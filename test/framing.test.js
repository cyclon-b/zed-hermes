import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { parseJsonLine, readLines, stringifyJson } from '../lib/framing.js';

async function collect(chunks) {
  const stream = new PassThrough();
  const lines = [];
  const done = (async () => {
    for await (const line of readLines(stream)) lines.push(line);
  })();
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  await done;
  return lines;
}

test('readLines reassembles lines split across chunks and strips CR', async () => {
  const lines = await collect(['{"a":', '1}\r\n{"b"', ':2}\n']);
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test('readLines yields a final unterminated line', async () => {
  assert.deepEqual(await collect(['{"a":1}']), ['{"a":1}']);
});

test('readLines does not split on a bare carriage return', async () => {
  assert.deepEqual(await collect(['{"a":1}\r{"b":2}\n']), ['{"a":1}\r{"b":2}']);
});

test('readLines keeps empty lines out of JSON parsing but yields them', async () => {
  assert.deepEqual(await collect(['\n']), ['']);
});

test('readLines decodes multi-byte UTF-8 split across chunks', async () => {
  const payload = Buffer.from(`${JSON.stringify({ text: 'привет' })}\n`, 'utf8');
  const lines = await collect([payload.subarray(0, 12), payload.subarray(12)]);
  assert.equal(JSON.parse(lines[0]).text, 'привет');
});

test('parseJsonLine rejects non-objects and invalid JSON', () => {
  assert.equal(parseJsonLine(''), null);
  assert.equal(parseJsonLine('   '), null);
  assert.equal(parseJsonLine('not json'), null);
  assert.equal(parseJsonLine('null'), null);
  assert.equal(parseJsonLine('42'), null);
  assert.deepEqual(parseJsonLine('{"id":1}'), { id: 1 });
});

test('stringifyJson returns null for circular input', () => {
  const value = { name: 'x' };
  value.self = value;
  assert.equal(stringifyJson(value), null);
  assert.equal(stringifyJson({ a: 1 }), '{"a":1}');
});
