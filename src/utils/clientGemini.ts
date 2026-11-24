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
const MODEL_CHAIN = [
  PRIMARY_MODEL,
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;
const PRIMARY_RETRY_DELAYS_MS = [2000, 4000];
const FALLBACK_RETRY_DELAYS_MS = [2000];

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-4-hydrogen': 'Gemini 4 Flash',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
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

function isModelNotFoundError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 404) return true;
  const msg = getErrorText(err).toLowerCase();
  return (
    msg.includes('not_found') ||
    msg.includes('no longer available') ||
    msg.includes('is not found')
  );
}

function isApiKeyError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 401 || status === 403) return true;
  const msg = getErrorText(err).toLowerCase();
  return (
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('permission_denied')
  );
}

export function formatGeminiUserError(
  err: unknown,
  language: Language = 'ru'
): string {
  if (err instanceof MissingGeminiKeyError) {
    return err.message;
  }
  if (isTransientOverloadError(err)) {
    return language === 'en'
      ? 'AI service is temporarily overloaded. Please try again in 10–15 seconds.'
      : 'Сервис ИИ временно перегружен, попробуйте повторить запрос через 10–15 секунд.';
  }
  if (isApiKeyError(err)) {
    return language === 'en'
      ? 'Invalid or rejected Gemini API key. Please check your key settings.'
      : 'Недействительный или отклонённый ключ Gemini API. Проверьте настройки ключа.';
  }

  const raw = getErrorText(err).trim();
  if (!raw || raw.startsWith('{') || raw.includes('"error"')) {
    return language === 'en'
      ? 'Failed to get a response from the AI service. Please try again.'
      : 'Не удалось получить ответ от сервиса ИИ. Повторите попытку.';
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
): Promise<{ text: string; modelUsed: string }> {
  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < MODEL_CHAIN.length; mIdx += 1) {
    const model = MODEL_CHAIN[mIdx];
    const delays =
      mIdx === 0 ? PRIMARY_RETRY_DELAYS_MS : FALLBACK_RETRY_DELAYS_MS;

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config as never,
        });
        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          throw new Error(
            language === 'en'
              ? 'The model returned an empty response. Please try again.'
              : 'Модель вернула пустой ответ. Повторите попытку.'
          );
        }
        return {
          text: rawText,
          modelUsed: MODEL_DISPLAY_NAMES[model] || model,
        };
      } catch (err) {
        lastError = err;

        if (isApiKeyError(err)) {
          throw new Error(formatGeminiUserError(err, language));
        }

        if (isModelNotFoundError(err)) {
          break;
        }

        if (isTransientOverloadError(err)) {
          if (attempt < delays.length) {
            await sleep(delays[attempt]);
            continue;
          }
          break;
        }

        throw new Error(formatGeminiUserError(err, language));
      }
    }
  }

  throw new Error(formatGeminiUserError(lastError, language));
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

  const prompt = `Ты — старший инвестиционный аналитик системы «IPDS Терминал» (Intelligent Business Systems).
Проведи глубокий инвестиционный и проектный экспресс-анализ в трёх контурах:
1) Контур «Цифры и экономика» (baselineInputs, payrollPerEmployeeMonthly, costStructure, revenueDrivers, unitEconomicsSummary, executiveSummary);
2) Контур «Риски и ограничения» (risks, assumptions, preLaunchSteps);
3) Контур «Рекомендации» (recommendations — опираясь на данные паспорта проекта, загруженные локальные документы, расчёты 1-го контура «Цифры» и выявленные риски 2-го контура «Риски»).

Все текстовые поля результата (executiveSummary, costStructure.category, costStructure.note, revenueDrivers, unitEconomicsSummary, risks.dimensionLabel, risks.title, risks.description, risks.mitigation, assumptions, preLaunchSteps, recommendations.analystConclusion, recommendations.riskMitigationMeasures, recommendations.crisisAndBottleneckPlan, recommendations.growthPlanAndMetrics) сформируй строго ${targetLangInstruction}.

ПАСПОРТ ПРОЕКТА:
- Название проекта: ${project.projectName}
- Инициатор / Контакт: ${project.fullName}
- Регион реализации: ${regionLabel}
- Валюта расчётов: ${project.currencyCode} (${project.currencySymbol})
- Категория / отрасль: ${project.category || 'Не указана'}
- Комментарий инициатора: ${project.comment || 'Нет дополнительного комментария'}

ЛОКАЛЬНО ИЗВЛЕЧЁННЫЙ КОНТЕКСТ ДОКУМЕНТОВ (файлы не загружались в облако, прочитаны на устройстве пользователя):
${buildDocumentsContext(project.documents)}

ТРЕБОВАНИЯ К РАСЧЁТАМ И РЕКОМЕНДАЦИЯМ:
1. Все денежные суммы (investmentAmount, monthlyRevenue, monthlyOpex, payrollPerEmployeeMonthly, costStructure.amount) указывай в полных единицах выбранной валюты (${project.currencyCode}, например 15000000 для 15 млн), без сокращений.
2. Обеспечь математическую согласованность: сумма costStructure.amount должна примерно соответствовать investmentAmount, сумма costStructure.sharePct должна быть близка к 100%, а monthlyRevenue и monthlyOpex должны отражать реалистичную экономику для региона «${regionLabel}».
3. В разделе risks обязательно покрой все 5 контуров: market (Рыночные), legal (Правовые и регуляторные), operational (Операционные), hr (Кадровые), regional (Региональные для «${regionLabel}»).
4. В разделе recommendations обязательно сформируй 4 структурированных блока (по 3–5 конкретных пунктов в каждом списке, привязанных к цифрам и рискам именно этого проекта):
   - analystConclusion: Итоговое заключение аналитика (целостный вердикт по реализуемости, экономике, окупаемости и ключевому условию успеха, 3–5 предложений);
   - riskMitigationMeasures: Меры по устранению и снижению рисков (прикладные шаги, напрямую закрывающие выявленные риски из 2-го контура);
   - crisisAndBottleneckPlan: План выхода из кризисных и узких точек (антикризисные действия на случай просадки спроса, кассового разрыва, задержки запуска или регуляторных ограничений);
   - growthPlanAndMetrics: План дальнейшего развития и ключевые контрольные метрики (поэтапное масштабирование и конкретные KPI/пороги контроля).`;

  const { text: rawText, modelUsed } = await generateWithRetryAndFallback(
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
            'baselineInputs',
            'payrollPerEmployeeMonthly',
            'costStructure',
            'revenueDrivers',
            'unitEconomicsSummary',
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

  return {
    executiveSummary: parsed.executiveSummary || '',
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
    risks: normalizedRisks,
    assumptions: parsed.assumptions ?? [],
    preLaunchSteps: parsed.preLaunchSteps ?? [],
    recommendations: normalizedRecommendations,
    generatedAt: new Date().toISOString(),
    modelUsed,
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
    ? `\nТЕКУЩИЕ ВЫВОДЫ ПО 3 КОНТУРАМ АНАЛИЗА:
- Контур 1 (Цифры): ${project.analysis.executiveSummary}
- Контур 2 (Риски): ${project.analysis.risks.map((r) => `${r.title} (${r.severity})`).join('; ')}
- Контур 3 (Рекомендации): ${
        project.analysis.recommendations?.analystConclusion ||
        'Рекомендации формируются на базе контуров Цифры и Риски.'
      }`
    : '';

  const replyLangInstruction = language === 'en' ? 'in English' : 'на русском языке';

  const prompt = `Ты — инвестиционный аналитик «IPDS Терминал» (Intelligent Business Systems).
Отвечай предметно, профессионально и строго ${replyLangInstruction}, опираясь на сохранённый паспорт проекта, три контура анализа («Цифры», «Риски», «Рекомендации»), предыдущую переписку и прикреплённые локальные файлы.

ПАСПОРТ ПРОЕКТА:
- Проект: ${project.projectName}
- Регион: ${regionLabel} (${project.currencyCode})
- Категория: ${project.category || 'Не указана'}
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

  const { text: rawText } = await generateWithRetryAndFallback(
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
          };
        };
        if (data?.ok && data.assistantMessage?.content) {
          return {
            reply: data.assistantMessage.content,
            suggestedOverrides: data.assistantMessage.suggestedOverrides ?? null,
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

