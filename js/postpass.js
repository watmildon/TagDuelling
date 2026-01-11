/**
 * Postpass API Module
 * Handles building and executing Postpass (PostgreSQL/PostGIS) queries
 * Alternative to Overpass for counting OSM objects by tags
 */

const POSTPASS_ENDPOINT = 'https://postpass.geofabrik.de/api/0.2/interpreter';
const POSTPASS_EXPLAIN_ENDPOINT = 'https://postpass.geofabrik.de/api/0.2/explain';

/**
 * Custom error class for Postpass query failures
 */
export class PostpassError extends Error {
    /**
     * @param {string} message - Human-readable error message
     * @param {string} type - Error type: 'timeout', 'server_error', 'parse_error', 'network'
     * @param {boolean} retryable - Whether the user should be offered a retry option
     * @param {Object} details - Additional error details for debugging
     */
    constructor(message, type, retryable = true, details = {}) {
        super(message);
        this.name = 'PostpassError';
        this.type = type;
        this.retryable = retryable;
        this.details = details;
    }
}

/**
 * Escape a string for use in SQL
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for SQL
 */
function escapeSqlString(str) {
    // PostgreSQL uses doubled single quotes for escaping
    return str.replace(/'/g, "''");
}

/**
 * Build a WHERE clause condition for a single tag
 * @param {Object} tag - Tag object with key and value
 * @returns {string} SQL condition like "tags ? 'key'" or "tags->>'key' = 'value'"
 */
function buildTagCondition(tag) {
    const escapedKey = escapeSqlString(tag.key);

    if (tag.value !== null) {
        const escapedValue = escapeSqlString(tag.value);
        return `tags->>'${escapedKey}' = '${escapedValue}'`;
    } else {
        // Key exists check using ? operator
        return `tags ? '${escapedKey}'`;
    }
}

/**
 * Build a SQL count query for Postpass
 * Postpass requires a geometry column in the result, so we use ST_Centroid(ST_Collect(geom))
 * to satisfy this requirement while still getting the count
 * @param {Array} tags - Array of {key, value} objects
 * @returns {string} SQL query string
 */
export function buildCountQuery(tags) {
    if (!tags || tags.length === 0) {
        throw new PostpassError(
            'No tags provided for query',
            'invalid_query',
            false,
            {}
        );
    }

    const conditions = tags.map(buildTagCondition);
    const whereClause = conditions.join(' AND ');

    // Use postpass_pointlinepolygon to query all geometry types (nodes, ways, relations)
    // This is equivalent to Overpass "nwr" selector
    // Postpass requires a geometry column - use a dummy point at (0,0) to avoid expensive aggregation
    return `SELECT COUNT(*) as count, ST_SetSRID(ST_MakePoint(0,0), 4326) as geom FROM postpass_pointlinepolygon WHERE ${whereClause}`;
}

/**
 * Execute a Postpass count query and return the count
 * @param {Array} tags - Array of {key, value} objects
 * @returns {Promise<number>} Count of matching objects
 * @throws {PostpassError} On query failure
 */
export async function executeCountQuery(tags) {
    const query = buildCountQuery(tags);

    console.log('Postpass query:', query);

    let response;
    try {
        // Postpass uses 'data' parameter (like Overpass)
        response = await fetch(POSTPASS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `data=${encodeURIComponent(query)}`
        });
    } catch (networkError) {
        console.error('Network error:', networkError);
        throw new PostpassError(
            'Network error: Unable to reach the Postpass server. Please check your internet connection.',
            'network',
            true,
            { originalError: networkError.message }
        );
    }

    // Handle HTTP errors
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('Postpass API error response:', response.status, errorText);

        if (response.status === 504 || response.status === 408) {
            // Gateway timeout - assume many results exist (consistent with Overpass behavior)
            console.log('HTTP timeout detected, assuming many results exist');
            return Infinity;
        }

        if (response.status >= 500) {
            throw new PostpassError(
                'Server error: The Postpass server is experiencing issues. Please try again shortly.',
                'server_error',
                true,
                { status: response.status, body: errorText }
            );
        }

        throw new PostpassError(
            `Query error: The server rejected the query (HTTP ${response.status}). ${errorText}`,
            'invalid_response',
            true,
            { status: response.status, body: errorText }
        );
    }

    // Parse response
    const responseText = await response.text();
    console.log('Postpass response:', responseText);

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (parseError) {
        console.error('Failed to parse Postpass response:', responseText);
        throw new PostpassError(
            'Failed to parse server response. The response was not valid JSON.',
            'parse_error',
            true,
            { parseError: parseError.message, responsePreview: responseText.substring(0, 500) }
        );
    }

    // Postpass returns GeoJSON-like structure with features array for aggregate queries
    // When geojson=false, it returns a simpler structure
    // The count should be in the first row of results

    if (data.error) {
        throw new PostpassError(
            `Query error: ${data.error}`,
            'invalid_response',
            true,
            { error: data.error }
        );
    }

    // Handle different response formats
    // Format 1: { rows: [{ count: 123 }] }
    if (data.rows && Array.isArray(data.rows) && data.rows.length > 0) {
        const count = parseInt(data.rows[0].count, 10);
        if (!isNaN(count)) {
            return count;
        }
    }

    // Format 2: { features: [{ properties: { count: 123 } }] }
    if (data.features && Array.isArray(data.features) && data.features.length > 0) {
        const count = parseInt(data.features[0].properties?.count, 10);
        if (!isNaN(count)) {
            return count;
        }
    }

    // Format 3: Direct array [ { count: 123 } ]
    if (Array.isArray(data) && data.length > 0) {
        const count = parseInt(data[0].count, 10);
        if (!isNaN(count)) {
            return count;
        }
    }

    // If we got here, we couldn't parse the count
    throw new PostpassError(
        'Invalid response: Could not extract count from response.',
        'invalid_response',
        true,
        { responseStructure: JSON.stringify(data).substring(0, 500) }
    );
}

/**
 * Get the Postpass endpoint URL (for display/debugging)
 * @returns {string} The Postpass API endpoint
 */
export function getEndpoint() {
    return POSTPASS_ENDPOINT;
}

/**
 * Get query complexity information from the Postpass /explain endpoint
 * Returns the queue assignment and optionally the full query plan
 * @param {Array} tags - Array of {key, value} objects
 * @returns {Promise<{queue: string, plan: Object|null}>} Queue name and optional plan
 * @throws {PostpassError} On query failure
 */
export async function explainQuery(tags) {
    const query = buildCountQuery(tags);

    let response;
    try {
        response = await fetch(POSTPASS_EXPLAIN_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `data=${encodeURIComponent(query)}`
        });
    } catch (networkError) {
        throw new PostpassError(
            'Network error: Unable to reach the Postpass server.',
            'network',
            true,
            { originalError: networkError.message }
        );
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new PostpassError(
            `Explain endpoint error (HTTP ${response.status}): ${errorText}`,
            'server_error',
            true,
            { status: response.status, body: errorText }
        );
    }

    const data = await response.json();

    return {
        queue: data.queue || 'unknown',
        plan: data.plan || null
    };
}
