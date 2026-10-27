// Клиент автозагрузки DEM-тайлов через /api/dem/{name}.hgt (Фаза 3.1).
// Отделяется от store, чтобы логику можно было тестировать с mock fetch.

import { parseHgt, type HgtTile } from "./hgt";

export class DemLoadError extends Error {}

/**
 * Загрузить один тайл по имени («N47E039»). Бросает DemLoadError с
 * человекочитаемым сообщением при любой сетевой/форматной ошибке.
 */
export async function fetchDemTile(
  name: string,
  signal?: AbortSignal
): Promise<HgtTile> {
  let resp: Response;
  try {
    resp = await fetch(`/api/dem/${encodeURIComponent(name)}.hgt`, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new DemLoadError(`Сеть недоступна: ${name}`);
  }
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const j = (await resp.json()) as { error?: string };
      if (j?.error) detail += `: ${j.error}`;
    } catch {
      /* тело не JSON — оставляем статус */
    }
    throw new DemLoadError(`${name}: ${detail}`);
  }
  const buffer = await resp.arrayBuffer();
  try {
    return parseHgt(`${name}.hgt`, buffer);
  } catch (e) {
    throw new DemLoadError(
      `${name}: ${e instanceof Error ? e.message : "битый HGT"}`
    );
  }
}

/**
 * Параллельная загрузка списка имён с ограничением одновременности и
 * дедупликацией. Возвращает найденные тайлы и ошибки по именам.
 */
export async function fetchDemTiles(
  names: string[],
  concurrency = 3,
  signal?: AbortSignal
): Promise<{ tiles: HgtTile[]; errors: string[] }> {
  const unique = Array.from(new Set(names));
  const tiles: HgtTile[] = [];
  const errors: string[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, unique.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < unique.length) {
      const idx = cursor++;
      const name = unique[idx];
      try {
        tiles.push(await fetchDemTile(name, signal));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        errors.push(e instanceof Error ? e.message : `${name}: ошибка загрузки`);
      }
    }
  });
  await Promise.all(workers);
  return { tiles, errors };
}
