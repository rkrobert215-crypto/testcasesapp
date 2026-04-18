import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';
import { TestPlanResult } from '@/types/qaPlanning';

export function useTestPlan() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [testPlan, setTestPlan] = useState<TestPlanResult | null>(null);

  const generateTestPlan = async (requirement: string) => {
    if (!requirement.trim()) {
      toast({
        title: 'Requirement needed',
        description: 'Paste a requirement before generating a test plan.',
        variant: 'destructive',
      });
      return null;
    }

    setIsGenerating(true);
    setTestPlan(null);

    try {
      const data = await invokeWithRetry('test-plan', { requirement });
      setTestPlan(data);
      toast({
        title: 'Test plan ready',
        description: 'Created a structured QA test plan for the requirement.',
      });
      return data as TestPlanResult;
    } catch (error) {
      console.error('Error generating test plan:', error);
      const aiError = describeAiError(error, 'Test plan failed', 'Failed to generate test plan');
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

  const clearTestPlan = () => setTestPlan(null);

  return {
    isGenerating,
    testPlan,
    generateTestPlan,
    clearTestPlan,
  };
}
