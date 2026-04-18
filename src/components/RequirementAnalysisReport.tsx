import type { ReactNode } from 'react';
import {
  Brain,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ListChecks,
  Save,
  ScrollText,
  Target,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { RequirementAnalysisResult } from '@/types/requirementAnalysis';
import { downloadTextFile } from '@/lib/downloadTextFile';

interface RequirementAnalysisReportProps {
  result: RequirementAnalysisResult;
  onClose: () => void;
  onSave?: (copyText: string, title: string) => void;
}

export function RequirementAnalysisReport({ result, onClose, onSave }: RequirementAnalysisReportProps) {
  const copyText = [
    'Requirement Analysis',
    '',
    `Simple Summary: ${result.simpleSummary}`,
    '',
    `Functionality Explanation: ${result.functionalityExplanation}`,
    ...(result.primaryActor ? ['', `Primary Actor: ${result.primaryActor}`] : []),
    ...(result.primaryAction ? ['', `Primary Action: ${result.primaryAction}`] : []),
    ...(result.recommendedStarter ? ['', `Recommended Starter: ${result.recommendedStarter}`] : []),
    ...(result.businessModules?.length ? ['', `Business Modules: ${result.businessModules.join(', ')}`] : []),
    '',
    'Main Flow:',
    ...result.mainFlow.map((item, index) => `${index + 1}. ${item}`),
    '',
    'What To Test:',
    ...result.whatToTest.map((item, index) => `${index + 1}. ${item}`),
    '',
    'How To Test:',
    ...result.howToTest.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Acceptance Criteria Breakdown:',
    ...result.acceptanceCriteria.flatMap((item, index) => [
      `${index + 1}. ${item.id} - ${item.criterion}`,
      `   Meaning: ${item.plainEnglishMeaning}`,
      `   Source: ${item.sourceType}`,
      ...(item.moduleHint ? [`   Module: ${item.moduleHint}`] : []),
      ...(item.priority ? [`   Priority: ${item.priority}`] : []),
      ...item.whatToTest.map((value) => `   What to test: ${value}`),
      ...item.howToTest.map((value) => `   How to test: ${value}`),
    ]),
    '',
    'Important Notes:',
    ...result.importantNotes.map((item, index) => `${index + 1}. ${item}`),
    ...(result.riskHotspots?.length
      ? ['', 'Risk Hotspots:', ...result.riskHotspots.map((item, index) => `${index + 1}. ${item}`)]
      : []),
  ].join('\n');

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(copyText);
    toast({
      title: 'Copied',
      description: 'Requirement analysis copied to clipboard.',
    });
  };

  return (
    <div className="gradient-card rounded-2xl border border-border/60 overflow-hidden shadow-lg animate-slide-up">
      <div className="px-5 py-4 gradient-primary flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-foreground/20 rounded-lg backdrop-blur-sm">
            <Brain className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold font-display text-primary-foreground">Requirement Analysis</h2>
            <p className="text-xs text-primary-foreground/80">
              Simple explanation, acceptance-criteria mapping, and test guidance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onSave && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSave(copyText, 'Requirement Analysis')}
              className="text-primary-foreground hover:bg-primary-foreground/20 gap-1.5 text-xs"
            >
              <Save className="h-4 w-4" />
              Save Locally
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadTextFile('Requirement Analysis', copyText)}
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

      <div className="p-5 space-y-6">
        <div className="grid lg:grid-cols-2 gap-4">
          <SectionCard
            icon={<ScrollText className="h-4 w-4 text-primary" />}
            title="Simple Summary"
            content={<p className="text-sm text-muted-foreground leading-6">{result.simpleSummary}</p>}
          />
          <SectionCard
            icon={<ClipboardList className="h-4 w-4 text-primary" />}
            title="Functionality Explained"
            content={<p className="text-sm text-muted-foreground leading-6">{result.functionalityExplanation}</p>}
          />
        </div>

        {(result.primaryActor || result.primaryAction || result.recommendedStarter || result.businessModules?.length) && (
          <div className="grid lg:grid-cols-3 gap-4">
            {result.primaryActor && (
              <SectionCard
                icon={<UserRound className="h-4 w-4 text-primary" />}
                title="Primary Actor"
                content={<p className="text-sm text-muted-foreground leading-6">{result.primaryActor}</p>}
              />
            )}
            {result.primaryAction && (
              <SectionCard
                icon={<Target className="h-4 w-4 text-primary" />}
                title="Primary Action"
                content={<p className="text-sm text-muted-foreground leading-6">{result.primaryAction}</p>}
              />
            )}
            {result.recommendedStarter && (
              <SectionCard
                icon={<ClipboardList className="h-4 w-4 text-primary" />}
                title="Recommended Starter"
                content={<p className="text-sm text-muted-foreground leading-6">{result.recommendedStarter}</p>}
              />
            )}
          </div>
        )}

        {result.businessModules && result.businessModules.length > 0 && (
          <SectionCard
            icon={<ClipboardList className="h-4 w-4 text-primary" />}
            title="Business Modules"
            content={<BulletList items={result.businessModules} />}
          />
        )}

        {result.mainFlow.length > 0 && (
          <SectionCard
            icon={<ListChecks className="h-4 w-4 text-primary" />}
            title="Main Flow"
            content={
              <ol className="space-y-2">
                {result.mainFlow.map((item, index) => (
                  <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            }
          />
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          <SectionCard
            icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
            title="What To Test"
            content={<BulletList items={result.whatToTest} />}
          />
          <SectionCard
            icon={<Brain className="h-4 w-4 text-primary" />}
            title="How To Test"
            content={<BulletList items={result.howToTest} />}
          />
        </div>

        <div className="rounded-2xl border border-border/60 bg-muted/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h3 className="font-bold font-display text-foreground">
              Acceptance Criteria Breakdown ({result.acceptanceCriteria.length})
            </h3>
          </div>
          <Accordion type="single" collapsible className="w-full">
            {result.acceptanceCriteria.map((item) => (
              <AccordionItem key={item.id} value={item.id} className="border-border/40">
                <AccordionTrigger className="text-left hover:no-underline">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">{item.id}</p>
                    <p className="text-sm text-muted-foreground">{item.criterion}</p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="rounded-xl bg-background/70 border border-border/50 p-4">
                    <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">Plain English Meaning</p>
                    <p className="text-sm text-muted-foreground leading-6">{item.plainEnglishMeaning}</p>
                  </div>
                  <div className="grid lg:grid-cols-2 gap-4">
                    <div className="rounded-xl bg-background/70 border border-border/50 p-4">
                      <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">Module</p>
                      <p className="text-sm text-muted-foreground leading-6">{item.moduleHint || 'General'}</p>
                    </div>
                    <div className="rounded-xl bg-background/70 border border-border/50 p-4">
                      <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">Priority</p>
                      <p className="text-sm text-muted-foreground leading-6">{item.priority || 'Medium'}</p>
                    </div>
                  </div>
                  <div className="grid lg:grid-cols-2 gap-4">
                    <div className="rounded-xl bg-background/70 border border-border/50 p-4">
                      <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">What To Test</p>
                      <BulletList items={item.whatToTest} />
                    </div>
                    <div className="rounded-xl bg-background/70 border border-border/50 p-4">
                      <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">How To Test</p>
                      <BulletList items={item.howToTest} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Source: <span className="font-medium text-foreground">{item.sourceType}</span>
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {result.importantNotes.length > 0 && (
          <SectionCard
            icon={<ScrollText className="h-4 w-4 text-primary" />}
            title="Important Notes"
            content={<BulletList items={result.importantNotes} />}
          />
        )}

        {result.riskHotspots && result.riskHotspots.length > 0 && (
          <SectionCard
            icon={<Target className="h-4 w-4 text-primary" />}
            title="Risk Hotspots"
            content={<BulletList items={result.riskHotspots} />}
          />
        )}
      </div>
    </div>
  );
}

function SectionCard({
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

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No items returned.</p>;
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
