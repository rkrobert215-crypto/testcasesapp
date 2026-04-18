import { type ReactNode } from 'react';
import { Brain, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface PlanningInputCardProps {
  title: string;
  description: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  isLoading: boolean;
  submitLabel: string;
  loadingLabel: string;
  loadingMessage: string;
  emptyStateTitle: string;
  emptyStateItems: string[];
  icon: ReactNode;
  resultVisible: boolean;
}

export function PlanningInputCard({
  title,
  description,
  placeholder,
  value,
  onChange,
  onSubmit,
  onClear,
  isLoading,
  submitLabel,
  loadingLabel,
  loadingMessage,
  emptyStateTitle,
  emptyStateItems,
  icon,
  resultVisible,
}: PlanningInputCardProps) {
  return (
    <div className="relative group">
      <div className="absolute -inset-[1px] gradient-primary rounded-2xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500" />

      <div className="relative gradient-card rounded-2xl border border-border/60 p-6 space-y-5 shadow-md">
        <div>
          <h3 className="text-lg font-bold font-display text-foreground mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full gradient-primary" />
            Paste requirement / AC:
          </label>
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="min-h-[220px] resize-y font-mono text-sm bg-muted/30 border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl transition-all"
            disabled={isLoading}
          />
        </div>

        <div className="flex gap-3">
          <Button
            onClick={onSubmit}
            disabled={isLoading || !value.trim()}
            size="lg"
            className="flex-1 gap-2 gradient-primary hover:opacity-90 transition-all shadow-md hover:shadow-glow font-semibold h-12 rounded-xl"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{loadingLabel}</span>
              </>
            ) : (
              <>
                {icon}
                <span>{submitLabel}</span>
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={onClear}
            className="gap-2 border-border/60 hover:bg-muted/50 h-12 rounded-xl px-5"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>

        {isLoading && (
          <div className="p-4 gradient-subtle border border-primary/20 rounded-xl animate-fade-in">
            <p className="text-sm font-medium flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 gradient-primary"></span>
              </span>
              <span className="text-foreground">{loadingMessage}</span>
            </p>
          </div>
        )}

        {!resultVisible && !isLoading && (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{emptyStateTitle}</p>
                <ul className="mt-2 space-y-1.5">
                  {emptyStateItems.map((item, index) => (
                    <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-1 shrink-0">-</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
