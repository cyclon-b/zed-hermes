import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  configFromEnv,
  defaultConfigPath,
  parseArgs,
  resolveConfig,
} from '../lib/config.js';

const ISOLATED_ENV = {
  ZED_HERMES_CONFIG: join(tmpdir(), 'zed-hermes-test-no-config.json'),
};

test('parseArgs collects flags, inline values and passthrough args', () => {
  const flags = parseArgs([
    '--command=hermes-dev',
    '--delay-ms',
    '25',
    '--no-synthesize',
    '--commands',
    '[{"name":"plan","description":"Plan"}]',
    '--',
    'acp',
    '--check',
  ]);
  assert.equal(flags.command, 'hermes-dev');
  assert.equal(flags.synthesizeDelayMs, 25);
  assert.equal(flags.synthesize, false);
  assert.deepEqual(flags.commands, [{ name: 'plan', description: 'Plan' }]);
  assert.deepEqual(flags.passthrough, ['acp', '--check']);
});

test('parseArgs rejects unknown flags and missing values', () => {
  assert.throws(() => parseArgs(['--wat']), /Unknown flag/);
  assert.throws(() => parseArgs(['--command']), /requires a value/);
  assert.throws(() => parseArgs(['positional']), /Unexpected argument/);
});

test('configFromEnv parses booleans and JSON', () => {
  const env = configFromEnv({
    ZED_HERMES_COMMAND: 'hermes2',
    ZED_HERMES_ARGS: '["acp"]',
    ZED_HERMES_SHELL: '0',
    ZED_HERMES_SYNTHESIZE: 'false',
    ZED_HERMES_DELAY_MS: '50',
    ZED_HERMES_ENV: '{"FOO":"bar"}',
  });
  assert.equal(env.command, 'hermes2');
  assert.deepEqual(env.args, ['acp']);
  assert.equal(env.shell, false);
  assert.equal(env.synthesize, false);
  assert.equal(env.synthesizeDelayMs, 50);
  assert.deepEqual(env.env, { FOO: 'bar' });
});

test('resolveConfig applies file < env < CLI precedence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zed-hermes-config-'));
  try {
    const file = join(dir, 'config.json');
    writeFileSync(
      file,
      JSON.stringify({
        command: 'from-file',
        synthesizeDelayMs: 10,
        commands: [{ name: 'filecmd', description: 'From the file' }],
        ignoredKey: true,
      }),
    );
    const config = resolveConfig({
      flags: { config: file, command: 'from-cli' },
      env: { ZED_HERMES_DELAY_MS: '99' },
    });
    assert.equal(config.command, 'from-cli');
    assert.equal(config.synthesizeDelayMs, 99);
    assert.deepEqual(config.commands.map((command) => command.name), ['filecmd']);
    assert.equal(config.configPath, file);
    assert.equal('ignoredKey' in config, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveConfig defaults to `hermes acp` and the default catalog', () => {
  const config = resolveConfig({ flags: {}, env: ISOLATED_ENV });
  assert.equal(config.command, 'hermes');
  assert.deepEqual(config.args, ['acp']);
  assert.ok(config.commands.length > 0);
  assert.equal(config.synthesize, true);
});

test('explicit missing config file is an error, default one is not', () => {
  assert.throws(
    () => resolveConfig({ flags: { config: join(tmpdir(), 'definitely-missing-zed-hermes.json') } }),
    /Config file not found/,
  );
  const config = resolveConfig({
    flags: {},
    env: {
      ZED_HERMES_CONFIG: join(tmpdir(), 'definitely-missing-zed-hermes-default.json'),
    },
  });
  assert.equal(config.configPath, undefined);
});

test('defaultConfigPath is platform-aware', () => {
  assert.match(defaultConfigPath('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }), /zed-hermes/);
  assert.match(defaultConfigPath('linux', { XDG_CONFIG_HOME: '/home/x/.config' }), /zed-hermes/);
  assert.match(defaultConfigPath('darwin', {}), /Application Support/);
});

test('shell accepts auto and string boolean spellings', () => {
  assert.equal(configFromEnv({ ZED_HERMES_SHELL: 'auto' }).shell, 'auto');
  assert.equal(resolveConfig({ flags: {}, env: { ...ISOLATED_ENV, ZED_HERMES_SHELL: 'auto' } }).shell, 'auto');
  assert.equal(resolveConfig({ flags: {}, env: { ...ISOLATED_ENV, ZED_HERMES_SHELL: 'false' } }).shell, false);
  assert.equal(resolveConfig({ flags: { shell: false }, env: ISOLATED_ENV }).shell, false);
});
