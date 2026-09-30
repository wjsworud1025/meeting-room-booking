SET search_path TO booking,public;
-- Refresh existing participants' Home tabs without sending duplicate DMs.
INSERT INTO tasks(kind,dedupe_key,payload,recipient_id,channel)
SELECT 'NOTIFY','slack-home-repair-v1:'||r.id||':'||m.id,
 jsonb_build_object('reservationId',r.id,'event','예약 현황 갱신'),m.id,'SLACK_HOME'
FROM reservations r JOIN reservation_members p ON p.reservation_id=r.id
JOIN members m ON m.id=p.member_id
WHERE r.ends_at>clock_timestamp() AND r.status IN ('CONFIRMED','HOLDING','REPLENISHING')
AND p.status='ACCEPTED' AND m.status='ACTIVE' AND m.slack_user_id IS NOT NULL
ON CONFLICT(dedupe_key) DO NOTHING;
-- Only retry failed Slack delivery for still-current reservations, never successful notifications.
UPDATE tasks t SET status='PENDING',attempts=0,next_run_at=clock_timestamp(),lease_until=NULL,lease_token=NULL
WHERE t.kind='NOTIFY' AND t.channel='AUTO' AND t.status='FAILED' AND t.last_error_code LIKE 'SLACK_%'
AND EXISTS(SELECT 1 FROM reservations r WHERE r.id::text=t.payload->>'reservationId' AND r.ends_at>clock_timestamp() AND r.status IN ('CONFIRMED','HOLDING','REPLENISHING'));
