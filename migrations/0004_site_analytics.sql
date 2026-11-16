CREATE TABLE IF NOT EXISTS site_page_views (
  day TEXT NOT NULL CHECK (length(day) = 10 AND day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  path TEXT NOT NULL CHECK (path IN ('/', '/curriculum', '/team', '/tutoring', '/community', '/contact', '/apply', '/schools', '/sponsors', '/donate')),
  page_views INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  PRIMARY KEY (day, path)
);
