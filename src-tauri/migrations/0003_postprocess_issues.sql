CREATE TABLE IF NOT EXISTS postprocess_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  level TEXT NOT NULL,
  stage TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_postprocess_issues_request
  ON postprocess_issues(request_id);
CREATE INDEX IF NOT EXISTS idx_postprocess_issues_item
  ON postprocess_issues(item_id);
