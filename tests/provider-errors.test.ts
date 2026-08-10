import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeAiError,
  getProviderRetryAfterMs,
  isRetryableAiErrorMessage,
} from '../src/lib/providerErrors.ts';

test('temporary per-minute quota errors honor the provider retry window', () => {
  const message = 'Quota exceeded; check your plan and billing details. Requests limit: 20. Please retry in 28.256 seconds.';

  assert.equal(isRetryableAiErrorMessage(message, 429), true);
  assert.equal(getProviderRetryAfterMs(message), 28_256);
  assert.deepEqual(describeAiError(message, 'Failed', 'Failed'), {
    title: 'Rate limit reached',
    description: 'The provider temporarily throttled this request. Retry after about 29 seconds.',
    retryable: true,
  });
});

test('zero quota and credit failures remain non-retryable', () => {
  const zeroQuota = 'Quota exceeded, limit: 0. Please retry in 20 seconds. Check billing details.';
  const noCredits = 'This request requires more credits.';

  assert.equal(isRetryableAiErrorMessage(zeroQuota, 429), false);
  assert.equal(isRetryableAiErrorMessage(noCredits, 402), false);
});
