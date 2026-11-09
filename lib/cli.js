/**
 * CLI entry: configuration, child spawn, signal handling, exit codes.
 *
 * @module cli
 */

import { readFileSync } from 'node:fs';

import { parseArgs, resolveConfig, configSummary } from './config.js';
import { AcpBridge } from './proxy.js';
import { describeSpawnError, spawnChild } from './spawn.js';

const HELP = `zed-hermes — Hermes Agent integration for Zed

Usage:
  zed-hermes [options] [-- <hermes args>]

The bridge starts "hermes acp" and proxies ACP over stdio. It appends the
configured command catalog to available_commands_update so the commands are
visible in Zed's "/" menu. All other traffic, including the mcpServers that Zed
sends in session/new, is forwarded untouched.

Options:
  --command <path>       Executable to start (default: hermes)
  --args <json>          JSON array of arguments (default: ["acp"])
  --env <json>           JSON object of extra environment variables
  --config <path>        Config file (default: per-user config.json)
  --commands <json>      JSON array of commands to advertise
  --delay-ms <n>         Delay before synthesizing an update (default: 300)
  --synthesize           Emit an update when Hermes sends none (default: on)
  --no-synthesize        Never synthesize
  --shell / --no-shell   Force or forbid shell spawning
  --print-config         Print the effective config and exit
  --version, -v          Print the bridge version
  --help, -h             Show this help

Environment:
  ZED_HERMES_COMMAND, ZED_HERMES_ARGS, ZED_HERMES_ENV, ZED_HERMES_CONFIG,
  ZED_HERMES_COMMANDS, ZED_HERMES_SHELL, ZED_HERMES_SYNTHESIZE,
  ZED_HERMES_DELAY_MS
`;

/**
 * @param {string[]} argv
 * @returns {Promise<number>} process exit code
 */
export async function main(argv) {
  /** @type {Record<string, unknown>} */
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (cause) {
    process.stderr.write(`zed-hermes: ${messageOf(cause)}\n`);
    return 2;
  }

  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (flags.version) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  /** @type {import('./config.js').BridgeConfig} */
  let config;
  try {
    config = resolveConfig({ flags: { ...flags }, env: process.env });
  } catch (cause) {
    process.stderr.write(`zed-hermes: invalid configuration: ${messageOf(cause)}\n`);
    return 2;
  }

  if (flags.printConfig) {
    process.stdout.write(`${JSON.stringify(configSummary(config), null, 2)}\n`);
    return 0;
  }

  const child = spawnChild(config);
  child.once('error', (cause) => {
    process.stderr.write(`zed-hermes: ${describeSpawnError(cause, config.command)}\n`);
  });

  const bridge = new AcpBridge({
    child,
    input: process.stdin,
    output: process.stdout,
    error: process.stderr,
    config,
  });
  bridge.start();

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    void bridge.stop(signal);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGTERM'));

  const exit = await bridge.waitForExit();
  if (exit.code !== null) return exit.code;
  return stopping ? 0 : 1;
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return `zed-hermes ${pkg.version}`;
  } catch {
    return 'zed-hermes (unknown version)';
  }
}

/** @param {unknown} cause */
function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
