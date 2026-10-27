"use client";

// Правая колонка результатов трассы: профиль A↔B + бюджет двусторонней линии
// (Фаза 1, задача 1.1). Экспорт JSON/CSV с частотным свипом в режиме диапазона.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfileChart } from "@/components/radio/profile-chart";
import { Metric, Placeholder } from "@/components/radio/shared";
import { POL_LABEL } from "@/lib/radio/form";
import { fmt } from "@/lib/radio/format";
import { SIGNAL_COLORS, SIGNAL_LABELS, signalQuality } from "@/lib/radio/signal";
import { frequencySweep, type LinkResult } from "@/lib/radio/engine";
import { useCalculatorStore, useDerived } from "@/lib/radio/calculator-store";
import { cn } from "@/lib/utils";

export function ResultsPanel() {
  const d = useDerived();
  const freqMode = useCalculatorStore((s) => s.freqMode);
  const polarization = useCalculatorStore((s) => s.polarization);
  const useSynthetic = useCalculatorStore((s) => s.useSynthetic);
  const tilesCount = useCalculatorStore((s) => s.tiles.size);
  // Фаза 2.1: результаты трассы — асинхронные, из стора (off-thread расчёт).
  const link = useCalculatorStore((s) => s.link);
  const linkError = useCalculatorStore((s) => s.linkError);
  const linkBusy = useCalculatorStore((s) => s.linkBusy);
  const linkLow = useCalculatorStore((s) => s.linkLow);
  const linkHigh = useCalculatorStore((s) => s.linkHigh);
  const linkReturn = useCalculatorStore((s) => s.linkReturn);
  const linkRxLow = useCalculatorStore((s) => s.linkRxLow);
  const linkRxHigh = useCalculatorStore((s) => s.linkRxHigh);
  const params = d.params;

  const download = (content: string, mime: string, name: string) => {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      {/* --- Профиль трассы --- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Профиль трассы A ↔ B (приёмопередатчики)</CardTitle>
          <CardDescription>
            {!d.rxOk
              ? "Укажите координаты ПРМ для построения профиля"
              : "Рельеф с учётом кривизны Земли (k), линия визирования и первая зона Френеля"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {link ? (
            <ProfileChart link={link} fadeMarginDb={params?.fadeMarginDb ?? 0} className="w-full text-foreground" />
          ) : linkError ? (
            <Placeholder text={linkError} warning />
          ) : !d.rxOk ? (
            <Placeholder text="Координаты ПРМ не указаны — профиль не строится. Зона связи доступна." />
          ) : linkBusy ? (
            <Placeholder text="Расчёт профиля выполняется в фоновом потоке…" />
          ) : (
            <Placeholder text="Исправьте координаты или параметры, чтобы построить профиль." />
          )}
        </CardContent>
      </Card>

      {/* --- Бюджет линии --- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Бюджет двусторонней линии A ↔ B</CardTitle>
        </CardHeader>
        <CardContent>
          {link ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {(() => {
                  const q = signalQuality(link.marginDb, params?.fadeMarginDb ?? 0);
                  const style = {
                    backgroundColor: SIGNAL_COLORS[q],
                    color: "#fff",
                    borderColor: SIGNAL_COLORS[q],
                  };
                  return <Badge style={style}>{SIGNAL_LABELS[q]}</Badge>;
                })()}
                <Badge variant="outline">{fmt(link.distanceM / 1000, 2)} км</Badge>
                <Badge variant="outline">
                  аз. {fmt(link.geom.fwdAzDeg, 1)}° (ист.) / {fmt(link.geom.revAzDeg, 1)}° (обр.)
                </Badge>
                <Badge variant="outline">
                  дир. угол {fmt(link.geom.gridAzDeg, 1)}°, зона {link.geom.zone}
                </Badge>
                <Badge variant="outline">{POL_LABEL[polarization]}</Badge>
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Metric label="EIRP" value={`${fmt(link.eirpDbm, 1)} дБм`} />
                <Metric label="Базовые потери (P.525)" value={`${fmt(link.fspl, 1)} дБ`} />
                <Metric
                  label="Дифракция (P.526)"
                  value={
                    link.diff.loss > 0.05
                      ? `${fmt(link.diff.loss, 1)} дБ — ${
                          link.diff.method === "deygout"
                            ? "Дейгаут"
                            : link.diff.method === "bullington"
                              ? "Буллингтон"
                              : "нет"
                        }`
                      : "нет препятствий"
                  }
                />
                <Metric label="Уровень на входе ПРМ" value={`${fmt(link.prxDbm, 1)} дБм`} />
                <Metric
                  label="Запас относительно чувствительности"
                  value={`${fmt(link.marginDb, 1)} дБ (нужно ${fmt(params?.fadeMarginDb ?? 0, 0)})`}
                />
                <Metric
                  label="Высоты антенн над уровнем моря"
                  value={`${fmt(link.h1AbsM, 0)} / ${fmt(link.h2AbsM, 0)} м`}
                />
                <Metric
                  label="Рельеф в точках ПРД / ПРМ"
                  value={`${fmt(link.txTerrainM, 0)} / ${fmt(link.rxTerrainM, 0)} м`}
                />
                <Metric label="Радиус Френеля в середине" value={`${fmt(link.f1MidM, 1)} м`} />
                <Metric
                  label="Худший просвет / радиус Френеля"
                  value={Number.isFinite(link.minClearance) ? fmt(link.minClearance, 2) : "—"}
                />
                <Metric
                  label="Пробелы данных HGT"
                  value={
                    link.gapCount === 0
                      ? "нет"
                      : `${link.gapCount} отсч. (${fmt(link.gapRatio * 100, 0)}%)`
                  }
                />
                <Metric
                  label="Рельеф"
                  value={useSynthetic && tilesCount === 0 ? "синтетический (демо)" : "HGT/SRTM"}
                />
              </dl>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!link || !params) return;
                    const payload = {
                      exported_at: new Date().toISOString(),
                      params,
                      useSynthetic,
                      result: {
                        distance_km: link.distanceM / 1000,
                        fspl_db: link.fspl,
                        diffraction_db: link.diff.loss,
                        diffraction_method: link.diff.method,
                        prx_dbm: link.prxDbm,
                        margin_db: link.marginDb,
                        ok: link.ok,
                        az_fwd_deg: link.geom.fwdAzDeg,
                        az_rev_deg: link.geom.revAzDeg,
                      },
                    };
                    download(JSON.stringify(payload, null, 2), "application/json", "radio_link.json");
                  }}
                >
                  Экспорт JSON
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!link) return;
                    const rows = [
                      "metric,value",
                      `distance_km,${(link.distanceM / 1000).toFixed(3)}`,
                      `fspl_db,${link.fspl.toFixed(2)}`,
                      `diffraction_db,${link.diff.loss.toFixed(2)}`,
                      `diffraction_method,${link.diff.method}`,
                      `prx_dbm,${link.prxDbm.toFixed(2)}`,
                      `margin_db,${link.marginDb.toFixed(2)}`,
                      `ok,${link.ok}`,
                    ];
                    if (freqMode === "range" && d.geom && params) {
                      const sweep = frequencySweep(
                        useCalculatorStore.getState().tiles,
                        d.geom!,
                        params,
                        d.parsed.txFMin,
                        d.parsed.txFMax,
                        Math.max((d.parsed.txFMax - d.parsed.txFMin) / 20, 0.1)
                      );
                      rows.push("", "freq_mhz,path_loss_db,prx_dbm,margin_db");
                      for (const s of sweep) {
                        rows.push(`${s.freq_mhz},${s.path_loss_db},${s.prx_dbm},${s.margin_db}`);
                      }
                    }
                    download(rows.join("\n"), "text/csv", "radio_link.csv");
                  }}
                >
                  Экспорт CSV
                </Button>
              </div>

              {/* Сравнение на краях диапазонов ПРД и ПРМ */}
              {freqMode === "range" && (d.parsed.txFRangeValid || d.parsed.rxFRangeValid) && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs">
                  {d.parsed.txFRangeValid && linkLow && linkHigh && (
                    <>
                      <p className="mb-2 font-medium">
                        Диапазон ПРД {fmt(d.parsed.txFMin, 0)}–{fmt(d.parsed.txFMax, 0)} МГц:
                      </p>
                      <table className="w-full tabular-nums">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="pb-1 text-left font-normal">Частота</th>
                            <th className="pb-1 text-right font-normal">FSPL</th>
                            <th className="pb-1 text-right font-normal">Дифр.</th>
                            <th className="pb-1 text-right font-normal">ПРМ</th>
                            <th className="pb-1 text-right font-normal">Запас</th>
                          </tr>
                        </thead>
                        <tbody>
                          <RangeRow fMHz={d.parsed.txFMin} link={linkLow} fade={params?.fadeMarginDb ?? 0} />
                          <RangeRow fMHz={link.fMHz} link={link} fade={params?.fadeMarginDb ?? 0} />
                          <RangeRow fMHz={d.parsed.txFMax} link={linkHigh} fade={params?.fadeMarginDb ?? 0} />
                        </tbody>
                      </table>
                    </>
                  )}
                  {d.parsed.rxFRangeValid && linkRxLow && linkRxHigh && (
                    <>
                      <p
                        className={`mb-2 font-medium ${
                          d.parsed.txFRangeValid && linkLow && linkHigh ? "mt-3" : ""
                        }`}
                      >
                        Диапазон ПРМ {fmt(d.parsed.rxFMin, 0)}–{fmt(d.parsed.rxFMax, 0)} МГц
                        (обратный канал):
                      </p>
                      <table className="w-full tabular-nums">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="pb-1 text-left font-normal">Частота</th>
                            <th className="pb-1 text-right font-normal">FSPL</th>
                            <th className="pb-1 text-right font-normal">Дифр.</th>
                            <th className="pb-1 text-right font-normal">ПРМ</th>
                            <th className="pb-1 text-right font-normal">Запас</th>
                          </tr>
                        </thead>
                        <tbody>
                          <RangeRow fMHz={d.parsed.rxFMin} link={linkRxLow} fade={params?.fadeMarginDb ?? 0} />
                          {linkReturn && (
                            <RangeRow fMHz={linkReturn.fMHz} link={linkReturn} fade={params?.fadeMarginDb ?? 0} />
                          )}
                          <RangeRow fMHz={d.parsed.rxFMax} link={linkRxHigh} fade={params?.fadeMarginDb ?? 0} />
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {link.obstacles.length > 0 && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs">
                  <p className="mb-1 font-medium">Препятствия над линией визирования (v &gt; 0):</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {link.obstacles.map((o, i) => (
                      <li key={i}>
                        {fmt(o.dM / 1000, 1)} км от ПРД, высота {fmt(o.hM, 0)} м, v = {fmt(o.v, 2)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : !d.rxOk ? (
            <Placeholder text="Укажите координаты ПРМ для расчёта бюджета линии." />
          ) : (
            <Placeholder text="Бюджет появится после устранения ошибок ввода и загрузки рельефа." />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function RangeRow({ fMHz, link, fade }: { fMHz: number; link: LinkResult; fade: number }) {
  return (
    <tr className="border-t border-border/40">
      <td className="py-1">{fmt(fMHz, 0)} МГц</td>
      <td className="py-1 text-right">{fmt(link.fspl, 1)}</td>
      <td className="py-1 text-right">{fmt(link.diff.loss, 1)}</td>
      <td className="py-1 text-right">{fmt(link.prxDbm, 1)}</td>
      <td
        className={cn(
          "py-1 text-right font-medium",
          link.marginDb >= fade ? "text-foreground" : "text-destructive"
        )}
      >
        {fmt(link.marginDb, 1)}
      </td>
    </tr>
  );
}
