/**
 * Test script to compare queue assignments between sorted and unsorted tag orders
 * Run with: node test/compare-sorted-queues.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const POSTPASS_EXPLAIN_ENDPOINT = 'https://postpass.geofabrik.de/api/0.2/explain';

// Same KEY_FREQUENCY_RANK as in postpass.js
const KEY_FREQUENCY_RANK = {
    'building': 1,
    'source': 2,
    'highway': 3,
    'addr:housenumber': 4,
    'addr:street': 5,
    'addr:city': 6,
    'name': 7,
    'addr:postcode': 8,
    'natural': 9,
    'surface': 10,
    'addr:country': 11,
    'landuse': 12,
    'power': 13,
    'waterway': 14,
    'building:levels': 15,
    'amenity': 16,
    'barrier': 17,
    'service': 18,
    'access': 19,
    'oneway': 20,
    'height': 21,
    'ref': 22,
    'maxspeed': 23,
    'lanes': 24,
    'layer': 25,
    'operator': 26,
    'type': 27,
    'lit': 28,
    'crossing': 29,
    'wall': 30,
    'footway': 31,
    'leisure': 32,
    'ele': 33,
    'tracktype': 34,
    'man_made': 35,
    'place': 36,
    'bicycle': 37,
    'foot': 38,
    'railway': 39,
    'bridge': 40,
    'intermittent': 41,
    'shop': 42,
    'smoothness': 43,
    'public_transport': 44,
    'tunnel': 45,
    'material': 46,
    'tactile_paving': 47,
    'water': 48,
    'entrance': 49,
    'bus': 50,
    'direction': 51,
    'sidewalk': 52,
    'opening_hours': 53,
    'parking': 54,
    'website': 55,
    'wikidata': 56,
    'location': 57,
    'width': 58,
    'office': 59,
    'sport': 60,
    'cuisine': 61,
    'tourism': 62,
    'colour': 63,
    'brand': 64,
    'phone': 65,
    'boundary': 66,
    'capacity': 67,
    'fee': 68,
    'denomination': 69,
    'religion': 70,
    'historic': 71,
    'wheelchair': 72,
    'wikipedia': 73,
    'internet_access': 74,
    'shelter': 75,
    'bench': 76,
    'emergency': 77,
    'healthcare': 78,
    'indoor': 79,
    'level': 80,
    'network': 81,
    'route': 82,
    'admin_level': 83,
    'area': 84,
    'golf': 85,
    'aeroway': 86,
    'military': 87,
    'craft': 88,
    'tower:type': 89,
    'attraction': 90,
    'garden:type': 91,
    'covered': 92,
    'incline': 93,
    'designation': 94,
    'seasonal': 95,
    'pump': 96,
    'diplomatic': 97,
    'government': 98,
    'advertising': 99,
    'playground': 100
};

/**
 * Get tag sort count (same logic as postpass.js)
 */
function getTagSortCount(tag) {
    if (tag.key in KEY_FREQUENCY_RANK) {
        const rank = KEY_FREQUENCY_RANK[tag.key];
        return 1_000_000_000 - (rank * 1_000_000);
    }
    return 0;
}

/**
 * Sort tags by frequency (least common first)
 */
function sortTagsForQuery(tags) {
    return [...tags].sort((a, b) => {
        const countA = getTagSortCount(a);
        const countB = getTagSortCount(b);
        return countA - countB;
    });
}

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
 * Build Postpass count query from tags
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
async function getQueueAssignment(query) {
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

        let estimatedRows = null;
        if (data.plan && data.plan[0] && data.plan[0].Plan) {
            const plan = data.plan[0].Plan;
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
 * Format tags for display
 */
function formatTags(tags) {
    return tags.map(t => t.value !== null ? `${t.key}=${t.value}` : t.key).join(' AND ');
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
    console.log('Comparing sorted vs unsorted tag ordering impact on Postpass queue assignment\n');
    console.log('Loading test cases...');
    const testCases = loadTestCases();

    // Filter to only multi-tag cases (sorting only matters with multiple tags)
    const multiTagCases = testCases.filter(tc => tc.tags.length > 1);
    console.log(`Found ${multiTagCases.length} multi-tag test cases\n`);

    const colWidths = { query: 45, unsortedQueue: 10, sortedQueue: 10, diff: 8 };
    const header = [
        pad('Query', colWidths.query),
        pad('Unsorted', colWidths.unsortedQueue),
        pad('Sorted', colWidths.sortedQueue),
        pad('Changed?', colWidths.diff)
    ].join(' | ');

    const separator = '-'.repeat(header.length);

    console.log(separator);
    console.log(header);
    console.log(separator);

    let changedCount = 0;
    const results = [];

    for (const testCase of multiTagCases) {
        const unsortedTags = testCase.tags;
        const sortedTags = sortTagsForQuery(testCase.tags);

        const unsortedQuery = buildPostpassQuery(unsortedTags);
        const sortedQuery = buildPostpassQuery(sortedTags);

        // Skip if order didn't change
        const orderChanged = formatTags(unsortedTags) !== formatTags(sortedTags);

        const unsortedResult = await getQueueAssignment(unsortedQuery);
        await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
        const sortedResult = await getQueueAssignment(sortedQuery);
        await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit

        const queueChanged = unsortedResult.queue !== sortedResult.queue;
        if (queueChanged) changedCount++;

        results.push({
            description: testCase.description,
            unsortedOrder: formatTags(unsortedTags),
            sortedOrder: formatTags(sortedTags),
            orderChanged,
            unsortedQueue: unsortedResult.queue,
            sortedQueue: sortedResult.queue,
            queueChanged,
            unsortedRows: unsortedResult.estimatedRows,
            sortedRows: sortedResult.estimatedRows
        });

        const row = [
            pad(testCase.description, colWidths.query),
            pad(unsortedResult.error || unsortedResult.queue, colWidths.unsortedQueue),
            pad(sortedResult.error || sortedResult.queue, colWidths.sortedQueue),
            pad(queueChanged ? 'YES' : (orderChanged ? 'no' : 'same'), colWidths.diff)
        ].join(' | ');

        console.log(row);
    }

    console.log(separator);
    console.log(`\nQueue changes: ${changedCount}/${multiTagCases.length}\n`);

    // Show detailed info for any cases where queue changed
    const changedCases = results.filter(r => r.queueChanged);
    if (changedCases.length > 0) {
        console.log('CASES WHERE QUEUE CHANGED:');
        console.log(separator);
        for (const r of changedCases) {
            console.log(`Query: ${r.description}`);
            console.log(`  Unsorted: ${r.unsortedOrder}`);
            console.log(`  Sorted:   ${r.sortedOrder}`);
            console.log(`  Queue: ${r.unsortedQueue} -> ${r.sortedQueue}`);
            console.log(`  Est. Rows: ${r.unsortedRows?.toLocaleString() ?? 'N/A'} -> ${r.sortedRows?.toLocaleString() ?? 'N/A'}`);
            console.log();
        }
    }

    // Show order changes even if queue didn't change
    const orderChangedCases = results.filter(r => r.orderChanged && !r.queueChanged);
    if (orderChangedCases.length > 0) {
        console.log('CASES WHERE ORDER CHANGED BUT QUEUE DID NOT:');
        console.log(separator);
        for (const r of orderChangedCases) {
            console.log(`Query: ${r.description}`);
            console.log(`  Unsorted: ${r.unsortedOrder}`);
            console.log(`  Sorted:   ${r.sortedOrder}`);
            console.log(`  Queue: ${r.unsortedQueue} (unchanged)`);
            console.log(`  Est. Rows: ${r.unsortedRows?.toLocaleString() ?? 'N/A'} -> ${r.sortedRows?.toLocaleString() ?? 'N/A'}`);
            console.log();
        }
    }
}

main().catch(console.error);
