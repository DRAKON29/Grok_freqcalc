// Тесты автозагрузки DEM (Фаза 3.1): валидация имён, URL источника,
// эвристика HGT, клиент fetchDemTiles с mock-фетчем.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEM_AUTO_ARCSEC,
  looksLikeHgt,
  normalizeTileName,
  upstreamUrl,
} from "@/lib/radio/dem";
import { fetchDemTiles } from "@/lib/radio/dem-client";

/** Буфер корректного «фиктивного» HGT side×side, Int16 big-endian. */
function hgtBuffer(side: number, value = 100): ArrayBuffer {
  const buf = new ArrayBuffer(side * side * 2);
  const view = new DataView(buf);
  for (let i = 0; i < side * side; i++) view.setInt16(i * 2, value, false);
  return buf;
}

describe("normalizeTileName", () => {
  it("принимает каноническое имя и .hgt-суффикс", () => {
    expect(normalizeTileName("N47E039")).toBe("N47E039");
    expect(normalizeTileName("n47e039.hgt")).toBe("N47E039");
    expect(normalizeTileName(" S55W003.HGT ")).toBe("S55W003");
  });

  it("отвергает мусор", () => {
    expect(normalizeTileName("N4E039")).toBeNull();
    expect(normalizeTileName("X47E039")).toBeNull();
    expect(normalizeTileName("../../etc/passwd")).toBeNull();
    expect(normalizeTileName("")).toBeNull();
  });
});

describe("upstreamUrl", () => {
  it("подставляет имя в шаблон по умолчанию", () => {
    const url = upstreamUrl("N47E039");
    expect(url).toContain("N47E039");
    expect(url.startsWith("https://")).toBe(true);
  });

  it("уважает пользовательский шаблон", () => {
    expect(upstreamUrl("N47E039", "https://x/{name}.hgt?v=2")).toBe(
      "https://x/N47E039.hgt?v=2"
    );
  });

  it("DEV-тест: не содержит секретов/ключей в дефолтном шаблоне", () => {
    expect(DEM_AUTO_ARCSEC).toBeGreaterThan(0);
    expect(/key=|token=|secret/i.test(upstreamUrl("N47E039"))).toBe(false);
  });
});

describe("looksLikeHgt", () => {
  it("пропускает квадратный Int16-буфер с правдоподобными высотами", () => {
    expect(looksLikeHgt(hgtBuffer(121))).toBe(true);
    expect(looksLikeHgt(hgtBuffer(121, -32768))).toBe(true); // void-тайл
  });

  it("отклоняет HTML-страницу ошибки и битый размер", () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html>404</html>")
      .buffer as ArrayBuffer;
    expect(looksLikeHgt(html)).toBe(false);
    expect(looksLikeHgt(new ArrayBuffer(100))).toBe(false);
    expect(looksLikeHgt(new ArrayBuffer(0))).toBe(false);
  });

  it("отклоняет мусор вне диапазона высот", () => {
    const buf = hgtBuffer(121, 0);
    const view = new DataView(buf);
    for (let i = 0; i < 121 * 121; i++) view.setInt16(i * 2, 20000, false);
    expect(looksLikeHgt(buf)).toBe(false);
  });
});

describe("fetchDemTiles (mock fetch)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("возвращает распарсенные тайлы при успехе", async () => {
    const body = hgtBuffer(3, 123);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(body, { status: 200, headers: { "Content-Type": "application/octet-stream" } })
      )
    );
    const { tiles, errors } = await fetchDemTiles(["N47E039"]);
    expect(errors).toEqual([]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].name).toBe("N47E039");
    expect(tiles[0].data[0]).toBe(123);
  });

  it("дедуплицирует имена и собирает ошибки по именам", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("N47E039")) return new Response(hgtBuffer(3), { status: 200 });
        return new Response(JSON.stringify({ error: "нет тайла" }), { status: 404 });
      })
    );
    const { tiles, errors } = await fetchDemTiles([
      "N47E039",
      "N47E039",
      "N48E039",
    ]);
    expect(tiles).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("N48E039");
    expect(errors[0]).toContain("HTTP 404");
  });

  it("не зависает на пустом списке", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const { tiles, errors } = await fetchDemTiles([]);
    expect(tiles).toEqual([]);
    expect(errors).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
