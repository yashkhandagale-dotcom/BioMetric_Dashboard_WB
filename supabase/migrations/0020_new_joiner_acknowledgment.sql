-- 0020_new_joiner_acknowledgment.sql
--
-- Adds rejection tracking to pending_employee_signups table so HR can
-- reject new joiners with a note, in addition to acknowledging them.

alter table pending_employee_signups
  add column if not exists status text not null default 'pending', -- pending, acknowledged, rejected
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists rejection_reason text;

create index if not exists idx_pending_signups_status
  on pending_employee_signups (status, created_at);

comment on column pending_employee_signups.status is
  'Status of the pending signup: pending (awaiting HR action), acknowledged (HR confirmed and created employee record), or rejected (HR declined).';

comment on column pending_employee_signups.acknowledged_at is
  'Timestamp when HR acknowledged this signup and created the employee record.';

comment on column pending_employee_signups.acknowledged_by is
  'User ID of the HR person who acknowledged this signup.';

comment on column pending_employee_signups.rejected_at is
  'Timestamp when HR rejected this signup.';

comment on column pending_employee_signups.rejected_by is
  'User ID of the HR person who rejected this signup.';

comment on column pending_employee_signups.rejection_reason is
  'Optional note/reason provided by HR when rejecting the signup.';
