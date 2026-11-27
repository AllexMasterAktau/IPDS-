import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Gavel,
  HelpCircle,
  Printer,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  CurrencyCode,
  FinancialInputs,
  FxRateMap,
  Language,
  ProjectRecord,
  RiskDimension,
  RiskSeverity,
} from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import {
  calculateDerivedMetrics,
  formatCompactMoney,
  formatMoney,
  getCurrencySymbol,
  getEffectiveCommitteeAudit,
  getEffectiveCommitteeVerdict,
  getEffectiveIndependentValuation,
  getEffectiveInputs,
  getEffectiveLegalCompliance,
  getEffectiveRecommendations,
  getFxConversionFactor,
  getRegionDisplayLabel,
  normalizeCurrencyCode,
} from '../utils/financialModel';
import {
  exportReportToPdf,
  PdfFontUnavailableError,
  preloadPdfFonts,
} from '../utils/pdfExport';
import { FinancialInfographics } from './FinancialInfographics';

interface ReportViewProps {
  language: Language;
  displayCurrency: CurrencyCode;
  fxRates: FxRateMap;
  project: ProjectRecord;
  isStandaloneWindow?: boolean;
  onUpdateOverrides: (overrides: Partial<FinancialInputs>) => void;
  onUpdateProjectMeta?: (
    patch: Partial<
      Pick<
        ProjectRecord,
        'businessScope' | 'activityType' | 'okedCode' | 'region' | 'customRegion'
      >
    >
  ) => void;
  onRunAnalysis?: () => void;
  analyzing?: boolean;
}

const RISK_DIMENSION_IDS: ('all' | RiskDimension)[] = [
  'all',
  'market',
  'legal',
  'operational',
  'hr',
  'regional',
];

function getSeverityMeta(severity: RiskSeverity, language: Language, isLight = false) {
  const t = getTranslations(language);
  if (severity === 'high') {
    return {
      label: t.report.severity.high,
      icon: <ShieldAlert className="w-3.5 h-3.5 shrink-0" />,
      cls: isLight ? 'text-rose-700 font-semibold' : 'text-rose-400 font-semibold',
    };
  }
  if (severity === 'medium') {
    return {
      label: t.report.severity.medium,
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
      cls: isLight ? 'text-amber-700 font-semibold' : 'text-amber-400 font-semibold',
    };
  }
  return {
    label: t.report.severity.low,
    icon: <ShieldCheck className="w-3.5 h-3.5 shrink-0" />,
    cls: isLight ? 'text-emerald-700 font-semibold' : 'text-emerald-400 font-semibold',
  };
}

export const ReportView: React.FC<ReportViewProps> = ({
  language,
  displayCurrency,
  fxRates,
  project,
  isStandaloneWindow = false,
  onUpdateOverrides,
  onUpdateProjectMeta,
  onRunAnalysis,
  analyzing = false,
}) => {
  const t = getTranslations(language);
  const [riskFilter, setRiskFilter] = useState<'all' | RiskDimension>('all');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [appliedSuggestedMeta, setAppliedSuggestedMeta] = useState(false);
  const pdfSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void preloadPdfFonts();
  }, []);

  useEffect(() => {
    setAppliedSuggestedMeta(false);
  }, [project.id, project.analysis?.generatedAt]);

  const analysis = project.analysis;
  const baseCurrency = normalizeCurrencyCode(analysis?.currencyCode || project.currencyCode);
  const fxFactor = getFxConversionFactor(baseCurrency, displayCurrency, fxRates);
  const displaySymbol = getCurrencySymbol(displayCurrency);

  const effectiveInputs = useMemo(() => {
    if (!analysis) return null;
    return getEffectiveInputs(analysis, project.manualOverrides);
  }, [analysis, project.manualOverrides]);

  const metrics = useMemo(() => {
    if (!analysis) return null;
    return calculateDerivedMetrics(
      analysis,
      project.manualOverrides,
      fxFactor,
      t.common.monthPrefix
    );
  }, [analysis, project.manualOverrides, fxFactor, t.common.monthPrefix]);

  const convertedCostStructure = useMemo(() => {
    if (!analysis) return [];
    return analysis.costStructure.map((item) => ({
      ...item,
      amount: Math.round(item.amount * fxFactor),
    }));
  }, [analysis, fxFactor]);

  const recommendations = useMemo(() => {
    if (!analysis || !metrics) return null;
    return getEffectiveRecommendations(analysis, metrics, language);
  }, [analysis, metrics, language]);

  const committeeVerdict = useMemo(() => {
    if (!analysis || !metrics) return null;
    return getEffectiveCommitteeVerdict(analysis, metrics, language);
  }, [analysis, metrics, language]);

  const independentValuation = useMemo(() => {
    if (!analysis || !metrics) return null;
    return getEffectiveIndependentValuation(analysis, metrics, displaySymbol, language);
  }, [analysis, metrics, displaySymbol, language]);

  const committeeAudit = useMemo(() => {
    if (!analysis || !metrics) return null;
    return getEffectiveCommitteeAudit(analysis, metrics, language);
  }, [analysis, metrics, language]);

  const legalCompliance = useMemo(() => {
    if (!analysis) return null;
    return getEffectiveLegalCompliance(project, analysis, language);
  }, [project, analysis, language]);

  if (
    !analysis ||
    !effectiveInputs ||
    !metrics ||
    !recommendations ||
    !committeeVerdict ||
    !independentValuation ||
    !committeeAudit ||
    !legalCompliance
  ) {
    return (
      <div className="w-full max-w-[1600px] mx-auto py-12 px-4 sm:px-8 lg:px-10">
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] p-8 text-center space-y-4">
          <h2 className="text-xl font-bold text-[#1E2022]">
            {t.report.notReadyTitle.replace('{name}', project.projectName)}
          </h2>
          <p className="text-sm text-[#5C6066] max-w-xl mx-auto">
            {t.report.notReadyDesc}
          </p>
          {onRunAnalysis && (
            <button
              type="button"
              disabled={analyzing}
              onClick={onRunAnalysis}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer shadow-xs"
            >
              {analyzing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>{language === 'en' ? 'Analysis in progress...' : 'Выполняется анализ...'}</span>
                </>
              ) : (
                <span>{t.report.runAnalyze}</span>
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  const regionLabel = getRegionDisplayLabel(project.region, project.customRegion, language);
  const hasOverrides = Object.keys(project.manualOverrides || {}).length > 0;
  const filteredRisks =
    riskFilter === 'all'
      ? analysis.risks
      : analysis.risks.filter((r) => r.dimension === riskFilter);

  const reportTabUrl = `/?view=report&projectId=${encodeURIComponent(project.id)}`;

  const handleFieldChange = (
    field: keyof FinancialInputs,
    rawValue: string,
    isMonetary = false
  ) => {
    const num = Number(rawValue.replace(/\s+/g, '').replace(',', '.'));
    if (!Number.isFinite(num)) return;
    const clamped = Math.max(0, num);
    const nativeVal =
      isMonetary && fxFactor !== 1
        ? Number((clamped / fxFactor).toFixed(4))
        : clamped;

    onUpdateOverrides({
      ...project.manualOverrides,
      [field]: nativeVal,
    });
  };

  const handleResetOverrides = () => {
    onUpdateOverrides({});
  };

  const handleDownloadPdf = async () => {
    if (!analysis || !effectiveInputs || !metrics) return;
    setExportingPdf(true);
    setPdfError(null);
    try {
      await exportReportToPdf({
        project,
        analysis,
        effectiveInputs,
        metrics,
        convertedCostStructure,
        language,
        displayCurrency,
        displaySymbol,
        hasOverrides,
      });
    } catch (err) {
      if (err instanceof PdfFontUnavailableError) {
        // Если шрифты кириллицы не удалось встроить, используем надёжный печатный контур (Save as PDF)
        window.print();
      } else {
        setPdfError(
          err instanceof Error
            ? err.message
            : language === 'en'
            ? 'PDF generation error'
            : 'Ошибка формирования PDF-документа'
        );
      }
    } finally {
      setExportingPdf(false);
    }
  };

  const displayInvestmentInput = Math.round(effectiveInputs.investmentAmount * fxFactor);
  const displayRevenueInput = Math.round(effectiveInputs.monthlyRevenue * fxFactor);
  const displayOpexInput = metrics.monthlyOpex;
  const fxNoteText =
    baseCurrency !== displayCurrency
      ? ` · ${t.report.fxConvertedNote
          .replace('{from}', baseCurrency)
          .replace('{rate}', `1 ${baseCurrency} = ${fxFactor.toFixed(4)} ${displayCurrency}`)}`
      : '';

  return (
    <div className="w-full max-w-[1600px] mx-auto py-4 px-4 sm:px-6 lg:px-8 space-y-5">
      {/* Верхняя панель действий отчёта */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[#E5E0D5]">
        <div className="min-w-0 max-w-full flex-1">
          {isStandaloneWindow && (
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-[#9A6E2E] hover:text-[#7B551F] font-medium mb-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.report.backToTerminal}</span>
            </a>
          )}
          <div className="text-xs text-[#5C6066] leading-snug break-words [overflow-wrap:anywhere]">
            {regionLabel} · {displayCurrency} ({displaySymbol}) · {t.report.initiator}:{' '}
            {project.fullName}
            {project.okedCode ? ` · ОКЭД ${project.okedCode}` : ''}
            {hasOverrides ? ` · ${t.report.manuallyRecalculated}` : ''}
            {fxNoteText}
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-[#1E2022] leading-snug mt-0.5 break-words [overflow-wrap:anywhere]">
            {project.projectName}
          </h2>
          {(project.businessScope || project.activityType) && (
            <div className="text-[11px] text-[#5C6066] mt-0.5 break-words [overflow-wrap:anywhere]">
              {[project.businessScope, project.activityType].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isStandaloneWindow && (
            <a
              href={reportTabUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors whitespace-nowrap shadow-xs"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-[#F5F3EE]" />
              <span>{t.report.openNewWindow}</span>
            </a>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
          >
            <Printer className="w-3.5 h-3.5 shrink-0 text-[#F5F3EE]" />
            <span>{t.report.print}</span>
          </button>

          <button
            type="button"
            disabled={exportingPdf}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
          >
            <Download className="w-3.5 h-3.5 shrink-0 text-[#F5F3EE]" />
            <span>
              {exportingPdf ? t.report.generatingPdf : t.report.downloadPdf}
            </span>
          </button>
        </div>
      </div>

      {pdfError && (
        <div className="no-print rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800">
          {pdfError}
        </div>
      )}

      {/* Вердикт жёсткого инвест-комитета */}
      <section
        className={`no-print rounded-xl border p-4 sm:p-5 space-y-1.5 shadow-[0_2px_10px_rgba(22,24,26,0.03)] ${
          committeeVerdict.verdict === 'GO'
            ? 'bg-emerald-50/70 border-emerald-300'
            : committeeVerdict.verdict === 'NO_GO'
            ? 'bg-rose-50/70 border-rose-300'
            : 'bg-amber-50/70 border-amber-300'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#1E2022]">
            <Gavel className="w-4 h-4 text-[#9A6E2E] shrink-0" />
            <span>{t.report.verdictTitle}</span>
          </div>
          <span
            className={`px-2.5 py-1 rounded-md text-xs font-bold border ${
              committeeVerdict.verdict === 'GO'
                ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                : committeeVerdict.verdict === 'NO_GO'
                ? 'bg-rose-100 border-rose-300 text-rose-900'
                : 'bg-amber-100 border-amber-300 text-amber-900'
            }`}
          >
            {t.report.verdictLabels[committeeVerdict.verdict]}
          </span>
        </div>
        <p className="text-xs sm:text-[13px] text-[#1E2022] leading-snug">
          {committeeVerdict.reason}
        </p>
      </section>

      {/* 6 ключевых показателей проекта */}
      <section className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4">
          <div className="text-xs text-[#5C6066]">{t.report.kpiCost}</div>
          <div className="mt-1.5 text-xl font-bold text-[#1E2022] font-mono-tabular">
            {formatMoney(metrics.projectCost, displaySymbol, language)}
          </div>
          <div className="mt-1 text-[11px] text-[#7A7E85]">
            {t.report.kpiCostSub} {effectiveInputs.workingCapitalReservePct}%
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4">
          <div className="text-xs text-[#5C6066]">{t.report.kpiInvestments}</div>
          <div className="mt-1 text-lg sm:text-xl font-bold text-[#9A6E2E] font-mono-tabular">
            {formatMoney(metrics.investmentAmount, displaySymbol, language)}
          </div>
          <div className="mt-0.5 text-[11px] text-[#7A7E85] leading-snug">
            {t.report.kpiInvestmentsSub}
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4">
          <div className="text-xs text-[#5C6066]">{t.report.kpiLaunch}</div>
          <div className="mt-1 text-lg sm:text-xl font-bold text-[#1E2022] font-mono-tabular">
            {metrics.launchMonths} {t.common.monthsShort}
          </div>
          <div className="mt-0.5 text-[11px] text-[#7A7E85] leading-snug">
            {t.report.kpiLaunchSub}
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4">
          <div className="text-xs text-[#5C6066]">{t.report.kpiStaff}</div>
          <div className="mt-1 text-lg sm:text-xl font-bold text-[#1E2022] font-mono-tabular">
            {metrics.headcount} {t.common.staffShort}
          </div>
          <div className="mt-0.5 text-[11px] text-[#7A7E85] leading-snug">
            {t.report.kpiStaffSub}{' '}
            {formatCompactMoney(metrics.monthlyOpex, displaySymbol, language)}/
            {t.common.monthsShort}
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4">
          <div className="text-xs text-[#5C6066]">{t.report.kpiRevenue}</div>
          <div className="mt-1 text-lg sm:text-xl font-bold text-[#1E2022] font-mono-tabular">
            {formatMoney(metrics.monthlyRevenue, displaySymbol, language)}
          </div>
          <div className="mt-0.5 text-[11px] text-[#7A7E85] leading-snug">
            {t.report.kpiRevenueSub}{' '}
            {formatCompactMoney(metrics.annualRevenue, displaySymbol, language)}
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4">
          <div className="text-xs text-[#5C6066]">{t.report.kpiPayback}</div>
          <div className="mt-1 text-lg sm:text-xl font-bold text-emerald-700 font-mono-tabular">
            {metrics.paybackMonths
              ? `${metrics.paybackMonths} ${t.common.monthsShort}`
              : t.common.moreThan60Months}
          </div>
          <div className="mt-0.5 text-[11px] text-[#7A7E85] leading-snug">
            {t.report.kpiPaybackSub
              .replace('{margin}', String(metrics.ebitdaMarginPct))
              .replace('{roi}', String(metrics.roiAnnualPct))}
          </div>
        </div>
      </section>

      {/* Интерактивный пересчёт показателей */}
      <section className="no-print rounded-xl bg-[#FFFFFF] border border-[#D8C7A5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[#B88B4A] shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-[#1E2022] leading-snug">
                {t.report.recalcTitle}
              </h3>
              <p className="text-xs text-[#5C6066] leading-snug">
                {t.report.recalcDesc}
              </p>
            </div>
          </div>
          {hasOverrides && (
            <button
              type="button"
              onClick={handleResetOverrides}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#F5F3EE]" />
              <span>{t.report.resetBaseline}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] text-[#5C6066] mb-1">
              {t.report.fieldInvestments} ({displaySymbol})
            </label>
            <input
              type="number"
              min={0}
              step={displayCurrency === 'USD' ? 500 : 10000}
              value={displayInvestmentInput}
              onChange={(e) => handleFieldChange('investmentAmount', e.target.value, true)}
              className="w-full px-3 py-2 rounded-lg bg-[#FAF8F3] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none font-mono-tabular text-sm text-[#1E2022]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#5C6066] mb-1">
              {t.report.fieldRevenue} ({displaySymbol})
            </label>
            <input
              type="number"
              min={0}
              step={displayCurrency === 'USD' ? 500 : 10000}
              value={displayRevenueInput}
              onChange={(e) => handleFieldChange('monthlyRevenue', e.target.value, true)}
              className="w-full px-3 py-2 rounded-lg bg-[#FAF8F3] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none font-mono-tabular text-sm text-[#1E2022]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#5C6066] mb-1">
              {t.report.fieldStaff}
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={effectiveInputs.headcount}
              onChange={(e) => handleFieldChange('headcount', e.target.value, false)}
              className="w-full px-3 py-2 rounded-lg bg-[#FAF8F3] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none font-mono-tabular text-sm text-[#1E2022]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#5C6066] mb-1">
              {t.report.fieldLaunch}
            </label>
            <input
              type="number"
              min={0}
              max={48}
              step={1}
              value={effectiveInputs.launchMonths}
              onChange={(e) => handleFieldChange('launchMonths', e.target.value, false)}
              className="w-full px-3 py-2 rounded-lg bg-[#FAF8F3] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none font-mono-tabular text-sm text-[#1E2022]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#5C6066] mb-1">
              {t.report.fieldOpex} ({displaySymbol})
            </label>
            <input
              type="number"
              min={0}
              step={displayCurrency === 'USD' ? 500 : 10000}
              value={displayOpexInput}
              onChange={(e) => handleFieldChange('monthlyOpex', e.target.value, true)}
              className="w-full px-3 py-2 rounded-lg bg-[#FAF8F3] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none font-mono-tabular text-sm text-[#1E2022]"
            />
          </div>
        </div>
      </section>

      {/* КОНТУР 1: Цифры и экономика */}
      <section className="no-print space-y-3.5">
        <div className="flex items-baseline justify-between border-b border-[#E5E0D5] pb-1.5">
          <h3 className="text-base sm:text-lg font-bold text-[#1E2022]">
            {t.report.contour1Title}
          </h3>
          <span className="text-xs text-[#5C6066]">
            {t.report.contour1Meta.replace('{currency}', displayCurrency)}
          </span>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 sm:p-5 space-y-2">
          <div className="text-xs font-semibold text-[#9A6E2E]">
            {t.report.execSummaryTitle}
          </div>
          <p className="text-xs sm:text-[13px] text-[#1E2022] leading-snug">
            {analysis.executiveSummary}
          </p>
          <p className="text-xs text-[#5C6066] leading-snug pt-2 border-t border-[#E5E0D5]">
            {analysis.unitEconomicsSummary}
          </p>
        </div>

        <FinancialInfographics
          language={language}
          metrics={metrics}
          costStructure={convertedCostStructure}
          currencySymbol={displaySymbol}
          theme="light"
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Таблица структуры инвестиций */}
          <div className="lg:col-span-7 rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E5E0D5]">
              <h4 className="text-sm font-semibold text-[#1E2022]">
                {t.report.costTableTitle}
              </h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E5E0D5] text-[#5C6066]">
                    <th className="py-2 px-3.5 font-medium">{t.report.colCategory}</th>
                    <th className="py-2 px-3.5 font-medium text-right">{t.report.colAmount}</th>
                    <th className="py-2 px-3.5 font-medium text-right">{t.report.colShare}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDE8DC]">
                  {convertedCostStructure.map((item) => (
                    <tr key={item.category} className="hover:bg-[#F5F3EE]/70">
                      <td className="py-2 px-3.5 leading-snug">
                        <div className="font-medium text-[#1E2022]">{item.category}</div>
                        <div className="text-[11px] text-[#5C6066] mt-0.5">{item.note}</div>
                      </td>
                      <td className="py-2 px-3.5 text-right font-mono-tabular text-[#1E2022] whitespace-nowrap">
                        {formatMoney(item.amount, displaySymbol, language)}
                      </td>
                      <td className="py-2 px-3.5 text-right font-mono-tabular text-[#9A6E2E] font-semibold whitespace-nowrap">
                        {item.sharePct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Драйверы выручки */}
          <div className="lg:col-span-5 rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <h4 className="text-sm font-semibold text-[#1E2022]">
              {t.report.driversTitle}
            </h4>
            <ul className="space-y-1.5">
              {analysis.revenueDrivers.map((driver, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-[#3A3D42] leading-snug">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#B88B4A] shrink-0 mt-0.5" />
                  <span>{driver}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Независимая переоценка терминала */}
        <div className="rounded-xl bg-[#FAF8F3] border border-[#D8C7A5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 sm:p-5 space-y-3">
          <div>
            <h4 className="text-sm font-bold text-[#1E2022]">{t.report.valuationTitle}</h4>
            <p className="text-xs text-[#5C6066] mt-0.5">{t.report.valuationSubtitle}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3.5 space-y-2 text-xs leading-snug">
              <div className="font-semibold text-[#9A6E2E]">{t.report.valProjectTitle}</div>
              <div className="space-y-1">
                <div className="text-[11px] text-[#5C6066]">{t.report.claimedLabel}</div>
                <div className="text-[#3A3D42]">{independentValuation.claimedProjectValue}</div>
              </div>
              <div className="pt-1.5 border-t border-[#EDE8DC] space-y-1">
                <div className="text-[11px] font-semibold text-[#1E2022]">
                  {t.report.realisticLabel}
                </div>
                <div className="font-bold text-[#1E2022] font-mono-tabular">
                  {independentValuation.realisticProjectValueRange}
                </div>
                {independentValuation.valuationMethodology && (
                  <p className="text-[11px] text-[#5C6066]">
                    {independentValuation.valuationMethodology}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3.5 space-y-2 text-xs leading-snug">
              <div className="font-semibold text-[#9A6E2E]">{t.report.valInvestmentTitle}</div>
              <div className="space-y-1">
                <div className="text-[11px] text-[#5C6066]">{t.report.claimedLabel}</div>
                <div className="text-[#3A3D42]">{independentValuation.claimedInvestment}</div>
              </div>
              <div className="pt-1.5 border-t border-[#EDE8DC] space-y-1">
                <div className="text-[11px] font-semibold text-[#1E2022]">
                  {t.report.realisticLabel}
                </div>
                <div className="font-bold text-[#9A6E2E] font-mono-tabular">
                  {independentValuation.realisticInvestmentAmount}
                </div>
                {independentValuation.investmentGapExplanation && (
                  <p className="text-[11px] text-[#5C6066]">
                    {independentValuation.investmentGapExplanation}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3.5 space-y-2 text-xs leading-snug">
              <div className="font-semibold text-[#9A6E2E]">{t.report.valPaybackTitle}</div>
              <div className="space-y-1">
                <div className="text-[11px] text-[#5C6066]">{t.report.claimedLabel}</div>
                <div className="text-[#3A3D42]">{independentValuation.claimedPayback}</div>
              </div>
              <div className="pt-1.5 border-t border-[#EDE8DC] space-y-1">
                <div className="text-[11px] font-semibold text-[#1E2022]">
                  {t.report.realisticLabel}
                </div>
                <div className="font-semibold text-[#1E2022]">
                  {t.report.valBasePayback}:{' '}
                  <span className="font-mono-tabular text-emerald-700">
                    {independentValuation.realisticPaybackBase}
                  </span>
                </div>
                <div className="font-semibold text-[#1E2022]">
                  {t.report.valStressPayback}:{' '}
                  <span className="font-mono-tabular text-rose-700">
                    {independentValuation.realisticPaybackStress}
                  </span>
                </div>
                {independentValuation.paybackComment && (
                  <p className="text-[11px] text-[#5C6066]">
                    {independentValuation.paybackComment}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Аудит жёсткого инвест-комитета */}
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 sm:p-5 space-y-3">
          <h4 className="text-sm font-bold text-[#1E2022]">{t.report.auditTitle}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(
              [
                { label: t.report.auditUnitEconomics, val: committeeAudit.unitEconomicsCheck },
                { label: t.report.auditDemand, val: committeeAudit.demandAndPainCheck },
                { label: t.report.auditMoat, val: committeeAudit.competitiveMoatCheck },
                { label: t.report.auditTeam, val: committeeAudit.teamAndSkinInTheGame },
                { label: t.report.auditStressTest, val: committeeAudit.stressTestSummary },
                { label: t.report.auditExitTranches, val: committeeAudit.exitAndTrancheLogic },
              ] as const
            ).map((cell) => (
              <div
                key={cell.label}
                className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3 space-y-1 text-xs leading-snug"
              >
                <div className="font-semibold text-[#9A6E2E]">{cell.label}</div>
                <p className="text-[#3A3D42]">{cell.val}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* КОНТУР 2: Риски и ограничения */}
      <section className="no-print space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#E5E0D5] pb-1.5">
          <h3 className="text-base sm:text-lg font-bold text-[#1E2022]">
            {t.report.contour2Title}
          </h3>
          <div className="flex flex-wrap items-center gap-1 p-0.5 rounded-lg bg-[#EAE5DB] border border-[#C9C1B2]">
            {RISK_DIMENSION_IDS.map((dimId) => (
              <button
                key={dimId}
                type="button"
                onClick={() => setRiskFilter(dimId)}
                className={`px-2 py-1 rounded-md text-xs transition-colors cursor-pointer whitespace-nowrap border ${
                  riskFilter === dimId
                    ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE] font-semibold'
                    : 'border-transparent hover:border-[#8C8476]/50 text-[#5C6066] hover:text-[#1E2022]'
                }`}
              >
                {t.report.riskTabs[dimId]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredRisks.map((risk) => {
            const sev = getSeverityMeta(risk.severity, language, true);
            return (
              <div
                key={risk.id}
                className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#5C6066] font-medium">{risk.dimensionLabel}</span>
                  <span className={`inline-flex items-center gap-1 ${sev.cls}`}>
                    {sev.icon}
                    <span>{sev.label}</span>
                  </span>
                </div>
                <h4 className="text-sm font-semibold text-[#1E2022] leading-snug">{risk.title}</h4>
                <p className="text-xs text-[#5C6066] leading-snug">{risk.description}</p>
                <div className="pt-1.5 border-t border-[#E5E0D5] text-xs leading-snug">
                  <span className="text-[#9A6E2E] font-semibold">
                    {t.report.mitigationPrefix}{' '}
                  </span>
                  <span className="text-[#3A3D42]">{risk.mitigation}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <h4 className="text-sm font-semibold text-[#1E2022]">
              {t.report.assumptionsTitle}
            </h4>
            <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-disc pl-4">
              {analysis.assumptions.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <h4 className="text-sm font-semibold text-[#1E2022]">
              {t.report.preLaunchTitle}
            </h4>
            <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-decimal pl-4">
              {analysis.preLaunchSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Правовой и регуляторный срез по региону и ОКЭД */}
        <div className="rounded-xl bg-[#FAF8F3] border border-[#D8C7A5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 sm:p-5 space-y-3 max-w-full box-border">
          <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
            <div className="inline-flex items-start gap-2 text-sm font-bold text-[#1E2022] min-w-0 max-w-full flex-1">
              <Scale className="w-4 h-4 text-[#9A6E2E] shrink-0 mt-0.5" />
              <span className="break-words [overflow-wrap:anywhere] whitespace-normal">
                {t.report.legalTitle}: {regionLabel}
              </span>
            </div>
            {(project.okedCode || legalCompliance.suggestedOkedCode) && (
              <span className="px-2.5 py-0.5 rounded bg-[#FFFFFF] border border-[#D8C7A5] font-mono-tabular text-xs font-semibold text-[#9A6E2E] break-words [overflow-wrap:anywhere] whitespace-normal max-w-full">
                ОКЭД: {project.okedCode || legalCompliance.suggestedOkedCode}
              </span>
            )}
          </div>

          <p className="text-xs text-[#3A3D42] leading-snug break-words [overflow-wrap:anywhere]">
            {legalCompliance.jurisdictionSummary}
          </p>

          {(legalCompliance.activityClassificationStatus === 'missing_suggested' ||
            legalCompliance.missingFieldsWarning) && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 sm:p-4 space-y-2.5 text-xs leading-snug max-w-full box-border">
              <div className="font-semibold text-amber-900 break-words [overflow-wrap:anywhere]">
                {t.report.legalMissingAlert}{' '}
                <span className="font-normal">{legalCompliance.missingFieldsWarning}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                <div className="rounded bg-white border border-amber-200 px-2.5 py-1.5">
                  <div className="text-[#5C6066]">{t.report.legalSuggestedScope}</div>
                  <div className="font-semibold text-[#1E2022]">
                    {legalCompliance.suggestedBusinessScope || '—'}
                  </div>
                </div>
                <div className="rounded bg-white border border-amber-200 px-2.5 py-1.5">
                  <div className="text-[#5C6066]">{t.report.legalSuggestedActivity}</div>
                  <div className="font-semibold text-[#1E2022]">
                    {legalCompliance.suggestedActivityType || '—'}
                  </div>
                </div>
                <div className="rounded bg-white border border-amber-200 px-2.5 py-1.5">
                  <div className="text-[#5C6066]">{t.report.legalSuggestedOked}</div>
                  <div className="font-mono-tabular font-semibold text-[#9A6E2E]">
                    {legalCompliance.suggestedOkedCode || '—'}
                  </div>
                </div>
              </div>
              {onUpdateProjectMeta && (
                <div>
                  <button
                    type="button"
                    disabled={appliedSuggestedMeta}
                    onClick={() => {
                      onUpdateProjectMeta({
                        businessScope:
                          project.businessScope || legalCompliance.suggestedBusinessScope,
                        activityType:
                          project.activityType || legalCompliance.suggestedActivityType,
                        okedCode: project.okedCode || legalCompliance.suggestedOkedCode,
                      });
                      setAppliedSuggestedMeta(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] disabled:opacity-70 text-[#F5F3EE] text-xs font-semibold cursor-pointer transition-colors"
                  >
                    {appliedSuggestedMeta && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    <span>
                      {appliedSuggestedMeta
                        ? t.report.legalAppliedSuggested
                        : t.report.legalApplySuggested}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {(
              [
                { label: t.report.legalTaxCode, val: legalCompliance.taxCodeChecks },
                {
                  label: t.report.legalEntrepreneurialCode,
                  val: legalCompliance.entrepreneurialCodeChecks,
                },
                { label: t.report.legalCivilCode, val: legalCompliance.civilCodeChecks },
                { label: t.report.legalCriminalCode, val: legalCompliance.criminalCodeRisks },
                {
                  label: t.report.legalLicensing,
                  val: legalCompliance.industryLicensingRequirements,
                },
              ] as const
            ).map((block) => (
              <div
                key={block.label}
                className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3 space-y-1 text-xs leading-snug"
              >
                <div className="font-semibold text-[#1E2022]">{block.label}</div>
                <p className="text-[#3A3D42]">{block.val}</p>
              </div>
            ))}

            {legalCompliance.legalStopFactors.length > 0 && (
              <div className="rounded-lg bg-rose-50/70 border border-rose-200 p-3 space-y-1 text-xs leading-snug">
                <div className="font-semibold text-rose-800">{t.report.legalStopFactors}</div>
                <ul className="list-disc pl-4 space-y-1 text-rose-900">
                  {legalCompliance.legalStopFactors.map((sf, i) => (
                    <li key={i}>{sf}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Красные флаги и неудобные вопросы основателю */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="rounded-xl bg-rose-50/60 border border-rose-200 shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-rose-900">
              <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />
              <span>{t.report.redFlagsTitle}</span>
            </div>
            <ul className="space-y-1 text-xs text-rose-900 leading-snug list-disc pl-4">
              {committeeAudit.unverifiedRedFlags.map((flag, i) => (
                <li key={i}>{flag}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-[#FAF8F3] border border-[#D8C7A5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#1E2022]">
              <HelpCircle className="w-4 h-4 text-[#9A6E2E] shrink-0" />
              <span>{t.report.hardQuestionsTitle}</span>
            </div>
            <ol className="space-y-1 text-xs text-[#3A3D42] leading-snug list-decimal pl-4">
              {committeeAudit.founderHardQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* КОНТУР 3: Рекомендации */}
      <section className="no-print space-y-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E5E0D5] pb-1.5">
          <h3 className="text-base sm:text-lg font-bold text-[#1E2022]">
            {t.report.contour3Title}
          </h3>
          <span className="text-xs text-[#5C6066]">{t.report.contour3Meta}</span>
        </div>

        <div className="rounded-xl bg-[#FFFFFF] border border-[#D8C7A5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 sm:p-5 space-y-1.5">
          <div className="text-xs font-semibold text-[#9A6E2E]">
            {t.report.recConclusionTitle}
          </div>
          <p className="text-xs sm:text-[13px] text-[#1E2022] leading-snug">
            {recommendations.analystConclusion}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <h4 className="text-sm font-semibold text-[#1E2022] leading-snug">
              {t.report.recMitigationTitle}
            </h4>
            <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-disc pl-4">
              {recommendations.riskMitigationMeasures.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <h4 className="text-sm font-semibold text-[#1E2022] leading-snug">
              {t.report.recCrisisTitle}
            </h4>
            <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-decimal pl-4">
              {recommendations.crisisAndBottleneckPlan.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 space-y-2">
            <h4 className="text-sm font-semibold text-[#1E2022] leading-snug">
              {t.report.recGrowthTitle}
            </h4>
            <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-disc pl-4">
              {recommendations.growthPlanAndMetrics.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ========================================================================
          ЧИСТАЯ ВЕРСИЯ ДЛЯ PDF-ЭКСПОРТА И ПЕЧАТИ (С ЛОГОТИПОМ, ВАЛЮТОЙ И ОБНОВЛЁННЫМИ ЦИФРАМИ)
          ======================================================================== */}
      <div
        aria-hidden="true"
        className="print-sheet-wrapper fixed -left-[99999px] top-0 w-[760px] max-w-full pointer-events-none"
      >
        <div
          ref={pdfSheetRef}
          id="pdf-export-sheet"
          className="print-only-sheet w-full max-w-full box-border bg-white text-slate-900 p-6 space-y-5 break-words [overflow-wrap:anywhere]"
          style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}
        >
          {/* Тёмная шапка меморандума для идеального контраста белого логотипа IBS */}
          <div className="print-break-avoid w-full max-w-full box-border rounded-xl bg-[#0B0F17] text-white p-5 flex items-center justify-between gap-5">
            <div className="w-48 shrink-0">
              <img
                src="/ibs_logo_transparent.png"
                alt="Intelligent Business Systems"
                className="w-full h-auto max-h-20 object-contain object-left"
              />
            </div>
            <div className="text-right min-w-0 flex-1 break-words [overflow-wrap:anywhere] whitespace-normal">
              <div className="text-xs text-amber-400 font-semibold">
                {t.report.pdfMemorandum}
              </div>
              <div className="text-lg font-bold mt-1 leading-snug">{project.projectName}</div>
              <div className="text-xs text-slate-300 mt-1 leading-snug">
                {t.report.pdfRegion}: {regionLabel} · {t.report.pdfCurrency}: {displayCurrency} (
                {displaySymbol}) · {t.report.pdfInitiator}: {project.fullName} ({project.email})
                {project.okedCode ? ` · ОКЭД: ${project.okedCode}` : ''}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                {t.report.pdfExportDate}:{' '}
                {new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'ru-RU')}
                {hasOverrides ? ` · ${t.report.pdfWithOverrides}` : ''}
              </div>
            </div>
          </div>

          {/* Вердикт комитета в печатной версии */}
          <div className="print-break-avoid w-full max-w-full box-border rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-2 font-bold text-slate-900 min-w-0">
              <span className="shrink-0">{t.report.verdictTitle}</span>
              <span className="break-words [overflow-wrap:anywhere] whitespace-normal min-w-0">
                {t.report.verdictLabels[committeeVerdict.verdict]}
              </span>
            </div>
            <p className="text-slate-700 leading-relaxed break-words [overflow-wrap:anywhere] whitespace-normal">
              {committeeVerdict.reason}
            </p>
          </div>

          {/* 6 KPI в PDF */}
          <div className="grid grid-cols-3 gap-3 w-full max-w-full">
            <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500 leading-snug">{t.report.pdfKpiCost}</div>
              <div className="text-base font-bold font-mono-tabular mt-1 break-words [overflow-wrap:anywhere]">
                {formatMoney(metrics.projectCost, displaySymbol, language)}
              </div>
            </div>
            <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500 leading-snug">{t.report.pdfKpiInvestments}</div>
              <div className="text-base font-bold font-mono-tabular text-amber-700 mt-1 break-words [overflow-wrap:anywhere]">
                {formatMoney(metrics.investmentAmount, displaySymbol, language)}
              </div>
            </div>
            <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500 leading-snug">{t.report.pdfKpiLaunch}</div>
              <div className="text-base font-bold font-mono-tabular mt-1 break-words [overflow-wrap:anywhere]">
                {metrics.launchMonths} {t.common.monthsShort}
              </div>
            </div>
            <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500 leading-snug">{t.report.pdfKpiStaff}</div>
              <div className="text-base font-bold font-mono-tabular mt-1 break-words [overflow-wrap:anywhere]">
                {metrics.headcount} {t.common.staffShort}
              </div>
            </div>
            <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500 leading-snug">{t.report.pdfKpiRevenue}</div>
              <div className="text-base font-bold font-mono-tabular mt-1 break-words [overflow-wrap:anywhere]">
                {formatMoney(metrics.monthlyRevenue, displaySymbol, language)}
              </div>
            </div>
            <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500 leading-snug">{t.report.pdfKpiPayback}</div>
              <div className="text-base font-bold font-mono-tabular text-emerald-700 mt-1 break-words [overflow-wrap:anywhere]">
                {metrics.paybackMonths
                  ? `${metrics.paybackMonths} ${t.common.monthsShort}`
                  : t.common.moreThan60Months}
              </div>
            </div>
          </div>

          {/* Контур 1 в PDF */}
          <div className="space-y-4 w-full max-w-full">
            <h2 className="print-keep-with-next text-base font-bold border-b border-slate-200 pb-1.5 break-words [overflow-wrap:anywhere]">
              {t.report.contour1Title}
            </h2>
            <p className="text-xs text-slate-700 leading-relaxed break-words [overflow-wrap:anywhere]">
              {analysis.executiveSummary}
            </p>
            <div className="print-break-avoid grid grid-cols-3 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3.5 w-full max-w-full box-border">
              <div className="min-w-0">
                <span className="text-slate-500">{t.report.pdfAnnualRevenue}: </span>
                <span className="font-mono-tabular font-semibold">
                  {formatCompactMoney(metrics.annualRevenue, displaySymbol, language)}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500">{t.report.pdfEbitdaMargin}: </span>
                <span className="font-mono-tabular font-semibold">{metrics.ebitdaMarginPct}%</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500">{t.report.pdfAnnualRoi}: </span>
                <span className="font-mono-tabular font-semibold">{metrics.roiAnnualPct}%</span>
              </div>
            </div>

            <FinancialInfographics
              language={language}
              metrics={metrics}
              costStructure={convertedCostStructure}
              currencySymbol={displaySymbol}
              theme="light"
            />

            {/* Независимая переоценка и аудит комитета в печатной версии */}
            <div className="grid grid-cols-3 gap-3 text-xs pt-2 w-full max-w-full">
              <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 space-y-1">
                <div className="font-semibold text-amber-800">{t.report.valProjectTitle}</div>
                <div className="text-slate-500">{t.report.claimedLabel}: {independentValuation.claimedProjectValue}</div>
                <div className="font-bold text-slate-900">{independentValuation.realisticProjectValueRange}</div>
              </div>
              <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 space-y-1">
                <div className="font-semibold text-amber-800">{t.report.valInvestmentTitle}</div>
                <div className="text-slate-500">{t.report.claimedLabel}: {independentValuation.claimedInvestment}</div>
                <div className="font-bold text-slate-900">{independentValuation.realisticInvestmentAmount}</div>
              </div>
              <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 space-y-1">
                <div className="font-semibold text-amber-800">{t.report.valPaybackTitle}</div>
                <div className="text-slate-500">{t.report.claimedLabel}: {independentValuation.claimedPayback}</div>
                <div className="font-bold text-slate-900">
                  {independentValuation.realisticPaybackBase} / {independentValuation.realisticPaybackStress}
                </div>
              </div>
            </div>
          </div>

          {/* Контур 2 в PDF */}
          <div className="space-y-3 pt-2 w-full max-w-full">
            <h2 className="print-keep-with-next text-base font-bold border-b border-slate-200 pb-1.5 break-words [overflow-wrap:anywhere]">
              {t.report.contour2Title}
            </h2>
            <div className="print-break-avoid w-full max-w-full box-border rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
              <div className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere] whitespace-normal">
                {t.report.legalTitle}: {regionLabel} (ОКЭД: {project.okedCode || legalCompliance.suggestedOkedCode || '—'})
              </div>
              <p className="text-slate-700 leading-relaxed break-words [overflow-wrap:anywhere] whitespace-normal">
                {legalCompliance.jurisdictionSummary}
              </p>
              {(legalCompliance.activityClassificationStatus === 'missing_suggested' ||
                legalCompliance.missingFieldsWarning) && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950 space-y-1 break-words [overflow-wrap:anywhere] whitespace-normal">
                  <div className="font-semibold">
                    {t.report.legalMissingAlert}{' '}
                    <span className="font-normal">{legalCompliance.missingFieldsWarning}</span>
                  </div>
                  <div className="text-[11px] text-slate-700">
                    {t.report.legalSuggestedScope}: {legalCompliance.suggestedBusinessScope || '—'} ·{' '}
                    {t.report.legalSuggestedActivity}: {legalCompliance.suggestedActivityType || '—'} ·{' '}
                    {t.report.legalSuggestedOked}: {legalCompliance.suggestedOkedCode || '—'}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 pt-1 text-slate-700 w-full max-w-full">
                <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                  <span className="font-semibold">{t.report.legalTaxCode}:</span> {legalCompliance.taxCodeChecks}
                </div>
                <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                  <span className="font-semibold">{t.report.legalEntrepreneurialCode}:</span> {legalCompliance.entrepreneurialCodeChecks}
                </div>
                <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                  <span className="font-semibold">{t.report.legalCivilCode}:</span> {legalCompliance.civilCodeChecks}
                </div>
                <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                  <span className="font-semibold">{t.report.legalCriminalCode}:</span> {legalCompliance.criminalCodeRisks}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-full">
              {analysis.risks.map((risk) => {
                const sev = getSeverityMeta(risk.severity, language, true);
                return (
                  <div
                    key={risk.id}
                    className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 space-y-1.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                      <span className="text-slate-500 font-medium min-w-0 break-words [overflow-wrap:anywhere]">
                        {risk.dimensionLabel}
                      </span>
                      <span className={`inline-flex items-center gap-1 shrink-0 ${sev.cls}`}>
                        {sev.icon}
                        <span>{sev.label}</span>
                      </span>
                    </div>
                    <div className="font-semibold text-slate-900 break-words [overflow-wrap:anywhere]">
                      {risk.title}
                    </div>
                    <div className="text-slate-600 leading-snug break-words [overflow-wrap:anywhere]">
                      {risk.description}
                    </div>
                    <div className="text-slate-700 pt-1.5 border-t border-slate-100 break-words [overflow-wrap:anywhere]">
                      <span className="font-semibold">{t.report.pdfMitigationShort}: </span>
                      {risk.mitigation}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 text-xs w-full max-w-full">
              <div className="print-break-avoid min-w-0">
                <div className="font-semibold mb-1">{t.report.redFlagsTitle}</div>
                <ul className="list-disc pl-4 space-y-1 text-rose-800">
                  {committeeAudit.unverifiedRedFlags.map((f, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{f}</li>
                  ))}
                </ul>
              </div>
              <div className="print-break-avoid min-w-0">
                <div className="font-semibold mb-1">{t.report.hardQuestionsTitle}</div>
                <ol className="list-decimal pl-4 space-y-1 text-slate-700">
                  {committeeAudit.founderHardQuestions.map((q, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{q}</li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 text-xs w-full max-w-full">
              <div className="print-break-avoid min-w-0">
                <div className="font-semibold mb-1">{t.report.pdfAssumptionsShort}</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {analysis.assumptions.map((a, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{a}</li>
                  ))}
                </ul>
              </div>
              <div className="print-break-avoid min-w-0">
                <div className="font-semibold mb-1">{t.report.pdfStepsShort}</div>
                <ul className="list-decimal pl-4 space-y-1 text-slate-700">
                  {analysis.preLaunchSteps.map((s, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Контур 3 в печатной версии */}
          <div className="space-y-3 pt-2 w-full max-w-full">
            <h2 className="print-keep-with-next text-base font-bold border-b border-slate-200 pb-1.5 break-words [overflow-wrap:anywhere]">
              {t.report.contour3Title}
            </h2>
            <div className="print-break-avoid w-full max-w-full box-border rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-xs">
              <div className="font-semibold text-amber-800">{t.report.recConclusionTitle}</div>
              <p className="text-slate-700 leading-relaxed break-words [overflow-wrap:anywhere]">
                {recommendations.analystConclusion}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs w-full max-w-full">
              <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 space-y-1">
                <div className="font-semibold text-slate-900">{t.report.recMitigationTitle}</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {recommendations.riskMitigationMeasures.map((m, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{m}</li>
                  ))}
                </ul>
              </div>
              <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 space-y-1">
                <div className="font-semibold text-slate-900">{t.report.recCrisisTitle}</div>
                <ul className="list-decimal pl-4 space-y-1 text-slate-700">
                  {recommendations.crisisAndBottleneckPlan.map((c, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{c}</li>
                  ))}
                </ul>
              </div>
              <div className="print-break-avoid min-w-0 box-border rounded-lg border border-slate-200 p-3.5 space-y-1">
                <div className="font-semibold text-slate-900">{t.report.recGrowthTitle}</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {recommendations.growthPlanAndMetrics.map((g, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{g}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>{t.report.pdfFooterLeft}</span>
            <span>{t.report.pdfFooterRight}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
