import { useState } from 'react';
import { TestCase } from '@/types/testCase';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';

export function useAuditEnhance() {
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditedTestCases, setAuditedTestCases] = useState<TestCase[]>([]);

  const auditTestCases = async (
    requirement: string,
    existingTestCases: Record<string, string>[],
    imagesBase64?: string[]
  ) => {
    if (!requirement.trim() && (!imagesBase64 || imagesBase64.length === 0)) {
      toast({
        title: 'Input required',
        description: 'Please enter a requirement or upload an image to audit against.',
        variant: 'destructive',
      });
      return [];
    }

    if (existingTestCases.length === 0) {
      toast({
        title: 'No test cases',
        description: 'Please upload existing test cases to audit.',
        variant: 'destructive',
      });
      return [];
    }

    setIsAuditing(true);
    setAuditedTestCases([]);

    try {
      const data = await invokeWithRetry('audit-test-cases', { requirement, existingTestCases, imagesBase64 });

      const generated = data.testCases || [];
      setAuditedTestCases(generated);

      toast({
        title: 'Audit complete',
        description: `Generated ${generated.length} new test cases to cover gaps.`,
      });

      return generated;
    } catch (error) {
      console.error('Error auditing test cases:', error);
      const aiError = describeAiError(error, 'Audit failed', 'Failed to audit test cases');
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsAuditing(false);
    }
  };

  const clearAuditedTestCases = () => {
    setAuditedTestCases([]);
  };

  return {
    isAuditing,
    auditedTestCases,
    auditTestCases,
    clearAuditedTestCases,
    setAuditedTestCases,
  };
}
