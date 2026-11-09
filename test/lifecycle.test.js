import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const BIN = fileURLToPath(new URL('../bin/zed-hermes.js', import.meta.url));

test('the CLI exits with the child code even while the client keeps stdin open', async () => {
  const child = spawn(
    process.execPath,
    [BIN, '--command', process.execPath, '--args', JSON.stringify(['-e', 'process.exit(3)'])],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`bridge did not exit within 5s; stderr:\n${stderr}`));
    }, 5000);
    timer.unref?.();
    child.on('exit', (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });

  assert.equal(code, 3);
  assert.doesNotMatch(stderr, /DeprecationWarning/, 'spawn must not trigger DEP0190');
});
