import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';
import { TestCase } from '@/types/testCase';
import { TraceabilityMatrixResult } from '@/types/qaPlanning';

export function useTraceabilityMatrix() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [matrix, setMatrix] = useState<TraceabilityMatrixResult | null>(null);

  const generateTraceabilityMatrix = async (requirement: string, testCases: TestCase[]) => {
    if (!requirement.trim()) {
      toast({
        title: 'Requirement needed',
        description: 'Paste a requirement before generating the RTM.',
        variant: 'destructive',
      });
      return null;
    }

    setIsGenerating(true);
    setMatrix(null);

    try {
      const data = await invokeWithRetry('traceability-matrix', { requirement, testCases });
      setMatrix(data);
      toast({
        title: 'RTM ready',
        description: `Mapped ${data.rows?.length || 0} requirement rows into traceability coverage.`,
      });
      return data as TraceabilityMatrixResult;
    } catch (error) {
      console.error('Error generating RTM:', error);
      const aiError = describeAiError(error, 'RTM failed', 'Failed to generate the RTM');
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

  const clearMatrix = () => setMatrix(null);

  return {
    isGenerating,
    matrix,
    generateTraceabilityMatrix,
    clearMatrix,
  };
}
