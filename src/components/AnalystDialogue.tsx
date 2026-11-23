import React, { useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  FileText,
  Lock,
  Paperclip,
  Play,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  CurrencyCode,
  FinancialInputs,
  FxRateMap,
  Language,
  LocalDocumentDigest,
  ProjectRecord,
} from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import {
  convertCurrencyAmount,
  formatMoney,
  getCurrencySymbol,
  getEffectiveInputs,
  getRegionDisplayLabel,
  normalizeCurrencyCode,
} from '../utils/financialModel';
import {
  ACCEPTED_LOCAL_FILE_TYPES,
  formatFileSize,
  parseLocalFileToDigest,
  validateLocalFilesBatch,
} from '../utils/localFileParser';

interface AnalystDialogueProps {
  language: Language;
  displayCurrency: CurrencyCode;
  fxRates: FxRateMap;
  project: ProjectRecord;
  sessionToken?: string;
  analyzing: boolean;
  onRunAnalysis: () => void;
  onProjectUpdated: (project: ProjectRecord) => void;
  onApplySuggestedOverrides: (overrides: Partial<FinancialInputs>) => void;
  onOpenReportTab: () => void;
}

export const AnalystDialogue: React.FC<AnalystDialogueProps> = ({
  language,
  displayCurrency,
  fxRates,
  project,
  sessionToken,
  analyzing,
  onRunAnalysis,
  onProjectUpdated,
  onApplySuggestedOverrides,
  onOpenReportTab,
}) => {
  const t = getTranslations(language);
  const [message, setMessage] = useState('');
  const [pendingDocs, setPendingDocs] = useState<LocalDocumentDigest[]>([]);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedMsgIds, setAppliedMsgIds] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const regionLabel = getRegionDisplayLabel(project.region, project.customRegion, language);
  const baseCurrency = normalizeCurrencyCode(project.analysis?.currencyCode || project.currencyCode);
  const displaySymbol = getCurrencySymbol(displayCurrency);

  const reportTabUrl = `/?view=report&projectId=${encodeURIComponent(project.id)}`;

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParsing(true);
    setError(null);
    try {
      const { accepted, oversized } = validateLocalFilesBatch(Array.from(files));

      if (oversized.length > 0) {
        const list = oversized
          .map((f) => `«${f.name}» (${formatFileSize(f.size, language)})`)
          .join(', ');
        setError(t.createModal.errFileTooLarge.replace('{files}', list));
      }

      if (accepted.length > 0) {
        const parsed = await Promise.all(
          accepted.map((f) => parseLocalFileToDigest(f))
        );
        setPendingDocs((prev) => [...prev, ...parsed]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.createModal.errReadFile);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() && pendingDocs.length === 0) return;

    setSending(true);
    setError(null);

    const currentEffectiveInputs = project.analysis
      ? getEffectiveInputs(project.analysis, project.manualOverrides)
      : undefined;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          project,
          message: message.trim(),
          newDocuments: pendingDocs,
          currentEffectiveInputs,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get AI analyst response.');
      }
      onProjectUpdated(data.project);
      setMessage('');
      setPendingDocs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sending message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto py-6 px-4 sm:px-8 lg:px-10 space-y-6">
      {/* Шапка проекта и главные действия анализа */}
      <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-[#5C6066]">
            {regionLabel} · {displayCurrency}
            {baseCurrency !== displayCurrency ? ` (${baseCurrency})` : ''} · {project.fullName} (
            {project.email})
          </div>
          <h2 className="text-xl font-bold text-[#1E2022]">{project.projectName}</h2>
          {project.comment && (
            <p className="text-xs text-[#5C6066] max-w-3xl">{project.comment}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={analyzing}
            onClick={onRunAnalysis}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
          >
            <Play className="w-3.5 h-3.5 text-[#F5F3EE] shrink-0" />
            <span>
              {analyzing
                ? t.dialogue.analyzing
                : project.analysis
                ? t.dialogue.reanalyze
                : t.dialogue.analyze}
            </span>
          </button>

          {project.analysis && (
            <>
              <button
                type="button"
                onClick={onOpenReportTab}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              >
                <span>{t.dialogue.modelBtn}</span>
              </button>

              <a
                href={reportTabUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors whitespace-nowrap shadow-xs"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-[#F5F3EE]" />
                <span>{t.common.getReport}</span>
              </a>
            </>
          )}
        </div>
      </div>

      {/* Панель локальных документов проекта */}
      <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-[#1E2022]">
            {t.dialogue.docsTitle} ({project.documents.length})
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#5C6066]">
            <Lock className="w-3 h-3 text-[#B88B4A]" />
            <span>{t.dialogue.docsLocalBadge}</span>
          </span>
        </div>

        {project.documents.length === 0 ? (
          <div className="text-xs text-[#5C6066]">{t.dialogue.docsEmpty}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {project.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] text-xs"
              >
                <FileText className="w-4 h-4 text-[#B88B4A] shrink-0" />
                <div className="min-w-0">
                  <div className="text-[#1E2022] font-medium truncate">{doc.name}</div>
                  <div className="text-[11px] text-[#5C6066] truncate">
                    {doc.previewNote}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* История диалога с ИИ */}
      <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] flex flex-col">
        <div className="px-5 py-3.5 border-b border-[#E5E0D5] flex items-center justify-between">
          <div className="text-sm font-semibold text-[#1E2022]">
            {t.dialogue.chatTitle}
          </div>
          <div className="text-[11px] text-[#5C6066]">
            {t.dialogue.chatMemoryNote} {project.email}
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[460px] overflow-y-auto">
          {project.dialogue.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <Sparkles className="w-5 h-5 text-[#B88B4A] mx-auto" />
              <div className="text-sm font-medium text-[#1E2022]">
                {t.dialogue.chatEmptyTitle}
              </div>
              <p className="text-xs text-[#5C6066] max-w-md mx-auto">
                {t.dialogue.chatEmptyDesc}
              </p>
            </div>
          ) : (
            project.dialogue.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-xl p-4 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#FFFFFF] border border-[#E5E0D5] ml-4 sm:ml-12'
                    : 'bg-[#EFECE4] border border-[#DDD5C3] mr-4 sm:mr-12'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-[#5C6066]">
                  <span className="font-semibold text-[#1E2022]">
                    {msg.role === 'user' ? project.fullName : t.dialogue.analystName}
                  </span>
                  <span className="font-mono-tabular">
                    {new Date(msg.createdAt).toLocaleString(
                      language === 'en' ? 'en-US' : 'ru-RU',
                      {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      }
                    )}
                  </span>
                </div>

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-[#9A6E2E] font-medium">
                    {msg.attachments.map((att) => (
                      <span key={att.name} className="inline-flex items-center gap-1">
                        <Paperclip className="w-3 h-3" />
                        <span>{att.name}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="text-[#1E2022] whitespace-pre-wrap text-[13px]">
                  {msg.content}
                </div>

                {msg.suggestedOverrides && project.analysis && (
                  <div className="mt-3 pt-3 border-t border-[#DCD4C3] flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-[#3A3D42] space-x-3 font-mono-tabular">
                      {msg.suggestedOverrides.investmentAmount && (
                        <span>
                          {t.dialogue.investments}:{' '}
                          {formatMoney(
                            convertCurrencyAmount(
                              msg.suggestedOverrides.investmentAmount,
                              baseCurrency,
                              displayCurrency,
                              fxRates
                            ),
                            displaySymbol,
                            language
                          )}
                        </span>
                      )}
                      {msg.suggestedOverrides.monthlyRevenue && (
                        <span>
                          {t.dialogue.revenueMo}:{' '}
                          {formatMoney(
                            convertCurrencyAmount(
                              msg.suggestedOverrides.monthlyRevenue,
                              baseCurrency,
                              displayCurrency,
                              fxRates
                            ),
                            displaySymbol,
                            language
                          )}
                        </span>
                      )}
                      {msg.suggestedOverrides.headcount && (
                        <span>
                          {t.dialogue.team}: {msg.suggestedOverrides.headcount} {t.common.staffShort}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onApplySuggestedOverrides(msg.suggestedOverrides!);
                        setAppliedMsgIds((prev) => ({ ...prev, [msg.id]: true }));
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
                    >
                      {appliedMsgIds[msg.id] ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#F5F3EE]" />
                          <span>{t.dialogue.applied}</span>
                        </>
                      ) : (
                        <span>{t.dialogue.applyBtn}</span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Форма отправки вопроса и локальных файлов */}
        <form
          onSubmit={handleSend}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleAttachFiles(e.dataTransfer.files);
          }}
          className="p-4 border-t border-[#E5E0D5] bg-[#F5F3EE] space-y-3 rounded-b-xl"
        >
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          )}

          {pendingDocs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] text-xs text-[#1E2022]"
                >
                  <FileText className="w-3.5 h-3.5 text-[#B88B4A]" />
                  <span className="max-w-[180px] truncate">{doc.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDocs((prev) => prev.filter((d) => d.id !== doc.id))
                    }
                    className="text-[#5C6066] hover:text-rose-700 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPTED_LOCAL_FILE_TYPES}
              onChange={(e) => void handleAttachFiles(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              disabled={parsing || sending}
              onClick={() => fileRef.current?.click()}
              title={t.dialogue.attachTitle}
              className="p-2.5 rounded-lg border border-white/[0.22] hover:border-white/[0.36] bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer shrink-0"
            >
              <Paperclip className="w-4 h-4 text-[#F5F3EE]" />
            </button>

            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={parsing ? t.dialogue.parsingFile : t.dialogue.inputPlaceholder}
              className="flex-1 min-w-0 px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96] resize-none"
            />

            <button
              type="submit"
              disabled={sending || parsing || (!message.trim() && pendingDocs.length === 0)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-50 text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4 text-[#F5F3EE]" />
              <span className="hidden sm:inline">
                {sending ? t.dialogue.sendingBtn : t.dialogue.sendBtn}
              </span>
            </button>
          </div>

          <div className="text-[11px] text-[#5C6066] flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-[#B88B4A] shrink-0" />
            <span>{t.dialogue.attachFormatsHint}</span>
          </div>
        </form>
      </div>
    </div>
  );
};
