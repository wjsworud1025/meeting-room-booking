SET search_path TO booking,public;
ALTER TABLE holiday_sync ADD COLUMN worker_heartbeat timestamptz;
