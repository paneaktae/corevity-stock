CREATE TABLE workspace_users (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX workspace_users_active ON workspace_users(is_active,email);
