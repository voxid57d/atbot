CREATE TRIGGER schedule_weekly_edit_insert_guard BEFORE INSERT ON weekly_schedules BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT protected weekly schedule') WHERE EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=NEW.employee_id AND work_date>=NEW.effective_date) OR EXISTS(SELECT 1 FROM payroll_period_locks WHERE to_date>=NEW.effective_date);
END;
CREATE TRIGGER schedule_weekly_edit_update_guard BEFORE UPDATE ON weekly_schedules BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT protected weekly schedule') WHERE NEW.employee_id!=OLD.employee_id OR NEW.weekday!=OLD.weekday OR NEW.effective_date!=OLD.effective_date OR EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=OLD.employee_id AND work_date>=OLD.effective_date) OR EXISTS(SELECT 1 FROM payroll_period_locks WHERE to_date>=OLD.effective_date);
END;
CREATE TRIGGER schedule_override_edit_insert_guard BEFORE INSERT ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT protected daily schedule') WHERE EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date) OR EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER schedule_override_edit_update_guard BEFORE UPDATE ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT protected daily schedule') WHERE NEW.employee_id!=OLD.employee_id OR NEW.work_date!=OLD.work_date OR EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date) OR EXISTS(SELECT 1 FROM payroll_period_locks WHERE OLD.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER schedule_recorded_shift_edit_guard BEFORE UPDATE ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT recorded schedule') WHERE (NEW.start_at!=OLD.start_at OR NEW.end_at!=OLD.end_at OR NEW.status!=OLD.status OR NEW.overtime_approved!=OLD.overtime_approved) AND EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date);
END;
CREATE TRIGGER schedule_weekly_edit_revision AFTER UPDATE ON weekly_schedules BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER schedule_weekly_create_revision AFTER INSERT ON weekly_schedules BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER schedule_override_create_revision AFTER INSERT ON shift_overrides BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER schedule_override_update_revision AFTER UPDATE ON shift_overrides BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
