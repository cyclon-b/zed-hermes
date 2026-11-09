import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpawnArgs, describeSpawnError, needsShell } from '../lib/spawn.js';

test('needsShell is Windows-only and leaves .exe alone', () => {
  assert.equal(needsShell('hermes', 'linux'), false);
  assert.equal(needsShell('hermes', 'win32'), true);
  assert.equal(needsShell('hermes.cmd', 'win32'), true);
  assert.equal(needsShell('C:\\tools\\hermes.cmd', 'win32'), true);
  assert.equal(needsShell('hermes.exe', 'win32'), false);
  assert.equal(needsShell('C:\\tools\\hermes.exe', 'win32'), false);
});

test('buildSpawnArgs honours auto, true and false', () => {
  const auto = buildSpawnArgs({ command: 'hermes', args: ['acp'], shell: 'auto' }, 'win32');
  assert.equal(auto.shell, true);
  const direct = buildSpawnArgs({ command: 'hermes.exe', args: ['acp'], shell: 'auto' }, 'win32');
  assert.equal(direct.shell, false);
  const forced = buildSpawnArgs({ command: 'hermes', args: ['acp'], shell: true }, 'linux');
  assert.equal(forced.shell, true);
  const off = buildSpawnArgs({ command: 'hermes', args: ['acp'], shell: false }, 'win32');
  assert.equal(off.shell, false);
  assert.deepEqual(off.args, ['acp']);
});

test('describeSpawnError explains ENOENT and passes other errors through', () => {
  assert.match(describeSpawnError(Object.assign(new Error('x'), { code: 'ENOENT' }), 'hermes'), /Install Hermes Agent/);
  assert.match(describeSpawnError(new Error('boom'), 'hermes'), /boom/);
});
