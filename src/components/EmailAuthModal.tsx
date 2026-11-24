import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { Language, ProjectRecord, UserSession } from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import { deduplicateProjects } from '../utils/projectDedup';

interface EmailAuthModalProps {
  language: Language;
  isOpen: boolean;
  gasWebhookUrl: string;
  onClose: () => void;
  onAuthenticated: (session: UserSession, projects: ProjectRecord[]) => void;
}

function readDeduplicatedLocalProjects(): ProjectRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('ipds_projects_v1') || '[]') as ProjectRecord[];
    return deduplicateProjects(parsed);
  } catch {
    return [];
  }
}

export const EmailAuthModal: React.FC<EmailAuthModalProps> = ({
  language,
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const t = getTranslations(language);
  const [email, setEmail] = useState('');

  if (!isOpen) return null;

  const handleQuickLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) return;

    const lowerEmail = trimmed.toLowerCase();
    const isAdmin = lowerEmail === 'allmasters13@gmail.com';
    const session: UserSession = {
      email: lowerEmail,
      sessionToken: `local_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      verifiedAt: new Date().toISOString(),
      isAdmin,
    };

    onAuthenticated(session, readDeduplicatedLocalProjects());
    setEmail('');
    onClose();
  };

  const handleDemoQuickLogin = () => {
    const demoEmail = 'demo@ibs-terminal.kz';
    const session: UserSession = {
      email: demoEmail,
      sessionToken: `local_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      verifiedAt: new Date().toISOString(),
      isAdmin: false,
    };

    onAuthenticated(session, readDeduplicatedLocalProjects());
    setEmail('');
    onClose();
  };

  const handleAdminQuickLogin = () => {
    const adminEmail = 'allmasters13@gmail.com';
    const session: UserSession = {
      email: adminEmail,
      sessionToken: `local_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      verifiedAt: new Date().toISOString(),
      isAdmin: true,
    };

    onAuthenticated(session, readDeduplicatedLocalProjects());
    setEmail('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#16181A]/60 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] text-[#1E2022] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E0D5]">
          <div>
            <h2 className="text-base font-bold text-[#1E2022]">{t.authModal.title}</h2>
            <p className="text-xs text-[#5C6066] mt-0.5">{t.authModal.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.authModal.closeAria}
            className="p-2 rounded-lg border border-[#C9C1B2] hover:border-[#8C6D3F] text-[#5C6066] hover:text-[#1E2022] hover:bg-[#EFECE4] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <form onSubmit={handleQuickLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                {t.authModal.labelEmail}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.createModal.placeholderEmail}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
              />
            </div>
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-[#F5F3EE]" />
              <span>{t.authModal.verifyBtn}</span>
            </button>
          </form>

          {/* Быстрые кнопки для удобного тестирования */}
          <div className="pt-3 border-t border-[#E5E0D5] space-y-2">
            <div className="text-[11px] font-medium text-[#5C6066]">
              {language === 'en' ? 'Quick Access / Demo:' : 'Быстрый доступ и демо:'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleDemoQuickLogin}
                className="px-3 py-2 rounded-lg bg-[#FAF8F3] hover:bg-[#EFECE4] border border-[#C9C1B2] text-xs font-medium text-[#1E2022] cursor-pointer transition-colors"
              >
                {language === 'en' ? 'Demo Mode' : 'Демо-режим'}
              </button>
              <button
                type="button"
                onClick={handleAdminQuickLogin}
                className="px-3 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] border border-white/[0.22] text-xs font-medium text-[#F5F3EE] cursor-pointer transition-colors"
              >
                {language === 'en' ? 'Admin (Allmasters)' : 'Админ (Allmasters)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
