/**
 * Bot Module
 * Handles bot AI logic and TagInfo API integration
 */

const TAGINFO_BASE_URL = 'https://taginfo.openstreetmap.org/api/4';

// Difficulty configurations
const DIFFICULTY_CONFIG = {
    easy: {
        challengeThreshold: 0.02,    // Challenge if to_fraction < 0.1%
        randomness: 0.4,              // 40% chance of random choice
        thinkingDelayMs: { min: 1000, max: 2000 },
        preferRareKeys: false
    },
    medium: {
        challengeThreshold: 0.02,     // Challenge if to_fraction < 1%
        randomness: 0.15,             // 15% chance of random choice
        thinkingDelayMs: { min: 800, max: 1500 },
        preferRareKeys: true
    },
    hard: {
        challengeThreshold: 0.02,     // Challenge if to_fraction < 5%
        randomness: 0.05,             // 5% chance of random choice
        thinkingDelayMs: { min: 500, max: 1000 },
        preferRareKeys: true
    }
};

// Top 20 common keys with their top 3 uncommon combination keys
// Data sourced from TagInfo API - these are keys that commonly co-occur
// but are NOT in the top 20 most common keys themselves
const KEY_COMBINATIONS = {
    'building': ['building:levels', 'height', 'start_date'],
    'source': ['source:date', 'start_date', 'wall'],
    'highway': ['oneway', 'maxspeed', 'lanes'],
    'name': ['maxspeed', 'oneway', 'lanes'],
    'surface': ['lanes', 'maxspeed', 'smoothness'],
    'natural': ['leaf_type', 'leaf_cycle', 'water'],
    'landuse': ['crop', 'residential', 'leaf_type'],
    'waterway': ['intermittent', 'tunnel', 'layer'],
    'amenity': ['parking', 'access', 'capacity'],
    'barrier': ['kerb', 'tactile_paving', 'material'],
    'leisure': ['sport', 'access', 'lit'],
    'shop': ['opening_hours', 'brand', 'phone'],
    'tourism': ['information', 'hiking', 'board_type'],
    'railway': ['gauge', 'electrified', 'usage'],
    'sport': ['hoops', 'access', 'lit'],
    'cuisine': ['takeaway', 'diet:vegetarian', 'opening_hours'],
    'religion': ['denomination', 'service_times', 'operator'],
    'historic': ['heritage', 'wikipedia', 'wikidata'],
    'place': ['population', 'is_in', 'wikipedia'],
    'man_made': ['material', 'height', 'operator']
};

// List of common keys (the top 20)
const COMMON_KEYS = Object.keys(KEY_COMBINATIONS);

// Cache for combination data - avoids redundant API calls during a game
// Maps key -> array of combination objects from TagInfo
const combinationCache = new Map();

// Keys known to have many values (frequency rank)
const KEY_FREQUENCY_RANK = {
    'building': 1, 'source': 2, 'highway': 3, 'name': 4, 'surface': 5,
    'natural': 6, 'landuse': 7, 'waterway': 8, 'amenity': 9, 'barrier': 10,
    'leisure': 11, 'shop': 12, 'tourism': 13, 'railway': 14, 'sport': 15,
    'cuisine': 16, 'religion': 17, 'historic': 18, 'place': 19, 'man_made': 20
};

// ============================================
// TagInfo API Functions
// ============================================

/**
 * Fetch tag combinations from TagInfo API
 * @param {string} key - The tag key to get combinations for
 * @returns {Promise<Array>} Array of {other_key, together_count, to_fraction, from_fraction}
 */
async function fetchKeyCombinations(key) {
    const url = `${TAGINFO_BASE_URL}/key/combinations?key=${encodeURIComponent(key)}&rp=50&sortname=together_count&sortorder=desc`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TagInfo API error: ${response.status}`);
    const data = await response.json();
    return data.data || [];
}

/**
 * Fetch common values for a key
 * @param {string} key - The tag key
 * @returns {Promise<Array>} Array of {value, count, fraction}
 */
async function fetchKeyValues(key) {
    const url = `${TAGINFO_BASE_URL}/key/values?key=${encodeURIComponent(key)}&rp=30&sortname=count&sortorder=desc`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TagInfo API error: ${response.status}`);
    const data = await response.json();
    return data.data || [];
}

/**
 * Fetch popular keys (for first move)
 * @returns {Promise<Array>} Array of {key, count_all}
 */
async function fetchPopularKeys() {
    const url = `${TAGINFO_BASE_URL}/keys/all?rp=100&sortname=count_all&sortorder=desc`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TagInfo API error: ${response.status}`);
    const data = await response.json();
    return data.data || [];
}

// ============================================
// Decision Logic
// ============================================

/**
 * Main bot action function - decides whether to add tag or challenge
 * @param {Object} gameState - Current game state
 * @param {Object} botPlayer - The bot player object {name, isBot, difficulty}
 * @returns {Promise<Object>} {action: 'addTag'|'challenge', data?: {key, value}}
 */
export async function decideBotAction(gameState, botPlayer) {
    const config = DIFFICULTY_CONFIG[botPlayer.difficulty] || DIFFICULTY_CONFIG.medium;
    const existingTags = gameState.tags;

    // If no tags yet, bot goes first - pick a starting key
    if (existingTags.length === 0) {
        const firstTag = await pickFirstTag(config);
        return { action: 'addTag', data: firstTag };
    }

    // Check if we should challenge
    const shouldChallenge = await evaluateChallengeDecision(existingTags, config);
    if (shouldChallenge) {
        return { action: 'challenge' };
    }

    // Otherwise, add a tag
    const tagToAdd = await pickNextTag(existingTags, config);
    return { action: 'addTag', data: tagToAdd };
}

/**
 * Pick the first tag when game starts
 * Always use local fallback list for instant response - no API call needed
 */
function pickFirstTag(config) {
    // Use local list for fast first move - no need to hit API
    const index = Math.floor(Math.random() * COMMON_KEYS.length);
    return { key: COMMON_KEYS[index], value: null };
}

/**
 * Pick the next tag to add based on existing tags
 * Uses TagInfo combinations API to find co-occurring keys
 */
async function pickNextTag(existingTags, config) {
    try {
        // Check if any tags need values specified
        const keyOnlyTags = existingTags.filter(t => t.value === null);
        const roll = Math.random();
        console.log(`Bot: ${keyOnlyTags.length} key-only tags, roll=${roll.toFixed(2)} (need >0.15 to specify value)`);
        if (keyOnlyTags.length > 0 && roll > 0.15) {
            // 85% chance to specify a value for existing key-only tag
            console.log(`Bot: Deciding to specify value for "${keyOnlyTags[0].key}"`);
            return await pickValueForKey(keyOnlyTags[0].key, existingTags, config);
        }

        // Find keys that co-occur with existing tags
        const candidates = await findCombinedKeyCandidates(existingTags, config);

        if (candidates.length === 0) {
            // No good candidates - use fallback
            return pickFallbackTag(existingTags, config);
        }

        // Pick from candidates based on difficulty
        return pickFromCandidates(candidates, config);

    } catch (error) {
        console.warn('Bot: TagInfo API error, using fallback:', error);
        return pickFallbackTag(existingTags, config);
    }
}

/**
 * Get combinations for a key, using cache if available
 * @param {string} key - The tag key
 * @returns {Promise<Array>} Combination data from TagInfo
 */
async function getCachedCombinations(key) {
    if (combinationCache.has(key)) {
        console.log(`Bot: Using cached combinations for "${key}"`);
        return combinationCache.get(key);
    }

    console.log(`Bot: Fetching combinations for "${key}"...`);
    const combinations = await fetchKeyCombinations(key);
    combinationCache.set(key, combinations);
    return combinations;
}

/**
 * Clear the combination cache (call when starting a new game)
 */
export function clearCombinationCache() {
    combinationCache.clear();
    console.log('Bot: Combination cache cleared');
}

/**
 * Find keys that commonly co-occur with ALL existing tags
 * Scores candidates based on how well they combine with multiple tags
 */
async function findCombinedKeyCandidates(existingTags, config) {
    const existingKeys = new Set(existingTags.map(t => t.key));

    // Fetch combinations for ALL existing tags (using cache)
    // This gives us a broader view of what keys work well together
    const allCombinationPromises = existingTags.map(tag => getCachedCombinations(tag.key));
    const allCombinationsArrays = await Promise.all(allCombinationPromises);

    // Build a score map: candidate_key -> { totalScore, tagMatches, combinationData }
    const candidateScores = new Map();

    for (let i = 0; i < existingTags.length; i++) {
        const sourceTag = existingTags[i];
        const combinations = allCombinationsArrays[i];

        for (const combo of combinations) {
            // Skip keys already in use
            if (existingKeys.has(combo.other_key)) continue;

            // Skip if co-occurrence is too low
            if (combo.together_count < 10 || combo.to_fraction < 0.001) continue;

            const key = combo.other_key;
            if (!candidateScores.has(key)) {
                candidateScores.set(key, {
                    key,
                    totalScore: 0,
                    tagMatches: 0,
                    minFraction: Infinity,
                    maxFraction: 0,
                    sources: []
                });
            }

            const candidate = candidateScores.get(key);
            candidate.tagMatches++;
            candidate.totalScore += combo.to_fraction;
            candidate.minFraction = Math.min(candidate.minFraction, combo.to_fraction);
            candidate.maxFraction = Math.max(candidate.maxFraction, combo.to_fraction);
            candidate.sources.push({
                sourceKey: sourceTag.key,
                toFraction: combo.to_fraction,
                togetherCount: combo.together_count
            });
        }
    }

    // Convert to array and filter/sort
    let candidates = Array.from(candidateScores.values());

    // Prefer candidates that match multiple existing tags
    // This increases likelihood the combination actually exists
    candidates.sort((a, b) => {
        // First priority: more tag matches is better
        if (b.tagMatches !== a.tagMatches) {
            return b.tagMatches - a.tagMatches;
        }
        // Second priority: depends on difficulty
        if (config.preferRareKeys) {
            // Hard mode: prefer lower minFraction (rarer combinations)
            return a.minFraction - b.minFraction;
        } else {
            // Easy mode: prefer higher totalScore (more common combinations)
            return b.totalScore - a.totalScore;
        }
    });

    // Log what we found for debugging
    if (candidates.length > 0) {
        const top = candidates[0];
        console.log(`Bot: Found ${candidates.length} candidates. Top: "${top.key}" matches ${top.tagMatches}/${existingTags.length} tags`);
    }

    return candidates.slice(0, 20); // Top 20 candidates
}

/**
 * Pick from candidate keys
 */
function pickFromCandidates(candidates, config) {
    // Add randomness based on difficulty
    if (Math.random() < config.randomness) {
        // Random pick from candidates
        const randomCandidate = candidates[Math.floor(Math.random() * candidates.length)];
        console.log(`Bot: Randomly picked "${randomCandidate.key}" (matches ${randomCandidate.tagMatches} tags)`);
        return { key: randomCandidate.key, value: null };
    }

    // Strategic pick - prefer top candidate (most or least common depending on sort)
    const topCandidate = candidates[0];
    console.log(`Bot: Strategically picked "${topCandidate.key}" (matches ${topCandidate.tagMatches} tags, minFraction=${topCandidate.minFraction.toFixed(4)})`);
    return { key: topCandidate.key, value: null };
}

/**
 * Pick a value for a key-only tag
 * Prefers common values to keep game going longer
 */
async function pickValueForKey(key, existingTags, config) {
    try {
        console.log(`Bot: Fetching values for key "${key}"...`);
        const values = await fetchKeyValues(key);
        console.log(`Bot: Got ${values.length} values for "${key}"`);

        if (values.length === 0) {
            // No values found, add a different key instead
            console.log(`Bot: No values found for "${key}", falling back to new key`);
            return pickFallbackTag(existingTags, config);
        }

        // Focus on the most common values (top 5) for safety
        const topValues = values.slice(0, 5);

        // Small chance of randomness - pick from top 10 instead
        if (Math.random() < config.randomness) {
            const extendedPool = values.slice(0, 10);
            const randomValue = extendedPool[Math.floor(Math.random() * extendedPool.length)];
            console.log(`Bot: Randomly picked value "${randomValue.value}" for "${key}"`);
            return { key, value: randomValue.value };
        }

        // Strongly prefer the most common value (index 0 or 1)
        // This keeps tag combinations valid and game interesting
        const pickIndex = Math.random() < 0.7 ? 0 : Math.floor(Math.random() * topValues.length);
        const chosenValue = topValues[pickIndex];
        console.log(`Bot: Picked common value "${chosenValue.value}" for "${key}" (rank ${pickIndex + 1})`);
        return { key, value: chosenValue.value };

    } catch (error) {
        console.warn('Bot: Failed to get values for key, adding new key instead:', error);
        return pickFallbackTag(existingTags, config);
    }
}

/**
 * Fallback tag selection when API fails
 * Strategy: Look for existing common keys and add one of their known combinations
 * If no common keys exist, add a common key at random
 */
function pickFallbackTag(existingTags, config) {
    const existingKeys = new Set(existingTags.map(t => t.key));

    // First, look for existing common keys that have known combinations
    const existingCommonKeys = existingTags
        .map(t => t.key)
        .filter(k => KEY_COMBINATIONS[k]);

    if (existingCommonKeys.length > 0) {
        // Pick a random existing common key and try to add one of its combinations
        const shuffledCommonKeys = [...existingCommonKeys].sort(() => Math.random() - 0.5);

        for (const commonKey of shuffledCommonKeys) {
            const combinations = KEY_COMBINATIONS[commonKey];
            // Find a combination key that isn't already used
            const availableCombos = combinations.filter(k => !existingKeys.has(k));

            if (availableCombos.length > 0) {
                // Pick randomly from available combinations
                const chosenKey = availableCombos[Math.floor(Math.random() * availableCombos.length)];
                console.log(`Bot: Fallback - adding "${chosenKey}" (combines with "${commonKey}")`);
                return { key: chosenKey, value: null };
            }
        }
    }

    // No common keys with available combinations - add a common key
    const availableCommon = COMMON_KEYS.filter(k => !existingKeys.has(k));

    if (availableCommon.length > 0) {
        const chosenKey = availableCommon[Math.floor(Math.random() * availableCommon.length)];
        console.log(`Bot: Fallback - adding common key "${chosenKey}"`);
        return { key: chosenKey, value: null };
    }

    // All common keys used - try combination keys that haven't been used
    const allCombinationKeys = new Set(
        Object.values(KEY_COMBINATIONS).flat()
    );
    const availableCombos = [...allCombinationKeys].filter(k => !existingKeys.has(k));

    if (availableCombos.length > 0) {
        const chosenKey = availableCombos[Math.floor(Math.random() * availableCombos.length)];
        console.log(`Bot: Fallback - adding combination key "${chosenKey}"`);
        return { key: chosenKey, value: null };
    }

    // Last resort - use a rare key
    const rareKeys = ['garden:type', 'diplomatic', 'golf', 'aeroway', 'craft', 'office'];
    const unusedRare = rareKeys.filter(k => !existingKeys.has(k));
    if (unusedRare.length > 0) {
        const chosenKey = unusedRare[Math.floor(Math.random() * unusedRare.length)];
        console.log(`Bot: Fallback - adding rare key "${chosenKey}"`);
        return { key: chosenKey, value: null };
    }

    // Absolute last resort
    console.log(`Bot: Fallback - last resort, adding "description"`);
    return { key: 'description', value: null };
}

// ============================================
// Challenge Decision
// ============================================

/**
 * Evaluate whether bot should challenge
 * Returns true if the combination seems unlikely to exist
 */
async function evaluateChallengeDecision(existingTags, config) {
    // Never challenge on first tag
    if (existingTags.length <= 1) {
        return false;
    }

    // Need at least 2 tags before considering a challenge
    const lastTag = existingTags[existingTags.length - 1];
    const otherTags = existingTags.slice(0, -1);

    try {
        // Get combinations for the last added tag
        const combinations = await fetchKeyCombinations(lastTag.key);

        // Check co-occurrence with each existing tag
        for (const existingTag of otherTags) {
            const combo = combinations.find(c => c.other_key === existingTag.key);

            if (!combo) {
                // Key not found in common combinations - likely rare
                // Higher chance to challenge
                if (Math.random() < 0.5) {
                    return true;
                }
            } else if (combo.to_fraction < config.challengeThreshold) {
                // Co-occurrence below threshold
                // Challenge probability increases with lower fraction
                const challengeProbability = 1 - (combo.to_fraction / config.challengeThreshold);
                if (Math.random() < challengeProbability * 0.7) {
                    return true;
                }
            }
        }

        // With 3+ tags, be somewhat more willing to challenge
        if (existingTags.length >= 3 && Math.random() < 0.1) {
            return true;
        }

        return false;

    } catch (error) {
        console.warn('Bot: Challenge evaluation failed:', error);
        // On API error, don't challenge (play safe)
        return false;
    }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get artificial "thinking" delay for better UX
 * @param {string} difficulty - 'easy' | 'medium' | 'hard'
 * @returns {number} Delay in milliseconds
 */
export function getThinkingDelay(difficulty) {
    const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.medium;
    const { min, max } = config.thinkingDelayMs;
    return Math.random() * (max - min) + min;
}
