# Troubleshooting

Start with:

```sh
npm run doctor
npm run probe
```

`doctor` checks Node and Hermes; `probe` speaks real ACP and fails with the
first broken step.

## The agent does not appear in Zed

- Confirm the `agent_servers` entry exists in Zed's `settings.json`
  (`zed: open settings file`).
- Restart Zed or open the Agent Panel. Zed watches settings, but a broken file
  is ignored silently.
- On Windows, if `node` is not on Zed's `PATH` (nvm, Volta, fnm), put the
  absolute path to `node.exe` in `command`.
- Check `dev: open acp logs` for a spawn error.

## `hermes` not found

```
zed-hermes: error: spawn hermes ENOENT
```

The bridge is running, but it cannot start Hermes. Either:

- add Hermes to `PATH`, or
- point the bridge at it:

  ```json
  { "command": "C:/Users/you/AppData/Local/hermes/bin/hermes.exe", "args": ["acp"] }
  ```

  in `~/.config/zed-hermes/config.json` (Windows:
  `%APPDATA%\zed-hermes\config.json`), or use `--command` in Zed's `args`.

## `hermes acp` fails immediately

Install the ACP extra in the Hermes checkout:

```bash
cd ~/.hermes/hermes-agent && python -c "import pm; pm.sync_venv(['acp'], explicit=True)"
```

Then:

```bash
hermes acp --version
hermes acp --check
hermes doctor
```

The bridge forwards Hermes' stderr unchanged, so the reason is in the ACP logs.

## No `/` commands in Zed

- Hermes should send `available_commands_update` after `session/new`. If it
  does, the bridge appends the catalog and Zed must show it.
- If your Hermes build never sends that update, the bridge synthesizes one
  after `synthesizeDelayMs`. Check that `synthesize` is not `false` in the
  config (`zed-hermes --print-config`).
- Confirm the catalog is not empty: `commands: []` disables the extras.
- `npm run probe` asserts the advertised list; compare it with what Zed shows.

## A command replies "not available" or similar

That is Hermes' own refusal, not a bridge error. Extra commands are executed by
the Hermes gateway through `slash.exec`. Reasons:

- The gateway daemon is not running or is unreachable.
- The installed Hermes version does not serve that command over the gateway.
- The command needs a subcommand or argument.

The prompt itself ends normally; the refusal is the command's reply text. See
[docs/commands.md](commands.md).

## MCP tools from Zed are missing

- Make sure the server is green in **Settings → AI → MCP Servers**.
- Check `agent.disabled_toolsets` in `~/.hermes/config.yaml`: it can remove a
  toolset from ACP sessions.
- `platform_toolsets.acp` and `no_mcp` do **not** affect editor-provided
  servers.
- Inspect `session/new` in `dev: open acp logs`; `mcpServers` must be present.

Details: [docs/mcp.md](mcp.md).

## The bridge dies with the child / Zed shows a disconnected agent

The bridge exits with the child's exit code. A child crash is surfaced, not
masked. Look at stderr in the ACP logs; it is forwarded verbatim.

If you see `EPIPE`, Zed closed the connection first; the bridge exits quietly.

## Non-JSON output on stdout

ACP reserves stdout for JSON-RPC. If the child (or a Hermes plugin) prints to
stdout, the bridge forwards the line verbatim and logs a single warning:

```
zed-hermes: warning: agent wrote a non-JSON line to stdout; forwarded verbatim
```

Fix the source; a stray `print()` in a plugin corrupts the transport.

## Settings were not updated

`scripts/register-zed.mjs` understands JSONC, so comments and trailing commas
in `settings.json` survive; it only refuses a structurally invalid file. If the
file cannot be parsed, `zed-hermes` prints the reason and the snippet instead
of writing.

To add the registry entry by hand:

```sh
node scripts/register-zed.mjs --print
```

A timestamped `.bak` file is created next to `settings.json` before every
write.
