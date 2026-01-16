# TagTrie - OSM Tag Autocomplete

A space-efficient data structure for autocompleting OpenStreetMap tag keys and values. Contains the top 500 most common OSM keys and up to 30 prevalent values per key.

## Size

- **Raw JSON**: ~168 KB
- **Gzipped** (network transfer): ~79 KB
- Browsers automatically decompress gzipped responses

## Installation

Copy these files to your project:

```
src/
  tagtrie.js    # The TagTrie class
  tagdata.json  # Pre-generated data
```

## Usage

### Browser (ES Modules)

```javascript
import { TagTrie } from './tagtrie.js';

// Fetch and initialize
const response = await fetch('./tagdata.json');
const data = await response.json();
const trie = new TagTrie(data);

// Autocomplete keys
trie.matchKeys('addr:');     // ['addr:housenumber', 'addr:street', 'addr:city', ...]
trie.matchKeys('high', 5);   // ['highway'] (limit to 5 results)

// Autocomplete values for a key
trie.matchValues('highway', 'res');  // ['residential', 'rest_area']
trie.getValues('amenity', 10);       // Top 10 amenity values

// Check if a key exists
trie.hasKey('highway');      // true
trie.hasKey('notakey');      // false

// Get key popularity rank (1 = most popular)
trie.getKeyRank('building'); // 1
trie.getKeyRank('highway');  // 3
```

### Node.js

```javascript
import { loadTagTrie } from './tagtrie.js';

const trie = await loadTagTrie('./tagdata.json');
trie.matchKeys('addr:');
```

### Using with import assertions (modern bundlers)

```javascript
import { TagTrie } from './tagtrie.js';
import data from './tagdata.json' with { type: 'json' };

const trie = new TagTrie(data);
```

## API Reference

### `new TagTrie(data)`

Create a new TagTrie from loaded JSON data.

### `matchKeys(prefix, limit = 20)`

Find keys matching a prefix, sorted by popularity.

```javascript
trie.matchKeys('addr:')    // All keys starting with 'addr:'
trie.matchKeys('', 10)     // Top 10 most popular keys
```

### `matchValues(key, prefix = '', limit = 20)`

Find values for a specific key matching a prefix.

```javascript
trie.matchValues('highway', 'res')  // Values starting with 'res'
trie.matchValues('building', '')    // All values for 'building'
```

### `getValues(key, limit = 30)`

Shorthand for `matchValues(key, '', limit)`.

### `hasKey(key)`

Check if an exact key exists in the dataset.

### `getKeyRank(key)`

Get the popularity rank of a key (1-500, or null if not found).

### `getAllKeys(limit = 500)`

Get all keys sorted by popularity.

### `getMetadata()`

Returns dataset info:

```javascript
{
  keys: 500,              // Number of keys
  values: 7185,           // Total unique values
  generatedDate: '2026-01-16'
}
```

## Regenerating Data

To fetch fresh data from the TagInfo API:

```bash
npm run generate
```

This takes ~30 seconds (500 API requests with rate limiting).

### Customizing

Edit `src/generate.js` to change:

```javascript
const NUM_KEYS = 500;           // Number of top keys to fetch
const MAX_VALUES_PER_KEY = 30;  // Max values per key
const REQUEST_DELAY_MS = 50;    // Delay between API requests
```

## Data Format

The `tagdata.json` structure:

```javascript
{
  "m": {                    // Metadata
    "k": 500,               // Key count
    "v": 7185,              // Unique value count
    "t": "2026-01-16"       // Generation date
  },
  "V": ["yes", "no", ...],  // All unique values (indexed)
  "T": {                    // Compressed trie
    "c": {                  // Children
      "build": {
        "c": {
          "ing": {
            "e": 1,         // End marker (rank)
            "v": [0, 15, ...], // Value indices
            "c": { ... }
          }
        }
      }
    }
  }
}
```

## Performance

- **Key lookup**: O(k) where k = key length
- **Key prefix search**: O(k + n) where n = number of matches
- **Value prefix search**: O(v) where v = values for that key (max 30)

All operations are sub-millisecond for typical use cases.

## Data Source

Data is fetched from the [TagInfo API](https://taginfo.openstreetmap.org/taginfo/apidoc):

- Keys: `/api/4/keys/all` sorted by `count_all`
- Values: `/api/4/key/prevalent_values` with fallback to `/api/4/key/values`

## License

MIT
