---
name: contribute
description: Set up a contributor's Fast Jira source development environment or guide an explicitly requested contribution workflow. Do not use for ordinary implementation or fixes in an existing source checkout.
---

# Contribute

Use this skill when a user asks to prepare a contributor environment, follow the contribution guide, or explicitly invokes Contribute. For ordinary feature development, debugging, or UI fixes in an existing checkout, follow that checkout’s AGENTS.md directly; do not invoke this skill solely because the task changes Fast Jira code.

Read [CONTRIBUTING.md](../../CONTRIBUTING.md), then the source checkout's AGENTS.md before changing code. A plugin installation contains built assets, not the development source. Reuse the user's source checkout or obtain https://github.com/hellojianijinworld/fast-jira with their access.

- If only environment preparation is requested, set up dependencies and run checks; do not invent a feature or modify the installed personal service.
- Use a separate development port when the personal service is running. Preserve credentials and existing changes.
- Keep shared skills and product logic in one place; use platform adapters only for discovery and installation differences.
- Verify with the documented type, lint, build, and meaningful automated checks. Jira writes are never a test strategy.
- Implement only the requested contribution. Commits, pushes, PRs and tags each require user authorization. Report changed behavior, checks, and limits.

The extended contribution workflow will be defined with the user later; this skill currently covers development preparation and explicitly requested work.
