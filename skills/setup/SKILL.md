---
name: setup
description: Install Fast Jira locally, register its Codex or Claude Code plugin, and guide the user through Jira connection setup. Use for first installation or explicit reinstallation.
---

# Setup

Use [INSTALL.md](../../INSTALL.md) as the single installation procedure. The plugin root is two directories above this skill directory; resolve its absolute path instead of assuming a developer checkout or a particular user's home.

- From an installed plugin, run its built `dist/cli/main.js`; do not install development dependencies. From source, build/package as INSTALL.md directs.
- Register only the current AI platform unless both are requested. Use official plugin commands and preserve unrelated user configuration. Skills may require a new session even after successful registration.
- Reuse the existing personal service and settings. Codex and Claude Code share the same service; normal startup must not create a second server.
- On macOS, run doctor → status → setup → status → open. If a custom home is requested, pass it on every command. Port conflicts never authorize killing an unrelated process. Other OS service setup is currently unsupported.
- Ask the user to create an Atlassian token at https://id.atlassian.com/manage-profile/security/api-tokens and enter site/email/token in the app. Never request the token in chat or print private files.
- Report app readiness separately from Jira authentication. Verify only with local health and read-only Jira requests. Do not write Jira data as an installation test.
