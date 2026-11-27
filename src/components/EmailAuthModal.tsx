import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, User, X } from 'lucide-react';
import type { Language, ProjectRecord, UserSession } from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import { deduplicateProjects } from '../utils/projectDedup';
import {
  fetchAllSharedAnalysesAsCreator,
  fetchMySharedAnalyses,
  getAdminEmail,
  hasLocalCreatorKeyHash,
  isCreatorEmail,
  isFirestoreConfigured,
  verifyOrClaimLocalCreatorKey,
} from '../utils/sharedDatabase';

interface EmailAuthModalProps {
  language: Language;
  isOpen: boolean;
  initialMode?: 'user' | 'creator';
  gasWebhookUrl: string;
  onClose: () => void;
  onAuthenticated: (
    session: UserSession,
    projects: ProjectRecord[],
    options?: {
      creatorKey?: string;
      creatorRemoteProjects?: ProjectRecord[];
    }
  ) => void;
}

function readDeduplicatedLocalProjects(): ProjectRecord[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem('ipds_projects_v1') || '[]'
    ) as ProjectRecord[];
    return deduplicateProjects(parsed);
  } catch {
    return [];
  }
}

export const EmailAuthModal: React.FC<EmailAuthModalProps> = ({
  language,
  isOpen,
  initialMode = 'user',
  onClose,
  onAuthenticated,
}) => {
  const t = getTranslations(language);
  const adminEmail = getAdminEmail();
  const firestoreEnabled = isFirestoreConfigured();

  const [mode, setMode] = useState<'user' | 'creator'>(initialMode);
  const [email, setEmail] = useState('');
  const [creatorEmail, setCreatorEmail] = useState(adminEmail);
  const [adminKey, setAdminKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setAdminKey('');
      if (initialMode === 'creator') {
        setCreatorEmail(adminEmail);
      }
    }
  }, [isOpen, initialMode, adminEmail]);

  if (!isOpen) return null;

  const handleUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t.authModal.errEmpty);
      return;
    }
    if (!trimmed.includes('@')) {
      setError(t.authModal.errEmail);
      return;
    }

    const lowerEmail = trimmed.toLowerCase();
    // Защита: вход под E-mail создателя площадки требует обязательного ввода ключа администратора
    if (isCreatorEmail(lowerEmail)) {
      setCreatorEmail(lowerEmail);
      setMode('creator');
      setError(t.authModal.creatorEnterKeyErr);
      return;
    }

    setLoading(true);
    try {
      const localProjects = readDeduplicatedLocalProjects();
      let remoteProjects: ProjectRecord[] = [];
      if (firestoreEnabled) {
        const res = await fetchMySharedAnalyses(lowerEmail);
        if (res.ok) {
          remoteProjects = res.projects;
        }
      }

      const session: UserSession = {
        email: lowerEmail,
        sessionToken: `local_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        verifiedAt: new Date().toISOString(),
        isAdmin: false,
      };

      onAuthenticated(session, deduplicateProjects([...localProjects, ...remoteProjects]));
      setEmail('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleCreatorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedEmail = creatorEmail.trim().toLowerCase();
    const trimmedKey = adminKey.trim();

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError(t.authModal.errEmail);
      return;
    }
    if (!isCreatorEmail(trimmedEmail)) {
      setError(
        language === 'en'
          ? `Creator access is restricted to ${adminEmail}.`
          : `Доступ создателя разрешён только для ${adminEmail}.`
      );
      return;
    }
    if (trimmedKey.length < 4) {
      setError(t.authModal.creatorEnterKeyErr);
      return;
    }

    setLoading(true);
    try {
      const localProjects = readDeduplicatedLocalProjects();
      let remoteProjects: ProjectRecord[] = [];

      if (firestoreEnabled) {
        const res = await fetchAllSharedAnalysesAsCreator(trimmedEmail, trimmedKey);
        if (!res.ok) {
          setError(
            res.error ||
              (language === 'en'
                ? 'Invalid creator E-mail or administrator key.'
                : 'Неверный E-mail создателя или ключ администратора.')
          );
          return;
        }
        remoteProjects = res.projects;
      } else {
        const localCheck = await verifyOrClaimLocalCreatorKey(trimmedEmail, trimmedKey);
        if (!localCheck.ok) {
          setError(localCheck.error || t.authModal.creatorEnterKeyErr);
          return;
        }
      }

      const session: UserSession = {
        email: trimmedEmail,
        sessionToken: `local_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        verifiedAt: new Date().toISOString(),
        isAdmin: true,
      };

      onAuthenticated(session, localProjects, {
        creatorKey: trimmedKey,
        creatorRemoteProjects: remoteProjects,
      });
      setAdminKey('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleDemoQuickLogin = async () => {
    setError(null);
    const demoEmail = 'demo@ibs-terminal.kz';
    const localProjects = readDeduplicatedLocalProjects();
    let remoteProjects: ProjectRecord[] = [];
    if (firestoreEnabled) {
      const res = await fetchMySharedAnalyses(demoEmail);
      if (res.ok) remoteProjects = res.projects;
    }
    const session: UserSession = {
      email: demoEmail,
      sessionToken: `local_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      verifiedAt: new Date().toISOString(),
      isAdmin: false,
    };

    onAuthenticated(session, deduplicateProjects([...localProjects, ...remoteProjects]));
    setEmail('');
    onClose();
  };

  const showFirstRunLocalHint = !firestoreEnabled && !hasLocalCreatorKeyHash();

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

        <div className="p-6 space-y-4">
          {/* Переключатель режима: Обычный пользователь / Создатель площадки */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#EAE5DB] border border-[#C9C1B2]">
            <button
              type="button"
              onClick={() => {
                setMode('user');
                setError(null);
              }}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                mode === 'user'
                  ? 'bg-[#1A1C1F] text-[#F5F3EE] font-semibold'
                  : 'text-[#5C6066] hover:text-[#1E2022]'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{t.authModal.tabUser}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('creator');
                setError(null);
              }}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                mode === 'creator'
                  ? 'bg-[#1A1C1F] text-[#F5F3EE] font-semibold'
                  : 'text-[#5C6066] hover:text-[#1E2022]'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{t.authModal.tabCreator}</span>
            </button>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800">
              {error}
            </div>
          )}

          {mode === 'user' ? (
            <form onSubmit={(e) => void handleUserLogin(e)} className="space-y-4">
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
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-[#F5F3EE]" />
                <span>{loading ? t.authModal.checking : t.authModal.verifyBtn}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void handleCreatorLogin(e)} className="space-y-3.5">
              <div className="rounded-lg bg-[#EFECE4] border border-[#D8C7A5] px-3 py-2 text-[11px] text-[#4B4333] leading-snug">
                {showFirstRunLocalHint ? t.authModal.creatorLocalSetupHint : t.authModal.creatorDbHint}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3A3D42] mb-1">
                  {t.authModal.labelCreatorEmail}
                </label>
                <input
                  type="email"
                  required
                  value={creatorEmail}
                  onChange={(e) => setCreatorEmail(e.target.value)}
                  placeholder={adminEmail}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3A3D42] mb-1">
                  {t.authModal.labelAdminKey}
                </label>
                <input
                  type="password"
                  required
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  placeholder={t.authModal.placeholderAdminKey}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm font-mono-tabular text-[#1E2022] placeholder:text-[#8B8F96]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
              >
                <KeyRound className="w-4 h-4 text-[#F5F3EE]" />
                <span>{loading ? t.authModal.checking : t.authModal.creatorVerifyBtn}</span>
              </button>
            </form>
          )}

          {/* Быстрые кнопки для удобного тестирования и перехода к режиму создателя */}
          <div className="pt-3 border-t border-[#E5E0D5] space-y-2">
            <div className="text-[11px] font-medium text-[#5C6066]">
              {language === 'en' ? 'Quick Access:' : 'Быстрый доступ:'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleDemoQuickLogin()}
                className="px-3 py-2 rounded-lg bg-[#FAF8F3] hover:bg-[#EFECE4] border border-[#C9C1B2] text-xs font-medium text-[#1E2022] cursor-pointer transition-colors"
              >
                {language === 'en' ? 'Demo Mode' : 'Демо-режим'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setMode('creator');
                  setCreatorEmail(adminEmail);
                  setError(null);
                }}
                className="px-3 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] border border-white/[0.22] text-xs font-medium text-[#F5F3EE] cursor-pointer transition-colors"
              >
                {t.authModal.creatorSwitchBtn}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
