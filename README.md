# High Court Services

Small API for Calcutta High Court integrations.

## What it does

- `cause-lists` service
  - builds official cause-list URLs from the Calcutta High Court site
  - fetches HTML or PDF cause lists
  - parses HTML cause lists and searches them by case number, party, or advocate text
  - searches upcoming cause lists across the next few days
- `case-status` service
  - loads Calcutta High Court benches from the eCourts backend
  - loads case types for a selected bench
  - creates a captcha-backed session for case-status lookup
  - submits case-number searches to the eCourts backend using that same session
  - supports party-name and advocate-name searches
- `saved-searches` storage
  - stores your lawyer-name, party-name, or case-detail searches in SQLite
  - stores run snapshots so you can revisit previous results

## Run

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000` by default.

## Environment



`DATABASE_URL` can come from Vercel Postgres or any standard PostgreSQL provider.

## Deploy Online

### Vercel

This repo includes:

- `api/server.ts`
- `vercel.json`

For Vercel:

1. Create a Vercel project from this repo.
2. Add a Postgres database to the project or provide a `DATABASE_URL`.
3. Set `CRON_SECRET`.
4. Deploy.

The app uses:

- `PORT=3000`
- `DATABASE_URL`
- `CRON_SECRET`

`vercel.json` configures a cron to call:

- `/api/cron/cause-list-sync`

### Import Existing Local SQLite Data

This repo includes a one-time import script that reads the old local SQLite database and copies it into Postgres.

```bash
npm run import:sqlite
```

Optional:

```bash
SQLITE_DB_PATH=D:\highcourt\highcourt.db npm run import:sqlite
```

### Docker

```bash
docker build -t highcourt-api .
docker run -p 3000:3000 -e PORT=3000 -e DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE highcourt-api
```

## Main endpoints

- `GET /health`
- `GET /api/cause-lists/url?date=2024-08-16&side=A&listType=D&format=html`
- `GET /api/cause-lists/fetch?date=2024-08-16&side=A&listType=D&format=html`
- `GET /api/cause-lists/search?date=2024-08-16&side=A&listType=D&query=MAT/1310/2024`
- `GET /api/cause-lists/upcoming?query=uttam&startDate=2026-04-10&days=7`
- `GET /api/case-status/benches`
- `GET /api/case-status/case-types?courtCode=3`
- `POST /api/case-status/session`
- `POST /api/case-status/search/case-number`
- `POST /api/case-status/search/party-name`
- `POST /api/case-status/search/advocate-name`
- `GET /api/saved-searches`
- `POST /api/saved-searches`
- `POST /api/saved-searches/:id/run`

## Example case-status flow

1. `POST /api/case-status/session`
2. Open the returned `captchaImageUrl`
3. Solve the captcha
4. `GET /api/case-status/case-types?courtCode=3`
5. `POST /api/case-status/search/case-number` with:

```json
{
  "sessionId": "returned-session-id",
  "captcha": "captcha-text",
  "courtCode": "3",
  "caseType": "19",
  "caseNumber": "1310",
  "year": "2024"
}
```

## Notes

- Cause-list scraping is practical because the official Calcutta High Court site exposes direct HTML and PDF cause-list URLs.
- Case-status lookup uses the eCourts system and is captcha-protected, so unattended polling for notifications will need either a solved captcha workflow, a user-assisted refresh step, or a different permitted source.
- Saved searches are stored in `D:\highcourt\highcourt.db`.
