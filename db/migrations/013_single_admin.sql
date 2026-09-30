SET search_path TO booking,public;
-- Stop instead of silently revoking an administrator added after the review.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM members WHERE role='ADMIN' AND status<>'INACTIVE' AND lower(COALESCE(email,''))<>'wjsworud1025@gmail.com') THEN
  RAISE EXCEPTION 'SINGLE_ADMIN_REVIEW_REQUIRED';
 END IF;
 IF EXISTS(SELECT 1 FROM members WHERE role='ADMIN') AND (SELECT count(*) FROM members WHERE role='ADMIN' AND status='ACTIVE' AND lower(email)='wjsworud1025@gmail.com')<>1 THEN
  RAISE EXCEPTION 'PRIMARY_ADMIN_REQUIRED';
 END IF;
END $guard$;
UPDATE members SET admin_level='ADMIN',admin_scope_team=NULL WHERE role='ADMIN';
CREATE UNIQUE INDEX members_single_admin ON members ((role)) WHERE role='ADMIN' AND status<>'INACTIVE';
