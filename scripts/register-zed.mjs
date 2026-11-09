#!/usr/bin/env node
/**
 * Add or remove the zed-hermes entry in Zed's settings.json.
 *
 * `settings.json` is rewritten as plain JSON (2-space indent) and the previous
 * file is backed up first. If the file is not valid JSON (Zed tolerates some
 * extensions), the script refuses to touch it and prints the snippet instead.
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
 * @param {string} bridge
 */
export function isOurEntry(entry, bridge = BRIDGE_PATH) {
  if (!entry || typeof entry !== 'object') return false;
  const record = /** @type {Record<string, unknown>} */ (entry);
  const args = Array.isArray(record.args) ? record.args.map(String) : [];
  return args.some((arg) => resolve(arg) === resolve(bridge));
}

/**
 * Mutate the settings object in place.
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

/**
 * @param {string} settingsPath
 * @param {{name?: string, entry?: Record<string, unknown>, bridge?: string, revert?: boolean, force?: boolean, dryRun?: boolean, backup?: boolean}} options
 */
export function updateSettingsFile(settingsPath, options = {}) {
  const path = resolve(settingsPath);
  const exists = existsSync(path);
  let settings = {};
  if (exists) {
    const raw = readFileSync(path, 'utf8');
    if (raw.trim()) {
      try {
        settings = JSON.parse(raw);
      } catch (cause) {
        throw new Error(
          `${path} is not strict JSON (${cause instanceof Error ? cause.message : cause}). ` +
            'Fix it, or paste the snippet printed by --print instead.',
        );
      }
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error(`${path} must contain a JSON object`);
    }
  }

  const result = applyEntry(settings, options);
  if (!result.changed || options.dryRun) return { ...result, path, backupPath: null };

  mkdirSync(dirname(path), { recursive: true });
  let backupPath = null;
  if (exists && options.backup !== false) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${path}.${stamp}.bak`;
    copyFileSync(path, backupPath);
  }
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
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
