# AI QA — матеріали на експертне рецензування

Лонгріди курсу AI QA з шаром коментарів як у Notion: експерт виділяє фрагмент тексту → «💬 Коментувати» → коментар зберігається в Supabase. Є відповіді в треді, статус «вирішено», панель усіх коментарів, фільтр за автором, експорт у CSV / Markdown.

## Файли
- `index.html` — загальна сторінка з усіма готовими лонгрідами й лічильником коментарів (посилання для експерта: `…/aq-qa/?k=<ключ рецензента>`)
- `pw-pre-work.html` — Пре-ворк (`data-doc="ai-qa-pw"`)
- `t1-qa-pipeline.html` — Тема 1 (оригінальний лонгрід + 3 рядки підключення шару рецензування перед `</body>`)
- `t2-jira-task-context.html` — Тема 2 (те саме, `data-doc="ai-qa-t2"`)
- `t3-requirements-grooming.html` — Тема 3 (те саме, `data-doc="ai-qa-t3"`)
- `t4-qa-checklist.html` — Тема 4 (те саме, `data-doc="ai-qa-t4"`)
- `t5-qa-test-cases.html` — Тема 5 (те саме, `data-doc="ai-qa-t5"`)
- `review/review.js`, `review/review.css` — шар рецензування (спільний для всіх тем)
- `review/config.js` — URL і publishable-ключ Supabase
- `supabase/schema.sql` — таблиці та RPC-функції (запустити один раз у SQL Editor)

## Нова тема
Додати перед `</body>`:
```html
<link rel="stylesheet" href="review/review.css"><script src="review/config.js"></script><script src="review/review.js" data-doc="ai-qa-t2"></script>
```
`data-doc` — унікальний ID теми, за ним групуються коментарі.

## Доступ
Посилання для експерта: `…/t1-qa-pipeline.html?k=<ключ рецензента>` — ключ запам'ятовується в браузері й прибирається з адресного рядка.
Ключі зберігаються лише в таблиці `qa_keys` у базі, не в репозиторії. Роль `admin` може редагувати й видаляти будь-які коментарі.

Valentyna Hordiienko · Middle Learning Architect
