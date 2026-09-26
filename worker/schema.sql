-- 기기 로그. 개발 기간 동안 앱이 10초마다 보내는 묶음(kind=live)과 "서버로 보내기" 묶음(kind=trail)을 저장한다.
-- 적용: npx wrangler d1 execute metro-logs --remote --file schema.sql
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  session TEXT,
  kind TEXT,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_at ON logs(at);
