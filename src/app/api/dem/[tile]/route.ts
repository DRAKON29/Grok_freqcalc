// GET /api/dem/N47E039.hgt — серверный прокси к Copernicus GLO-30 (AWS Open Data).
// Отдаёт бинарный HGT (Int16 big-endian) с HTTP-кешированием, чтобы клиенту не
// требовалась ручная загрузка .hgt-файлов. Vercel KV недоступен в этом окружении,
// поэтому используется стандартный Cache-Control (edge/HTTP-кеш выполняет роль
// серверного кеша; при необходимости легко заменить на KV/Blob).

import { NextResponse } from "next/server";
import {
  normalizeTileName,
  upstreamUrl,
  looksLikeHgt,
  DEM_AUTO_ARCSEC,
} from "@/lib/radio/dem";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 15_000;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tile: string }> }
): Promise<NextResponse> {
  const { tile } = await ctx.params;
  const name = normalizeTileName(decodeURIComponent(tile ?? ""));
  if (!name) {
    return NextResponse.json(
      { error: "Некорректное имя тайла (ожидалось N47E039.hgt)" },
      { status: 400 }
    );
  }

  const url = upstreamUrl(name, process.env.DEM_SOURCE_URL);
  let upstream: Response;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    upstream = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
  } catch {
    return NextResponse.json(
      { error: `Источник рельефа недоступен: ${url}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    // 404 означает «тайл отсутствует у источника» (например, океан за пределами покрытия)
    const status = upstream.status === 404 ? 404 : 502;
    return NextResponse.json(
      { error: `Источник вернул ${upstream.status} для ${name}` },
      { status }
    );
  }

  const buffer = await upstream.arrayBuffer();
  if (!looksLikeHgt(buffer)) {
    return NextResponse.json(
      { error: `Ответ источника не является корректным HGT (${buffer.byteLength} байт)` },
      { status: 502 }
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "public, max-age=604800, s-maxage=604800, immutable",
      "X-Dem-Tile": name,
      "X-Dem-Arcsec": String(DEM_AUTO_ARCSEC),
    },
  });
}
