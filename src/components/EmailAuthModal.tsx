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
  const [mode, setMode] = useState<'otp' | 'key'>('otp');
  const [credential, setCredential] = useState('');
  const [codeSentInfo, setCodeSentInfo] = useState<{
    email: string;
    emailDispatchedViaGas: boolean;
    demoOtpCode?: string;
    accountExists: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !email.includes('@')) {
      setError(t.authModal.errEmail);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          gasWebhookUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to request verification code.');
      }
      setCodeSentInfo({
        email: data.email,
        emailDispatchedViaGas: Boolean(data.emailDispatchedViaGas),
        demoOtpCode: data.demoOtpCode,
        accountExists: Boolean(data.accountExists),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code request error.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !credential.trim()) {
      setError(t.authModal.errEmpty);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          credential: credential.trim(),
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify access.');
      }

      const session: UserSession = {
        email: data.email,
        sessionToken: data.sessionToken,
        accessKeyHint: data.accessKeyHint,
        verifiedAt: new Date().toISOString(),
      };
      onAuthenticated(session, data.projects ?? []);
      setCredential('');
      setCodeSentInfo(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification error.');
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
          {/* Переключатель способа подтверждения */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#EAE5DB] border border-[#C9C1B2]">
            <button
              type="button"
              onClick={() => {
                setMode('otp');
                setError(null);
              }}
              className={`px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                mode === 'otp'
                  ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE] font-semibold'
                  : 'border-transparent hover:border-[#8C8476]/50 text-[#5C6066] hover:text-[#1E2022]'
              }`}
            >
              {t.authModal.tabOtp}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('key');
                setError(null);
              }}
              className={`px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                mode === 'key'
                  ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE] font-semibold'
                  : 'border-transparent hover:border-[#8C8476]/50 text-[#5C6066] hover:text-[#1E2022]'
              }`}
            >
              {t.authModal.tabKey}
            </button>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800">
              {error}
            </div>
          )}

          {mode === 'otp' ? (
            <div className="space-y-4">
              <form onSubmit={handleRequestCode} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                    {t.authModal.labelEmail}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t.createModal.placeholderEmail}
                      className="flex-1 min-w-0 px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-sm text-[#1E2022] placeholder:text-[#8B8F96]"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-3.5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-xs font-semibold text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {loading ? t.authModal.sending : t.authModal.getCode}
                    </button>
                  </div>
                </div>
              </form>

              {codeSentInfo && (
                <div className="rounded-lg bg-[#EFECE4] border border-[#D8C7A5] p-3.5 text-xs space-y-1.5">
                  <div className="flex items-center gap-2 font-medium text-[#9A6E2E]">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {codeSentInfo.emailDispatchedViaGas
                        ? t.authModal.codeSentViaGas.replace('{email}', codeSentInfo.email)
                        : t.authModal.codeGenerated.replace('{email}', codeSentInfo.email)}
                    </span>
                  </div>
                  {codeSentInfo.demoOtpCode && (
                    <div className="text-[#1E2022] pt-1">
                      {t.authModal.demoOtpLabel}{' '}
                      <span className="font-mono-tabular font-bold text-[#9A6E2E] text-sm tracking-widest">
                        {codeSentInfo.demoOtpCode}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                    {t.authModal.labelOtpInput}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder="000000"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none font-mono-tabular text-sm text-[#1E2022] placeholder:text-[#8B8F96] tracking-widest"
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
            </div>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
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
              <div>
                <label className="block text-xs font-medium text-[#3A3D42] mb-1.5">
                  {t.authModal.labelKeyInput}
                </label>
                <input
                  type="text"
                  required
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder="IPDS-XXXX-XXXX"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none font-mono-tabular text-sm text-[#1E2022] placeholder:text-[#8B8F96] uppercase"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] disabled:opacity-60 text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
              >
                <KeyRound className="w-4 h-4 text-[#F5F3EE]" />
                <span>{loading ? t.authModal.checking : t.authModal.loginKeyBtn}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
