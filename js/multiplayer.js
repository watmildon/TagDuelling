/**
 * Multiplayer Module
 * Handles game synchronization over WebRTC
 */

import * as webrtc from './webrtc.js';
import * as state from './gameState.js';

// Multiplayer state
let isMultiplayer = false;
let localPlayerIndex = 0; // 0 = host (player 1), 1 = guest (player 2)

// Callbacks
let onRemoteActionCallback = null;

/**
 * Message types for game sync
 */
const MSG_TYPES = {
    // Game setup
    GAME_START: 'game_start',
    GAME_CONFIG: 'game_config',
    PLAYER_NAME: 'player_name', // Guest sends their name to host

    // Game actions
    ADD_TAG: 'add_tag',
    SPECIFY_VALUE: 'specify_value',
    CHALLENGE: 'challenge',
    CHALLENGE_RESULT: 'challenge_result',

    // Game flow
    PLAY_AGAIN: 'play_again',
    BACK_TO_SETUP: 'back_to_setup'
};

/**
 * Initialize multiplayer handlers
 */
export function init() {
    webrtc.onMessage(handleRemoteMessage);
    // Note: onConnected and onDisconnected callbacks are handled by main.js
    // which calls notifyConnected() and notifyDisconnected() to forward events
}

/**
 * Set callback for remote actions
 * @param {Function} callback - Called with action type and data
 */
export function onRemoteAction(callback) {
    onRemoteActionCallback = callback;
}

/**
 * Check if currently in multiplayer mode
 * @returns {boolean}
 */
export function isMultiplayerMode() {
    return isMultiplayer && webrtc.isConnected();
}

/**
 * Get local player index (0 or 1)
 * @returns {number}
 */
export function getLocalPlayerIndex() {
    return localPlayerIndex;
}

/**
 * Check if it's the local player's turn
 * @returns {boolean}
 */
export function isLocalPlayerTurn() {
    if (!isMultiplayer) return true;
    const currentState = state.getState();
    return currentState.currentPlayerIndex === localPlayerIndex;
}

/**
 * Handle connection established
 */
function handleConnected() {
    isMultiplayer = true;
    localPlayerIndex = webrtc.getIsHost() ? 0 : 1;
    console.log('Multiplayer: Connected as player', localPlayerIndex + 1);
}

/**
 * Notify multiplayer module that connection is established
 * Called by main.js since webrtc only supports one onConnected callback
 */
export function notifyConnected() {
    handleConnected();
}

/**
 * Handle disconnection
 */
function handleDisconnected() {
    isMultiplayer = false;
    console.log('Multiplayer: Disconnected');
}

/**
 * Notify multiplayer module that connection is lost
 * Called by main.js since webrtc only supports one onDisconnected callback
 */
export function notifyDisconnected() {
    handleDisconnected();
}

/**
 * Handle incoming message from remote peer
 */
function handleRemoteMessage(message) {
    console.log('Multiplayer: Received', message.type, message);

    switch (message.type) {
        case MSG_TYPES.GAME_START:
            handleRemoteGameStart(message);
            break;

        case MSG_TYPES.GAME_CONFIG:
            handleRemoteGameConfig(message);
            break;

        case MSG_TYPES.ADD_TAG:
            handleRemoteAddTag(message);
            break;

        case MSG_TYPES.SPECIFY_VALUE:
            handleRemoteSpecifyValue(message);
            break;

        case MSG_TYPES.CHALLENGE:
            handleRemoteChallenge(message);
            break;

        case MSG_TYPES.CHALLENGE_RESULT:
            handleRemoteChallengeResult(message);
            break;

        case MSG_TYPES.PLAY_AGAIN:
            handleRemotePlayAgain();
            break;

        case MSG_TYPES.BACK_TO_SETUP:
            handleRemoteBackToSetup();
            break;

        case MSG_TYPES.PLAYER_NAME:
            handleRemotePlayerName(message);
            break;

        default:
            console.warn('Multiplayer: Unknown message type:', message.type);
    }
}

/**
 * Send game start to remote (host only)
 */
export function sendGameStart(region, players) {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.GAME_START,
        region: region,
        players: players.map(p => ({ name: p.name, isBot: false }))
    });
}

/**
 * Send game config to remote before starting (host only)
 */
export function sendGameConfig(region) {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.GAME_CONFIG,
        region: region
    });
}

/**
 * Send player name to host (guest only)
 * @param {string} name - Player's name
 */
export function sendPlayerName(name) {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.PLAYER_NAME,
        name: name,
        playerIndex: localPlayerIndex
    });
}

/**
 * Send add tag action
 */
export function sendAddTag(key, value) {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.ADD_TAG,
        key: key,
        value: value
    });
}

/**
 * Send specify value action
 */
export function sendSpecifyValue(key, value) {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.SPECIFY_VALUE,
        key: key,
        value: value
    });
}

/**
 * Send challenge action
 */
export function sendChallenge() {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.CHALLENGE
    });
}

/**
 * Send challenge result (from whoever ran the query)
 */
export function sendChallengeResult(count) {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.CHALLENGE_RESULT,
        count: count
    });
}

/**
 * Send play again
 */
export function sendPlayAgain() {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.PLAY_AGAIN
    });
}

/**
 * Send back to setup
 */
export function sendBackToSetup() {
    if (!webrtc.isConnected()) return;

    webrtc.send({
        type: MSG_TYPES.BACK_TO_SETUP
    });
}

// Remote message handlers

function handleRemoteGameStart(message) {
    // Update player names from host
    if (message.players && message.players.length >= 2) {
        state.updatePlayerName(0, message.players[0].name);
        state.updatePlayerName(1, message.players[1].name);
    }

    // Set region from host
    if (message.region) {
        state.setRegion(message.region);
    } else {
        state.setRegion(null); // Global region
    }

    // Start the game (transitions from WAITING to PLAYING for guest)
    state.startGame();

    if (onRemoteActionCallback) {
        onRemoteActionCallback('game_start', message);
    }
}

function handleRemoteGameConfig(message) {
    if (message.region) {
        state.setRegion(message.region);
    }

    if (onRemoteActionCallback) {
        onRemoteActionCallback('game_config', message);
    }
}

function handleRemoteAddTag(message) {
    state.addTag(message.key, message.value);
    state.nextTurn();

    if (onRemoteActionCallback) {
        onRemoteActionCallback('add_tag', message);
    }
}

function handleRemoteSpecifyValue(message) {
    state.specifyTagValue(message.key, message.value);
    state.nextTurn();

    if (onRemoteActionCallback) {
        onRemoteActionCallback('specify_value', message);
    }
}

function handleRemoteChallenge(message) {
    state.initiateChallenge();

    if (onRemoteActionCallback) {
        onRemoteActionCallback('challenge', message);
    }
}

function handleRemoteChallengeResult(message) {
    state.setChallengeResult(message.count);

    if (onRemoteActionCallback) {
        onRemoteActionCallback('challenge_result', message);
    }
}

function handleRemotePlayAgain() {
    state.playAgain();

    if (onRemoteActionCallback) {
        onRemoteActionCallback('play_again', {});
    }
}

function handleRemoteBackToSetup() {
    // Guest goes back to waiting state, not setup
    // (Only host can be on setup screen in multiplayer)
    state.enterWaitingState();

    if (onRemoteActionCallback) {
        onRemoteActionCallback('back_to_setup', {});
    }
}

function handleRemotePlayerName(message) {
    // Update remote player's name
    if (message.playerIndex >= 0) {
        state.updatePlayerName(message.playerIndex, message.name);
    }

    if (onRemoteActionCallback) {
        onRemoteActionCallback('player_name', message);
    }
}

/**
 * Reset multiplayer state
 */
export function reset() {
    isMultiplayer = false;
    localPlayerIndex = 0;
    webrtc.disconnect();
}
