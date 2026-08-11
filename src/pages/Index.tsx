import { Suspense, lazy, startTransition, useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { TestCaseInput } from '@/components/TestCaseInput';
import { HistoryDrawer } from '@/components/HistoryDrawer';
import { useTestCaseGenerator } from '@/hooks/useTestCaseGenerator';
import { useLocalHistory } from '@/hooks/useLocalHistory';
import { useArtifactHistory } from '@/hooks/useArtifactHistory';
import { useCoverageValidator } from '@/hooks/useCoverageValidator';
import type { CoverageResult } from '@/hooks/useCoverageValidator';
import { useSmartMerge } from '@/hooks/useSmartMerge';
import { useAuditEnhance } from '@/hooks/useAuditEnhance';
import { HistoryEntry, InputType, TestCase } from '@/types/testCase';
import { getUniqueAdditionalTestCases, mergeTestCasesPreservingExisting } from '@/lib/mergeTestCases';
import {
  buildCoverageImprovementBatches,
  countCoverageImprovementRequests,
  selectCoverageImprovements,
} from '@/lib/coverageQualityGate';
import type { CoverageImprovementSelectionOptions } from '@/lib/coverageQualityGate';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { parsedRowsToTestCases } from '@/lib/parsedRowsToTestCases';
import { describeAiError } from '@/lib/providerErrors';
import { toast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  ListPlus,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

const RequirementAnalysisTab = lazy(() =>
  import('@/components/RequirementAnalysisTab').then((module) => ({ default: module.RequirementAnalysisTab }))
);
const QaPlanningWorkbench = lazy(() =>
  import('@/components/QaPlanningWorkbench').then((module) => ({ default: module.QaPlanningWorkbench }))
);
const FileUploadMerge = lazy(() =>
  import('@/components/FileUploadMerge').then((module) => ({ default: module.FileUploadMerge }))
);
const AuditEnhance = lazy(() =>
  import('@/components/AuditEnhance').then((module) => ({ default: module.AuditEnhance }))
);
const HowToUseTab = lazy(() =>
  import('@/components/HowToUseTab').then((module) => ({ default: module.HowToUseTab }))
);
const MergeDiffView = lazy(() =>
  import('@/components/MergeDiffView').then((module) => ({ default: module.MergeDiffView }))
);
const TestCaseTable = lazy(() =>
  import('@/components/TestCaseTable').then((module) => ({ default: module.TestCaseTable }))
);
const CoverageReport = lazy(() =>
  import('@/components/CoverageReport').then((module) => ({ default: module.CoverageReport }))
);
const CoverageGapReviewPanel = lazy(() =>
  import('@/components/CoverageGapReviewPanel').then((module) => ({ default: module.CoverageGapReviewPanel }))
);
const HelpSection = lazy(() =>
  import('@/components/HelpSection').then((module) => ({ default: module.HelpSection }))
);

function PanelFallback({ label = 'Loading section...' }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-6 text-sm text-muted-foreground animate-pulse">
      {label}
    </div>
  );
}

interface CoverageSourceContext {
  input: string;
  inputType: InputType;
  imagesBase64?: string[];
  testCases: TestCase[];
}

type QualityGateStatus = 'passed' | 'improved' | 'attention' | 'incomplete';

interface QualityGateSummary {
  status: QualityGateStatus;
  title: string;
  detail: string;
}

async function requestCoverageImprovements(
  source: CoverageSourceContext,
  coverage: CoverageResult,
  options: CoverageImprovementSelectionOptions = {},
  onBatchProgress?: (batchNumber: number, batchCount: number) => void
) {
  const selection = selectCoverageImprovements(coverage, options);
  if (selection.missingScenarios.length === 0 && selection.recommendations.length === 0) {
    return { ...selection, additions: [] as TestCase[] };
  }

  const batches = buildCoverageImprovementBatches(coverage, options);
  let workingSuite = source.testCases;
  const additions: TestCase[] = [];

  for (const [index, batch] of batches.entries()) {
    onBatchProgress?.(index + 1, batches.length);
    const data = await invokeWithRetry('audit-test-cases', {
      requirement: source.input,
      existingTestCases: workingSuite,
      imagesBase64: source.imagesBase64,
      focusMissingScenarios: batch.focusMissingScenarios,
      focusRecommendations: batch.focusRecommendations,
    });
    const uniqueBatchCases = getUniqueAdditionalTestCases(workingSuite, data.testCases || []);
    if (uniqueBatchCases.length === 0) continue;

    additions.push(...uniqueBatchCases);
    workingSuite = mergeTestCasesPreservingExisting(workingSuite, uniqueBatchCases);
  }

  return {
    ...selection,
    additions: getUniqueAdditionalTestCases(source.testCases, additions),
  };
}

async function requestConsolidatedCoverageImprovements(
  source: CoverageSourceContext,
  coverage: CoverageResult
) {
  const selection = selectCoverageImprovements(coverage);
  if (selection.missingScenarios.length === 0 && selection.recommendations.length === 0) {
    return { ...selection, additions: [] as TestCase[] };
  }

  const data = await invokeWithRetry(
    'audit-test-cases',
    {
      requirement: source.input,
      existingTestCases: source.testCases,
      imagesBase64: source.imagesBase64,
      focusMissingScenarios: selection.focusMissingScenarios,
      focusRecommendations: selection.focusRecommendations,
    },
    {
      maxRetries: 2,
      baseDelay: 1500,
      maxDelay: 10000,
      maxAttemptDurationForRetryMs: 45000,
    }
  );

  return {
    ...selection,
    additions: getUniqueAdditionalTestCases(source.testCases, data.testCases || []),
  };
}

export default function Index() {
  const {
    isLoading,
    testCases,
    stage,
    stageMessage,
    generateTestCases,
    clearTestCases,
    setTestCases,
    updateGenerationStage,
    deliverTestCases,
  } = useTestCaseGenerator();
  const { history, loadHistoryEntry, saveToHistory, deleteEntry, clearHistory } = useLocalHistory();
  const { artifactHistory, saveArtifact, deleteArtifact, clearArtifacts } = useArtifactHistory();
  const {
    isValidating,
    coverageResult,
    validateCoverage,
    clearCoverageResult,
    publishCoverageResult,
  } = useCoverageValidator();
  const { isProcessing, processMerge, diffData, clearDiff } = useSmartMerge();
  const { isAuditing, auditTestCases, clearAuditedTestCases } = useAuditEnhance();
  
  const [lastInput, setLastInput] = useState('');
  const [lastInputType, setLastInputType] = useState<InputType>('requirement');
  const [lastImagesBase64, setLastImagesBase64] = useState<string[] | undefined>();
  const [activeTab, setActiveTab] = useState('generate');
  const [isGeneratingCoverageImprovements, setIsGeneratingCoverageImprovements] = useState(false);
  const [pendingCoverageGapCases, setPendingCoverageGapCases] = useState<TestCase[]>([]);
  const [qualityGateSummary, setQualityGateSummary] = useState<QualityGateSummary | null>(null);
  const latestCoverageContextRef = useRef({ testCases, lastInput, lastInputType, lastImagesBase64 });

  useEffect(() => {
    latestCoverageContextRef.current = { testCases, lastInput, lastInputType, lastImagesBase64 };
  }, [testCases, lastInput, lastInputType, lastImagesBase64]);

  const handleGenerate = async (input: string, inputType: InputType, imagesBase64?: string[]) => {
    setLastInput(input);
    setLastInputType(inputType);
    setLastImagesBase64(imagesBase64);
    setQualityGateSummary(null);
    clearCoverageResult();
    clearDiff();
    setPendingCoverageGapCases([]);

    const runAutomaticQualityGate = inputType === 'requirement';
    const generated = await generateTestCases(input, inputType, imagesBase64, {
      deferDelivery: runAutomaticQualityGate,
    });
    if (generated.length === 0) {
      return;
    }

    if (!runAutomaticQualityGate) {
      saveToHistory(inputType, input, generated, { imagesBase64 });
      return;
    }

    let finalSuite = generated;

    try {
      updateGenerationStage('validating', 'Running fast exact-requirement and technical-risk checks...');
      let coverage = await validateCoverage(input, inputType, finalSuite, imagesBase64, {
        silent: true,
        deterministicOnly: true,
        publishResult: false,
      });
      if (!coverage) {
        throw new Error('Automatic coverage validation returned no result.');
      }

      const initialSelection = selectCoverageImprovements(coverage);
      const initialMissingCount = initialSelection.missingScenarios.length;
      const initialRecommendationCount = initialSelection.recommendations.length;
      const initialImprovementCount = initialMissingCount + initialRecommendationCount;
      let addedCount = 0;

      if (initialImprovementCount > 0) {
        updateGenerationStage(
          'retrying',
          `Adding ${initialImprovementCount} verified missing coverage item${initialImprovementCount === 1 ? '' : 's'} in one consolidated quality pass...`
        );
        const improvements = await requestConsolidatedCoverageImprovements(
          { input, inputType, imagesBase64, testCases: finalSuite },
          coverage
        );
        if (improvements.additions.length > 0) {
          finalSuite = mergeTestCasesPreservingExisting(finalSuite, improvements.additions);
          addedCount = improvements.additions.length;
        }

        updateGenerationStage(
          'validating',
          `Rechecking exact coverage across the complete ${finalSuite.length}-testcase suite...`
        );
        const recheckedCoverage = await validateCoverage(
          input,
          inputType,
          finalSuite,
          imagesBase64,
          { silent: true, deterministicOnly: true, publishResult: false }
        );
        if (!recheckedCoverage) {
          throw new Error('Automatic post-enhancement coverage validation returned no result.');
        }
        coverage = recheckedCoverage;
      }

      const remainingImprovementCount = countCoverageImprovementRequests(coverage);
      const remainingSelection = selectCoverageImprovements(coverage);
      const informationalNoteCount =
        coverage.missingScenarios.length + coverage.recommendations.length - remainingImprovementCount;
      updateGenerationStage('finalizing', 'Deduplicating, sequencing, and preparing the final reviewed suite...');

      if (remainingImprovementCount === 0 && addedCount === 0) {
        if (informationalNoteCount === 0) clearCoverageResult();
        setQualityGateSummary({
          status: 'passed',
          title: informationalNoteCount > 0
            ? 'Fast QA gate passed with clarification notes'
            : 'Fast QA gate passed',
          detail: `The senior-QA generation and exact requirement checks found no missing executable behavior.${informationalNoteCount > 0 ? ` ${informationalNoteCount} non-testable clarification or process note${informationalNoteCount === 1 ? ' remains' : 's remain'} visible; no product behavior was fabricated.` : ''}`,
        });
      } else if (remainingImprovementCount === 0) {
        if (informationalNoteCount === 0) clearCoverageResult();
        setQualityGateSummary({
          status: 'improved',
          title: informationalNoteCount > 0
            ? 'Suite improved with clarification notes retained'
            : 'Fast QA gate improved the suite',
          detail: `The exact check found ${initialMissingCount} gap${initialMissingCount === 1 ? '' : 's'} and ${initialRecommendationCount} testable recommendation${initialRecommendationCount === 1 ? '' : 's'}. One consolidated repair added ${addedCount} unique testcase${addedCount === 1 ? '' : 's'}, and the complete suite passed the fast recheck.${informationalNoteCount > 0 ? ` ${informationalNoteCount} non-testable note${informationalNoteCount === 1 ? ' remains' : 's remain'} visible for human confirmation.` : ''}`,
        });
      } else {
        setQualityGateSummary({
          status: 'attention',
          title: 'Automatic QA review completed with remaining items',
          detail: `${addedCount} unique testcase${addedCount === 1 ? ' was' : 's were'} added in one consolidated quality pass, but ${remainingSelection.missingScenarios.length} executable gap${remainingSelection.missingScenarios.length === 1 ? '' : 's'} and ${remainingSelection.recommendations.length} testable recommendation${remainingSelection.recommendations.length === 1 ? '' : 's'} still need review. They remain visible below and were not silently ignored.`,
        });
      }

      deliverTestCases(finalSuite, {
        title: remainingImprovementCount > 0
          ? 'Reviewed suite ready with attention items'
          : addedCount > 0 ? 'Final reviewed suite ready' : 'Quality-checked suite ready',
        description: `${finalSuite.length} testcases delivered after senior-QA generation, a fast exact-requirement check${initialImprovementCount > 0 ? ', one consolidated repair, and one recheck' : ''}${remainingImprovementCount > 0 ? `; ${remainingImprovementCount} review item${remainingImprovementCount === 1 ? ' remains' : 's remain'} visible` : ''}.`,
        stageMessage: 'Final quality-checked testcases ready.',
      });
      if (remainingImprovementCount > 0 || informationalNoteCount > 0) {
        publishCoverageResult(coverage);
      } else {
        clearCoverageResult();
      }
      saveToHistory(inputType, input, finalSuite, {
        inputSummary: `${input.slice(0, 80) || 'Full requirement'} - auto QA reviewed`,
        imagesBase64,
      });
    } catch (error) {
      console.error('Automatic post-generation quality gate failed:', error);
      const aiError = describeAiError(
        error,
        'Automatic QA gate incomplete',
        'The best available suite was preserved, but the automatic coverage enhancement could not finish.'
      );
      setQualityGateSummary({
        status: 'incomplete',
        title: 'Automatic QA gate incomplete',
        detail: 'The best available suite was preserved. Use Check Coverage to retry the remaining review without regenerating it.',
      });
      deliverTestCases(finalSuite, {
        title: aiError.title,
        description: `${aiError.description} The best available ${finalSuite.length}-testcase suite is available and was not lost.`,
        stageMessage: 'Best available suite ready; automatic coverage review needs retry.',
        variant: 'destructive',
      });
      saveToHistory(inputType, input, finalSuite, {
        inputSummary: `${input.slice(0, 80) || 'Full requirement'} - QA gate needs retry`,
        imagesBase64,
      });
    }
  };

  const handleValidateCoverage = () => {
    if (!lastInput.trim() && (!lastImagesBase64 || lastImagesBase64.length === 0)) {
      toast({
        title: 'Requirement context missing',
        description: 'Coverage needs the original requirement or images that produced this testcase set.',
        variant: 'destructive',
      });
      return;
    }

    validateCoverage(lastInput, lastInputType, testCases, lastImagesBase64);
  };

  const handleGenerateCoverageCases = async (options: {
    scenarioIndexes?: number[];
    recommendationIndexes?: number[];
    mergeImmediately?: boolean;
  } = {}) => {
    if (!coverageResult || (coverageResult.missingScenarios.length === 0 && coverageResult.recommendations.length === 0)) {
      toast({
        title: 'No coverage improvements',
        description: 'Run coverage validation first to identify gaps or recommendations.',
      });
      return;
    }

    if (!lastInput.trim() && (!lastImagesBase64 || lastImagesBase64.length === 0)) {
      toast({
        title: 'Requirement context missing',
        description: 'Coverage can generate full missing testcases only when the original requirement context is available.',
        variant: 'destructive',
      });
      return;
    }

    const sourceContext = { testCases, lastInput, lastInputType, lastImagesBase64 };
    const selection = selectCoverageImprovements(coverageResult, options);

    if (selection.missingScenarios.length === 0 && selection.recommendations.length === 0) {
      toast({
        title: 'Nothing selected',
        description: 'Choose at least one missing scenario or recommendation to convert.',
      });
      return;
    }

    setIsGeneratingCoverageImprovements(true);

    try {
      const improvements = await requestCoverageImprovements(
        {
          input: sourceContext.lastInput,
          inputType: sourceContext.lastInputType,
          imagesBase64: sourceContext.lastImagesBase64,
          testCases: sourceContext.testCases,
        },
        coverageResult,
        options
      );

      const latestContext = latestCoverageContextRef.current;
      if (
        latestContext.testCases !== sourceContext.testCases ||
        latestContext.lastInput !== sourceContext.lastInput ||
        latestContext.lastInputType !== sourceContext.lastInputType ||
        latestContext.lastImagesBase64 !== sourceContext.lastImagesBase64
      ) {
        toast({
          title: 'Suite changed while generating',
          description: 'The generated improvements were not applied to a different suite. Run Check Coverage again on the current table.',
          variant: 'destructive',
        });
        return;
      }

      const uniqueGapCases = improvements.additions;
      const addedCount = uniqueGapCases.length;

      if (addedCount === 0) {
        toast({
          title: 'No new executable cases',
          description: 'The improvements were already covered, duplicated existing cases, or contained process-only advice.',
        });
        return;
      }

      if (options.mergeImmediately) {
        const mergedSuite = mergeTestCasesPreservingExisting(sourceContext.testCases, uniqueGapCases);
        setTestCases(mergedSuite);
        setPendingCoverageGapCases([]);
        const refreshedCoverage = await validateCoverage(
          sourceContext.lastInput,
          sourceContext.lastInputType,
          mergedSuite,
          sourceContext.lastImagesBase64,
          { silent: true }
        );
        if (!refreshedCoverage) {
          setQualityGateSummary({
            status: 'incomplete',
            title: 'Coverage cases added; revalidation incomplete',
            detail: `${addedCount} unique professional testcase${addedCount === 1 ? ' was' : 's were'} merged without changing the existing suite. Run Check Coverage again because the post-merge validation returned no result.`,
          });
          saveToHistory(sourceContext.lastInputType, sourceContext.lastInput, mergedSuite, {
            inputSummary: `${sourceContext.lastInput.slice(0, 80) || 'Current suite'} - coverage added; recheck needed`,
            imagesBase64: sourceContext.lastImagesBase64,
          });
          toast({
            title: 'Coverage cases added',
            description: `Added ${addedCount} testcase${addedCount === 1 ? '' : 's'}, but the post-merge coverage check needs to be retried.`,
          });
          return;
        }
        const remainingCount = countCoverageImprovementRequests(refreshedCoverage);
        setQualityGateSummary({
          status: remainingCount > 0 ? 'attention' : 'improved',
          title: remainingCount > 0
            ? 'Coverage improvements added; review remains'
            : 'Coverage improvements added and revalidated',
          detail: `${addedCount} unique professional testcase${addedCount === 1 ? ' was' : 's were'} merged without changing the existing suite.${remainingCount > 0 ? ` ${remainingCount} executable coverage item${remainingCount === 1 ? ' remains' : 's remain'} visible after revalidation.` : ' The complete merged suite has no remaining executable coverage items.'}`,
        });
        saveToHistory(sourceContext.lastInputType, sourceContext.lastInput, mergedSuite, {
          inputSummary: `${sourceContext.lastInput.slice(0, 80) || 'Current suite'} - coverage improved`,
          imagesBase64: sourceContext.lastImagesBase64,
        });
        toast({
          title: 'Coverage cases added',
          description: `Added ${addedCount} professional testcase${addedCount > 1 ? 's' : ''} to the main table without changing existing cases.`,
        });
        return;
      }

      setPendingCoverageGapCases(uniqueGapCases);
      toast({
        title: 'Review generated improvements',
        description: `Generated ${addedCount} professional testcase${addedCount > 1 ? 's' : ''}. Review and choose what to add.`,
      });
    } catch (error) {
      console.error('Error generating coverage-gap test cases:', error);
      const aiError = describeAiError(
        error,
        'Coverage improvement failed',
        'Failed to convert the coverage gaps and recommendations into complete testcases.'
      );
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingCoverageImprovements(false);
    }
  };

  const handleClear = () => {
    clearTestCases();
    clearCoverageResult();
    clearDiff();
    clearAuditedTestCases();
    setPendingCoverageGapCases([]);
    setQualityGateSummary(null);
  };

  const handleSmartMerge = async (parsedFiles: Record<string, string>[][]) => {
    clearCoverageResult();
    try {
      const merged = await processMerge(parsedFiles);
      if (merged.length > 0) {
        setTestCases(merged);
        setLastInput('');
        setLastInputType('requirement');
        setLastImagesBase64(undefined);
        setPendingCoverageGapCases([]);
        setQualityGateSummary(null);
        saveToHistory('requirement', '', merged, {
          inputSummary: 'Smart Merged Test Cases (from uploaded files)',
        });
      }
    } catch (error) {
      console.error('Smart merge handler error:', error);
    }
  };

  const handleAudit = async (requirement: string, existingTestCases: Record<string, string>[], imagesBase64?: string[]) => {
    clearCoverageResult();
    clearDiff();
    setPendingCoverageGapCases([]);
    setQualityGateSummary(null);
    const newCases = await auditTestCases(requirement, existingTestCases, imagesBase64);
    if (newCases.length > 0) {
      const baselineCases = parsedRowsToTestCases(existingTestCases);
      const mergedCases = mergeTestCasesPreservingExisting(baselineCases, newCases);
      setTestCases(mergedCases);
      setLastInput(requirement);
      setLastInputType('requirement');
      setLastImagesBase64(imagesBase64);
      saveToHistory('requirement', requirement, mergedCases, {
        inputSummary: requirement || 'Enhanced test cases from Audit',
        imagesBase64,
      });
    }
  };

  const handleCloseCoverageGapReview = () => {
    setPendingCoverageGapCases([]);
  };

  const handleMergeSelectedCoverageGapCases = async (selectedIds: string[]) => {
    const selectedCases = pendingCoverageGapCases.filter((testCase) => selectedIds.includes(testCase.id));

    if (selectedCases.length === 0) {
      toast({
        title: 'No cases selected',
        description: 'Select at least one generated gap case to merge.',
      });
      return;
    }

    const uniqueSelectedCases = getUniqueAdditionalTestCases(testCases, selectedCases);
    if (uniqueSelectedCases.length === 0) {
      setPendingCoverageGapCases([]);
      toast({
        title: 'Cases already present',
        description: 'The selected coverage cases are already in the main table.',
      });
      return;
    }

    const mergedSuite = mergeTestCasesPreservingExisting(testCases, uniqueSelectedCases);
    setTestCases(mergedSuite);
    setPendingCoverageGapCases([]);
    saveToHistory(lastInputType, lastInput, mergedSuite, {
      inputSummary: `${lastInput.slice(0, 80) || 'Current suite'} - coverage improved`,
      imagesBase64: lastImagesBase64,
    });

    setIsGeneratingCoverageImprovements(true);
    try {
      const refreshedCoverage = lastInput.trim() || (lastImagesBase64?.length ?? 0) > 0
        ? await validateCoverage(lastInput, lastInputType, mergedSuite, lastImagesBase64, { silent: true })
        : null;

      if (!refreshedCoverage) {
        setQualityGateSummary({
          status: 'incomplete',
          title: 'Reviewed cases added; revalidation incomplete',
          detail: `${uniqueSelectedCases.length} selected testcase${uniqueSelectedCases.length === 1 ? ' was' : 's were'} merged into the main table. Run Check Coverage again when the original requirement context is available.`,
        });
        toast({
          title: 'Cases added',
          description: 'The selected cases were preserved, but the post-merge coverage check needs to be retried.',
        });
        return;
      }

      const remainingCount = countCoverageImprovementRequests(refreshedCoverage);
      setQualityGateSummary({
        status: remainingCount > 0 ? 'attention' : 'improved',
        title: remainingCount > 0
          ? 'Reviewed cases added; coverage items remain'
          : 'Reviewed cases added and revalidated',
        detail: `${uniqueSelectedCases.length} selected testcase${uniqueSelectedCases.length === 1 ? ' was' : 's were'} merged into the main table.${remainingCount > 0 ? ` ${remainingCount} executable coverage item${remainingCount === 1 ? ' remains' : 's remain'} visible.` : ' The merged suite has no remaining executable coverage items.'}`,
      });
      toast({
        title: 'Cases added',
        description: `Added ${uniqueSelectedCases.length} reviewed testcase${uniqueSelectedCases.length > 1 ? 's' : ''} and rechecked the complete suite.`,
      });
    } finally {
      setIsGeneratingCoverageImprovements(false);
    }
  };

  const handleLoadHistoryEntry = async (entry: HistoryEntry) => {
    const restoredEntry = await loadHistoryEntry(entry);
    startTransition(() => {
      setTestCases(restoredEntry.testCases);
      setLastInput(restoredEntry.inputText || '');
      setLastInputType(restoredEntry.inputType);
      setLastImagesBase64(restoredEntry.imagesBase64);
      setPendingCoverageGapCases([]);
      setQualityGateSummary(null);
      clearCoverageResult();
      clearDiff();
      setActiveTab('generate');
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 gradient-primary opacity-[0.03] blur-3xl rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent opacity-[0.03] blur-3xl rounded-full" />
      </div>
      
      <main className="container mx-auto overflow-x-hidden px-4 py-8">
        <div className="min-w-0 space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 w-full">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <TabsList className="grid h-auto w-full flex-1 grid-cols-2 rounded-xl border border-border/60 bg-muted/50 p-1 sm:grid-cols-3 xl:grid-cols-6">
                <TabsTrigger value="generate" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
                  <Zap className="h-4 w-4" />
                  Generate
                </TabsTrigger>
                <TabsTrigger value="analysis" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
                  <Brain className="h-4 w-4" />
                  Requirement Analysis
                </TabsTrigger>
                <TabsTrigger value="planning" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
                  <FileCheck2 className="h-4 w-4" />
                  QA Planning
                </TabsTrigger>
                <TabsTrigger value="upload" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  Upload & Merge
                </TabsTrigger>
                <TabsTrigger value="audit" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
                  <Sparkles className="h-4 w-4" />
                  Audit & Enhance
                </TabsTrigger>
                <TabsTrigger value="guide" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
                  <BookOpen className="h-4 w-4" />
                  How to Use
                </TabsTrigger>
              </TabsList>
              <HistoryDrawer
                history={history}
                artifactHistory={artifactHistory}
                onLoad={handleLoadHistoryEntry}
                onDelete={deleteEntry}
                onClear={clearHistory}
                onDeleteArtifact={deleteArtifact}
                onClearArtifacts={clearArtifacts}
                restoreDisabled={isLoading || isValidating || isGeneratingCoverageImprovements}
              />
            </div>
              
              <TabsContent value="generate" className="mt-4">
                <TestCaseInput
                  onGenerate={handleGenerate}
                  isLoading={isLoading}
                  stage={stage}
                  stageMessage={stageMessage}
                  onClear={handleClear}
                />
              </TabsContent>

              <TabsContent value="analysis" className="mt-4">
                <Suspense fallback={<PanelFallback label="Loading requirement analysis..." />}>
                  <RequirementAnalysisTab
                    onSaveArtifact={(input) => {
                      saveArtifact(input);
                      toast({
                        title: 'Artifact saved',
                        description: `${input.title} saved to the artifact history.`,
                      });
                    }}
                  />
                </Suspense>
              </TabsContent>

              <TabsContent value="planning" className="mt-4">
                <Suspense fallback={<PanelFallback label="Loading QA planning..." />}>
                  <QaPlanningWorkbench
                    currentTestCases={testCases}
                    onSaveArtifact={(input) => {
                      saveArtifact(input);
                      toast({
                        title: 'Artifact saved',
                        description: `${input.title} saved to the artifact history.`,
                      });
                    }}
                  />
                </Suspense>
              </TabsContent>
              
              <TabsContent value="upload" className="mt-4">
                <Suspense fallback={<PanelFallback label="Loading merge tools..." />}>
                  <FileUploadMerge
                    onMergedResult={() => {}}
                    isProcessing={isProcessing}
                    onProcess={handleSmartMerge}
                  />
                </Suspense>
              </TabsContent>

              <TabsContent value="audit" className="mt-4">
                <Suspense fallback={<PanelFallback label="Loading audit tools..." />}>
                  <AuditEnhance
                    onAudit={handleAudit}
                    isAuditing={isAuditing}
                    onClear={handleClear}
                  />
                </Suspense>
              </TabsContent>

              <TabsContent value="guide" className="mt-4">
                <Suspense fallback={<PanelFallback label="Loading guide..." />}>
                  <HowToUseTab />
                </Suspense>
              </TabsContent>
            </Tabs>

            {diffData && (
              <Suspense fallback={<PanelFallback label="Loading merge diff..." />}>
                <MergeDiffView diff={diffData} onClose={clearDiff} />
              </Suspense>
            )}

            {qualityGateSummary && testCases.length > 0 && (
              <div
                className={
                  qualityGateSummary.status === 'passed' || qualityGateSummary.status === 'improved'
                    ? 'flex items-start gap-3 rounded-xl border border-positive/35 bg-positive/10 px-4 py-3 text-positive shadow-sm'
                    : qualityGateSummary.status === 'attention'
                      ? 'flex items-start gap-3 rounded-xl border border-accent/35 bg-accent/10 px-4 py-3 text-accent-foreground shadow-sm'
                      : 'flex items-start gap-3 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-destructive shadow-sm'
                }
              >
                {qualityGateSummary.status === 'passed' || qualityGateSummary.status === 'improved'
                  ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
                <div>
                  <p className="text-sm font-bold">{qualityGateSummary.title}</p>
                  <p className="mt-0.5 text-xs leading-5 opacity-85">{qualityGateSummary.detail}</p>
                </div>
              </div>
            )}

            {testCases.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-4 py-3 shadow-sm">
                <span className="text-sm font-semibold text-foreground">Result Actions</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleValidateCoverage}
                  disabled={isValidating}
                  className="gap-2"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {isValidating ? 'Checking Coverage...' : 'Check Coverage'}
                </Button>
                {coverageResult && (coverageResult.missingScenarios.length > 0 || coverageResult.recommendations.length > 0) && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateCoverageCases()}
                      disabled={isGeneratingCoverageImprovements}
                      className="gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      {isGeneratingCoverageImprovements ? 'Generating...' : 'Create Gap Cases for Review'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleGenerateCoverageCases({ mergeImmediately: true })}
                      disabled={isGeneratingCoverageImprovements}
                      className="gap-2 gradient-primary hover:opacity-90"
                    >
                      <ListPlus className="h-4 w-4" />
                      {isGeneratingCoverageImprovements ? 'Generating...' : 'Create & Add Gap Cases'}
                    </Button>
                  </>
                )}
              </div>
            )}

            {testCases.length > 0 && (
              <Suspense fallback={<PanelFallback label="Loading generated test cases..." />}>
                <TestCaseTable 
                  testCases={testCases}
                  onValidateCoverage={handleValidateCoverage}
                  isValidating={isValidating}
                  inputSummary={lastInput}
                  onDeleteTestCase={(index) => {
                    setTestCases(prev => prev.filter((_, i) => i !== index));
                    clearCoverageResult();
                    setQualityGateSummary(null);
                  }}
                />
              </Suspense>
            )}
            {coverageResult && (
              <Suspense fallback={<PanelFallback label="Loading coverage report..." />}>
                <CoverageReport 
                  result={coverageResult} 
                  onClose={clearCoverageResult}
                  onGenerateMissingScenario={(scenario) => {
                    const index = coverageResult.missingScenarios.findIndex(
                      (item) =>
                        item.scenario === scenario.scenario &&
                        item.priority === scenario.priority &&
                        item.type === scenario.type
                    );
                    if (index !== -1) {
                      handleGenerateCoverageCases({ scenarioIndexes: [index], recommendationIndexes: [] });
                    }
                  }}
                  onGenerateRecommendation={(_, index) => {
                    handleGenerateCoverageCases({ scenarioIndexes: [], recommendationIndexes: [index] });
                  }}
                  onGenerateAllImprovements={() => handleGenerateCoverageCases()}
                  onAddAllImprovements={() => handleGenerateCoverageCases({ mergeImmediately: true })}
                  isGeneratingImprovements={isGeneratingCoverageImprovements}
                />
              </Suspense>
            )}
            {pendingCoverageGapCases.length > 0 && (
              <Suspense fallback={<PanelFallback label="Loading coverage gap review..." />}>
                <CoverageGapReviewPanel
                  pendingCases={pendingCoverageGapCases}
                  onClose={handleCloseCoverageGapReview}
                  onMergeSelected={handleMergeSelectedCoverageGapCases}
                />
              </Suspense>
            )}
            {activeTab === 'generate' && testCases.length === 0 && !isLoading && !isProcessing && (
              <Suspense fallback={<PanelFallback label="Loading guidance..." />}>
                <HelpSection />
              </Suspense>
            )}
        </div>
      </main>
    </div>
  );
}
