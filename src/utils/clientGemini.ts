import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  DialogueMessage,
  FinancialInputs,
  Language,
  LocalDocumentDigest,
  ProjectAnalysis,
  ProjectRecord,
} from '../types/ipds';

export const LS_GEMINI_KEY = 'ipds_gemini_api_key_v1';

export interface RuntimeServerInfo {
  hasBackend: boolean;
  serverGeminiConfigured: boolean;
}

declare global {
  interface Window {
    __IPDS_RUNTIME__?: {
      hasBackend?: boolean;
      serverGeminiConfigured?: boolean;
    };
  }
}

export function getRuntimeServerInfo(): RuntimeServerInfo {
  if (typeof window === 'undefined') {
    return { hasBackend: false, serverGeminiConfigured: false };
  }
  const rt = window.__IPDS_RUNTIME__;
  return {
    hasBackend: Boolean(rt?.hasBackend),
    serverGeminiConfigured: Boolean(rt?.serverGeminiConfigured),
  };
}

export class MissingGeminiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingGeminiKeyError';
  }
}

export function getBuildEnvGeminiApiKey(): string {
  const viteGemini = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || '';
  if (viteGemini.trim()) return viteGemini.trim();
  const viteGoogle = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) || '';
  return viteGoogle.trim();
}

export function getClientGeminiApiKey(): string {
  try {
    const localKey = (localStorage.getItem(LS_GEMINI_KEY) || '').trim();
    if (localKey) return localKey;
  } catch {}
  return getBuildEnvGeminiApiKey();
}

export function isGeminiKeyAvailable(serverGeminiConfiguredOverride?: boolean | null): boolean {
  if (getClientGeminiApiKey()) return true;
  if (typeof serverGeminiConfiguredOverride === 'boolean') {
    return serverGeminiConfiguredOverride;
  }
  return getRuntimeServerInfo().serverGeminiConfigured;
}

export function setClientGeminiApiKey(key: string) {
  try {
    localStorage.setItem(LS_GEMINI_KEY, key.trim());
  } catch {}
}

const PRIMARY_MODEL = 'gemini-3.8-flash';
export const GEMINI_MODEL_CASCADE = [
  PRIMARY_MODEL,
  'gemini-4-hydrogen',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
] as const;
const RETRY_DELAYS_MS = [1000, 2000];

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-4-hydrogen': 'Gemini 4 Flash',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
  'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorText(err: unknown): string {
  if (err instanceof Error) return err.message || '';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function getErrorStatus(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const anyErr = err as { status?: unknown; code?: unknown };
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.code === 'number') return anyErr.code;
  }
  const msg = getErrorText(err);
  const match =
    msg.match(/"code"\s*:\s*(\d{3})/) ||
    msg.match(/\b(429|503|404|403|401|400)\b/);
  return match ? Number(match[1]) : null;
}

function isInvalidApiKeyError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 401) return true;
  const msg = getErrorText(err).toLowerCase();
  return (
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('invalid api key') ||
    msg.includes('api key expired')
  );
}

function isHardQuotaOrModelBlockedError(err: unknown): boolean {
  const status = getErrorStatus(err);
  const msg = getErrorText(err).toLowerCase();
  if (status === 403 || msg.includes('permission_denied')) {
    return !isInvalidApiKeyError(err);
  }
  if (status === 429 || msg.includes('resource_exhausted')) {
    return (
      msg.includes('limit: 0') ||
      msg.includes('free_tier') ||
      msg.includes('billing') ||
      msg.includes('not enabled')
    );
  }
  return false;
}

function isTransientOverloadError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 429 || status === 503) return true;
  const msg = getErrorText(err).toLowerCase();
  return (
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('too many requests') ||
    msg.includes('service unavailable') ||
    msg.includes('rate limit')
  );
}

function isModelNotFoundOrUnsupportedError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 404) return true;
  const msg = getErrorText(err).toLowerCase();
  return (
    msg.includes('not_found') ||
    msg.includes('no longer available') ||
    msg.includes('is not found') ||
    msg.includes('is not supported') ||
    msg.includes('unsupported')
  );
}

function isThinkingConfigError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status !== 400) return false;
  const msg = getErrorText(err).toLowerCase();
  return msg.includes('thinking') || msg.includes('thinking_level') || msg.includes('thinkinglevel');
}

export function getOverloadedCascadeMessage(language: Language = 'ru'): string {
  return language === 'en'
    ? 'The analytical model is overloaded. Please check back in a few minutes.'
    : 'Аналитическая модель перегружена. Зайдите через несколько минут';
}

export function formatGeminiUserError(
  err: unknown,
  language: Language = 'ru'
): string {
  if (err instanceof MissingGeminiKeyError) {
    return err.message;
  }
  if (isInvalidApiKeyError(err)) {
    return language === 'en'
      ? 'Invalid or rejected Gemini API key. Please check your key settings.'
      : 'Недействительный или отклонённый ключ Gemini API. Проверьте настройки ключа.';
  }
  if (
    isTransientOverloadError(err) ||
    isHardQuotaOrModelBlockedError(err) ||
    isModelNotFoundOrUnsupportedError(err)
  ) {
    return getOverloadedCascadeMessage(language);
  }

  const raw = getErrorText(err).trim();
  if (!raw || raw.startsWith('{') || raw.includes('"error"')) {
    return getOverloadedCascadeMessage(language);
  }
  return raw;
}

async function generateWithRetryAndFallback(
  ai: GoogleGenAI,
  params: {
    contents: string;
    config: Record<string, unknown>;
  },
  language: Language
): Promise<{
  text: string;
  modelUsed: string;
  modelId: string;
  usedFallbackModel: boolean;
}> {
  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < GEMINI_MODEL_CASCADE.length; mIdx += 1) {
    const model = GEMINI_MODEL_CASCADE[mIdx];
    let activeConfig: Record<string, unknown> = { ...params.config };

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: activeConfig as never,
        });
        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          throw new Error(
            language === 'en'
              ? 'The model returned an empty response. Please try again.'
              : 'Модель вернула пустой ответ. Повторите попытку.'
          );
        }
        const displayName = MODEL_DISPLAY_NAMES[model] || model;
        return {
          text: rawText,
          modelUsed: `${displayName} (${model})`,
          modelId: model,
          usedFallbackModel: mIdx > 0,
        };
      } catch (err) {
        lastError = err;

        if (isInvalidApiKeyError(err)) {
          throw new Error(formatGeminiUserError(err, language));
        }

        if (isThinkingConfigError(err) && 'thinkingConfig' in activeConfig) {
          const { thinkingConfig: _removed, ...restConfig } = activeConfig;
          activeConfig = restConfig;
          continue;
        }

        if (
          isModelNotFoundOrUnsupportedError(err) ||
          isHardQuotaOrModelBlockedError(err)
        ) {
          break;
        }

        if (isTransientOverloadError(err)) {
          if (attempt < RETRY_DELAYS_MS.length) {
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          break;
        }

        break;
      }
    }
  }

  if (lastError && isInvalidApiKeyError(lastError)) {
    throw new Error(formatGeminiUserError(lastError, language));
  }
  throw new Error(getOverloadedCascadeMessage(language));
}

function buildDocumentsContext(documents: LocalDocumentDigest[]): string {
  if (!documents.length) {
    return 'Пользователь не прикрепил локальные документы. Проведи оценку на базе названия, региона, отрасли и комментария к проекту, явно указав допущения.';
  }
  return documents
    .map(
      (doc, idx) =>
        `--- ДОКУМЕНТ #${idx + 1}: ${doc.name} (${doc.fileType}, ${doc.charCount} симв.) ---\n${doc.extractedText}`
    )
    .join('\n\n');
}

export async function clientAnalyzeProject(
  project: ProjectRecord,
  language: Language = 'ru'
): Promise<ProjectAnalysis> {
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) {
    throw new MissingGeminiKeyError(
      language === 'en'
        ? 'Gemini API key is not configured yet. Please sign in as administrator (?admin=1) to configure it.'
        : 'Ключ Gemini API ещё не задан. Для настройки ключа войдите как администратор или откройте терминал с ?admin=1.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
  });

  const regionLabel =
    project.region === 'Свой вариант' && project.customRegion
      ? project.customRegion
      : project.region;
  const targetLangInstruction = language === 'en' ? 'in English' : 'на русском языке';
  const hasMissingActivityFields =
    !project.businessScope?.trim() ||
    !project.activityType?.trim() ||
    !project.okedCode?.trim();

  const prompt = `Ты — жёсткий инвестиционный комитет и старший проектный/правовой аналитик системы «IPDS Терминал» (Intelligent Business Systems).
Проведи глубокий независимый аудит проекта (НЕ пересказывай слепо цифры из документов инициатора — подвергай их стресс-проверке и критической переоценке) в трёх контурах:
1) Контур «Цифры и экономика» (executiveSummary, investmentCommitteeVerdict, investmentCommitteeVerdictReason, baselineInputs, payrollPerEmployeeMonthly, costStructure, revenueDrivers, unitEconomicsSummary, independentValuation, committeeAudit);
2) Контур «Риски и ограничения» (risks по 5 измерениям, legalCompliance — глубокий правовой и регуляторный срез по региону «${regionLabel}» и виду деятельности/ОКЭД, assumptions, preLaunchSteps);
3) Контур «Рекомендации» (recommendations — заключение, меры по устранению рисков, план выхода из кризисных точек и план роста/KPI на базе 1-го и 2-го контуров).

Все текстовые поля результата сформируй строго ${targetLangInstruction}.

ПАСПОРТ ПРОЕКТА:
- Название проекта: ${project.projectName}
- Инициатор / Контакт: ${project.fullName}
- Регион реализации: ${regionLabel}
- Валюта расчётов: ${project.currencyCode} (${project.currencySymbol})
- Категория / отрасль: ${project.category || 'Не указана'}
- Род деятельности: ${project.businessScope?.trim() || 'НЕ УКАЗАН (требуется определить и предложить)'}
- Вид деятельности: ${project.activityType?.trim() || 'НЕ УКАЗАН (требуется определить и предложить)'}
- Код ОКЭД / ОКВЭД / классификатор: ${project.okedCode?.trim() || 'НЕ УКАЗАН (требуется определить и предложить)'}
- Комментарий инициатора: ${project.comment || 'Нет дополнительного комментария'}

ЛОКАЛЬНО ИЗВЛЕЧЁННЫЙ КОНТЕКСТ ДОКУМЕНТОВ (файлы не загружались в облако, прочитаны на устройстве пользователя):
${buildDocumentsContext(project.documents)}

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ЖЁСТКОГО АУДИТА И ПРАВОВОГО СРЕЗА:
1. ПРАВОВОЙ И РЕГУЛЯТОРНЫЙ СРЕЗ ПО РЕГИОНУ «${regionLabel}» (legalCompliance):
   - Проверь проект по применимому законодательству выбранного региона («${regionLabel}» — для Казахстана: НК РК, ПК РК, ГК РК, УК РК; для РФ: НК РФ, ГК РФ, УК РФ, законы о лицензировании/бизнесе; для Международного/иного региона: применимые налоговые, корпоративные/предпринимательские, гражданские, уголовно-правовые и отраслевые нормы):
     * taxCodeChecks: Налоговый кодекс (спецрежимы vs ОУР, НДС, налоги на ФОТ, трансграничные/дивидендные риски).
     * entrepreneurialCodeChecks: Предпринимательский кодекс / нормы регулирования бизнеса (ОПФ, субсидии, антимонопольные, проверки, статус МСБ).
     * civilCodeChecks: Гражданский кодекс (договорная обвязка, права на ИС/активы, ответственность, возвратность/залоги).
     * criminalCodeRisks: Уголовный кодекс (уголовно-правовые риски: безлицензионная/незаконная деятельность, уклонение от налогов, мошенничество/финансирование, персональные данные, AML/KYC).
     * industryLicensingRequirements: профильные отраслевые лицензии, разрешения, сертификация, техрегламенты.
     * legalStopFactors: 2–4 конкретных правовых стоп-фактора.
   - Если род деятельности, вид деятельности или код ОКЭД не заполнены (${hasMissingActivityFields ? 'СЕЙЧАС НЕ ЗАПОЛНЕНЫ' : 'заполнены'}), обязательно укажи в missingFieldsWarning, каких полей не хватает, установи activityClassificationStatus = "missing_suggested" (или "provided", если все 3 заполнены) и предложи наиболее точные suggestedBusinessScope, suggestedActivityType и suggestedOkedCode на основе сути проекта и документов.
2. НЕЗАВИСИМАЯ ПЕРЕОЦЕНКА ТЕРМИНАЛА (independentValuation И baselineInputs):
   - НЕ повторяй слепо оптимистичные цифры инициатора. В baselineInputs заложи РЕАЛИСТИЧНУЮ оценку терминала с учётом скрытых затрат, оборотного капитала и буфера.
   - В independentValuation сопоставь «Заявлено в документах» vs «Реалистичная оценка терминала»:
     * claimedProjectValue vs realisticProjectValueRange + valuationMethodology (обоснуй диапазон оценки бизнеса сейчас);
     * claimedInvestment vs realisticInvestmentAmount + investmentGapExplanation (почему реально нужно больше с учётом ФОТ на разгон, маркетинга, лицензий и резерва);
     * claimedPayback vs realisticPaybackBase и realisticPaybackStress + paybackComment.
3. АУДИТ ЖЁСТКОГО ИНВЕСТ-КОМИТЕТА (investmentCommitteeVerdict + committeeAudit):
   - Вынеси вердикт GO, CONDITIONAL_GO или NO_GO и краткое жёсткое обоснование (investmentCommitteeVerdictReason).
   - Проверь: unitEconomicsCheck (LTV/CAC, Burn Rate, маржа, масштабируемость), demandAndPainCheck (реальная боль и подтверждённый спрос), competitiveMoatCheck (защитимый «ров»), teamAndSkinInTheGame (команда и «шкура на кону»), stressTestSummary (задержка запуска +3–6 мес., рост CAPEX/OPEX +20–30%, просадка выручки -25–30%), exitAndTrancheLogic (логика выхода и транши под KPI).
   - В unverifiedRedFlags явно перечисли пункты с пометкой «Данные не подтверждены / Красный флаг: ...» (или EN equivalent), где цифры/обещания не подтверждены фактами.
   - В founderHardQuestions сформулируй 4–6 прямых неудобных вопросов основателю.
4. МАТЕМАТИКА И КОНТУРЫ:
   - Все суммы в baselineInputs, payrollPerEmployeeMonthly, costStructure.amount указывай в полных единицах валюты (${project.currencyCode}), без сокращений. Сумма costStructure.amount ≈ investmentAmount, сумма sharePct ≈ 100%.
   - В risks обязательно покрой все 5 контуров: market, legal, operational, hr, regional.
   - В recommendations заполни analystConclusion, riskMitigationMeasures, crisisAndBottleneckPlan, growthPlanAndMetrics (по 3–5 пунктов).`;

  const { text: rawText, modelUsed, modelId, usedFallbackModel } =
    await generateWithRetryAndFallback(
    ai,
    {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            investmentCommitteeVerdict: {
              type: Type.STRING,
              description: 'One of: GO, CONDITIONAL_GO, NO_GO',
            },
            investmentCommitteeVerdictReason: { type: Type.STRING },
            baselineInputs: {
              type: Type.OBJECT,
              properties: {
                investmentAmount: { type: Type.NUMBER },
                monthlyRevenue: { type: Type.NUMBER },
                headcount: { type: Type.INTEGER },
                launchMonths: { type: Type.INTEGER },
                monthlyOpex: { type: Type.NUMBER },
                workingCapitalReservePct: { type: Type.NUMBER },
              },
              required: [
                'investmentAmount',
                'monthlyRevenue',
                'headcount',
                'launchMonths',
                'monthlyOpex',
                'workingCapitalReservePct',
              ],
            },
            payrollPerEmployeeMonthly: { type: Type.NUMBER },
            costStructure: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  sharePct: { type: Type.NUMBER },
                  note: { type: Type.STRING },
                },
                required: ['category', 'amount', 'sharePct', 'note'],
              },
            },
            revenueDrivers: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            unitEconomicsSummary: { type: Type.STRING },
            independentValuation: {
              type: Type.OBJECT,
              properties: {
                claimedProjectValue: { type: Type.STRING },
                realisticProjectValueRange: { type: Type.STRING },
                valuationMethodology: { type: Type.STRING },
                claimedInvestment: { type: Type.STRING },
                realisticInvestmentAmount: { type: Type.STRING },
                investmentGapExplanation: { type: Type.STRING },
                claimedPayback: { type: Type.STRING },
                realisticPaybackBase: { type: Type.STRING },
                realisticPaybackStress: { type: Type.STRING },
                paybackComment: { type: Type.STRING },
              },
              required: [
                'claimedProjectValue',
                'realisticProjectValueRange',
                'valuationMethodology',
                'claimedInvestment',
                'realisticInvestmentAmount',
                'investmentGapExplanation',
                'claimedPayback',
                'realisticPaybackBase',
                'realisticPaybackStress',
                'paybackComment',
              ],
            },
            committeeAudit: {
              type: Type.OBJECT,
              properties: {
                unitEconomicsCheck: { type: Type.STRING },
                demandAndPainCheck: { type: Type.STRING },
                competitiveMoatCheck: { type: Type.STRING },
                teamAndSkinInTheGame: { type: Type.STRING },
                stressTestSummary: { type: Type.STRING },
                exitAndTrancheLogic: { type: Type.STRING },
                unverifiedRedFlags: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                founderHardQuestions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'unitEconomicsCheck',
                'demandAndPainCheck',
                'competitiveMoatCheck',
                'teamAndSkinInTheGame',
                'stressTestSummary',
                'exitAndTrancheLogic',
                'unverifiedRedFlags',
                'founderHardQuestions',
              ],
            },
            legalCompliance: {
              type: Type.OBJECT,
              properties: {
                jurisdictionSummary: { type: Type.STRING },
                activityClassificationStatus: {
                  type: Type.STRING,
                  description: 'One of: provided, missing_suggested',
                },
                suggestedBusinessScope: { type: Type.STRING },
                suggestedActivityType: { type: Type.STRING },
                suggestedOkedCode: { type: Type.STRING },
                missingFieldsWarning: { type: Type.STRING },
                taxCodeChecks: { type: Type.STRING },
                entrepreneurialCodeChecks: { type: Type.STRING },
                civilCodeChecks: { type: Type.STRING },
                criminalCodeRisks: { type: Type.STRING },
                industryLicensingRequirements: { type: Type.STRING },
                legalStopFactors: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'jurisdictionSummary',
                'activityClassificationStatus',
                'suggestedBusinessScope',
                'suggestedActivityType',
                'suggestedOkedCode',
                'missingFieldsWarning',
                'taxCodeChecks',
                'entrepreneurialCodeChecks',
                'civilCodeChecks',
                'criminalCodeRisks',
                'industryLicensingRequirements',
                'legalStopFactors',
              ],
            },
            risks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  dimension: { type: Type.STRING },
                  dimensionLabel: { type: Type.STRING },
                  title: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  description: { type: Type.STRING },
                  mitigation: { type: Type.STRING },
                },
                required: [
                  'dimension',
                  'dimensionLabel',
                  'title',
                  'severity',
                  'description',
                  'mitigation',
                ],
              },
            },
            assumptions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            preLaunchSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            recommendations: {
              type: Type.OBJECT,
              properties: {
                analystConclusion: { type: Type.STRING },
                riskMitigationMeasures: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                crisisAndBottleneckPlan: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                growthPlanAndMetrics: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'analystConclusion',
                'riskMitigationMeasures',
                'crisisAndBottleneckPlan',
                'growthPlanAndMetrics',
              ],
            },
          },
          required: [
            'executiveSummary',
            'investmentCommitteeVerdict',
            'investmentCommitteeVerdictReason',
            'baselineInputs',
            'payrollPerEmployeeMonthly',
            'costStructure',
            'revenueDrivers',
            'unitEconomicsSummary',
            'independentValuation',
            'committeeAudit',
            'legalCompliance',
            'risks',
            'assumptions',
            'preLaunchSteps',
            'recommendations',
          ],
        },
      },
    },
    language
  );

  const parsed = JSON.parse(rawText) as any;
  const normalizedRisks = (parsed.risks ?? []).map((risk: any, index: number) => ({
    id: `risk_${index + 1}`,
    dimension: ['market', 'legal', 'operational', 'hr', 'regional'].includes(risk.dimension)
      ? risk.dimension
      : 'operational',
    dimensionLabel: risk.dimensionLabel || 'Риск проекта',
    title: risk.title || 'Риск',
    severity: ['high', 'medium', 'low'].includes(risk.severity) ? risk.severity : 'medium',
    description: risk.description || '',
    mitigation: risk.mitigation || '',
  }));

  const rawRec = parsed.recommendations || {};
  const normalizedRecommendations = {
    analystConclusion:
      typeof rawRec.analystConclusion === 'string' ? rawRec.analystConclusion.trim() : '',
    riskMitigationMeasures: Array.isArray(rawRec.riskMitigationMeasures)
      ? rawRec.riskMitigationMeasures.map((s: unknown) => String(s || '').trim()).filter(Boolean)
      : [],
    crisisAndBottleneckPlan: Array.isArray(rawRec.crisisAndBottleneckPlan)
      ? rawRec.crisisAndBottleneckPlan.map((s: unknown) => String(s || '').trim()).filter(Boolean)
      : [],
    growthPlanAndMetrics: Array.isArray(rawRec.growthPlanAndMetrics)
      ? rawRec.growthPlanAndMetrics.map((s: unknown) => String(s || '').trim()).filter(Boolean)
      : [],
  };

  const rawVerdict = String(parsed.investmentCommitteeVerdict || '').toUpperCase().trim();
  const normalizedVerdict =
    rawVerdict === 'GO' || rawVerdict === 'CONDITIONAL_GO' || rawVerdict === 'NO_GO'
      ? rawVerdict
      : 'CONDITIONAL_GO';

  const rawVal = parsed.independentValuation || {};
  const normalizedValuation = {
    claimedProjectValue: String(rawVal.claimedProjectValue || '—').trim(),
    realisticProjectValueRange: String(rawVal.realisticProjectValueRange || '—').trim(),
    valuationMethodology: String(rawVal.valuationMethodology || '').trim(),
    claimedInvestment: String(rawVal.claimedInvestment || '—').trim(),
    realisticInvestmentAmount: String(rawVal.realisticInvestmentAmount || '—').trim(),
    investmentGapExplanation: String(rawVal.investmentGapExplanation || '').trim(),
    claimedPayback: String(rawVal.claimedPayback || '—').trim(),
    realisticPaybackBase: String(rawVal.realisticPaybackBase || '—').trim(),
    realisticPaybackStress: String(rawVal.realisticPaybackStress || '—').trim(),
    paybackComment: String(rawVal.paybackComment || '').trim(),
  };

  const rawAudit = parsed.committeeAudit || {};
  const normalizedAudit = {
    unitEconomicsCheck: String(rawAudit.unitEconomicsCheck || '').trim(),
    demandAndPainCheck: String(rawAudit.demandAndPainCheck || '').trim(),
    competitiveMoatCheck: String(rawAudit.competitiveMoatCheck || '').trim(),
    teamAndSkinInTheGame: String(rawAudit.teamAndSkinInTheGame || '').trim(),
    stressTestSummary: String(rawAudit.stressTestSummary || '').trim(),
    exitAndTrancheLogic: String(rawAudit.exitAndTrancheLogic || '').trim(),
    unverifiedRedFlags: Array.isArray(rawAudit.unverifiedRedFlags)
      ? rawAudit.unverifiedRedFlags.map((s: unknown) => String(s || '').trim()).filter(Boolean)
      : [],
    founderHardQuestions: Array.isArray(rawAudit.founderHardQuestions)
      ? rawAudit.founderHardQuestions.map((s: unknown) => String(s || '').trim()).filter(Boolean)
      : [],
  };

  const rawLegal = parsed.legalCompliance || {};
  const normalizedLegal = {
    jurisdictionSummary: String(rawLegal.jurisdictionSummary || '').trim(),
    activityClassificationStatus: (hasMissingActivityFields
      ? 'missing_suggested'
      : rawLegal.activityClassificationStatus === 'missing_suggested'
      ? 'missing_suggested'
      : 'provided') as 'provided' | 'missing_suggested',
    suggestedBusinessScope: String(
      rawLegal.suggestedBusinessScope || project.businessScope || ''
    ).trim(),
    suggestedActivityType: String(
      rawLegal.suggestedActivityType || project.activityType || ''
    ).trim(),
    suggestedOkedCode: String(rawLegal.suggestedOkedCode || project.okedCode || '').trim(),
    missingFieldsWarning: String(rawLegal.missingFieldsWarning || '').trim(),
    taxCodeChecks: String(rawLegal.taxCodeChecks || '').trim(),
    entrepreneurialCodeChecks: String(rawLegal.entrepreneurialCodeChecks || '').trim(),
    civilCodeChecks: String(rawLegal.civilCodeChecks || '').trim(),
    criminalCodeRisks: String(rawLegal.criminalCodeRisks || '').trim(),
    industryLicensingRequirements: String(rawLegal.industryLicensingRequirements || '').trim(),
    legalStopFactors: Array.isArray(rawLegal.legalStopFactors)
      ? rawLegal.legalStopFactors.map((s: unknown) => String(s || '').trim()).filter(Boolean)
      : [],
  };

  return {
    executiveSummary: parsed.executiveSummary || '',
    investmentCommitteeVerdict: normalizedVerdict,
    investmentCommitteeVerdictReason: String(parsed.investmentCommitteeVerdictReason || '').trim(),
    currencyCode: project.currencyCode,
    currencySymbol: project.currencySymbol,
    baselineInputs: {
      investmentAmount: Math.max(1, Math.round(parsed.baselineInputs?.investmentAmount || 1000000)),
      monthlyRevenue: Math.max(1, Math.round(parsed.baselineInputs?.monthlyRevenue || 500000)),
      headcount: Math.max(1, Math.round(parsed.baselineInputs?.headcount || 5)),
      launchMonths: Math.max(1, Math.round(parsed.baselineInputs?.launchMonths || 6)),
      monthlyOpex: Math.max(1, Math.round(parsed.baselineInputs?.monthlyOpex || 200000)),
      workingCapitalReservePct: Math.max(
        0,
        Math.min(50, Math.round(parsed.baselineInputs?.workingCapitalReservePct || 15))
      ),
    },
    payrollPerEmployeeMonthly: Math.max(1, Math.round(parsed.payrollPerEmployeeMonthly || 80000)),
    costStructure: parsed.costStructure ?? [],
    revenueDrivers: parsed.revenueDrivers ?? [],
    unitEconomicsSummary: parsed.unitEconomicsSummary ?? '',
    independentValuation: normalizedValuation,
    committeeAudit: normalizedAudit,
    legalCompliance: normalizedLegal,
    risks: normalizedRisks,
    assumptions: parsed.assumptions ?? [],
    preLaunchSteps: parsed.preLaunchSteps ?? [],
    recommendations: normalizedRecommendations,
    generatedAt: new Date().toISOString(),
    modelUsed,
    modelId,
    usedFallbackModel,
  };
}

export async function clientChatWithAnalyst(
  project: ProjectRecord,
  userMessage: string,
  newDocuments: LocalDocumentDigest[],
  currentEffectiveInputs?: FinancialInputs,
  language: Language = 'ru'
): Promise<{
  reply: string;
  suggestedOverrides: Partial<FinancialInputs> | null;
  modelUsed: string;
  modelId: string;
  usedFallbackModel: boolean;
}> {
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) {
    throw new MissingGeminiKeyError(
      language === 'en'
        ? 'Gemini API key is not configured yet. Please sign in as administrator (?admin=1) to configure it.'
        : 'Ключ Gemini API ещё не задан. Для настройки ключа войдите как администратор или откройте терминал с ?admin=1.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
  });

  const regionLabel =
    project.region === 'Свой вариант' && project.customRegion
      ? project.customRegion
      : project.region;

  const historyText = project.dialogue
    .slice(-12)
    .map(
      (msg: DialogueMessage) =>
        `[${msg.role === 'user' ? 'Инициатор' : 'Аналитик IPDS'}]: ${msg.content}`
    )
    .join('\n\n');

  const newDocsBlock =
    newDocuments.length > 0
      ? `\nНОВЫЕ ЛОКАЛЬНЫЕ ДОКУМЕНТЫ, ПРИКРЕПЛЁННЫЕ К ЭТОМУ СООБЩЕНИЮ:\n${buildDocumentsContext(newDocuments)}`
      : '';

  const currentModelBlock = currentEffectiveInputs
    ? `\nТЕКУЩИЕ АКТУАЛЬНЫЕ ЦИФРЫ В МОДЕЛИ (${project.currencyCode}):
- Сумма инвестиций: ${currentEffectiveInputs.investmentAmount}
- Ежемесячная выручка: ${currentEffectiveInputs.monthlyRevenue}
- Штат: ${currentEffectiveInputs.headcount} чел.
- Срок запуска: ${currentEffectiveInputs.launchMonths} мес.
- Ежемесячный OPEX: ${currentEffectiveInputs.monthlyOpex}`
    : '';

  const existingContoursBlock = project.analysis
    ? `\nТЕКУЩИЕ ВЫВОДЫ ПО 3 КОНТУРАМ И КОМИТЕТУ:
- Вердикт комитета: ${project.analysis.investmentCommitteeVerdict || 'CONDITIONAL_GO'} (${project.analysis.investmentCommitteeVerdictReason || ''})
- Контур 1 (Цифры): ${project.analysis.executiveSummary}
- Независимая переоценка: стоимость=${project.analysis.independentValuation?.realisticProjectValueRange || '—'}; инвест=${project.analysis.independentValuation?.realisticInvestmentAmount || '—'}; окупаемость=${project.analysis.independentValuation?.realisticPaybackBase || '—'} / стресс=${project.analysis.independentValuation?.realisticPaybackStress || '—'}
- Красные флаги: ${(project.analysis.committeeAudit?.unverifiedRedFlags || []).join('; ') || 'нет'}
- Правовой срез (${regionLabel}, ОКЭД=${project.okedCode || project.analysis.legalCompliance?.suggestedOkedCode || 'не указан'}): ${(project.analysis.legalCompliance?.legalStopFactors || []).join('; ') || '—'}
- Контур 2 (Риски): ${project.analysis.risks.map((r) => `${r.title} (${r.severity})`).join('; ')}
- Контур 3 (Рекомендации): ${
        project.analysis.recommendations?.analystConclusion ||
        'Рекомендации формируются на базе контуров Цифры и Риски.'
      }`
    : '';

  const replyLangInstruction = language === 'en' ? 'in English' : 'на русском языке';

  const prompt = `Ты — старший инвестиционный и правовой аналитик жёсткого инвест-комитета «IPDS Терминал» (Intelligent Business Systems).
Отвечай предметно, критически, без приукрашивания и строго ${replyLangInstruction}, опираясь на сохранённый паспорт проекта (включая регион, род/вид деятельности и код ОКЭД), правовые нормы региона «${regionLabel}» (Налоговый, Предпринимательский, Гражданский, Уголовный кодексы, лицензирование), независимую переоценку, три контура анализа («Цифры», «Риски», «Рекомендации»), предыдущую переписку и прикреплённые локальные файлы.

ПАСПОРТ ПРОЕКТА:
- Проект: ${project.projectName}
- Регион: ${regionLabel} (${project.currencyCode})
- Категория: ${project.category || 'Не указана'}
- Род деятельности: ${project.businessScope?.trim() || 'Не указан'}
- Вид деятельности: ${project.activityType?.trim() || 'Не указан'}
- Код ОКЭД / классификатор: ${project.okedCode?.trim() || 'Не указан'}
- Комментарий: ${project.comment || 'Нет'}
${currentModelBlock}
${existingContoursBlock}

РАНЕЕ ЗАГРУЖЕННЫЕ ДОКУМЕНТЫ:
${buildDocumentsContext(project.documents)}
${newDocsBlock}

ИСТОРИЯ ДИАЛОГА:
${historyText || 'Диалог только начат.'}

НОВЫЙ ВОПРОС / ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
${userMessage}

Если пользователь просит пересчитать или скорректировать какие-либо финансовые параметры (инвестиции, выручку, штат, срок запуска, OPEX) на основе новых данных или сценария, заполни объект suggestedOverrides (иначе оставь applyOverrides = false).`;

  const { text: rawText, modelUsed, modelId, usedFallbackModel } =
    await generateWithRetryAndFallback(
    ai,
    {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            applyOverrides: { type: Type.BOOLEAN },
            investmentAmount: { type: Type.NUMBER },
            monthlyRevenue: { type: Type.NUMBER },
            headcount: { type: Type.INTEGER },
            launchMonths: { type: Type.INTEGER },
            monthlyOpex: { type: Type.NUMBER },
          },
          required: ['reply', 'applyOverrides'],
        },
      },
    },
    language
  );

  const parsed = JSON.parse(rawText) as any;
  let suggestedOverrides: Partial<FinancialInputs> | null = null;
  if (parsed.applyOverrides) {
    suggestedOverrides = {};
    if (typeof parsed.investmentAmount === 'number' && parsed.investmentAmount > 0) {
      suggestedOverrides.investmentAmount = Math.round(parsed.investmentAmount);
    }
    if (typeof parsed.monthlyRevenue === 'number' && parsed.monthlyRevenue > 0) {
      suggestedOverrides.monthlyRevenue = Math.round(parsed.monthlyRevenue);
    }
    if (typeof parsed.headcount === 'number' && parsed.headcount > 0) {
      suggestedOverrides.headcount = Math.round(parsed.headcount);
    }
    if (typeof parsed.launchMonths === 'number' && parsed.launchMonths >= 0) {
      suggestedOverrides.launchMonths = Math.round(parsed.launchMonths);
    }
    if (typeof parsed.monthlyOpex === 'number' && parsed.monthlyOpex > 0) {
      suggestedOverrides.monthlyOpex = Math.round(parsed.monthlyOpex);
    }
    if (Object.keys(suggestedOverrides).length === 0) {
      suggestedOverrides = null;
    }
  }

  return {
    reply: parsed.reply || '',
    suggestedOverrides,
    modelUsed,
    modelId,
    usedFallbackModel,
  };
}

export async function analyzeProjectSmart(
  project: ProjectRecord,
  language: Language = 'ru',
  sessionToken?: string,
  serverGeminiConfigured?: boolean | null
): Promise<{ analysis: ProjectAnalysis; usedFallbackNoServerKey: boolean }> {
  const runtime = getRuntimeServerInfo();
  const useServerKey =
    runtime.hasBackend &&
    (serverGeminiConfigured ?? runtime.serverGeminiConfigured) === true;

  if (useServerKey) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`;
      }
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/analyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project, language }),
      });

      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; analysis?: ProjectAnalysis };
        if (data?.ok && data.analysis) {
          return { analysis: data.analysis, usedFallbackNoServerKey: false };
        }
      }

      if (res.status !== 404) {
        const errPayload = (await res.json().catch(() => null)) as {
          code?: string;
          error?: string;
        } | null;
        if (errPayload?.code !== 'NO_API_KEY') {
          throw new Error(errPayload?.error || formatGeminiUserError(null, language));
        }
      }
    } catch (err) {
      // If it's a real non-key backend/overload error (not network/404/NO_API_KEY), surface it
      if (
        err instanceof Error &&
        !(err instanceof TypeError) &&
        !getClientGeminiApiKey()
      ) {
        throw err;
      }
      if (err instanceof Error && !(err instanceof TypeError)) {
        // Only fall back to client key if user actually has a client key configured
        if (!getClientGeminiApiKey()) {
          throw err;
        }
      }
    }
  }

  const analysis = await clientAnalyzeProject(project, language);
  return { analysis, usedFallbackNoServerKey: true };
}

export async function chatWithAnalystSmart(
  project: ProjectRecord,
  userMessage: string,
  newDocuments: LocalDocumentDigest[],
  currentEffectiveInputs?: FinancialInputs,
  language: Language = 'ru',
  sessionToken?: string,
  serverGeminiConfigured?: boolean | null
): Promise<{
  reply: string;
  suggestedOverrides: Partial<FinancialInputs> | null;
  modelUsed: string;
  modelId: string;
  usedFallbackModel: boolean;
  usedFallbackNoServerKey: boolean;
}> {
  const runtime = getRuntimeServerInfo();
  const useServerKey =
    runtime.hasBackend &&
    (serverGeminiConfigured ?? runtime.serverGeminiConfigured) === true;

  if (useServerKey) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`;
      }
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          project,
          message: userMessage,
          newDocuments,
          currentEffectiveInputs,
          language,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          assistantMessage?: {
            content?: string;
            suggestedOverrides?: Partial<FinancialInputs> | null;
            modelUsed?: string;
            modelId?: string;
            usedFallbackModel?: boolean;
          };
        };
        if (data?.ok && data.assistantMessage?.content) {
          return {
            reply: data.assistantMessage.content,
            suggestedOverrides: data.assistantMessage.suggestedOverrides ?? null,
            modelUsed: data.assistantMessage.modelUsed || 'Gemini',
            modelId: data.assistantMessage.modelId || '',
            usedFallbackModel: Boolean(data.assistantMessage.usedFallbackModel),
            usedFallbackNoServerKey: false,
          };
        }
      }

      if (res.status !== 404) {
        const errPayload = (await res.json().catch(() => null)) as {
          code?: string;
          error?: string;
        } | null;
        if (errPayload?.code !== 'NO_API_KEY') {
          throw new Error(errPayload?.error || formatGeminiUserError(null, language));
        }
      }
    } catch (err) {
      if (err instanceof Error && !(err instanceof TypeError)) {
        if (!getClientGeminiApiKey()) {
          throw err;
        }
      }
    }
  }

  const resClient = await clientChatWithAnalyst(
    project,
    userMessage,
    newDocuments,
    currentEffectiveInputs,
    language
  );
  return { ...resClient, usedFallbackNoServerKey: true };
}

