// Файлы рельефа SRTM (.hgt): бинарные матрицы Int16 (big-endian), без заголовка.
// 1201×1201 — шаг 3″, 3601×3601 — шаг 1″. Имя тайла — его юго-западный угол:
// «N47E039» покрывает 47…48° с.ш., 39…40° в.д. Строка 0 — северная кромка,
// столбец 0 — западная. Значение −32768 — пустота (void).

export interface HgtTile {
  name: string; // «N47E039»
  latTop: number; // широта северной кромки (именованная широта + 1°)
  lonLeft: number; // долгота западной кромки (именованная долгота)
  size: number; // сторона матрицы (1201/3601)
  step: number; // угловой шаг, градусы
  arcSec: number; // разрешение в угловых секундах
  data: Int16Array; // построчно, с севера
  bytes: number;
}

export type HgtTileMap = Map<string, HgtTile>;

export const HGT_NO_DATA = -32768;

const NAME_RE = /^([NS])(\d{2})([EW])(\d{3})$/;

export interface HgtTileRef {
  latTop: number;
  lonLeft: number;
  name: string;
}

/**
 * Разбор имени файла «N47E039.hgt» → покрытие тайла.
 * Имя задаёт юго-западный угол: тайл тянется на 1° на север и восток от него.
 */
export function parseHgtFileName(
  fileName: string
): HgtTileRef | null {
  const base = fileName.trim().toUpperCase().replace(/\.HGT$/i, "");
  const m = NAME_RE.exec(base);
  if (!m) return null;
  const latDeg = Number(m[2]);
  const lonDeg = Number(m[4]);
  const latTop = latDeg + 1; // северная кромка (юго-западный угол + 1°)
  const lonLeft = m[3] === "E" ? lonDeg : -lonDeg;
  return { latTop, lonLeft, name: base };
}

/** Имя тайла, покрывающего точку. */
export function tileKeyAt(lat: number, lon: number): string {
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const latHem = latFloor >= 0 ? "N" : "S";
  const lonHem = lonFloor >= 0 ? "E" : "W";
  const la = Math.abs(latFloor);
  const lo = Math.abs(lonFloor);
  const latS = la < 10 ? `0${la}` : String(la);
  const lonS = lo < 10 ? `00${lo}` : lo < 100 ? `0${lo}` : String(lo);
  return `${latHem}${latS}${lonHem}${lonS}`;
}

/**
 * Разбор содержимого .hgt. Имя файла определяет покрытие тайла.
 * Байтовый порядок — big-endian.
 */
export function parseHgt(fileName: string, buffer: ArrayBuffer): HgtTile {
  const ref = parseHgtFileName(fileName);
  if (!ref) {
    throw new Error(
      `Имя файла «${fileName}» не соответствует формату HGT (пример: N47E039.hgt)`
    );
  }
  const bytes = buffer.byteLength;
  const side = Math.round(Math.sqrt(bytes / 2));
  if (side < 2 || side * side * 2 !== bytes) {
    throw new Error(
      `Размер файла «${fileName}» (${bytes} байт) не соответствует матрице HGT`
    );
  }
  const arcSec = Math.round(3600 / (side - 1));
  const view = new DataView(buffer);
  const data = new Int16Array(side * side);
  for (let i = 0; i < data.length; i++) {
    data[i] = view.getInt16(i * 2, false);
  }
  return {
    name: ref.name,
    latTop: ref.latTop,
    lonLeft: ref.lonLeft,
    size: side,
    step: 1 / (side - 1),
    arcSec,
    data,
    bytes,
  };
}

/**
 * Высота (м над уровнем моря) в точке WGS-84. Билинейная интерполяция;
 * при пустотах — ближайший корректный узел. null — данных нет.
 */
export function sampleHeight(
  tiles: HgtTileMap,
  lat: number,
  lon: number
): number | null {
  const tile = tiles.get(tileKeyAt(lat, lon));
  if (!tile) return null;

  const s = tile.size;
  if (s < 2) {
    const z = tile.data[0];
    return z === HGT_NO_DATA ? null : z;
  }

  const x = (lon - tile.lonLeft) / tile.step;
  const y = (tile.latTop - lat) / tile.step;
  const cx = Math.min(Math.max(x, 0), s - 1);
  const cy = Math.min(Math.max(y, 0), s - 1);
  let c0 = Math.floor(cx);
  let r0 = Math.floor(cy);
  if (c0 > s - 2) c0 = s - 2;
  if (r0 > s - 2) r0 = s - 2;
  const fx = cx - c0;
  const fy = cy - r0;

  const z00 = tile.data[r0 * s + c0];
  const z10 = tile.data[r0 * s + c0 + 1];
  const z01 = tile.data[(r0 + 1) * s + c0];
  const z11 = tile.data[(r0 + 1) * s + c0 + 1];

  const ok = (z: number) => z !== HGT_NO_DATA;
  if (ok(z00) && ok(z10) && ok(z01) && ok(z11)) {
    return (
      z00 * (1 - fx) * (1 - fy) +
      z10 * fx * (1 - fy) +
      z01 * (1 - fx) * fy +
      z11 * fx * fy
    );
  }

  // Пустота рядом — берём ближайший валидный узел.
  let best: number | null = null;
  let bestD = Infinity;
  const cands: Array<[number, number, number]> = [
    [z00, fx, fy],
    [z10, fx - 1, fy],
    [z01, fx, fy - 1],
    [z11, fx - 1, fy - 1],
  ];
  for (const [z, dx, dy] of cands) {
    if (!ok(z)) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}
