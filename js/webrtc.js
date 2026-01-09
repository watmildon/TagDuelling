/**
 * WebRTC Module
 * Handles peer-to-peer connections for multiplayer games
 * Uses room codes for signaling via Cloudflare Worker
 */

// Connection state
let peerConnection = null;
let dataChannel = null;
let isHost = false;
let connectionState = 'disconnected'; // disconnected, connecting, connected
let currentRoomCode = null;
let pollingInterval = null;
let intentionalDisconnect = false; // Track user-initiated disconnects

// Callbacks
let onMessageCallback = null;
let onConnectedCallback = null;
let onDisconnectedCallback = null;
let onStateChangeCallback = null;

// Cloudflare Worker base URL
const WORKER_BASE_URL = 'https://tag-duelling.matthew-whilden.workers.dev';

// Fallback ICE servers (STUN only) if TURN fetch fails
const FALLBACK_ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Cached ICE servers config (populated by fetchTurnCredentials)
let cachedIceServers = null;

// Timeout for ICE gathering (ms)
const ICE_GATHERING_TIMEOUT = 10000;

// Polling interval for host waiting for guest (ms)
const POLL_INTERVAL = 2000;

// Polling timeout (ms) - stop after 5 minutes
const POLL_TIMEOUT = 300000;

/**
 * Fetch TURN credentials from Cloudflare Worker
 * @returns {Promise<Object>} ICE servers configuration
 */
async function fetchTurnCredentials() {
    try {
        const response = await fetch(`${WORKER_BASE_URL}/generate-turn-creds`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();

        // Use response directly as ICE servers config
        cachedIceServers = {
            iceServers: [data.iceServers]
        };

        console.log('WebRTC: TURN credentials fetched successfully');
        return cachedIceServers;
    } catch (err) {
        console.warn('WebRTC: Failed to fetch TURN credentials, using STUN fallback:', err);
        return FALLBACK_ICE_SERVERS;
    }
}

/**
 * Get ICE servers config (fetches TURN creds if not cached)
 * @returns {Promise<Object>} ICE servers configuration
 */
async function getIceServers() {
    if (cachedIceServers) {
        return cachedIceServers;
    }
    return await fetchTurnCredentials();
}

/**
 * Set callback for incoming messages
 * @param {Function} callback - Called with parsed message object
 */
export function onMessage(callback) {
    onMessageCallback = callback;
}

/**
 * Set callback for connection established
 * @param {Function} callback - Called when data channel opens
 */
export function onConnected(callback) {
    onConnectedCallback = callback;
}

/**
 * Set callback for disconnection
 * @param {Function} callback - Called when connection closes
 */
export function onDisconnected(callback) {
    onDisconnectedCallback = callback;
}

/**
 * Set callback for state changes
 * @param {Function} callback - Called with new state string
 */
export function onStateChange(callback) {
    onStateChangeCallback = callback;
}

/**
 * Update connection state and notify
 */
function setState(newState) {
    connectionState = newState;
    if (onStateChangeCallback) {
        onStateChangeCallback(newState);
    }
}

/**
 * Get current connection state
 * @returns {string} Current state
 */
export function getState() {
    return connectionState;
}

/**
 * Check if we're the host
 * @returns {boolean}
 */
export function getIsHost() {
    return isHost;
}

/**
 * Get current room code
 * @returns {string|null}
 */
export function getRoomCode() {
    return currentRoomCode;
}

/**
 * Set up peer connection event handlers for diagnostics
 * @param {RTCPeerConnection} pc
 */
function setupPeerConnectionHandlers(pc) {
    pc.oniceconnectionstatechange = () => {
        console.log('WebRTC: ICE connection state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
            console.error('WebRTC: ICE connection failed - check network/firewall');
        } else if (pc.iceConnectionState === 'disconnected') {
            console.warn('WebRTC: ICE connection disconnected');
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('WebRTC: Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
            console.error('WebRTC: Connection failed');
            setState('disconnected');
            if (onDisconnectedCallback && !intentionalDisconnect) {
                onDisconnectedCallback();
            }
        }
    };

    pc.onicecandidateerror = (event) => {
        // Only log significant errors (not STUN timeouts which are normal)
        if (event.errorCode !== 701) {
            console.warn('WebRTC: ICE candidate error:', event.errorCode, event.errorText);
        }
    };
}

/**
 * Create a room and return the room code
 * Host creates offer, stores in KV, gets back a short code
 * @returns {Promise<string>} Room code (e.g., "X7K9M2")
 */
export async function createRoom() {
    isHost = true;
    intentionalDisconnect = false; // Reset for new connection
    setState('connecting');

    // Clean up any existing connection
    cleanup();

    // Fetch TURN credentials and create peer connection
    const iceServers = await getIceServers();
    peerConnection = new RTCPeerConnection(iceServers);
    setupPeerConnectionHandlers(peerConnection);

    // Create data channel (host creates it)
    dataChannel = peerConnection.createDataChannel('game', {
        ordered: true
    });
    setupDataChannel(dataChannel);

    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    const completeOffer = await waitForIceGathering();

    // Encode offer as base64
    const offerToken = btoa(JSON.stringify({
        type: 'offer',
        sdp: completeOffer.sdp
    }));

    // Send to worker to create room
    const response = await fetch(`${WORKER_BASE_URL}/room/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer: offerToken })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create room');
    }

    const data = await response.json();
    currentRoomCode = data.code;

    console.log('WebRTC: Room created with code:', currentRoomCode);
    return currentRoomCode;
}

/**
 * Start polling for guest to join
 * @param {Function} onTimeout - Called if polling times out
 * @returns {Promise<void>} Resolves when guest joins and connection established
 */
export function waitForGuest(onTimeout) {
    return new Promise((resolve, reject) => {
        if (!currentRoomCode) {
            reject(new Error('No room code - create room first'));
            return;
        }

        const startTime = Date.now();

        pollingInterval = setInterval(async () => {
            try {
                // Check for timeout
                if (Date.now() - startTime > POLL_TIMEOUT) {
                    stopPolling();
                    if (onTimeout) onTimeout();
                    reject(new Error('Room expired'));
                    return;
                }

                const response = await fetch(`${WORKER_BASE_URL}/room/${currentRoomCode}`);

                if (!response.ok) {
                    if (response.status === 404) {
                        stopPolling();
                        reject(new Error('Room expired'));
                        return;
                    }
                    return; // Retry on other errors
                }

                const data = await response.json();

                if (data.hasAnswer && data.answer) {
                    stopPolling();

                    // Process the answer
                    await acceptAnswer(data.answer);
                    resolve();
                }
            } catch (err) {
                console.error('WebRTC: Polling error:', err);
                // Continue polling on transient errors
            }
        }, POLL_INTERVAL);
    });
}

/**
 * Stop polling for guest
 */
export function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

/**
 * Join a room with a code
 * Guest fetches offer, creates answer, stores answer in KV
 * @param {string} code - Room code to join
 * @returns {Promise<void>} Resolves when answer is submitted (connection will establish after)
 */
export async function joinRoom(code) {
    isHost = false;
    intentionalDisconnect = false; // Reset for new connection
    setState('connecting');

    // Clean up any existing connection first
    cleanup();

    // Set room code after cleanup (cleanup resets it)
    currentRoomCode = code.toUpperCase();

    // Fetch TURN credentials and create peer connection
    const iceServers = await getIceServers();
    peerConnection = new RTCPeerConnection(iceServers);
    setupPeerConnectionHandlers(peerConnection);

    // Handle incoming data channel (guest receives it)
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };

    // Fetch room to get offer
    const statusResponse = await fetch(`${WORKER_BASE_URL}/room/${currentRoomCode}`);

    if (!statusResponse.ok) {
        if (statusResponse.status === 404) {
            throw new Error('Room not found or expired');
        }
        const error = await statusResponse.json();
        throw new Error(error.error || 'Failed to get room');
    }

    const statusData = await statusResponse.json();

    if (statusData.hasAnswer) {
        throw new Error('Room already has a player');
    }

    if (!statusData.offer) {
        throw new Error('Room has no offer');
    }

    // Decode offer
    let offer;
    try {
        offer = JSON.parse(atob(statusData.offer));
    } catch (e) {
        throw new Error('Invalid offer in room');
    }

    if (offer.type !== 'offer') {
        throw new Error('Invalid offer type');
    }

    // Set remote description (the offer)
    await peerConnection.setRemoteDescription({
        type: 'offer',
        sdp: offer.sdp
    });

    // Create answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Wait for ICE gathering to complete
    const completeAnswer = await waitForIceGathering();

    // Encode answer as base64
    const answerToken = btoa(JSON.stringify({
        type: 'answer',
        sdp: completeAnswer.sdp
    }));

    // Submit answer to room
    const joinResponse = await fetch(`${WORKER_BASE_URL}/room/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: currentRoomCode, answer: answerToken })
    });

    if (!joinResponse.ok) {
        const error = await joinResponse.json();
        throw new Error(error.error || 'Failed to join room');
    }

    console.log('WebRTC: Joined room, waiting for connection...');
    // Connection will establish when host polls and processes our answer
}

/**
 * Accept an answer token (internal use by host)
 * @param {string} answerToken - Base64 encoded answer from guest
 */
async function acceptAnswer(answerToken) {
    // Decode answer
    let answer;
    try {
        answer = JSON.parse(atob(answerToken));
    } catch (e) {
        throw new Error('Invalid answer token');
    }

    if (answer.type !== 'answer') {
        throw new Error('Token is not an answer');
    }

    // Set remote description (the answer)
    await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answer.sdp
    });

    // Connection should establish automatically now
    console.log('WebRTC: Answer accepted, connection establishing...');
}

/**
 * Wait for ICE gathering to complete
 * @returns {Promise<RTCSessionDescription>} Complete local description with all candidates
 */
function waitForIceGathering() {
    return new Promise((resolve, reject) => {
        // Check if already complete
        if (peerConnection.iceGatheringState === 'complete') {
            resolve(peerConnection.localDescription);
            return;
        }

        // Set timeout
        const timeout = setTimeout(() => {
            // Resolve with what we have even if not complete
            console.warn('ICE gathering timed out, using partial candidates');
            resolve(peerConnection.localDescription);
        }, ICE_GATHERING_TIMEOUT);

        // Listen for gathering complete
        peerConnection.onicegatheringstatechange = () => {
            if (peerConnection.iceGatheringState === 'complete') {
                clearTimeout(timeout);
                resolve(peerConnection.localDescription);
            }
        };
    });
}

/**
 * Set up data channel event handlers
 * @param {RTCDataChannel} channel
 */
function setupDataChannel(channel) {
    channel.onopen = () => {
        console.log('WebRTC: Data channel opened');
        setState('connected');
        if (onConnectedCallback) {
            onConnectedCallback();
        }
    };

    channel.onclose = () => {
        console.log('WebRTC: Data channel closed');
        setState('disconnected');
        if (onDisconnectedCallback && !intentionalDisconnect) {
            onDisconnectedCallback();
        }
    };

    channel.onerror = (error) => {
        console.error('WebRTC: Data channel error:', error);
    };

    channel.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('WebRTC: Received message:', message);
            if (onMessageCallback) {
                onMessageCallback(message);
            }
        } catch (e) {
            console.error('WebRTC: Failed to parse message:', e);
        }
    };
}

/**
 * Send a message to the remote peer
 * @param {Object} message - Object to send (will be JSON stringified)
 * @returns {boolean} True if sent successfully
 */
export function send(message) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        console.warn('WebRTC: Cannot send, data channel not open');
        return false;
    }

    try {
        dataChannel.send(JSON.stringify(message));
        console.log('WebRTC: Sent message:', message);
        return true;
    } catch (e) {
        console.error('WebRTC: Failed to send message:', e);
        return false;
    }
}

/**
 * Check if connected
 * @returns {boolean}
 */
export function isConnected() {
    return dataChannel && dataChannel.readyState === 'open';
}

/**
 * Clean up connection
 */
export function cleanup() {
    stopPolling();

    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    currentRoomCode = null;
    setState('disconnected');
}

/**
 * Disconnect and clean up (user-initiated)
 */
export function disconnect() {
    intentionalDisconnect = true;
    cleanup();
}
