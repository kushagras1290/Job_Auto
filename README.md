# Instant Job Radar

Near-real-time, company-first remote AI job discovery for India-based mid-level
engineers who prefer IST/EU work hours, with immediate Telegram alerts and
application tracking in Google Sheets.

**Development status:** Runnable and unit tested; **not deployed**, **not**
connected to Telegram, Cloudflare D1 or Apps Script until your credentials
and activation steps are completed. This is not the same as a Codex Tasks
automation; it is a dedicated service that keeps working when Codex is closed.

## Architecture

Cloudflare Cron/Event -> allowlisted employer ATS -> normalization -> conservative
India/time-zone checks + heuristic role fit -> D1 with idempotent upsert ->
Telegram immediate alerts + optional Sheets relay. UTC 03:30 digest = 09:00 IST.

- `src/`: Worker and modular integrations
- `migrations/`: D1 schema and verified employer ATS seed list
- `integrations/google-sheet-relay.gs`: optional bidirectional status update
- `tests/`: tests requiring no external credentials
- `docs/DEPLOYMENT.md`: setup, security, limitations and operational runbook

```bash
npm install
npm test
```

Read [the full deployment runbook](docs/DEPLOYMENT.md) before deploying.

## Important design boundary

A publicly available career board generally does not provide instant vacancy
notifications to unaffiliated jobseekers. Polling every five minutes is the
high-priority target for verified employer boards, with rate limiting,
backoff and provider-friendly requests. Instant notifications are possible
**after discovery**, not necessarily at the exact moment an employer publishes.
