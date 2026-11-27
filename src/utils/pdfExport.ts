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
  getEffectiveCommitteeAudit,
  getEffectiveCommitteeVerdict,
  getEffectiveIndependentValuation,
  getEffectiveLegalCompliance,
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
  const margin = 15; // 15 мм поля страницы со всех сторон
  const contentW = pageW - margin * 2; // 180 мм
  const footerReserved = 13;
  const maxY = pageH - margin - footerReserved;
  const boxPadX = 5;
  const boxPadY = 4.5;
  const boxInnerW = contentW - boxPadX * 2; // 170 мм

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

  /**
   * Жёсткий перенос строк: гарантирует, что ни одна строка (включая длинные ОКЭД,
   * регионы, URL или непрерывные слова без пробелов) не выйдет за maxWidthMm.
   */
  const wrapLines = (
    text: string,
    maxWidthMm: number,
    size: number,
    bold = false
  ): string[] => {
    pdf.setFont('DejaVuSans', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const safeW = Math.max(8, maxWidthMm);
    const normalized = String(text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .trim();
    if (!normalized) return [];

    const rawLines = pdf.splitTextToSize(normalized, safeW) as string[];
    const result: string[] = [];

    for (const rawLine of rawLines) {
      if (pdf.getTextWidth(rawLine) <= safeW + 0.05) {
        result.push(rawLine);
        continue;
      }
      // Принудительно дробим слишком длинный токен посимвольно
      let chunk = '';
      for (const ch of rawLine) {
        const candidate = chunk + ch;
        if (chunk && pdf.getTextWidth(candidate) > safeW) {
          result.push(chunk);
          chunk = ch === ' ' ? '' : ch;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) result.push(chunk);
    }

    return result;
  };

  const drawWrappedTextAt = (
    lines: string[],
    x: number,
    startY: number,
    lineHeight: number,
    align: 'left' | 'right' = 'left'
  ): number => {
    let cursor = startY;
    for (const line of lines) {
      pdf.text(line, x, cursor, align === 'right' ? { align: 'right' } : undefined);
      cursor += lineHeight;
    }
    return cursor;
  };

  const drawSectionHeading = (title: string, subtitle?: string) => {
    const titleLines = wrapLines(title, contentW, 11.2, true);
    setBold(11.2, [22, 24, 26]);
    const singleTitleW =
      titleLines.length === 1 ? pdf.getTextWidth(titleLines[0]) : contentW;

    let subLines: string[] = [];
    let subFitsInline = false;
    if (subtitle) {
      setRegular(7.8, [92, 96, 102]);
      const rawSubW = pdf.getTextWidth(subtitle);
      if (titleLines.length === 1 && singleTitleW + rawSubW <= contentW - 6) {
        subFitsInline = true;
      } else {
        subLines = wrapLines(subtitle, contentW, 7.8, false);
      }
    }

    const neededH =
      4 +
      titleLines.length * 4.8 +
      (subFitsInline ? 0 : subLines.length * 3.5) +
      10;
    ensureSpace(neededH);

    let hyCursor = y + 4;
    setBold(11.2, [22, 24, 26]);
    for (const line of titleLines) {
      pdf.text(line, margin, hyCursor);
      hyCursor += 4.8;
    }

    if (subtitle) {
      setRegular(7.8, [92, 96, 102]);
      if (subFitsInline) {
        pdf.text(subtitle, pageW - margin, y + 4, { align: 'right' });
      } else {
        for (const line of subLines) {
          pdf.text(line, margin, hyCursor);
          hyCursor += 3.5;
        }
      }
    }

    const lineY = hyCursor + 0.8;
    pdf.setDrawColor(216, 209, 195);
    pdf.setLineWidth(0.35);
    pdf.line(margin, lineY, pageW - margin, lineY);
    y = lineY + 4;
  };

  interface StyledSegment {
    lines: string[];
    size: number;
    bold: boolean;
    color: [number, number, number];
    lineHeight: number;
    spaceBefore?: number;
    dividerBefore?: boolean;
  }

  /**
   * Рисует карточку с рамкой и внутренними отступами.
   * Небольшие карточки держатся целиком (`break-inside: avoid`),
   * а сверхдлинные блоки аккуратно переносятся по страницам без обрезки.
   */
  const drawCardWithSegments = (
    segments: StyledSegment[],
    fill: [number, number, number],
    border: [number, number, number],
    radius = 1.8,
    gapAfter = 3
  ) => {
    const calcHeight = (segs: StyledSegment[]) => {
      let h = boxPadY * 2;
      for (const s of segs) {
        if (s.dividerBefore) h += 3;
        if (s.spaceBefore) h += s.spaceBefore;
        h += s.lines.length * s.lineHeight;
      }
      return h;
    };

    if (segments.every((s) => s.lines.length === 0)) return;

    const totalH = calcHeight(segments);
    const maxSinglePageH = maxY - margin - 2;

    if (totalH <= maxSinglePageH) {
      ensureSpace(totalH + gapAfter);
      pdf.setFillColor(fill[0], fill[1], fill[2]);
      pdf.setDrawColor(border[0], border[1], border[2]);
      pdf.setLineWidth(0.35);
      pdf.roundedRect(margin, y, contentW, totalH, radius, radius, 'FD');

      let cy = y + boxPadY + 2.6;
      for (const seg of segments) {
        if (seg.dividerBefore) {
          cy += 0.6;
          pdf.setDrawColor(border[0], border[1], border[2]);
          pdf.setLineWidth(0.25);
          pdf.line(margin + boxPadX, cy, pageW - margin - boxPadX, cy);
          cy += 2.6;
        }
        if (seg.spaceBefore) cy += seg.spaceBefore;
        if (seg.bold) {
          setBold(seg.size, seg.color);
        } else {
          setRegular(seg.size, seg.color);
        }
        cy = drawWrappedTextAt(seg.lines, margin + boxPadX, cy, seg.lineHeight);
      }

      y += totalH + gapAfter;
      return;
    }

    // Сверхдлинный блок: разбиваем построчно по страницам с рамкой на каждом фрагменте
    interface FlatLine {
      text: string;
      size: number;
      bold: boolean;
      color: [number, number, number];
      lineHeight: number;
      spaceBefore: number;
      dividerBefore: boolean;
    }
    const flat: FlatLine[] = [];
    for (const seg of segments) {
      seg.lines.forEach((line, idx) => {
        flat.push({
          text: line,
          size: seg.size,
          bold: seg.bold,
          color: seg.color,
          lineHeight: seg.lineHeight,
          spaceBefore: idx === 0 ? seg.spaceBefore || 0 : 0,
          dividerBefore: idx === 0 ? Boolean(seg.dividerBefore) : false,
        });
      });
    }

    let i = 0;
    while (i < flat.length) {
      const avail = maxY - y;
      if (avail < boxPadY * 2 + 10) {
        pdf.addPage();
        y = margin;
      }
      const chunkStart = i;
      let chunkH = boxPadY * 2;
      while (i < flat.length) {
        const item = flat[i];
        const extra =
          (item.dividerBefore ? 3.2 : 0) + item.spaceBefore + item.lineHeight;
        if (i > chunkStart && y + chunkH + extra > maxY) {
          break;
        }
        chunkH += extra;
        i += 1;
      }

      pdf.setFillColor(fill[0], fill[1], fill[2]);
      pdf.setDrawColor(border[0], border[1], border[2]);
      pdf.setLineWidth(0.35);
      pdf.roundedRect(margin, y, contentW, chunkH, radius, radius, 'FD');

      let cy = y + boxPadY + 2.6;
      for (let k = chunkStart; k < i; k++) {
        const item = flat[k];
        if (item.dividerBefore) {
          cy += 0.6;
          pdf.setDrawColor(border[0], border[1], border[2]);
          pdf.setLineWidth(0.25);
          pdf.line(margin + boxPadX, cy, pageW - margin - boxPadX, cy);
          cy += 2.6;
        }
        if (item.spaceBefore) cy += item.spaceBefore;
        if (item.bold) {
          setBold(item.size, item.color);
        } else {
          setRegular(item.size, item.color);
        }
        pdf.text(item.text, margin + boxPadX, cy);
        cy += item.lineHeight;
      }

      y += chunkH + (i < flat.length ? 3 : gapAfter);
      if (i < flat.length) {
        pdf.addPage();
        y = margin;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 1. ТЁМНАЯ ШАПКА МЕМОРАНДУМА С ЛОГОТИПОМ IBS
  // ---------------------------------------------------------------------------
  const headerRightMaxW = contentW - 64; // ~116 мм, левая зона 54 мм под логотип
  const memoLines = wrapLines(t.report.pdfMemorandum, headerRightMaxW, 8, true);
  const titleLines = wrapLines(project.projectName, headerRightMaxW, 12.5, true);
  const metaLine1 =
    `${t.report.pdfRegion}: ${regionLabel} · ${t.report.pdfCurrency}: ${displayCurrency} (${displaySymbol})` +
    (project.okedCode ? ` · ОКЭД: ${project.okedCode}` : '');
  const metaLine2 = `${t.report.pdfInitiator}: ${project.fullName} (${project.email})`;
  const exportDateStr = new Date().toLocaleDateString(
    language === 'en' ? 'en-US' : 'ru-RU'
  );
  const metaLine3 =
    `${t.report.pdfExportDate}: ${exportDateStr}` +
    (hasOverrides ? ` · ${t.report.pdfWithOverrides}` : '');

  const metaLines1 = wrapLines(metaLine1, headerRightMaxW, 7.6);
  const metaLines2 = wrapLines(metaLine2, headerRightMaxW, 7.6);
  const metaLines3 = wrapLines(metaLine3, headerRightMaxW, 7.3);

  const headerTextH =
    6 +
    memoLines.length * 4 +
    titleLines.length * 5 +
    metaLines1.length * 3.5 +
    metaLines2.length * 3.5 +
    metaLines3.length * 3.4 +
    6;
  const headerH = Math.max(30, headerTextH);

  pdf.setFillColor(11, 15, 23);
  pdf.roundedRect(margin, y, contentW, headerH, 2.5, 2.5, 'F');

  if (logoInfo) {
    const maxLogoW = 48;
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
      const fbLines = wrapLines('IBS Terminal', 48, 10.5, true);
      setBold(10.5, [201, 155, 82]);
      drawWrappedTextAt(fbLines, margin + 5, y + headerH / 2, 4.5);
    }
  } else {
    const fbLines = wrapLines('Intelligent Business Systems', 48, 10, true);
    setBold(10, [201, 155, 82]);
    drawWrappedTextAt(fbLines, margin + 5, y + headerH / 2 - 2, 4.4);
  }

  let hy = y + 6.5;
  const rightX = pageW - margin - 5;
  setBold(8, [224, 181, 110]);
  hy = drawWrappedTextAt(memoLines, rightX, hy, 4, 'right');
  hy += 0.8;

  setBold(12.5, [255, 255, 255]);
  hy = drawWrappedTextAt(titleLines, rightX, hy, 5, 'right');

  setRegular(7.6, [203, 213, 225]);
  hy = drawWrappedTextAt(metaLines1, rightX, hy, 3.5, 'right');
  hy = drawWrappedTextAt(metaLines2, rightX, hy, 3.5, 'right');
  setRegular(7.3, [148, 163, 184]);
  drawWrappedTextAt(metaLines3, rightX, hy, 3.4, 'right');

  y += headerH + 5;

  // ---------------------------------------------------------------------------
  // 1B. ВЕРДИКТ ЖЁСТКОГО ИНВЕСТ-КОМИТЕТА (ЖЁЛТАЯ/ЦВЕТНАЯ РАМКА С ЗАПАСОМ ОТСТУПОВ)
  // ---------------------------------------------------------------------------
  const committeeVerdict = getEffectiveCommitteeVerdict(analysis, metrics, language);
  const independentValuation = getEffectiveIndependentValuation(
    analysis,
    metrics,
    displaySymbol,
    language
  );
  const committeeAudit = getEffectiveCommitteeAudit(analysis, metrics, language);
  const legalCompliance = getEffectiveLegalCompliance(project, analysis, language);

  const verdictLabel = t.report.verdictLabels[committeeVerdict.verdict];
  const verdictBg: [number, number, number] =
    committeeVerdict.verdict === 'GO'
      ? [236, 253, 245]
      : committeeVerdict.verdict === 'NO_GO'
      ? [255, 241, 242]
      : [255, 251, 235];
  const verdictBorder: [number, number, number] =
    committeeVerdict.verdict === 'GO'
      ? [110, 231, 183]
      : committeeVerdict.verdict === 'NO_GO'
      ? [253, 164, 175]
      : [252, 211, 77];
  const verdictAccent: [number, number, number] =
    committeeVerdict.verdict === 'GO'
      ? [6, 95, 70]
      : committeeVerdict.verdict === 'NO_GO'
      ? [159, 18, 57]
      : [146, 64, 14];

  drawCardWithSegments(
    [
      {
        lines: wrapLines(`${t.report.verdictTitle}: ${verdictLabel}`, boxInnerW, 8.2, true),
        size: 8.2,
        bold: true,
        color: verdictAccent,
        lineHeight: 3.9,
      },
      {
        lines: wrapLines(String(committeeVerdict.reason || '—'), boxInnerW, 8, false),
        size: 8,
        bold: false,
        color: [30, 32, 34],
        lineHeight: 3.7,
        spaceBefore: 1,
      },
    ],
    verdictBg,
    verdictBorder,
    1.8,
    4.5
  );

  // ---------------------------------------------------------------------------
  // 2. 6 KPI КАРТОЧЕК (2 РЯДА ПО 3, АВТОПЕРЕНОС И ЕДИНАЯ ВЫСОТА РЯДА)
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
  const cardPadX = 3.8;
  const cardInnerW = cardW - cardPadX * 2;

  for (let row = 0; row < 2; row++) {
    const rowItems = kpiCards.slice(row * 3, row * 3 + 3).map((card) => {
      const labelLines = wrapLines(card.label, cardInnerW, 7.1, false);
      const valueLines = wrapLines(card.value, cardInnerW, 9.8, true);
      const subLines = wrapLines(card.sub, cardInnerW, 6.7, false);
      const neededH =
        4 +
        labelLines.length * 3.1 +
        1 +
        valueLines.length * 4.4 +
        1 +
        subLines.length * 2.9 +
        3;
      return { card, labelLines, valueLines, subLines, neededH };
    });

    const rowH = Math.max(21, ...rowItems.map((it) => it.neededH));
    ensureSpace(rowH + cardGap + 2);

    rowItems.forEach((item, col) => {
      const cx = margin + col * (cardW + cardGap);
      const cy = y;
      pdf.setFillColor(250, 248, 243);
      pdf.setDrawColor(229, 224, 213);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(cx, cy, cardW, rowH, 1.8, 1.8, 'FD');

      let kpy = cy + 4.4;
      setRegular(7.1, [92, 96, 102]);
      kpy = drawWrappedTextAt(item.labelLines, cx + cardPadX, kpy, 3.1);
      kpy += 1;

      setBold(9.8, item.card.valueColor || [30, 32, 34]);
      kpy = drawWrappedTextAt(item.valueLines, cx + cardPadX, kpy, 4.4);
      kpy += 0.6;

      setRegular(6.7, [122, 126, 133]);
      drawWrappedTextAt(item.subLines, cx + cardPadX, kpy, 2.9);
    });

    y += rowH + cardGap;
  }

  y += 3;

  // ---------------------------------------------------------------------------
  // 3. КОНТУР 1: ЦИФРЫ И ЭКОНОМИКА
  // ---------------------------------------------------------------------------
  drawSectionHeading(
    t.report.contour1Title,
    t.report.contour1Meta.replace('{currency}', displayCurrency)
  );

  // Резюме и Юнит-экономика
  const execSegments: StyledSegment[] = [
    {
      lines: wrapLines(t.report.execSummaryTitle, boxInnerW, 8, true),
      size: 8,
      bold: true,
      color: [154, 110, 46],
      lineHeight: 3.8,
    },
    {
      lines: wrapLines(analysis.executiveSummary, boxInnerW, 8.5, false),
      size: 8.5,
      bold: false,
      color: [30, 32, 34],
      lineHeight: 3.9,
      spaceBefore: 0.8,
    },
  ];
  const unitLines = wrapLines(analysis.unitEconomicsSummary, boxInnerW, 8.1, false);
  if (unitLines.length > 0) {
    execSegments.push({
      lines: unitLines,
      size: 8.1,
      bold: false,
      color: [92, 96, 102],
      lineHeight: 3.7,
      dividerBefore: true,
    });
  }
  drawCardWithSegments(execSegments, [250, 248, 243], [229, 224, 213], 2, 4);

  // Строка сводных коэффициентов (Годовая выручка, EBITDA, ROI)
  const thirdW = contentW / 3;
  const ratioCellInnerW = thirdW - 8;
  const ratioItems = [
    {
      k: t.report.pdfAnnualRevenue,
      v: formatCompactMoney(metrics.annualRevenue, displaySymbol, language),
    },
    { k: t.report.pdfEbitdaMargin, v: `${metrics.ebitdaMarginPct}%` },
    { k: t.report.pdfAnnualRoi, v: `${metrics.roiAnnualPct}%` },
  ].map((it) => {
    const kLines = wrapLines(`${it.k}:`, ratioCellInnerW, 7.4, false);
    const vLines = wrapLines(it.v, ratioCellInnerW, 8.2, true);
    return { ...it, kLines, vLines };
  });
  const ratioH = Math.max(
    11,
    3.5 +
      Math.max(
        ...ratioItems.map((it) => it.kLines.length * 3.3 + it.vLines.length * 3.8)
      ) +
      2
  );
  ensureSpace(ratioH + 4);
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(margin, y, contentW, ratioH, 1.5, 1.5, 'FD');

  for (let i = 0; i < ratioItems.length; i++) {
    const rx = margin + i * thirdW + 4;
    let ryCursor = y + 4.4;
    setRegular(7.4, [100, 116, 139]);
    ryCursor = drawWrappedTextAt(ratioItems[i].kLines, rx, ryCursor, 3.3);
    setBold(8.2, [15, 23, 42]);
    drawWrappedTextAt(ratioItems[i].vLines, rx, ryCursor + 0.3, 3.8);
  }
  y += ratioH + 4;

  // ---------------------------------------------------------------------------
  // 4. ВЕКТОРНЫЕ ГРАФИКИ: НАКОПЛЕННЫЙ ДЕНЕЖНЫЙ ПОТОК И ЕЖЕМЕСЯЧНАЯ ЭКОНОМИКА
  // ---------------------------------------------------------------------------
  const leftChartW = 104;
  const rightChartW = contentW - leftChartW - 4;
  const rightChartX = margin + leftChartW + 4;

  const leftTitleLines = wrapLines(t.charts.cashflowTitle, leftChartW - 8, 8.3, true);
  const paybackShort = metrics.paybackMonths
    ? `${metrics.paybackMonths} ${t.common.monthsShort}`
    : t.common.moreThan60Months;
  const leftSubLines = wrapLines(
    `${t.charts.launchLabel}: ${metrics.launchMonths} ${t.common.monthsShort} · ${t.charts.paybackPointLabel}: ${paybackShort}`,
    leftChartW - 8,
    6.8
  );
  const leftHeaderH = 4.5 + leftTitleLines.length * 3.8 + leftSubLines.length * 3.1 + 2;

  const rightTitleLines = wrapLines(t.charts.balanceTitle, rightChartW - 8, 8.3, true);
  const barTrackW = rightChartW - 8;

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
  ].map((b) => {
    setBold(6.7, [30, 32, 34]);
    const valW = pdf.getTextWidth(b.valText);
    const labelMaxW = Math.max(18, barTrackW - valW - 2.5);
    const labelLines = wrapLines(b.label, labelMaxW, 6.7, false).slice(0, 2);
    return { ...b, labelLines };
  });

  const capexTitleLines = wrapLines(t.charts.capexStructure, barTrackW, 7.4, true);
  const topCosts = convertedCostStructure.slice(0, 5);
  const capexLegendRows = topCosts.slice(0, 3).map((item) => {
    const shareStr = `${item.sharePct}%`;
    setBold(6.3, [30, 32, 34]);
    const shareW = pdf.getTextWidth(shareStr);
    const catLines = wrapLines(item.category, barTrackW - shareW - 6, 6.3, false).slice(0, 1);
    return { shareStr, catLine: catLines[0] || '' };
  });

  const rightNeededH =
    5 +
    rightTitleLines.length * 3.8 +
    2 +
    bars.reduce((s, b) => s + b.labelLines.length * 3 + 4.4, 0) +
    3.5 +
    capexTitleLines.length * 3.4 +
    4.5 +
    capexLegendRows.length * 3.6 +
    3;

  const chartBlockH = Math.max(60, leftHeaderH + 41, rightNeededH);
  ensureSpace(chartBlockH + 4);

  // Левая карточка: график денежного потока (24 мес.)
  pdf.setFillColor(250, 248, 243);
  pdf.setDrawColor(229, 224, 213);
  pdf.roundedRect(margin, y, leftChartW, chartBlockH, 2, 2, 'FD');

  let lcy = y + 5;
  setBold(8.3, [30, 32, 34]);
  lcy = drawWrappedTextAt(leftTitleLines, margin + 4, lcy, 3.8);
  setRegular(6.8, [92, 96, 102]);
  lcy = drawWrappedTextAt(leftSubLines, margin + 4, lcy, 3.1);

  const series = metrics.cashflowSeries.slice(0, 24);
  const plotX = margin + 17;
  const plotY = Math.max(y + 15, lcy + 2);
  const plotW = leftChartW - 22;
  const plotH = Math.max(26, chartBlockH - (plotY - y) - 9);

  const vals = series.map((p) => p.cumulativeCashflow);
  const minVal = Math.min(0, ...vals);
  const maxVal = Math.max(1, ...vals);
  const valRange = Math.max(1, maxVal - minVal);

  const xAt = (idx: number) =>
    plotX + (series.length > 1 ? (idx / (series.length - 1)) * plotW : 0);
  const yAt = (v: number) => plotY + ((maxVal - v) / valRange) * plotH;

  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    const gy = plotY + ratio * plotH;
    const gv = maxVal - ratio * valRange;
    pdf.setDrawColor(229, 224, 213);
    pdf.setLineWidth(0.2);
    pdf.line(plotX, gy, plotX + plotW, gy);
    setRegular(6.1, [100, 105, 112]);
    pdf.text(formatCompactMoney(gv, '', language).trim(), plotX - 1.5, gy + 1, {
      align: 'right',
    });
  }

  const zeroY = yAt(0);
  pdf.setDrawColor(122, 126, 133);
  pdf.setLineWidth(0.35);
  pdf.line(plotX, zeroY, plotX + plotW, zeroY);

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

  const paybackIdx = series.findIndex((p) => p.month === metrics.paybackMonths);
  if (paybackIdx >= 0) {
    const px = xAt(paybackIdx);
    const py = yAt(series[paybackIdx].cumulativeCashflow);
    pdf.setFillColor(21, 128, 61);
    pdf.circle(px, py, 1.3, 'F');
    const pbText = `${t.common.monthPrefix}${metrics.paybackMonths}`;
    setBold(6.4, [21, 128, 61]);
    const pbW = pdf.getTextWidth(pbText);
    const pbX = Math.max(plotX, Math.min(plotX + plotW - pbW - 0.5, px + 2));
    pdf.text(pbText, pbX, Math.max(plotY + 3, py - 2));
  }

  setRegular(6.1, [92, 96, 102]);
  for (let i = 0; i < series.length; i++) {
    if (i === 0 || (i + 1) % 6 === 0 || i === series.length - 1) {
      pdf.text(series[i].label, xAt(i), plotY + plotH + 4.2, { align: 'center' });
    }
  }

  // Правая карточка: ежемесячная экономика и структура CAPEX
  pdf.setFillColor(250, 248, 243);
  pdf.setDrawColor(229, 224, 213);
  pdf.roundedRect(rightChartX, y, rightChartW, chartBlockH, 2, 2, 'FD');

  let by = y + 5;
  setBold(8.3, [30, 32, 34]);
  by = drawWrappedTextAt(rightTitleLines, rightChartX + 4, by, 3.8);
  by += 1.2;

  for (const b of bars) {
    const rowTopY = by;
    setRegular(6.7, [92, 96, 102]);
    by = drawWrappedTextAt(b.labelLines, rightChartX + 4, by, 3);
    setBold(6.7, [30, 32, 34]);
    pdf.text(b.valText, rightChartX + rightChartW - 4, rowTopY, { align: 'right' });

    by += 0.5;
    pdf.setFillColor(229, 224, 213);
    pdf.rect(rightChartX + 4, by, barTrackW, 2.2, 'F');
    pdf.setFillColor(b.color[0], b.color[1], b.color[2]);
    pdf.rect(rightChartX + 4, by, Math.max(1.5, barTrackW * b.pct), 2.2, 'F');
    by += 4.6;
  }

  pdf.setDrawColor(229, 224, 213);
  pdf.line(rightChartX + 4, by - 0.8, rightChartX + rightChartW - 4, by - 0.8);
  by += 2.8;
  setBold(7.4, [30, 32, 34]);
  by = drawWrappedTextAt(capexTitleLines, rightChartX + 4, by, 3.4);
  by += 0.6;

  const capexPalette: [number, number, number][] = [
    [184, 139, 74],
    [31, 33, 36],
    [75, 107, 130],
    [126, 120, 107],
    [172, 165, 150],
  ];
  const totalShare = Math.max(
    1,
    topCosts.reduce((s, item) => s + (item.sharePct || 0), 0)
  );
  let segX = rightChartX + 4;
  for (let i = 0; i < topCosts.length; i++) {
    const segW = ((topCosts[i].sharePct || 0) / totalShare) * barTrackW;
    const col = capexPalette[i % capexPalette.length];
    pdf.setFillColor(col[0], col[1], col[2]);
    pdf.rect(segX, by, Math.max(0.8, segW), 2.4, 'F');
    segX += segW;
  }
  by += 5.2;
  for (let i = 0; i < capexLegendRows.length; i++) {
    const row = capexLegendRows[i];
    const col = capexPalette[i % capexPalette.length];
    pdf.setFillColor(col[0], col[1], col[2]);
    pdf.rect(rightChartX + 4, by - 1.8, 2, 2, 'F');
    setRegular(6.3, [58, 61, 66]);
    pdf.text(row.catLine, rightChartX + 7, by);
    setBold(6.3, [30, 32, 34]);
    pdf.text(row.shareStr, rightChartX + rightChartW - 4, by, {
      align: 'right',
    });
    by += 3.5;
  }

  y += chartBlockH + 5;

  // ---------------------------------------------------------------------------
  // 5. ТАБЛИЦА СТРУКТУРЫ ИНВЕСТИЦИЙ И ДРАЙВЕРЫ ВЫРУЧКИ
  // ---------------------------------------------------------------------------
  const costTitleLines = wrapLines(t.report.costTableTitle, contentW, 9.5, true);
  ensureSpace(14 + costTitleLines.length * 4.2);
  setBold(9.5, [30, 32, 34]);
  y = drawWrappedTextAt(costTitleLines, margin, y + 3.5, 4.2) + 1.5;

  const colCatMaxW = contentW - 64; // 116 мм
  const colAmountRightX = pageW - margin - 20;
  const colShareRightX = pageW - margin - 3.5;

  const drawCostTableHeader = () => {
    pdf.setFillColor(239, 236, 228);
    pdf.setDrawColor(229, 224, 213);
    pdf.rect(margin, y, contentW, 6.5, 'FD');
    setBold(7.5, [58, 61, 66]);
    pdf.text(t.report.colCategory, margin + 3.5, y + 4.4);
    pdf.text(t.report.colAmount, colAmountRightX, y + 4.4, { align: 'right' });
    pdf.text(t.report.colShare, colShareRightX, y + 4.4, { align: 'right' });
    y += 6.5;
  };

  drawCostTableHeader();

  for (const item of convertedCostStructure) {
    const catLines = wrapLines(item.category, colCatMaxW, 8, true);
    const noteLines = item.note ? wrapLines(item.note, colCatMaxW, 7.1) : [];
    const amountLines = wrapLines(
      formatMoney(item.amount, displaySymbol, language),
      38,
      7.8,
      false
    );
    const textH = catLines.length * 3.6 + noteLines.length * 3.2;
    const amtH = amountLines.length * 3.6;
    const rowH = Math.max(8.5, 3.8 + Math.max(textH, amtH) + 2);

    if (y + rowH > maxY) {
      pdf.addPage();
      y = margin;
      drawCostTableHeader();
    }

    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(237, 232, 220);
    pdf.rect(margin, y, contentW, rowH, 'FD');

    let ry = y + 4.3;
    setBold(8, [30, 32, 34]);
    ry = drawWrappedTextAt(catLines, margin + 3.5, ry, 3.6);
    setRegular(7.1, [92, 96, 102]);
    drawWrappedTextAt(noteLines, margin + 3.5, ry, 3.2);

    setRegular(7.8, [30, 32, 34]);
    drawWrappedTextAt(amountLines, colAmountRightX, y + 4.5, 3.6, 'right');
    setBold(8, [154, 110, 46]);
    pdf.text(`${item.sharePct}%`, colShareRightX, y + 4.5, { align: 'right' });

    y += rowH;
  }

  y += 5;

  // Драйверы выручки
  if (analysis.revenueDrivers.length > 0) {
    const drvHeadLines = wrapLines(t.report.driversTitle, contentW, 9.5, true);
    ensureSpace(12 + drvHeadLines.length * 4.2);
    setBold(9.5, [30, 32, 34]);
    y = drawWrappedTextAt(drvHeadLines, margin, y + 3.5, 4.2) + 1.5;

    for (const driver of analysis.revenueDrivers) {
      const dLines = wrapLines(`• ${String(driver || '')}`, contentW - 6, 8.1);
      if (dLines.length === 0) continue;
      ensureSpace(3 + dLines.length * 3.8);
      setRegular(8.1, [58, 61, 66]);
      y = drawWrappedTextAt(dLines, margin + 3, y + 3, 3.8) - 2.2;
    }
    y += 4;
  }

  // ---------------------------------------------------------------------------
  // 5B. НЕЗАВИСИМАЯ ПЕРЕОЦЕНКА ТЕРМИНАЛА И АУДИТ ЖЁСТКОГО ИНВЕСТ-КОМИТЕТА
  // ---------------------------------------------------------------------------
  const valHeadLines = wrapLines(t.report.valuationTitle, contentW, 9.8, true);
  ensureSpace(16 + valHeadLines.length * 4.3);
  setBold(9.8, [30, 32, 34]);
  y = drawWrappedTextAt(valHeadLines, margin, y + 3.5, 4.3) + 1.8;

  const valRows = [
    {
      title: t.report.valProjectTitle,
      claimed: `${t.report.claimedLabel}: ${String(independentValuation.claimedProjectValue || '—')}`,
      realistic: `${t.report.realisticLabel}: ${String(independentValuation.realisticProjectValueRange || '—')}`,
      note: String(independentValuation.valuationMethodology || ''),
    },
    {
      title: t.report.valInvestmentTitle,
      claimed: `${t.report.claimedLabel}: ${String(independentValuation.claimedInvestment || '—')}`,
      realistic: `${t.report.realisticLabel}: ${String(independentValuation.realisticInvestmentAmount || '—')}`,
      note: String(independentValuation.investmentGapExplanation || ''),
    },
    {
      title: t.report.valPaybackTitle,
      claimed: `${t.report.claimedLabel}: ${String(independentValuation.claimedPayback || '—')}`,
      realistic: `${t.report.valBasePayback}: ${String(independentValuation.realisticPaybackBase || '—')} · ${t.report.valStressPayback}: ${String(independentValuation.realisticPaybackStress || '—')}`,
      note: String(independentValuation.paybackComment || ''),
    },
  ];

  for (const row of valRows) {
    const segs: StyledSegment[] = [
      {
        lines: wrapLines(String(row.title || '—'), boxInnerW, 8.1, true),
        size: 8.1,
        bold: true,
        color: [154, 110, 46],
        lineHeight: 3.7,
      },
      {
        lines: wrapLines(row.claimed, boxInnerW, 7.7, false),
        size: 7.7,
        bold: false,
        color: [92, 96, 102],
        lineHeight: 3.4,
        spaceBefore: 0.6,
      },
      {
        lines: wrapLines(row.realistic, boxInnerW, 8, true),
        size: 8,
        bold: true,
        color: [30, 32, 34],
        lineHeight: 3.6,
        spaceBefore: 0.4,
      },
    ];
    if (row.note) {
      segs.push({
        lines: wrapLines(row.note, boxInnerW, 7.4, false),
        size: 7.4,
        bold: false,
        color: [92, 96, 102],
        lineHeight: 3.3,
        spaceBefore: 0.4,
      });
    }
    drawCardWithSegments(segs, [255, 255, 255], [216, 199, 165], 1.6, 2.5);
  }

  y += 2;
  const auditHeadLines = wrapLines(t.report.auditTitle, contentW, 9.5, true);
  ensureSpace(14 + auditHeadLines.length * 4.2);
  setBold(9.5, [30, 32, 34]);
  y = drawWrappedTextAt(auditHeadLines, margin, y + 3.5, 4.2) + 1.8;

  const auditItems = [
    { label: t.report.auditUnitEconomics, val: committeeAudit.unitEconomicsCheck },
    { label: t.report.auditDemand, val: committeeAudit.demandAndPainCheck },
    { label: t.report.auditMoat, val: committeeAudit.competitiveMoatCheck },
    { label: t.report.auditTeam, val: committeeAudit.teamAndSkinInTheGame },
    { label: t.report.auditStressTest, val: committeeAudit.stressTestSummary },
    { label: t.report.auditExitTranches, val: committeeAudit.exitAndTrancheLogic },
  ];

  for (const item of auditItems) {
    drawCardWithSegments(
      [
        {
          lines: wrapLines(String(item.label || '—'), boxInnerW, 7.8, true),
          size: 7.8,
          bold: true,
          color: [154, 110, 46],
          lineHeight: 3.6,
        },
        {
          lines: wrapLines(String(item.val || '—'), boxInnerW, 7.8, false),
          size: 7.8,
          bold: false,
          color: [30, 32, 34],
          lineHeight: 3.5,
          spaceBefore: 0.6,
        },
      ],
      [250, 248, 243],
      [229, 224, 213],
      1.5,
      2
    );
  }

  y += 3;

  // ---------------------------------------------------------------------------
  // 6. КОНТУР 2: РИСКИ И ОГРАНИЧЕНИЯ + ПРАВОВОЙ СРЕЗ ПО РЕГИОНУ
  // ---------------------------------------------------------------------------
  drawSectionHeading(t.report.contour2Title);

  const okedStr = String(project.okedCode || legalCompliance.suggestedOkedCode || '—');
  const scopeStr = String(project.businessScope || legalCompliance.suggestedBusinessScope || '—');
  const activityStr = String(project.activityType || legalCompliance.suggestedActivityType || '—');

  const legalHeadingLines = wrapLines(
    `${t.report.legalTitle}: ${regionLabel} (ОКЭД: ${okedStr})`,
    contentW,
    9.2,
    true
  );
  ensureSpace(legalHeadingLines.length * 4.2 + 12);
  setBold(9.2, [30, 32, 34]);
  y = drawWrappedTextAt(legalHeadingLines, margin, y + 3.5, 4.2) + 1.8;

  const legalSummaryText = `${String(legalCompliance.jurisdictionSummary || '')} | ${t.dialogue.labelBusinessScope}: ${scopeStr} | ${t.dialogue.labelActivityType}: ${activityStr}`;
  drawCardWithSegments(
    [
      {
        lines: wrapLines(legalSummaryText, boxInnerW, 7.8, false),
        size: 7.8,
        bold: false,
        color: [30, 32, 34],
        lineHeight: 3.5,
      },
    ],
    [250, 248, 243],
    [216, 199, 165],
    1.6,
    2.5
  );

  if (
    legalCompliance.activityClassificationStatus === 'missing_suggested' ||
    legalCompliance.missingFieldsWarning
  ) {
    const warnSegments: StyledSegment[] = [
      {
        lines: wrapLines(
          `${t.report.legalMissingAlert} ${legalCompliance.missingFieldsWarning || ''}`,
          boxInnerW,
          7.6,
          true
        ),
        size: 7.6,
        bold: true,
        color: [146, 64, 14],
        lineHeight: 3.5,
      },
      {
        lines: wrapLines(
          `${t.report.legalSuggestedScope}: ${legalCompliance.suggestedBusinessScope || '—'} · ${t.report.legalSuggestedActivity}: ${legalCompliance.suggestedActivityType || '—'} · ${t.report.legalSuggestedOked}: ${legalCompliance.suggestedOkedCode || '—'}`,
          boxInnerW,
          7.5,
          false
        ),
        size: 7.5,
        bold: false,
        color: [58, 61, 66],
        lineHeight: 3.4,
        spaceBefore: 1,
      },
    ];
    drawCardWithSegments(warnSegments, [255, 251, 235], [252, 211, 77], 1.6, 2.5);
  }

  const legalCodeBlocks = [
    { label: t.report.legalTaxCode, val: legalCompliance.taxCodeChecks },
    { label: t.report.legalEntrepreneurialCode, val: legalCompliance.entrepreneurialCodeChecks },
    { label: t.report.legalCivilCode, val: legalCompliance.civilCodeChecks },
    { label: t.report.legalCriminalCode, val: legalCompliance.criminalCodeRisks },
    { label: t.report.legalLicensing, val: legalCompliance.industryLicensingRequirements },
  ];
  for (const block of legalCodeBlocks) {
    drawCardWithSegments(
      [
        {
          lines: wrapLines(String(block.label || '—'), boxInnerW, 7.7, true),
          size: 7.7,
          bold: true,
          color: [30, 32, 34],
          lineHeight: 3.5,
        },
        {
          lines: wrapLines(String(block.val || '—'), boxInnerW, 7.7, false),
          size: 7.7,
          bold: false,
          color: [58, 61, 66],
          lineHeight: 3.4,
          spaceBefore: 0.6,
        },
      ],
      [255, 255, 255],
      [229, 224, 213],
      1.4,
      1.8
    );
  }
  y += 2;

  for (const risk of analysis.risks) {
    const sev = getSeverityColors(risk.severity);
    const sevLabel = t.report.severity[sev.labelKey];
    setBold(7.4, [sev.r, sev.g, sev.b]);
    const sevW = pdf.getTextWidth(sevLabel);
    const dimLines = wrapLines(
      String(risk.dimensionLabel || ''),
      Math.max(40, boxInnerW - sevW - 6),
      7.4,
      true
    );
    const rTitleLines = wrapLines(risk.title, boxInnerW, 8.5, true);
    const rDescLines = wrapLines(risk.description, boxInnerW, 7.8);
    const mitText = `${t.report.pdfMitigationShort}: ${risk.mitigation}`;
    const rMitLines = wrapLines(mitText, boxInnerW, 7.8);

    const riskCardH =
      boxPadY * 2 +
      dimLines.length * 3.4 +
      1 +
      rTitleLines.length * 3.8 +
      0.8 +
      rDescLines.length * 3.5 +
      3 +
      rMitLines.length * 3.5;

    if (riskCardH <= maxY - margin - 2) {
      ensureSpace(riskCardH + 3);
      pdf.setFillColor(250, 248, 243);
      pdf.setDrawColor(229, 224, 213);
      pdf.setLineWidth(0.35);
      pdf.roundedRect(margin, y, contentW, riskCardH, 1.8, 1.8, 'FD');

      let ry = y + boxPadY + 2.5;
      setBold(7.4, [92, 96, 102]);
      const headerTopY = ry;
      ry = drawWrappedTextAt(dimLines, margin + boxPadX, ry, 3.4);
      setBold(7.4, [sev.r, sev.g, sev.b]);
      pdf.text(sevLabel, pageW - margin - boxPadX, headerTopY, { align: 'right' });

      ry += 0.8;
      setBold(8.5, [15, 23, 42]);
      ry = drawWrappedTextAt(rTitleLines, margin + boxPadX, ry, 3.8);

      ry += 0.4;
      setRegular(7.8, [71, 85, 105]);
      ry = drawWrappedTextAt(rDescLines, margin + boxPadX, ry, 3.5);

      ry += 0.6;
      pdf.setDrawColor(229, 224, 213);
      pdf.line(margin + boxPadX, ry, pageW - margin - boxPadX, ry);
      ry += 2.8;

      setRegular(7.8, [51, 65, 85]);
      drawWrappedTextAt(rMitLines, margin + boxPadX, ry, 3.5);

      y += riskCardH + 3;
    } else {
      drawCardWithSegments(
        [
          {
            lines: wrapLines(`${risk.dimensionLabel} · ${sevLabel}`, boxInnerW, 7.4, true),
            size: 7.4,
            bold: true,
            color: [sev.r, sev.g, sev.b],
            lineHeight: 3.4,
          },
          {
            lines: rTitleLines,
            size: 8.5,
            bold: true,
            color: [15, 23, 42],
            lineHeight: 3.8,
            spaceBefore: 0.6,
          },
          {
            lines: rDescLines,
            size: 7.8,
            bold: false,
            color: [71, 85, 105],
            lineHeight: 3.5,
            spaceBefore: 0.4,
          },
          {
            lines: rMitLines,
            size: 7.8,
            bold: false,
            color: [51, 65, 85],
            lineHeight: 3.5,
            dividerBefore: true,
          },
        ],
        [250, 248, 243],
        [229, 224, 213],
        1.8,
        3
      );
    }
  }

  // Ключевые допущения, стоп-факторы и приоритетные шаги
  const renderBulletSection = (heading: string, items: string[], numbered = false) => {
    if (!items || items.length === 0) return;
    const headLines = wrapLines(heading, contentW, 9.2, true);
    const firstPrefix = numbered ? '1. ' : '• ';
    const firstLines = wrapLines(`${firstPrefix}${items[0]}`, contentW - 6, 8);
    // Удерживаем заголовок вместе с первым пунктом
    ensureSpace(headLines.length * 4.1 + firstLines.length * 3.7 + 6);

    setBold(9.2, [30, 32, 34]);
    y = drawWrappedTextAt(headLines, margin, y + 4, 4.1) + 1.2;

    for (let i = 0; i < items.length; i++) {
      const prefix = numbered ? `${i + 1}. ` : '• ';
      const lines = wrapLines(`${prefix}${items[i]}`, contentW - 6, 8);
      if (lines.length === 0) continue;
      ensureSpace(3 + lines.length * 3.7);
      setRegular(8, [58, 61, 66]);
      y = drawWrappedTextAt(lines, margin + 3, y + 3, 3.7) - 2.1;
    }
    y += 3;
  };

  renderBulletSection(t.report.legalStopFactors, legalCompliance.legalStopFactors, false);
  renderBulletSection(t.report.redFlagsTitle, committeeAudit.unverifiedRedFlags, false);
  renderBulletSection(t.report.hardQuestionsTitle, committeeAudit.founderHardQuestions, true);
  renderBulletSection(t.report.pdfAssumptionsShort, analysis.assumptions, false);
  renderBulletSection(t.report.pdfStepsShort, analysis.preLaunchSteps, true);

  // ---------------------------------------------------------------------------
  // 7. КОНТУР 3: РЕКОМЕНДАЦИИ
  // ---------------------------------------------------------------------------
  const recommendations = getEffectiveRecommendations(analysis, metrics, language);
  drawSectionHeading(t.report.contour3Title, t.report.contour3Meta);

  drawCardWithSegments(
    [
      {
        lines: wrapLines(t.report.recConclusionTitle, boxInnerW, 8, true),
        size: 8,
        bold: true,
        color: [154, 110, 46],
        lineHeight: 3.8,
      },
      {
        lines: wrapLines(recommendations.analystConclusion, boxInnerW, 8.3, false),
        size: 8.3,
        bold: false,
        color: [30, 32, 34],
        lineHeight: 3.8,
        spaceBefore: 0.8,
      },
    ],
    [255, 255, 255],
    [216, 199, 165],
    2,
    4
  );

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
    const fy = pageH - 8.5;
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.25);
    pdf.line(margin, fy - 3.5, pageW - margin, fy - 3.5);
    setRegular(7, [100, 116, 139]);
    const rightStr = `${t.report.pdfFooterRight}  ·  ${p} / ${totalPages}`;
    const rightW = pdf.getTextWidth(rightStr);
    const leftMaxW = Math.max(40, contentW - rightW - 4);
    const leftShort = wrapLines(t.report.pdfFooterLeft, leftMaxW, 7)[0] || t.report.pdfFooterLeft;
    pdf.text(leftShort, margin, fy);
    pdf.text(rightStr, pageW - margin, fy, { align: 'right' });
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
