BEGIN;
SET LOCAL lock_timeout='5s';
CREATE ROLE booking_maintenance_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE booking_maintenance_operator NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE SCHEMA maintenance;
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC;
CREATE TABLE maintenance.operations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action text NOT NULL,login_id text NOT NULL,tenant_id uuid NOT NULL,affected_rows bigint NOT NULL,reason text NOT NULL,performed_by text NOT NULL DEFAULT session_user,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE VIEW maintenance.customers WITH(security_barrier=true) AS
SELECT t.id tenant_id,a.login_id,t.name,t.status,
(SELECT count(*) FROM booking.members m WHERE m.tenant_id=t.id) members,
(SELECT count(*) FROM booking.rooms r WHERE r.tenant_id=t.id) rooms,
(SELECT count(*) FROM booking.reservations r WHERE r.tenant_id=t.id) reservations
FROM saas_control.tenants t JOIN identity.accounts a ON a.id=t.owner_account_id;
CREATE VIEW maintenance.members WITH(security_barrier=true) AS SELECT m.tenant_id,c.login_id,m.id,m.display_name,m.class_name,m.role,m.status FROM booking.members m JOIN maintenance.customers c USING(tenant_id);
CREATE VIEW maintenance.rooms WITH(security_barrier=true) AS SELECT r.tenant_id,c.login_id,r.id,r.name,r.active FROM booking.rooms r JOIN maintenance.customers c USING(tenant_id);
CREATE VIEW maintenance.reservations WITH(security_barrier=true) AS SELECT r.tenant_id,c.login_id,r.id,r.room_id,r.starts_at,r.ends_at,r.status FROM booking.reservations r JOIN maintenance.customers c USING(tenant_id);
CREATE VIEW maintenance.history WITH(security_barrier=true) AS SELECT e.tenant_id,c.login_id,e.id,e.action,e.decided_at FROM booking.audit_events e JOIN maintenance.customers c USING(tenant_id);
REVOKE ALL ON ALL TABLES IN SCHEMA maintenance FROM PUBLIC;
GRANT USAGE ON SCHEMA maintenance TO booking_maintenance_reader,booking_maintenance_operator;
GRANT SELECT ON maintenance.customers,maintenance.members,maintenance.rooms,maintenance.reservations,maintenance.history TO booking_maintenance_reader;
CREATE FUNCTION maintenance.clear_history(target_login text,operation_reason text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid; removed bigint;
BEGIN
 IF length(trim(operation_reason))<5 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 SELECT t.id INTO STRICT target FROM saas_control.tenants t JOIN identity.accounts a ON a.id=t.owner_account_id WHERE a.login_id=target_login AND t.status='ACTIVE' FOR UPDATE OF t;
 DELETE FROM booking.audit_events WHERE tenant_id=target AND decided_at<=statement_timestamp();
 GET DIAGNOSTICS removed=ROW_COUNT;
 INSERT INTO maintenance.operations(action,login_id,tenant_id,affected_rows,reason) VALUES('CLEAR_HISTORY',target_login,target,removed,operation_reason);
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION maintenance.clear_history(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance.clear_history(text,text) TO booking_maintenance_operator;
COMMIT;
