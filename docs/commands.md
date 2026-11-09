# Commands

Hermes has two command surfaces that matter in Zed:

- **Advertised commands** — listed in `available_commands_update`. Zed renders
  them in the `/` menu with descriptions and input hints.
- **Forwarded commands** — not advertised, but still executed. ACP sends every
  `/command` that is not in its own route table to the gateway's `slash.exec`.
  Hermes runs the command or answers with a refusal.

The bridge only changes the first list. It never intercepts or executes a
command.

## Advertised by Hermes itself

As of Hermes `main` (2026-11), 14 commands are advertised out of the box:

| Command | Purpose |
|---|---|
| `/help` | List available commands |
| `/model` | Show or switch the model |
| `/tools` | List available tools |
| `/context` | Show conversation context usage |
| `/reset` | Clear conversation history |
| `/compress` | Compress conversation context |
| `/steer` | Inject guidance into the running turn |
| `/queue` | Queue a prompt for the next turn |
| `/usage` | Show token usage and limits |
| `/status` | Show session, model and context info |
| `/version` | Show the Hermes version |
| `/title` | Show or set the session title |
| `/undo` | Remove the last N turns |
| `/retry` | Resend the last user message |

The bridge skips any extra whose name is already in this list, so upstream
wording and hints always win.

## Advertised by zed-hermes

| Command | Hint | Purpose |
|---|---|---|
| `/plan` | `[task]` | Write an implementation plan to `.hermes/plans/` without executing it |
| `/init` | `[notes]` | Generate or update `AGENTS.md` from a repo scan |
| `/diff` | `[staged\|all\|session] [--stat]` | Show git changes in the working directory |
| `/goal` | `[<objective>\|status\|pause\|resume\|clear]` | Set a standing goal across turns |
| `/learn` | `<what to learn from>` | Distill a reusable skill from a directory, URL, workflow or notes |
| `/review` | `[instructions]` | Spawn an independent reviewer subagent |
| `/memory` | `[pending\|approve\|reject\|approval]` | Review memory writes and the write gate |
| `/rollback` | `[number]` | List or restore filesystem checkpoints |
| `/branch` | `[--here] [name]` | Branch the current session |
| `/refine` | `[focus]` | Run the memory/skill self-improvement review |
| `/btw` | `<question>` | Ask a side question about the current conversation |
| `/bg` | `<prompt>` | Run a prompt in a separate background session |
| `/moa` | `<prompt>` | Run one prompt through the Mixture of Agents preset |
| `/fast` | `[normal\|fast\|auto\|cold\|status]` | Show or set fast mode for supported routes |
| `/reasoning` | `[level\|show\|hide]` | Show or set reasoning effort and display |
| `/skills` | `[pending\|approve\|reject\|diff\|approval]` | Review pending skill writes |
| `/yolo` | — | Toggle YOLO mode (skips approval prompts) |

These are chosen because they are useful in an editor and have a clear,
side-effect-conscious purpose.

## Caveats for the added commands

All of these are served by the Hermes gateway, but a few deserve a warning:

- **`/yolo`** turns off dangerous-command approval for the session. It is in
the menu because it is a genuine Hermes command; use it deliberately, and
remember that any approval prompt you dismiss otherwise is there for a reason.
- **`/skills`** exposes only the write-approval subcommands over the gateway
(`pending`, `approve`, `reject`, `diff`, `approval`). Search and install stay
CLI-only and will be refused.
- **`/bg`** and **`/moa`** spawn work outside the current turn; results arrive
as background events and can be expensive.
- **`/fast`** changes request pricing/priority on supported model routes; it is
a no-op elsewhere.
- **`/memory`** and **`/refine`** act on Hermes' persistent memory and skills,
not on the repository.

## Customizing the list

The `commands` key in your config **replaces** the default catalog. To drop a
single entry, copy the defaults from
[`config/zed-hermes.example.json`](../config/zed-hermes.example.json) and omit
it. An empty array disables the extras entirely and leaves only Hermes' own 14
advertised commands.

## Why a refusal is not an error

ACP has no rejection channel for an unadvertised command, and treating prose
that begins with `/` as an error would be worse than forwarding it. So:

1. The bridge advertises a name.
2. You send it.
3. Hermes decides: it runs the handler, asks for more input, or answers with a
   short refusal naming the command.
4. The refusal arrives as the command's **reply text**. The prompt itself ends
   normally.

If a command you rely on starts refusing, check the Hermes version and its
[slash-command reference](https://hermes-agent.nousresearch.com/docs/reference/slash-commands).
Update the entry in your config; no bridge change is needed.
