/**
 * Game State Module
 * Manages the game state and provides mutation functions
 */

import { prefetchTagCount } from './overpass.js';

// DWG (Data Working Group) member IRC usernames for bot names
const DWG_USERNAMES = [
    'edvac', 'trigpoint', 'RicoElectrico', 'supaplextw', 'fizzie41',
    'clairedelune', 'antonkhorev', 'GeoMechain', 'jeslop', 'mavl',
    'mizmay', 'Richlv', 'Polarbear', 'kmpoppe', 'elliott_',
    'skquinn', 'woodpeck', 'Stereo', 'sev', 'Taya_S',
    'Glassman', 'SomeoneElse', 'fortera_au', 'marczoutendijk'
];

/**
 * Get a random DWG bot name
 * @returns {string} Random bot name like "woodpeck_bot"
 */
function getRandomBotName() {
    const username = DWG_USERNAMES[Math.floor(Math.random() * DWG_USERNAMES.length)];
    return `${username}_bot`;
}

// Game phases
export const PHASES = {
    SETUP: 'setup',
    WAITING: 'waiting', // Guest waiting for host to start the game
    PLAYING: 'playing',
    CHALLENGE: 'challenge',
    FINISHED: 'finished'
};

// Initial state factory
function createInitialState() {
    return {
        players: [
            { name: 'Player 1', isBot: false },
            { name: 'Player 2', isBot: false }
        ],
        currentPlayerIndex: 0,
        tags: [],
        region: null, // { name, adminLevel, displayName } or { relationId, displayName } or null for global
        gamePhase: PHASES.SETUP,
        challenger: null, // Player who initiated challenge
        challengeResult: null // { count: number, winner: string, loser: string }
    };
}

// The game state
let state = createInitialState();

// Subscribers for state changes
const subscribers = new Set();

/**
 * Subscribe to state changes
 * @param {Function} callback - Called whenever state changes
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

/**
 * Notify all subscribers of state change
 */
function notifySubscribers() {
    subscribers.forEach(callback => callback(state));
}

/**
 * Get current state (read-only copy)
 * @returns {Object} Current game state
 */
export function getState() {
    return { ...state };
}

/**
 * Get current player
 * @returns {Object} Current player object
 */
export function getCurrentPlayer() {
    return state.players[state.currentPlayerIndex];
}

/**
 * Add a new player
 * @param {string} name - Player name (optional, defaults to "Player N")
 */
export function addPlayer(name = null) {
    const playerNumber = state.players.length + 1;
    state.players.push({
        name: name || `Player ${playerNumber}`,
        isBot: false
    });
    notifySubscribers();
}

/**
 * Remove a player by index
 * @param {number} index - Player index to remove
 */
export function removePlayer(index) {
    if (state.players.length <= 2) {
        return; // Minimum 2 players
    }
    state.players.splice(index, 1);
    notifySubscribers();
}

/**
 * Update a player's name
 * @param {number} index - Player index
 * @param {string} name - New name
 */
export function updatePlayerName(index, name) {
    if (index >= 0 && index < state.players.length) {
        state.players[index].name = name || `Player ${index + 1}`;
        notifySubscribers();
    }
}

/**
 * Set the region filter using boundary relation
 * @param {Object|null} regionData - Region object with name/adminLevel or relationId, or null for global
 */
export function setRegion(regionData) {
    if (regionData && regionData.relationId) {
        // Custom relation ID
        state.region = {
            relationId: regionData.relationId,
            displayName: regionData.displayName || `Relation ${regionData.relationId}`
        };
    } else if (regionData && regionData.name && regionData.adminLevel) {
        // Named region with admin level
        state.region = {
            name: regionData.name,
            adminLevel: regionData.adminLevel,
            displayName: regionData.displayName || regionData.name
        };
    } else {
        state.region = null;
    }
    notifySubscribers();
}

/**
 * Strip surrounding quotes from a string
 * Handles: "value", 'value', and nested like ""value""
 * @param {string} str - String to strip quotes from
 * @returns {string} String with surrounding quotes removed
 */
function stripQuotes(str) {
    let result = str;
    // Keep stripping while surrounded by matching quotes
    while (
        (result.startsWith('"') && result.endsWith('"')) ||
        (result.startsWith("'") && result.endsWith("'"))
    ) {
        result = result.slice(1, -1);
    }
    return result;
}

/**
 * Add a new tag to the pool
 * @param {string} key - Tag key
 * @param {string|null} value - Tag value (null for "any")
 * @returns {boolean} Success
 */
export function addTag(key, value = null) {
    const trimmedKey = stripQuotes(key.trim()).toLowerCase();
    if (!trimmedKey) {
        return false;
    }

    // Check if key already exists
    const existingIndex = state.tags.findIndex(t => t.key === trimmedKey);
    if (existingIndex !== -1) {
        return false; // Key already exists
    }

    const trimmedValue = value ? stripQuotes(value.trim()) : null;
    state.tags.push({
        key: trimmedKey,
        value: trimmedValue
    });

    // Prefetch taginfo count in the background for query optimization
    prefetchTagCount(trimmedKey, trimmedValue);

    notifySubscribers();
    return true;
}

/**
 * Specify a value for an existing key-only tag
 * @param {string} key - Tag key
 * @param {string} value - Tag value
 * @returns {boolean} Success
 */
export function specifyTagValue(key, value) {
    const trimmedKey = stripQuotes(key.trim()).toLowerCase();
    const trimmedValue = stripQuotes(value.trim());

    if (!trimmedKey || !trimmedValue) {
        return false;
    }

    const tag = state.tags.find(t => t.key === trimmedKey);
    if (!tag || tag.value !== null) {
        return false; // Tag doesn't exist or already has a value
    }

    tag.value = trimmedValue;

    // Prefetch taginfo count for the new key=value combination
    prefetchTagCount(trimmedKey, trimmedValue);

    notifySubscribers();
    return true;
}

/**
 * Get tags that have no value specified (key-only)
 * @returns {Array} Tags with null values
 */
export function getKeyOnlyTags() {
    return state.tags.filter(t => t.value === null);
}

/**
 * Move to next player's turn
 */
export function nextTurn() {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    notifySubscribers();
}

/**
 * Enter waiting state (for multiplayer guests)
 */
export function enterWaitingState() {
    state.gamePhase = PHASES.WAITING;
    notifySubscribers();
}

/**
 * Start the game
 */
export function startGame() {
    state.gamePhase = PHASES.PLAYING;
    state.currentPlayerIndex = 0;
    state.tags = [];
    state.challenger = null;
    state.challengeResult = null;
    notifySubscribers();
}

/**
 * Initiate a challenge
 */
export function initiateChallenge() {
    state.gamePhase = PHASES.CHALLENGE;
    state.challenger = getCurrentPlayer();
    notifySubscribers();
}

/**
 * Set challenge result
 * @param {number} count - Number of OSM objects found
 */
export function setChallengeResult(count) {
    const challenger = state.challenger;
    const previousPlayerIndex = (state.currentPlayerIndex - 1 + state.players.length) % state.players.length;
    const previousPlayer = state.players[previousPlayerIndex];

    if (count === 0) {
        // Challenger wins - the previous player added an impossible tag
        state.challengeResult = {
            count,
            winner: challenger.name,
            loser: previousPlayer.name,
            challengerWon: true
        };
    } else {
        // Challenger loses - objects exist
        state.challengeResult = {
            count,
            winner: previousPlayer.name,
            loser: challenger.name,
            challengerWon: false
        };
    }

    state.gamePhase = PHASES.FINISHED;
    notifySubscribers();
}

/**
 * Reset for a new round (same players, same region)
 */
export function playAgain() {
    state.tags = [];
    state.currentPlayerIndex = 0;
    state.gamePhase = PHASES.PLAYING;
    state.challenger = null;
    state.challengeResult = null;
    notifySubscribers();
}

/**
 * Full reset to setup screen
 */
export function resetToSetup() {
    state = createInitialState();
    notifySubscribers();
}

/**
 * Go back to setup from game
 */
export function backToSetup() {
    state.gamePhase = PHASES.SETUP;
    state.tags = [];
    state.currentPlayerIndex = 0;
    state.challenger = null;
    state.challengeResult = null;
    notifySubscribers();
}

/**
 * Toggle a player between human and bot
 * @param {number} index - Player index
 * @param {boolean} isBot - Whether player is a bot
 */
export function setPlayerAsBot(index, isBot) {
    if (index >= 0 && index < state.players.length) {
        state.players[index] = {
            ...state.players[index],
            isBot
        };
        // Update name to indicate bot
        if (isBot) {
            state.players[index].name = getRandomBotName();
            // Bots don't support custom regions, so reset to global
            state.region = null;
        } else {
            state.players[index].name = `Player ${index + 1}`;
        }
        notifySubscribers();
    }
}

/**
 * Check if current player is a bot
 * @returns {boolean}
 */
export function isCurrentPlayerBot() {
    const current = getCurrentPlayer();
    return current && current.isBot === true;
}

/**
 * Check if any player is a bot
 * @returns {boolean}
 */
export function hasAnyBot() {
    return state.players.some(player => player.isBot === true);
}

/**
 * Check if a non-global region is selected
 * @returns {boolean}
 */
export function hasRegionSelected() {
    return state.region !== null;
}
