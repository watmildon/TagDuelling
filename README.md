# Tag Duelling

A multiplayer game where players competitively suggest [OpenStreetMap tags](https://wiki.openstreetmap.org/wiki/Tags) into a plausible tag pool for an object. Players take turns adding tags or specifying values, and opponents can challenge the validity of the tag combination. If there's nothing in the database with that set of tags, the challenging player wins.

Special shout outs to the folks running the https://private.coffee/ Overpass intance, [TagInfo](https://taginfo.openstreetmap.org/) maintainters, and everyone who adds great tagging depth to our beloved OpenStreetMap.

## Features

- Multiple human players can play locally
- Bot opponents can be added, or watch the bots duel it out
- Regional filtering (countries, states, cities, or custom OSM relation IDs)
- Light/dark theme support

### Challenge Resolution

The site uses Overpass to determine a winner and presume that any long running query will have returned more than one result. I am still evaluating if this is a sensible metric.

## Bot Behavior

Bot development is something I would love to get feeback on. Some constraints to keep in mind:

- The bots never cheat and aren't omnicient. In practice, this means there's only one [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) call at the end of the game.
- Bots tend to consult pre-cached common keys and values to make guesses.
- Bots are allowed to review [TagInfo](https://taginfo.openstreetmap.org/) for tag combination guesses.
- Rounds must be fast.
- Difficulty affects randomness, challenge thresholds, etc.