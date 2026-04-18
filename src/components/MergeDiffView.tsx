import { useState } from 'react';
import { ChevronDown, ChevronUp, GitMerge, Trash2, Plus, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface MergeDiffData {
  originalCount: number;
  mergedCount: number;
  removedAsDuplicates: string[];
  keptOriginals: string[];
  refinedTestCases: string[];
}

interface MergeDiffViewProps {
  diff: MergeDiffData;
  onClose: () => void;
}

export function MergeDiffView({ diff, onClose }: MergeDiffViewProps) {
  const [expandRemoved, setExpandRemoved] = useState(false);
  const [expandKept, setExpandKept] = useState(false);
  const [expandRefined, setExpandRefined] = useState(false);

  const removedCount = diff.removedAsDuplicates.length;
  const reductionPct = diff.originalCount > 0
    ? Math.round(((diff.originalCount - diff.mergedCount) / diff.originalCount) * 100)
    : 0;

  return (
    <div className="gradient-card rounded-2xl border border-border/60 p-6 space-y-4 shadow-md animate-slide-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 gradient-primary rounded-lg">
            <GitMerge className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-foreground">Merge Diff Report</h3>
            <p className="text-xs text-muted-foreground">Summary of what changed during smart merge</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
          Close
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/40 rounded-xl p-4 text-center border border-border/40">
          <p className="text-2xl font-bold text-foreground">{diff.originalCount}</p>
          <p className="text-xs text-muted-foreground font-medium">Original TCs</p>
        </div>
        <div className="bg-muted/40 rounded-xl p-4 text-center border border-border/40">
          <div className="flex items-center justify-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" />
            <p className="text-2xl font-bold text-primary">{diff.mergedCount}</p>
          </div>
          <p className="text-xs text-muted-foreground font-medium">After Merge</p>
        </div>
        <div className="bg-negative/10 rounded-xl p-4 text-center border border-negative/20">
          <p className="text-2xl font-bold text-negative">-{reductionPct}%</p>
          <p className="text-xs text-muted-foreground font-medium">Reduction</p>
        </div>
      </div>

      {/* Removed duplicates */}
      {removedCount > 0 && (
        <div className="border border-negative/20 rounded-xl overflow-hidden">
          <button
            onClick={() => setExpandRemoved(!expandRemoved)}
            className="w-full flex items-center justify-between px-4 py-3 bg-negative/5 hover:bg-negative/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-negative" />
              <span className="text-sm font-semibold text-foreground">
                Removed as Duplicates ({removedCount})
              </span>
            </div>
            {expandRemoved ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {expandRemoved && (
            <div className="px-4 py-3 space-y-1.5 max-h-60 overflow-y-auto">
              {diff.removedAsDuplicates.map((tc, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-negative font-mono text-xs mt-0.5">✕</span>
                  <span className="line-through opacity-70">{tc}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Refined test cases */}
      {diff.refinedTestCases.length > 0 && (
        <div className="border border-positive/20 rounded-xl overflow-hidden">
          <button
            onClick={() => setExpandRefined(!expandRefined)}
            className="w-full flex items-center justify-between px-4 py-3 bg-positive/5 hover:bg-positive/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-positive" />
              <span className="text-sm font-semibold text-foreground">
                Smart Merged Result ({diff.refinedTestCases.length})
              </span>
            </div>
            {expandRefined ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {expandRefined && (
            <div className="px-4 py-3 space-y-1.5 max-h-60 overflow-y-auto">
              {diff.refinedTestCases.map((tc, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="text-positive font-mono text-xs mt-0.5">✓</span>
                  <span>{tc}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
