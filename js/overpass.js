/**
 * Overpass API Module
 * Handles building and executing Overpass queries
 */

const OVERPASS_ENDPOINT = 'https://overpass.private.coffee/api/interpreter';
const OVERPASS_ULTRA_URL = 'https://overpass-ultra.us';

/**
 * Custom error class for Overpass query failures
 * Distinguishes between retryable errors (timeouts, server issues) and permanent failures
 */
export class OverpassError extends Error {
    /**
     * @param {string} message - Human-readable error message
     * @param {string} type - Error type: 'timeout', 'server_error', 'rate_limit', 'parse_error', 'invalid_response', 'network'
     * @param {boolean} retryable - Whether the user should be offered a retry option
     * @param {Object} details - Additional error details for debugging
     */
    constructor(message, type, retryable = true, details = {}) {
        super(message);
        this.name = 'OverpassError';
        this.type = type;
        this.retryable = retryable;
        this.details = details;
    }
}

// Common keys sorted by frequency (most common first)
// Queries run faster when most common keys are at the end of the filter list
// Source: https://taginfo.openstreetmap.org/keys
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

// Taginfo API for fetching actual tag usage counts
// Note: These are global OSM counts, used even in regional game modes.
// Regional tag prevalence would require Overpass queries which are too slow for prefetching.
const TAGINFO_API = 'https://taginfo.openstreetmap.org/api/4';
const TAGINFO_CACHE_KEY = 'tag-duelling-taginfo-cache';
const TAGINFO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Check if localStorage is available
 * @returns {boolean}
 */
function isLocalStorageAvailable() {
    try {
        const test = '__localStorage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch (e) {
        return false;
    }
}

// In-memory cache for current session (loaded from localStorage on init)
let taginfoCache = loadTaginfoCache();

/**
 * Load taginfo cache from localStorage
 * @returns {Map} Cache map with tag keys and {count, timestamp} values
 */
function loadTaginfoCache() {
    if (!isLocalStorageAvailable()) {
        return new Map();
    }

    try {
        const stored = localStorage.getItem(TAGINFO_CACHE_KEY);
        if (!stored) return new Map();

        const parsed = JSON.parse(stored);
        const now = Date.now();
        const cache = new Map();

        // Only load entries that haven't expired
        for (const [key, entry] of Object.entries(parsed)) {
            if (now - entry.timestamp < TAGINFO_CACHE_TTL) {
                cache.set(key, entry);
            }
        }

        return cache;
    } catch (error) {
        console.warn('Failed to load taginfo cache:', error);
        return new Map();
    }
}

/**
 * Save taginfo cache to localStorage
 */
function saveTaginfoCache() {
    if (!isLocalStorageAvailable()) {
        return;
    }

    try {
        const obj = Object.fromEntries(taginfoCache);
        localStorage.setItem(TAGINFO_CACHE_KEY, JSON.stringify(obj));
    } catch (error) {
        console.warn('Failed to save taginfo cache:', error);
    }
}

/**
 * Get the cache key for a tag
 * @param {string} key - Tag key
 * @param {string|null} value - Tag value or null for key-only
 * @returns {string} Cache key
 */
function getTagCacheKey(key, value) {
    return value !== null ? `${key}=${value}` : key;
}

/**
 * Get cached count for a tag if available and not expired
 * @param {string} key - Tag key
 * @param {string|null} value - Tag value or null
 * @returns {number|null} Cached count or null if not cached/expired
 */
function getCachedTagCount(key, value) {
    const cacheKey = getTagCacheKey(key, value);
    const entry = taginfoCache.get(cacheKey);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp >= TAGINFO_CACHE_TTL) {
        taginfoCache.delete(cacheKey);
        return null;
    }

    return entry.count;
}

/**
 * Fetch tag count from taginfo API
 * @param {string} key - Tag key
 * @param {string|null} value - Tag value or null for key-only
 * @returns {Promise<number|null>} Count or null on failure
 */
async function fetchTagCount(key, value) {
    const endpoint = value !== null
        ? `${TAGINFO_API}/tag/stats?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`
        : `${TAGINFO_API}/key/stats?key=${encodeURIComponent(key)}`;

    try {
        const response = await fetch(endpoint);
        if (!response.ok) {
            console.warn(`Taginfo API error for ${key}=${value}:`, response.status);
            return null;
        }

        const data = await response.json();
        const allStats = data.data?.find(d => d.type === 'all');
        return allStats ? allStats.count : 0;
    } catch (error) {
        console.warn(`Taginfo fetch failed for ${key}=${value}:`, error);
        return null;
    }
}

/**
 * Prefetch tag count in the background and cache it
 * Call this when a tag is added to the game
 * @param {string} key - Tag key
 * @param {string|null} value - Tag value or null for key-only
 */
export async function prefetchTagCount(key, value) {
    const cacheKey = getTagCacheKey(key, value);

    // Skip if already cached and not expired
    if (getCachedTagCount(key, value) !== null) {
        console.log(`Taginfo cache hit for ${cacheKey}`);
        return;
    }

    console.log(`Prefetching taginfo for ${cacheKey}...`);
    const count = await fetchTagCount(key, value);

    if (count !== null) {
        taginfoCache.set(cacheKey, {
            count,
            timestamp: Date.now()
        });
        saveTaginfoCache();
        console.log(`Taginfo cached: ${cacheKey} = ${count}`);
    }
}

/**
 * Get the usage count for sorting purposes
 * Uses taginfo cache if available, falls back to static KEY_FREQUENCY_RANK
 * @param {Object} tag - Tag object with key and value
 * @returns {number} Usage count (lower = less common = should come first)
 */
function getTagSortCount(tag) {
    // First check taginfo cache for exact count
    const cachedCount = getCachedTagCount(tag.key, tag.value);
    if (cachedCount !== null) {
        return cachedCount;
    }

    // Fall back to static key frequency rank
    // Convert rank to a large count estimate (rank 1 = most common = highest count)
    if (tag.key in KEY_FREQUENCY_RANK) {
        const rank = KEY_FREQUENCY_RANK[tag.key];
        // Invert rank so rank 1 (most common) becomes highest count
        // Use a base of 1 billion to ensure static ranks sort after taginfo counts
        return 1_000_000_000 - (rank * 1_000_000);
    }

    // Unknown keys get count of 0 (least common, sort first)
    return 0;
}

/**
 * Sort tags for optimal query performance
 * Uses taginfo counts when available, falls back to static KEY_FREQUENCY_RANK
 * Tags are sorted by usage count ascending (least common first)
 *
 * @param {Array} tags - Array of {key, value} objects
 * @returns {Array} Sorted tags array
 */
function sortTagsForQuery(tags) {
    return [...tags].sort((a, b) => {
        const countA = getTagSortCount(a);
        const countB = getTagSortCount(b);
        // Lower count = less common = should come first
        return countA - countB;
    });
}

/**
 * Build tag filters string from tags array
 * @param {Array} tags - Array of {key, value} objects
 * @returns {string} Tag filters like ["key"="value"]["key2"]
 */
function buildTagFilters(tags) {
    const sortedTags = sortTagsForQuery(tags);
    return sortedTags.map(tag => {
        if (tag.value !== null) {
            // Escape special characters in value
            const escapedValue = tag.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return `["${tag.key}"="${escapedValue}"]`;
        } else {
            // Key exists with any value
            return `["${tag.key}"]`;
        }
    }).join('');
}

/**
 * Build an Overpass QL query to count objects matching tags
 * @param {Array} tags - Array of {key, value} objects
 * @param {Object|null} region - Region with name/adminLevel or relationId, or null for global
 * @returns {string} Overpass QL query
 */
export function buildCountQuery(tags, region = null) {
    const tagFilters = buildTagFilters(tags);
    const timeout = region ? 10 : 5;

    if (region && region.relationId) {
        // Use relation ID directly
        return `[out:json][timeout:${timeout}];
rel(${region.relationId});
map_to_area->.searchArea;
nwr(area.searchArea)${tagFilters};
out count;`;
    }

    if (region && region.name && region.adminLevel) {
        // Use boundary relation for regional query
        const escapedName = region.name.replace(/"/g, '\\"');
        return `[out:json][timeout:${timeout}];
rel["type"="boundary"]["name"="${escapedName}"]["admin_level"="${region.adminLevel}"];
map_to_area->.searchArea;
nwr(area.searchArea)${tagFilters};
out count;`;
    }

    // Global query (no region filter)
    return `[out:json][timeout:${timeout}];
nwr${tagFilters};
out count;`;
}

/**
 * Build a display query (shows actual results, not just count)
 * @param {Array} tags - Array of {key, value} objects
 * @param {Object|null} region - Region with name/adminLevel or relationId, or null for global
 * @returns {string} Overpass QL query
 */
export function buildDisplayQuery(tags, region = null) {
    const tagFilters = buildTagFilters(tags);
    const timeout = region ? 30 : 60;

    if (region && region.relationId) {
        // Use relation ID directly
        return `[out:json][timeout:${timeout}];
rel(${region.relationId});
map_to_area->.searchArea;
nwr(area.searchArea)${tagFilters};
out body;
>;
out skel qt;`;
    }

    if (region && region.name && region.adminLevel) {
        // Use boundary relation for regional query
        const escapedName = region.name.replace(/"/g, '\\"');
        return `[out:json][timeout:${timeout}];
rel["type"="boundary"]["name"="${escapedName}"]["admin_level"="${region.adminLevel}"];
map_to_area->.searchArea;
nwr(area.searchArea)${tagFilters};
out body;
>;
out skel qt;`;
    }

    // Global query (no region filter)
    return `[out:json][timeout:${timeout}];
nwr${tagFilters};
out body;
>;
out skel qt;`;
}

/**
 * Execute an Overpass query and return the count
 * @param {Array} tags - Array of {key, value} objects
 * @param {Object|null} region - Region with name/adminLevel or null for global
 * @returns {Promise<number>} Count of matching objects
 * @throws {OverpassError} On query failure with details about whether retry is appropriate
 */
export async function executeCountQuery(tags, region = null) {
    const query = buildCountQuery(tags, region);

    console.log('Overpass query:', query);

    let response;
    try {
        response = await fetch(OVERPASS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `data=${encodeURIComponent(query)}`
        });
    } catch (networkError) {
        console.error('Network error:', networkError);
        throw new OverpassError(
            'Network error: Unable to reach the Overpass server. Please check your internet connection.',
            'network',
            true,
            { originalError: networkError.message }
        );
    }

    // Handle HTTP errors
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('Overpass API error response:', response.status, errorText);

        // Categorize HTTP errors
        if (response.status === 429) {
            throw new OverpassError(
                'Rate limited: Too many requests to the Overpass server. Please wait a moment and try again.',
                'rate_limit',
                true,
                { status: response.status, body: errorText }
            );
        }

        if (response.status === 504 || response.status === 408) {
            // Gateway timeout or request timeout - likely means too many results
            // This is actually a "success" case for the game - many results exist
            console.log('HTTP timeout detected, assuming many results exist');
            return Infinity;
        }

        if (response.status >= 500) {
            throw new OverpassError(
                'Server error: The Overpass server is experiencing issues. Please try again shortly.',
                'server_error',
                true,
                { status: response.status, body: errorText }
            );
        }

        // 4xx errors (except 429 handled above) are usually query problems
        throw new OverpassError(
            `Query error: The server rejected the query (HTTP ${response.status}).`,
            'invalid_response',
            true,
            { status: response.status, body: errorText }
        );
    }

    // Parse response
    const responseText = await response.text();
    console.log('Overpass response:', responseText);

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (parseError) {
        console.error('Failed to parse Overpass response:', responseText);

        // If we got HTML back, the server might be returning an error page
        if (responseText.trim().startsWith('<')) {
            // Check for common timeout indicators in HTML error pages
            if (responseText.toLowerCase().includes('timeout') ||
                responseText.toLowerCase().includes('timed out')) {
                console.log('HTML timeout response detected, assuming many results exist');
                return Infinity;
            }
            throw new OverpassError(
                'Server returned an error page instead of data. The server may be overloaded.',
                'server_error',
                true,
                { responsePreview: responseText.substring(0, 500) }
            );
        }

        throw new OverpassError(
            'Failed to parse server response. The response was not valid JSON.',
            'parse_error',
            true,
            { parseError: parseError.message, responsePreview: responseText.substring(0, 500) }
        );
    }

    // Validate response shape - should be an object
    if (typeof data !== 'object' || data === null) {
        throw new OverpassError(
            'Invalid response: Expected an object but received something else.',
            'invalid_response',
            true,
            { receivedType: typeof data }
        );
    }

    // Check for timeout in JSON response - if query times out, assume many results exist
    // (queries with few/no results return quickly)
    if (data.remark) {
        const remarkLower = data.remark.toLowerCase();
        if (remarkLower.includes('timeout') ||
            remarkLower.includes('timed out') ||
            remarkLower.includes('runtime limit')) {
            console.log('Timeout detected in response remark, assuming many results exist');
            return Infinity;
        }

        // Log other remarks for debugging but don't fail
        console.warn('Overpass remark:', data.remark);
    }

    // Validate that we have an elements array
    if (!Array.isArray(data.elements)) {
        // Some error responses have a valid JSON structure but no elements
        // If there's a remark, it might indicate an issue
        if (data.remark) {
            throw new OverpassError(
                `Query issue: ${data.remark}`,
                'invalid_response',
                true,
                { remark: data.remark }
            );
        }

        throw new OverpassError(
            'Invalid response: Missing elements array in response.',
            'invalid_response',
            true,
            { keys: Object.keys(data) }
        );
    }

    // The count query returns the count in elements[0].tags.total
    if (data.elements.length > 0 && data.elements[0].tags && data.elements[0].tags.total !== undefined) {
        const count = parseInt(data.elements[0].tags.total, 10);
        if (isNaN(count)) {
            throw new OverpassError(
                'Invalid response: Count value is not a number.',
                'invalid_response',
                true,
                { totalValue: data.elements[0].tags.total }
            );
        }
        return count;
    }

    // Empty elements array with no errors means 0 results
    // This is a valid response
    return 0;
}

/**
 * Build a URL to view results on Ultra
 * @param {Array} tags - Array of {key, value} objects
 * @param {Object|null} region - Region with name/adminLevel or null for global
 * @returns {string} URL to Ultra with server parameter
 */
export function buildUltraLink(tags, region = null) {
    const query = buildDisplayQuery(tags, region);
    const encodedQuery = encodeURIComponent(query);
    const encodedServer = encodeURIComponent(OVERPASS_ENDPOINT);
    return `${OVERPASS_ULTRA_URL}#query=${encodedQuery}&server=${encodedServer}`;
}
