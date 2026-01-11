/**
 * Protocol Module
 * Defines all message types and payload schemas for host-guest communication
 * in the host-authoritative multiplayer architecture.
 */

// Message types: Host → Guest
export const HostMessage = {
    WELCOME: 'welcome',           // Initial connection acknowledgment
    STATE_SYNC: 'state_sync',     // Full game state broadcast
    ACTION_REJECTED: 'action_rejected', // Guest action was invalid
    PING: 'ping',                 // Connection health check
    GAME_ENDED: 'game_ended'      // Session terminated
};

// Message types: Guest → Host
export const GuestMessage = {
    SET_NAME: 'set_name',         // Guest sets their display name
    SUBMIT_TURN: 'submit_turn',   // Guest submits tag/value
    CHALLENGE: 'challenge',       // Guest initiates challenge
    REQUEST_REMATCH: 'request_rematch', // Guest wants another round
    ACK: 'ack',                   // Acknowledge received state
    PONG: 'pong'                  // Response to ping
};

// Rejection reasons
export const RejectionReason = {
    NOT_YOUR_TURN: 'not_your_turn',
    INVALID_TAG: 'invalid_tag',
    DUPLICATE_TAG: 'duplicate_tag',
    GAME_NOT_PLAYING: 'game_not_playing',
    INVALID_ACTION: 'invalid_action'
};

// Game end reasons
export const GameEndReason = {
    HOST_LEFT: 'host_left',
    HOST_ENDED_SESSION: 'host_ended_session',
    CONNECTION_LOST: 'connection_lost'
};

// Maximum safe version number before wraparound
const MAX_VERSION = Number.MAX_SAFE_INTEGER;

/**
 * Check if received version is newer than last version (handles wraparound)
 * @param {number} received - Received version number
 * @param {number} last - Last known version number
 * @returns {boolean} True if received is newer
 */
export function isNewerVersion(received, last) {
    // Handle wraparound: if difference is huge, assume wraparound
    if (last > received && last - received > MAX_VERSION / 2) {
        return true;
    }
    return received > last;
}

/**
 * Create a state sync message
 * @param {Object} gameState - Full game state from gameState.js
 * @param {number} version - State version number
 * @param {Object} rematchRequested - Rematch request status { host, guest }
 * @param {Object} sessionWins - Win counts { host, guest }
 * @returns {Object} STATE_SYNC message
 */
export function createStateSync(gameState, version, rematchRequested = { host: false, guest: false }, sessionWins = { host: 0, guest: 0 }) {
    return {
        type: HostMessage.STATE_SYNC,
        version,
        state: {
            players: gameState.players,
            currentPlayerIndex: gameState.currentPlayerIndex,
            tags: gameState.tags,
            region: gameState.region,
            gamePhase: gameState.gamePhase,
            challenger: gameState.challenger,
            challengeResult: gameState.challengeResult,
            rematchRequested: rematchRequested,
            sessionWins: sessionWins
        }
    };
}

/**
 * Create a welcome message
 * @param {number} playerIndex - Assigned player index (always 1 for guest)
 * @returns {Object} WELCOME message
 */
export function createWelcome(playerIndex) {
    return {
        type: HostMessage.WELCOME,
        playerIndex
    };
}

/**
 * Create an action rejected message
 * @param {string} reason - One of RejectionReason values
 * @param {string} message - Human-readable explanation
 * @returns {Object} ACTION_REJECTED message
 */
export function createActionRejected(reason, message) {
    return {
        type: HostMessage.ACTION_REJECTED,
        reason,
        message
    };
}

/**
 * Create a ping message
 * @returns {Object} PING message
 */
export function createPing() {
    return {
        type: HostMessage.PING
    };
}

/**
 * Create a game ended message
 * @param {string} reason - One of GameEndReason values
 * @returns {Object} GAME_ENDED message
 */
export function createGameEnded(reason) {
    return {
        type: HostMessage.GAME_ENDED,
        reason
    };
}

/**
 * Create a set name message
 * @param {string} name - Guest's chosen name
 * @returns {Object} SET_NAME message
 */
export function createSetName(name) {
    return {
        type: GuestMessage.SET_NAME,
        name
    };
}

/**
 * Create a submit turn message
 * @param {string} action - 'add_tag' or 'specify_value'
 * @param {string} key - Tag key
 * @param {string|null} value - Tag value (null for key-only)
 * @returns {Object} SUBMIT_TURN message
 */
export function createSubmitTurn(action, key, value) {
    return {
        type: GuestMessage.SUBMIT_TURN,
        action,
        key,
        value
    };
}

/**
 * Create a challenge message
 * @returns {Object} CHALLENGE message
 */
export function createChallenge() {
    return {
        type: GuestMessage.CHALLENGE
    };
}

/**
 * Create a request rematch message
 * @returns {Object} REQUEST_REMATCH message
 */
export function createRequestRematch() {
    return {
        type: GuestMessage.REQUEST_REMATCH
    };
}

/**
 * Create an acknowledgment message
 * @param {number} version - Version being acknowledged
 * @returns {Object} ACK message
 */
export function createAck(version) {
    return {
        type: GuestMessage.ACK,
        version
    };
}

/**
 * Create a pong message
 * @returns {Object} PONG message
 */
export function createPong() {
    return {
        type: GuestMessage.PONG
    };
}
