# Nightshift v1.1 hotfix TZ — gaps found during first live install

Собираем всё говнишко, найденное при живом прогоне `nightshift init → /plugin install → /nightshift …`
на чистой Mac в ходе первой реальной установки (после v1.1.1 fix-batch).

---

## H1. Команды плагина namespaced криво

### Симптом
После `/plugin install nightshift@nightshift` команда `/nightshift intake --project …`
отвечает `Unknown command: /nightshift` + `Args from unknown skill: intake --project …`.

Причина: Claude Code 2.1.114 префиксует все плагин-команды неймспейсом:
`/<plugin-name>:<command>`. Наш файл `claude/commands/nightshift.md` поэтому доступен как
`/nightshift:nightshift`, что (а) ужасно звучит (б) заставляет делать диспатч по аргументам
(`intake | confirm-scaffold | start`), хотя Claude Code позволяет сделать ровно три прямые команды.

### Fix
Разбить `claude/commands/nightshift.md` на три отдельных файла:

- `claude/commands/intake.md` → `/nightshift:intake --project <path>`
- `claude/commands/confirm-scaffold.md` → `/nightshift:confirm-scaffold`
- `claude/commands/start.md` → `/nightshift:start` (legacy — intake + confirm одним махом)

Регрессионный тест: парсинг `claude/commands/*.md` — должно быть три отдельных файла, каждый
с корректным frontmatter `description` и `argument-hint`.

### Не делаем
Не оставляем `nightshift.md` как диспатчер рядом — это путает пользователя (какая из
`/nightshift:nightshift` и `/nightshift:intake` правильная?). Удаляем старый файл.

---

## H2. `nightshift init --claude-now` не работает внутри Claude-сессии

### Симптом
Пользователь случайно запустил `nightshift init ~/dev/foo --claude-now` из Claude-чата
(не из терминала). `--claude-now` execs `claude` интерактивно, но внутри уже запущенного
Claude'а stdin/stdout — не TTY → интерактив ломается. Claude вынужден запускать init
без `--claude-now` и просить юзера открыть новую сессию.

### Fix
В `core/scripts/nightshift-init.mjs`:
- Перед `spawn('claude', …, { stdio: 'inherit' })` проверять `process.stdout.isTTY`
- Если не TTY (значит родитель не человек в терминале) — печатать warning
  «--claude-now ignored: no TTY detected. Run the printed command manually from a real terminal.»
  и делать fallback на обычный `formatSummary()` печат.
- Exit 0 (не ошибка — мы всё равно сделали своё дело, просто не вышло заэксечить claude).

### Регрессионный тест
`core/scripts/test/fixbatch-init-claude-now-no-tty.test.mjs`:
- Запустить `nightshift-init.mjs <tmp> --claude-now` в `spawnSync`-режиме (stdio: 'pipe' → не-TTY)
- Assert exit 0
- Assert stdout содержит `--claude-now ignored: no TTY`

---

## H3. User-scope install копирует файлы — правки в репо не подхватываются

### Симптом
После `/plugin install nightshift@nightshift` в user-scope Claude Code копирует
`~/dev/codex-comp/nightshift/claude/*` в `~/.claude/plugins/nightshift-<marketplace>/…`.
Когда мы чиним баги в репо и коммитим — установленная копия остаётся старой.
Пользователю приходится вручную делать `/plugin uninstall nightshift && /plugin install nightshift@nightshift`.

### Fix (выбрать один из двух)

**Option A — детектить и подсказывать:**
- В `scripts/nightshift.sh doctor`: если установленная копия плагина отстаёт от репо
  (по хешу `plugin.json` или по версии из manifest'а) — предупреждение + готовая
  команда reinstall'а.
- Минус: пользователь всё равно делает это сам.

**Option B — авто-sync:**
- Scaffold-скрипт `scripts/install-plugin.sh` который сам делает `/plugin uninstall + install`
  через `claude --print "/plugin uninstall nightshift; /plugin install nightshift@nightshift"`.
- Минус: requires TTY claude, те же проблемы что у `--claude-now`.

**Option C (рекомендую) — dev-mode:**
- README явно описать «если ты разрабатываешь сам nightshift — используй
  `claude --plugin-dir ~/dev/codex-comp/nightshift/claude` вместо `/plugin install`,
  тогда правки в репо live».
- Для обычного пользователя — marketplace flow через `/plugin install` как сейчас.
- В `scripts/nightshift.sh doctor` добавить эту подсказку под WARN если repo ≠ installed copy.

---

## H4. hooks.json schema wrapper (lesson learned)

### Что произошло
В v1.1.1 fix-batch я перенёс хуки из `claude/settings.json` в `claude/hooks/hooks.json`
без внешнего `{ "hooks": {...} }` wrapper'а. Claude Code plugin-loader использует строгую
zod-схему `{ hooks: { <event>: [...] } }` и отваливается с
`expected: "record", path: ["hooks"], code: "invalid_type"`.

### Что пофиксили
Коммит `b320649` — добавили wrapper, регрессионный тест в
`core/scripts/test/plugin-self-contained.test.mjs` теперь требует наличие top-level
`"hooks"` ключа + минимум по одному элементу в каждом из 4 событий.

### Что оставить в TZ
Ничего — уже закрыто. Лог как напоминание что live-install — единственный способ
найти такие расхождения спеки.

---

## H5. README/docs ссылаются на устаревший `/plugin install <path>`

### Симптом
В `README.md` инструкция установки плагина говорит:
```
/plugin install ~/dev/codex-comp/nightshift/claude
```

Но Claude Code 2.1.114 переделал синтаксис — `/plugin install` требует `<name>@<marketplace>`.
Пользователь получает `Marketplace "<path>" not found`.

### Fix
README + `docs/WALKTHROUGH.md` → актуальный marketplace flow:
```
# one-time
/plugin marketplace add ~/dev/codex-comp/nightshift
/plugin install nightshift@nightshift
/reload-plugins
```

Старая запись с path'ом → удалить. Если хотим поддерживать старый Claude Code (<2.1.x):
добавить «если у тебя старая версия Claude Code — используй `--plugin-dir`», но это
маргинально.

---

## H6. `/plugin install` flow — как пользователь выбирает scope

### Симптом
В UI `/plugin install` появляется выбор из трёх scope'ов:
`Install for you (user scope)`, `Install for all collaborators`, `Install for you in this repo only`.
Документации по умолчанию / рекомендации в README нет — пользователь выбирает наугад.

### Fix
В README добавить одну строчку: «выбери **user scope** — nightshift будет доступен
во всех твоих Claude-сессиях, в любой папке».

---

## H7. constitution.md стэк зашит в шаблон — тихая ложь при нестандартном стеке

### Симптом (нашли на kw-injector-v1)
Intake корректно записал в `proposal.stack` = `python-fastapi-celery-redis-postgres-nextjs-tiptap`
(юзеру нужен Python-пайплайн + Next.js фронтенд). Но в
`core/templates/project-starter/memory/constitution.md` был захардкожен блок:
```
## 1. Stack
- Frontend: Next.js 15 (App Router) + TypeScript strict + Tailwind CSS.
- Backend: Supabase (Postgres + RLS + Auth + Storage).
- Deploy: Vercel.
```
Скаффолд копировал шаблон 1-в-1, intake snapshot с правильным стеком уходил В КОНЕЦ файла
после блока Constraints. `plan-writer` читает `## 1. Stack` первым → строит план под
Next.js+Supabase, игнорируя Python-требования.

### Fix (сделано)
- `core/templates/project-starter/memory/constitution.md`: блок `## 1. Stack` заменён
  на placeholder `<!-- nightshift:stack-block -->`.
- `core/scripts/nightshift-scaffold.mjs::renderStackBlock()` — новая функция, строит
  Stack секцию из `proposal.stack` + `proposal.providers` + `proposal.template`.
- `renderConstitution()` — ищет маркер, подставляет сгенерированный блок. Fallback
  на prepend перед `## 2.` если маркера нет (старые шаблоны).
- Регрессионный тест `core/scripts/test/hotfix-dynamic-stack-block.test.mjs` — два кейса:
  Python/FastAPI/Celery и Next.js/Supabase — оба дают корректный Stack блок.

### Что ещё потенциально врёт (в hotfix H8 следующим шагом) ← **сделано**
- ~~`CLAUDE.md` в template'е говорит `pnpm dev / pnpm typecheck / pnpm build` — хардкод~~
  → `renderClaudeMd(flags, name)` строит Commands секцию: poetry-блок если Python
  в стеке, pnpm-блок если Next. Монорепо префиксует `cd apps/<api|worker>` и
  `pnpm -C apps/web`.
- ~~`README.md` template'а описывает «Next.js 15 + Supabase»~~ → `renderReadme(flags, name)`
  генерирует Stack секцию из флагов + Setup блок с нужными командами установки.
- ~~`package.json`, `next.config.mjs`, `tsconfig.json`, `middleware.ts`, `app/`, `lib/` —
  копируются всегда, даже если стек Python.~~ → `renderPackageJson(flags, name)`
  возвращает workspace-root для монорепо, классический Next-package для Next-only,
  `null` для pure-Python (файл вообще не пишется). Next-specific файлы (`app/`,
  `lib/`, `next.config.mjs`, `middleware.ts`, `tsconfig.json`) попадают в `excludeRel`
  если `hasNext=false` и не копируются вообще.

Полный список рендеров:
- `renderEnvTemplate(flags)` — секции Supabase / LLM / Storage+Queue / Google / Deploy
  включаются по флагам.
- `renderGitignore(flags)` — JS блок если hasNext, Python блок если hasPython.
- `renderClaudeMd(flags, name)` — dual-stack Commands.
- `renderCi(flags)` — jobs web / api / worker / smoke появляются по флагам, smoke
  `needs: [...]` собирается динамически.
- `renderSmokeSh(flags)` — один или два компонента в зависимости от FastAPI/Next.
- `renderPackageJson(flags, name)` — workspace-root | Next-app | `null`.
- `renderPnpmWorkspace(flags)` — только для монорепо.
- `renderReadme(flags, name)` — Stack секция + Setup команды.
- `renderProjectStructure(flags, name)` — монорепо vs плоский layout.
- `renderApiContracts(flags)` — FastAPI/Pydantic секция + Next/Zod секция + Shared Types
  пункт для монорепо.
- `renderTaskTemplate(flags)` — verification_plan.commands варианты JS+Python,
  forbidden_files подбираются по флагам, gates_required соответствует стеку.
- `renderReviewDimensions(flags)` — missed_deps evidence `pnpm audit | poetry show --outdated`
  с пометкой «both stacks» для монорепо.
- `renderReuseFunctionsMd(flags)` + `renderReuseIndexEntries(flags)` — пути Supabase
  хелперов корректны под монорепо (`apps/web/lib/supabase/...`) или плоский layout.
- `renderPlanPlaceholder(flags, name)` + `renderDataModel(flags, name)` — пустые placeholder'ы
  с уже корректными JS/Python библиотеками + RLS секция только если Supabase в стеке.

Регрессионный тест: `core/scripts/test/hotfix-dynamic-scaffold-surface.test.mjs` —
9 сценариев (монорепо, Python-only, Next-only), пинят каждый render output.

## H9. Skill-субагенты не пишут `model` в events.ndjson — стоимость не посчитаешь

### Симптом (нашли на kw-injector-v1 live-запуске)
Когда `/nightshift:plan` спавнит `plan-writer` subagent (112k токенов, 15 мин), или
`/nightshift:analyze` спавнит `analyzer` (87k токенов, 5 мин) — ни одно их событие в
`tasks/events.ndjson` не содержит поле `model`. Все 23 `decision.recorded` + 7
`question.asked` + 1 `wave.reviewed` — без указания чьего ума дело.

Последствие: post-factum нельзя сказать сколько стоил конкретный plan-writer run
(был он на Opus или на Sonnet), сколько стоил analyzer, куда ушли деньги за ночь.
Только ручной подсчёт по Claude Code UI в момент работы.

Для `task.dispatched` / `task.implemented` событий через `core/scripts/dispatch.mjs`
модель-ид пишется (см. `payload.model`). Но skill-вызовы идут не через dispatch.mjs,
а через plugin-хуки Claude Code напрямую — минуя нашу инструментацию.

### Fix (две части)
1. В `claude/hooks/pre-task-preflight.sh` (или новом хуке `pre-subagent.sh`) при
   входе в `Task` tool: читать `hookSpecificOutput.agent_name` + `model`, писать
   событие `task.dispatched` с `payload.agent = <skill-name>` + `payload.model = <id>`
   через `nightshift dispatch append`. В `post-subagent.sh` — писать `task.implemented`
   с `tokens.input/output/cached` + `duration_ms`.
2. Схема `event.schema.json` уже поддерживает поле `model` на верхнем уровне и
   `tokens` с input/output/cached. Ничего добавлять не надо — только начать их
   реально заполнять для skill-субагентов.

Регрессионный тест: запустить `/nightshift:plan` на тестовом проекте, ассертить что
в events.ndjson минимум одно событие `task.dispatched` с `agent == 'plan-writer'`
и `model` не null.

## H10. `session.end` флудит events.ndjson — 27% событий это shutdown-сообщения

### Симптом (тот же live-запуск)
48 событий всего, из них 13 — `session.end`. Это Stop-хук `checkpoint.sh`, который
пишет `session.end` на каждый завершённый ход пользователя. В интерактивной сессии
это означает одно событие на каждый юзер-ход, даже если полезной работы в этом ходе
не было (юзер просто задал уточняющий вопрос).

Последствие: лог шумит, полезные события (decision.recorded, question.asked,
wave.reviewed) тонут. Для анализа приходится фильтровать.

### Fix
В `claude/hooks/checkpoint.sh`: перед записью `session.end` проверять, было ли
хоть одно не-session событие с предыдущего `session.end` в том же session_id.
Если не было — skip (не пишем вторую/третью/четвёртую холостую session.end).
Это dedupe'ит флуд, но сохраняет одно `session.end` на фактический «конец
работы в session».

Альтернатива (проще): писать `session.end` только если прошло ≥ N минут с
предыдущего того же `session.end` в том же session. N = 15 подходит: в
длинном интерактиве одной сессии достаточно одного checkpoint'а в 15 мин,
финальный всё равно напишется когда launchd-пингер увидит staleness или
оркестратор сам решит остановиться.

Регрессионный тест: 5 быстрых user turns подряд → events.ndjson содержит
один `session.end`, не 5.

## H11. Rich status dashboard — `nightshift status --dashboard [--watch]`

### Запрос
Пользователь во время ночного прогона хочет в соседнем терминале видеть живую
картинку: где пайплайн, какая волна в процентах, какие задачи в каком статусе
(ожидает/импл/ревью/ок/ошибка), какие вопросы открыты, сколько токенов/денег
потрачено, какие guard-события произошли. Без помех основной Claude-сессии.

Сейчас `nightshift status` выдаёт 3 строки: session_id, zone, event count. Этого
мало для live мониторинга.

### Дизайн
Расширить `core/scripts/project-status.mjs`:

- `--dashboard` (и дефолт если не задан `--json`/`--compact`): рендерит ASCII-панель:
  - pipeline progress (intake → scaffold → plan → analyze → tasks → implement → deploy) с галочками/in-progress/pending
  - активная волна с progress bar `[██████░░░░]` + `accepted/total`
  - per-task строка: `TASK-ID name <status> <model>` (из events `task.contracted`,
    `task.dispatched`, `task.reviewed`, `task.accepted`, `task.rejected`)
  - open questions (`question.asked` без парного `question.answered`)
  - guard/gate summary за последний час
  - budget: `tokens.input/output/cached` + оценка $ через `core/schemas/costs.json`
- `--watch [N]` (default N=10 сек): очистить экран + перерисовать каждые N сек.
  Безопасный для concurrent reader: events.ndjson append-only, fstat+reseek без
  блокировки.
- `--json`: машиночитаемая форма тех же данных (для внешних интеграций/тестов).

### Slash-команда
`claude/commands/status.md` уже есть, но зовёт старый CLI без флагов. Обновить на
`nightshift status "$PROJECT" --dashboard`. Пользователь из Claude-сессии будет
вводить `/nightshift:status` и получать full board в одном ответе.

### Почему не прямо сейчас
Во время активного ночного прогона kw-injector-v1 трогать scripts/dispatch/hooks
не будем — риск гонки событий при переключении code path'ов. Делается утром или
по сигналу.

### Acceptance
- `nightshift status <path> --dashboard` печатает ≥ 7 секций (pipeline, wave,
  tasks, questions, guards, budget, last-event)
- `--watch` рефрешит без перечитывания события сначала (использует tail-position
  offset)
- Unit test: fixture events.ndjson + 3 волны → ассертить что dashboard выдаёт
  корректные проценты, counts, и обнаруживает неотвеченные questions
- Slash-команда `/nightshift:status` возвращает dashboard (не raw CLI output)

## H12. Token-aware self-preservation + auto-install launchd pinger

### Запрос
Пользователь во время ночного прогона увидел в Claude Max UI «20% токенов осталось
на час» и спросил: что будет если Claude умрёт от лимита посреди волны?

Сейчас ответ: `session.end` / `session.halted` event (если doc-syncer успеет написать)
→ полная остановка. Если `launchd` пингер НЕ установлен — никто не разбудит Claude
когда лимиты обновятся (5-часовой цикл у Max). Работа стоит до утра / до ручного
возобновления.

### Часть 1 (простая, P1) — auto-install launchd pinger при `confirm-scaffold`

Сейчас `scaffold` создаёт проект, но launchd-пингер требует отдельного шага
`nightshift launchd install --project <path>`. В интерактивной документации я
(Claude) напоминаю пользователю, и слишком часто получаю «skip» — потому что
пользователь не понимает что это overnight safety net.

**Fix:**
- В `claude/commands/nightshift.md` (секция `confirm-scaffold`, шаг 4) сделать
  вопрос обязательным (не опциональным), с дефолтом **yes**. Прямо: «установить
  overnight-пингер? [Y/n]» — не «хочешь ли опционально».
- На Darwin: если ответ не-N — запустить `nightshift launchd install --project <path>`
  прямо из scaffold flow, не перекладывая на пользователя.
- На не-Darwin: пропустить с пометкой «Linux/Windows: поставьте cron эквивалент
  из docs/OVERNIGHT.md» (H12.1 → написать этот doc).

Регрессионный тест: scaffold с подтверждением → `launchctl list | grep ai.nightshift.pinger`
должно вернуть запись (на Darwin).

### Часть 2 (сложная, P2) — token-pressure handoff

**Проблема.** Claude Code не экспонирует остаток токенов внутрь модели во время
turn'а. Модель не знает сколько у неё осталось. Значит «успеть поставить таймер
за 1-2%» через обычный ход не работает — в момент когда лимит близко, Claude
уже либо продолжает, либо падает с 429.

**Что можно сделать на уровне плагина (реализуемо):**

а) **Pre-emptive handoff note в каждом `task.reviewed`-событии.** Когда
orchestrator принимает задачу, он пишет HANDOFF.md в репо проекта с ровно
одной строкой: «если ты — свежий Claude в этом же cwd и видишь этот файл,
это значит предыдущая сессия упала; запусти `/nightshift:resume` и продолжи с
последнего `task.accepted`». HANDOFF.md пишет orchestrator при КАЖДОМ
принятии задачи, перезаписывая (не appending). Если Claude умрёт между
принятыми задачами — launchd-пингер поднимает `claude --continue` → Claude
читает cwd/HANDOFF.md → понимает что делать.

b) **Budget sentinel event.** Claude Code SDK / env переменные могут
экспонировать token-budget (`ANTHROPIC_BUDGET_REMAINING`?) — если это
доступно, orchestrator перед каждым task-dispatch проверяет и при
`remaining < 5%` пишет `budget.exceeded` event (схема уже поддерживает),
перестаёт брать новые задачи, дожидается уже-in-flight, пишет
`session.halted` и корректно выходит. launchd-пингер через 30+ мин
(когда лимиты обновятся) возобновит. Требует подтверждения что
`ANTHROPIC_BUDGET_REMAINING` реально доступно из плагина; если нет —
часть (b) в Claude Code невозможна и остаётся только (a).

c) **Codex-native implementer фолбек.** Если Claude-токены всё, но
Codex-токены целы — implementer продолжает. Reviewer требует НЕ-Claude
модель. Сейчас reviewer захардкожен на `claude-opus-4.7`. Разрешить
`reviewer_model: gpt-5.4` как фолбек когда anthropic.budget.exceeded
(требует изменения в router.mjs + новый decision.recorded kind).

### Acceptance (Часть 1 сразу, Часть 2 отдельным релизом)
- `confirm-scaffold` prompt дефолтит на «yes» для launchd install
- Scaffold на Darwin реально ставит pinger без доп. шагов
- `HANDOFF.md` в корне проекта — single-line auto-refreshed pointer для
  resume
- Регрессионные тесты в `core/scripts/test/fixbatch-launchd-autoinstall.test.mjs`
  + `fixbatch-handoff-pointer.test.mjs`

### Что НЕ фиксит (честно)
- Если пользователь закроет ноут (full sleep) — launchd тоже спит. Нужен
  `caffeinate -i &` как мы уже делаем, или «Prevent automatic sleeping when
  display is off» в System Settings → Battery. Pinger ничему не поможет если
  OS приостановлена.
- OpenAI Codex лимиты — отдельный бюджет, мы не контролируем. Max-план у
  OpenAI даёт много, но если реально исчерпано — implementer упадёт. Router
  уже обрабатывает RATE_LIMITED с backoff, в пределе — `task.blocked` и
  пользователь решает утром.

## H13. Router tuning — больше работы на Codex spark/gpt-5.4, меньше на Claude Opus

### Запрос
Пользователь: «мне нужно больше использовать Codex, а Claude оставлять только
на самое сложное. Заебись если найдём где использовать Codex spark — быстрая
модель для мелких задач, я бы всю мелочь на него клал.»

### Текущее состояние (core/scripts/router.mjs § 6.1)
Роутер УЖЕ умеет:
- `safe + ≤150 LOC + straightforward` → **gpt-5.4**
- `mechanical` → **gpt-5.3-codex-spark** (это то о чём пользователь просит!)
- `review-required OR >150 LOC OR core types OR refactor` → `gpt-5.3-codex`
- `approval-required` → `gpt-5.3-codex` xhigh

Проблема — **task-decomposer почти никогда не ставит `mechanical`**. В live
kw-injector-v1 wave 0 все 20 тасков ушли как `review-required` (скелет монорепо,
миграции, seed-файлы, CI). В итоге spark не дёрнут ни разу. Плюс reviewer
везде захардкожен на `claude-opus-4.7` — дорого и не всегда оправдано.

### Fix — три части

**Часть A (P1) — расширить `mechanical` в task-decomposer'е.**
`claude/agents/task-decomposer.md` + `core/skills/task-decomposer/SKILL.md`:
явно перечислить паттерны что считается mechanical:
- rename variable/function/file без изменения поведения
- move file без изменения содержимого
- add identical test stub (follow existing pattern)
- regex-style refactor (change quotes, formatting, imports)
- update version in single config file
- add missing CI step copied from sibling project
- doc-sync tasks (update FEATURE_INDEX, REUSE_FUNCTIONS, PROJECT_STRUCTURE)
Эти задачи должны получать `target_model: gpt-5.3-codex-spark`. Регрессионный
тест: фикстура из 10 тасков, 4 из них попадают в mechanical по шаблонам выше
→ роутер вернёт spark.

**Часть B (P1) — reviewer не всегда Opus.**
Сейчас конституция требует reviewer ≠ implementer, но дефолт для JS/Python
skeleton кода — `claude-opus-4.7`. Разрешить **градацию**:
| risk_class | implementer | reviewer default |
|---|---|---|
| safe        | gpt-5.4         | **gpt-5.4** с `--fresh-session` (разные контексты = другой inference)  |
| safe-mech   | gpt-5.3-spark   | **gpt-5.4**                                                            |
| review-req  | gpt-5.3-codex   | **gpt-5.4** (не Opus! gpt-5.4 достаточно для код-ревью)                |
| approval-req| gpt-5.3-codex   | **claude-opus-4.7** (оставить Opus когда реально важно)                |

Это снимает Opus-нагрузку с 80% тасков. Core rule «reviewer ≠ implementer»
остаётся соблюдённым на уровне model family, но мы больше не жжём Opus на
тривиальном коде.

**Часть C (P2) — context-packer и doc-syncer на Haiku/spark.**
Сейчас они в `claude/agents/*.md` захардкожены на Claude Haiku 4.5 — это
уже дёшево, но spark может быть ещё быстрее/дешевле для:
- `context-packer` — читает контракт + ссылки, складывает в ≤500 строк markdown.
  Чисто transformation task, у spark вполне достаточно.
- `doc-syncer` — replay events → update 3 markdown index'а. Механика, spark.

Замерить один live-запуск Haiku vs spark для этих двух агентов; если spark
не просаживает качество — переключить дефолт.

### Ожидаемый effect
- **Claude Opus расход** падает в 3-5× (сейчас реально жжёт orchestrator +
  plan-writer + analyzer + 20× reviewer. После H13b reviewer падает ~80%).
- **Overnight-budget survival** — 20-тасковая волна должна пролезать в
  стандартный Claude Max без выхода за лимит.
- **Cost ranking** для честной статистики — см. H9 (тот же рефактор).

### Acceptance
- `task-decomposer` на регрессионной фикстуре помечает ≥ 30% простых тасков
  как `mechanical` → роутер уходит на spark
- Конституция + task-template позволяет reviewer: `gpt-5.4` для
  `risk_class: review-required`
- Router возвращает корректную пару (implementer, reviewer) не дублируя
  model family
- CHANGELOG-строка «Opus spend на волне-skeleton (20 tasks) упало с X до Y
  токенов» с реальными цифрами из до/после замера

## H14. Pinger не различает «Claude умер» от «Claude ждёт ответ пользователя»

### Симптом (live на kw-injector-v1 2026-04-21)
Пользователь поставил launchd-пингер на overnight run. Orchestrator во время
работы задал approval-вопрос пользователю и заснул в ожидании ответа. Ответа
не пришло — пользователь спал. Last event в events.ndjson старше 15 мин →
пингер считает сессию stale → запускает `claude --continue` → но сессия
физически жива, процесс ждёт stdin. `claude --continue` либо конфликтует,
либо просто не помогает. Работа стоит до утра.

Это архитектурный промах **v1.0**: пингер спроектирован под сценарий
«процесс упал», но интерактивный approval-wait выглядит снаружи идентично.
Оба = «нет событий > 15 мин».

### Fix — три слоя в порядке от простого к сложному

**Слой A (P1) — пингер СПЕРВА смотрит на тип последнего события.**
`core/scripts/health-ping.mjs::main()`: перед `attemptUnstick`:
```js
const lastEvent = events.at(-1);
if (lastEvent && lastEvent.action === 'question.asked') {
  // Not stale — waiting for human. Emit session.paused with pointer
  // to the question + notify via `say` on Darwin + morning-digest flag.
  // Do NOT spawn claude --continue — it can't answer the question.
  await appendEvent(logPath, {
    agent: 'health-pinger',
    action: 'session.paused',
    outcome: 'success',
    notes: `orchestrator awaiting human approval on ${lastEvent.payload?.question_id || 'open question'}. Recover: open the Claude session and answer.`
  });
  if (process.platform === 'darwin') {
    spawn('say', ['nightshift is waiting for your answer'], { detached: true });
  }
  return;
}
```
То же для `task.blocked` (risk_class=approval-required без matching decision) —
пингер нужен молчать, не дёргать `claude --continue`.

**Слой B (P1) — morning-digest подсвечивает open questions сверху.**
`core/scripts/morning-digest.mjs`: пересчитать `question.asked` минус
`question.answered` — всё что осталось идёт в секцию «**⚠ waiting for
your answer**» в начале дайджеста, не в конце.

**Слой C (P2) — push-уведомление в Claude через launchctl.**
На Darwin можно через `osascript -e 'display notification ...'` вытолкнуть
alert в Notification Center. Пользователь увидит что ночью появился вопрос
и разбудится / ответит. Ключ — не спамить: одно уведомление на появление
новой question.asked, не на каждый пинг.

### Acceptance
- `health-ping.mjs` регрессия: фикстура events.ndjson с последним
  `question.asked` → pinger.unstuck НЕ вызывается, зато пишется
  `session.paused` с ссылкой на вопрос
- Morning digest на такой же фикстуре → секция «waiting for your answer»
  в топе, список вопросов с question_id + payload.question
- `say` (Darwin) вызывается только при ПЕРВОМ обнаружении неотвеченного
  вопроса (хранить sentinel file `.nightshift/last-notified-question`)

### Что НЕ чинит (честно)
- Пользователь всё равно должен проснуться и ответить — это не обход
  approval-required, это приоритетное уведомление. approval-required —
  safety-фича, её обход был бы багом.
- Если Claude-сессия реально умерла И последнее событие совпало с
  `question.asked` — слой A по ошибке не возьмёт resume. Это редкий
  случай: добавить pingloop timeout (напр., 3 пинга подряд на одном
  `question.asked` → всё же пробуем `claude --continue`).

## Priority
- **H1** (namespace split) — P0, блокирует первый live-запуск без шпаргалки
- **H5** (README plugin install) — P0, те же грабли наступит каждый новый пользователь
- **H6** (scope выбор) — P0, тривиально, за 5 минут
- **H2** (--claude-now без TTY) — P1, не блокирует, но UX грязный
- **H3** (install-copy drift) — P1, важно когда разрабатываешь сам nightshift
- **H4** (hooks.json lesson) — done
- **H7** (constitution stack-block dynamic) — done
- **H8** (остальной scaffold surface dynamic) — done
- **H9** (skill subagents не пишут model) — P1, критично для honest cost accounting
- **H10** (session.end флуд) — P2, шум но не блокер
- **H11** (rich status dashboard) — P1, живой monitoring overnight — пользовательская просьба
- **H12** (auto-install launchd + token handoff) — P1 часть-1 (launchd default-yes), P2 часть-2 (budget sentinel)
- **H13** (router tuning, spark для mechanical, reviewer не-Opus) — P1 часть-A+B (task-decomposer + reviewer grade), P2 часть-C (context-packer/doc-syncer на spark)
- **H14** (pinger vs approval-wait) — P1 слой A+B (skip resume on question.asked + morning-digest приоритет), P2 слой C (push-уведомление)

## Acceptance
- Новый пользователь на чистой Mac может пройти `clone → install.sh → /plugin install →
  /nightshift:intake` по README без моих подсказок в чате.
- `pnpm test` зелёный (добавятся новые регрессионные тесты).
- `/nightshift:intake`, `/nightshift:confirm-scaffold`, `/nightshift:start` — три прямые команды
  (не одна с диспатчем).
