/**
 * Main Application Module
 * Orchestrates game flow and handles all event bindings
 */

import * as state from './gameState.js';
import * as ui from './ui.js';
import * as overpass from './overpass.js';
import * as bot from './bot.js';
import * as webrtc from './webrtc.js';
import * as hostController from './hostController.js';
import * as guestController from './guestController.js';

// DEPRECATED: multiplayer.js is being phased out
// import * as multiplayer from './multiplayer.js';

// Local storage keys
const STORAGE_KEYS = {
    REGION: 'tag-duelling-region',
    RELATION_ID: 'tag-duelling-relation-id',
    THEME: 'tag-duelling-theme',
    TOURNAMENT_MODE: 'tag-duelling-tournament-mode'
};

// Multiplayer UI element references
let mpElements = null;

// Debounce timer for guest name input
let guestNameDebounceTimer = null;

// Track current multiplayer role
let isHostRole = false;
let isGuestRole = false;

/**
 * Check if currently in multiplayer mode (either as host or guest)
 * @returns {boolean}
 */
function isMultiplayerMode() {
    return webrtc.isConnected() && (hostController.isInitialized() || guestController.isInitialized());
}

/**
 * Check if it's the local player's turn
 * @returns {boolean}
 */
function isLocalPlayerTurn() {
    if (!isMultiplayerMode()) return true;

    const currentState = state.getState();
    if (isHostRole) {
        return currentState.currentPlayerIndex === 0;
    } else if (isGuestRole) {
        return currentState.currentPlayerIndex === 1;
    }
    return true;
}

/**
 * Get local player index (0 for host, 1 for guest)
 * @returns {number}
 */
function getLocalPlayerIndex() {
    if (isHostRole) return 0;
    if (isGuestRole) return 1;
    return 0;
}

/**
 * Initialize the application
 */
function init() {
    // Initialize UI elements
    const elements = ui.initElements();

    // Initialize multiplayer elements
    initMultiplayerElements();

    // Load saved preferences
    loadPreferences(elements);

    // Set up event listeners
    bindEvents(elements);
    bindMultiplayerEvents();

    // Subscribe to state changes
    state.subscribe(handleStateChange);

    // Set up WebRTC callbacks
    webrtc.onConnected(handleMultiplayerConnected);
    webrtc.onDisconnected(() => handleMultiplayerDisconnected('connection_lost'));

    // Set up WebRTC message routing to appropriate controller
    webrtc.onMessage(handleWebRTCMessage);

    // Initial render
    renderFromState();
}

/**
 * Route WebRTC messages to the appropriate controller
 */
function handleWebRTCMessage(message) {
    if (!webrtc.isConnected()) return;

    if (isHostRole && hostController.isInitialized()) {
        hostController.handleGuestMessage(message);
    } else if (isGuestRole && guestController.isInitialized()) {
        guestController.handleHostMessage(message);
    }
}

/**
 * Initialize multiplayer UI element references
 */
function initMultiplayerElements() {
    mpElements = {
        // Sections
        defaultSection: document.getElementById('multiplayer-default'),
        hostSection: document.getElementById('multiplayer-host'),
        joinSection: document.getElementById('multiplayer-join'),
        connectedSection: document.getElementById('multiplayer-connected'),

        // Host flow
        hostRoomCode: document.getElementById('host-room-code'),
        hostStatusText: document.getElementById('host-status-text'),
        hostCancelBtn: document.getElementById('host-cancel-btn'),

        // Join flow
        joinCodeInput: document.getElementById('join-code-input'),
        joinBtn: document.getElementById('join-btn'),
        joinCancelBtn: document.getElementById('join-cancel-btn'),
        joinStatus: document.getElementById('join-status'),

        // Buttons
        hostGameBtn: document.getElementById('host-game-btn'),
        joinGameBtn: document.getElementById('join-game-btn'),
        disconnectBtn: document.getElementById('disconnect-btn'),
        leaveGameBtn: document.getElementById('leave-game-btn'),

        // Guest waiting screen
        guestNameInput: document.getElementById('guest-name-input')
    };
}

/**
 * Load saved preferences from localStorage
 */
function loadPreferences(elements) {
    // Load theme
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    if (savedTheme) {
        document.body.dataset.theme = savedTheme;
    }

    // Load region (stored as selected index)
    const savedRegionIndex = localStorage.getItem(STORAGE_KEYS.REGION);
    if (savedRegionIndex && elements.regionSelect) {
        const index = parseInt(savedRegionIndex, 10);
        if (index >= 0 && index < elements.regionSelect.options.length) {
            elements.regionSelect.selectedIndex = index;
        }
    }

    // Load custom relation ID
    const savedRelationId = localStorage.getItem(STORAGE_KEYS.RELATION_ID);
    if (savedRelationId) {
        ui.setRelationIdInput(savedRelationId);
    }

    // Update custom region input visibility based on selection
    ui.updateCustomRegionVisibility();

    // Sync loaded region to state
    const regionData = ui.getSelectedRegion();
    state.setRegion(regionData);

    // Load tournament mode preference
    const savedTournamentMode = localStorage.getItem(STORAGE_KEYS.TOURNAMENT_MODE);
    if (savedTournamentMode === 'true') {
        const checkbox = document.getElementById('tournament-mode-checkbox');
        if (checkbox) {
            checkbox.checked = true;
            state.setTournamentMode(true);
        }
    }
}

/**
 * Bind all event listeners
 */
function bindEvents(elements) {
    // Theme toggle
    elements.themeToggle.addEventListener('click', handleThemeToggle);

    // Setup screen
    elements.addPlayerBtn.addEventListener('click', () => state.addPlayer());
    elements.startGameBtn.addEventListener('click', handleStartGame);
    elements.regionSelect.addEventListener('change', handleRegionChange);
    elements.relationIdInput.addEventListener('input', handleRelationIdInput);

    // Tournament mode checkbox
    const tournamentCheckbox = document.getElementById('tournament-mode-checkbox');
    if (tournamentCheckbox) {
        tournamentCheckbox.addEventListener('change', handleTournamentModeChange);
    }

    // Tooltip triggers - prevent click from bubbling to parent label
    document.querySelectorAll('.tooltip-trigger').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    // Game screen
    elements.submitBtn.addEventListener('click', handleSubmit);
    elements.challengeBtn.addEventListener('click', handleChallenge);
    elements.backToSetupBtn.addEventListener('click', handleBackToSetup);

    // Enter key in tag inputs submits the turn
    elements.tagPool.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && (e.target.classList.contains('tag-new-input') || e.target.classList.contains('tag-value-input'))) {
            handleSubmit();
        }
    });

    // Results screen
    elements.playAgainBtn.addEventListener('click', handlePlayAgain);
    elements.newGameBtn.addEventListener('click', handleNewGame);
}

/**
 * Bind multiplayer event listeners
 */
function bindMultiplayerEvents() {
    // Host flow
    mpElements.hostGameBtn.addEventListener('click', handleHostGame);
    mpElements.hostCancelBtn.addEventListener('click', resetMultiplayerUI);

    // Join flow
    mpElements.joinGameBtn.addEventListener('click', handleJoinGame);
    mpElements.joinBtn.addEventListener('click', handleJoinRoom);
    mpElements.joinCancelBtn.addEventListener('click', resetMultiplayerUI);

    // Allow Enter key in room code input
    mpElements.joinCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleJoinRoom();
        }
    });

    // Auto-uppercase room code input and strip invalid characters
    mpElements.joinCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    // Handle paste to trim whitespace before maxlength truncation
    mpElements.joinCodeInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        const cleanedText = pastedText.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        e.target.value = cleanedText.slice(0, 6);
    });

    // Connected state
    mpElements.disconnectBtn.addEventListener('click', handleDisconnect);

    // Waiting screen
    mpElements.leaveGameBtn.addEventListener('click', handleLeaveGame);
    mpElements.guestNameInput.addEventListener('input', handleGuestNameChange);

    // Connection lost overlay
    const connectionLostOkBtn = document.getElementById('connection-lost-ok-btn');
    if (connectionLostOkBtn) {
        connectionLostOkBtn.addEventListener('click', () => {
            ui.hideConnectionLost();
            state.resetToSetup();
        });
    }
}

/**
 * Handle Play Again button
 */
async function handlePlayAgain() {
    if (isMultiplayerMode()) {
        if (isHostRole) {
            // Host requests rematch
            hostController.handleLocalRematchRequest();
        } else if (isGuestRole) {
            // Guest requests rematch
            guestController.requestRematch();
        }
    } else {
        // Local game - just restart (async for tournament mode tag generation)
        await state.playAgain();
    }
}

/**
 * Handle New Game button
 */
function handleNewGame() {
    if (isMultiplayerMode()) {
        if (isHostRole) {
            // Host ends session
            hostController.endSession();
        } else if (isGuestRole) {
            // Guest leaves - just disconnect and reset locally
            guestController.shutdown();
            webrtc.disconnect();
        }
    }
    resetMultiplayerState();
    state.resetSessionWins();
    state.resetToSetup();
}

/**
 * Handle Back to Setup button (from game screen)
 */
function handleBackToSetup() {
    if (isMultiplayerMode()) {
        if (isHostRole) {
            hostController.endSession();
        } else if (isGuestRole) {
            guestController.shutdown();
            webrtc.disconnect();
        }
    }
    resetMultiplayerState();
    state.resetSessionWins();
    state.resetToSetup();
}

/**
 * Reset multiplayer state variables
 */
function resetMultiplayerState() {
    isHostRole = false;
    isGuestRole = false;
    if (hostController.isInitialized()) {
        hostController.shutdown();
    }
    if (guestController.isInitialized()) {
        guestController.shutdown();
    }
}

/**
 * Handle Host Game button - create room and show code
 */
async function handleHostGame() {
    showMultiplayerSection('host');
    mpElements.hostRoomCode.textContent = '......';
    mpElements.hostStatusText.textContent = 'Retrieving room code...';

    try {
        const roomCode = await webrtc.createRoom();
        mpElements.hostRoomCode.textContent = roomCode;
        mpElements.hostStatusText.textContent = 'Waiting for opponent to join...';

        // Start polling for guest to join
        webrtc.waitForGuest(() => {
            // Timeout callback
            ui.showError('Room expired. Please create a new room.');
            resetMultiplayerUI();
        }).catch(err => {
            if (err.message !== 'Room expired') {
                console.error('Waiting for guest failed:', err);
            }
        });
        // Connection will be established via onConnected callback when guest joins

    } catch (error) {
        console.error('Failed to create room:', error);
        ui.showError('Failed to create room. Please try again.');
        resetMultiplayerUI();
    }
}

/**
 * Handle Join Game button - show join UI
 */
function handleJoinGame() {
    showMultiplayerSection('join');
    mpElements.joinCodeInput.value = '';
    mpElements.joinStatus.textContent = '';
    mpElements.joinCodeInput.focus();
}

/**
 * Handle Join Room button - join with room code
 */
async function handleJoinRoom() {
    const code = mpElements.joinCodeInput.value.trim();
    if (!code) {
        ui.showError('Please enter a room code.');
        return;
    }

    if (code.length !== 6) {
        ui.showError('Room code must be 6 characters.');
        return;
    }

    mpElements.joinStatus.textContent = 'Joining...';
    mpElements.joinBtn.disabled = true;

    try {
        await webrtc.joinRoom(code);
        mpElements.joinStatus.textContent = 'Waiting for connection...';
        // Connection will be established via onConnected callback
    } catch (error) {
        console.error('Failed to join room:', error);
        mpElements.joinStatus.textContent = '';
        mpElements.joinBtn.disabled = false;
        ui.showError(error.message || 'Failed to join room. Please check the code and try again.');
    }
}

/**
 * Handle Disconnect button
 */
function handleDisconnect() {
    if (isHostRole) {
        hostController.endSession();
    } else if (isGuestRole) {
        guestController.shutdown();
    }
    webrtc.disconnect();
    resetMultiplayerState();
    resetMultiplayerUI();
    // Reset UI for local mode
    const elements = ui.getElements();
    elements.startGameBtn.textContent = 'Start Local Game';
    elements.addPlayerBtn.classList.remove('hidden');
    // Reset to default players
    state.resetToSetup();
}

/**
 * Handle Leave Game button (from waiting screen)
 */
function handleLeaveGame() {
    if (isGuestRole) {
        guestController.shutdown();
    }
    webrtc.disconnect();
    resetMultiplayerState();
    resetMultiplayerUI();
    state.resetToSetup();
}

/**
 * Handle guest name input change (with debounce)
 */
function handleGuestNameChange(e) {
    clearTimeout(guestNameDebounceTimer);
    guestNameDebounceTimer = setTimeout(() => {
        const name = e.target.value.trim() || 'Player 2';
        // Update local state
        state.updatePlayerName(getLocalPlayerIndex(), name);
        // Send to host via guest controller
        if (isGuestRole && guestController.isInitialized()) {
            guestController.setName(name);
        }
    }, 300);
}

/**
 * Handle multiplayer connection established
 */
function handleMultiplayerConnected() {
    showMultiplayerSection('connected');

    // Immediately hide add player button in multiplayer mode
    // This must happen before any state updates that trigger re-renders
    const elements = ui.getElements();
    elements.addPlayerBtn.classList.add('hidden');

    if (webrtc.getIsHost()) {
        // Host: initialize host controller
        isHostRole = true;
        isGuestRole = false;

        // Set up players for multiplayer
        // Use "Player 2" as default - will be updated when guest sends their name
        state.updatePlayerName(0, 'Host');
        state.updatePlayerName(1, 'Player 2');
        // Ensure both players are human (no bots in multiplayer)
        state.setPlayerAsBot(0, false);
        state.setPlayerAsBot(1, false);

        // Initialize host controller
        hostController.initialize();

        // Set up host controller callbacks
        hostController.setOnGuestNameChanged((name) => {
            renderFromState();
        });

        hostController.setOnRematchStatusChanged((status) => {
            renderFromState();
        });

        hostController.setOnGuestDisconnected(() => {
            handleMultiplayerDisconnected('connection_lost');
        });

        hostController.setOnChallengeRequested(async () => {
            // Guest initiated challenge - host runs the query
            const currentState = state.getState();
            await executeChallengeQuery(currentState.tags, currentState.region);
        });

        // Update start button text
        updateStartButtonForMultiplayer();

        // Re-render to hide add player button and update UI for multiplayer
        renderFromState();
    } else {
        // Guest: initialize guest controller
        isHostRole = false;
        isGuestRole = true;

        // Set up initial player names
        // Guest shows "Player 2" until host's state sync arrives with authoritative names
        state.updatePlayerName(0, 'Host');
        state.updatePlayerName(1, 'Player 2');
        state.setPlayerAsBot(0, false);
        state.setPlayerAsBot(1, false);

        // Initialize guest controller
        guestController.initialize();

        // Set up guest controller callbacks
        guestController.setOnWelcomeReceived((playerIndex) => {
            // Send initial name to host (default to "Player 2" if empty)
            const name = mpElements.guestNameInput.value.trim() || 'Player 2';
            guestController.setName(name);
        });

        guestController.setOnStateReceived((receivedState) => {
            // State has been applied by the controller
            // Just re-render UI
            renderFromState();
        });

        guestController.setOnActionRejected((reason, message) => {
            ui.hidePendingAction();
            ui.showError(message);
        });

        guestController.setOnHostDisconnected((reason) => {
            handleMultiplayerDisconnected(reason);
        });

        // Set default name in input (matches default player name)
        mpElements.guestNameInput.value = 'Player 2';

        // Enter waiting state
        state.enterWaitingState();
    }
}

/**
 * Update start button text for multiplayer mode
 */
function updateStartButtonForMultiplayer() {
    const elements = ui.getElements();
    if (isMultiplayerMode() && isHostRole) {
        elements.startGameBtn.textContent = 'Start Remote Game';
    } else {
        elements.startGameBtn.textContent = 'Start Local Game';
    }
}

/**
 * Handle multiplayer disconnection
 * @param {string} reason - Optional reason for disconnect (from protocol.GameEndReason)
 */
function handleMultiplayerDisconnected(reason) {
    // Shutdown controllers
    resetMultiplayerState();

    resetMultiplayerUI();
    // Reset UI for local mode
    const elements = ui.getElements();
    elements.startGameBtn.textContent = 'Start Local Game';
    elements.addPlayerBtn.classList.remove('hidden');
    // Reset players to default
    state.resetToSetup();

    // Only show connection lost modal for unexpected disconnects
    // Don't show it when the other player intentionally ended/left the session
    if (reason === 'connection_lost') {
        ui.showConnectionLost();
    }
}

/**
 * Show specific multiplayer section
 */
function showMultiplayerSection(section) {
    mpElements.defaultSection.classList.toggle('hidden', section !== 'default');
    mpElements.hostSection.classList.toggle('hidden', section !== 'host');
    mpElements.joinSection.classList.toggle('hidden', section !== 'join');
    mpElements.connectedSection.classList.toggle('hidden', section !== 'connected');
}

/**
 * Reset multiplayer UI to default state
 */
function resetMultiplayerUI() {
    showMultiplayerSection('default');
    mpElements.joinCodeInput.value = '';
    mpElements.joinStatus.textContent = '';
    mpElements.joinBtn.disabled = false;
    mpElements.hostRoomCode.textContent = '';
    mpElements.hostStatusText.textContent = 'Retrieving room code...';
    webrtc.disconnect();
}

// Track if bot turn is in progress to prevent double execution
let botTurnInProgress = false;

/**
 * Handle state changes
 */
function handleStateChange(newState) {
    renderFromState();

    // Check if current player is a bot and game is in playing phase
    if (newState.gamePhase === state.PHASES.PLAYING && state.isCurrentPlayerBot() && !botTurnInProgress) {
        executeBotTurn();
    }
}

/**
 * Render UI based on current state
 */
function renderFromState() {
    const currentState = state.getState();

    // Show correct screen based on game phase
    switch (currentState.gamePhase) {
        case state.PHASES.SETUP:
            ui.showScreen('setup');
            renderSetupScreen(currentState);
            break;

        case state.PHASES.WAITING:
            // Guest waiting for host to start
            ui.showScreen('waiting');
            // Update region and tournament mode display for guest
            ui.updateGuestRegionDisplay(currentState.region);
            ui.updateGuestTournamentModeDisplay(currentState.tournamentMode);
            break;

        case state.PHASES.PLAYING:
            ui.showScreen('game');
            renderGameScreen(currentState);
            break;

        case state.PHASES.CHALLENGE:
            // Keep showing game screen during challenge
            ui.showScreen('game');
            // Show loading overlay for remote player waiting for query result
            if (isMultiplayerMode() && isGuestRole) {
                ui.showLoading();
            }
            break;

        case state.PHASES.FINISHED:
            // Hide loading overlay (in case guest was waiting for query result)
            ui.hideLoading();
            ui.showScreen('results');
            renderResultsScreen(currentState);
            break;
    }
}

/**
 * Render setup screen
 */
function renderSetupScreen(currentState) {
    const hasBots = state.hasAnyBot();
    const hasRegion = state.hasRegionSelected();
    const inMultiplayer = isMultiplayerMode();

    // Update conflict warnings and disabled states
    ui.updateBotRegionConflictState(hasBots, hasRegion, inMultiplayer);

    // If bots are present and region was reset, clear localStorage
    if (hasBots && !hasRegion) {
        localStorage.setItem(STORAGE_KEYS.REGION, '0');
        localStorage.removeItem(STORAGE_KEYS.RELATION_ID);
    }

    // Hide add player button in multiplayer mode
    const elements = ui.getElements();
    elements.addPlayerBtn.classList.toggle('hidden', inMultiplayer);

    // Build multiplayer options if in multiplayer mode
    const multiplayerOptions = inMultiplayer ? {
        isMultiplayer: true,
        localPlayerIndex: getLocalPlayerIndex()
    } : null;

    ui.renderPlayerList(
        currentState.players,
        (index, name) => {
            state.updatePlayerName(index, name);
            // Send name to host if guest in multiplayer
            if (inMultiplayer && isGuestRole && index === getLocalPlayerIndex()) {
                guestController.setName(name);
            }
        },
        (index) => state.removePlayer(index),
        (index, isBot) => {
            state.setPlayerAsBot(index, isBot);
        },
        hasRegion || inMultiplayer, // Disable bot toggles if region is selected or in multiplayer
        multiplayerOptions
    );
}

/**
 * Render game screen
 */
function renderGameScreen(currentState) {
    ui.renderCurrentPlayer(
        state.getCurrentPlayer(),
        currentState.players,
        currentState.currentPlayerIndex,
        currentState.tags
    );
    ui.renderTagPool(currentState.tags);

    // Update abandon button text based on game mode
    const elements = ui.getElements();
    elements.backToSetupBtn.textContent = isMultiplayerMode() ? 'Abandon Game' : 'Back to Setup';

    // In multiplayer, disable controls when it's not the local player's turn and show session score
    if (isMultiplayerMode()) {
        const isLocalTurn = isLocalPlayerTurn();
        ui.setGameControlsEnabled(isLocalTurn);

        // Display session score
        const sessionWins = isHostRole
            ? hostController.getSessionWins()
            : guestController.getSessionWins();
        ui.updateSessionScore(sessionWins, currentState.players, true);
    } else {
        // Local game - show session score with local wins
        const localWins = state.getSessionWins();
        const sessionWins = { host: localWins[0], guest: localWins[1] };
        ui.updateSessionScore(sessionWins, currentState.players, true);
    }
}

/**
 * Render results screen
 */
function renderResultsScreen(currentState) {
    const ultraLink = overpass.buildUltraLink(currentState.tags, currentState.region);
    ui.renderResults(currentState.challengeResult, currentState.tags, ultraLink);

    // Update rematch UI and session score
    if (isMultiplayerMode()) {
        const rematchStatus = isHostRole
            ? hostController.getRematchStatus()
            : guestController.getRematchStatus();
        ui.updateRematchUI(isHostRole, rematchStatus, currentState.players);

        // Display session score
        const sessionWins = isHostRole
            ? hostController.getSessionWins()
            : guestController.getSessionWins();
        ui.updateSessionScore(sessionWins, currentState.players, true);
    } else {
        ui.resetRematchUI();
        // Local game - show session score with local wins
        const localWins = state.getSessionWins();
        const sessionWins = { host: localWins[0], guest: localWins[1] };
        ui.updateSessionScore(sessionWins, currentState.players, true);
    }
}

/**
 * Handle theme toggle
 */
function handleThemeToggle() {
    const currentTheme = document.body.dataset.theme;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let newTheme;
    if (!currentTheme) {
        // Currently using system preference, switch to opposite
        newTheme = prefersDark ? 'light' : 'dark';
    } else if (currentTheme === 'dark') {
        newTheme = 'light';
    } else {
        newTheme = 'dark';
    }

    document.body.dataset.theme = newTheme;
    localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
}

/**
 * Handle region change
 */
function handleRegionChange(e) {
    // Update custom input visibility
    ui.updateCustomRegionVisibility();

    const regionData = ui.getSelectedRegion();
    state.setRegion(regionData);

    // Store the selected index for persistence
    localStorage.setItem(STORAGE_KEYS.REGION, e.target.selectedIndex.toString());

    // If custom, also save the relation ID
    if (regionData && regionData.relationId) {
        localStorage.setItem(STORAGE_KEYS.RELATION_ID, regionData.relationId);
    }

    // Broadcast region change to guest in multiplayer
    if (isMultiplayerMode() && isHostRole) {
        hostController.broadcastState();
    }
}

/**
 * Handle relation ID input change
 */
function handleRelationIdInput(e) {
    const relationId = e.target.value.trim();

    // Update state
    if (relationId) {
        state.setRegion({
            relationId: relationId,
            name: `Relation ${relationId}`
        });
        localStorage.setItem(STORAGE_KEYS.RELATION_ID, relationId);
    } else {
        state.setRegion(null);
    }

    // Broadcast region change to guest in multiplayer
    if (isMultiplayerMode() && isHostRole) {
        hostController.broadcastState();
    }
}

/**
 * Handle tournament mode checkbox change
 */
function handleTournamentModeChange(e) {
    const enabled = e.target.checked;
    state.setTournamentMode(enabled);
    localStorage.setItem(STORAGE_KEYS.TOURNAMENT_MODE, enabled.toString());

    // Broadcast tournament mode change to guest in multiplayer
    if (isMultiplayerMode() && isHostRole) {
        hostController.broadcastState();
    }
}

/**
 * Handle start game button
 */
async function handleStartGame() {
    // Check for bots in multiplayer mode
    if (isMultiplayerMode() && state.hasAnyBot()) {
        ui.showError("Bots are not supported in multiplayer mode");
        return;
    }

    const regionData = ui.getSelectedRegion();
    state.setRegion(regionData);

    // Sync tournament mode checkbox to state (in case state was reset but checkbox stayed checked)
    const tournamentCheckbox = document.getElementById('tournament-mode-checkbox');
    if (tournamentCheckbox) {
        state.setTournamentMode(tournamentCheckbox.checked);
    }

    // Clear bot's combination cache for fresh game
    bot.clearCombinationCache();

    // Start the game (async for tournament mode tag generation)
    await state.startGame();

    // In multiplayer, host broadcasts the new state to guest
    if (isMultiplayerMode() && isHostRole) {
        hostController.broadcastState();
    }
}

/**
 * Handle submit button - validates and processes the player's turn
 */
function handleSubmit() {
    // In multiplayer, only allow submit on local player's turn
    if (isMultiplayerMode() && !isLocalPlayerTurn()) {
        ui.showError("It's not your turn!");
        return;
    }

    const validation = ui.validateSingleEdit();

    if (!validation.valid) {
        ui.showError(validation.error);
        return;
    }

    if (isMultiplayerMode()) {
        if (isHostRole) {
            // Host: apply locally and broadcast
            if (validation.type === 'new') {
                const { key, value } = validation.data;
                const success = state.addTag(key, value);
                if (!success) {
                    ui.showError('That key already exists. Specify a value for it instead.');
                    return;
                }
            } else if (validation.type === 'value') {
                const { tagIndex, value } = validation.data;
                const currentState = state.getState();
                const tag = currentState.tags[tagIndex];
                if (!tag) {
                    ui.showError('Invalid tag reference');
                    return;
                }
                const success = state.specifyTagValue(tag.key, value);
                if (!success) {
                    ui.showError('Failed to set value');
                    return;
                }
            }
            state.nextTurn();
            hostController.broadcastState();
        } else if (isGuestRole) {
            // Guest: send action to host, show pending state
            ui.showPendingAction();

            if (validation.type === 'new') {
                const { key, value } = validation.data;
                guestController.submitTurn('add_tag', key, value);
            } else if (validation.type === 'value') {
                const { tagIndex, value } = validation.data;
                const currentState = state.getState();
                const tag = currentState.tags[tagIndex];
                if (!tag) {
                    ui.showError('Invalid tag reference');
                    return;
                }
                guestController.submitTurn('specify_value', tag.key, value);
            }
            // State will be updated when host broadcasts new state
        }
    } else {
        // Local game - apply directly
        if (validation.type === 'new') {
            const { key, value } = validation.data;
            const success = state.addTag(key, value);
            if (!success) {
                ui.showError('That key already exists. Specify a value for it instead.');
                return;
            }
        } else if (validation.type === 'value') {
            const { tagIndex, value } = validation.data;
            const currentState = state.getState();
            const tag = currentState.tags[tagIndex];
            if (!tag) {
                ui.showError('Invalid tag reference');
                return;
            }
            const success = state.specifyTagValue(tag.key, value);
            if (!success) {
                ui.showError('Failed to set value');
                return;
            }
        }
        state.nextTurn();
    }
}

/**
 * Handle challenge button
 */
async function handleChallenge() {
    // In multiplayer, only allow challenge on local player's turn
    if (isMultiplayerMode() && !isLocalPlayerTurn()) {
        ui.showError("It's not your turn!");
        return;
    }

    const currentState = state.getState();

    if (isMultiplayerMode()) {
        if (isHostRole) {
            // Host challenges - initiate and run query
            state.initiateChallenge();
            hostController.broadcastState();
            await executeChallengeQuery(currentState.tags, currentState.region);
        } else if (isGuestRole) {
            // Guest challenges - send to host, host will run query
            ui.showPendingAction();
            guestController.challenge();
            // Host will execute query and broadcast result
        }
    } else {
        // Local game
        state.initiateChallenge();
        await executeChallengeQuery(currentState.tags, currentState.region);
    }
}

/**
 * Execute the challenge query with retry support
 * @param {Array} tags - Tags to query
 * @param {Object|null} region - Region filter
 */
async function executeChallengeQuery(tags, region) {
    ui.showLoading();

    try {
        // Check if still connected (for multiplayer)
        if (isMultiplayerMode() && !webrtc.isConnected()) {
            console.warn('Connection lost during query setup');
            return;
        }

        const count = await overpass.executeCountQuery(tags, region);

        // Check if still connected after query (for multiplayer)
        if (isMultiplayerMode() && !webrtc.isConnected()) {
            console.warn('Connection lost during query execution');
            return;
        }

        // Record win for session tracking BEFORE setting result
        // (setChallengeResult triggers UI render, so wins must be recorded first)
        const currentState = state.getState();
        const challengerIndex = currentState.currentPlayerIndex;
        const previousPlayerIndex = (challengerIndex - 1 + currentState.players.length) % currentState.players.length;
        // count === 0 means challenger wins, otherwise previous player wins
        const winnerIndex = count === 0 ? challengerIndex : previousPlayerIndex;

        if (isMultiplayerMode() && isHostRole) {
            hostController.recordWin(winnerIndex);
        } else if (!isMultiplayerMode()) {
            // Local game - record win in gameState
            state.recordWin(winnerIndex);
        }

        // Set result (this triggers UI render via state subscribers)
        state.setChallengeResult(count);

        // Broadcast updated state to guest
        if (isMultiplayerMode() && isHostRole) {
            hostController.broadcastState();
        }
    } catch (error) {
        console.error('Overpass query failed:', error);

        // Check if this is a retryable error
        const isRetryable = error.name === 'OverpassError' && error.retryable;

        if (isRetryable) {
            // Ask user if they want to retry
            const shouldRetry = await ui.showRetryDialog(error.message);

            if (shouldRetry) {
                // Retry the query
                await executeChallengeQuery(tags, region);
                return;
            }
        } else {
            // Non-retryable error, just show message
            ui.showError(`Query failed: ${error.message}`);
        }

        // User declined retry or error is not retryable - go back to playing state
        await state.playAgain();

        // Broadcast recovery state if host
        if (isMultiplayerMode() && isHostRole) {
            hostController.broadcastState();
        }
    } finally {
        ui.hideLoading();
    }
}

/**
 * Execute bot's turn with artificial delay
 */
async function executeBotTurn() {
    botTurnInProgress = true;
    const currentState = state.getState();
    const currentPlayer = state.getCurrentPlayer();

    // Show bot thinking UI
    ui.showBotThinking();

    // Add artificial delay for UX
    const delay = bot.getThinkingDelay();
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
        // Get bot's decision
        const decision = await bot.decideBotAction(currentState, currentPlayer);

        if (decision.action === 'challenge') {
            // Bot challenges
            botTurnInProgress = false;
            ui.hideBotThinking();
            await handleChallenge();
        } else if (decision.action === 'addTag') {
            // Bot adds a tag
            const { key, value } = decision.data;

            if (value !== null) {
                // Check if this is specifying value for existing key
                const existingTag = currentState.tags.find(t => t.key === key && t.value === null);
                if (existingTag) {
                    state.specifyTagValue(key, value);
                } else {
                    state.addTag(key, value);
                }
            } else {
                state.addTag(key, null);
            }

            // Move to next turn
            botTurnInProgress = false;
            ui.hideBotThinking();
            state.nextTurn();
        }
    } catch (error) {
        console.error('Bot turn failed:', error);
        // Fallback: add a safe tag
        const fallbackKey = 'building';
        if (!currentState.tags.find(t => t.key === fallbackKey)) {
            state.addTag(fallbackKey, null);
        } else {
            state.addTag('natural', null);
        }
        botTurnInProgress = false;
        ui.hideBotThinking();
        state.nextTurn();
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
