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
  # calls:                   # задача-функция: проверка вызывает функцию и сравнивает, что она вернула —
  #                          # формат в docs/template/course-package.md, раздел 7 «Задачи-функции»
  asserts:                   # особые проверки функций: код ученика выполняется, затем каждая проверка отдельно
    - name: Квадрат 3 равен 9
      code: assert square(3) == 9, "square(3) должно вернуть 9"
  forbid: [max, sorted]      # необязательно: что нельзя использовать в решении (задачи «напишите сами»);
                             # проверяется по синтаксическому дереву — имя, метод или импорт; комментарии не считаются; если запрет нарушен, остальные тесты не запускаются
                             # особые значения: "[]" — индексы и срезы, "f-string" — f-строки, "for" и "while" — циклы, "slice" — только срезы (индекс s[i] разрешён);
                             # имя, которое ученик сам завёл (свой count = 0), запретом не считается — только готовые функции и методы
  files:                     # необязательно: файлы задачи (имя → текст) — таблица для чтения, модуль для import
    sales.csv: |
      город,сумма
      Казань,120
    shop.py: |
      def total(prices):
          return sum(prices)
hints:                       # лестница: открываются по одной, число открытых сохраняется
  - level: 1
    text: Вспомните, какая функция выводит текст.
timeout_ms: 5000             # необязательно
```

**Файлы задачи.** Каждый запуск (проверка, «По шагам», каждый тест `io`) идёт в своей свежей папке: туда кладутся `tests.files`, она становится текущей и первым местом, где ищет `import`, поэтому `open("sales.csv")` и `import shop` находят файлы задачи. После запуска папка удаляется вместе с импортированными из неё модулями — следующий запуск начинается с чистого листа. Ученик видит файлы вкладками над редактором («Ваш код», `shop.py`, `sales.csv`), только для чтения. У теста `io` могут быть свои `files` (поверх общих — другой `sales.csv`) и `files_out` — какие файлы программа должна оставить и с каким текстом (сравнение как у вывода; у скрытого теста ожидаемый текст не показывается). Код ученика лежит в той же папке как `main.py`: проверка может сделать `import main` и убедиться, что при импорте ничего не печатается (`if __name__ == "__main__"`). Проверки `asserts` выполняются в той же папке после кода ученика и могут читать созданные им файлы. В теории `<Trace files={{"sales.csv": "…"}}>` показывает пошаговое выполнение с файлами.

Подсказка в `input("...")` не мешает проверке: при проверке текст подсказки не попадает в вывод. При «Запустить» ученик видит её вместе с введённой строкой, как в терминале. Код ученика, итог, число проверок и подсказок сохраняются (`quiz_state`, scope `task:<id>`), каждая проверка пишется в `attempt` (kind `code`).

### 3.2. Задача в терминале (`sandbox: shell`) — реализовано (этапы 1 и 2)

Тренажёр Linux-терминала в браузере: ученик набирает настоящие команды bash на виртуальной файловой системе, проверяется **итог** — файлы и папки после его работы, вывод и какие команды он применял. Вставляется так же: `<Sandbox task="<id>" />`, у задачи — своя страница (условие слева, терминал с деревом файлов справа, «Проверить», «Сбросить», проверки вкладками). Состояние (файлы, папка, история) сохраняется, как код задачи на Python. Образец — `apps/web/src/shell/__tests__/fixtures/sh-sample-backup/task.yaml`.

```yaml
id: sh-sample-backup
title: Разобрать папку с отчётами
sandbox: shell
difficulty: 2
statement: |
  1. Создайте папку `archive/2026` …
setup:
  cwd: /home/student          # начальная папка; относительные пути в files, dirs и проверках — от неё
  user: student               # пока только student (права и пользователи — этап 2)
  env: {LANG: C.UTF-8}        # дополнительные переменные окружения
  date: 2026-11-20T09:00      # дата файлов задачи (ls -l); по умолчанию — вчера, 09:00
  files:                      # путь → текст, или {content, mode, owner, group}
    reports/jan.csv: "id,amount\n1,10\n"
    /etc/app.conf: {content: "port=80\n", mode: "644", owner: root}
  dirs: [drafts]              # пустые папки
solution:                     # эталон: команды по порядку; валидатор выполняет их в тренажёре
  - mkdir -p archive/2026
  - mv reports/*.csv archive/2026/
  - {cmd: "rm -i old.txt", input: ["y"]}                                # ответы на вопросы команды
  - {cmd: "nano app.conf", keys: ["End", "0", "C-o", "Enter", "C-x"]}   # клавиши полноэкранной программы
tests:
  checks:                     # все должны пройти; у каждой — русское name (иначе имя строится само), необязательные hidden и message
    - {name: Папка создана, fs_exists: archive/2026, type: dir}     # type: file | dir — необязательно
    - fs_absent: reports/jan.csv
    - fs_content: {path: count.txt, equals: "4\n"}                  # или contains: […], not_contains: […], regex: "…"
    - fs_mode: {path: deploy.sh, mode: "744"}                        # права (для темы о правах)
    - last_output_contains: ["срочно: сдать отчёт"]                  # последняя команда, которая что-то напечатала
    - run: ls archive/2026                                           # выполняется на КОПИИ итоговой ФС ученика
      stdout: "feb.csv\njan.csv\n"                                   # stdout, stdout_contains, stderr, stderr_contains, exit_code; stdin, cwd
    - command_used: [mv]                                             # хоть одна из команд встречалась в истории
    - {name: Перенос, а не копирование, forbid_commands: [cp], hidden: true}
hints:
  - level: 1
    text: "`mkdir -p` создаёт всю цепочку папок сразу."
```

Клавиши в `keys`: символ, `Enter`, `Backspace`, `Delete`, `Tab`, `Escape`, стрелки `Up`/`Down`/`Left`/`Right`, `Home`, `End`, `PageUp`, `PageDown`, `C-x` (Ctrl+X), `M-g` (Alt+G), `F1`…`F12`.

- **Команды — по смыслу, а не по символам.** `command_used` и `forbid_commands` смотрят на имена команд из разбора строки (синтаксическое дерево): `\rm`, `/bin/rm`, `rm` внутри `&&` и конвейера — всё это `rm`. Запрещайте команду, только если без запрета задача решается «не тем» способом (перенос — копированием и удалением).
- **`run` — на копии.** Проверочная команда не меняет файлы ученика; вывод сравнивается без цветовых кодов; `ls` в проверке пишет «в трубу» (по одному имени в строке, как настоящий `ls` не в терминал).
- **Ловушки — проверкой содержимого.** `sort f > f` даёт пустой файл — `fs_content` с `equals` сообщит «Файл пустой»: заблуждение видно по результату.
- **Валидатор** (`tools/program/build.py`, `npm run check`) проверяет схему, выполняет `solution` в том же движке (Node 22.18+, `apps/web/src/shell/headless.ts`) — все проверки должны пройти — и проверяет, что без единой команды хотя бы одна проверка не проходит.
- **Что умеет терминал (этап 1).** Команды тем «Файловая система», «nano», «Пайпы»: `pwd`, `cd` (`..`, `~`, `-`, без аргумента), `ls` (`-l -a -A -h -R -1 -t -S -r -d -F`), `mkdir` (`-p -v`), `touch`, `cp` (`-r -i -v -n`), `mv` (`-i -v -n`), `rm` (`-r -f -i -v -d`), `rmdir`, `cat` (`-n -b`), `less`, `head`/`tail` (`-n N`, `-N`, `-n +N`, `-n -N`, `-c`), `tree`, `file`, `man`, `--help`, `clear`, `history`, `echo`, `nano`, `vim` (только выйти), `grep` (`-i -v -n -c -r -o -w -E`), `find` (`-name -iname -type -size -mtime -exec … \;`/`+`), `wc` (`-l -w -c -m`), `sort` (`-n -r -k -t -u`), `uniq` (`-c -d -u -i`), `cut` (`-d -f -c`), `tee` (`-a`); шаблоны `* ? [abc]` по правилам bash (скрытые не совпадают, без совпадений шаблон остаётся), кавычки `"…" '…' \`, `| > >> < 2> 2>> 2>&1 &> /dev/null ; && ||`, `$?`, переменные, `$(…)`, `$((…))`. Сообщения об ошибках — дословно как в Ubuntu (по-английски), справка `man`/`--help` — короткая, на русском. Этап 2 — права, процессы, окружение и скрипты — ниже.

**Этап 2: права, процессы, окружение, скрипты.** Темы «Права доступа и владельцы; sudo», «Процессы и сигналы», «Переменные окружения и PATH», «Bash-скрипты». Образец — `apps/web/src/shell/__tests__/fixtures/sh-sample-admin/task.yaml`.

```yaml
setup:
  user: student                    # кто ученик (по умолчанию student: группы student и sudo); есть ещё anna (anna, team) и root
  sudo_password: forge             # пароль ученика для sudo (по умолчанию forge)
  users:                           # новые пользователи или изменения: группы, пароль (для su), uid
    bob: {groups: [team], password: secret}
    student: {groups: [sudo, team]}
  files:
    /srv/app/config.ini: {content: "port=80\n", mode: "644", owner: root, group: root}
  dirs:
    - {path: /srv/team, mode: "2775", owner: anna, group: team}
  env: {APP_ENV: dev}              # экспортированные переменные окружения
  processes:                       # процессы при старте задачи (PID по порядку с 3001, если не заданы)
    - {name: hog, behavior: busy}                                   # 99,7 % CPU, умирает от TERM
    - {name: stubborn, behavior: ignore_term}                       # игнорирует TERM/INT/HUP — только KILL
    - {name: collector, user: root, behavior: logger, file: /var/log/collector.log}   # пишет строку в файл раз в секунду
    - {name: worker, behavior: cleanup, file: state.txt}            # на TERM дописывает "saved" и выходит; KILL — без уборки
    # ещё поля: cpu, mem, pid, cmd (что видно в ps), line (текст строки logger, {time} — время), tty
tests:
  checks:
    - fs_owner: {path: /srv/app/config.ini, owner: root, group: root}   # owner и/или group
    - fs_mode: {path: deploy.sh, mode: "744"}
    - process_absent: hog                       # или {name: hog, user: student}
    - process_alive: collector
    - signal_sent: {to: stubborn, signal: KILL, after: TERM}   # KILL был, и до него — TERM
solution:
  - {cmd: "echo port=8080 | sudo tee /srv/app/config.ini", input: ["forge"]}   # пароль sudo — как ответ на вопрос
```

- **Права проверяются при каждом обращении** по правилам POSIX: тройка владельца, группы или остальных; у папки r — читать список, w — создавать и удалять в ней, x — входить и проходить насквозь; удаление файла зависит от прав папки, а не файла (`rm` спросит про `write-protected`); у `/tmp` бит sticky — чужое не удалить; root проходит везде (исполнять — если есть хоть один x). Сообщения — как в Ubuntu: `Permission denied`, `Operation not permitted`.
- **sudo** спрашивает пароль ученика (`[sudo] password for student:`, ввод не отображается), три попытки, помнит 15 минут; `sudo -i`, `sudo su`, `su - anna` открывают оболочку другого пользователя, `exit` возвращает. Ловушка `sudo echo x > /etc/f` работает как в жизни: перенаправление делает оболочка ученика — `Permission denied`; правильно — `… | sudo tee /etc/f`.
- **Процессы**: `ps` (`aux`, `-ef`, `-e`, `-u`, `-p`, `--sort=-%cpu`), `pgrep` (`-l -a -f -u -x`), `kill` (`-TERM -INT -KILL -9 -15 -STOP -CONT -s`, `%N`, `-l`), `pkill`, `killall`, `top` (раз в секунду; `q`, `P`, `M`, `k`), `sleep`, `&`, `$!`, `jobs` (`-l -p`), `fg`, `bg`, Ctrl+C (SIGINT, код 130), Ctrl+Z (задание остановлено, код 148); убитый сигналом N завершается с кодом 128+N; чужой процесс без sudo — `Operation not permitted`; остановленный процесс получит TERM только после CONT. Время настоящее: что произошло между командами, догоняется перед каждой.
- **Окружение**: переменная оболочки и экспортированная различаются (`X=1` не видна `bash -c`, `printenv`, `env`, пока нет `export`); `VAR=x команда`, `unset`; `PATH` ищется слева направо, своя программа в текущей папке — только `./prog`; `which`, `type`; псевдонимы и функции живут до закрытия окна; `source`/`.` выполняет файл в этой оболочке. Кнопка «Новое окно терминала» в тренажёре — новый bash: переменные без `export`, псевдонимы и задания пропадают, читается `~/.bashrc` (в нём по умолчанию `ll`, `la`, `l` как в Ubuntu); `exit` в последнем окне тоже открывает новое.
- **Скрипты**: `./script.sh` требует x и выполняет shebang (`#!/bin/bash`, `#!/usr/bin/env bash`), `bash script.sh` — только чтения; скрипт — дочерний процесс (`cd` и переменные внутри не меняют оболочку ученика); `$0 $1…$9 $# $@ "$@" $?`, `read -r`, `while read -r line; do …; done < файл`, `test`/`[ ]`/`[[ ]]`, `if/elif/else`, `for`, `while`, `case`, функции, `$(…)`, `$((…))`, `set -euo pipefail`. Файл с концами строк Windows ломается как в настоящем bash: `/bin/bash^M: bad interpreter`, `$'\r': command not found`; `cat -A` показывает `^M$`.
- **Чего нет**: `read` с клавиатуры внутри скрипта (ввод — через `|` или `<<<`; проверка `run` — через `stdin`); `python3` (мост к Pyodide не сделан — см. `docs/dev/decisions.md`); `apt`.

**`<Shell>` в теории** — живой терминал на заготовленных файлах, без оценки и без сохранения:

```mdx
<Shell files={{"notes/todo.txt": "купить молоко\n"}} dirs={["photos"]} cwd="/home/student" />
<Shell files={{"report.csv": "id,amount\n"}} script={["ls", "mkdir backup", "cp report.csv backup/", "ls -R"]} />
```

С `script` кнопка «Следующая команда» набирает и выполняет команды по одной (как пошаговый `<Trace>`); между ними ученик может вводить свои. «Сбросить» возвращает файлы. Необязательно: `rows` (высота в строках), `title`, а для демонстраций этапа 2 — `processes`, `users`, `env` в том же виде, что в `setup` задачи (например, `<Shell processes={[{name: "hog", behavior: "busy"}]} script={["ps aux", "kill 3001", "ps aux"]} />`).

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
