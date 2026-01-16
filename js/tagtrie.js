/**
 * TagTrie - Space-efficient autocomplete for OpenStreetMap tags
 *
 * Provides fast prefix-based lookups for OSM tag keys and their values.
 * Data is stored in a compressed trie structure for minimal memory footprint.
 */

export class TagTrie {
  /**
   * @param {object} data - The loaded tagdata.json object
   */
  constructor(data) {
    this.meta = data.m;
    this.values = data.V;  // Global values array
    this.trie = data.T;    // Compressed trie
  }

  /**
   * Find all keys matching a prefix, sorted by popularity rank.
   * @param {string} prefix - The prefix to match (e.g., 'addr:')
   * @param {number} [limit=20] - Maximum results to return
   * @returns {string[]} Matching keys, most popular first
   */
  matchKeys(prefix, limit = 20) {
    const results = [];
    this._collectKeys(this.trie, '', prefix, results);

    // Sort by rank (lower = more popular)
    results.sort((a, b) => a.rank - b.rank);

    return results.slice(0, limit).map(r => r.key);
  }

  /**
   * Find all values for a key matching a prefix, sorted by popularity.
   * @param {string} key - The exact key (e.g., 'highway')
   * @param {string} [prefix=''] - Value prefix to match (e.g., 'res')
   * @param {number} [limit=20] - Maximum results to return
   * @returns {string[]} Matching values, most popular first
   */
  matchValues(key, prefix = '', limit = 20) {
    const node = this._findNode(this.trie, key);

    if (!node || !node.v) {
      return [];
    }

    const lowerPrefix = prefix.toLowerCase();

    // Values are stored as indices into the global values array
    // They're already sorted by popularity (most popular first)
    const matches = [];
    for (const idx of node.v) {
      const value = this.values[idx];
      if (value.toLowerCase().startsWith(lowerPrefix)) {
        matches.push(value);
        if (matches.length >= limit) break;
      }
    }

    return matches;
  }

  /**
   * Get all values for a key (no filtering), sorted by popularity.
   * @param {string} key - The exact key
   * @param {number} [limit=30] - Maximum results
   * @returns {string[]} Values, most popular first
   */
  getValues(key, limit = 30) {
    return this.matchValues(key, '', limit);
  }

  /**
   * Check if an exact key exists in the trie.
   * @param {string} key - The key to check
   * @returns {boolean}
   */
  hasKey(key) {
    const node = this._findNode(this.trie, key);
    return node !== null && node.e !== undefined;
  }

  /**
   * Get the popularity rank of a key (1 = most popular).
   * @param {string} key - The key to check
   * @returns {number|null} Rank or null if not found
   */
  getKeyRank(key) {
    const node = this._findNode(this.trie, key);
    return node?.e ?? null;
  }

  /**
   * Get all keys in the trie, sorted by rank.
   * @param {number} [limit=500] - Maximum results
   * @returns {string[]} All keys, most popular first
   */
  getAllKeys(limit = 500) {
    return this.matchKeys('', limit);
  }

  /**
   * Get metadata about the dataset.
   * @returns {object} { keys, values, generatedDate }
   */
  getMetadata() {
    return {
      keys: this.meta.k,
      values: this.meta.v,
      generatedDate: this.meta.t
    };
  }

  // --- Private methods ---

  /**
   * Navigate the compressed trie to find the node for an exact string.
   */
  _findNode(node, target) {
    if (!node || !target) {
      return target === '' ? node : null;
    }

    if (!node.c) {
      return null;
    }

    // Check each child prefix
    for (const [prefix, child] of Object.entries(node.c)) {
      if (target.startsWith(prefix)) {
        // Full prefix matched, continue with remainder
        return this._findNode(child, target.slice(prefix.length));
      }
      if (prefix.startsWith(target)) {
        // Target is shorter than prefix - partial match, no exact node
        return null;
      }
    }

    return null;
  }

  /**
   * Collect all keys under a node that match the given prefix.
   */
  _collectKeys(node, currentPath, targetPrefix, results) {
    if (!node) return;

    // If we haven't consumed the full prefix yet, navigate down
    if (targetPrefix) {
      if (!node.c) return;

      for (const [edgeLabel, child] of Object.entries(node.c)) {
        if (targetPrefix.startsWith(edgeLabel)) {
          // Edge fully matches start of prefix
          this._collectKeys(
            child,
            currentPath + edgeLabel,
            targetPrefix.slice(edgeLabel.length),
            results
          );
        } else if (edgeLabel.startsWith(targetPrefix)) {
          // Prefix fully consumed within this edge
          this._collectKeys(
            child,
            currentPath + edgeLabel,
            '',
            results
          );
        }
      }
      return;
    }

    // Prefix fully matched - collect all keys from here
    if (node.e !== undefined) {
      results.push({ key: currentPath, rank: node.e });
    }

    if (node.c) {
      for (const [edgeLabel, child] of Object.entries(node.c)) {
        this._collectKeys(child, currentPath + edgeLabel, '', results);
      }
    }
  }
}

/**
 * Load TagTrie from a URL (browser) or file path (Node.js).
 * @param {string} urlOrPath - URL or file path to tagdata.json
 * @returns {Promise<TagTrie>}
 */
export async function loadTagTrie(urlOrPath) {
  let data;

  if (typeof window !== 'undefined') {
    // Browser environment
    const response = await fetch(urlOrPath);
    data = await response.json();
  } else {
    // Node.js environment
    const fs = await import('fs');
    const content = fs.readFileSync(urlOrPath, 'utf-8');
    data = JSON.parse(content);
  }

  return new TagTrie(data);
}

export default TagTrie;
