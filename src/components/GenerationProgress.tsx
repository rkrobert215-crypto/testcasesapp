import { useState, useEffect } from 'react';
import { Search, CheckCircle2, FileText } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { GenerationStage } from '@/hooks/useTestCaseGenerator';

interface GenerationProgressProps {
  isActive: boolean;
  stage: GenerationStage;
  stageMessage?: string | null;
  imageCount?: number;
}

const STEPS = [
  { icon: FileText, label: 'Reading requirement', stage: 'reading' },
  { icon: Search, label: 'Generating test cases', stage: 'generating' },
  { icon: CheckCircle2, label: 'Finalizing output', stage: 'finalizing' },
];

const STAGE_PROGRESS: Record<Exclude<GenerationStage, null>, number> = {
  reading: 10,
  analyzing: 30,
  generating: 60,
  validating: 72,
  retrying: 82,
  finalizing: 95,
  complete: 100,
  error: 0,
};

const STAGE_INDEX: Record<Exclude<GenerationStage, null>, number> = {
  reading: 0,
  analyzing: 1,
  generating: 1,
  validating: 1,
  retrying: 1,
  finalizing: 2,
  complete: 2,
  error: 0,
};

export function GenerationProgress({ isActive, stage, stageMessage, imageCount = 0 }: GenerationProgressProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setElapsedSeconds(0);
      return;
    }

    const timerInterval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(timerInterval);
    };
  }, [isActive]);

  if (!isActive) return null;

  const currentStage = stage ?? 'reading';
  const currentStep = STAGE_INDEX[currentStage];
  const progress = STAGE_PROGRESS[currentStage];
  const activeStep = STEPS[currentStep];
  const fallbackMessage = `${activeStep.label}${imageCount > 0 ? ` (including ${imageCount} image${imageCount > 1 ? 's' : ''})` : ''}...`;

  return (
    <div className="p-5 gradient-subtle border border-primary/20 rounded-xl animate-fade-in space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium">Processing...</span>
          <span>{elapsedSeconds}s elapsed</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const isCompleted = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-300',
                isCompleted && 'bg-positive/15 text-positive',
                isCurrent && 'bg-primary/15 text-primary animate-pulse',
                !isCompleted && !isCurrent && 'text-muted-foreground/50'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{step.label}</span>
              {isCompleted && <CheckCircle2 className="h-3 w-3 text-positive" />}
            </div>
          );
        })}
      </div>

      <p className="text-sm font-medium flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 gradient-primary" />
        </span>
        <span className="text-foreground">
          {stageMessage || fallbackMessage}
        </span>
      </p>
    </div>
  );
}
