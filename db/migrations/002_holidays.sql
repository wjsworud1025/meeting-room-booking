SET search_path=booking,public;
CREATE TABLE holiday_years(year integer PRIMARY KEY CHECK(year BETWEEN 2000 AND 2100), days jsonb NOT NULL, synced_at timestamptz NOT NULL);
CREATE SEQUENCE holiday_override_version;
CREATE TABLE holiday_overrides(local_date date PRIMARY KEY, name text, source_url text NOT NULL, reason text NOT NULL, version integer NOT NULL DEFAULT nextval('holiday_override_version'), updated_by uuid REFERENCES members, updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE holiday_sync(id integer PRIMARY KEY CHECK(id=1), next_run_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_attempt_at timestamptz, last_success_at timestamptz, last_error text, changed_dates jsonb NOT NULL DEFAULT '[]');
INSERT INTO holiday_sync(id) VALUES(1);
ALTER TABLE tasks DROP CONSTRAINT tasks_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK(kind IN ('SLACK_COMMAND','MEMBER_PROVISION','NOTIFY','RETENTION','HOLIDAY_SYNC'));
