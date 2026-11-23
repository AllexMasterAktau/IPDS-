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
function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY или GOOGLE_API_KEY не настроен на сервере. Добавьте ключ в Settings > Secrets в Google AI Studio.'
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
  language: Language = 'ru'
): Promise<ProjectAnalysis> {
  const ai = getGeminiClient();
  const regionLabel =
    project.region === 'Свой вариант' && project.customRegion
      ? project.customRegion
      : project.region;
  const targetLangInstruction =
    language === 'en' ? 'in English' : 'на русском языке';

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
    model: 'gemini-4-hydrogen',
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
    generatedAt: new Date().toISOString(),
    modelUsed: 'Gemini 4 Hydrogen',
  };
}

export async function chatWithAnalystGemini(
  project: ProjectRecord,
  userMessage: string,
  newDocuments: LocalDocumentDigest[],
  currentEffectiveInputs?: FinancialInputs,
  language: Language = 'ru'
): Promise<{
  reply: string;
  suggestedOverrides: Partial<FinancialInputs> | null;
}> {
  const ai = getGeminiClient();
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

  const replyLangInstruction =
    language === 'en' ? 'in English' : 'на русском языке';

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
    model: 'gemini-4-hydrogen',
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
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Аналитик не смог сформировать ответ. Повторите запрос.');
  }

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
  };
}
