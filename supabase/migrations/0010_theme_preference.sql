-- 0010: per-employee theme preference (Workstream 2, step 2 — toggle
-- persistence). Lets an employee's dark/light choice follow them across
-- devices/logins instead of being tied to one browser's localStorage.
-- The attendance dashboard side deliberately stays localStorage-only
-- (next-themes' default), matching its existing no-backend design —
-- this column is read/written only by app/api/leave/theme/route.ts.
alter table employees
    add column if not exists theme_preference text not null default 'dark'
        check (theme_preference in ('dark', 'light'));
