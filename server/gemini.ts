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
  const hasMissingActivityFields =
    !project.businessScope?.trim() ||
    !project.activityType?.trim() ||
    !project.okedCode?.trim();

  const prompt = `Ты — жёсткий инвестиционный комитет и старший проектный/правовой аналитик системы «IPDS Терминал» (Intelligent Business Systems).
Проведи глубокий независимый аудит проекта (НЕ пересказывай слепо цифры из документов инициатора — подвергай их стресс-проверке и критической переоценке) в трёх контурах («Цифры и экономика», «Риски и ограничения», «Рекомендации»). Все текстовые поля результата сформируй строго ${targetLangInstruction}.

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
   - Проверь проект по применимому законодательству региона «${regionLabel}» (для Казахстана: НК РК, ПК РК, ГК РК, УК РК; для РФ: НК РФ, ГК РФ, УК РФ, законы о лицензировании/бизнесе; для иного/Международного региона: применимые налоговые, предпринимательские, гражданские, уголовно-правовые и отраслевые нормы):
     * taxCodeChecks: Налоговый кодекс (спецрежимы vs ОУР, НДС, налоги на ФОТ, налоги у источника);
     * entrepreneurialCodeChecks: Предпринимательский кодекс / нормы регулирования бизнеса;
     * civilCodeChecks: Гражданский кодекс (договорная обвязка, ИС, ответственность, залоги);
     * criminalCodeRisks: Уголовный кодекс (уголовно-правовые риски: безлицензионная деятельность, налоги, фиктивные сделки, AML/персональные данные);
     * industryLicensingRequirements: отраслевое лицензирование, разрешения и сертификация;
     * legalStopFactors: 2–4 правовых стоп-фактора.
   - Если род деятельности, вид деятельности или код ОКЭД не заполнены (${hasMissingActivityFields ? 'СЕЙЧАС НЕ ЗАПОЛНЕНЫ' : 'заполнены'}), обязательно заполни missingFieldsWarning, установи activityClassificationStatus = "missing_suggested" (или "provided", если все 3 указаны) и предложи suggestedBusinessScope, suggestedActivityType и suggestedOkedCode на базе описания и документов.
2. НЕЗАВИСИМАЯ ПЕРЕОЦЕНКА ТЕРМИНАЛА (independentValuation И baselineInputs):
   - В baselineInputs заложи реалистичную оценку терминала (с учётом скрытых затрат, оборотного капитала и буфера), а не слепой пересказ бизнес-плана.
   - В independentValuation сопоставь «Заявлено в документах» vs «Реалистичная оценка терминала»: стоимость бизнеса сейчас (claimedProjectValue vs realisticProjectValueRange + valuationMethodology), реальная сумма инвестиций (claimedInvestment vs realisticInvestmentAmount + investmentGapExplanation), реальные сроки окупаемости (claimedPayback vs realisticPaybackBase и realisticPaybackStress + paybackComment).
3. АУДИТ ЖЁСТКОГО ИНВЕСТ-КОМИТЕТА (investmentCommitteeVerdict + committeeAudit):
   - Вынеси вердикт GO, CONDITIONAL_GO или NO_GO и краткое жёсткое обоснование (investmentCommitteeVerdictReason).
   - Проверь: unitEconomicsCheck, demandAndPainCheck, competitiveMoatCheck, teamAndSkinInTheGame, stressTestSummary, exitAndTrancheLogic.
   - Заполни unverifiedRedFlags («Данные не подтверждены / Красный флаг: ...» или EN equivalent) и 4–6 вопросов в founderHardQuestions.
4. МАТЕМАТИКА И КОНТУРЫ:
   - Все денежные суммы (investmentAmount, monthlyRevenue, monthlyOpex, payrollPerEmployeeMonthly, costStructure.amount) в полных единицах валюты (${project.currencyCode}). Сумма costStructure.amount ≈ investmentAmount, сумма sharePct ≈ 100%.
   - В risks покрой все 5 контуров: market, legal, operational, hr, regional.
   - В recommendations сформируй 4 блока: analystConclusion, riskMitigationMeasures, crisisAndBottleneckPlan, growthPlanAndMetrics.`;

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
            investmentCommitteeVerdict: {
              type: Type.STRING,
              description: 'Одно из: GO, CONDITIONAL_GO, NO_GO',
            },
            investmentCommitteeVerdictReason: {
              type: Type.STRING,
              description: 'Жёсткое обоснование вердикта инвест-комитета.',
            },
            baselineInputs: {
              type: Type.OBJECT,
              properties: {
                investmentAmount: {
                  type: Type.NUMBER,
                  description: 'Реалистичная сумма инвестиций (CAPEX) в полных единицах валюты.',
                },
                monthlyRevenue: {
                  type: Type.NUMBER,
                  description: 'Реалистичная ежемесячная выручка после выхода на режим, в полных единицах валюты.',
                },
                headcount: {
                  type: Type.INTEGER,
                  description: 'Предполагаемое количество сотрудников (чел.).',
                },
                launchMonths: {
                  type: Type.INTEGER,
                  description: 'Реалистичный срок запуска в месяцах (целое число, 1-36).',
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
                  description: 'Одно из: provided, missing_suggested',
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
                  dimension: {
                    type: Type.STRING,
                    description: 'Одно из: market, legal, operational, hr, regional',
                  },
                  dimensionLabel: {
                    type: Type.STRING,
                    description: 'Название контура риска (например: Рыночный риск, Правовой риск, Операционный риск, Кадровый риск, Региональный риск)',
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
      title: risk.title || 'Риск',
      severity: sev,
      description: risk.description || '',
      mitigation: risk.mitigation || '',
    };
  });

  const rawVerdict = String(parsed.investmentCommitteeVerdict || '').toUpperCase().trim();
  const normalizedVerdict: ProjectAnalysis['investmentCommitteeVerdict'] =
    rawVerdict === 'GO' || rawVerdict === 'CONDITIONAL_GO' || rawVerdict === 'NO_GO'
      ? rawVerdict
      : 'CONDITIONAL_GO';

  const rawVal = (parsed.independentValuation || {}) as Partial<
    NonNullable<ProjectAnalysis['independentValuation']>
  >;
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

  const rawAudit = (parsed.committeeAudit || {}) as Partial<
    NonNullable<ProjectAnalysis['committeeAudit']>
  >;
  const normalizedAudit = {
    unitEconomicsCheck: String(rawAudit.unitEconomicsCheck || '').trim(),
    demandAndPainCheck: String(rawAudit.demandAndPainCheck || '').trim(),
    competitiveMoatCheck: String(rawAudit.competitiveMoatCheck || '').trim(),
    teamAndSkinInTheGame: String(rawAudit.teamAndSkinInTheGame || '').trim(),
    stressTestSummary: String(rawAudit.stressTestSummary || '').trim(),
    exitAndTrancheLogic: String(rawAudit.exitAndTrancheLogic || '').trim(),
    unverifiedRedFlags: Array.isArray(rawAudit.unverifiedRedFlags)
      ? rawAudit.unverifiedRedFlags.map((s) => String(s || '').trim()).filter(Boolean)
      : [],
    founderHardQuestions: Array.isArray(rawAudit.founderHardQuestions)
      ? rawAudit.founderHardQuestions.map((s) => String(s || '').trim()).filter(Boolean)
      : [],
  };

  const rawLegal = (parsed.legalCompliance || {}) as Partial<
    NonNullable<ProjectAnalysis['legalCompliance']>
  >;
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
      ? rawLegal.legalStopFactors.map((s) => String(s || '').trim()).filter(Boolean)
      : [],
  };

  return {
    executiveSummary: parsed.executiveSummary,
    investmentCommitteeVerdict: normalizedVerdict,
    investmentCommitteeVerdictReason: String(parsed.investmentCommitteeVerdictReason || '').trim(),
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
    independentValuation: normalizedValuation,
    committeeAudit: normalizedAudit,
    legalCompliance: normalizedLegal,
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

  const replyLangInstruction =
    language === 'en' ? 'in English' : 'на русском языке';

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
