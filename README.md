# Opponent Notebook

A private, browser-only notebook for tournament opponents: pull public Lichess or Chess.com games, build an opening tree, type over-the-board games from a scoresheet, tag notes, and (on this device) run a modest Stockfish suggestion.

**All data stays in this browser** (IndexedDB). There are no analytics and no server of your own. Deploying this site needs a separate, explicit OK — this copy is for local use.

## Run locally

From this folder:

```bash
python3 -m http.server 8765
```

Open http://localhost:8765/ and unlock with the passcode you were given. The page stores only a salted hash of that passcode, never the passcode itself.

If you change the passcode in the environment, regenerate the hash file (this script never prints the passcode):

```bash
node scripts/write-hash.mjs
```

## What is bundled

- `chess.js` 1.4.0 (move and PGN validation)
- Stockfish 19 lite, single-threaded WASM (works on ordinary static hosting; no COOP/COEP headers required)
- A small bundled opening-name table (not a complete ECO book)

Public game pulls use the official Lichess and Chess.com HTTP APIs. Those sites may rate-limit or block a browser request (CORS). When that happens the app says so plainly; you can still log over-the-board games.
