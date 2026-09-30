SET search_path TO booking,public;
ALTER TABLE members ADD COLUMN first_booking_at timestamptz;
ALTER TABLE members ADD COLUMN slack_directory_active boolean NOT NULL DEFAULT true;
ALTER TABLE slack_workspace_classes ADD COLUMN directory_synced_at timestamptz;
UPDATE members m SET first_booking_at=(SELECT min(COALESCE(p.responded_at,r.created_at)) FROM reservation_members p JOIN reservations r ON r.id=p.reservation_id WHERE p.member_id=m.id AND (p.status IN ('ACCEPTED','LEFT') OR m.id=ANY(r.first_confirmed_member_ids))) WHERE m.role='STUDENT';
