SET search_path TO booking,public;
ALTER TABLE slack_web_links ADD COLUMN ready boolean NOT NULL DEFAULT true;
