/**
 * WebRTC Module
 * Handles peer-to-peer connections for multiplayer games
 * Uses "Vanilla ICE" - waits for all candidates before generating token
 */

// Connection state
let peerConnection = null;
let dataChannel = null;
let isHost = false;
let connectionState = 'disconnected'; // disconnected, connecting, connected

// Callbacks
let onMessageCallback = null;
let onConnectedCallback = null;
let onDisconnectedCallback = null;
let onStateChangeCallback = null;

// ICE servers (STUN only - no TURN needed for most connections)
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Timeout for ICE gathering (ms)
const ICE_GATHERING_TIMEOUT = 10000;

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
 * Create a new peer connection as host and generate offer token
 * @returns {Promise<string>} Base64 encoded offer token
 */
export async function createOffer() {
    isHost = true;
    setState('connecting');

    // Clean up any existing connection
    cleanup();

    // Create new peer connection
    peerConnection = new RTCPeerConnection(ICE_SERVERS);

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

    // Encode as base64 token
    const token = btoa(JSON.stringify({
        type: 'offer',
        sdp: completeOffer.sdp
    }));

    return token;
}

/**
 * Accept an offer token and generate answer token
 * @param {string} offerToken - Base64 encoded offer from host
 * @returns {Promise<string>} Base64 encoded answer token
 */
export async function acceptOffer(offerToken) {
    isHost = false;
    setState('connecting');

    // Clean up any existing connection
    cleanup();

    // Decode offer
    let offer;
    try {
        offer = JSON.parse(atob(offerToken));
    } catch (e) {
        throw new Error('Invalid offer token');
    }

    if (offer.type !== 'offer') {
        throw new Error('Token is not an offer');
    }

    // Create new peer connection
    peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Handle incoming data channel (guest receives it)
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel(dataChannel);
    };

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

    // Encode as base64 token
    const token = btoa(JSON.stringify({
        type: 'answer',
        sdp: completeAnswer.sdp
    }));

    return token;
}

/**
 * Complete connection by accepting answer token (host only)
 * @param {string} answerToken - Base64 encoded answer from guest
 */
export async function acceptAnswer(answerToken) {
    if (!isHost) {
        throw new Error('Only host can accept answer');
    }

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
        if (onDisconnectedCallback) {
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
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    setState('disconnected');
}

/**
 * Disconnect and clean up
 */
export function disconnect() {
    cleanup();
}
