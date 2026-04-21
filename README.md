# nightshift

**Multi-agent development plugin on top of Claude Code + Codex CLI.**

Describe a project in chat, sleep, wake up to a reviewed, deployed implementation with a full audit trail that proves the agents followed the rules.

> Status: v1.1 in progress — install + wiring hardening accepted (Wave A), idea-first intake flow accepted (Wave B), retrieval memory + Codex adapter honesty next. Design is frozen — see `NIGHTSHIFT_MASTER_SPEC.md` and `nightshift_v1_1_dev_brief.md`.

## What you get

- **Contracts before code.** Every task has a machine-checkable contract with `allowed_files`, risk class, hard gates.
- **Append-only event log.** `events.ndjson` is the canonical store; `state.json` and `compliance.md` are derived.
- **Adversarial review.** Reviewer model ≠ implementer model. Every dimension has evidence paths.
- **Hard gates before acceptance.** Quality score is only for ranking; acceptance is binary.
- **Overnight safety.** launchd pinger unsticks stalled work; 8am digest tells you what happened.
- **Risk-class gating.** `approval-required` tasks block on recorded human approval.

## Install (macOS)

Prereqs: `claude` (Claude Code CLI), `codex` (OpenAI Codex CLI, optional — implementer falls back to Claude Sonnet if missing), Node 22, pnpm 10, git.

```bash
# One-time host setup (if you don't already have these)
npm i -g @openai/codex-cli   # optional; only needed for Codex-backed implementer
# (Claude Code CLI install per https://code.claude.com/docs)

# Clone + install nightshift
git clone https://github.com/3d-wiki-admin/nightshift ~/.nightshift
cd ~/.nightshift
./scripts/install.sh --link-bin
```

`--link-bin` drops a symlink to the `nightshift` CLI into `~/.local/bin` (no sudo). If `~/.local/bin` is not on PATH, the installer prints a one-line reminder — add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc and re-source it.

### Install the Claude plugin

Claude Code ≥ 2.1 installs plugins via marketplaces, not direct paths. The repo ships its own single-plugin marketplace at `.claude-plugin/marketplace.json`, so the flow is:

```
# inside any Claude Code session
/plugin marketplace add ~/.nightshift
/plugin install nightshift@nightshift
/reload-plugins
```

Pick **user scope** when prompted — the plugin becomes available in every Claude Code session, in any directory. After `/reload-plugins` you should see `1 plugin · 19 skills · 16 agents · 6 hooks · 0 errors`.

> Commands land under the `/nightshift:` namespace — `/nightshift:plan`, `/nightshift:tasks`, `/nightshift:implement`, etc. Typing `/nightshift:` and hitting Tab enumerates them all.

## Use — idea-first flow (v1.1 default)

**Step 1 (shell):** register a fresh project + write a minimal meta scaffold. The CLI prints exactly one command to paste — `cd` and `claude` in a single line.
```bash
nightshift init ~/dev/your-new-project
# prints: cd <path> && claude "/nightshift intake --project <path>"
```

If you want init to exec `claude` immediately (no copy step):
```bash
nightshift init ~/dev/your-new-project --claude-now
```

**Step 2 (Claude):** 6-question intake interview + approval checkpoint.
```
/nightshift:nightshift intake --project ~/dev/your-new-project
```

Answer the questions, review the proposed stack/template/providers/risk-class, say **"да / go / ok"** to approve.

**Step 3 (Claude):** scaffold the project — only after approval.
```
/nightshift:nightshift confirm-scaffold
```

**Step 4+ (Claude):** the rest of the pipeline — all commands namespaced under `/nightshift:`.
```
/nightshift:plan                 # plan + research + data-model + API
/nightshift:analyze              # consistency check
/nightshift:tasks                # decompose into the next wave
/nightshift:implement            # run the wave
/nightshift:review-wave          # adversarial wave review (GPT-5.4)
/nightshift:sync                 # refresh graphs/index/state/compliance
/nightshift:status               # ASCII dashboard
```

`/bootstrap` still exists as an internal recovery command — useful when a project's files were accidentally deleted. It is **not** the public entry point; `nightshift init` is.

See the [spec](./NIGHTSHIFT_MASTER_SPEC.md) for the full command catalog (§8), skills (§7), and event schema (§11).

## Layout

```
nightshift/
├── core/              # platform-agnostic brain (event store, schemas, scripts, skills, templates)
├── claude/            # Claude Code plugin (agents, commands, hooks)
├── codex/             # Codex CLI adapter (skill prompts + automations manifest — see codex/README.md)
├── launchd/           # macOS agents for overnight safety
├── scripts/           # top-level install and setup
└── docs/              # architecture, agents, secrets, contributing
```

## License

MIT — see `LICENSE`.
