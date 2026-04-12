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

```bash
PORT=3000
DB_PATH=./data/highcourt.db
```

`DB_PATH` should point to a writable location. For cloud hosting, use a persistent disk path instead of a local Windows path.

## Deploy Online

### Render

This repo includes:

- `Dockerfile`
- `render.yaml`

To deploy on Render:

1. Create a new Blueprint/Web Service from this GitHub repo.
2. Keep the disk mount enabled at `/opt/render/project/data`.
3. Deploy the service.

The app will use:

- `PORT=3000`
- `DB_PATH=/opt/render/project/data/highcourt.db`

### Docker

```bash
docker build -t highcourt-api .
docker run -p 3000:3000 -e PORT=3000 -e DB_PATH=/app/data/highcourt.db highcourt-api
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
