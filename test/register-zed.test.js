import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  buildEntry,
  isOurEntry,
  parseJsonc,
  updateSettingsFile,
  zedSettingsPath,
} from '../scripts/register-zed.mjs';

function tempSettings(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'zed-hermes-zed-'));
  const path = join(dir, 'settings.json');
  if (contents !== undefined) writeFileSync(path, contents);
  return { dir, path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('adds the agent entry and preserves unrelated settings', (t) => {
  const { path, cleanup } = tempSettings(JSON.stringify({ theme: 'One Dark' }));
  t.after(cleanup);

  const result = updateSettingsFile(path, { entry: buildEntry({ bridge: '/repo/bin/zed-hermes.js' }) });
  assert.equal(result.changed, true);
  assert.ok(existsSync(result.backupPath));

  const settings = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(settings.theme, 'One Dark');
  assert.deepEqual(settings.agent_servers.Hermes.args, ['/repo/bin/zed-hermes.js']);
  assert.equal(settings.agent_servers.Hermes.type, 'custom');
});

test('is idempotent', (t) => {
  const { path, cleanup } = tempSettings('{}');
  t.after(cleanup);

  const entry = buildEntry({ bridge: '/repo/bin/zed-hermes.js' });
  assert.equal(updateSettingsFile(path, { entry }).changed, true);
  const second = updateSettingsFile(path, { entry });
  assert.equal(second.changed, false);
  assert.equal(readdirSync(dirname(path)).filter((name) => name.endsWith('.bak')).length, 1);
});

test('revert removes only our entry', (t) => {
  const { path, cleanup } = tempSettings(
    JSON.stringify({
      agent_servers: {
        Hermes: buildEntry({ bridge: '/repo/bin/zed-hermes.js' }),
        Other: { type: 'custom', command: 'other', args: [] },
      },
    }),
  );
  t.after(cleanup);

  const result = updateSettingsFile(path, { revert: true, bridge: '/repo/bin/zed-hermes.js' });
  assert.equal(result.changed, true);
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal('Hermes' in settings.agent_servers, false);
  assert.equal(settings.agent_servers.Other.command, 'other');
});

test('revert refuses to delete a foreign entry unless forced', (t) => {
  const { path, cleanup } = tempSettings(
    JSON.stringify({ agent_servers: { Hermes: { type: 'custom', command: 'other', args: [] } } }),
  );
  t.after(cleanup);

  assert.throws(() => updateSettingsFile(path, { revert: true }), /--force/);
  const forced = updateSettingsFile(path, { revert: true, force: true });
  assert.equal(forced.changed, true);
  assert.equal(isOurEntry(JSON.parse(readFileSync(path, 'utf8')).agent_servers?.Hermes), false);
});

test('malformed settings are reported, never overwritten', (t) => {
  const original = '{ "theme": }\n';
  const { path, cleanup } = tempSettings(original);
  t.after(cleanup);

  assert.throws(() => updateSettingsFile(path, {}), /Invalid JSON value|Expected/);
  assert.equal(readFileSync(path, 'utf8'), original);
});

test('adds the entry to JSONC without touching comments', (t) => {
  const original = [
    '// Zed settings',
    '{',
    '  // appearance',
    '  "theme": "One Dark",',
    '  "agent_servers": {',
    '    "Other": { "type": "custom", "command": "other", "args": [] },',
    '  },',
    '}',
    '',
  ].join('\n');
  const { path, cleanup } = tempSettings(original);
  t.after(cleanup);

  const result = updateSettingsFile(path, { entry: buildEntry({ bridge: '/repo/bin/zed-hermes.js' }) });
  assert.equal(result.changed, true);
  const text = readFileSync(path, 'utf8');
  assert.match(text, /\/\/ Zed settings/);
  assert.match(text, /\/\/ appearance/);
  assert.match(text, /"Other"/);

  const settings = parseJsonc(text).value;
  assert.deepEqual(settings.agent_servers.Hermes.args, ['/repo/bin/zed-hermes.js']);
  assert.equal(settings.agent_servers.Other.command, 'other');
});

test('revert from JSONC keeps comments and other agents', (t) => {
  const original = [
    '{',
    '  // keep me',
    '  "agent_servers": {',
    '    "Hermes": {',
    '      "type": "custom",',
    '      "command": "node",',
    '      "args": ["/repo/bin/zed-hermes.js"],',
    '      "env": {},',
    '    },',
    '    "Other": { "type": "custom", "command": "other", "args": [] },',
    '  },',
    '  "theme": "One Dark",',
    '}',
    '',
  ].join('\n');
  const { path, cleanup } = tempSettings(original);
  t.after(cleanup);

  const result = updateSettingsFile(path, {
    revert: true,
    bridge: '/repo/bin/zed-hermes.js',
  });
  assert.equal(result.changed, true);
  const text = readFileSync(path, 'utf8');
  assert.match(text, /\/\/ keep me/);

  const settings = parseJsonc(text).value;
  assert.equal('Hermes' in settings.agent_servers, false);
  assert.equal(settings.agent_servers.Other.command, 'other');
  assert.equal(settings.theme, 'One Dark');
});

test('creates agent_servers when the JSONC file has none', (t) => {
  const original = '{\n  // only a theme\n  "theme": "x",\n}\n';
  const { path, cleanup } = tempSettings(original);
  t.after(cleanup);

  updateSettingsFile(path, { entry: buildEntry({ bridge: '/repo/bin/zed-hermes.js' }) });
  const text = readFileSync(path, 'utf8');
  assert.match(text, /\/\/ only a theme/);
  assert.deepEqual(parseJsonc(text).value.agent_servers.Hermes.args, ['/repo/bin/zed-hermes.js']);
});

test('dry run does not write', (t) => {
  const { path, cleanup } = tempSettings(JSON.stringify({ theme: 'x' }));
  t.after(cleanup);

  const result = updateSettingsFile(path, { dryRun: true });
  assert.equal(result.changed, true);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).agent_servers, undefined);
});

test('zedSettingsPath is platform-aware', () => {
  assert.match(zedSettingsPath('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }), /Zed[\\/]settings\.json$/);
  assert.match(zedSettingsPath('linux', { XDG_CONFIG_HOME: '/home/x/.config' }), /zed[\\/]settings\.json$/);
  assert.match(zedSettingsPath('darwin', {}), /Application Support[\\/]Zed[\\/]settings\.json$/);
});
