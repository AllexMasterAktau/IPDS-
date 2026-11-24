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

export class MissingGeminiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingGeminiKeyError';
  }
}

export function getClientGeminiApiKey(): string {
  try {
    return (localStorage.getItem(LS_GEMINI_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setClientGeminiApiKey(key: string) {
  try {
    localStorage.setItem(LS_GEMINI_KEY, key.trim());
  } catch {}
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
        ? 'Gemini API Key is not configured on the server or in your browser. Please enter your Gemini API key (AIza...).'
        : 'Ключ Gemini API не задан на сервере и в браузере. Введите ваш ключ Gemini API (AIza...) для выполнения анализа.'
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
Проведи глубокий инвестиционный и проектный экспресс-анализ в двух контурах («Цифры и экономика» и «Риски и ограничения»). Все текстовые поля результата (executiveSummary, costStructure.category, costStructure.note, revenueDrivers, unitEconomicsSummary, risks.dimensionLabel, risks.title, risks.description, risks.mitigation, assumptions, preLaunchSteps) сформируй строго ${targetLangInstruction}.

ПАСПОРТ ПРОЕКТА:
- Название проекта: ${project.projectName}
- Инициатор / Контакт: ${project.fullName}
- Регион реализации: ${regionLabel}
- Валюта расчётов: ${project.currencyCode} (${project.currencySymbol})
- Категория / отрасль: ${project.category || 'Не указана'}
- Комментарий инициатора: ${project.comment || 'Нет дополнительного комментария'}

ЛОКАЛЬНО ИЗВЛЕЧЁННЫЙ КОНТЕКСТ ДОКУМЕНТОВ (файлы не загружались в облако, прочитаны на устройстве пользователя):
${buildDocumentsContext(project.documents)}

ТРЕБОВАНИЯ К РАСЧЁТАМ:
1. Все денежные суммы (investmentAmount, monthlyRevenue, monthlyOpex, payrollPerEmployeeMonthly, costStructure.amount) указывай в полных единицах выбранной валюты (${project.currencyCode}, например 15000000 для 15 млн), без сокращений.
2. Обеспечь математическую согласованность: сумма costStructure.amount должна примерно соответствовать investmentAmount, сумма costStructure.sharePct должна быть близка к 100%, а monthlyRevenue и monthlyOpex должны отражать реалистичную экономику для региона «${regionLabel}».
3. В разделе risks обязательно покрой все 5 контуров: market (Рыночные), legal (Правовые и регуляторные), operational (Операционные), hr (Кадровые), regional (Региональные для «${regionLabel}»).`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
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
        ],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Модель вернула пустой ответ. Повторите попытку анализа.');
  }

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
    generatedAt: new Date().toISOString(),
    modelUsed: 'Gemini 3.8 Flash',
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
        ? 'Gemini API Key is not configured on the server or in your browser. Please enter your Gemini API key (AIza...).'
        : 'Ключ Gemini API не задан на сервере и в браузере. Введите ваш ключ Gemini API (AIza...) для продолжения диалога.'
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

  const replyLangInstruction = language === 'en' ? 'in English' : 'на русском языке';

  const prompt = `Ты — инвестиционный аналитик «IPDS Терминал» (Intelligent Business Systems).
Отвечай предметно, профессионально и строго ${replyLangInstruction}, опираясь на сохранённый паспорт проекта, предыдущую переписку и прикреплённые локальные файлы.

ПАСПОРТ ПРОЕКТА:
- Проект: ${project.projectName}
- Регион: ${regionLabel} (${project.currencyCode})
- Категория: ${project.category || 'Не указана'}
- Комментарий: ${project.comment || 'Нет'}
${currentModelBlock}

РАНЕЕ ЗАГРУЖЕННЫЕ ДОКУМЕНТЫ:
${buildDocumentsContext(project.documents)}
${newDocsBlock}

ИСТОРИЯ ДИАЛОГА:
${historyText || 'Диалог только начат.'}

НОВЫЙ ВОПРОС / ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
${userMessage}

Если пользователь просит пересчитать или скорректировать какие-либо финансовые параметры (инвестиции, выручку, штат, срок запуска, OPEX) на основе новых данных или сценария, заполни объект suggestedOverrides (иначе оставь applyOverrides = false).`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
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
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Аналитик не смог сформировать ответ. Повторите запрос.');
  }

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
  const clientApiKey = getClientGeminiApiKey();

  if (serverGeminiConfigured !== false) {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/analyze`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          },
          body: JSON.stringify({
            project,
            language,
            ...(clientApiKey ? { clientApiKey } : {}),
          }),
        }
      );

      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();
      let data: any = null;
      if (contentType.includes('application/json') && rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = null;
        }
      }

      if (res.ok && data?.ok !== false && data?.analysis) {
        return {
          analysis: data.analysis as ProjectAnalysis,
          usedFallbackNoServerKey: false,
        };
      }

      // Если сервер не настроен (404 / не JSON / нет серверного ключа), переходим на клиентский fallback
      if (
        res.status === 404 ||
        !data ||
        data.code === 'NO_API_KEY'
      ) {
        const analysis = await clientAnalyzeProject(project, language);
        return { analysis, usedFallbackNoServerKey: true };
      }

      throw new Error(
        data.error ||
          data.message ||
          (language === 'en'
            ? 'Failed to run project analysis.'
            : 'Не удалось выполнить анализ проекта.')
      );
    } catch (err) {
      if (err instanceof MissingGeminiKeyError) {
        throw err;
      }
      // При сетевом сбое к /api/* пробуем клиентский вызов только если локальный ключ задан
      if (err instanceof TypeError && clientApiKey) {
        const analysis = await clientAnalyzeProject(project, language);
        return { analysis, usedFallbackNoServerKey: true };
      }
      throw err;
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
  const clientApiKey = getClientGeminiApiKey();

  if (serverGeminiConfigured !== false) {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          },
          body: JSON.stringify({
            project,
            message: userMessage,
            newDocuments,
            currentEffectiveInputs,
            language,
            ...(clientApiKey ? { clientApiKey } : {}),
          }),
        }
      );

      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();
      let data: any = null;
      if (contentType.includes('application/json') && rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = null;
        }
      }

      if (res.ok && data?.ok !== false && data?.assistantMessage) {
        return {
          reply: String(data.assistantMessage.content || ''),
          suggestedOverrides: data.assistantMessage.suggestedOverrides ?? null,
          usedFallbackNoServerKey: false,
        };
      }

      if (
        res.status === 404 ||
        !data ||
        data.code === 'NO_API_KEY'
      ) {
        const resClient = await clientChatWithAnalyst(
          project,
          userMessage,
          newDocuments,
          currentEffectiveInputs,
          language
        );
        return { ...resClient, usedFallbackNoServerKey: true };
      }

      throw new Error(
        data.error ||
          data.message ||
          (language === 'en'
            ? 'Failed to get analyst response.'
            : 'Не удалось получить ответ аналитика.')
      );
    } catch (err) {
      if (err instanceof MissingGeminiKeyError) {
        throw err;
      }
      if (err instanceof TypeError && clientApiKey) {
        const resClient = await clientChatWithAnalyst(
          project,
          userMessage,
          newDocuments,
          currentEffectiveInputs,
          language
        );
        return { ...resClient, usedFallbackNoServerKey: true };
      }
      throw err;
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

