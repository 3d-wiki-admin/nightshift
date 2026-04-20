# Nightshift v1.1 — ТЗ для разработчика

## 0. Зачем этот batch

Нужно довести Nightshift до состояния, где он:

1. **ставится и запускается проще**;
2. **надёжно заводит новый проект из одной входной точки**;
3. **по умолчанию ведёт пользователя через обсуждение идеи, а потом разворачивает структуру**;
4. **лучше помнит принятые решения и живое состояние проекта**;
5. **не обещает plugin-grade reliability там, где wiring ещё не замкнут**.

Этот batch не про новые “красивые” фичи. Он про:
- надёжность;
- UX первого запуска;
- правильную установку;
- правильный intake flow;
- retrieval-memory;
- честную интеграцию Claude/Codex.

---

## 1. Главный продуктовый выбор

### Выбор по умолчанию: **idea-first, scaffold-after-approval**

Nightshift должен по умолчанию работать так:

1. пользователь запускает **одну команду**;
2. Nightshift проводит doctor/preflight;
3. Nightshift открывает Claude с уже доступным Nightshift;
4. Claude говорит: **«Давай обсудим идею»**;
5. только после короткого intake и явного подтверждения пользователя Nightshift:
   - создаёт проект/репо;
   - разворачивает архитектурный каркас;
   - подключает нужные файлы/контракты/CI/launchd/project registry.

### Почему именно так

Это надёжнее, чем scaffold-first, потому что:
- не создаются лишние репо/папки/ресурсы до фиксации идеи;
- меньше мусора в infra/secrets/deploy providers;
- правильнее выбирается template и стек;
- меньше drift между разговором и scaffold’ом.

### Допустимый fast path

Нужен **необязательный** быстрый путь:
- `--template next-supabase-vercel`
- `--template api-worker`
- `--template internal-tool`

Но это **не default**. Default = conversation-first.

---

## 2. Целевой UX

## 2.1 One-time install

Должна существовать **одна поддерживаемая команда установки**, которая:
- ставит/обновляет Nightshift;
- проверяет зависимости;
- делает CLI доступным как `nightshift`;
- подготавливает Claude-side и Codex-side wiring;
- не требует вручную помнить 5 следующих шагов.

### Минимально приемлемый UX

```bash
bash <(curl -fsSL https://.../install.sh)
```

или

```bash
brew install nightshift
```

или, если это пока internal-only:

```bash
./scripts/install.sh --link-bin --setup-claude --setup-codex --yes
```

Важно не то, какой именно transport выбран, а то, что для пользователя это **один явный entrypoint**, а не "git clone → cd → install → отдельно plugin install → отдельно launchd".

## 2.2 One-command project init

После установки должна быть **одна команда создания/запуска нового проекта**:

```bash
nightshift init ~/dev/my-project
```

или

```bash
nightshift new my-project
```

Она должна:
1. проверить окружение;
2. зарегистрировать проект;
3. подготовить проектный runtime Nightshift;
4. запустить Claude в target project **с уже доступным Nightshift**;
5. автоматически начать intake flow или посадить пользователя в Claude с одной очевидной следующей командой.

### Целевой UX-диалог

```text
$ nightshift init ~/dev/groceries

✓ doctor passed
✓ project registered
✓ nightshift runtime attached
✓ Claude opened in /Users/.../groceries

Nightshift:
  Архитектурный runtime готов.
  Давай обсудим идею перед scaffold’ом.
```

Потом Claude ведёт интервью.
После подтверждения:

```text
✓ constitution created
✓ spec created
✓ template selected: next-supabase-vercel
✓ project scaffolded
✓ CI wired
✓ launchd linked to this project
✓ project ready for /plan
```

---

## 3. Что именно нужно сделать

## P0 — Обязательные фиксы

### P0.1 Упростить install surface

#### Требование
Сделать **один entrypoint** для установки Nightshift.

#### Нужно
- добавить top-level launcher `nightshift` в PATH;
- installer должен быть idempotent;
- installer должен уметь:
  - ставить npm/pnpm зависимости проекта;
  - проверить наличие `claude`, `codex`, `node`, `git`;
  - аккуратно сообщить, что отсутствует;
  - опционально ставить launchd;
  - не регистрировать launchd на `~/.nightshift` как “активный проект” по умолчанию.

#### Acceptance
- пользователь запускает **одну** команду установки;
- по завершении доступна команда `nightshift --help`;
- не требуется вручную искать пути к `claude/` и `codex/`.

---

### P0.2 Исправить Claude plugin wiring

#### Требование
Claude-side hooks должны подключаться **в поддерживаемом plugin surface**, а не через неочевидный/ломкий путь.

#### Нужно
- перевести hook wiring на корректную plugin-конфигурацию;
- обеспечить, чтобы реально работали:
  - session start / resume check;
  - pre-task preflight;
  - write guard;
  - bash budget;
  - post-edit sync;
  - checkpoint.

#### Acceptance
- `/hooks` показывает hooks Nightshift;
- integration test подтверждает, что hook registration реально виден Claude;
- документация не врёт о способе подключения hooks.

---

### P0.3 Убрать зависимость Claude plugin от внешнего `../core`

#### Проблема
Claude plugins устанавливаются копированием plugin directory в cache location. Нельзя рассчитывать, что plugin сможет стабильно ходить наружу по `../core`.

#### Требование
Claude plugin должен быть **самодостаточным runtime surface**.

#### Предпочтительное решение
Сделать self-contained Claude-side execution surface:
- либо `bin/nightshift` внутри plugin root;
- либо сгенерированный `dist/claude-plugin/` с включённым runtime helper;
- либо другой надёжный способ, при котором plugin-команды не ломаются после установки.

#### Acceptance
- установленный Claude plugin работает независимо от cwd;
- команды Nightshift не требуют, чтобы target project содержал `core/`;
- локальный dev-mode и installed mode одинаково предсказуемы.

---

### P0.4 Привести Codex integration к честному состоянию

#### Требование
Нужно выбрать одно из двух и сделать это честно:

**Вариант A:** довести `codex/` до настоящего installable Codex plugin/packaging surface.  
**Вариант B:** честно позиционировать это как adapter/skill-pack и не выдавать за готовый plugin.

#### Обязательное независимо от варианта
`dispatch` должен реально передавать в Codex всё, что skills ожидают:
- `NIGHTSHIFT_TASK_CONTRACT`
- `NIGHTSHIFT_CONTEXT_PACK`
- `NIGHTSHIFT_CONSTITUTION`
- `NIGHTSHIFT_PROJECT_DIR`
- при необходимости `NIGHTSHIFT_DECISIONS`, `NIGHTSHIFT_SERVICES`, `NIGHTSHIFT_REUSE_INDEX`

#### Acceptance
- implementer/context-packer получают свои входы не “по договорённости”, а реально;
- есть integration test на dispatch → Codex env plumbing.

---

### P0.5 Починить health-ping/resume flow

#### Требование
Ночной pinger должен вызывать Claude **поддерживаемым способом**, а не на сомнительном флаге.

#### Нужно
- перепроверить и переписать resume-call на реально поддерживаемый CLI flow;
- задокументировать, в каком режиме это работает;
- если нужен wrapper/launcher — сделать его официальной частью Nightshift.

#### Acceptance
- health-ping умеет безопасно инициировать resume на project session;
- это покрыто хотя бы одним integration test / scripted smoke.

---

### P0.6 Исправить launchd UX

#### Проблема
Сейчас launchd легко привязывается к самой папке Nightshift, а не к целевому проекту.

#### Требование
Launchd должен устанавливаться **явно на project path**.

#### Нужно
- не включать project-specific launchd автоматически на `~/.nightshift`;
- при `nightshift init <project>` регистрировать launchd именно на этот проект;
- хранить связку project ↔ plist/runtime в registry.

#### Acceptance
- новый проект после `nightshift init` получает корректный pinger/digest;
- Nightshift core не считается “активным проектом”.

---

## P1 — Новый intake flow

### P1.1 Добавить команду верхнего уровня

Нужна новая верхнеуровневая команда:

```bash
nightshift init <project-path>
```

или

```bash
nightshift new <project-name>
```

### Эта команда должна делать

#### Шаг 1. Doctor
- проверка `node`, `git`, `claude`, `codex`, `pnpm`/`npm`
- проверка прав записи
- проверка, не занят ли target path
- проверка secret backend и deploy tooling, если template этого требует

#### Шаг 2. Project registration
- создать запись в глобальном registry
- присвоить `project_id`
- зафиксировать путь, template (если выбран), created_at, stage=`intake`

#### Шаг 3. Launch Claude with Nightshift available
Nightshift должен открыть Claude так, чтобы user **сразу попал в intake flow**.

#### Шаг 4. Intake interview
Claude должен провести короткое, но жёсткое интервью:
- что строим;
- кто пользователь;
- основной use case;
- что явно out of scope;
- constraints по стеку и стоимости;
- deploy ожидания;
- данные / auth / payments / background jobs;
- success criteria “к утру”.

#### Шаг 5. Approval checkpoint
Claude кратко резюмирует:
- idea summary
- selected stack
- selected template
- selected providers
- initial risk class

И спрашивает:

> Подтверждаешь? После подтверждения я разверну структуру проекта.

#### Шаг 6. Scaffold after approval
Только после этого Nightshift делает scaffold:
- repo init / open existing repo;
- template files;
- `memory/`;
- `tasks/`;
- contracts;
- `.env.template`;
- CI;
- launchd/project runtime;
- project-level state;
- optional Codex adapter wiring.

#### Шаг 7. Return to Claude
После scaffold Claude должен вернуться с понятным summary:
- что создано;
- какой template выбран;
- что уже известно;
- что следующий шаг — `/plan`.

---

## P1.2 Добавить fast path, но не по умолчанию

Нужен флаг:

```bash
nightshift init ~/dev/foo --template next-supabase-vercel --fast
```

Тогда:
- scaffold можно делать сразу;
- intake будет короче;
- но это explicit opt-in.

---

## P1.3 Согласовать команды Claude с новым flow

Нужно переработать UX команд так, чтобы новый пользователь не запоминал старую многошаговую магию.

### Целевой порядок
1. `nightshift init <project>`
2. Claude intake
3. scaffold
4. `/plan`
5. `/analyze`
6. `/tasks`
7. `/implement`
8. `/review-wave`
9. `/sync`
10. `/deploy`
11. `/status`

### Важно
`/bootstrap` не должен оставаться как confusing first step, если `nightshift init` уже делает bootstrap/scaffold.

Нужно выбрать:
- либо `/bootstrap` становится internal-only / alias / deprecated;
- либо `nightshift init` сам вызывает ту же логику.

Но пользователь должен видеть **один главный entrypoint**, а не 2 конкурирующих.

---

## P1.4 Сделать retrieval-memory обязательной частью pipeline

### Почему
Сейчас Nightshift умеет записывать память, но ещё недостаточно хорошо умеет её использовать в нужный момент.

### Нужно добавить

#### 1. `memory/decisions.ndjson`
Machine-readable log решений:
- `id`
- `ts`
- `kind`
- `subject`
- `answer`
- `source`
- `wave/task`
- `supersedes`

#### 2. `memory/services.json`
Живое состояние инфраструктуры:
- preview URL
- prod URL
- provider resource IDs
- secret refs
- environments
- deploy ownership

#### 3. `memory/incidents.ndjson`
История ошибок и fixes:
- symptom
- task/wave
- root cause
- fix
- evidence
- prevented_by

#### 4. `memory/reuse-index.json`
Machine-readable reuse memory:
- file
- export/name
- purpose
- tags
- safe_to_extend
- examples

### Главное требование
`context-packer` и `plan-writer` обязаны читать это как **first-class inputs**.

Не достаточно “где-то это записали”. Нужно реальное retrieval использование.

---

## P1.5 Добавить глобальный registry проектов

### Файл
`~/.nightshift/registry/projects.json`

### Минимальная структура
- `project_id`
- `path`
- `name`
- `stage`
- `template`
- `stack`
- `providers`
- `active_wave`
- `last_digest_at`
- `launchd_enabled`
- `created_at`

### Зачем
Это мост к твоей большей идее “несколько проектов в одном контуре”, но без UI и лишней сложности.

---

## 4. Архитектурные правила batch-а

### 4.1 Не усложнять сверх нужного
В этом batch-е **не нужно**:
- vector DB;
- graph DB;
- отдельный web dashboard;
- cloud orchestration;
- multi-user permissions system;
- always-on supervisor beyond launchd/local scheduler.

### 4.2 Не ломать current core
Сохраняем:
- `events.ndjson` как canonical event log;
- `state.json` как projection;
- `compliance.md` как derived artifact;
- heavy lane;
- micro lane;
- hard gates;
- approvals/risk classes.

### 4.3 Не смешивать marketing UX и actual runtime truth
README/install/docs должны описывать **то, что реально работает сейчас**, а не желаемое будущее.

---

## 5. Детальный acceptance

## 5.1 Install

### Сценарий
Пользователь на чистой машине запускает одну команду установки.

### Должно быть
- Nightshift CLI появляется в PATH;
- self-test проходит;
- выводит понятную следующую команду;
- не привязывает launchd к `~/.nightshift` как к активному проекту.

---

## 5.2 Init flow

### Сценарий
```bash
nightshift init ~/dev/groceries
```

### Должно быть
- project регистрируется;
- Claude открывается с доступным Nightshift;
- начинается intake;
- после подтверждения делается scaffold;
- Claude возвращается с summary и следующим шагом.

---

## 5.3 Retrieval memory

### Сценарий
Пользователь дал ответ на архитектурный вопрос.

### Должно быть
- решение попадает в `decisions.ndjson`;
- следующий `/plan` и `context-packer` реально учитывают его без ручного grep пользователя.

---

## 5.4 Codex execution

### Сценарий
Nightshift отдаёт задачу Codex implementer’у.

### Должно быть
- contract/context/constitution/project_dir реально переданы;
- это видно по интеграционному тесту и debug output;
- fallback при отсутствии Codex остаётся честным.

---

## 5.5 Overnight

### Сценарий
Есть project-specific launchd.

### Должно быть
- pinger смотрит на правильный проект;
- digest относится к правильному проекту;
- resume flow работает поддерживаемым путём;
- stalled tasks корректно уходят в paused.

---

## 6. Формат спорных решений

Разработчик может **оспорить** предложенное решение, если даёт:

1. альтернативу;
2. почему она надёжнее/проще;
3. что она не ломает из acceptance;
4. migration plan, если меняется surface.

### Примеры допустимого спора
- вместо CLI subprocess для Codex использовать Codex SDK;
- вместо `projects.json` использовать SQLite registry;
- вместо `decision.ndjson` + `services.json` использовать одну структурированную state DB.

### Но недопустимо
- просто убрать требование к one-command init;
- оставить scaffold-first default без доказательства надёжности;
- оставить write-only memory без retrieval integration;
- оставить install/docs surface в противоречии с реальным wiring.

---

## 7. Рекомендуемый порядок реализации

### Wave A — install + wiring
- one-command install
- Claude hooks wiring
- core path resolution fix
- launchd project targeting
- health-ping resume fix

### Wave B — init UX
- `nightshift init`
- intake flow
- approval checkpoint
- scaffold-after-approval
- deprecate/alias old bootstrap path

### Wave C — retrieval memory
- decisions.ndjson
- services.json
- incidents.ndjson
- reuse-index.json
- context-packer/plan-writer integration

### Wave D — Codex honesty
- adapter vs plugin decision
- dispatch env wiring
- integration tests
- docs cleanup

---

## 8. Итоговое определение done

Этот batch считается готовым, если:

- Nightshift можно поставить одной командой;
- новый проект можно начать одной командой;
- по умолчанию Nightshift сначала обсуждает идею, а потом разворачивает scaffold;
- Claude-side hooks реально работают;
- Codex integration реально получает нужные входы;
- launchd смотрит на правильный проект;
- decisions/services/incidents/reuse становятся частью retrieval memory;
- docs/install flow не обещают того, чего runtime ещё не умеет.

