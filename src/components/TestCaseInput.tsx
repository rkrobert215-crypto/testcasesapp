import { useState, useRef } from 'react';
import { Loader2, Trash2, Zap, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { InputTypeSelector } from './InputTypeSelector';
import { TemplateLibrary } from './TemplateLibrary';
import { GenerationProgress } from './GenerationProgress';
import { InputType } from '@/types/testCase';
import { GenerationStage } from '@/hooks/useTestCaseGenerator';
import { useToast } from '@/hooks/use-toast';
import { fitImagesWithinCloudPayloadBudget, optimizeImageForAi } from '@/lib/imageOptimizer';

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
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleGenerate = async () => {
    await onGenerate(input, inputType, imagesBase64.length > 0 ? imagesBase64 : undefined);
  };

  const handleClear = () => {
    setInput('');
    setImagePreviews([]);
    setImagesBase64([]);
    onClear();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remaining = MAX_IMAGES - imagesBase64.length;
    const toProcess = files.slice(0, remaining);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (remaining <= 0) {
      toast({
        title: 'Maximum images reached',
        description: `You can attach up to ${MAX_IMAGES} screenshots.`,
        variant: 'destructive',
      });
      return;
    }

    setIsProcessingImages(true);
    const results = await Promise.allSettled(toProcess.map(optimizeImageForAi));
    const optimizedCandidates = results
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof optimizeImageForAi>>> =>
        result.status === 'fulfilled'
      )
      .map((result) => result.value.dataUrl);
    const { accepted: optimized, rejectedCount } = fitImagesWithinCloudPayloadBudget(
      imagesBase64,
      optimizedCandidates
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
    if (rejectedCount > 0) {
      errors.push(
        `${rejectedCount} image${rejectedCount === 1 ? '' : 's'} exceeded the combined cloud request limit.`
      );
    }

    if (optimized.length > 0) {
      setImagePreviews((current) => [...current, ...optimized]);
      setImagesBase64((current) => [...current, ...optimized]);
    }
    if (errors.length > 0) {
      toast({
        title: 'Some images were not attached',
        description: errors.join(' '),
        variant: 'destructive',
      });
    }
    setIsProcessingImages(false);
  };

  const removeImage = (index: number) => {
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
    setImagesBase64(prev => prev.filter((_, i) => i !== index));
  };

  const hasContent = input.trim() || imagesBase64.length > 0;
  const usesAutomaticQualityGate = inputType === 'requirement';

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
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={handleImageUpload}
            className="hidden"
            disabled={isLoading || isProcessingImages}
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
                disabled={isLoading || isProcessingImages}
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
            disabled={isLoading || isProcessingImages || !hasContent}
            size="lg"
            className="flex-1 gap-2 gradient-primary hover:opacity-90 transition-all shadow-md hover:shadow-glow font-semibold h-12 rounded-xl"
          >
            {isLoading || isProcessingImages ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{isProcessingImages ? 'Preparing images...' : 'Generating...'}</span>
              </>
            ) : (
              <>
                <Zap className="h-5 w-5" />
                <span>{usesAutomaticQualityGate ? 'Generate Reviewed Test Cases' : 'Generate Test Cases'}</span>
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            size="lg"
            onClick={handleClear} 
            disabled={isLoading || isProcessingImages}
            className="gap-2 border-border/60 hover:bg-muted/50 h-12 rounded-xl px-5"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>

        {usesAutomaticQualityGate && (
          <p className="text-center text-xs leading-5 text-muted-foreground">
            Full Requirement includes the senior-QA review, then runs one fast exact-requirement check. If a supported
            gap remains, it is added in one consolidated pass and rechecked once. Detailed Coverage Analysis stays
            available under Result Actions after delivery.
          </p>
        )}

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
