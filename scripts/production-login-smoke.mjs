const baseUrl = (process.env.SMOKE_BASE_URL || 'https://testcasesapp.vercel.app').replace(/\/+$/, '');
const hostedAccessToken = (process.env.HOSTED_AI_ACCESS_TOKEN || '').trim();
const lambdaProxyToken = (process.env.LAMBDA_PROXY_TOKEN || '').trim();

if (!hostedAccessToken && !lambdaProxyToken) {
  throw new Error('Set HOSTED_AI_ACCESS_TOKEN for Vercel or LAMBDA_PROXY_TOKEN for the protected Lambda.');
}

const requirement = `
Story
As a registered user, I want to log in so that I can access my account securely.

Acceptance Criteria
- The login form provides required email and password fields.
- The system validates credentials and shows a generic error for invalid credentials.
- Successful login redirects the user to the dashboard.
- A Forgot password link is available from the login page.
- The account locks after 5 consecutive failed login attempts.
- The authenticated session expires after 30 minutes of inactivity.
`;

const aiSettings = {
  provider: 'claude_cli',
  generationMode: 'rob_style',
  strictRequirementMode: true,
  claudeCliModel: 'sonnet',
  ...(hostedAccessToken ? { hostedAccessToken } : {}),
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function postFunction(functionName, body, { maxRetries = 2, timeoutMs = 290_000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/api/functions/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(lambdaProxyToken ? { 'X-Testcase-Proxy-Token': lambdaProxyToken } : {}),
      },
      body: JSON.stringify({ ...body, aiSettings }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const elapsedMs = Date.now() - startedAt;
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || 'Non-JSON response' };
    }

    if (response.ok && !payload.error) {
      return { payload, elapsedMs };
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxRetries || elapsedMs >= 45_000) {
      throw new Error(`${functionName} failed (${response.status}): ${payload.error || 'Unknown error'}`);
    }
    await wait(Math.min(1500 * (2 ** attempt), 10_000));
  }

  throw new Error(`${functionName} exhausted its retry budget.`);
}

function isTestableRecommendation(value) {
  return typeof value === 'string' && value.trim() && !/^\s*(?:clarification|process)\s*:/i.test(value);
}

function normalizedTitle(testCase) {
  return String(testCase.testCase || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const generation = await postFunction('generate-test-cases', {
  input: requirement,
  inputType: 'requirement',
  imagesBase64: [],
});
const initialSuite = Array.isArray(generation.payload.testCases) ? generation.payload.testCases : [];
if (initialSuite.length === 0) {
  throw new Error('Production generation returned no testcases.');
}

const initialCoverageCall = await postFunction('validate-coverage', {
  input: requirement,
  inputType: 'requirement',
  testCases: initialSuite,
  deterministicOnly: true,
}, { maxRetries: 1, timeoutMs: 60_000 });
const initialCoverage = initialCoverageCall.payload;
const focusedScenarios = (initialCoverage.missingScenarios || []).map((item) => item.scenario);
const focusedRecommendations = (initialCoverage.recommendations || []).filter(isTestableRecommendation);

let additions = [];
let repairElapsedMs = 0;
if (focusedScenarios.length > 0 || focusedRecommendations.length > 0) {
  const repair = await postFunction('audit-test-cases', {
    requirement,
    existingTestCases: initialSuite,
    focusMissingScenarios: focusedScenarios,
    focusRecommendations: focusedRecommendations,
  });
  repairElapsedMs = repair.elapsedMs;
  additions = Array.isArray(repair.payload.testCases) ? repair.payload.testCases : [];
}

const existingTitles = new Set(initialSuite.map(normalizedTitle));
const uniqueAdditions = additions.filter((testCase) => {
  const title = normalizedTitle(testCase);
  if (!title || existingTitles.has(title)) return false;
  existingTitles.add(title);
  return true;
});
const finalSuite = [...initialSuite, ...uniqueAdditions];
const finalCoverageCall = await postFunction('validate-coverage', {
  input: requirement,
  inputType: 'requirement',
  testCases: finalSuite,
  deterministicOnly: true,
}, { maxRetries: 1, timeoutMs: 60_000 });
const finalCoverage = finalCoverageCall.payload;

const requiredFields = [
  'id',
  'requirementReference',
  'module',
  'priority',
  'coverageArea',
  'scenario',
  'testCase',
  'testData',
  'preconditions',
  'testSteps',
  'expectedResult',
  'postCondition',
  'type',
];
const incompleteRows = finalSuite
  .map((testCase, index) => ({
    index: index + 1,
    missing: requiredFields.filter((field) => !String(testCase[field] || '').trim()),
  }))
  .filter((row) => row.missing.length > 0);
const duplicateGroups = Object.entries(
  finalSuite.reduce((groups, testCase) => {
    const key = normalizedTitle(testCase);
    groups[key] = (groups[key] || 0) + 1;
    return groups;
  }, {})
).filter(([, count]) => count > 1);
const weakRows = finalSuite.filter((testCase) =>
  String(testCase.testSteps || '').split('\n').filter(Boolean).length < 2 ||
  String(testCase.expectedResult || '').trim().length < 25
);
const titleStyleFailures = finalSuite.filter((testCase) =>
  !/^verify that\b/i.test(String(testCase.testCase || '').trim())
);
const suiteText = JSON.stringify(finalSuite).toLowerCase();
const expectedSignals = [
  ['required email', ['required email', 'email is required', 'empty email']],
  ['required password', ['required password', 'password is required', 'empty password', 'password field empty', 'required email and password']],
  ['invalid credentials', ['invalid credentials', 'incorrect credentials']],
  ['dashboard redirect', ['dashboard', 'redirect']],
  ['Forgot password', ['forgot password']],
  ['5 failed attempts', ['5 consecutive', '5 failed', 'fifth failed']],
  ['30-minute inactivity', ['30 minutes', '30-minute']],
];
const missingSignals = expectedSignals
  .filter(([, alternatives]) => !alternatives.some((value) => suiteText.includes(value)))
  .map(([label]) => label);

const report = {
  productionTarget: lambdaProxyToken ? 'Protected Claude Lambda' : baseUrl,
  generationSeconds: Math.round(generation.elapsedMs / 100) / 10,
  generationWasCached: generation.payload.cached === true,
  fastInitialCoverageSeconds: Math.round(initialCoverageCall.elapsedMs / 100) / 10,
  repairNeeded: focusedScenarios.length + focusedRecommendations.length > 0,
  repairSeconds: Math.round(repairElapsedMs / 100) / 10,
  initialCount: initialSuite.length,
  addedCount: uniqueAdditions.length,
  finalCount: finalSuite.length,
  initialCoverageScore: initialCoverage.coverageScore,
  finalCoverageScore: finalCoverage.coverageScore,
  remainingGaps: finalCoverage.missingScenarios || [],
  remainingRecommendations: finalCoverage.recommendations || [],
  positiveCount: finalSuite.filter((testCase) => testCase.type === 'Positive').length,
  negativeCount: finalSuite.filter((testCase) => testCase.type === 'Negative').length,
  incompleteRows,
  duplicateTitles: duplicateGroups,
  weakRowCount: weakRows.length,
  nonVerifyThatTitles: titleStyleFailures.map((testCase) => testCase.testCase),
  missingAcceptanceSignals: missingSignals,
  testcaseTitles: finalSuite.map((testCase, index) => `${index + 1}. ${testCase.testCase}`),
};

console.log(JSON.stringify(report, null, 2));

if (
  finalSuite.length < 15 ||
  (finalCoverage.missingScenarios || []).length > 0 ||
  focusedRecommendations.length > 0 && uniqueAdditions.length === 0 ||
  incompleteRows.length > 0 ||
  duplicateGroups.length > 0 ||
  weakRows.length > 0 ||
  missingSignals.length > 0
) {
  process.exitCode = 1;
}
