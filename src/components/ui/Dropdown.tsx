import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Theme-aware select replacement. Native <select> renders its option list with
 * the OS/GTK theme, which ignores the app's active theme. This builds the menu
 * from theme CSS vars (`surface`, `--color-border`, accent) so it always matches.
 */
export default function Dropdown<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input-base w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute z-[60] left-0 right-0 mt-1 surface border border-border rounded-lg
                     shadow-2xl py-1 max-h-60 overflow-y-auto"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                          ${o.value === value
                            ? "text-accent bg-surface-hover"
                            : "text-foreground-secondary hover:bg-surface-hover"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
