'use client';
import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  title: string;
  description: string;
  formula?: string;
  example?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function InfoTooltip({ title, description, formula, example }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Position tooltip intelligently to stay on screen
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const TIP_W = 280;
      const TIP_H = 160;

      let style: typeof pos = {};
      // Vertical: prefer below, fall back to above
      if (rect.bottom + TIP_H + 8 < vh) {
        style.top = rect.bottom + window.scrollY + 6;
      } else {
        style.top = rect.top + window.scrollY - TIP_H - 6;
      }
      // Horizontal: align left of button, clamp to viewport
      let left = rect.left + window.scrollX;
      if (left + TIP_W > vw - 8) left = vw - TIP_W - 8;
      if (left < 8) left = 8;
      style.left = left;
      setPos(style);
    }

    function handleClick(e: MouseEvent) {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        tipRef.current && !tipRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        className="text-slate-500 hover:text-slate-300 transition-colors flex items-center"
        title={title}
        aria-label={`Info: ${title}`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={tipRef}
          className="fixed z-[9999] bg-slate-900 border border-slate-600 rounded-xl p-4 shadow-2xl text-xs"
          style={{ width: 280, ...pos }}
        >
          <p className="text-white font-semibold mb-2">{title}</p>
          <p className="text-slate-300 mb-2">{description}</p>
          {formula && (
            <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700 mb-2">
              <p className="text-slate-400 text-[10px] uppercase tracking-wide mb-1">Formula</p>
              <p className="text-amber-400 font-mono text-xs">{formula}</p>
            </div>
          )}
          {example && (
            <p className="text-slate-400 italic text-[11px]">{example}</p>
          )}
        </div>
      )}
    </div>
  );
}