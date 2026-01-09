/**
 * Main Application Module
 * Orchestrates game flow and handles all event bindings
 */

import * as state from './gameState.js';
import * as ui from './ui.js';
import * as overpass from './overpass.js';
import * as bot from './bot.js';
import * as webrtc from './webrtc.js';
import * as multiplayer from './multiplayer.js';

// Local storage keys
const STORAGE_KEYS = {
    REGION: 'tag-duelling-region',
    RELATION_ID: 'tag-duelling-relation-id',
    THEME: 'tag-duelling-theme'
};

// Multiplayer UI element references
let mpElements = null;

/**
 * Initialize the application
 */
function init() {
    // Initialize UI elements
    const elements = ui.initElements();

    // Initialize multiplayer elements
    initMultiplayerElements();

    // Initialize multiplayer module
    multiplayer.init();

    // Load saved preferences
    loadPreferences(elements);

    // Set up event listeners
    bindEvents(elements);
    bindMultiplayerEvents();

    // Subscribe to state changes
    state.subscribe(handleStateChange);

    // Set up multiplayer callbacks
    multiplayer.onRemoteAction(handleRemoteAction);
    webrtc.onConnected(handleMultiplayerConnected);
    webrtc.onDisconnected(handleMultiplayerDisconnected);

    // Initial render
    renderFromState();
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
        hostStep1: document.getElementById('host-step-1'),
        hostStep2: document.getElementById('host-step-2'),
        hostStep3: document.getElementById('host-step-3'),
        hostOfferToken: document.getElementById('host-offer-token'),
        hostAnswerInput: document.getElementById('host-answer-input'),
        copyOfferBtn: document.getElementById('copy-offer-btn'),
        hostConnectBtn: document.getElementById('host-connect-btn'),
        hostCancelBtn: document.getElementById('host-cancel-btn'),

        // Join flow
        joinStep1: document.getElementById('join-step-1'),
        joinStep2: document.getElementById('join-step-2'),
        joinStep3: document.getElementById('join-step-3'),
        joinOfferInput: document.getElementById('join-offer-input'),
        joinAnswerToken: document.getElementById('join-answer-token'),
        joinAcceptBtn: document.getElementById('join-accept-btn'),
        copyAnswerBtn: document.getElementById('copy-answer-btn'),
        joinCancelBtn: document.getElementById('join-cancel-btn'),

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
    mpElements.copyOfferBtn.addEventListener('click', () => copyToClipboard(mpElements.hostOfferToken.value, mpElements.copyOfferBtn));
    mpElements.hostConnectBtn.addEventListener('click', handleHostConnect);
    mpElements.hostCancelBtn.addEventListener('click', resetMultiplayerUI);

    // Join flow
    mpElements.joinGameBtn.addEventListener('click', handleJoinGame);
    mpElements.joinAcceptBtn.addEventListener('click', handleJoinAccept);
    mpElements.copyAnswerBtn.addEventListener('click', () => copyToClipboard(mpElements.joinAnswerToken.value, mpElements.copyAnswerBtn));
    mpElements.joinCancelBtn.addEventListener('click', resetMultiplayerUI);

    // Connected state
    mpElements.disconnectBtn.addEventListener('click', handleDisconnect);

    // Waiting screen
    mpElements.leaveGameBtn.addEventListener('click', handleLeaveGame);
    mpElements.guestNameInput.addEventListener('input', handleGuestNameChange);
}

/**
 * Handle Play Again button
 */
function handlePlayAgain() {
    if (multiplayer.isMultiplayerMode()) {
        multiplayer.sendPlayAgain();
    }
    state.playAgain();
}

/**
 * Handle New Game button
 */
function handleNewGame() {
    if (multiplayer.isMultiplayerMode()) {
        multiplayer.sendBackToSetup();
    }
    state.resetToSetup();
}

/**
 * Handle Back to Setup button (from game screen)
 */
function handleBackToSetup() {
    if (multiplayer.isMultiplayerMode()) {
        multiplayer.sendBackToSetup();
        multiplayer.reset();
    }
    state.resetToSetup();
}

/**
 * Handle Host Game button - start hosting
 */
async function handleHostGame() {
    showMultiplayerSection('host');
    showHostStep(1);

    try {
        const offerToken = await webrtc.createOffer();
        mpElements.hostOfferToken.value = offerToken;
        showHostStep(2);
        showHostStep(3);
    } catch (error) {
        console.error('Failed to create offer:', error);
        ui.showError('Failed to create connection. Please try again.');
        resetMultiplayerUI();
    }
}

/**
 * Handle Host Connect button - accept answer token
 */
async function handleHostConnect() {
    const answerToken = mpElements.hostAnswerInput.value.trim();
    if (!answerToken) {
        ui.showError('Please paste the response token from your opponent.');
        return;
    }

    try {
        await webrtc.acceptAnswer(answerToken);
        // Connection will be established, onConnected callback will handle UI
    } catch (error) {
        console.error('Failed to accept answer:', error);
        ui.showError('Invalid response token. Please check and try again.');
    }
}

/**
 * Handle Join Game button - show join UI
 */
function handleJoinGame() {
    showMultiplayerSection('join');
    showJoinStep(1);
}

/**
 * Handle Join Accept button - accept offer and generate answer
 */
async function handleJoinAccept() {
    const offerToken = mpElements.joinOfferInput.value.trim();
    if (!offerToken) {
        ui.showError('Please paste the invite token from the host.');
        return;
    }

    showJoinStep(2);

    try {
        const answerToken = await webrtc.acceptOffer(offerToken);
        mpElements.joinAnswerToken.value = answerToken;
        showJoinStep(3);
        // Connection will be established when host accepts our answer
    } catch (error) {
        console.error('Failed to accept offer:', error);
        ui.showError('Invalid invite token. Please check and try again.');
        showJoinStep(1);
    }
}

/**
 * Handle Disconnect button
 */
function handleDisconnect() {
    webrtc.disconnect();
    multiplayer.reset();
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
    webrtc.disconnect();
    multiplayer.reset();
    state.resetToSetup();
}

/**
 * Handle guest name input change
 */
function handleGuestNameChange(e) {
    const name = e.target.value.trim() || 'Guest';
    // Update local state
    state.updatePlayerName(multiplayer.getLocalPlayerIndex(), name);
    // Send to host
    multiplayer.sendPlayerName(name);
}

/**
 * Handle multiplayer connection established
 */
function handleMultiplayerConnected() {
    // Notify multiplayer module that connection is established
    // (webrtc only supports one callback, so we need to forward this)
    multiplayer.notifyConnected();

    showMultiplayerSection('connected');

    if (webrtc.getIsHost()) {
        // Host: set up players for multiplayer, stay on setup screen
        state.updatePlayerName(0, 'Host');
        state.updatePlayerName(1, 'Guest (connecting...)');
        // Ensure both players are human (no bots in multiplayer)
        state.setPlayerAsBot(0, false);
        state.setPlayerAsBot(1, false);
        // Update start button text
        updateStartButtonForMultiplayer();
    } else {
        // Guest: enter waiting state immediately
        state.updatePlayerName(0, 'Host');
        state.updatePlayerName(1, 'Guest');
        state.setPlayerAsBot(0, false);
        state.setPlayerAsBot(1, false);
        // Set default name in input and send to host
        mpElements.guestNameInput.value = 'Guest';
        multiplayer.sendPlayerName('Guest');
        state.enterWaitingState();
    }
}

/**
 * Update start button text for multiplayer mode
 */
function updateStartButtonForMultiplayer() {
    const elements = ui.getElements();
    if (multiplayer.isMultiplayerMode() && webrtc.getIsHost()) {
        elements.startGameBtn.textContent = 'Start Remote Game';
    } else {
        elements.startGameBtn.textContent = 'Start Local Game';
    }
}

/**
 * Handle multiplayer disconnection
 */
function handleMultiplayerDisconnected() {
    // Notify multiplayer module that connection is lost
    multiplayer.notifyDisconnected();

    resetMultiplayerUI();
    // Reset UI for local mode
    const elements = ui.getElements();
    elements.startGameBtn.textContent = 'Start Local Game';
    elements.addPlayerBtn.classList.remove('hidden');
    ui.showError('Connection lost. Please reconnect to continue playing.');
}

/**
 * Handle remote action from multiplayer module
 */
function handleRemoteAction(actionType, data) {
    console.log('Remote action:', actionType, data);
    // State is already updated by multiplayer module
    // Just need to re-render
    renderFromState();
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
 * Show specific host step
 */
function showHostStep(step) {
    mpElements.hostStep1.classList.toggle('hidden', step !== 1);
    mpElements.hostStep2.classList.toggle('hidden', step < 2);
    mpElements.hostStep3.classList.toggle('hidden', step < 3);
}

/**
 * Show specific join step
 */
function showJoinStep(step) {
    mpElements.joinStep1.classList.toggle('hidden', step !== 1);
    mpElements.joinStep2.classList.toggle('hidden', step !== 2);
    mpElements.joinStep3.classList.toggle('hidden', step !== 3);
}

/**
 * Reset multiplayer UI to default state
 */
function resetMultiplayerUI() {
    showMultiplayerSection('default');
    mpElements.hostOfferToken.value = '';
    mpElements.hostAnswerInput.value = '';
    mpElements.joinOfferInput.value = '';
    mpElements.joinAnswerToken.value = '';
    webrtc.cleanup();
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
        ui.showError('Failed to copy to clipboard.');
    }
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
            break;

        case state.PHASES.PLAYING:
            ui.showScreen('game');
            renderGameScreen(currentState);
            break;

        case state.PHASES.CHALLENGE:
            // Keep showing game screen during challenge
            ui.showScreen('game');
            break;

        case state.PHASES.FINISHED:
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
    const isMultiplayerMode = multiplayer.isMultiplayerMode();

    // Update conflict warnings and disabled states
    ui.updateBotRegionConflictState(hasBots, hasRegion);

    // If bots are present and region was reset, clear localStorage
    if (hasBots && !hasRegion) {
        localStorage.setItem(STORAGE_KEYS.REGION, '0');
        localStorage.removeItem(STORAGE_KEYS.RELATION_ID);
    }

    // Hide add player button in multiplayer mode
    const elements = ui.getElements();
    elements.addPlayerBtn.classList.toggle('hidden', isMultiplayerMode);

    // Build multiplayer options if in multiplayer mode
    const multiplayerOptions = isMultiplayerMode ? {
        isMultiplayer: true,
        localPlayerIndex: multiplayer.getLocalPlayerIndex()
    } : null;

    ui.renderPlayerList(
        currentState.players,
        (index, name) => {
            state.updatePlayerName(index, name);
            // Send name to remote player if in multiplayer
            if (isMultiplayerMode && index === multiplayer.getLocalPlayerIndex()) {
                multiplayer.sendPlayerName(name);
            }
        },
        (index) => state.removePlayer(index),
        (index, isBot) => state.setPlayerAsBot(index, isBot),
        (index, difficulty) => state.setBotDifficulty(index, difficulty),
        hasRegion || isMultiplayerMode, // Disable bot toggles if region is selected or in multiplayer
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
        currentState.currentPlayerIndex
    );
    ui.renderTagPool(currentState.tags);

    // In multiplayer, disable controls when it's not the local player's turn
    if (multiplayer.isMultiplayerMode()) {
        const isLocalTurn = multiplayer.isLocalPlayerTurn();
        ui.setGameControlsEnabled(isLocalTurn);
    }
}

/**
 * Render results screen
 */
function renderResultsScreen(currentState) {
    const ultraLink = overpass.buildUltraLink(currentState.tags, currentState.region);
    ui.renderResults(currentState.challengeResult, currentState.tags, ultraLink);
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
            displayName: `Relation ${relationId}`
        });
        localStorage.setItem(STORAGE_KEYS.RELATION_ID, relationId);
    } else {
        state.setRegion(null);
    }
}

/**
 * Handle start game button
 */
function handleStartGame() {
    const regionData = ui.getSelectedRegion();
    state.setRegion(regionData);

    // In multiplayer, host sends game start to guest
    if (multiplayer.isMultiplayerMode() && webrtc.getIsHost()) {
        const currentState = state.getState();
        multiplayer.sendGameStart(regionData, currentState.players);
    }

    state.startGame();
}

/**
 * Handle submit button - validates and processes the player's turn
 */
function handleSubmit() {
    // In multiplayer, only allow submit on local player's turn
    if (multiplayer.isMultiplayerMode() && !multiplayer.isLocalPlayerTurn()) {
        ui.showError("It's not your turn!");
        return;
    }

    const validation = ui.validateSingleEdit();

    if (!validation.valid) {
        ui.showError(validation.error);
        return;
    }

    if (validation.type === 'new') {
        // Adding a new tag
        const { key, value } = validation.data;
        const success = state.addTag(key, value);
        if (!success) {
            ui.showError('That key already exists. Specify a value for it instead.');
            return;
        }
        // Send to remote in multiplayer
        if (multiplayer.isMultiplayerMode()) {
            multiplayer.sendAddTag(key, value);
        }
    } else if (validation.type === 'value') {
        // Specifying a value for existing key
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
        // Send to remote in multiplayer
        if (multiplayer.isMultiplayerMode()) {
            multiplayer.sendSpecifyValue(tag.key, value);
        }
    }

    // Move to next turn
    state.nextTurn();
}

/**
 * Handle challenge button
 */
async function handleChallenge() {
    // In multiplayer, only allow challenge on local player's turn
    if (multiplayer.isMultiplayerMode() && !multiplayer.isLocalPlayerTurn()) {
        ui.showError("It's not your turn!");
        return;
    }

    const currentState = state.getState();

    // Initiate challenge
    state.initiateChallenge();

    // Send challenge to remote in multiplayer
    if (multiplayer.isMultiplayerMode()) {
        multiplayer.sendChallenge();
    }

    // Show loading
    ui.showLoading();

    try {
        // Execute query
        const count = await overpass.executeCountQuery(currentState.tags, currentState.region);

        // Send result to remote in multiplayer
        if (multiplayer.isMultiplayerMode()) {
            multiplayer.sendChallengeResult(count);
        }

        // Set result
        state.setChallengeResult(count);
    } catch (error) {
        console.error('Overpass query failed:', error);
        ui.showError(`Query failed: ${error.message}. Please try again.`);
        // Go back to playing state
        state.playAgain();
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
    const delay = bot.getThinkingDelay(currentPlayer.difficulty);
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
