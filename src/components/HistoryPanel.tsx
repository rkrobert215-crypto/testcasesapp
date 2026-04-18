import { Clock, Trash2, Upload, History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HistoryEntry } from '@/types/testCase';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface HistoryPanelProps {
  history: HistoryEntry[];
  onLoad: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  requirement: 'Full Req',
  highlevel: 'High Level',
  testcase: 'Complete TC',
  scenario: 'Scenario',
  expected: 'Expected',
};

const TYPE_COLORS: Record<string, string> = {
  requirement: 'bg-primary/15 text-primary border-primary/30',
  highlevel: 'bg-accent/15 text-accent border-accent/30',
  testcase: 'bg-edge/15 text-edge border-edge/30',
  scenario: 'bg-security/15 text-security border-security/30',
  expected: 'bg-positive/15 text-positive border-positive/30',
};

export function HistoryPanel({ history, onLoad, onDelete, onClear }: HistoryPanelProps) {
  if (history.length === 0) {
    return (
      <div className="gradient-card rounded-2xl border border-border/60 p-6 shadow-sm sticky top-24">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-muted rounded-lg">
            <History className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="font-bold font-display text-foreground">History</h3>
        </div>
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted/60 flex items-center justify-center">
            <Clock className="h-8 w-8 text-muted-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground">
            No history yet. Your generated test cases will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gradient-card rounded-2xl border border-border/60 p-5 shadow-sm sticky top-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 gradient-primary rounded-lg">
            <History className="h-4 w-4 text-primary-foreground" />
          </div>
          <h3 className="font-bold font-display text-foreground">
            History
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
      
      <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="p-3 rounded-xl border border-border/60 hover:border-primary/30 hover:bg-muted/30 transition-all group cursor-pointer"
            onClick={() => onLoad(entry)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border',
                    TYPE_COLORS[entry.inputType]
                  )}>
                    {TYPE_LABELS[entry.inputType]}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {entry.testCases.length} TCs
                  </span>
                </div>
                <p className="text-sm text-foreground font-medium truncate">{entry.inputSummary}</p>
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
                  onClick={(e) => { e.stopPropagation(); onLoad(entry); }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
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
