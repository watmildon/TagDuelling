/**
 * Main Application Module
 * Orchestrates game flow and handles all event bindings
 */

import * as state from './gameState.js';
import * as ui from './ui.js';
import * as overpass from './overpass.js';
import * as bot from './bot.js';

// Local storage keys
const STORAGE_KEYS = {
    REGION: 'tag-duelling-region',
    RELATION_ID: 'tag-duelling-relation-id',
    THEME: 'tag-duelling-theme'
};

/**
 * Initialize the application
 */
function init() {
    // Initialize UI elements
    const elements = ui.initElements();

    // Load saved preferences
    loadPreferences(elements);

    // Set up event listeners
    bindEvents(elements);

    // Subscribe to state changes
    state.subscribe(handleStateChange);

    // Initial render
    renderFromState();
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
    elements.backToSetupBtn.addEventListener('click', () => state.backToSetup());

    // Enter key in tag inputs submits the turn
    elements.tagPool.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && (e.target.classList.contains('tag-new-input') || e.target.classList.contains('tag-value-input'))) {
            handleSubmit();
        }
    });

    // Results screen
    elements.playAgainBtn.addEventListener('click', () => state.playAgain());
    elements.newGameBtn.addEventListener('click', () => state.resetToSetup());
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

    // Update conflict warnings and disabled states
    ui.updateBotRegionConflictState(hasBots, hasRegion);

    // If bots are present and region was reset, clear localStorage
    if (hasBots && !hasRegion) {
        localStorage.setItem(STORAGE_KEYS.REGION, '0');
        localStorage.removeItem(STORAGE_KEYS.RELATION_ID);
    }

    ui.renderPlayerList(
        currentState.players,
        (index, name) => state.updatePlayerName(index, name),
        (index) => state.removePlayer(index),
        (index, isBot) => state.setPlayerAsBot(index, isBot),
        (index, difficulty) => state.setBotDifficulty(index, difficulty),
        hasRegion // Disable bot toggles if region is selected
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
    state.startGame();
}

/**
 * Handle submit button - validates and processes the player's turn
 */
function handleSubmit() {
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
    }

    // Move to next turn
    state.nextTurn();
}

/**
 * Handle challenge button
 */
async function handleChallenge() {
    const currentState = state.getState();

    // Initiate challenge
    state.initiateChallenge();

    // Show loading
    ui.showLoading();

    try {
        // Execute query
        const count = await overpass.executeCountQuery(currentState.tags, currentState.region);

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
