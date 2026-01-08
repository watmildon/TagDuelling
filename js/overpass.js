/**
 * Overpass API Module
 * Handles building and executing Overpass queries
 */

const OVERPASS_ENDPOINT = 'https://overpass.private.coffee/api/interpreter';
const OVERPASS_ULTRA_URL = 'https://overpass-ultra.us';

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

/**
 * Sort tags for optimal query performance
 * Order:
 * 1. Key=value pairs NOT on the most used list
 * 2. Generic keys NOT on the most used list
 * 3. Key=value pairs on the most used list
 * 4. Generic keys on the most used list (sorted by frequency, most common last)
 *
 * @param {Array} tags - Array of {key, value} objects
 * @returns {Array} Sorted tags array
 */
function sortTagsForQuery(tags) {
    return [...tags].sort((a, b) => {
        const aIsCommon = a.key in KEY_FREQUENCY_RANK;
        const bIsCommon = b.key in KEY_FREQUENCY_RANK;
        const aHasValue = a.value !== null;
        const bHasValue = b.value !== null;

        // Calculate priority group (lower = earlier in query)
        // Group 1: key=value, not common
        // Group 2: key only, not common
        // Group 3: key=value, common
        // Group 4: key only, common
        const getGroup = (isCommon, hasValue) => {
            if (!isCommon && hasValue) return 1;
            if (!isCommon && !hasValue) return 2;
            if (isCommon && hasValue) return 3;
            return 4; // common, no value
        };

        const groupA = getGroup(aIsCommon, aHasValue);
        const groupB = getGroup(bIsCommon, bHasValue);

        if (groupA !== groupB) {
            return groupA - groupB;
        }

        // Within group 4 (common generic keys), sort by frequency (most common last)
        if (groupA === 4) {
            const rankA = KEY_FREQUENCY_RANK[a.key];
            const rankB = KEY_FREQUENCY_RANK[b.key];
            // Higher rank number (less common) comes first
            return rankB - rankA;
        }

        // Within other groups, maintain original order
        return 0;
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
 */
export async function executeCountQuery(tags, region = null) {
    const query = buildCountQuery(tags, region);

    console.log('Overpass query:', query);

    const response = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `data=${encodeURIComponent(query)}`
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Overpass API error response:', errorText);
        throw new Error(`Overpass API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const responseText = await response.text();
    console.log('Overpass response:', responseText);

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (parseError) {
        console.error('Failed to parse Overpass response:', responseText);
        throw new Error(`Failed to parse Overpass response: ${parseError.message}\n${responseText}`);
    }

    // Check for timeout - if query times out, assume many results exist
    // (queries with few/no results return quickly)
    if (data.remark && data.remark.includes('timeout')) {
        return Infinity;
    }

    // Check for other errors in the response
    if (data.remark) {
        console.warn('Overpass remark:', data.remark);
    }

    // The count query returns the count in elements[0].tags.total
    if (data.elements && data.elements.length > 0 && data.elements[0].tags) {
        return parseInt(data.elements[0].tags.total, 10) || 0;
    }

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
