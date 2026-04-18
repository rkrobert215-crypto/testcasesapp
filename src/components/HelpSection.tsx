import { Sparkles, Brain, Clock, FileSpreadsheet, Zap, FileText, Rocket, PenTool, ScrollText, Target } from 'lucide-react';

const FEATURES = [
  {
    icon: <Brain className="h-5 w-5" />,
    title: 'AI-Powered Analysis',
    description: 'Advanced AI generates 20-30 comprehensive test cases with full coverage',
  },
  {
    icon: <Clock className="h-5 w-5" />,
    title: 'Auto-Save History',
    description: 'All generations saved locally in your browser automatically',
  },
  {
    icon: <FileSpreadsheet className="h-5 w-5" />,
    title: 'Excel/Sheets Ready',
    description: 'Copy cells, columns, rows, or export to paste directly into spreadsheets',
  },
];

const INPUT_MODES = [
  { icon: <FileText className="h-4 w-4" />, title: 'Full Requirement', description: 'Complete user story → 20-30 detailed test cases' },
  { icon: <Rocket className="h-4 w-4" />, title: 'High Level TCs', description: 'Requirement → 5-15 quick smoke tests' },
  { icon: <PenTool className="h-4 w-4" />, title: 'Complete TC', description: 'Test case → Fill missing columns' },
  { icon: <ScrollText className="h-4 w-4" />, title: 'Scenario', description: 'Scenario → Generate complete details' },
  { icon: <Target className="h-4 w-4" />, title: 'Expected Result', description: 'Test case → Generate expected outcomes' },
];

export function HelpSection() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero Section */}
      <div className="relative overflow-hidden gradient-subtle border border-primary/20 rounded-2xl p-8">
        <div className="absolute top-0 right-0 w-64 h-64 gradient-primary opacity-10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 gradient-primary rounded-xl shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <h3 className="text-xl font-bold font-display text-foreground">
              Welcome to Test Case Generator
            </h3>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Transform your requirements into comprehensive, well-structured test cases instantly. 
            Our AI analyzes your input and generates detailed scenarios covering positive, negative, 
            edge cases, and security aspects.
          </p>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid md:grid-cols-3 gap-4">
        {FEATURES.map((feature, index) => (
          <div 
            key={index}
            className="group gradient-card border border-border/60 rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-300"
          >
            <div className="p-2 w-fit gradient-primary rounded-lg text-primary-foreground mb-3 group-hover:shadow-glow transition-shadow">
              {feature.icon}
            </div>
            <h4 className="font-bold font-display text-foreground mb-1">{feature.title}</h4>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </div>

      {/* Input Modes */}
      <div className="gradient-card border border-border/60 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-5 w-5 text-primary" />
          <h3 className="font-bold font-display text-foreground">5 Input Modes Available</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {INPUT_MODES.map((mode, index) => (
            <div 
              key={index}
              className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors"
            >
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                {mode.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{mode.title}</p>
                <p className="text-xs text-muted-foreground">{mode.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
