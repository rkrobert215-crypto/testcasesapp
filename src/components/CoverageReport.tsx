import { CheckCircle, AlertTriangle, XCircle, Lightbulb, Target, X, Copy, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoverageResult, MissingScenario } from '@/hooks/useCoverageValidator';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

interface CoverageReportProps {
  result: CoverageResult;
  onClose: () => void;
  onGenerateMissingScenario?: (scenario: MissingScenario) => void;
  onGenerateAllMissingScenarios?: () => void;
  isGeneratingMissingScenarios?: boolean;
}

const PRIORITY_COLORS = {
  High: 'bg-negative/15 text-negative border-negative/40',
  Medium: 'bg-edge/15 text-edge border-edge/40',
  Low: 'bg-muted text-muted-foreground border-border',
};

const TYPE_COLORS: Record<string, string> = {
  Positive: 'bg-positive/15 text-positive',
  Negative: 'bg-negative/15 text-negative',
  Edge: 'bg-edge/15 text-edge',
  Security: 'bg-security/15 text-security',
  Integration: 'bg-primary/15 text-primary',
  Regression: 'bg-accent/15 text-accent-foreground',
};

export function CoverageReport({
  result,
  onClose,
  onGenerateMissingScenario,
  onGenerateAllMissingScenarios,
  isGeneratingMissingScenarios = false,
}: CoverageReportProps) {
  const getScoreIcon = () => {
    if (result.coverageScore >= 90) return <CheckCircle className="h-8 w-8 text-positive" />;
    if (result.coverageScore >= 70) return <AlertTriangle className="h-8 w-8 text-edge" />;
    return <XCircle className="h-8 w-8 text-negative" />;
  };

  const getScoreColor = () => {
    if (result.coverageScore >= 90) return 'text-positive';
    if (result.coverageScore >= 70) return 'text-edge';
    return 'text-negative';
  };

  const handleCopyAll = () => {
    const lines = [
      `Coverage Score: ${result.coverageScore}%`,
      `Summary: ${result.summary}`,
      '',
      'Covered Areas:',
      ...result.coveredAreas.map((area) => `  - ${area}`),
      '',
      'Missing Scenarios:',
      ...result.missingScenarios.map((scenario, index) => `  ${index + 1}. [${scenario.priority}] ${scenario.scenario} (${scenario.type})`),
      '',
      'Recommendations:',
      ...result.recommendations.map((recommendation, index) => `  ${index + 1}. ${recommendation}`),
    ];

    navigator.clipboard.writeText(lines.join('\n'));
    toast({ title: 'Copied', description: 'Coverage report copied to clipboard.' });
  };

  return (
    <div className="gradient-card rounded-2xl border border-border/60 overflow-hidden shadow-lg animate-slide-up">
      <div className="px-5 py-4 gradient-primary flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-foreground/20 rounded-lg backdrop-blur-sm">
            <Target className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold font-display text-primary-foreground">Coverage Analysis</h2>
            <p className="text-xs text-primary-foreground/80">AI-powered test coverage validation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result.missingScenarios.length > 0 && onGenerateAllMissingScenarios && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onGenerateAllMissingScenarios}
              disabled={isGeneratingMissingScenarios}
              className="text-primary-foreground hover:bg-primary-foreground/20 gap-1.5 text-xs"
            >
              <Sparkles className="h-4 w-4" />
              {isGeneratingMissingScenarios ? 'Generating...' : 'Generate All Gaps'}
            </Button>
          )}
          {result.missingScenarios.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyAll}
              className="text-primary-foreground hover:bg-primary-foreground/20 gap-1.5 text-xs"
            >
              <Copy className="h-4 w-4" />
              Copy All
            </Button>
          )}
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

      <div className="p-5 space-y-6">
        <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-xl">
          {getScoreIcon()}
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className={cn('text-4xl font-bold font-display', getScoreColor())}>
                {result.coverageScore}%
              </span>
              <span className="text-muted-foreground text-sm">coverage</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{result.summary}</p>
          </div>
        </div>

        {result.coveredAreas.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-positive" />
              Well Covered Areas
            </h3>
            <div className="flex flex-wrap gap-2">
              {result.coveredAreas.map((area, index) => (
                <span
                  key={index}
                  className="px-3 py-1 bg-positive/10 text-positive rounded-full text-xs font-medium"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>
        )}

        {result.missingScenarios.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-edge" />
              Missing Scenarios ({result.missingScenarios.length})
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {result.missingScenarios.map((scenario, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg"
                >
                  <span className={cn(
                    'px-2 py-0.5 rounded text-[10px] font-bold uppercase border',
                    PRIORITY_COLORS[scenario.priority]
                  )}>
                    {scenario.priority}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{scenario.scenario}</p>
                    <span className={cn(
                      'inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium',
                      TYPE_COLORS[scenario.type] || 'bg-muted text-muted-foreground'
                    )}>
                      {scenario.type}
                    </span>
                  </div>
                  {onGenerateMissingScenario && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onGenerateMissingScenario(scenario)}
                      disabled={isGeneratingMissingScenarios}
                      className="gap-1.5 shrink-0"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate Case
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {result.recommendations.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              Recommendations
            </h3>
            <ul className="space-y-1.5">
              {result.recommendations.map((recommendation, index) => (
                <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>{recommendation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.missingScenarios.length === 0 && result.coverageScore >= 90 && (
          <div className="text-center py-4">
            <CheckCircle className="h-12 w-12 text-positive mx-auto mb-2" />
            <p className="text-lg font-semibold text-positive">Excellent Coverage!</p>
            <p className="text-sm text-muted-foreground">All major scenarios are covered.</p>
          </div>
        )}
      </div>
    </div>
  );
}
