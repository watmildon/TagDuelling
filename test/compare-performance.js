/**
 * Performance comparison script for Overpass vs Postpass
 * Run with: node test/compare-performance.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API endpoints
const OVERPASS_ENDPOINT = 'https://overpass.private.coffee/api/interpreter';
const POSTPASS_ENDPOINT = 'https://postpass.geofabrik.de/api/0.2/interpreter';
const POSTPASS_EXPLAIN_ENDPOINT = 'https://postpass.geofabrik.de/api/0.2/explain';

// Timeout for individual queries (60 seconds)
const QUERY_TIMEOUT_MS = 60000;

/**
 * Parse a TSV line into an array of tag objects
 * @param {string} line - Tab-separated tags like "key1\tkey2=value"
 * @returns {Array} Array of {key, value} objects
 */
function parseTsvLine(line) {
    const parts = line.split('\t').map(p => p.trim()).filter(p => p);
    return parts.map(part => {
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) {
            return { key: part, value: null };
        }
        return {
            key: part.substring(0, eqIndex),
            value: part.substring(eqIndex + 1)
        };
    });
}

/**
 * Load test cases from TSV file
 * @returns {Array} Array of { description, tags } objects
 */
function loadTestCases() {
    const filePath = join(__dirname, '..', 'testdata', 'tag-combinations.tsv');
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const testCases = [];

    for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const tags = parseTsvLine(trimmed);
        if (tags.length > 0) {
            // Create description from tags
            const desc = tags.map(t => t.value !== null ? `${t.key}=${t.value}` : t.key).join(' + ');
            testCases.push({ description: desc, tags });
        }
    }

    return testCases;
}

/**
 * Build Overpass count query
 * @param {Array} tags - Array of {key, value} objects
 * @returns {string} Overpass QL query
 */
function buildOverpassQuery(tags) {
    const filters = tags.map(tag => {
        if (tag.value !== null) {
            const escapedValue = tag.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return `["${tag.key}"="${escapedValue}"]`;
        }
        return `["${tag.key}"]`;
    }).join('');

    return `[out:json][timeout:60];
nwr${filters};
out count;`;
}

/**
 * Build Postpass count query
 * Postpass requires a geometry column in the result, so we use ST_Centroid(ST_Collect(geom))
 * to satisfy this requirement while still getting the count
 * @param {Array} tags - Array of {key, value} objects
 * @returns {string} SQL query
 */
function buildPostpassQuery(tags) {
    const conditions = tags.map(tag => {
        const escapedKey = tag.key.replace(/'/g, "''");
        if (tag.value !== null) {
            const escapedValue = tag.value.replace(/'/g, "''");
            return `tags->>'${escapedKey}' = '${escapedValue}'`;
        }
        return `tags ? '${escapedKey}'`;
    });

    // Postpass requires a geometry column - use a dummy point at (0,0) to avoid expensive aggregation
    return `SELECT COUNT(*) as count, ST_SetSRID(ST_MakePoint(0,0), 4326) as geom FROM postpass_pointlinepolygon WHERE ${conditions.join(' AND ')}`;
}

/**
 * Execute Overpass query and return count + timing
 * @param {Array} tags - Array of {key, value} objects
 * @returns {Promise<{count: number|string, timeMs: number, error: string|null}>}
 */
async function executeOverpass(tags) {
    const query = buildOverpassQuery(tags);
    const start = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

    try {
        const response = await fetch(OVERPASS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const timeMs = performance.now() - start;

        if (!response.ok) {
            if (response.status === 504 || response.status === 408) {
                return { count: 'timeout', timeMs, error: null };
            }
            return { count: null, timeMs, error: `HTTP ${response.status}` };
        }

        const data = await response.json();

        // Check for timeout in remark
        if (data.remark && data.remark.toLowerCase().includes('timeout')) {
            return { count: 'timeout', timeMs, error: null };
        }

        // Extract count
        if (data.elements?.[0]?.tags?.total !== undefined) {
            return { count: parseInt(data.elements[0].tags.total, 10), timeMs, error: null };
        }

        return { count: 0, timeMs, error: null };
    } catch (err) {
        clearTimeout(timeoutId);
        const timeMs = performance.now() - start;
        if (err.name === 'AbortError') {
            return { count: 'timeout', timeMs: QUERY_TIMEOUT_MS, error: '60s+' };
        }
        return { count: null, timeMs, error: err.message };
    }
}

/**
 * Execute Postpass query and return count + timing
 * @param {Array} tags - Array of {key, value} objects
 * @returns {Promise<{count: number|string, timeMs: number, error: string|null}>}
 */
async function executePostpass(tags) {
    const query = buildPostpassQuery(tags);
    const start = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

    try {
        // Postpass uses 'data' parameter (like Overpass) not 'query'
        const response = await fetch(POSTPASS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const timeMs = performance.now() - start;

        if (!response.ok) {
            if (response.status === 504 || response.status === 408) {
                return { count: 'timeout', timeMs, error: null };
            }
            const text = await response.text();
            return { count: null, timeMs, error: `HTTP ${response.status}: ${text.substring(0, 100)}` };
        }

        const data = await response.json();

        // Handle different response formats
        let count = null;
        if (data.rows?.[0]?.count !== undefined) {
            count = parseInt(data.rows[0].count, 10);
        } else if (data.features?.[0]?.properties?.count !== undefined) {
            count = parseInt(data.features[0].properties.count, 10);
        } else if (Array.isArray(data) && data[0]?.count !== undefined) {
            count = parseInt(data[0].count, 10);
        }

        if (count !== null && !isNaN(count)) {
            return { count, timeMs, error: null };
        }

        return { count: null, timeMs, error: `Unexpected response format: ${JSON.stringify(data).substring(0, 100)}` };
    } catch (err) {
        clearTimeout(timeoutId);
        const timeMs = performance.now() - start;
        if (err.name === 'AbortError') {
            return { count: 'timeout', timeMs: QUERY_TIMEOUT_MS, error: '60s+' };
        }
        return { count: null, timeMs, error: err.message };
    }
}

/**
 * Get queue assignment from Postpass explain endpoint
 * @param {Array} tags - Array of {key, value} objects
 * @returns {Promise<string>} Queue name or 'error'
 */
async function getPostpassQueue(tags) {
    const query = buildPostpassQuery(tags);
    try {
        const response = await fetch(POSTPASS_EXPLAIN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`
        });
        if (!response.ok) return 'error';
        const data = await response.json();
        return data.queue || 'unknown';
    } catch {
        return 'error';
    }
}

/**
 * Format count for display
 */
function formatCount(count) {
    if (count === null) return 'ERROR';
    if (count === 'timeout') return 'TIMEOUT';
    if (typeof count === 'number') return count.toLocaleString();
    return String(count);
}

/**
 * Format time for display
 */
function formatTime(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Check if counts match
 */
function countsMatch(a, b) {
    // Both timeout = match
    if (a === 'timeout' && b === 'timeout') return true;
    // One timeout, one very high count = close enough
    if (a === 'timeout' && typeof b === 'number' && b > 100000) return true;
    if (b === 'timeout' && typeof a === 'number' && a > 100000) return true;
    // Both numbers = must match exactly
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    // Otherwise no match
    return false;
}

/**
 * Pad string to length
 */
function pad(str, len, align = 'left') {
    const s = String(str);
    if (s.length >= len) return s.substring(0, len);
    const padding = ' '.repeat(len - s.length);
    return align === 'right' ? padding + s : s + padding;
}

/**
 * Main test runner
 */
async function main() {
    console.log('Loading test cases...');
    const testCases = loadTestCases();
    console.log(`Found ${testCases.length} test cases\n`);

    // Print header
    const colWidths = { query: 45, queue: 8, overpassTime: 10, postpassTime: 10, overpassCount: 12, postpassCount: 12, match: 6 };
    const header = [
        pad('Query', colWidths.query),
        pad('Queue', colWidths.queue),
        pad('Overpass', colWidths.overpassTime, 'right'),
        pad('Postpass', colWidths.postpassTime, 'right'),
        pad('OP Count', colWidths.overpassCount, 'right'),
        pad('PP Count', colWidths.postpassCount, 'right'),
        pad('Match', colWidths.match)
    ].join(' | ');

    const separator = '-'.repeat(header.length);

    console.log(separator);
    console.log(header);
    console.log(separator);

    const results = [];

    for (const testCase of testCases) {
        // Get queue assignment first (fast), then run queries in parallel
        const queue = await getPostpassQueue(testCase.tags);

        const [overpassResult, postpassResult] = await Promise.all([
            executeOverpass(testCase.tags),
            executePostpass(testCase.tags)
        ]);

        const match = countsMatch(overpassResult.count, postpassResult.count);

        const row = [
            pad(testCase.description, colWidths.query),
            pad(queue, colWidths.queue),
            pad(overpassResult.error || formatTime(overpassResult.timeMs), colWidths.overpassTime, 'right'),
            pad(postpassResult.error || formatTime(postpassResult.timeMs), colWidths.postpassTime, 'right'),
            pad(formatCount(overpassResult.count), colWidths.overpassCount, 'right'),
            pad(formatCount(postpassResult.count), colWidths.postpassCount, 'right'),
            pad(match ? 'YES' : 'NO', colWidths.match)
        ].join(' | ');

        console.log(row);

        results.push({
            query: testCase.description,
            queue,
            overpass: overpassResult,
            postpass: postpassResult,
            match
        });

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(separator);

    // Print summary
    const successful = results.filter(r => r.overpass.count !== null && r.postpass.count !== null);
    const matching = results.filter(r => r.match);
    const overpassFaster = successful.filter(r => r.overpass.timeMs < r.postpass.timeMs);
    const postpassFaster = successful.filter(r => r.postpass.timeMs < r.overpass.timeMs);

    const avgOverpass = successful.length > 0
        ? successful.reduce((sum, r) => sum + r.overpass.timeMs, 0) / successful.length
        : 0;
    const avgPostpass = successful.length > 0
        ? successful.reduce((sum, r) => sum + r.postpass.timeMs, 0) / successful.length
        : 0;

    console.log('\nSUMMARY');
    console.log(separator);
    console.log(`Total test cases: ${results.length}`);
    console.log(`Successful (both returned results): ${successful.length}`);
    console.log(`Matching counts: ${matching.length}/${results.length}`);
    console.log(`Overpass faster: ${overpassFaster.length}`);
    console.log(`Postpass faster: ${postpassFaster.length}`);
    console.log(`Average Overpass time: ${formatTime(avgOverpass)}`);
    console.log(`Average Postpass time: ${formatTime(avgPostpass)}`);

    if (avgPostpass < avgOverpass) {
        const speedup = ((avgOverpass - avgPostpass) / avgOverpass * 100).toFixed(1);
        console.log(`\nPostpass is ${speedup}% faster on average`);
    } else if (avgOverpass < avgPostpass) {
        const speedup = ((avgPostpass - avgOverpass) / avgPostpass * 100).toFixed(1);
        console.log(`\nOverpass is ${speedup}% faster on average`);
    }
}

main().catch(console.error);
