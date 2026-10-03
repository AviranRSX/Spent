@AGENTS.md

# Claude Code notes

`AGENTS.md` (imported above) is the single source of truth for project context, money semantics, architecture, and conventions. Update it there, not here, so Claude Code and other agents stay in sync. Keep this file for Claude Code specific notes only.

- Real bank and card exports live in `/transactions/` and the live database in `/data/`. Both are gitignored. You may read them to debug a parser or a categorization issue when the user asks, but never quote their contents in commits, tests, docs, or artifacts.
- For questions about categorization routing, run `npm run debug:import-classification` before reading code.
