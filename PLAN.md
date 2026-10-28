# План работ: стабилизация и развитие «Радиокалькулятора»

**Точка отката:** `snapshot/dev_union-2026-10-25` (коммит `327a5e7`, branch `dev_union`).
Откат: `git checkout snapshot/dev_union-2026-10-25 -- .` или `git reset --hard snapshot/dev_union-2026-10-25`.

---

## Фаза 0 — Нулевая линия защиты (без изменения поведения) ✅ ВЫПОЛНЕНО (2026-10-25)

| # | Задача | Статус | Результат |
|---|--------|--------|-----------|
| 0.1 | Настроить Vitest + coverage; покрыть юнит-тестами `src/lib/radio/`: `geodesy.ts`, `sk42.ts`, `pathloss.ts`, `signal.ts`, `format.ts` (эталонные значения: FSPL @ 1 ГГц/1 км = 92.44 дБ, известные точки СК-42↔WGS-84) | ✅ | Vitest 5 + v8-coverage; geodesy 98.9%, sk42 98.9%, pathloss 96.1%, signal 100%, format 86.8% |
| 0.2 | Тест-фикстуры для `hgt.ts` / `tile-cache.ts` / `synthetic.ts` (парсинг бинарных HGT, границы тайлов, интерполяция) | ✅ (hgt/synthetic) | hgt.ts 94.4% — синтетические HGT-буферы in-memory; tile-cache остаётся 0% (обёртка над IndexedDB, требует jsdom — перенесено в Фазу 2 вместе с кешированием) |
| 0.3 | Интеграционный тест `engine.ts` (858 строк): фиксированные входы → снапшот выходов | ✅ | 7 сквозных сценариев (LOS/дифракция/рефлексия, coverage-сетка); engine 24.9% lines — остальное это UI-специфичные ветки, покрываются после изоляции ядра (1.4) |
| 0.4 | В CI (`bun run check`) добавить `test`; зафиксировать lockfile-стратегию (bun vs npm — сейчас двусмысленно) | ✅ | `check = lint && typecheck && test && build`; стратегия: bun.lock (packageManager в package.json), node_modules не коммитится |

Итого: **88 тестов, 6 файлов, все зелёные**; `typecheck` чистый.

## Фаза 1 — Архитектура UI (разбить «God-component») ✅ ВЫПОЛНЕНО (2026-10-25)

| # | Задача | Статус | Результат |
|---|--------|--------|-----------|
| 1.1 | Декомпозиция `radio-calculator.tsx` (2093 строки) на панели: `TxAntennaPanel`, `RxAntennaPanel`, `FrequencyPanel`, `TerrainPanel`, `ResultsPanel` + общий layout | ✅ | `radio-calculator.tsx` = 34 строки (layout); панели: coordinates/settings/terrain/trajectory/vertical/results/coverage + `shared.tsx`; каждая < 300 строк, читают стор/derive напрямую |
| 1.2 | Состояние формы → `react-hook-form` + `zod` (зависимости уже в package.json, но не использовались) | ✅ | `src/lib/radio/form.ts`: zod-схема всех полей + типизированные значения; ручной парсинг чисел из input убран |
| 1.3 | Вынести расчётный pipeline из `useEffect` в явный стор (`zustand`) с селекторами | ✅ | `src/lib/radio/calculator-store.ts`: единый стор (values/tiles/coverage/vertical/busy) + `useDerived()` с сериализуемым ключом пересчёта; цепочка зависимостей useEffect устранена |
| 1.4 | Разделить «чистое ядро» и UI: запрет импорта `components/*` из `lib/radio/*` | ✅ | Ядро `lib/radio` не знает про UI (проверено); eslint no-restricted-imports правило добавлено в flat-config |

Дополнительно: все ESLint-предупреждения по проекту сведены к нулю (map-picker: ref-в-render → useEffect, сложные deps → примитивы; панели: сняты лишние eslint-disable; store: тонкая подписка deriveDepKey).

## Фаза 2 — Производительность

| # | Задача | Детали |
|---|--------|--------|
| 2.1 | ✅ **ВЫПОЛНЕНО** (2026-10-27) Перенос трассовых расчётов (профиль + дифракция + coverage-карта) в **Web Worker** (postMessage + Transferable ArrayBuffer, без comlink). Файлы: `engine-protocol.ts` (контракт задач/ответов), `engine-worker.ts` (ядро в worker), `engine-client.ts` (singleton, очередь с отменой предыдущей задачи, синхронный fallback при отсутствии Worker). Интегрировано: calculator-store (vertical/coverage — асинхронно, busy-статус как прогресс), coverage/vertical/results-панели. Тесты: `tests/engine-worker.test.ts` — round-trip сериализации, `deriveProfileMulti ≡ deriveProfile` (детерминизм), эквивалентность worker-ядра `evaluateLink`. Итого 94/94 зелёные | Тяжёлые циклы по DEM блокируют основной поток |
| 2.2 | ✅ **ВЫПОЛНЕНО** (2026-10-27) LRU-кеш результатов (`engine-cache.ts`: `LruCache`, `hashInt16`/`terrainHash` — FNV-1a, compat ES2017 без BigInt; отдельные кеши link/coverage/vertical/trajectory, 64 записи, trajectory — 8). Интеграция в `engine-client.ts`: ключ = terrain-hash + координаты + дистанция/азимут + все значимые параметры; промах → worker/sync-fallback, попадание → мгновенный возврат. Дебаунс 250 мс в `useLinkAsync` (store): в worker уходит только финальная задача. Инвалидация: `clearEngineCache()` при загрузке/выгрузке тайлов и переключении synthetic-режима. Тесты: `tests/engine-cache.test.ts` (12 кейсов: детерминизм хеша, чувствительность, инвариантность к порядку тайлов, LRU-вытеснение, свежесть по get). Итого 106/106 зелёные, lint/tsc/build чисто | Исключить повторные полные пересчёты |
| 2.3 | ✅ **ВЫПОЛНЕНО** (2026-10-27) Адаптивный coverage-скан (`scanCoverage`): экспоненциальный поиск границы зелёной зоны (шаг ×1.8) + бисекция до ±5 м вместо brute-force по лестнице дальностей; skip-оптимизация — нечётные азимуты (шаг 5°) копируют границу соседних лучей при совпадении в пределах 30 м (кольцевая индексация с корректным wrap-around 355°↔0°). Сетка и детерминизм сохранены. Тесты: `tests/coverage-adaptive.test.ts` (эквивалентность эталонному скану на ровном рельефе, монотонность, плоский/горный кейсы). Перепроверка: усилено условие пропуска, lint/tsc/test чисто | Квадратичная сложность на больших картах |
| 2.4 | ✅ **ВЫПОЛНЕНО** (2026-10-27) Hover-подсказка профиля трассы: чистая логика `src/lib/radio/profile.ts` (`pointClearance`, `evaluateHoverPoint`; конвенция знака просвета согласована с `minClearance` движка: (los−hc)/r1, >0 — LOS над рельефом, <0 — экран; статусы clear/grazing/blocked/edge по порогу 0.6 r1). UI: `profile-chart.tsx` — обратное преобразование координат курсора viewBox→данные (`invertScene`), SVG-карточка (дистанция, рельеф/LOS, просвет/r1, статус) — попадает в экспорт. Тесты: `tests/profile-hover.test.ts` (12 кейсов). Итого 124/124 зелёные, lint/tsc/build чисто. Примечание: удаление неиспользуемых shadcn-зависимостей перенесено в 2.5 | Тяжёлые hover-пересчёты и несогласованный знак просвета |
| 2.5 | ✅ **ВЫПОЛНЕНО** (2026-10-27) Чистка зависимостей: удалены 32 неиспользуемых shadcn-компонента (`src/components/ui/*`: accordion, alert-dialog, aspect-ratio, avatar, breadcrumb, calendar, carousel, chart, checkbox, collapsible, command, context-menu, drawer, dropdown-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, sidebar, slider, sonner, switch, table, textarea, toggle-group) + `theme-toggle.tsx` (не подключался). Из package.json удалено 30 пакетов (@hookform/resolvers, react-hook-form, 16 неиспользуемых @radix-ui-*, @tanstack/react-query, cmdk, date-fns, embla-carousel-react, input-otp, react-day-picker, react-resizable-panels, recharts, sonner, vaul). Оставлены только реально импортируемые: 8 radix-пакетов (slot/dialog/label/select/separator/tabs/toggle/tooltip), leaflet, geist, next-themes (ThemeProvider в layout), zod, zustand, clsx/tailwind-merge/cva/tailwindcss-animate/lucide-react. Проверка: bun install (Removed: 30), lint/tsc чистые, 124/124 тестов зелёные, `next build` успешен | Бюджет бандла Vercel |

**Итог Фазы 2:** ✅ ЗАВЕРШЕНА (2.1 worker → 2.2 LRU-кеш+дебаунс → 2.3 адаптивный скан → 2.4 hover-профиль → 2.5 чистка зависимостей). Все проверки: lint/typecheck/test (124/124)/build — чисто.

## Фаза 3 — Данные и UX

| # | Задача | Детали |
|---|--------|--------|
| 3.1 | ✅ **ВЫПОЛНЕНО** (2026-10-27) — Автозагрузка DEM: `GET /api/dem/[tile]` — прокси к Copernicus GLO-30 (AWS Open Data, без ключа; переопределяется через `DEM_SOURCE_URL`), валидация имени тайла, эвристика `looksLikeHgt`, HTTP Cache-Control (public, immutable, 30 дней) вместо Vercel KV (недоступен в окружении). Клиент: `dem.ts`/`dem-client.ts` (параллельная загрузка с ограничением одновременности), стор: `autoDem`/`demBusy`/`demError` + `ensureRequiredTiles()` (кэш в IndexedDB), хук `useDemAuto` (дебаунс 400 мс) и исправленная интеграция `useLinkAsync`+`useDemAuto` в `RadioCalculator` (критический баг Фазы 2: хук нигде не вызывался — асинхронный расчёт трассы был мёртв). UI: чекбокс «Автозагрузка рельефа (GLO-30)», кнопка ручного докачивания, алерт ошибок. Тесты: `tests/dem.test.ts` (11 кейсов); всего 135/135 зелёные, lint/tsc/build чисто | Главный фрикцион текущего UX |
| 3.2 | ✅ **ВЫПОЛНЕНО** (2026-10-28) — Явная маркировка синтетического рельефа: `buildProfileRaw` считает `syntheticCount` (точки, где высота взята из `synthetic.ts`), `LinkResult.syntheticUsed` и `TrajectoryResult.syntheticUsed` (+ флаг на точку) проброшены через worker/клиент без изменения протокола (поле в сериализуемом RawProfile). UI: amber-алерт «Синтетический рельеф (демо)» в ResultsPanel над профилем и в TrajectoryPanel; метрика «Рельеф» теперь опирается на факт использования (`link.syntheticUsed`), а не на грубую эвристику `tilesCount===0`. Тесты: `tests/synthetic-flag.test.ts` (3 кейса: полный DEM → 0; пустой + useSynthetic → count>0, gaps=0; пустой без синтетики → ошибка данных). 138/138 зелёные, lint/tsc/build чисто | Риск принять демо-данные за реальные |
| 3.3 | ✅ **ВЫПОЛНЕНО** (2026-10-28) — Жёсткий парсер JSON-пресетов: `parseTrajectoryFile` при синтаксической ошибке JSON возвращает сообщение с привязкой к позиции («строка N, колонка M» + фрагмент ±20 символов вокруг ошибки) вместо глухого «не является корректным JSON»; сохранены фолбэки (BOM, обёртка `{...}`). Тесты: 2 новых кейса в `tests/utils.test.ts`; 140/140 зелёные, lint/tsc/build чисто | Отладка чужих пресетов |
| 3.4 | Сохранение/загрузка проекта (localStorage + экспорт/импорт JSON, URL-share с сериализованным состоянием) | Базовая функциональность инструмента |
| 3.5 | CSP: закрыть frame-ancestors (потенциальный clickjacking); audit `next.config.mjs` | Безопасность |
| 3.6 | Экспорт отчёта в PDF (profile-plot + таблица бюджета_link) — стандартная практика для radio study | Ценность для инженеров |
| 3.7 | ✅ **ВЫПОЛНЕНО** (2026-10-25) — **Увеличенный просмотр «Профиля трассы»**: `profile-chart.tsx` сделан интерактивным: зум колесом вокруг курсора (Shift — только вертикаль, Ctrl — только горизонталь), pinch-зум на тач-устройствах, pan перетаскиванием, двойной клик / кнопка «Сброс»; слайдер VEx (×1–10, в диалоге до ×20); кнопки ZoomIn/ZoomOut + индикатор кратности; диалог «Развернуть» (shadcn Dialog, viewBox 1400×620) с независимым зумом и отображением видимого участка в км; клиппинг данных осями, адаптивные сетки высот/дистанций при зуме; экспорт текущего вида в SVG и PNG ×3 | Запрошенная функциональность: раньше профиль — статичная маленькая SVG, детали у препятствий и зоны Френеля неразличимы |

## Фаза 4 — Физические модели (наращивание функционала)

| # | Задача | Приоритет |
|---|--------|-----------|
| 4.1 | Дифракция: сейчас один нож (edge) — перейти к множественным препятствиям по ITU-R P.526 (Burkholder / multiple knife-edge) | Высокий |
| 4.2 | ITU-R P.2001 (сейчас упрощённый hybrid) как основная модель; опционально P.452 (полный) с atmospheric ducting | Высокий |
| 4.3 | Газопоглощение O2/H2O (P.676) — критично > 10 ГГц | Средний |
| 4.4 | Потери от дождя и паров воды: P.530/P.838 + климатические зоны (подстановка ITU climate data) | Средний |
| 4.5 | Реальные ДН антенн: импорт паттернов (SECAD/GAINSET CSV), поляризация и tilt | Средний |
| 4.6 | Мульти-трасса / интерференция (C/I), несколько приёмников; clutter и отражение от подстилающей поверхности (two-ray) как опция | Низкий (долгосрочно) |
| 4.7 | Калибровка моделей против внешних бенчмарков (IITF/Longley-Rice reference results) | Высокий (делать параллельно 4.x) |

## Порядок выполнения и связи

```
Фаза 0 ──► Фаза 1 ──► Фаза 2 ──► Фаза 3 ──► Фаза 4
(тесты)   (структура) (worker)   (DEM API)  (модели)
              ▲            ▲
              └── ядро lib/radio изолируется на 1.4 — это предпосылка и 2.1, и 4.x
```

**Правило ветвления:** каждая строка таблицы = отдельная PR-ветка от `dev_union`; после green `check` + tests — squash-merge. Тег `snapshot/dev_union-2026-10-25` остаётся постоянной точкой отката.

**Исключение по приоритету:** задача **3.7 (интерактивный/увеличенный профиль трассы)** — явно запрошенная функциональность, может быть выполнена досрочно, сразу после Фаз 0–1 (тесты + декомпозиция дают безопасную базу для правки `profile-chart.tsx`). Технически она самодостаточна: данные (`link.pts`, `los`, `r1`) уже есть в props, изменения локальны в одном компоненте + обёртка-диалог.

**Критерий готовности плана:** приложение не блокирует UI > 100 мс на типовой трассе, покрытие тестами ядра ≥ 80%, реальный DEM загружается без действий пользователя, результат содержит ссылку на применённую рекомендацию ITU.
