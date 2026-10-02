-- Independent login identities. Pending accounts cannot access booking data.
CREATE SCHEMA identity;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
CREATE TABLE identity.accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), login_id text NOT NULL UNIQUE CHECK(login_id ~ '^[a-z0-9_]{4,32}$'),
 password_hash text NOT NULL, must_change_password boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','DISABLED')),
 version integer NOT NULL DEFAULT 1, failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- The complete legacy dataset has one owner until the tenant cutover.
CREATE TABLE identity.legacy_owner (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 account_id uuid NOT NULL UNIQUE REFERENCES identity.accounts,
 member_id uuid NOT NULL UNIQUE REFERENCES booking.members,
 assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.sessions (
 token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES identity.accounts ON DELETE CASCADE,
 account_version integer NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON identity.sessions(account_id);
CREATE INDEX ON identity.sessions(expires_at);
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC;
