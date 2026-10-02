-- Apply only AFTER 001_candidate.sql in the isolated SaaS environment.
-- Not part of automatic production migrations.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT table_name FROM information_schema.columns WHERE table_schema='booking' AND column_name='tenant_id' LOOP
  EXECUTE format('ALTER TABLE booking.%I ALTER COLUMN tenant_id SET DEFAULT saas_control.current_tenant()',r.table_name);
 END LOOP;
END $$;
CREATE FUNCTION saas_control.account_route(account uuid)
RETURNS TABLE(tenant_id uuid,member_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,saas_control AS $$
 SELECT t.id,m.id FROM saas_control.tenants t JOIN identity.accounts a ON a.id=t.owner_account_id
 JOIN booking.members m ON m.tenant_id=t.id AND m.account_id=a.id AND m.role='ADMIN' AND m.status='ACTIVE'
 WHERE a.id=account AND a.status='ACTIVE' AND NOT a.must_change_password AND t.status='ACTIVE'
$$;
REVOKE ALL ON FUNCTION saas_control.account_route(uuid) FROM PUBLIC;
CREATE FUNCTION saas_control.create_space(account uuid,space_name text,rules jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,saas_control AS $$
DECLARE a identity.accounts%ROWTYPE; t uuid; m uuid;
BEGIN
 IF length(trim(space_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_SPACE_NAME'; END IF;
 SELECT * INTO STRICT a FROM identity.accounts WHERE id=account FOR UPDATE;
 IF a.status='DISABLED' OR a.must_change_password THEN RAISE EXCEPTION 'ACCOUNT_NOT_READY'; END IF;
 SELECT id INTO t FROM saas_control.tenants WHERE owner_account_id=a.id AND status<>'DELETED';
 IF t IS NOT NULL THEN RETURN t; END IF;
 INSERT INTO saas_control.accounts(id,display_name) VALUES(a.id,a.login_id) ON CONFLICT(id) DO NOTHING;
 INSERT INTO saas_control.tenants(name,owner_account_id) VALUES(trim(space_name),a.id) RETURNING id INTO t;
 INSERT INTO booking.members(tenant_id,account_id,display_name,role,status) VALUES(t,a.id,a.login_id,'ADMIN','ACTIVE') RETURNING id INTO m;
 INSERT INTO booking.settings(tenant_id,id,facility_name,bootstrap_admin_id) VALUES(t,1,trim(space_name),m);
 INSERT INTO booking.venues(tenant_id,name) VALUES(t,'기본 수업장');
 INSERT INTO booking.policy_versions(tenant_id,effective_on,rules_json,created_by) VALUES(t,'2000-01-01',rules || '{"rooms":{}}'::jsonb,m);
 INSERT INTO booking.holiday_sync(tenant_id,id) VALUES(t,1);
 UPDATE identity.accounts SET status='ACTIVE' WHERE id=a.id;
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION saas_control.create_space(uuid,text,jsonb) FROM PUBLIC;

ALTER TABLE booking.members DROP CONSTRAINT members_identity_required;
ALTER TABLE booking.members ADD CONSTRAINT members_identity_required CHECK(
 email IS NOT NULL OR (role='STUDENT' AND slack_workspace_id IS NOT NULL AND slack_user_id IS NOT NULL)
 OR (role='ADMIN' AND ((admin_slack_team IS NOT NULL AND admin_slack_user IS NOT NULL) OR account_id IS NOT NULL))
);
