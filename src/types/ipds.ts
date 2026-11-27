export type RegionPreset = 'Казахстан' | 'РФ' | 'Международный' | 'Свой вариант';
export type CurrencyCode = 'RUB' | 'KZT' | 'USD';
export type Language = 'ru' | 'en';

export type FxRateMap = Record<CurrencyCode, number>;

export interface FxRatesState {
  rates: FxRateMap; // Значения относительно 1 USD (USD = 1)
  source: 'live' | 'fallback' | 'manual';
  updatedAt: string;
  provider?: string;
}

export interface LocalDocumentDigest {
  id: string;
  name: string;
  sizeBytes: number;
  fileType: string;
  charCount: number;
  extractedText: string;
  previewNote: string;
  addedAt: string;
}

export interface FinancialInputs {
  investmentAmount: number; // Предполагаемая сумма инвестиций (в базовых единицах валюты)
  monthlyRevenue: number;   // Предполагаемая выручка в месяц
  headcount: number;        // Предполагаемое количество сотрудников
  launchMonths: number;     // Предполагаемый срок запуска (мес.)
  monthlyOpex: number;      // Ежемесячные операционные расходы (OPEX)
  workingCapitalReservePct: number; // Резерв на запуск / оборотный капитал (%)
}

export interface CashflowPoint {
  month: number;
  label: string;
  revenue: number;
  opex: number;
  capex: number;
  netCashflow: number;
  cumulativeCashflow: number;
}

export interface DerivedMetrics {
  projectCost: number;       // Предполагаемая стоимость проекта
  investmentAmount: number;  // Предполагаемая сумма инвестиций
  launchMonths: number;      // Предполагаемый срок запуска
  headcount: number;         // Предполагаемое количество сотрудников
  monthlyRevenue: number;    // Предполагаемая выручка в месяц
  monthlyOpex: number;       // Пересчитанный OPEX с учётом штата
  monthlyProfit: number;     // Ежемесячная операционная прибыль (EBITDA)
  ebitdaMarginPct: number;   // Операционная маржинальность (%)
  annualRevenue: number;     // Годовая выручка (12 мес.)
  annualProfit: number;      // Годовая операционная прибыль
  paybackMonths: number | null; // Предполагаемый срок окупаемости (мес.), null если не окупается в горизонте 60 мес.
  roiAnnualPct: number;      // Годовая доходность на инвестиции (ROI %)
  cashflowSeries: CashflowPoint[];
}

export interface CostBreakdownItem {
  category: string;
  amount: number;
  sharePct: number;
  note: string;
}

export type RiskDimension = 'market' | 'legal' | 'operational' | 'hr' | 'regional';
export type RiskSeverity = 'high' | 'medium' | 'low';

export interface RiskItem {
  id: string;
  dimension: RiskDimension;
  dimensionLabel: string;
  title: string;
  severity: RiskSeverity;
  description: string;
  mitigation: string;
}

export interface ProjectRecommendations {
  analystConclusion: string;
  riskMitigationMeasures: string[];
  crisisAndBottleneckPlan: string[];
  growthPlanAndMetrics: string[];
}

export type InvestmentCommitteeVerdict = 'GO' | 'CONDITIONAL_GO' | 'NO_GO';

export interface IndependentValuation {
  claimedProjectValue: string;
  realisticProjectValueRange: string;
  valuationMethodology: string;
  claimedInvestment: string;
  realisticInvestmentAmount: string;
  investmentGapExplanation: string;
  claimedPayback: string;
  realisticPaybackBase: string;
  realisticPaybackStress: string;
  paybackComment: string;
}

export interface CommitteeAudit {
  unitEconomicsCheck: string;
  demandAndPainCheck: string;
  competitiveMoatCheck: string;
  teamAndSkinInTheGame: string;
  stressTestSummary: string;
  exitAndTrancheLogic: string;
  unverifiedRedFlags: string[];
  founderHardQuestions: string[];
}

export interface LegalComplianceCut {
  jurisdictionSummary: string;
  activityClassificationStatus: 'provided' | 'missing_suggested';
  suggestedBusinessScope: string;
  suggestedActivityType: string;
  suggestedOkedCode: string;
  missingFieldsWarning: string;
  taxCodeChecks: string;
  entrepreneurialCodeChecks: string;
  civilCodeChecks: string;
  criminalCodeRisks: string;
  industryLicensingRequirements: string;
  legalStopFactors: string[];
}

export interface ProjectAnalysis {
  executiveSummary: string;
  investmentCommitteeVerdict?: InvestmentCommitteeVerdict;
  investmentCommitteeVerdictReason?: string;
  currencyCode: string;
  currencySymbol: string;
  baselineInputs: FinancialInputs;
  payrollPerEmployeeMonthly: number;
  costStructure: CostBreakdownItem[];
  revenueDrivers: string[];
  unitEconomicsSummary: string;
  independentValuation?: IndependentValuation;
  committeeAudit?: CommitteeAudit;
  legalCompliance?: LegalComplianceCut;
  risks: RiskItem[];
  assumptions: string[];
  preLaunchSteps: string[];
  recommendations?: ProjectRecommendations;
  generatedAt: string;
  modelUsed: string;
  modelId?: string;
  usedFallbackModel?: boolean;
}

export interface DialogueAttachmentMeta {
  name: string;
  fileType: string;
  sizeBytes: number;
}

export interface DialogueMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: DialogueAttachmentMeta[];
  suggestedOverrides?: Partial<FinancialInputs> | null;
  modelUsed?: string;
  modelId?: string;
  usedFallbackModel?: boolean;
  createdAt: string;
}

export type LeadSyncStatus = 'synced' | 'pending' | 'unconfigured' | 'error';

export interface ProjectRecord {
  id: string;
  fullName: string;
  email: string;
  projectName: string;
  region: RegionPreset;
  customRegion?: string;
  category?: string;
  businessScope?: string;
  activityType?: string;
  okedCode?: string;
  comment?: string;
  currencyCode: string;
  currencySymbol: string;
  documents: LocalDocumentDigest[];
  docsCount?: number;
  analysis: ProjectAnalysis | null;
  manualOverrides: Partial<FinancialInputs>;
  dialogue: DialogueMessage[];
  leadSyncStatus: LeadSyncStatus;
  leadSyncMessage?: string;
  sharedSyncStatus?: 'synced' | 'pending' | 'unconfigured' | 'error';
  sharedSyncedAt?: string;
  sharedFromDatabase?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProjectPreview {
  id: string;
  projectName: string;
  region: RegionPreset;
  customRegion?: string;
  category?: string;
  updatedAt: string;
  hasAnalysis: boolean;
}

export interface UserSession {
  email: string;
  sessionToken: string;
  accessKeyHint?: string;
  verifiedAt: string;
  isAdmin?: boolean;
}

export interface AdminUserSummary {
  email: string;
  createdAt: string;
  projectCount: number;
}

