'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

// Workstream 2, step 1 — theme FOUNDATION only. No component migration
// yet (that's a later subpart) — existing hardcoded slate-* classes are
// completely untouched by this file. All this does is make next-themes
// available app-wide and flip a `dark`/`light` class on <html>, which
// app/globals.css's semantic tokens key off of via @custom-variant dark.
//
// defaultTheme="dark" + enableSystem={false}: dark stays the default
// regardless of the visitor's OS setting, so nothing regresses visually
// until the migration pass actually rewires components to read the new
// CSS variables. Flip enableSystem on later if you want OS-preference
// detection instead of an explicit default.
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      {children}
    </NextThemesProvider>
  );
}
