export type GenerationMode = 'rob_style' | 'yuv_style' | 'swag_style' | 'professional_standard';

export interface GenerationModeProfile {
  label: string;
  generatorPromptLines: string[];
  reviewerLines: string[];
  reviewThreshold: number;
  correctionReminder: string;
  analysisPromptLines: string[];
  auditPromptLines: string[];
  mergePromptLines: string[];
  coveragePromptLines: string[];
  planningPromptLines: string[];
  traceabilityPromptLines: string[];
  testDataPromptLines: string[];
  scenarioPromptLines: string[];
  clarificationPromptLines: string[];
}

export const DEFAULT_GENERATION_MODE: GenerationMode = 'rob_style';

export const GENERATION_MODE_PROFILES: Record<GenerationMode, GenerationModeProfile> = {
  rob_style: {
    label: 'Rob',
    generatorPromptLines: [
      'Keep the suite aligned with Rob-style manual QA writing: clean, permission-aware, actor-based, and easy to review.',
      'Strongly prefer actor-based testcase titles such as "Verify that the user..." whenever that matches the requirement actor.',
      'Keep authority names exact and visible when permissions drive the scenario.',
      'Write expected results as short, direct, observable outcomes instead of padded prose.',
      'When permissions matter, explicitly separate with-permission, without-permission, wrong-permission, action-visibility, and action-execution scenarios when they represent different risks.',
      'When exports, emails, notifications, or other user-visible side effects are part of the flow, keep trigger conditions and visible outcomes explicit instead of implied.',
      'When onboarding, account setup, or configuration screens are involved, keep step-by-step role-aware coverage practical and easy to execute.',
      'Use clean module/page names when the feature clearly refers to a specific page, screen, popup, list, or details view.',
      'Keep enterprise fields present, but make them concise, practical, and easy for a working QA team to use.',
      'Do not compress distinct useful QA checks just to make the output shorter; prefer complete, practical coverage.',
    ],
    reviewerLines: [
      'Preserve Rob-style actor-based QA wording, especially clear permission-aware testcase titles.',
      'Flag cases that sound robotic, vague, or less precise than a clean senior manual-QA workbook.',
      'Approve only if the suite feels like strong senior-QA work while still sounding natural and crisp.',
      'Do not over-filter meaningful boundary, validation, navigation, or persistence checks when they add real coverage.',
    ],
    reviewThreshold: 84,
    correctionReminder: 'Keep the suite in a Rob-style QA voice while fixing coverage, naming, and quality gaps with clearer permission-aware titles and sharper expected results.',
    analysisPromptLines: [
      'Keep explanations simple, practical, and close to a clean senior QA workbook style.',
      'Prefer plain tester language over formal enterprise phrasing.',
      'Call out role-specific outcomes, notifications, exports, and user-visible side effects when they matter to testing.',
      'When suggesting testcase starters or testing ideas, keep them human, permission-aware, and browser-focused.',
    ],
    auditPromptLines: [
      'When adding missing cases, keep the new cases aligned with Rob-style manual QA wording.',
      'Prefer actor-based testcase naming that sounds natural to experienced browser testers.',
      'Make permission or authority distinctions explicit when they are part of the real behavior.',
      'Keep expected results short, direct, and immediately observable.',
      'Keep email, export, notification, and downstream-reflection outcomes explicit when they are part of the real flow.',
      'Prefer complete gap coverage over compressed minimalist additions when the requirement clearly supports more detail.',
    ],
    mergePromptLines: [
      'Preserve the clean tester voice of strong rows instead of over-formalizing everything.',
      'When merging duplicates, keep the final testcase wording practical, human, and permission-aware.',
      'Preserve distinct coverage and do not merge away meaningful variations just for neatness.',
    ],
    coveragePromptLines: [
      'Explain coverage gaps in plain tester-friendly English.',
      'Recommendations should sound practical and actionable, not overly formal.',
      'Treat missing meaningful detail as a real gap instead of assuming a shorter suite is automatically stronger.',
    ],
    planningPromptLines: [
      'Keep the test plan practical, browser-testing focused, and easy for a working QA team to execute.',
      'Prefer realistic scope, assumptions, risks, and deliverables over boilerplate template wording.',
      'Write planning notes the way a senior QA would hand them to another tester: clear, direct, and usable.',
      'Favor complete, useful planning detail over polished but shallow summaries.',
    ],
    traceabilityPromptLines: [
      'Make the matrix easy to read by a manual QA team and keep coverage notes practical and direct.',
      'When coverage is missing, explain the gap in natural tester language.',
      'Call out missing role-based outcomes, settings combinations, and user-visible side effects when they are part of the requirement.',
    ],
    testDataPromptLines: [
      'Suggest realistic, usable test data that a manual tester would actually prepare.',
      'Balance valid, invalid, and edge data without turning it into artificial filler.',
      'Call out permission-specific or status-specific data sets when they matter to execution.',
    ],
    scenarioPromptLines: [
      'Map flows the way an experienced manual tester would think through the feature: primary, alternate, negative, and edge.',
      'Keep the scenario map concrete and easy to turn into testcases later.',
      'Do not collapse meaningful alternate or edge flows into generic umbrella statements.',
    ],
    clarificationPromptLines: [
      'Ask practical QA clarification questions in plain English.',
      'Surface ambiguity the way an experienced tester would before execution starts.',
      'Prefer complete, risk-relevant clarification over a shorter but incomplete question set.',
    ],
  },
  yuv_style: {
    label: 'Yuv',
    generatorPromptLines: [
      'Keep the suite aligned with Yuv-style QA thinking: broad, practical, module-aware, and coverage-rich.',
      'Cover module/page behavior, UI states, navigation, list behavior, sorting, filters, and downstream reflection when they are relevant.',
      'When the feature is list- or grid-oriented, explicitly cover default sort, reverse sort, filters/search, empty state, row click navigation, column behavior, and downstream detail-page reflection where relevant.',
      'When account setup, onboarding, settings, customer, supplier, buyer, or reseller flows are involved, keep actor-specific page behavior and downstream reflection explicit.',
      'When exports, notifications, email delivery, API-triggered changes, or background side effects are visible to the user or business flow, cover them as separate meaningful scenarios.',
      'Keep testcase titles professional and actor-based, but optimize more for complete functional coverage than for title polish alone.',
      'Separate positive, negative, edge, navigation, and UI-behavior scenarios when they represent different user risks.',
      'Do not compress useful coverage just to make the output shorter; prefer better and more complete test cases.',
    ],
    reviewerLines: [
      'Preserve Yuv-style breadth: module/page behavior, practical UI checks, and fuller scenario separation.',
      'Flag suites that miss list behavior, navigation, sorting, filtering, page/module context, or realistic negative paths.',
      'Approve only if the suite feels like a strong senior QA explored the feature end to end, not just the main AC bullets.',
      'Reject over-compressed artifacts that merge distinct user risks into a few generic cases.',
    ],
    reviewThreshold: 86,
    correctionReminder: 'Raise the suite to a Yuv-style QA standard with broader module-aware coverage, stronger UI/list/navigation coverage, and fuller positive/negative/edge separation.',
    analysisPromptLines: [
      'Keep the analysis practical and feature-oriented, with strong attention to modules, pages, states, and user-visible behavior.',
      'Highlight coverage implications around navigation, UI behavior, and downstream list/detail views when relevant.',
      'Surface settings, onboarding, multi-actor, export, and notification side-effect implications when the requirement supports them.',
      'Prefer concrete tester observations over abstract enterprise wording.',
    ],
    auditPromptLines: [
      'When adding missing cases, widen the coverage the way a senior QA would: module behavior, UI states, navigation, and practical negatives.',
      'Preserve distinct page/list/detail/table/sort/filter scenarios instead of merging them away.',
      'When list behavior is relevant, add the missing sort, filter, search, empty-state, row-click, and downstream-reflection cases instead of summarizing them broadly.',
      'When onboarding, settings, notifications, exports, or multi-actor flows are relevant, keep those scenario clusters separate instead of hiding them in generic rows.',
      'Prefer complete gap coverage over compressed minimalist additions.',
    ],
    mergePromptLines: [
      'Preserve meaningful scenario breadth when merging and keep module/page context clear.',
      'Do not merge away useful UI, sorting, navigation, table, or state-based differences just for neatness.',
      'Keep the final wording practical and immediately usable for execution.',
    ],
    coveragePromptLines: [
      'Explain coverage gaps in a practical QA voice with clear references to missing UI states, navigation paths, or module behavior.',
      'Treat missing page/list/detail behavior, state transitions, and edge conditions as real coverage gaps when supported by the requirement.',
      'Treat missing notifications, emails, exports, onboarding steps, and actor-specific outcomes as real gaps when supported by the requirement.',
      'Prefer fuller, execution-ready recommendations over minimalist summaries.',
    ],
    planningPromptLines: [
      'Keep the plan practical and execution-focused, with attention to modules, pages, states, and realistic user flows.',
      'Prefer realistic scope, assumptions, risks, and deliverables over boilerplate wording.',
      'Call out multi-actor coordination, settings dependencies, and side effects such as export, email, and downstream reflection when they matter.',
      'Favor complete, useful planning detail over polished but shallow summaries.',
    ],
    traceabilityPromptLines: [
      'Make the matrix easy to read by a QA team and keep coverage notes tied to concrete module/page behavior.',
      'Highlight where navigation, list behavior, state changes, or UI interactions are only partially covered.',
    ],
    testDataPromptLines: [
      'Suggest realistic, usable test data that supports positive, negative, edge, and state-based coverage.',
      'Include data combinations that help exercise list views, sorting, filtering, statuses, and downstream reflection when relevant.',
    ],
    scenarioPromptLines: [
      'Map flows the way an experienced manual tester would think through the feature: primary, alternate, negative, edge, and UI/state-driven flows.',
      'Keep the scenario map concrete and easy to turn into fuller testcases later.',
      'Do not collapse meaningful alternate, UI, state, or edge flows into generic umbrella statements.',
    ],
    clarificationPromptLines: [
      'Ask practical QA clarification questions in plain English.',
      'Surface ambiguity around modules, pages, state behavior, navigation, sorting/filtering, and downstream visibility before execution starts.',
      'Prefer complete, risk-relevant clarification over a shorter but incomplete question set.',
    ],
  },
  swag_style: {
    label: 'SWAG',
    generatorPromptLines: [
      'Use the SWAG benchmark style: broad web-app QA coverage across common UI patterns, business states, and user-visible behavior.',
      'Treat forms, inputs, dropdowns, radios, checkboxes, file uploads, drag-and-drop, grids, filters, sorting, pagination, exports, refresh behavior, and persistence as reusable QA coverage patterns when relevant.',
      'Cover permission, role, tenant-setting, feature-flag, state-transition, network/API reflection, and DB/data-persistence behavior when the requirement supports them.',
      'Also cover onboarding, account setup, customer/supplier/buyer/reseller actor differences, notification/email delivery, and user-visible side effects when they are relevant.',
      'When the requirement points to accessibility, cover keyboard navigation, focus behavior, labels, and accessible error or dialog behavior explicitly.',
      'When the requirement points to mobile or responsive behavior, cover desktop/tablet/mobile differences, truncation/overflow, and touch behavior explicitly.',
      'When the requirement points to concurrency, volume, or environment compatibility, cover multi-user conflicts, duplicate-submit protection, performance/loading behavior, and browser-specific differences explicitly.',
      'When export, API/network, or background actions are part of the requirement, keep both trigger behavior and reflected user/business outcomes explicit.',
      'Keep testcase titles professional and actor-based, but prioritize complete benchmark-worthy coverage over minimal output.',
      'Professional-quality benchmark mode means better and more complete test cases, not fewer ones.',
    ],
    reviewerLines: [
      'Review the suite against broad web-app QA benchmark expectations, not just explicit AC bullets.',
      'Flag missing UI pattern coverage such as sort/filter/search/list behavior, form validation, upload/download, state persistence, redirects, and side effects when the requirement supports them.',
      'Flag missing onboarding, settings, notification/email, export, API/network-reflection, and multi-actor coverage when the requirement supports them.',
      'Flag missing accessibility, responsive/mobile, concurrency, performance/large-data, deeper API/DB, or browser-compatibility coverage when the requirement supports them.',
      'Approve only if the suite feels benchmark-worthy for a modern web app and does not over-compress useful cases.',
      'Reject suites that miss realistic permission, state, navigation, persistence, or user-message coverage.',
    ],
    reviewThreshold: 88,
    correctionReminder: 'Raise the artifact to SWAG benchmark quality with complete web-app QA coverage, explicit state/permission handling, and practical execution-ready detail.',
    analysisPromptLines: [
      'Analyze the requirement with a broad web-app QA benchmark mindset.',
      'Surface reusable UI, state, permission, navigation, and persistence patterns when they are relevant.',
      'Surface onboarding, account setup, notification/email, export, API/network-reflection, and multi-actor patterns when they are relevant.',
      'Also surface accessibility, responsive/mobile, concurrency, performance/large-data, deeper API/DB, and cross-browser patterns when they are relevant.',
      'Prefer practical benchmark-style tester observations over shallow summaries.',
    ],
    auditPromptLines: [
      'When adding missing cases, fill benchmark-worthy gaps across web-app patterns such as forms, grids, filters, uploads, exports, state transitions, and persistence.',
      'Also fill missing benchmark-worthy gaps around onboarding, settings, notifications, emails, network/API reflection, and multi-actor flows when they are relevant.',
      'Also fill missing benchmark-worthy gaps around accessibility, responsive/mobile behavior, concurrency, performance/volume, browser compatibility, and deeper API/DB verification when they are relevant.',
      'Preserve distinct scenario clusters instead of merging them into broad umbrella rows.',
      'Prefer complete benchmark coverage over minimalist additions.',
    ],
    mergePromptLines: [
      'Preserve meaningful benchmark-level coverage when merging and do not merge away distinct UI, state, permission, or persistence risks.',
      'Keep the final wording practical, professional, and execution-ready.',
    ],
    coveragePromptLines: [
      'Judge coverage against common web-app QA benchmark expectations when the requirement supports them.',
      'Treat missing form validation, list behavior, upload/download behavior, redirect behavior, settings combinations, and persistence as real gaps when relevant.',
      'Treat missing notifications, emails, export/network reflection, onboarding/account setup, and actor-specific outcomes as real gaps when relevant.',
      'Treat missing accessibility, responsive/mobile, concurrency, performance/loading, deeper API/DB, and browser-compatibility coverage as real gaps when relevant.',
      'Prefer fuller benchmark-minded recommendations over overly short summaries.',
    ],
    planningPromptLines: [
      'Make planning artifacts reflect benchmark-quality modern web-app QA coverage.',
      'Highlight reusable UI, state, role, navigation, data, and persistence risks clearly.',
      'Include onboarding, settings, notification/email, export/network, and multi-actor risks when they matter.',
      'Also include accessibility, responsive/mobile, concurrency, performance/volume, API/DB, and browser-compatibility risks when they matter.',
      'Favor complete and practical planning detail over boilerplate.',
    ],
    traceabilityPromptLines: [
      'Keep traceability tied to explicit requirement points plus clear benchmark-worthy coverage areas such as forms, grids, settings, and persistence.',
      'Include actor-specific flows and side effects like notifications, exports, or reflected data updates when they matter.',
      'Include accessibility, responsive/mobile, concurrency, performance/loading, API/DB, and browser-compatibility obligations when they matter.',
      'Highlight where key web-app behaviors are only partially covered.',
    ],
    testDataPromptLines: [
      'Suggest data combinations that support benchmark-style coverage: valid/invalid/boundary, role-based, status-based, search/filter, upload/export, and persistence checks.',
      'Include realistic datasets for customer/supplier/buyer/reseller actors, settings combinations, and notification/export side effects when relevant.',
      'Include realistic datasets for large-volume records, conflict scenarios, and API/DB state verification when relevant.',
      'Keep the data realistic and execution-ready.',
    ],
    scenarioPromptLines: [
      'Map scenarios with a strong web-app QA benchmark mindset: primary, alternate, negative, edge, state, permission, navigation, persistence, and side-effect flows.',
      'Include onboarding/setup and multi-actor interaction flows when the requirement supports them.',
      'Include accessibility, responsive/mobile, concurrency, performance/loading, API/DB, and browser-compatibility flows when the requirement supports them.',
      'Do not collapse meaningful UI or workflow variations into generic umbrella statements.',
    ],
    clarificationPromptLines: [
      'Ask benchmark-minded QA clarification questions in plain English.',
      'Surface ambiguity around forms, grids, state transitions, settings, permissions, uploads/downloads, redirects, and persistence before execution starts.',
      'Also surface ambiguity around onboarding, account setup, notifications/emails, exports, API/network reflection, and actor-specific outcomes when relevant.',
      'Also surface ambiguity around accessibility obligations, mobile/responsive support, browser coverage, concurrency rules, performance expectations, and API/DB verification when relevant.',
      'Prefer complete, risk-relevant clarification over a shorter but incomplete question set.',
    ],
  },
  professional_standard: {
    label: 'Professional Standard',
    generatorPromptLines: [
      'Optimize for enterprise-standard QA documentation and formal review readiness.',
      'Maintain strong traceability from requirement points to testcase rows.',
      'Make module, priority, test data, and post-condition fields meaningfully useful for project teams.',
      'Keep wording professional, concise, and audit-ready while still using actor-based titles when appropriate.',
      'Use clean module/page naming and keep expected results direct, observable, and reviewer-friendly.',
      'When permissions or list/grid behavior are central to the feature, cover them with explicit, distinct cases rather than generic umbrella rows.',
      'When settings, onboarding, notifications, exports, or multi-actor outcomes are central to the feature, cover them with explicit, distinct cases rather than generic umbrella rows.',
      'Prefer risk-based, stakeholder-ready artifacts over generic checklist filler.',
      'Professional standard does not mean fewer rows; prefer complete, useful, review-worthy coverage over over-compressed output.',
    ],
    reviewerLines: [
      'Be strict about traceability, coverage completeness, and enterprise field quality.',
      'Flag weak prioritization, vague test data, or missing post-conditions.',
      'Approve only if the suite reads like a formally reviewable senior-QA deliverable.',
      'Reject artifacts that feel generic, boilerplate-heavy, or weak on risk and business impact.',
      'Reject over-compressed artifacts that remove meaningful validation, boundary, navigation, or risk coverage.',
    ],
    reviewThreshold: 90,
    correctionReminder: 'Raise the suite to a formal professional QA standard with stronger traceability, cleaner prioritization, and more audit-ready wording.',
    analysisPromptLines: [
      'Use cleaner enterprise-style summaries and more formal QA language where helpful.',
      'Emphasize traceability, risk, and review-ready clarity in the analysis.',
      'Keep recommendations concise, structured, and suitable for professional QA documentation.',
      'Call out ambiguity, risk, and coverage implications the way a senior QA reviewer would.',
    ],
    auditPromptLines: [
      'Make new gap-filling cases look formally reviewable and traceable to requirement points.',
      'Prioritize strong module assignment, priority, and enterprise field quality.',
      'Prefer risk-first gap filling rather than broad but shallow padding.',
      'Do not trim away meaningful missing scenarios just to keep the enhancement set shorter.',
    ],
    mergePromptLines: [
      'Normalize the final suite into a consistent, professional, enterprise-ready format.',
      'Prefer concise, formally reviewable testcase wording and stronger field standardization.',
      'Do not preserve weak rows just for quantity; preserve business coverage, not clutter.',
      'Do not merge away distinct requirement coverage just because two rows look superficially similar.',
    ],
    coveragePromptLines: [
      'Explain gaps and recommendations in a formal, review-ready QA tone.',
      'Make recommendations concise, prioritized, and enterprise-appropriate.',
      'Keep the coverage judgment honest and risk-weighted rather than optimistic.',
      'Treat missing side effects, actor-specific flows, and settings-driven behavior as real risk gaps when supported by the requirement.',
      'Treat missing meaningful QA detail as a real coverage gap; do not reward over-compressed suites.',
    ],
    planningPromptLines: [
      'Make the test plan read like a formal, enterprise-ready QA strategy artifact.',
      'Keep scope, risks, entry criteria, exit criteria, and deliverables cleanly structured and reviewable.',
      'Favor realistic execution value over template language.',
      'Keep planning artifacts complete and decision-useful, not polished but shallow.',
    ],
    traceabilityPromptLines: [
      'Structure the matrix for professional traceability and review readiness.',
      'Use concise, formal coverage notes that clearly show covered, partial, and missing areas.',
      'Highlight the requirement points that would create release risk if left partial or missing.',
    ],
    testDataPromptLines: [
      'Make the test data plan look organized, complete, and enterprise-ready.',
      'Emphasize traceability between scenarios, data categories, and why each dataset matters.',
      'Use realistic values and edge cases a working QA team would actually prepare.',
    ],
    scenarioPromptLines: [
      'Present the scenario map in a structured, professional QA planning style.',
      'Highlight regression-sensitive intersections and high-risk paths clearly.',
      'Avoid decorative filler flows; emphasize the flows that actually matter for defects and release risk.',
      'Do not over-compress distinct alternate, negative, or edge flows that matter for real QA coverage.',
    ],
    clarificationPromptLines: [
      'Phrase clarification questions in a concise, professional, stakeholder-ready style.',
      'Clearly distinguish blockers from lower-priority ambiguities.',
      'Surface the unanswered decisions most likely to cause test escapes or rework.',
      'Prefer a complete, risk-driven question set over a shorter but incomplete one.',
    ],
  },
};

export function getGenerationMode(aiSettings: unknown): GenerationMode {
  const rawSettings = aiSettings && typeof aiSettings === 'object' ? (aiSettings as Record<string, unknown>) : {};
  if (rawSettings.generationMode === 'professional_standard') return 'professional_standard';
  if (rawSettings.generationMode === 'swag_style') return 'swag_style';
  if (rawSettings.generationMode === 'yuv_style') return 'yuv_style';
  if (rawSettings.generationMode === 'rob_style' || rawSettings.generationMode === 'my_style') return 'rob_style';
  return DEFAULT_GENERATION_MODE;
}

export function isStrictRequirementMode(aiSettings: unknown): boolean {
  const rawSettings = aiSettings && typeof aiSettings === 'object' ? (aiSettings as Record<string, unknown>) : {};
  return rawSettings.strictRequirementMode === true;
}

export function getGenerationModeProfile(generationMode: GenerationMode): GenerationModeProfile {
  return GENERATION_MODE_PROFILES[generationMode] || GENERATION_MODE_PROFILES[DEFAULT_GENERATION_MODE];
}
