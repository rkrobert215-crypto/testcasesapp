import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AiPromptPart,
  ClaudeCliGenerationOptions,
  ClaudeCliStructuredGenerator,
} from '../supabase/functions/_shared/aiClient.ts';

const ALL_CLAUDE_TOOLS =
  'Bash,BashOutput,KillShell,Read,Write,Edit,NotebookEdit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,SlashCommand';
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_TOTAL_IMAGE_BYTES = 4_000_000;
const MAX_STDOUT_BYTES = 20_000_000;
const MAX_STDERR_BYTES = 64_000;
const DEFAULT_TIMEOUT_MS = 250_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 840_000;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const SECRET_PREFIXES = [
  'ANTHROPIC',
  'OPENAI',
  'GEMINI',
  'GOOGLE',
  'GROQ',
  'OPENROUTER',
  'AWS',
  'SUPABASE',
  'VERCEL',
  'CLOUDFLARE',
  'CF_',
  'VITE_',
  'SMTP',
  'TELEGRAM',
  'DHAN',
  'UPSTOX',
  'ANGEL',
];
const SECRET_MARKERS = [
  'API_KEY',
  'AUTH_TOKEN',
  'ACCESS_TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSPHRASE',
  'CREDENTIAL',
  'PROXY_TOKEN',
];

interface ClaudeCliEnvelope {
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
}

interface MaterializedPrompt {
  text: string;
  imagePaths: string[];
}

export const generateWithClaudeCli: ClaudeCliStructuredGenerator = async <T>(
  options: ClaudeCliGenerationOptions
): Promise<T> => {
  const requestDirectory = await mkdtemp(path.join(os.tmpdir(), 'testcase-claude-'));
  const systemPromptPath = path.join(requestDirectory, 'system-prompt.txt');

  try {
    await writeFile(systemPromptPath, options.systemPrompt, 'utf8');
    const prompt = await materializeUserParts(options.userParts, requestDirectory);
    const hasImages = prompt.imagePaths.length > 0;
    const cliPath = await findClaudeCli();
    const command = buildClaudeCommand({
      cliPath,
      model: options.model,
      schema: options.output.schema,
      systemPromptPath,
      hasImages,
    });
    const timeoutMs = readTimeoutMs(process.env.CLAUDE_CODE_TIMEOUT_MS);
    const { stdout } = await runClaudeProcess({
      executable: command.executable,
      args: command.args,
      cwd: requestDirectory,
      input: buildClaudeCliUserPrompt(prompt.text, prompt.imagePaths, options.featureName),
      env: safeClaudeChildEnv(),
      timeoutMs,
    });

    return parseClaudeCliEnvelope<T>(stdout);
  } finally {
    await removeRequestDirectory(requestDirectory);
  }
};

export function safeClaudeChildEnv(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const safeEnvironment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string' || isSecretEnvironmentVariable(name)) {
      continue;
    }
    safeEnvironment[name] = value;
  }

  return safeEnvironment;
}

export function decodeImageDataUrl(dataUrl: string): {
  buffer: Buffer;
  extension: string;
  mediaType: string;
} {
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) {
    throw new Error('A screenshot is not a valid base64 image data URL.');
  }

  const mediaType = match[1].toLowerCase();
  const extension = ALLOWED_IMAGE_TYPES[mediaType];
  if (!extension) {
    throw new Error('Screenshots must be PNG, JPEG, WebP, or GIF images.');
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (buffer.length === 0) {
    throw new Error('A screenshot was empty.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Each screenshot must be 1 MB or smaller after optimization.');
  }

  return { buffer, extension, mediaType };
}

export function buildClaudeCliUserPrompt(
  text: string,
  imagePaths: string[],
  featureName: string
): string {
  const sections = [
    `Task: ${featureName}`,
    '',
    text.trim() || 'No text content was supplied.',
  ];

  if (imagePaths.length > 0) {
    sections.push(
      '',
      'Attached screenshots:',
      ...imagePaths.map((imagePath, index) => `${index + 1}. ${imagePath}`),
      '',
      'Use the Read tool only to inspect these exact screenshot paths. Do not access any other file.'
    );
  }

  return sections.join('\n');
}

export function parseClaudeCliEnvelope<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('Claude CLI returned no output.');
  }

  let envelope: ClaudeCliEnvelope | null = tryParseObject(trimmed);
  if (!envelope) {
    for (const line of trimmed.split(/\r?\n/).reverse()) {
      envelope = tryParseObject(line.trim());
      if (envelope) {
        break;
      }
    }
  }

  if (!envelope) {
    throw new Error('Claude CLI returned an invalid response envelope.');
  }
  if (envelope.is_error) {
    const message =
      typeof envelope.result === 'string'
        ? envelope.result.slice(0, 500)
        : 'Claude CLI reported an unsuccessful generation.';
    throw new Error(message);
  }
  if (envelope.structured_output !== undefined && envelope.structured_output !== null) {
    return envelope.structured_output as T;
  }
  if (typeof envelope.result !== 'string' || !envelope.result.trim()) {
    throw new Error('Claude CLI did not return structured output.');
  }

  const result = envelope.result.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(result) as T;
  } catch {
    throw new Error('Claude CLI result did not contain valid structured JSON.');
  }
}

export async function findClaudeCli(
  environment: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const configuredPath = environment.CLAUDE_CLI_PATH?.trim();
  if (configuredPath) {
    await assertFileExists(configuredPath, 'CLAUDE_CLI_PATH');
    return configuredPath;
  }

  if (process.platform !== 'win32') {
    return 'claude';
  }

  const homeDirectory = environment.USERPROFILE || environment.HOME;
  if (homeDirectory) {
    const extensionsDirectory = path.join(homeDirectory, '.vscode', 'extensions');
    try {
      const candidates = (await readdir(extensionsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('anthropic.claude-code-'))
        .map((entry) => ({
          version: parseExtensionVersion(entry.name),
          binary: path.join(extensionsDirectory, entry.name, 'resources', 'native-binary', 'claude.exe'),
        }))
        .sort((left, right) => compareVersions(right.version, left.version));

      for (const candidate of candidates) {
        try {
          await access(candidate.binary);
          return candidate.binary;
        } catch {
          // Continue to the next installed extension.
        }
      }
    } catch {
      // The extension directory is optional.
    }
  }

  return 'claude';
}

async function materializeUserParts(
  userParts: AiPromptPart[],
  requestDirectory: string
): Promise<MaterializedPrompt> {
  const textParts: string[] = [];
  const imageParts = userParts.filter(
    (part): part is Extract<AiPromptPart, { type: 'image' }> => part.type === 'image'
  );
  if (imageParts.length > MAX_IMAGES) {
    throw new Error(`A maximum of ${MAX_IMAGES} screenshots is supported.`);
  }

  const attachmentsDirectory = path.join(requestDirectory, 'attachments');
  const imagePaths: string[] = [];
  let totalImageBytes = 0;

  if (imageParts.length > 0) {
    await mkdir(attachmentsDirectory, { recursive: true });
  }

  let imageIndex = 0;
  for (const part of userParts) {
    if (part.type === 'text') {
      textParts.push(part.text);
      continue;
    }

    const decoded = decodeImageDataUrl(part.dataUrl);
    totalImageBytes += decoded.buffer.length;
    if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('Combined screenshot size must be 4 MB or smaller after optimization.');
    }

    imageIndex += 1;
    const imagePath = path.join(attachmentsDirectory, `screenshot-${imageIndex}.${decoded.extension}`);
    await writeFile(imagePath, decoded.buffer);
    imagePaths.push(imagePath);
  }

  return { text: textParts.join('\n\n'), imagePaths };
}

function buildClaudeCommand({
  cliPath,
  model,
  schema,
  systemPromptPath,
  hasImages,
}: {
  cliPath: string;
  model: string;
  schema: Record<string, unknown>;
  systemPromptPath: string;
  hasImages: boolean;
}) {
  const allowedTools = hasImages ? 'Read' : '';
  const deniedTools = hasImages
    ? ALL_CLAUDE_TOOLS.split(',')
        .filter((toolName) => toolName !== 'Read')
        .join(',')
    : ALL_CLAUDE_TOOLS;
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schema),
    '--system-prompt-file',
    systemPromptPath,
    '--tools',
    allowedTools,
    '--allowedTools',
    allowedTools,
    '--disallowedTools',
    deniedTools,
    '--strict-mcp-config',
    '--no-session-persistence',
    '--safe-mode',
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    hasImages ? '8' : '6',
    '--effort',
    'high',
    '--model',
    model,
  ];

  return { executable: cliPath, args };
}

function runClaudeProcess({
  executable,
  args,
  cwd,
  input,
  env,
  timeoutMs,
}: {
  executable: string;
  args: string[];
  cwd: string;
  input: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`Claude CLI timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    const finish = (error?: Error, result?: { stdout: string; stderr: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > MAX_STDOUT_BYTES) {
        child.kill();
        finish(new Error('Claude CLI output exceeded the 20 MB safety limit.'));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_BYTES);
    });
    child.on('error', (error) => {
      finish(
        new Error(
          error.message.includes('ENOENT')
            ? 'Claude CLI was not found. Install Claude Code or configure CLAUDE_CLI_PATH.'
            : `Claude CLI could not start: ${error.message}`
        )
      );
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      if (exitCode !== 0 && !stdout.trim()) {
        const detail = sanitizeProcessError(stderr);
        finish(new Error(`Claude CLI exited with code ${exitCode}.${detail ? ` ${detail}` : ''}`));
        return;
      }
      finish(undefined, { stdout, stderr });
    });

    child.stdin.on('error', (error) => finish(new Error(`Claude CLI input failed: ${error.message}`)));
    child.stdin.end(input, 'utf8');
  });
}

function isSecretEnvironmentVariable(name: string): boolean {
  const upperName = name.toUpperCase();
  if (upperName.startsWith('CLAUDE')) {
    return false;
  }
  return (
    SECRET_PREFIXES.some((prefix) => upperName.startsWith(prefix)) ||
    SECRET_MARKERS.some((marker) => upperName.includes(marker))
  );
}

function readTimeoutMs(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(parsed)));
}

function tryParseObject(text: string): ClaudeCliEnvelope | null {
  if (!text.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as ClaudeCliEnvelope)
      : null;
  } catch {
    return null;
  }
}

function parseExtensionVersion(name: string): number[] {
  const match = name.match(/claude-code-(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

async function assertFileExists(filePath: string, label: string) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} points to a missing Claude CLI binary.`);
  }
}

async function removeRequestDirectory(requestDirectory: string) {
  const resolvedDirectory = path.resolve(requestDirectory);
  const resolvedTemporaryRoot = path.resolve(os.tmpdir());
  const expectedPrefix = `${resolvedTemporaryRoot}${path.sep}testcase-claude-`;
  if (!resolvedDirectory.startsWith(expectedPrefix)) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  await rm(resolvedDirectory, { recursive: true, force: true });
}

function sanitizeProcessError(stderr: string): string {
  return stderr
    .replace(/(?:sk|AIza|gsk_|oauth)[A-Za-z0-9_.-]{8,}/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-500);
}
