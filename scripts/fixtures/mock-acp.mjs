#!/usr/bin/env node
/**
 * Minimal ACP agent used by tests and `scripts/probe.mjs --mock`.
 *
 * Flags:
 *   --silent   never send available_commands_update
 *   --no-echo  do not answer prompts
 */

import { createInterface } from 'node:readline';

const silent = process.argv.includes('--silent');
const echo = !process.argv.includes('--no-echo');
const sessionId = 'mock-session-1';

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message.method !== 'string') return;

  const id = message.id ?? null;
  const reply = (result) => {
    if (id !== null) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  };
  const notify = (update) => {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })}\n`,
    );
  };

  switch (message.method) {
    case 'initialize':
      reply({ protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true } } });
      break;
    case 'session/new':
    case 'session/resume':
    case 'session/load':
      reply({ sessionId, modes: null, models: null });
      if (!silent) {
        notify({
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'mock', description: 'Mock command from the fixture' }],
        });
      }
      break;
    case 'session/prompt': {
      if (!echo) break;
      const text = (message.params?.prompt ?? [])
        .filter((block) => block?.type === 'text')
        .map((block) => block.text)
        .join(' ');
      notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo: ${text}` } });
      reply({ stopReason: 'end_turn' });
      break;
    }
    case 'session/cancel':
      break;
    default:
      reply({});
      break;
  }
});
