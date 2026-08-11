import { useState } from 'react';
import { TestCase, InputType } from '@/types/testCase';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';

export type GenerationStage = 'reading' | 'analyzing' | 'generating' | 'validating' | 'retrying' | 'finalizing' | 'complete' | 'error' | null;

interface GenerateTestCaseOptions {
  deferDelivery?: boolean;
}

interface DeliverTestCaseOptions {
  title: string;
  description: string;
  stageMessage?: string;
  variant?: 'default' | 'destructive';
}

export function useTestCaseGenerator() {
  const [isLoading, setIsLoading] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [stage, setStage] = useState<GenerationStage>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);

  const updateGenerationStage = (nextStage: GenerationStage, message: string) => {
    setStage(nextStage);
    setStageMessage(message);
  };

  const deliverTestCases = (cases: TestCase[], options: DeliverTestCaseOptions) => {
    setTestCases(cases);
    setStage('complete');
    setStageMessage(options.stageMessage || 'Test cases ready.');
    setIsLoading(false);
    toast({
      title: options.title,
      description: options.description,
      variant: options.variant,
    });
  };

  const generateTestCases = async (
    input: string,
    inputType: InputType,
    imagesBase64?: string[],
    options: GenerateTestCaseOptions = {}
  ) => {
    if (!input.trim() && (!imagesBase64 || imagesBase64.length === 0)) {
      toast({
        title: 'Input required',
        description: 'Please enter some text or upload an image to generate test cases.',
        variant: 'destructive',
      });
      return [];
    }

    setIsLoading(true);
    setTestCases([]);
    setStage('reading');
    setStageMessage('Reading requirement...');
    let keepLoadingForDeferredDelivery = false;

    try {
      setStage('generating');
      setStageMessage('Generating test cases...');

      const data = await invokeWithRetry('generate-test-cases', {
        input,
        inputType,
        imagesBase64,
      }, {
        maxRetries: 2,
        maxAttemptDurationForRetryMs: 45000,
      });

      const generated = data.testCases || [];
      const wasCached = data.cached === true;

      if (options.deferDelivery && generated.length > 0) {
        keepLoadingForDeferredDelivery = true;
        setStage('validating');
        setStageMessage('Initial suite ready. Starting automatic coverage review...');
      } else {
        deliverTestCases(generated, {
          title: wasCached ? 'Test cases loaded (cached)' : 'Test cases generated',
          description: `${wasCached ? 'Loaded' : 'Generated'} ${generated.length} test cases${wasCached ? ' from cache' : ''}.`,
          stageMessage: wasCached ? 'Loaded cached results.' : 'Test cases ready.',
        });
      }

      return generated;
    } catch (error) {
      console.error('Error generating test cases:', error);
      const aiError = describeAiError(error, 'Generation failed', 'Failed to generate test cases');
      setStage('error');
      setStageMessage(aiError.description);
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
      return [];
    } finally {
      if (!keepLoadingForDeferredDelivery) {
        setIsLoading(false);
      }
    }
  };

  const clearTestCases = () => {
    setIsLoading(false);
    setTestCases([]);
    setStage(null);
    setStageMessage(null);
  };

  return {
    isLoading,
    testCases,
    stage,
    stageMessage,
    generateTestCases,
    clearTestCases,
    setTestCases,
    updateGenerationStage,
    deliverTestCases,
  };
}
