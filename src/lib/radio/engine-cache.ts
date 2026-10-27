// Кеширование результатов тяжёлых расчётов (Фаза 2, задача 2.2).
// LRU-кеш с ключом из параметров задачи + terrain-hash загруженных DEM-тайлов.
// Инвалидация: при изменении набора тайлов меняется hash → все прежние
// ключи автоматически становятся промахами; дополнительно clearEngineCache()
// вызывается при загрузке/выгрузке тайлов и в тестах (beforeEach).

import type { HgtTileMap } from "./hgt";

// 32-битный FNV-1a (compat: target ES2017 запрещает BigInt-литералы).
// Для ключа кеша достаточно комбинировать два независимых 32-битных свода.
const FNV_OFF = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnvMix(h: number, byte: number): number {
  h ^= byte & 0xff;
  return Math.imul(h, FNV_PRIME) >>> 0;
}

/** Детерминированный хеш по Int16Array (без аллокаций на элемент). */
export function hashInt16(data: Int16Array): string {
  let a = FNV_OFF;
  let b = FNV_OFF ^ 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    a = fnvMix(fnvMix(a, v & 0xff), (v >>> 8) & 0xff);
    b = fnvMix(fnvMix(b, (v >>> 8) & 0xff), v & 0xff);
  }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0"));
}

/**
 * Хеш рельефа: имена тайлов + хеши их данных. Синтез-режим учитывается,
 * чтобы «пустые» карты с разными флагами не имели общих ключей.
 */
export function terrainHash(tiles: HgtTileMap, useSynthetic: boolean): string {
  const names = [...tiles.keys()].sort();
  let acc = FNV_OFF;
  for (const n of names) {
    const t = tiles.get(n)!;
    for (let i = 0; i < n.length; i++) {
      acc = fnvMix(acc, n.charCodeAt(i));
    }
    // данные неизменяемы после parseHgt — сводим полный хеш тайла
    const dh = hashInt16(t.data);
    for (let i = 0; i < dh.length; i++) {
      acc = fnvMix(acc, dh.charCodeAt(i));
    }
  }
  if (useSynthetic) {
    acc = fnvMix(acc, 0x73);
    acc = fnvMix(acc, 0x53); // маркер synth-режима
  }
  return acc.toString(16).padStart(8, "0");
}

export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // refresh recency
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const MAX_ENTRIES = 64;

const linkCache = new LruCache<unknown>(MAX_ENTRIES);
const coverageCache = new LruCache<unknown>(MAX_ENTRIES);
const verticalCache = new LruCache<unknown>(MAX_ENTRIES);
const trajectoryCache = new LruCache<unknown>(8);

export function cacheGetLink(key: string): unknown {
  return linkCache.get(key);
}
export function cacheSetLink(key: string, v: unknown): void {
  linkCache.set(key, v);
}
export function cacheGetCoverage(key: string): unknown {
  return coverageCache.get(key);
}
export function cacheSetCoverage(key: string, v: unknown): void {
  coverageCache.set(key, v);
}
export function cacheGetVertical(key: string): unknown {
  return verticalCache.get(key);
}
export function cacheSetVertical(key: string, v: unknown): void {
  verticalCache.set(key, v);
}
export function cacheGetTrajectory(key: string): unknown {
  return trajectoryCache.get(key);
}
export function cacheSetTrajectory(key: string, v: unknown): void {
  trajectoryCache.set(key, v);
}

/** Полная очистка всех кешей (тесты, загрузка/выгрузка тайлов). */
export function clearEngineCache(): void {
  linkCache.clear();
  coverageCache.clear();
  verticalCache.clear();
  trajectoryCache.clear();
}
