---
name: managing
description: Start, stop, open, inspect, update, or remove an existing Fast Jira local installation while preserving personal settings.
---

# Managing

Read the management section in [INSTALL.md](../../INSTALL.md). Resolve the plugin root from this skill's directory. The shared manager is `dist/cli/main.js`; the durable installed copy is under the personal service's `runtime/dist/cli/main.js`.

- Inspect status before acting. Report installed, registered, and running separately. Use the service's real URL, not an assumed default port.
- Map the requested operation to start, stop, open, status, update, or remove. A working service is not restarted for a status/open request. Preserve a custom home on every command.
- Update only when requested, using the newly built/installed plugin's manager, then verify health. The manager replaces execution assets and preserves `.env`; it attempts rollback on failure. Do not claim the AI plugin itself was updated just because the app service was.
- When a new package is needed, follow INSTALL.md and the current platform's official update commands. Do not reset a dirty source checkout or alter global instruction files.
- Remove only the requested scope: stopping, removing the service, and uninstalling an AI plugin are distinct operations. `remove` keeps authentication and logs; deleting personal data needs explicit authorization.
- Never print `.env`, credentials, or raw private logs. Do not change Jira issues or comments to verify service health.
