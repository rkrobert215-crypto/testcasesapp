import { readFile } from 'node:fs/promises';

export function parseWranglerDeploymentUrl(output) {
  const records = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();

  for (const record of records) {
    if (record.type !== 'deploy' || !Array.isArray(record.targets)) {
      continue;
    }
    const target = record.targets.find((value) => typeof value === 'string' && value.startsWith('https://'));
    if (target) {
      return target.replace(/\/+$/, '');
    }
  }

  throw new Error('Wrangler deployment output did not contain a workers.dev or custom-domain target.');
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error('Wrangler output file path is required.');
  }
  process.stdout.write(parseWranglerDeploymentUrl(await readFile(outputPath, 'utf8')));
}

const isDirectRun =
  process.argv[1]?.replace(/\\/g, '/').endsWith('/read-wrangler-deployment-url.mjs');

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
