// Чистые (без DOM/fetch) утилиты автозагрузки DEM — используются и в API-роуте,
// и на клиенте. Имя HGT-тайла задаёт его юго-западный угол (N47E039 → 47..48°с.ш.,
// 39..40°в.д.), см. hgt.ts. Источник высот по умолчанию — Copernicus GLO-30
// (~30 м), доступен без ключа через public S3-зеркало AWS.

/** Кандидаты upstream для GET /api/dem/{name}.hgt (проверяются по порядку). */
export const DEM_UPSTREAMS: string[] = [
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{name}/{name}-skadi.hgt",
];

/** Разрешение, возвращаемое автозагрузкой (угловые секунды). */
export const DEM_AUTO_ARCSEC = 30;

const NAME_RE = /^[NS]\d{2}[EW]\d{3}$/;

/** Валидация имени тайла из URL («N47E039»). Возвращает нормализованное имя или null. */
export function normalizeTileName(raw: string): string | null {
  const name = raw.trim().toUpperCase().replace(/\.HGT$/i, "");
  return NAME_RE.test(name) ? name : null;
}

/** Ожидание пустого тайла (океан/полярные зоны в GLO-30 ~ constant). */
export function expectedSizeBytes(arcSec: number): number {
  const side = Math.round(3600 / arcSec) + 1; // 1″→3601, 3″→1201, 30″→121
  return side * side * 2;
}

/**
 * URL источника для тайла. `{name}` подставляется напрямую; шаблон можно
 * переопределить переменной окружения DEM_SOURCE_URL (например, MapTiler
 * с токеном: https://api.maptiler.com/tiles/terrain-rgb/...).
 */
export function upstreamUrl(name: string, template?: string): string {
  const tpl = (template && template.trim()) || DEM_UPSTREAMS[0];
  return tpl.replace("{name}", name);
}

/**
 * Проверка, что буфер — корректный HGT квадрат Int16 big-endian.
 * Используется до отправки клиенту, чтобы не отдавать HTML-страницы ошибок.
 */
export function looksLikeHgt(buffer: ArrayBuffer): boolean {
  const bytes = buffer.byteLength;
  if (bytes < 2 * 2 * 2) return false;
  const side = Math.round(Math.sqrt(bytes / 2));
  if (side < 2 || side * side * 2 !== bytes) return false;
  // грубая проверка значений: все данные в диапазоне высот Земли либо void
  const view = new DataView(buffer);
  let sane = 0;
  const probes = Math.min(16, side * side);
  for (let i = 0; i < probes; i++) {
    const idx = Math.floor((i / probes) * (side * side - 1));
    const v = view.getInt16(idx * 2, false); // big-endian
    if (v === -32768 || (v >= -500 && v <= 9000)) sane++;
  }
  return sane >= Math.ceil(probes * 0.8);
}
