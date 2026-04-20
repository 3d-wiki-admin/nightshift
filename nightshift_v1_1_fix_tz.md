# Nightshift v1.1 — ТЗ на исправления после полного аудита

## Цель батча

Добить **v1.1 до состояния "надёжный single-project runtime"** перед дальнейшим развитием.

Смысл этого батча:
- не добавлять новые большие фичи;
- не расползаться в multi-project UI, новый orchestrator, новый memory stack;
- **закрыть реальные runtime / wiring / UX-дыры**, которые сейчас отделяют Nightshift от состояния “можно безопасно использовать как nightly harness на одном проекте”.

Текущий честный статус по аудиту:
- ядро сильное;
- `init → intake → approval → scaffold → status` уже в целом живо;
- retrieval-memory уже не главный пробел;
- **главные риски теперь в glue layer**: Codex detection, Claude prompt-layer, resume path, git/checkpoint story, CLI/UX.

---

## Что считаем успехом после этого батча

После выполнения батча Nightshift должен удовлетворять таким условиям:

1. **Тесты зелёные** в чистой среде с понятным поведением platform-specific тестов.
2. **`nightshift init <path>`** ведёт пользователя по надёжному idea-first пути.
3. После approval новый проект становится **настоящим git repo** и поддерживает checkpoints/rollback.
4. Claude-слой не ссылается на недоступные repo-relative `core/...` пути.
5. Resume / health-ping используют **реально рабочий путь**, а не псевдо-resume.
6. Launchd устанавливается через **официальный CLI-путь**, а не через сырые внутренние пути.
7. Документация и версия честно совпадают с тем, что реально есть в коде.

---

## Non-goals (что в этом батче НЕ делаем)

Не делать в этом батче:
- новый UI / dashboard;
- multi-project control plane;
- SQLite registry вместо JSON;
- новый vector DB / embeddings / graph memory;
- полноценный installable Codex plugin, если это не нужно для закрытия текущих багов;
- новые design / review / infra lanes сверх того, что уже есть.

Если в процессе окажется, что что-то из этого очень хочется “заодно”, это **вынести в следующий batch**, а не тащить в текущий.

---

# P0 — обязательные исправления

## P0.1 — Сделать suite реально зелёной

### Проблема
Сейчас по аудиту локально проходит `219/223`, падают 4 теста.

Падают:
- `dispatch.mjs codex propagates NIGHTSHIFT_* env...`
- `dispatch.mjs codex emits guard.violation...`
- `install-launchd without --project...`
- `install-launchd refuses non-existent project dir...`

### Что исправить

#### A. `dispatch` / Codex detection
Починить `codexAvailable()` / Codex PATH detection так, чтобы тестовый/fake `codex`, подложенный через `PATH`, реально находился.

Сейчас поиск выглядит слишком хрупким. Если используется shell-проверка в духе `bash -lc 'command -v codex'`, это может ломать injected PATH.

### Требование
Нужно использовать детекцию, которая уважает текущий `process.env.PATH` и совпадает с реальным runtime `spawn`-поведением.

#### B. `install-launchd` tests
Сделать поведение и тесты platform-aware:
- либо macOS-only тесты **явно skip**-аются на non-Darwin;
- либо скрипт/тесты синхронизируются так, чтобы ожидания совпадали.

### Acceptance
- локально в CI/чистой среде: **все тесты зелёные**;
- если platform-specific tests скипаются, это явно отражено и проверено.

---

## P0.2 — Починить resume-path в health-ping

### Проблема
Сейчас health-ping пытается делать resume через стратегию типа `claude -p /resume`.

Это выглядит логически неверно: print/headless mode не должен подменять нормальный interactive resume.

### Что исправить
Нужно заменить текущую resume-стратегию на **реально поддерживаемый и проверяемый механизм**.

Варианты допустимы, если они честные:
- либо использовать поддерживаемый `claude --resume ...` / другой официальный resume-путь;
- либо, если автоматический resume нельзя сделать надёжно, **пересмотреть поведение health-ping**:
  - не пытаться “симулировать resume”;
  - вместо этого переводить проект в `paused/stale`, писать событие и формировать явную команду для человека;
  - optional: открывать новый guarded recovery flow.

### Acceptance
- есть integration/e2e test на stale session;
- нет фальшивого resume через print-mode;
- поведение при stale-run ясно описано в docs.

---

## P0.3 — Убрать repo-relative `core/...` из Claude prompt-layer

### Проблема
В `claude/commands/*.md` и `claude/agents/*.md` всё ещё торчат указания вида:
- `core/skills/...`
- `core/schemas/...`
- `core/templates/...`

Это ломает self-contained plugin story, потому что plugin живёт в cache, а пользователь сидит в target project.

### Что исправить
Во всём Claude-слое убрать прямые ссылки на repo-relative пути и заменить их на один из двух supported способов:

1. **`nightshift <subcommand>`** как официальный интерфейс к runtime;
2. packaged runtime path через один единый helper/env (`NIGHTSHIFT_RUNTIME_DIR` или эквивалент), если прямой доступ действительно нужен.

### Требование
Никаких инструкций вида:
- `run core/...`
- `read core/...`
- `validate against core/...`

в user/project runtime больше быть не должно.

### Acceptance
- `rg -n "\bcore/" claude/` не возвращает runtime-critical ссылок;
- команды и агенты работают, опираясь только на `nightshift ...` или packaged runtime.

---

## P0.4 — Убрать двойную запись approval при confirm-scaffold

### Проблема
Сейчас approval/decision записывается в двух местах:
- в логике confirm-scaffold;
- и внутри `nightshift-scaffold.mjs`.

Это создаёт риск двойного `decision.recorded` на один и тот же approval.

### Что исправить
Выбрать **одного канонического writer-а** для approval event.

Допустимы оба варианта:
- либо approval event пишет `confirm-scaffold`, а scaffold только читает его;
- либо `confirm-scaffold` только валидирует и вызывает scaffold, а сам event пишет `nightshift-scaffold.mjs`.

### Acceptance
- на один approval создаётся **ровно один** `decision.recorded`;
- есть regression test на отсутствие duplicate event.

---

## P0.5 — После scaffold проект обязан становиться git repo

### Проблема
Сейчас после реального scaffold новый проект может не иметь `.git/`.

Это ломает/ослабляет:
- checkpoints;
- rollback;
- wave tags;
- часть overnight safety story.

### Что исправить
После успешного approval и scaffold:
- если репо ещё не инициализировано, делать `git init -b main`;
- добавить базовый `.gitignore`, если он не существует;
- по возможности делать initial commit/scaffold baseline commit, если это не ломает UX.

### Acceptance
После `nightshift scaffold <project>` / подтверждённого flow:
- проект является git repo;
- `preflight` больше не пишет “not a git repo — checkpoints unavailable”;
- checkpoint/rollback story не фальшивая.

---

## P0.6 — Сделать launchd официальной subcommand-поверхностью

### Проблема
Сейчас prompt-layer говорит про установку launchd, но реальный путь завязан на внутренний script path.

Это не user-grade UX.

### Что исправить
Добавить официальный CLI surface:

```bash
nightshift launchd install --project <path>
nightshift launchd uninstall --project <path>
nightshift launchd status --project <path>
```

Если `status` слишком много для этого батча, минимум:
- `install`
- `uninstall`

### Требование
Claude-команды и docs должны ссылаться **только на CLI**, а не на сырой путь `scripts/install-launchd.sh`.

### Acceptance
- launchd можно поставить и снять через `nightshift ...`;
- confirm-scaffold / intake flow могут выдать пользователю одну правильную CLI-команду;
- нет сырого script path в user-facing инструкциях.

---

# P1 — обязательные UX/consistency исправления

## P1.1 — Довести `nightshift init` до честного idea-first UX

### Проблема
Сейчас `nightshift init` создаёт минимальную структуру и говорит “что делать дальше”, но **не ощущается как одна команда, после которой тебя уже ведут**.

### Что исправить
`nightshift init <path>` должен делать минимум такой happy path:

1. зарегистрировать проект;
2. создать minimal meta scaffold;
3. прогнать `doctor` или хотя бы встроенную проверку окружения;
4. либо:
   - автоматически открыть Claude intake, **если это реально надёжно**;
   - либо напечатать **ровно одну** следующую команду, а не многошаговый hand-holding.

### Приоритет UX
Если auto-open Claude ненадёжен, лучше честный fallback, например:

```bash
cd ~/dev/my-project
claude "/nightshift intake --project ~/dev/my-project"
```

Но это должна быть **одна готовая команда**, а не расплывчатая инструкция.

### Acceptance
Для юзера flow выглядит так:

```bash
nightshift init ~/dev/my-project
```

И дальше он либо сразу попадает в intake, либо получает **одну** copy-paste команду для старта intake.

---

## P1.2 — Синхронизировать docs/help с реальным v1.1 состоянием

### Проблема
Документация уже разошлась с кодом.

Что нужно проверить и поправить:
- `README.md`
- `docs/WALKTHROUGH.md`
- `docs/ARCHITECTURE.md`
- help/header внутри `scripts/nightshift.sh`
- `CHANGELOG.md`
- версия `claude/.claude-plugin/plugin.json`

### Что исправить
Docs должны честно отражать:
- новый `init` flow;
- idea-first approval;
- то, что launchd не ставится автоматически;
- реальный список user-facing subcommands;
- фактическую версию пакета;
- фактический статус Codex-side packaging.

### Acceptance
- docs не обещают того, чего ещё нет;
- help-текст CLI совпадает с поведением;
- plugin version синхронизирована с package version или осознанно versioned separately с объяснением.

---

## P1.3 — Честно назвать Codex-стадию

### Проблема
Система выглядит так, будто Codex-часть — уже полноценный plugin, хотя по факту это пока adapter/skill-pack surface.

### Что исправить
До тех пор, пока нет полноценного installable Codex plugin surface, в docs/README/help нужно честно формулировать это как:
- Codex adapter
- Codex execution backend
- Codex skill pack

Но не как “готовый installable Codex plugin”, если это не так.

### Acceptance
- формулировки по Codex в docs/README/help честные;
- пользователь не думает, что обе стороны одинаково “пакетированы”, если это не так.

---

# P2 — полезные, но не блокирующие добивки

## P2.1 — Packaging hygiene для share/export

### Проблема
В текущем архиве видно лишнее:
- `__MACOSX/`
- `.git/`
- `node_modules/`
- `.nightshift/review-run.log` и прочие локальные review artifacts

Для runtime это не блокер, но для аудита и шаринга — мусор.

### Что исправить
Добавить официальный export/share script, который делает чистый архив без:
- `.git`
- `node_modules`
- `__MACOSX`
- `.nightshift/*.log`
- локальных кэшей / служебных мусорных файлов

### Acceptance
Есть одна команда, например:

```bash
nightshift export-review-zip <out.zip>
```

которая собирает чистый архив для ревью.

---

# Отдельно: что разработчик может оспорить

Разработчик может предметно оспорить любую из предложенных реализаций, **но не саму проблему**, если проблема подтверждена аудитом.

Формат оспаривания:

1. **Что именно предлагается сделать иначе**
2. **Почему это надёжнее / проще / устойчивее**
3. **Что это не ломает из acceptance criteria**
4. **Какой migration path**

Примеры допустимого оспаривания:
- “resume лучше не делать автоматически вообще, а переводить run в paused + печатать recovery command”
- “git initial commit делать не сразу, а только после scaffold success + first sync”
- “launchd status переносим в следующий батч, но install/uninstall делаем сейчас”

Недопустимый ответ:
- “давайте пока оставим как есть, вроде работает”
- “это UX, потом поправим”
- “тесты падают только у тебя”

---

# Порядок выполнения

Рекомендую такой порядок:

## Wave A-fix
1. P0.1 tests green
2. P0.2 health-ping resume
3. P0.3 remove `core/...` from Claude layer
4. P0.4 duplicate approval event
5. P0.5 git init after scaffold
6. P0.6 launchd CLI surface

## Wave B-polish
7. P1.1 `nightshift init` happy path
8. P1.2 docs/help/version sync
9. P1.3 Codex stage wording

## Optional cleanup
10. P2.1 export/share hygiene

---

# Финальный acceptance checklist

Перед закрытием батча должно быть выполнено всё ниже:

- [ ] test suite green (или platform-specific skip корректно оформлены)
- [ ] `codex` detection уважает injected PATH
- [ ] stale-run behavior не использует fake resume через print-mode
- [ ] в Claude-layer нет критичных repo-relative `core/...` путей
- [ ] approval event не дублируется
- [ ] scaffold создаёт git repo
- [ ] launchd ставится через `nightshift launchd install --project <path>`
- [ ] `nightshift init` ведёт пользователя по idea-first path
- [ ] docs/help/version согласованы
- [ ] Codex stage названа честно

---

# Короткий ожидаемый user-flow после исправлений

Пользовательский happy path должен выглядеть так:

```bash
nightshift init ~/dev/my-project
```

Дальше Nightshift:
1. регистрирует проект
2. проверяет среду
3. запускает intake или даёт одну готовую команду
4. Claude обсуждает идею
5. пользователь подтверждает scaffold
6. scaffold создаёт полноценный проект + git repo
7. дальше идут `/plan`, `/analyze`, `/tasks`, `/implement`, `/review-wave`, `/sync`, `/status`

Если это не так — батч не считается завершённым.
