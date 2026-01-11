/**
 * Test script to check Postpass queue complexity assignments
 * Run with: node test/check-queue-complexity.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const POSTPASS_EXPLAIN_ENDPOINT = 'https://postpass.geofabrik.de/api/0.2/explain';

/**
 * Parse a TSV line into an array of tag objects
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
 */
function loadTestCases() {
    const filePath = join(__dirname, '..', 'testdata', 'tag-combinations.tsv');
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const testCases = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const tags = parseTsvLine(trimmed);
        if (tags.length > 0) {
            const desc = tags.map(t => t.value !== null ? `${t.key}=${t.value}` : t.key).join(' + ');
            testCases.push({ description: desc, tags });
        }
    }

    return testCases;
}

/**
 * Build Postpass count query
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

    return `SELECT COUNT(*) as count, ST_SetSRID(ST_MakePoint(0,0), 4326) as geom FROM postpass_pointlinepolygon WHERE ${conditions.join(' AND ')}`;
}

/**
 * Get queue assignment from explain endpoint
 */
async function getQueueAssignment(tags) {
    const query = buildPostpassQuery(tags);
    const start = performance.now();

    try {
        const response = await fetch(POSTPASS_EXPLAIN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`
        });

        const timeMs = performance.now() - start;

        if (!response.ok) {
            return { queue: 'ERROR', timeMs, error: `HTTP ${response.status}` };
        }

        const data = await response.json();

        // Extract estimated rows from the plan
        // The actual row estimate is in the Append node (child of Aggregate)
        let estimatedRows = null;
        if (data.plan && data.plan[0] && data.plan[0].Plan) {
            const plan = data.plan[0].Plan;
            // Look for Append node which has the actual row estimate
            if (plan.Plans && plan.Plans[0] && plan.Plans[0]['Node Type'] === 'Append') {
                estimatedRows = plan.Plans[0]['Plan Rows'];
            } else {
                estimatedRows = plan['Plan Rows'];
            }
        }

        return {
            queue: data.queue || 'unknown',
            timeMs,
            estimatedRows,
            error: null
        };
    } catch (err) {
        const timeMs = performance.now() - start;
        return { queue: 'ERROR', timeMs, error: err.message };
    }
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

    const colWidths = { query: 50, queue: 10, rows: 15, time: 10 };
    const header = [
        pad('Query', colWidths.query),
        pad('Queue', colWidths.queue),
        pad('Est. Rows', colWidths.rows, 'right'),
        pad('Time', colWidths.time, 'right')
    ].join(' | ');

    const separator = '-'.repeat(header.length);

    console.log(separator);
    console.log(header);
    console.log(separator);

    const queueCounts = {};

    for (const testCase of testCases) {
        const result = await getQueueAssignment(testCase.tags);

        queueCounts[result.queue] = (queueCounts[result.queue] || 0) + 1;

        const timeStr = result.timeMs < 1000 ? `${Math.round(result.timeMs)}ms` : `${(result.timeMs / 1000).toFixed(2)}s`;
        const rowsStr = result.estimatedRows !== null ? result.estimatedRows.toLocaleString() : 'N/A';

        const row = [
            pad(testCase.description, colWidths.query),
            pad(result.error || result.queue, colWidths.queue),
            pad(rowsStr, colWidths.rows, 'right'),
            pad(timeStr, colWidths.time, 'right')
        ].join(' | ');

        console.log(row);

        // Small delay to be nice to the server
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(separator);
    console.log('\nQUEUE DISTRIBUTION');
    console.log(separator);
    for (const [queue, count] of Object.entries(queueCounts).sort()) {
        console.log(`${pad(queue, 10)}: ${count} queries`);
    }
}

main().catch(console.error);
