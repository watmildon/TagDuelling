/**
 * Host Controller Module
 * Manages authoritative game state and guest communication.
 * The host is the single source of truth for all game state.
 */

import * as webrtc from './webrtc.js';
import * as state from './gameState.js';
import * as protocol from './protocol.js';

// Controller state
let initialized = false;
let stateVersion = 0;
let pendingAck = false;
let ackTimeout = null;
let retryCount = 0;
let heartbeatInterval = null;
let guestConnected = false;
let rematchRequested = { host: false, guest: false };

// Callbacks for UI updates and game events
let onGuestNameChanged = null;
let onRematchStatusChanged = null;
let onGuestDisconnected = null;
let onChallengeRequested = null;

// Constants
const ACK_TIMEOUT_MS = 3000;
const MAX_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 10000;
const MAX_VERSION = Number.MAX_SAFE_INTEGER;

/**
 * Initialize host controller when guest connects
 */
export function initialize() {
    if (initialized) return;

    initialized = true;
    guestConnected = true;
    stateVersion = 0;
    retryCount = 0;
    pendingAck = false;
    rematchRequested = { host: false, guest: false };

    // Send welcome message
    sendToGuest(protocol.createWelcome(1));

    // Start heartbeat
    startHeartbeat();

    console.log('HostController: Initialized');
}

/**
 * Handle incoming message from guest
 * @param {Object} message - Parsed message object
 */
export function handleGuestMessage(message) {
    if (!initialized) {
        console.warn('HostController: Received message before initialization');
        return;
    }

    switch (message.type) {
        case protocol.GuestMessage.SET_NAME:
            handleSetName(message.name);
            break;
        case protocol.GuestMessage.SUBMIT_TURN:
            handleGuestTurn(message);
            break;
        case protocol.GuestMessage.CHALLENGE:
            handleGuestChallenge();
            break;
        case protocol.GuestMessage.REQUEST_REMATCH:
            handleGuestRematchRequest();
            break;
        case protocol.GuestMessage.ACK:
            handleAck(message.version);
            break;
        case protocol.GuestMessage.PONG:
            handlePong();
            break;
        default:
            console.warn('HostController: Unknown message type:', message.type);
    }
}

/**
 * Broadcast current state to guest
 */
export function broadcastState() {
    if (!guestConnected) return;

    incrementVersion();
    const currentState = state.getState();

    const message = protocol.createStateSync(currentState, stateVersion, rematchRequested);
    pendingAck = true;
    retryCount = 0;

    sendToGuest(message);
    startAckTimeout();
}

/**
 * Notify controller that host performed a local action
 * State is updated by main.js, we just broadcast
 */
export function handleLocalAction() {
    broadcastState();
}

/**
 * Handle host's local challenge initiation
 * Called after state.initiateChallenge()
 */
export function handleLocalChallenge() {
    broadcastState();
}

/**
 * Handle challenge result from query execution
 * Called after state.setChallengeResult()
 */
export function handleChallengeResult() {
    broadcastState();
}

/**
 * Handle host's local rematch request
 */
export function handleLocalRematchRequest() {
    rematchRequested.host = true;

    if (rematchRequested.guest) {
        // Both requested - start new round
        startNewRound();
    } else {
        // Just update status and broadcast
        broadcastState();
        if (onRematchStatusChanged) {
            onRematchStatusChanged({ ...rematchRequested });
        }
    }
}

/**
 * Handle host ending the session
 */
export function endSession() {
    if (guestConnected) {
        sendToGuest(protocol.createGameEnded(protocol.GameEndReason.HOST_ENDED_SESSION));
    }
    shutdown();
}

/**
 * Shutdown controller
 */
export function shutdown() {
    stopHeartbeat();
    clearAckTimeout();
    initialized = false;
    guestConnected = false;
    stateVersion = 0;
    retryCount = 0;
    pendingAck = false;
    rematchRequested = { host: false, guest: false };
    console.log('HostController: Shutdown');
}

// Callback setters
export function setOnGuestNameChanged(callback) { onGuestNameChanged = callback; }
export function setOnRematchStatusChanged(callback) { onRematchStatusChanged = callback; }
export function setOnGuestDisconnected(callback) { onGuestDisconnected = callback; }
export function setOnChallengeRequested(callback) { onChallengeRequested = callback; }

// Internal message handlers

function handleSetName(name) {
    const sanitizedName = (name || 'Guest').trim().substring(0, 30) || 'Guest';
    state.updatePlayerName(1, sanitizedName);

    if (onGuestNameChanged) {
        onGuestNameChanged(sanitizedName);
    }

    broadcastState();
}

function handleGuestTurn(message) {
    const currentState = state.getState();

    // Validate it's guest's turn
    if (currentState.currentPlayerIndex !== 1) {
        sendToGuest(protocol.createActionRejected(
            protocol.RejectionReason.NOT_YOUR_TURN,
            "It's not your turn"
        ));
        return;
    }

    // Validate game is in playing phase
    if (currentState.gamePhase !== state.PHASES.PLAYING) {
        sendToGuest(protocol.createActionRejected(
            protocol.RejectionReason.GAME_NOT_PLAYING,
            "Game is not in playing phase"
        ));
        return;
    }

    // Process the turn
    let success = false;
    if (message.action === 'add_tag') {
        success = state.addTag(message.key, message.value);
        if (!success) {
            sendToGuest(protocol.createActionRejected(
                protocol.RejectionReason.DUPLICATE_TAG,
                "That tag key already exists"
            ));
            return;
        }
    } else if (message.action === 'specify_value') {
        success = state.specifyTagValue(message.key, message.value);
        if (!success) {
            sendToGuest(protocol.createActionRejected(
                protocol.RejectionReason.INVALID_TAG,
                "Cannot specify value for that tag"
            ));
            return;
        }
    } else {
        sendToGuest(protocol.createActionRejected(
            protocol.RejectionReason.INVALID_ACTION,
            "Unknown action type"
        ));
        return;
    }

    state.nextTurn();
    broadcastState();
}

function handleGuestChallenge() {
    const currentState = state.getState();

    // Validate it's guest's turn
    if (currentState.currentPlayerIndex !== 1) {
        sendToGuest(protocol.createActionRejected(
            protocol.RejectionReason.NOT_YOUR_TURN,
            "It's not your turn"
        ));
        return;
    }

    // Validate game is in playing phase
    if (currentState.gamePhase !== state.PHASES.PLAYING) {
        sendToGuest(protocol.createActionRejected(
            protocol.RejectionReason.GAME_NOT_PLAYING,
            "Game is not in playing phase"
        ));
        return;
    }

    // Initiate challenge
    state.initiateChallenge();
    broadcastState();

    // Notify main.js to run the query
    if (onChallengeRequested) {
        onChallengeRequested();
    }
}

function handleGuestRematchRequest() {
    rematchRequested.guest = true;

    if (rematchRequested.host) {
        // Both requested - start new round
        startNewRound();
    } else {
        broadcastState();
        if (onRematchStatusChanged) {
            onRematchStatusChanged({ ...rematchRequested });
        }
    }
}

function startNewRound() {
    rematchRequested = { host: false, guest: false };

    // Get current round number and alternate starting player
    const currentState = state.getState();
    const currentRound = currentState.roundNumber || 1;
    const nextRound = currentRound + 1;
    const nextStartingPlayer = (nextRound - 1) % 2;

    state.playAgain();

    // Set the starting player for the new round
    // Note: playAgain() resets to player 0, so we may need to adjust
    if (nextStartingPlayer === 1) {
        state.nextTurn(); // Move to player 1
    }

    broadcastState();

    if (onRematchStatusChanged) {
        onRematchStatusChanged({ ...rematchRequested });
    }
}

function handleAck(version) {
    if (version === stateVersion) {
        pendingAck = false;
        clearAckTimeout();
        retryCount = 0;
    }
}

function handlePong() {
    // Guest is alive - could track last pong time for monitoring
}

// Communication

function sendToGuest(message) {
    if (!webrtc.isConnected()) {
        console.warn('HostController: Cannot send, not connected');
        return false;
    }
    return webrtc.send(message);
}

// Version management

function incrementVersion() {
    stateVersion = stateVersion >= MAX_VERSION ? 1 : stateVersion + 1;
}

// Acknowledgment handling

function startAckTimeout() {
    clearAckTimeout();
    ackTimeout = setTimeout(() => {
        if (pendingAck && retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`HostController: ACK timeout, retry ${retryCount}/${MAX_RETRIES}`);

            // Resend last state (same version)
            const currentState = state.getState();
            const message = protocol.createStateSync(currentState, stateVersion, rematchRequested);
            sendToGuest(message);
            startAckTimeout();
        } else if (pendingAck) {
            console.error('HostController: Guest not responding after', MAX_RETRIES, 'retries');
            guestConnected = false;
            if (onGuestDisconnected) {
                onGuestDisconnected();
            }
        }
    }, ACK_TIMEOUT_MS);
}

function clearAckTimeout() {
    if (ackTimeout) {
        clearTimeout(ackTimeout);
        ackTimeout = null;
    }
}

// Heartbeat

function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (guestConnected) {
            sendToGuest(protocol.createPing());
        }
    }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// Public getters

export function isInitialized() { return initialized; }
export function isGuestConnected() { return guestConnected; }
export function getRematchStatus() { return { ...rematchRequested }; }
export function getStateVersion() { return stateVersion; }
