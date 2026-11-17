# Документация Syllabus Engine

Проект состоит из двух независимых частей:

- **Движок** — платформа обучения: сервер, песочницы, проверка, повторение, преподаватель Claude, интерфейс. Ничего не знает о машинном обучении.
- **Пакет обучения** — конкретное обучение в `content/<id>/`: учебный план, темы, задачи, глоссарий, тексты главной, свои демонстрации. Активный выбирается в `syllabus.yaml`. Сейчас основной пакет — Forge ML (машинное обучение и данные), есть маленький образец `example-drawing`.

Поэтому документация разделена на пять частей. Для курса по музыке или рисованию создаётся свой пакет (формат — [template/course-package.md](template/course-package.md)) и, если нужно, своя песочница (см. [template/new-domain.md](template/new-domain.md)).

| Часть | Для кого | Документы |
|---|---|---|
| **product/** — что и зачем | все | [vision](product/vision.md) — цель, рынок, профиль выпускника · [learning-method](product/learning-method.md) — методика: ступени, рубежи, повторение, подсказки · [teacher](product/teacher.md) — преподаватель Claude |
| **content/** — курс | авторы курса | [curriculum](../content/forge-ml/docs/curriculum.md) — учебный план (генерируется) · [style-guide](content/style-guide.md) — как писать теорию · [authoring](content/authoring.md) — форматы файлов, задачи, генераторы · [visualizations](content/visualizations.md) — визуализации и тренажёры по всему курсу · [sources](content/sources.md) — источники и лицензии |
| **platform/** — движок | разработчики | [architecture](platform/architecture.md) — стек, сервер, песочницы, данные, Claude · [development-plan](platform/development-plan.md) — этапы |
| **frontend/** — интерфейс | разработчики, дизайн | [design-system](frontend/design-system.md) — токены, шрифты, страницы, компоненты |
| **dev/** — кухня разработки | авторы и ревьюеры | [README](dev/README.md) · [decisions](dev/decisions.md) — журнал решений · [prerequisite-trees](../content/forge-ml/docs/prerequisite-trees.md) — деревья предпосылок Forge ML (генерируется) · [review-protocol](dev/review-protocol.md) |
| **template/** — тиражирование | кто делает курс по другой теме | [course-package](template/course-package.md) — формат пакета обучения и подключение · [course-generator-prompt](template/course-generator-prompt.md) — промпт агенту «сделай курс по X» · [project-brief](template/project-brief.md) — полная выжимка замысла для своего агента · [new-domain](template/new-domain.md) — как сделать такую же платформу для музыки, рисования и т. д. |

Источник правды для структуры обучения — `program.yaml` пакета (для Forge ML — `content/forge-ml/program.yaml`). Документы в `content/<id>/docs/` генерируются из него командой `npm run build:docs`.
