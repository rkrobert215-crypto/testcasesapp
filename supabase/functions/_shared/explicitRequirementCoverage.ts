export interface ExplicitRequirementMissingScenario {
  scenario: string;
  priority: 'High' | 'Medium' | 'Low';
  type: 'Positive' | 'Negative';
}

const HEADING_NAMES = new Set([
  'acceptance criteria',
  'availability',
  'availability / conditions',
  'behavior',
  'conditions',
  'evaluation',
  'permissions',
  'rule evaluation',
  'scope',
  'story',
  'supports',
  'validation rules',
  'works with',
]);

const REQUIREMENT_SIGNAL = /\b(must|shall|should|need to|needs to|only|except|ignored|ignore|defaults?|appears?|display(?:s|ed)?|creates?|updates?|preserves?|prevents?|allows?|supports?|applies?|evaluates?|clears?|deselects?|filters?|redirects?|sends?|shows?|requires?|cannot|does not|do not|if|when|after|before)\b/i;
const NEGATIVE_SIGNAL = /\b(no|not|never|cannot|must not|does not|do not|disabled|invalid|missing|malformed|unauthorized|forbidden|ignored|false|except|without|failure|fails?|duplicate)\b/i;
const BULLET_PREFIX = /^\s*(?:[-*\u2022]|\[(?: |x|X)?\]|\d+[.)])\s*/;

const COVERAGE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'for', 'from',
  'has', 'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their',
  'then', 'this', 'to', 'user', 'users', 'using', 'when', 'where', 'which', 'with',
]);

const GENERIC_TECHNICAL_ANCHORS = new Set(['api', 'db', 'id', 'qa', 'tc', 'ui']);

function cleanClause(value: string) {
  return value
    .replace(BULLET_PREFIX, '')
    .replace(/^acceptance criteria\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;]+$/, '');
}

function isHeading(value: string) {
  const normalized = value.replace(/:$/, '').trim().toLowerCase();
  return HEADING_NAMES.has(normalized) || (value.endsWith(':') && value.split(/\s+/).length <= 8);
}

function normalizeToken(token: string) {
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 6) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

function significantTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !COVERAGE_STOP_WORDS.has(token))
      .map(normalizeToken)
  );
}

function distinctiveRequirementAnchors(value: string) {
  const anchors = new Set<string>();
  const patterns = [
    /\b[A-Z][A-Z0-9_]{1,}\b/g,
    /\b[a-z]+(?:[A-Z][a-zA-Z0-9]*)+\b/g,
    /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/g,
    /\b\d+(?:\.\d+)?(?:\s*(?:milliseconds?|ms|seconds?|secs?|minutes?|mins?|hours?|days?|%))?\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const anchor = match[0].toLowerCase().replace(/\s+/g, ' ').trim();
      if (!GENERIC_TECHNICAL_ANCHORS.has(anchor)) anchors.add(anchor);
    }
  }

  for (const match of value.matchAll(/["'`]([^"'`]{2,80})["'`]/g)) {
    const anchor = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
    if (anchor.split(/\s+/).length <= 6) anchors.add(anchor);
  }

  return [...anchors];
}

function rowContainsAnchor(row: string, anchor: string) {
  const normalizedRow = row.toLowerCase().replace(/\s+/g, ' ');
  const escapedAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9_])${escapedAnchor}(?:$|[^a-z0-9_])`, 'i').test(normalizedRow);
}

function clauseIsCovered(clause: string, suiteRows: string[]) {
  const clauseTokens = significantTokens(clause);
  const requiresNegativeEvidence = NEGATIVE_SIGNAL.test(clause);
  if (clauseTokens.size === 0) return true;

  const anchors = distinctiveRequirementAnchors(clause);
  const anchorsCovered = anchors.every((anchor) =>
    suiteRows.some((row) => {
      if (!rowContainsAnchor(row, anchor)) return false;

      const rowTokens = significantTokens(row);
      let contextualOverlap = 0;
      for (const token of clauseTokens) {
        if (rowTokens.has(token)) contextualOverlap += 1;
      }
      return contextualOverlap >= Math.min(2, clauseTokens.size);
    })
  );
  if (!anchorsCovered) return false;

  return suiteRows.some((row) => {
    if (requiresNegativeEvidence && !NEGATIVE_SIGNAL.test(row)) return false;

    const rowTokens = significantTokens(row);
    let overlap = 0;
    for (const token of clauseTokens) {
      if (rowTokens.has(token)) overlap += 1;
    }

    const requiredOverlap = clauseTokens.size <= 3
      ? Math.min(2, clauseTokens.size)
      : Math.max(3, Math.ceil(clauseTokens.size * 0.5));
    return overlap >= requiredOverlap;
  });
}

export function extractExplicitRequirementClauses(input: string): string[] {
  const clauses: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of input.replaceAll('\r', '').split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('```') || isHeading(trimmed)) continue;

    const hasBullet = BULLET_PREFIX.test(trimmed);
    const candidates = hasBullet
      ? [trimmed]
      : trimmed.split(/(?<=[.!?])\s+/);

    for (const candidate of candidates) {
      const cleaned = cleanClause(candidate);
      if (cleaned.length < 8 || cleaned.length > 320) continue;
      if (!hasBullet && !REQUIREMENT_SIGNAL.test(cleaned)) continue;
      if (/^(insert into|values\s*\(|on duplicate key update)/i.test(cleaned)) continue;

      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        clauses.push(cleaned);
      }
    }
  }

  return clauses.slice(0, 40);
}

export function buildMissingExplicitRequirementScenarios(
  input: string,
  testCases: unknown[]
): ExplicitRequirementMissingScenario[] {
  const suiteRows = testCases.map((testCase) => JSON.stringify(testCase));

  return extractExplicitRequirementClauses(input)
    .filter((clause) => !clauseIsCovered(clause, suiteRows))
    .map((clause) => ({
      scenario: `Verify this explicit requirement point with complete steps and observable results: ${clause}`,
      priority: NEGATIVE_SIGNAL.test(clause) ? 'High' : 'Medium',
      type: NEGATIVE_SIGNAL.test(clause) ? 'Negative' : 'Positive',
    }));
}
