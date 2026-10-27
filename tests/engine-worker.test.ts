// Тесты контракта off-thread расчётов (Фаза 2.1): детерминизм worker-ядра
// относительно main-thread evaluateLink, эквивалентность deriveProfileMulti
// и структурная клонируемость результатов протокола.

import { describe, expect, it } from "vitest";
import {
  type RadioParams,
  buildLinkResult,
  buildProfileRaw,
  deriveProfile,
  deriveProfileMulti,
  evaluateLink,
  pathGeometry,
} from "@/lib/radio/engine";
import { parseHgt, type HgtTileMap } from "@/lib/radio/hgt";
import { DEFAULT_HELMERT_SK42_WGS84 } from "@/lib/radio/sk42";
import { makeFlatTile, tileMap } from "./helpers/fixtures";
import type { EngineDone, LinkInput } from "@/lib/radio/engine-protocol";

const params: RadioParams = {
  fMHz: 433,
  pTxDbm: 37,
  txGainDbi: 6,
  rxGainDbi: 6,
  txFeederDb: 1,
  rxFeederDb: 1,
  extraLossDb: 0,
  txAntHM: 10,
  rxAntHM: 10,
  sensitivityDbm: -101,
  fadeMarginDb: 10,
  kFactor: 4 / 3,
  helm: DEFAULT_HELMERT_SK42_WGS84,
};

const TX = { B: 47.3, L: 39.3 };
const RX = { B: 47.3, L: 39.6 };

/** Реплика computeLink из engine-worker.ts (тот же код ядра, тот же порядок). */
function workerComputeLink(input: LinkInput, tiles: HgtTileMap) {
  const D = input.geom.distanceM;
  if (D < 1) throw new Error("Точки ПРД и ПРМ совпадают");
  if (D > 1000_000) throw new Error("Дальность более 1000 км — модель неприменима");
  const step = Math.max(25, D / 400);
  const nPts = Math.min(500, Math.max(30, Math.ceil(D / step)));
  const raw = buildProfileRaw(
    tiles,
    input.geom.txWgs,
    (input.geom.fwdAzDeg * Math.PI) / 180,
    D,
    nPts,
    input.params.kFactor,
    !!input.params.useSynthetic
  );
  const freqs = input.freqsMHz.length > 0 ? input.freqsMHz : [input.params.fMHz];
  const profiles = deriveProfileMulti(
    raw,
    raw.txTerrainM + input.params.txAntHM,
    raw.rxTerrainM + input.params.rxAntHM,
    freqs
  );
  return profiles.map((pts, i) => {
    const p: RadioParams = { ...input.params, fMHz: freqs[i] };
    return buildLinkResult(input.geom, p, raw, pts);
  });
}

describe("deriveProfileMulti ≡ deriveProfile (детерминизм)", () => {
  const tiles = tileMap([makeFlatTile(47, 39, 100), makeFlatTile(47, 40, 100)]);
  const geom = pathGeometry(TX, RX, params.helm);

  it("профиль multi идентичен одиночному по всем полям", () => {
    const D = geom.distanceM;
    const step = Math.max(25, D / 400);
    const nPts = Math.min(500, Math.max(30, Math.ceil(D / step)));
    const raw = buildProfileRaw(
      tiles,
      geom.txWgs,
      (geom.fwdAzDeg * Math.PI) / 180,
      D,
      nPts,
      params.kFactor,
      false
    );
    const h1 = raw.txTerrainM + params.txAntHM;
    const h2 = raw.rxTerrainM + params.rxAntHM;
    const single = deriveProfile(raw, h1, h2, params.fMHz);
    const [multi] = deriveProfileMulti(raw, h1, h2, [params.fMHz]);
    expect(multi).toEqual(single);
  });

  it("несколько частот дают разные r1/v при одинаковом рельефе", () => {
    const D = geom.distanceM;
    const raw = buildProfileRaw(
      tiles,
      geom.txWgs,
      (geom.fwdAzDeg * Math.PI) / 180,
      D,
      100,
      params.kFactor,
      false
    );
    const h1 = raw.txTerrainM + params.txAntHM;
    const h2 = raw.rxTerrainM + params.rxAntHM;
    const [lo, hi] = deriveProfileMulti(raw, h1, h2, [150, 900]);
    // радиус Френеля обратно пропорционален √f: на 150 МГц r1 больше
    expect(lo[50].r1).toBeGreaterThan(hi[50].r1);
    // знак v = (hc − los)·√2/r1 (этап 1): при hc < los |v| тем больше, чем
    // меньше r1 (высокая частота «сильнее» видит то же углубление под LOS)
    expect(Math.abs(lo[50].v)).toBeLessThan(Math.abs(hi[50].v));
  });
});

describe("worker-ядро ≡ evaluateLink (main thread)", () => {
  const tiles = tileMap([makeFlatTile(47, 39, 100), makeFlatTile(47, 40, 100)]);
  const geom = pathGeometry(TX, RX, params.helm);

  it("LinkResult побитово совпадает", () => {
    const direct = evaluateLink(tiles, geom, params);
    const viaWorker = workerComputeLink(
      {
        tiles: [],
        geom,
        tx: TX,
        rx: RX,
        freqsMHz: [],
        params,
      },
      tiles
    )[0];
    expect(viaWorker).toStrictEqual(direct);
  });

  it("частотный набор даёт результаты, равные последовательному evaluateLink", () => {
    const freqs = [150, 433, 900];
    const viaWorker = workerComputeLink(
      { tiles: [], geom, tx: TX, rx: RX, freqsMHz: freqs, params },
      tiles
    );
    viaWorker.forEach((r, i) => {
      const direct = evaluateLink(tiles, geom, { ...params, fMHz: freqs[i] });
      expect(r).toStrictEqual(direct);
    });
  });
});

describe("структурная клонируемость результатов (контракт протокола)", () => {
  const tiles = tileMap([makeFlatTile(47, 39, 100), makeFlatTile(47, 40, 100)]);
  const geom = pathGeometry(TX, RX, params.helm);

  it("EngineDone проходит structuredClone без потерь", () => {
    const byFreq = workerComputeLink(
      { tiles: [], geom, tx: TX, rx: RX, freqsMHz: [433, 900], params },
      tiles
    );
    const done: EngineDone = { kind: "link", id: 1, output: { byFreq } };
    const copy = structuredClone(done);
    expect(copy).toStrictEqual(done);
  });

  it("тайлы восстанавливаются из ArrayBuffer (round-trip как через transfer list)", () => {
    const src = makeFlatTile(47, 39, 100);
    const buf = new Int16Array(src.data.length);
    for (let i = 0; i < src.data.length; i++) buf[i] = src.data[i];
    const be = new ArrayBuffer(buf.length * 2);
    const dv = new DataView(be);
    for (let i = 0; i < buf.length; i++) dv.setInt16(i * 2, buf[i], false);
    const parsed = parseHgt(`${src.name}.hgt`, be);
    expect(parsed.data).toEqual(src.data);
    expect(parsed.latTop).toBe(src.latTop);
    expect(parsed.lonLeft).toBe(src.lonLeft);
  });
});
