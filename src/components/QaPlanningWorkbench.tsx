import { useState } from 'react';
import {
  AlertCircle,
  Brain,
  CircleHelp,
  ClipboardList,
  Database,
  FileCheck2,
  FileSearch,
  GitBranch,
  ScrollText,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlanningInputCard } from '@/components/planning/PlanningInputCard';
import { BulletList, LabeledValue, ReportShell, SectionCard } from '@/components/planning/PlanningPrimitives';
import { useTestPlan } from '@/hooks/useTestPlan';
import { useTraceabilityMatrix } from '@/hooks/useTraceabilityMatrix';
import { useTestDataPlan } from '@/hooks/useTestDataPlan';
import { useScenarioMap } from '@/hooks/useScenarioMap';
import { useClarificationQuestions } from '@/hooks/useClarificationQuestions';
import type {
  ClarificationQuestionsResult,
  ScenarioMapResult,
  TestDataPlanResult,
  TestPlanResult,
  TraceabilityMatrixResult,
} from '@/types/qaPlanning';
import type { TestCase } from '@/types/testCase';
import type { SaveArtifactInput } from '@/types/artifactHistory';

interface QaPlanningWorkbenchProps {
  currentTestCases: TestCase[];
  onSaveArtifact?: (input: SaveArtifactInput) => void;
}

const PLACEHOLDER = `User Story:
As an approver, I want to review submitted purchase orders so that I can approve or reject them.

Acceptance Criteria:
- Submitted purchase orders appear in the approver queue
- Only approvers can approve or reject
- Rejected purchase orders require a rejection reason
- Approved purchase orders become read-only
- Approval or rejection is logged in history`;

export function QaPlanningWorkbench({ currentTestCases, onSaveArtifact }: QaPlanningWorkbenchProps) {
  const [activeTool, setActiveTool] = useState('test-plan');
  const [requirement, setRequirement] = useState('');
  const [generatedRequirementByTool, setGeneratedRequirementByTool] = useState<Record<string, string>>({});
  const { isGenerating: isGeneratingPlan, testPlan, generateTestPlan, clearTestPlan } = useTestPlan();
  const { isGenerating: isGeneratingMatrix, matrix, generateTraceabilityMatrix, clearMatrix } = useTraceabilityMatrix();
  const { isGenerating: isGeneratingData, testDataPlan, generateTestDataPlan, clearTestDataPlan } = useTestDataPlan();
  const { isGenerating: isGeneratingScenario, scenarioMap, generateScenarioMap, clearScenarioMap } = useScenarioMap();
  const {
    isGenerating: isGeneratingClarifications,
    clarifications,
    generateClarificationQuestions,
    clearClarifications,
  } = useClarificationQuestions();

  const clearCurrentTool = () => {
    setRequirement('');
    if (activeTool === 'test-plan') clearTestPlan();
    if (activeTool === 'rtm') clearMatrix();
    if (activeTool === 'test-data') clearTestDataPlan();
    if (activeTool === 'scenario-map') clearScenarioMap();
    if (activeTool === 'clarifications') clearClarifications();
  };

  const snapshotRequirement = (tool: string) => {
    setGeneratedRequirementByTool((prev) => ({
      ...prev,
      [tool]: requirement,
    }));
  };

  return (
    <div className="space-y-6">
      <div className="gradient-subtle border border-primary/20 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 gradient-primary rounded-xl shadow-glow">
            <FileCheck2 className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-xl font-bold font-display text-foreground">QA Planning Workbench</h3>
            <p className="text-sm text-muted-foreground">
              Build requirement-driven planning artifacts like test plans, RTMs, test data, scenario maps, and
              clarification questions before execution starts.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Paste the requirement once, then switch between planning tools. The current AI style mode also applies here.
        </p>
      </div>

      <Tabs value={activeTool} onValueChange={setActiveTool} className="space-y-4">
        <TabsList className="w-full grid grid-cols-2 lg:grid-cols-5 h-auto rounded-xl bg-muted/50 border border-border/60 p-1">
          <TabsTrigger value="test-plan" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
            <ClipboardList className="h-4 w-4" />
            Test Plan
          </TabsTrigger>
          <TabsTrigger value="rtm" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
            <Target className="h-4 w-4" />
            RTM
          </TabsTrigger>
          <TabsTrigger value="test-data" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
            <Database className="h-4 w-4" />
            Test Data
          </TabsTrigger>
          <TabsTrigger value="scenario-map" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
            <GitBranch className="h-4 w-4" />
            Scenario Map
          </TabsTrigger>
          <TabsTrigger value="clarifications" className="gap-2 font-semibold rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
            <CircleHelp className="h-4 w-4" />
            Clarifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="test-plan" className="space-y-6">
          <PlanningInputCard
            title="Test Plan"
            description="Create a requirement-specific QA test plan with scope, risks, environments, entry/exit criteria, deliverables, and roles."
            placeholder={PLACEHOLDER}
            value={requirement}
            onChange={setRequirement}
            onSubmit={() => {
              snapshotRequirement('test-plan');
              void generateTestPlan(requirement);
            }}
            onClear={clearCurrentTool}
            isLoading={isGeneratingPlan}
            submitLabel="Generate Test Plan"
            loadingLabel="Generating Test Plan..."
            loadingMessage="AI is turning the requirement into a project-ready QA test plan."
            emptyStateTitle="What you will get"
            emptyStateItems={[
              'A scope-based QA test plan tied to the requirement',
              'Practical risks, assumptions, dependencies, and milestones',
              'Entry/exit criteria and clear deliverables for execution',
            ]}
            icon={<ClipboardList className="h-5 w-5" />}
            resultVisible={Boolean(testPlan)}
          />
          {testPlan && (
            <TestPlanReport
              result={testPlan}
              onClose={clearTestPlan}
              onSave={(copyText) =>
                onSaveArtifact?.({
                  type: 'test-plan',
                  title: 'QA Test Plan',
                  requirementText: generatedRequirementByTool['test-plan'] || requirement,
                  copyText,
                })
              }
            />
          )}
        </TabsContent>

        <TabsContent value="rtm" className="space-y-6">
          <PlanningInputCard
            title="Requirement Traceability Matrix"
            description="Map requirement points to scenarios and testcases, and show covered, partial, or missing coverage."
            placeholder={PLACEHOLDER}
            value={requirement}
            onChange={setRequirement}
            onSubmit={() => {
              snapshotRequirement('rtm');
              void generateTraceabilityMatrix(requirement, currentTestCases);
            }}
            onClear={clearCurrentTool}
            isLoading={isGeneratingMatrix}
            submitLabel="Generate RTM"
            loadingLabel="Generating RTM..."
            loadingMessage="AI is mapping requirement points into a traceability matrix."
            emptyStateTitle="What you will get"
            emptyStateItems={[
              'One row per requirement point or acceptance criterion',
              'Coverage status using current app testcases when available',
              'Gap notes and suggested next steps for missing coverage',
            ]}
            icon={<Target className="h-5 w-5" />}
            resultVisible={Boolean(matrix)}
          />
          {currentTestCases.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              RTM will use the current testcase table in the app to judge whether each requirement point is
              <span className="font-medium text-foreground"> Covered</span>,
              <span className="font-medium text-foreground"> Partial</span>, or
              <span className="font-medium text-foreground"> Missing</span>.
            </div>
          )}
          {matrix && (
            <TraceabilityMatrixReport
              result={matrix}
              onClose={clearMatrix}
              onSave={(copyText) =>
                onSaveArtifact?.({
                  type: 'traceability-matrix',
                  title: 'Requirement Traceability Matrix',
                  requirementText: generatedRequirementByTool.rtm || requirement,
                  copyText,
                })
              }
            />
          )}
        </TabsContent>

        <TabsContent value="test-data" className="space-y-6">
          <PlanningInputCard
            title="Test Data Plan"
            description="Design realistic valid, invalid, and edge test data sets tied to the feature, flows, and risks."
            placeholder={PLACEHOLDER}
            value={requirement}
            onChange={setRequirement}
            onSubmit={() => {
              snapshotRequirement('test-data');
              void generateTestDataPlan(requirement);
            }}
            onClear={clearCurrentTool}
            isLoading={isGeneratingData}
            submitLabel="Generate Test Data Plan"
            loadingLabel="Generating Test Data..."
            loadingMessage="AI is designing practical datasets for positive, negative, and edge testing."
            emptyStateTitle="What you will get"
            emptyStateItems={[
              'Feature-specific data categories and datasets',
              'Sample valid and negative/edge values to prepare',
              'Environment and privacy notes for safer execution',
            ]}
            icon={<Database className="h-5 w-5" />}
            resultVisible={Boolean(testDataPlan)}
          />
          {testDataPlan && (
            <TestDataPlanReport
              result={testDataPlan}
              onClose={clearTestDataPlan}
              onSave={(copyText) =>
                onSaveArtifact?.({
                  type: 'test-data-plan',
                  title: 'Test Data Plan',
                  requirementText: generatedRequirementByTool['test-data'] || requirement,
                  copyText,
                })
              }
            />
          )}
        </TabsContent>

        <TabsContent value="scenario-map" className="space-y-6">
          <PlanningInputCard
            title="Scenario Map"
            description="Break the feature into primary, alternate, negative, and edge flows before detailed testcase writing."
            placeholder={PLACEHOLDER}
            value={requirement}
            onChange={setRequirement}
            onSubmit={() => {
              snapshotRequirement('scenario-map');
              void generateScenarioMap(requirement);
            }}
            onClear={clearCurrentTool}
            isLoading={isGeneratingScenario}
            submitLabel="Generate Scenario Map"
            loadingLabel="Generating Scenario Map..."
            loadingMessage="AI is mapping the feature into business flows and risk intersections."
            emptyStateTitle="What you will get"
            emptyStateItems={[
              'Primary and alternate flows for the feature',
              'Negative and edge scenarios that deserve testcase coverage',
              'Regression-sensitive paths and high-risk intersections',
            ]}
            icon={<GitBranch className="h-5 w-5" />}
            resultVisible={Boolean(scenarioMap)}
          />
          {scenarioMap && (
            <ScenarioMapReport
              result={scenarioMap}
              onClose={clearScenarioMap}
              onSave={(copyText) =>
                onSaveArtifact?.({
                  type: 'scenario-map',
                  title: 'Scenario Map',
                  requirementText: generatedRequirementByTool['scenario-map'] || requirement,
                  copyText,
                })
              }
            />
          )}
        </TabsContent>

        <TabsContent value="clarifications" className="space-y-6">
          <PlanningInputCard
            title="Clarification Questions"
            description="Raise the questions, assumptions, and ambiguities a senior QA should surface before execution begins."
            placeholder={PLACEHOLDER}
            value={requirement}
            onChange={setRequirement}
            onSubmit={() => {
              snapshotRequirement('clarifications');
              void generateClarificationQuestions(requirement);
            }}
            onClear={clearCurrentTool}
            isLoading={isGeneratingClarifications}
            submitLabel="Generate Clarifications"
            loadingLabel="Generating Clarifications..."
            loadingMessage="AI is identifying ambiguous requirement areas and drafting stakeholder-ready questions."
            emptyStateTitle="What you will get"
            emptyStateItems={[
              'Blocking and non-blocking clarification questions',
              'Why each question matters and who should answer it',
              'Assumptions and safe testing assumptions to document',
            ]}
            icon={<CircleHelp className="h-5 w-5" />}
            resultVisible={Boolean(clarifications)}
          />
          {clarifications && (
            <ClarificationQuestionsReport
              result={clarifications}
              onClose={clearClarifications}
              onSave={(copyText) =>
                onSaveArtifact?.({
                  type: 'clarifications',
                  title: 'Clarification Questions',
                  requirementText: generatedRequirementByTool.clarifications || requirement,
                  copyText,
                })
              }
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TestPlanReport({
  result,
  onClose,
  onSave,
}: {
  result: TestPlanResult;
  onClose: () => void;
  onSave?: (copyText: string) => void;
}) {
  const copyText = [
    'Test Plan',
    '',
    `Title: ${result.title}`,
    `Objective: ${result.objective}`,
    '',
    'In Scope:',
    ...result.scopeIn.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Out of Scope:',
    ...result.scopeOut.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Test Types:',
    ...result.testTypes.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Environments:',
    ...result.environments.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Assumptions:',
    ...result.assumptions.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Dependencies:',
    ...result.dependencies.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Risks:',
    ...result.risks.map((item, index) => `${index + 1}. ${item.risk} [${item.impact}] Mitigation: ${item.mitigation}`),
    '',
    'Entry Criteria:',
    ...result.entryCriteria.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Exit Criteria:',
    ...result.exitCriteria.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Deliverables:',
    ...result.deliverables.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Milestones:',
    ...result.milestones.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Roles and Responsibilities:',
    ...result.rolesAndResponsibilities.map((item, index) => `${index + 1}. ${item.role}: ${item.responsibility}`),
    '',
    'Strategy Notes:',
    ...result.strategyNotes.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');

  return (
    <ReportShell
      title="QA Test Plan"
      subtitle="Scope, risk, execution readiness, and delivery expectations"
      icon={<ClipboardList className="h-5 w-5 text-primary-foreground" />}
      copyText={copyText}
      onClose={onClose}
      onSave={onSave ? () => onSave(copyText) : undefined}
    >
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard
          icon={<ScrollText className="h-4 w-4 text-primary" />}
          title="Title"
          content={<p className="text-sm text-muted-foreground leading-6">{result.title}</p>}
        />
        <SectionCard
          icon={<Target className="h-4 w-4 text-primary" />}
          title="Objective"
          content={<p className="text-sm text-muted-foreground leading-6">{result.objective}</p>}
        />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<ClipboardList className="h-4 w-4 text-primary" />} title="In Scope" content={<BulletList items={result.scopeIn} />} />
        <SectionCard icon={<AlertCircle className="h-4 w-4 text-primary" />} title="Out of Scope" content={<BulletList items={result.scopeOut} />} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<Brain className="h-4 w-4 text-primary" />} title="Test Types" content={<BulletList items={result.testTypes} />} />
        <SectionCard icon={<Target className="h-4 w-4 text-primary" />} title="Environments" content={<BulletList items={result.environments} />} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<ScrollText className="h-4 w-4 text-primary" />} title="Assumptions" content={<BulletList items={result.assumptions} />} />
        <SectionCard icon={<FileSearch className="h-4 w-4 text-primary" />} title="Dependencies" content={<BulletList items={result.dependencies} />} />
      </div>
      <SectionCard
        icon={<ShieldAlert className="h-4 w-4 text-primary" />}
        title={`Risks (${result.risks.length})`}
        content={
          <div className="space-y-3">
            {result.risks.map((item, index) => (
              <div key={index} className="rounded-xl bg-background/70 border border-border/50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{item.risk}</p>
                  <span className={badgeClass(item.impact, 'impact')}>{item.impact}</span>
                </div>
                <p className="text-sm text-muted-foreground leading-6">{item.mitigation}</p>
              </div>
            ))}
          </div>
        }
      />
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<FileCheck2 className="h-4 w-4 text-primary" />} title="Entry Criteria" content={<BulletList items={result.entryCriteria} />} />
        <SectionCard icon={<FileCheck2 className="h-4 w-4 text-primary" />} title="Exit Criteria" content={<BulletList items={result.exitCriteria} />} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<ClipboardList className="h-4 w-4 text-primary" />} title="Deliverables" content={<BulletList items={result.deliverables} />} />
        <SectionCard icon={<Target className="h-4 w-4 text-primary" />} title="Milestones" content={<BulletList items={result.milestones} />} />
      </div>
      <SectionCard
        icon={<Brain className="h-4 w-4 text-primary" />}
        title="Roles and Responsibilities"
        content={
          <div className="space-y-3">
            {result.rolesAndResponsibilities.map((item, index) => (
              <div key={index} className="rounded-xl bg-background/70 border border-border/50 p-4">
                <p className="text-sm font-semibold text-foreground">{item.role}</p>
                <p className="text-sm text-muted-foreground leading-6 mt-1">{item.responsibility}</p>
              </div>
            ))}
          </div>
        }
      />
      <SectionCard icon={<ScrollText className="h-4 w-4 text-primary" />} title="Strategy Notes" content={<BulletList items={result.strategyNotes} />} />
    </ReportShell>
  );
}

function TraceabilityMatrixReport({
  result,
  onClose,
  onSave,
}: {
  result: TraceabilityMatrixResult;
  onClose: () => void;
  onSave?: (copyText: string) => void;
}) {
  const statusCounts = {
    covered: result.rows.filter((row) => row.coverageStatus === 'Covered').length,
    partial: result.rows.filter((row) => row.coverageStatus === 'Partial').length,
    missing: result.rows.filter((row) => row.coverageStatus === 'Missing').length,
  };

  const copyText = [
    'Requirement Traceability Matrix',
    '',
    `Summary: ${result.summary}`,
    '',
    'Rows:',
    ...result.rows.flatMap((row) => [
      `${row.id} | ${row.requirementReference} | ${row.coverageStatus}`,
      `Requirement Point: ${row.requirementPoint}`,
      `Module: ${row.module} | Priority: ${row.priority}`,
      `Suggested Scenario: ${row.suggestedScenario}`,
      `Suggested Testcases: ${row.suggestedTestCases.join(' | ')}`,
      `Notes: ${row.notes}`,
      '',
    ]),
    'Gaps:',
    ...result.gaps.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Recommended Next Steps:',
    ...result.recommendedNextSteps.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');

  return (
    <ReportShell
      title="Requirement Traceability Matrix"
      subtitle="Requirement-to-scenario coverage mapping"
      icon={<Target className="h-5 w-5 text-primary-foreground" />}
      copyText={copyText}
      onClose={onClose}
      onSave={onSave ? () => onSave(copyText) : undefined}
    >
      <SectionCard icon={<ScrollText className="h-4 w-4 text-primary" />} title="Summary" content={<p className="text-sm text-muted-foreground leading-6">{result.summary}</p>} />
      <div className="grid lg:grid-cols-3 gap-4">
        <LabeledValue label="Covered" value={String(statusCounts.covered)} />
        <LabeledValue label="Partial" value={String(statusCounts.partial)} />
        <LabeledValue label="Missing" value={String(statusCounts.missing)} />
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="font-bold font-display text-foreground">RTM Rows ({result.rows.length})</h3>
        </div>
        {result.rows.map((row) => (
          <div key={row.id} className="rounded-xl bg-background/70 border border-border/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{row.requirementReference}</span>
              <span className={badgeClass(row.priority, 'priority')}>{row.priority}</span>
              <span className={badgeClass(row.coverageStatus, 'coverage')}>{row.coverageStatus}</span>
            </div>
            <p className="text-sm font-semibold text-foreground">{row.requirementPoint}</p>
            <p className="text-sm text-muted-foreground">Module: {row.module}</p>
            <p className="text-sm text-muted-foreground">Suggested Scenario: {row.suggestedScenario}</p>
            <div>
              <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-2">Suggested Testcases</p>
              <BulletList items={row.suggestedTestCases} />
            </div>
            <p className="text-sm text-muted-foreground">Notes: {row.notes}</p>
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<AlertCircle className="h-4 w-4 text-primary" />} title="Gaps" content={<BulletList items={result.gaps} emptyLabel="No major gaps listed." />} />
        <SectionCard icon={<Brain className="h-4 w-4 text-primary" />} title="Recommended Next Steps" content={<BulletList items={result.recommendedNextSteps} emptyLabel="No next steps listed." />} />
      </div>
    </ReportShell>
  );
}

function TestDataPlanReport({
  result,
  onClose,
  onSave,
}: {
  result: TestDataPlanResult;
  onClose: () => void;
  onSave?: (copyText: string) => void;
}) {
  const copyText = [
    'Test Data Plan',
    '',
    `Summary: ${result.summary}`,
    '',
    'Data Categories:',
    ...result.dataCategories.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Datasets:',
    ...result.datasets.flatMap((item) => [
      `${item.id} - ${item.scenario}`,
      `Category: ${item.dataCategory}`,
      `Objective: ${item.objective}`,
      `Sample Data: ${item.sampleData.join(' | ')}`,
      `Negative/Edge Data: ${item.negativeOrEdgeData.join(' | ')}`,
      `Why Needed: ${item.whyNeeded}`,
      `Preconditions: ${item.preconditions.join(' | ')}`,
      '',
    ]),
    'Environment Notes:',
    ...result.environmentNotes.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Privacy Notes:',
    ...result.privacyNotes.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');

  return (
    <ReportShell
      title="Test Data Plan"
      subtitle="Requirement-driven datasets for positive, negative, and edge testing"
      icon={<Database className="h-5 w-5 text-primary-foreground" />}
      copyText={copyText}
      onClose={onClose}
      onSave={onSave ? () => onSave(copyText) : undefined}
    >
      <SectionCard icon={<ScrollText className="h-4 w-4 text-primary" />} title="Summary" content={<p className="text-sm text-muted-foreground leading-6">{result.summary}</p>} />
      <SectionCard icon={<Database className="h-4 w-4 text-primary" />} title="Data Categories" content={<BulletList items={result.dataCategories} />} />
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="font-bold font-display text-foreground">Datasets ({result.datasets.length})</h3>
        </div>
        {result.datasets.map((item) => (
          <div key={item.id} className="rounded-xl bg-background/70 border border-border/50 p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {item.id} - {item.scenario}
              </p>
              <p className="text-sm text-muted-foreground">{item.dataCategory}</p>
            </div>
            <p className="text-sm text-muted-foreground leading-6">{item.objective}</p>
            <div className="grid lg:grid-cols-2 gap-4">
              <SectionCard icon={<Database className="h-4 w-4 text-primary" />} title="Sample Data" content={<BulletList items={item.sampleData} />} />
              <SectionCard icon={<AlertCircle className="h-4 w-4 text-primary" />} title="Negative / Edge Data" content={<BulletList items={item.negativeOrEdgeData} />} />
            </div>
            <LabeledValue label="Why Needed" value={item.whyNeeded} />
            <SectionCard icon={<FileSearch className="h-4 w-4 text-primary" />} title="Preconditions" content={<BulletList items={item.preconditions} />} />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<Target className="h-4 w-4 text-primary" />} title="Environment Notes" content={<BulletList items={result.environmentNotes} />} />
        <SectionCard icon={<ShieldAlert className="h-4 w-4 text-primary" />} title="Privacy Notes" content={<BulletList items={result.privacyNotes} />} />
      </div>
    </ReportShell>
  );
}

function ScenarioMapReport({
  result,
  onClose,
  onSave,
}: {
  result: ScenarioMapResult;
  onClose: () => void;
  onSave?: (copyText: string) => void;
}) {
  const copyText = [
    'Scenario Map',
    '',
    `Feature Goal: ${result.featureGoal}`,
    '',
    'Primary Flow:',
    ...result.primaryFlow.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Alternate Flows:',
    ...result.alternateFlows.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Negative Flows:',
    ...result.negativeFlows.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Edge Cases:',
    ...result.edgeCases.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Regression Focus:',
    ...result.regressionFocus.map((item, index) => `${index + 1}. ${item}`),
    '',
    'High-Risk Intersections:',
    ...result.highRiskIntersections.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');

  return (
    <ReportShell
      title="Scenario Map"
      subtitle="Primary, alternate, negative, edge, and regression-sensitive flows"
      icon={<GitBranch className="h-5 w-5 text-primary-foreground" />}
      copyText={copyText}
      onClose={onClose}
      onSave={onSave ? () => onSave(copyText) : undefined}
    >
      <SectionCard icon={<Target className="h-4 w-4 text-primary" />} title="Feature Goal" content={<p className="text-sm text-muted-foreground leading-6">{result.featureGoal}</p>} />
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<GitBranch className="h-4 w-4 text-primary" />} title="Primary Flow" content={<BulletList items={result.primaryFlow} />} />
        <SectionCard icon={<GitBranch className="h-4 w-4 text-primary" />} title="Alternate Flows" content={<BulletList items={result.alternateFlows} />} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<AlertCircle className="h-4 w-4 text-primary" />} title="Negative Flows" content={<BulletList items={result.negativeFlows} />} />
        <SectionCard icon={<ShieldAlert className="h-4 w-4 text-primary" />} title="Edge Cases" content={<BulletList items={result.edgeCases} />} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard icon={<Target className="h-4 w-4 text-primary" />} title="Regression Focus" content={<BulletList items={result.regressionFocus} />} />
        <SectionCard icon={<ShieldAlert className="h-4 w-4 text-primary" />} title="High-Risk Intersections" content={<BulletList items={result.highRiskIntersections} />} />
      </div>
    </ReportShell>
  );
}

function ClarificationQuestionsReport({
  result,
  onClose,
  onSave,
}: {
  result: ClarificationQuestionsResult;
  onClose: () => void;
  onSave?: (copyText: string) => void;
}) {
  const copyText = [
    'Clarification Questions',
    '',
    `Summary: ${result.summary}`,
    '',
    'Questions:',
    ...result.questions.flatMap((item) => [
      `${item.id} - ${item.question}`,
      `Why it matters: ${item.whyItMatters}`,
      `Risk if unanswered: ${item.riskIfUnanswered}`,
      `Suggested owner: ${item.suggestedOwner}`,
      `Blocking level: ${item.blockingLevel}`,
      '',
    ]),
    'Assumptions:',
    ...result.assumptions.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Decisions To Confirm:',
    ...result.decisionsToConfirm.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Safe Testing Assumptions:',
    ...result.safeTestingAssumptions.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');

  return (
    <ReportShell
      title="Clarification Questions"
      subtitle="Ambiguities, assumptions, and blocking questions to raise before testing"
      icon={<CircleHelp className="h-5 w-5 text-primary-foreground" />}
      copyText={copyText}
      onClose={onClose}
      onSave={onSave ? () => onSave(copyText) : undefined}
    >
      <SectionCard icon={<ScrollText className="h-4 w-4 text-primary" />} title="Summary" content={<p className="text-sm text-muted-foreground leading-6">{result.summary}</p>} />
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CircleHelp className="h-4 w-4 text-primary" />
          <h3 className="font-bold font-display text-foreground">Questions ({result.questions.length})</h3>
        </div>
        {result.questions.map((item) => (
          <div key={item.id} className="rounded-xl bg-background/70 border border-border/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{item.id}</span>
              <span className={badgeClass(item.riskIfUnanswered, 'impact')}>{item.riskIfUnanswered}</span>
              <span className={badgeClass(item.blockingLevel, 'blocking')}>{item.blockingLevel}</span>
            </div>
            <p className="text-sm font-semibold text-foreground">{item.question}</p>
            <p className="text-sm text-muted-foreground leading-6">{item.whyItMatters}</p>
            <p className="text-sm text-muted-foreground">Suggested owner: {item.suggestedOwner}</p>
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <SectionCard icon={<Brain className="h-4 w-4 text-primary" />} title="Assumptions" content={<BulletList items={result.assumptions} />} />
        <SectionCard icon={<Target className="h-4 w-4 text-primary" />} title="Decisions To Confirm" content={<BulletList items={result.decisionsToConfirm} />} />
        <SectionCard icon={<ShieldAlert className="h-4 w-4 text-primary" />} title="Safe Testing Assumptions" content={<BulletList items={result.safeTestingAssumptions} />} />
      </div>
    </ReportShell>
  );
}

function badgeClass(value: string, type: 'impact' | 'priority' | 'coverage' | 'blocking') {
  if (type === 'coverage') {
    if (value === 'Covered') return 'rounded-full bg-emerald-500/10 text-emerald-400 px-2.5 py-1 text-xs font-medium';
    if (value === 'Partial') return 'rounded-full bg-amber-500/10 text-amber-400 px-2.5 py-1 text-xs font-medium';
    return 'rounded-full bg-rose-500/10 text-rose-400 px-2.5 py-1 text-xs font-medium';
  }

  if (type === 'blocking') {
    if (value === 'Blocking') return 'rounded-full bg-rose-500/10 text-rose-400 px-2.5 py-1 text-xs font-medium';
    if (value === 'Important') return 'rounded-full bg-amber-500/10 text-amber-400 px-2.5 py-1 text-xs font-medium';
    return 'rounded-full bg-sky-500/10 text-sky-400 px-2.5 py-1 text-xs font-medium';
  }

  if (value === 'Critical' || value === 'High') {
    return 'rounded-full bg-rose-500/10 text-rose-400 px-2.5 py-1 text-xs font-medium';
  }
  if (value === 'Medium') {
    return 'rounded-full bg-amber-500/10 text-amber-400 px-2.5 py-1 text-xs font-medium';
  }
  return 'rounded-full bg-emerald-500/10 text-emerald-400 px-2.5 py-1 text-xs font-medium';
}
