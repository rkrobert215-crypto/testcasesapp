import type { CoverageResult } from '@/hooks/useCoverageValidator';

export interface CoverageImprovementSelectionOptions {
  scenarioIndexes?: number[];
  recommendationIndexes?: number[];
}

export function selectCoverageImprovements(
  coverageResult: CoverageResult,
  options: CoverageImprovementSelectionOptions = {}
) {
  const hasExplicitSelection =
    typeof options.scenarioIndexes !== 'undefined' ||
    typeof options.recommendationIndexes !== 'undefined';
  const missingScenarios = typeof options.scenarioIndexes !== 'undefined'
    ? coverageResult.missingScenarios.filter((_, index) => options.scenarioIndexes?.includes(index))
    : hasExplicitSelection ? [] : coverageResult.missingScenarios;
  const recommendations = typeof options.recommendationIndexes !== 'undefined'
    ? coverageResult.recommendations.filter((_, index) => options.recommendationIndexes?.includes(index))
    : hasExplicitSelection ? [] : coverageResult.recommendations;

  return {
    missingScenarios,
    recommendations,
    focusMissingScenarios: missingScenarios.map((scenario) => scenario.scenario),
    focusRecommendations: recommendations,
  };
}

export function countCoverageImprovementRequests(coverageResult: CoverageResult) {
  return coverageResult.missingScenarios.length + coverageResult.recommendations.length;
}
