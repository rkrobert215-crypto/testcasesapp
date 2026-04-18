import { useState } from 'react';
import { TestCase, InputType } from '@/types/testCase';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';

export interface MissingScenario {
  scenario: string;
  priority: 'High' | 'Medium' | 'Low';
  type: 'Positive' | 'Negative';
}

export interface CoverageResult {
  coverageScore: number;
  summary: string;
  coveredAreas: string[];
  missingScenarios: MissingScenario[];
  recommendations: string[];
}

export function useCoverageValidator() {
  const [isValidating, setIsValidating] = useState(false);
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);

  const validateCoverage = async (
    input: string,
    inputType: InputType,
    testCases: TestCase[],
    imagesBase64?: string[]
  ) => {
    if (testCases.length === 0) {
      toast({
        title: 'No test cases',
        description: 'Generate test cases first before validating coverage.',
        variant: 'destructive',
      });
      return null;
    }

    setIsValidating(true);
    setCoverageResult(null);

    try {
      const data = await invokeWithRetry('validate-coverage', { input, inputType, imagesBase64, testCases });

      setCoverageResult(data);

      const scoreLabel = data.coverageScore >= 90 ? 'Excellent' : data.coverageScore >= 70 ? 'Good' : 'Needs Review';
      toast({
        title: `Coverage: ${data.coverageScore}% - ${scoreLabel}`,
        description: data.summary,
      });

      return data;
    } catch (error) {
      console.error('Error validating coverage:', error);
      const aiError = describeAiError(error, 'Validation failed', 'Failed to validate coverage');
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  const clearCoverageResult = () => {
    setCoverageResult(null);
  };

  return {
    isValidating,
    coverageResult,
    validateCoverage,
    clearCoverageResult,
  };
}
