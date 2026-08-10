import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMissingExplicitRequirementScenarios,
  extractExplicitRequirementClauses,
} from '../supabase/functions/_shared/explicitRequirementCoverage.ts';

const FILTER_REQUIREMENT = `
Story
Provide configurable grouping-based filters on the Sales Order list page.

Acceptance Criteria
- ALL appears first when one or more configured filters exist.
- If no filters are configured, no filter pills are shown and the full list is displayed.
- Selecting multiple non-ALL filters combines matching orders with OR behavior.
- Selecting ALL clears every other selected filter and displays all orders.
- A group named in orderListGroupsToInclude but absent from orderListGroups is ignored.
- A rule whose attribute is missing from the order evaluates to false.
- An order matching multiple selected filters appears only once with no duplicate result.
`;

test('explicit requirement extraction is domain-agnostic and ignores section headings', () => {
  const clauses = extractExplicitRequirementClauses(FILTER_REQUIREMENT);

  assert.equal(clauses.length, 8);
  assert.ok(clauses.some((clause) => /configurable grouping-based filters/i.test(clause)));
  assert.ok(clauses.some((clause) => /OR behavior/i.test(clause)));
  assert.ok(!clauses.some((clause) => clause === 'Story' || clause === 'Acceptance Criteria'));
});

test('explicit requirement backstop finds weak list, filter, validation, and deduplication coverage', () => {
  const weakSuite = [
    {
      testCase: 'Verify that configured grouping filters appear on the Sales Order list page',
      expectedResult: 'The configured grouping filter pills are displayed.',
    },
  ];
  const missing = buildMissingExplicitRequirementScenarios(FILTER_REQUIREMENT, weakSuite);
  const text = missing.map((item) => item.scenario).join('\n');

  assert.match(text, /no filters are configured/i);
  assert.match(text, /OR behavior/i);
  assert.match(text, /Selecting ALL clears/i);
  assert.match(text, /absent from orderListGroups/i);
  assert.match(text, /attribute is missing/i);
  assert.match(text, /no duplicate result/i);
});

test('explicit requirement backstop accepts complete coverage without adding filler', () => {
  const strongSuite = extractExplicitRequirementClauses(FILTER_REQUIREMENT).map((clause, index) => ({
    id: `TC_${index + 1}`,
    testCase: `Verify that ${clause}`,
    expectedResult: clause,
  }));

  assert.deepEqual(buildMissingExplicitRequirementScenarios(FILTER_REQUIREMENT, strongSuite), []);
});

test('explicit requirement extraction handles prose requirements without bullet formatting', () => {
  const prose = 'Password must contain at least eight characters. Email must use a valid format. The system sends a verification email after registration.';
  const clauses = extractExplicitRequirementClauses(prose);

  assert.deepEqual(clauses, [
    'Password must contain at least eight characters',
    'Email must use a valid format',
    'The system sends a verification email after registration',
  ]);
});

test('explicit requirement backstop requires every exact status anchor across the suite', () => {
  const requirement = 'After an order status transitions to SHIPPED/INVOICED, a POE row must be created.';
  const shippedOnly = [{
    testCase: 'Verify that a POE row is created after an order status transitions to SHIPPED',
    expectedResult: 'The POE row is created for the SHIPPED transition.',
  }];
  const bothStatuses = [
    ...shippedOnly,
    {
      testCase: 'Verify that a POE row is created after an order status transitions to INVOICED',
      expectedResult: 'The POE row is created for the INVOICED transition.',
    },
  ];

  assert.equal(buildMissingExplicitRequirementScenarios(requirement, shippedOnly).length, 1);
  assert.deepEqual(buildMissingExplicitRequirementScenarios(requirement, bothStatuses), []);
});

test('explicit requirement backstop preserves exact numeric boundaries', () => {
  const requirement = 'The account must lock after 5 failed login attempts.';
  const wrongBoundary = [{
    testCase: 'Verify that the account locks after repeated failed login attempts',
    expectedResult: 'The account is locked after 3 failures.',
  }];
  const exactBoundary = [{
    testCase: 'Verify that the account locks after 5 failed login attempts',
    expectedResult: 'The account is locked immediately after the fifth failure.',
  }];

  assert.equal(buildMissingExplicitRequirementScenarios(requirement, wrongBoundary).length, 1);
  assert.deepEqual(buildMissingExplicitRequirementScenarios(requirement, exactBoundary), []);
});

test('an exact value in an unrelated testcase cannot satisfy a requirement boundary', () => {
  const requirement = 'The account must lock after 5 failed login attempts.';
  const unrelatedFive = [
    {
      testCase: 'Verify that the account locks after repeated failed login attempts',
      expectedResult: 'The account is locked after the configured threshold.',
    },
    {
      testCase: 'Verify that the dashboard displays 5 recent notifications',
      expectedResult: 'Exactly 5 notification rows are visible.',
    },
  ];

  assert.equal(buildMissingExplicitRequirementScenarios(requirement, unrelatedFive).length, 1);
});
