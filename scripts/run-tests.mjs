import { rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(projectRoot, '.tmp-tests');
const testEntries = [
  'tests/ai-settings.test.ts',
  'tests/claude-cli-adapter.test.ts',
  'tests/reviewed-generation.test.ts',
  'tests/generation-pipeline.test.ts',
  'tests/cloudflare-worker.test.ts',
  'tests/lambda-handler.test.ts',
  'tests/vercel-handler.test.ts',
  'tests/wrangler-output.test.ts',
  'tests/image-payload-budget.test.ts',
  'tests/test-case-identity.test.ts',
  'tests/technical-workflow-coverage.test.ts',
  'tests/coverage-quality-gate.test.ts',
].map((fileName) => path.join(projectRoot, fileName));

await rm(outputDirectory, { recursive: true, force: true });

try {
  await build({
    entryPoints: testEntries,
    outdir: outputDirectory,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: 'inline',
    legalComments: 'none',
    alias: {
      '@': path.join(projectRoot, 'src'),
    },
  });

  const testOutputs = testEntries.map((entry) =>
    path.join(outputDirectory, `${path.basename(entry, '.ts')}.js`)
  );
  const result = spawnSync(process.execPath, ['--test', ...testOutputs], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
