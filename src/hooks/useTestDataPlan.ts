import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';
import { TestDataPlanResult } from '@/types/qaPlanning';

export function useTestDataPlan() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [testDataPlan, setTestDataPlan] = useState<TestDataPlanResult | null>(null);

  const generateTestDataPlan = async (requirement: string) => {
    if (!requirement.trim()) {
      toast({
        title: 'Requirement needed',
        description: 'Paste a requirement before generating a test data plan.',
        variant: 'destructive',
      });
      return null;
    }

    setIsGenerating(true);
    setTestDataPlan(null);

    try {
      const data = await invokeWithRetry('test-data-plan', { requirement });
      setTestDataPlan(data);
      toast({
        title: 'Test data plan ready',
        description: `Prepared ${data.datasets?.length || 0} test data datasets.`,
      });
      return data as TestDataPlanResult;
    } catch (error) {
      console.error('Error generating test data plan:', error);
      const aiError = describeAiError(error, 'Test data plan failed', 'Failed to generate the test data plan');
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const clearTestDataPlan = () => setTestDataPlan(null);

  return {
    isGenerating,
    testDataPlan,
    generateTestDataPlan,
    clearTestDataPlan,
  };
}
