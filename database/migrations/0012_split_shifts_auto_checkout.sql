-- Existing schedules remain in slot 1. A second regular shift is optional.
ALTER TABLE weekly_schedules ADD COLUMN second_start_minute INTEGER;
ALTER TABLE weekly_schedules ADD COLUMN second_end_minute INTEGER;
ALTER TABLE shift_overrides ADD COLUMN second_start_minute INTEGER;
ALTER TABLE shift_overrides ADD COLUMN second_end_minute INTEGER;
ALTER TABLE shift_overrides ADD COLUMN second_cancelled INTEGER NOT NULL DEFAULT 0 CHECK(second_cancelled IN (0,1));
ALTER TABLE scheduled_shifts ADD COLUMN slot INTEGER NOT NULL DEFAULT 1 CHECK(slot IN (1,2));
DROP INDEX one_regular_shift;
CREATE UNIQUE INDEX one_regular_shift_slot ON scheduled_shifts(employee_id,work_date,slot) WHERE kind='regular';
CREATE TRIGGER weekly_second_shift_insert BEFORE INSERT ON weekly_schedules BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid second shift') WHERE NOT ((NEW.second_start_minute IS NULL AND NEW.second_end_minute IS NULL) OR (NEW.second_start_minute IS NOT NULL AND NEW.second_end_minute IS NOT NULL AND NEW.second_start_minute>=NEW.end_minute AND NEW.second_end_minute>NEW.second_start_minute AND NEW.second_end_minute<=1439));
END;
CREATE TRIGGER weekly_second_shift_update BEFORE UPDATE ON weekly_schedules BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid second shift') WHERE NOT ((NEW.second_start_minute IS NULL AND NEW.second_end_minute IS NULL) OR (NEW.second_start_minute IS NOT NULL AND NEW.second_end_minute IS NOT NULL AND NEW.second_start_minute>=NEW.end_minute AND NEW.second_end_minute>NEW.second_start_minute AND NEW.second_end_minute<=1439));
END;
CREATE TRIGGER override_second_shift_insert BEFORE INSERT ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid second shift') WHERE NOT ((NEW.second_start_minute IS NULL AND NEW.second_end_minute IS NULL) OR (NEW.second_start_minute IS NOT NULL AND NEW.second_end_minute IS NOT NULL AND NEW.second_start_minute>=0 AND NEW.second_end_minute>NEW.second_start_minute AND NEW.second_end_minute<=1439 AND (NEW.cancelled=1 OR NEW.second_cancelled=1 OR NEW.second_start_minute>=NEW.end_minute)));
END;
CREATE TRIGGER override_second_shift_update BEFORE UPDATE ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid second shift') WHERE NOT ((NEW.second_start_minute IS NULL AND NEW.second_end_minute IS NULL) OR (NEW.second_start_minute IS NOT NULL AND NEW.second_end_minute IS NOT NULL AND NEW.second_start_minute>=0 AND NEW.second_end_minute>NEW.second_start_minute AND NEW.second_end_minute<=1439 AND (NEW.cancelled=1 OR NEW.second_cancelled=1 OR NEW.second_start_minute>=NEW.end_minute)));
END;
CREATE TRIGGER regular_slot_identity BEFORE UPDATE OF slot ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT shift slot identity') WHERE NEW.slot!=OLD.slot;
END;
CREATE TRIGGER regular_shift_overlap_insert BEFORE INSERT ON scheduled_shifts WHEN NEW.kind='regular' AND NEW.status='scheduled' BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT overlapping regular shifts') WHERE EXISTS(SELECT 1 FROM scheduled_shifts WHERE id!=NEW.id AND employee_id=NEW.employee_id AND work_date=NEW.work_date AND kind='regular' AND status='scheduled' AND start_at<NEW.end_at AND end_at>NEW.start_at);
END;
CREATE TRIGGER regular_shift_overlap_update BEFORE UPDATE ON scheduled_shifts WHEN NEW.kind='regular' AND NEW.status='scheduled' BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT overlapping regular shifts') WHERE EXISTS(SELECT 1 FROM scheduled_shifts WHERE id!=NEW.id AND employee_id=NEW.employee_id AND work_date=NEW.work_date AND kind='regular' AND status='scheduled' AND start_at<NEW.end_at AND end_at>NEW.start_at);
END;
-- A separate immutable journal records system actions without attributing them to a person.
CREATE TABLE automatic_checkouts (
 session_id TEXT PRIMARY KEY REFERENCES attendance_sessions(id),
 closed_at INTEGER NOT NULL, processed_at INTEGER NOT NULL,
 reason TEXT NOT NULL
);
CREATE TRIGGER automatic_checkout_update_guard BEFORE UPDATE ON automatic_checkouts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable automatic checkout');
END;
CREATE TRIGGER automatic_checkout_delete_guard BEFORE DELETE ON automatic_checkouts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable automatic checkout');
END;
-- Keep an administrator's observation distinct from the employee's declaration.
ALTER TABLE daily_uniform_confirmations ADD COLUMN admin_has_uniform INTEGER CHECK(admin_has_uniform IN (0,1));
