import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWranglerDeploymentUrl } from '../scripts/read-wrangler-deployment-url.mjs';

test('Wrangler output parser selects the newest deployment target', () => {
  const output = [
    JSON.stringify({
      type: 'deploy',
      targets: ['https://old.testcasesapp.workers.dev'],
    }),
    JSON.stringify({ type: 'secret', name: 'APP_PASSWORD' }),
    JSON.stringify({
      type: 'deploy',
      targets: ['https://testcasesapp.example.workers.dev'],
    }),
  ].join('\n');

  assert.equal(
    parseWranglerDeploymentUrl(output),
    'https://testcasesapp.example.workers.dev'
  );
});

test('Wrangler output parser fails when no deployment target exists', () => {
  assert.throws(
    () => parseWranglerDeploymentUrl(JSON.stringify({ type: 'secret' })),
    /did not contain/
  );
});
