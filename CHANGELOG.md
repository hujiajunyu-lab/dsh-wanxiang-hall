# Changelog

All notable changes to this project. Version numbers follow semver on the plugin package; the server keeps its own `API_VERSION` counter (the panel refuses to talk to an older server).

## 2.3.0

- **First npm release.** `private` removed from `package.json`; `dsh plugin add dsh-wanxiang-hall` installs it.
- **Knowledge base moved to its own file** `kb.json`. Writing a project no longer rewrites up to 500 memory entries; a hit counter bump touches one small file.
- Knowledge base list scrolls (max 340px) with a **expand** button (up to 78vh) — long lists no longer push everything else down the page.
- Open-source scaffolding: `README.md` (English-first), `README.zh.md`, `LICENSE` (MIT), `CHANGELOG.md`, `.gitignore`, `docs/architecture.md`, `docs/tools.md`, `docs/gates.md`.
- `assets/hero.svg` — repository banner (pipeline + three shapes).
- De-identified defaults: no hard-coded vault path, backup dir falls back to `~/.dsh/court-backups`.
- `repository` / `homepage` / `bugs` point at the real GitHub repository.
- `API_VERSION` 20.

## 2.2.0

- **Enterprise knowledge base**: `kb.js` + `court_kb_save` / `court_kb_search` / `court_kb_digest` / `court_kb_update`, seven kinds (decision / constraint / pitfall / pattern / tool / glossary / client preference), local scoring search (Latin words + Chinese bigrams), 3 entries auto-injected into every hand-off, `hits` counter, "digest from project" flow in the panel.
- Panel tab 知识库 → **智库** with search, kind filters, entry cards, digest flow.
- Three new preset rules: search memory before intake, read memory before starting, save new pitfalls at delivery.

## 2.1.0

- Renamed to **万象工阁 / Wanxiang Hall** (13 files, 70 occurrences).
- Credit line on the intake page: made by 幻盏衍露.
- `万象工阁插件说明-v2.1.md` — the operator manual.

## 2.0.0

- **Three staffing shapes** replace the single hard-coded state machine: `PIPELINES[squad|crew|line]`, per-shape seats, per-shape `rejectCap` (1 / 2 / 1). The light shape finally has no reviewer and no executor seat — the PM builds, the secretary spot-checks.
- **Schema v4**: `shape`, `lineage`, `linkedSessions`, `context`, `packages`, `ownership`, `quote`, `actual`, `budget`, `manual`, `rejects`, `delegation`, `answers`, `items`, `legacy`.
- **Fact layer**: `activity.js` derives liveness from session-log mtime (six states), nudge cooldown 30 min, escalation after 2 nudges. Removed the old "no session → auto-block" behaviour, which manufactured blockages.
- **Contracts**: `court_fork_project` (a follow-up project inherits workspace, context, ownership, checks and *sessions* — no re-onboarding), `court_set_manual` / `court_update_manual` (only secretary or client ticks), `court_set_quote` + `actual` accounting, `court_set_appetite` (time box), `court_set_priority` (important/urgent quadrant).
- **Gates**: revision must clear `mustFix` with `fixes[]`; starting work requires a signed scope; closing requires no pending user-action items; out-of-scope audit at closing (from 2.0.0's Step 3 work).
- **Persistence guard**: corrupt state file refuses writes instead of silently falling back to an empty state; an empty-state write over a non-empty disk is rejected; `.prev` copy kept before every write.
- **Panel**: renamed seats (architect / reviewer / PM / engineer / delivery secretary), three-shape picker at intake, importance/urgency quadrant with hover expansion, portfolio strip, time-box section, knowledge/ownership sections, package list, per-document budget display.
- Directory moved from `solo-company` to `wanxiang-hall`; package renamed to `dsh-wanxiang-hall`.

## 1.7.0

- Last version under the old name (一言堂 / 朝堂): 5 seats, one hard-coded pipeline, `court_*` tools, panel with stage / progress / rounds / documents / sessions.
