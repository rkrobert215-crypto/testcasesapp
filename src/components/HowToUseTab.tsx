import { Zap, FileSpreadsheet, Sparkles, Upload, ImagePlus, Download, ClipboardCopy, CheckCircle2, ArrowRight, Brain, RotateCcw, BookOpen, ScrollText, FileCheck2, Database, GitBranch, CircleHelp, Target } from 'lucide-react';

const TABS_GUIDE = [
  {
    icon: <Zap className="h-5 w-5" />,
    tab: 'Generate',
    color: 'text-primary',
    steps: [
      { text: 'Select an input mode (Full Requirement, High Level TCs, Complete TC, Scenario, or Expected Result)', icon: <ArrowRight className="h-3.5 w-3.5" /> },
      { text: 'Paste your requirement / user story in the text area', icon: <ArrowRight className="h-3.5 w-3.5" /> },
      { text: 'Optionally attach up to 5 screenshots or mockups for visual context', icon: <ImagePlus className="h-3.5 w-3.5" /> },
      { text: 'Click "Generate Test Cases" — AI produces 20-30 structured test cases', icon: <Brain className="h-3.5 w-3.5" /> },
      { text: 'Use "Validate Coverage" to check if all scenarios are covered', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    ],
    whatToTest: [
      'Try each of the 5 input modes with different types of requirements',
      'Upload 2-3 images alongside text to test multi-modal generation',
      'Use the Template Library dropdown to pre-fill common scenarios',
      'After generating, click "Validate Coverage" to find gaps',
      'Export results as CSV or XLSX and verify the file opens correctly',
    ],
  },
  {
    icon: <Brain className="h-5 w-5" />,
    tab: 'Requirement Analysis',
    color: 'text-primary',
    steps: [
      { text: 'Paste the full requirement or acceptance criteria into the analysis text area', icon: <ArrowRight className="h-3.5 w-3.5" /> },
      { text: 'Click "Analyze Requirement" to let AI read the requirement carefully in multiple passes', icon: <Brain className="h-3.5 w-3.5" /> },
      { text: 'Review the simple summary and functionality explanation in plain English', icon: <ScrollText className="h-3.5 w-3.5" /> },
      { text: 'Open each acceptance-criteria section to see what to test and how to test it', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    ],
    whatToTest: [
      'Paste a requirement with explicit AC bullets and confirm each AC appears in the breakdown',
      'Paste a requirement without formal AC bullets and check whether the app derives practical requirement points',
      'Verify the summary is understandable by a non-technical teammate',
      'Confirm the "what to test" and "how to test" guidance is concrete and useful for manual testing',
    ],
  },
  {
    icon: <FileCheck2 className="h-5 w-5" />,
    tab: 'QA Planning',
    color: 'text-primary',
    steps: [
      { text: 'Open QA Planning and choose Test Plan, RTM, Test Data, Scenario Map, or Clarifications', icon: <ArrowRight className="h-3.5 w-3.5" /> },
      { text: 'Paste the requirement once and reuse it across all planning tools', icon: <ScrollText className="h-3.5 w-3.5" /> },
      { text: 'Use Test Plan for strategy, RTM for coverage mapping, Test Data for datasets, Scenario Map for flows, and Clarifications for open questions', icon: <Target className="h-3.5 w-3.5" /> },
      { text: 'If test cases already exist in the app table, RTM uses them to judge Covered / Partial / Missing coverage', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    ],
    whatToTest: [
      'Generate a Test Plan and verify scope, risks, entry criteria, exit criteria, and deliverables are requirement-specific',
      'Generate an RTM with and without existing test cases to confirm coverage status changes realistically',
      'Generate a Test Data Plan and check for valid, invalid, and edge datasets',
      'Generate a Scenario Map and verify primary, alternate, negative, and edge flows are all present',
      'Generate Clarification Questions and confirm blockers, assumptions, and decision points are practical and not filler',
    ],
  },
  {
    icon: <FileSpreadsheet className="h-5 w-5" />,
    tab: 'Upload & Merge',
    color: 'text-accent',
    steps: [
      { text: 'Upload one or more Excel/CSV files containing existing test cases', icon: <Upload className="h-3.5 w-3.5" /> },
      { text: 'The AI analyzes, deduplicates, and merges all uploaded test cases', icon: <Brain className="h-3.5 w-3.5" /> },
      { text: 'Review the merged result in the table below', icon: <ArrowRight className="h-3.5 w-3.5" /> },
      { text: 'A diff view shows what was added, removed, or kept', icon: <ArrowRight className="h-3.5 w-3.5" /> },
    ],
    whatToTest: [
      'Upload 2+ overlapping test case files to verify deduplication',
      'Try files with different column structures',
      'Check the diff view to confirm merge accuracy',
      'Export the merged result and compare with originals',
    ],
  },
  {
    icon: <Sparkles className="h-5 w-5" />,
    tab: 'Audit & Enhance',
    color: 'text-primary',
    steps: [
      { text: 'Paste the requirement and upload existing test cases (Excel/CSV)', icon: <ArrowRight className="h-3.5 w-3.5" /> },
      { text: 'Optionally attach screenshots for additional context', icon: <ImagePlus className="h-3.5 w-3.5" /> },
      { text: 'AI audits your test cases against the requirement', icon: <Brain className="h-3.5 w-3.5" /> },
      { text: 'Missing scenarios are added, weak cases are enhanced', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    ],
    whatToTest: [
      'Provide a requirement with intentionally incomplete test cases',
      'Check if AI adds missing negative, edge, and security test cases',
      'Verify enhanced test cases retain existing valid content',
      'Attach images to see if visual context improves audit quality',
    ],
  },
];

const GENERAL_FEATURES = [
  { icon: <ClipboardCopy className="h-4 w-4" />, text: 'Click any cell to copy its value; use row/column copy buttons for bulk copying' },
  { icon: <Download className="h-4 w-4" />, text: 'Export to CSV or XLSX — files are spreadsheet-ready with auto-sized columns' },
  { icon: <RotateCcw className="h-4 w-4" />, text: 'History panel (right sidebar) auto-saves every generation for quick reload' },
  { icon: <Brain className="h-4 w-4" />, text: 'AI calls auto-retry up to 3 times with exponential backoff on failures' },
  { icon: <Database className="h-4 w-4" />, text: 'AI Settings style mode now applies across Generate, Requirement Analysis, QA Planning, Audit, Merge, and Coverage validation' },
  { icon: <GitBranch className="h-4 w-4" />, text: 'QA Planning groups Test Plan, RTM, Test Data, Scenario Map, and Clarification Questions into one workbench' },
  { icon: <CircleHelp className="h-4 w-4" />, text: 'RTM can use the current testcase table in the app to judge whether requirement points are Covered, Partial, or Missing' },
];

export function HowToUseTab() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="gradient-subtle border border-primary/20 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 gradient-primary rounded-xl shadow-glow">
            <BookOpen className="h-5 w-5 text-primary-foreground" />
          </div>
          <h3 className="text-xl font-bold font-display text-foreground">How to Use & What to Test</h3>
        </div>
        <p className="text-muted-foreground">
          A complete guide to every tab, feature, and what you should test to verify everything works.
        </p>
      </div>

      {/* Tab-by-tab guide */}
      <div className="space-y-4">
        {TABS_GUIDE.map((guide) => (
          <div key={guide.tab} className="gradient-card border border-border/60 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-primary/10 ${guide.color}`}>{guide.icon}</div>
              <h4 className="text-lg font-bold font-display text-foreground">Tab: {guide.tab}</h4>
            </div>

            {/* Steps */}
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">How it works:</p>
              <ol className="space-y-2">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <span className="mt-0.5 text-primary shrink-0">{step.icon}</span>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* What to test */}
            <div className="bg-muted/40 rounded-xl p-4">
              <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                What to test:
              </p>
              <ul className="space-y-1.5">
                {guide.whatToTest.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-1 shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {/* General features */}
      <div className="gradient-card border border-border/60 rounded-2xl p-6">
        <h4 className="text-lg font-bold font-display text-foreground mb-4">General Features</h4>
        <div className="grid sm:grid-cols-2 gap-3">
          {GENERAL_FEATURES.map((feat, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-muted/40">
              <span className="mt-0.5 text-primary shrink-0">{feat.icon}</span>
              <p className="text-sm text-muted-foreground">{feat.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
