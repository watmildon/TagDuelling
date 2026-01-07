/**
 * Bot Test Scaffolding
 * Run bot vs bot games in the console to test difficulty settings
 *
 * Usage: Open browser console on the game page and run:
 *   import('./js/botTest.js').then(t => t.runTests())
 *
 * Or run specific tests:
 *   import('./js/botTest.js').then(t => t.runMatch('easy', 'hard', 10))
 */

import * as bot from './bot.js';

// Simulated game state for testing
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

/**
 * Simulate a single game between two bots
 * @returns {Object} { winner: 0|1, turns: number, tags: array, challengedBy: 0|1, turnLog: array }
 */
async function simulateGame(difficulty1, difficulty2, maxTurns = 50, verbose = false) {
    const state = createTestState(difficulty1, difficulty2);
    let turns = 0;
    const turnLog = []; // Always track turns for logging

    console.log(`\n--- New Game: ${difficulty1} vs ${difficulty2} ---`);

    while (turns < maxTurns) {
        const currentPlayer = state.players[state.currentPlayerIndex];

        try {
            const decision = await bot.decideBotAction(state, currentPlayer);

            if (decision.action === 'challenge') {
                // Determine winner - we can't actually query Overpass, so we'll estimate
                // based on tag count and randomness
                const challengeSuccess = estimateChallengeSuccess(state.tags);
                const previousPlayerIndex = (state.currentPlayerIndex - 1 + 2) % 2;

                const challengeLog = `Turn ${turns + 1}: ${currentPlayer.name} CHALLENGES!`;
                turnLog.push(challengeLog);
                console.log(`  ${challengeLog}`);

                const tagsStr = state.tags.map(t => t.value ? `${t.key}=${t.value}` : t.key).join(', ');
                console.log(`  Final tags: ${tagsStr}`);
                console.log(`  Challenge ${challengeSuccess ? 'SUCCEEDED (no matches found)' : 'FAILED (matches exist)'}`);
                console.log(`  Winner: ${challengeSuccess ? currentPlayer.name : state.players[previousPlayerIndex].name}`);

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

                // Check if specifying value for existing key
                const existingTag = state.tags.find(t => t.key === key && t.value === null);
                if (existingTag && value !== null) {
                    existingTag.value = value;
                    const log = `Turn ${turns + 1}: ${currentPlayer.name} specifies ${key}=${value}`;
                    turnLog.push(log);
                    console.log(`  ${log}`);
                } else if (!state.tags.find(t => t.key === key)) {
                    state.tags.push({ key, value });
                    const log = `Turn ${turns + 1}: ${currentPlayer.name} adds ${value ? `${key}=${value}` : key}`;
                    turnLog.push(log);
                    console.log(`  ${log}`);
                } else {
                    // Key already exists, pick a different one
                    const log = `Turn ${turns + 1}: ${currentPlayer.name} tried duplicate key ${key}, skipping`;
                    turnLog.push(log);
                    console.log(`  ${log}`);
                }

                // Next player
                state.currentPlayerIndex = (state.currentPlayerIndex + 1) % 2;
                turns++;
            }
        } catch (error) {
            console.error(`Error on turn ${turns + 1}:`, error);
            turnLog.push(`Turn ${turns + 1}: ERROR - ${error.message}`);
            break;
        }
    }

    // Max turns reached - shouldn't happen often
    console.log(`  Game reached max turns (${maxTurns})`);
    return {
        winner: -1,
        turns,
        tags: [...state.tags],
        challengedBy: -1,
        challengeSuccess: false,
        turnLog
    };
}

/**
 * Estimate if a challenge would succeed based on tag combination
 * This is a rough heuristic since we can't query Overpass
 */
function estimateChallengeSuccess(tags) {
    // More tags = higher chance of challenge success (fewer matching objects)
    // Base probability increases with tag count
    const baseProb = Math.min(0.1 + (tags.length - 1) * 0.15, 0.8);

    // Tags with specific values are more constraining
    const specifiedCount = tags.filter(t => t.value !== null).length;
    const specifiedBonus = specifiedCount * 0.1;

    const successProb = Math.min(baseProb + specifiedBonus, 0.9);

    return Math.random() < successProb;
}

/**
 * Run multiple games between two difficulty levels
 */
export async function runMatch(difficulty1, difficulty2, numGames = 20, verbose = false) {
    console.log(`\n========================================`);
    console.log(`Running ${numGames} games: ${difficulty1.toUpperCase()} vs ${difficulty2.toUpperCase()}`);
    console.log(`========================================`);

    const results = {
        bot1Wins: 0,
        bot2Wins: 0,
        draws: 0,
        totalTurns: 0,
        avgTurns: 0,
        challengesByBot1: 0,
        challengesByBot2: 0,
        successfulChallenges: 0
    };

    for (let i = 0; i < numGames; i++) {
        if (verbose) {
            console.log(`\nGame ${i + 1}/${numGames}`);
        }

        const result = await simulateGame(difficulty1, difficulty2, 50, verbose);

        if (result.winner === 0) results.bot1Wins++;
        else if (result.winner === 1) results.bot2Wins++;
        else results.draws++;

        results.totalTurns += result.turns;

        if (result.challengedBy === 0) results.challengesByBot1++;
        else if (result.challengedBy === 1) results.challengesByBot2++;

        if (result.challengeSuccess) results.successfulChallenges++;

        // Small delay to not hammer the API
        await new Promise(r => setTimeout(r, 100));
    }

    results.avgTurns = (results.totalTurns / numGames).toFixed(1);

    console.log(`\n--- Results ---`);
    console.log(`${difficulty1.toUpperCase()} wins: ${results.bot1Wins} (${(results.bot1Wins/numGames*100).toFixed(1)}%)`);
    console.log(`${difficulty2.toUpperCase()} wins: ${results.bot2Wins} (${(results.bot2Wins/numGames*100).toFixed(1)}%)`);
    console.log(`Draws/Timeouts: ${results.draws}`);
    console.log(`Average turns per game: ${results.avgTurns}`);
    console.log(`Challenges by ${difficulty1}: ${results.challengesByBot1}`);
    console.log(`Challenges by ${difficulty2}: ${results.challengesByBot2}`);
    console.log(`Successful challenges: ${results.successfulChallenges}/${numGames - results.draws}`);

    return results;
}

/**
 * Run a single verbose game to see the bot logic in action
 */
export async function runSingleGame(difficulty1 = 'medium', difficulty2 = 'medium') {
    return await simulateGame(difficulty1, difficulty2, 50, true);
}

/**
 * Run comprehensive tests across all difficulty matchups
 */
export async function runTests(gamesPerMatchup = 10) {
    console.log('='.repeat(50));
    console.log('BOT DIFFICULTY TEST SUITE');
    console.log('='.repeat(50));

    const difficulties = ['easy', 'medium', 'hard'];
    const allResults = {};

    // Test each matchup
    for (const d1 of difficulties) {
        for (const d2 of difficulties) {
            const key = `${d1}_vs_${d2}`;
            allResults[key] = await runMatch(d1, d2, gamesPerMatchup, false);

            // Delay between matchups
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));

    console.log('\nWin rates (row vs column):');
    console.log('         | Easy   | Medium | Hard');
    console.log('-'.repeat(40));

    for (const d1 of difficulties) {
        let row = `${d1.padEnd(8)} |`;
        for (const d2 of difficulties) {
            const key = `${d1}_vs_${d2}`;
            const winRate = (allResults[key].bot1Wins / gamesPerMatchup * 100).toFixed(0);
            row += ` ${winRate.padStart(4)}%  |`;
        }
        console.log(row);
    }

    console.log('\nExpected: Hard should beat Easy more often');
    console.log('Expected: Higher difficulty = more challenges issued');

    return allResults;
}

/**
 * Quick test - run 3 games of each matchup
 */
export async function quickTest() {
    return await runTests(3);
}

// Export for console use
console.log('Bot Test Module Loaded!');
console.log('Commands:');
console.log('  runTests(10)     - Full test suite with 10 games per matchup');
console.log('  quickTest()      - Quick test with 3 games per matchup');
console.log('  runMatch("easy", "hard", 20) - Run 20 games of specific matchup');
console.log('  runSingleGame("easy", "hard") - Watch one verbose game');
