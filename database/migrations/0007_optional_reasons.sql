-- Reasons are optional; reviewer identity and timestamps remain required.
-- No tables reference this table by foreign key. Preserve all rows and triggers.
CREATE TABLE optional_reason_uniform_copy AS SELECT * FROM daily_uniform_confirmations;
DROP TABLE daily_uniform_confirmations;
CREATE TABLE daily_uniform_confirmations (
 employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 declared_at INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 decision_reason TEXT, reviewed_by TEXT REFERENCES users(id), reviewed_at INTEGER,
 PRIMARY KEY(employee_id,work_date),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
 (status!='pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
INSERT INTO daily_uniform_confirmations SELECT * FROM optional_reason_uniform_copy;
DROP TABLE optional_reason_uniform_copy;
CREATE TRIGGER discipline_uniform_insert BEFORE INSERT ON daily_uniform_confirmations BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT unavailable workday') WHERE NOT EXISTS(SELECT 1 FROM discipline_workdays WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_uniform_update BEFORE UPDATE ON daily_uniform_confirmations BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT unavailable workday') WHERE NOT EXISTS(SELECT 1 FROM discipline_workdays WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_archive_daily_uniform_confirmations_insert_after AFTER INSERT ON daily_uniform_confirmations BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_daily_uniform_confirmations_update_before BEFORE UPDATE ON daily_uniform_confirmations BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_daily_uniform_confirmations_update_after AFTER UPDATE ON daily_uniform_confirmations BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER payroll_revision_daily_uniform_confirmations_insert AFTER INSERT ON daily_uniform_confirmations BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_daily_uniform_confirmations_update AFTER UPDATE ON daily_uniform_confirmations BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
