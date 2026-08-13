# oh-my-web

A personal fork of [pi-web](https://github.com/agegr/pi-web) — a local browser UI for the [pi coding agent](https://github.com/earendil-works/pi).

> **Fork notice**: this project is forked from [agegr/pi-web](https://github.com/agegr/pi-web) by Alex Yang. It keeps the original git history and adds personal UI/UX customizations on top.

## What's different from pi-web

- **File attachments** — drop files into the chat and send them as attachments ([PR #404](https://github.com/agegr/pi-web/pull/404) style).
- **Skill collapse blocks** — invoked skills render as collapsible cards instead of the compact command style ([PR #354](https://github.com/agegr/pi-web/pull/354) style).
- **Multi-skill invocation** — invoke several skills in one message (`/skill:a /skill:b`); every skill is expanded and reaches the model as a full `<skill>` block.
- **Mention chips in the composer** — `/skill:`, `/command`, and `@file` mentions are highlighted as blue chips so calls read as distinct from the prompt text. The chips render as cards in the sent message (files are clickable).
- **AI Studio-style message navigator** — a collapsible side panel lists user/assistant/tool messages with icons and active-message highlight.
- **Inline delete confirm** — the file explorer's delete button confirms in place (no browser `confirm()` dialog).
- **Simplified chrome** — minimal header, `pi-<version>` logo, clean skill styling.

## Quick Start

Requires Node.js 22.19.0 or newer.

```bash
npm install
npm run build
npm run start   # serves on http://127.0.0.1:30142 by default (see package.json)
```

Or use the helper command after installing:

```bash
oh-my-web      # opens http://127.0.0.1:30142 in your default browser
omw            # same as above, shorter alias
```

## Upstream

- Original project: [agegr/pi-web](https://github.com/agegr/pi-web)
- pi coding agent: [earendil-works/pi](https://github.com/earendil-works/pi)
