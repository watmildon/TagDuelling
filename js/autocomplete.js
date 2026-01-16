/**
 * Autocomplete Module
 * Provides tag suggestions as users type in tag inputs
 */

import { TagTrie } from './tagtrie.js';
import * as state from './gameState.js';

// TagTrie instance (loaded asynchronously)
let trie = null;

// Currently active autocomplete dropdown
let activeDropdown = null;
let activeInput = null;
let selectedIndex = -1;

/**
 * Initialize the autocomplete system by loading tag data
 */
export async function init() {
    try {
        const response = await fetch('./js/tagdata.json');
        const data = await response.json();
        trie = new TagTrie(data);
        console.log('TagTrie loaded:', trie.getMetadata());
    } catch (error) {
        console.error('Failed to load tag data for autocomplete:', error);
    }
}

/**
 * Check if autocomplete is ready
 * @returns {boolean}
 */
export function isReady() {
    return trie !== null;
}

/**
 * Get key suggestions for a prefix
 * @param {string} prefix - The prefix to match
 * @param {number} limit - Maximum results
 * @returns {string[]}
 */
export function getKeySuggestions(prefix, limit = 10) {
    if (!trie) return [];
    return trie.matchKeys(prefix, limit);
}

/**
 * Get value suggestions for a key and optional prefix
 * @param {string} key - The tag key
 * @param {string} prefix - The value prefix to match
 * @param {number} limit - Maximum results
 * @returns {string[]}
 */
export function getValueSuggestions(key, prefix = '', limit = 10) {
    if (!trie) return [];
    return trie.matchValues(key, prefix, limit);
}

/**
 * Attach autocomplete behavior to an input element
 * @param {HTMLInputElement} input - The input element
 * @param {string} type - 'key' for key suggestions, 'value' for value suggestions
 * @param {string} [tagKey] - For value inputs, the key to get values for
 */
export function attachToInput(input, type, tagKey = null) {
    if (!input) return;

    // Store metadata on the input
    input.dataset.autocompleteType = type;
    if (tagKey) {
        input.dataset.autocompleteKey = tagKey;
    }

    // Input event - show suggestions as user types
    input.addEventListener('input', handleInput);

    // Focus event - show suggestions if there's content
    input.addEventListener('focus', handleFocus);

    // Blur event - hide suggestions (with delay for click handling)
    input.addEventListener('blur', handleBlur);

    // Keyboard navigation
    input.addEventListener('keydown', handleKeydown);
}

/**
 * Detach autocomplete from an input element
 * @param {HTMLInputElement} input
 */
export function detachFromInput(input) {
    if (!input) return;
    input.removeEventListener('input', handleInput);
    input.removeEventListener('focus', handleFocus);
    input.removeEventListener('blur', handleBlur);
    input.removeEventListener('keydown', handleKeydown);
}

/**
 * Handle input event - show suggestions based on current value
 */
function handleInput(e) {
    const input = e.target;
    showSuggestionsForInput(input);
}

/**
 * Handle focus event
 */
function handleFocus(e) {
    const input = e.target;
    showSuggestionsForInput(input);
}

/**
 * Handle blur event - hide suggestions after a delay
 */
function handleBlur(e) {
    const blurredInput = e.target;
    // Delay to allow click events on dropdown items
    setTimeout(() => {
        // Only hide if the blurred input is still the active one
        // (prevents hiding when focus moves to another autocomplete input)
        if (activeInput === blurredInput || activeInput === null) {
            hideDropdown();
        }
    }, 150);
}

/**
 * Handle keyboard navigation in dropdown
 */
function handleKeydown(e) {
    if (!activeDropdown) return;

    const items = activeDropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateSelection(items);
            break;

        case 'ArrowUp':
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelection(items);
            break;

        case 'Enter':
            if (selectedIndex >= 0 && items[selectedIndex]) {
                e.preventDefault();
                selectItem(items[selectedIndex]);
            }
            break;

        case 'Escape':
            e.preventDefault();
            hideDropdown();
            break;

        case 'Tab':
            // Allow tab to complete selected item if there is one
            if (selectedIndex >= 0 && items[selectedIndex]) {
                e.preventDefault();
                selectItem(items[selectedIndex]);
            } else {
                hideDropdown();
            }
            break;
    }
}

/**
 * Update visual selection in dropdown
 */
function updateSelection(items) {
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === selectedIndex);
    });

    // Scroll selected item into view
    if (selectedIndex >= 0 && items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
}

/**
 * Show suggestions dropdown for an input
 */
function showSuggestionsForInput(input) {
    if (!trie) return;

    // Disable autocomplete in tournament mode
    if (state.isTournamentMode()) {
        hideDropdown();
        return;
    }

    const type = input.dataset.autocompleteType;
    const value = input.value;

    let suggestions = [];
    let showNoSuggestions = false;

    if (type === 'key' || type === 'new') {
        // For new tag input, parse the value to determine context
        if (value.includes('=')) {
            // User is typing a value after the equals sign
            const [keyPart, valuePart] = value.split('=');
            const key = keyPart.trim();
            const valuePrefix = valuePart || '';

            // Check if the key exists in the trie
            if (trie.hasKey(key)) {
                suggestions = getValueSuggestions(key, valuePrefix, 10);
                if (suggestions.length === 0 && valuePrefix) {
                    showNoSuggestions = true;
                }
            } else {
                // Key not in trie - show "no suggestions"
                showNoSuggestions = true;
            }
            // Store context for selection
            input.dataset.autocompleteContext = 'value';
            input.dataset.autocompleteKeyPart = key;
        } else {
            // User is typing a key (or input is empty - show top keys)
            suggestions = getKeySuggestions(value, 10);
            if (suggestions.length === 0 && value) {
                showNoSuggestions = true;
            }
            input.dataset.autocompleteContext = 'key';
        }
    } else if (type === 'value') {
        // For value-only inputs (existing key without value)
        const key = input.dataset.autocompleteKey;
        if (key) {
            if (trie.hasKey(key)) {
                // Show top values when empty, or filtered values when typing
                suggestions = getValueSuggestions(key, value, 10);
                if (suggestions.length === 0 && value) {
                    showNoSuggestions = true;
                }
            } else if (value) {
                // Key not in trie and user is typing - show "no suggestions"
                showNoSuggestions = true;
            }
            // If key not in trie and input is empty, just don't show anything
        }
    }

    if (suggestions.length > 0) {
        showDropdown(input, suggestions);
    } else if (showNoSuggestions) {
        showNoSuggestionsDropdown(input);
    } else {
        hideDropdown();
    }
}

/**
 * Show a "no suggestions" message dropdown
 */
function showNoSuggestionsDropdown(input) {
    hideDropdown(); // Remove any existing dropdown

    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';

    const item = document.createElement('div');
    item.className = 'autocomplete-item autocomplete-no-suggestions';
    item.textContent = 'No suggestions';

    dropdown.appendChild(item);

    // Position dropdown below input
    const tagItem = input.closest('.tag-item');

    if (tagItem) {
        tagItem.style.position = 'relative';
        dropdown.style.position = 'absolute';
        dropdown.style.top = '100%';
        dropdown.style.left = '0';
        dropdown.style.right = '0';
        dropdown.style.marginTop = '2px';
        tagItem.appendChild(dropdown);
    } else {
        const rect = input.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.width = `${rect.width}px`;
        document.body.appendChild(dropdown);
    }

    activeDropdown = dropdown;
    activeInput = input;
    selectedIndex = -1;
}

/**
 * Create and show the dropdown
 */
function showDropdown(input, suggestions) {
    hideDropdown(); // Remove any existing dropdown

    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';

    suggestions.forEach((suggestion, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = suggestion;
        item.dataset.value = suggestion;
        item.dataset.index = index;

        item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent blur
        });

        item.addEventListener('click', () => {
            selectItem(item);
        });

        item.addEventListener('mouseenter', () => {
            selectedIndex = index;
            updateSelection(dropdown.querySelectorAll('.autocomplete-item'));
        });

        dropdown.appendChild(item);
    });

    // Position dropdown below input
    const rect = input.getBoundingClientRect();
    const tagItem = input.closest('.tag-item');

    // Append to tag-item if available, otherwise to body
    if (tagItem) {
        tagItem.style.position = 'relative';
        dropdown.style.position = 'absolute';
        dropdown.style.top = '100%';
        dropdown.style.left = '0';
        dropdown.style.right = '0';
        dropdown.style.marginTop = '2px';
        tagItem.appendChild(dropdown);
    } else {
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.width = `${rect.width}px`;
        document.body.appendChild(dropdown);
    }

    activeDropdown = dropdown;
    activeInput = input;
    selectedIndex = -1;
}

/**
 * Hide the dropdown
 */
function hideDropdown() {
    if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
    }
    activeInput = null;
    selectedIndex = -1;
}

/**
 * Select an item from the dropdown
 */
function selectItem(item) {
    if (!activeInput) return;

    const value = item.dataset.value;
    const type = activeInput.dataset.autocompleteType;
    const context = activeInput.dataset.autocompleteContext;

    if (type === 'new' || type === 'key') {
        if (context === 'value') {
            // User was typing a value - complete the full key=value
            const keyPart = activeInput.dataset.autocompleteKeyPart;
            activeInput.value = `${keyPart}=${value}`;
        } else {
            // User was typing a key - insert key and add equals sign for value completion
            activeInput.value = `${value}=`;
            // Show value suggestions for this key
            setTimeout(() => {
                showSuggestionsForInput(activeInput);
            }, 0);
        }
    } else if (type === 'value') {
        // For value-only inputs, just set the value
        activeInput.value = value;
    }

    hideDropdown();

    // Keep focus on input
    activeInput.focus();

    // Trigger input event so any listeners can react
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Clean up autocomplete dropdowns (call when tag pool is re-rendered)
 */
export function cleanup() {
    hideDropdown();
}
