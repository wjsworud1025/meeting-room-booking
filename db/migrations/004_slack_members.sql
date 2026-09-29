SET search_path=booking,public;
ALTER TABLE members ALTER COLUMN email DROP NOT NULL;
ALTER TABLE members ADD CONSTRAINT members_identity_required CHECK(email IS NOT NULL OR (slack_workspace_id IS NOT NULL AND slack_user_id IS NOT NULL AND role='STUDENT'));
CREATE TABLE slack_workspace_classes(
 team_id text PRIMARY KEY,
 class_name text NOT NULL,
 cohort_id uuid NOT NULL REFERENCES cohorts,
 auto_enroll boolean NOT NULL DEFAULT false
);
REVOKE ALL ON slack_workspace_classes FROM PUBLIC;
