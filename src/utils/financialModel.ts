import {
  CashflowPoint,
  CommitteeAudit,
  CurrencyCode,
  DerivedMetrics,
  FinancialInputs,
  FxRateMap,
  IndependentValuation,
  InvestmentCommitteeVerdict,
  Language,
  LegalComplianceCut,
  ProjectAnalysis,
  ProjectRecommendations,
  ProjectRecord,
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

export function getEffectiveCommitteeVerdict(
  analysis: ProjectAnalysis,
  metrics: DerivedMetrics,
  language: Language = 'ru'
): {
  verdict: InvestmentCommitteeVerdict;
  reason: string;
} {
  if (
    analysis.investmentCommitteeVerdict === 'GO' ||
    analysis.investmentCommitteeVerdict === 'CONDITIONAL_GO' ||
    analysis.investmentCommitteeVerdict === 'NO_GO'
  ) {
    return {
      verdict: analysis.investmentCommitteeVerdict,
      reason:
        analysis.investmentCommitteeVerdictReason?.trim() ||
        analysis.recommendations?.analystConclusion ||
        analysis.executiveSummary,
    };
  }

  const highRisksCount = analysis.risks.filter((r) => r.severity === 'high').length;
  let verdict: InvestmentCommitteeVerdict = 'CONDITIONAL_GO';
  if (metrics.monthlyProfit <= 0 || (metrics.paybackMonths !== null && metrics.paybackMonths > 48)) {
    verdict = 'NO_GO';
  } else if (metrics.ebitdaMarginPct >= 22 && highRisksCount <= 1 && metrics.paybackMonths !== null && metrics.paybackMonths <= 24) {
    verdict = 'GO';
  }

  const reason =
    analysis.investmentCommitteeVerdictReason?.trim() ||
    (language === 'en'
      ? `Preliminary committee stance based on EBITDA margin (${metrics.ebitdaMarginPct}%), annual ROI (${metrics.roiAnnualPct}%), and ${highRisksCount} high-severity risk(s).`
      : `Позиция инвест-комитета на базе EBITDA маржи (${metrics.ebitdaMarginPct}%), годового ROI (${metrics.roiAnnualPct}%) и ${highRisksCount} риск(ов) высокого уровня.`);

  return { verdict, reason };
}

export function getEffectiveIndependentValuation(
  analysis: ProjectAnalysis,
  metrics: DerivedMetrics,
  displaySymbol: string,
  language: Language = 'ru'
): IndependentValuation {
  const v = analysis.independentValuation;
  const hasReal =
    Boolean(v?.realisticProjectValueRange?.trim()) &&
    Boolean(v?.realisticInvestmentAmount?.trim()) &&
    Boolean(v?.realisticPaybackBase?.trim());

  if (hasReal && v) {
    return {
      claimedProjectValue: v.claimedProjectValue?.trim() || '—',
      realisticProjectValueRange: v.realisticProjectValueRange.trim(),
      valuationMethodology: v.valuationMethodology?.trim() || '',
      claimedInvestment: v.claimedInvestment?.trim() || '—',
      realisticInvestmentAmount: v.realisticInvestmentAmount.trim(),
      investmentGapExplanation: v.investmentGapExplanation?.trim() || '',
      claimedPayback: v.claimedPayback?.trim() || '—',
      realisticPaybackBase: v.realisticPaybackBase.trim(),
      realisticPaybackStress: v.realisticPaybackStress?.trim() || '—',
      paybackComment: v.paybackComment?.trim() || '',
    };
  }

  const ebitdaAnnual = Math.max(0, metrics.annualProfit);
  const lowVal = Math.round(ebitdaAnnual * 1.5);
  const highVal = Math.round(ebitdaAnnual * 3.0);
  const stressPayback = metrics.paybackMonths
    ? Math.round(metrics.paybackMonths * 1.45)
    : null;

  return language === 'en'
    ? {
        claimedProjectValue: 'Not explicitly verified in documents',
        realisticProjectValueRange:
          ebitdaAnnual > 0
            ? `${formatCompactMoney(lowVal, displaySymbol, 'en')} – ${formatCompactMoney(highVal, displaySymbol, 'en')}`
            : formatCompactMoney(metrics.investmentAmount * 0.7, displaySymbol, 'en'),
        valuationMethodology:
          'Estimated at 1.5x–3.0x stabilized annual EBITDA adjusted for launch stage and execution risks.',
        claimedInvestment: formatCompactMoney(metrics.investmentAmount, displaySymbol, 'en'),
        realisticInvestmentAmount: formatCompactMoney(metrics.projectCost, displaySymbol, 'en'),
        investmentGapExplanation:
          'Includes working capital buffer, launch slippage reserve, and mandatory compliance costs.',
        claimedPayback: metrics.paybackMonths
          ? `${metrics.paybackMonths} mo. (model baseline)`
          : '> 60 mo.',
        realisticPaybackBase: metrics.paybackMonths
          ? `${metrics.paybackMonths} mo.`
          : '> 60 mo.',
        realisticPaybackStress: stressPayback ? `${stressPayback} mo.` : '> 60 mo.',
        paybackComment:
          'Stress scenario assumes +25% OPEX/CAPEX overrun and a 3-month launch & revenue ramp delay.',
      }
    : {
        claimedProjectValue: 'В документах не подтверждена фактами',
        realisticProjectValueRange:
          ebitdaAnnual > 0
            ? `${formatCompactMoney(lowVal, displaySymbol, 'ru')} – ${formatCompactMoney(highVal, displaySymbol, 'ru')}`
            : formatCompactMoney(metrics.investmentAmount * 0.7, displaySymbol, 'ru'),
        valuationMethodology:
          'Оценка по мультипликатору 1.5x–3.0x годовой EBITDA с дисконтом за стадию запуска и операционные риски.',
        claimedInvestment: formatCompactMoney(metrics.investmentAmount, displaySymbol, 'ru'),
        realisticInvestmentAmount: formatCompactMoney(metrics.projectCost, displaySymbol, 'ru'),
        investmentGapExplanation:
          'Учитывает оборотный капитал, скрытые пусконаладочные и регуляторные издержки и резервный буфер.',
        claimedPayback: metrics.paybackMonths
          ? `${metrics.paybackMonths} мес. (расчётная база)`
          : '> 60 мес.',
        realisticPaybackBase: metrics.paybackMonths ? `${metrics.paybackMonths} мес.` : '> 60 мес.',
        realisticPaybackStress: stressPayback ? `${stressPayback} мес.` : '> 60 мес.',
        paybackComment:
          'Стресс-сценарий закладывает удорожание сметы/OPEX на 20–25% и сдвиг выхода на плановую выручку.',
      };
}

export function getEffectiveCommitteeAudit(
  analysis: ProjectAnalysis,
  metrics: DerivedMetrics,
  language: Language = 'ru'
): CommitteeAudit {
  const a = analysis.committeeAudit;
  if (a && a.unitEconomicsCheck && a.stressTestSummary) {
    return {
      unitEconomicsCheck: a.unitEconomicsCheck,
      demandAndPainCheck: a.demandAndPainCheck,
      competitiveMoatCheck: a.competitiveMoatCheck,
      teamAndSkinInTheGame: a.teamAndSkinInTheGame,
      stressTestSummary: a.stressTestSummary,
      exitAndTrancheLogic: a.exitAndTrancheLogic,
      unverifiedRedFlags: Array.isArray(a.unverifiedRedFlags) ? a.unverifiedRedFlags.filter(Boolean) : [],
      founderHardQuestions: Array.isArray(a.founderHardQuestions) ? a.founderHardQuestions.filter(Boolean) : [],
    };
  }

  return language === 'en'
    ? {
        unitEconomicsCheck:
          analysis.unitEconomicsSummary ||
          `EBITDA margin ${metrics.ebitdaMarginPct}%. LTV/CAC and monthly burn rate require primary invoice & conversion verification.`,
        demandAndPainCheck:
          'Market pain is stated conceptually; signed LOIs, pilot prepayments, and repeat purchase evidence must be verified.',
        competitiveMoatCheck:
          'Defensibility relies on execution speed and unit cost discipline; switching costs and regulatory barriers need validation.',
        teamAndSkinInTheGame:
          'Founder operational track record and personal capital commitment (skin in the game) are not documented yet.',
        stressTestSummary: `With +20% cost overrun and -25% revenue ramp, monthly EBITDA drops sharply; liquidity buffer for ${metrics.launchMonths + 3} mo. is critical.`,
        exitAndTrancheLogic:
          'Funding should be released in KPI-gated tranches (legal/licensing clearance -> pilot revenue -> unit-economy breakeven).',
        unverifiedRedFlags: [
          'Unverified baseline demand assumptions — confirm signed contracts or pilot pipeline before full CAPEX deployment.',
        ],
        founderHardQuestions: [
          'What verified customer prepayments or signed B2B/B2C pilots exist right now?',
          'How much personal capital have founders invested alongside external funding?',
          'What happens to cash runway if launch is delayed by 4 months and CAC doubles?',
        ],
      }
    : {
        unitEconomicsCheck:
          analysis.unitEconomicsSummary ||
          `EBITDA маржа ${metrics.ebitdaMarginPct}%. Показатели LTV/CAC и Burn Rate требуют сверки с первичной статистикой продаж.`,
        demandAndPainCheck:
          'Рыночная боль заявлена на уровне концепции; требуется подтверждение спроса договорами, предзаказами или пилотной конверсией.',
        competitiveMoatCheck:
          'Конкурентное преимущество («ров») требует защиты через себестоимость, эксклюзивные каналы или регуляторный барьер.',
        teamAndSkinInTheGame:
          'Личный финансовый вклад основателей («шкура на кону») и релевантный отраслевой опыт команды не подтверждены документами.',
        stressTestSummary: `При задержке запуска на 3–4 мес., росте расходов на 20% и просадке выручки на 25% критичен резерв ликвидности минимум на ${metrics.launchMonths + 3} мес.`,
        exitAndTrancheLogic:
          'Финансирование целесообразно дробить на транши под KPI: регистрация/лицензии -> подтверждение первых продаж -> выход в операционный ноль.',
        unverifiedRedFlags: [
          'Данные не подтверждены / Красный флаг: плановая выручка и конверсия в модели не подкреплены первичными контрактами или статистикой пилота.',
        ],
        founderHardQuestions: [
          'Какие фактические предзаказы, LOI или оплаченные пилоты подтверждают спрос на сегодня?',
          'Какую долю риска и собственных средств основатели вкладывают в проект («шкура на кону»)?',
          'За счёт чего проект выживет при задержке запуска на 4 месяца и двукратном росте стоимости привлечения клиента?',
        ],
      };
}

export function getEffectiveLegalCompliance(
  project: ProjectRecord,
  analysis: ProjectAnalysis,
  language: Language = 'ru'
): LegalComplianceCut {
  const lc = analysis.legalCompliance;
  const hasMissingInputs =
    !project.businessScope?.trim() ||
    !project.activityType?.trim() ||
    !project.okedCode?.trim();

  if (lc && lc.jurisdictionSummary && lc.taxCodeChecks) {
    return {
      jurisdictionSummary: lc.jurisdictionSummary,
      activityClassificationStatus: hasMissingInputs
        ? 'missing_suggested'
        : lc.activityClassificationStatus || 'provided',
      suggestedBusinessScope: lc.suggestedBusinessScope || project.businessScope || '',
      suggestedActivityType: lc.suggestedActivityType || project.activityType || '',
      suggestedOkedCode: lc.suggestedOkedCode || project.okedCode || '',
      missingFieldsWarning: lc.missingFieldsWarning || '',
      taxCodeChecks: lc.taxCodeChecks,
      entrepreneurialCodeChecks: lc.entrepreneurialCodeChecks,
      civilCodeChecks: lc.civilCodeChecks,
      criminalCodeRisks: lc.criminalCodeRisks,
      industryLicensingRequirements: lc.industryLicensingRequirements,
      legalStopFactors: Array.isArray(lc.legalStopFactors)
        ? lc.legalStopFactors.filter(Boolean)
        : [],
    };
  }

  const regionLabel = getRegionDisplayLabel(project.region, project.customRegion, language);
  const legalRisks = analysis.risks.filter((r) => r.dimension === 'legal' || r.dimension === 'regional');

  return language === 'en'
    ? {
        jurisdictionSummary: `Jurisdiction: ${regionLabel}. Preliminary legal & regulatory review across tax, corporate/entrepreneurial, civil, criminal compliance, and sector licensing.`,
        activityClassificationStatus: hasMissingInputs ? 'missing_suggested' : 'provided',
        suggestedBusinessScope: project.businessScope || project.category || 'Commercial & services sector',
        suggestedActivityType: project.activityType || project.projectName,
        suggestedOkedCode: project.okedCode || 'To be refined per national classifier (OKED/OKVED/NACE)',
        missingFieldsWarning: hasMissingInputs
          ? 'Business scope, activity type, or OKED/NACE classifier code is not filled in — specify exact codes before legal registration and tax regime selection.'
          : '',
        taxCodeChecks:
          'Verify eligibility for special vs. general tax regimes, VAT registration threshold, withholding taxes, and payroll contributions in the selected jurisdiction.',
        entrepreneurialCodeChecks:
          'Ensure entity form, charter capital, SME status requirements, and state support / antitrust restrictions comply with entrepreneurial legislation.',
        civilCodeChecks:
          'Audit customer/supplier contracts, IP ownership assignment, liability caps, SLA penalties, and lease/collateral terms under the Civil Code.',
        criminalCodeRisks:
          'Assess compliance risks related to unlicensed regulated activity, tax evasion thresholds, AML/KYC controls, and false reporting liability.',
        industryLicensingRequirements:
          legalRisks[0]?.description ||
          'Check mandatory sector permits, sanitary/fire approvals, data protection, and certification rules before commercial launch.',
        legalStopFactors: legalRisks.length > 0
          ? legalRisks.map((r) => `${r.title}: ${r.mitigation}`)
          : ['Confirm licensing, tax registration, and IP/contract clearance prior to first commercial revenue.'],
      }
    : {
        jurisdictionSummary: `Юрисдикция: ${regionLabel}. Проверка проекта по Налоговому, Предпринимательскому, Гражданскому, Уголовному кодексам и профильным отраслевым нормам.`,
        activityClassificationStatus: hasMissingInputs ? 'missing_suggested' : 'provided',
        suggestedBusinessScope: project.businessScope || project.category || 'Коммерческая деятельность / услуги',
        suggestedActivityType: project.activityType || project.projectName,
        suggestedOkedCode: project.okedCode || 'Уточнить код по национальному классификатору ОКЭД / ОКВЭД',
        missingFieldsWarning: hasMissingInputs
          ? 'Не заполнены род деятельности, вид деятельности или код ОКЭД — необходимо указать точный классификатор для выбора налогового режима и проверки лицензий.'
          : '',
        taxCodeChecks:
          'Проверить пороги НДС, допустимость специального налогового режима по виду деятельности/ОКЭД, налоги у источника выплаты и нагрузку на ФОТ по Налоговому кодексу.',
        entrepreneurialCodeChecks:
          'Сверить требования к ОПФ, статусу субъекта предпринимательства, уставному капиталу, антимонопольным ограничениям и условиям госрегулирования.',
        civilCodeChecks:
          'Проверить договорную обвязку с клиентами и подрядчиками (ГК), передачу прав на ИС/ПО, ответственность сторон, неустойки и обеспечение обязательств.',
        criminalCodeRisks:
          'Исключить риски незаконного предпринимательства без лицензии, уклонения от уплаты налогов, фиктивных сделок, нарушений AML/персональных данных и ответственности должностных лиц (УК).',
        industryLicensingRequirements:
          legalRisks[0]?.description ||
          'Проверить обязательное лицензирование, уведомления о начале деятельности, отраслевую сертификацию, требования СЭС/пожарной безопасности и защиты данных.',
        legalStopFactors: legalRisks.length > 0
          ? legalRisks.map((r) => `${r.title}: ${r.mitigation}`)
          : ['До старта выручки подтвердить отсутствие запретов по выбранному коду ОКЭД и закрыть разрешительные процедуры.'],
      };
}

