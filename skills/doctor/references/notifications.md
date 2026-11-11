# Stop & Idle Notifications (`$doctor --notifications`)

Reference guide for [`skills/doctor/SKILL.md`](../SKILL.md). The `oh-my-agy` `Stop` hook sends a notification when the Antigravity agent stops and is idle (after any active workflow continuation budget is exhausted), when a workflow enters `"blocked"` waiting for user input, and on stop errors.

## 1. Config Files & Security Boundaries

- **Global**: `~/.gemini/config/oh-my-agy/notifications.json`
- **Per-workspace override** (top-level keys replace global ones, except `command.command`): `<workspace>/.omagy/notifications.json`
- **Security boundaries (`RCE` & `SSRF` protection)**:
  - Shell `command.command` execution (`sh -c`) is honored **strictly from user-global `~/.gemini/config/oh-my-agy/notifications.json`**; workspace-local `<workspace>/.omagy/notifications.json` can never supply or override `command.command` (it may only set `command.enabled: false` to mute a global command).
  - Outbound `slack`, `discord`, `telegram`, and `webhook` URLs must use `https:` and target non-private hosts (`localhost`, `.local`, loopback `127.*`/`::1`, link-local `169.254.*`/`fe80:`, and RFC1918 private IPs `10.*`, `172.16-31.*`, `192.168.*` are rejected by `isSafeNotificationUrl`).

## 2. Schema & Events

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

### Events
- `session-idle`: the agent stopped normally.
- `needs-input`: a workflow wrote `current_phase: "blocked"` within the last 10 minutes.
- `error`: the run stopped with an error.

### Command Placeholders & Webhook Payload
- `command` placeholders (each substituted shell-quoted): `{{event}}`, `{{message}}`, `{{projectPath}}`, `{{conversationId}}`.
  - macOS: `terminal-notifier -title oh-my-agy -message {{message}}`, or `osascript -e "display notification \"$(printf %s {{message}})\" with title \"oh-my-agy\""`
  - Linux: `notify-send oh-my-agy {{message}}`
- Generic `webhook` JSON body: `{"event", "message", "project", "projectPath", "conversationId"}`.
- Cooldown env override: `OMAGY_IDLE_COOLDOWN_SECONDS`.

## 3. Configuration Workflow

1. **Inspect**: read both config files if present and summarize enabled providers (mask secrets: show only the last 4 characters).
2. **Choose**: call `ask_question` with options: Slack webhook, Discord webhook, Telegram bot, generic webhook, local command (global only), cross-cutting settings (events/cooldown), disable all.
3. **Collect values**: gather settings for the chosen provider and confirm global vs workspace scope (`command.command` requires global scope). Never echo full secrets back. Warn that workspace files can be staged if `.omagy/` is not in `.gitignore`, and recommend keeping webhook tokens in the global config.
4. **Write & validate**: read-modify-write the target JSON with `write_file` and validate syntax with:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "<path>"
   ```
5. **Smoke test** (network providers require `BypassSandbox: true` if sandboxed):
   - Slack: `curl -sS -X POST -H 'content-type: application/json' -d '{"text":"oh-my-agy test"}' "<webhookUrl>"`
   - Discord: `curl -sS -X POST -H 'content-type: application/json' -d '{"content":"oh-my-agy test"}' "<webhookUrl>"`
   - Telegram: `curl -sS -X POST "https://api.telegram.org/bot<token>/sendMessage" -d chat_id=<id> -d text="oh-my-agy test"`
   - Command: execute the substituted local command once.
6. **Disable all**: set `"enabled": false`.

## 4. Unsupported Gateways & Exit Evidence

- External bot reply listeners, notification profile switching, and `SessionStart` outbound webhooks (`SessionStart` is reserved for local context injection) are unsupported; reproduce custom targets with `webhook` or global `command`.
- **Exit evidence**: report config path(s), enabled providers (masked), active events, cooldown, JSON parse validation, and smoke-test output. Do not claim live hook delivery from config edits alone — hook-driven delivery runs on the next agent stop once plugin hooks are loaded (`$doctor`).
