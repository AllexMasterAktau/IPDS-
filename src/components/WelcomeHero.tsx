import React from 'react';
import {
  ArrowRight,
  Calculator,
  FileSpreadsheet,
  KeyRound,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import type { Language, ProjectRecord, UserSession } from '../types/ipds';
import { getTranslations } from '../i18n/translations';

interface WelcomeHeroProps {
  language: Language;
  session: UserSession | null;
  projectsCount: number;
  latestProject: ProjectRecord | null;
  onOpenCreateModal: () => void;
  onOpenAuthModal: () => void;
  onOpenLatestProject: () => void;
}

export const WelcomeHero: React.FC<WelcomeHeroProps> = ({
  language,
  session,
  projectsCount,
  latestProject,
  onOpenCreateModal,
  onOpenAuthModal,
  onOpenLatestProject,
}) => {
  const t = getTranslations(language);
  const icons = [
    <FileSpreadsheet key="0" className="w-5 h-5 text-[#B88B4A]" />,
    <Calculator key="1" className="w-5 h-5 text-[#B88B4A]" />,
    <SlidersHorizontal key="2" className="w-5 h-5 text-[#B88B4A]" />,
    <ShieldAlert key="3" className="w-5 h-5 text-[#B88B4A]" />,
  ];

  const capabilities = t.welcome.capabilities.map((cap, idx) => ({
    icon: icons[idx],
    title: cap.title,
    description: cap.description,
  }));

  return (
    <div className="w-full max-w-[1600px] mx-auto py-8 px-4 sm:px-8 lg:px-10 space-y-8">
      {/* Главный приветственный блок */}
      <section className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_12px_rgba(22,24,26,0.04)] p-6 sm:p-10">
        <div className="text-xs font-semibold text-[#9A6E2E] mb-3">
          {t.welcome.kicker}
        </div>

        <h2 className="text-2xl sm:text-4xl font-bold text-[#1E2022] tracking-tight leading-snug max-w-5xl flex flex-col gap-3 sm:gap-4 text-left">
          <span>{t.welcome.headlineLine1}</span>
          <span>{t.welcome.headlineLine2}</span>
        </h2>

        <div className="mt-5 w-full text-left text-sm sm:text-[15px] text-[#5C6066] leading-relaxed space-y-1">
          <p>{t.welcome.subtitleLine1}</p>
          <p>{t.welcome.subtitleLine2}</p>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenCreateModal}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
          >
            <Plus className="w-4 h-4 text-[#F5F3EE] shrink-0" />
            <span>{t.common.createProject}</span>
          </button>

          {!session ? (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
            >
              <KeyRound className="w-4 h-4 text-[#F5F3EE] shrink-0" />
              <span>{t.welcome.restoreAccess}</span>
            </button>
          ) : latestProject ? (
            <button
              type="button"
              onClick={onOpenLatestProject}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
            >
              <span>
                {t.welcome.openLatestProject} ({projectsCount})
              </span>
              <ArrowRight className="w-4 h-4 text-[#F5F3EE] shrink-0" />
            </button>
          ) : null}
        </div>
      </section>

      {/* Сетка возможностей системы */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {capabilities.map((item) => (
          <div
            key={item.title}
            className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-6 space-y-2.5"
          >
            <div className="flex items-center gap-2.5">
              {item.icon}
              <h3 className="text-base font-semibold text-[#1E2022]">{item.title}</h3>
            </div>
            <p className="text-sm text-[#5C6066] leading-relaxed">{item.description}</p>
          </div>
        ))}
      </section>

      {/* Быстрый сценарий работы */}
      <section className="rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] shadow-[0_2px_10px_rgba(22,24,26,0.03)] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-[#1E2022]">
            {t.welcome.bottomTitle}
          </h3>
          <p className="text-xs text-[#5C6066] mt-1">
            {t.welcome.bottomDesc}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
        >
          <Plus className="w-4 h-4 text-[#F5F3EE] shrink-0" />
          <span>{t.common.createProject}</span>
        </button>
      </section>
    </div>
  );
};
