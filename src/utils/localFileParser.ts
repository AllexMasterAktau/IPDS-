import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { LocalDocumentDigest } from '../types/ipds';

export const MAX_LOCAL_FILE_SIZE_MB = 20;
export const MAX_LOCAL_FILE_SIZE_BYTES = MAX_LOCAL_FILE_SIZE_MB * 1024 * 1024;

export const ACCEPTED_LOCAL_FILE_TYPES = [
  '.pdf',
  '.txt',
  '.csv',
  '.doc',
  '.docx',
  '.rtf',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.ppt',
  '.pptx',
  '.md',
  '.tsv',
  '.json',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
].join(',');

export function formatFileSize(bytes: number, lang: 'ru' | 'en' = 'ru'): string {
  if (bytes < 1024) return `${bytes} ${lang === 'en' ? 'B' : 'Б'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${lang === 'en' ? 'KB' : 'КБ'}`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} ${lang === 'en' ? 'MB' : 'МБ'}`;
}

export function validateLocalFilesBatch(files: File[]): {
  accepted: File[];
  oversized: File[];
} {
  const accepted: File[] = [];
  const oversized: File[] = [];
  for (const file of files) {
    if (file.size > MAX_LOCAL_FILE_SIZE_BYTES) {
      oversized.push(file);
    } else {
      accepted.push(file);
    }
  }
  return { accepted, oversized };
}

function cleanWhitespace(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function extractReadablePdfStrings(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('latin1');
  const raw = decoder.decode(bytes);
  const matches: string[] = [];
  const regex = /\(([^()\\]{3,500})\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const candidate = match[1].replace(/[^\x20-\x7E\u0400-\u04FF]/g, ' ').trim();
    if (candidate.length >= 3 && /[a-zA-Zа-яА-ЯёЁ0-9]/.test(candidate)) {
      matches.push(candidate);
    }
  }
  return cleanWhitespace(matches.join(' '));
}

function extractRtfText(rawRtf: string): string {
  let cleaned = rawRtf.replace(
    /\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|header|footer|fldinst)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,
    ' '
  );

  const cp1251Decoder = new TextDecoder('windows-1251');
  cleaned = cleaned.replace(/(?:\\'[0-9a-fA-F]{2})+/g, (seq) => {
    const hexPairs = seq.match(/[0-9a-fA-F]{2}/g) ?? [];
    const bytes = new Uint8Array(hexPairs.map((h) => parseInt(h, 16)));
    try {
      return cp1251Decoder.decode(bytes);
    } catch {
      return '';
    }
  });

  cleaned = cleaned.replace(/\\u(-?\d+)\??/g, (_m, numStr) => {
    const rawCode = Number(numStr);
    if (!Number.isFinite(rawCode)) return '';
    const code = rawCode < 0 ? rawCode + 65536 : rawCode;
    return String.fromCharCode(code);
  });

  cleaned = cleaned
    .replace(/\\(?:par|line|row)\b/g, '\n')
    .replace(/\\(?:tab|cell)\b/g, ' | ')
    .replace(/\\[{}\\]/g, (m) => m[1])
    .replace(/\\'[0-9a-fA-F]{2}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '');

  return cleanWhitespace(cleaned);
}

const OLE_NOISE_RE =
  /^(Root Entry|WordDocument|1Table|0Table|Data|ObjectPool|CompObj|SummaryInformation|DocumentSummaryInformation|PowerPoint Document|Current User|Pictures|Times New Roman|Calibri|Arial|Cambria|Segoe UI|Normal\.dotm?|Microsoft (Office )?(Word|Excel|PowerPoint))$/i;

function extractLegacyBinaryStrings(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const runs: string[] = [];

  // 1. Поиск UTF-16LE последовательностей (основная кодировка кириллицы/Unicode в .doc/.ppt/.xls)
  let currentUtf16 = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    const code = (hi << 8) | lo;
    const isAsciiPrintable =
      hi === 0 && (lo === 0x09 || lo === 0x0a || lo === 0x0d || (lo >= 0x20 && lo <= 0x7e));
    const isCyrillic = code >= 0x0400 && code <= 0x04ff;

    if (isAsciiPrintable || isCyrillic) {
      currentUtf16 += code === 0x0d ? '\n' : String.fromCharCode(code);
    } else {
      const trimmed = currentUtf16.trim();
      if (
        trimmed.length >= 6 &&
        /[a-zA-Zа-яА-ЯёЁ0-9]{2,}/.test(trimmed) &&
        !OLE_NOISE_RE.test(trimmed)
      ) {
        runs.push(trimmed);
      }
      currentUtf16 = '';
    }
  }
  if (currentUtf16.trim().length >= 6 && !OLE_NOISE_RE.test(currentUtf16.trim())) {
    runs.push(currentUtf16.trim());
  }

  // 2. Поиск однобайтовых строк (ASCII / Windows-1251), если UTF-16LE дал мало текста
  if (runs.join(' ').length < 120) {
    try {
      const cp1251 = new TextDecoder('windows-1251').decode(bytes);
      const byteMatches =
        cp1251.match(/[a-zA-Zа-яА-ЯёЁ0-9][a-zA-Zа-яА-ЯёЁ0-9 ,.;:!?%()\-/№"'«»]{5,}/g) ?? [];
      for (const m of byteMatches) {
        const trimmed = m.trim();
        if (!OLE_NOISE_RE.test(trimmed) && /[a-zA-Zа-яА-ЯёЁ]{2,}/.test(trimmed)) {
          runs.push(trimmed);
        }
      }
    } catch {
      // ignore decoder fallback
    }
  }

  const deduped = Array.from(new Set(runs));
  return cleanWhitespace(deduped.join('\n'));
}

function extractNumberedSlideIndex(filePath: string): number {
  const m = filePath.match(/(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

/**
 * Local-First извлечение полного текстового контекста из файлов до 20 МБ
 * без искусственного урезания по количеству символов.
 */
export async function parseLocalFileToDigest(file: File): Promise<LocalDocumentDigest> {
  if (file.size > MAX_LOCAL_FILE_SIZE_BYTES) {
    throw new Error(
      `Файл «${file.name}» (${formatFileSize(file.size)}) превышает лимит ${MAX_LOCAL_FILE_SIZE_MB} МБ.`
    );
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  let extractedText = '';
  let previewNote = '';

  try {
    if (['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'log', 'yml', 'yaml'].includes(ext)) {
      const rawText = await file.text();
      extractedText = cleanWhitespace(rawText);
      const lineCount = extractedText ? extractedText.split('\n').length : 0;
      previewNote = `Текстовый документ (${lineCount} строк, ${formatFileSize(file.size)})`;
    } else if (ext === 'rtf') {
      const rawRtf = await file.text();
      extractedText = extractRtfText(rawRtf);
      if (!extractedText) {
        extractedText = `Документ RTF "${file.name}" (${formatFileSize(file.size)}).`;
      }
      previewNote = `Документ RTF (${formatFileSize(file.size)})`;
    } else if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) {
      const buffer = await file.arrayBuffer();
      try {
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetOutputs: string[] = [];

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;
          const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ' | ', RS: '\n' });
          const lines = csv
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.replace(/\|/g, '').trim().length > 0);
          if (lines.length > 0) {
            sheetOutputs.push(`[Лист: ${sheetName}]\n${lines.join('\n')}`);
          }
        }
        extractedText = cleanWhitespace(sheetOutputs.join('\n\n'));
        previewNote = `Таблица Excel (${workbook.SheetNames.length} лист., ${formatFileSize(file.size)})`;
      } catch {
        const legacyText = extractLegacyBinaryStrings(buffer);
        extractedText =
          legacyText.length > 40
            ? legacyText
            : `Таблица "${file.name}" (${formatFileSize(file.size)}). Бинарная структура защищена или нестандартный формат.`;
        previewNote = `Таблица Excel (${formatFileSize(file.size)})`;
      }
    } else if (ext === 'docx') {
      const buffer = await file.arrayBuffer();
      try {
        const zip = await JSZip.loadAsync(buffer);
        const xmlPaths = Object.keys(zip.files)
          .filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/i.test(name))
          .sort();
        const parts: string[] = [];

        for (const p of xmlPaths) {
          const xmlFile = zip.file(p);
          if (!xmlFile) continue;
          const xml = await xmlFile.async('text');
          const textOnly = decodeXmlEntities(
            xml
              .replace(/<\/w:p>/g, '\n')
              .replace(/<\/w:tr>/g, '\n')
              .replace(/<\/w:tc>/g, ' | ')
              .replace(/<[^>]+>/g, '')
          );
          if (textOnly.trim()) parts.push(textOnly);
        }
        extractedText = cleanWhitespace(parts.join('\n'));
      } catch {
        extractedText = extractLegacyBinaryStrings(buffer);
      }
      previewNote = `Документ Word (${formatFileSize(file.size)})`;
    } else if (ext === 'doc') {
      const buffer = await file.arrayBuffer();
      const extracted = extractLegacyBinaryStrings(buffer);
      extractedText =
        extracted.length > 40
          ? extracted
          : `Документ Microsoft Word (.doc) "${file.name}" (${formatFileSize(file.size)}). Бинарный формат защищён или содержит только встроенные объекты; учти в анализе название документа и параметры проекта.`;
      previewNote = `Документ Word .doc (${formatFileSize(file.size)})`;
    } else if (ext === 'pptx') {
      const buffer = await file.arrayBuffer();
      try {
        const zip = await JSZip.loadAsync(buffer);
        const slidePaths = Object.keys(zip.files)
          .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
          .sort((a, b) => extractNumberedSlideIndex(a) - extractNumberedSlideIndex(b));

        const slidesText: string[] = [];
        for (const slidePath of slidePaths) {
          const slideFile = zip.file(slidePath);
          if (!slideFile) continue;
          const xml = await slideFile.async('text');
          const slideNo = extractNumberedSlideIndex(slidePath);
          const rawText = decodeXmlEntities(
            xml
              .replace(/<\/a:p>/g, '\n')
              .replace(/<\/a:tr>/g, '\n')
              .replace(/<\/a:tc>/g, ' | ')
              .replace(/<[^>]+>/g, '')
          );
          const cleanedSlide = cleanWhitespace(rawText);
          if (cleanedSlide) {
            slidesText.push(`[Слайд ${slideNo}]\n${cleanedSlide}`);
          }
        }

        const notePaths = Object.keys(zip.files)
          .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
          .sort((a, b) => extractNumberedSlideIndex(a) - extractNumberedSlideIndex(b));

        for (const notePath of notePaths) {
          const noteFile = zip.file(notePath);
          if (!noteFile) continue;
          const xml = await noteFile.async('text');
          const noteNo = extractNumberedSlideIndex(notePath);
          const rawNote = decodeXmlEntities(
            xml.replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')
          );
          const cleanedNote = cleanWhitespace(rawNote);
          if (cleanedNote && !/^\d+$/.test(cleanedNote)) {
            slidesText.push(`[Заметки к слайду ${noteNo}]\n${cleanedNote}`);
          }
        }

        extractedText = cleanWhitespace(slidesText.join('\n\n'));
      } catch {
        extractedText = extractLegacyBinaryStrings(buffer);
      }
      previewNote = `Презентация PowerPoint (${formatFileSize(file.size)})`;
    } else if (ext === 'ppt') {
      const buffer = await file.arrayBuffer();
      const extracted = extractLegacyBinaryStrings(buffer);
      extractedText =
        extracted.length > 40
          ? extracted
          : `Презентация Microsoft PowerPoint (.ppt) "${file.name}" (${formatFileSize(file.size)}). Бинарный формат защищён или содержит только графику; учти в анализе название презентации и параметры проекта.`;
      previewNote = `Презентация PowerPoint .ppt (${formatFileSize(file.size)})`;
    } else if (ext === 'pdf') {
      const buffer = await file.arrayBuffer();
      const extracted = extractReadablePdfStrings(buffer);
      extractedText =
        extracted.length > 60
          ? extracted
          : `PDF-документ "${file.name}" (${formatFileSize(file.size)}). Текст защищён сжатием потоков; проанализируй с учётом имени файла и вводных параметров проекта.`;
      previewNote = `PDF-документ (${formatFileSize(file.size)})`;
    } else {
      const fallbackText = await file.text().catch(() => '');
      const printableRatio =
        fallbackText.length > 0
          ? fallbackText.replace(/[^\x20-\x7E\u0400-\u04FF\n\r\t]/g, '').length /
            fallbackText.length
          : 0;
      if (printableRatio > 0.7) {
        extractedText = cleanWhitespace(fallbackText);
      } else {
        extractedText = `Локальный файл "${file.name}" (${formatFileSize(file.size)}, тип ${file.type || ext || 'неизвестен'}).`;
      }
      previewNote = `Файл (${formatFileSize(file.size)})`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка чтения файла';
    extractedText = `Локальный файл "${file.name}" (${formatFileSize(file.size)}). Локальная обработка метаданных: ${message}`;
    previewNote = `Метаданные файла (${formatFileSize(file.size)})`;
  }

  if (!extractedText) {
    extractedText = `Локальный файл "${file.name}" (${formatFileSize(file.size)}) без извлечённого текста.`;
  }

  return {
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    sizeBytes: file.size,
    fileType: ext.toUpperCase() || 'FILE',
    charCount: extractedText.length,
    extractedText,
    previewNote,
    addedAt: new Date().toISOString(),
  };
}
