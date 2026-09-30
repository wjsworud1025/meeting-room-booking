-- Isolated SaaS environment only; follows 001 and 002.
CREATE FUNCTION saas_control.install_preview(hash text) RETURNS TABLE(id uuid,name text,venue_name text,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.id,r.name,v.name,r.expires_at FROM booking.class_install_requests r
 JOIN booking.venues v ON v.id=r.venue_id JOIN saas_control.tenants t ON t.id=r.tenant_id
 WHERE r.token_hash=hash AND r.revoked_at IS NULL AND r.completed_at IS NULL AND r.expires_at>now() AND t.status='ACTIVE'
$$;
CREATE FUNCTION saas_control.connect_install(hash text,team text,team_name text,app text,bot text,ciphertext text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r booking.class_install_requests%ROWTYPE; c uuid;
BEGIN
 SELECT q.* INTO STRICT r FROM booking.class_install_requests q JOIN saas_control.tenants t ON t.id=q.tenant_id
 WHERE q.token_hash=hash AND q.revoked_at IS NULL AND q.completed_at IS NULL AND q.expires_at>now() AND t.status='ACTIVE' FOR UPDATE OF q;
 -- Global PK is the race-safe ownership boundary. Never overwrite another installation.
 INSERT INTO saas_control.workspace_routes(team_id,tenant_id) VALUES(team,r.tenant_id);
 INSERT INTO booking.slack_installations(tenant_id,team_id,team_name,app_id,bot_user_id,bot_token_encrypted) VALUES(r.tenant_id,team,team_name,app,bot,ciphertext);
 INSERT INTO booking.cohorts(tenant_id,name,starts_on,ends_on,venue_id) VALUES(r.tenant_id,r.name,(now() AT TIME ZONE 'Asia/Seoul')::date,'9999-12-31',r.venue_id) RETURNING id INTO c;
 INSERT INTO booking.slack_workspace_classes(tenant_id,team_id,class_name,cohort_id,auto_enroll) VALUES(r.tenant_id,team,r.name,c,true);
 UPDATE booking.class_install_requests SET team_id=team,completed_at=now() WHERE id=r.id;
END $$;
CREATE FUNCTION saas_control.workspace_route(team text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.tenant_id FROM saas_control.workspace_routes r JOIN saas_control.tenants t ON t.id=r.tenant_id
 JOIN booking.slack_installations i ON i.team_id=r.team_id AND i.tenant_id=r.tenant_id
 JOIN booking.slack_workspace_classes w ON w.team_id=r.team_id AND w.tenant_id=r.tenant_id
 JOIN booking.cohorts c ON c.id=w.cohort_id AND c.tenant_id=r.tenant_id
 WHERE r.team_id=team AND t.status='ACTIVE' AND i.revoked_at IS NULL AND w.auto_enroll AND c.inactive_at IS NULL
$$;
CREATE FUNCTION saas_control.web_link_route(hash text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT l.tenant_id FROM booking.slack_web_links l JOIN saas_control.tenants t ON t.id=l.tenant_id
 WHERE l.token_hash=hash AND l.expires_at>now() AND t.status='ACTIVE'
$$;
CREATE FUNCTION saas_control.claim_notification() RETURNS TABLE(id uuid,tenant_id uuid,lease_token uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE booking.tasks q SET status='RUNNING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',attempts=q.attempts+1
 WHERE q.id=(SELECT j.id FROM booking.tasks j JOIN saas_control.tenants t ON t.id=j.tenant_id
 WHERE t.status='ACTIVE' AND j.kind='NOTIFY' AND ((j.status='PENDING' AND j.next_run_at<=clock_timestamp()) OR (j.status='RUNNING' AND j.lease_until<clock_timestamp()))
 ORDER BY j.next_run_at,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1)
 RETURNING q.id,q.tenant_id,q.lease_token
$$;
CREATE FUNCTION saas_control.delivery_allowed(tenant uuid,task uuid,lease uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM booking.tasks j JOIN saas_control.tenants t ON t.id=j.tenant_id
 JOIN booking.members m ON m.id=j.recipient_id AND m.tenant_id=j.tenant_id
 WHERE j.id=task AND j.tenant_id=tenant AND j.lease_token=lease AND j.status='RUNNING' AND j.lease_until>clock_timestamp()
 AND t.status='ACTIVE' AND m.status='ACTIVE')
$$;
CREATE FUNCTION saas_control.maintenance_tenants() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.tenant_id FROM booking.settings s JOIN saas_control.tenants t ON t.id=s.tenant_id WHERE t.status='ACTIVE'
 AND (s.job_heartbeat IS NULL OR s.job_heartbeat<now()-interval '30 seconds') ORDER BY s.job_heartbeat NULLS FIRST LIMIT 50
$$;
REVOKE ALL ON FUNCTION saas_control.install_preview(text),saas_control.connect_install(text,text,text,text,text,text),saas_control.workspace_route(text),saas_control.web_link_route(text),saas_control.claim_notification(),saas_control.delivery_allowed(uuid,uuid,uuid),saas_control.maintenance_tenants() FROM PUBLIC;
