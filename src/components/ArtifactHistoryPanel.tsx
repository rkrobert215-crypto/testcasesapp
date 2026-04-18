import { Clock, Copy, Download, ScrollText, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ArtifactHistoryEntry } from '@/types/artifactHistory';
import { toast } from '@/hooks/use-toast';
import { downloadTextFile } from '@/lib/downloadTextFile';
import { cn } from '@/lib/utils';

interface ArtifactHistoryPanelProps {
  history: ArtifactHistoryEntry[];
  onDelete: (id: string) => void;
  onClear: () => void;
}

const TYPE_LABELS: Record<ArtifactHistoryEntry['type'], string> = {
  'requirement-analysis': 'Analysis',
  'test-plan': 'Test Plan',
  'traceability-matrix': 'RTM',
  'test-data-plan': 'Test Data',
  'scenario-map': 'Scenario Map',
  clarifications: 'Clarifications',
};

const TYPE_COLORS: Record<ArtifactHistoryEntry['type'], string> = {
  'requirement-analysis': 'bg-primary/15 text-primary border-primary/30',
  'test-plan': 'bg-accent/15 text-accent border-accent/30',
  'traceability-matrix': 'bg-edge/15 text-edge border-edge/30',
  'test-data-plan': 'bg-positive/15 text-positive border-positive/30',
  'scenario-map': 'bg-security/15 text-security border-security/30',
  clarifications: 'bg-muted text-muted-foreground border-border',
};

export function ArtifactHistoryPanel({ history, onDelete, onClear }: ArtifactHistoryPanelProps) {
  const handleCopy = async (entry: ArtifactHistoryEntry) => {
    await navigator.clipboard.writeText(entry.copyText);
    toast({
      title: 'Copied',
      description: `${entry.title} copied to clipboard.`,
    });
  };

  if (history.length === 0) {
    return (
      <div className="gradient-card rounded-2xl border border-border/60 p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-muted rounded-lg">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
          </div>
          <h3 className="font-bold font-display text-foreground">Saved Artifacts</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Saved requirement analysis and QA planning reports will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="gradient-card rounded-2xl border border-border/60 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 gradient-primary rounded-lg">
            <ScrollText className="h-4 w-4 text-primary-foreground" />
          </div>
          <h3 className="font-bold font-display text-foreground">
            Saved Artifacts
            <span className="ml-2 text-sm font-normal text-muted-foreground">({history.length})</span>
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
        >
          Clear All
        </Button>
      </div>

      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="p-3 rounded-xl border border-border/60 hover:border-primary/30 hover:bg-muted/30 transition-all group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border',
                      TYPE_COLORS[entry.type]
                    )}
                  >
                    {TYPE_LABELS[entry.type]}
                  </span>
                </div>
                <p className="text-sm text-foreground font-medium truncate">{entry.title}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{entry.requirementSummary}</p>
                <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
                </p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                  onClick={() => void handleCopy(entry)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                  onClick={() => downloadTextFile(entry.title, entry.copyText)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
