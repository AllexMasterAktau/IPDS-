import React, { useState } from 'react';
import { KeyRound, Mail, ShieldCheck, X } from 'lucide-react';
import type { Language, ProjectRecord, UserSession } from '../types/ipds';
import { getTranslations } from '../i18n/translations';

interface EmailAuthModalProps {
  language: Language;
  isOpen: boolean;
  gasWebhookUrl: string;
  onClose: () => void;
  onAuthenticated: (session: UserSession, projects: ProjectRecord[]) => void;
}

export const EmailAuthModal: React.FC<EmailAuthModalProps> = ({
  language,
  isOpen,
  gasWebhookUrl,
  onClose,
  onAuthenticated,
}) => {
  const t = getTranslations(language);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleQuickLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError(t.authModal.errEmail);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sign in.');
      }

      const session: UserSession = {
        email: data.email,
        sessionToken: data.sessionToken,
        accessKeyHint: data.accessKeyHint,
        verifiedAt: new Date().toISOString(),
        isAdmin: Boolean(data.isAdmin),
      };
      onAuthenticated(session, data.projects ?? []);
      setEmail('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in error.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoQuickLogin = async () => {
    setEmail('demo@ibs-terminal.kz');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@ibs-terminal.kz' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sign in.');
      }
      const session: UserSession = {
        email: data.email,
        sessionToken: data.sessionToken,
        accessKeyHint: data.accessKeyHint,
        verifiedAt: new Date().toISOString(),
        isAdmin: Boolean(data.isAdmin),
      };
      onAuthenticated(session, data.projects ?? []);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in error.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminQuickLogin = async () => {
    setEmail('allmasters13@gmail.com');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'allmasters13@gmail.com' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sign in.');
      }
      const session: UserSession = {
        email: data.email,
        sessionToken: data.sessionToken,
        accessKeyHint: data.accessKeyHint,
        verifiedAt: new Date().toISOString(),
        isAdmin: Boolean(data.isAdmin),
      };
      onAuthenticated(session, data.projects ?? []);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in error.');
    } finally {
      setLoading(false);
    }
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
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800">
              {error}
            </div>
          )}

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
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-[#F5F3EE]" />
              <span>{loading ? t.authModal.checking : t.authModal.verifyBtn}</span>
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
                disabled={loading}
                onClick={() => void handleDemoQuickLogin()}
                className="px-3 py-2 rounded-lg bg-[#FAF8F3] hover:bg-[#EFECE4] border border-[#C9C1B2] text-xs font-medium text-[#1E2022] cursor-pointer transition-colors"
              >
                {language === 'en' ? 'Demo Mode' : 'Демо-режим'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleAdminQuickLogin()}
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
