import { useState } from 'react';
import { Brain, Loader2, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRequirementAnalysis } from '@/hooks/useRequirementAnalysis';
import { RequirementAnalysisReport } from '@/components/RequirementAnalysisReport';
import { SaveArtifactInput } from '@/types/artifactHistory';

const PLACEHOLDER = `Acceptance Criteria:
- User can create a purchase order
- User can edit draft purchase orders
- Submitted purchase orders become read-only
- Only users with approver permission can approve
- Approved purchase orders show approval history`;

interface RequirementAnalysisTabProps {
  onSaveArtifact?: (input: SaveArtifactInput) => void;
}

export function RequirementAnalysisTab({ onSaveArtifact }: RequirementAnalysisTabProps) {
  const [requirement, setRequirement] = useState('');
  const [lastAnalyzedRequirement, setLastAnalyzedRequirement] = useState('');
  const { isAnalyzing, analysisResult, analyzeRequirement, clearAnalysis } = useRequirementAnalysis();

  const handleAnalyze = async () => {
    setLastAnalyzedRequirement(requirement);
    await analyzeRequirement(requirement);
  };

  const handleClear = () => {
    setRequirement('');
    clearAnalysis();
  };

  return (
    <div className="space-y-6">
      <div className="relative group">
        <div className="absolute -inset-[1px] gradient-primary rounded-2xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500" />

        <div className="relative gradient-card rounded-2xl border border-border/60 p-6 space-y-5 shadow-md">
          <div>
            <h3 className="text-lg font-bold font-display text-foreground mb-1">Requirement Analysis</h3>
            <p className="text-sm text-muted-foreground">
              AI reads the requirement line by line, explains the functionality in simple English, and maps each
              acceptance-criteria point into what to test and how to test it.
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full gradient-primary" />
              Paste requirement / AC:
            </label>
            <Textarea
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
              placeholder={PLACEHOLDER}
              className="min-h-[220px] resize-y font-mono text-sm bg-muted/30 border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl transition-all"
              disabled={isAnalyzing}
            />
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !requirement.trim()}
              size="lg"
              className="flex-1 gap-2 gradient-primary hover:opacity-90 transition-all shadow-md hover:shadow-glow font-semibold h-12 rounded-xl"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Analyzing Requirement...</span>
                </>
              ) : (
                <>
                  <Search className="h-5 w-5" />
                  <span>Analyze Requirement</span>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={handleClear}
              className="gap-2 border-border/60 hover:bg-muted/50 h-12 rounded-xl px-5"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          </div>

          {isAnalyzing && (
            <div className="p-4 gradient-subtle border border-primary/20 rounded-xl animate-fade-in">
              <p className="text-sm font-medium flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 gradient-primary"></span>
                </span>
                <span className="text-foreground">
                  AI is reviewing the requirement top-to-bottom, bottom-to-top, and then top-to-bottom again to build
                  a clearer test plan from the acceptance criteria.
                </span>
              </p>
            </div>
          )}

          {!analysisResult && !isAnalyzing && (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Brain className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">What you will get</p>
                  <ul className="mt-2 space-y-1.5">
                    <li className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-1 shrink-0">-</span>
                      <span>A simple-English explanation of what the feature is supposed to do</span>
                    </li>
                    <li className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-1 shrink-0">-</span>
                      <span>A short summary you can share with non-technical teammates</span>
                    </li>
                    <li className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-1 shrink-0">-</span>
                      <span>Acceptance-criteria-by-acceptance-criteria guidance for what to test and how to test it</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {analysisResult && (
        <RequirementAnalysisReport
          result={analysisResult}
          onClose={clearAnalysis}
          onSave={(copyText, title) =>
            onSaveArtifact?.({
              type: 'requirement-analysis',
              title,
              requirementText: lastAnalyzedRequirement || requirement,
              copyText,
            })
          }
        />
      )}
    </div>
  );
}
