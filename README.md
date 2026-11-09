# zed-hermes

> [Hermes Agent](https://github.com/NousResearch/hermes-agent) in [Zed](https://zed.dev):
> the full slash-command surface in the Agent Panel's `/` menu, and Zed's MCP
> servers (`context_servers`) forwarded to Hermes over ACP.

[Русская версия](README.ru.md)

## Status

The bridge is covered by automated tests against a mocked ACP agent, and by an
end-to-end probe that drives the real bridge over stdio. It has **not** been
exercised against a live Hermes installation in this repository's CI — run
`npm run probe` on your machine as the first verification step. See
[Known behaviour and limitations](#known-behaviour-and-limitations).

## The problem

Hermes already runs as an ACP server (`hermes acp`), so Zed can host it as an
External Agent today. Two gaps remain:

1. **Command discoverability.** Zed renders its `/` menu only from ACP
   `available_commands_update`. Hermes advertises 14 commands (`help`, `model`,
   `tools`, `context`, `reset`, `compress`, `steer`, `queue`, `usage`, `status`,
   `version`, `title`, `undo`, `retry`). Its other commands — `/plan`, `/init`,
   `/diff`, `/goal`, `/learn` and many more — still execute, because ACP
   forwards every unadvertised `/command` to the gateway's `slash.exec`. They
   are simply invisible in the menu.
2. **MCP wiring is easy to break.** Zed forwards its MCP servers in
   `session/new.mcpServers`; Hermes attaches them per session. Any proxy that
   rewrites `session/new`, or a Hermes config with `no_mcp`, quietly drops them.

## What this repository ships

A **zero-patch ACP proxy** plus tooling. Nothing under `~/.hermes` is modified,
no Hermes plugin is installed, and no Hermes version is pinned.

| Piece | What it does |
|---|---|
| `bin/zed-hermes.js` | Spawns `hermes acp`, proxies ACP over stdio |
| `lib/proxy.js` | Augments or synthesizes `available_commands_update`; forwards everything else untouched |
| `scripts/register-zed.mjs` | Adds/removes the `agent_servers` entry in Zed's `settings.json` (with backup) |
| `scripts/probe.mjs` | Real ACP end-to-end check, plus `--doctor` environment checks |
| `install.ps1` / `install.sh` | Per-user setup and Zed registration, idempotent and reversible |
| `docs/` | Command surface, MCP wiring, troubleshooting |

## How it works

```text
Zed Agent Panel
      │  ACP over stdio (NDJSON JSON-RPC)
      ▼
zed-hermes  ──pass-through──▶  hermes acp  ──▶  Hermes gateway
      │                              │
      │  available_commands_update   │
      └────── augmented ─────────────┘
```

1. **Pass-through.** Every line is forwarded unchanged. Only three things are
   inspected: `session/new|resume|load|fork` requests (to learn the session id),
   their responses, and `session/update` notifications carrying
   `available_commands_update`.
2. **Augment.** When Hermes advertises its commands, the curated catalog is
   appended. Upstream always wins on a name collision, and order is preserved.
3. **Synthesize.** If a Hermes build never sends an advertisement, the bridge
   emits one shortly after the `session/new` response (`synthesizeDelayMs`,
   default 300 ms), so the menu is still populated. The timer is cancelled the
   moment a real update arrives.
4. **MCP stays transparent.** `session/new` is forwarded byte-for-byte, so
   Zed's `mcpServers` reach Hermes exactly as Zed sent them. A regression test
   asserts this.

The commands themselves are executed by Hermes, not by the bridge. The bridge
only makes them visible. A command Hermes refuses arrives as the command's
*reply* — never as a failed prompt.

## Requirements

- Hermes Agent with the ACP extra installed:

  ```bash
  cd ~/.hermes/hermes-agent && python -c "import pm; pm.sync_venv(['acp'], explicit=True)"
  ```

  `hermes acp --version` must succeed. Configure a provider/model first with
  `hermes model` (ACP reuses the same credentials).
- Zed with External Agents.
- Node.js ≥ 22.

## Install

### Windows (PowerShell)

```powershell
git clone https://github.com/cyclon-b/zed-hermes.git
cd zed-hermes
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```sh
git clone https://github.com/cyclon-b/zed-hermes.git
cd zed-hermes
./install.sh
```

Both installers:

1. verify Node.js ≥ 22 and warn if `hermes` is missing or its ACP extra is not
   installed;
2. create the per-user config on first run
   (`%APPDATA%\zed-hermes\config.json`, `~/.config/zed-hermes/config.json`, or
   `~/Library/Application Support/zed-hermes/config.json`);
3. add `agent_servers.Hermes` to Zed's `settings.json`, after backing it up.

Options: `-NoZed` / `--no-zed` prints the snippet instead of editing settings;
`-Revert` / `--revert` removes the entry. Re-running is idempotent.

## Register the agent in Zed manually

```json
{
  "agent_servers": {
    "Hermes": {
      "type": "custom",
      "command": "node",
      "args": ["C:/path/to/zed-hermes/bin/zed-hermes.js"],
      "env": {}
    }
  }
}
```

If `node` is not on Zed's `PATH` (common with version managers), use the
absolute path to the executable in `command`. Then open the Agent Panel, start
a new `Hermes` thread, and type `/`.

> The bridge is the thing configured here, not `hermes acp` directly. If you
> point Zed at `hermes acp` instead, everything still works — you just lose the
> extra commands in the menu.

## MCP servers from Zed

Zed's MCP servers (`context_servers` in Zed settings) are forwarded to the
agent as `mcpServers` in `session/new`; Hermes attaches them to the session and
offers their tools to the model. The bridge does not touch that payload.

Worth knowing:

- Hermes' `platform_toolsets.acp` and `no_mcp` filter **`config.yaml`** servers.
  Editor-provided servers are added separately, so you do not need to list them.
- `agent.disabled_toolsets` can still remove an MCP toolset from every ACP
  session. If a tool disappears, check that key first.
- Zed owns remote MCP auth (OAuth prompts). Hermes receives a working server,
  not credentials.
- With a Hermes gateway that advertises `acp-session-mcp-v1`, editor servers
  belong to the canonical session. Closing Zed does not cancel another
  session's MCP execution.

Full details: [docs/mcp.md](docs/mcp.md).

## Verify without Zed

```sh
npm run doctor          # node, hermes on PATH, hermes acp --version
npm run probe           # real ACP handshake against hermes acp
npm run probe -- --mock # the same probe against the bundled mock agent
```

`probe` starts the bridge exactly as Zed does, performs
`initialize → session/new → available_commands_update → session/prompt /version`,
and exits non-zero if the curated commands are missing.

Transport debugging inside Zed: `dev: open acp logs` from the Command Palette.

## Default commands

The bridge adds these to the menu. All of them are real Hermes commands.

| Command | What it does |
|---|---|
| `/plan [task]` | Write an implementation plan without executing it |
| `/init [notes]` | Generate or update `AGENTS.md` from a repo scan |
| `/diff [staged\|all\|session]` | Show git changes in the working directory |
| `/goal [<objective>\|status\|pause\|resume\|clear]` | Set a standing goal across turns |
| `/learn <what to learn from>` | Distill a reusable skill |
| `/review [instructions]` | Spawn an independent reviewer subagent |
| `/memory [pending\|approve\|reject\|approval]` | Review memory writes and the write gate |
| `/rollback [number]` | List or restore filesystem checkpoints |
| `/branch [--here] [name]` | Branch the current session |
| `/refine [focus]` | Run the memory/skill self-improvement review |
| `/btw <question>` | Ask a side question about the current conversation |
| `/bg <prompt>` | Run a prompt in a separate background session |
| `/moa <prompt>` | Run one prompt through the Mixture of Agents preset |
| `/fast [normal\|fast\|auto\|cold\|status]` | Show or set fast mode for supported routes |
| `/reasoning [level\|show\|hide]` | Show or set reasoning effort and display |
| `/skills [pending\|approve\|reject\|diff\|approval]` | Review pending skill writes |
| `/yolo` | Toggle YOLO mode (skips approval prompts) |

`/yolo` disables dangerous-command approval for the session and `/skills`
exposes only its write-approval subcommands over the gateway — see
[docs/commands.md](docs/commands.md) for those caveats and for how to drop an
entry from the list.

## Configuration

`~/.config/zed-hermes/config.json` (Windows: `%APPDATA%\zed-hermes\config.json`):

```json
{
  "command": "hermes",
  "args": ["acp"],
  "shell": "auto",
  "synthesize": true,
  "synthesizeDelayMs": 300,
  "commands": [{ "name": "plan", "description": "…", "hint": "[task]" }]
}
```

Precedence: CLI flags → `ZED_HERMES_*` environment variables → config file →
defaults. `zed-hermes --print-config` prints the effective values. On Windows,
`shell: "auto"` runs `.cmd`/`.ps1` shims (such as a `hermes` installed via a
package manager) through `cmd.exe`; set `shell: false` with an absolute `.exe`.

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Revert
```

```sh
./install.sh --revert
```

The per-user config is left in place. Delete the `zed-hermes` directory under
your config root if you want it gone too.

## Known behaviour and limitations

- **Not yet validated against a live Hermes install here.** The proxy logic,
  framing, augmentation, synthesis, Zed settings editing, and Windows spawn
  decisions are covered by `node --test`; the end-to-end ACP path is covered
  against a mock agent. `npm run probe` is the check that uses your Hermes.
- **The catalog mirrors Hermes' command surface as of 2026-11.** If Hermes
  renames or removes a command, the menu entry will produce Hermes' own
  refusal reply. Fix it in your config; no code change is required.
- **Extra commands are executed by the gateway.** Hermes' ACP process is a
  viewer of its gateway daemon. If the daemon is unavailable, commands return
  a refusal instead of running.
- **Synthesis is a heuristic.** A client that rejects `session/update` before it
  has registered the session would drop it; the 300 ms delay gives Hermes' own
  advertisement time to arrive first (the `session/new` response is already
  written before synthesis is scheduled). Set `synthesize: false` if you prefer
  to rely on Hermes' own advertisement only.
- **Not an npm registry package.** Run it from a checkout; the bridge has zero
  runtime dependencies, so there is nothing to install globally.
- The bridge does not implement ACP presentation features (plan cards, todos,
  terminals) and does not alter Hermes' tool permissions.

## Development

```sh
npm run check   # syntax + catalog invariants
npm test        # node --test, no external dependencies
npm run probe -- --mock
```

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for noncommercial use;
commercial use, including selling this software or products built on it, is not
granted. For commercial licensing, contact the author.

See [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright (c) 2026 Gennady
Artamonov. Not affiliated with or endorsed by Nous Research or Zed Industries.
