ALTER TABLE telegram_chats ADD COLUMN encouragement INTEGER NOT NULL DEFAULT 1 CHECK(encouragement IN (0,1));
ALTER TABLE notification_outbox ADD COLUMN shift_id TEXT REFERENCES scheduled_shifts(id);
ALTER TABLE notification_outbox ADD COLUMN shift_start_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN shift_end_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN notification_kind TEXT;
ALTER TABLE notification_outbox ADD COLUMN expires_at INTEGER;
UPDATE notification_outbox SET status='failed',error_code='reminder_policy_changed' WHERE status='pending' AND event_key LIKE 'upcoming:%';

CREATE TABLE role_daily_pay_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_id TEXT NOT NULL REFERENCES roles(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), threshold_minutes INTEGER,
 hourly_rate INTEGER, effective_date TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 CHECK((enabled=0 AND threshold_minutes IS NULL AND hourly_rate IS NULL) OR
       (enabled=1 AND threshold_minutes IS NOT NULL AND hourly_rate IS NOT NULL AND threshold_minutes BETWEEN 1 AND 1439 AND hourly_rate BETWEEN 0 AND 1000000000))
);
CREATE INDEX role_daily_pay_effective ON role_daily_pay_history(role_id,effective_date,id);
CREATE TRIGGER role_daily_pay_insert_guard BEFORE INSERT ON role_daily_pay_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT locked daily pay policy') WHERE EXISTS(SELECT 1 FROM payroll_period_locks WHERE NEW.effective_date<=to_date);
END;
CREATE TRIGGER role_daily_pay_revision AFTER INSERT ON role_daily_pay_history BEGIN
 UPDATE discipline_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER role_daily_pay_immutable_update BEFORE UPDATE ON role_daily_pay_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable daily pay policy');
END;
CREATE TRIGGER role_daily_pay_immutable_delete BEFORE DELETE ON role_daily_pay_history BEGIN
 SELECT RAISE(ABORT,'ATBOT_CONFLICT immutable daily pay policy');
END;
