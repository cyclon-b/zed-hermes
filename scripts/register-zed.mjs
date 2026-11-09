#!/usr/bin/env node
/**
 * Add or remove the zed-hermes entry in Zed's settings.json.
 *
 * Zed's settings file is JSONC: it may contain line and block comments and
 * trailing commas. A strict JSON round-trip would destroy them, so the script
 * parses with positions, splices only the affected range, and validates the
 * result. A timestamped backup is written before any change.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_AGENT_NAME = 'Hermes';
export const BRIDGE_PATH = fileURLToPath(new URL('../bin/zed-hermes.js', import.meta.url));

/**
 * Zed's per-user settings file.
 *
 * @param {NodeJS.Platform} [platform]
 * @param {Record<string, string | undefined>} [env]
 */
export function zedSettingsPath(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const appData = env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Zed', 'settings.json');
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Zed', 'settings.json');
  }
  const xdg = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'zed', 'settings.json');
}

/**
 * The `agent_servers.<name>` value this bridge installs.
 *
 * @param {{node?: string, bridge?: string}} [options]
 */
export function buildEntry({ node = 'node', bridge = BRIDGE_PATH } = {}) {
  return { type: 'custom', command: node, args: [bridge], env: {} };
}

/**
 * @param {unknown} entry
 * @param {string} [bridge]
 */
export function isOurEntry(entry, bridge = BRIDGE_PATH) {
  if (!entry || typeof entry !== 'object') return false;
  const record = /** @type {Record<string, unknown>} */ (entry);
  const args = Array.isArray(record.args) ? record.args.map(String) : [];
  return args.some((arg) => resolve(arg) === resolve(bridge));
}

/**
 * Mutate a plain settings object in place (used for new and empty files).
 *
 * @param {Record<string, any>} settings
 * @param {{name?: string, entry?: Record<string, unknown>, bridge?: string, revert?: boolean, force?: boolean}} options
 */
export function applyEntry(settings, options = {}) {
  const name = options.name || DEFAULT_AGENT_NAME;
  const servers = settings.agent_servers;
  if (servers !== undefined && (servers === null || typeof servers !== 'object' || Array.isArray(servers))) {
    throw new Error('`agent_servers` exists but is not an object');
  }
  const existing = servers?.[name];

  if (options.revert) {
    if (existing === undefined) return { changed: false, reason: `agent_servers.${name} is not present` };
    if (!options.force && !isOurEntry(existing, options.bridge)) {
      throw new Error(
        `agent_servers.${name} does not point at zed-hermes; re-run with --force to remove it anyway`,
      );
    }
    delete servers[name];
    return { changed: true, reason: `removed agent_servers.${name}` };
  }

  const entry = options.entry || buildEntry();
  if (JSON.stringify(existing) === JSON.stringify(entry)) {
    return { changed: false, reason: `agent_servers.${name} is already up to date` };
  }
  settings.agent_servers = { ...(servers || {}), [name]: entry };
  return { changed: true, reason: `wrote agent_servers.${name}` };
}

// -- JSONC parsing ---------------------------------------------------------

/**
 * @typedef {{start: number, end: number, type: string, value?: unknown, properties?: Array<{key: string, keyStart: number, value: any}>, items?: any[]}} JsoncNode
 */

/**
 * Parse JSONC and keep source positions for every node.
 *
 * @param {string} text
 * @returns {{value: unknown, root: JsoncNode}}
 */
export function parseJsonc(text) {
  const state = { text, index: 0 };
  const root = parseValue(state);
  skipTrivia(state);
  if (state.index < text.length) {
    throw new Error(`Unexpected trailing content at offset ${state.index}`);
  }
  return { value: toValue(root), root };
}

/**
 * @param {{text: string, index: number}} state
 * @returns {JsoncNode}
 */
function parseValue(state) {
  skipTrivia(state);
  const text = state.text;
  const start = state.index;
  const char = text[state.index];
  if (char === '{') return parseObject(state);
  if (char === '[') return parseArray(state);
  if (char === '"') {
    const value = parseString(state);
    return { start, end: state.index, type: 'string', value };
  }
  while (state.index < text.length && !/[,\]}\s/:]/.test(text[state.index])) {
    state.index += 1;
  }
  const raw = text.slice(start, state.index);
  if (!/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(raw)) {
    throw new Error(`Invalid JSON value "${raw}" at offset ${start}`);
  }
  return { start, end: state.index, type: 'literal', value: JSON.parse(raw) };
}

/**
 * @param {{text: string, index: number}} state
 * @returns {JsoncNode}
 */
function parseObject(state) {
  const text = state.text;
  const start = state.index;
  state.index += 1;
  /** @type {Array<{key: string, keyStart: number, value: any}>} */
  const properties = [];
  for (;;) {
    skipTrivia(state);
    if (text[state.index] === '}') {
      state.index += 1;
      return { start, end: state.index, type: 'object', properties };
    }
    const keyStart = state.index;
    if (text[state.index] !== '"') throw new Error(`Expected a property name at offset ${state.index}`);
    const key = parseString(state);
    skipTrivia(state);
    if (text[state.index] !== ':') throw new Error(`Expected ":" at offset ${state.index}`);
    state.index += 1;
    const value = parseValue(state);
    properties.push({ key, keyStart, value });
    skipTrivia(state);
    if (text[state.index] === ',') {
      state.index += 1;
      skipTrivia(state);
      if (text[state.index] === '}') {
        state.index += 1;
        return { start, end: state.index, type: 'object', properties };
      }
      continue;
    }
    if (text[state.index] === '}') {
      state.index += 1;
      return { start, end: state.index, type: 'object', properties };
    }
    throw new Error(`Expected "," or "}" at offset ${state.index}`);
  }
}

/**
 * @param {{text: string, index: number}} state
 * @returns {JsoncNode}
 */
function parseArray(state) {
  const text = state.text;
  const start = state.index;
  state.index += 1;
  /** @type {any[]} */
  const items = [];
  for (;;) {
    skipTrivia(state);
    if (text[state.index] === ']') {
      state.index += 1;
      return { start, end: state.index, type: 'array', items };
    }
    items.push(parseValue(state));
    skipTrivia(state);
    if (text[state.index] === ',') {
      state.index += 1;
      skipTrivia(state);
      if (text[state.index] === ']') {
        state.index += 1;
        return { start, end: state.index, type: 'array', items };
      }
      continue;
    }
    if (text[state.index] === ']') {
      state.index += 1;
      return { start, end: state.index, type: 'array', items };
    }
    throw new Error(`Expected "," or "]" at offset ${state.index}`);
  }
}

/**
 * @param {{text: string, index: number}} state
 * @returns {string}
 */
function parseString(state) {
  const text = state.text;
  const start = state.index;
  state.index += 1;
  while (state.index < text.length) {
    const char = text[state.index];
    if (char === '\\') {
      state.index += 2;
      continue;
    }
    if (char === '"') {
      state.index += 1;
      return JSON.parse(text.slice(start, state.index));
    }
    if (char === '\n' || char === '\r') break;
    state.index += 1;
  }
  throw new Error(`Unterminated string at offset ${start}`);
}

/**
 * @param {{text: string, index: number}} state
 */
function skipTrivia(state) {
  const text = state.text;
  for (;;) {
    while (state.index < text.length && /\s/.test(text[state.index])) state.index += 1;
    if (text.startsWith('//', state.index)) {
      const newline = text.indexOf('\n', state.index);
      state.index = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (text.startsWith('/*', state.index)) {
      const close = text.indexOf('*/', state.index + 2);
      if (close === -1) throw new Error(`Unterminated block comment at offset ${state.index}`);
      state.index = close + 2;
      continue;
    }
    return;
  }
}

/**
 * @param {JsoncNode} node
 */
function toValue(node) {
  if (node.type === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const property of node.properties || []) out[property.key] = toValue(property.value);
    return out;
  }
  if (node.type === 'array') return (node.items || []).map(toValue);
  return node.value;
}

/**
 * @param {JsoncNode} node
 * @param {string} key
 */
function findProperty(node, key) {
  return (node.properties || []).find((property) => property.key === key);
}

/**
 * Apply the change to JSONC text without touching anything outside the
 * affected range.
 *
 * @param {string} text
 * @param {{name?: string, entry?: Record<string, unknown>, bridge?: string, revert?: boolean, force?: boolean}} options
 */
export function mutateJsoncText(text, options = {}) {
  const name = options.name || DEFAULT_AGENT_NAME;
  const { root } = parseJsonc(text);
  if (root.type !== 'object') throw new Error('settings.json must contain a JSON object');

  const serversProperty = findProperty(root, 'agent_servers');

  if (options.revert) {
    if (!serversProperty) return { changed: false, reason: `agent_servers.${name} is not present`, text };
    if (serversProperty.value.type !== 'object') {
      throw new Error('`agent_servers` exists but is not an object');
    }
    const property = findProperty(serversProperty.value, name);
    if (!property) return { changed: false, reason: `agent_servers.${name} is not present`, text };
    if (!options.force && !isOurEntry(toValue(property.value), options.bridge)) {
      throw new Error(
        `agent_servers.${name} does not point at zed-hermes; re-run with --force to remove it anyway`,
      );
    }
    const [start, end] = removalRange(text, property, serversProperty.value);
    const next = text.slice(0, start) + text.slice(end);
    parseJsonc(next);
    return { changed: true, reason: `removed agent_servers.${name}`, text: next };
  }

  const entry = options.entry || buildEntry();
  const json = formatEntry(entry, '    ');

  if (!serversProperty) {
    const insertAt = root.start + 1;
    const hasProperties = (root.properties || []).length > 0;
    const block = hasProperties
      ? `\n  "agent_servers": {\n    ${JSON.stringify(name)}: ${json}\n  },`
      : `\n  "agent_servers": {\n    ${JSON.stringify(name)}: ${json}\n  }\n`;
    const next = text.slice(0, insertAt) + block + text.slice(insertAt);
    parseJsonc(next);
    return { changed: true, reason: `wrote agent_servers.${name}`, text: next };
  }

  if (serversProperty.value.type !== 'object') {
    throw new Error('`agent_servers` exists but is not an object');
  }

  const property = findProperty(serversProperty.value, name);
  if (property) {
    const current = toValue(property.value);
    if (JSON.stringify(current) === JSON.stringify(entry)) {
      return { changed: false, reason: `agent_servers.${name} is already up to date`, text };
    }
    const indent = lineIndent(text, property.keyStart);
    const next =
      text.slice(0, property.value.start) +
      formatEntry(entry, indent) +
      text.slice(property.value.end);
    parseJsonc(next);
    return { changed: true, reason: `updated agent_servers.${name}`, text: next };
  }

  const insertAt = serversProperty.value.start + 1;
  const hasProperties = (serversProperty.value.properties || []).length > 0;
  const block = hasProperties
    ? `\n    ${JSON.stringify(name)}: ${json},`
    : `\n    ${JSON.stringify(name)}: ${json}\n  `;
  const next = text.slice(0, insertAt) + block + text.slice(insertAt);
  parseJsonc(next);
  return { changed: true, reason: `wrote agent_servers.${name}`, text: next };
}

/**
 * Render an entry as JSON whose continuation lines follow `indent`.
 *
 * @param {Record<string, unknown>} entry
 * @param {string} indent
 */
function formatEntry(entry, indent) {
  return JSON.stringify(entry, null, 2).replace(/\n/g, `\n${indent}`);
}

/**
 * Whitespace prefix of the line containing `index`.
 *
 * @param {string} text
 * @param {number} index
 */
function lineIndent(text, index) {
  let start = index;
  while (start > 0 && text[start - 1] !== '\n') start -= 1;
  const prefix = text.slice(start, index);
  return /^[ \t]*$/.test(prefix) ? prefix : '    ';
}

/**
 * Range of text to delete for one object property, including exactly one
 * separating comma.
 *
 * @param {string} text
 * @param {{keyStart: number, value: {end: number}}} property
 * @param {JsoncNode} objectNode
 */
function removalRange(text, property, objectNode) {
  let start = property.keyStart;
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1;

  let end = property.value.end;
  let cursor = end;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;

  if (text[cursor] === ',') {
    end = cursor + 1;
  } else if ((objectNode.properties || []).length > 1) {
    let comma = start;
    while (comma > 0 && /\s/.test(text[comma - 1])) comma -= 1;
    if (text[comma - 1] === ',') start = comma - 1;
  }

  return [start, end];
}

/**
 * @param {string} settingsPath
 * @param {{name?: string, entry?: Record<string, unknown>, bridge?: string, revert?: boolean, force?: boolean, dryRun?: boolean, backup?: boolean}} options
 */
export function updateSettingsFile(settingsPath, options = {}) {
  const path = resolve(settingsPath);
  const exists = existsSync(path);
  const raw = exists ? readFileSync(path, 'utf8') : '';
  const hasContent = raw.trim().length > 0;

  let result;
  let nextText;

  if (hasContent) {
    result = mutateJsoncText(raw, options);
    nextText = result.text;
  } else {
    const settings = {};
    result = applyEntry(settings, options);
    nextText = `${JSON.stringify(settings, null, 2)}\n`;
  }

  if (!result.changed || options.dryRun) return { ...result, path, backupPath: null };

  mkdirSync(dirname(path), { recursive: true });
  let backupPath = null;
  if (exists && options.backup !== false) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${path}.${stamp}.bak`;
    copyFileSync(path, backupPath);
  }
  writeFileSync(path, nextText, 'utf8');
  return { ...result, path, backupPath };
}

/**
 * @param {string} [name]
 * @param {{node?: string, bridge?: string}} [options]
 */
export function snippet(name = DEFAULT_AGENT_NAME, options = {}) {
  return JSON.stringify({ agent_servers: { [name]: buildEntry(options) } }, null, 2);
}

const HELP = `Usage: node scripts/register-zed.mjs [options]

Options:
  --settings <path>  Zed settings.json (default: per-platform location)
  --name <name>      Agent name shown in Zed (default: ${DEFAULT_AGENT_NAME})
  --bridge <path>    Path to bin/zed-hermes.js (default: this checkout)
  --node <path>      Node executable to use (default: node)
  --revert           Remove the entry instead of adding it
  --force            With --revert, remove an entry that does not point at this bridge
  --dry-run          Print what would change without writing
  --print            Print the agent_servers snippet and exit
  --help, -h         Show this help
`;

/**
 * @param {string[]} argv
 */
export function main(argv) {
  const options = {
    name: DEFAULT_AGENT_NAME,
    settingsPath: null,
    node: 'node',
    bridge: BRIDGE_PATH,
    revert: false,
    force: false,
    dryRun: false,
    print: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      return 0;
    }
    if (arg === '--revert') options.revert = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--print') options.print = true;
    else if (arg === '--settings') options.settingsPath = next();
    else if (arg === '--name') options.name = next();
    else if (arg === '--bridge') options.bridge = resolve(next());
    else if (arg === '--node') options.node = next();
    else throw new Error(`Unknown flag: ${arg}`);
  }

  if (options.print) {
    process.stdout.write(`${snippet(options.name, { node: options.node, bridge: options.bridge })}\n`);
    return 0;
  }

  const path = options.settingsPath || zedSettingsPath();
  try {
    const result = updateSettingsFile(path, {
      name: options.name,
      entry: buildEntry({ node: options.node, bridge: options.bridge }),
      bridge: options.bridge,
      revert: options.revert,
      force: options.force,
      dryRun: options.dryRun,
    });
    process.stdout.write(
      `${result.changed ? (options.dryRun ? 'would change' : 'ok') : 'no change'}: ${result.reason}\n`,
    );
    process.stdout.write(`settings: ${result.path}\n`);
    if (result.backupPath) process.stdout.write(`backup:   ${result.backupPath}\n`);
    if (result.changed && !options.dryRun) {
      process.stdout.write('Restart Zed or open the Agent Panel; Zed reloads settings automatically.\n');
    }
    return 0;
  } catch (cause) {
    process.stderr.write(`zed-hermes: ${cause instanceof Error ? cause.message : cause}\n`);
    if (!options.revert) {
      process.stderr.write('\nAdd this to your Zed settings.json manually:\n');
      process.stderr.write(`${snippet(options.name, { node: options.node, bridge: options.bridge })}\n`);
    }
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
