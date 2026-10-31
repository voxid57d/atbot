PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
 access TEXT NOT NULL DEFAULT 'employee' CHECK(access IN ('employee','admin','super_admin')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE bootstrap_state (id INTEGER PRIMARY KEY CHECK(id=1), user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
CREATE TABLE employees (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), activation_date TEXT NOT NULL,
 deactivation_date TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(deactivation_date IS NULL OR deactivation_date >= activation_date)
);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
CREATE TABLE role_levels (id TEXT PRIMARY KEY, role_id TEXT NOT NULL REFERENCES roles(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(role_id,name));
CREATE TABLE employee_role_history (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), level_id TEXT NOT NULL REFERENCES role_levels(id),
 effective_date TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, UNIQUE(employee_id,effective_date)
);
CREATE INDEX role_history_lookup ON employee_role_history(employee_id,effective_date DESC);
CREATE TABLE hourly_rate_history (
 id TEXT PRIMARY KEY, level_id TEXT NOT NULL REFERENCES role_levels(id), hourly_rate INTEGER NOT NULL CHECK(hourly_rate BETWEEN 0 AND 1000000000),
 effective_date TEXT NOT NULL, created_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL, UNIQUE(level_id,effective_date)
);
CREATE INDEX rate_history_lookup ON hourly_rate_history(level_id,effective_date DESC);
CREATE TABLE admin_permissions (user_id TEXT NOT NULL REFERENCES users(id), permission TEXT NOT NULL CHECK(permission IN ('employees.manage','salary.manage','payroll.approve','attendance.manage','audit.view')), PRIMARY KEY(user_id,permission));
CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE consumed_logins (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL,
 before_json TEXT, after_json TEXT, reason TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX audit_time ON audit_logs(created_at DESC,id);
CREATE TABLE idempotency_keys (
 actor_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL,
 response_json TEXT NOT NULL, status INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(actor_id,key)
);
CREATE TABLE system_settings (id INTEGER PRIMARY KEY CHECK(id=1), timezone TEXT NOT NULL DEFAULT 'Asia/Tashkent', currency TEXT NOT NULL DEFAULT 'UZS', payroll_start_day INTEGER NOT NULL DEFAULT 1 CHECK(payroll_start_day BETWEEN 1 AND 28));
INSERT INTO system_settings(id) VALUES(1);
INSERT INTO roles(id,name) VALUES ('office-manager','Office Manager'),('cashier','Cashier'),('assistant','Office Manager Assistant'),('maintenance','Maintenance');
-- Deliberately no production wage values: configure rates explicitly before onboarding.
