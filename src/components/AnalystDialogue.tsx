import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
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
  calculateDerivedMetrics,
  convertCurrencyAmount,
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
  ACCEPTED_LOCAL_FILE_TYPES,
  formatFileSize,
  parseLocalFileToDigest,
  validateLocalFilesBatch,
} from '../utils/localFileParser';
import { chatWithAnalystSmart, MissingGeminiKeyError } from '../utils/clientGemini';

interface AnalystDialogueProps {
  language: Language;
  displayCurrency: CurrencyCode;
  fxRates: FxRateMap;
  project: ProjectRecord;
  sessionToken?: string;
  serverGeminiConfigured?: boolean | null;
  analyzing: boolean;
  onRunAnalysis: () => void;
  onProjectUpdated: (project: ProjectRecord) => void;
  onApplySuggestedOverrides: (overrides: Partial<FinancialInputs>) => void;
  onOpenReportTab: () => void;
  onMissingApiKey?: () => void;
  onFallbackToClientKey?: () => void;
}

export const AnalystDialogue: React.FC<AnalystDialogueProps> = ({
  language,
  displayCurrency,
  fxRates,
  project,
  sessionToken,
  serverGeminiConfigured = null,
  analyzing,
  onRunAnalysis,
  onProjectUpdated,
  onApplySuggestedOverrides,
  onOpenReportTab,
  onMissingApiKey,
  onFallbackToClientKey,
}) => {
  const t = getTranslations(language);
  const [message, setMessage] = useState('');
  const [pendingDocs, setPendingDocs] = useState<LocalDocumentDigest[]>([]);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedMsgIds, setAppliedMsgIds] = useState<Record<string, boolean>>({});
  const [activeContourTab, setActiveContourTab] = useState<
    'numbers' | 'risks' | 'recommendations'
  >('recommendations');
  const [contoursExpanded, setContoursExpanded] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const regionLabel = getRegionDisplayLabel(project.region, project.customRegion, language);
  const baseCurrency = normalizeCurrencyCode(project.analysis?.currencyCode || project.currencyCode);
  const displaySymbol = getCurrencySymbol(displayCurrency);
  const fxFactor = getFxConversionFactor(baseCurrency, displayCurrency, fxRates);

  const derivedMetrics = useMemo(() => {
    if (!project.analysis) return null;
    return calculateDerivedMetrics(
      project.analysis,
      project.manualOverrides,
      fxFactor,
      t.common.monthPrefix
    );
  }, [project.analysis, project.manualOverrides, fxFactor, t.common.monthPrefix]);

  const effectiveRecommendations = useMemo(() => {
    if (!project.analysis || !derivedMetrics) return null;
    return getEffectiveRecommendations(project.analysis, derivedMetrics, language);
  }, [project.analysis, derivedMetrics, language]);

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
      const aiResponse = await chatWithAnalystSmart(
        project,
        message.trim(),
        pendingDocs,
        currentEffectiveInputs,
        language,
        sessionToken,
        serverGeminiConfigured
      );

      if (aiResponse.usedFallbackNoServerKey) {
        onFallbackToClientKey?.();
      }

      const now = new Date().toISOString();
      const userMsgRecord = {
        id: `msg_u_${Date.now()}`,
        role: 'user' as const,
        content: message.trim(),
        attachments: pendingDocs.map((d) => ({
          name: d.name,
          fileType: d.fileType,
          sizeBytes: d.sizeBytes,
        })),
        createdAt: now,
      };

      const assistantMsgRecord = {
        id: `msg_a_${Date.now() + 1}`,
        role: 'assistant' as const,
        content: aiResponse.reply,
        suggestedOverrides: aiResponse.suggestedOverrides,
        modelUsed: aiResponse.modelUsed,
        modelId: aiResponse.modelId,
        usedFallbackModel: aiResponse.usedFallbackModel,
        createdAt: new Date(Date.now() + 10).toISOString(),
      };

      const updatedProject: ProjectRecord = {
        ...project,
        documents: [...project.documents, ...pendingDocs],
        dialogue: [...project.dialogue, userMsgRecord, assistantMsgRecord],
        updatedAt: now,
      };

      onProjectUpdated(updatedProject);
      setMessage('');
      setPendingDocs([]);
    } catch (err) {
      if (err instanceof MissingGeminiKeyError) {
        onMissingApiKey?.();
      }
      setError(err instanceof Error ? err.message : 'Error sending message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto py-4 px-4 sm:px-6 lg:px-8 space-y-4">
      {/* Шапка проекта и главные действия анализа */}
      <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-0.5 leading-snug">
          <div className="text-xs text-[#5C6066]">
            {regionLabel} · {displayCurrency}
            {baseCurrency !== displayCurrency ? ` (${baseCurrency})` : ''} · {project.fullName} (
            {project.email})
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-[#1E2022] leading-snug">{project.projectName}</h2>
          {project.comment && (
            <p className="text-xs text-[#5C6066] max-w-3xl leading-snug">{project.comment}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={analyzing}
            onClick={onRunAnalysis}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
          >
            {analyzing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                <span>{language === 'en' ? 'Analysis in progress...' : 'Выполняется анализ...'}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-[#F5F3EE] shrink-0" />
                <span>
                  {project.analysis
                    ? t.dialogue.reanalyze
                    : t.dialogue.analyze}
                </span>
              </>
            )}
          </button>

          {project.analysis && (
            <>
              <button
                type="button"
                onClick={onOpenReportTab}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              >
                <span>{t.dialogue.modelBtn}</span>
              </button>

              <a
                href={reportTabUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors whitespace-nowrap shadow-xs"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-[#F5F3EE]" />
                <span>{t.common.getReport}</span>
              </a>
            </>
          )}
        </div>
      </div>

      {/* Компактный блок материалов на ПК пользователя */}
      <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-[#1E2022]">
            {t.dialogue.userPcDocsTitle} ({project.documents.length})
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#5C6066]">
            <Lock className="w-3 h-3 text-[#B88B4A]" />
            <span>{t.dialogue.userPcBadge}</span>
          </span>
        </div>

        {project.documents.length === 0 ? (
          <div className="text-xs text-[#5C6066] leading-snug">{t.dialogue.docsEmpty}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {project.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] text-xs leading-tight"
              >
                <FileText className="w-3.5 h-3.5 text-[#B88B4A] shrink-0" />
                <div className="min-w-0">
                  <div className="text-[#1E2022] font-medium truncate">{doc.name}</div>
                  <div className="text-[11px] text-[#5C6066] truncate">
                    {doc.previewNote} · {doc.charCount} симв.
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Три контура анализа рядом с диалогом (Цифры, Риски, Рекомендации) */}
      {project.analysis && derivedMetrics && effectiveRecommendations && (
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-[#1E2022] mr-1">
                {t.dialogue.contoursSummaryTitle}:
              </span>
              {(
                [
                  { id: 'numbers', label: t.dialogue.contourTabNumbers },
                  { id: 'risks', label: t.dialogue.contourTabRisks },
                  { id: 'recommendations', label: t.dialogue.contourTabRecommendations },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveContourTab(tab.id);
                    setContoursExpanded(true);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer border whitespace-nowrap ${
                    activeContourTab === tab.id && contoursExpanded
                      ? 'bg-[#1A1C1F] border-white/[0.26] text-[#F5F3EE] font-semibold'
                      : 'bg-[#FFFFFF] border-[#C9C1B2] text-[#3A3D42] hover:border-[#8C6D3F] hover:text-[#1E2022]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setContoursExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-[#5C6066] hover:text-[#1E2022] cursor-pointer"
            >
              <span>
                {contoursExpanded ? t.dialogue.hideContours : t.dialogue.showContours}
              </span>
              {contoursExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {contoursExpanded && activeContourTab === 'numbers' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-3 py-2">
                  <div className="text-[11px] text-[#5C6066]">{t.projects.kpiInvestments}</div>
                  <div className="text-xs font-mono-tabular font-bold text-[#9A6E2E] mt-0.5">
                    {formatCompactMoney(derivedMetrics.investmentAmount, displaySymbol, language)}
                  </div>
                </div>
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-3 py-2">
                  <div className="text-[11px] text-[#5C6066]">{t.projects.kpiRevenue}</div>
                  <div className="text-xs font-mono-tabular font-bold text-[#1E2022] mt-0.5">
                    {formatCompactMoney(derivedMetrics.monthlyRevenue, displaySymbol, language)}
                  </div>
                </div>
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-3 py-2">
                  <div className="text-[11px] text-[#5C6066]">{t.report.pdfEbitdaMargin}</div>
                  <div className="text-xs font-mono-tabular font-bold text-[#1E2022] mt-0.5">
                    {derivedMetrics.ebitdaMarginPct}%
                  </div>
                </div>
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-3 py-2">
                  <div className="text-[11px] text-[#5C6066]">{t.projects.kpiPayback}</div>
                  <div className="text-xs font-mono-tabular font-bold text-emerald-700 mt-0.5">
                    {derivedMetrics.paybackMonths
                      ? `${derivedMetrics.paybackMonths} ${t.common.monthsShort}`
                      : t.common.moreThan60Months}
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#3A3D42] leading-snug bg-[#FFFFFF] border border-[#E5E0D5] rounded-lg px-3 py-2">
                {project.analysis.executiveSummary}
              </p>
            </div>
          )}

          {contoursExpanded && activeContourTab === 'risks' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {project.analysis.risks.map((risk) => (
                <div
                  key={risk.id}
                  className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-2.5 space-y-1 text-xs leading-snug"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#5C6066]">
                      {risk.dimensionLabel}
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        risk.severity === 'high'
                          ? 'text-rose-700'
                          : risk.severity === 'medium'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {t.report.severity[risk.severity]}
                    </span>
                  </div>
                  <div className="font-semibold text-[#1E2022]">{risk.title}</div>
                  <div className="text-[#5C6066]">{risk.description}</div>
                </div>
              ))}
            </div>
          )}

          {contoursExpanded && activeContourTab === 'recommendations' && (
            <div className="space-y-2.5">
              <div className="rounded-lg bg-[#FFFFFF] border border-[#D8C7A5] p-3 space-y-1">
                <div className="text-[11px] font-semibold text-[#9A6E2E]">
                  {t.report.recConclusionTitle}
                </div>
                <p className="text-xs text-[#1E2022] leading-snug">
                  {effectiveRecommendations.analystConclusion}
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-[#1E2022] leading-snug">
                    {t.report.recMitigationTitle}
                  </div>
                  <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-disc pl-4">
                    {effectiveRecommendations.riskMitigationMeasures.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-[#1E2022] leading-snug">
                    {t.report.recCrisisTitle}
                  </div>
                  <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-decimal pl-4">
                    {effectiveRecommendations.crisisAndBottleneckPlan.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-[#1E2022] leading-snug">
                    {t.report.recGrowthTitle}
                  </div>
                  <ul className="space-y-1 text-xs text-[#3A3D42] leading-snug list-disc pl-4">
                    {effectiveRecommendations.growthPlanAndMetrics.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* История диалога с ИИ */}
      <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] flex flex-col">
        <div className="px-4 py-2.5 border-b border-[#E5E0D5] flex items-center justify-between">
          <div className="text-sm font-semibold text-[#1E2022]">
            {t.dialogue.chatTitle}
          </div>
          <div className="text-[11px] text-[#5C6066]">
            {t.dialogue.chatMemoryNote} {project.email}
          </div>
        </div>

        <div className="p-4 space-y-2.5 max-h-[460px] overflow-y-auto">
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
                className={`rounded-xl p-3 text-sm leading-snug ${
                  msg.role === 'user'
                    ? 'bg-[#FFFFFF] border border-[#E5E0D5] ml-4 sm:ml-10'
                    : 'bg-[#EFECE4] border border-[#DDD5C3] mr-4 sm:mr-10'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1 text-[11px] text-[#5C6066]">
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
                  <div className="mb-1.5 flex flex-wrap gap-2 text-[11px] text-[#9A6E2E] font-medium">
                    {msg.attachments.map((att) => (
                      <span key={att.name} className="inline-flex items-center gap-1">
                        <Paperclip className="w-3 h-3" />
                        <span>{att.name}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="text-[#1E2022] whitespace-pre-wrap text-[13px] leading-snug">
                  {msg.content}
                </div>

                {msg.suggestedOverrides && project.analysis && (
                  <div className="mt-2.5 pt-2.5 border-t border-[#DCD4C3] flex flex-wrap items-center justify-between gap-2.5">
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
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
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
          className="p-3 border-t border-[#E5E0D5] bg-[#F5F3EE] space-y-2 rounded-b-xl"
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
