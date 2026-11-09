/**
 * Test helpers: an in-memory child process and output capture.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = [];
    this.stdin.on('error', () => {});
  }

  /** @param {NodeJS.Signals | number} [signal] */
  kill(signal = 'SIGTERM') {
    this.killed.push(signal);
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }

  /** @param {number} code */
  exit(code) {
    this.emit('exit', code, null);
  }
}

/**
 * Collect lines written to a writable stream and let tests await them.
 *
 * @param {import('node:stream').Writable} [stream]
 */
export function createSink(stream = new PassThrough()) {
  /** @type {string[]} */
  const lines = [];
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      lines.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
  return {
    stream,
    lines,
    /**
     * @param {(lines: string[]) => boolean} predicate
     * @param {number} [timeoutMs]
     */
    async waitFor(predicate, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(lines)) {
        if (Date.now() > deadline) {
          throw new Error(`timed out; lines so far:\n${lines.join('\n')}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return lines;
    },
  };
}

/**
 * @param {string} line
 */
export function parse(line) {
  return JSON.parse(line);
}

/**
 * @param {import('node:stream').Writable} stream
 * @param {unknown} message
 */
export function write(stream, message) {
  stream.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
}
