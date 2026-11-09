/**
 * Transparent ACP proxy between Zed and `hermes acp`.
 *
 * Responsibilities:
 *  - forward every JSON-RPC line in both directions, byte-for-byte unless a
 *    line has to be augmented;
 *  - append the curated command catalog to `available_commands_update`;
 *  - synthesize that update when Hermes never sends one;
 *  - leave `session/new` parameters (including Zed's `mcpServers`) untouched.
 *
 * @module proxy
 */

import { EventEmitter } from 'node:events';

import { mergeCommands } from './commands.js';
import { parseJsonLine, readLines, stringifyJson, writeLine } from './framing.js';

const SESSION_CREATE_METHODS = new Set(['session/new', 'session/resume', 'session/load', 'session/fork']);
const SESSION_CLOSE_METHODS = new Set(['session/close', 'session/end']);
const KILL_GRACE_MS = 2000;

/**
 * @typedef {object} SessionState
 * @property {boolean} upstreamAdvertised
 * @property {boolean} synthesized
 * @property {NodeJS.Timeout | null} timer
 */

export class AcpBridge extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('node:child_process').ChildProcess} options.child
   * @param {NodeJS.ReadableStream} options.input
   * @param {NodeJS.WritableStream} options.output
   * @param {NodeJS.WritableStream} [options.error]
   * @param {import('./config.js').BridgeConfig} options.config
   */
  constructor({ child, input, output, error, config }) {
    super();
    this.child = child;
    this.input = input;
    this.output = output;
    this.error = error ?? process.stderr;
    this.config = config;

    /** @type {Map<string, SessionState>} */
    this._sessions = new Map();
    /** @type {Map<string, {method: string, sessionId: string | null}>} */
    this._pending = new Map();
    /** @type {Promise<void>} */
    this._writeChain = Promise.resolve();
    /** @type {{code: number | null, signal: NodeJS.Signals | null} | null} */
    this._exitInfo = null;
    this._started = false;
    this._stopping = false;
    this._loggedNonJson = false;
  }

  start() {
    if (this._started) return this;
    this._started = true;

    this.child.on('error', (cause) => this._handleChildError(cause));
    this.child.on('exit', (code, signal) => this._handleChildExit(code, signal));

    if (this.child.stderr) {
      this.child.stderr.on('error', () => {});
      this.child.stderr.pipe(this.error, { end: false });
    }

    void this._pumpToAgent();
    void this._pumpToClient();
    return this;
  }

  /** Resolves with `{code, signal}` once the child exits. */
  waitForExit() {
    if (this._exitInfo) return Promise.resolve(this._exitInfo);
    return new Promise((resolve) => this.once('exit', resolve));
  }

  /**
   * Stop the child, escalating to SIGKILL after a short grace period.
   *
   * @param {NodeJS.Signals} [signal]
   */
  async stop(signal = 'SIGTERM') {
    if (this._stopping) return;
    this._stopping = true;
    this._clearTimers();

    try {
      /** @type {any} */ (this.input).destroy?.();
    } catch {
      // The client may already be gone.
    }
    try {
      this.child.stdin?.end();
    } catch {
      // Already closed.
    }
    try {
      this.child.kill(signal);
    } catch {
      // Already dead.
    }

    const exited = await Promise.race([
      this.waitForExit().then(() => true),
      sleep(KILL_GRACE_MS).then(() => false),
    ]);
    if (!exited) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // Nothing left to kill.
      }
    }

    // A child that keeps its pipes open after `exit` (or a test double that
    // never closes them) would keep the pump alive forever.
    for (const stream of [this.child.stdout, this.child.stderr]) {
      try {
        /** @type {any} */ (stream)?.destroy?.();
      } catch {
        // Already destroyed.
      }
    }
  }

  // -- client -> agent ----------------------------------------------------

  async _pumpToAgent() {
    try {
      for await (const line of readLines(/** @type {any} */ (this.input))) {
        this._inspectClientLine(line);
        await writeLine(/** @type {any} */ (this.child.stdin), line);
      }
    } catch (cause) {
      this._report(cause);
    } finally {
      try {
        this.child.stdin?.end();
      } catch {
        // Already closed.
      }
    }
  }

  /** @param {string} line */
  _inspectClientLine(line) {
    const message = parseJsonLine(line);
    if (!message || typeof message.method !== 'string') return;
    if (message.id === undefined || message.id === null) return;

    const method = message.method;
    if (method === 'session/new' && Array.isArray(message.params?.mcpServers)) {
      const count = message.params.mcpServers.length;
      if (count > 0) {
        const names = message.params.mcpServers
          .map((server) => (server && typeof server.name === 'string' ? server.name : '?'))
          .join(', ');
        this._log('info', `forwarding ${count} MCP server(s) from Zed: ${names}`);
      }
    }
    if (!SESSION_CREATE_METHODS.has(method) && !SESSION_CLOSE_METHODS.has(method)) return;

    this._pending.set(String(message.id), {
      method,
      sessionId: extractSessionId(message.params),
    });
  }

  // -- agent -> client ----------------------------------------------------

  async _pumpToClient() {
    try {
      for await (const line of readLines(/** @type {any} */ (this.child.stdout))) {
        const result = this._inspectAgentLine(line);
        await this._write(result.line);
        if (result.advertisedFor) {
          for (const sessionId of result.advertisedFor) this._markAdvertised(sessionId);
        }
        if (result.synthesizeFor) {
          for (const sessionId of result.synthesizeFor) this._scheduleSynthesis(sessionId);
        }
      }
    } catch (cause) {
      this._report(cause);
    }
  }

  /**
   * @param {string} line
   * @returns {{line: string, advertisedFor?: string[], synthesizeFor?: string[]}}
   */
  _inspectAgentLine(line) {
    const message = parseJsonLine(line);
    if (!message) {
      if (!this._loggedNonJson && line.trim() !== '') {
        this._loggedNonJson = true;
        this._log('warning', 'agent wrote a non-JSON line to stdout; forwarded verbatim');
      }
      return { line };
    }

    // Response to a client request.
    if (message.id !== undefined && message.method === undefined) {
      const key = String(message.id);
      const pending = this._pending.get(key);
      if (!pending) return { line };
      this._pending.delete(key);

      const result = /** @type {Record<string, unknown>} */ (message.result ?? {});
      const sessionId =
        typeof result.sessionId === 'string' ? result.sessionId : pending.sessionId;

      if (SESSION_CLOSE_METHODS.has(pending.method)) {
        if (pending.sessionId) this._dropSession(pending.sessionId);
        return { line };
      }
      if (SESSION_CREATE_METHODS.has(pending.method) && sessionId) {
        return { line, synthesizeFor: [sessionId] };
      }
      return { line };
    }

    // Command advertisement from Hermes.
    if (
      message.method === 'session/update' &&
      message.params?.update?.sessionUpdate === 'available_commands_update'
    ) {
      const sessionId = typeof message.params.sessionId === 'string' ? message.params.sessionId : '';
      const upstream = Array.isArray(message.params.update.availableCommands)
        ? message.params.update.availableCommands
        : [];
      const merged = mergeCommands(upstream, this.config.commands);
      const advertisedFor = sessionId ? [sessionId] : [];
      if (merged.length === upstream.length) return { line, advertisedFor };

      const augmented = {
        ...message,
        params: {
          ...message.params,
          update: { ...message.params.update, availableCommands: merged },
        },
      };
      return { line: stringifyJson(augmented) ?? line, advertisedFor };
    }

    return { line };
  }

  // -- command advertisement bookkeeping ---------------------------------

  /** @param {string} sessionId */
  _state(sessionId) {
    let state = this._sessions.get(sessionId);
    if (!state) {
      state = { upstreamAdvertised: false, synthesized: false, timer: null };
      this._sessions.set(sessionId, state);
    }
    return state;
  }

  /** @param {string} sessionId */
  _markAdvertised(sessionId) {
    if (!sessionId) return;
    const state = this._state(sessionId);
    state.upstreamAdvertised = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  /** @param {string} sessionId */
  _dropSession(sessionId) {
    const state = this._sessions.get(sessionId);
    if (state?.timer) clearTimeout(state.timer);
    this._sessions.delete(sessionId);
  }

  /** @param {string} sessionId */
  _scheduleSynthesis(sessionId) {
    if (!this.config.synthesize || !sessionId) return;
    const state = this._state(sessionId);
    if (state.upstreamAdvertised || state.synthesized || state.timer) return;

    const availableCommands = mergeCommands([], this.config.commands);
    if (availableCommands.length === 0) return;

    const timer = setTimeout(() => {
      state.timer = null;
      if (state.upstreamAdvertised || state.synthesized) return;
      state.synthesized = true;
      const notification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: { sessionUpdate: 'available_commands_update', availableCommands },
        },
      };
      void this._write(stringifyJson(notification) ?? '');
    }, this.config.synthesizeDelayMs);

    timer.unref?.();
    state.timer = timer;
  }

  // -- output -------------------------------------------------------------

  /**
   * Serialize writes so an augmented update and a synthesized one can never
   * interleave on the wire.
   *
   * @param {string} line
   */
  _write(line) {
    if (!line) return this._writeChain;
    this._writeChain = this._writeChain
      .then(() => writeLine(/** @type {any} */ (this.output), line))
      .catch((cause) => {
        this._report(cause);
      });
    return this._writeChain;
  }

  // -- lifecycle ----------------------------------------------------------

  /** @param {NodeJS.ErrnoException} cause */
  _handleChildError(cause) {
    this._report(cause);
    this._handleChildExit(null, null);
  }

  /**
   * @param {number | null} code
   * @param {NodeJS.Signals | null} signal
   */
  _handleChildExit(code, signal) {
    if (this._exitInfo) return;
    this._clearTimers();
    this._exitInfo = { code, signal };
    this.emit('exit', this._exitInfo);
  }

  _clearTimers() {
    for (const state of this._sessions.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
    }
  }

  /** @param {unknown} cause */
  _report(cause) {
    if (isBrokenPipe(cause)) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    this._log('error', message);
    this.emit('bridge-error', cause);
  }

  /**
   * @param {'error' | 'warning' | 'info'} level
   * @param {string} message
   */
  _log(level, message) {
    const prefix = level === 'error' ? 'error: ' : level === 'warning' ? 'warning: ' : '';
    try {
      this.error.write(`zed-hermes: ${prefix}${message}\n`);
    } catch {
      // stderr may be closed during teardown.
    }
  }
}

/**
 * @param {unknown} params
 * @returns {string | null}
 */
function extractSessionId(params) {
  if (!params || typeof params !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (params);
  for (const key of ['sessionId', 'resumeSessionId', 'parentSessionId']) {
    if (typeof record[key] === 'string' && record[key]) return record[key];
  }
  return null;
}

/** @param {unknown} cause */
function isBrokenPipe(cause) {
  return Boolean(cause) && /** @type {NodeJS.ErrnoException} */ (cause).code === 'EPIPE';
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
