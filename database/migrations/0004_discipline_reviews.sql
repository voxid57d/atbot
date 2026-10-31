CREATE TABLE discipline_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO discipline_state VALUES(1,0);
CREATE TRIGGER discipline_revision_guard BEFORE UPDATE ON discipline_state BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT discipline changed') WHERE NEW.revision!=OLD.revision+1;
END;
CREATE TABLE disciplinary_policies (
 id INTEGER PRIMARY KEY AUTOINCREMENT, effective_date TEXT NOT NULL,
 policy_json TEXT NOT NULL CHECK(json_valid(policy_json)), created_by TEXT REFERENCES users(id),
 created_at INTEGER NOT NULL, reason TEXT NOT NULL
);
INSERT INTO disciplinary_policies(effective_date,policy_json,created_at,reason)
 VALUES('1970-01-01','{"secondFine":null,"thirdFine":null,"fourthFine":0,"laterFine":null,"laterAction":"Administrator review required"}',0,'Initial policy - monetary fines require configuration');
CREATE INDEX discipline_policy_date ON disciplinary_policies(effective_date,id);
CREATE TRIGGER discipline_policy_immutable_update BEFORE UPDATE ON disciplinary_policies BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable discipline policy');
END;
CREATE TRIGGER discipline_policy_immutable_delete BEFORE DELETE ON disciplinary_policies BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable discipline policy');
END;
CREATE TRIGGER discipline_policy_locked BEFORE INSERT ON disciplinary_policies BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked discipline policy') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.effective_date<=to_date);
END;
CREATE TABLE daily_work_reviews (
 employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 rating TEXT NOT NULL CHECK(rating IN ('excellent','good','bad')), comment TEXT NOT NULL,
 attendance_snapshot TEXT NOT NULL, reviewed_by TEXT NOT NULL REFERENCES users(id), reviewed_at INTEGER NOT NULL,
 PRIMARY KEY(employee_id,work_date)
);
CREATE TABLE daily_uniform_confirmations (
 employee_id TEXT NOT NULL REFERENCES employees(id), work_date TEXT NOT NULL,
 declared_at INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 decision_reason TEXT, reviewed_by TEXT REFERENCES users(id), reviewed_at INTEGER,
 PRIMARY KEY(employee_id,work_date),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
 (status!='pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(decision_reason)>=5))
);
CREATE TABLE early_departure_reviews (
 shift_id TEXT PRIMARY KEY REFERENCES scheduled_shifts(id), employee_id TEXT NOT NULL REFERENCES employees(id),
 work_date TEXT NOT NULL, source_token TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('approved','rejected')), reason TEXT NOT NULL,
 reviewed_by TEXT NOT NULL REFERENCES users(id), reviewed_at INTEGER NOT NULL
);
CREATE VIEW discipline_workdays AS
 SELECT employee_id,work_date,min(check_in) AS first_in,max(coalesce(check_out,check_in)) AS last_time,
 sum(check_out IS NULL) AS open_sessions,
 json_group_array(json_object('id',id,'in',check_in,'out',check_out,'shift',shift_id)) AS attendance_snapshot
 FROM (SELECT * FROM effective_attendance ORDER BY id) GROUP BY employee_id,work_date;
CREATE VIEW discipline_lateness AS
 SELECT s.id AS shift_id,s.employee_id,s.work_date,s.start_at,s.end_at,min(a.check_in) AS first_in,
 CAST((min(a.check_in)-s.start_at)/60 AS INTEGER) AS late_minutes
 FROM scheduled_shifts s JOIN effective_attendance a ON a.shift_id=s.id AND a.employee_id=s.employee_id
 WHERE s.kind='regular' AND s.status='scheduled'
 GROUP BY s.id HAVING min(a.check_in)>=s.start_at+60;
CREATE VIEW discipline_sources AS
 SELECT 'late:'||shift_id AS id,employee_id,work_date,first_in AS occurred_at,'lateness' AS category,
 CAST(late_minutes AS TEXT)||' minute(s) late' AS reason,
 json_object('start',start_at,'arrival',first_in) AS source_token FROM discipline_lateness
 UNION ALL
 SELECT 'quality:'||r.employee_id||':'||r.work_date,r.employee_id,r.work_date,r.reviewed_at,'quality',r.comment,
 json_object('rating',r.rating,'snapshot',r.attendance_snapshot,'at',r.reviewed_at,'comment',r.comment)
 FROM daily_work_reviews r JOIN discipline_workdays w ON w.employee_id=r.employee_id AND w.work_date=r.work_date
 WHERE r.rating='bad' AND r.attendance_snapshot=w.attendance_snapshot
 UNION ALL
 SELECT 'uniform:'||r.employee_id||':'||r.work_date,r.employee_id,r.work_date,r.reviewed_at,'uniform',r.decision_reason,
 json_object('status',r.status,'at',r.reviewed_at,'reason',r.decision_reason)
 FROM daily_uniform_confirmations r JOIN discipline_workdays w ON w.employee_id=r.employee_id AND w.work_date=r.work_date
 WHERE r.status='rejected';
CREATE TABLE violation_decisions (
 violation_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),work_date TEXT NOT NULL,
 source_token TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('confirmed','excused','reversed')),
 reason TEXT NOT NULL,decided_by TEXT NOT NULL REFERENCES users(id),decided_at INTEGER NOT NULL
);
CREATE TABLE manager_meetings (
 violation_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),work_date TEXT NOT NULL,
 progression_token TEXT NOT NULL,reason TEXT NOT NULL,completed_by TEXT NOT NULL REFERENCES users(id),completed_at INTEGER NOT NULL
);
CREATE TRIGGER discipline_attendance_insert AFTER INSERT ON attendance_sessions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_attendance_update AFTER UPDATE ON attendance_sessions BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_manual_insert AFTER INSERT ON manual_attendance BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_shift_insert AFTER INSERT ON scheduled_shifts BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_shift_update AFTER UPDATE ON scheduled_shifts BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_payroll_lock_insert AFTER INSERT ON payroll_period_locks BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_payroll_lock_update AFTER UPDATE ON payroll_period_locks BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_payroll_lock_delete AFTER DELETE ON payroll_period_locks BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER discipline_violation_insert BEFORE INSERT ON violation_decisions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT changed violation') WHERE NOT EXISTS(SELECT 1 FROM discipline_sources WHERE id=NEW.violation_id AND employee_id=NEW.employee_id AND work_date=NEW.work_date AND source_token=NEW.source_token);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_violation_update BEFORE UPDATE ON violation_decisions BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT changed violation') WHERE NOT EXISTS(SELECT 1 FROM discipline_sources WHERE id=NEW.violation_id AND employee_id=NEW.employee_id AND work_date=NEW.work_date AND source_token=NEW.source_token);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_early_insert BEFORE INSERT ON early_departure_reviews BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_early_update BEFORE UPDATE ON early_departure_reviews BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_meeting_insert BEFORE INSERT ON manager_meetings BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_meeting_update BEFORE UPDATE ON manager_meetings BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_quality_insert BEFORE INSERT ON daily_work_reviews BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT unavailable workday') WHERE NOT EXISTS(SELECT 1 FROM discipline_workdays WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND attendance_snapshot=NEW.attendance_snapshot);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_quality_update BEFORE UPDATE ON daily_work_reviews BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT unavailable workday') WHERE NOT EXISTS(SELECT 1 FROM discipline_workdays WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND attendance_snapshot=NEW.attendance_snapshot);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_uniform_insert BEFORE INSERT ON daily_uniform_confirmations BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT unavailable workday') WHERE NOT EXISTS(SELECT 1 FROM discipline_workdays WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TRIGGER discipline_uniform_update BEFORE UPDATE ON daily_uniform_confirmations BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT unavailable workday') WHERE NOT EXISTS(SELECT 1 FROM discipline_workdays WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date);
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked review') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.work_date BETWEEN from_date AND to_date);
END;
CREATE TABLE discipline_source_history (
 violation_id TEXT NOT NULL, source_token TEXT NOT NULL, employee_id TEXT NOT NULL REFERENCES employees(id),
 work_date TEXT NOT NULL,category TEXT NOT NULL,reason TEXT NOT NULL,occurred_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL,
 PRIMARY KEY(violation_id,source_token)
);
CREATE INDEX discipline_history_period ON discipline_source_history(employee_id,work_date);
INSERT OR IGNORE INTO discipline_source_history
 SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources;
CREATE TRIGGER discipline_history_immutable_update BEFORE UPDATE ON discipline_source_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable violation history');
END;
CREATE TRIGGER discipline_history_immutable_delete BEFORE DELETE ON discipline_source_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable violation history');
END;
CREATE TRIGGER discipline_archive_attendance_sessions_insert_after AFTER INSERT ON attendance_sessions BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_attendance_sessions_update_before BEFORE UPDATE ON attendance_sessions BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_attendance_sessions_update_after AFTER UPDATE ON attendance_sessions BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_manual_attendance_insert_after AFTER INSERT ON manual_attendance BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_daily_work_reviews_insert_after AFTER INSERT ON daily_work_reviews BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_daily_work_reviews_update_before BEFORE UPDATE ON daily_work_reviews BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=OLD.employee_id AND work_date=OLD.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
END;
CREATE TRIGGER discipline_archive_daily_work_reviews_update_after AFTER UPDATE ON daily_work_reviews BEGIN
 INSERT INTO discipline_source_history SELECT id,source_token,employee_id,work_date,category,reason,occurred_at,unixepoch() FROM discipline_sources ds WHERE employee_id=NEW.employee_id AND work_date=NEW.work_date AND NOT EXISTS(SELECT 1 FROM discipline_source_history h WHERE h.violation_id=ds.id AND h.source_token=ds.source_token);
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
