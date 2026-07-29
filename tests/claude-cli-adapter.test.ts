import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClaudeCliUserPrompt,
  decodeImageDataUrl,
  parseClaudeCliEnvelope,
  safeClaudeChildEnv,
} from '../server/claudeCliAdapter.ts';

test('Claude CLI envelope prefers schema-enforced structured output', () => {
  const parsed = parseClaudeCliEnvelope<{ value: string }>(
    JSON.stringify({
      result: 'ignored',
      structured_output: { value: 'professional' },
    })
  );

  assert.deepEqual(parsed, { value: 'professional' });
});

test('Claude CLI envelope supports a final JSON line and result fallback', () => {
  const parsed = parseClaudeCliEnvelope<{ ok: boolean }>(
    `diagnostic line\n${JSON.stringify({ result: '{"ok":true}' })}`
  );

  assert.deepEqual(parsed, { ok: true });
});

test('Claude child environment keeps Claude auth but removes application secrets', () => {
  const child = safeClaudeChildEnv({
    PATH: 'bin',
    HOME: 'home',
    CLAUDE_CODE_OAUTH_TOKEN: 'allowed',
    OPENAI_API_KEY: 'blocked',
    LAMBDA_PROXY_TOKEN: 'blocked',
    CUSTOM_PASSWORD: 'blocked',
  });

  assert.equal(child.CLAUDE_CODE_OAUTH_TOKEN, 'allowed');
  assert.equal(child.PATH, 'bin');
  assert.equal(child.OPENAI_API_KEY, undefined);
  assert.equal(child.LAMBDA_PROXY_TOKEN, undefined);
  assert.equal(child.CUSTOM_PASSWORD, undefined);
});

test('image decoder accepts supported data URLs and rejects oversized images', () => {
  const small = decodeImageDataUrl(`data:image/png;base64,${Buffer.from('png').toString('base64')}`);
  assert.equal(small.extension, 'png');
  assert.equal(small.buffer.toString(), 'png');

  const oversized = Buffer.alloc(1_000_001).toString('base64');
  assert.throws(
    () => decodeImageDataUrl(`data:image/jpeg;base64,${oversized}`),
    /1 MB or smaller/
  );
});

test('image paths are explicit and Read is constrained in the prompt', () => {
  const prompt = buildClaudeCliUserPrompt('Requirement text', ['C:\\tmp\\shot.jpg'], 'test-plan');
  assert.match(prompt, /Task: test-plan/);
  assert.match(prompt, /C:\\tmp\\shot.jpg/);
  assert.match(prompt, /Read tool only/);
});
