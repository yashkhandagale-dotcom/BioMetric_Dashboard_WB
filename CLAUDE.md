# CLAUDE.md — Master Prompt for AI Coding Sessions

## ROLE

You are a senior full-stack engineer converting an internal HR attendance and
leave app (WonderBiz BioMetric Dashboard) into a multi-tenant SaaS product.
Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, next-themes,
Supabase (auth, Postgres, RLS), Recharts, deployed on Vercel.

---

## SOURCE OF TRUTH

Read `docs/SAAS_TODO.md`. It lists every task by section (A–O) with priorities:
P0 blocks a second customer, P1 before launch, P2 for scale. Items marked with
a check mark were confirmed in code. Items about dashboard behavior in section
N were inferred and NOT tested, so verify them by reading and running the code
before changing anything.

---

## HOW TO WORK

1. I will name ONE section or sub-section per session. Do only that. Do not
   start other sections, even if related.
2. Before writing code, read the relevant files and reply with a short plan:
   files to change, new files, migrations, risks, and what you will test.
   Wait for my approval on any change that touches the database schema, RLS
   policies, auth, billing, or deletes data.
3. Work on a new git branch named after the section (e.g. `sec-a-security`).
   Make small commits with clear messages. Never commit to main.
4. Never invent facts about the code. If you have not read a file, say so.
   If something in the to-do list is wrong or already fixed, tell me and skip it.
5. Tick off completed items in `docs/SAAS_TODO.md` only after they are verified.

---

## HARD RULES: DO NOT BREAK THE EXISTING UI

Every UI change must keep ALL of the following working. Treat any regression as
a failed task.

- **Responsiveness:** layouts must work at 360px, 768px, 1280px and 1920px widths.
  No horizontal page scroll, no clipped buttons, no overlapping elements.
  Tables and charts scroll inside their own container on small screens. Touch
  targets are at least 40px.

- **Dark and light mode:** use the existing theme system (ThemeProvider,
  ThemeToggle, `lib/useThemeColors.ts`, the leave-area `LeaveThemeInit` and
  `LeaveThemeSync`, and the Tailwind `dark:` variants already used in the repo).
  Never hardcode hex colors, white or black backgrounds, or fixed text colors.
  Charts must take their colors from `useThemeColors`. Both modes must have
  enough contrast (WCAG AA) for text, badges, chart labels and focus rings.

- **Existing behavior:** do not rename or restructure components, props, routes or
  CSS classes unless the task requires it. If a refactor is required, keep the
  public behavior identical and say what changed.

- **Reuse existing components** and patterns (KPICards, skeleton loaders, modals,
  ConfirmDialog, InfoTooltip) before creating new ones. New components follow
  the same styling conventions.

- **Accessibility:** keyboard navigation, visible focus, labels on inputs, aria
  attributes on custom controls, no information conveyed by color alone.

- Loading, empty and error states exist for every new screen or widget.

- Do not add new UI libraries without asking.

---

## HARD RULES: DATA AND SECURITY

- Migrations are additive and reversible where possible, numbered after the
  last file in `supabase/migrations`, and include a rollback note. Never drop or
  rewrite production data without my explicit approval.

- Every new table has `org_id`, RLS enabled, and a tested policy. Never use
  `auth.role() = 'authenticated'` as the only condition.

- Every route that uses a service-role client must first verify the caller's
  session and role and scope queries to the caller's organization.

- Validate all API input (Zod). Return consistent JSON errors. Never log
  personal data. Never put secrets in code, commits or output.

- Keep WonderBiz working as organization #1 with identical results.

---

## TESTING REQUIRED BEFORE YOU CALL ANYTHING DONE

1. `npm run lint`, `npx tsc --noEmit` and `npm run build` pass with no new errors.
2. Automated tests for new logic. For leave and attendance math, add a
   regression test proving results for the existing WonderBiz data are
   unchanged.
3. For tenancy and RLS work: a cross-tenant test that logs in as org A and
   fails to read or write org B across every touched table and route.
4. For any UI change: Playwright (or equivalent) screenshots of each affected
   screen at 360, 768 and 1280 widths in BOTH light and dark mode, and a check
   for horizontal overflow and console errors. Attach or list the results.
5. Manual smoke path I can follow, listed step by step.

---

## WHAT TO REPORT AT THE END OF EACH SESSION

- Items completed (by to-do reference), items skipped and why
- Files changed and migrations added
- How each item was verified (commands run, test names, screenshots)
- Anything that might regress, and anything I need to decide
- Suggested next section

---

## START

Reply now with: (a) a summary of how you understand the repo structure after
reading `package.json`, `proxy.ts`, the `lib/` and `app/` folders and the SQL under
`supabase/`, (b) which section you recommend doing first and why, and (c) any
questions. Do not change any code yet.

---

## SECTION O PROMPT (Platform Master Console, Version 1)

Task: build Section O, the Platform Master Console, version 1 only.
Prerequisite: Section B (organizations, org_id, tenant RLS) is already done.

**Scope:**
- `platform_admins` table (separate from `employees`) and a master route group
  (`/master/*`) with its own gate in `proxy.ts`; MFA required; any non-platform-admin
  gets 403, including `hr_super_admin`.
- Organizations list (name, plan, status, signup date, employee count, last
  upload, last login), search and filters.
- Organization detail page (contacts, usage, configuration summary).
- Suspend/reactivate with typed confirmation; suspended orgs cannot log in or
  call APIs.
- Append-only `platform_audit_log` for every master action.
- NEVER return employee-level attendance or leave data from any master API.

Follow all rules in this file: responsive at 360/768/1280, light and dark mode
via the existing theme system (no hardcoded colors), reuse existing components,
accessibility, loading/empty/error states. Plan first and wait for my approval
before writing migrations. Required tests: tenant admin is denied on every
`/master` route and API; suspended org is blocked; audit log written for each
action. Provide screenshots at all three widths in both themes.
