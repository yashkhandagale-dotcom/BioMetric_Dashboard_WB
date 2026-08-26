// Wraps every /leave/** route (admin, me, team, approvals, login,
// change-password) — Next.js nests each subtree's own layout.tsx (auth
// guards + the shared LeaveShell nav) inside this one. This file itself
// does NOT gate anything and does NOT render any chrome of its own.
//
// It used to also mount a full-width row containing nothing but the
// theme toggle, above every single /leave/** page (including the ones
// that already had their own header) — that stray bar was the "the
// dark/light toggle is taking up the whole header" issue: a full-bleed
// strip whose only content was one small icon button. The toggle now
// lives inside LeaveShell (sidebar footer on desktop, top bar on
// mobile), sized like the compact icon button it always was, so this
// layout has nothing left to render beyond the themed background.
// LeaveThemeInit IS mounted here though (not chrome — no visible output)
// specifically because this is the one layout in the /leave/** tree that
// doesn't get torn down and rebuilt when navigating between top-level
// sections (me/approvals/team/admin each have their own layout.tsx).
// Reading the saved theme_preference from the DB here, once per section
// entry, is what fixes the "theme flips every time I switch tabs" bug —
// it used to be read inside LeaveShell itself, which DOES remount on
// every such switch. See LeaveThemeInit.tsx for the full explanation.
import './globals.css';
import LeaveThemeInit from '@/components/leave/LeaveThemeInit';
import ThemeProvider from '@/components/ThemeProvider';
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const _themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(!t)return;document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme = t==='dark'? 'dark':'light';}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: _themeInitScript }} />
      </head>
      <body className="bg-[var(--bg-surface)] min-h-screen">
        <ThemeProvider>
          <LeaveThemeInit />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}