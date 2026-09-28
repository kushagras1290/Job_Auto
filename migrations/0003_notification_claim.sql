-- Concurrent crons can overlap at :00/:30; reserve each message before delivery.
-- A crashed worker's claim expires so the message can be retried.
ALTER TABLE jobs ADD COLUMN alert_claim_until TEXT;
CREATE INDEX IF NOT EXISTS jobs_alert_claim ON jobs(alerted_at,alert_claim_until,fit_score);
