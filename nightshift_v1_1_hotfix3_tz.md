# Nightshift v1.1.1 — Hotfix-3 TZ (H16 solo, round 2 after spike)

**Scope:** H16 (wave-end handoff + pinger-driven fresh `claude -p` spawn
per wave) only. H9/H12/H13/B-02 graduate separately.

**Goal:** auto-clear orchestrator context between waves in overnight
mode. Target savings ~500k tokens / $150-200 per 4-5 wave overnight.

**Suite baseline:** 284/284 on Darwin.

> **Round-1 status:** revise — 5 FAIL + 3 NOTE. Spike ran, identified
> correct primitive = `claude -p "/slash-command"`.
> **Round-2 status:** revise — 4 PASS + 4 FAIL. Acknowledged: race-prone
> session_id source, no autonomous gate, parser contradiction, test gaps.
> **Round-3 applies** 6 structural fixes: session.start-tail for sid,
> NIGHTSHIFT_AUTONOMOUS env gate, stable hash-based claim key with
> stale-claim recovery, orphan-handoff repair, parser strict-reject
> duplicates + actually parsed by pinger, expanded test matrix.

---

## Problem (unchanged)

Single orchestrator session lives through all waves. Wave 0 on
kw-injector-v1: 629k tokens by morning. 4-5 waves × ~100k context
each = $150-200 waste per night.

Between waves in overnight mode: no chat user nuance. All
load-bearing state on disk (events.ndjson, memory/*, tasks/*).

## Core design (rewritten after spike)

**Primitive:** `claude -p "/nightshift:implement --wave=<N+1>"` —
verified in spike as:
- Non-interactive
- Supports plugin slash commands
- Supports multi-turn tool orchestration within one print turn
- Exits cleanly when turn completes
- No `--continue` → fresh session, no context bleed

**Flow:**

```
[orchestrator wave N session]
   emit wave.accepted
   write tasks/waves/N/handoff-to-next.md (audit + operator visibility)
   emit wave.handoff event
   turn ends naturally (if -p invocation) or user gets /status (if interactive)

[pinger, every 30 min]
   1. openQuestions check (H14) — unchanged, first priority
   2. [NEW] resurrect-fresh check (requires NIGHTSHIFT_AUTONOMOUS=1
      env from launchd plist):
        if most recent wave.handoff points at a next_manifest that
        exists, handoff file exists + parses, NO task.dispatched for
        that wave, AND either no claim file at
        `.nightshift/wave-claim-<key>` OR existing claim is stale
        (pid dead + no recent session events + age > 2h):
          create claim file atomically via O_EXCL
          where <key> = first 16 chars of
          sha256("source_wave:next_wave:next_manifest")
          spawn detached: claude -p --dangerously-skip-permissions
                "/nightshift:implement --wave=<N+1>"
                with env NIGHTSHIFT_SESSION_ID=<newSid>
          rewrite claim file with spawned pid
          emit session.start with payload.source=pinger-resurrect,
                payload.triggering_handoff=<event_id>
          exit pinger (work dispatched)
   3. Stale-check (current behavior) — unchanged fallback
```

## Three layers, in implementation order

### Layer A — schema + skill

#### A.1 `core/schemas/event.schema.json`

Add `"wave.handoff"` to `action.enum`. Grouped near `wave.accepted`.

#### A.2 `core/skills/wave-orchestrator/SKILL.md`

Append section `## Wave-end handoff`:

After emitting `wave.accepted`, if a next wave manifest exists at
`tasks/waves/<N+1>/manifest.yaml`, perform these steps IN ORDER
before ending the turn:

1. Compose handoff file `tasks/waves/<N>/handoff-to-next.md` with
   EXACTLY these six sections (all required; parser pattern-matches
   on heading text verbatim; empty content OK but heading MUST be
   present):

   ```markdown
   # Handoff — wave <N> → wave <N+1>

   ## Machine fields
   - source_wave: <N>
   - next_wave: <N+1>
   - source_session_id: <orchestrator's current session_id>
   - handoff_token: <ULID or hash, correlation for audit>

   ## Wave <N> summary
   <one paragraph prose>

   ## Pending from this wave
   <bulleted list of blocked/paused/follow-up task ids; "- none" ok>

   ## Next wave pointer
   - manifest: tasks/waves/<N+1>/manifest.yaml
   - first task: <TASK-ID>

   ## Canonical state to re-read
   - tasks/events.ndjson  ← PRIMARY canonical store
   - CLAUDE.md
   - HANDOFF.md
   - memory/constitution.md
   - tasks/spec.md
   - tasks/plan.md
   - tasks/paused.md
   - tasks/waves/<N+1>/manifest.yaml
   - tasks/waves/<N>/handoff-to-next.md (this file)

   ## Ephemeral nuances
   <bulleted list; autonomous overnight: usually "- none">
   ```

   The "Machine fields" section in round-2 is a fix for reviewer-cited
   "underspec'd machine contract". `handoff_token` enables audit
   correlation; `source_session_id` ties handoff to the exiting
   session. `source_wave` + `next_wave` avoid regex-parsing the
   manifest path for integer wave numbers.

2. Emit the `wave.handoff` event with full payload including the
   machine fields.

   Session_id resolution (round-4 fix: prefer runtime env, fall back
   to log-history only if env missing). Primary source is
   `$NIGHTSHIFT_SESSION_ID` per the pattern already established in
   `core/scripts/wave-reviewer.mjs:122-125` and
   `core/provisioners/interface.mjs:13-17`. Log-grep is a last-resort
   defensive fallback, not the canonical path:

   ```bash
   SID="${NIGHTSHIFT_SESSION_ID:-$(grep '"action":"session.start"' \
           tasks/events.ndjson | tail -n 1 | jq -r .session_id)}"
   # Validate shape — if env was garbage, fall through to log-grep:
   if ! [[ "$SID" =~ ^sess_[0-9A-HJKMNP-TV-Z]{20,40}$ ]]; then
     SID="$(grep '"action":"session.start"' tasks/events.ndjson | \
             tail -n 1 | jq -r .session_id)"
   fi
   TOKEN="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
   jq -nc --arg sid "$SID" \
      --argjson sw <N> \
      --argjson nw <N+1> \
      --arg token "$TOKEN" \
      --arg hp "tasks/waves/<N>/handoff-to-next.md" \
      --arg nm "tasks/waves/<N+1>/manifest.yaml" '{
        session_id: $sid,
        wave: $sw,
        agent: "wave-orchestrator",
        action: "wave.handoff",
        outcome: "success",
        payload: {
          source_wave: $sw,
          next_wave: $nw,
          source_session_id: $sid,
          handoff_token: $token,
          handoff_path: $hp,
          next_manifest: $nm
        }
      }' | nightshift dispatch append --log tasks/events.ndjson
   ```

   Round-4 fix: `payload.source_session_id` is ALWAYS included
   (normal and repaired events alike). The consumer cross-check
   (Layer B) validates against `event.payload.source_session_id`,
   NOT `event.session_id`. This means repaired events (where
   top-level `session_id` = pinger's) still pass the cross-check
   because the payload carries the original orchestrator's id.
   ```

3. Atomic rule: write file FIRST, emit event SECOND. If file write
   fails → abort before emitting event; log to stderr. If event
   emission fails after file was written → DO NOT rollback file
   (file is idempotent; next orchestrator tick can re-attempt event
   emit). The skill prompt tells the orchestrator to retry event
   emission up to 2 times before giving up.

4. After both succeed, the orchestrator's turn ends normally. In
   interactive mode, the user sees it in chat + can continue manually.
   In -p mode (pinger-launched), Claude's print turn ends → process
   exits cleanly → fresh session closes the wave.

**Skill-side behavior is mode-agnostic** — orchestrator always writes
handoff + event + ends turn, regardless of interactive vs -p mode.
The **mode gate lives on the PINGER** (see Layer B): pinger only
fires the resurrect-fresh path when `NIGHTSHIFT_AUTONOMOUS=1` env is
set (launchd plist sets it; interactive user runs don't have it).
This split-responsibility keeps the skill simple while making
autonomous-mode activation explicit at the scheduler boundary.

### Layer B — pinger resurrect-fresh path

#### B.1 `core/scripts/health-ping.mjs`

Rework the pipeline ordering (reviewer's FAIL #3 fix):

```js
async function main() {
  // ... existing setup through `events` + `state` ...

  // 1. openQuestions short-circuit (H14) — UNCHANGED, remains first
  const openQs = openQuestions(events);
  if (openQs.length > 0) {
    // emit session.paused + pinger.ping{skipped:awaiting_human}
    // say on Darwin, etc.  (all existing H14 logic)
    return;
  }

  // 2. [NEW H16] Resurrect-fresh check — runs BEFORE the
  //    `!inProgressWaves.length` early return (reviewer's fix):
  const handoffClaim = await detectResurrectFreshOpportunity(projectDir, events);
  if (handoffClaim) {
    // Already emitted an attempted pinger.ping inside this function.
    return;
  }

  // 3. Existing pinger logic — append pinger.ping, check in-progress
  //    waves, staleness, claude --continue — UNCHANGED.
  await appendEvent(logPath, {
    session_id: sid,
    agent: 'health-pinger',
    action: 'pinger.ping',
    payload: { source: 'launchd', project: projectDir }
  });
  // ... existing stale-check / attemptUnstick / pauseTask ...
}
```

`detectResurrectFreshOpportunity(projectDir, events)` logic:

```js
async function detectResurrectFreshOpportunity(projectDir, events) {
  // Round-3 fix #2: autonomous-mode gate. Only fires when launchd
  // plist sets NIGHTSHIFT_AUTONOMOUS=1. Interactive runs (user typing
  // `nightshift health-ping` manually or daytime launchd without
  // plist update) don't resurrect.
  if (process.env.NIGHTSHIFT_AUTONOMOUS !== '1') return null;

  // Find most recent wave.handoff
  const handoff = events.slice().reverse().find(e => e.action === 'wave.handoff');
  if (!handoff) {
    // Round-3 fix #6: orphan handoff file repair. Did orchestrator
    // write a file but fail to emit the event?
    await maybeRepairOrphanHandoff(projectDir, events);
    return null;
  }

  const { next_manifest, handoff_path, next_wave, source_wave, handoff_token } = handoff.payload || {};
  if (!next_manifest || !handoff_path || next_wave == null || source_wave == null || !handoff_token) {
    console.error('[pinger] wave.handoff missing required payload fields; ignoring.');
    return null;
  }

  const nextManifestAbs = path.resolve(projectDir, next_manifest);
  const handoffAbs = path.resolve(projectDir, handoff_path);
  if (!await pathExists(nextManifestAbs) || !await pathExists(handoffAbs)) {
    console.error(`[pinger] wave.handoff references missing files — not spawning; handoff_token=${handoff_token}`);
    return null;
  }

  // Round-3 fix #3: parse the handoff file (not just existence-check).
  // Rejects malformed before spawning. parseHandoff is strict on
  // duplicate headings — rejects if same-level heading appears twice.
  const { parseHandoff } = await import('./wave-handoff.mjs');
  let parsed;
  try {
    const raw = await fs.readFile(handoffAbs, 'utf8');
    parsed = parseHandoff(raw);
  } catch (err) {
    console.error(`[pinger] handoff file parse failed; not spawning: ${err.message}`);
    return null;
  }
  // Cross-check ALL parsed machine fields vs event payload (round-4
  // fix: was only source_wave + next_wave in round 3). Any drift
  // between file and event means something rewrote one without the
  // other — unsafe to act on.
  // Round-4 fix: use payload.source_session_id as source of truth,
  // NOT event.session_id. Repaired events (emitted by pinger) have
  // top-level session_id = pinger's, but payload preserves the
  // orchestrator's original. Normal events have both equal. This
  // unifies the cross-check for both paths.
  const mfExpected = {
    source_wave,
    next_wave,
    source_session_id: handoff.payload?.source_session_id,
    handoff_token
  };
  if (!mfExpected.source_session_id) {
    console.error('[pinger] wave.handoff payload missing source_session_id; legacy event, not spawning.');
    return null;
  }
  const mismatches = Object.keys(mfExpected).filter(k =>
    parsed.machine_fields[k] !== mfExpected[k]);
  if (mismatches.length > 0) {
    console.error(`[pinger] handoff file/event mismatch on: ${mismatches.join(', ')}; not spawning.`);
    return null;
  }
  // next_manifest path in machine_fields should also match payload:
  const mfNextManifest = parsed.next_wave_pointer?.manifest;
  if (mfNextManifest && mfNextManifest !== next_manifest) {
    console.error('[pinger] handoff file next_manifest disagrees with event payload; not spawning.');
    return null;
  }

  // Idempotency: have we already dispatched into this wave?
  const alreadyDispatched = events.some(e =>
    e.action === 'task.dispatched' && Number(e.wave) === Number(next_wave));
  if (alreadyDispatched) return null;

  // Round-3 fix #4: STABLE claim key — not handoff_token (which
  // changes per re-emit). Use deterministic hash of the wave
  // transition + manifest path. Re-emits of the same handoff map to
  // the same claim file.
  const crypto = await import('node:crypto');
  const claimKey = crypto.createHash('sha256')
    .update(`${source_wave}:${next_wave}:${next_manifest}`)
    .digest('hex').slice(0, 16);
  const claimFile = path.join(projectDir, '.nightshift', `wave-claim-${claimKey}`);

  // Round-4 fix: LIVENESS-AWARE claim recovery. Round-3 was age-only;
  // reviewer correctly flagged that a still-running claude -p that
  // hasn't yet emitted task.dispatched would be killed + double-
  // spawned at 2h. Now we check:
  //   1. process alive? (kill -0 on stored pid)
  //   2. any events from stored new_session_id in last 2h?
  // Either "yes" → claim still live, don't retry.
  // Both "no" + age > 2h → recover.
  const STALE_CLAIM_MS = 2 * 60 * 60 * 1000;
  try {
    const stat = await fs.stat(claimFile);
    const ageMs = Date.now() - stat.mtimeMs;
    const claimJson = JSON.parse(await fs.readFile(claimFile, 'utf8'));
    const claimPid = claimJson.pid;
    const claimSid = claimJson.new_session_id;

    // Liveness check 1: is the spawned process still alive?
    let procAlive = false;
    if (claimPid) {
      try { process.kill(claimPid, 0); procAlive = true; }
      catch { /* ESRCH = process gone; EPERM = alive but other user (shouldn't happen for our own spawn) */ }
    }

    // Liveness check 2: did the spawned session recently emit any event?
    const recentActivity = claimSid && events.some(e =>
      e.session_id === claimSid &&
      (Date.now() - new Date(e.ts).getTime()) < STALE_CLAIM_MS);

    if (procAlive || recentActivity) {
      // Live claim — whatever we spawned is still doing work (or has
      // crashed very recently but will eventually be timed out).
      return null;
    }

    // Both checks failed AND age > TTL → declare stale + recover.
    if (ageMs > STALE_CLAIM_MS) {
      console.error(`[pinger] stale claim ${claimKey} recovered: pid ${claimPid} gone, no events from ${claimSid}, age ${Math.round(ageMs / 60000)}m`);
      await fs.unlink(claimFile);
      await appendEvent(path.join(projectDir, 'tasks', 'events.ndjson'), {
        session_id: sessionId(),
        agent: 'health-pinger',
        action: 'session.halted',
        outcome: 'failure',
        payload: {
          reason: 'stale_claim_recovered',
          claim_key: claimKey,
          stale_pid: claimPid,
          stale_session_id: claimSid,
          next_wave,
          age_ms: ageMs
        }
      });
      // fall through to fresh spawn below
    } else {
      // Not alive but not yet stale — wait one more tick before recovery
      return null;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // ENOENT: no existing claim; proceed to create one below
  }

  // Create claim atomically via O_EXCL (fs.open 'wx'). APFS + macOS
  // guarantee atomic create here.
  // Round-4: pid + new_session_id baked in before spawn so recovery
  // can check liveness. (Write once claim is created; pid from child
  // spawn result; we write claim FIRST to reserve, then rewrite with
  // pid after spawn succeeds.)
  const newSid = sessionId();
  try {
    await fs.mkdir(path.dirname(claimFile), { recursive: true });
    const fh = await fs.open(claimFile, 'wx');
    await fh.write(JSON.stringify({
      claim_key: claimKey,
      handoff_token,
      triggering_handoff: handoff.event_id,
      source_wave, next_wave,
      new_session_id: newSid,
      pid: null,                   // rewritten after spawn
      created_at: new Date().toISOString()
    }, null, 2));
    await fh.close();
  } catch (err) {
    if (err.code === 'EEXIST') return null;
    throw err;
  }

  // Emit session.start{source:pinger-resurrect}. Uses the newSid
  // already generated + baked into the claim file above.
  await appendEvent(
    path.join(projectDir, 'tasks', 'events.ndjson'),
    {
      session_id: newSid,
      agent: 'system',
      action: 'session.start',
      payload: {
        source: 'pinger-resurrect',
        triggering_handoff: handoff.event_id,
        handoff_token,
        next_wave
      },
      notes: `pinger spawning fresh claude -p for wave ${next_wave}`
    }
  );

  // Spawn fresh claude -p detached
  const cli = process.env.NIGHTSHIFT_CLAUDE_CMD || 'claude';
  const args = [
    '-p',
    '--dangerously-skip-permissions',
    `/nightshift:implement --wave=${next_wave}`
  ];
  const child = spawn(cli, args, {
    cwd: projectDir,
    env: { ...process.env, NIGHTSHIFT_SESSION_ID: newSid },
    stdio: 'ignore',
    detached: true
  });
  child.on('error', err => {
    console.error(`[pinger] claude -p spawn failed: ${err.message}`);
    // Emit session.halted so audit captures the failure
    appendEvent(
      path.join(projectDir, 'tasks', 'events.ndjson'),
      {
        session_id: newSid,
        agent: 'system',
        action: 'session.halted',
        outcome: 'failure',
        payload: { reason: 'pinger_spawn_failed', error: err.message }
      }
    ).catch(() => {});
    // Remove claim so next tick can retry
    fs.unlink(claimFile).catch(() => {});
  });
  child.unref();

  // Round-4: rewrite claim file with spawned pid so liveness recovery
  // works. Non-atomic rewrite is fine — we're the only writer.
  try {
    const current = JSON.parse(await fs.readFile(claimFile, 'utf8'));
    current.pid = child.pid;
    await fs.writeFile(claimFile, JSON.stringify(current, null, 2));
  } catch {
    // If rewrite fails, liveness check falls back to session events
    // presence (claimSid check); not fatal.
  }

  return { handoff_token, new_session_id: newSid, pid: child.pid };
}
```

Key properties:
- **Ordered BEFORE** `!inProgressWaves.length` return (reviewer FAIL #3)
- **`NIGHTSHIFT_AUTONOMOUS=1` gate** — only fires when launchd plist
  sets the env; interactive / daytime don't trigger (round-3 fix #2)
- **Parses handoff file** via `parseHandoff()` before spawning
  (round-3 fix — not just existence-check); cross-checks machine
  fields vs event payload
- **Stable claim key** = sha256 hash of `source_wave:next_wave:next_manifest`
  truncated to 16 chars. Re-emits map to same claim file (round-3 fix #4)
- **Stale-claim recovery** (round-4 liveness-aware gate) — three-AND
  rule: spawned pid dead (`kill -0` fails ESRCH) AND stored
  new_session_id has NO events in last 2h AND claim mtime > 2h →
  remove claim + emit `session.halted{reason:stale_claim_recovered}`
  carrying stale pid + stale session id + retry this tick. If ANY of
  the three conditions is false, claim stays (live-process /
  recent-activity / not-yet-aged). See F-K fixture for exact behavior.
- **Orphan handoff repair** — handoff file exists but no wave.handoff
  event → pinger emits repair event (round-3 fix #6)
- **New `session_id`** for fresh session, env-propagated via
  `NIGHTSHIFT_SESSION_ID` to the spawned claude -p
- **Emits `session.start{source:pinger-resurrect}`** with correlation
  to triggering handoff via `handoff_token` + `event_id`
- **Fails open**: spawn error → remove claim → emit session.halted →
  next pinger tick can retry

`maybeRepairOrphanHandoff(projectDir, events)` helper:
```js
async function maybeRepairOrphanHandoff(projectDir, events) {
  // Look for tasks/waves/<N>/handoff-to-next.md on disk where no
  // matching wave.handoff event exists. Only acts on the most-recent
  // orphan.
  // Round-4 fix: numeric descending sort (round-3 had lex reverse
  // which would put wave "10" BEFORE wave "2" — wrong).
  const waves = await fs.readdir(path.join(projectDir, 'tasks', 'waves')).catch(() => []);
  const numericDesc = waves
    .filter(w => /^\d+$/.test(w))
    .map(w => parseInt(w, 10))
    .sort((a, b) => b - a)
    .map(n => String(n));
  for (const w of numericDesc) {
    const hp = `tasks/waves/${w}/handoff-to-next.md`;
    const hpAbs = path.join(projectDir, hp);
    if (!await pathExists(hpAbs)) continue;

    const hasEvent = events.some(e =>
      e.action === 'wave.handoff' && e.payload?.handoff_path === hp);
    if (hasEvent) continue;

    // Orphan: parse it, emit a repair wave.handoff event with
    // payload.repaired: true so audit can distinguish. Next tick
    // picks it up via the normal resurrect path.
    const { parseHandoff } = await import('./wave-handoff.mjs');
    const raw = await fs.readFile(hpAbs, 'utf8');
    let parsed;
    try { parsed = parseHandoff(raw); }
    catch (err) {
      console.error(`[pinger] orphan handoff file ${hp} is malformed; skipping repair.`);
      continue;
    }
    const mf = parsed.machine_fields;
    await appendEvent(path.join(projectDir, 'tasks', 'events.ndjson'), {
      session_id: sessionId(),
      agent: 'health-pinger',
      action: 'wave.handoff',
      outcome: 'success',
      wave: mf.source_wave,
      payload: {
        source_wave: mf.source_wave,
        next_wave: mf.next_wave,
        handoff_path: hp,
        next_manifest: `tasks/waves/${mf.next_wave}/manifest.yaml`,
        handoff_token: mf.handoff_token,
        repaired: true,
        source_session_id: mf.source_session_id
      }
    });
    return;   // one repair per tick
  }
}
```

### Layer C — orchestrator skill safeguards

Beyond the handoff writer in A.2, add in SKILL.md:

- Parser strictness (round-3 fix #3 — eliminates earlier contradiction):
  `parseHandoff()` REJECTS the file if any of these conditions:
  - Any of the 6 required H2 sections missing
  - Sections out of order
  - ANY H2 heading appears more than once (duplicates = reject, NOT
    last-wins; single consistent rule)
  - "Machine fields" section lacks any required subfield
    (source_wave, next_wave, source_session_id, handoff_token)
  - source_wave / next_wave not parseable as integers
  Pinger calls parseHandoff BEFORE spawning (see Layer B). Tests
  cover each rejection class.

- Fallback for pinger-not-installed: orchestrator prints a message
  to chat (interactive) OR writes `tasks/paused.md` entry
  (-p mode) saying "wave <N> complete; pinger not installed →
  user runs: `cd <project> && claude \"/nightshift:implement --wave=<N+1>\"`".
  Detection: check `launchctl list | grep ai.nightshift.pinger` on
  Darwin, OR existence of `~/Library/LaunchAgents/ai.nightshift.pinger.plist`.

- Explicit reminder: orchestrator does NOT pre-emptively start
  wave <N+1>. That's the caller's job (pinger or user).

### Layer D — launchd plist env + preflight + doctor

#### D.1 `launchd/ai.nightshift.pinger.plist`

Add `<key>EnvironmentVariables</key>` with `NIGHTSHIFT_AUTONOMOUS=1`
(round-3 fix #2). This is the gate that distinguishes launchd-driven
resurrection from interactive `nightshift health-ping` calls.

Existing env keys in plist (`__NIGHTSHIFT_ACTIVE_PROJECT__`, `__HOME__`)
are preserved — just add the new one. `install-launchd.sh` does NOT
need changes (it just templates substitutions into the plist); the
env variable is static.

#### D.2 preflight + doctor

Add to `core/scripts/preflight.sh`:
- Check: if a recent `wave.handoff` event exists, parse its
  payload fields `source_wave`, `next_wave`, `next_manifest`, and
  compute the claim filename the pinger would use:
  ```bash
  KEY=$(printf '%s:%s:%s' "$SW" "$NW" "$NM" | \
        shasum -a 256 | head -c 16)
  CLAIM_FILE=".nightshift/wave-claim-${KEY}"
  ```
  If `$CLAIM_FILE` does NOT exist AND NO `task.dispatched` event
  for `next_wave` is in events.ndjson → WARN (exit 2) with
  "wave <N+1> handoff is waiting; pinger should resurrect within
  30 min, or run `/nightshift:implement --wave=<N+1>` manually."
- Gate the "launchd not installed" check behind a new flag:
  `preflight --require-launchd` turns the existing WARN (exit 2)
  into FAIL (exit 1). Default stays WARN (backward-compat).

`nightshift launchd status` already exists (scripts/nightshift.sh
`launchd` subcommand); SKILL.md fallback instructions should
reference it rather than raw `launchctl` commands.

## Acceptance tests

### Test 1: `core/event-store/test/schema-wave-handoff.test.mjs`

Round-trip: `wave.handoff` event validates + append/read cycle.
Pattern from `schema-action-enum.test.mjs`.

### Test 2: `core/scripts/test/hotfix3-wave-handoff-render.test.mjs`

Pure function test of handoff file render/parse (extract to module
`core/scripts/wave-handoff.mjs`):
- renderHandoff(inputs) → markdown with 6 sections in exact order
- parseHandoff(markdown) → structured object, roundtrips renderHandoff output
- Rejects: missing section, duplicate-same-level, out-of-order,
  extra level-1 heading, empty "Machine fields" subfield

### Test 3: `core/scripts/test/hotfix3-pinger-resurrect-fresh.test.mjs`

18 fixtures (rounds 1→2→3→4 cumulative coverage):

- **F-A (accepted-wave / no-in-progress path)**: wave.accepted +
  wave.handoff events + `tasks/waves/1/manifest.yaml` file +
  handoff-to-next.md file + NO in-progress waves → pinger DOES
  spawn fresh claude -p (this is the path reviewer flagged as
  broken in round-1 because H16 check was AFTER the no-in-progress
  return). Fake claude records argv, assert `--continue` NOT in argv.

- **F-B (question wins over handoff)**: both `question.asked`
  unresolved AND a wave.handoff in same log → `openQuestions()`
  short-circuit fires, NO fresh spawn, session.paused emitted per
  H14. Proves pipeline ordering from H14 + H16 composes correctly.

- **F-C (concurrent pinger claim)**: two pinger runs invoked in
  parallel (spawnSync'd back-to-back). Only ONE creates the
  claim-sentinel + spawns fresh claude; the other sees EEXIST and
  returns quiet. Proves O_EXCL atomicity.

- **F-D (handoff missing files)**: wave.handoff event exists but
  handoff-to-next.md or next manifest file is MISSING → no spawn,
  stderr warning logged, pinger proceeds to normal stale-check path.

- **F-E (already-dispatched)**: wave.handoff + claim sentinel +
  a `task.dispatched` for next_wave in events → pinger does NOT
  re-spawn (work already in progress).

- **F-F (spawn failure)**: mock `spawn` to emit 'error' event →
  assert: claim sentinel REMOVED, session.halted event emitted with
  `payload.reason: pinger_spawn_failed`, process exits 0 (pinger
  errors don't cascade — next tick retries).

- **F-G (malformed handoff payload)**: wave.handoff event present
  but `payload.next_manifest` is empty string → no spawn, warning
  logged. Proves we validate payload before acting.

- **F-H (last-wave path)**: wave.accepted emitted but NO
  wave.handoff follows (orchestrator detected no next manifest →
  skipped handoff) → pinger proceeds normally (no resurrect path
  fires; falls to existing stale-check / done-state).

- **F-I (autonomous-mode gate)**: valid wave.handoff event + valid
  handoff file + `NIGHTSHIFT_AUTONOMOUS` env NOT set → pinger does
  NOT spawn. Set env → same inputs → pinger DOES spawn. (round-3
  fix #2 coverage)

- **F-J (claim key stable across re-emits)**: wave.handoff event
  emitted twice with DIFFERENT handoff_token values for the same
  wave transition (e.g. after a repair) → claim key is the same,
  only one spawn happens. (round-3 fix #4 coverage)

- **F-K (liveness-aware stale-claim recovery)**: claim sentinel
  exists storing a pid that does NOT exist (kill -0 fails with
  ESRCH), stored `new_session_id` has NO events in last 2h, AND
  claim mtime is >2h old → pinger removes claim, emits
  session.halted{reason:stale_claim_recovered} carrying the stale
  pid + stale session id, creates fresh claim + spawns.
  Negative tests in same fixture: (a) pid alive → don't recover;
  (b) pid gone BUT recent session events exist → don't recover;
  (c) both failing but age < 2h → don't recover. All three must
  false for recovery. (round-4 fix for new-hole #1)

- **F-L (orphan handoff file repair)**: `tasks/waves/N/handoff-to-next.md`
  exists on disk + well-formed + NO wave.handoff event with that
  handoff_path in events → pinger emits repair wave.handoff event
  with `payload.repaired: true`; next tick picks it up via normal
  resurrect path.

- **F-M (session-id propagation)**: pinger spawns fresh claude -p
  with `NIGHTSHIFT_SESSION_ID=<newSid>` in env; fake claude appends
  an event to events.ndjson using that env var → event has correct
  session_id matching the one pinger emitted for session.start.
  (addresses new-hole #3 from round-2)

- **F-N (child exits before any task.dispatched)**: spawned fake
  claude exits 0 after 1 second with no `task.dispatched` events
  written → claim remains (claim is terminal per tick), next
  pinger tick sees claim + no dispatched → after 2h is auto-recovered
  per F-K path. Short-term test: verify pinger doesn't double-spawn
  on immediate next tick while claim is fresh (round-4: verify via
  liveness-aware recovery — pid still alive → don't recover; pid
  gone but age < 2h → don't recover either).

- **F-O (preflight --require-launchd)**: on a system where
  `launchctl list | grep ai.nightshift.pinger` returns empty:
  - Without `--require-launchd`: preflight exits **2** with a WARN
    ("launchd pinger not loaded — optional, needed only for
    overnight runs"). This preserves the existing preflight
    contract at `core/scripts/preflight.sh:66-69` and
    `core/skills/preflight-check/SKILL.md:17-20` — exit 2 is the
    documented warning code.
  - With `--require-launchd`: preflight exits **1** with a FAIL
    and the actionable message `launchd pinger not installed —
    run nightshift launchd install --project <path>`. Exit 1 is
    preflight's documented "fail" code.
  - Fail-no-require and Warn-no-require assertions prevent future
    drift.

- **F-P (pinger-not-installed manual fallback)**: orchestrator skill
  detects (on Darwin) that `ai.nightshift.pinger` is not loaded.
  After emitting `wave.handoff` event, also appends an entry to
  `tasks/paused.md` with the recovery command:
  `cd <project> && claude "/nightshift:implement --wave=<N+1>"`.
  Interactive user sees it + can manually kick the next wave.

- **F-Q (wave numeric sort)**: `tasks/waves/` has subdirs `2/`, `10/`,
  `3/`. `maybeRepairOrphanHandoff` picks `10/handoff-to-next.md` first
  (highest numeric wave), not `3/` (lexicographic first). Asserts
  the fix from round-4.

- **F-R (cross-check mismatch)**: wave.handoff event says
  `next_wave=5` but parsed handoff file's machine field says `next_wave=6`
  → pinger refuses to spawn, logs mismatch warning. Similar test
  for `next_manifest` path mismatch and `handoff_token` mismatch.

### Test 4: existing-test preservation

Update/verify:
- `core/scripts/test/health-ping-resume.test.mjs` — existing
  stale-to-unstick path still works (pinger fallback branch 3)
- `core/scripts/test/hotfix2-pinger-question-aware.test.mjs` —
  H14 ordering preserved (F-B test above double-checks)

## Implementation order (Codex units)

1. **Unit 1** — A.1 schema + A.2 skill handoff writer + Test 1 + Test 2
   (render/parse pure functions). Lands the producer side.

2. **Unit 2** — B.1 pinger resurrect-fresh + Test 3 F-A/F-B/F-D/F-E/F-G/F-H
   (ordering, missing files, dispatched, malformed, last-wave).
   Lands the consumer side.

3. **Unit 3** — Test 3 F-C (concurrent claim) + F-F (spawn failure).
   Harder fixtures (race + mocked failure); isolated so Unit 2
   can land first.

4. **Unit 4** — Layer C skill safeguards (parser strictness + fallback
   message + no-preempt reminder) and Layer D preflight + doctor
   updates. Small wrap-up.

Three atomic commits (or four) back-to-back; each keeps suite green.
All four together make up hotfix-3.

## Honest caveats (transparent to reviewer)

- `claude -p` turn duration: overnight runs demonstrate ~3-4 hour
  orchestrator sessions routinely. -p is the same model just without
  the "await next user input" loop at the end. No documented timeout
  I found; if one exists it's likely higher than per-turn runtime.
  If a wave's turn times out silently, the liveness-aware stale-claim
  recovery from Layer B (three-AND gate: pid dead + no recent session
  events + age > 2h) detects and recovers on a later pinger tick. See
  F-K acceptance fixture for exact behavior.

- launchd env for spawned claude: launchd agent inherits the env
  from the plist. Claude Code auth (keychain) is tied to UID — same
  user, should work. If not, spawn fails → F-F path handles.

- fork-session: we deliberately don't use `--fork-session` because
  that forks from the CURRENT session's context (not what we want —
  we want fresh). `-p` with no resume/continue gives a genuine fresh
  session, verified by the spike.

## Cross-cutting

### Suite risk register (updated)

| File | Why it might break | Mitigation |
|---|---|---|
| `core/scripts/test/health-ping-resume.test.mjs` | New pipeline branch before existing stale-check | F-A/F-H fixtures preserve the stale-check path |
| `core/scripts/test/hotfix2-pinger-question-aware.test.mjs` | openQuestions short-circuit must stay step 1 | F-B test above explicitly composes question + handoff |
| `core/scripts/test/single-writer.test.mjs` | New session.start/session.halted calls | All go through `appendEvent` — single-writer invariant unchanged |
| `core/scripts/test/preflight.test.mjs` (if exists) | New WARN on orphan handoff | Preserve existing exit codes; new check is additive |

### Atomicity

Schema (A.1) + skill (A.2) + pinger (B.1) MUST ship across commits
in order: A.1 → A.2 → B.1. Partial:
- A.1 alone: inert (enum value exists, no producer).
- A.1 + A.2: producers emit, consumers don't act — safe drop of
  events that would be ignored.
- A.1 + A.2 + B.1: fully wired.

A.1 must land BEFORE A.2 (skill emits an event that must validate).
B.1 can land any time after A.1; safe to batch with A.2 or split.

### Round-6 closure of round-5 1 FAIL + 3 doc-consistency holes

All round-5 issues were summary-vs-design drift (active design
correct; summaries/caveats/history out of sync). Round-6 sweeps:

| Round-5 item | Round-6 response |
|---|---|
| stale `.nightshift/wave-<N+1>-claiming` in top-level flow | Replaced with `.nightshift/wave-claim-<key>` + full sha256 derivation spelled out in the flow block |
| D.2 preflight under-specified on hashed claim filename | Added explicit `KEY=$(printf ... | shasum -a 256 | head -c 16)` + `CLAIM_FILE` shell derivation |
| "Honest caveats" said TTL is a follow-up | Rewrote: caveat now points at F-K + Layer B liveness-aware recovery (already implemented, not follow-up) |
| Round-1/2 closure tables said old session-id contract | Marked SUPERSEDED + pointed at active env-first contract |

### Round-4 closure of round-3 3 FAILs + 4 new holes

| Round-3 item | Round-4 response |
|---|---|
| FAIL #2 session_id still log-grep | Changed to `${NIGHTSHIFT_SESSION_ID:-<fallback>}` pattern matching `wave-reviewer.mjs:122-125`. Fallback to grep only if env missing / malformed |
| FAIL #4 autonomous-mode contradictions | Removed "no mode switch needed" text; added "mode gate lives on pinger" explicit note; plist change spec'd in Layer D.1 verbatim |
| FAIL #8 missing preflight + manual-fallback tests | Added F-O (preflight --require-launchd exit codes) + F-P (pinger-not-installed manual fallback message in paused.md) |
| New-hole #1 age-only stale recovery | Liveness-aware: claim file stores pid + new_session_id; recovery checks `kill -0 pid` AND recent session events before declaring stale. Both must fail + age > 2h |
| New-hole #2 lex sort in orphan repair | `parseInt` + numeric descending sort: wave 10 → wave 3 → wave 2 order |
| New-hole #3 autonomous-mode internal contradictions | Eliminated per FAIL #4 above; single source of truth = Layer B pinger env check |
| New-hole #4 partial cross-check | Expanded to full: source_wave, next_wave, source_session_id, handoff_token, next_manifest. F-R covers mismatch cases |
| Fixture count (13 said, 14 enumerated) | Reconciled: 18 fixtures after F-O/F-P/F-Q/F-R additions |

### Round-3 closure of round-2 4 FAILs + 5 new holes

| Round-2 item | Round-3 response |
|---|---|
| FAIL #2 race-prone session_id | Round-3: switched to `grep session.start` tail. **Round-4 SUPERSEDED**: env-first via `$NIGHTSHIFT_SESSION_ID` (matches existing pattern in `wave-reviewer.mjs:122-125`); `grep session.start` only as fallback when env is missing or malformed. |
| FAIL #4 no overnight-mode switch | `NIGHTSHIFT_AUTONOMOUS=1` env gate on pinger resurrect path; set by launchd plist (Layer D.1); interactive / daytime don't trigger |
| FAIL #6 parser contradiction | Single strict rule: reject duplicates. Pinger ACTUALLY calls `parseHandoff()` before spawning + cross-checks machine fields vs event payload |
| FAIL #8 test coverage | Added F-I through F-N (6 new fixtures); total now 14 fixtures covering claim-stability, stale recovery, orphan repair, session-id propagation, child-exits-early, autonomous gate |
| New-hole #1: detached exit before dispatch | F-K liveness-aware stale-claim recovery (pid dead + no recent session events + age > 2h — three-AND gate) + F-N tick-idempotency test |
| New-hole #2: claim identity unstable across re-emits | Stable claim key = hash(source_wave:next_wave:next_manifest); F-J test |
| New-hole #3: session_id propagation missing | `NIGHTSHIFT_SESSION_ID` env passed to `spawn`; F-M test |
| New-hole #4: parser claimed but not wired | Pinger calls parseHandoff() in detect logic (Layer B) |
| New-hole #5: orphan handoff file stranded | `maybeRepairOrphanHandoff()` emits repair wave.handoff; F-L test |

### Round-1 closure table (unchanged from round 2)

| Reviewer item | Round-2 response |
|---|---|
| 1. Atomicity (NOTE) | Schema-first ordering acknowledged; still single-commit-safe via Unit 1 containing A.1+A.2 together. |
| 2. Skill write-then-append race (NOTE) | File-first-event-second ordering; file is idempotent; event emit retries 2×. Round-4 SUPERSEDED session_id source: env-first (`$NIGHTSHIFT_SESSION_ID`) with `grep session.start` as last-resort fallback. Old `tail -n 1` text in this row refers to round-2 state. |
| 3. Pinger pipeline placement (FAIL) | Fixed: H16 check moved BEFORE `!inProgressWaves.length` return. See `health-ping.mjs::main()` sketch. |
| 4. Overnight-mode switch missing (FAIL) | **Superseded by rounds 3+4.** Mode gate lives on the PINGER via `NIGHTSHIFT_AUTONOMOUS=1` env (set by launchd plist, Layer D.1). Round-2 text "removed need for mode switch" was wrong and is deprecated; see Layer B detect function for the actual gate implementation. |
| 5. Pipeline ordering regression check (NOTE) | F-B fixture explicitly tests question + handoff composition. |
| 6. Handoff schema underspec (NOTE) | Added "Machine fields" section with source_wave, next_wave, source_session_id, handoff_token. Parser rejects missing/out-of-order. Reread list now includes events.ndjson as PRIMARY. |
| 7. spawnFreshClaude stdin viability (FAIL) | **Rejected approach entirely.** Replaced with `claude -p "/nightshift:implement --wave=N+1"` verified by spike. No stdin piping, no bare claude. |
| 8. Test coverage gaps (FAIL) | Expanded to 8 fixtures (F-A through F-H) covering: accepted-wave/no-in-progress, question wins, concurrent claim, missing files, dispatched-already, spawn failure, malformed payload, last-wave. |
