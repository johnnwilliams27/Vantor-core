'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, value, defaultValue, onChange, onBlur, name, disabled, ...props }, ref) => {
    const [open, setOpen] = React.useState(false);
    const [mounted, setMounted] = React.useState(false);
    const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    const nativeRef = React.useRef<HTMLSelectElement | null>(null);

    React.useEffect(() => { setMounted(true); }, []);

    // Merge refs
    const setRefs = React.useCallback((el: HTMLSelectElement | null) => {
      nativeRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLSelectElement | null>).current = el;
    }, [ref]);

    // Flatten React children into a plain string. Using `String(children)`
    // directly is wrong when children is an array — `Array.prototype.toString`
    // joins with commas, turning `<option>{label} · {time}</option>` into
    // "label, · ,time" in our custom dropdown trigger.
    const childrenToText = (node: React.ReactNode): string => {
      if (node == null || node === false || node === true) return '';
      if (typeof node === 'string' || typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(childrenToText).join('');
      if (React.isValidElement(node)) {
        return childrenToText((node.props as { children?: React.ReactNode }).children);
      }
      return '';
    };

    // Parse option children
    const options = React.useMemo(() => {
      const result: { value: string; label: string }[] = [];
      React.Children.forEach(children, (child) => {
        if (!React.isValidElement(child)) return;
        const childProps = child.props as Record<string, unknown>;
        const val = String(childProps.value ?? '');
        const label = childrenToText(childProps.children as React.ReactNode) || val;
        result.push({ value: val, label });
      });
      return result;
    }, [children]);

    // Get current value from native select
    const currentValue = nativeRef.current?.value ?? String(value ?? defaultValue ?? '');
    const selectedOption = options.find((o) => o.value === currentValue);
    const displayLabel = selectedOption?.label || options[0]?.label || 'Select…';
    const isPlaceholder = !selectedOption || selectedOption.value === '';

    const updatePos = React.useCallback(() => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }, []);

    // Position dropdown when opened + track scroll/resize
    React.useEffect(() => {
      if (!open) return;
      updatePos();
      const onScroll = () => updatePos();
      const onResize = () => updatePos();
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
      };
    }, [open, updatePos]);

    // Close on outside click
    React.useEffect(() => {
      if (!open) return;
      const handler = (e: MouseEvent) => {
        const target = e.target as Node;
        if (containerRef.current?.contains(target)) return;
        if (dropdownRef.current?.contains(target)) return;
        setOpen(false);
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Close on Escape
    React.useEffect(() => {
      if (!open) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [open]);

    const selectOption = (optionValue: string) => {
      const el = nativeRef.current;
      if (el) {
        // Set native select value and fire change event for react-hook-form
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype, 'value'
        )?.set;
        nativeSetter?.call(el, optionValue);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setOpen(false);
    };

    // Force re-render when native value changes
    const [, forceRender] = React.useState(0);

    const dropdown = open && pos && mounted ? createPortal(
      <div
        ref={dropdownRef}
        style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
        className="rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150 origin-top"
      >
        <div className="max-h-60 overflow-y-auto py-1">
          {options.map((opt) => {
            const isSelected = opt.value === currentValue;
            const isEmpty = opt.value === '';
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => selectOption(opt.value)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors text-left',
                  'hover:bg-accent hover:text-accent-foreground',
                  isSelected && !isEmpty && 'bg-accent/50 font-medium',
                  isEmpty && 'text-muted-foreground',
                )}
              >
                <span className="flex-1 truncate">{opt.label}</span>
                {isSelected && !isEmpty && (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>,
      document.body,
    ) : null;

    return (
      <div ref={containerRef} className={cn('relative', className)}>
        {/* Hidden native select — react-hook-form binds to this */}
        <select
          ref={setRefs}
          value={value}
          defaultValue={defaultValue}
          onChange={(e) => {
            onChange?.(e);
            forceRender((n) => n + 1);
          }}
          onBlur={onBlur}
          name={name}
          disabled={disabled}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          {...props}
        >
          {children}
        </select>

        {/* Custom trigger */}
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(!open)}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background transition-colors',
            'hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            open && 'ring-2 ring-ring ring-offset-2',
          )}
        >
          <span className={cn('truncate text-left', isPlaceholder && 'text-muted-foreground')}>
            {displayLabel}
          </span>
          <ChevronDown className={cn(
            'ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )} />
        </button>

        {dropdown}
      </div>
    );
  }
);
Select.displayName = 'Select';

export { Select };
