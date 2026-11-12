# Fieldwork

Find internships and early-career jobs by academic field, keyword, and US ZIP code.

## Stage 1

Run `npm start` with Node.js 24 or newer, then open http://127.0.0.1:3000. The initial interface uses a clearly marked example catalog and browser-local example bookmarks.

## Stage 2

The same startup command now runs a SQLite-backed server. It supports accounts, persistent bookmarks, indexed keyword search, and US ZIP-radius filtering. The catalog still uses examples at this stage. The database defaults to `data/fieldwork.sqlite`.

ZIP coordinates and city names are adapted from the [GeoNames postal code dataset](https://download.geonames.org/export/zip/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled file retains US ZIP, city, state code, latitude, and longitude.

## Stage 3

The server checks public employer boards on startup and every 30 minutes. **Check for new roles** refreshes eligible feeds for the selected field. Edit `config/boards.json` to add an employer or set `BOARD_CONFIG` to load your own file. Run `node server.mjs --sync` for a one-off refresh and `node --test` for automated checks.

Popular ranking combines recent public Bluesky reactions to the same posting URL with Fieldwork bookmarks. Coverage depends on which postings appear in Bluesky search.
