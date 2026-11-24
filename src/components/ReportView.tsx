import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Printer,
  RotateCcw,
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
  getEffectiveInputs,
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
  onRunAnalysis,
  analyzing = false,
}) => {
  const t = getTranslations(language);
  const [riskFilter, setRiskFilter] = useState<'all' | RiskDimension>('all');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void preloadPdfFonts();
  }, []);

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

  if (!analysis || !effectiveInputs || !metrics || !recommendations) {
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
        <div>
          {isStandaloneWindow && (
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-[#9A6E2E] hover:text-[#7B551F] font-medium mb-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.report.backToTerminal}</span>
            </a>
          )}
          <div className="text-xs text-[#5C6066] leading-snug">
            {regionLabel} · {displayCurrency} ({displaySymbol}) · {t.report.initiator}:{' '}
            {project.fullName}
            {hasOverrides ? ` · ${t.report.manuallyRecalculated}` : ''}
            {fxNoteText}
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-[#1E2022] leading-snug mt-0.5">
            {project.projectName}
          </h2>
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
        className="fixed -left-[99999px] top-0 w-[920px] pointer-events-none"
      >
        <div
          ref={pdfSheetRef}
          id="pdf-export-sheet"
          className="print-only-sheet bg-white text-slate-900 p-8 space-y-6"
          style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}
        >
          {/* Тёмная шапка меморандума для идеального контраста белого логотипа IBS */}
          <div className="rounded-xl bg-[#0B0F17] text-white p-6 flex items-center justify-between gap-6">
            <div className="w-60 shrink-0">
              <img
                src="/ibs_logo_transparent.png"
                alt="Intelligent Business Systems"
                className="w-full h-auto max-h-20 object-contain object-left"
              />
            </div>
            <div className="text-right">
              <div className="text-xs text-amber-400 font-semibold">
                {t.report.pdfMemorandum}
              </div>
              <div className="text-lg font-bold mt-1">{project.projectName}</div>
              <div className="text-xs text-slate-300 mt-1">
                {t.report.pdfRegion}: {regionLabel} · {t.report.pdfCurrency}: {displayCurrency} (
                {displaySymbol}) · {t.report.pdfInitiator}: {project.fullName} ({project.email})
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {t.report.pdfExportDate}:{' '}
                {new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'ru-RU')}
                {hasOverrides ? ` · ${t.report.pdfWithOverrides}` : ''}
              </div>
            </div>
          </div>

          {/* 6 KPI в PDF */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500">{t.report.pdfKpiCost}</div>
              <div className="text-base font-bold font-mono-tabular mt-1">
                {formatMoney(metrics.projectCost, displaySymbol, language)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500">{t.report.pdfKpiInvestments}</div>
              <div className="text-base font-bold font-mono-tabular text-amber-700 mt-1">
                {formatMoney(metrics.investmentAmount, displaySymbol, language)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500">{t.report.pdfKpiLaunch}</div>
              <div className="text-base font-bold font-mono-tabular mt-1">
                {metrics.launchMonths} {t.common.monthsShort}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500">{t.report.pdfKpiStaff}</div>
              <div className="text-base font-bold font-mono-tabular mt-1">
                {metrics.headcount} {t.common.staffShort}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500">{t.report.pdfKpiRevenue}</div>
              <div className="text-base font-bold font-mono-tabular mt-1">
                {formatMoney(metrics.monthlyRevenue, displaySymbol, language)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50">
              <div className="text-[11px] text-slate-500">{t.report.pdfKpiPayback}</div>
              <div className="text-base font-bold font-mono-tabular text-emerald-700 mt-1">
                {metrics.paybackMonths
                  ? `${metrics.paybackMonths} ${t.common.monthsShort}`
                  : t.common.moreThan60Months}
              </div>
            </div>
          </div>

          {/* Контур 1 в PDF */}
          <div className="space-y-4">
            <h2 className="text-base font-bold border-b border-slate-200 pb-1.5">
              {t.report.contour1Title}
            </h2>
            <p className="text-xs text-slate-700 leading-relaxed">{analysis.executiveSummary}</p>
            <div className="grid grid-cols-3 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div>
                <span className="text-slate-500">{t.report.pdfAnnualRevenue}: </span>
                <span className="font-mono-tabular font-semibold">
                  {formatCompactMoney(metrics.annualRevenue, displaySymbol, language)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">{t.report.pdfEbitdaMargin}: </span>
                <span className="font-mono-tabular font-semibold">{metrics.ebitdaMarginPct}%</span>
              </div>
              <div>
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
          </div>

          {/* Контур 2 в PDF */}
          <div className="space-y-3 pt-2">
            <h2 className="text-base font-bold border-b border-slate-200 pb-1.5">
              {t.report.contour2Title}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {analysis.risks.map((risk) => {
                const sev = getSeverityMeta(risk.severity, language, true);
                return (
                  <div
                    key={risk.id}
                    className="rounded-lg border border-slate-200 p-3 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-medium">{risk.dimensionLabel}</span>
                      <span className={`inline-flex items-center gap-1 ${sev.cls}`}>
                        {sev.icon}
                        <span>{sev.label}</span>
                      </span>
                    </div>
                    <div className="font-semibold text-slate-900">{risk.title}</div>
                    <div className="text-slate-600 leading-snug">{risk.description}</div>
                    <div className="text-slate-700 pt-1 border-t border-slate-100">
                      <span className="font-semibold">{t.report.pdfMitigationShort}: </span>
                      {risk.mitigation}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
              <div>
                <div className="font-semibold mb-1">{t.report.pdfAssumptionsShort}</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {analysis.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-1">{t.report.pdfStepsShort}</div>
                <ul className="list-decimal pl-4 space-y-1 text-slate-700">
                  {analysis.preLaunchSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Контур 3 в печатной версии */}
          <div className="space-y-3 pt-2">
            <h2 className="text-base font-bold border-b border-slate-200 pb-1.5">
              {t.report.contour3Title}
            </h2>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 text-xs">
              <div className="font-semibold text-amber-800">{t.report.recConclusionTitle}</div>
              <p className="text-slate-700 leading-snug">{recommendations.analystConclusion}</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 p-3 space-y-1">
                <div className="font-semibold text-slate-900">{t.report.recMitigationTitle}</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {recommendations.riskMitigationMeasures.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 space-y-1">
                <div className="font-semibold text-slate-900">{t.report.recCrisisTitle}</div>
                <ul className="list-decimal pl-4 space-y-1 text-slate-700">
                  {recommendations.crisisAndBottleneckPlan.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 space-y-1">
                <div className="font-semibold text-slate-900">{t.report.recGrowthTitle}</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {recommendations.growthPlanAndMetrics.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
            <span>{t.report.pdfFooterLeft}</span>
            <span>{t.report.pdfFooterRight}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
