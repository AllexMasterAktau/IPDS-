import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { CurrencyCode, FxRateMap, FxRatesState, Language } from '../types/ipds';
import { getTranslations } from '../i18n/translations';
import { CURRENCY_SYMBOLS } from '../utils/financialModel';
import { getClientGeminiApiKey, setClientGeminiApiKey } from '../utils/clientGemini';

interface TopBarControlsProps {
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  displayCurrency: CurrencyCode;
  onChangeCurrency: (currency: CurrencyCode) => void;
  fxState: FxRatesState;
  fxLoading: boolean;
  onRefreshFx: () => void;
  onApplyManualFx: (rates: FxRateMap) => void;
  onResetManualFx: () => void;
  variant?: 'light' | 'dark';
  canManageGeminiKey?: boolean;
  serverGeminiConfigured?: boolean | null;
  forceShowKeyButton?: boolean;
  onKeySaved?: () => void;
}

const CURRENCIES: CurrencyCode[] = ['RUB', 'KZT', 'USD'];

export const TopBarControls: React.FC<TopBarControlsProps> = ({
  language,
  onChangeLanguage,
  displayCurrency,
  onChangeCurrency,
  fxState,
  fxLoading,
  onRefreshFx,
  onApplyManualFx,
  onResetManualFx,
  variant = 'light',
  canManageGeminiKey = false,
  serverGeminiConfigured = false,
  onKeySaved,
}) => {
  const t = getTranslations(language);
  const isDark = variant === 'dark';

  const [fxOpen, setFxOpen] = useState(false);
  const [rubInput, setRubInput] = useState(String(fxState.rates.RUB));
  const [kztInput, setKztInput] = useState(String(fxState.rates.KZT));
  const popoverRef = useRef<HTMLDivElement>(null);

  const [keyOpen, setKeyOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => getClientGeminiApiKey());
  const keyPopoverRef = useRef<HTMLDivElement>(null);
  const hasLocalKey = Boolean(getClientGeminiApiKey());
  const hasEffectiveKey = Boolean(hasLocalKey || serverGeminiConfigured);
  const showKeyButton = Boolean(canManageGeminiKey);

  useEffect(() => {
    setRubInput(String(fxState.rates.RUB));
    setKztInput(String(fxState.rates.KZT));
  }, [fxState.rates.RUB, fxState.rates.KZT]);

  useEffect(() => {
    if (!fxOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setFxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [fxOpen]);

  useEffect(() => {
    if (!keyOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (keyPopoverRef.current && !keyPopoverRef.current.contains(e.target as Node)) {
        setKeyOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [keyOpen]);

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    setClientGeminiApiKey(apiKeyInput);
    setKeyOpen(false);
    onKeySaved?.();
  };

  const statusText =
    fxState.source === 'live'
      ? t.header.fxStatusLive
      : fxState.source === 'manual'
      ? t.header.fxStatusManual
      : t.header.fxStatusFallback;

  const formattedTime = (() => {
    try {
      return new Date(fxState.updatedAt).toLocaleString(
        language === 'en' ? 'en-US' : 'ru-RU',
        {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }
      );
    } catch {
      return fxState.updatedAt;
    }
  })();

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rub = Number(rubInput.replace(',', '.'));
    const kzt = Number(kztInput.replace(',', '.'));
    if (!Number.isFinite(rub) || rub <= 0 || !Number.isFinite(kzt) || kzt <= 0) return;
    onApplyManualFx({
      USD: 1,
      RUB: Number(rub.toFixed(2)),
      KZT: Number(kzt.toFixed(2)),
    });
    setFxOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Переключатель валют RUB / KZT / USD + кнопка курсов FX */}
      <div className="relative flex items-center gap-1" ref={popoverRef}>
        <div
          role="group"
          aria-label="Currency selector"
          className={`inline-flex items-center p-0.5 rounded-lg border ${
            isDark
              ? 'bg-[#22252A] border-white/[0.22]'
              : 'bg-[#EAE5DB] border-[#C9C1B2]'
          }`}
        >
          {CURRENCIES.map((code) => {
            const active = displayCurrency === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => onChangeCurrency(code)}
                className={`px-2 py-1 rounded-md text-xs font-mono-tabular transition-colors cursor-pointer whitespace-nowrap border ${
                  active
                    ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE] font-semibold'
                    : isDark
                    ? 'border-transparent hover:border-white/[0.22] text-[#B5B8BF] hover:text-[#F5F3EE]'
                    : 'border-transparent hover:border-[#8C8476]/50 text-[#5C6066] hover:text-[#1E2022]'
                }`}
              >
                {code} {CURRENCY_SYMBOLS[code]}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setFxOpen((v) => !v)}
          title={t.header.fxButtonTitle}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.22] hover:border-white/[0.36] bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] text-xs text-[#F5F3EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap"
        >
          <span className="hidden xl:inline font-medium">{statusText}</span>
          <SlidersHorizontal className="w-3.5 h-3.5 shrink-0 text-[#F5F3EE]" />
        </button>

        {fxOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] text-[#1E2022] shadow-xl p-4 z-50 space-y-3.5">
            <div className="flex items-start justify-between gap-2 border-b border-[#E5E0D5] pb-2.5">
              <div>
                <div className="text-xs font-bold text-[#1E2022]">{t.header.fxPanelTitle}</div>
                <div className="text-[11px] text-[#5C6066] mt-0.5">
                  <span
                    className={`font-semibold ${
                      fxState.source === 'live'
                        ? 'text-emerald-700'
                        : fxState.source === 'manual'
                        ? 'text-[#9A6E2E]'
                        : 'text-amber-700'
                    }`}
                  >
                    {statusText}
                  </span>{' '}
                  · {t.header.fxUpdatedLabel}: {formattedTime}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFxOpen(false)}
                aria-label={t.header.fxCloseBtn}
                className="p-1 rounded-md border border-[#C9C1B2] hover:border-[#8C6D3F] text-[#5C6066] hover:text-[#1E2022] hover:bg-[#EFECE4] transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-[#3A3D42] mb-1">
                    {t.header.fxRubLabel}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={rubInput}
                    onChange={(e) => setRubInput(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs font-mono-tabular text-[#1E2022]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#3A3D42] mb-1">
                    {t.header.fxKztLabel}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={kztInput}
                    onChange={(e) => setKztInput(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs font-mono-tabular text-[#1E2022]"
                  />
                </div>
              </div>

              <div className="text-[11px] text-[#5C6066]">{t.header.fxUsdHint}</div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors"
                >
                  {t.header.fxApplyManualBtn}
                </button>
                <button
                  type="button"
                  disabled={fxLoading}
                  onClick={onRefreshFx}
                  className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-medium text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-3 h-3 text-[#F5F3EE] ${fxLoading ? 'animate-spin' : ''}`} />
                  <span>{fxLoading ? t.header.fxRefreshing : t.header.fxRefreshBtn}</span>
                </button>
                {fxState.source === 'manual' && (
                  <button
                    type="button"
                    onClick={onResetManualFx}
                    className="w-full px-3 py-1.5 rounded-lg border border-white/[0.22] hover:border-white/[0.36] bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] text-[#F5F3EE] text-xs font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors"
                  >
                    {t.header.fxResetAutoBtn}
                  </button>
                )}
              </div>
            </form>

            <div className="text-[10px] text-[#7A7E85] leading-snug pt-1 border-t border-[#E5E0D5]">
              {t.header.fxOfflineNote}
            </div>
          </div>
        )}
      </div>

      {/* Кнопка настройки Gemini API Key (показывается, если серверный ключ не задан или задан локальный) */}
      {showKeyButton && (
        <div className="relative" ref={keyPopoverRef}>
          <button
            type="button"
            onClick={() => {
              setApiKeyInput(getClientGeminiApiKey());
              setKeyOpen((v) => !v);
            }}
            title={language === 'en' ? 'Gemini API Key Settings' : 'Настройка Gemini API Key'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer whitespace-nowrap text-xs ${
              hasEffectiveKey
                ? 'bg-emerald-900/10 border-emerald-600/40 text-emerald-800 hover:bg-emerald-900/20'
                : 'bg-[#1A1C1F] border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline font-medium">
              {hasEffectiveKey
                ? language === 'en'
                  ? 'API Key Set'
                  : 'Ключ задан'
                : language === 'en'
                ? 'Gemini Key'
                : 'Ключ Gemini'}
            </span>
          </button>

          {keyOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-xl bg-[#FAF8F3] border border-[#E5E0D5] text-[#1E2022] shadow-xl p-4 z-50 space-y-3.5">
              <div className="flex items-start justify-between gap-2 border-b border-[#E5E0D5] pb-2.5">
                <div>
                  <div className="text-xs font-bold text-[#1E2022]">
                    {language === 'en' ? 'Gemini API Key' : 'Ключ Gemini API'}
                  </div>
                  <div className="text-[11px] text-[#5C6066] mt-0.5">
                    {serverGeminiConfigured && !hasLocalKey
                      ? language === 'en'
                        ? 'Environment key is active for all users by default. Optional local override:'
                        : 'Ключ из окружения сервера активен по умолчанию. При необходимости задайте локальный:'
                      : language === 'en'
                      ? 'Enter your API key (AIza...) for browser analysis.'
                      : 'Введите ваш ключ (AIza...) для анализа из браузера.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setKeyOpen(false)}
                  className="p-1 rounded-md border border-[#C9C1B2] hover:border-[#8C6D3F] text-[#5C6066] hover:text-[#1E2022] hover:bg-[#EFECE4] transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <form onSubmit={handleSaveKey} className="space-y-3">
                <div>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E5E0D5] focus:border-[#B88B4A] focus:outline-none text-xs font-mono-tabular text-[#1E2022]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] text-[#F5F3EE] font-semibold text-xs cursor-pointer transition-colors"
                  >
                    {language === 'en' ? 'Save Key' : 'Сохранить ключ'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Переключатель языка RU / EN */}
      <div
        role="group"
        aria-label="Language selector"
        className={`inline-flex items-center p-0.5 rounded-lg border ${
          isDark
            ? 'bg-[#22252A] border-white/[0.22]'
            : 'bg-[#EAE5DB] border-[#C9C1B2]'
        }`}
      >
        {(['ru', 'en'] as Language[]).map((lng) => {
          const active = language === lng;
          return (
            <button
              key={lng}
              type="button"
              onClick={() => onChangeLanguage(lng)}
              className={`px-2 py-1 rounded-md text-xs font-semibold uppercase transition-colors cursor-pointer border ${
                active
                  ? 'bg-[#1A1C1F] border-white/[0.26] hover:border-white/[0.38] text-[#F5F3EE]'
                  : isDark
                  ? 'border-transparent hover:border-white/[0.22] text-[#B5B8BF] hover:text-[#F5F3EE]'
                  : 'border-transparent hover:border-[#8C8476]/50 text-[#5C6066] hover:text-[#1E2022]'
              }`}
            >
              {lng.toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
};
