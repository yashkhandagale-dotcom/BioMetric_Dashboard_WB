# BioMetric Attendance Dashboard

An internal HR analytics tool built for WonderBiz Technologies. It ingests raw CSV/Excel exports from biometric attendance machines and turns them into KPIs, charts, and per‑employee drill-downs — no backend, no database, everything runs client-side in the browser.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4** for styling
- **Recharts** for charts, **jsPDF / jspdf-autotable** for PDF export, **xlsx** for Excel export
- **PapaParse** for CSV parsing
- Data persistence via **localStorage** (no server-side DB)

## Key Features

- **Multi-file upload** with fuzzy column mapping — auto-detects biometric export columns even if headers vary between machines
- **KPI dashboard**: attendance rate, absenteeism, late/early rates, productivity loss — with configurable thresholds (Settings panel)
- **Attendance heatmap** and **office-wise comparison** (e.g. Mumbai vs Hyderabad)
- **Leave management**: mark planned/casual/sick/LWP/half-day leave per employee
- **Predefined holiday calendars** per office/year, plus support for ad-hoc custom holidays
- **Employee-level drill-down**: individual attendance timeline, punch records, comparison view
- **Day-level filtering** and view-mode-aware KPI cards
- **Export**: PDF reports and Excel export of processed data
- **LAN sharing**: generate a shareable link so a manager on the same network can view the same dataset — the data lives on the server behind a short-lived random token and expires after 24 hours, it is never embedded in the URL itself
- **Backup & restore**: export every record, mapping, leave, holiday, and threshold to one JSON file from Settings → Backup, and restore from it later
- **Department comparison**: select 2+ departments to get a side-by-side KPI comparison table, a per-department daily trend line chart, and dimmed/highlighted department bar charts
- **Basic-auth middleware** protecting all routes (intended for local/LAN use only — see note below)

## Getting Started

```bash
npm install
cp .env.example .env   # then edit .env and set your own DASHBOARD_AUTH_USER / DASHBOARD_AUTH_PASS
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Log in with whatever credentials you set in `.env`. There is no default password — the app rejects every request if the env vars aren't set.

To build for production:

```bash
npm run build
npm start          # binds to all interfaces (0.0.0.0) — needed for LAN sharing with a manager
npm run start:local  # binds to 127.0.0.1 only, if you never want this reachable from other devices
```

## Project Structure

```
app/                  Next.js App Router entry (page.tsx, layout.tsx, globals.css)
app/api/shared-link/   Server-side token store backing the manager shared-link view
components/           UI components (upload, KPI cards, charts, panels, modals)
lib/                   Business logic — CSV parsing, column matching, thresholds,
                       holidays, leave storage, PDF/Excel export, shared-link logic
middleware.ts          Basic-auth gate for all routes
```

## Usage Flow

1. **Upload** one or more biometric CSV/Excel exports via the Upload Zone
2. **Map columns** — the app suggests a mapping automatically; confirm or adjust
3. Review the **dashboard**: KPIs, charts, heatmap, office comparison
4. Drill into individual **employees**, mark **leave**, or manage the **holiday calendar**
5. Select 2+ departments to enter **comparison mode**: a comparison table plus per-department trend and bar charts
6. **Export** results as PDF or Excel, generate a **LAN share link** for a manager, or **back up all data** to a JSON file

## Notes & Known Limitations

- All data is stored in the browser's `localStorage` — clearing browser data wipes it. Use Settings → Backup to export/restore a JSON snapshot as a safety net. This is a POC design choice
- Authentication in `middleware.ts` reads credentials from `DASHBOARD_AUTH_USER` / `DASHBOARD_AUTH_PASS` environment variables (see `.env.example`) — never hardcode credentials in source
- Shared links use a random, expiring (24h) server-side token rather than embedding data in the URL — see `app/api/shared-link`. The in-memory store is per server process, so it resets on restart
- Shift window and grace periods are configurable per office in the Settings panel (defaults: 09:30–18:30 shift, 10-minute grace).
