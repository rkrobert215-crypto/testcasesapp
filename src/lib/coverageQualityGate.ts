import type { CoverageResult } from '@/hooks/useCoverageValidator';

export interface CoverageImprovementSelectionOptions {
  scenarioIndexes?: number[];
  recommendationIndexes?: number[];
}

export interface CoverageImprovementBatch {
  focusMissingScenarios: string[];
  focusRecommendations: string[];
}

export const DEFAULT_COVERAGE_IMPROVEMENT_BATCH_SIZE = 6;

const COVERAGE_STOP_WORDS = new Set([
  'a', 'add', 'an', 'and', 'are', 'as', 'at', 'be', 'behavior', 'by', 'case', 'check',
  'confirm', 'coverage', 'ensure', 'for', 'from', 'handling', 'in', 'is', 'it', 'of',
  'on', 'or', 'scenario', 'test', 'testing', 'that', 'the', 'this', 'to', 'verify',
  'with', 'without',
]);

export function isTestableCoverageInstruction(value: string) {
  return value.trim().length > 0 && !/^\s*(?:clarification|process)\s*:/i.test(value);
}

function coverageTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !COVERAGE_STOP_WORDS.has(token))
      .map((token) => token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token)
  );
}

function coverageInstructionsOverlap(left: string, right: string) {
  const leftTokens = coverageTokens(left);
  const rightTokens = coverageTokens(right);
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  if (smallerSize === 0) return false;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return overlap >= 2 && overlap / smallerSize >= 0.9 && overlap / unionSize >= 0.8;
}

export function selectCoverageImprovements(
  coverageResult: CoverageResult,
  options: CoverageImprovementSelectionOptions = {}
) {
  const hasExplicitSelection =
    typeof options.scenarioIndexes !== 'undefined' ||
    typeof options.recommendationIndexes !== 'undefined';
  const selectedMissingScenarios = typeof options.scenarioIndexes !== 'undefined'
    ? coverageResult.missingScenarios.filter((_, index) => options.scenarioIndexes?.includes(index))
    : hasExplicitSelection ? [] : coverageResult.missingScenarios;
  const selectedRecommendations = typeof options.recommendationIndexes !== 'undefined'
    ? coverageResult.recommendations.filter((_, index) => options.recommendationIndexes?.includes(index))
    : hasExplicitSelection ? [] : coverageResult.recommendations;
  const missingScenarios = selectedMissingScenarios.filter((item) =>
    isTestableCoverageInstruction(item.scenario)
  );
  const testableRecommendations = selectedRecommendations.filter(isTestableCoverageInstruction);
  const recommendations = testableRecommendations.filter((recommendation, index, all) =>
    all.findIndex((candidate) => coverageInstructionsOverlap(candidate, recommendation)) === index &&
    !missingScenarios.some((scenario) => coverageInstructionsOverlap(scenario.scenario, recommendation))
  );

  return {
    missingScenarios,
    recommendations,
    focusMissingScenarios: missingScenarios.map((scenario) => scenario.scenario),
    focusRecommendations: recommendations,
  };
}

export function countCoverageImprovementRequests(coverageResult: CoverageResult) {
  const selection = selectCoverageImprovements(coverageResult);
  return selection.missingScenarios.length + selection.recommendations.length;
}

export function buildCoverageImprovementBatches(
  coverageResult: CoverageResult,
  options: CoverageImprovementSelectionOptions = {},
  batchSize = DEFAULT_COVERAGE_IMPROVEMENT_BATCH_SIZE
): CoverageImprovementBatch[] {
  const selection = selectCoverageImprovements(coverageResult, options);
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize));
  const requests = [
    ...selection.focusMissingScenarios.map((value) => ({ kind: 'scenario' as const, value })),
    ...selection.focusRecommendations.map((value) => ({ kind: 'recommendation' as const, value })),
  ];
  const batches: CoverageImprovementBatch[] = [];

  for (let index = 0; index < requests.length; index += normalizedBatchSize) {
    const batchRequests = requests.slice(index, index + normalizedBatchSize);
    batches.push({
      focusMissingScenarios: batchRequests
        .filter((request) => request.kind === 'scenario')
        .map((request) => request.value),
      focusRecommendations: batchRequests
        .filter((request) => request.kind === 'recommendation')
        .map((request) => request.value),
    });
  }

  return batches;
}
