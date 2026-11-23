import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ProjectRecord, PublicProjectPreview } from '../src/types/ipds';

export interface StoredUserAccount {
  email: string;
  accessKeyHash: string;
  accessKeyHint: string;
  otpCode: string | null;
  otpExpiresAt: number | null;
  sessions: string[];
  createdAt: string;
}

interface StoreData {
  users: Record<string, StoredUserAccount>;
  projects: Record<string, ProjectRecord>;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'ipds-store.json');

function ensureStoreFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const initial: StoreData = { users: {}, projects: {} };
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

function readStore(): StoreData {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as StoreData;
    return {
      users: parsed.users ?? {},
      projects: parsed.projects ?? {},
    };
  } catch {
    return { users: {}, projects: {} };
  }
}

function writeStore(data: StoreData): void {
  ensureStoreFile();
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashSecret(value: string): string {
  return crypto.createHash('sha256').update(value.trim()).digest('hex');
}

function generatePersonalAccessKey(): string {
  const partA = crypto.randomBytes(2).toString('hex').toUpperCase();
  const partB = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `IPDS-${partA}-${partB}`;
}

function generateSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function ensureUserAndSession(emailRaw: string): {
  user: StoredUserAccount;
  sessionToken: string;
  newlyGeneratedKey: string | null;
} {
  const email = normalizeEmail(emailRaw);
  const store = readStore();
  let user = store.users[email];
  let newlyGeneratedKey: string | null = null;

  if (!user) {
    newlyGeneratedKey = generatePersonalAccessKey();
    user = {
      email,
      accessKeyHash: hashSecret(newlyGeneratedKey),
      accessKeyHint: `${newlyGeneratedKey.slice(0, 7)}••••${newlyGeneratedKey.slice(-2)}`,
      otpCode: null,
      otpExpiresAt: null,
      sessions: [],
      createdAt: new Date().toISOString(),
    };
  }

  const sessionToken = generateSessionToken();
  user.sessions = [...user.sessions.slice(-14), sessionToken];
  store.users[email] = user;
  writeStore(store);

  return { user, sessionToken, newlyGeneratedKey };
}

export function createOtpForEmail(emailRaw: string): {
  exists: boolean;
  email: string;
  otpCode: string;
  expiresInMinutes: number;
} {
  const email = normalizeEmail(emailRaw);
  const store = readStore();
  let user = store.users[email];
  const exists = Boolean(user);

  if (!user) {
    const fallbackKey = generatePersonalAccessKey();
    user = {
      email,
      accessKeyHash: hashSecret(fallbackKey),
      accessKeyHint: `${fallbackKey.slice(0, 7)}••••${fallbackKey.slice(-2)}`,
      otpCode: null,
      otpExpiresAt: null,
      sessions: [],
      createdAt: new Date().toISOString(),
    };
  }

  const otpNum = crypto.randomInt(100000, 999999);
  const otpCode = String(otpNum);
  user.otpCode = otpCode;
  user.otpExpiresAt = Date.now() + 10 * 60 * 1000;
  store.users[email] = user;
  writeStore(store);

  return {
    exists,
    email,
    otpCode,
    expiresInMinutes: 10,
  };
}

export function verifyAccessForEmail(
  emailRaw: string,
  credential: string,
  mode: 'otp' | 'key'
): {
  valid: boolean;
  reason?: string;
  sessionToken?: string;
  accessKeyHint?: string;
  projects?: ProjectRecord[];
} {
  const email = normalizeEmail(emailRaw);
  const store = readStore();
  const user = store.users[email];

  if (!user) {
    return { valid: false, reason: 'Проекты для указанного E-mail пока не найдены.' };
  }

  const trimmed = credential.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Введите код подтверждения или персональный ключ доступа.' };
  }

  if (mode === 'otp') {
    if (!user.otpCode || !user.otpExpiresAt) {
      return { valid: false, reason: 'Одноразовый код не запрашивался. Запросите новый код.' };
    }
    if (Date.now() > user.otpExpiresAt) {
      return { valid: false, reason: 'Срок действия кода истёк. Запросите новый код.' };
    }
    if (user.otpCode !== trimmed) {
      return { valid: false, reason: 'Неверный код подтверждения.' };
    }
    user.otpCode = null;
    user.otpExpiresAt = null;
  } else {
    if (hashSecret(trimmed.toUpperCase()) !== user.accessKeyHash) {
      return { valid: false, reason: 'Неверный персональный ключ доступа.' };
    }
  }

  const sessionToken = generateSessionToken();
  user.sessions = [...user.sessions.slice(-14), sessionToken];
  store.users[email] = user;
  writeStore(store);

  const projects = Object.values(store.projects)
    .filter((p) => normalizeEmail(p.email) === email)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return {
    valid: true,
    sessionToken,
    accessKeyHint: user.accessKeyHint,
    projects,
  };
}

export function getUserBySessionToken(token: string | undefined): {
  email: string;
  accessKeyHint: string;
  projects: ProjectRecord[];
} | null {
  if (!token) return null;
  const store = readStore();
  const found = Object.values(store.users).find((u) => u.sessions.includes(token));
  if (!found) return null;

  const projects = Object.values(store.projects)
    .filter((p) => normalizeEmail(p.email) === normalizeEmail(found.email))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return {
    email: found.email,
    accessKeyHint: found.accessKeyHint,
    projects,
  };
}

export function upsertProjectRecord(project: ProjectRecord): ProjectRecord {
  const store = readStore();
  const updated: ProjectRecord = {
    ...project,
    email: normalizeEmail(project.email),
    updatedAt: new Date().toISOString(),
  };
  store.projects[updated.id] = updated;
  writeStore(store);
  return updated;
}

export function getProjectById(projectId: string): ProjectRecord | null {
  const store = readStore();
  return store.projects[projectId] ?? null;
}

export function deleteProjectById(projectId: string, email: string): boolean {
  const store = readStore();
  const existing = store.projects[projectId];
  if (!existing || normalizeEmail(existing.email) !== normalizeEmail(email)) {
    return false;
  }
  delete store.projects[projectId];
  writeStore(store);
  return true;
}

export function getPublicProjectPreviews(limit = 5): PublicProjectPreview[] {
  const store = readStore();
  return Object.values(store.projects)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      projectName: p.projectName,
      region: p.region,
      customRegion: p.customRegion,
      category: p.category,
      updatedAt: p.updatedAt,
      hasAnalysis: Boolean(p.analysis),
    }));
}
