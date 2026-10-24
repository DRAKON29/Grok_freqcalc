import { Logo } from "@/components/logo";
import { RadioCalculator } from "@/components/radio/radio-calculator";

export default function IndexPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <header className="mb-6 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Калькулятор распространения радиосигнала
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Расчёт трассы и зоны связи для частот 50 МГц–7 ГГц. Координаты — СК-42
            (эллипсоид Красовского). Рельеф: HGT/SRTM или синтетический (демо).
            Базовые потери — ITU-R P.525, дифракция — ITU-R P.526 (Дейгаут и Буллингтон).
            Экспорт результатов в JSON/CSV.
          </p>
        </header>

        <RadioCalculator />
      </main>

      <footer className="mb-4 flex flex-col items-center justify-center gap-2">
        <p className="text-xs text-muted-foreground">
          Модель справочна. Для ответственных расчётов сверяйтесь с ITU-R P.452/P.1812 и картами рельефа.
        </p>
        <div className="flex items-center rounded-xl bg-neutral-900 px-4 py-2 text-neutral-100">
          <Logo className="h-5 w-auto" />
        </div>
      </footer>
    </div>
  );
}
