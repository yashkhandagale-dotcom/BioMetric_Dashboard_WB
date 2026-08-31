-- Attendance-driven half-day reconciliation for approved leave.
-- A normal full-day leave request remains a single continuous period in the UI.
-- When biometric attendance proves <=5 hours on a covered date, that date
-- contributes 0.5 instead of 1.0. Missed/single punches are not auto-converted.

alter table balance_transactions
  drop constraint if exists balance_transactions_reason_check,
  add constraint balance_transactions_reason_check check (reason in
      ('comp_off_credit', 'hr_manual_adjustment', 'carry_forward',
       'encashment', 'lapse', 'leave_approved', 'leave_cancelled',
       'lwp_conversion', 'pro_ration_initial', 'opening_balance_seed',
       'attendance_half_day_adjustment'));

create or replace function fn_reconcile_leave_attendance_days(p_leave_request_id uuid)
returns table(
  adjusted boolean,
  previous_total numeric,
  total_days numeric,
  short_dates date[]
) as $$
declare
  v_req record;
  v_employee_code text;
  v_previous numeric;
  v_total numeric;
  v_date date;
  v_rec record;
  v_minutes integer;
  v_short_dates date[] := '{}';
  v_balance_id uuid;
  v_fy_start_year integer;
  v_delta numeric;
begin
  -- Serialize reconciliation for this request so repeated CSV uploads or
  -- concurrent approval/upload events cannot double-adjust the balance.
  perform pg_advisory_xact_lock(hashtextextended(p_leave_request_id::text, 0));

  select lr.*, lt.code as leave_type_code, lt.is_directly_applicable
    into v_req
  from leave_requests lr
  join leave_types lt on lt.id = lr.leave_type_id
  where lr.id = p_leave_request_id;

  if not found then
    raise exception 'leave_requests row % not found', p_leave_request_id;
  end if;

  v_previous := v_req.total_days;

  -- Explicit half-day requests are already authoritative. Pending/rejected/
  -- cancelled rows are not balance-bearing and therefore are not reconciled.
  if v_req.is_half_day or v_req.status not in ('approved', 'auto_lwp') or not v_req.is_directly_applicable then
    return query select false, v_previous, v_previous, v_short_dates;
    return;
  end if;

  select employee_code into v_employee_code from employees where id = v_req.employee_id;
  if v_employee_code is null then
    raise exception 'Employee % has no employee_code', v_req.employee_id;
  end if;

  v_total := 0;
  v_date := v_req.start_date;
  while v_date <= v_req.end_date loop
    select ar.status, ar.duration, ar.in_time, ar.out_time, ar.is_short_day
      into v_rec
    from attendance_records ar
    where ar.employee_code = v_employee_code
      and ar.date = v_date::text
    order by ar.updated_at desc
    limit 1;

    -- Only a valid present day with a measurable duration <=5 hours is
    -- evidence strong enough to reduce leave. Missed/single punches remain
    -- Possible Half Day for the existing HR workflow.
    v_minutes := 0;
    if found
       and coalesce(lower(v_rec.status), '') like '%present%'
       and coalesce(lower(v_rec.status), '') not like '%absent%'
       and v_rec.duration is not null
       and v_rec.duration ~ '^[0-9]+:[0-9]{1,2}$' then
      v_minutes := split_part(v_rec.duration, ':', 1)::integer * 60
                   + split_part(v_rec.duration, ':', 2)::integer;
    end if;

    if v_minutes > 0 and v_minutes <= 300 then
      v_total := v_total + 0.5;
      v_short_dates := array_append(v_short_dates, v_date);
    else
      v_total := v_total + 1;
    end if;

    v_date := v_date + 1;
  end loop;

  v_delta := v_total - v_previous;

  if v_delta <> 0 then
    update leave_requests
       set total_days = v_total, updated_at = now()
     where id = p_leave_request_id;

    -- Mirror fn_debit_leave_on_approval's 25-Mar FY rule.
    if extract(month from v_req.start_date) > 3
       or (extract(month from v_req.start_date) = 3 and extract(day from v_req.start_date) >= 25) then
      v_fy_start_year := extract(year from v_req.start_date)::integer;
    else
      v_fy_start_year := extract(year from v_req.start_date)::integer - 1;
    end if;

    select id into v_balance_id
    from leave_balances
    where employee_id = v_req.employee_id
      and leave_type_id = v_req.leave_type_id
      and fy_start_year = v_fy_start_year
    for update;

    if v_balance_id is null then
      raise exception 'No leave balance found for employee %, leave type %, FY%', v_req.employee_id, v_req.leave_type_code, v_fy_start_year;
    end if;

    update leave_balances
       set used = used + v_delta, updated_at = now()
     where id = v_balance_id;

    insert into balance_transactions (leave_balance_id, delta, reason, reference_id, note)
    values (v_balance_id, -v_delta, 'attendance_half_day_adjustment', p_leave_request_id,
            format('Biometric reconciliation changed leave from %s to %s day(s); short-day date(s): %s',
                   v_previous, v_total, array_to_string(v_short_dates, ', ')));
  end if;

  -- If the Possible Half Day queue already has an exception row for one of
  -- these dates, resolve it automatically against the approved leave. This
  -- prevents HR from seeing the same biometric short day and accidentally
  -- recording a second half-day leave manually.
  if array_length(v_short_dates, 1) is not null then
    update attendance_exceptions
       set exception_type = 'possible_half_day',
           resolution = 'leave_recorded',
           resolution_note = format('Automatically reconciled with approved %s leave request %s from biometric short-day evidence.', v_req.leave_type_code, p_leave_request_id),
           leave_request_id = p_leave_request_id,
           resolved_at = now(),
           updated_at = now()
     where employee_id = v_req.employee_id
       and exception_date = any(v_short_dates)
       and resolution in ('pending', 'ignored');
  end if;

  return query select (v_delta <> 0), v_previous, v_total, v_short_dates;
end;
$$ language plpgsql;
