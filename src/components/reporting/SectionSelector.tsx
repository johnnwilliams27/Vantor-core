'use client';
import { SECTION_REGISTRY, type SectionId } from './section-config';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface SectionSelectorProps {
  enabled: Set<SectionId>;
  onToggle: (id: SectionId) => void;
}

export function SectionSelector({ enabled, onToggle }: SectionSelectorProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {SECTION_REGISTRY.map((section) => {
        const isOn = enabled.has(section.id);
        const Icon = section.icon;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onToggle(section.id)}
            className={cn(
              'relative flex items-start gap-3 rounded-lg border p-3.5 text-left transition-all duration-200',
              isOn
                ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
                : 'border-border bg-card hover:border-border/80 hover:bg-muted/30 opacity-70 hover:opacity-90',
            )}
          >
            <div className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors',
              isOn ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              <Icon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{section.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{section.description}</div>
            </div>
            <div className={cn(
              'absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-200',
              isOn
                ? 'border-primary bg-primary text-white'
                : 'border-muted-foreground/30',
            )}>
              {isOn && <Check className="h-3 w-3" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
