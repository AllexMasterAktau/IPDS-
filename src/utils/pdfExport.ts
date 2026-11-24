import { jsPDF } from 'jspdf';
import type {
  CostBreakdownItem,
  CurrencyCode,
  DerivedMetrics,
  FinancialInputs,
  Language,
  ProjectAnalysis,
  ProjectRecord,
  RiskSeverity,
} from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import {
  formatCompactMoney,
  formatMoney,
  getEffectiveRecommendations,
  getRegionDisplayLabel,
} from './financialModel';

interface SaveFilePickerWritable {
  write: (data: Blob | BufferSource | string) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}

interface SaveFilePickerHandle {
  createWritable: () => Promise<SaveFilePickerWritable>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

type ShowSaveFilePickerFn = (
  options?: SaveFilePickerOptions
) => Promise<SaveFilePickerHandle>;

export class PdfFontUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfFontUnavailableError';
  }
}

export interface PdfReportExportParams {
  project: ProjectRecord;
  analysis: ProjectAnalysis;
  effectiveInputs: FinancialInputs;
  metrics: DerivedMetrics;
  convertedCostStructure: CostBreakdownItem[];
  language: Language;
  displayCurrency: CurrencyCode;
  displaySymbol: string;
  hasOverrides: boolean;
}

interface LoadedFonts {
  regularBase64: string;
  boldBase64: string;
}

let cachedFontsPromise: Promise<LoadedFonts> | null = null;
let cachedLogoPromise: Promise<{ dataUrl: string; aspect: number } | null> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) {
    throw new PdfFontUnavailableError(`Failed to load font ${url}: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 10_000) {
    throw new PdfFontUnavailableError(`Invalid font asset ${url}`);
  }
  // Проверяем TTF signature (0x00010000 или 'true' или 'OTTO')
  const view = new DataView(buf);
  const sig = view.getUint32(0, false);
  if (sig !== 0x00010000 && sig !== 0x74727565 && sig !== 0x4f54544f) {
    throw new PdfFontUnavailableError(`Unexpected font binary format for ${url}`);
  }
  return arrayBufferToBase64(buf);
}

export function preloadPdfFonts(): Promise<LoadedFonts | null> {
  if (!cachedFontsPromise) {
    cachedFontsPromise = Promise.all([
      fetchFontBase64('/fonts/DejaVuSans.ttf'),
      fetchFontBase64('/fonts/DejaVuSans-Bold.ttf'),
    ]).then(([regularBase64, boldBase64]) => ({ regularBase64, boldBase64 }));
  }
  return cachedFontsPromise.catch(() => {
    cachedFontsPromise = null;
    return null;
  });
}

async function loadFontsOrThrow(): Promise<LoadedFonts> {
  if (!cachedFontsPromise) {
    cachedFontsPromise = Promise.all([
      fetchFontBase64('/fonts/DejaVuSans.ttf'),
      fetchFontBase64('/fonts/DejaVuSans-Bold.ttf'),
    ]).then(([regularBase64, boldBase64]) => ({ regularBase64, boldBase64 }));
  }
  try {
    return await cachedFontsPromise;
  } catch (err) {
    cachedFontsPromise = null;
    throw err instanceof PdfFontUnavailableError
      ? err
      : new PdfFontUnavailableError(
          err instanceof Error ? err.message : 'Cyrillic PDF font unavailable'
        );
  }
}

async function loadLogoPngDataUrl(): Promise<{ dataUrl: string; aspect: number } | null> {
  if (cachedLogoPromise) return cachedLogoPromise;
  cachedLogoPromise = (async () => {
    const candidates = [
      '/ibs_logo_transparent.png',
      '/assets/aistudio/ibs_logo_transparent_98656fe4.png',
    ];
    for (const src of candidates) {
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.crossOrigin = 'anonymous';
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Image load failed'));
          el.src = src;
        });
        if (!img.naturalWidth || !img.naturalHeight) continue;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(img, 0, 0);
        return {
          dataUrl: canvas.toDataURL('image/png'),
          aspect: img.naturalWidth / img.naturalHeight,
        };
      } catch {
        // try next
      }
    }
    return null;
  })();
  return cachedLogoPromise;
}

export function buildPdfFileName(projectName: string): string {
  const safeSlug =
    projectName
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'IPDS_Project';

  return `IPDS_Report_${safeSlug}.pdf`;
}

/**
 * Проверяет, что сформированный массив байтов является валидным PDF-документом
 * с заголовком `%PDF-` и закрывающим маркером `%%EOF`.
 */
export function assertValidPdfBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.length < 512) {
    throw new Error('Сформированный PDF-документ пуст или повреждён.');
  }
  const header = String.fromCharCode(
    bytes[0],
    bytes[1],
    bytes[2],
    bytes[3],
    bytes[4]
  );
  if (header !== '%PDF-') {
    throw new Error('Нарушена сигнатура PDF-файла (%PDF-).');
  }
  const tailSlice = bytes.subarray(Math.max(0, bytes.length - 64));
  const tailText = Array.from(tailSlice)
    .map((b) => String.fromCharCode(b))
    .join('');
  if (!tailText.includes('%%EOF')) {
    throw new Error('Отсутствует завершающий маркер %%EOF в PDF-документе.');
  }
}

function getSeverityColors(severity: RiskSeverity): {
  r: number;
  g: number;
  b: number;
  labelKey: 'high' | 'medium' | 'low';
} {
  if (severity === 'high') {
    return { r: 190, g: 18, b: 60, labelKey: 'high' };
  }
  if (severity === 'medium') {
    return { r: 180, g: 83, b: 9, labelKey: 'medium' };
  }
  return { r: 21, g: 128, b: 61, labelKey: 'low' };
}

/**
 * Формирует настоящий бинарный PDF-документ (`application/pdf`, `%PDF-...`)
 * с встроенным шрифтом DejaVuSans (полная поддержка кириллицы, казахского алфавита, ₽, ₸, $),
 * IBS-шапкой, KPI-карточками, векторными графиками, таблицами и обоими контурами анализа.
 */
export async function buildBinaryReportPdfBytes(
  params: PdfReportExportParams,
  injectedFonts?: LoadedFonts
): Promise<Uint8Array> {
  const {
    project,
    analysis,
    effectiveInputs,
    metrics,
    convertedCostStructure,
    language,
    displayCurrency,
    displaySymbol,
    hasOverrides,
  } = params;

  const fonts = injectedFonts ?? (await loadFontsOrThrow());
  const logoInfo =
    typeof document !== 'undefined' ? await loadLogoPngDataUrl() : null;
  const t = getTranslations(language);
  const regionLabel = getRegionDisplayLabel(
    project.region,
    project.customRegion,
    language
  );

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  pdf.addFileToVFS('DejaVuSans.ttf', fonts.regularBase64);
  pdf.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  pdf.addFileToVFS('DejaVuSans-Bold.ttf', fonts.boldBase64);
  pdf.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
  pdf.setFont('DejaVuSans', 'normal');

  const pageW = pdf.internal.pageSize.getWidth(); // 210
  const pageH = pdf.internal.pageSize.getHeight(); // 297
  const margin = 12;
  const contentW = pageW - margin * 2; // 186
  const footerReserved = 12;
  const maxY = pageH - margin - footerReserved;

  let y = margin;

  const setRegular = (size: number, color: [number, number, number] = [30, 32, 34]) => {
    pdf.setFont('DejaVuSans', 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(color[0], color[1], color[2]);
  };

  const setBold = (size: number, color: [number, number, number] = [30, 32, 34]) => {
    pdf.setFont('DejaVuSans', 'bold');
    pdf.setFontSize(size);
    pdf.setTextColor(color[0], color[1], color[2]);
  };

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > maxY) {
      pdf.addPage();
      y = margin;
    }
  };

  const drawSectionHeading = (title: string, subtitle?: string) => {
    ensureSpace(14);
    setBold(11.5, [22, 24, 26]);
    pdf.text(title, margin, y + 4);
    if (subtitle) {
      setRegular(8, [92, 96, 102]);
      pdf.text(subtitle, pageW - margin, y + 4, { align: 'right' });
    }
    y += 6.2;
    pdf.setDrawColor(216, 209, 195);
    pdf.setLineWidth(0.35);
    pdf.line(margin, y, pageW - margin, y);
    y += 4;
  };

  const wrapLines = (text: string, widthMm: number, size: number, bold = false): string[] => {
    pdf.setFont('DejaVuSans', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    return pdf.splitTextToSize(String(text || ''), widthMm) as string[];
  };

  // ---------------------------------------------------------------------------
  // 1. ТЁМНАЯ ШАПКА МЕМОРАНДУМА С ЛОГОТИПОМ IBS
  // ---------------------------------------------------------------------------
  const titleLines = wrapLines(project.projectName, 114, 13, true);
  const metaLine1 = `${t.report.pdfRegion}: ${regionLabel} · ${t.report.pdfCurrency}: ${displayCurrency} (${displaySymbol})`;
  const metaLine2 = `${t.report.pdfInitiator}: ${project.fullName} (${project.email})`;
  const exportDateStr = new Date().toLocaleDateString(
    language === 'en' ? 'en-US' : 'ru-RU'
  );
  const metaLine3 =
    `${t.report.pdfExportDate}: ${exportDateStr}` +
    (hasOverrides ? ` · ${t.report.pdfWithOverrides}` : '');

  const metaLines1 = wrapLines(metaLine1, 114, 7.8);
  const metaLines2 = wrapLines(metaLine2, 114, 7.8);
  const metaLines3 = wrapLines(metaLine3, 114, 7.5);

  const headerTextH =
    6 +
    titleLines.length * 5.2 +
    metaLines1.length * 3.6 +
    metaLines2.length * 3.6 +
    metaLines3.length * 3.5 +
    8;
  const headerH = Math.max(30, headerTextH);

  pdf.setFillColor(11, 15, 23);
  pdf.roundedRect(margin, y, contentW, headerH, 2.5, 2.5, 'F');

  if (logoInfo) {
    const maxLogoW = 54;
    const maxLogoH = headerH - 8;
    let logoW = maxLogoW;
    let logoH = logoW / logoInfo.aspect;
    if (logoH > maxLogoH) {
      logoH = maxLogoH;
      logoW = logoH * logoInfo.aspect;
    }
    const logoY = y + (headerH - logoH) / 2;
    try {
      pdf.addImage(logoInfo.dataUrl, 'PNG', margin + 5, logoY, logoW, logoH);
    } catch {
      setBold(11, [201, 155, 82]);
      pdf.text('IBS Terminal', margin + 6, y + headerH / 2);
    }
  } else {
    setBold(11, [201, 155, 82]);
    pdf.text('Intelligent Business Systems', margin + 6, y + headerH / 2);
  }

  let hy = y + 6.5;
  const rightX = pageW - margin - 5;
  setBold(8, [224, 181, 110]);
  pdf.text(t.report.pdfMemorandum, rightX, hy, { align: 'right' });
  hy += 5;

  setBold(13, [255, 255, 255]);
  for (const line of titleLines) {
    pdf.text(line, rightX, hy, { align: 'right' });
    hy += 5.2;
  }

  setRegular(7.8, [203, 213, 225]);
  for (const line of metaLines1) {
    pdf.text(line, rightX, hy, { align: 'right' });
    hy += 3.6;
  }
  for (const line of metaLines2) {
    pdf.text(line, rightX, hy, { align: 'right' });
    hy += 3.6;
  }
  setRegular(7.5, [148, 163, 184]);
  for (const line of metaLines3) {
    pdf.text(line, rightX, hy, { align: 'right' });
    hy += 3.5;
  }

  y += headerH + 5;

  // ---------------------------------------------------------------------------
  // 2. 6 KPI КАРТОЧЕК (2 РЯДА ПО 3)
  // ---------------------------------------------------------------------------
  const kpiCards: Array<{
    label: string;
    value: string;
    sub: string;
    valueColor?: [number, number, number];
  }> = [
    {
      label: t.report.pdfKpiCost,
      value: formatMoney(metrics.projectCost, displaySymbol, language),
      sub: `${t.report.kpiCostSub} ${effectiveInputs.workingCapitalReservePct}%`,
    },
    {
      label: t.report.pdfKpiInvestments,
      value: formatMoney(metrics.investmentAmount, displaySymbol, language),
      sub: t.report.kpiInvestmentsSub,
      valueColor: [154, 110, 46],
    },
    {
      label: t.report.pdfKpiLaunch,
      value: `${metrics.launchMonths} ${t.common.monthsShort}`,
      sub: t.report.kpiLaunchSub,
    },
    {
      label: t.report.pdfKpiStaff,
      value: `${metrics.headcount} ${t.common.staffShort}`,
      sub: `${t.report.kpiStaffSub} ${formatCompactMoney(
        metrics.monthlyOpex,
        displaySymbol,
        language
      )}/${t.common.monthsShort}`,
    },
    {
      label: t.report.pdfKpiRevenue,
      value: formatMoney(metrics.monthlyRevenue, displaySymbol, language),
      sub: `${t.report.kpiRevenueSub} ${formatCompactMoney(
        metrics.annualRevenue,
        displaySymbol,
        language
      )}`,
    },
    {
      label: t.report.pdfKpiPayback,
      value: metrics.paybackMonths
        ? `${metrics.paybackMonths} ${t.common.monthsShort}`
        : t.common.moreThan60Months,
      sub: t.report.kpiPaybackSub
        .replace('{margin}', String(metrics.ebitdaMarginPct))
        .replace('{roi}', String(metrics.roiAnnualPct)),
      valueColor: [21, 128, 61],
    },
  ];

  const cardGap = 3.5;
  const cardW = (contentW - cardGap * 2) / 3;
  const cardH = 19.5;
  ensureSpace(cardH * 2 + cardGap + 5);

  for (let i = 0; i < kpiCards.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = margin + col * (cardW + cardGap);
    const cy = y + row * (cardH + cardGap);
    const card = kpiCards[i];

    pdf.setFillColor(250, 248, 243);
    pdf.setDrawColor(229, 224, 213);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(cx, cy, cardW, cardH, 1.8, 1.8, 'FD');

    setRegular(7.3, [92, 96, 102]);
    pdf.text(card.label, cx + 3, cy + 4.8);

    setBold(10.5, card.valueColor || [30, 32, 34]);
    const valText = wrapLines(card.value, cardW - 6, 10.5, true)[0] || card.value;
    pdf.text(valText, cx + 3, cy + 10.8);

    setRegular(6.8, [122, 126, 133]);
    const subText = wrapLines(card.sub, cardW - 6, 6.8)[0] || '';
    pdf.text(subText, cx + 3, cy + 16);
  }

  y += cardH * 2 + cardGap + 6;

  // ---------------------------------------------------------------------------
  // 3. КОНТУР 1: ЦИФРЫ И ЭКОНОМИКА
  // ---------------------------------------------------------------------------
  drawSectionHeading(
    t.report.contour1Title,
    t.report.contour1Meta.replace('{currency}', displayCurrency)
  );

  // Резюме и Юнит-экономика
  const execLines = wrapLines(analysis.executiveSummary, contentW - 8, 8.6);
  const unitLines = wrapLines(analysis.unitEconomicsSummary, contentW - 8, 8.2);
  const summaryBoxH =
    7 +
    execLines.length * 3.9 +
    (unitLines.length > 0 ? 3 + unitLines.length * 3.7 : 0) +
    4;
  ensureSpace(summaryBoxH + 4);

  pdf.setFillColor(250, 248, 243);
  pdf.setDrawColor(229, 224, 213);
  pdf.roundedRect(margin, y, contentW, summaryBoxH, 2, 2, 'FD');

  let sy = y + 5;
  setBold(8, [154, 110, 46]);
  pdf.text(t.report.execSummaryTitle, margin + 4, sy);
  sy += 4.3;

  setRegular(8.6, [30, 32, 34]);
  for (const line of execLines) {
    pdf.text(line, margin + 4, sy);
    sy += 3.9;
  }

  if (unitLines.length > 0) {
    sy += 1;
    pdf.setDrawColor(229, 224, 213);
    pdf.line(margin + 4, sy, pageW - margin - 4, sy);
    sy += 3.5;
    setRegular(8.2, [92, 96, 102]);
    for (const line of unitLines) {
      pdf.text(line, margin + 4, sy);
      sy += 3.7;
    }
  }
  y += summaryBoxH + 4;

  // Строка сводных коэффициентов (Годовая выручка, EBITDA, ROI)
  ensureSpace(12);
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(margin, y, contentW, 9.5, 1.5, 1.5, 'FD');

  const thirdW = contentW / 3;
  const ratioItems = [
    {
      k: t.report.pdfAnnualRevenue,
      v: formatCompactMoney(metrics.annualRevenue, displaySymbol, language),
    },
    { k: t.report.pdfEbitdaMargin, v: `${metrics.ebitdaMarginPct}%` },
    { k: t.report.pdfAnnualRoi, v: `${metrics.roiAnnualPct}%` },
  ];
  for (let i = 0; i < ratioItems.length; i++) {
    const rx = margin + i * thirdW + 4;
    setRegular(7.8, [100, 116, 139]);
    const labelStr = `${ratioItems[i].k}: `;
    pdf.text(labelStr, rx, y + 6);
    const labelW = pdf.getTextWidth(labelStr);
    setBold(8.2, [15, 23, 42]);
    pdf.text(ratioItems[i].v, rx + labelW, y + 6);
  }
  y += 13;

  // ---------------------------------------------------------------------------
  // 4. ВЕКТОРНЫЕ ГРАФИКИ: НАКОПЛЕННЫЙ ДЕНЕЖНЫЙ ПОТОК И ЕЖЕМЕСЯЧНАЯ ЭКОНОМИКА
  // ---------------------------------------------------------------------------
  const chartBlockH = 58;
  ensureSpace(chartBlockH + 4);

  const leftChartW = 107;
  const rightChartW = contentW - leftChartW - 4;
  const rightChartX = margin + leftChartW + 4;

  // Левая карточка: график денежного потока (24 мес.)
  pdf.setFillColor(250, 248, 243);
  pdf.setDrawColor(229, 224, 213);
  pdf.roundedRect(margin, y, leftChartW, chartBlockH, 2, 2, 'FD');

  setBold(8.5, [30, 32, 34]);
  pdf.text(t.charts.cashflowTitle, margin + 3.5, y + 5.2);
  setRegular(7, [92, 96, 102]);
  const paybackShort = metrics.paybackMonths
    ? `${metrics.paybackMonths} ${t.common.monthsShort}`
    : t.common.moreThan60Months;
  pdf.text(
    `${t.charts.launchLabel}: ${metrics.launchMonths} ${t.common.monthsShort} · ${t.charts.paybackPointLabel}: ${paybackShort}`,
    margin + 3.5,
    y + 9.2
  );

  const series = metrics.cashflowSeries.slice(0, 24);
  const plotX = margin + 17;
  const plotY = y + 14;
  const plotW = leftChartW - 21;
  const plotH = 34;

  const vals = series.map((p) => p.cumulativeCashflow);
  const minVal = Math.min(0, ...vals);
  const maxVal = Math.max(1, ...vals);
  const valRange = Math.max(1, maxVal - minVal);

  const xAt = (idx: number) =>
    plotX + (series.length > 1 ? (idx / (series.length - 1)) * plotW : 0);
  const yAt = (v: number) => plotY + ((maxVal - v) / valRange) * plotH;

  // Горизонтальная сетка
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    const gy = plotY + ratio * plotH;
    const gv = maxVal - ratio * valRange;
    pdf.setDrawColor(229, 224, 213);
    pdf.setLineWidth(0.2);
    pdf.line(plotX, gy, plotX + plotW, gy);
    setRegular(6.2, [100, 105, 112]);
    pdf.text(formatCompactMoney(gv, '', language).trim(), plotX - 1.5, gy + 1, {
      align: 'right',
    });
  }

  // Линия нуля (точка безубыточности)
  const zeroY = yAt(0);
  pdf.setDrawColor(122, 126, 133);
  pdf.setLineWidth(0.35);
  pdf.line(plotX, zeroY, plotX + plotW, zeroY);

  // Линия накопленного денежного потока
  if (series.length > 1) {
    pdf.setDrawColor(184, 139, 74);
    pdf.setLineWidth(0.75);
    for (let i = 0; i < series.length - 1; i++) {
      pdf.line(
        xAt(i),
        yAt(series[i].cumulativeCashflow),
        xAt(i + 1),
        yAt(series[i + 1].cumulativeCashflow)
      );
    }
  }

  // Точка окупаемости
  const paybackIdx = series.findIndex((p) => p.month === metrics.paybackMonths);
  if (paybackIdx >= 0) {
    const px = xAt(paybackIdx);
    const py = yAt(series[paybackIdx].cumulativeCashflow);
    pdf.setFillColor(21, 128, 61);
    pdf.circle(px, py, 1.3, 'F');
    setBold(6.5, [21, 128, 61]);
    pdf.text(
      `${t.common.monthPrefix}${metrics.paybackMonths}`,
      Math.min(plotX + plotW - 10, px + 2),
      Math.max(plotY + 3, py - 2)
    );
  }

  // Подписи оси X
  setRegular(6.2, [92, 96, 102]);
  for (let i = 0; i < series.length; i++) {
    if (i === 0 || (i + 1) % 6 === 0 || i === series.length - 1) {
      pdf.text(series[i].label, xAt(i), plotY + plotH + 4.2, { align: 'center' });
    }
  }

  // Правая карточка: ежемесячная экономика и структура CAPEX
  pdf.setFillColor(250, 248, 243);
  pdf.setDrawColor(229, 224, 213);
  pdf.roundedRect(rightChartX, y, rightChartW, chartBlockH, 2, 2, 'FD');

  setBold(8.5, [30, 32, 34]);
  pdf.text(t.charts.balanceTitle, rightChartX + 3.5, y + 5.2);

  const maxBar = Math.max(1, metrics.monthlyRevenue, metrics.monthlyOpex);
  const bars = [
    {
      label: t.charts.monthlyRevenue,
      valText: formatCompactMoney(metrics.monthlyRevenue, displaySymbol, language),
      pct: Math.min(1, metrics.monthlyRevenue / maxBar),
      color: [184, 139, 74] as [number, number, number],
    },
    {
      label: t.charts.monthlyOpex.replace('{count}', String(metrics.headcount)),
      valText: formatCompactMoney(metrics.monthlyOpex, displaySymbol, language),
      pct: Math.min(1, metrics.monthlyOpex / maxBar),
      color: [31, 33, 36] as [number, number, number],
    },
    {
      label: t.charts.monthlyProfit,
      valText: `${formatCompactMoney(metrics.monthlyProfit, displaySymbol, language)} (${metrics.ebitdaMarginPct}%)`,
      pct: Math.min(1, Math.max(0.04, Math.max(0, metrics.monthlyProfit) / maxBar)),
      color:
        metrics.monthlyProfit >= 0
          ? ([21, 128, 61] as [number, number, number])
          : ([190, 18, 60] as [number, number, number]),
    },
  ];

  let by = y + 10.5;
  const barTrackW = rightChartW - 7;
  for (const b of bars) {
    setRegular(6.8, [92, 96, 102]);
    const truncatedLabel = wrapLines(b.label, barTrackW - 24, 6.8)[0] || b.label;
    pdf.text(truncatedLabel, rightChartX + 3.5, by);
    setBold(6.8, [30, 32, 34]);
    pdf.text(b.valText, rightChartX + rightChartW - 3.5, by, { align: 'right' });

    by += 1.6;
    pdf.setFillColor(229, 224, 213);
    pdf.rect(rightChartX + 3.5, by, barTrackW, 2.2, 'F');
    pdf.setFillColor(b.color[0], b.color[1], b.color[2]);
    pdf.rect(rightChartX + 3.5, by, Math.max(1.5, barTrackW * b.pct), 2.2, 'F');
    by += 5.8;
  }

  // Мини-полоса структуры CAPEX
  pdf.setDrawColor(229, 224, 213);
  pdf.line(rightChartX + 3.5, by, rightChartX + rightChartW - 3.5, by);
  by += 4;
  setBold(7.5, [30, 32, 34]);
  pdf.text(t.charts.capexStructure, rightChartX + 3.5, by);
  by += 2.2;

  const capexPalette: [number, number, number][] = [
    [184, 139, 74],
    [31, 33, 36],
    [75, 107, 130],
    [126, 120, 107],
    [172, 165, 150],
  ];
  const topCosts = convertedCostStructure.slice(0, 5);
  const totalShare = Math.max(
    1,
    topCosts.reduce((s, item) => s + (item.sharePct || 0), 0)
  );
  let segX = rightChartX + 3.5;
  for (let i = 0; i < topCosts.length; i++) {
    const segW = ((topCosts[i].sharePct || 0) / totalShare) * barTrackW;
    const col = capexPalette[i % capexPalette.length];
    pdf.setFillColor(col[0], col[1], col[2]);
    pdf.rect(segX, by, Math.max(0.8, segW), 2.4, 'F');
    segX += segW;
  }
  by += 5.4;
  for (let i = 0; i < Math.min(3, topCosts.length); i++) {
    const item = topCosts[i];
    const col = capexPalette[i % capexPalette.length];
    pdf.setFillColor(col[0], col[1], col[2]);
    pdf.rect(rightChartX + 3.5, by - 1.8, 2, 2, 'F');
    setRegular(6.4, [58, 61, 66]);
    const catStr = wrapLines(item.category, barTrackW - 14, 6.4)[0] || item.category;
    pdf.text(catStr, rightChartX + 6.5, by);
    setBold(6.4, [30, 32, 34]);
    pdf.text(`${item.sharePct}%`, rightChartX + rightChartW - 3.5, by, {
      align: 'right',
    });
    by += 3.5;
  }

  y += chartBlockH + 5;

  // ---------------------------------------------------------------------------
  // 5. ТАБЛИЦА СТРУКТУРЫ ИНВЕСТИЦИЙ И ДРАЙВЕРЫ ВЫРУЧКИ
  // ---------------------------------------------------------------------------
  ensureSpace(22);
  setBold(9.5, [30, 32, 34]);
  pdf.text(t.report.costTableTitle, margin, y + 3.5);
  y += 6;

  // Заголовок таблицы
  pdf.setFillColor(239, 236, 228);
  pdf.setDrawColor(229, 224, 213);
  pdf.rect(margin, y, contentW, 6.5, 'FD');
  setBold(7.6, [58, 61, 66]);
  pdf.text(t.report.colCategory, margin + 3, y + 4.4);
  pdf.text(t.report.colAmount, pageW - margin - 24, y + 4.4, { align: 'right' });
  pdf.text(t.report.colShare, pageW - margin - 3, y + 4.4, { align: 'right' });
  y += 6.5;

  for (const item of convertedCostStructure) {
    const catLines = wrapLines(item.category, 118, 8, true);
    const noteLines = item.note ? wrapLines(item.note, 118, 7.1) : [];
    const rowH = Math.max(8, 3.5 + catLines.length * 3.6 + noteLines.length * 3.2 + 2);
    ensureSpace(rowH);

    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(237, 232, 220);
    pdf.rect(margin, y, contentW, rowH, 'FD');

    let ry = y + 4.2;
    setBold(8, [30, 32, 34]);
    for (const line of catLines) {
      pdf.text(line, margin + 3, ry);
      ry += 3.6;
    }
    setRegular(7.1, [92, 96, 102]);
    for (const line of noteLines) {
      pdf.text(line, margin + 3, ry);
      ry += 3.2;
    }

    setRegular(8, [30, 32, 34]);
    pdf.text(
      formatMoney(item.amount, displaySymbol, language),
      pageW - margin - 24,
      y + 4.5,
      { align: 'right' }
    );
    setBold(8, [154, 110, 46]);
    pdf.text(`${item.sharePct}%`, pageW - margin - 3, y + 4.5, { align: 'right' });

    y += rowH;
  }

  y += 5;

  // Драйверы выручки
  if (analysis.revenueDrivers.length > 0) {
    ensureSpace(14);
    setBold(9.5, [30, 32, 34]);
    pdf.text(t.report.driversTitle, margin, y + 3.5);
    y += 6;

    for (const driver of analysis.revenueDrivers) {
      const dLines = wrapLines(`• ${driver}`, contentW - 4, 8.2);
      ensureSpace(dLines.length * 3.8 + 2);
      setRegular(8.2, [58, 61, 66]);
      for (const line of dLines) {
        pdf.text(line, margin + 2, y + 3);
        y += 3.8;
      }
      y += 0.8;
    }
    y += 4;
  }

  // ---------------------------------------------------------------------------
  // 6. КОНТУР 2: РИСКИ И ОГРАНИЧЕНИЯ
  // ---------------------------------------------------------------------------
  drawSectionHeading(t.report.contour2Title);

  for (const risk of analysis.risks) {
    const sev = getSeverityColors(risk.severity);
    const sevLabel = t.report.severity[sev.labelKey];
    const rTitleLines = wrapLines(risk.title, contentW - 8, 8.6, true);
    const rDescLines = wrapLines(risk.description, contentW - 8, 7.8);
    const mitText = `${t.report.pdfMitigationShort}: ${risk.mitigation}`;
    const rMitLines = wrapLines(mitText, contentW - 8, 7.8);

    const riskCardH =
      8.5 +
      rTitleLines.length * 3.8 +
      rDescLines.length * 3.5 +
      rMitLines.length * 3.5 +
      4;
    ensureSpace(riskCardH + 3);

    pdf.setFillColor(250, 248, 243);
    pdf.setDrawColor(229, 224, 213);
    pdf.roundedRect(margin, y, contentW, riskCardH, 1.8, 1.8, 'FD');

    let ry = y + 4.8;
    setBold(7.4, [92, 96, 102]);
    pdf.text(risk.dimensionLabel, margin + 4, ry);
    setBold(7.4, [sev.r, sev.g, sev.b]);
    pdf.text(sevLabel, pageW - margin - 4, ry, { align: 'right' });
    ry += 4.3;

    setBold(8.6, [15, 23, 42]);
    for (const line of rTitleLines) {
      pdf.text(line, margin + 4, ry);
      ry += 3.8;
    }

    setRegular(7.8, [71, 85, 105]);
    for (const line of rDescLines) {
      pdf.text(line, margin + 4, ry);
      ry += 3.5;
    }

    ry += 1;
    pdf.setDrawColor(229, 224, 213);
    pdf.line(margin + 4, ry, pageW - margin - 4, ry);
    ry += 3.4;

    setRegular(7.8, [51, 65, 85]);
    for (const line of rMitLines) {
      pdf.text(line, margin + 4, ry);
      ry += 3.5;
    }

    y += riskCardH + 3;
  }

  // Ключевые допущения и приоритетные шаги
  const renderBulletSection = (heading: string, items: string[], numbered = false) => {
    if (!items || items.length === 0) return;
    ensureSpace(14);
    setBold(9.2, [30, 32, 34]);
    pdf.text(heading, margin, y + 4);
    y += 6.5;

    for (let i = 0; i < items.length; i++) {
      const prefix = numbered ? `${i + 1}. ` : '• ';
      const lines = wrapLines(`${prefix}${items[i]}`, contentW - 4, 8);
      ensureSpace(lines.length * 3.7 + 1.5);
      setRegular(8, [58, 61, 66]);
      for (const line of lines) {
        pdf.text(line, margin + 2, y + 3);
        y += 3.7;
      }
      y += 0.8;
    }
    y += 3;
  };

  renderBulletSection(t.report.pdfAssumptionsShort, analysis.assumptions, false);
  renderBulletSection(t.report.pdfStepsShort, analysis.preLaunchSteps, true);

  // ---------------------------------------------------------------------------
  // 7. КОНТУР 3: РЕКОМЕНДАЦИИ
  // ---------------------------------------------------------------------------
  const recommendations = getEffectiveRecommendations(analysis, metrics, language);
  drawSectionHeading(t.report.contour3Title, t.report.contour3Meta);

  const recConcLines = wrapLines(recommendations.analystConclusion, contentW - 8, 8.4);
  const recConcBoxH = 9 + recConcLines.length * 3.8 + 4;
  ensureSpace(recConcBoxH + 4);

  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(216, 199, 165);
  pdf.setLineWidth(0.35);
  pdf.roundedRect(margin, y, contentW, recConcBoxH, 2, 2, 'FD');

  let rcy = y + 5;
  setBold(8, [154, 110, 46]);
  pdf.text(t.report.recConclusionTitle, margin + 4, rcy);
  rcy += 4.3;
  setRegular(8.4, [30, 32, 34]);
  for (const line of recConcLines) {
    pdf.text(line, margin + 4, rcy);
    rcy += 3.8;
  }
  y += recConcBoxH + 4;

  renderBulletSection(
    t.report.recMitigationTitle,
    recommendations.riskMitigationMeasures,
    false
  );
  renderBulletSection(
    t.report.recCrisisTitle,
    recommendations.crisisAndBottleneckPlan,
    true
  );
  renderBulletSection(
    t.report.recGrowthTitle,
    recommendations.growthPlanAndMetrics,
    false
  );

  // ---------------------------------------------------------------------------
  // 8. КОЛОНТИТУЛЫ НА ВСЕХ СТРАНИЦАХ
  // ---------------------------------------------------------------------------
  const totalPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    const fy = pageH - 8;
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.25);
    pdf.line(margin, fy - 3.5, pageW - margin, fy - 3.5);
    setRegular(7.2, [100, 116, 139]);
    pdf.text(t.report.pdfFooterLeft, margin, fy);
    pdf.text(`${t.report.pdfFooterRight}  ·  ${p} / ${totalPages}`, pageW - margin, fy, {
      align: 'right',
    });
  }

  const arrayBuffer = pdf.output('arraybuffer');
  const bytes = new Uint8Array(arrayBuffer);
  assertValidPdfBytes(bytes);
  return bytes;
}

function triggerStandardPdfDownload(pdfBlob: Blob, fileName: string): void {
  const url = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    try {
      document.body.removeChild(link);
    } catch {
      // ignore
    }
    URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * Экспорт отчёта в настоящий бинарный PDF-файл (`application/pdf`, `%PDF-...`).
 * 1) Формирует и валидирует байты PDF до обращения к файловой системе (исключает 0-байтные битые файлы).
 * 2) По возможности открывает `window.showSaveFilePicker` для выбора пути и имени.
 * 3) При отмене, отсутствии API или ограничении iframe выполняет стандартное скачивание с `.pdf` именем.
 */
export async function exportReportToPdf(
  params: PdfReportExportParams
): Promise<void> {
  const fileName = buildPdfFileName(params.project.projectName);
  const pdfBytes = await buildBinaryReportPdfBytes(params);
  assertValidPdfBytes(pdfBytes);

  const pdfBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

  if (typeof window !== 'undefined') {
    const pickerFn = (
      window as Window & { showSaveFilePicker?: ShowSaveFilePickerFn }
    ).showSaveFilePicker;
    if (typeof pickerFn === 'function') {
      try {
        const fileHandle = await pickerFn({
          suggestedName: fileName,
          types: [
            {
              description: 'PDF Document',
              accept: { 'application/pdf': ['.pdf'] },
            },
          ],
        });

        let writable: SaveFilePickerWritable | null = null;
        try {
          writable = await fileHandle.createWritable();
          await writable.write(pdfBlob);
          await writable.close();
          return;
        } catch {
          try {
            await writable?.abort?.();
          } catch {
            // ignore abort cleanup errors
          }
        }
      } catch {
        // Пользователь отменил выбор, либо среда (iframe / expired user gesture) ограничила showSaveFilePicker —
        // выполняем стандартное скачивание валидного PDF без ошибок и зависаний.
      }
    }
  }

  triggerStandardPdfDownload(pdfBlob, fileName);
}
