SET search_path TO booking,public;
-- Replace cached pre-hosting Home views, including members without bookings.
INSERT INTO tasks(kind,dedupe_key,payload,recipient_id,channel)
SELECT 'NOTIFY','production-home-v2:'||m.id,
 jsonb_build_object('event','운영 주소 갱신'),m.id,'SLACK_HOME'
FROM members m JOIN slack_workspace_classes w ON w.team_id=m.slack_workspace_id
JOIN cohorts c ON c.id=w.cohort_id
WHERE m.status='ACTIVE' AND m.role='STUDENT' AND m.slack_user_id IS NOT NULL
 AND w.auto_enroll AND c.inactive_at IS NULL
ON CONFLICT(dedupe_key) DO NOTHING;
-- One recovery notice per current participant; never replay historical events.
INSERT INTO tasks(kind,dedupe_key,payload,recipient_id,channel)
SELECT 'NOTIFY','production-notice-v2:'||r.id||':'||m.id,
 jsonb_build_object('reservationId',r.id,'event','예약 현황 안내'),m.id,'AUTO'
FROM reservations r JOIN reservation_members p ON p.reservation_id=r.id
JOIN members m ON m.id=p.member_id
WHERE r.ends_at>clock_timestamp() AND r.status IN ('CONFIRMED','HOLDING','REPLENISHING')
 AND p.status='ACCEPTED' AND m.status='ACTIVE' AND m.slack_user_id IS NOT NULL
ON CONFLICT(dedupe_key) DO NOTHING;
