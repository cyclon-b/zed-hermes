#!/usr/bin/env node
/**
 * End-to-end probe: starts the bridge exactly as Zed would, speaks ACP over
 * stdio, and checks the advertised command catalog.
 *
 *   npm run probe                 # against the real `hermes acp`
 *   npm run probe -- --mock       # against the bundled mock agent (CI)
 *   npm run doctor                # environment checks only
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CATALOG } from '../lib/commands.js';
import { parseJsonLine, readLines, writeLine } from '../lib/framing.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'zed-hermes.js');
const MOCK = resolve(HERE, '..', 'scripts', 'fixtures', 'mock-acp.mjs');

const HELP = `Usage: node scripts/probe.mjs [options] [-- <bridge flags>]

Options:
  --doctor            Check node + hermes + the ACP extra, then exit
  --mock              Use the bundled mock ACP agent instead of hermes
  --prompt <slash>    Slash command to send after session/new (default: /version)
  --mcp <json>        JSON array of MCP servers for session/new (default: [])
  --timeout-ms <n>    Per-step timeout (default: 20000)
  --help, -h          Show this help

Bridge flags after \`--\` are passed to bin/zed-hermes.js (for example
\`-- --command /path/to/hermes\`).`;

function parse(argv) {
  const options = {
    doctor: false,
    mock: false,
    prompt: '/version',
    mcp: [],
    timeoutMs: 20000,
    bridgeArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--') {
      options.bridgeArgs = argv.slice(index + 1);
      break;
    }
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--doctor') options.doctor = true;
    else if (arg === '--mock') options.mock = true;
    else if (arg === '--prompt') options.prompt = next();
    else if (arg === '--mcp') options.mcp = JSON.parse(next());
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next());
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return options;
}

function doctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node >= 22', ok: nodeMajor >= 22, detail: process.versions.node });

  const locate = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['hermes'], {
    encoding: 'utf8',
    shell: false,
  });
  const hermesPath = (locate.stdout || '').split(/\r?\n/).find(Boolean) || null;
  checks.push({
    name: 'hermes on PATH',
    ok: locate.status === 0,
    detail: hermesPath || 'not found — install Hermes Agent, or set --command',
  });

  if (locate.status === 0) {
    const version = spawnSync('hermes', ['acp', '--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 20000,
    });
    const output = `${version.stdout || ''}${version.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean);
    checks.push({
      name: 'hermes acp --version',
      ok: version.status === 0,
      detail: output.slice(-3).join(' | ') || `exit ${version.status}`,
    });
    if (version.status !== 0) {
      checks.push({
        name: 'ACP extra',
        ok: false,
        detail:
          'install it in the Hermes checkout: python -c "import pm; pm.sync_venv([\'acp\'], explicit=True)"',
      });
    }
  }

  let config = null;
  try {
    config = JSON.parse(readFileSync(resolve(HERE, '..', 'package.json'), 'utf8')).version;
  } catch {
    // Version is informational.
  }
  process.stdout.write(`zed-hermes ${config ?? '(unknown version)'}\n`);
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}\n`);
  }
  return checks.every((check) => check.ok) ? 0 : 1;
}

async function runProbe(options) {
  const childArgs = [BIN];
  if (options.mock) {
    childArgs.push('--command', process.execPath, '--args', JSON.stringify([MOCK]));
  }
  childArgs.push(...options.bridgeArgs);

  const child = spawn(process.execPath, childArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const stderrLines = [];
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line) stderrLines.push(line);
      if (stderrLines.length > 40) stderrLines.shift();
    }
  });

  /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void}>} */
  const pending = new Map();
  const notifications = [];
  let nextId = 0;
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
    for (const [, entry] of pending) entry.reject(new Error(`bridge exited (${code ?? signal})`));
    pending.clear();
  });

  const readLoop = (async () => {
    for await (const line of readLines(child.stdout)) {
      const message = parseJsonLine(line);
      if (!message) continue;
      if (message.id !== undefined && message.method === undefined) {
        const entry = pending.get(Number(message.id));
        if (!entry) continue;
        pending.delete(Number(message.id));
        if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else entry.resolve(message.result);
      } else if (typeof message.method === 'string') {
        notifications.push(message);
      }
    }
  })();

  const request = (method, params) => {
    const id = ++nextId;
    const response = new Promise((resolvePromise, rejectPromise) => {
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    });
    void writeLine(child.stdin, JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return withTimeout(response, options.timeoutMs, method);
  };

  try {
    const init = await request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
    process.stdout.write(`initialize: ok (protocolVersion ${init?.protocolVersion ?? '?'})\n`);

    const session = await request('session/new', { cwd: process.cwd(), mcpServers: options.mcp });
    const sessionId = session?.sessionId;
    process.stdout.write(`session/new: ${sessionId ?? '(no id)'}\n`);
    if (!sessionId) throw new Error('session/new returned no sessionId');

    const update = await waitForUpdate(notifications, sessionId, options.timeoutMs);
    const names = update.params.update.availableCommands.map((command) => command.name);
    const extraNames = DEFAULT_CATALOG.map((command) => command.name);
    const missing = extraNames.filter((name) => !names.includes(name));
    process.stdout.write(`available_commands_update: ${names.join(', ')}\n`);
    if (missing.length > 0) {
      throw new Error(
        `advertised commands are missing: ${missing.join(', ')}. ` +
          'Hermes may have changed its command surface; check docs/commands.md.',
      );
    }
    process.stdout.write(`extras advertised: ${extraNames.join(', ')}\n`);

    const promptResult = await request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: options.prompt }],
    });
    const text = notifications
      .filter(
        (message) =>
          message.method === 'session/update' &&
          message.params?.sessionId === sessionId &&
          message.params?.update?.sessionUpdate === 'agent_message_chunk',
      )
      .map((message) => message.params.update.content?.text || '')
      .join('');
    process.stdout.write(`prompt ${options.prompt}: ${text || `(no text, stopReason=${promptResult?.stopReason})`}\n`);
    process.stdout.write('result: ok\n');
    return 0;
  } catch (cause) {
    process.stderr.write(`probe failed: ${cause instanceof Error ? cause.message : cause}\n`);
    if (stderrLines.length > 0) process.stderr.write(`bridge stderr:\n${stderrLines.join('\n')}\n`);
    return 1;
  } finally {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already gone.
    }
    await withTimeout(readLoop, 2000, 'shutdown').catch(() => {});
    if (exited === null) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

async function waitForUpdate(notifications, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = notifications.find(
      (message) =>
        message.method === 'session/update' &&
        message.params?.sessionId === sessionId &&
        message.params?.update?.sessionUpdate === 'available_commands_update',
    );
    if (found) return found;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('no available_commands_update arrived');
}

const options = parse(process.argv.slice(2));
if (options.help) {
  process.stdout.write(`${HELP}\n`);
  process.exitCode = 0;
} else if (options.doctor) {
  process.exitCode = doctor();
} else {
  runProbe(options).then((code) => {
    process.exitCode = code;
  });
}
