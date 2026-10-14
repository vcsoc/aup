import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Settings } from '../shared/types.js';

const location = z.string().max(4096).refine(value => !/[\x00-\x1f]/.test(value), 'Paths cannot contain control characters');
const absolute = location.refine(value => /^(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(value), 'Use an absolute path');
const optionalPath = z.union([z.literal(''), absolute]);
export const settingsSchema = z.object({
  networkEnabled: z.boolean(), processEnabled: z.boolean(), localEnabled: z.boolean(),
  refreshSeconds: z.number().int().min(30).max(3600), threshold: z.number().int().min(50).max(100),
  theme: z.enum(['system', 'dark', 'light']),
  paths: z.object({ claude: absolute, codex: absolute, grok: absolute, kimi: absolute, fireworks: absolute, pi: absolute }),
  importDir: optionalPath, codexBinary: optionalPath,
}).strict();

export function defaultSettings(env = process.env, home = homedir()): Settings {
  return {
    networkEnabled: false, processEnabled: true, localEnabled: true, refreshSeconds: 300,
    threshold: 90, theme: 'system',
    paths: {
      claude: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
      codex: env.CODEX_HOME || path.join(home, '.codex'),
      grok: env.GROK_HOME || path.join(home, '.grok'),
      kimi: env.KIMI_CODE_HOME || path.join(home, '.kimi-code'),
      fireworks: path.join(home, '.fireworks'),
      pi: env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'),
    },
    importDir: path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'omarchy', 'agents', 'usage'),
    codexBinary: '',
  };
}

export async function loadSettings(file: string): Promise<{ settings: Settings; warning?: string }> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    return { settings: settingsSchema.parse(raw) };
  } catch (error) {
    return { settings: defaultSettings(), warning: (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : 'Settings could not be read; defaults are active. Save settings to repair the file.' };
  }
}

export async function saveSettings(file: string, input: unknown): Promise<Settings> {
  const settings = settingsSchema.parse(input);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, file);
  return settings;
}
