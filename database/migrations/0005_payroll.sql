CREATE TABLE payroll_periods (
 id TEXT PRIMARY KEY,from_date TEXT NOT NULL,to_date TEXT NOT NULL CHECK(to_date>=from_date),
 status TEXT NOT NULL CHECK(status IN ('open','finalized')),snapshot_version INTEGER NOT NULL DEFAULT 0,
 approved_by TEXT REFERENCES users(id),approved_at INTEGER,reopen_reason TEXT,
 UNIQUE(from_date,to_date)
);
CREATE TABLE payroll_snapshots (
 period_id TEXT NOT NULL REFERENCES payroll_periods(id),version INTEGER NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),approved_by TEXT NOT NULL REFERENCES users(id),approved_at INTEGER NOT NULL,reason TEXT NOT NULL,
 PRIMARY KEY(period_id,version)
);
CREATE TRIGGER payroll_snapshot_immutable_update BEFORE UPDATE ON payroll_snapshots BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable payroll snapshot');
END;
CREATE TRIGGER payroll_snapshot_immutable_delete BEFORE DELETE ON payroll_snapshots BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable payroll snapshot');
END;
CREATE TABLE payroll_adjustments (
 id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),work_date TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('bonus','deduction','advance','leave_pay')),amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 1000000000),reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','reversed')),
 created_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,decided_by TEXT REFERENCES users(id),decided_at INTEGER,decision_reason TEXT
);
CREATE INDEX payroll_adjustment_date ON payroll_adjustments(employee_id,work_date);
CREATE TABLE payroll_resolutions (
 employee_id TEXT NOT NULL REFERENCES employees(id),work_date TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('unapproved_overtime','unworked_day')),
 source_token TEXT NOT NULL,reason TEXT NOT NULL,decided_by TEXT NOT NULL REFERENCES users(id),decided_at INTEGER NOT NULL,
 PRIMARY KEY(employee_id,work_date,kind)
);
CREATE TRIGGER payroll_resolution_insert_guard BEFORE INSERT ON payroll_resolutions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked resolution') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_resolution_update_guard BEFORE UPDATE ON payroll_resolutions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked resolution') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TABLE payroll_fine_decisions (
 violation_id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),work_date TEXT NOT NULL,
 progression_token TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('approved','rejected')),amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 1000000000),
 reason TEXT NOT NULL,decided_by TEXT NOT NULL REFERENCES users(id),decided_at INTEGER NOT NULL
);
CREATE TRIGGER payroll_adjustment_insert_guard BEFORE INSERT ON payroll_adjustments BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked adjustment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_adjustment_update_guard BEFORE UPDATE ON payroll_adjustments BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable adjustment') WHERE NEW.employee_id!=OLD.employee_id OR NEW.work_date!=OLD.work_date OR NEW.kind!=OLD.kind OR NEW.amount!=OLD.amount OR NEW.reason!=OLD.reason OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at;
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid adjustment transition') WHERE NOT ((OLD.status='pending' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='reversed'));
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked adjustment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_fine_insert_guard BEFORE INSERT ON payroll_fine_decisions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked fine') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_fine_update_guard BEFORE UPDATE ON payroll_fine_decisions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked fine') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_attendance_insert_guard BEFORE INSERT ON attendance_sessions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked attendance') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_attendance_update_guard BEFORE UPDATE ON attendance_sessions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked attendance') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date OR NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_manual_insert_guard BEFORE INSERT ON manual_attendance BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked attendance') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_overtime_insert_guard BEFORE INSERT ON overtime_approvals BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked overtime') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_shift_insert_guard BEFORE INSERT ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked schedule') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_shift_update_guard BEFORE UPDATE ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked schedule') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date OR NEW.work_date BETWEEN from_date AND to_date) AND (OLD.start_at!=NEW.start_at OR OLD.end_at!=NEW.end_at OR OLD.status!=NEW.status OR OLD.overtime_approved!=NEW.overtime_approved OR OLD.employee_id!=NEW.employee_id OR OLD.work_date!=NEW.work_date OR OLD.kind!=NEW.kind);
END;
CREATE TRIGGER payroll_rate_revision AFTER INSERT ON hourly_rate_history BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_assignment_revision AFTER INSERT ON employee_role_history BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_request_insert_revision AFTER INSERT ON employee_requests BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_request_update_revision AFTER UPDATE ON employee_requests BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_overtime_revision AFTER INSERT ON overtime_approvals BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_employee_revision AFTER UPDATE ON employees BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_user_revision AFTER UPDATE ON users BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_payroll_adjustments_insert AFTER INSERT ON payroll_adjustments BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_payroll_adjustments_update AFTER UPDATE ON payroll_adjustments BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_payroll_fine_decisions_insert AFTER INSERT ON payroll_fine_decisions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_payroll_fine_decisions_update AFTER UPDATE ON payroll_fine_decisions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_payroll_resolutions_insert AFTER INSERT ON payroll_resolutions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_payroll_resolutions_update AFTER UPDATE ON payroll_resolutions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_disciplinary_policies_insert AFTER INSERT ON disciplinary_policies BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_disciplinary_policies_update AFTER UPDATE ON disciplinary_policies BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_daily_work_reviews_insert AFTER INSERT ON daily_work_reviews BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_daily_work_reviews_update AFTER UPDATE ON daily_work_reviews BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_daily_uniform_confirmations_insert AFTER INSERT ON daily_uniform_confirmations BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_daily_uniform_confirmations_update AFTER UPDATE ON daily_uniform_confirmations BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_violation_decisions_insert AFTER INSERT ON violation_decisions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_violation_decisions_update AFTER UPDATE ON violation_decisions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_manager_meetings_insert AFTER INSERT ON manager_meetings BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_manager_meetings_update AFTER UPDATE ON manager_meetings BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_early_departure_reviews_insert AFTER INSERT ON early_departure_reviews BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_revision_early_departure_reviews_update AFTER UPDATE ON early_departure_reviews BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_locked_delete_attendance_sessions BEFORE DELETE ON attendance_sessions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked source') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_locked_delete_manual_attendance BEFORE DELETE ON manual_attendance BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked source') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_locked_delete_overtime_approvals BEFORE DELETE ON overtime_approvals BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked source') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_locked_delete_scheduled_shifts BEFORE DELETE ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked source') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_locked_hourly_rate_history_insert BEFORE INSERT ON hourly_rate_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked historical rate or assignment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.effective_date<=to_date);
END;
CREATE TRIGGER payroll_locked_hourly_rate_history_update BEFORE UPDATE ON hourly_rate_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked historical rate or assignment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.effective_date<=to_date);
END;
CREATE TRIGGER payroll_locked_hourly_rate_history_delete BEFORE DELETE ON hourly_rate_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked historical rate or assignment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.effective_date<=to_date);
END;
CREATE TRIGGER payroll_locked_employee_role_history_insert BEFORE INSERT ON employee_role_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked historical rate or assignment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.effective_date<=to_date);
END;
CREATE TRIGGER payroll_locked_employee_role_history_update BEFORE UPDATE ON employee_role_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked historical rate or assignment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.effective_date<=to_date);
END;
CREATE TRIGGER payroll_locked_employee_role_history_delete BEFORE DELETE ON employee_role_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked historical rate or assignment') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.effective_date<=to_date);
END;
CREATE TRIGGER payroll_locked_update_manual_attendance BEFORE UPDATE ON manual_attendance BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked source') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date OR NEW.work_date BETWEEN from_date AND to_date);
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_locked_update_overtime_approvals BEFORE UPDATE ON overtime_approvals BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked source') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date OR NEW.work_date BETWEEN from_date AND to_date);
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER payroll_pending_request_lock BEFORE INSERT ON employee_requests BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked request') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER payroll_lock_overlap BEFORE INSERT ON payroll_period_locks BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT overlapping payroll lock') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE from_date<=NEW.to_date AND to_date>=NEW.from_date);
END;
CREATE TRIGGER payroll_settings_guard BEFORE UPDATE ON system_settings BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT historical payroll boundaries') WHERE NEW.payroll_start_day!=OLD.payroll_start_day AND EXISTS(SELECT 1 FROM payroll_snapshots);
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
