import React, { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw, Table2, TableProperties, X } from 'lucide-react';
import type { Language, ProjectRecord } from '../types/ipds';
import { getTranslations } from '../i18n/translations';

interface GasIntegrationModalProps {
  language: Language;
  isOpen: boolean;
  gasWebhookUrl: string;
  onSaveWebhookUrl: (url: string) => void;
  projects: ProjectRecord[];
  onProjectSynced: (updatedProject: ProjectRecord) => void;
  onClose: () => void;
}

const GAS_SCRIPT_TEMPLATE = `/**
 * Google Apps Script Web App для таблицы «IPDS — Заявки и контакты МСБ»
 * Разверните как Веб-приложение (Выполнять: от моего имени, Доступ: все).
 * При автономном скрипте задайте свойство скрипта SPREADSHEET_ID (Настройки проекта -> Свойства скрипта).
 */
function getTargetSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('Таблица не привязана. Укажите SPREADSHEET_ID в свойствах скрипта.');
  }
  return active;
}

function doGet(e) {
  try {
    var ss = getTargetSpreadsheet_();
    var sheet = ss.getSheetByName('IPDS — Заявки и контакты МСБ');
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var values = sheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: values }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = getTargetSpreadsheet_();

    if (data.action === 'send_otp' && data.email && data.otpCode) {
      MailApp.sendEmail({
        to: data.email,
        subject: 'IPDS Терминал — Код подтверждения доступа',
        body: 'Ваш одноразовый код для доступа к проектам IPDS Терминал: ' + data.otpCode + '\\nСрок действия: ' + (data.expiresInMinutes || 10) + ' мин.'
      });
      return ContentService.createTextOutput(JSON.stringify({ ok: true, sent: true })).setMimeType(ContentService.MimeType.JSON);
    }

    var sheetName = data.sheetName || 'IPDS — Заявки и контакты МСБ';
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Дата', 'ФИО', 'E-mail', 'Проект', 'Регион', 'Категория', 'Комментарий', 'Источник']);
    }
    sheet.appendRow([
      data.createdAt || new Date().toISOString(),
      data.fullName || '',
      data.email || '',
      data.projectName || '',
      data.region || '',
      data.category || '',
      data.comment || '',
      data.source || 'IPDS Терминал'
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}`;

export const GasIntegrationModal: React.FC<GasIntegrationModalProps> = ({
  language,
  isOpen,
  gasWebhookUrl,
  onSaveWebhookUrl,
  projects,
  onProjectSynced,
  onClose,
}) => {
  const t = getTranslations(language);
  const [urlInput, setUrlInput] = useState(gasWebhookUrl);
  const [copiedScript, setCopiedScript] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [readingSheet, setReadingSheet] = useState(false);
  const [sheetRows, setSheetRows] = useState<unknown[][] | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setUrlInput(gasWebhookUrl);
    }
  }, [isOpen, gasWebhookUrl]);

  if (!isOpen) return null;

  const pendingProjects = projects.filter((p) => p.leadSyncStatus !== 'synced');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveWebhookUrl(urlInput.trim());
    setStatusIsError(false);
    setStatusMessage(t.gasModal.urlSaved);
  };

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(GAS_SCRIPT_TEMPLATE).catch(() => {});
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const handleReadSheet = async () => {
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      setStatusIsError(true);
      setStatusMessage(t.gasModal.urlRequiredForRead);
      return;
    }
    setReadingSheet(true);
    setStatusMessage(null);
    setStatusIsError(false);
    try {
      const res = await fetch('/api/leads/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gasWebhookUrl: trimmedUrl }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        rows?: unknown[][];
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setStatusIsError(true);
        setStatusMessage(data.message || data.error || t.gasModal.sheetReadErr);
        return;
      }
      setSheetRows(Array.isArray(data.rows) ? data.rows : []);
      setStatusIsError(false);
      setStatusMessage(data.message || t.gasModal.sheetReadSuccess);
    } catch (err) {
      setStatusIsError(true);
      setStatusMessage(err instanceof Error ? err.message : t.gasModal.sheetReadErr);
    } finally {
      setReadingSheet(false);
    }
  };

  const handleRetrySync = async (project: ProjectRecord) => {
    setSyncingId(project.id);
    setStatusMessage(null);
    setStatusIsError(false);
    try {
      const res = await fetch('/api/leads/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          lead: project,
          gasWebhookUrl: urlInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.project) {
        onProjectSynced(data.project);
      } else {
        onProjectSynced({
          ...project,
          leadSyncStatus: data.ok ? 'synced' : 'error',
          leadSyncMessage: data.message,
        });
      }
      setStatusIsError(!data.ok);
      setStatusMessage(data.message || t.gasModal.syncDone);
    } catch (err) {
      setStatusIsError(true);
      setStatusMessage(
        err instanceof Error ? err.message : t.gasModal.syncNetErr
      );
    } finally {
      setSyncingId(null);
    }
  };

  const headerRow = sheetRows && sheetRows.length > 0 ? sheetRows[0] : [];
  const dataRows = sheetRows && sheetRows.length > 1 ? sheetRows.slice(1) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16181A]/60 backdrop-blur-xs">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] text-[#1E2022] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E0D5] sticky top-0 bg-[#FAF8F3] z-10">
          <div className="flex items-center gap-2.5">
            <TableProperties className="w-5 h-5 text-[#B88B4A]" />
            <div>
              <h2 className="text-base font-bold text-[#1E2022]">{t.gasModal.title}</h2>
              <p className="text-xs text-[#5C6066]">{t.gasModal.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.gasModal.closeAria}
            className="p-2 rounded-lg border border-[#C9C1B2] hover:border-[#8C6D3F] text-[#5C6066] hover:text-[#1E2022] hover:bg-[#EFECE4] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <form onSubmit={handleSave} className="space-y-3">
            <label className="block text-xs font-medium text-[#3A3D42]">
              {t.gasModal.urlLabelPre}{' '}
              <code className="px-1.5 py-0.5 rounded bg-[#EFECE4] text-[#9A6E2E] font-mono-tabular">
                GAS_WEBHOOK_URL
              </code>{' '}
              {t.gasModal.urlLabelPost}
            </label>
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 min-w-0 px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs font-mono-tabular text-[#1E2022] placeholder:text-[#8B8F96]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors"
              >
                {t.gasModal.saveUrl}
              </button>
              <button
                type="button"
                disabled={readingSheet}
                onClick={() => void handleReadSheet()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs cursor-pointer whitespace-nowrap disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors"
              >
                <Table2 className={`w-3.5 h-3.5 text-[#F5F3EE] ${readingSheet ? 'animate-pulse' : ''}`} />
                <span>{readingSheet ? t.gasModal.readingSheet : t.gasModal.testReadBtn}</span>
              </button>
            </div>
            {statusMessage && (
              <div
                className={`text-xs font-medium pt-1 ${
                  statusIsError ? 'text-rose-700' : 'text-[#9A6E2E]'
                }`}
              >
                {statusMessage}
              </div>
            )}
          </form>

          {/* Предпросмотр строк из Google Таблицы (doGet) */}
          {sheetRows !== null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#3A3D42]">
                  {t.gasModal.sheetPreviewTitle}
                </span>
                <span className="font-mono-tabular text-[#5C6066]">
                  {sheetRows.length} {t.gasModal.sheetRowsCount}
                </span>
              </div>
              {sheetRows.length === 0 ? (
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-4 py-3 text-xs text-[#5C6066]">
                  {t.gasModal.sheetEmptyRows}
                </div>
              ) : (
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] overflow-x-auto max-h-48">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-[#EFECE4] text-[#3A3D42] sticky top-0">
                      <tr>
                        {headerRow.map((cell, idx) => (
                          <th
                            key={idx}
                            className="px-2.5 py-1.5 font-semibold border-b border-[#E5E0D5] whitespace-nowrap"
                          >
                            {String(cell ?? '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFECE4]">
                      {dataRows.slice(0, 20).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-[#FAF8F3]">
                          {headerRow.map((_, cIdx) => (
                            <td
                              key={cIdx}
                              className="px-2.5 py-1.5 text-[#1E2022] max-w-[180px] truncate"
                              title={String(row[cIdx] ?? '')}
                            >
                              {String(row[cIdx] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Очередь повторной отправки заявок */}
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-[#3A3D42]">
              {t.gasModal.queueTitle} ({pendingProjects.length})
            </div>
            {pendingProjects.length === 0 ? (
              <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-4 py-3 text-xs text-[#5C6066]">
                {t.gasModal.queueEmpty}
              </div>
            ) : (
              <div className="space-y-2">
                {pendingProjects.map((proj) => (
                  <div
                    key={proj.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#1E2022] truncate">
                        {proj.projectName} · {proj.fullName}
                      </div>
                      <div className="text-[11px] text-[#5C6066] truncate">
                        {proj.email} · {proj.leadSyncMessage || t.gasModal.awaitingSend}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={syncingId === proj.id}
                      onClick={() => void handleRetrySync(proj)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-medium text-[#F5F3EE] cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 text-[#F5F3EE] ${syncingId === proj.id ? 'animate-spin' : ''}`}
                      />
                      <span>{t.gasModal.sendBtn}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Готовый шаблон Code.gs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#3A3D42]">
                {t.gasModal.scriptTitle}
              </span>
              <button
                type="button"
                onClick={handleCopyScript}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-medium text-[#F5F3EE] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors"
              >
                {copiedScript ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t.gasModal.copied}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#F5F3EE]" />
                    <span>{t.gasModal.copyScript}</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3.5 rounded-lg bg-[#16181A] border border-[#2A2D32] text-[11px] font-mono-tabular text-[#E5E3DD] overflow-x-auto max-h-52 leading-relaxed">
              {GAS_SCRIPT_TEMPLATE}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
