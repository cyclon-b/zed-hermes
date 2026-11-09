/**
 * NDJSON framing for the ACP stdio transport.
 *
 * ACP sends one JSON-RPC object per `\n`-terminated line. This module keeps the
 * bridge dependency-free and backpressure-aware: writers wait for `drain`, and
 * readers consume the stream as an async iterator, which pauses the source
 * while downstream work is pending.
 *
 * @module framing
 */

import { once } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

/** Guard against a peer that never sends a newline. */
const MAX_LINE_BYTES = 64 * 1024 * 1024;

/**
 * Yield decoded lines from a readable stream.
 *
 * Accepts both `\n` and `\r\n`; a trailing `\r` is stripped, a bare `\r` is
 * never treated as a separator. A final unterminated line is yielded once the
 * stream ends.
 *
 * @param {AsyncIterable<Buffer|string>} stream
 * @returns {AsyncGenerator<string>}
 */
export async function* readLines(stream) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    if (buffer.length > MAX_LINE_BYTES && !buffer.includes('\n')) {
      throw new Error(`ACP line exceeds ${MAX_LINE_BYTES} bytes without a newline`);
    }
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      yield stripCarriageReturn(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  }
  buffer += decoder.end();
  if (buffer.length > 0) yield stripCarriageReturn(buffer);
}

/**
 * @param {string} line
 */
function stripCarriageReturn(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Write one line and respect backpressure.
 *
 * @param {import('node:stream').Writable} stream
 * @param {string} line
 */
export async function writeLine(stream, line) {
  if (stream.destroyed || stream.writableEnded) return;
  const ok = stream.write(`${line}\n`);
  if (!ok) await once(stream, 'drain');
}

/**
 * Serialize JSON without throwing on circular input.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function stringifyJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Parse one NDJSON line, returning `null` for anything that is not JSON.
 *
 * @param {string} line
 */
export function parseJsonLine(line) {
  if (!line || line.trim() === '') return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}
