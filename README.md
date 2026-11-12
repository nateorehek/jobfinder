# Fieldwork

Search live internships and jobs by academic field, keyword, and US ZIP radius. Save roles to your account, read role summaries and likely skills, and sort by recency or popularity.

## Run locally

Install Node.js 24 or newer, open PowerShell in this project folder, and run:

```powershell
node server.mjs
```

Open [localhost:3000](http://127.0.0.1:3000). The first refresh starts in the background. The example catalog appears until the first successful feed check. Account data and listings persist in `data/fieldwork.sqlite`. Use `node --test` to verify the app or `node server.mjs --sync` to run a one-off refresh.

## Deploy

The application needs a running Node process and a persistent disk. For a Docker host, from the project folder run:

```powershell
docker compose up --build -d
```

Compose binds to `127.0.0.1:3000` on the host and preserves the database in a named volume. For public access, set `PUBLIC_ORIGIN=https://your-domain.example` in your deployment environment and route that domain through an HTTPS reverse proxy to the app. The HTTPS origin enables Secure session cookies. GitHub hosts the source and runs checks. Use a Node or Docker host for the app.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Node listener. The container binds to all interfaces inside Docker. |
| `DB_PATH` | `./data/fieldwork.sqlite` | Database path on durable storage |
| `PUBLIC_ORIGIN` | Request host | Exact public HTTPS origin for browser writes and secure cookies |
| `TRUST_PROXY` | `0` | Set to 1 when one trusted proxy provides the client IP |
| `BOARD_CONFIG` | `config/boards.json` | Custom board configuration file |
| `LIVE_FEEDS` | `1` | Set to 0 to turn off employer refreshes |
| `SYNC_MINUTES` | `30` | Background interval. Zero disables the timer and startup check. Nonzero values below 10 run at 10-minute intervals. |
| `BLUESKY_ENABLED` | `1` | Set to 0 to skip Bluesky scans |

See the [architecture and operations guide](docs/architecture.md) for data flow, adding sources, backups, and troubleshooting.

## Sources and coverage

- The app polls official public [Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), and [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api) employer boards. Coverage depends on the configured employers.
- Active, publicly listed Summer 2027 internships also come from [SimplifyJobs and the Pitt Computer Science Club](https://github.com/SimplifyJobs/Summer2027-Internships). These listings use the existing internship cards and filters. When an employer board also lists the role, Fieldwork uses the employer's details.
- Popularity uses [Bluesky public search](https://github.com/bluesky-social/atproto/blob/main/packages/bsky/src/api/app/bsky/feed/searchPosts.ts) and Fieldwork saves. Some listings have little or no external engagement data. LinkedIn applicant counts and Reddit or X metrics are outside the current integrations.
- US ZIP coordinates are adapted from the [GeoNames postal code dataset](https://download.geonames.org/export/zip/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled file retains US ZIP, city, state, latitude, and longitude. Distances are approximate.
