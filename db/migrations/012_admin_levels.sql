SET search_path TO booking,public;
ALTER TABLE members ADD COLUMN admin_level text NOT NULL DEFAULT 'ADMIN' CHECK(admin_level IN ('MAINTAINER','ADMIN','SUB_ADMIN'));
ALTER TABLE members ADD COLUMN admin_scope_team text;
ALTER TABLE members ADD CONSTRAINT sub_admin_scope CHECK(admin_level<>'SUB_ADMIN' OR (role='ADMIN' AND admin_scope_team IS NOT NULL));
UPDATE members SET admin_level='MAINTAINER',account_version=account_version+1 WHERE role='ADMIN' AND status='ACTIVE' AND lower(email)='wjsworud1025@gmail.com';
