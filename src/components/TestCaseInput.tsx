import { useState, useRef } from 'react';
import { Loader2, Trash2, Zap, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { InputTypeSelector } from './InputTypeSelector';
import { TemplateLibrary } from './TemplateLibrary';
import { GenerationProgress } from './GenerationProgress';
import { InputType } from '@/types/testCase';
import { GenerationStage } from '@/hooks/useTestCaseGenerator';

const MAX_IMAGES = 5;

interface TestCaseInputProps {
  onGenerate: (input: string, inputType: InputType, imagesBase64?: string[]) => Promise<void>;
  isLoading: boolean;
  stage: GenerationStage;
  stageMessage?: string | null;
  onClear: () => void;
}

const PLACEHOLDERS: Record<InputType, string> = {
  requirement: "As a tenant admin or buyer with appropriate permissions I want the ability to...",
  highlevel: "Paste your requirement here to generate high level test cases...",
  testcase: "Verify that the admin can create additional field with valid name...",
  scenario: "Admin creates required field, buyer tries checkout without filling it...",
  expected: "Buyer with BeforeRelease=No tries to edit required visible field...",
};

const LABELS: Record<InputType, string> = {
  requirement: "Paste your requirement / user story:",
  highlevel: "Paste your requirement for high level test cases:",
  testcase: "Paste your test case:",
  scenario: "Describe the scenario:",
  expected: "Paste test case to get expected result:",
};

export function TestCaseInput({ onGenerate, isLoading, stage, stageMessage, onClear }: TestCaseInputProps) {
  const [input, setInput] = useState('');
  const [inputType, setInputType] = useState<InputType>('requirement');
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imagesBase64, setImagesBase64] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    await onGenerate(input, inputType, imagesBase64.length > 0 ? imagesBase64 : undefined);
  };

  const handleClear = () => {
    setInput('');
    setImagePreviews([]);
    setImagesBase64([]);
    onClear();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remaining = MAX_IMAGES - imagesBase64.length;
    const toProcess = files.filter(f => f.type.startsWith('image/')).slice(0, remaining);

    toProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setImagePreviews(prev => [...prev, result]);
        setImagesBase64(prev => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
    setImagesBase64(prev => prev.filter((_, i) => i !== index));
  };

  const hasContent = input.trim() || imagesBase64.length > 0;

  return (
    <div className="relative group">
      <div className="absolute -inset-[1px] gradient-primary rounded-2xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500" />
      
      <div className="relative gradient-card rounded-2xl border border-border/60 p-6 space-y-5 shadow-md">
        <div className="flex items-center justify-between">
          <InputTypeSelector value={inputType} onChange={setInputType} />
          <TemplateLibrary onSelect={(text) => setInput(text)} />
        </div>
        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full gradient-primary" />
            {LABELS[inputType]}
          </label>
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={PLACEHOLDERS[inputType]}
              className="min-h-[160px] resize-y font-mono text-sm bg-muted/30 border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl transition-all"
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Image Upload Section */}
        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            Attach screenshots / mockups (optional, up to {MAX_IMAGES}):
          </label>
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
            disabled={isLoading}
          />
          
          <div className="flex flex-wrap gap-3">
            {imagePreviews.map((preview, index) => (
              <div key={index} className="relative inline-block">
                <img
                  src={preview}
                  alt={`Upload ${index + 1}`}
                  className="h-24 w-24 rounded-xl border border-border/60 object-cover bg-muted/30"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full shadow-md"
                  onClick={() => removeImage(index)}
                  disabled={isLoading}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            
            {imagesBase64.length < MAX_IMAGES && (
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="gap-2 border-dashed border-border/60 hover:bg-muted/50 h-24 w-24 rounded-xl flex flex-col items-center justify-center"
              >
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {imagesBase64.length === 0 ? 'Add' : 'More'}
                </span>
              </Button>
            )}
          </div>
          
          {imagesBase64.length > 0 && (
            <p className="text-xs text-muted-foreground">{imagesBase64.length}/{MAX_IMAGES} images attached</p>
          )}
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleGenerate}
            disabled={isLoading || !hasContent}
            size="lg"
            className="flex-1 gap-2 gradient-primary hover:opacity-90 transition-all shadow-md hover:shadow-glow font-semibold h-12 rounded-xl"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Zap className="h-5 w-5" />
                <span>Generate Test Cases</span>
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            size="lg"
            onClick={handleClear} 
            className="gap-2 border-border/60 hover:bg-muted/50 h-12 rounded-xl px-5"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>

        <GenerationProgress
          isActive={isLoading}
          stage={stage}
          stageMessage={stageMessage}
          imageCount={imagesBase64.length}
        />
      </div>
    </div>
  );
}
