-- Customer lifecycle. Callers provide a server-authenticated account ID after reauthentication.
ALTER TABLE saas_control.tenants ADD COLUMN delete_after timestamptz;
CREATE TABLE saas_control.transfers(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES saas_control.tenants,from_account uuid NOT NULL REFERENCES identity.accounts,to_account uuid NOT NULL REFERENCES identity.accounts,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','CANCELLED')),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours');
CREATE UNIQUE INDEX one_pending_transfer ON saas_control.transfers(tenant_id) WHERE status='PENDING';
CREATE TABLE saas_control.exports(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES saas_control.tenants,owner_id uuid NOT NULL REFERENCES identity.accounts,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','FAILED')),lease uuid,lease_until timestamptz,data bytea,expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE saas_control.deletion_ledger(tenant_id uuid PRIMARY KEY,deleted_at timestamptz NOT NULL);
CREATE TABLE saas_control.space_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES saas_control.tenants,action text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON saas_control.transfers,saas_control.exports,saas_control.deletion_ledger,saas_control.space_events FROM PUBLIC;
CREATE FUNCTION saas_control.space_info(account uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('space',(SELECT jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'deleteAfter',t.delete_after,'futureReservations',(SELECT count(*) FROM booking.reservations r WHERE r.tenant_id=t.id AND r.ends_at>now() AND r.status NOT IN ('CANCELLED','ENDED'))) FROM saas_control.tenants t WHERE t.owner_account_id=account AND t.status<>'DELETED'),
 'exports',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'status',e.status,'expiresAt',e.expires_at) ORDER BY e.created_at DESC) FROM saas_control.exports e JOIN saas_control.tenants t ON t.id=e.tenant_id WHERE t.owner_account_id=account AND e.owner_id=account AND e.expires_at>now()),'[]'),
 'incoming',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',t.name,'expiresAt',r.expires_at)) FROM saas_control.transfers r JOIN saas_control.tenants t ON t.id=r.tenant_id WHERE r.to_account=account AND r.status='PENDING' AND r.expires_at>now() AND t.status='ACTIVE'),'[]'),
 'notices',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'message','관리자 소유권 이전이 완료되었습니다.')) FROM saas_control.transfers r WHERE r.status='ACCEPTED' AND (r.from_account=account OR r.to_account=account)),'[]'),
 'outgoing',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'loginId',a.login_id,'expiresAt',r.expires_at)) FROM saas_control.transfers r JOIN saas_control.tenants t ON t.id=r.tenant_id JOIN identity.accounts a ON a.id=r.to_account WHERE t.owner_account_id=account AND r.status='PENDING' AND r.expires_at>now()),'[]'))
$$;
CREATE FUNCTION saas_control.space_action(account uuid,action text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t saas_control.tenants%ROWTYPE; r saas_control.transfers%ROWTYPE; target identity.accounts%ROWTYPE; old_member uuid; new_member uuid; rid uuid;
BEGIN
 PERFORM 1 FROM identity.accounts WHERE id=account AND status<>'DISABLED' AND NOT must_change_password AND version=(input->>'accountVersion')::integer FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_READY'; END IF;
 IF action='transfer.accept' THEN
  SELECT * INTO STRICT r FROM saas_control.transfers WHERE id=(input->>'id')::uuid AND to_account=account;
  SELECT * INTO STRICT t FROM saas_control.tenants WHERE id=r.tenant_id FOR UPDATE;
  SELECT * INTO STRICT r FROM saas_control.transfers WHERE id=r.id FOR UPDATE;
  SELECT * INTO STRICT target FROM identity.accounts WHERE id=account FOR UPDATE;
  IF r.status='ACCEPTED' AND t.owner_account_id=account THEN RETURN '{"accepted":true}'; END IF;
  IF r.status<>'PENDING' OR r.expires_at<=now() OR t.status<>'ACTIVE' OR t.owner_account_id<>r.from_account THEN RAISE EXCEPTION 'TRANSFER_EXPIRED'; END IF;
  IF EXISTS(SELECT 1 FROM saas_control.tenants WHERE owner_account_id=account AND status<>'DELETED') THEN RAISE EXCEPTION 'SPACE_ALREADY_OWNED'; END IF;
  SELECT id INTO STRICT old_member FROM booking.members WHERE tenant_id=t.id AND role='ADMIN' AND status='ACTIVE';
  UPDATE booking.members SET status='INACTIVE',inactive_at=now(),access_version=access_version+1 WHERE id=old_member;
  INSERT INTO saas_control.accounts(id,display_name) VALUES(account,target.login_id) ON CONFLICT(id) DO NOTHING;
  INSERT INTO booking.members(tenant_id,account_id,display_name,role,status) VALUES(t.id,account,target.login_id,'ADMIN','ACTIVE') RETURNING id INTO new_member;
  UPDATE saas_control.tenants SET owner_account_id=account,auth_version=auth_version+1 WHERE id=t.id;
  UPDATE booking.settings SET bootstrap_admin_id=new_member WHERE tenant_id=t.id;
  DELETE FROM identity.legacy_owner WHERE member_id=old_member;
  DELETE FROM identity.sessions WHERE account_id IN (r.from_account,account);
  DELETE FROM booking.slack_web_links WHERE tenant_id=t.id;
  DELETE FROM saas_control.exports WHERE tenant_id=t.id;
  UPDATE identity.accounts SET status='ACTIVE' WHERE id=account;
  UPDATE saas_control.transfers SET status=CASE WHEN id=r.id THEN 'ACCEPTED' ELSE 'CANCELLED' END WHERE tenant_id=t.id AND status='PENDING';
  INSERT INTO saas_control.space_events(tenant_id,action) VALUES(t.id,'transfer.accepted');
  RETURN '{"accepted":true}';
 END IF;
 SELECT * INTO STRICT t FROM saas_control.tenants WHERE owner_account_id=account AND status IN ('ACTIVE','DELETION_PENDING') FOR UPDATE;
 IF action='export.create' THEN
  rid:=(input->>'id')::uuid;
  IF EXISTS(SELECT 1 FROM saas_control.exports WHERE id=rid AND tenant_id=t.id AND owner_id=account) THEN RETURN jsonb_build_object('id',rid); END IF;
  IF (SELECT count(*) FROM saas_control.exports WHERE tenant_id=t.id AND expires_at>now() AND status<>'FAILED')>=3 THEN RAISE EXCEPTION 'EXPORT_LIMIT'; END IF;
  INSERT INTO saas_control.exports(id,tenant_id,owner_id) VALUES(rid,t.id,account);
 ELSIF action='transfer.create' THEN
  IF t.status<>'ACTIVE' THEN RAISE EXCEPTION 'SPACE_PAUSED'; END IF;
  SELECT * INTO STRICT target FROM identity.accounts WHERE login_id=input->>'loginId' AND id<>account AND status<>'DISABLED' AND NOT must_change_password FOR UPDATE;
  IF EXISTS(SELECT 1 FROM saas_control.tenants WHERE owner_account_id=target.id AND status<>'DELETED') THEN RAISE EXCEPTION 'SPACE_ALREADY_OWNED'; END IF;
  rid:=(input->>'id')::uuid;
  IF EXISTS(SELECT 1 FROM saas_control.transfers WHERE id=rid AND tenant_id=t.id AND to_account=target.id) THEN RETURN jsonb_build_object('id',rid); END IF;
  UPDATE saas_control.transfers SET status='CANCELLED' WHERE tenant_id=t.id AND status='PENDING';
  INSERT INTO saas_control.transfers(id,tenant_id,from_account,to_account) VALUES(rid,t.id,account,target.id);
 ELSIF action='transfer.cancel' THEN
  UPDATE saas_control.transfers SET status='CANCELLED' WHERE id=(input->>'id')::uuid AND tenant_id=t.id AND status='PENDING';
 ELSIF action='delete.request' THEN
  IF input->>'name' IS DISTINCT FROM t.name THEN RAISE EXCEPTION 'SPACE_NAME_MISMATCH'; END IF;
  IF t.status='DELETION_PENDING' THEN RETURN jsonb_build_object('deleteAfter',t.delete_after); END IF;
  UPDATE booking.settings SET config_version=config_version+1 WHERE tenant_id=t.id;
  UPDATE saas_control.tenants SET status='DELETION_PENDING',delete_after=now()+interval '7 days',auth_version=auth_version+1 WHERE id=t.id;
  UPDATE saas_control.transfers SET status='CANCELLED' WHERE tenant_id=t.id AND status='PENDING';
  DELETE FROM booking.slack_web_links WHERE tenant_id=t.id;
  UPDATE booking.tasks SET status='FAILED',lease_until=NULL,last_error_code='SPACE_DELETION_PENDING' WHERE tenant_id=t.id AND status IN ('PENDING','RUNNING');
 ELSIF action='delete.cancel' THEN
  IF t.status<>'DELETION_PENDING' OR t.delete_after<=now() THEN RAISE EXCEPTION 'DELETE_NOT_CANCELLABLE'; END IF;
  UPDATE saas_control.tenants SET status='ACTIVE',delete_after=NULL,auth_version=auth_version+1 WHERE id=t.id;
 ELSE RAISE EXCEPTION 'UNKNOWN_SPACE_ACTION'; END IF;
 INSERT INTO saas_control.space_events(tenant_id,action) VALUES(t.id,action);
 RETURN jsonb_build_object('id',rid,'completed',true);
END $$;
CREATE FUNCTION saas_control.claim_export() RETURNS TABLE(id uuid,lease uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE saas_control.exports e SET status='RUNNING',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds' WHERE e.id=(
 SELECT q.id FROM saas_control.exports q JOIN saas_control.tenants t ON t.id=q.tenant_id WHERE t.status IN ('ACTIVE','DELETION_PENDING') AND t.owner_account_id=q.owner_id AND q.expires_at>clock_timestamp() AND (q.status='PENDING' OR q.status='RUNNING' AND q.lease_until<clock_timestamp()) ORDER BY q.created_at FOR UPDATE OF q SKIP LOCKED LIMIT 1) RETURNING e.id,e.lease
$$;
CREATE FUNCTION saas_control.finish_export(request uuid,token uuid,archive bytea) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF octet_length(archive)>20971520 THEN RAISE EXCEPTION 'EXPORT_TOO_LARGE'; END IF;
 UPDATE saas_control.exports e SET status=CASE WHEN archive IS NULL THEN 'FAILED' ELSE 'DONE' END,data=archive,lease=NULL,lease_until=NULL FROM saas_control.tenants t
 WHERE e.id=request AND e.lease=token AND e.status='RUNNING' AND e.lease_until>clock_timestamp() AND e.expires_at>clock_timestamp() AND t.id=e.tenant_id AND t.owner_account_id=e.owner_id AND t.status IN ('ACTIVE','DELETION_PENDING');
 RETURN FOUND;
END $$;
CREATE FUNCTION saas_control.download_export(account uuid,request uuid,expected_version integer) RETURNS bytea LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e.data FROM saas_control.exports e JOIN saas_control.tenants t ON t.id=e.tenant_id WHERE e.id=request AND e.owner_id=account AND t.owner_account_id=account AND t.status IN ('ACTIVE','DELETION_PENDING') AND e.status='DONE' AND e.expires_at>now() AND EXISTS(SELECT 1 FROM identity.accounts a WHERE a.id=account AND a.version=expected_version AND a.status<>'DISABLED')
$$;
CREATE FUNCTION saas_control.export_snapshot(request uuid,token uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid; result jsonb:='{}'; row_data jsonb; entry record;
BEGIN
 SELECT e.tenant_id INTO STRICT tenant FROM saas_control.exports e JOIN saas_control.tenants t ON t.id=e.tenant_id WHERE e.id=request AND e.lease=token AND e.status='RUNNING' AND e.lease_until>clock_timestamp() AND e.expires_at>clock_timestamp() AND t.owner_account_id=e.owner_id AND t.status IN ('ACTIVE','DELETION_PENDING');
 FOR entry IN SELECT * FROM (VALUES
 ('settings','facility_name,timezone'),('venues','id,name'),('rooms','id,name,active,venue_id'),('cohorts','id,name,starts_on,ends_on,inactive_at,venue_id'),
 ('members','id,display_name,email,class_name,cohort_id,role,status,created_at'),('reservations','id,cohort_id,room_id,creator_id,organizer_id,starts_at,ends_at,status,capacity_snapshot,minimum_snapshot,created_at'),
 ('reservation_members','id,reservation_id,member_id,status,responded_at'),('policy_versions','id,effective_on,rules_json,created_at'),('opening_exceptions','id,local_date,room_id,kind,local_start,local_end,reason'),
 ('holiday_overrides','local_date,name,source_url,reason'),('reports','id,reservation_id,reporter_id,type,detail,status,resolution,created_at'),('sanctions','id,member_id,kind,starts_at,ends_at,reason,revoked_at'),('audit_events','id,actor_id,action,reason,decided_at')) v(tab,cols) LOOP
 EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT %s FROM booking.%I WHERE tenant_id=$1) x',entry.cols,entry.tab) INTO row_data USING tenant;
 result:=result||jsonb_build_object(entry.tab,row_data);
 END LOOP;
 RETURN jsonb_build_object('manifest',jsonb_build_object('schemaVersion','1.0','generatedAt',now(),'timezone','Asia/Seoul'),'tables',result);
END $$;
CREATE FUNCTION saas_control.purge_spaces() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t record; tab text; count_deleted integer:=0; tombstone uuid;
BEGIN
 DELETE FROM saas_control.exports WHERE expires_at<=clock_timestamp();
 UPDATE saas_control.transfers SET status='CANCELLED' WHERE status='PENDING' AND expires_at<=clock_timestamp();
 FOR t IN SELECT id FROM saas_control.tenants WHERE status='DELETION_PENDING' AND delete_after<=clock_timestamp() FOR UPDATE SKIP LOCKED LIMIT 5 LOOP
 DELETE FROM identity.legacy_owner WHERE member_id IN (SELECT id FROM booking.members WHERE tenant_id=t.id);
 DELETE FROM saas_control.exports WHERE tenant_id=t.id;
 DELETE FROM saas_control.transfers WHERE tenant_id=t.id;
 DELETE FROM saas_control.space_events WHERE tenant_id=t.id;
 UPDATE saas_control.tenants SET status='DELETED',name='삭제된 공간' WHERE id=t.id;
 FOREACH tab IN ARRAY ARRAY['member_claims','reservation_members','reports','sanctions','audit_events','command_receipts','tasks','slack_web_links','class_install_requests','opening_exceptions','reservations','policy_versions','holiday_overrides','holiday_sync','settings','slack_workspace_classes','slack_installations','members','cohorts','rooms','venues'] LOOP
  EXECUTE format('DELETE FROM booking.%I WHERE tenant_id=$1',tab) USING t.id;
 END LOOP;
 DELETE FROM saas_control.workspace_routes WHERE tenant_id=t.id;
 INSERT INTO saas_control.accounts(id,display_name) VALUES(gen_random_uuid(),'삭제됨') RETURNING id INTO tombstone;
 UPDATE saas_control.tenants SET owner_account_id=tombstone WHERE id=t.id;
 INSERT INTO saas_control.deletion_ledger(tenant_id,deleted_at) VALUES(t.id,clock_timestamp()) ON CONFLICT DO NOTHING;
 count_deleted:=count_deleted+1;
 END LOOP;
 RETURN count_deleted;
END $$;
REVOKE ALL ON FUNCTION saas_control.space_info(uuid),saas_control.space_action(uuid,text,jsonb),saas_control.claim_export(),saas_control.finish_export(uuid,uuid,bytea),saas_control.download_export(uuid,uuid,integer),saas_control.export_snapshot(uuid,uuid),saas_control.purge_spaces() FROM PUBLIC;

CREATE FUNCTION saas_control.expire_lifecycle() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM saas_control.exports WHERE expires_at<=clock_timestamp();
 UPDATE saas_control.transfers SET status='CANCELLED' WHERE status='PENDING' AND expires_at<=clock_timestamp();
$$;
REVOKE ALL ON FUNCTION saas_control.expire_lifecycle() FROM PUBLIC;
