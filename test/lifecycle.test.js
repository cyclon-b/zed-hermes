import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const BIN = fileURLToPath(new URL('../bin/zed-hermes.js', import.meta.url));

/**
 * Run the bridge with a child that exits immediately and with stdin kept open.
 *
 * @param {string[]} args
 */
function runWithOpenStdin(args) {
  const child = spawn(process.execPath, [BIN, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`bridge did not exit within 5s; stderr:\n${stderr}`));
    }, 5000);
    timer.unref?.();
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
  return result;
}

test('the CLI exits with the child code even while the client keeps stdin open', async () => {
  const { code, stderr } = await runWithOpenStdin([
    '--command',
    process.execPath,
    '--args',
    JSON.stringify(['-e', 'process.exit(3)']),
  ]);
  assert.equal(code, 3);
  assert.doesNotMatch(stderr, /DeprecationWarning/, 'spawn must not trigger DEP0190');
});

test(
  'shell mode runs a .cmd shim from a path with spaces',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zed-hermes shim-'));
    const shim = join(dir, 'exit4.cmd');
    writeFileSync(shim, '@echo off\r\nnode -e "process.exit(4)"\r\nexit /b %ERRORLEVEL%\r\n');
    try {
      const { code } = await runWithOpenStdin(['--command', shim]);
      assert.equal(code, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
