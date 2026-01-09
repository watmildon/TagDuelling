/**
 * UI Module
 * Handles all DOM rendering and updates
 */

import { PHASES } from './gameState.js';

// DOM element references (cached for performance)
let elements = null;

/**
 * Initialize and cache DOM element references
 */
export function initElements() {
    elements = {
        // Screens
        setupScreen: document.getElementById('setup-screen'),
        waitingScreen: document.getElementById('waiting-screen'),
        gameScreen: document.getElementById('game-screen'),
        resultsScreen: document.getElementById('results-screen'),

        // Setup
        playerList: document.getElementById('player-list'),
        addPlayerBtn: document.getElementById('add-player-btn'),
        botWarning: document.getElementById('bot-warning'),
        regionSelect: document.getElementById('region-select'),
        regionWarning: document.getElementById('region-warning'),
        customRegionInput: document.getElementById('custom-region-input'),
        relationIdInput: document.getElementById('relation-id-input'),
        startGameBtn: document.getElementById('start-game-btn'),

        // Game
        currentPlayer: document.getElementById('current-player'),
        playerIndicators: document.getElementById('player-indicators'),
        tagPool: document.getElementById('tag-pool'),
        submitBtn: document.getElementById('submit-btn'),
        challengeBtn: document.getElementById('challenge-btn'),
        backToSetupBtn: document.getElementById('back-to-setup-btn'),

        // Results
        resultIcon: document.getElementById('result-icon'),
        resultTitle: document.getElementById('result-title'),
        resultMessage: document.getElementById('result-message'),
        resultCount: document.getElementById('result-count'),
        overpassLink: document.getElementById('overpass-link'),
        finalTagList: document.getElementById('final-tag-list'),
        playAgainBtn: document.getElementById('play-again-btn'),
        newGameBtn: document.getElementById('new-game-btn'),

        // Loading
        loadingOverlay: document.getElementById('loading-overlay'),

        // Theme
        themeToggle: document.getElementById('theme-toggle')
    };

    return elements;
}

/**
 * Get cached elements
 */
export function getElements() {
    return elements;
}

/**
 * Show a specific screen, hide others
 * @param {string} screenName - 'setup', 'waiting', 'game', or 'results'
 */
export function showScreen(screenName) {
    elements.setupScreen.classList.toggle('hidden', screenName !== 'setup');
    elements.waitingScreen.classList.toggle('hidden', screenName !== 'waiting');
    elements.gameScreen.classList.toggle('hidden', screenName !== 'game');
    elements.resultsScreen.classList.toggle('hidden', screenName !== 'results');
}

/**
 * Render the player list in setup screen
 * @param {Array} players - Array of player objects
 * @param {Function} onNameChange - Callback for name changes
 * @param {Function} onRemove - Callback for removing player
 * @param {Function} onBotToggle - Callback for bot toggle (optional)
 * @param {Function} onDifficultyChange - Callback for difficulty change (optional)
 * @param {boolean} disableBotToggles - Whether bot toggles should be disabled (region selected)
 * @param {Object} multiplayerOptions - Multiplayer mode options { isMultiplayer, localPlayerIndex }
 */
export function renderPlayerList(players, onNameChange, onRemove, onBotToggle = null, onDifficultyChange = null, disableBotToggles = false, multiplayerOptions = null) {
    elements.playerList.innerHTML = '';

    const isMultiplayer = multiplayerOptions?.isMultiplayer || false;
    const localPlayerIndex = multiplayerOptions?.localPlayerIndex ?? -1;

    players.forEach((player, index) => {
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';

        // In multiplayer, mark remote players
        const isRemotePlayer = isMultiplayer && index !== localPlayerIndex;
        if (isRemotePlayer) {
            playerItem.classList.add('remote-player');
        }
        if (isMultiplayer && index === localPlayerIndex) {
            playerItem.classList.add('local-player');
        }

        // Bot toggle (if callbacks provided and not in multiplayer mode)
        if (onBotToggle && !isMultiplayer) {
            const toggleContainer = document.createElement('div');
            toggleContainer.className = 'bot-toggle-container';

            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'bot-toggle';
            if (disableBotToggles) {
                toggleLabel.classList.add('disabled');
            }

            const toggleCheckbox = document.createElement('input');
            toggleCheckbox.type = 'checkbox';
            toggleCheckbox.checked = player.isBot || false;
            toggleCheckbox.disabled = disableBotToggles;
            toggleCheckbox.addEventListener('change', (e) => onBotToggle(index, e.target.checked));

            const toggleSlider = document.createElement('span');
            toggleSlider.className = 'bot-toggle-slider';

            toggleLabel.appendChild(toggleCheckbox);
            toggleLabel.appendChild(toggleSlider);

            const toggleText = document.createElement('span');
            toggleText.className = 'bot-toggle-text';
            toggleText.textContent = player.isBot ? 'BOT' : 'HUMAN';

            toggleContainer.appendChild(toggleLabel);
            toggleContainer.appendChild(toggleText);
            playerItem.appendChild(toggleContainer);
        }

        // In multiplayer, show player type indicator instead of bot toggle
        if (isMultiplayer) {
            const playerTypeIndicator = document.createElement('span');
            playerTypeIndicator.className = 'player-type-indicator';
            if (index === localPlayerIndex) {
                playerTypeIndicator.textContent = 'YOU';
                playerTypeIndicator.classList.add('you');
            } else {
                playerTypeIndicator.textContent = 'REMOTE';
                playerTypeIndicator.classList.add('remote');
            }
            playerItem.appendChild(playerTypeIndicator);
        }

        // Name input
        const input = document.createElement('input');
        input.type = 'text';
        input.value = player.name;
        input.placeholder = `Player ${index + 1}`;
        // Disable name editing for bots and remote players
        input.disabled = player.isBot || isRemotePlayer;
        input.addEventListener('change', (e) => onNameChange(index, e.target.value));
        input.addEventListener('blur', (e) => {
            if (!e.target.value.trim()) {
                e.target.value = `Player ${index + 1}`;
                onNameChange(index, e.target.value);
            }
        });
        playerItem.appendChild(input);

        // Difficulty selector (only for bots, not in multiplayer)
        if (player.isBot && onDifficultyChange && !isMultiplayer) {
            const difficultySelect = document.createElement('select');
            difficultySelect.className = 'bot-difficulty';
            ['easy', 'medium', 'hard'].forEach(diff => {
                const option = document.createElement('option');
                option.value = diff;
                option.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
                option.selected = player.difficulty === diff;
                difficultySelect.appendChild(option);
            });
            difficultySelect.addEventListener('change', (e) => onDifficultyChange(index, e.target.value));
            playerItem.appendChild(difficultySelect);
        }

        // Only show remove button if more than 2 players and not in multiplayer
        if (players.length > 2 && !isMultiplayer) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-player-btn';
            removeBtn.textContent = '\u00D7'; // × symbol
            removeBtn.title = 'Remove player';
            removeBtn.addEventListener('click', () => onRemove(index));
            playerItem.appendChild(removeBtn);
        }

        elements.playerList.appendChild(playerItem);
    });
}

/**
 * Render the current player indicator in game screen
 * @param {Object} currentPlayer - Current player object
 * @param {Array} players - All players
 * @param {number} currentIndex - Current player index
 * @param {boolean} isBotThinking - Whether bot is currently thinking
 */
export function renderCurrentPlayer(currentPlayer, players, currentIndex, isBotThinking = false) {
    const isBot = currentPlayer.isBot;

    if (isBot && isBotThinking) {
        elements.currentPlayer.textContent = `${currentPlayer.name} is thinking...`;
        elements.currentPlayer.classList.add('bot-thinking');
    } else {
        elements.currentPlayer.textContent = `${currentPlayer.name}'s Turn`;
        elements.currentPlayer.classList.remove('bot-thinking');
    }

    // Render all player indicators
    elements.playerIndicators.innerHTML = '';
    players.forEach((player, index) => {
        const indicator = document.createElement('span');
        indicator.className = 'player-indicator';
        if (index === currentIndex) {
            indicator.classList.add('active');
        }
        if (player.isBot) {
            indicator.classList.add('is-bot');
        }
        indicator.textContent = player.name;
        elements.playerIndicators.appendChild(indicator);
    });
}

/**
 * Render the tag pool with inline editing
 * @param {Array} tags - Array of {key, value} objects
 */
export function renderTagPool(tags) {
    elements.tagPool.innerHTML = '';

    // Render existing tags
    tags.forEach((tag, index) => {
        const tagItem = document.createElement('div');
        tagItem.className = 'tag-item';

        const keySpan = document.createElement('span');
        keySpan.className = 'tag-key';
        keySpan.textContent = tag.key;
        tagItem.appendChild(keySpan);

        if (tag.value !== null) {
            // Tag has a value - display as read-only
            const equalsSpan = document.createElement('span');
            equalsSpan.className = 'tag-equals';
            equalsSpan.textContent = ' = ';
            tagItem.appendChild(equalsSpan);

            const valueSpan = document.createElement('span');
            valueSpan.className = 'tag-value';
            valueSpan.textContent = tag.value;
            tagItem.appendChild(valueSpan);
        } else {
            // Tag is key-only - add editable value input
            const equalsSpan = document.createElement('span');
            equalsSpan.className = 'tag-equals';
            equalsSpan.textContent = ' = ';
            tagItem.appendChild(equalsSpan);

            const valueInput = document.createElement('input');
            valueInput.type = 'text';
            valueInput.className = 'tag-value-input';
            valueInput.placeholder = '(any value)';
            valueInput.dataset.tagIndex = index;
            valueInput.dataset.inputType = 'value';
            tagItem.appendChild(valueInput);
        }

        elements.tagPool.appendChild(tagItem);
    });

    // Add new tag input row at the bottom
    const newTagItem = document.createElement('div');
    newTagItem.className = 'tag-item tag-item-new';

    const newTagInput = document.createElement('input');
    newTagInput.type = 'text';
    newTagInput.className = 'tag-new-input';
    newTagInput.id = 'new-tag-input';
    newTagInput.placeholder = tags.length === 0 ? 'Enter tag (e.g., amenity or amenity=cafe)' : 'Add new tag...';
    newTagInput.dataset.inputType = 'new';

    newTagItem.appendChild(newTagInput);
    elements.tagPool.appendChild(newTagItem);

    // Focus the new tag input
    newTagInput.focus();
}

/**
 * Get all editable inputs and their values
 * @returns {Object} Object with newTag and valueInputs arrays
 */
export function getEditableInputs() {
    const newTagInput = document.getElementById('new-tag-input');
    const valueInputs = elements.tagPool.querySelectorAll('.tag-value-input');

    const result = {
        newTag: newTagInput ? newTagInput.value.trim() : '',
        valueEdits: []
    };

    valueInputs.forEach(input => {
        const value = input.value.trim();
        if (value) {
            result.valueEdits.push({
                tagIndex: parseInt(input.dataset.tagIndex, 10),
                value: value
            });
        }
    });

    return result;
}

/**
 * Validate that only one edit was made
 * @returns {Object} { valid: boolean, error: string|null, type: 'new'|'value'|null, data: any }
 */
export function validateSingleEdit() {
    const inputs = getEditableInputs();
    const hasNewTag = inputs.newTag.length > 0;
    const hasValueEdit = inputs.valueEdits.length > 0;

    if (!hasNewTag && !hasValueEdit) {
        return { valid: false, error: 'Please enter a tag or specify a value', type: null, data: null };
    }

    if (hasNewTag && hasValueEdit) {
        return { valid: false, error: 'Please only make one change per turn (either add a new tag OR specify a value)', type: null, data: null };
    }

    if (inputs.valueEdits.length > 1) {
        return { valid: false, error: 'Please only specify one value per turn', type: null, data: null };
    }

    if (hasNewTag) {
        // Parse the new tag input
        const tagStr = inputs.newTag;
        if (tagStr.includes('=')) {
            const [key, ...valueParts] = tagStr.split('=');
            const value = valueParts.join('='); // Handle values containing =
            return {
                valid: true,
                error: null,
                type: 'new',
                data: { key: key.trim(), value: value.trim() || null }
            };
        } else {
            return {
                valid: true,
                error: null,
                type: 'new',
                data: { key: tagStr, value: null }
            };
        }
    }

    if (hasValueEdit) {
        return {
            valid: true,
            error: null,
            type: 'value',
            data: inputs.valueEdits[0]
        };
    }

    return { valid: false, error: 'Unknown error', type: null, data: null };
}

/**
 * Clear all editable inputs
 */
export function clearEditableInputs() {
    const newTagInput = document.getElementById('new-tag-input');
    if (newTagInput) {
        newTagInput.value = '';
    }

    const valueInputs = elements.tagPool.querySelectorAll('.tag-value-input');
    valueInputs.forEach(input => {
        input.value = '';
    });
}

/**
 * Render the results screen
 * @param {Object} result - Challenge result object
 * @param {Array} tags - Final tag list
 * @param {string} ultraLink - Link to Ultra
 */
export function renderResults(result, tags, ultraLink) {
    // Set icon
    elements.resultIcon.className = 'result-icon';
    // We show from challenger's perspective
    if (result.challengerWon) {
        elements.resultIcon.classList.add('winner');
        elements.resultTitle.textContent = `${result.winner} Wins!`;
        elements.resultMessage.textContent = `The challenge was successful! No objects exist with these tags.`;
    } else {
        elements.resultIcon.classList.add('loser');
        elements.resultTitle.textContent = `${result.winner} Wins!`;
        elements.resultMessage.textContent = `The challenge failed! Objects exist with these tags.`;
    }

    // Result count with formatting
    if (result.count === Infinity) {
        elements.resultCount.textContent = 'Many (query timed out)';
    } else {
        elements.resultCount.textContent = result.count.toLocaleString();
    }

    // Overpass link
    elements.overpassLink.href = ultraLink;

    // Final tags
    renderFinalTags(tags);
}

/**
 * Render tags in results screen
 * @param {Array} tags - Array of {key, value} objects
 */
function renderFinalTags(tags) {
    elements.finalTagList.innerHTML = '';

    tags.forEach(tag => {
        const tagItem = document.createElement('div');
        tagItem.className = 'tag-item';

        const keySpan = document.createElement('span');
        keySpan.className = 'tag-key';
        keySpan.textContent = tag.key;
        tagItem.appendChild(keySpan);

        if (tag.value !== null) {
            const equalsSpan = document.createElement('span');
            equalsSpan.className = 'tag-equals';
            equalsSpan.textContent = ' = ';
            tagItem.appendChild(equalsSpan);

            const valueSpan = document.createElement('span');
            valueSpan.className = 'tag-value';
            valueSpan.textContent = tag.value;
            tagItem.appendChild(valueSpan);
        } else {
            const anySpan = document.createElement('span');
            anySpan.className = 'tag-any';
            anySpan.textContent = '(any value)';
            tagItem.appendChild(anySpan);
        }

        elements.finalTagList.appendChild(tagItem);
    });
}

/**
 * Show loading overlay
 */
export function showLoading() {
    elements.loadingOverlay.classList.remove('hidden');
}

/**
 * Hide loading overlay
 */
export function hideLoading() {
    elements.loadingOverlay.classList.add('hidden');
}

/**
 * Show an error message
 * @param {string} message - Error message to display
 */
export function showError(message) {
    alert(message); // Simple alert for now
}

/**
 * Show a retryable error dialog and return user's choice
 * @param {string} message - Error message to display
 * @returns {Promise<boolean>} True if user wants to retry, false otherwise
 */
export function showRetryDialog(message) {
    // Use confirm for now - could be upgraded to a custom modal later
    const retryPrompt = `${message}\n\nWould you like to try again?`;
    return Promise.resolve(confirm(retryPrompt));
}

/**
 * Get the selected region data
 * @returns {Object|null} Region object with name/adminLevel or relationId, or null for global
 */
export function getSelectedRegion() {
    const select = elements.regionSelect;
    const option = select.options[select.selectedIndex];

    // Check for custom relation ID
    if (option.value === 'custom') {
        const relationId = elements.relationIdInput.value.trim();
        if (relationId) {
            return {
                relationId: relationId,
                displayName: `Relation ${relationId}`
            };
        }
        return null; // No ID entered, treat as global
    }

    // Check for global (no data attributes)
    if (!option.dataset.name) {
        return null;
    }

    return {
        name: option.dataset.name,
        adminLevel: option.dataset.adminLevel,
        displayName: option.text
    };
}

/**
 * Show or hide the custom region input based on selection
 */
export function updateCustomRegionVisibility() {
    const select = elements.regionSelect;
    const option = select.options[select.selectedIndex];
    const isCustom = option.value === 'custom';

    elements.customRegionInput.classList.toggle('hidden', !isCustom);

    if (isCustom) {
        elements.relationIdInput.focus();
    }
}

/**
 * Set the relation ID input value (used when loading preferences)
 * @param {string} relationId - The relation ID to set
 */
export function setRelationIdInput(relationId) {
    if (elements.relationIdInput) {
        elements.relationIdInput.value = relationId || '';
    }
}

/**
 * Update bot/region conflict state
 * @param {boolean} hasBots - Whether any player is a bot
 * @param {boolean} hasRegion - Whether a non-global region is selected
 */
export function updateBotRegionConflictState(hasBots, hasRegion) {
    // Region select: disable if bots are present
    elements.regionSelect.disabled = hasBots;
    elements.regionWarning.classList.toggle('hidden', !hasBots);

    // Bot warning in players section: show if region is selected
    elements.botWarning.classList.toggle('hidden', !hasRegion);

    // If bots are present, reset region select to global and hide custom input
    if (hasBots) {
        elements.regionSelect.selectedIndex = 0; // Reset to "Global"
        elements.customRegionInput.classList.add('hidden');
        elements.relationIdInput.disabled = true;
        elements.relationIdInput.value = '';
    } else {
        elements.relationIdInput.disabled = false;
        // Custom region visibility handled by updateCustomRegionVisibility
    }
}

/**
 * Check if bot toggles should be disabled (region is selected)
 * @returns {boolean}
 */
export function shouldDisableBotToggles() {
    const select = elements.regionSelect;
    const option = select.options[select.selectedIndex];
    // Disable if any region other than global is selected
    return option.value !== '' || (option.value === 'custom' && elements.relationIdInput.value.trim() !== '');
}

/**
 * Show bot thinking state (disable inputs during bot turn)
 */
export function showBotThinking() {
    elements.submitBtn.disabled = true;
    elements.challengeBtn.disabled = true;
    const inputs = elements.tagPool.querySelectorAll('input');
    inputs.forEach(input => input.disabled = true);
    elements.currentPlayer.classList.add('bot-thinking');
}

/**
 * Hide bot thinking state (re-enable inputs)
 */
export function hideBotThinking() {
    elements.submitBtn.disabled = false;
    elements.challengeBtn.disabled = false;
    const inputs = elements.tagPool.querySelectorAll('input');
    inputs.forEach(input => input.disabled = false);
    elements.currentPlayer.classList.remove('bot-thinking');
}

/**
 * Set game controls enabled/disabled state for multiplayer turn management
 * @param {boolean} isLocalTurn - Whether it's the local player's turn
 */
export function setGameControlsEnabled(isLocalTurn) {
    elements.submitBtn.disabled = !isLocalTurn;
    elements.challengeBtn.disabled = !isLocalTurn;
    const inputs = elements.tagPool.querySelectorAll('input');
    inputs.forEach(input => input.disabled = !isLocalTurn);

    // Add visual indication when it's not the local player's turn
    elements.currentPlayer.classList.toggle('waiting-for-opponent', !isLocalTurn);
}
