'use client';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  title: string;
  description: string;
  formula?: string;
  example?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const TIP_W = 280;
const TIP_H = 160;

export default function InfoTooltip({ title, description, formula, example }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Only render the portal on the client (avoids SSR "document is not defined")
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    function computePosition() {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // NOTE: rect.top/left/bottom are already viewport-relative,
      // which is exactly what `position: fixed` needs — do NOT add
      // window.scrollX/scrollY here (that's only correct for `absolute`).
      let top = rect.bottom + 6;
      if (top + TIP_H > vh - 8) {
        top = rect.top - TIP_H - 6; // flip above if it would overflow bottom
      }
      if (top < 8) top = 8;

      let left = rect.left;
      if (left + TIP_W > vw - 8) left = vw - TIP_W - 8;
      if (left < 8) left = 8;

      setPos({ top, left });
    }

    computePosition();

    // Keep it glued to the button while open (scroll/resize)
    window.addEventListener('scroll', computePosition, true);
    window.addEventListener('resize', computePosition);

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
      window.removeEventListener('scroll', computePosition, true);
      window.removeEventListener('resize', computePosition);
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

      {open && mounted && createPortal(
        <div
          ref={tipRef}
          className="fixed z-[9999] bg-slate-900 border border-slate-600 rounded-xl p-4 shadow-2xl text-xs opacity-100"
          style={{ width: TIP_W, top: pos.top, left: pos.left }}
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
        </div>,
        document.body
      )}
    </div>
  );
}