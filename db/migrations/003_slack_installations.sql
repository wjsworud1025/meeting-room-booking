SET search_path=booking,public;
CREATE TABLE slack_installations(
 team_id text PRIMARY KEY,
 team_name text NOT NULL,
 app_id text NOT NULL,
 bot_user_id text NOT NULL,
 bot_token_encrypted text NOT NULL,
 installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz
);
REVOKE ALL ON slack_installations FROM PUBLIC;
