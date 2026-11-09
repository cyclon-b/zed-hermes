# Changelog

## 0.1.0 — 2026-11-09

Initial release.

### Added

- ACP bridge (`bin/zed-hermes.js`, `lib/proxy.js`) that runs `hermes acp` and
  transparently proxies JSON-RPC over stdio.
- Command catalog (`lib/commands.js`): 17 commands appended to
  `available_commands_update`, including the previously opt-in `/btw`, `/bg`,
  `/moa`, `/fast`, `/reasoning`, `/skills`, `/yolo`.
- Update synthesis for Hermes builds that never advertise commands
  (`synthesizeDelayMs`, default 300 ms).
- `scripts/register-zed.mjs`: idempotent add/remove of the `agent_servers`
  entry in Zed's `settings.json`, JSONC-aware (comments and trailing commas
  are preserved), with backup and `--force` for foreign entries.
- `scripts/probe.mjs`: real ACP end-to-end probe, `--mock` mode,
  `--doctor` environment checks, and a `--wait-ms` pause before prompting.
- `install.ps1` / `install.sh`: per-user config and Zed registration, with
  revert.
- Documentation: command surface, MCP forwarding, troubleshooting, English and
  Russian READMEs.
- Tests covering NDJSON framing, augmentation, synthesis, pass-through of
  `session/new` (including `mcpServers`), id correlation, session lifecycle,
  spawn failures, configuration precedence, Windows spawn decisions, and Zed
  settings editing.
- CI on Windows and Linux with Node 22.
