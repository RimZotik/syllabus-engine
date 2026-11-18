# Форматы контента и как его расширять

> Всё содержимое обучения — обычные файлы в папке пакета `courses/<id>/` (формат пакета и подключение — [template/course-package.md](../template/course-package.md)). Добавить тему, задачу или вопрос = добавить файл по шаблону. Код платформы при этом не меняется.
>
> Раздел 1 ниже — целевое дерево, включая то, что ещё **планируется** (course.yaml, discipline.yaml, концепты, генераторы, рубрики, датасеты). Что уже работает — в спецификации пакета.

## 1. Дерево контента

```
content/
  program.yaml              # учебный план: курсы → дисциплины → разделы → темы (источник правды о порядке)
  glossary.yaml             # все термины курса
  concepts.yaml             # концепты (единицы памяти для повторения) и их предпосылки
  courses/
    I/                      # курс
      course.yaml           # переводной экзамен, курсовой проект, рубрика проекта
      sql1/                 # дисциплина (id из program.yaml)
        discipline.yaml     # экзамен: состав, порог, устные вопросы; открываемые библиотеки
        joins/              # раздел
          section.yaml      # контрольная раздела
          01-join-types/    # тема
            topic.mdx       # текст темы (разметка — см. style-guide.md)
            checks.yaml     # встроенные «проверь себя»
            figures/        # иллюстрации и данные для них
            tasks/
              count-orders/
                task.yaml   # условие, песочница, концепты, сложность, подсказки
                starter.sql
                solution.sql
                tests.yaml
  question_families/        # генераторы вопросов (раздел 4)
  rubrics/                  # рубрики для устных и письменных ответов
  datasets/                 # маленькие учебные наборы данных (крупные — скачиваются)
```

`id` курса, дисциплины и раздела совпадают с `program.yaml`. Валидатор не пропустит тему, которой нет в плане, и план без тем.

## 2. Тема — `topic.mdx`

```mdx
---
id: I.sql1.joins.01
title: JOIN — это операция над множествами строк
minutes: 45
concepts: [sql.join.inner, sql.join.left, sql.join.null-fill]
introduces: [join, cartesian-product, null]   # термины глоссария, которые вводятся здесь
sources: ["CMU 15-445, лекция 2", "PostgreSQL Docs 7.2.1"]
---

<Hook>Две таблицы почти всегда связаны…</Hook>

Соединение <Mark>склеивает строки из двух таблиц по условию</Mark>…

<Viz kind="sql-join" tables="users,orders" />

<Check id="left-count" />

<Sandbox task="count-orders" />
```

Компоненты разметки описаны в [style-guide.md](style-guide.md), раздел 3. Новый компонент добавляется во фронтенд один раз (см. [design-system.md](../frontend/design-system.md)) и сразу доступен всем темам.

## 3. Задача — `task.yaml`

```yaml
id: count-orders
title: Число заказов у каждого пользователя
sandbox: sql                 # тип песочницы: python-browser | python-kernel | sql | git | shell | math | ...
dataset: shop-small          # из content/datasets
concepts: [sql.join.left, sql.aggregate.count-null]
difficulty: 2                # 1–5
statement: |
  Выведите имена всех пользователей и число их заказов, включая тех, у кого заказов нет.
checks:                      # как проверять (тип зависит от песочницы)
  compare: result_set
  order_matters: true
hints:                       # лестница H1–H5
  - level: 1
    text: Что именно считает COUNT(*) в строке, где все столбцы orders равны NULL?
  - level: 2
    text: Вспомните разницу COUNT(*) и COUNT(столбец).
variants: question_families/sql/left-join-count.py   # необязательно: генератор вариантов
```

### 3.1. Задача на Python (`sandbox: python-browser`) — реализовано

Лежит в `<тема>/tasks/<id>/task.yaml`, в тексте темы вставляется `<Sandbox task="<id>" />`. Код выполняется в браузере (Pyodide в фоновом потоке, без интернета), бесконечный цикл останавливается по таймауту.

```yaml
id: greet-by-name            # уникален во всём курсе
title: Приветствие
sandbox: python-browser
difficulty: 1
statement: |                 # `код` в обратных кавычках выделяется
  Прочитайте имя через `input()` и выведите `Привет, <имя>!`.
starter: |                   # с чего начинает ученик; НЕ должен проходить тесты
  name = input()
stdin: "Аня
"               # ввод по умолчанию для кнопки «Запустить»
solution: |                  # эталон; обязан проходить все тесты (проверяет npm run check)
  name = input()
  print(f"Привет, {name}!")
tests:
  io:                        # программа целиком: ввод → ожидаемый вывод (пробелы в концах строк не важны)
    - stdin: "Аня
"
      stdout: "Привет, Аня!"
    - stdin: "Борис
"
      stdout: "Привет, Борис!"
      hidden: true           # ученик видит только, что тест не прошёл
  asserts:                   # для функций: код ученика выполняется, затем каждая проверка отдельно
    - name: Квадрат 3 равен 9
      code: assert square(3) == 9, "square(3) должно вернуть 9"
  forbid: [max, sorted]      # необязательно: что нельзя использовать в решении (задачи «напишите сами»);
                             # проверяется по синтаксическому дереву — имя, метод или импорт; комментарии не считаются
                             # особые значения: "[]" — индексы и срезы, "f-string" — f-строки
hints:                       # лестница: открываются по одной, число открытых сохраняется
  - level: 1
    text: Вспомните, какая функция выводит текст.
timeout_ms: 5000             # необязательно
```

Подсказка в `input("...")` не мешает проверке: при проверке текст подсказки не попадает в вывод. При «Запустить» ученик видит её вместе с введённой строкой, как в терминале. Код ученика, итог, число проверок и подсказок сохраняются (`quiz_state`, scope `task:<id>`), каждая проверка пишется в `attempt` (kind `code`).

## 4. Семейство вопросов — генератор

Семейство = шаблон + код-генератор + эталон + рубрика. Платформа порождает варианты сама, бесплатно; Claude пишет семейство один раз.

```python
# content/question_families/linalg/matmul_shape.py
FAMILY = {"id": "linalg.matmul.shape", "concepts": ["linalg.matmul.dims"], "type": "number-tuple"}

def generate(rng):
    m, n, k = rng.integers(2, 7, size=3)
    return {
        "prompt": f"A имеет размер {m}×{n}, B — {n}×{k}. Каков размер AB?",
        "answer": (m, k),
        "distractors": [(n, n), (m, n), (k, m)],   # для варианта с выбором ответа
    }
```

Обязательные проверки в CI: генератор детерминирован при одинаковом seed, эталон проходит свои тесты, варианты не повторяются в пределах 100 запусков.

## 5. Глоссарий — `glossary.yaml`

```yaml
- id: cross-entropy
  term: кросс-энтропия
  en: cross-entropy
  synonyms: [перекрёстная энтропия, log-loss]
  short: Мера того, насколько предсказанное распределение вероятностей далеко от правильного ответа. Чем увереннее модель ошибается, тем она больше.
  formula: "H(p, q) = -\\sum_i p_i \\log q_i"
  introduced_in: II.prob.info.03
```

## 6. Рубрика устного ответа

```yaml
id: sql.where-vs-having
question: Чем WHERE отличается от HAVING?
criteria:
  - {id: order, text: "Называет порядок: WHERE до группировки, HAVING после", points: 2}
  - {id: aggregates, text: "Объясняет, почему агрегаты допустимы только в HAVING", points: 2}
  - {id: example, text: "Приводит корректный пример", points: 1}
misconceptions:
  - "HAVING — это просто WHERE для больших таблиц"
probes:                       # стандартная лестница уточнений (одинакова для всех учеников)
  - Нужно найти города, где больше 10 покупателей старше 30. Какое условие куда пойдёт?
  - Что произойдёт, если написать COUNT(*) > 10 в WHERE?
reference_answer: …
```

## 7. Как добавить новое

| Что | Шаги |
|---|---|
| Тему | 1) строка в `program.yaml`; 2) папка темы по шаблону `tools/templates/topic`; 3) термины в глоссарий; 4) `uv run forge validate` |
| Задачу | папка в `tasks/` по шаблону песочницы; эталон должен пройти тесты |
| Вопрос с вариантами | файл в `question_families/`, ссылка из `checks.yaml` или экзамена |
| Дисциплину | раздел в `program.yaml` → `build.py` проверит порядок → папка дисциплины |
| Новый тип песочницы | это изменение движка, см. [architecture.md](../platform/architecture.md), раздел «Песочницы как плагины» |

Шаблоны для всех типов файлов лежат в `tools/templates/`; команда `uv run forge new topic I.sql1.joins` создаёт заготовку.
