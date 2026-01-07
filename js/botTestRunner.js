/**
 * Node.js Bot Test Runner
 * Runs bot vs bot games in the console without needing a browser
 *
 * Usage: node js/botTestRunner.js
 */

const TAGINFO_BASE_URL = 'https://taginfo.openstreetmap.org/api/4';
const OVERPASS_ENDPOINT = 'https://overpass.private.coffee/api/interpreter';

// Difficulty configurations (copied from bot.js)
const DIFFICULTY_CONFIG = {
    easy: {
        challengeThreshold: 0.001,
        randomness: 0.4,
        thinkingDelayMs: { min: 1000, max: 2000 },
        preferRareKeys: false
    },
    medium: {
        challengeThreshold: 0.01,
        randomness: 0.15,
        thinkingDelayMs: { min: 800, max: 1500 },
        preferRareKeys: true
    },
    hard: {
        challengeThreshold: 0.05,
        randomness: 0.05,
        thinkingDelayMs: { min: 500, max: 1000 },
        preferRareKeys: true
    }
};

// Top 20 common keys with their top 3 uncommon combination keys
// Data sourced from TagInfo API
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

const COMMON_KEYS = Object.keys(KEY_COMBINATIONS);

// ============================================
// TagInfo API Functions
// ============================================

async function fetchKeyCombinations(key) {
    const url = `${TAGINFO_BASE_URL}/key/combinations?key=${encodeURIComponent(key)}&rp=50&sortname=together_count&sortorder=desc`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TagInfo API error: ${response.status}`);
    const data = await response.json();
    return data.data || [];
}

async function fetchKeyValues(key) {
    const url = `${TAGINFO_BASE_URL}/key/values?key=${encodeURIComponent(key)}&rp=30&sortname=count&sortorder=desc`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TagInfo API error: ${response.status}`);
    const data = await response.json();
    return data.data || [];
}

// ============================================
// Bot Decision Logic (copied from bot.js)
// ============================================

async function decideBotAction(gameState, botPlayer) {
    const config = DIFFICULTY_CONFIG[botPlayer.difficulty] || DIFFICULTY_CONFIG.medium;
    const existingTags = gameState.tags;

    if (existingTags.length === 0) {
        const firstTag = pickFirstTag(config);
        return { action: 'addTag', data: firstTag };
    }

    const shouldChallenge = await evaluateChallengeDecision(existingTags, config);
    if (shouldChallenge) {
        return { action: 'challenge' };
    }

    const tagToAdd = await pickNextTag(existingTags, config);
    return { action: 'addTag', data: tagToAdd };
}

function pickFirstTag(config) {
    const index = Math.floor(Math.random() * COMMON_KEYS.length);
    return { key: COMMON_KEYS[index], value: null };
}

async function pickNextTag(existingTags, config) {
    try {
        const keyOnlyTags = existingTags.filter(t => t.value === null);
        const roll = Math.random();
        console.log(`    [Bot Logic] ${keyOnlyTags.length} key-only tags, roll=${roll.toFixed(2)} (need >0.3 to specify value)`);

        if (keyOnlyTags.length > 0 && roll > 0.3) {
            console.log(`    [Bot Logic] Deciding to specify value for "${keyOnlyTags[0].key}"`);
            return await pickValueForKey(keyOnlyTags[0].key, existingTags, config);
        }

        const candidates = await findCombinedKeyCandidates(existingTags, config);

        if (candidates.length === 0) {
            return pickFallbackTag(existingTags, config);
        }

        return pickFromCandidates(candidates, config);

    } catch (error) {
        console.warn('    [Bot Logic] TagInfo API error, using fallback:', error.message);
        return pickFallbackTag(existingTags, config);
    }
}

async function findCombinedKeyCandidates(existingTags, config) {
    const mostRecent = existingTags[existingTags.length - 1];
    const combinations = await fetchKeyCombinations(mostRecent.key);

    const existingKeys = new Set(existingTags.map(t => t.key));
    const candidates = combinations.filter(c =>
        !existingKeys.has(c.other_key) &&
        c.together_count > 10 &&
        c.to_fraction > 0.001
    );

    if (config.preferRareKeys) {
        candidates.sort((a, b) => a.to_fraction - b.to_fraction);
    }

    return candidates.slice(0, 20);
}

function pickFromCandidates(candidates, config) {
    if (Math.random() < config.randomness) {
        const randomCandidate = candidates[Math.floor(Math.random() * candidates.length)];
        return { key: randomCandidate.other_key, value: null };
    }

    const topCandidate = candidates[0];
    return { key: topCandidate.other_key, value: null };
}

async function pickValueForKey(key, existingTags, config) {
    try {
        console.log(`    [Bot Logic] Fetching values for key "${key}"...`);
        const values = await fetchKeyValues(key);
        console.log(`    [Bot Logic] Got ${values.length} values for "${key}"`);

        if (values.length === 0) {
            console.log(`    [Bot Logic] No values found for "${key}", falling back to new key`);
            return pickFallbackTag(existingTags, config);
        }

        const poolSize = config.preferRareKeys ? 20 : 10;
        const pool = values.slice(0, poolSize);

        if (Math.random() < config.randomness) {
            const randomValue = pool[Math.floor(Math.random() * pool.length)];
            console.log(`    [Bot Logic] Randomly picked value "${randomValue.value}" for "${key}"`);
            return { key, value: randomValue.value };
        }

        const goodValue = pool.find(v => v.count > 1000) || pool[0];
        console.log(`    [Bot Logic] Strategically picked value "${goodValue.value}" for "${key}"`);
        return { key, value: goodValue.value };

    } catch (error) {
        console.warn('    [Bot Logic] Failed to get values for key:', error.message);
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
                console.log(`    [Bot Logic] Fallback - adding "${chosenKey}" (combines with "${commonKey}")`);
                return { key: chosenKey, value: null };
            }
        }
    }

    // No common keys with available combinations - add a common key
    const availableCommon = COMMON_KEYS.filter(k => !existingKeys.has(k));

    if (availableCommon.length > 0) {
        const chosenKey = availableCommon[Math.floor(Math.random() * availableCommon.length)];
        console.log(`    [Bot Logic] Fallback - adding common key "${chosenKey}"`);
        return { key: chosenKey, value: null };
    }

    // All common keys used - try combination keys that haven't been used
    const allCombinationKeys = new Set(
        Object.values(KEY_COMBINATIONS).flat()
    );
    const availableCombos = [...allCombinationKeys].filter(k => !existingKeys.has(k));

    if (availableCombos.length > 0) {
        const chosenKey = availableCombos[Math.floor(Math.random() * availableCombos.length)];
        console.log(`    [Bot Logic] Fallback - adding combination key "${chosenKey}"`);
        return { key: chosenKey, value: null };
    }

    // Last resort - use a rare key
    const rareKeys = ['garden:type', 'diplomatic', 'golf', 'aeroway', 'craft', 'office'];
    const unusedRare = rareKeys.filter(k => !existingKeys.has(k));
    if (unusedRare.length > 0) {
        const chosenKey = unusedRare[Math.floor(Math.random() * unusedRare.length)];
        console.log(`    [Bot Logic] Fallback - adding rare key "${chosenKey}"`);
        return { key: chosenKey, value: null };
    }

    // Absolute last resort
    console.log(`    [Bot Logic] Fallback - last resort, adding "description"`);
    return { key: 'description', value: null };
}

async function evaluateChallengeDecision(existingTags, config) {
    if (existingTags.length <= 1) {
        return false;
    }

    const lastTag = existingTags[existingTags.length - 1];
    const otherTags = existingTags.slice(0, -1);

    try {
        const combinations = await fetchKeyCombinations(lastTag.key);

        for (const existingTag of otherTags) {
            const combo = combinations.find(c => c.other_key === existingTag.key);

            if (!combo) {
                if (Math.random() < 0.5) {
                    console.log(`    [Challenge] Key "${existingTag.key}" not found in combinations for "${lastTag.key}" - challenging!`);
                    return true;
                }
            } else if (combo.to_fraction < config.challengeThreshold) {
                const challengeProbability = 1 - (combo.to_fraction / config.challengeThreshold);
                if (Math.random() < challengeProbability * 0.7) {
                    console.log(`    [Challenge] Low co-occurrence ${(combo.to_fraction * 100).toFixed(3)}% for "${existingTag.key}" + "${lastTag.key}" - challenging!`);
                    return true;
                }
            }
        }

        if (existingTags.length >= 3 && Math.random() < 0.1) {
            console.log(`    [Challenge] 3+ tags, random challenge trigger`);
            return true;
        }

        return false;

    } catch (error) {
        console.warn('    [Challenge] Evaluation failed:', error.message);
        return false;
    }
}

// ============================================
// Test Scaffolding
// ============================================

// Common keys sorted by frequency for query optimization
const KEY_FREQUENCY_RANK = {
    'building': 1, 'source': 2, 'highway': 3, 'addr:housenumber': 4,
    'addr:street': 5, 'addr:city': 6, 'name': 7, 'addr:postcode': 8,
    'natural': 9, 'surface': 10, 'landuse': 12, 'waterway': 14,
    'amenity': 16, 'barrier': 17, 'leisure': 32, 'railway': 39,
    'shop': 42, 'sport': 60, 'cuisine': 61, 'tourism': 62
};

/**
 * Sort tags for optimal Overpass query performance
 */
function sortTagsForQuery(tags) {
    return [...tags].sort((a, b) => {
        const aIsCommon = a.key in KEY_FREQUENCY_RANK;
        const bIsCommon = b.key in KEY_FREQUENCY_RANK;
        const aHasValue = a.value !== null;
        const bHasValue = b.value !== null;

        const getGroup = (isCommon, hasValue) => {
            if (!isCommon && hasValue) return 1;
            if (!isCommon && !hasValue) return 2;
            if (isCommon && hasValue) return 3;
            return 4;
        };

        const groupA = getGroup(aIsCommon, aHasValue);
        const groupB = getGroup(bIsCommon, bHasValue);

        if (groupA !== groupB) return groupA - groupB;
        if (groupA === 4) {
            return (KEY_FREQUENCY_RANK[b.key] || 999) - (KEY_FREQUENCY_RANK[a.key] || 999);
        }
        return 0;
    });
}

/**
 * Build an Overpass QL count query
 */
function buildCountQuery(tags) {
    const sortedTags = sortTagsForQuery(tags);
    const tagFilters = sortedTags.map(tag => {
        if (tag.value !== null) {
            const escapedValue = tag.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return `["${tag.key}"="${escapedValue}"]`;
        } else {
            return `["${tag.key}"]`;
        }
    }).join('');

    return `[out:json][timeout:10];
(
  nwr${tagFilters};
);
out count;`;
}

/**
 * Execute Overpass query and return count of matching objects
 */
async function executeOverpassCount(tags) {
    const query = buildCountQuery(tags);
    const tagsStr = tags.map(t => t.value ? `${t.key}=${t.value}` : t.key).join(', ');

    console.log(`    [Overpass] Querying for: [${tagsStr}]`);

    try {
        const response = await fetch(OVERPASS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`
        });

        if (!response.ok) {
            console.log(`    [Overpass] API error: ${response.status}`);
            // On error, assume objects exist (conservative)
            return -1;
        }

        const data = await response.json();

        // Check for timeout - assume many results exist
        if (data.remark && data.remark.includes('timeout')) {
            console.log(`    [Overpass] Query timed out - assuming many results exist`);
            return Infinity;
        }

        // Extract count from response
        if (data.elements && data.elements.length > 0 && data.elements[0].tags) {
            const count = parseInt(data.elements[0].tags.total, 10) || 0;
            console.log(`    [Overpass] Found ${count} matching objects`);
            return count;
        }

        console.log(`    [Overpass] Found 0 matching objects`);
        return 0;
    } catch (error) {
        console.log(`    [Overpass] Error: ${error.message}`);
        return -1; // Error case - assume objects exist
    }
}

/**
 * Determine challenge success by querying Overpass
 * Returns true if challenge succeeds (no matching objects found)
 */
async function determineChallengeSuccess(tags) {
    const count = await executeOverpassCount(tags);

    if (count === -1) {
        // On error, randomly decide (50/50)
        console.log(`    [Challenge] API error - using random fallback`);
        return Math.random() < 0.5;
    }

    // Challenge succeeds if count is 0 (no matching objects)
    return count === 0;
}

function createTestState(difficulty1, difficulty2) {
    return {
        players: [
            { name: `Bot1 (${difficulty1})`, isBot: true, difficulty: difficulty1 },
            { name: `Bot2 (${difficulty2})`, isBot: true, difficulty: difficulty2 }
        ],
        currentPlayerIndex: 0,
        tags: [],
        region: null,
        gamePhase: 'playing'
    };
}

async function simulateGame(difficulty1, difficulty2, maxTurns = 50) {
    const state = createTestState(difficulty1, difficulty2);
    let turns = 0;
    const turnLog = [];

    console.log(`\n${'='.repeat(60)}`);
    console.log(`NEW GAME: ${difficulty1.toUpperCase()} vs ${difficulty2.toUpperCase()}`);
    console.log(`${'='.repeat(60)}`);

    while (turns < maxTurns) {
        const currentPlayer = state.players[state.currentPlayerIndex];

        try {
            console.log(`\n  [Turn ${turns + 1}] ${currentPlayer.name}'s turn...`);
            const decision = await decideBotAction(state, currentPlayer);

            if (decision.action === 'challenge') {
                const previousPlayerIndex = (state.currentPlayerIndex - 1 + 2) % 2;

                const log = `Turn ${turns + 1}: ${currentPlayer.name} CHALLENGES!`;
                turnLog.push(log);
                console.log(`  >>> ${currentPlayer.name} CHALLENGES! <<<`);

                const tagsStr = state.tags.map(t => t.value ? `${t.key}=${t.value}` : t.key).join(', ');
                console.log(`  Final tags: [${tagsStr}]`);

                // Query Overpass to determine challenge success
                const challengeSuccess = await determineChallengeSuccess(state.tags);
                console.log(`  Challenge result: ${challengeSuccess ? 'SUCCEEDED (no matches found)' : 'FAILED (matches exist)'}`);

                const winner = challengeSuccess ? currentPlayer : state.players[previousPlayerIndex];
                console.log(`  WINNER: ${winner.name}`);

                return {
                    winner: challengeSuccess ? state.currentPlayerIndex : previousPlayerIndex,
                    turns: turns + 1,
                    tags: [...state.tags],
                    challengedBy: state.currentPlayerIndex,
                    challengeSuccess,
                    turnLog
                };
            } else if (decision.action === 'addTag') {
                const { key, value } = decision.data;

                const existingTag = state.tags.find(t => t.key === key && t.value === null);
                if (existingTag && value !== null) {
                    existingTag.value = value;
                    const log = `Turn ${turns + 1}: ${currentPlayer.name} specifies ${key}=${value}`;
                    turnLog.push(log);
                    console.log(`  ACTION: Specifies value -> ${key}=${value}`);
                } else if (!state.tags.find(t => t.key === key)) {
                    state.tags.push({ key, value });
                    const log = `Turn ${turns + 1}: ${currentPlayer.name} adds ${value ? `${key}=${value}` : key}`;
                    turnLog.push(log);
                    console.log(`  ACTION: Adds tag -> ${value ? `${key}=${value}` : key}`);
                } else {
                    const log = `Turn ${turns + 1}: ${currentPlayer.name} tried duplicate key ${key}, skipping`;
                    turnLog.push(log);
                    console.log(`  ACTION: Tried duplicate key "${key}", skipping`);
                }

                const currentTags = state.tags.map(t => t.value ? `${t.key}=${t.value}` : t.key).join(', ');
                console.log(`  Current tags: [${currentTags}]`);

                state.currentPlayerIndex = (state.currentPlayerIndex + 1) % 2;
                turns++;
            }
        } catch (error) {
            console.error(`  ERROR on turn ${turns + 1}:`, error.message);
            turnLog.push(`Turn ${turns + 1}: ERROR - ${error.message}`);
            break;
        }
    }

    console.log(`\n  Game reached max turns (${maxTurns}) - DRAW`);
    return {
        winner: -1,
        turns,
        tags: [...state.tags],
        challengedBy: -1,
        challengeSuccess: false,
        turnLog
    };
}

async function runMatch(difficulty1, difficulty2, numGames = 5) {
    console.log(`\n${'#'.repeat(70)}`);
    console.log(`MATCH: ${difficulty1.toUpperCase()} vs ${difficulty2.toUpperCase()} (${numGames} games)`);
    console.log(`${'#'.repeat(70)}`);

    const results = {
        bot1Wins: 0,
        bot2Wins: 0,
        draws: 0,
        totalTurns: 0,
        challengesByBot1: 0,
        challengesByBot2: 0,
        successfulChallenges: 0,
        games: []
    };

    for (let i = 0; i < numGames; i++) {
        console.log(`\n>>> Starting game ${i + 1}/${numGames}...`);

        const result = await simulateGame(difficulty1, difficulty2, 50);
        results.games.push(result);

        if (result.winner === 0) results.bot1Wins++;
        else if (result.winner === 1) results.bot2Wins++;
        else results.draws++;

        results.totalTurns += result.turns;

        if (result.challengedBy === 0) results.challengesByBot1++;
        else if (result.challengedBy === 1) results.challengesByBot2++;

        if (result.challengeSuccess) results.successfulChallenges++;

        // Delay between games to avoid rate limiting Overpass
        console.log(`\n  [Waiting 2s before next game to avoid rate limiting...]`);
        await new Promise(r => setTimeout(r, 2000));
    }

    results.avgTurns = (results.totalTurns / numGames).toFixed(1);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`MATCH RESULTS: ${difficulty1.toUpperCase()} vs ${difficulty2.toUpperCase()}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`${difficulty1.toUpperCase()} wins: ${results.bot1Wins}/${numGames} (${(results.bot1Wins/numGames*100).toFixed(1)}%)`);
    console.log(`${difficulty2.toUpperCase()} wins: ${results.bot2Wins}/${numGames} (${(results.bot2Wins/numGames*100).toFixed(1)}%)`);
    console.log(`Draws/Timeouts: ${results.draws}`);
    console.log(`Average turns per game: ${results.avgTurns}`);
    console.log(`Challenges by ${difficulty1}: ${results.challengesByBot1}`);
    console.log(`Challenges by ${difficulty2}: ${results.challengesByBot2}`);
    console.log(`Successful challenges: ${results.successfulChallenges}/${numGames - results.draws}`);

    return results;
}

async function runTests(gamesPerMatchup = 3) {
    console.log('='.repeat(70));
    console.log('BOT DIFFICULTY TEST SUITE');
    console.log(`Running ${gamesPerMatchup} games per matchup`);
    console.log('='.repeat(70));

    const difficulties = ['easy', 'medium', 'hard'];
    const allResults = {};

    for (const d1 of difficulties) {
        for (const d2 of difficulties) {
            const key = `${d1}_vs_${d2}`;
            allResults[key] = await runMatch(d1, d2, gamesPerMatchup);
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(70));

    console.log('\nWin rates (row vs column):');
    console.log('         | Easy   | Medium | Hard');
    console.log('-'.repeat(45));

    for (const d1 of difficulties) {
        let row = `${d1.padEnd(8)} |`;
        for (const d2 of difficulties) {
            const key = `${d1}_vs_${d2}`;
            const winRate = (allResults[key].bot1Wins / gamesPerMatchup * 100).toFixed(0);
            row += ` ${winRate.padStart(4)}%  |`;
        }
        console.log(row);
    }

    console.log('\nExpected behavior:');
    console.log('- Hard should beat Easy more often');
    console.log('- Higher difficulty = more strategic challenges');
    console.log('- Same difficulty = ~50% win rate');

    return allResults;
}

// Main execution
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--quick') || args.includes('-q')) {
        // Quick test: 2 games per matchup
        await runTests(2);
    } else if (args.includes('--single') || args.includes('-s')) {
        // Single game between medium bots
        const d1 = args[args.indexOf('--single') + 1] || args[args.indexOf('-s') + 1] || 'medium';
        const d2 = args[args.indexOf('--single') + 2] || args[args.indexOf('-s') + 2] || 'medium';
        await simulateGame(d1, d2, 50);
    } else if (args.includes('--match') || args.includes('-m')) {
        // Run a specific match
        const idx = args.indexOf('--match') !== -1 ? args.indexOf('--match') : args.indexOf('-m');
        const d1 = args[idx + 1] || 'easy';
        const d2 = args[idx + 2] || 'hard';
        const numGames = parseInt(args[idx + 3]) || 5;
        await runMatch(d1, d2, numGames);
    } else if (args.includes('--full') || args.includes('-f')) {
        // Full test: 20 games per matchup (as originally requested)
        await runTests(20);
    } else if (args.length > 0 && !isNaN(parseInt(args[0]))) {
        // Custom game count: node botTestRunner.js 10
        await runTests(parseInt(args[0]));
    } else {
        // Default: run full test suite with 3 games per matchup
        await runTests(3);
    }
}

main().catch(console.error);
