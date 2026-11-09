import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { AcpBridge } from '../lib/proxy.js';
import { FakeChild, createSink, parse, write } from './helpers/fake-child.js';

const CATALOG = [
  { name: 'plan', description: 'Plan without executing', hint: '[task]' },
  { name: 'diff', description: 'Show git changes' },
];

/**
 * @param {Partial<import('../lib/config.js').BridgeConfig>} [overrides]
 */
function setup(overrides = {}) {
  const child = new FakeChild();
  const input = new PassThrough();
  const output = createSink();
  const inbox = createSink(child.stdin);
  const errors = createSink(child.stderr);
  const logs = createSink();
  const bridge = new AcpBridge({
    child,
    input,
    output: output.stream,
    error: logs.stream,
    config: {
      command: 'mock',
      args: [],
      env: {},
      shell: false,
      synthesize: true,
      synthesizeDelayMs: 5000,
      commands: CATALOG,
      ...overrides,
    },
  });
  bridge.start();
  return { child, input, output, inbox, bridge, errors, logs };
}

test('augments an upstream advertisement and leaves session/new params untouched', async (t) => {
  const { child, input, output, inbox, logs, bridge } = setup();
  t.after(() => bridge.stop());

  const sessionNew = {
    jsonrpc: '2.0',
    id: 1,
    method: 'session/new',
    params: {
      cwd: 'C:/work',
      mcpServers: [{ name: 'zed-github', command: 'npx', args: ['-y', 'github-mcp'] }],
    },
  };
  const rawRequest = JSON.stringify(sessionNew);
  write(input, sessionNew);

  await inbox.waitFor((lines) => lines.length === 1);
  assert.equal(inbox.lines[0], rawRequest, 'session/new must reach Hermes byte-for-byte');
  assert.ok(
    logs.lines.some((line) => line.includes('forwarding 1 MCP server(s) from Zed: zed-github')),
    'the bridge should report forwarded MCP servers',
  );

  write(child.stdout, { jsonrpc: '2.0', id: 1, result: { sessionId: 's1' } });
  write(child.stdout, {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 's1',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'help', description: 'List available commands' }],
      },
    },
  });

  await output.waitFor((lines) => lines.length === 2);
  assert.deepEqual(parse(output.lines[0]).result, { sessionId: 's1' });
  const update = parse(output.lines[1]);
  assert.equal(update.params.update.sessionUpdate, 'available_commands_update');
  assert.deepEqual(
    update.params.update.availableCommands.map((command) => command.name),
    ['help', 'plan', 'diff'],
  );
  assert.deepEqual(update.params.update.availableCommands[1].input, { hint: '[task]' });
});

test('synthesizes an update after the session response when Hermes sends none', async (t) => {
  const { child, input, output, inbox, bridge } = setup({ synthesizeDelayMs: 0 });
  t.after(() => bridge.stop());

  write(input, { jsonrpc: '2.0', id: 7, method: 'session/new', params: { cwd: '/w', mcpServers: [] } });
  await inbox.waitFor((lines) => lines.length === 1);
  write(child.stdout, { jsonrpc: '2.0', id: 7, result: { sessionId: 's2' } });

  await output.waitFor((lines) => lines.length === 2);
  assert.deepEqual(parse(output.lines[0]).result, { sessionId: 's2' });
  const update = parse(output.lines[1]);
  assert.equal(update.method, 'session/update');
  assert.equal(update.params.sessionId, 's2');
  assert.deepEqual(
    update.params.update.availableCommands.map((command) => command.name),
    ['plan', 'diff'],
  );
});

test('a late upstream advertisement is still augmented instead of re-synthesized', async (t) => {
  const { child, input, output, bridge } = setup({ synthesizeDelayMs: 0 });
  t.after(() => bridge.stop());

  write(input, { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/w' } });
  write(child.stdout, { jsonrpc: '2.0', id: 2, result: { sessionId: 's3' } });
  await output.waitFor((lines) => lines.length === 2);

  write(child.stdout, {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 's3',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'help', description: 'List available commands' }],
      },
    },
  });
  await output.waitFor((lines) => lines.length === 3);

  const last = parse(output.lines[2]);
  assert.deepEqual(
    last.params.update.availableCommands.map((command) => command.name),
    ['help', 'plan', 'diff'],
  );
});

test('repeated upstream updates never duplicate the extras', async (t) => {
  const { child, input, output, bridge } = setup();
  t.after(() => bridge.stop());

  const update = (text) => ({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 's4',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'help', description: text }],
      },
    },
  });

  write(input, { jsonrpc: '2.0', id: 3, method: 'session/new', params: { cwd: '/w' } });
  write(child.stdout, { jsonrpc: '2.0', id: 3, result: { sessionId: 's4' } });
  write(child.stdout, update('first'));
  write(child.stdout, update('second'));

  await output.waitFor((lines) => lines.length === 3);
  for (const line of output.lines.slice(1)) {
    const names = parse(line).params.update.availableCommands.map((command) => command.name);
    assert.deepEqual(names, ['help', 'plan', 'diff']);
  }
});

test('synthesis can be disabled', async (t) => {
  const { child, input, output, bridge } = setup({ synthesize: false, synthesizeDelayMs: 0 });
  t.after(() => bridge.stop());

  write(input, { jsonrpc: '2.0', id: 4, method: 'session/new', params: { cwd: '/w' } });
  write(child.stdout, { jsonrpc: '2.0', id: 4, result: { sessionId: 's5' } });

  await output.waitFor((lines) => lines.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(output.lines.length, 1);
});

test('an empty catalog leaves upstream advertisements untouched', async (t) => {
  const { child, input, output, bridge } = setup({ commands: [], synthesize: false, synthesizeDelayMs: 0 });
  t.after(() => bridge.stop());

  const notification = {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 's6',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'help', description: 'List available commands' }],
      },
    },
  };

  write(input, { jsonrpc: '2.0', id: 6, method: 'session/new', params: { cwd: '/w' } });
  write(child.stdout, { jsonrpc: '2.0', id: 6, result: { sessionId: 's6' } });
  write(child.stdout, notification);

  await output.waitFor((lines) => lines.length === 2);
  assert.equal(output.lines[1], JSON.stringify(notification));
});

test('non-JSON agent output is forwarded verbatim', async (t) => {
  const { child, output, bridge } = setup();
  t.after(() => bridge.stop());

  child.stdout.write('this is not json\n');
  await output.waitFor((lines) => lines.length === 1);
  assert.equal(output.lines[0], 'this is not json');
});

test('child exit is propagated with its code', async (t) => {
  const { child, bridge } = setup();
  child.exit(7);
  const info = await bridge.waitForExit();
  assert.deepEqual(info, { code: 7, signal: null });
  assert.equal(bridge._exitInfo.code, 7);
  t.after(() => bridge.stop());
});

test('stop() signals the child and resolves', async (t) => {
  const { child, bridge } = setup();
  t.after(() => bridge.stop());
  await bridge.stop('SIGTERM');
  assert.deepEqual(child.killed, ['SIGTERM']);
});
