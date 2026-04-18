import { InputType, InputTypeOption } from '@/types/testCase';
import { cn } from '@/lib/utils';
import { FileText, Rocket, PenTool, ScrollText, Target } from 'lucide-react';

const INPUT_TYPES: (InputTypeOption & { icon: React.ReactNode })[] = [
  { value: 'requirement', label: 'Full Requirement', icon: <FileText className="h-4 w-4" />, description: 'Generate 20-30 comprehensive test cases' },
  { value: 'highlevel', label: 'High Level TCs', icon: <Rocket className="h-4 w-4" />, description: 'Generate 5-15 smoke tests quickly' },
  { value: 'testcase', label: 'Complete TC', icon: <PenTool className="h-4 w-4" />, description: 'Fill in missing test case columns' },
  { value: 'scenario', label: 'Scenario', icon: <ScrollText className="h-4 w-4" />, description: 'Generate from scenario description' },
  { value: 'expected', label: 'Expected Result', icon: <Target className="h-4 w-4" />, description: 'Generate expected results only' },
];

interface InputTypeSelectorProps {
  value: InputType;
  onChange: (value: InputType) => void;
}

export function InputTypeSelector({ value, onChange }: InputTypeSelectorProps) {
  const selectedType = INPUT_TYPES.find(t => t.value === value);
  
  return (
    <div className="space-y-3">
      <label className="text-sm font-semibold text-foreground flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full gradient-primary" />
        Select Input Type
      </label>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {INPUT_TYPES.map((type) => (
          <button
            key={type.value}
            onClick={() => onChange(type.value)}
            className={cn(
              'group relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-300',
              'hover:scale-[1.02] active:scale-[0.98]',
              value === type.value
                ? 'border-primary bg-primary/10 shadow-md'
                : 'border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-primary/5'
            )}
          >
            <div className={cn(
              'p-2 rounded-lg transition-all',
              value === type.value
                ? 'gradient-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary'
            )}>
              {type.icon}
            </div>
            <span className={cn(
              'text-xs font-semibold text-center leading-tight transition-colors',
              value === type.value ? 'text-primary' : 'text-foreground'
            )}>
              {type.label}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40">
        <span className="text-xs text-muted-foreground">
          {selectedType?.description}
        </span>
      </div>
    </div>
  );
}
