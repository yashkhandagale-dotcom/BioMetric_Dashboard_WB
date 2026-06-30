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

export default function InfoTooltip({ title, description, formula, example, position = 'bottom' }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  const positionClasses = {
    bottom: 'top-full mt-2 left-0',
    top: 'bottom-full mb-2 left-0',
    left: 'right-full mr-2 top-0',
    right: 'left-full ml-2 top-0',
  };

  return (
    <div ref={ref} className="relative inline-flex" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className="text-slate-500 hover:text-slate-300 transition-colors flex items-center"
        title={title}
        aria-label={`Info: ${title}`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          className={`absolute z-50 bg-slate-900 border border-slate-600 rounded-xl p-4 shadow-2xl w-72 text-xs ${positionClasses[position]}`}
          style={{ minWidth: 260 }}
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
