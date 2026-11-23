import React, { useState } from 'react';
import {
  ExternalLink,
  FolderOpen,
  KeyRound,
  Lock,
  MessageSquare,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  CurrencyCode,
  FxRateMap,
  Language,
  ProjectRecord,
  PublicProjectPreview,
} from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import {
  calculateDerivedMetrics,
  formatCompactMoney,
  getCurrencySymbol,
  getFxConversionFactor,
  getRegionDisplayLabel,
  normalizeCurrencyCode,
} from '../utils/financialModel';

interface ProjectsListViewProps {
  language: Language;
  displayCurrency: CurrencyCode;
  fxRates: FxRateMap;
  isAuthenticated: boolean;
  activeUserEmail: string | null;
  projects: ProjectRecord[];
  previewProjects: PublicProjectPreview[];
  activeProjectId: string | null;
  analyzingProjectId: string | null;
  onSelectProject: (projectId: string, targetTab: 'dialogue' | 'report') => void;
  onRunAnalysis: (project: ProjectRecord) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenCreateModal: () => void;
  onOpenAuthModal: () => void;
}

export const ProjectsListView: React.FC<ProjectsListViewProps> = ({
  language,
  displayCurrency,
  fxRates,
  isAuthenticated,
  activeUserEmail,
  projects,
  previewProjects,
  activeProjectId,
  analyzingProjectId,
  onSelectProject,
  onRunAnalysis,
  onDeleteProject,
  onOpenCreateModal,
  onOpenAuthModal,
}) => {
  const t = getTranslations(language);
  const [query, setQuery] = useState('');
  const displaySymbol = getCurrencySymbol(displayCurrency);

  // Режим до подтверждения входа по E-mail: только последние 5 закрытых карточек предпросмотра
  if (!isAuthenticated || !activeUserEmail) {
    const latestPreviews = [...previewProjects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);

    const filteredPreviews = latestPreviews.filter((p) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const regionLoc = getRegionDisplayLabel(p.region, p.customRegion, language).toLowerCase();
      return (
        p.projectName.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        p.region.toLowerCase().includes(q) ||
        regionLoc.includes(q)
      );
    });

    if (latestPreviews.length === 0) {
      return (
        <div className="w-full max-w-[1600px] mx-auto py-12 px-4 sm:px-8 lg:px-10">
          <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] p-10 text-center space-y-4">
            <FolderOpen className="w-8 h-8 text-[#B88B4A] mx-auto" />
            <h2 className="text-xl font-bold text-[#1E2022]">{t.projects.emptyTitle}</h2>
            <p className="text-sm text-[#5C6066] max-w-md mx-auto">
              {t.projects.emptyDesc}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4 text-[#F5F3EE]" />
                <span>{t.common.createProject}</span>
              </button>
              <button
                type="button"
                onClick={onOpenAuthModal}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer shadow-xs"
              >
                <KeyRound className="w-4 h-4 text-[#F5F3EE]" />
                <span>{t.projects.unlockBtn}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full max-w-[1600px] mx-auto py-6 px-4 sm:px-8 lg:px-10 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#1E2022]">{t.projects.heading}</h2>
            <p className="text-xs text-[#5C6066] mt-0.5">
              {t.projects.previewCountLabel}: {latestPreviews.length} · {t.projects.lockedBadge}
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-[#5C6066] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.projects.searchPlaceholder}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs text-[#1E2022] placeholder:text-[#8B8F96]"
              />
            </div>
          </div>
        </div>

        {/* Информационная плашка о закрытом предпросмотре */}
        <div className="rounded-xl bg-[#EFECE4] border border-[#D8C7A5] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-[#3A3D42]">
            <Lock className="w-4 h-4 text-[#9A6E2E] shrink-0" />
            <span>{t.projects.previewSubtitle}</span>
          </div>
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <KeyRound className="w-3.5 h-3.5 text-[#F5F3EE]" />
            <span>{t.projects.unlockBtn}</span>
          </button>
        </div>

        <div className="space-y-3">
          {filteredPreviews.map((proj) => {
            const regionLabel = getRegionDisplayLabel(proj.region, proj.customRegion, language);
            return (
              <button
                key={proj.id}
                type="button"
                onClick={onOpenAuthModal}
                className="w-full text-left rounded-xl p-5 border border-[#E5E0D5] bg-[#FAF8F3] hover:bg-[#FFFFFF] hover:border-[#32363C] transition-all shadow-[0_2px_10px_rgba(22,24,26,0.03)] cursor-pointer group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C6066]">
                      <span>{regionLabel}</span>
                      {proj.category && (
                        <>
                          <span>·</span>
                          <span>{proj.category}</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="font-mono-tabular">
                        {new Date(proj.updatedAt).toLocaleDateString(
                          language === 'en' ? 'en-US' : 'ru-RU'
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EFECE4] border border-[#D8C7A5] text-[11px] font-semibold text-[#9A6E2E]">
                        <Lock className="w-3 h-3 shrink-0" />
                        <span>{t.projects.lockedBadge}</span>
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-[#1E2022] truncate">
                      {proj.projectName}
                    </h3>

                    <div className="text-xs text-[#6B7078] flex items-center gap-1.5">
                      <Lock className="w-3 h-3 text-[#9A6E2E] shrink-0" />
                      <span>{t.projects.lockedHint}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Авторизованный режим: отображаем ТОЛЬКО проекты подтверждённого activeUserEmail
  const normalizedActiveEmail = (activeUserEmail || projects[0]?.email || '').trim().toLowerCase();
  let scopedProjects = projects.filter(
    (p) => normalizedActiveEmail === 'allmasters13@gmail.com' || (p.email || '').trim().toLowerCase() === normalizedActiveEmail
  );
  if (scopedProjects.length === 0 && projects.length > 0) {
    scopedProjects = projects;
  }

  const filtered = scopedProjects.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const regionLoc = getRegionDisplayLabel(p.region, p.customRegion, language).toLowerCase();
    return (
      p.projectName.toLowerCase().includes(q) ||
      p.fullName.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      p.region.toLowerCase().includes(q) ||
      regionLoc.includes(q)
    );
  });

  if (scopedProjects.length === 0) {
    return (
      <div className="w-full max-w-[1600px] mx-auto py-12 px-4 sm:px-8 lg:px-10">
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] p-10 text-center space-y-4">
          <FolderOpen className="w-8 h-8 text-[#B88B4A] mx-auto" />
          <h2 className="text-xl font-bold text-[#1E2022]">{t.projects.emptyTitle}</h2>
          <p className="text-sm text-[#5C6066] max-w-md mx-auto">
            {t.projects.emptyDesc}
          </p>
          <button
            type="button"
            onClick={onOpenCreateModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4 text-[#F5F3EE]" />
            <span>{t.common.createProject}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto py-6 px-4 sm:px-8 lg:px-10 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#1E2022]">{t.projects.heading}</h2>
          <p className="text-xs text-[#5C6066] mt-0.5">
            {t.projects.countLabel}: {scopedProjects.length} ·{' '}
            {t.projects.userScopeNote.replace('{email}', activeUserEmail)}
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-[#5C6066] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.projects.searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs text-[#1E2022] placeholder:text-[#8B8F96]"
            />
          </div>
          <button
            type="button"
            onClick={onOpenCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 text-[#F5F3EE]" />
            <span>{t.common.createProject}</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((proj) => {
          const isSelected = proj.id === activeProjectId;
          const isAnalyzing = analyzingProjectId === proj.id;
          const regionLabel = getRegionDisplayLabel(proj.region, proj.customRegion, language);
          const baseCurrency = normalizeCurrencyCode(
            proj.analysis?.currencyCode || proj.currencyCode
          );
          const fxFactor = getFxConversionFactor(baseCurrency, displayCurrency, fxRates);
          const derived = proj.analysis
            ? calculateDerivedMetrics(
                proj.analysis,
                proj.manualOverrides,
                fxFactor,
                t.common.monthPrefix
              )
            : null;
          const reportTabUrl = `/?view=report&projectId=${encodeURIComponent(proj.id)}`;

          return (
            <div
              key={proj.id}
              className={`rounded-xl p-5 border transition-all shadow-[0_2px_10px_rgba(22,24,26,0.03)] ${
                isSelected
                  ? 'bg-[#FFFFFF] border-[#1A1C1F]'
                  : 'bg-[#FAF8F3] border-[#E5E0D5] hover:border-[#C9BFA9]'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="text-xs text-[#5C6066]">
                    {regionLabel} · {displayCurrency}
                    {baseCurrency !== displayCurrency ? ` (${baseCurrency})` : ''} · {proj.fullName} ·{' '}
                    <span className="font-mono-tabular">
                      {new Date(proj.updatedAt).toLocaleDateString(
                        language === 'en' ? 'en-US' : 'ru-RU'
                      )}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-[#1E2022] truncate">
                    {proj.projectName}
                  </h3>
                  <div className="text-xs text-[#5C6066] flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      {t.projects.docsCount}: {proj.documents.length}
                    </span>
                    <span>
                      {t.projects.msgsCount}: {proj.dialogue.length}
                    </span>
                    <span>
                      {t.projects.crmSync}:{' '}
                      <span
                        className={
                          proj.leadSyncStatus === 'synced'
                            ? 'text-emerald-700 font-medium'
                            : 'text-[#9A6E2E] font-medium'
                        }
                      >
                        {proj.leadSyncStatus === 'synced'
                          ? t.projects.syncSynced
                          : proj.leadSyncStatus === 'unconfigured'
                          ? t.projects.syncUnconfigured
                          : t.projects.syncQueued}
                      </span>
                    </span>
                  </div>
                </div>

                {derived && (
                  <div className="grid grid-cols-3 gap-4 lg:gap-6 text-right shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-[#E5E0D5]">
                    <div>
                      <div className="text-[11px] text-[#5C6066]">{t.projects.kpiInvestments}</div>
                      <div className="text-xs font-mono-tabular font-semibold text-[#9A6E2E] mt-0.5">
                        {formatCompactMoney(derived.investmentAmount, displaySymbol, language)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5C6066]">{t.projects.kpiRevenue}</div>
                      <div className="text-xs font-mono-tabular font-semibold text-[#1E2022] mt-0.5">
                        {formatCompactMoney(derived.monthlyRevenue, displaySymbol, language)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5C6066]">{t.projects.kpiPayback}</div>
                      <div className="text-xs font-mono-tabular font-semibold text-emerald-700 mt-0.5">
                        {derived.paybackMonths
                          ? `${derived.paybackMonths} ${t.common.monthsShort}`
                          : t.common.moreThan60Months}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectProject(proj.id, 'dialogue')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#F5F3EE]" />
                    <span>{t.projects.btnDialogue}</span>
                  </button>

                  {!proj.analysis ? (
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => onRunAnalysis(proj)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5 text-[#F5F3EE]" />
                      <span>{isAnalyzing ? t.projects.btnAnalyzing : t.projects.btnAnalyze}</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelectProject(proj.id, 'report')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <span>{t.projects.btnOpenModel}</span>
                      </button>
                      <a
                        href={reportTabUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[#F5F3EE]" />
                        <span>{t.projects.btnGetReport}</span>
                      </a>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => onDeleteProject(proj.id)}
                    aria-label={`${t.projects.deleteAria} ${proj.projectName}`}
                    className="p-2 rounded-lg border border-[#D8D1C3] hover:border-rose-300 text-[#7A7E85] hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
