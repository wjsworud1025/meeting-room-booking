-- Explicit SaaS migration only. Worker functions never expose customer payloads.
CREATE TABLE saas_control.holiday_job (
 id integer PRIMARY KEY CHECK(id=1), next_run_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, last_attempt_at timestamptz,
 last_success_at timestamptz, last_error text
);
INSERT INTO saas_control.holiday_job(id) VALUES(1);
REVOKE ALL ON saas_control.holiday_job FROM PUBLIC;
CREATE FUNCTION saas_control.claim_holidays() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE token uuid;
BEGIN
 UPDATE booking.holiday_sync s SET worker_heartbeat=clock_timestamp()
 FROM saas_control.tenants t WHERE s.tenant_id=t.id AND t.status='ACTIVE' AND (s.worker_heartbeat IS NULL OR s.worker_heartbeat<clock_timestamp()-interval '30 seconds');
 UPDATE saas_control.holiday_job SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',last_attempt_at=clock_timestamp()
 WHERE id=1 AND next_run_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING lease_token INTO token;
 RETURN token;
END $$;
CREATE FUNCTION saas_control.request_holidays() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF saas_control.current_tenant() IS NULL THEN RAISE EXCEPTION 'TENANT_REQUIRED'; END IF;
 UPDATE saas_control.holiday_job SET next_run_at=clock_timestamp() WHERE id=1
 AND (last_attempt_at IS NULL OR last_attempt_at<clock_timestamp()-interval '1 minute')
 AND (lease_until IS NULL OR lease_until<clock_timestamp());
 RETURN FOUND;
END $$;
CREATE FUNCTION saas_control.finish_holidays(token uuid, first_year integer, data jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i integer; y integer; days jsonb; old_days jsonb; changes text[]; all_changes text[]:='{}';
BEGIN
 PERFORM 1 FROM saas_control.holiday_job WHERE id=1 AND lease_token=token AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF first_year NOT BETWEEN 2000 AND 2099 OR jsonb_typeof(data)<>'array' OR jsonb_array_length(data)<>2 THEN RAISE EXCEPTION 'HOLIDAY_INVALID_RESPONSE'; END IF;
 FOR i IN 0..1 LOOP
  y:=first_year+i; days:=data->i;
  IF jsonb_typeof(days)<>'object' THEN RAISE EXCEPTION 'HOLIDAY_INVALID_RESPONSE'; END IF;
  IF (SELECT count(*) FROM jsonb_each(days)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'HOLIDAY_INCOMPLETE_RESPONSE'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(days) e WHERE e.key !~ ('^'||y::text||'-[0-9]{2}-[0-9]{2}$') OR jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}') NOT BETWEEN 1 AND 100) THEN RAISE EXCEPTION 'HOLIDAY_INVALID_RESPONSE'; END IF;
  PERFORM key::date FROM jsonb_each(days);
  SELECT h.days INTO old_days FROM booking.holiday_years h WHERE year=y;
  SELECT array_agg(k) INTO changes FROM (SELECT jsonb_object_keys(COALESCE(old_days,'{}')) k UNION SELECT jsonb_object_keys(days)) keys WHERE old_days->k IS DISTINCT FROM days->k;
  all_changes:=all_changes||COALESCE(changes,'{}');
  INSERT INTO booking.holiday_years(year,days,synced_at) VALUES(y,days,clock_timestamp()) ON CONFLICT(year) DO UPDATE SET days=EXCLUDED.days,synced_at=EXCLUDED.synced_at;
 END LOOP;
 UPDATE booking.holiday_sync s SET last_attempt_at=j.last_attempt_at,last_success_at=clock_timestamp(),last_error=NULL,next_run_at=clock_timestamp()+interval '6 hours',
 changed_dates=(SELECT COALESCE(jsonb_agg(d ORDER BY d),'[]') FROM (
  SELECT jsonb_array_elements_text(s.changed_dates) d UNION SELECT unnest(all_changes)
 ) dates WHERE d>=(clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date::text AND NOT EXISTS(SELECT 1 FROM booking.holiday_overrides o WHERE o.tenant_id=s.tenant_id AND o.local_date=d::date))
 FROM saas_control.holiday_job j,saas_control.tenants t WHERE j.id=1 AND t.id=s.tenant_id AND t.status='ACTIVE';
 UPDATE saas_control.holiday_job SET last_success_at=clock_timestamp(),last_error=NULL,lease_token=NULL,lease_until=NULL,next_run_at=clock_timestamp()+interval '6 hours' WHERE id=1;
 RETURN true;
END $$;
CREATE FUNCTION saas_control.fail_holidays(token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE saas_control.holiday_job SET last_error='HOLIDAY_SYNC_FAILED',lease_token=NULL,lease_until=NULL,next_run_at=clock_timestamp()+interval '5 minutes'
 WHERE id=1 AND lease_token=token AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE booking.holiday_sync s SET last_error='HOLIDAY_SYNC_FAILED' FROM saas_control.tenants t WHERE s.tenant_id=t.id AND t.status='ACTIVE';
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION saas_control.claim_holidays(),saas_control.request_holidays(),saas_control.finish_holidays(uuid,integer,jsonb),saas_control.fail_holidays(uuid) FROM PUBLIC;
