# Документация Syllabus Engine

Проект состоит из двух независимых частей:

- **Движок** — платформа обучения: сервер, песочницы, проверка, повторение, преподаватель Claude, интерфейс. Ничего не знает о машинном обучении.
- **Контент-пакет** — конкретный курс: учебный план, темы, задачи, генераторы вопросов, глоссарий, рубрики. Сейчас это курс Forge ML по машинному обучению и данным.

Поэтому документация разделена на пять частей. Для курса по музыке или рисованию меняется только контент-пакет и, возможно, набор песочниц (см. [template/new-domain.md](template/new-domain.md)).

| Часть | Для кого | Документы |
|---|---|---|
| **product/** — что и зачем | все | [vision](product/vision.md) — цель, рынок, профиль выпускника · [learning-method](product/learning-method.md) — методика: ступени, рубежи, повторение, подсказки · [teacher](product/teacher.md) — преподаватель Claude |
| **content/** — курс | авторы курса | [curriculum](content/curriculum.md) — учебный план (генерируется) · [style-guide](content/style-guide.md) — как писать теорию · [authoring](content/authoring.md) — форматы файлов, задачи, генераторы · [visualizations](content/visualizations.md) — визуализации и тренажёры по всему курсу · [sources](content/sources.md) — источники и лицензии |
| **platform/** — движок | разработчики | [architecture](platform/architecture.md) — стек, сервер, песочницы, данные, Claude · [development-plan](platform/development-plan.md) — этапы |
| **frontend/** — интерфейс | разработчики, дизайн | [design-system](frontend/design-system.md) — токены, шрифты, страницы, компоненты |
| **dev/** — кухня разработки | авторы и ревьюеры | [README](dev/README.md) · [decisions](dev/decisions.md) — журнал решений · [prerequisite-trees](dev/prerequisite-trees.md) — деревья предпосылок (генерируется) · [review-protocol](dev/review-protocol.md) |
| **template/** — тиражирование | кто делает курс по другой теме | [project-brief](template/project-brief.md) — полная выжимка замысла для своего агента · [new-domain](template/new-domain.md) — как сделать такую же платформу для музыки, рисования и т. д. |

Источник правды для структуры курса — `content/program.yaml`. Документ `content/curriculum.md` генерируется из него командой `uv run --with pyyaml tools/program/build.py`.
