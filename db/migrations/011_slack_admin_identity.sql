SET search_path TO booking,public;
ALTER TABLE members ADD COLUMN admin_slack_team text;
ALTER TABLE members ADD COLUMN admin_slack_user text;
ALTER TABLE members ADD CONSTRAINT admin_slack_pair CHECK ((admin_slack_team IS NULL AND admin_slack_user IS NULL) OR (role='ADMIN' AND admin_slack_team IS NOT NULL AND admin_slack_user IS NOT NULL));
CREATE UNIQUE INDEX members_admin_slack_identity ON members(admin_slack_team,admin_slack_user) WHERE role='ADMIN';
UPDATE members SET admin_slack_team=slack_workspace_id,admin_slack_user=slack_user_id WHERE role='ADMIN' AND slack_workspace_id IS NOT NULL AND slack_user_id IS NOT NULL;
ALTER TABLE members DROP CONSTRAINT members_identity_required;
ALTER TABLE members ADD CONSTRAINT members_identity_required CHECK(email IS NOT NULL OR (slack_workspace_id IS NOT NULL AND slack_user_id IS NOT NULL AND role='STUDENT') OR (role='ADMIN' AND admin_slack_team IS NOT NULL AND admin_slack_user IS NOT NULL));
