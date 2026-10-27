---
name: managing
description: Start, stop, open, inspect, update, or remove an existing Fast Jira local installation while preserving personal settings.
---

# Managing

Read the management section in [INSTALL.md](../../INSTALL.md). Resolve the plugin root from this skill's directory. The shared manager is `dist/cli/main.js`; the durable installed copy is under the personal service's `runtime/dist/cli/main.js`.

- Inspect status before acting. Report installed, registered, and running separately. Use the service's real URL, not an assumed default port.
- Map the requested operation to start, stop, open, status, update, or remove. A working service is not restarted for a status/open request. Preserve a custom home on every command.
- Update only when requested, using the newly built/installed plugin's manager, then verify health. The manager replaces execution assets and preserves `config/connection.env`; it attempts rollback on failure. Do not claim the AI plugin itself was updated just because the app service was.
- The app’s Settings → Management → Update flow updates the service and installed user-scope Codex/Claude Fast Jira plugins together. New AI sessions load the refreshed skills. Do not confuse this coordinated flow with the service-only CLI `update`.
- When a new package is needed, follow INSTALL.md and the current platform's official update commands. Do not reset a dirty source checkout or alter global instruction files.
- Remove only the requested scope: stopping, removing the service, and uninstalling an AI plugin are distinct operations. `remove` keeps authentication and logs; deleting personal data needs explicit authorization.
- Never print `.env`, `config/connection.env`, `config/mcp-token`, credentials, or raw private logs. Do not change Jira issues or comments to verify service health.

When authentication or token renewal is needed, open the app and follow Setup's user-only authentication handoff. During entry, inspect only `GET /api/connection/status`; never inspect browser content, clipboard, request payloads, or private credential files.

The process is detached from the terminal, with no OS auto-start registration. After reboot, start it explicitly through Managing. A consented local domain is restored on start when available; otherwise open the verified localhost URL. Do not attach startup to unrelated AI sessions or messages.
