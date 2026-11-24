import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  DialogueMessage,
  FinancialInputs,
  Language,
  LocalDocumentDigest,
  ProjectAnalysis,
  ProjectRecord,
} from '../src/types/ipds';

/**
 * Инициализация клиента Gemini API строго на стороне сервера.
 * API-ключ автоматически подхватывается из переменной окружения process.env.GEMINI_API_KEY
 * (настраивается в панели Settings > Secrets в Google AI Studio или в файле .env).
 */
function getGeminiClient(clientApiKey?: string): GoogleGenAI {
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    clientApiKey ||
    ''
  ).trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY или GOOGLE_API_KEY не настроен на сервере. Добавьте ключ в Settings > Secrets в Google AI Studio или введите ключ в браузере.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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
  const match = msg.match(/"code"\s*:\s*(\d{3})/) || msg.match(/\b(429|503|404|403|401|400)\b/);
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

export function isTransientOverloadError(err: unknown): boolean {
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

export function formatGeminiUserError(err: unknown, language: Language = 'ru'): string {
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

        // For any unexpected model-level error (e.g. empty response or 500), try next model in cascade
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

export async function analyzeProjectWithGemini(
  project: ProjectRecord,
  language: Language = 'ru',
  clientApiKey?: string
): Promise<ProjectAnalysis> {
  const ai = getGeminiClient(clientApiKey);
  const regionLabel =
    project.region === 'Свой вариант' && project.customRegion
      ? project.customRegion
      : project.region;
  const targetLangInstruction =
    language === 'en' ? 'in English' : 'на русском языке';

  const prompt = `Ты — старший инвестиционный аналитик системы «IPDS Терминал» (Intelligent Business Systems).
Проведи глубокий инвестиционный и проектный экспресс-анализ в трёх контурах («Цифры и экономика», «Риски и ограничения» и «Рекомендации» на базе паспорта, локальных документов, расчётов 1-го контура и рисков 2-го контура). Все текстовые поля результата сформируй строго ${targetLangInstruction}.

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
4. В разделе recommendations сформируй 4 блока: analystConclusion (Итоговое заключение аналитика), riskMitigationMeasures (Меры по устранению и снижению рисков), crisisAndBottleneckPlan (План выхода из кризисных и узких точек), growthPlanAndMetrics (План дальнейшего развития и ключевые контрольные метрики).`;

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
            executiveSummary: {
              type: Type.STRING,
              description: 'Краткое инвестиционное резюме проекта (3-5 предложений).',
            },
            baselineInputs: {
              type: Type.OBJECT,
              properties: {
                investmentAmount: {
                  type: Type.NUMBER,
                  description: 'Предполагаемая сумма инвестиций (CAPEX) в полных единицах валюты.',
                },
                monthlyRevenue: {
                  type: Type.NUMBER,
                  description: 'Предполагаемая ежемесячная выручка после выхода на режим, в полных единицах валюты.',
                },
                headcount: {
                  type: Type.INTEGER,
                  description: 'Предполагаемое количество сотрудников (чел.).',
                },
                launchMonths: {
                  type: Type.INTEGER,
                  description: 'Предполагаемый срок запуска в месяцах (целое число, 1-36).',
                },
                monthlyOpex: {
                  type: Type.NUMBER,
                  description: 'Совокупные ежемесячные операционные расходы (ФОТ, аренда, сырьё, маркетинг, налоги) в полных единицах валюты.',
                },
                workingCapitalReservePct: {
                  type: Type.NUMBER,
                  description: 'Резерв на запуск и оборотный капитал в % от инвестиций (обычно 10-25).',
                },
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
            payrollPerEmployeeMonthly: {
              type: Type.NUMBER,
              description: 'Средние ежемесячные затраты на одного сотрудника (ФОТ + налоги) в выбранной валюте.',
            },
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
              description: 'Ключевые драйверы выручки и монетизации (3-5 пунктов).',
            },
            unitEconomicsSummary: {
              type: Type.STRING,
              description: 'Пояснение структуры затрат, маржинальности и логики окупаемости.',
            },
            risks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  dimension: {
                    type: Type.STRING,
                    description: 'Одно из: market, legal, operational, hr, regional',
                  },
                  dimensionLabel: {
                    type: Type.STRING,
                    description: 'Название контура риска по-русски (например: Рыночный риск, Правовой риск, Операционный риск, Кадровый риск, Региональный риск)',
                  },
                  title: { type: Type.STRING },
                  severity: {
                    type: Type.STRING,
                    description: 'Одно из: high, medium, low',
                  },
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
              description: 'Ключевые допущения финансовой модели (3-6 пунктов).',
            },
            preLaunchSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Приоритетные шаги до запуска и привлечения финансирования (3-5 пунктов).',
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

  const parsed = JSON.parse(rawText) as Omit<
    ProjectAnalysis,
    'currencyCode' | 'currencySymbol' | 'generatedAt' | 'modelUsed'
  >;

  const normalizedRisks = (parsed.risks ?? []).map((risk, index) => {
    const dim = (['market', 'legal', 'operational', 'hr', 'regional'].includes(risk.dimension)
      ? risk.dimension
      : 'operational') as ProjectAnalysis['risks'][number]['dimension'];
    const sev = (['high', 'medium', 'low'].includes(risk.severity)
      ? risk.severity
      : 'medium') as ProjectAnalysis['risks'][number]['severity'];

    return {
      id: `risk_${index + 1}`,
      dimension: dim,
      dimensionLabel: risk.dimensionLabel || 'Риск проекта',
      title: risk.title,
      severity: sev,
      description: risk.description,
      mitigation: risk.mitigation,
    };
  });

  return {
    executiveSummary: parsed.executiveSummary,
    currencyCode: project.currencyCode,
    currencySymbol: project.currencySymbol,
    baselineInputs: {
      investmentAmount: Math.max(1, Math.round(parsed.baselineInputs.investmentAmount)),
      monthlyRevenue: Math.max(1, Math.round(parsed.baselineInputs.monthlyRevenue)),
      headcount: Math.max(1, Math.round(parsed.baselineInputs.headcount)),
      launchMonths: Math.max(1, Math.round(parsed.baselineInputs.launchMonths)),
      monthlyOpex: Math.max(1, Math.round(parsed.baselineInputs.monthlyOpex)),
      workingCapitalReservePct: Math.max(
        0,
        Math.min(50, Math.round(parsed.baselineInputs.workingCapitalReservePct))
      ),
    },
    payrollPerEmployeeMonthly: Math.max(1, Math.round(parsed.payrollPerEmployeeMonthly)),
    costStructure: parsed.costStructure ?? [],
    revenueDrivers: parsed.revenueDrivers ?? [],
    unitEconomicsSummary: parsed.unitEconomicsSummary ?? '',
    risks: normalizedRisks,
    assumptions: parsed.assumptions ?? [],
    preLaunchSteps: parsed.preLaunchSteps ?? [],
    recommendations: parsed.recommendations,
    generatedAt: new Date().toISOString(),
    modelUsed,
    modelId,
    usedFallbackModel,
  };
}

export async function chatWithAnalystGemini(
  project: ProjectRecord,
  userMessage: string,
  newDocuments: LocalDocumentDigest[],
  currentEffectiveInputs?: FinancialInputs,
  language: Language = 'ru',
  clientApiKey?: string
): Promise<{
  reply: string;
  suggestedOverrides: Partial<FinancialInputs> | null;
  modelUsed: string;
  modelId: string;
  usedFallbackModel: boolean;
}> {
  const ai = getGeminiClient(clientApiKey);
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

  const replyLangInstruction =
    language === 'en' ? 'in English' : 'на русском языке';

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
            reply: {
              type: Type.STRING,
              description: 'Развёрнутый, чёткий ответ инвестиционного аналитика с опорой на документы и цифры.',
            },
            applyOverrides: {
              type: Type.BOOLEAN,
              description: 'true только если пользователь явно просил изменить цифры модели или новые документы требуют корректировки параметров.',
            },
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

  const parsed = JSON.parse(rawText) as {
    reply: string;
    applyOverrides: boolean;
    investmentAmount?: number;
    monthlyRevenue?: number;
    headcount?: number;
    launchMonths?: number;
    monthlyOpex?: number;
  };

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
    reply: parsed.reply,
    suggestedOverrides,
    modelUsed,
    modelId,
    usedFallbackModel,
  };
}
