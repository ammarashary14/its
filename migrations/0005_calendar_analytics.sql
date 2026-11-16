-- Extend the public-page constraint while preserving every existing count.
-- Wrangler applies this migration transactionally.
CREATE TABLE site_page_views_with_calendar (
  day TEXT NOT NULL CHECK (length(day) = 10 AND day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  path TEXT NOT NULL CHECK (path IN ('/', '/curriculum', '/team', '/tutoring', '/community', '/calendar', '/contact', '/apply', '/schools', '/sponsors', '/donate')),
  page_views INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  PRIMARY KEY (day, path)
);
INSERT INTO site_page_views_with_calendar (day, path, page_views)
  SELECT day, path, page_views FROM site_page_views;
DROP TABLE site_page_views;
ALTER TABLE site_page_views_with_calendar RENAME TO site_page_views;
