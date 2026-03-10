'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Settings, Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

export function SettingsMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'p-2 rounded-lg transition-colors',
          open
            ? 'bg-[#207679]/10 text-[#207679] dark:bg-teal-500/20 dark:text-teal-300'
            : 'hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground'
        )}
        title="Theme settings"
        aria-label="Open theme settings"
        aria-expanded={open}
      >
        <Settings className="h-5 w-5" />
      </button>

      {open && (
        <div className="animate-dropdown absolute right-0 top-full mt-2 w-44 z-50 py-1.5 rounded-xl border border-border bg-popover shadow-xl">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => {
                setTheme(value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors rounded-lg mx-auto',
                theme === value
                  ? 'text-[#207679] dark:text-teal-300 font-medium bg-[#207679]/10 dark:bg-teal-500/15'
                  : 'text-foreground hover:bg-black/5 dark:hover:bg-white/10'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {theme === value && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#207679] dark:bg-teal-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
