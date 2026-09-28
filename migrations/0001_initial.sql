CREATE TABLE IF NOT EXISTS sources (
 id TEXT PRIMARY KEY,
 company TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('greenhouse','lever','ashby','remotive','himalayas')),
 board TEXT NOT NULL,
 tier TEXT NOT NULL CHECK(tier IN ('priority','broad','daily')),
 active INTEGER NOT NULL DEFAULT 1,
 cooldown_minutes INTEGER NOT NULL DEFAULT 30,
 last_started_at TEXT,
 last_success_at TEXT,
 lease_until TEXT,
 failure_count INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sources_tier_active ON sources(tier,active,last_started_at);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 source_id TEXT NOT NULL,
 source_job_id TEXT NOT NULL,
 company TEXT NOT NULL,
 title TEXT NOT NULL,
 location TEXT,
 apply_url TEXT NOT NULL,
 source_url TEXT NOT NULL,
 published_at TEXT,
 first_seen_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL,
 fit_score INTEGER NOT NULL,
 eligibility TEXT NOT NULL CHECK(eligibility IN ('confirmed','review','rejected')),
 timezone_fit TEXT NOT NULL CHECK(timezone_fit IN ('confirmed','review','rejected')),
 reason TEXT NOT NULL,
 evidence TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Discovered' CHECK(status IN ('Discovered','Review','Shortlisted','Applied','Interview','Offer','Rejected','Archived')),
 applied_at TEXT,
 follow_up_at TEXT,
 notes TEXT NOT NULL DEFAULT '',
 alerted_at TEXT,
 sheet_synced_at TEXT,
 description_hash TEXT NOT NULL,
 UNIQUE(provider,source_job_id)
);
CREATE INDEX IF NOT EXISTS jobs_recent ON jobs(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS jobs_alert_pending ON jobs(alerted_at,fit_score);
CREATE INDEX IF NOT EXISTS jobs_sheet_pending ON jobs(sheet_synced_at,last_seen_at);
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY,
 started_at TEXT NOT NULL,
 finished_at TEXT,
 tier TEXT NOT NULL,
 sources_checked INTEGER NOT NULL DEFAULT 0,
 jobs_seen INTEGER NOT NULL DEFAULT 0,
 new_jobs INTEGER NOT NULL DEFAULT 0,
 errors INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sources(id,company,provider,board,tier,cooldown_minutes) VALUES
 ('feed:remotive','Remotive','remotive','all','daily',360),
 ('feed:himalayas','Himalayas','himalayas','all','daily',1440);
