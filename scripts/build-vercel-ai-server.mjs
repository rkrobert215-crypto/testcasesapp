import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const outDir = path.join(projectRoot, 'server-dist');

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, 'server', 'generate-test-cases-server.ts')],
  outfile: path.join(outDir, 'generate-test-cases-server.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
});
