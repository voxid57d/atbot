CREATE TABLE absence_categories (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1))
);
INSERT INTO absence_categories(id,label) VALUES('sick','Sick leave'),('personal','Personal matter'),('emergency','Emergency'),('other','Other');
CREATE TABLE employee_requests (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), kind TEXT NOT NULL CHECK(kind IN ('absence','correction','overtime')),
 work_date TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at INTEGER NOT NULL, decided_by TEXT REFERENCES users(id), decided_at INTEGER, decision_reason TEXT, paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)),
 CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL) OR (status!='pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(decision_reason)>0))
);
CREATE UNIQUE INDEX one_absence_per_day ON employee_requests(employee_id,work_date) WHERE kind='absence' AND status!='rejected';
CREATE UNIQUE INDEX one_pending_correction ON employee_requests(employee_id,work_date) WHERE kind='correction' AND status='pending';
CREATE UNIQUE INDEX one_overtime_interval ON employee_requests(employee_id,work_date,json_extract(payload_json,'$.start'),json_extract(payload_json,'$.end')) WHERE kind='overtime' AND status!='rejected';
CREATE INDEX requests_review ON employee_requests(status,created_at);
CREATE TABLE manual_attendance (
 id TEXT PRIMARY KEY REFERENCES employee_requests(id), employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 shift_id TEXT REFERENCES scheduled_shifts(id), check_in INTEGER NOT NULL, check_out INTEGER NOT NULL CHECK(check_out>check_in)
);
CREATE VIEW effective_attendance AS
 SELECT id,employee_id,work_date,shift_id,check_in,check_out,0 AS manual FROM attendance_sessions
 UNION ALL SELECT id,employee_id,work_date,shift_id,check_in,check_out,1 AS manual FROM manual_attendance;
CREATE TABLE attendance_originals (
 session_id TEXT PRIMARY KEY REFERENCES attendance_sessions(id), original_json TEXT NOT NULL CHECK(json_valid(original_json))
);
CREATE TABLE payroll_period_locks (
 id TEXT PRIMARY KEY, from_date TEXT NOT NULL, to_date TEXT NOT NULL CHECK(to_date>=from_date), locked_by TEXT NOT NULL REFERENCES users(id), locked_at INTEGER NOT NULL
);
CREATE TRIGGER request_decision_guard BEFORE UPDATE ON employee_requests BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT request already decided') WHERE OLD.status!='pending' OR NEW.status='pending';
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable request') WHERE NEW.employee_id!=OLD.employee_id OR NEW.kind!=OLD.kind OR NEW.work_date!=OLD.work_date OR NEW.payload_json!=OLD.payload_json OR NEW.reason!=OLD.reason OR NEW.created_at!=OLD.created_at;
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked payroll requires adjustment') WHERE NEW.status='approved' AND EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT absence policy changed') WHERE NEW.status='approved' AND NEW.kind='absence' AND NEW.paid!=(SELECT paid FROM absence_categories WHERE id=json_extract(NEW.payload_json,'$.category'));
 SELECT RAISE(ABORT,'ATBOT_CONFLICT attendance changed') WHERE NEW.status='approved' AND NEW.kind='correction' AND json_extract(NEW.payload_json,'$.sessionId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM attendance_sessions WHERE id=json_extract(NEW.payload_json,'$.sessionId') AND employee_id=NEW.employee_id AND check_in=json_extract(NEW.payload_json,'$.originalIn') AND check_out IS json_extract(NEW.payload_json,'$.originalOut'));
 SELECT RAISE(ABORT,'ATBOT_CONFLICT overlapping attendance') WHERE NEW.status='approved' AND NEW.kind='correction' AND EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=NEW.employee_id AND id!=coalesce(json_extract(NEW.payload_json,'$.sessionId'),'') AND check_in<json_extract(NEW.payload_json,'$.end') AND coalesce(check_out,unixepoch())>json_extract(NEW.payload_json,'$.start'));
END;
CREATE TRIGGER protect_originals_update BEFORE UPDATE ON attendance_originals BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable original attendance');
END;
CREATE TRIGGER protect_originals_delete BEFORE DELETE ON attendance_originals BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable original attendance');
END;
CREATE TABLE shift_coverage_assignments (
 id TEXT PRIMARY KEY, absence_id TEXT NOT NULL REFERENCES employee_requests(id), employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at>start_at), reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')), requires_acceptance INTEGER NOT NULL CHECK(requires_acceptance IN (0,1)),
 overtime_approved INTEGER NOT NULL CHECK(overtime_approved=1), created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, decided_at INTEGER,
 CHECK(end_at-start_at<=64800)
);
CREATE UNIQUE INDEX one_coverage_per_absence ON shift_coverage_assignments(absence_id) WHERE status!='declined';
CREATE TRIGGER coverage_insert_guard BEFORE INSERT ON shift_coverage_assignments BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid coverage') WHERE NOT EXISTS(SELECT 1 FROM employee_requests WHERE id=NEW.absence_id AND kind='absence' AND status='approved' AND work_date=NEW.work_date AND employee_id!=NEW.employee_id);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT invalid replacement employee') WHERE NOT EXISTS(SELECT 1 FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=NEW.employee_id AND u.active=1 AND e.activation_date<=NEW.work_date AND (e.deactivation_date IS NULL OR e.deactivation_date>NEW.work_date));
 SELECT RAISE(ABORT,'ATBOT_CONFLICT replacement is absent') WHERE EXISTS(SELECT 1 FROM employee_requests WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND kind='absence' AND status!='rejected');
END;
CREATE TRIGGER coverage_decision_guard BEFORE UPDATE ON shift_coverage_assignments BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT coverage already decided') WHERE OLD.status!='pending' OR NEW.status NOT IN ('accepted','declined');
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable coverage') WHERE NEW.absence_id!=OLD.absence_id OR NEW.employee_id!=OLD.employee_id OR NEW.work_date!=OLD.work_date OR NEW.start_at!=OLD.start_at OR NEW.end_at!=OLD.end_at OR NEW.reason!=OLD.reason OR NEW.overtime_approved!=OLD.overtime_approved OR NEW.requires_acceptance!=OLD.requires_acceptance;
 SELECT RAISE(ABORT,'ATBOT_CONFLICT replacement unavailable') WHERE NEW.status='accepted' AND (NOT EXISTS(SELECT 1 FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=NEW.employee_id AND u.active=1 AND e.activation_date<=NEW.work_date AND (e.deactivation_date IS NULL OR e.deactivation_date>NEW.work_date)) OR EXISTS(SELECT 1 FROM employee_requests WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND kind='absence' AND status!='rejected'));
END;
CREATE TRIGGER coverage_shift_guard BEFORE INSERT ON scheduled_shifts WHEN EXISTS(SELECT 1 FROM shift_coverage_assignments WHERE id=NEW.source_id) BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT overlapping coverage shift') WHERE EXISTS(SELECT 1 FROM scheduled_shifts WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND status='scheduled' AND start_at<NEW.end_at AND end_at>NEW.start_at);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked coverage date') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TABLE telegram_chats (
 user_id TEXT PRIMARY KEY REFERENCES users(id), chat_id TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), reminders INTEGER NOT NULL DEFAULT 0 CHECK(reminders IN (0,1)), updated_at INTEGER NOT NULL, last_update_id INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE notification_outbox (
 id TEXT PRIMARY KEY, event_key TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, markup_json TEXT, audience TEXT NOT NULL DEFAULT 'employee' CHECK(audience IN ('employee','admin')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, error_code TEXT,
 UNIQUE(event_key,user_id)
);
CREATE INDEX notification_due ON notification_outbox(status,next_attempt_at);
CREATE TRIGGER absence_coverage_guard BEFORE INSERT ON employee_requests WHEN NEW.kind='absence' BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT assigned coverage') WHERE EXISTS(SELECT 1 FROM shift_coverage_assignments WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND status!='declined');
END;
CREATE TRIGGER protect_manual_weekly BEFORE INSERT ON weekly_schedules BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT historical manual attendance') WHERE EXISTS(SELECT 1 FROM manual_attendance WHERE employee_id=NEW.employee_id AND work_date>=NEW.effective_date);
END;
CREATE TRIGGER protect_manual_override_insert BEFORE INSERT ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT historical manual attendance') WHERE EXISTS(SELECT 1 FROM manual_attendance WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
END;
CREATE TRIGGER protect_manual_override_update BEFORE UPDATE ON shift_overrides BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT historical manual attendance') WHERE EXISTS(SELECT 1 FROM manual_attendance WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
END;
CREATE TRIGGER protect_coverage_schedule_insert BEFORE INSERT ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT assigned coverage overlap') WHERE EXISTS(SELECT 1 FROM scheduled_shifts s JOIN shift_coverage_assignments c ON c.id=s.source_id WHERE s.id!=NEW.id AND s.employee_id=NEW.employee_id AND s.work_date=NEW.work_date AND s.status='scheduled' AND NEW.status='scheduled' AND s.start_at<NEW.end_at AND s.end_at>NEW.start_at);
END;
CREATE TRIGGER protect_coverage_schedule_update BEFORE UPDATE ON scheduled_shifts BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT assigned coverage overlap') WHERE EXISTS(SELECT 1 FROM scheduled_shifts s JOIN shift_coverage_assignments c ON c.id=s.source_id WHERE s.id!=NEW.id AND s.employee_id=NEW.employee_id AND s.work_date=NEW.work_date AND s.status='scheduled' AND NEW.status='scheduled' AND s.start_at<NEW.end_at AND s.end_at>NEW.start_at);
END;
