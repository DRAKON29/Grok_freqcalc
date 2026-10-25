// Декларация полей формы калькулятора и константы ввода.
// Чистый модуль (без React): используется стором (calculator-store.ts),
// панелями формы и тестами.

export type CoordMode = "deg" | "gk";
export type PowerUnit = "dBm" | "mW";
export type FreqMode = "single" | "range";
export type Polarization = "V" | "H" | "C";

export const POL_LABEL: Record<Polarization, string> = {
  V: "Вертикальная",
  H: "Горизонтальная",
  C: "Круговая",
};

/** Радиусы анализа зоны связи, км. */
export const ANALYSIS_KM = [2, 4, 6, 9, 13, 19, 28, 42, 62, 92, 135, 200, 290, 420];

/** Диапазоны высот для вертикального анализа, м. */
export const VERT_MAX_HM = [25, 50, 100, 200];

export interface FieldSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  hint?: string;
  digits?: number;
}

// fMHz и pTxDbm обрабатываются отдельно (переключатели режима/единиц).
export const RADIO_FIELDS: FieldSpec[] = [
  { key: "fMHz", label: "Частота", unit: "МГц", min: 50, max: 7000, hint: "от 50 до 7000" },
  { key: "sensitivityDbm", label: "Чувствительность ПРМ", unit: "дБм", min: -160, max: -20 },
  { key: "fadeMarginDb", label: "Запас на замирание", unit: "дБ", min: 0, max: 40 },
  { key: "txGainDbi", label: "Усиление антенны ПРД", unit: "дБи", min: -10, max: 60 },
  { key: "rxGainDbi", label: "Усиление антенны ПРМ", unit: "дБи", min: -10, max: 60 },
  { key: "txFeederDb", label: "Потери фидера ПРД", unit: "дБ", min: 0, max: 30 },
  { key: "rxFeederDb", label: "Потери фидера ПРМ", unit: "дБ", min: 0, max: 30 },
  { key: "extraLossDb", label: "Дополнительные потери", unit: "дБ", min: 0, max: 60 },
  { key: "txAntHM", label: "Высота антенны ПРД над рельефом", unit: "м", min: 0, max: 3000, hint: "до 3000" },
  { key: "rxAntHM", label: "Высота антенны ПРМ над рельефом", unit: "м", min: 0, max: 3000, hint: "до 3000" },
  { key: "kFactor", label: "Коэффициент рефракции k", unit: "", min: 0.1, max: 10, hint: "1,33 — стандартная рефракция" },
];

/** Значения по умолчанию (всё — строки сырого ввода пользователя). */
export const DEFAULTS: Record<string, string> = {
  fMHz: "433",
  txFMinMHz: "430",
  txFMaxMHz: "440",
  rxFMinMHz: "430",
  rxFMaxMHz: "440",
  pTxDbm: "40",
  txGainDbi: "3",
  rxGainDbi: "2",
  txFeederDb: "1,5",
  rxFeederDb: "1,5",
  extraLossDb: "0",
  txAntHM: "10",
  rxAntHM: "1,5",
  sensitivityDbm: "-105",
  fadeMarginDb: "10",
  kFactor: "1,33",
  beamWidthDeg: "",
  txB: "50,5000",
  txL: "36,8500",
  rxB: "50,4872",
  rxL: "36,8385",
  txX: "5600000",
  txY: "7400000",
  rxX: "5600000",
  rxY: "7400000",
  vertDistKm: "5",
  vertAzDeg: "0",
};
