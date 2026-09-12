'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface IMultiSelectOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  /** Findings matching this option, shown next to the label so a zero-count option isn't worth clicking. */
  readonly count?: number;
}

interface IMultiSelectProps<T extends string | number> {
  readonly label: string;
  readonly options: readonly IMultiSelectOption<T>[];
  readonly selected: readonly T[];
  readonly onChange: (values: T[]) => void;
}

export function MultiSelect<T extends string | number>({
  label,
  options,
  selected,
  onChange,
}: IMultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonId = useId();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function toggle(value: T) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const summary =
    selected.length === 0
      ? 'All'
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? String(selected[0]))
        : `${selected.length} selected`;

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={buttonId} className="mb-1 block text-xs text-text-dim">
        {label}
      </label>
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-48 truncate border border-line bg-surface-2 px-2 py-1.5 text-left text-sm text-text outline-none focus:border-accent"
      >
        {summary}
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-64 overflow-y-auto border border-line bg-surface-2 shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-text-dim">No options</p>
          ) : (
            options.map((option) => {
              const disabled = option.count === 0;
              return (
                <label
                  key={option.value}
                  className={`flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-surface ${
                    disabled ? 'cursor-not-allowed text-text-dim' : 'cursor-pointer text-text'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    disabled={disabled}
                    onChange={() => toggle(option.value)}
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.count !== undefined && (
                    <span className="font-mono text-xs text-text-dim">{option.count}</span>
                  )}
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
