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

```bash
brew install gh supabase
npm i -g @openai/codex-cli
git clone https://github.com/3d-wiki-admin/nightshift ~/.nightshift
cd ~/.nightshift
./scripts/install.sh --link-bin
```

`--link-bin` drops a symlink to the `nightshift` CLI into `~/.local/bin` or `~/bin` if either is on PATH (no sudo). Use `--system-bin` to place it under `/usr/local/bin` (with sudo). Either way, `install.sh` also packages the self-contained Claude plugin runtime so `/plugin install` works immediately.

Inside Claude Code:
```
/plugin install ~/.nightshift/claude
```

## Use — idea-first flow (v1.1 default)

**Step 1 (shell):** register a fresh project + write a minimal meta scaffold.
```bash
nightshift init ~/dev/your-new-project
cd ~/dev/your-new-project
claude
```

**Step 2 (Claude):** 6-question intake interview + approval checkpoint.
```
/nightshift intake --project ~/dev/your-new-project
```

Answer the questions, review the proposed stack/template/providers/risk-class, say **"да / go / ok"** to approve.

**Step 3 (Claude):** scaffold the project — only after approval.
```
/nightshift confirm-scaffold
```

**Step 4+ (Claude):** the rest of the pipeline.
```
/plan                 # plan + research + data-model + API
/analyze              # consistency check
/tasks                # decompose into the next wave
/implement            # run the wave
/review-wave          # adversarial wave review (GPT-5.4, 60 min)
/sync                 # refresh graphs/index/state/compliance
/status               # ASCII dashboard
```

`/bootstrap` still exists as an internal recovery command — useful when a project's files were accidentally deleted. It is **not** the public entry point; `nightshift init` is.

See the [spec](./NIGHTSHIFT_MASTER_SPEC.md) for the full command catalog (§8), skills (§7), and event schema (§11).

## Layout

```
nightshift/
├── core/              # platform-agnostic brain (event store, schemas, scripts, skills, templates)
├── claude/            # Claude Code plugin (agents, commands, hooks)
├── codex/             # Codex CLI plugin
├── launchd/           # macOS agents for overnight safety
├── scripts/           # top-level install and setup
└── docs/              # architecture, agents, secrets, contributing
```

## License

MIT — see `LICENSE`.
