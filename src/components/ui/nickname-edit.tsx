'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NicknameEditProps {
  /** Current nickname value. Null/empty shows the emptyPlaceholder. */
  value: string | null | undefined;
  /**
   * Save handler — resolve on success (exits edit mode), reject/throw to
   * keep the editor open. The parent typically calls an API + toast here.
   */
  onSave: (newValue: string | null) => Promise<void>;
  /** Shown when value is null/empty. Default: italic "No nickname". */
  emptyPlaceholder?: React.ReactNode;
  /** Placeholder inside the edit input. Default: "Enter nickname…". */
  placeholder?: string;
  /** Optional icon rendered before the display value (e.g., Settings2 for ERP rows). */
  prefixIcon?: React.ReactNode;
  /** Require non-empty to enable Save. Default true. */
  requireNonEmpty?: boolean;
  /** aria-label on the Edit pencil button. Specify for screen readers. */
  editAriaLabel: string;
  /** Extra className on the outer wrapper. */
  className?: string;
  /** Extra className on the display-mode label text. */
  labelClassName?: string;
}

/**
 * Shared inline nickname edit pattern — pencil icon in display mode, Input
 * + Save/Cancel in edit mode. Enter saves, Escape cancels. Used across
 * Wallets, Bank Accounts, and ERP rows so all three surfaces read alike.
 */
export function NicknameEdit({
  value,
  onSave,
  emptyPlaceholder = <span className="text-muted-foreground italic">No nickname</span>,
  placeholder = 'Enter nickname…',
  prefixIcon,
  requireNonEmpty = true,
  editAriaLabel,
  className,
  labelClassName,
}: NicknameEditProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setEditValue(value ?? '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditValue('');
  };

  const saveEdit = async () => {
    const trimmed = editValue.trim();
    if (requireNonEmpty && !trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <Input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder={placeholder}
          className="h-7 text-sm w-44"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit();
            if (e.key === 'Escape') cancelEdit();
          }}
          disabled={saving}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={saveEdit}
          disabled={saving || (requireNonEmpty && !editValue.trim())}
          aria-label="Save nickname"
        >
          <Check className="h-3.5 w-3.5 text-green-600" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={cancelEdit}
          disabled={saving}
          aria-label="Cancel edit"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {prefixIcon}
      <span className={cn('text-sm', value ? 'font-medium' : '', labelClassName)}>
        {value || emptyPlaceholder}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={startEdit}
        aria-label={editAriaLabel}
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}
