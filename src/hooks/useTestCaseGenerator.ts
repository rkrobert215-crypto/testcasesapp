import { useState } from 'react';
import { TestCase, InputType } from '@/types/testCase';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';

export type GenerationStage = 'reading' | 'analyzing' | 'generating' | 'validating' | 'retrying' | 'finalizing' | 'complete' | 'error' | null;

export function useTestCaseGenerator() {
  const [isLoading, setIsLoading] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [stage, setStage] = useState<GenerationStage>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);

  const generateTestCases = async (input: string, inputType: InputType, imagesBase64?: string[]) => {
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

    try {
      setStage('generating');
      setStageMessage('Generating test cases...');

      const data = await invokeWithRetry('generate-test-cases', {
        input,
        inputType,
        imagesBase64,
      });

      const generated = data.testCases || [];
      const wasCached = data.cached === true;

      setTestCases(generated);
      setStage('finalizing');
      setStageMessage('Finalizing output...');
      setStage('complete');
      setStageMessage(wasCached ? 'Loaded cached results.' : 'Test cases ready.');

      toast({
        title: wasCached ? 'Test cases loaded (cached)' : 'Test cases generated',
        description: `${wasCached ? 'Loaded' : 'Generated'} ${generated.length} test cases${wasCached ? ' from cache' : ''}.`,
      });

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
      setIsLoading(false);
    }
  };

  const clearTestCases = () => {
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
  };
}
