import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';
import { ClarificationQuestionsResult } from '@/types/qaPlanning';

export function useClarificationQuestions() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [clarifications, setClarifications] = useState<ClarificationQuestionsResult | null>(null);

  const generateClarificationQuestions = async (requirement: string) => {
    if (!requirement.trim()) {
      toast({
        title: 'Requirement needed',
        description: 'Paste a requirement before generating clarification questions.',
        variant: 'destructive',
      });
      return null;
    }

    setIsGenerating(true);
    setClarifications(null);

    try {
      const data = await invokeWithRetry('clarification-questions', { requirement });
      setClarifications(data);
      toast({
        title: 'Clarification questions ready',
        description: `Raised ${data.questions?.length || 0} QA clarification points.`,
      });
      return data as ClarificationQuestionsResult;
    } catch (error) {
      console.error('Error generating clarification questions:', error);
      const aiError = describeAiError(error, 'Clarification module failed', 'Failed to generate clarification questions');
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

  const clearClarifications = () => setClarifications(null);

  return {
    isGenerating,
    clarifications,
    generateClarificationQuestions,
    clearClarifications,
  };
}
