/** Качество двусторонней радиолинии по запасу относительно чувствительности. */

export type SignalQuality = "green" | "yellow" | "red";

export const SIGNAL_COLORS = {
  green: "#16a34a",
  yellow: "#ca8a04",
  red: "#dc2626",
} as const;

export const SIGNAL_LABELS: Record<SignalQuality, string> = {
  green: "Уверенный сигнал",
  yellow: "Неустойчивый сигнал",
  red: "Связи нет",
};

/**
 * green  — запас ≥ fadeMargin (устойчивая двусторонняя связь)
 * yellow — 0 ≤ запас < fadeMargin (связь есть, но без требуемого запаса)
 * red    — запас < 0 (связь не обеспечивается)
 */
export function signalQuality(
  marginDb: number,
  fadeMarginDb: number
): SignalQuality {
  if (!Number.isFinite(marginDb)) return "red";
  if (marginDb >= fadeMarginDb) return "green";
  if (marginDb >= 0) return "yellow";
  return "red";
}

export function signalColor(
  marginDb: number,
  fadeMarginDb: number
): string {
  return SIGNAL_COLORS[signalQuality(marginDb, fadeMarginDb)];
}
