import type { ReactNode } from 'react';
import { Copy, Download, Save, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { downloadTextFile } from '@/lib/downloadTextFile';

export function ReportShell({
  title,
  subtitle,
  icon,
  copyText,
  onClose,
  onSave,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  copyText: string;
  onClose: () => void;
  onSave?: () => void;
  children: ReactNode;
}) {
  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(copyText);
    toast({
      title: 'Copied',
      description: `${title} copied to clipboard.`,
    });
  };

  return (
    <div className="gradient-card rounded-2xl border border-border/60 overflow-hidden shadow-lg animate-slide-up">
      <div className="px-5 py-4 gradient-primary flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-foreground/20 rounded-lg backdrop-blur-sm">{icon}</div>
          <div>
            <h2 className="text-lg font-bold font-display text-primary-foreground">{title}</h2>
            <p className="text-xs text-primary-foreground/80">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onSave && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSave}
              className="text-primary-foreground hover:bg-primary-foreground/20 gap-1.5 text-xs"
            >
              <Save className="h-4 w-4" />
              Save Locally
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadTextFile(title, copyText)}
            className="text-primary-foreground hover:bg-primary-foreground/20 gap-1.5 text-xs"
          >
            <Download className="h-4 w-4" />
            Download TXT
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyAll}
            className="text-primary-foreground hover:bg-primary-foreground/20 gap-1.5 text-xs"
          >
            <Copy className="h-4 w-4" />
            Copy All
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-primary-foreground hover:bg-primary-foreground/20"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-6">{children}</div>
    </div>
  );
}

export function SectionCard({
  icon,
  title,
  content,
}: {
  icon: ReactNode;
  title: string;
  content: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-bold font-display text-foreground">{title}</h3>
      </div>
      {content}
    </div>
  );
}

export function BulletList({ items, emptyLabel = 'No items returned.' }: { items: string[]; emptyLabel?: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
          <span className="text-primary mt-1 shrink-0">-</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function LabeledValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background/70 border border-border/50 p-4">
      <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">{label}</p>
      <p className="text-sm text-muted-foreground leading-6">{value}</p>
    </div>
  );
}
