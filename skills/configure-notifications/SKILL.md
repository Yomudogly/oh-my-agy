---
name: configure-notifications
description: "[oh-my-agy] Configure oh-my-agy stop/idle notifications to Slack, Discord, Telegram, a generic webhook, or a local command (e.g. macOS notification). Use for 'configure notifications', 'setup slack/discord/telegram notifications', 'notify me when the agent stops', or disabling notifications."
---

# Configure oh-my-agy Notifications

The oh-my-agy `Stop` hook sends a notification when the Antigravity agent stops and is idle (after any workflow continuation is exhausted). It also notifies when a workflow is blocked waiting for you, and on errors.

## Config files

- Global: `~/.gemini/config/oh-my-agy/notifications.json`
- Per-workspace override (top-level keys replace global ones): `<workspace>/.omagy/notifications.json`

Schema:
```json
{
  "enabled": true,
  "idleCooldownSeconds": 60,
  "events": ["session-idle", "needs-input", "error"],
  "slack":    { "enabled": false, "webhookUrl": "https://hooks.slack.com/services/..." },
  "discord":  { "enabled": false, "webhookUrl": "https://discord.com/api/webhooks/..." },
  "telegram": { "enabled": false, "botToken": "123:ABC", "chatId": "123456" },
  "webhook":  { "enabled": false, "url": "https://example.com/hook", "method": "POST", "headers": {} },
  "command":  { "enabled": false, "command": "terminal-notifier -title oh-my-agy -message {{message}}" }
}
```

Events:
- `session-idle`: the agent stopped normally.
- `needs-input`: a workflow wrote `current_phase:"blocked"` in the last 10 minutes.
- `error`: the run stopped with an error.

`command` placeholders (each substituted shell-quoted): `{{event}}`, `{{message}}`, `{{projectPath}}`, `{{conversationId}}`. Examples:
- macOS: `terminal-notifier -title oh-my-agy -message {{message}}`, or `osascript -e "display notification \"$(printf %s {{message}})\" with title \"oh-my-agy\""`
- Linux: `notify-send oh-my-agy {{message}}`

The generic `webhook` receives JSON: `{"event","message","project","projectPath","conversationId"}`.

The cooldown can be overridden with the env var `OMAGY_IDLE_COOLDOWN_SECONDS`.

## Workflow

1. **Inspect**: read both config files if present and summarize which providers are enabled (mask secrets: show only the last 4 characters).
2. **Choose**: `ask_question` with options: Slack webhook, Discord webhook, Telegram bot, generic webhook, local command, cross-cutting settings (events/cooldown), disable all.
3. **Collect values** for the chosen provider. Ask for the global vs workspace scope. Never echo full secrets back. Warn that workspace configs may get committed, and suggest keeping secrets in the global file or ensuring `.omagy/` is gitignored.
4. **Write** the JSON with `write_to_file` (read-modify-write; preserve other keys). Validate it with `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <path>`.
5. **Smoke test** the provider directly (this needs network; re-run with `BypassSandbox: true` if the sandbox blocks it):
   - Slack: `curl -sS -X POST -H 'content-type: application/json' -d '{"text":"oh-my-agy test"}' <webhookUrl>`
   - Discord: `... -d '{"content":"oh-my-agy test"}' <webhookUrl>`
   - Telegram: `curl -sS -X POST "https://api.telegram.org/bot<token>/sendMessage" -d chat_id=<id> -d text="oh-my-agy test"`
   - Command: run the substituted command once.
6. **Disable all**: set `"enabled": false`.

## Not ported from oh-my-codex
OpenClaw/clawdbot gateways, the Discord bot reply listener, notification profiles, and the session-start event (Antigravity exposes no session-start hook). Reproduce custom gateways with `webhook` or `command`.

## Exit evidence
Report the config path(s), enabled providers (masked), events, cooldown, JSON validation result, and smoke-test output. Do not claim delivery from configuration alone. Hook-driven delivery happens on the next agent stop (Antigravity must have loaded the plugin hooks; see `$doctor`).
