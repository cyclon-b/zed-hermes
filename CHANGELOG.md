# Changelog

## 0.1.0 — 2026-11-09

Initial release.

### Added

- ACP bridge (`bin/zed-hermes.js`, `lib/proxy.js`) that runs `hermes acp` and
  transparently proxies JSON-RPC over stdio.
- Command catalog (`lib/commands.js`): 10 commands appended to
  `available_commands_update`, plus an opt-in set.
- Update synthesis for Hermes builds that never advertise commands
  (`synthesizeDelayMs`, default 300 ms).
- `scripts/register-zed.mjs`: idempotent add/remove of the `agent_servers`
  entry in Zed's `settings.json`, with backup and `--force` for foreign entries.
- `scripts/probe.mjs`: real ACP end-to-end probe, `--mock` mode, and
  `--doctor` environment checks.
- `install.ps1` / `install.sh`: per-user config and Zed registration, with
  revert.
- Documentation: command surface, MCP forwarding, troubleshooting, English and
  Russian READMEs.
- Tests covering NDJSON framing, augmentation, synthesis, pass-through of
  `session/new` (including `mcpServers`), id correlation, session lifecycle,
  spawn failures, configuration precedence, Windows spawn decisions, and Zed
  settings editing.
- CI on Windows and Linux with Node 22.
