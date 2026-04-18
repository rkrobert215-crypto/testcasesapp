import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';
import { RequirementAnalysisResult } from '@/types/requirementAnalysis';

export function useRequirementAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<RequirementAnalysisResult | null>(null);

  const analyzeRequirement = async (requirement: string) => {
    if (!requirement.trim()) {
      toast({
        title: 'Requirement needed',
        description: 'Paste a requirement or acceptance criteria before running analysis.',
        variant: 'destructive',
      });
      return null;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      const data = await invokeWithRetry('requirement-analysis', { requirement });
      setAnalysisResult(data);

      toast({
        title: 'Analysis ready',
        description: `Mapped ${data.acceptanceCriteria?.length || 0} requirement points into test guidance.`,
      });

      return data as RequirementAnalysisResult;
    } catch (error) {
      console.error('Error analyzing requirement:', error);
      const aiError = describeAiError(error, 'Analysis failed', 'Failed to analyze requirement');
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearAnalysis = () => {
    setAnalysisResult(null);
  };

  return {
    isAnalyzing,
    analysisResult,
    analyzeRequirement,
    clearAnalysis,
  };
}
