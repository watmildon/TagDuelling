/**
 * Guest Controller Module
 * Handles guest-side state reception and action submission.
 * Guest receives authoritative state from host and submits actions as requests.
 */

import * as webrtc from './webrtc.js';
import * as state from './gameState.js';
import * as protocol from './protocol.js';

// Controller state
let initialized = false;
let localPlayerIndex = 1;
let lastReceivedVersion = 0;
let pendingAction = null;
let heartbeatTimeout = null;
let welcomeReceived = false;
let lastRematchStatus = { host: false, guest: false };
let lastSessionWins = { host: 0, guest: 0 };

// Callbacks
let onStateReceived = null;
let onActionRejected = null;
let onHostDisconnected = null;
let onWelcomeReceived = null;

// Constants
const HEARTBEAT_TIMEOUT_MS = 30000;

/**
 * Initialize guest controller
 */
export function initialize() {
    if (initialized) return;

    initialized = true;
    localPlayerIndex = 1;
    lastReceivedVersion = 0;
    pendingAction = null;
    welcomeReceived = false;

    console.log('GuestController: Initialized, waiting for welcome');
}

/**
 * Handle incoming message from host
 * @param {Object} message - Parsed message object
 */
export function handleHostMessage(message) {
    if (!initialized) {
        console.warn('GuestController: Received message before initialization');
        return;
    }

    // Any message from host resets heartbeat timeout
    resetHeartbeatTimeout();

    switch (message.type) {
        case protocol.HostMessage.WELCOME:
            handleWelcome(message);
            break;
        case protocol.HostMessage.STATE_SYNC:
            handleStateSync(message);
            break;
        case protocol.HostMessage.ACTION_REJECTED:
            handleActionRejected(message);
            break;
        case protocol.HostMessage.PING:
            handlePing();
            break;
        case protocol.HostMessage.GAME_ENDED:
            handleGameEnded(message);
            break;
        default:
            console.warn('GuestController: Unknown message type:', message.type);
    }
}

/**
 * Submit a turn action to host
 * @param {string} action - 'add_tag' or 'specify_value'
 * @param {string} key - Tag key
 * @param {string|null} value - Tag value
 */
export function submitTurn(action, key, value) {
    if (!welcomeReceived) {
        console.warn('GuestController: Cannot submit turn before welcome');
        return;
    }

    pendingAction = { type: 'turn', action, key, value };
    sendToHost(protocol.createSubmitTurn(action, key, value));
}

/**
 * Submit a challenge to host
 */
export function challenge() {
    if (!welcomeReceived) {
        console.warn('GuestController: Cannot challenge before welcome');
        return;
    }

    pendingAction = { type: 'challenge' };
    sendToHost(protocol.createChallenge());
}

/**
 * Request a rematch
 */
export function requestRematch() {
    if (!welcomeReceived) {
        console.warn('GuestController: Cannot request rematch before welcome');
        return;
    }

    sendToHost(protocol.createRequestRematch());
}

/**
 * Set player name
 * @param {string} name - Guest's chosen name
 */
export function setName(name) {
    if (!welcomeReceived) {
        console.warn('GuestController: Cannot set name before welcome');
        return;
    }

    sendToHost(protocol.createSetName(name));
}

/**
 * Check if it's the local player's turn
 * @returns {boolean}
 */
export function isLocalPlayerTurn() {
    const currentState = state.getState();
    return currentState.currentPlayerIndex === localPlayerIndex;
}

/**
 * Shutdown controller
 */
export function shutdown() {
    clearHeartbeatTimeout();
    initialized = false;
    welcomeReceived = false;
    lastReceivedVersion = 0;
    pendingAction = null;
    lastRematchStatus = { host: false, guest: false };
    lastSessionWins = { host: 0, guest: 0 };
    console.log('GuestController: Shutdown');
}

// Callback setters
export function setOnStateReceived(callback) { onStateReceived = callback; }
export function setOnActionRejected(callback) { onActionRejected = callback; }
export function setOnHostDisconnected(callback) { onHostDisconnected = callback; }
export function setOnWelcomeReceived(callback) { onWelcomeReceived = callback; }

// Internal message handlers

function handleWelcome(message) {
    localPlayerIndex = message.playerIndex;
    welcomeReceived = true;

    console.log('GuestController: Received welcome, player index:', localPlayerIndex);

    // Start heartbeat monitoring
    resetHeartbeatTimeout();

    if (onWelcomeReceived) {
        onWelcomeReceived(localPlayerIndex);
    }
}

function handleStateSync(message) {
    const { version, state: receivedState } = message;

    // Only process if newer version
    if (!protocol.isNewerVersion(version, lastReceivedVersion)) {
        console.log('GuestController: Ignoring old state version:', version, 'last:', lastReceivedVersion);
        // Still send ACK for idempotency
        sendToHost(protocol.createAck(version));
        return;
    }

    lastReceivedVersion = version;

    // Send acknowledgment immediately
    sendToHost(protocol.createAck(version));

    // Clear pending action - state update means it was processed (or we need to resync)
    pendingAction = null;

    // Extract rematch status from received state
    if (receivedState.rematchRequested) {
        lastRematchStatus = { ...receivedState.rematchRequested };
    }

    // Extract session wins from received state
    if (receivedState.sessionWins) {
        lastSessionWins = { ...receivedState.sessionWins };
    }

    // Apply state to local gameState
    applyReceivedState(receivedState);

    if (onStateReceived) {
        onStateReceived(receivedState);
    }
}

function applyReceivedState(receivedState) {
    // Determine the appropriate game phase for guest
    // Guest stays in WAITING while host is in SETUP
    let guestPhase = receivedState.gamePhase;
    if (receivedState.gamePhase === state.PHASES.SETUP) {
        guestPhase = state.PHASES.WAITING;
    }

    // Use replaceState for clean state application
    state.replaceState({
        players: receivedState.players,
        currentPlayerIndex: receivedState.currentPlayerIndex,
        tags: receivedState.tags,
        region: receivedState.region,
        gamePhase: guestPhase,
        challenger: receivedState.challenger,
        challengeResult: receivedState.challengeResult
    });
}

function handleActionRejected(message) {
    console.log('GuestController: Action rejected:', message.reason, message.message);
    pendingAction = null;

    if (onActionRejected) {
        onActionRejected(message.reason, message.message);
    }
}

function handlePing() {
    sendToHost(protocol.createPong());
}

function handleGameEnded(message) {
    console.log('GuestController: Game ended:', message.reason);

    const reason = message.reason;
    shutdown();

    if (onHostDisconnected) {
        onHostDisconnected(reason);
    }
}

// Communication

function sendToHost(message) {
    if (!webrtc.isConnected()) {
        console.warn('GuestController: Cannot send, not connected');
        return false;
    }
    return webrtc.send(message);
}

// Heartbeat timeout

function resetHeartbeatTimeout() {
    clearHeartbeatTimeout();
    heartbeatTimeout = setTimeout(() => {
        console.error('GuestController: Heartbeat timeout - host not responding');
        if (onHostDisconnected) {
            onHostDisconnected(protocol.GameEndReason.CONNECTION_LOST);
        }
    }, HEARTBEAT_TIMEOUT_MS);
}

function clearHeartbeatTimeout() {
    if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
    }
}

// Public getters

export function isInitialized() { return initialized; }
export function isWelcomeReceived() { return welcomeReceived; }
export function getLocalPlayerIndex() { return localPlayerIndex; }
export function hasPendingAction() { return pendingAction !== null; }
export function getPendingAction() { return pendingAction; }
export function getLastReceivedVersion() { return lastReceivedVersion; }
export function getRematchStatus() { return { ...lastRematchStatus }; }
export function getSessionWins() { return { ...lastSessionWins }; }
