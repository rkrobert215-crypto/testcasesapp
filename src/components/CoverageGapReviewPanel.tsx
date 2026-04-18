import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Sparkles, X } from 'lucide-react';
import { TestCase } from '@/types/testCase';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface CoverageGapReviewPanelProps {
  pendingCases: TestCase[];
  onClose: () => void;
  onMergeSelected: (selectedIds: string[]) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-negative/15 text-negative border-negative/40',
  High: 'bg-primary/15 text-primary border-primary/40',
  Medium: 'bg-accent/15 text-accent border-accent/40',
  Low: 'bg-muted text-muted-foreground border-border/60',
};

const TYPE_COLORS: Record<string, string> = {
  Positive: 'bg-positive/15 text-positive border-positive/40',
  Negative: 'bg-negative/15 text-negative border-negative/40',
  Edge: 'bg-edge/15 text-edge border-edge/40',
  Security: 'bg-security/15 text-security border-security/40',
};

export function CoverageGapReviewPanel({
  pendingCases,
  onClose,
  onMergeSelected,
}: CoverageGapReviewPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds(pendingCases.map((testCase) => testCase.id));
  }, [pendingCases]);

  const allSelected = useMemo(
    () => pendingCases.length > 0 && selectedIds.length === pendingCases.length,
    [pendingCases.length, selectedIds.length]
  );

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : pendingCases.map((testCase) => testCase.id));
  };

  return (
    <div className="gradient-card rounded-2xl border border-border/60 overflow-hidden shadow-lg animate-slide-up">
      <div className="px-5 py-4 gradient-primary flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-foreground/20 rounded-lg backdrop-blur-sm">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold font-display text-primary-foreground">Review Coverage Gap Cases</h2>
            <p className="text-xs text-primary-foreground/80">
              Check the AI-generated missing testcases before they are merged into your suite.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-primary-foreground hover:bg-primary-foreground/20"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {pendingCases.length} generated case{pendingCases.length > 1 ? 's' : ''} ready for review
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedIds.length} selected. Only selected cases will be merged into the current list.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={toggleAll} className="gap-2">
              <CheckSquare className="h-4 w-4" />
              {allSelected ? 'Clear Selection' : 'Select All'}
            </Button>
            <Button
              size="sm"
              onClick={() => onMergeSelected(selectedIds)}
              disabled={selectedIds.length === 0}
              className="gap-2 gradient-primary hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Merge Selected
            </Button>
          </div>
        </div>

        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {pendingCases.map((testCase) => (
            <div key={testCase.id} className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedIds.includes(testCase.id)}
                  onCheckedChange={() => toggleSelection(testCase.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-foreground">{testCase.id}</span>
                    {testCase.priority && (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${PRIORITY_COLORS[testCase.priority] || PRIORITY_COLORS.Low}`}>
                        {testCase.priority}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${TYPE_COLORS[testCase.type] || TYPE_COLORS.Positive}`}>
                      {testCase.type}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{testCase.testCase}</p>
                  <p className="text-sm text-muted-foreground mt-1">{testCase.scenario}</p>
                  <div className="grid gap-3 lg:grid-cols-2 mt-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-primary font-semibold mb-1">Coverage Area</p>
                      <p className="text-sm text-muted-foreground">{testCase.coverageArea}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-primary font-semibold mb-1">Expected Result</p>
                      <p className="text-sm text-muted-foreground">{testCase.expectedResult}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
