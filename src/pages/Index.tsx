import { Suspense, lazy, useState } from 'react';
import { Header } from '@/components/Header';
import { TestCaseInput } from '@/components/TestCaseInput';
import { HistoryPanel } from '@/components/HistoryPanel';
import { ArtifactHistoryPanel } from '@/components/ArtifactHistoryPanel';
import { useTestCaseGenerator } from '@/hooks/useTestCaseGenerator';
import { useLocalHistory } from '@/hooks/useLocalHistory';
import { useArtifactHistory } from '@/hooks/useArtifactHistory';
import { useCoverageValidator } from '@/hooks/useCoverageValidator';
import { useSmartMerge } from '@/hooks/useSmartMerge';
import { useAuditEnhance } from '@/hooks/useAuditEnhance';
import { InputType, TestCase } from '@/types/testCase';
import { getUniqueAdditionalTestCases, mergeTestCasesPreservingExisting } from '@/lib/mergeTestCases';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { parsedRowsToTestCases } from '@/lib/parsedRowsToTestCases';
import { describeAiError } from '@/lib/providerErrors';
import { toast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Zap, FileSpreadsheet, Sparkles, BookOpen, Brain, FileCheck2, ShieldCheck } from 'lucide-react';

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

export default function Index() {
  const { isLoading, testCases, stage, stageMessage, generateTestCases, clearTestCases, setTestCases } = useTestCaseGenerator();
  const { history, saveToHistory, deleteEntry, clearHistory } = useLocalHistory();
  const { artifactHistory, saveArtifact, deleteArtifact, clearArtifacts } = useArtifactHistory();
  const { isValidating, coverageResult, validateCoverage, clearCoverageResult } = useCoverageValidator();
  const { isProcessing, processMerge, diffData, clearDiff } = useSmartMerge();
  const { isAuditing, auditTestCases, clearAuditedTestCases } = useAuditEnhance();
  
  const [lastInput, setLastInput] = useState('');
  const [lastInputType, setLastInputType] = useState<InputType>('requirement');
  const [lastImagesBase64, setLastImagesBase64] = useState<string[] | undefined>();
  const [activeTab, setActiveTab] = useState('generate');
  const [isGeneratingCoverageGaps, setIsGeneratingCoverageGaps] = useState(false);
  const [pendingCoverageGapCases, setPendingCoverageGapCases] = useState<TestCase[]>([]);

  const handleGenerate = async (input: string, inputType: InputType, imagesBase64?: string[]) => {
    setLastInput(input);
    setLastInputType(inputType);
    setLastImagesBase64(imagesBase64);
    clearCoverageResult();
    clearDiff();
    setPendingCoverageGapCases([]);
    
    const generated = await generateTestCases(input, inputType, imagesBase64);
    if (generated.length > 0) {
      saveToHistory(inputType, input, generated, { imagesBase64 });
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

  const handleGenerateCoverageGapCases = async (scenarioIndexes?: number[]) => {
    if (!coverageResult || coverageResult.missingScenarios.length === 0) {
      toast({
        title: 'No missing scenarios',
        description: 'Run coverage validation first to identify any gaps.',
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

    const selectedScenarios =
      scenarioIndexes && scenarioIndexes.length > 0
        ? coverageResult.missingScenarios.filter((_, index) => scenarioIndexes.includes(index))
        : coverageResult.missingScenarios;

    if (selectedScenarios.length === 0) {
      toast({
        title: 'No scenarios selected',
        description: 'Choose at least one missing scenario to generate.',
      });
      return;
    }

    setIsGeneratingCoverageGaps(true);

    try {
      const data = await invokeWithRetry('audit-test-cases', {
        requirement: lastInput,
        existingTestCases: testCases,
        imagesBase64: lastImagesBase64,
        focusMissingScenarios: selectedScenarios.map((scenario) => scenario.scenario),
      });

      const generatedCases = data.testCases || [];
      const uniqueGapCases = getUniqueAdditionalTestCases(testCases, generatedCases);
      const addedCount = uniqueGapCases.length;

      if (addedCount === 0) {
        toast({
          title: 'No new cases generated',
          description: 'The generated coverage-gap cases were already present in the testcase list.',
        });
        return;
      }

      setPendingCoverageGapCases(uniqueGapCases);
      toast({
        title: 'Review generated cases',
        description: `Generated ${addedCount} missing testcase${addedCount > 1 ? 's' : ''}. Review and choose what to merge.`,
      });
    } catch (error) {
      console.error('Error generating coverage-gap test cases:', error);
      const aiError = describeAiError(
        error,
        'Gap generation failed',
        'Failed to generate missing testcases from the coverage gaps.'
      );
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingCoverageGaps(false);
    }
  };

  const handleClear = () => {
    clearTestCases();
    clearCoverageResult();
    clearDiff();
    clearAuditedTestCases();
    setPendingCoverageGapCases([]);
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

    setTestCases((prev) => mergeTestCasesPreservingExisting(prev, selectedCases));
    setPendingCoverageGapCases([]);
    clearCoverageResult();
    toast({
      title: 'Cases merged',
      description: `Merged ${selectedCases.length} reviewed testcase${selectedCases.length > 1 ? 's' : ''} into the current suite.`,
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
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 w-full">
              <TabsList className="w-full grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 h-auto rounded-xl bg-muted/50 border border-border/60 p-1">
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
                {coverageResult && coverageResult.missingScenarios.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateCoverageGapCases()}
                    disabled={isGeneratingCoverageGaps}
                    className="gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    {isGeneratingCoverageGaps ? 'Generating Missing Cases...' : 'Generate Missing Cases'}
                  </Button>
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
                      handleGenerateCoverageGapCases([index]);
                    }
                  }}
                  onGenerateAllMissingScenarios={() => handleGenerateCoverageGapCases()}
                  isGeneratingMissingScenarios={isGeneratingCoverageGaps}
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
          
          <aside className="min-w-0 space-y-4">
            <HistoryPanel
              history={history}
              onLoad={(entry) => {
                setTestCases(entry.testCases);
                setLastInput(entry.inputText || '');
                setLastInputType(entry.inputType);
                setLastImagesBase64(entry.imagesBase64);
                clearCoverageResult();
                clearDiff();
                setActiveTab('generate');
              }}
              onDelete={deleteEntry}
              onClear={clearHistory}
            />
            <ArtifactHistoryPanel
              history={artifactHistory}
              onDelete={deleteArtifact}
              onClear={clearArtifacts}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
