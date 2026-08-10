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
  options: CoverageImprovementSelectionOptions = {}
) {
  const selection = selectCoverageImprovements(coverage, options);
  if (selection.missingScenarios.length === 0 && selection.recommendations.length === 0) {
    return { ...selection, additions: [] as TestCase[] };
  }

  const data = await invokeWithRetry('audit-test-cases', {
    requirement: source.input,
    existingTestCases: source.testCases,
    imagesBase64: source.imagesBase64,
    focusMissingScenarios: selection.focusMissingScenarios,
    focusRecommendations: selection.focusRecommendations,
  });

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
  const { isValidating, coverageResult, validateCoverage, clearCoverageResult } = useCoverageValidator();
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

    const source: CoverageSourceContext = {
      input,
      inputType,
      imagesBase64,
      testCases: generated,
    };

    try {
      updateGenerationStage('validating', 'Checking every requirement point against the initial testcase suite...');
      const coverage = await validateCoverage(input, inputType, generated, imagesBase64, { silent: true });
      if (!coverage) {
        throw new Error('Automatic coverage validation returned no result.');
      }

      const requestedImprovementCount = countCoverageImprovementRequests(coverage);
      let finalSuite = generated;
      let addedCount = 0;

      if (requestedImprovementCount > 0) {
        updateGenerationStage(
          'retrying',
          `Converting ${coverage.missingScenarios.length} missing scenario${coverage.missingScenarios.length === 1 ? '' : 's'} and ${coverage.recommendations.length} recommendation${coverage.recommendations.length === 1 ? '' : 's'} into complete testcases...`
        );
        const improvements = await requestCoverageImprovements(source, coverage);
        addedCount = improvements.additions.length;
        if (addedCount > 0) {
          finalSuite = mergeTestCasesPreservingExisting(generated, improvements.additions);
          clearCoverageResult();
        }
      }

      updateGenerationStage('finalizing', 'Deduplicating, sequencing, and preparing the final reviewed suite...');

      if (requestedImprovementCount === 0) {
        setQualityGateSummary({
          status: 'passed',
          title: 'Automatic QA gate passed',
          detail: `Coverage checked at ${coverage.coverageScore}% with no missing scenarios or testable recommendations.`,
        });
      } else if (addedCount > 0) {
        setQualityGateSummary({
          status: 'improved',
          title: 'Automatic QA gate improved the suite',
          detail: `Coverage found ${coverage.missingScenarios.length} gap${coverage.missingScenarios.length === 1 ? '' : 's'} and ${coverage.recommendations.length} recommendation${coverage.recommendations.length === 1 ? '' : 's'}; ${addedCount} unique testcase${addedCount === 1 ? ' was' : 's were'} added before delivery.`,
        });
      } else {
        setQualityGateSummary({
          status: 'attention',
          title: 'Coverage checked - review still advised',
          detail: 'The remaining items were already covered, duplicates, clarifications, or process-only recommendations, so no fabricated testcase rows were added.',
        });
      }

      deliverTestCases(finalSuite, {
        title: addedCount > 0 ? 'Final reviewed suite ready' : 'Quality-checked suite ready',
        description: addedCount > 0
          ? `${finalSuite.length} testcases delivered after automatically adding ${addedCount} coverage improvement${addedCount === 1 ? '' : 's'}.`
          : `${finalSuite.length} testcases delivered after the automatic coverage review.`,
        stageMessage: 'Final quality-checked testcases ready.',
      });
      saveToHistory(inputType, input, finalSuite, {
        inputSummary: `${input.slice(0, 80) || 'Full requirement'} - auto QA checked`,
        imagesBase64,
      });
    } catch (error) {
      console.error('Automatic post-generation quality gate failed:', error);
      const aiError = describeAiError(
        error,
        'Automatic QA gate incomplete',
        'The initial suite was preserved, but the automatic coverage enhancement could not finish.'
      );
      setQualityGateSummary({
        status: 'incomplete',
        title: 'Automatic QA gate incomplete',
        detail: 'The initial suite was preserved. Use Check Coverage to retry the remaining review without regenerating it.',
      });
      deliverTestCases(generated, {
        title: aiError.title,
        description: `${aiError.description} The initial ${generated.length}-testcase suite is available and was not lost.`,
        stageMessage: 'Initial suite ready; automatic coverage review needs retry.',
        variant: 'destructive',
      });
      saveToHistory(inputType, input, generated, {
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
        clearCoverageResult();
        setQualityGateSummary({
          status: 'improved',
          title: 'Coverage improvements added',
          detail: `${addedCount} unique professional testcase${addedCount === 1 ? ' was' : 's were'} merged without changing the existing suite.`,
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

  const handleMergeSelectedCoverageGapCases = (selectedIds: string[]) => {
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
    clearCoverageResult();
    setQualityGateSummary({
      status: 'improved',
      title: 'Reviewed coverage cases added',
      detail: `${uniqueSelectedCases.length} selected testcase${uniqueSelectedCases.length === 1 ? ' was' : 's were'} merged into the main table.`,
    });
    saveToHistory(lastInputType, lastInput, mergedSuite, {
      inputSummary: `${lastInput.slice(0, 80) || 'Current suite'} - coverage improved`,
      imagesBase64: lastImagesBase64,
    });
    toast({
      title: 'Cases added',
      description: `Added ${uniqueSelectedCases.length} reviewed testcase${uniqueSelectedCases.length > 1 ? 's' : ''} to the main table without changing existing cases.`,
    });
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
                      {isGeneratingCoverageImprovements ? 'Generating...' : 'Generate & Review All'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleGenerateCoverageCases({ mergeImmediately: true })}
                      disabled={isGeneratingCoverageImprovements}
                      className="gap-2 gradient-primary hover:opacity-90"
                    >
                      <ListPlus className="h-4 w-4" />
                      {isGeneratingCoverageImprovements ? 'Generating...' : 'Generate & Add All'}
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
