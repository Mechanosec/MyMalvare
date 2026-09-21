'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface IRepositorySelectProps {
  readonly options: readonly { value: number; label: string; name: string }[];
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export function RepositorySelect({ options, value, onChange, placeholder = 'Select a repository…', disabled = false }: IRepositorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const matches = options.filter((option) => option.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(next: number | null) {
    onChange(next);
    close();
  }

  return (
    <div ref={root} className="relative w-64" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <label htmlFor={id} className="mb-1 block text-xs text-text-dim">Repository</label>
      <button
        ref={trigger} id={id} type="button" aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        aria-controls={open ? `${id}-list` : undefined}
        title={selected?.label}
        onClick={() => { setOpen(!open); setQuery(''); setActive(-1); }}
        className="flex w-full items-center justify-between gap-2 border border-line bg-surface-2 px-2 py-1.5 text-left text-sm text-text outline-none focus:border-accent disabled:opacity-50"
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <span aria-hidden="true" className="shrink-0 text-text-dim">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[min(32rem,calc(100vw-2rem))] border border-line bg-surface-2 shadow-xl">
          <div className="border-b border-line p-2">
            <input
              autoFocus role="combobox" aria-label="Search repositories" aria-expanded="true"
              aria-controls={`${id}-list`} aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
              value={query} placeholder="Search owner/repository…"
              onChange={(event) => { setQuery(event.target.value); setActive(-1); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { event.preventDefault(); close(); }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((previous) => matches.length === 0 ? -1 : event.key === 'ArrowDown'
                    ? Math.min(previous + 1, matches.length - 1) : Math.max(previous - 1, 0));
                }
                if (event.key === 'Enter' && matches[active]) { event.preventDefault(); choose(matches[active].value); }
              }}
              className="w-full border border-line bg-ink px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
            />
          </div>
          <div id={`${id}-list`} role="listbox" aria-label="Repositories" className="max-h-64 overflow-y-auto p-1">
            {matches.map((option, index) => (
              <button
                key={option.value} id={`${id}-${index}`} type="button" role="option"
                tabIndex={-1} aria-selected={value === option.value} title={option.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
                className={`flex w-full items-center gap-2 border-l-2 px-2 py-2 text-left text-sm hover:bg-surface ${value === option.value ? 'border-accent bg-accent/15 font-medium text-accent' : 'border-transparent text-text'} ${index === active ? 'ring-1 ring-inset ring-accent' : ''}`}
              ><span className="min-w-0 flex-1 truncate">{option.label}</span>{value === option.value && <span aria-hidden="true">✓</span>}</button>
            ))}
          </div>
          {matches.length === 0 && <p role="status" className="px-3 py-3 text-sm text-text-dim">No matching repositories.</p>}
          {value !== null && <button type="button" onClick={() => choose(null)} className="w-full border-t border-line px-3 py-2 text-left text-xs text-text-dim hover:text-text">Clear selection</button>}
        </div>
      )}
    </div>
  );
}
