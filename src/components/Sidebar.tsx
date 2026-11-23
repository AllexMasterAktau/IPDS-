import React from 'react';
import {
  FileText,
  FolderKanban,
  Home,
  KeyRound,
  LogOut,
  MessageSquare,
  Settings2,
  X,
} from 'lucide-react';
import type { Language, ProjectRecord } from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import { getRegionDisplayLabel } from '../utils/financialModel';

export type ActiveTab = 'welcome' | 'projects' | 'dialogue' | 'report';

interface SidebarProps {
  language: Language;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenAuthModal: () => void;
  onSwitchEmail: () => void;
  onOpenGasModal: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
  activeUserEmail: string | null;
  projects: ProjectRecord[];
  previewCount: number;
  activeProject: ProjectRecord | null;
  onSelectProject: (projectId: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  language,
  activeTab,
  onSelectTab,
  onOpenAuthModal,
  onSwitchEmail,
  onOpenGasModal,
  onLogout,
  isAuthenticated,
  activeUserEmail,
  projects,
  previewCount,
  activeProject,
  onSelectProject,
  mobileOpen,
  onCloseMobile,
}) => {
  const t = getTranslations(language);
  const hasVerifiedAccount = isAuthenticated === true && Boolean(activeUserEmail);

  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ReactNode;
    disabled?: boolean;
    count?: number;
  }[] = [
    { id: 'welcome', label: t.sidebar.navWelcome, icon: <Home className="w-4 h-4 shrink-0" /> },
    {
      id: 'projects',
      label: t.sidebar.navProjects,
      icon: <FolderKanban className="w-4 h-4 shrink-0" />,
      count: hasVerifiedAccount ? projects.length : previewCount,
    },
    {
      id: 'dialogue',
      label: t.sidebar.navDialogue,
      icon: <MessageSquare className="w-4 h-4 shrink-0" />,
      disabled: !activeProject,
    },
    {
      id: 'report',
      label: t.sidebar.navReport,
      icon: <FileText className="w-4 h-4 shrink-0" />,
      disabled: !activeProject,
    },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#16181A] border-r border-[#2A2D32] text-[#E5E3DD] select-none">
      {/* Брендинг: Логотип IBS на ширину колонки + заголовок IPDS Терминал */}
      <div className="px-4 pt-5 pb-4 border-b border-[#2A2D32]">
        <div className="flex items-center justify-between lg:block">
          <div className="w-full pr-6 lg:pr-0">
            <img
              src="/ibs_logo_transparent.png"
              alt="Intelligent Business Systems"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.fallbackApplied) {
                  target.dataset.fallbackApplied = '1';
                  target.src = '/assets/aistudio/ibs_logo_transparent_98656fe4.png';
                }
              }}
              className="w-full h-auto max-h-24 object-contain object-left"
            />
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label={t.sidebar.closeMenu}
            className="lg:hidden p-2 text-[#A4A8AF] hover:text-white border border-white/[0.22] hover:border-white/[0.36] rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4">
          <h1 className="text-lg font-bold tracking-tight text-[#FAF8F5] leading-snug">
            {t.common.appName}
          </h1>
          <p className="text-xs text-[#C99B52] font-medium mt-0.5">
            {t.common.appSubtitle}
          </p>
        </div>
      </div>

      {/* Навигация терминала */}
      <nav className="px-4 py-4 space-y-2">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) {
                  onSelectTab(item.id);
                  onCloseMobile();
                }
              }}
              className={`w-full h-11 flex items-center justify-between px-4 rounded-lg text-sm transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5F3EE]/30 ${
                isActive
                  ? 'bg-[#26292E] border border-white/[0.30] hover:border-white/[0.42] text-[#F5F3EE] font-semibold shadow-xs'
                  : item.disabled
                  ? 'border border-white/[0.14] text-[#5A5E66] cursor-not-allowed'
                  : 'border border-white/[0.22] hover:border-white/[0.36] text-[#D3D1CB] hover:bg-[#222529] hover:text-[#F5F3EE]'
              }`}
            >
              <span className="flex items-center gap-3 truncate">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.count === 'number' && item.count > 0 && (
                <span
                  className={`text-xs font-mono-tabular ml-2 ${
                    isActive ? 'text-[#F5F3EE]/80 font-semibold' : 'text-[#9A9EA6]'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Быстрый переключатель недавних проектов (только после входа по E-mail) */}
      {hasVerifiedAccount && projects.length > 0 && (
        <div className="px-4 py-3 border-t border-[#2A2D32] flex-1 overflow-y-auto min-h-0">
          <div className="text-xs font-medium text-[#9A9EA6] mb-2">
            {t.sidebar.activeProjects}
          </div>
          <div className="space-y-1">
            {projects.slice(0, 8).map((proj) => {
              const selected = activeProject?.id === proj.id;
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => {
                    onSelectProject(proj.id);
                    onCloseMobile();
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#23262A] text-[#C99B52] font-medium border border-white/[0.30]'
                      : 'border border-white/[0.16] hover:border-white/[0.32] text-[#B5B8BF] hover:text-[#FAF8F5] hover:bg-[#1E2125]'
                  }`}
                >
                  <div className="truncate">{proj.projectName}</div>
                  <div className="text-[11px] text-[#7D828B] truncate mt-0.5">
                    {getRegionDisplayLabel(proj.region, proj.customRegion, language)} ·{' '}
                    {proj.analysis ? t.sidebar.reportReady : t.sidebar.draft}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(!hasVerifiedAccount || projects.length === 0) && <div className="flex-1" />}

      {/* Доступ по E-mail и настройки интеграции */}
      <div className="px-4 py-3 border-t border-[#2A2D32] space-y-2 bg-[#1B1D20]">
        {hasVerifiedAccount && activeUserEmail ? (
          <div className="space-y-1.5">
            <div className="text-[11px] text-[#9A9EA6]">{t.sidebar.verifiedEmail}</div>
            <div className="text-xs font-medium text-[#FAF8F5] truncate">
              {activeUserEmail}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  onSwitchEmail();
                  onCloseMobile();
                }}
                className="text-xs text-[#C99B52] hover:text-[#DFB46E] transition-colors cursor-pointer"
              >
                {t.sidebar.changeEmail}
              </button>
              <span className="text-[#4B4F57] text-xs">·</span>
              <button
                type="button"
                onClick={() => {
                  onLogout();
                  onCloseMobile();
                }}
                className="inline-flex items-center gap-1 text-xs text-[#9A9EA6] hover:text-[#FAF8F5] transition-colors cursor-pointer"
              >
                <LogOut className="w-3 h-3" />
                <span>{t.sidebar.logout}</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onOpenAuthModal();
              onCloseMobile();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.22] hover:border-white/[0.36] bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] text-xs font-medium text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5F3EE]/30 transition-colors cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5 text-[#F5F3EE] shrink-0" />
            <span className="truncate">{t.sidebar.loginByEmail}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            onOpenGasModal();
            onCloseMobile();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.22] hover:border-white/[0.36] bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] text-xs font-medium text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5F3EE]/30 transition-colors cursor-pointer"
        >
          <Settings2 className="w-3.5 h-3.5 text-[#F5F3EE] shrink-0" />
          <span className="truncate">{t.sidebar.gasSettings}</span>
        </button>
      </div>

      {/* Футер с подписью разработчика и ссылкой на Telegram */}
      <div className="px-4 py-3 border-t border-[#2A2D32] bg-[#16181A] text-[11px] text-[#9A9EA6] whitespace-nowrap">
        <span>{t.common.developerPrefix} </span>
        <a
          href="https://t.me/AllexMaster"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#C99B52] hover:text-[#E0B56E] hover:underline transition-colors"
        >
          Intelligent Business Systems® 2026
        </a>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-[312px] shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 w-[304px] max-w-[88vw] h-full">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
