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

These are chosen because they are useful in an editor and have a clear,
side-effect-conscious purpose.

## Opt-in commands

Add any of these to the `commands` array in your config. They are not
advertised by default because they are situational or easy to misuse.

| Command | Hint | Why opt-in |
|---|---|---|
| `/btw` | `<question>` | One-off side question; easy to confuse with a normal prompt |
| `/bg` | `<prompt>` | Starts work in a separate background session |
| `/moa` | `<prompt>` | Mixture of Agents; expensive, one-shot |
| `/fast` | `[normal\|fast\|auto\|cold\|status]` | Changes request pricing/priority for supported routes |
| `/reasoning` | `[level\|show\|hide]` | Changes reasoning effort and display |
| `/skills` | `[pending\|approve\|reject\|diff\|approval]` | Only the write-approval subcommands are served over the gateway |
| `/yolo` | — | Disables approval prompts; exposing it invites accidents |

Example:

```json
{
  "commands": [
    { "name": "plan", "description": "Write an implementation plan", "hint": "[task]" },
    { "name": "diff", "description": "Show git changes" },
    { "name": "btw", "description": "Ask a side question", "hint": "<question>" }
  ]
}
```

The `commands` key replaces the default catalog; copy entries from
[`config/zed-hermes.example.json`](../config/zed-hermes.example.json) that you
want to keep.

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
