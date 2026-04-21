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

## Acceptance
- Новый пользователь на чистой Mac может пройти `clone → install.sh → /plugin install →
  /nightshift:intake` по README без моих подсказок в чате.
- `pnpm test` зелёный (добавятся новые регрессионные тесты).
- `/nightshift:intake`, `/nightshift:confirm-scaffold`, `/nightshift:start` — три прямые команды
  (не одна с диспатчем).
