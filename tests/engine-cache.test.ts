// Тесты LRU-кеша и terrain-hash (Фаза 2.2).

import { beforeEach, describe, expect, it } from "vitest";
import {
  LruCache,
  clearEngineCache,
  hashInt16,
  terrainHash,
} from "@/lib/radio/engine-cache";
import { makeFlatTile, tileMap } from "./helpers/fixtures";

describe("hashInt16", () => {
  it("детерминирован для одинаковых данных", () => {
    const a = new Int16Array([5, -3, 0, 100]);
    const b = new Int16Array([5, -3, 0, 100]);
    expect(hashInt16(a)).toBe(hashInt16(b));
  });

  it("чувствителен к изменению любого элемента", () => {
    const a = new Int16Array([5, -3, 0, 100]);
    const b = new Int16Array([5, -3, 1, 100]);
    expect(hashInt16(a)).not.toBe(hashInt16(b));
  });

  it("пустой массив даёт стабильный хеш", () => {
    expect(hashInt16(new Int16Array(0))).toBe(hashInt16(new Int16Array(0)));
  });
});

describe("terrainHash", () => {
  it("одинаковые карты дают одинаковый хеш", () => {
    const t1 = tileMap([makeFlatTile(47, 39, 10)]);
    const t2 = tileMap([makeFlatTile(47, 39, 10)]);
    expect(terrainHash(t1, false)).toBe(terrainHash(t2, false));
  });

  it("разная высота тайла меняет хеш", () => {
    const t1 = tileMap([makeFlatTile(47, 39, 10)]);
    const t2 = tileMap([makeFlatTile(47, 39, 20)]);
    expect(terrainHash(t1, false)).not.toBe(terrainHash(t2, false));
  });

  it("порядок вставки тайлов не влияет на хеш", () => {
    const t1 = tileMap([makeFlatTile(47, 39, 10), makeFlatTile(47, 40, 30)]);
    const t2 = tileMap([makeFlatTile(47, 40, 30), makeFlatTile(47, 39, 10)]);
    expect(terrainHash(t1, false)).toBe(terrainHash(t2, false));
  });

  it("флаг synthetic различает пустые карты", () => {
    expect(terrainHash(tileMap([]), true)).not.toBe(
      terrainHash(tileMap([]), false)
    );
  });
});

describe("LruCache", () => {
  it("get/set/hit", () => {
    const c = new LruCache<number>(3);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.get("zzz")).toBeUndefined();
  });

  it("вытесняет самый старый при переполнении", () => {
    const c = new LruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // вытесняет "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("get обновляет свежесть записи", () => {
    const c = new LruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // "a" снова свежий, "b" — самый старый
    c.set("cc", 3); // вытесняет "b"
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
  });

  it("clear обнуляет кеш", () => {
    const c = new LruCache<number>(5);
    c.set("a", 1);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });
});

describe("clearEngineCache", () => {
  beforeEach(() => clearEngineCache());

  it("не бросает исключений и идемпотентен", () => {
    clearEngineCache();
    clearEngineCache();
    expect(true).toBe(true);
  });
});
