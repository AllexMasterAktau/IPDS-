import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FolderKanban,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  AdminUserSummary,
  CurrencyCode,
  FxRateMap,
  Language,
  ProjectRecord,
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

interface AdminPanelViewProps {
  language: Language;
  displayCurrency: CurrencyCode;
  fxRates: FxRateMap;
  projects: ProjectRecord[];
  users: AdminUserSummary[];
  gasConfigured: boolean;
  loading: boolean;
  syncingPending: boolean;
  analyzingProjectId: string | null;
  activeProjectId: string | null;
  onRefresh: () => void;
  onSyncPending: () => void;
  onSelectProject: (projectId: string, targetTab: 'dialogue' | 'report') => void;
  onRunAnalysis: (project: ProjectRecord) => void;
  onDeleteProject: (projectId: string) => void;
}

type AdminSubTab = 'projects' | 'contacts';
type StatusFilter = 'all' | 'ready' | 'draft';

export const AdminPanelView: React.FC<AdminPanelViewProps> = ({
  language,
  displayCurrency,
  fxRates,
  projects,
  users,
  gasConfigured,
  loading,
  syncingPending,
  analyzingProjectId,
  activeProjectId,
  onRefresh,
  onSyncPending,
  onSelectProject,
  onRunAnalysis,
  onDeleteProject,
}) => {
  const t = getTranslations(language);
  const displaySymbol = getCurrencySymbol(displayCurrency);

  const [subTab, setSubTab] = useState<AdminSubTab>('projects');
  const [query, setQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const analytics = useMemo(() => {
    let analyzedCount = 0;
    let draftCount = 0;
    let totalInvestments = 0;
    let totalMonthlyRevenue = 0;
    let paybackSum = 0;
    let paybackCount = 0;
    let totalDocs = 0;
    let totalMsgs = 0;
    let syncedCount = 0;
    let pendingCount = 0;

    const uniqueEmails = new Set<string>();
    const regionCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();

    for (const proj of projects) {
      const em = proj.email.trim().toLowerCase();
      if (em) uniqueEmails.add(em);

      totalDocs += proj.documents.length;
      totalMsgs += proj.dialogue.length;

      if (proj.leadSyncStatus === 'synced') {
        syncedCount += 1;
      } else {
        pendingCount += 1;
      }

      const regLabel = getRegionDisplayLabel(proj.region, proj.customRegion, language);
      regionCounts.set(regLabel, (regionCounts.get(regLabel) ?? 0) + 1);

      if (proj.category?.trim()) {
        const cat = proj.category.trim();
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }

      if (proj.analysis) {
        analyzedCount += 1;
        const baseCurrency = normalizeCurrencyCode(
          proj.analysis.currencyCode || proj.currencyCode
        );
        const fxFactor = getFxConversionFactor(baseCurrency, displayCurrency, fxRates);
        const derived = calculateDerivedMetrics(
          proj.analysis,
          proj.manualOverrides,
          fxFactor,
          t.common.monthPrefix
        );
        totalInvestments += derived.investmentAmount;
        totalMonthlyRevenue += derived.monthlyRevenue;
        if (derived.paybackMonths !== null && Number.isFinite(derived.paybackMonths)) {
          paybackSum += derived.paybackMonths;
          paybackCount += 1;
        }
      } else {
        draftCount += 1;
      }
    }

    const totalProjects = projects.length;
    const regionBreakdown = Array.from(regionCounts.entries())
      .map(([label, count]) => ({
        label,
        count,
        sharePct: totalProjects > 0 ? Math.round((count / totalProjects) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const categoryBreakdown = Array.from(categoryCounts.entries())
      .map(([label, count]) => ({
        label,
        count,
        sharePct: totalProjects > 0 ? Math.round((count / totalProjects) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const avgPaybackMonths =
      paybackCount > 0 ? Math.round((paybackSum / paybackCount) * 10) / 10 : null;

    return {
      totalProjects,
      analyzedCount,
      draftCount,
      uniqueContactsCount: Math.max(uniqueEmails.size, users.length),
      totalInvestments,
      totalMonthlyRevenue,
      avgPaybackMonths,
      totalDocs,
      totalMsgs,
      syncedCount,
      pendingCount,
      regionBreakdown,
      categoryBreakdown,
    };
  }, [projects, users.length, displayCurrency, fxRates, language, t.common.monthPrefix]);

  const availableRegions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      set.add(getRegionDisplayLabel(p.region, p.customRegion, language));
    }
    return Array.from(set).sort();
  }, [projects, language]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((proj) => {
      const regLabel = getRegionDisplayLabel(proj.region, proj.customRegion, language);
      if (regionFilter !== 'all' && regLabel !== regionFilter) return false;
      if (statusFilter === 'ready' && !proj.analysis) return false;
      if (statusFilter === 'draft' && proj.analysis) return false;
      if (!q) return true;
      return (
        proj.projectName.toLowerCase().includes(q) ||
        proj.fullName.toLowerCase().includes(q) ||
        proj.email.toLowerCase().includes(q) ||
        (proj.category || '').toLowerCase().includes(q) ||
        (proj.comment || '').toLowerCase().includes(q) ||
        regLabel.toLowerCase().includes(q)
      );
    });
  }, [projects, query, regionFilter, statusFilter, language]);

  const contactRows = useMemo(() => {
    const map = new Map<
      string,
      {
        email: string;
        fullName: string;
        projects: ProjectRecord[];
        regions: Set<string>;
        categories: Set<string>;
        latestComment: string;
        latestUpdatedAt: string;
        allSynced: boolean;
      }
    >();

    for (const proj of filteredProjects) {
      const email = proj.email.trim().toLowerCase();
      const regLabel = getRegionDisplayLabel(proj.region, proj.customRegion, language);
      const existing = map.get(email);
      if (!existing) {
        map.set(email, {
          email,
          fullName: proj.fullName,
          projects: [proj],
          regions: new Set([regLabel]),
          categories: new Set(proj.category?.trim() ? [proj.category.trim()] : []),
          latestComment: proj.comment?.trim() || '',
          latestUpdatedAt: proj.updatedAt,
          allSynced: proj.leadSyncStatus === 'synced',
        });
      } else {
        existing.projects.push(proj);
        existing.regions.add(regLabel);
        if (proj.category?.trim()) existing.categories.add(proj.category.trim());
        if (!existing.latestComment && proj.comment?.trim()) {
          existing.latestComment = proj.comment.trim();
        }
        if (new Date(proj.updatedAt) > new Date(existing.latestUpdatedAt)) {
          existing.latestUpdatedAt = proj.updatedAt;
          existing.fullName = proj.fullName;
        }
        if (proj.leadSyncStatus !== 'synced') {
          existing.allSynced = false;
        }
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime()
    );
  }, [filteredProjects, language]);

  const handleExportCsv = () => {
    const escapeCell = (val: unknown) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };

    const headers = [
      'ID',
      t.admin.colInitiator,
      t.admin.colEmail,
      t.createModal.labelProjectName,
      t.admin.colRegion,
      t.admin.colCategory,
      t.admin.colComment,
      displayCurrency,
      t.projects.kpiInvestments,
      t.projects.kpiRevenue,
      t.projects.kpiPayback,
      t.admin.colSync,
      t.admin.colDate,
    ];

    const lines = [headers.map(escapeCell).join(';')];

    for (const proj of filteredProjects) {
      const regLabel = getRegionDisplayLabel(proj.region, proj.customRegion, language);
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

      lines.push(
        [
          proj.id,
          proj.fullName,
          proj.email,
          proj.projectName,
          regLabel,
          proj.category || '',
          proj.comment || '',
          displayCurrency,
          derived ? Math.round(derived.investmentAmount) : '',
          derived ? Math.round(derived.monthlyRevenue) : '',
          derived?.paybackMonths ?? '',
          proj.leadSyncStatus,
          proj.updatedAt,
        ]
          .map(escapeCell)
          .join(';')
      );
    }

    const csvContent = `\uFEFF${lines.join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ipds-admin-projects-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderSyncBadge = (proj: ProjectRecord) => {
    if (proj.leadSyncStatus === 'synced') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-medium text-emerald-700">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>{t.admin.syncSynced}</span>
        </span>
      );
    }
    if (proj.leadSyncStatus === 'error') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-[11px] font-medium text-rose-700">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{t.admin.syncError}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EFECE4] border border-[#D8C7A5] text-[11px] font-medium text-[#9A6E2E]">
        <Clock className="w-3 h-3 shrink-0" />
        <span>
          {proj.leadSyncStatus === 'unconfigured'
            ? t.admin.syncUnconfigured
            : t.admin.syncPending}
        </span>
      </span>
    );
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto py-4 px-4 sm:px-6 lg:px-8 space-y-4">
      {/* Шапка панели администратора */}
      <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-4 sm:p-5 shadow-[0_2px_12px_rgba(22,24,26,0.04)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1 leading-snug">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9A6E2E]">
            <ShieldCheck className="w-4 h-4" />
            <span>{t.admin.badge}</span>
            <span className="text-[#8B8F96]">·</span>
            <span className="font-mono-tabular text-[#5C6066]">allmasters13@gmail.com</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-[#1E2022] tracking-tight leading-snug">
            {t.admin.title}
          </h2>
          <p className="text-xs text-[#5C6066] leading-snug">{t.admin.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#F5F3EE] ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? t.admin.refreshing : t.admin.refreshBtn}</span>
          </button>

          {gasConfigured && analytics.pendingCount > 0 && (
            <button
              type="button"
              disabled={syncingPending}
              onClick={onSyncPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
            >
              <Send className={`w-3.5 h-3.5 text-[#F5F3EE] ${syncingPending ? 'animate-pulse' : ''}`} />
              <span>
                {syncingPending
                  ? t.admin.syncingPending
                  : t.admin.syncPendingBtn.replace('{count}', String(analytics.pendingCount))}
              </span>
            </button>
          )}

          <button
            type="button"
            disabled={filteredProjects.length === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-50 text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#F5F3EE]" />
            <span>{t.admin.exportCsvBtn}</span>
          </button>
        </div>
      </div>

      {/* Сводные KPI-карточки */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-4 space-y-1.5 shadow-[0_2px_10px_rgba(22,24,26,0.03)]">
          <div className="flex items-center justify-between text-xs text-[#5C6066]">
            <span>{t.admin.kpiTotalProjects}</span>
            <FolderKanban className="w-4 h-4 text-[#B88B4A]" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-[#1E2022]">
            {analytics.totalProjects}
          </div>
          <div className="text-[11px] text-[#5C6066]">
            {t.admin.kpiProjectsSub
              .replace('{ready}', String(analytics.analyzedCount))
              .replace('{drafts}', String(analytics.draftCount))}
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-4 space-y-1.5 shadow-[0_2px_10px_rgba(22,24,26,0.03)]">
          <div className="flex items-center justify-between text-xs text-[#5C6066]">
            <span>{t.admin.kpiUniqueContacts}</span>
            <Users className="w-4 h-4 text-[#B88B4A]" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-[#1E2022]">
            {analytics.uniqueContactsCount}
          </div>
          <div className="text-[11px] text-[#5C6066]">
            {t.admin.kpiContactsSub
              .replace('{docs}', String(analytics.totalDocs))
              .replace('{msgs}', String(analytics.totalMsgs))}
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-4 space-y-1.5 shadow-[0_2px_10px_rgba(22,24,26,0.03)]">
          <div className="flex items-center justify-between text-xs text-[#5C6066]">
            <span>
              {t.admin.kpiTotalInvestments} ({displayCurrency})
            </span>
            <BarChart3 className="w-4 h-4 text-[#B88B4A]" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-[#9A6E2E]">
            {formatCompactMoney(analytics.totalInvestments, displaySymbol, language)}
          </div>
          <div className="text-[11px] text-[#5C6066]">
            {t.admin.kpiInvestmentsSub.replace('{count}', String(analytics.analyzedCount))}
          </div>
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-4 space-y-1.5 shadow-[0_2px_10px_rgba(22,24,26,0.03)]">
          <div className="flex items-center justify-between text-xs text-[#5C6066]">
            <span>
              {t.admin.kpiTotalRevenue} ({displayCurrency})
            </span>
            <BarChart3 className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-2xl font-bold font-mono-tabular text-[#1E2022]">
            {formatCompactMoney(analytics.totalMonthlyRevenue, displaySymbol, language)}
          </div>
          <div className="text-[11px] text-[#5C6066]">
            {t.admin.kpiPaybackSub.replace(
              '{months}',
              analytics.avgPaybackMonths !== null
                ? `${analytics.avgPaybackMonths} ${t.common.monthsShort}`
                : '—'
            )}
          </div>
        </div>
      </div>

      {/* Сводная аналитика: география, отрасли и фоновая синхронизация */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-5 space-y-3 shadow-[0_2px_10px_rgba(22,24,26,0.03)]">
          <div className="text-sm font-bold text-[#1E2022]">{t.admin.regionsTitle}</div>
          {analytics.regionBreakdown.length === 0 ? (
            <div className="text-xs text-[#5C6066]">{t.admin.emptyAll}</div>
          ) : (
            <div className="space-y-2.5">
              {analytics.regionBreakdown.map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#1E2022] font-medium truncate">{item.label}</span>
                    <span className="font-mono-tabular text-[#5C6066] shrink-0">
                      {item.count} ({item.sharePct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#EAE5DB] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#1A1C1F]"
                      style={{ width: `${Math.max(4, item.sharePct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-5 space-y-4 shadow-[0_2px_10px_rgba(22,24,26,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-[#1E2022]">{t.admin.categoriesTitle}</span>
            <span className="text-[11px] font-mono-tabular text-[#5C6066]">
              {t.admin.gasBgStatusLabel}{' '}
              <span className={gasConfigured ? 'text-emerald-700 font-semibold' : 'text-[#9A6E2E] font-semibold'}>
                {gasConfigured ? t.admin.gasBgConfigured : t.admin.gasBgUnconfigured}
              </span>
            </span>
          </div>

          {analytics.categoryBreakdown.length === 0 ? (
            <div className="text-xs text-[#5C6066]">{t.admin.noCategories}</div>
          ) : (
            <div className="space-y-2">
              {analytics.categoryBreakdown.map((cat) => (
                <div key={cat.label} className="flex items-center justify-between text-xs gap-3">
                  <span className="text-[#1E2022] truncate">{cat.label}</span>
                  <span className="font-mono-tabular text-[#5C6066] shrink-0">
                    {cat.count} ({cat.sharePct}%)
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-[#E5E0D5] grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-3 py-2">
              <div className="text-[11px] text-[#5C6066]">{t.admin.syncedCountLabel}</div>
              <div className="font-mono-tabular font-bold text-emerald-700 text-sm mt-0.5">
                {analytics.syncedCount}
              </div>
            </div>
            <div className="rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] px-3 py-2">
              <div className="text-[11px] text-[#5C6066]">{t.admin.pendingCountLabel}</div>
              <div className="font-mono-tabular font-bold text-[#9A6E2E] text-sm mt-0.5">
                {analytics.pendingCount}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Панель переключения вкладок и фильтров */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="inline-grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#EAE5DB] border border-[#C9C1B2] self-start">
          <button
            type="button"
            onClick={() => setSubTab('projects')}
            className={`px-3.5 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer border whitespace-nowrap ${
              subTab === 'projects'
                ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE] font-semibold'
                : 'border-transparent hover:border-[#8C8476]/50 text-[#5C6066] hover:text-[#1E2022]'
            }`}
          >
            {t.admin.tabProjects} ({filteredProjects.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('contacts')}
            className={`px-3.5 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer border whitespace-nowrap ${
              subTab === 'contacts'
                ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE] font-semibold'
                : 'border-transparent hover:border-[#8C8476]/50 text-[#5C6066] hover:text-[#1E2022]'
            }`}
          >
            {t.admin.tabContacts} ({contactRows.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] sm:w-64">
            <Search className="w-4 h-4 text-[#5C6066] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.admin.searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs text-[#1E2022] placeholder:text-[#8B8F96]"
            />
          </div>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs text-[#1E2022]"
          >
            <option value="all">{t.admin.filterAllRegions}</option>
            {availableRegions.map((reg) => (
              <option key={reg} value={reg}>
                {reg}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs text-[#1E2022]"
          >
            <option value="all">{t.admin.filterAllStatuses}</option>
            <option value="ready">{t.admin.filterReady}</option>
            <option value="draft">{t.admin.filterDraft}</option>
          </select>
        </div>
      </div>

      {/* Содержимое вкладок: Все проекты / Контакты */}
      {filteredProjects.length === 0 ? (
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] p-10 text-center text-sm text-[#5C6066]">
          {projects.length === 0 ? t.admin.emptyAll : t.admin.emptyFiltered}
        </div>
      ) : subTab === 'projects' ? (
        <div className="space-y-3">
          {filteredProjects.map((proj) => {
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
                className={`rounded-xl p-3.5 sm:p-4 border transition-all shadow-[0_2px_10px_rgba(22,24,26,0.03)] ${
                  isSelected
                    ? 'bg-[#FFFFFF] border-[#1A1C1F]'
                    : 'bg-[#FAF8F3] border-[#E5E0D5] hover:border-[#C9BFA9]'
                }`}
              >
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0 leading-snug">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C6066]">
                      <span className="font-semibold text-[#1E2022]">{proj.fullName}</span>
                      <span>·</span>
                      <span className="font-mono-tabular text-[#9A6E2E]">{proj.email}</span>
                      <span>·</span>
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
                      {renderSyncBadge(proj)}
                    </div>

                    <h3 className="text-base font-bold text-[#1E2022] truncate">
                      {proj.projectName}
                    </h3>

                    {proj.comment && (
                      <p className="text-xs text-[#5C6066] line-clamp-2">{proj.comment}</p>
                    )}

                    <div className="text-xs text-[#5C6066] flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        {proj.documents.length} {t.admin.docsShort}
                      </span>
                      <span>
                        {proj.dialogue.length} {t.admin.msgsShort}
                      </span>
                      <span>
                        {proj.analysis ? t.admin.filterReady : t.admin.filterDraft}
                      </span>
                    </div>
                  </div>

                  {derived && (
                    <div className="grid grid-cols-3 gap-4 lg:gap-6 text-right shrink-0 border-t xl:border-t-0 pt-3 xl:pt-0 border-[#E5E0D5]">
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
                      <span>{t.admin.btnDialogue}</span>
                    </button>

                    {!proj.analysis ? (
                      <button
                        type="button"
                        disabled={isAnalyzing}
                        onClick={() => onRunAnalysis(proj)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Play className="w-3.5 h-3.5 text-[#F5F3EE]" />
                        <span>{isAnalyzing ? t.admin.btnAnalyzing : t.admin.btnAnalyze}</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelectProject(proj.id, 'report')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <span>{t.admin.btnModel}</span>
                        </button>
                        <a
                          href={reportTabUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors whitespace-nowrap"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-[#F5F3EE]" />
                          <span>{t.admin.btnReport}</span>
                        </a>
                      </>
                    )}

                    {confirmDeleteId === proj.id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteProject(proj.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 border border-rose-500 text-xs font-semibold text-white cursor-pointer"
                        >
                          {t.admin.btnDeleteConfirm}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1.5 rounded-lg border border-[#C9C1B2] text-xs text-[#5C6066] hover:text-[#1E2022] cursor-pointer"
                        >
                          {t.admin.btnCancelDelete}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(proj.id)}
                        aria-label={`${t.admin.deleteAria} ${proj.projectName}`}
                        className="p-2 rounded-lg border border-[#D8D1C3] hover:border-rose-300 text-[#7A7E85] hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] overflow-x-auto shadow-[0_2px_10px_rgba(22,24,26,0.03)]">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#EFECE4] text-[#3A3D42] border-b border-[#E5E0D5]">
              <tr>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colInitiator}</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colEmail}</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colProjects}</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colRegion}</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colCategory}</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colComment}</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colSync}</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">{t.admin.colDate}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E0D5] bg-[#FFFFFF]">
              {contactRows.map((c) => (
                <tr key={c.email} className="hover:bg-[#FAF8F3] align-top leading-snug">
                  <td className="px-3 py-2 font-medium text-[#1E2022] whitespace-nowrap">
                    {c.fullName}
                  </td>
                  <td className="px-3 py-2 font-mono-tabular text-[#9A6E2E] whitespace-nowrap">
                    {c.email}
                  </td>
                  <td className="px-3 py-2 min-w-[200px]">
                    <div className="space-y-0.5">
                      <div className="text-[11px] font-mono-tabular text-[#5C6066]">
                        {c.projects.length} {t.admin.projectsCountWord}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {c.projects.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              onSelectProject(p.id, p.analysis ? 'report' : 'dialogue')
                            }
                            className="text-left text-xs font-medium text-[#1E2022] hover:text-[#9A6E2E] hover:underline cursor-pointer truncate max-w-[240px]"
                          >
                            {p.projectName}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[#5C6066] whitespace-nowrap">
                    {Array.from(c.regions).join(', ')}
                  </td>
                  <td className="px-3 py-2 text-[#5C6066] max-w-[160px] truncate">
                    {Array.from(c.categories).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-[#5C6066] max-w-[220px]">
                    <span className="line-clamp-2">{c.latestComment || '—'}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {c.allSynced ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-medium text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{t.admin.syncSynced}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EFECE4] border border-[#D8C7A5] text-[11px] font-medium text-[#9A6E2E]">
                        <Clock className="w-3 h-3" />
                        <span>{t.admin.syncPending}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono-tabular text-[#5C6066] whitespace-nowrap">
                    {new Date(c.latestUpdatedAt).toLocaleDateString(
                      language === 'en' ? 'en-US' : 'ru-RU'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
