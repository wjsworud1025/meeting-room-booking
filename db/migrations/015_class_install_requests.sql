SET search_path TO booking,public;
CREATE TABLE IF NOT EXISTS class_install_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, venue_id uuid NOT NULL REFERENCES venues(id),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 team_id text UNIQUE, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON class_install_requests FROM PUBLIC;
