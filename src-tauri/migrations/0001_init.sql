CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  uploader TEXT NOT NULL DEFAULT '',
  requested_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  error TEXT,
  metadata TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_items (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  idx INTEGER,
  format_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  speed TEXT,
  eta TEXT,
  output_path TEXT,
  error TEXT,
  output_dir TEXT,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_items_request ON download_items (request_id);
CREATE INDEX IF NOT EXISTS idx_download_items_status ON download_items (status);
