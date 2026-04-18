import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { invokeWithRetry } from '@/lib/retryWithBackoff';
import { describeAiError } from '@/lib/providerErrors';
import { ScenarioMapResult } from '@/types/qaPlanning';

export function useScenarioMap() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [scenarioMap, setScenarioMap] = useState<ScenarioMapResult | null>(null);

  const generateScenarioMap = async (requirement: string) => {
    if (!requirement.trim()) {
      toast({
        title: 'Requirement needed',
        description: 'Paste a requirement before generating a scenario map.',
        variant: 'destructive',
      });
      return null;
    }

    setIsGenerating(true);
    setScenarioMap(null);

    try {
      const data = await invokeWithRetry('scenario-map', { requirement });
      setScenarioMap(data);
      toast({
        title: 'Scenario map ready',
        description: 'Mapped the feature into primary, alternate, negative, and edge flows.',
      });
      return data as ScenarioMapResult;
    } catch (error) {
      console.error('Error generating scenario map:', error);
      const aiError = describeAiError(error, 'Scenario map failed', 'Failed to generate the scenario map');
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

  const clearScenarioMap = () => setScenarioMap(null);

  return {
    isGenerating,
    scenarioMap,
    generateScenarioMap,
    clearScenarioMap,
  };
}
