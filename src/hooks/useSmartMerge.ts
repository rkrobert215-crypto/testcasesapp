import { useState } from 'react';
import { TestCase } from '@/types/testCase';
import { toast } from '@/hooks/use-toast';
import { MergeDiffData } from '@/components/MergeDiffView';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';

export function useSmartMerge() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [diffData, setDiffData] = useState<MergeDiffData | null>(null);

  const processMerge = async (parsedFiles: Record<string, string>[][]): Promise<TestCase[]> => {
    setIsProcessing(true);
    setDiffData(null);

    const originalTestCaseNames: string[] = [];
    parsedFiles.forEach(fileRows => {
      fileRows.forEach(row => {
        const name = row.testCase || row.testcase || row['test case'] || row.description || '';
        if (name.trim()) originalTestCaseNames.push(name.trim());
      });
    });

    const originalCount = parsedFiles.reduce((sum, f) => sum + f.length, 0);

    try {
      const data = await invokeWithRetry('smart-merge-testcases', { files: parsedFiles });

      const merged: TestCase[] = data.testCases || [];
      const mergedNames = new Set(merged.map(tc => tc.testCase.toLowerCase().trim()));

      const removedAsDuplicates = originalTestCaseNames.filter(name => {
        const lower = name.toLowerCase().trim();
        for (const mergedName of mergedNames) {
          const origWords = new Set(lower.split(/\s+/).filter(w => w.length > 2));
          const mergedWords = new Set(mergedName.split(/\s+/).filter(w => w.length > 2));
          let overlap = 0;
          origWords.forEach(w => { if (mergedWords.has(w)) overlap++; });
          if (origWords.size > 0 && overlap / origWords.size > 0.6) return false;
        }
        return true;
      });

      setDiffData({
        originalCount,
        mergedCount: merged.length,
        removedAsDuplicates,
        keptOriginals: originalTestCaseNames.filter(n => !removedAsDuplicates.includes(n)),
        refinedTestCases: merged.map(tc => tc.testCase),
      });

      toast({
        title: 'Smart merge complete',
        description: `${originalCount} -> ${merged.length} test cases (${removedAsDuplicates.length} duplicates removed).`,
      });
      return merged;
    } catch (error) {
      console.error('Smart merge error:', error);
      const aiError = describeAiError(error, 'Merge failed', 'Failed to merge test cases');
      toast({
        title: aiError.title,
        description: aiError.description,
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsProcessing(false);
    }
  };

  const clearDiff = () => setDiffData(null);

  return { isProcessing, processMerge, diffData, clearDiff };
}
