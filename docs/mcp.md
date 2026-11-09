# Zed MCP servers → Hermes

Zed's MCP servers and Hermes' own MCP configuration are two independent
sources. Both can be active in the same session.

## How it is wired

```text
Zed settings.json
  context_servers: { github: { command, args, env }, remote: { url, headers } }
        │
        │  ACP session/new  { cwd, mcpServers: [...] }
        ▼
zed-hermes bridge          (forwards the request byte-for-byte)
        ▼
hermes acp  ──▶  Hermes gateway  ──▶  tools available to the model
```

- Zed sends its configured `context_servers` as `mcpServers` in `session/new`.
- Hermes attaches them to that session and offers their tools to the model.
  On gateways advertising `acp-session-mcp-v1`, editor servers belong to the
  canonical session, not to the short-lived ACP viewer process.
- The bridge does not rewrite `session/new`. A regression test in
  `test/proxy.test.js` asserts the request reaches Hermes byte-for-byte,
  including the `mcpServers` array.

Nothing needs to be added to `~/.hermes/config.yaml` for Zed's servers.

## What filters what

| Setting | Affects `config.yaml` servers | Affects Zed `mcpServers` |
|---|---|---|
| `platform_toolsets.acp` | Yes (allowlist) | No |
| `no_mcp` | Yes (drops all) | No |
| `agent.disabled_toolsets` | Yes | Yes, if the MCP toolset name is listed |
| Zed `context_servers` | — | Yes (source of truth) |

So:

- An empty or restrictive `platform_toolsets.acp` does **not** remove Zed's
  servers.
- `agent.disabled_toolsets` can still hide a toolset from every ACP session.
  If a Zed MCP tool does not appear, check that key before blaming the bridge.
- Plugin toolsets are additive as well; `agent.disabled_toolsets` is the
  reliable way to remove them.

## Remote servers and OAuth

Zed owns remote MCP authentication. When a remote server has no
`Authorization` header, Zed runs the MCP OAuth flow and forwards a working
server. Hermes never sees the OAuth token exchange; it only receives the
transport specification.

The gateway keeps that specification in memory. After a gateway restart, the
editor must supply the same `mcpServers` again on load/resume. Zed does this
when you reopen the thread.

## Verify

1. **In Zed.** Open a Hermes thread and ask: *"List the MCP tools you can
   call."* Tools are exposed as `mcp__<server>__<tool>`.
2. **Transport.** Run `dev: open acp logs` from the Command Palette and look at
   the `session/new` request. `mcpServers` should contain your Zed servers.
3. **Bridge.** `npm run probe -- --mcp '[{"name":"probe","command":"node","args":["./my-mcp-server.mjs"],"env":[]}]'`
   sends a real stdio server entry and confirms Hermes accepts it. ACP requires
   `env` to be an array of `{name, value}` objects for stdio servers, so pass
   `[]` when there is nothing to set.
4. **Tool call.** Discovery of editor servers happens before the first model
   turn. `/tools` issued immediately after `session/new` may not list them yet;
   asking the model to call one (`"Call the <tool> with ..."`) is the definitive
   check. The tools are exposed as `mcp__<server>__<tool>`.

## Failure modes

| Symptom | Likely cause |
|---|---|
| No Zed MCP tools at all | `agent.disabled_toolsets` includes the MCP toolset; or the server is not green in Zed's MCP settings |
| Tools work in Zed Agent but not in Hermes | The server is Zed-only; confirm it is in `context_servers`, not a Zed Agent profile |
| Tool disappears after a gateway restart | Reopen the thread so Zed re-sends `mcpServers`; a changed spec or secret refuses reattachment |
| Remote server re-prompts for auth | Zed's OAuth grant expired; reconnect the server in Zed settings |
| Hermes also lists `config.yaml` servers | Expected: both sources are active unless you narrow `platform_toolsets.acp` |

## Related

- Hermes ACP docs: <https://hermes-agent.nousresearch.com/docs/user-guide/features/acp>
- Zed MCP docs: <https://zed.dev/docs/ai/mcp>
- Zed external agents: <https://zed.dev/docs/ai/external-agents>
