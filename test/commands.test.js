import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_ADVERTISED,
  DEFAULT_CATALOG,
  mergeCommands,
  normalizeCatalog,
  shadowedByBuiltins,
} from '../lib/commands.js';

test('default catalog is valid and does not shadow Hermes builtins', () => {
  const catalog = normalizeCatalog(DEFAULT_CATALOG);
  assert.equal(catalog.length, DEFAULT_CATALOG.length);
  assert.deepEqual(shadowedByBuiltins(catalog), []);
  for (const command of catalog) {
    assert.match(command.name, /^[a-z][a-z0-9_-]*$/);
    assert.ok(command.description.length > 0);
  }
});

test('catalog includes the previously opt-in commands', () => {
  const names = new Set(DEFAULT_CATALOG.map((command) => command.name));
  for (const name of ['btw', 'bg', 'moa', 'fast', 'reasoning', 'skills', 'yolo']) {
    assert.equal(names.has(name), true, `${name} must be advertised by default`);
  }
});

test('mergeCommands appends missing extras and keeps upstream order', () => {
  const upstream = [
    { name: 'help', description: 'builtin' },
    { name: 'plan', description: 'stale upstream description' },
  ];
  const merged = mergeCommands(upstream, DEFAULT_CATALOG);
  assert.deepEqual(
    merged.slice(0, 2).map((command) => command.name),
    ['help', 'plan'],
  );
  assert.equal(merged[1].description, 'stale upstream description');
  assert.equal(merged[0].description, 'builtin');
  const names = merged.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('diff'));
  assert.equal(names.filter((name) => name === 'plan').length, 1);
});

test('mergeCommands maps hints to ACP input shape and skips invalid entries', () => {
  const merged = mergeCommands([], [
    { name: 'plan', description: 'Plan', hint: '[task]' },
    { name: 'Bad Name', description: 'nope' },
    { name: 'nodesc' },
    { name: 'plan', description: 'duplicate' },
  ]);
  assert.deepEqual(merged, [
    { name: 'plan', description: 'Plan', input: { hint: '[task]' } },
  ]);
});

test('mergeCommands without extras is a no-op copy', () => {
  const upstream = [{ name: 'help', description: 'builtin' }];
  const merged = mergeCommands(upstream, []);
  assert.deepEqual(merged, upstream);
  assert.notEqual(merged, upstream);
});

test('every builtin name is known to the collision check', () => {
  assert.ok(BUILTIN_ADVERTISED.includes('model'));
  assert.deepEqual(shadowedByBuiltins([{ name: 'model', description: 'x' }]), ['model']);
});
