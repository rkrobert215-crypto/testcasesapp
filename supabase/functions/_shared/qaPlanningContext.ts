import type { RequirementAnalysisResult } from './requirementAnalysis.ts';

export function formatRequirementInsights(insights: RequirementAnalysisResult | null): string {
  if (!insights) {
    return 'No structured requirement analysis available.';
  }

  const requirementPoints = insights.acceptanceCriteria
    .map(
      (point) =>
        `${point.id} [${point.sourceType}] [${point.priority}] [${point.moduleHint}] ${point.criterion}\nMeaning: ${point.plainEnglishMeaning}\nWhat to test: ${point.whatToTest.join(' | ')}\nHow to test: ${point.howToTest.join(' | ')}`
    )
    .join('\n\n');

  return [
    `Requirement intelligence:`,
    `- Functionality explanation: ${insights.functionalityExplanation}`,
    `- Simple summary: ${insights.simpleSummary}`,
    `- Primary actor: ${insights.primaryActor}`,
    `- Primary action: ${insights.primaryAction}`,
    `- Recommended starter: ${insights.recommendedStarter}`,
    `- Business modules: ${insights.businessModules.join(', ') || 'General'}`,
    `- Main flow: ${insights.mainFlow.join(' -> ')}`,
    `- Risk hotspots: ${insights.riskHotspots.join(' | ') || 'None identified'}`,
    `- Important notes: ${insights.importantNotes.join(' | ') || 'None'}`,
    '',
    `Requirement points:`,
    requirementPoints || 'No structured requirement points available.',
  ].join('\n');
}
