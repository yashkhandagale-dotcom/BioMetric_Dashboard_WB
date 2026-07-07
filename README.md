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
- **LAN sharing**: generate a shareable link so a manager on the same network can view the same dataset
- **Basic-auth middleware** protecting all routes (intended for local/LAN use only — see note below)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Log in with the credentials configured in `middleware.ts` (default: `admin` / `admin@123`).

To build for production:

```bash
npm run build
npm start
```

## Project Structure

```
app/                  Next.js App Router entry (page.tsx, layout.tsx, globals.css)
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
5. **Export** results as PDF or Excel, or generate a **LAN share link** for a manager

## Notes & Known Limitations

- All data is stored in the browser's `localStorage` — clearing browser data wipes it. This is a POC design choice
- Authentication in `middleware.ts` is a simple hardcoded basic-auth check 
- Shift window and grace periods are configurable per office in the Settings panel (defaults: 09:30–18:30 shift, 10-minute grace).
