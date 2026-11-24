import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

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
 * Экспорт чистого многостраничного PDF-документа с полной поддержкой кириллицы,
 * логотипом IBS, обоими контурами анализа, SVG-инфографикой и пересчитанными цифрами.
 * По возможности предлагает выбрать путь и имя файла через showSaveFilePicker.
 */
export async function exportReportElementToPdf(
  element: HTMLElement,
  projectName: string
): Promise<void> {
  const fileName = buildPdfFileName(projectName);

  // Открываем системное окно выбора пути сразу в рамках пользовательского клика
  let fileHandle: SaveFilePickerHandle | null = null;
  if (typeof window !== 'undefined') {
    const pickerFn = (
      window as Window & { showSaveFilePicker?: ShowSaveFilePickerFn }
    ).showSaveFilePicker;
    if (typeof pickerFn === 'function') {
      try {
        fileHandle = await pickerFn({
          suggestedName: fileName,
          types: [
            {
              description: 'PDF Document',
              accept: { 'application/pdf': ['.pdf'] },
            },
          ],
        });
      } catch {
        // Пользователь отменил выбор или окружение (напр. iframe) ограничило API —
        // выполняем запасное скачивание PDF без ошибок и зависаний.
        fileHandle = null;
      }
    }
  }

  // Гарантируем, что шрифты полностью загружены до рендера в PNG
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const dataUrl = await toPng(element, {
    quality: 0.98,
    pixelRatio: 2,
    backgroundColor: '#FFFFFF',
    cacheBust: true,
  });

  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Не удалось подготовить изображение отчёта для PDF'));
  });

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();
  const marginMm = 10;
  const usableWidthMm = pageWidthMm - marginMm * 2;
  const usableHeightMm = pageHeightMm - marginMm * 2;

  const imgWidthPx = img.naturalWidth;
  const imgHeightPx = img.naturalHeight;
  const pxPerMm = imgWidthPx / usableWidthMm;
  const pageHeightPx = Math.floor(usableHeightMm * pxPerMm);

  let offsetPx = 0;
  let pageIndex = 0;

  while (offsetPx < imgHeightPx) {
    const sliceHeightPx = Math.min(pageHeightPx, imgHeightPx - offsetPx);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = imgWidthPx;
    sliceCanvas.height = sliceHeightPx;
    const ctx = sliceCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Ошибка 2D-контекста при формировании страниц PDF');
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      img,
      0,
      offsetPx,
      imgWidthPx,
      sliceHeightPx,
      0,
      0,
      imgWidthPx,
      sliceHeightPx
    );

    const sliceDataUrl = sliceCanvas.toDataURL('image/png');
    const sliceHeightMm = sliceHeightPx / pxPerMm;

    if (pageIndex > 0) {
      pdf.addPage();
    }
    pdf.addImage(sliceDataUrl, 'PNG', marginMm, marginMm, usableWidthMm, sliceHeightMm);

    offsetPx += sliceHeightPx;
    pageIndex += 1;
  }

  if (fileHandle) {
    let writable: SaveFilePickerWritable | null = null;
    try {
      const pdfBlob = pdf.output('blob');
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
  }

  pdf.save(fileName);
}
