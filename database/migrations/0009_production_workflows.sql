-- Paired displays remain registered until explicitly revoked.
UPDATE registered_tablets SET credential_expires_at=NULL WHERE credential_hash IS NOT NULL AND revoked_at IS NULL;
DROP TRIGGER valid_attendance_insert;
CREATE TRIGGER valid_attendance_insert BEFORE INSERT ON attendance_sessions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid employee or tablet') WHERE NOT EXISTS(SELECT 1 FROM registered_tablets WHERE id=NEW.tablet_id AND credential_hash IS NOT NULL AND (credential_expires_at IS NULL OR credential_expires_at>unixepoch()) AND revoked_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=NEW.employee_id AND u.active=1 AND e.activation_date<=NEW.work_date AND (e.deactivation_date IS NULL OR e.deactivation_date>NEW.work_date));
END;

-- Store every daily correction before allowing a protected shift update.
CREATE TABLE schedule_corrections (
 id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES scheduled_shifts(id),
 employee_id TEXT NOT NULL REFERENCES employees(id),work_date TEXT NOT NULL,
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 actor_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE TABLE schedule_correction_context (
 shift_id TEXT PRIMARY KEY REFERENCES scheduled_shifts(id),correction_id TEXT NOT NULL REFERENCES schedule_corrections(id)
);
CREATE TRIGGER schedule_correction_insert_guard BEFORE INSERT ON schedule_corrections BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid schedule correction') WHERE NOT EXISTS(SELECT 1 FROM scheduled_shifts WHERE id=NEW.shift_id AND employee_id=NEW.employee_id AND work_date=NEW.work_date)
 OR EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER schedule_correction_immutable_update BEFORE UPDATE ON schedule_corrections BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable schedule correction');
END;
CREATE TRIGGER schedule_correction_immutable_delete BEFORE DELETE ON schedule_corrections BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable schedule correction');
END;
DROP TRIGGER protect_override_insert;
DROP TRIGGER protect_override_update;
DROP TRIGGER schedule_override_edit_insert_guard;
DROP TRIGGER schedule_override_edit_update_guard;
DROP TRIGGER schedule_recorded_shift_edit_guard;
CREATE TRIGGER schedule_override_edit_insert_guard BEFORE INSERT ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT protected daily schedule') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date)
 OR (EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date) AND NOT EXISTS(SELECT 1 FROM schedule_correction_context x JOIN scheduled_shifts s ON s.id=x.shift_id WHERE s.employee_id=NEW.employee_id AND s.work_date=NEW.work_date));
END;
CREATE TRIGGER schedule_override_edit_update_guard BEFORE UPDATE ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT protected daily schedule') WHERE NEW.employee_id!=OLD.employee_id OR NEW.work_date!=OLD.work_date
 OR EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date)
 OR (EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date) AND NOT EXISTS(SELECT 1 FROM schedule_correction_context x JOIN scheduled_shifts s ON s.id=x.shift_id WHERE s.employee_id=OLD.employee_id AND s.work_date=OLD.work_date));
END;
CREATE TRIGGER schedule_recorded_shift_edit_guard BEFORE UPDATE ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT shift identity') WHERE NEW.employee_id!=OLD.employee_id OR NEW.work_date!=OLD.work_date OR NEW.kind!=OLD.kind;
 SELECT RAISE(ABORT,'ATBOT_CONFLICT recorded schedule') WHERE (NEW.start_at!=OLD.start_at OR NEW.end_at!=OLD.end_at OR NEW.status!=OLD.status OR NEW.overtime_approved!=OLD.overtime_approved)
 AND EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date)
 AND NOT EXISTS(SELECT 1 FROM schedule_correction_context x JOIN schedule_corrections c ON c.id=x.correction_id WHERE x.shift_id=OLD.id AND json_extract(c.before_json,'$.start_at')=OLD.start_at AND json_extract(c.before_json,'$.end_at')=OLD.end_at AND json_extract(c.before_json,'$.status')=OLD.status AND json_extract(c.before_json,'$.overtime_approved')=OLD.overtime_approved AND json_extract(c.after_json,'$.start_at')=NEW.start_at AND json_extract(c.after_json,'$.end_at')=NEW.end_at AND json_extract(c.after_json,'$.status')=NEW.status AND json_extract(c.after_json,'$.overtime_approved')=NEW.overtime_approved);
END;
-- Archive both versions of schedule-based discipline sources.
CREATE TRIGGER discipline_archive_shift_correction_before BEFORE UPDATE ON scheduled_shifts BEGIN
 INSERT OR IGNORE INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date;
END;
CREATE TRIGGER discipline_archive_shift_correction_after AFTER UPDATE ON scheduled_shifts BEGIN
 INSERT OR IGNORE INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date;
END;
-- Salary periods are calendar months; historical snapshots remain immutable.
UPDATE system_settings SET payroll_start_day=1 WHERE id=1;
CREATE TRIGGER salary_calendar_month_guard BEFORE UPDATE OF payroll_start_day ON system_settings BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT salaries use calendar months') WHERE NEW.payroll_start_day!=1;
END;
