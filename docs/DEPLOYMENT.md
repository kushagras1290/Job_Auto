# Instant Job Radar: operational runbook

## What this project does

A Cloudflare Worker scans a verified allowlist of employers' public Greenhouse,
Lever and Ashby job boards. Remotive and Himalayas supplement company-first
sources at a deliberately lower frequency. Every job is normalized, scored,
classified, deduplicated in D1 and, when explicitly eligible for India plus
IST/EU/async hours, sent immediately to Telegram. Less-certain listings are
saved as **Review**. A Google Sheet is an optional, synchronized tracking view.

**Limits:** This is near-real-time polling, not true instant discovery: publicly
available ATS APIs usually do not emit publisher webhooks to outside jobseekers.
An authorized event producer can POST a normalized job event to the protected
webhook. Only verified eligibility evidence can trigger a high-priority alert.
No external applications are submitted by this service.

## Requirements

- Node.js >=22, Cloudflare account with Workers and D1 billing/usage reviewed.
- A Telegram bot and personal chat ID for proactive alerts.
- A Google account and created Google Sheet for optional tracking integration.
- Do not commit tokens, Google Apps Script secrets or personal resumes to Git.

## 1. Provision Cloudflare

```bash
npm install
npx wrangler login
npx wrangler d1 create job_radar
```

Put the actual `database_id` from the creation output into `wrangler.jsonc`.
Validate account limits and any applicable costs before enabling minute-level
scans; free-plan allowances and per-account quotas may change. Remove placeholder
`WORKER_PUBLIC_BASE_URL` if not required.

Set up the database:

```bash
npm run db:remote
```

This applies the schema and verifies a handful of actual employer board tokens:
`mightybot`, `emergence`, `particle41llc`, `globalli`. More employers are registered over
the protected API after verifying that the board token exists and current job
feeds are permissible to access. Never guess a board slug based solely on a
company name. Every source's first scan runs when its tier schedule triggers.

Set secrets (use a different randomly generated value for each purpose):

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Deploy:

```bash
npm test
npm run deploy
```

Cloudflare Cron Triggers run in **UTC**, so `30 3 * * *` means 09:00 IST
throughout the year. The config registers priority every 5 minutes, broad
once every 30 minutes, supplementary feeds every 6 hours (subject to per-source
cooldowns), and one 09:00 IST digest. Multiple tiers can overlap; D1 per-source
leases limit duplicate network requests. These are polling targets, not a
latency SLA. No arbitrary employer-site HTML scraping, CAPTCHA circumvention,
or unauthorized webhooks are implemented.

## 2. Register employer boards

```bash
curl -X POST "https://YOUR-WORKER.workers.dev/api/sources" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"ashby","company":"Verified Employer","board":"REAL_VERIFIED_BOARD_TOKEN","tier":"priority"}'
```

Providers: `greenhouse`, `lever`, `ashby`, `remotive`, `himalayas`.
If a board is not confirmed accessible, don't register it. Generic supplementary
feeds use `board=all` and cannot be configured for high-frequency polling.

Other endpoints:

```text
GET    /health                       public basic liveness
GET    /api/jobs?limit=30            admin protected
GET    /api/sources                  admin protected
GET    /api/runs                     admin protected
POST   /api/scan                     admin; JSON {"tier":"priority"}
PATCH  /api/jobs/{id}/status         admin; JSON {"status":"Applied"}
POST   /webhooks/authorized-job-event admin; only your trusted event producer
```

An API `202` on a manual scan means the background run was accepted, not that
the run succeeded. Inspect `/api/runs` and Cloudflare logs. A health `200` only
confirms the process, not job feeds, alerts or Google Sheets integration.

## 3. Connect Google Sheets

Use the provided Google Sheet, **Instant Job Radar — Application Tracker**.
Its `Tracker` has the 18 fields expected by the relay. Open a new Apps Script
project attached to that sheet, paste the code from
`integrations/google-sheet-relay.gs`, and set Script Properties:

```text
SPREADSHEET_ID  = <Google Sheet ID>
SYNC_SECRET     = <high-entropy independent shared secret>
WORKER_URL      = <your deployed Worker URL>
ADMIN_TOKEN     = <your Worker admin token>
```

Deploy an Apps Script Web App executing as **you**; its URL must only be
shared with the Worker. Deployments with `Anyone` access rely entirely on the
shared secret, so anyone possessing it can make changes to the tracker. Keep it
out of logs. Run `setupEditTrigger()` once and authorize it; without this step
edits in the Status column don't flow back to D1.

Put these Worker secrets in place:

```bash
npx wrangler secret put SHEETS_WEB_APP_URL
npx wrangler secret put SHEETS_SYNC_SECRET
```

The sheet relay intentionally preserves human-edited Status, Applied at,
Follow-up date and Notes on metadata updates. Status, Follow-up date and Notes edits are pushed back
to the D1 record via the Apps Script edit trigger. Dates should use YYYY-MM-DD. Do not treat the spreadsheet
as an atomic transactional database; D1 is authoritative.

## 4. Alert and tracking rules

- Immediately alert only explicit India hiring + full-remote + IST/EU/async
  evidence with fit score >=70. These are conservative text heuristics,
  **not** legal validation of work authorization or an ML-calibrated probability.
- Worldwide-only, unstated hours, ambiguous remote status => `Review`, not
  instant qualified alerts; a human checks recruiter/employer evidence.
- Foreign-only hiring, US-only hours, onsite-only, principal/staff, or
  >6 years explicitly required => reject from the target stream.
- Keep original employer application URLs; no auto-submission or auto-login.
- Job status and applied date survive reposting and rescans.

## 5. Monitor

Inspect `GET /api/runs`, the `sources.last_error` and `failure_count` fields,
Telegram delivery, and recent Sheet rows daily. If a feed returns rate-limit
HTTP 429/503, source cooldown increases exponentially to a maximum of 16x.
Public APIs may omit fresh roles, expose stale dates or change response shape;
manual verification of each recommended role and its hours remains essential.

## 6. Security

- Strong admin bearer token, source-host allowlist, HTTPS-only URLs, no custom
  URLs, no automatic application submissions.
- Scope Tokens per environment and rotate periodically; don't copy a full
  resume into an externally accessible sheet.
- Review the Apps Script deployment exposure; replace its shared secret if a
  URL or code snippet leaks it.
- Keep telemetry free of applicant personal data and configure an appropriate
  data-retention policy before production expansion.
