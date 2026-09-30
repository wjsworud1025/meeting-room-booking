SET search_path TO booking,public;
CREATE TABLE slack_web_links(
 token_hash text PRIMARY KEY,
 team_id text NOT NULL,
 user_id text NOT NULL,
 member_id uuid NOT NULL REFERENCES members,
 access_version integer NOT NULL,
 destination text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX slack_web_links_expiry ON slack_web_links(expires_at);
