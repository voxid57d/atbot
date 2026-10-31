CREATE TABLE weekly_schedules (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1438), end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1439 AND end_minute>start_minute),
 effective_date TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 UNIQUE(employee_id,weekday,effective_date)
);
CREATE INDEX weekly_lookup ON weekly_schedules(employee_id,weekday,effective_date DESC);
CREATE TABLE shift_overrides (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 start_minute INTEGER, end_minute INTEGER, cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)),
 reason TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 UNIQUE(employee_id,work_date), CHECK(cancelled=1 OR (start_minute>=0 AND end_minute<=1439 AND end_minute>start_minute))
);
CREATE TABLE scheduled_shifts (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at>start_at),
 kind TEXT NOT NULL CHECK(kind IN ('regular','extra')), status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled')),
 overtime_approved INTEGER NOT NULL DEFAULT 0 CHECK(overtime_approved IN (0,1)), source_id TEXT, created_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_regular_shift ON scheduled_shifts(employee_id,work_date) WHERE kind='regular';
CREATE INDEX shifts_by_date ON scheduled_shifts(work_date,employee_id);
CREATE TABLE registered_tablets (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, pairing_hash TEXT UNIQUE, pairing_expires_at INTEGER,
 credential_hash TEXT UNIQUE, credential_expires_at INTEGER, revoked_at INTEGER,
 created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE TABLE attendance_sessions (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), shift_id TEXT REFERENCES scheduled_shifts(id), work_date TEXT NOT NULL,
 check_in INTEGER NOT NULL, check_out INTEGER CHECK(check_out IS NULL OR check_out>=check_in), tablet_id TEXT NOT NULL REFERENCES registered_tablets(id),
 checkout_source TEXT CHECK(checkout_source IN ('employee','admin')), checkout_reason TEXT, closed_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_active_session ON attendance_sessions(employee_id) WHERE check_out IS NULL;
CREATE INDEX attendance_by_day ON attendance_sessions(employee_id,work_date,check_in,id);
CREATE TABLE attendance_closures (session_id TEXT PRIMARY KEY REFERENCES attendance_sessions(id), closed_at INTEGER NOT NULL);
CREATE TABLE overtime_approvals (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at>start_at), reason TEXT NOT NULL,
 approved_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE INDEX overtime_by_day ON overtime_approvals(employee_id,work_date);
CREATE TRIGGER valid_attendance_insert BEFORE INSERT ON attendance_sessions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid employee or tablet') WHERE NOT EXISTS(SELECT 1 FROM registered_tablets WHERE id=NEW.tablet_id AND credential_hash IS NOT NULL AND credential_expires_at>unixepoch() AND revoked_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=NEW.employee_id AND u.active=1 AND e.activation_date<=NEW.work_date AND (e.deactivation_date IS NULL OR e.deactivation_date>NEW.work_date));
END;
CREATE TRIGGER protect_weekly_schedule BEFORE INSERT ON weekly_schedules BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT historical schedule') WHERE EXISTS(SELECT 1 FROM attendance_sessions WHERE employee_id=NEW.employee_id AND work_date>=NEW.effective_date);
END;
CREATE TRIGGER protect_override_insert BEFORE INSERT ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT historical schedule') WHERE EXISTS(SELECT 1 FROM attendance_sessions WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
END;
CREATE TRIGGER protect_override_update BEFORE UPDATE ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT historical schedule') WHERE EXISTS(SELECT 1 FROM attendance_sessions WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
END;
