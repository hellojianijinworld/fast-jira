---
name: setup
description: Install Fast Jira locally, register its Codex or Claude Code plugin, and guide the user through Jira connection setup. Use for first installation or explicit reinstallation.
---

# Setup

Use [INSTALL.md](../../INSTALL.md) as the single installation procedure. The plugin root is two directories above this skill directory; resolve its absolute path instead of assuming a developer checkout or a particular user's home.

- From an installed plugin, run its built `dist/cli/main.js`; do not install development dependencies. From source, build/package as INSTALL.md directs.
- Register only the current AI platform unless both are requested. Use official plugin commands and preserve unrelated user configuration. Skills may require a new session even after successful registration.
- Reuse the existing personal service and settings. Codex and Claude Code share the same service; normal startup must not create a second server.
- Run doctor → status → setup → status → open on supported Node platforms. Ask for local domain consent, then use `setup --domain yes` or `--domain no`. On macOS with Node 24+, the installer opens the native system authorization dialog for https://fast-jira.local using pinned Portless. Certificate trust is requested separately through a temporary native GUI app and scoped to the current user and fast-jira.local HTTPS. Verify both OS trust and the real HTTPS response; the helper removes itself after completion. The user approves inside the system dialogs; never ask them to open Terminal, paste commands, or run sudo. Never obtain or enter their administrator password. Cancellation/failure and other OSes fall back to localhost. The app/MCP process remains unprivileged.
- The Node process survives the launching terminal but does not auto-start after reboot. No OS service, session hook, or scheduled job is registered. If a custom home is requested, preserve it in all manager commands and MCP process FAST_JIRA_HOME. Port conflicts never authorize killing an unrelated process.
- Plugin .mcp.json registers the stdio bridge automatically. Both platforms use the same runtime/config folder; Jira credentials stay in config/connection.env. MCP writes require native user elicitation approval; unsupported clients cannot write.
- Open the Jira connection screen. Site, email and token are visible together; the progress header reflects input and verification without separate pages. The user follows the token issuance link and pastes the token directly into the app. Never request it in chat.
- After handing off authentication, stop all browser inspection/automation: no screenshots, DOM or field reads, network payload inspection, clipboard access, or credential file reads. Do not automate Atlassian login, token creation/copy, or token entry. These restrictions also apply when replacing a token.
- Observe only `GET /api/connection/status` during handoff. It returns a state without identity or secrets and makes no Jira requests. Poll at most once every 3 seconds for up to 2 minutes, stopping on connected or failed. A timeout means installation is complete but connection is waiting; do not ask the user to paste a token into chat or keep polling indefinitely. A new agent turn can check this endpoint again.
- `unverified` means a saved token exists but has not been validated in this process. Do not call it connected. Before a new authentication handoff, an existing installation may be verified with a read-only request whose response body is not printed.
- Report app readiness separately from Jira authentication. Verify only with local health and read-only Jira requests. Do not write Jira data as an installation test.
