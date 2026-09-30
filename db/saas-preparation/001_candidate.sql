-- Rehearsal only. NOT a production migration; run inside a caller-owned transaction.
SET LOCAL search_path=booking,public;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
 THEN RAISE EXCEPTION 'SAAS_MIGRATION_ROLE_REQUIRED'; END IF;
END $$;
CREATE SCHEMA saas_control;
REVOKE ALL ON SCHEMA saas_control FROM PUBLIC;
CREATE TABLE saas_control.accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_subject uuid UNIQUE,
 display_name text NOT NULL, email text, status text NOT NULL DEFAULT 'ACTIVE'
 CHECK(status IN ('ACTIVE','INACTIVE')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE saas_control.tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 owner_account_id uuid NOT NULL REFERENCES saas_control.accounts,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','DELETION_PENDING','DELETED')),
 auth_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenants_one_owned_space ON saas_control.tenants(owner_account_id) WHERE status<>'DELETED';
CREATE TABLE saas_control.preparation (
 id integer PRIMARY KEY CHECK(id=1), first_tenant_id uuid NOT NULL REFERENCES saas_control.tenants,
 version text NOT NULL, prepared_at timestamptz NOT NULL DEFAULT now()
);
DO $bootstrap$
DECLARE a uuid; t uuid; m booking.members%ROWTYPE;
BEGIN
 IF (SELECT count(*) FROM booking.members WHERE role='ADMIN' AND status<>'INACTIVE')<>1
 OR (SELECT count(*) FROM booking.members WHERE role='ADMIN' AND status='ACTIVE')<>1
 THEN RAISE EXCEPTION 'SAAS_SINGLE_ACTIVE_OWNER_REQUIRED'; END IF;
 SELECT * INTO STRICT m FROM booking.members WHERE role='ADMIN' AND status='ACTIVE';
 IF to_regclass('identity.legacy_owner') IS NOT NULL THEN
  SELECT account_id INTO a FROM identity.legacy_owner WHERE member_id=m.id;
  IF EXISTS(SELECT 1 FROM identity.legacy_owner) AND a IS NULL THEN
   RAISE EXCEPTION 'SAAS_LEGACY_OWNER_MISMATCH';
  END IF;
 END IF;
 a:=COALESCE(a,gen_random_uuid());
 INSERT INTO saas_control.accounts(id,auth_subject,display_name,email)
 VALUES(a,m.auth_user_id,m.display_name,m.email);
 INSERT INTO saas_control.tenants(name,owner_account_id)
 SELECT facility_name,a FROM booking.settings WHERE id=1 RETURNING id INTO STRICT t;
 INSERT INTO saas_control.preparation VALUES(1,t,'v1.0-rehearsal',now());
END $bootstrap$;
ALTER TABLE booking.members ADD COLUMN account_id uuid REFERENCES saas_control.accounts;
UPDATE booking.members SET account_id=(SELECT owner_account_id FROM saas_control.tenants) WHERE role='ADMIN' AND status='ACTIVE';
-- No default tenant: legacy writes must fail rather than be assigned to another customer.
DO $scope$
DECLARE n text; t uuid; tables text[] := ARRAY[
 'settings','venues','cohorts','rooms','policy_versions','opening_exceptions','members',
 'reservations','reservation_members','member_claims','reports','sanctions','audit_events',
 'command_receipts','tasks','holiday_overrides','holiday_sync','slack_installations',
 'slack_workspace_classes','slack_web_links','class_install_requests'];
BEGIN
 SELECT first_tenant_id INTO STRICT t FROM saas_control.preparation;
 FOREACH n IN ARRAY tables LOOP
  EXECUTE format('ALTER TABLE booking.%I ADD COLUMN tenant_id uuid REFERENCES saas_control.tenants',n);
  EXECUTE format('UPDATE booking.%I SET tenant_id=$1',n) USING t;
  EXECUTE format('ALTER TABLE booking.%I ALTER COLUMN tenant_id SET NOT NULL',n);
  EXECUTE format('CREATE INDEX ON booking.%I(tenant_id)',n);
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='booking' AND table_name=n AND column_name='id') THEN
   EXECUTE format('CREATE UNIQUE INDEX ON booking.%I(tenant_id,id)',n);
  END IF;
 END LOOP;
END $scope$;
-- Preserve original FK delete actions; add tenant checks for every existing customer FK.
-- Deferred NO ACTION lets original SET NULL / CASCADE actions complete normally.
DO $references$
DECLARE r record; source_cols text; target_cols text;
BEGIN
 FOR r IN SELECT c.* FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid
 JOIN pg_class d ON d.oid=c.confrelid JOIN pg_namespace ns ON ns.oid=s.relnamespace
 JOIN pg_namespace nd ON nd.oid=d.relnamespace
 WHERE c.contype='f' AND ns.nspname='booking' AND nd.nspname='booking'
 LOOP
  SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.ord) INTO source_cols
  FROM unnest(r.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=r.conrelid AND a.attnum=k.num;
  SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.ord) INTO target_cols
  FROM unnest(r.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=r.confrelid AND a.attnum=k.num;
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s(tenant_id,%s)', 'saas_ref_'||r.confrelid||'_'||array_to_string(r.confkey,'_'),r.confrelid::regclass,target_cols);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(tenant_id,%s) REFERENCES %s(tenant_id,%s) DEFERRABLE INITIALLY IMMEDIATE',r.conrelid::regclass,'saas_fk_'||r.oid,source_cols,r.confrelid::regclass,target_cols);
 END LOOP;
END $references$;
ALTER TABLE booking.settings DROP CONSTRAINT settings_pkey;
ALTER TABLE booking.settings ADD PRIMARY KEY(tenant_id);
ALTER TABLE booking.holiday_sync DROP CONSTRAINT holiday_sync_pkey;
ALTER TABLE booking.holiday_sync ADD PRIMARY KEY(tenant_id);
ALTER TABLE booking.holiday_overrides DROP CONSTRAINT holiday_overrides_pkey;
ALTER TABLE booking.holiday_overrides ADD PRIMARY KEY(tenant_id,local_date);
ALTER TABLE booking.venues DROP CONSTRAINT venues_name_key;
ALTER TABLE booking.venues ADD UNIQUE(tenant_id,name);
ALTER TABLE booking.policy_versions DROP CONSTRAINT policy_versions_effective_on_key;
ALTER TABLE booking.policy_versions ADD UNIQUE(tenant_id,effective_on);
ALTER TABLE booking.tasks DROP CONSTRAINT tasks_dedupe_key_key;
ALTER TABLE booking.tasks ADD UNIQUE(tenant_id,dedupe_key);
ALTER TABLE booking.members DROP CONSTRAINT members_email_key;
ALTER TABLE booking.members ADD UNIQUE(tenant_id,email);
ALTER TABLE booking.members DROP CONSTRAINT members_auth_user_id_key;
ALTER TABLE booking.members ADD UNIQUE(tenant_id,auth_user_id);
DROP INDEX booking.members_single_admin;
CREATE UNIQUE INDEX members_single_admin ON booking.members(tenant_id) WHERE role='ADMIN' AND status<>'INACTIVE';
-- Workspace IDs remain globally unique; this is the authoritative routing registry.
CREATE TABLE saas_control.workspace_routes (
 team_id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES saas_control.tenants,
 UNIQUE(tenant_id,team_id)
);
INSERT INTO saas_control.workspace_routes(team_id,tenant_id)
 SELECT team_id,tenant_id FROM booking.slack_installations
 UNION SELECT team_id,tenant_id FROM booking.slack_workspace_classes
 UNION SELECT team_id,tenant_id FROM booking.class_install_requests WHERE team_id IS NOT NULL;
ALTER TABLE booking.slack_installations ADD FOREIGN KEY(tenant_id,team_id) REFERENCES saas_control.workspace_routes(tenant_id,team_id);
ALTER TABLE booking.slack_workspace_classes ADD FOREIGN KEY(tenant_id,team_id) REFERENCES saas_control.workspace_routes(tenant_id,team_id);
ALTER TABLE booking.class_install_requests ADD FOREIGN KEY(tenant_id,team_id) REFERENCES saas_control.workspace_routes(tenant_id,team_id);
ALTER TABLE booking.slack_web_links ADD FOREIGN KEY(tenant_id,team_id) REFERENCES saas_control.workspace_routes(tenant_id,team_id);
-- Drop exclusion constraints by catalog name (PostgreSQL-generated names vary).
DO $exclusions$ DECLARE r record; BEGIN
 FOR r IN SELECT conrelid::regclass tbl,conname FROM pg_constraint
 WHERE contype='x' AND conrelid IN ('booking.reservations'::regclass,'booking.member_claims'::regclass)
 LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.tbl,r.conname); END LOOP;
END $exclusions$;
ALTER TABLE booking.reservations ADD EXCLUDE USING gist(tenant_id WITH =,room_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status IN ('HOLDING','CONFIRMED','REPLENISHING'));
ALTER TABLE booking.member_claims ADD EXCLUDE USING gist(tenant_id WITH =,member_id WITH =,during WITH &&);
-- Only returns the current active tenant ID. No customer data, fixed search path.
CREATE FUNCTION saas_control.current_tenant() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,saas_control AS $$
 SELECT id FROM saas_control.tenants
 WHERE id=NULLIF(current_setting('booking.tenant_id',true),'')::uuid AND status='ACTIVE'
$$;
REVOKE ALL ON FUNCTION saas_control.current_tenant() FROM PUBLIC;
DO $rls$ DECLARE r record; BEGIN
 FOR r IN SELECT table_name FROM information_schema.columns WHERE table_schema='booking' AND column_name='tenant_id'
 LOOP
  EXECUTE format('ALTER TABLE booking.%I ENABLE ROW LEVEL SECURITY',r.table_name);
  EXECUTE format('ALTER TABLE booking.%I FORCE ROW LEVEL SECURITY',r.table_name);
  EXECUTE format('CREATE POLICY tenant_scope ON booking.%I USING(tenant_id=saas_control.current_tenant()) WITH CHECK(tenant_id=saas_control.current_tenant())',r.table_name);
 END LOOP;
END $rls$;
REVOKE ALL ON ALL TABLES IN SCHEMA saas_control FROM PUBLIC;

-- Enforce OWNER/member agreement at commit, allowing atomic ownership transfer.
CREATE FUNCTION saas_control.check_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,saas_control AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM saas_control.tenants t WHERE t.status<>'DELETED' AND
  (SELECT count(*) FROM booking.members m WHERE m.tenant_id=t.id AND m.role='ADMIN'
   AND m.status='ACTIVE' AND m.account_id=t.owner_account_id)<>1)
 OR EXISTS(SELECT 1 FROM booking.members m JOIN saas_control.tenants t ON t.id=m.tenant_id
  WHERE m.role='ADMIN' AND m.status='ACTIVE' AND m.account_id IS DISTINCT FROM t.owner_account_id)
 THEN RAISE EXCEPTION 'SAAS_OWNER_MEMBER_MISMATCH'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION saas_control.check_owner() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER tenant_owner_check AFTER INSERT OR UPDATE OR DELETE ON saas_control.tenants
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION saas_control.check_owner();
CREATE CONSTRAINT TRIGGER member_owner_check AFTER INSERT OR UPDATE OR DELETE ON booking.members
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION saas_control.check_owner();
-- Also inspect pre-existing bootstrap rows, since constraint triggers only see later writes.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM saas_control.tenants t WHERE NOT EXISTS(SELECT 1 FROM booking.members m
 WHERE m.tenant_id=t.id AND m.account_id=t.owner_account_id AND m.role='ADMIN' AND m.status='ACTIVE'))
 THEN RAISE EXCEPTION 'SAAS_OWNER_MEMBER_MISMATCH'; END IF;
END $$;
