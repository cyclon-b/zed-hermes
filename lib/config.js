/**
 * Configuration: defaults, per-platform config discovery, and precedence.
 *
 * Precedence, highest first: CLI flags -> environment -> config file -> defaults.
 *
 * @module config
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { DEFAULT_CATALOG, normalizeCatalog } from './commands.js';

/** @typedef {object} BridgeConfig
 * @property {string} command      Executable that starts Hermes in ACP mode.
 * @property {string[]} args       Arguments passed to {@link command}.
 * @property {Record<string,string>} env Extra environment for the child.
 * @property {true|false|'auto'} shell Run the child through a shell.
 * @property {boolean} synthesize  Emit our own update when Hermes sends none.
 * @property {number} synthesizeDelayMs Grace period before synthesizing.
 * @property {Array<{name: string, description: string, hint?: string}>} commands
 * @property {string} [configPath] Config file that was loaded, if any.
 */

/** @type {BridgeConfig} */
export const DEFAULT_CONFIG = Object.freeze({
  command: 'hermes',
  args: Object.freeze(['acp']),
  env: Object.freeze({}),
  shell: 'auto',
  synthesize: true,
  synthesizeDelayMs: 300,
  commands: DEFAULT_CATALOG,
});

/**
 * Per-user config file location.
 *
 * @param {NodeJS.Platform} [platform]
 * @param {Record<string, string | undefined>} [env]
 */
export function defaultConfigPath(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const appData = env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'zed-hermes', 'config.json');
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'zed-hermes', 'config.json');
  }
  const xdg = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'zed-hermes', 'config.json');
}

/**
 * Read a config file. Missing default file is not an error; a missing explicit
 * path is.
 *
 * @param {string | undefined} path
 * @param {{explicit?: boolean}} [options]
 * @returns {{config: Record<string, unknown>, path: string | null}}
 */
export function loadConfigFile(path, { explicit = false } = {}) {
  const file = path ? resolve(path) : defaultConfigPath();
  if (!existsSync(file)) {
    if (explicit) throw new Error(`Config file not found: ${file}`);
    return { config: {}, path: null };
  }
  const text = readFileSync(file, 'utf8');
  const parsed = JSON.parse(stripBom(text));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file must contain a JSON object: ${file}`);
  }
  return { config: /** @type {Record<string, unknown>} */ (parsed), path: file };
}

/**
 * Raw CLI flags. Unset keys are absent so that precedence works.
 *
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {Record<string, unknown>} */
  const flags = { passthrough: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      flags.passthrough = argv.slice(index + 1);
      break;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg} (use -- to pass flags to Hermes)`);
    }
    const [name, inline] = splitFlag(arg);
    switch (name) {
      case '--help':
      case '-h':
        flags.help = true;
        break;
      case '--version':
      case '-v':
        flags.version = true;
        break;
      case '--print-config':
        flags.printConfig = true;
        break;
      case '--synthesize':
        flags.synthesize = true;
        break;
      case '--no-synthesize':
        flags.synthesize = false;
        break;
      case '--shell':
        flags.shell = true;
        break;
      case '--no-shell':
        flags.shell = false;
        break;
      case '--command':
        flags.command = value(name, inline, argv, () => index, (next) => {
          index = next;
        });
        break;
      case '--args':
        flags.args = parseJsonOrSingle(
          value(name, inline, argv, () => index, (next) => {
            index = next;
          }),
          name,
        );
        break;
      case '--env':
        flags.env = parseJsonObject(
          value(name, inline, argv, () => index, (next) => {
            index = next;
          }),
          name,
        );
        break;
      case '--commands':
        flags.commands = parseJsonArray(
          value(name, inline, argv, () => index, (next) => {
            index = next;
          }),
          name,
        );
        break;
      case '--config':
        flags.config = value(name, inline, argv, () => index, (next) => {
          index = next;
        });
        break;
      case '--delay-ms':
        flags.synthesizeDelayMs = parseDelay(
          value(name, inline, argv, () => index, (next) => {
            index = next;
          }),
          name,
        );
        break;
      default:
        throw new Error(`Unknown flag: ${name}. Run zed-hermes --help.`);
    }
  }
  return flags;
}

/**
 * @param {string} arg
 * @returns {[string, string | undefined]}
 */
function splitFlag(arg) {
  const eq = arg.indexOf('=');
  if (eq === -1) return [arg, undefined];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

/**
 * @param {string} name
 * @param {string | undefined} inline
 * @param {string[]} argv
 * @param {() => number} readIndex
 * @param {(next: number) => void} writeIndex
 */
function value(name, inline, argv, readIndex, writeIndex) {
  if (inline !== undefined) return inline;
  const next = readIndex() + 1;
  if (next >= argv.length) throw new Error(`${name} requires a value`);
  writeIndex(next);
  return argv[next];
}

/**
 * @param {string} raw
 * @param {string} flag
 */
function parseJsonOrSingle(raw, flag) {
  const text = raw.trim();
  if (text.startsWith('[')) {
    const parsed = parseJsonArray(text, flag);
    return parsed.map(String);
  }
  return text ? [text] : [];
}

/**
 * @param {string} raw
 * @param {string} flag
 */
function parseJsonArray(raw, flag) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${flag} expects a JSON array`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${flag} expects a JSON array`);
  return parsed;
}

/**
 * @param {string} raw
 * @param {string} flag
 */
function parseJsonObject(raw, flag) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${flag} expects a JSON object`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${flag} expects a JSON object`);
  }
  return parsed;
}

/**
 * @param {string} raw
 * @param {string} flag
 */
function parseDelay(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${flag} expects a non-negative number`);
  return Math.floor(value);
}

/**
 * Read bridge settings from the environment.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, unknown>}
 */
export function configFromEnv(env) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (env.ZED_HERMES_COMMAND) out.command = env.ZED_HERMES_COMMAND;
  if (env.ZED_HERMES_ARGS) out.args = parseJsonOrSingle(env.ZED_HERMES_ARGS, 'ZED_HERMES_ARGS');
  if (env.ZED_HERMES_ENV) out.env = parseJsonObject(env.ZED_HERMES_ENV, 'ZED_HERMES_ENV');
  if (env.ZED_HERMES_SHELL !== undefined) out.shell = normalizeShell(env.ZED_HERMES_SHELL);
  if (env.ZED_HERMES_SYNTHESIZE !== undefined) {
    out.synthesize = !['0', 'false', 'no', 'off'].includes(
      env.ZED_HERMES_SYNTHESIZE.toLowerCase(),
    );
  }
  if (env.ZED_HERMES_DELAY_MS) out.synthesizeDelayMs = parseDelay(env.ZED_HERMES_DELAY_MS, 'ZED_HERMES_DELAY_MS');
  if (env.ZED_HERMES_COMMANDS) out.commands = parseJsonArray(env.ZED_HERMES_COMMANDS, 'ZED_HERMES_COMMANDS');
  return out;
}

/**
 * Build the effective config from all sources.
 *
 * @param {{flags?: Record<string, unknown>, env?: Record<string, string | undefined>}} [sources]
 * @returns {BridgeConfig}
 */
export function resolveConfig({ flags = {}, env = process.env } = {}) {
  const { config: fileConfig, path } = loadConfigFile(
    typeof flags.config === 'string' ? flags.config : env.ZED_HERMES_CONFIG,
    { explicit: typeof flags.config === 'string' },
  );

  const merged = {
    ...DEFAULT_CONFIG,
    ...pickKnown(fileConfig),
    ...configFromEnv(env),
    ...pickKnown(flags),
  };

  const args = Array.isArray(merged.args) ? merged.args.map(String) : [...DEFAULT_CONFIG.args];
  if (Array.isArray(flags.passthrough) && flags.passthrough.length > 0) args.push(...flags.passthrough);

  return {
    command: String(merged.command || DEFAULT_CONFIG.command),
    args,
    env: isPlainObject(merged.env) ? /** @type {Record<string,string>} */ (merged.env) : {},
    shell: normalizeShell(merged.shell),
    synthesize: merged.synthesize !== false,
    synthesizeDelayMs: Number.isFinite(merged.synthesizeDelayMs)
      ? Math.max(0, Number(merged.synthesizeDelayMs))
      : DEFAULT_CONFIG.synthesizeDelayMs,
    commands:
      merged.commands === undefined
        ? normalizeCatalog(DEFAULT_CATALOG)
        : normalizeCatalog(merged.commands),
    ...(path ? { configPath: path } : {}),
  };
}

/**
 * Accept `true`/`false`/`auto` plus their common string spellings, so
 * `ZED_HERMES_SHELL=auto` and a config file with `"shell": "false"` behave as
 * written instead of silently falling back to `auto`.
 *
 * @param {unknown} value
 * @returns {true | false | 'auto'}
 */
function normalizeShell(value) {
  if (value === true || value === false || value === 'auto') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'auto') return 'auto';
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
  }
  return 'auto';
}

/**
 * Keep only keys the bridge understands, so typos in a config file are ignored
 * rather than silently forwarded to the child.
 *
 * @param {Record<string, unknown>} input
 */
function pickKnown(input) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!isPlainObject(input)) return out;
  for (const key of [
    'command',
    'args',
    'env',
    'shell',
    'synthesize',
    'synthesizeDelayMs',
    'commands',
  ]) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} text
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * @param {BridgeConfig} config
 */
export function configSummary(config) {
  return {
    command: config.command,
    args: config.args,
    shell: config.shell,
    synthesize: config.synthesize,
    synthesizeDelayMs: config.synthesizeDelayMs,
    commands: config.commands.map((command) => command.name),
    configPath: config.configPath ?? null,
  };
}
