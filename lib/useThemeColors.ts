'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

// Recharts SVG props (stroke/fill) need real color strings — they don't
// reliably resolve CSS var() references the way a className does across
// browsers — so this reads the CSS variables actually applied to <html>
// at render time and returns plain hex, recomputed whenever the theme
// changes (via next-themes' resolvedTheme, which triggers the re-render).
//
// Scope: NEUTRAL/structural chart colors only (grid lines, axis ticks,
// border) — the ones that should flip between the dark and light token
// sets in app/globals.css. Status/accent colors (green = good, amber =
// warning, red = bad, blue = highlight, etc.) are deliberately left as
// fixed hex literals throughout Charts.tsx, not wired to this hook —
// their meaning should stay consistent across themes rather than
// following the surface/text swap.
export function useThemeColors() {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState({
    border: '#334155',
    mutedText: '#94a3b8',
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    setColors({
      border: read('--border', '#334155'),
      mutedText: read('--text-muted', '#94a3b8'),
    });
  }, [resolvedTheme]);

  return colors;
}
