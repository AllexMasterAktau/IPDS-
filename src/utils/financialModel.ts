import {
  CashflowPoint,
  CurrencyCode,
  DerivedMetrics,
  FinancialInputs,
  FxRateMap,
  Language,
  ProjectAnalysis,
  ProjectRecommendations,
  RegionPreset,
} from '../types/ipds';

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  RUB: '₽',
  KZT: '₸',
  USD: '$',
};

export const DEFAULT_FX_RATES: FxRateMap = {
  USD: 1,
  RUB: 97.5,
  KZT: 495.0,
};

export function normalizeCurrencyCode(code?: string): CurrencyCode {
  if (code === 'RUB' || code === 'KZT' || code === 'USD') {
    return code;
  }
  return 'USD';
}

export function getCurrencySymbol(code: CurrencyCode): string {
  return CURRENCY_SYMBOLS[code] || '$';
}

export function getFxConversionFactor(
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: FxRateMap
): number {
  if (fromCurrency === toCurrency) return 1;
  const fromRate = Math.max(0.0001, rates[fromCurrency] || DEFAULT_FX_RATES[fromCurrency]);
  const toRate = Math.max(0.0001, rates[toCurrency] || DEFAULT_FX_RATES[toCurrency]);
  return toRate / fromRate;
}

export function convertCurrencyAmount(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: FxRateMap
): number {
  if (!Number.isFinite(amount)) return 0;
  if (fromCurrency === toCurrency) return amount;
  return amount * getFxConversionFactor(fromCurrency, toCurrency, rates);
}

export function getRegionDefaults(
  region: RegionPreset,
  customRegion?: string,
  lang: Language = 'ru'
): {
  currencyCode: CurrencyCode;
  currencySymbol: string;
  displayLabel: string;
} {
  if (region === 'Казахстан') {
    return {
      currencyCode: 'KZT',
      currencySymbol: '₸',
      displayLabel: lang === 'en' ? 'Kazakhstan (KZT)' : 'Казахстан (KZT)',
    };
  }
  if (region === 'РФ') {
    return {
      currencyCode: 'RUB',
      currencySymbol: '₽',
      displayLabel: lang === 'en' ? 'Russia (RUB)' : 'РФ (RUB)',
    };
  }
  if (region === 'Международный') {
    return {
      currencyCode: 'USD',
      currencySymbol: '$',
      displayLabel: lang === 'en' ? 'International (USD)' : 'Международный (USD)',
    };
  }
  const fallbackLabel = lang === 'en' ? 'Custom region (USD)' : 'Свой регион (USD)';
  return {
    currencyCode: 'USD',
    currencySymbol: '$',
    displayLabel: customRegion?.trim() ? `${customRegion.trim()} (USD)` : fallbackLabel,
  };
}

export function getRegionDisplayLabel(
  region: RegionPreset,
  customRegion: string | undefined,
  lang: Language
): string {
  if (region === 'Свой вариант' && customRegion?.trim()) {
    return customRegion.trim();
  }
  if (lang === 'en') {
    if (region === 'Казахстан') return 'Kazakhstan';
    if (region === 'РФ') return 'Russia';
    if (region === 'Международный') return 'International';
    return 'Custom';
  }
  return region;
}

export function formatMoney(
  amount: number,
  currencySymbol: string,
  lang: Language = 'ru'
): string {
  if (!Number.isFinite(amount)) return `0 ${currencySymbol}`;
  const rounded = Math.round(amount);
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  const formatted = new Intl.NumberFormat(locale).format(rounded);
  return `${formatted} ${currencySymbol}`;
}

export function formatCompactMoney(
  amount: number,
  currencySymbol: string,
  lang: Language = 'ru'
): string {
  if (!Number.isFinite(amount)) return currencySymbol ? `0 ${currencySymbol}` : '0';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  const suffix = currencySymbol ? ` ${currencySymbol}` : '';

  if (lang === 'en') {
    if (abs >= 1_000_000_000) {
      return `${sign}${(abs / 1_000_000_000).toFixed(2)}B${suffix}`;
    }
    if (abs >= 1_000_000) {
      return `${sign}${(abs / 1_000_000).toFixed(2)}M${suffix}`;
    }
    if (abs >= 10_000) {
      return `${sign}${(abs / 1_000).toFixed(0)}K${suffix}`;
    }
    return `${sign}${new Intl.NumberFormat('en-US').format(Math.round(abs))}${suffix}`;
  }

  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(2).replace('.', ',')} млрд${suffix}`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2).replace('.', ',')} млн${suffix}`;
  }
  if (abs >= 10_000) {
    return `${sign}${(abs / 1_000).toFixed(0)} тыс.${suffix}`;
  }
  return `${sign}${new Intl.NumberFormat('ru-RU').format(Math.round(abs))}${suffix}`;
}

export function getEffectiveInputs(
  analysis: ProjectAnalysis,
  overrides: Partial<FinancialInputs> = {}
): FinancialInputs {
  const base = analysis.baselineInputs;
  return {
    investmentAmount: Math.max(0, overrides.investmentAmount ?? base.investmentAmount),
    monthlyRevenue: Math.max(0, overrides.monthlyRevenue ?? base.monthlyRevenue),
    headcount: Math.max(1, Math.round(overrides.headcount ?? base.headcount)),
    launchMonths: Math.max(0, Math.round(overrides.launchMonths ?? base.launchMonths)),
    monthlyOpex: Math.max(0, overrides.monthlyOpex ?? base.monthlyOpex),
    workingCapitalReservePct: Math.max(
      0,
      Math.min(60, overrides.workingCapitalReservePct ?? base.workingCapitalReservePct)
    ),
  };
}

/**
 * Мгновенный детерминированный пересчёт всех производных показателей и графика
 * денежных потоков с поддержкой пересчёта в выбранную валюту (fxFactor).
 */
export function calculateDerivedMetrics(
  analysis: ProjectAnalysis,
  overrides: Partial<FinancialInputs> = {},
  fxFactor = 1,
  monthPrefix = 'М'
): DerivedMetrics {
  const effective = getEffectiveInputs(analysis, overrides);
  const base = analysis.baselineInputs;

  const payrollPerEmployee =
    analysis.payrollPerEmployeeMonthly > 0
      ? analysis.payrollPerEmployeeMonthly
      : Math.round((base.monthlyOpex * 0.42) / Math.max(1, base.headcount));

  const headcountDelta = effective.headcount - base.headcount;
  const nativeMonthlyOpex =
    overrides.monthlyOpex !== undefined
      ? Math.max(0, overrides.monthlyOpex)
      : Math.max(0, base.monthlyOpex + headcountDelta * payrollPerEmployee);

  const scaledInvestment = effective.investmentAmount * fxFactor;
  const scaledRevenue = effective.monthlyRevenue * fxFactor;
  const scaledOpex = nativeMonthlyOpex * fxFactor;

  const reserveFactor = 1 + effective.workingCapitalReservePct / 100;
  const projectCost = Math.round(scaledInvestment * reserveFactor);

  const monthlyProfit = Math.round(scaledRevenue - scaledOpex);
  const ebitdaMarginPct =
    scaledRevenue > 0
      ? Number(((monthlyProfit / scaledRevenue) * 100).toFixed(1))
      : 0;

  const annualRevenue = Math.round(scaledRevenue * 12);
  const annualProfit = Math.round(monthlyProfit * 12);
  const roiAnnualPct =
    projectCost > 0 ? Number(((annualProfit / projectCost) * 100).toFixed(1)) : 0;

  const horizonMonths = 36;
  const maxCalcMonths = 60;
  const cashflowSeries: CashflowPoint[] = [];
  let cumulative = 0;
  let paybackMonths: number | null = null;

  const capexMonths = Math.max(1, effective.launchMonths);
  const monthlyCapexDuringLaunch = projectCost / capexMonths;

  for (let m = 1; m <= maxCalcMonths; m++) {
    const isPreLaunch = m <= effective.launchMonths;
    const capex = isPreLaunch ? monthlyCapexDuringLaunch : 0;

    let rampFactor = 0;
    if (!isPreLaunch) {
      const monthsSinceLaunch = m - effective.launchMonths;
      if (monthsSinceLaunch === 1) rampFactor = 0.65;
      else if (monthsSinceLaunch === 2) rampFactor = 0.85;
      else rampFactor = 1.0;
    }

    const revenue = Math.round(scaledRevenue * rampFactor);
    const opex = isPreLaunch
      ? Math.round(scaledOpex * 0.25)
      : Math.round(scaledOpex);
    const netCashflow = Math.round(revenue - opex - capex);
    cumulative += netCashflow;

    if (paybackMonths === null && m > effective.launchMonths && cumulative >= 0) {
      paybackMonths = m;
    }

    if (m <= horizonMonths) {
      cashflowSeries.push({
        month: m,
        label: `${monthPrefix}${m}`,
        revenue,
        opex,
        capex: Math.round(capex),
        netCashflow,
        cumulativeCashflow: Math.round(cumulative),
      });
    }
  }

  return {
    projectCost,
    investmentAmount: Math.round(scaledInvestment),
    launchMonths: effective.launchMonths,
    headcount: effective.headcount,
    monthlyRevenue: Math.round(scaledRevenue),
    monthlyOpex: Math.round(scaledOpex),
    monthlyProfit,
    ebitdaMarginPct,
    annualRevenue,
    annualProfit,
    paybackMonths,
    roiAnnualPct,
    cashflowSeries,
  };
}

/**
 * Возвращает структурированный 3-й контур «Рекомендации».
 * Для новых отчётов используется результат ИИ напрямую; для ранее сохранённых
 * отчётов без поля recommendations формируется согласованная сводка из контуров 1 и 2.
 */
export function getEffectiveRecommendations(
  analysis: ProjectAnalysis,
  metrics: DerivedMetrics,
  language: Language = 'ru'
): ProjectRecommendations {
  const rec = analysis.recommendations;
  const hasAiRec =
    Boolean(rec?.analystConclusion?.trim()) &&
    (rec?.riskMitigationMeasures?.length ?? 0) > 0 &&
    (rec?.crisisAndBottleneckPlan?.length ?? 0) > 0 &&
    (rec?.growthPlanAndMetrics?.length ?? 0) > 0;

  if (hasAiRec && rec) {
    return {
      analystConclusion: rec.analystConclusion.trim(),
      riskMitigationMeasures: rec.riskMitigationMeasures.filter(Boolean),
      crisisAndBottleneckPlan: rec.crisisAndBottleneckPlan.filter(Boolean),
      growthPlanAndMetrics: rec.growthPlanAndMetrics.filter(Boolean),
    };
  }

  const paybackText = metrics.paybackMonths
    ? language === 'en'
      ? `${metrics.paybackMonths} months`
      : `${metrics.paybackMonths} мес.`
    : language === 'en'
    ? 'over 60 months'
    : 'свыше 60 мес.';

  const analystConclusion =
    rec?.analystConclusion?.trim() ||
    (language === 'en'
      ? `${analysis.executiveSummary} Based on Contour 1 calculations (EBITDA margin ${metrics.ebitdaMarginPct}%, annual ROI ${metrics.roiAnnualPct}%, estimated payback ${paybackText}) and Contour 2 risk profile, the project is viable provided launch discipline, working capital reserve control, and key risk mitigations are maintained.`
      : `${analysis.executiveSummary} С учётом расчётов 1-го контура (EBITDA маржа ${metrics.ebitdaMarginPct}%, годовой ROI ${metrics.roiAnnualPct}%, расчётная окупаемость ${paybackText}) и карты рисков 2-го контура проект реализуем при соблюдении дисциплины запуска, контроле оборотного резерва и выполнении мер по снижению ключевых рисков.`);

  const riskMitigationMeasures =
    rec?.riskMitigationMeasures && rec.riskMitigationMeasures.length > 0
      ? rec.riskMitigationMeasures
      : analysis.risks
          .map((r) => `${r.title}: ${r.mitigation}`)
          .filter(Boolean);

  const crisisAndBottleneckPlan =
    rec?.crisisAndBottleneckPlan && rec.crisisAndBottleneckPlan.length > 0
      ? rec.crisisAndBottleneckPlan
      : language === 'en'
      ? [
          ...analysis.preLaunchSteps.slice(0, 2),
          'Hold a dedicated liquidity buffer covering 2–3 months of fixed OPEX in case launch timeline or revenue ramp shifts.',
          'Define trigger thresholds (revenue < 70% of plan or burn-rate overrun > 15%) to pause non-critical CAPEX and reallocate marketing.',
        ]
      : [
          ...analysis.preLaunchSteps.slice(0, 2),
          'Сформировать отдельный резерв ликвидности на 2–3 месяца фиксированного OPEX на случай сдвига сроков запуска или выхода на плановую выручку.',
          'Утвердить триггеры антикризисного реагирования (выручка < 70% плана или перерасход OPEX > 15%) с заморозкой второстепенных расходов.',
        ];

  const growthPlanAndMetrics =
    rec?.growthPlanAndMetrics && rec.growthPlanAndMetrics.length > 0
      ? rec.growthPlanAndMetrics
      : language === 'en'
      ? [
          ...analysis.revenueDrivers.slice(0, 2),
          `Control KPIs: monthly revenue vs. plan, EBITDA margin >= ${Math.max(10, Math.round(metrics.ebitdaMarginPct))}%, payback <= ${metrics.paybackMonths ?? 36} mo.`,
        ]
      : [
          ...analysis.revenueDrivers.slice(0, 2),
          `Контрольные метрики: выполнение плана ежемесячной выручки, удержание EBITDA маржи >= ${Math.max(10, Math.round(metrics.ebitdaMarginPct))}% и срока окупаемости <= ${metrics.paybackMonths ?? 36} мес.`,
        ];

  return {
    analystConclusion,
    riskMitigationMeasures,
    crisisAndBottleneckPlan,
    growthPlanAndMetrics,
  };
}

