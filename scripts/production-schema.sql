-- Supabase SQL Editor bootstrap: schema only; no sample users, no credentials.
BEGIN;
SELECT pg_advisory_xact_lock(29092026);
CREATE TABLE IF NOT EXISTS public.booking_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $migration_0$
BEGIN
IF NOT EXISTS (SELECT 1 FROM public.booking_migrations WHERE name='001_initial.sql') THEN
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS booking;
REVOKE ALL ON SCHEMA booking FROM PUBLIC;
SET search_path TO booking, public;
CREATE TABLE settings (
 id integer PRIMARY KEY CHECK (id=1), facility_name text NOT NULL DEFAULT '회의실 예약', timezone text NOT NULL DEFAULT 'Asia/Seoul',
 config_version integer NOT NULL DEFAULT 1, job_heartbeat timestamptz, admin_bootstrap_started_at timestamptz, bootstrap_admin_id uuid
);
INSERT INTO settings(id) VALUES(1);
CREATE TABLE cohorts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, inactive_at timestamptz);
CREATE TABLE members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid UNIQUE, cohort_id uuid REFERENCES cohorts,
 email text NOT NULL UNIQUE CHECK(email=lower(trim(email))), display_name text NOT NULL, class_name text NOT NULL DEFAULT '',
 role text NOT NULL CHECK(role IN ('STUDENT','ADMIN')), status text NOT NULL DEFAULT 'REGISTERED' CHECK(status IN ('REGISTERED','PROVISIONING','ACTIVE','INACTIVE','FAILED')),
 account_version integer NOT NULL DEFAULT 1, access_version integer NOT NULL DEFAULT 1, cooldown_until timestamptz,
 slack_workspace_id text, slack_user_id text, link_code_hash text, link_code_expires_at timestamptz, link_code_attempts integer NOT NULL DEFAULT 0,
 admin_invite_id uuid UNIQUE, issuer_type text CHECK(issuer_type IN ('ADMIN','BOOTSTRAP','RECOVERY')), invited_by uuid REFERENCES members,
 invite_expires_at timestamptz, invite_accepted_at timestamptz, invite_revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), inactive_at timestamptz,
 CHECK((role='STUDENT' AND cohort_id IS NOT NULL) OR (role='ADMIN' AND cohort_id IS NULL)), UNIQUE(slack_workspace_id,slack_user_id)
);
ALTER TABLE settings ADD FOREIGN KEY(bootstrap_admin_id) REFERENCES members ON DELETE SET NULL;
CREATE TABLE rooms(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,active boolean NOT NULL DEFAULT true,display_order integer NOT NULL);
CREATE TABLE policy_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),effective_on date NOT NULL UNIQUE,rules_json jsonb NOT NULL,created_by uuid REFERENCES members,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE opening_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),local_date date NOT NULL,room_id uuid REFERENCES rooms,kind text NOT NULL CHECK(kind IN ('CLOSED','OPEN')),local_start text NOT NULL,local_end text NOT NULL,reason text NOT NULL,version integer NOT NULL DEFAULT 1,CHECK(local_start<local_end));
CREATE TABLE reservations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cohort_id uuid NOT NULL REFERENCES cohorts,room_id uuid NOT NULL REFERENCES rooms,creator_id uuid NOT NULL REFERENCES members,organizer_id uuid NOT NULL REFERENCES members,policy_version_id uuid NOT NULL REFERENCES policy_versions,
 capacity_snapshot integer NOT NULL,minimum_snapshot integer NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('HOLDING','CONFIRMED','REPLENISHING','CANCELLED','ENDED')),
 initial_deadline timestamptz NOT NULL,replenish_deadline timestamptz,first_confirmed_at timestamptz,first_confirmed_member_ids uuid[],start_member_ids uuid[],start_snapshot_at timestamptz,
 version integer NOT NULL DEFAULT 1,cancel_reason text,create_request_key text NOT NULL,
 transfer_request_id uuid,transfer_from_id uuid REFERENCES members,transfer_to_id uuid REFERENCES members,transfer_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(starts_at<ends_at),CHECK(minimum_snapshot>=2 AND capacity_snapshot>=minimum_snapshot),
 CHECK((first_confirmed_at IS NULL)=(first_confirmed_member_ids IS NULL)),CHECK((start_snapshot_at IS NULL)=(start_member_ids IS NULL)),
 UNIQUE(creator_id,create_request_key),
 EXCLUDE USING gist(room_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status IN ('HOLDING','CONFIRMED','REPLENISHING'))
);
CREATE TABLE reservation_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reservation_id uuid NOT NULL REFERENCES reservations ON DELETE CASCADE,member_id uuid NOT NULL REFERENCES members,invited_by uuid NOT NULL REFERENCES members,status text NOT NULL CHECK(status IN ('INVITED','ACCEPTED','DECLINED','REVOKED','LEFT','EXPIRED')),invitation_generation integer NOT NULL DEFAULT 1,responded_at timestamptz,UNIQUE(reservation_id,member_id));
CREATE TABLE member_claims(reservation_id uuid NOT NULL REFERENCES reservations ON DELETE CASCADE,member_id uuid NOT NULL REFERENCES members,during tstzrange NOT NULL,PRIMARY KEY(reservation_id,member_id),CHECK(NOT isempty(during) AND NOT lower_inf(during) AND NOT upper_inf(during)),EXCLUDE USING gist(member_id WITH =,during WITH &&));
CREATE TABLE reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cohort_id uuid NOT NULL REFERENCES cohorts,reservation_id uuid NOT NULL REFERENCES reservations,reporter_id uuid NOT NULL REFERENCES members,type text NOT NULL CHECK(type IN ('UNUSED','FACILITY','OTHER')),detail text NOT NULL,status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),resolution text,resolved_by uuid REFERENCES members,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE sanctions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cohort_id uuid NOT NULL REFERENCES cohorts,member_id uuid NOT NULL REFERENCES members,kind text NOT NULL CHECK(kind IN ('WARNING','RESTRICTED')),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,reason text NOT NULL,created_by uuid NOT NULL REFERENCES members,revoked_at timestamptz,CHECK(starts_at<ends_at));
CREATE TABLE audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cohort_id uuid REFERENCES cohorts,actor_id uuid REFERENCES members,action text NOT NULL,entity_type text NOT NULL,entity_id uuid,before_summary jsonb,after_summary jsonb,reason text NOT NULL DEFAULT '',decided_at timestamptz NOT NULL,request_id text NOT NULL);
CREATE TABLE command_receipts(actor_id uuid NOT NULL REFERENCES members,command_type text NOT NULL,idempotency_key text NOT NULL,request_hash text NOT NULL,status integer NOT NULL,result_summary jsonb NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(actor_id,command_type,idempotency_key));
CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('SLACK_COMMAND','MEMBER_PROVISION','NOTIFY','RETENTION')),dedupe_key text NOT NULL UNIQUE,payload jsonb NOT NULL,recipient_id uuid REFERENCES members,channel text,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','FAILED')),attempts integer NOT NULL DEFAULT 0,next_run_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_until timestamptz,lease_token uuid,result_summary jsonb,last_error_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX reservations_times ON reservations(starts_at,ends_at,status);
CREATE INDEX participation_member ON reservation_members(member_id,status);
CREATE INDEX tasks_pending ON tasks(status,next_run_at);
CREATE INDEX sanctions_member ON sanctions(member_id,ends_at);
CREATE INDEX exceptions_date ON opening_exceptions(local_date,room_id);
CREATE INDEX audits_entity ON audit_events(entity_id,decided_at);
REVOKE ALL ON ALL TABLES IN SCHEMA booking FROM PUBLIC;

INSERT INTO public.booking_migrations(name) VALUES('001_initial.sql');
END IF;
END $migration_0$;
DO $migration_1$
BEGIN
IF NOT EXISTS (SELECT 1 FROM public.booking_migrations WHERE name='002_holidays.sql') THEN
SET search_path=booking,public;
CREATE TABLE holiday_years(year integer PRIMARY KEY CHECK(year BETWEEN 2000 AND 2100), days jsonb NOT NULL, synced_at timestamptz NOT NULL);
CREATE SEQUENCE holiday_override_version;
CREATE TABLE holiday_overrides(local_date date PRIMARY KEY, name text, source_url text NOT NULL, reason text NOT NULL, version integer NOT NULL DEFAULT nextval('holiday_override_version'), updated_by uuid REFERENCES members, updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE holiday_sync(id integer PRIMARY KEY CHECK(id=1), next_run_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_attempt_at timestamptz, last_success_at timestamptz, last_error text, changed_dates jsonb NOT NULL DEFAULT '[]');
INSERT INTO holiday_sync(id) VALUES(1);
ALTER TABLE tasks DROP CONSTRAINT tasks_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK(kind IN ('SLACK_COMMAND','MEMBER_PROVISION','NOTIFY','RETENTION','HOLIDAY_SYNC'));

INSERT INTO public.booking_migrations(name) VALUES('002_holidays.sql');
END IF;
END $migration_1$;
COMMIT;
SELECT name FROM public.booking_migrations ORDER BY name;
