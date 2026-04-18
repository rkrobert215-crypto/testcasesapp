import { generateStructuredData } from './aiClient.ts';
import { isStrictRequirementMode } from './generationMode.ts';

type JsonSchema = Record<string, unknown>;

type AiPromptPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      dataUrl: string;
    };

interface StructuredOutputDefinition {
  name: string;
  description: string;
  schema: JsonSchema;
}

interface ReviewedStructuredGenerationOptions<T> {
  aiSettings: unknown;
  featureName: string;
  artifactLabel: string;
  systemPrompt: string;
  userParts: AiPromptPart[];
  output: StructuredOutputDefinition;
  reviewThreshold?: number;
  reviewFocusLines?: string[];
  correctionReminder?: string;
}

interface ArtifactReviewResult {
  overallScore: number;
  decision: 'approve' | 'revise';
  strengths: string[];
  criticalGaps: string[];
  revisionInstructions: string[];
}

const artifactReviewSchema = {
  type: 'object',
  properties: {
    overallScore: { type: 'number' },
    decision: { type: 'string', enum: ['approve', 'revise'] },
    strengths: {
      type: 'array',
      items: { type: 'string' },
    },
    criticalGaps: {
      type: 'array',
      items: { type: 'string' },
    },
    revisionInstructions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['overallScore', 'decision', 'strengths', 'criticalGaps', 'revisionInstructions'],
  additionalProperties: false,
} as const;

export async function generateReviewedStructuredData<T>({
  aiSettings,
  featureName,
  artifactLabel,
  systemPrompt,
  userParts,
  output,
  reviewThreshold = 86,
  reviewFocusLines = [],
  correctionReminder = 'Raise the artifact to a senior-QA, enterprise-ready standard without changing the requirement scope.',
}: ReviewedStructuredGenerationOptions<T>): Promise<T> {
  const strictRequirementMode = isStrictRequirementMode(aiSettings);
  const firstDraft = await generateStructuredData<T>({
    aiSettings,
    featureName,
    systemPrompt,
    userParts,
    output,
  });

  const draftJson = JSON.stringify(firstDraft, null, 2);

  let review: ArtifactReviewResult;
  try {
    review = await generateStructuredData<ArtifactReviewResult>({
      aiSettings,
      featureName: `${featureName}-quality-review`,
      systemPrompt: [
        'You are a principal QA reviewer in 2026 auditing a generated QA artifact.',
        '',
        `Review the candidate ${artifactLabel} against the original requirement/context and decide whether it is strong enough for a 10+ year senior QA standard.`,
        `Minimum approval score: ${reviewThreshold}. If the artifact is below that score, you must return "revise".`,
        '',
        'Evaluate for:',
        '- traceability to the requirement',
        '- preservation of exact named labels, config keys, logic terms, and fixed behaviors from the requirement when they matter',
        '- realism and practical QA usefulness',
        '- coverage of high-risk and high-priority areas',
        '- professional wording and review readiness',
        '- absence of vague filler or generic boilerplate',
        '- absence of invented configuration-management UI, setup workflow, or modal behavior that is not stated in the requirement',
        ...(strictRequirementMode
          ? [
              '- strict exact-requirement fidelity when the source contains exact labels, config keys, rule names, or fixed behavior terms',
              '- rejection of placeholder examples that replace exact requirement terms with generic substitute values',
            ]
          : []),
        ...reviewFocusLines.map((line) => `- ${line}`),
        '',
        'Choose "revise" if the artifact has meaningful gaps, weak wording, weak prioritization, missing risk focus, or poor stakeholder usefulness.',
        'Be strict but practical.',
      ].join('\n'),
      userParts: [
        ...userParts,
        {
          type: 'text',
          text: [
            `Candidate ${artifactLabel} JSON:`,
            draftJson,
          ].join('\n'),
        },
      ],
      output: {
        name: 'return_artifact_review',
        description: 'Return a strict quality review of the generated QA artifact.',
        schema: artifactReviewSchema as unknown as JsonSchema,
      },
    });
  } catch (error) {
    console.warn(`[${featureName}] artifact review failed, returning first draft:`, error);
    return firstDraft;
  }

  const needsRevision =
    review.decision === 'revise' ||
    review.overallScore < reviewThreshold ||
    review.criticalGaps.length > 0;

  if (!needsRevision) {
    return firstDraft;
  }

  try {
    return await generateStructuredData<T>({
      aiSettings,
      featureName: `${featureName}-quality-correction`,
      systemPrompt: [
        systemPrompt,
        '',
        'QUALITY CORRECTION PASS:',
        `Revise the ${artifactLabel} so it meets a senior-QA, enterprise-ready standard.`,
        correctionReminder,
        'Fix every review issue while staying inside the original requirement scope.',
        'Preserve exact named labels, config keys, logic terms, and fixed behaviors from the requirement when they matter.',
        'Do not invent admin/configuration screens, modals, or setup workflows unless the requirement explicitly includes them.',
        ...(strictRequirementMode
          ? [
              'Strict exact requirement mode is enabled, so keep the corrected artifact tightly aligned to the source wording and fixed logic terms.',
              'Do not replace exact requirement terms with generic examples or substitute values.',
            ]
          : []),
        'Return only the corrected final artifact.',
      ].join('\n'),
      userParts: [
        ...userParts,
        {
          type: 'text',
          text: [
            `First draft ${artifactLabel} JSON:`,
            draftJson,
            '',
            `Quality review result:`,
            `- Overall score: ${review.overallScore}`,
            `- Decision: ${review.decision}`,
            `- Strengths: ${review.strengths.join(' | ') || 'None listed'}`,
            `- Critical gaps: ${review.criticalGaps.join(' | ') || 'None listed'}`,
            `- Revision instructions: ${review.revisionInstructions.join(' | ') || 'None listed'}`,
          ].join('\n'),
        },
      ],
      output,
    });
  } catch (error) {
    console.warn(`[${featureName}] artifact correction failed, returning first draft:`, error);
    return firstDraft;
  }
}
