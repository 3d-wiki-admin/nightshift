# nightshift

**Multi-agent development plugin on top of Claude Code + Codex CLI.**

Describe a project in chat, sleep, wake up to a reviewed, deployed implementation with a full audit trail that proves the agents followed the rules.

> Status: v1.0 (build in progress). Design is frozen — see `NIGHTSHIFT_MASTER_SPEC.md`.

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
./scripts/install.sh
```

Inside Claude Code:
```
/plugin install ~/.nightshift/claude
```

## Use

```bash
cd ~/dev/your-new-project
claude
```

Then in Claude:
```
/bootstrap
/nightshift start     # interview: constitution + spec
/plan                 # plan + research + data-model + API
/analyze              # consistency check
/tasks                # decompose into next wave
/implement            # run the wave
/review-wave          # adversarial wave review
/sync                 # refresh graphs/index/state/compliance
/status               # ASCII dashboard
```

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
