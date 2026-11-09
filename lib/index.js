/**
 * Public API surface.
 *
 * @module zed-hermes
 */

export { AcpBridge } from './proxy.js';
export {
  BUILTIN_ADVERTISED,
  DEFAULT_CATALOG,
  OPTIONAL_CATALOG,
  mergeCommands,
  normalizeCatalog,
  shadowedByBuiltins,
  toAvailableCommand,
} from './commands.js';
export {
  DEFAULT_CONFIG,
  configFromEnv,
  configSummary,
  defaultConfigPath,
  loadConfigFile,
  parseArgs,
  resolveConfig,
} from './config.js';
export { spawnChild, buildSpawnArgs, joinCommandLine, needsShell, describeSpawnError } from './spawn.js';
export { main } from './cli.js';
