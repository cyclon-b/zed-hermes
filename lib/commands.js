/**
 * Command catalog for the Zed <-> Hermes ACP bridge.
 *
 * Hermes already advertises a fixed set of commands over ACP
 * (`acp_adapter/gateway_session_meta.py`). Every other slash command typed in
 * the editor is still forwarded to the gateway's `slash.exec`, so it runs — it
 * just never shows up in Zed's `/` menu because it is not advertised.
 *
 * This module owns the curated list that the bridge adds to
 * `available_commands_update`.
 *
 * @module commands
 */

/** Commands Hermes advertises on its own. Kept for collision checks and docs. */
export const BUILTIN_ADVERTISED = Object.freeze([
  'help',
  'model',
  'tools',
  'context',
  'reset',
  'compress',
  'steer',
  'queue',
  'usage',
  'status',
  'version',
  'title',
  'undo',
  'retry',
]);

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Extra commands advertised by default.
 *
 * Every entry is a real Hermes slash command that the gateway serves; the
 * bridge only makes it visible in Zed's command menu. `/yolo` and `/skills`
 * are powerful or partial — see `docs/commands.md` before using them.
 */
export const DEFAULT_CATALOG = Object.freeze([
  {
    name: 'plan',
    description: 'Write an implementation plan to .hermes/plans/ without executing it',
    hint: '[task]',
  },
  {
    name: 'init',
    description: 'Generate or update AGENTS.md from a repository scan',
    hint: '[notes]',
  },
  {
    name: 'diff',
    description: 'Show git changes in the working directory',
    hint: '[staged|all|session] [--stat]',
  },
  {
    name: 'goal',
    description: 'Set a standing goal Hermes keeps working toward across turns',
    hint: '[<objective>|status|pause|resume|clear]',
  },
  {
    name: 'learn',
    description: 'Distill a reusable skill from a directory, URL, workflow or notes',
    hint: '<what to learn from>',
  },
  {
    name: 'review',
    description: 'Spawn an independent reviewer subagent for the work just discussed',
    hint: '[instructions]',
  },
  {
    name: 'memory',
    description: 'Review pending memory writes and toggle the write gate',
    hint: '[pending|approve|reject|approval]',
  },
  {
    name: 'rollback',
    description: 'List or restore filesystem checkpoints',
    hint: '[number]',
  },
  {
    name: 'branch',
    description: 'Branch the current session into an independent copy',
    hint: '[--here] [name]',
  },
  {
    name: 'refine',
    description: 'Run the memory and skill self-improvement review now',
    hint: '[focus]',
  },
  {
    name: 'btw',
    description: 'Ask a side question about the current conversation',
    hint: '<question>',
  },
  {
    name: 'bg',
    description: 'Run a prompt in a separate background session',
    hint: '<prompt>',
  },
  {
    name: 'moa',
    description: 'Run one prompt through the default Mixture of Agents preset',
    hint: '<prompt>',
  },
  {
    name: 'fast',
    description: 'Show or set fast mode for supported model routes',
    hint: '[normal|fast|auto|cold|status]',
  },
  {
    name: 'reasoning',
    description: 'Show or set reasoning effort and reasoning display',
    hint: '[level|show|hide]',
  },
  {
    name: 'skills',
    description: 'Review pending skill writes (approve, reject, diff)',
    hint: '[pending|approve|reject|diff|approval]',
  },
  {
    name: 'yolo',
    description: 'Toggle YOLO mode, which skips approval prompts',
  },
]);

/**
 * @typedef {object} CatalogCommand
 * @property {string} name
 * @property {string} description
 * @property {string} [hint]
 */

/**
 * Normalize one catalog entry, dropping entries that cannot be advertised.
 *
 * @param {unknown} entry
 * @returns {{name: string, description: string, hint?: string} | null}
 */
export function normalizeCommand(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const raw = /** @type {Record<string, unknown>} */ (entry);
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/^\//, '').toLowerCase() : '';
  if (!NAME_PATTERN.test(name)) return null;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!description) return null;
  const hint = typeof raw.hint === 'string' ? raw.hint.trim() : '';
  return hint ? { name, description, hint } : { name, description };
}

/**
 * @param {unknown} catalog
 * @returns {Array<{name: string, description: string, hint?: string}>}
 */
export function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of catalog) {
    const command = normalizeCommand(entry);
    if (!command || seen.has(command.name)) continue;
    seen.add(command.name);
    out.push(command);
  }
  return out;
}

/**
 * Convert a catalog entry to the ACP `AvailableCommand` shape.
 *
 * @param {{name: string, description: string, hint?: string}} command
 */
export function toAvailableCommand(command) {
  return {
    name: command.name,
    description: command.description,
    ...(command.hint ? { input: { hint: command.hint } } : {}),
  };
}

/**
 * Merge extra commands into a list the agent already advertised.
 *
 * Upstream always wins: an extra whose name is already present is skipped, and
 * order is preserved (upstream first, extras appended).
 *
 * @param {Array<Record<string, unknown>>} upstream ACP `AvailableCommand` list
 * @param {Array<{name: string, description: string, hint?: string}>} extras
 */
export function mergeCommands(upstream, extras) {
  const base = Array.isArray(upstream) ? upstream : [];
  const seen = new Set(
    base
      .map((command) => (command && typeof command.name === 'string' ? command.name : ''))
      .filter(Boolean),
  );
  const merged = [...base];
  for (const command of normalizeCatalog(extras)) {
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    merged.push(toAvailableCommand(command));
  }
  return merged;
}

/**
 * Names from the catalog that shadow a command Hermes already advertises.
 *
 * @param {Array<{name: string, description: string, hint?: string}>} catalog
 */
export function shadowedByBuiltins(catalog) {
  const builtins = new Set(BUILTIN_ADVERTISED);
  return normalizeCatalog(catalog)
    .map((command) => command.name)
    .filter((name) => builtins.has(name));
}
