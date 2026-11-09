/**
 * Spawning `hermes acp` in a way that works on Windows shims too.
 *
 * @module spawn
 */

import { spawn } from 'node:child_process';
import { extname } from 'node:path';

/**
 * Decide whether Windows needs a shell to run the configured executable.
 *
 * npm-style `.cmd`/`.bat`/`.ps1` shims cannot be passed to `CreateProcess`
 * directly. On Windows we therefore run a bare name (no extension, no path)
 * through the shell, while an explicit `.exe` runs directly. POSIX never needs
 * this.
 *
 * @param {string} command
 * @param {NodeJS.Platform} platform
 */
export function needsShell(command, platform = process.platform) {
  if (platform !== 'win32') return false;
  const ext = extname(command).toLowerCase();
  if (ext === '.exe') return false;
  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') return true;
  // Bare name (`hermes`): could resolve to hermes.cmd. Let cmd.exe resolve it.
  return !command.includes('\\') && !command.includes('/');
}

/**
 * @param {{command: string, args: string[], shell: true|false|'auto'}} config
 * @param {NodeJS.Platform} [platform]
 */
export function buildSpawnArgs(config, platform = process.platform) {
  const shell =
    config.shell === true || (config.shell === 'auto' && needsShell(config.command, platform));
  if (!shell) return { command: config.command, args: [...config.args], shell: false };

  // Node warns (DEP0190) when `shell: true` is combined with an args array,
  // because it only concatenates them. Compose one quoted command line instead.
  return { command: joinCommandLine(config.command, config.args, platform), args: [], shell: true };
}

/**
 * Build one shell command line from an executable and its arguments.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.Platform} [platform]
 */
export function joinCommandLine(command, args, platform = process.platform) {
  return [command, ...args].map((token) => quoteToken(token, platform)).join(' ');
}

/**
 * @param {string} token
 * @param {NodeJS.Platform} platform
 */
function quoteToken(token, platform) {
  if (token === '') return platform === 'win32' ? '""' : "''";
  if (platform === 'win32') {
    return /[\s"&|<>^()%!]/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token;
  }
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

/**
 * Start the Hermes ACP child process.
 *
 * @param {{command: string, args: string[], env: Record<string,string>, shell: true|false|'auto'}} config
 * @param {{platform?: NodeJS.Platform, spawnImpl?: typeof spawn}} [options]
 */
export function spawnChild(config, options = {}) {
  const platform = options.platform ?? process.platform;
  const spawnImpl = options.spawnImpl ?? spawn;
  const plan = buildSpawnArgs(config, platform);
  return spawnImpl(plan.command, plan.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...config.env },
    shell: plan.shell,
    windowsHide: true,
  });
}

/**
 * Turn a spawn failure into an actionable message.
 *
 * @param {NodeJS.ErrnoException} error
 * @param {string} command
 */
export function describeSpawnError(error, command) {
  if (error && error.code === 'ENOENT') {
    return [
      `Could not start "${command}".`,
      'Install Hermes Agent and make sure it is on PATH, or set --command /',
      'ZED_HERMES_COMMAND / "command" in ~/.config/zed-hermes/config.json.',
    ].join(' ');
  }
  return `Could not start "${command}": ${error instanceof Error ? error.message : String(error)}`;
}
