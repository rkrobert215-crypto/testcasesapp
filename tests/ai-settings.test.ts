import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  serializeAiSettingsForRequest,
} from '../src/lib/aiSettings.ts';
import { describeAiError, isRetryableAiErrorMessage } from '../src/lib/providerErrors.ts';

test('Claude subscription is the secure default provider', () => {
  assert.equal(DEFAULT_AI_SETTINGS.provider, 'claude_cli');
  assert.equal(DEFAULT_AI_SETTINGS.claudeCliModel, 'sonnet');
  assert.equal(DEFAULT_AI_SETTINGS.strictRequirementMode, true);
});

test('stored Claude subscription model is normalized and serialized', () => {
  const settings = normalizeAiSettings({
    ...DEFAULT_AI_SETTINGS,
    provider: 'claude_cli',
    claudeCliModel: 'opus',
    hostedAccessToken: 'hosted-app-token',
  });
  const request = serializeAiSettingsForRequest(settings, {
    includeSecrets: false,
    includeHostedAccessToken: true,
  });

  assert.equal(request.provider, 'claude_cli');
  assert.equal(request.claudeCliModel, 'opus');
  assert.equal(request.hostedAccessToken, 'hosted-app-token');
  assert.equal('openaiApiKey' in request, false);
  assert.equal('claudeApiKey' in request, false);

  const nonHostedRequest = serializeAiSettingsForRequest(settings, { includeSecrets: false });
  assert.equal('hostedAccessToken' in nonHostedRequest, false);
});

test('Rob style cannot disable strict exact-requirement mode', () => {
  const settings = normalizeAiSettings({
    ...DEFAULT_AI_SETTINGS,
    generationMode: 'rob_style',
    strictRequirementMode: false,
  });

  assert.equal(settings.strictRequirementMode, true);
});

test('Claude session limits retain the reset time and are not retried', () => {
  const message = "You've hit your session limit - resets 1:40pm";
  assert.equal(isRetryableAiErrorMessage(message, 429), false);
  assert.deepEqual(describeAiError(new Error(message), 'Failed', 'Failed'), {
    title: 'Claude session limit reached',
    description: message,
    retryable: false,
  });
});
