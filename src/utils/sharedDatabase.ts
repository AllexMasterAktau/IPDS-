import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  DialogueMessage,
  FinancialInputs,
  ProjectAnalysis,
  ProjectRecord,
  RegionPreset,
} from '../types/ipds';

const LS_LOCAL_CREATOR_KEY_HASH = 'ipds_creator_key_hash_v1';

export const FIRESTORE_COLLECTION_ANALYSES = 'ipds_shared_analyses';
export const FIRESTORE_COLLECTION_SETTINGS = 'ipds_settings';

export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

function readViteEnv(key: string): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, unknown> })?.env;
    const raw = env?.[key];
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

function logFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const errMsg = error instanceof Error ? error.message : String(error);
  const info: FirestoreErrorInfo = {
    error: errMsg,
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(info));
  return errMsg;
}

export function getAdminEmail(): string {
  return readViteEnv('VITE_ADMIN_EMAIL').toLowerCase();
}

export function isCreatorEmail(email: string | null | undefined): boolean {
  const adminEmail = getAdminEmail();
  if (!adminEmail || !email) return false;
  return email.trim().toLowerCase() === adminEmail;
}

export function getFirebaseConfig(): FirebaseEnvConfig {
  return {
    apiKey: readViteEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readViteEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readViteEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readViteEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readViteEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readViteEnv('VITE_FIREBASE_APP_ID'),
  };
}

export function isFirestoreConfigured(): boolean {
  const cfg = getFirebaseConfig();
  return Boolean(cfg.apiKey && cfg.projectId && cfg.appId);
}

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;

function getFirestoreDb(): Firestore | null {
  if (!isFirestoreConfigured()) return null;
  if (cachedDb) return cachedDb;

  const cfg = getFirebaseConfig();
  try {
    const firebaseOptions: Record<string, string> = {
      apiKey: cfg.apiKey,
      projectId: cfg.projectId,
      appId: cfg.appId,
    };
    if (cfg.authDomain) firebaseOptions.authDomain = cfg.authDomain;
    if (cfg.storageBucket) firebaseOptions.storageBucket = cfg.storageBucket;
    if (cfg.messagingSenderId) firebaseOptions.messagingSenderId = cfg.messagingSenderId;

    cachedApp = getApps().length > 0 ? getApp() : initializeApp(firebaseOptions);
    cachedDb = getFirestore(cachedApp);
    return cachedDb;
  } catch (err) {
    console.warn(
      'Firebase initialization skipped (missing or invalid env configuration):',
      err instanceof Error ? err.message : String(err)
    );
    cachedApp = null;
    cachedDb = null;
    return null;
  }
}

let connectionTested = false;

export async function testFirestoreConnection(): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db) return false;
  if (connectionTested) return true;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('offline') || msg.toLowerCase().includes('network')) {
      console.warn('Firestore connection check skipped (offline):', msg);
    }
    return false;
  }
}

export interface SharedAnalysisDoc {
  id: string;
  authorEmail?: string;
  author_email?: string;
  fullName?: string;
  full_name?: string;
  projectName?: string;
  project_name?: string;
  region: string;
  customRegion?: string | null;
  custom_region?: string | null;
  category?: string | null;
  businessScope?: string | null;
  business_scope?: string | null;
  activityType?: string | null;
  activity_type?: string | null;
  okedCode?: string | null;
  oked_code?: string | null;
  comment?: string | null;
  currencyCode?: string | null;
  currency_code?: string | null;
  currencySymbol?: string | null;
  currency_symbol?: string | null;
  hasAnalysis?: boolean;
  has_analysis?: boolean;
  verdict?: string | null;
  docsCount?: number | null;
  docs_count?: number | null;
  analysis?: ProjectAnalysis | null;
  manualOverrides?: Partial<FinancialInputs> | null;
  manual_overrides?: Partial<FinancialInputs> | null;
  dialogue?: DialogueMessage[] | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

const ALLOWED_REGIONS: RegionPreset[] = [
  'Казахстан',
  'РФ',
  'Международный',
  'Свой вариант',
];

/**
 * Firestore отклоняет поля со значением `undefined`.
 * Очищаем объект/массивы рекурсивно перед вызовом setDoc.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeDialogueForSharedDb(dialogue: DialogueMessage[] = []): DialogueMessage[] {
  // Сохраняем только текст диалога и лёгкие имена вложений, без содержимого файлов
  return dialogue.slice(-24).map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: (msg.content || '').slice(0, 6000),
    ...(msg.attachments?.length
      ? {
          attachments: msg.attachments.map((att) => ({
            name: att.name,
            fileType: att.fileType,
            sizeBytes: att.sizeBytes,
          })),
        }
      : {}),
    ...(msg.suggestedOverrides ? { suggestedOverrides: msg.suggestedOverrides } : {}),
    createdAt: msg.createdAt,
  }));
}

/**
 * Формирует облегчённый пакет проекта для Firebase Firestore:
 * паспорт, регион, вид деятельности/ОКЭД, полный анализ (3 контура, переоценка, правовой срез, вердикт)
 * и E-mail автора — СТРОГО БЕЗ исходных файлов (`documents`).
 */
export function buildSharedProjectPayload(project: ProjectRecord): Record<string, unknown> {
  const rawDocsCount =
    project.documents && project.documents.length > 0
      ? project.documents.length
      : project.docsCount ?? 0;
  const docsCount = Math.max(0, Math.min(1000, Math.floor(Number(rawDocsCount) || 0)));
  const authorEmail = (project.email || '').trim().toLowerCase();

  return stripUndefinedDeep({
    id: project.id,
    authorEmail,
    fullName: (project.fullName || '').trim() || authorEmail,
    projectName: (project.projectName || '').trim(),
    region: project.region,
    customRegion: project.region === 'Свой вариант' ? project.customRegion?.trim() || null : null,
    category: project.category?.trim() || null,
    businessScope: project.businessScope?.trim() || null,
    activityType: project.activityType?.trim() || null,
    okedCode: project.okedCode?.trim() || null,
    comment: project.comment?.trim() || null,
    currencyCode: project.currencyCode || 'RUB',
    currencySymbol: project.currencySymbol || '₽',
    hasAnalysis: Boolean(project.analysis),
    verdict: project.analysis?.investmentCommitteeVerdict || null,
    docsCount,
    analysis: project.analysis ?? null,
    manualOverrides: project.manualOverrides ?? {},
    dialogue: sanitizeDialogueForSharedDb(project.dialogue ?? []),
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
  });
}

/**
 * Восстанавливает полноценную карточку ProjectRecord из документа Firestore.
 * Массив `documents` всегда пуст (`[]`), чтобы исходные файлы оставались только на ПК автора.
 */
export function hydrateProjectFromSharedRow(row: SharedAnalysisDoc): ProjectRecord {
  const region: RegionPreset = ALLOWED_REGIONS.includes(row.region as RegionPreset)
    ? (row.region as RegionPreset)
    : 'Казахстан';

  const authorEmail = ((row.authorEmail ?? row.author_email) || '').trim().toLowerCase();
  const fullName = (row.fullName ?? row.full_name) || authorEmail;
  const projectName = (row.projectName ?? row.project_name) || 'Проект';
  const createdAt = row.createdAt ?? row.created_at ?? new Date().toISOString();
  const updatedAt = row.updatedAt ?? row.updated_at ?? new Date().toISOString();
  const rawDocsCount = row.docsCount ?? row.docs_count;

  return {
    id: row.id,
    fullName,
    email: authorEmail,
    projectName,
    region,
    customRegion: (row.customRegion ?? row.custom_region) || undefined,
    category: row.category || undefined,
    businessScope: (row.businessScope ?? row.business_scope) || undefined,
    activityType: (row.activityType ?? row.activity_type) || undefined,
    okedCode: (row.okedCode ?? row.oked_code) || undefined,
    comment: row.comment || undefined,
    currencyCode: (row.currencyCode ?? row.currency_code) || 'RUB',
    currencySymbol: (row.currencySymbol ?? row.currency_symbol) || '₽',
    documents: [],
    docsCount: typeof rawDocsCount === 'number' ? rawDocsCount : 0,
    analysis: row.analysis ?? null,
    manualOverrides: (row.manualOverrides ?? row.manual_overrides) ?? {},
    dialogue: Array.isArray(row.dialogue) ? row.dialogue : [],
    leadSyncStatus: 'synced',
    sharedSyncStatus: 'synced',
    sharedSyncedAt: updatedAt,
    sharedFromDatabase: true,
    createdAt,
    updatedAt,
  };
}

export async function syncProjectToSharedDb(project: ProjectRecord): Promise<{
  synced: boolean;
  status: 'synced' | 'unconfigured' | 'error';
  error?: string;
}> {
  const db = getFirestoreDb();
  if (!db) {
    return { synced: false, status: 'unconfigured' };
  }
  const email = (project.email || '').trim().toLowerCase();
  if (!email || !email.includes('@') || !project.projectName?.trim() || !project.id?.trim()) {
    return { synced: false, status: 'error', error: 'Invalid project author or name' };
  }

  const docPath = `${FIRESTORE_COLLECTION_ANALYSES}/${project.id}`;
  try {
    const payload = buildSharedProjectPayload(project);
    await setDoc(doc(db, FIRESTORE_COLLECTION_ANALYSES, project.id), payload, {
      merge: true,
    });
    return { synced: true, status: 'synced' };
  } catch (err) {
    const errMsg = logFirestoreError(err, OperationType.WRITE, docPath);
    return {
      synced: false,
      status: 'error',
      error: errMsg,
    };
  }
}

export async function fetchMySharedAnalyses(email: string): Promise<{
  ok: boolean;
  configured: boolean;
  projects: ProjectRecord[];
  error?: string;
}> {
  const db = getFirestoreDb();
  const normalized = email.trim().toLowerCase();
  if (!db) {
    return { ok: false, configured: false, projects: [] };
  }
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, configured: true, projects: [] };
  }

  try {
    const q = query(
      collection(db, FIRESTORE_COLLECTION_ANALYSES),
      where('authorEmail', '==', normalized)
    );
    const snap = await getDocs(q);
    const projects = snap.docs
      .map((d) => hydrateProjectFromSharedRow({ ...(d.data() as SharedAnalysisDoc), id: d.id }))
      // Дополнительная строгая изоляция на клиенте: только проекты подтверждённого пользователя
      .filter((p) => (p.email || '').trim().toLowerCase() === normalized)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return { ok: true, configured: true, projects };
  } catch (err) {
    const errMsg = logFirestoreError(err, OperationType.LIST, FIRESTORE_COLLECTION_ANALYSES);
    return {
      ok: false,
      configured: true,
      projects: [],
      error: errMsg,
    };
  }
}

// ============================================================================
// Хэширование и проверка ключа создателя площадки (SHA-256)
// ============================================================================
async function sha256Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value.trim());
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv_${(hash >>> 0).toString(16)}`;
}

export function hasLocalCreatorKeyHash(): boolean {
  try {
    return Boolean(localStorage.getItem(LS_LOCAL_CREATOR_KEY_HASH));
  } catch {
    return false;
  }
}

function readLocalCreatorKeyHash(): string {
  try {
    return localStorage.getItem(LS_LOCAL_CREATOR_KEY_HASH) || '';
  } catch {
    return '';
  }
}

function writeLocalCreatorKeyHash(hash: string): void {
  try {
    localStorage.setItem(LS_LOCAL_CREATOR_KEY_HASH, hash);
  } catch {
    // ignore storage errors
  }
}

export async function verifyOrClaimLocalCreatorKey(
  email: string,
  adminKey: string
): Promise<{ ok: boolean; claimedNew?: boolean; error?: string }> {
  const normalized = email.trim().toLowerCase();
  const trimmedKey = adminKey.trim();
  if (!getAdminEmail()) {
    return {
      ok: false,
      error: 'E-mail администратора (VITE_ADMIN_EMAIL) не задан в переменных окружения.',
    };
  }
  if (!isCreatorEmail(normalized)) {
    return { ok: false, error: 'Неверный E-mail создателя площадки.' };
  }
  if (trimmedKey.length < 4) {
    return {
      ok: false,
      error: 'Ключ администратора должен содержать минимум 4 символа.',
    };
  }

  const incomingHash = await sha256Hex(`${normalized}::${trimmedKey}`);
  const storedHash = readLocalCreatorKeyHash();

  if (!storedHash) {
    writeLocalCreatorKeyHash(incomingHash);
    return { ok: true, claimedNew: true };
  }

  if (storedHash !== incomingHash) {
    return { ok: false, error: 'Неверный ключ администратора.' };
  }
  return { ok: true, claimedNew: false };
}

async function verifyOrClaimCreatorKeyAcrossFirestore(
  db: Firestore,
  normalizedEmail: string,
  trimmedKey: string
): Promise<{ ok: boolean; error?: string }> {
  if (!getAdminEmail()) {
    return {
      ok: false,
      error: 'E-mail администратора (VITE_ADMIN_EMAIL) не задан в переменных окружения.',
    };
  }
  if (!isCreatorEmail(normalizedEmail)) {
    return { ok: false, error: 'Неверный E-mail создателя площадки.' };
  }
  if (trimmedKey.length < 4) {
    return {
      ok: false,
      error: 'Ключ администратора должен содержать минимум 4 символа.',
    };
  }

  const incomingHash = await sha256Hex(`${normalizedEmail}::${trimmedKey}`);
  const creatorDocRef = doc(db, FIRESTORE_COLLECTION_SETTINGS, 'creator');

  try {
    const snap = await getDoc(creatorDocRef);
    if (snap.exists()) {
      const data = snap.data() as { adminEmail?: string; adminKeyHash?: string };
      const remoteHash = (data?.adminKeyHash || '').trim();
      const remoteEmail = (data?.adminEmail || '').trim().toLowerCase();
      if (remoteHash) {
        if (remoteEmail && remoteEmail !== normalizedEmail) {
          return { ok: false, error: 'Неверный E-mail создателя площадки.' };
        }
        if (remoteHash !== incomingHash) {
          return { ok: false, error: 'Неверный ключ администратора.' };
        }
        writeLocalCreatorKeyHash(remoteHash);
        return { ok: true };
      }
    }

    // Если в Firestore ещё не задан хэш создателя — проверяем локальный кэш или регистрируем при первом входе
    const localCheck = await verifyOrClaimLocalCreatorKey(normalizedEmail, trimmedKey);
    if (!localCheck.ok) return localCheck;

    try {
      await setDoc(creatorDocRef, {
        adminEmail: normalizedEmail,
        adminKeyHash: incomingHash,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Если в Firestore Rules открыта только коллекция ipds_shared_analyses, локальная проверка всё равно работает
    }
    return { ok: true };
  } catch (err) {
    logFirestoreError(err, OperationType.GET, `${FIRESTORE_COLLECTION_SETTINGS}/creator`);
    return verifyOrClaimLocalCreatorKey(normalizedEmail, trimmedKey);
  }
}

export async function fetchAllSharedAnalysesAsCreator(
  email: string,
  adminKey: string
): Promise<{
  ok: boolean;
  configured: boolean;
  projects: ProjectRecord[];
  error?: string;
}> {
  const normalized = email.trim().toLowerCase();
  const trimmedKey = adminKey.trim();

  if (!getAdminEmail()) {
    return {
      ok: false,
      configured: isFirestoreConfigured(),
      projects: [],
      error: 'E-mail администратора (VITE_ADMIN_EMAIL) не задан в переменных окружения.',
    };
  }
  if (!isCreatorEmail(normalized) || !trimmedKey) {
    return {
      ok: false,
      configured: isFirestoreConfigured(),
      projects: [],
      error: 'Укажите E-mail создателя и ключ администратора.',
    };
  }

  const db = getFirestoreDb();
  if (!db) {
    return { ok: false, configured: false, projects: [] };
  }

  const authCheck = await verifyOrClaimCreatorKeyAcrossFirestore(db, normalized, trimmedKey);
  if (!authCheck.ok) {
    return {
      ok: false,
      configured: true,
      projects: [],
      error: authCheck.error || 'Неверный E-mail создателя или ключ администратора.',
    };
  }

  try {
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTION_ANALYSES));
    const projects = snap.docs
      .map((d) => hydrateProjectFromSharedRow({ ...(d.data() as SharedAnalysisDoc), id: d.id }))
      .sort((a, b) => {
        const aReady = a.analysis ? 1 : 0;
        const bReady = b.analysis ? 1 : 0;
        if (aReady !== bReady) return bReady - aReady;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

    return {
      ok: true,
      configured: true,
      projects,
    };
  } catch (err) {
    const errMsg = logFirestoreError(err, OperationType.LIST, FIRESTORE_COLLECTION_ANALYSES);
    return {
      ok: false,
      configured: true,
      projects: [],
      error: errMsg.includes('permission-denied') || errMsg.includes('Missing or insufficient permissions')
        ? 'Нет прав чтения Firestore. Проверьте правила безопасности (Rules) в Firebase Console.'
        : errMsg,
    };
  }
}

export async function deleteSharedAnalysis(
  projectId: string,
  email: string,
  adminKey?: string
): Promise<boolean> {
  const db = getFirestoreDb();
  const normalized = email.trim().toLowerCase();
  if (!db || !projectId || !normalized) return false;

  try {
    const docRef = doc(db, FIRESTORE_COLLECTION_ANALYSES, projectId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return true;

    const data = snap.data() as SharedAnalysisDoc;
    const owner = ((data.authorEmail ?? data.author_email) || '').trim().toLowerCase();

    if (isCreatorEmail(normalized) && adminKey?.trim()) {
      const check = await verifyOrClaimCreatorKeyAcrossFirestore(db, normalized, adminKey.trim());
      if (!check.ok) return false;
    } else if (owner && owner !== normalized) {
      return false;
    }

    await deleteDoc(docRef);
    return true;
  } catch (err) {
    logFirestoreError(err, OperationType.DELETE, `${FIRESTORE_COLLECTION_ANALYSES}/${projectId}`);
    return false;
  }
}

export async function updateLocalCreatorKey(
  email: string,
  newAdminKey: string
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const trimmed = newAdminKey.trim();
  if (!isCreatorEmail(normalized) || trimmed.length < 4) return;
  const hash = await sha256Hex(`${normalized}::${trimmed}`);
  writeLocalCreatorKeyHash(hash);
}
