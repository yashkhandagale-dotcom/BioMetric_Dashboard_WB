-- =====================================================================
-- WonderBiz Leave Management System — HR leave correction
-- Migration: 0013_hr_leave_correction.sql
--
-- Adds a distinct HR-only action for reversing an approved/auto_lwp
-- leave_requests row AFTER its dates have already passed — something
-- the existing cancellation route deliberately does not allow (you
-- cannot "cancel" leave that already happened; see
-- app/api/leave/requests/[id]/cancel/route.ts's own already-started
-- guard). This is a data-correction tool ("the record is wrong, credit
-- the days back"), not a cancellation, so it gets its own audit trail
-- rather than overloading cancelExistingRequest's semantics.
--
-- Reuses status='cancelled' (no new leave_requests.status value — the
-- existing check constraint already treats 'cancelled' as "not counted,
-- balance not held" everywhere it's read) but tags the row with WHO
-- corrected it, WHY, and WHEN, so the UI can render "Cancelled" for a
-- normal withdraw/cancel and "Reversed by HR — <reason>" for this path
-- without the two being confused.
--
-- Run after 0012_config_regularisation_wfh_thresholds.sql, in the same
-- (unified) Supabase project.
-- =====================================================================

alter table leave_requests
    add column if not exists corrected_by      uuid references employees(id),
    add column if not exists correction_reason text,
    add column if not exists corrected_at      timestamptz;

comment on column leave_requests.corrected_by is
    'HR employee who reversed this ALREADY-FINISHED approved/auto_lwp request (distinct from cancelled_by/withdrawn, which is just the acting employee_id already implied by status=cancelled + no corrected_by).';
comment on column leave_requests.correction_reason is
    'Required free-text reason HR gave for the correction — e.g. "employee actually attended, marked in error". Always non-null when corrected_by is set.';
comment on column leave_requests.corrected_at is
    'When the correction was made — distinct from updated_at, which also moves on unrelated edits.';

-- Widen notifications.type to accept the new event so notifyLeaveEvent
-- can insert a 'leave_corrected' row the same way every other event
-- type already does (same pattern as migration 0012's own widening for
-- the WFH types).
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
    check (type in
        ('leave_submitted', 'leave_approved', 'leave_rejected', 'leave_cancelled', 'leave_reminder',
         'wfh_submitted', 'wfh_approved', 'wfh_rejected', 'wfh_cancelled',
         'leave_corrected'));
