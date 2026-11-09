-- Public sign-up: who created the site, and from where (for rate limiting).
ALTER TABLE sites ADD COLUMN email TEXT;
ALTER TABLE sites ADD COLUMN created_ip TEXT;

CREATE INDEX sites_created_ip ON sites (created_ip, created_at);
