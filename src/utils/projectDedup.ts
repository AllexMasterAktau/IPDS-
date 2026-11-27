import type {
  LocalDocumentDigest,
  ProjectRecord,
  PublicProjectPreview,
} from '../types/ipds';

/**
 * Нормализует название проекта для сравнения и дедупликации:
 * убирает крайние пробелы, схлопывает повторяющиеся пробелы, приводит к нижнему регистру
 * и унифицирует типографские кавычки.
 */
export function normalizeProjectName(name: string | undefined | null): string {
  return (name || '')
    .replace(/[«»„“”]/g, '"')
    .replace(/[‘’`]/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeOwnerEmail(email: string | undefined | null): string {
  return (email || '').trim().toLowerCase();
}

function getTimestampMs(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Выбирает приоритетную карточку при совпадении названий:
 * 1) вариант со статусом «Отчёт готов» (наличие analysis);
 * 2) при равном статусе — более свежая запись по updatedAt (или createdAt);
 * 3) при равенстве дат — запись с большим числом сообщений и документов.
 */
export function pickPreferredProject(a: ProjectRecord, b: ProjectRecord): ProjectRecord {
  const mergedDocs = mergeDocumentsUnique(a.documents, b.documents);
  const maxDocsCount = Math.max(
    a.docsCount ?? a.documents?.length ?? 0,
    b.docsCount ?? b.documents?.length ?? 0,
    mergedDocs.length
  );

  const aReady = Boolean(a.analysis);
  const bReady = Boolean(b.analysis);

  let primary: ProjectRecord;
  let secondary: ProjectRecord;

  if (aReady !== bReady) {
    primary = aReady ? a : b;
    secondary = aReady ? b : a;
  } else {
    const aUpdated = getTimestampMs(a.updatedAt) || getTimestampMs(a.createdAt);
    const bUpdated = getTimestampMs(b.updatedAt) || getTimestampMs(b.createdAt);
    if (aUpdated !== bUpdated) {
      primary = aUpdated > bUpdated ? a : b;
      secondary = aUpdated > bUpdated ? b : a;
    } else {
      const aRichness = (a.dialogue?.length || 0) + (a.documents?.length || 0);
      const bRichness = (b.dialogue?.length || 0) + (b.documents?.length || 0);
      primary = aRichness >= bRichness ? a : b;
      secondary = primary === a ? b : a;
    }
  }

  // Сохраняем локальные документы с ПК пользователя, даже если более свежая версия пришла из общей БД без файлов
  const preservedDialogue =
    (primary.dialogue?.length || 0) >= (secondary.dialogue?.length || 0)
      ? primary.dialogue || []
      : secondary.dialogue || [];

  return {
    ...primary,
    documents: mergedDocs,
    docsCount: maxDocsCount,
    dialogue: preservedDialogue,
    sharedFromDatabase: Boolean(primary.sharedFromDatabase && mergedDocs.length === 0),
  };
}

/**
 * Удаляет дубликаты проектов (по id и по паре email + нормализованное название),
 * оставляя более свежий вариант или вариант со статусом «Отчёт готов»,
 * и сортирует результат от самых свежих к более старым.
 */
export function deduplicateProjects(projects: ProjectRecord[]): ProjectRecord[] {
  if (!Array.isArray(projects) || projects.length === 0) return [];

  const byId = new Map<string, ProjectRecord>();
  for (const proj of projects) {
    if (!proj || typeof proj !== 'object' || !proj.id) continue;
    const prev = byId.get(proj.id);
    byId.set(proj.id, prev ? pickPreferredProject(prev, proj) : proj);
  }

  const byOwnerAndName = new Map<string, ProjectRecord>();
  for (const proj of byId.values()) {
    const owner = normalizeOwnerEmail(proj.email);
    const normName = normalizeProjectName(proj.projectName);
    const key = normName ? `${owner}::${normName}` : `id:${proj.id}`;
    const existing = byOwnerAndName.get(key);
    byOwnerAndName.set(key, existing ? pickPreferredProject(existing, proj) : proj);
  }

  return Array.from(byOwnerAndName.values()).sort((a, b) => {
    const aTime = getTimestampMs(a.updatedAt) || getTimestampMs(a.createdAt);
    const bTime = getTimestampMs(b.updatedAt) || getTimestampMs(b.createdAt);
    return bTime - aTime;
  });
}

/**
 * Ищет существующий проект по нормализованному названию строго в рамках указанного E-mail
 * (чтобы проекты разных пользователей с одинаковыми названиями не смешивались).
 */
export function findProjectByNormalizedName(
  projects: ProjectRecord[],
  projectName: string,
  ownerEmail?: string
): ProjectRecord | null {
  const targetName = normalizeProjectName(projectName);
  if (!targetName) return null;

  const deduped = deduplicateProjects(projects);
  const normalizedEmail = normalizeOwnerEmail(ownerEmail);

  if (normalizedEmail) {
    return (
      deduped.find(
        (p) =>
          normalizeProjectName(p.projectName) === targetName &&
          normalizeOwnerEmail(p.email) === normalizedEmail
      ) ?? null
    );
  }

  return deduped.find((p) => normalizeProjectName(p.projectName) === targetName) ?? null;
}

/**
 * Объединяет локальные документы без дубликатов по имени и размеру файла.
 */
export function mergeDocumentsUnique(
  existingDocs: LocalDocumentDigest[] = [],
  newDocs: LocalDocumentDigest[] = []
): LocalDocumentDigest[] {
  const byKey = new Map<string, LocalDocumentDigest>();
  for (const doc of existingDocs) {
    const key = `${doc.name.trim().toLowerCase()}::${doc.sizeBytes}`;
    byKey.set(key, doc);
  }
  for (const doc of newDocs) {
    const key = `${doc.name.trim().toLowerCase()}::${doc.sizeBytes}`;
    byKey.set(key, doc);
  }
  return Array.from(byKey.values());
}

/**
 * Безопасно обновляет существующую карточку проекта новыми данными формы создания,
 * сохраняя id, историю диалога, готовый отчёт и ранее загруженные документы.
 */
export function mergeProjectUpdate(
  existing: ProjectRecord,
  incoming: Omit<ProjectRecord, 'id' | 'createdAt' | 'analysis' | 'manualOverrides' | 'dialogue'>
): ProjectRecord {
  const mergedDocs = mergeDocumentsUnique(existing.documents, incoming.documents);
  return {
    ...existing,
    fullName: incoming.fullName || existing.fullName,
    email: incoming.email || existing.email,
    projectName: incoming.projectName || existing.projectName,
    region: incoming.region,
    customRegion: incoming.region === 'Свой вариант' ? incoming.customRegion : undefined,
    category: incoming.category ?? existing.category,
    businessScope: incoming.businessScope ?? existing.businessScope,
    activityType: incoming.activityType ?? existing.activityType,
    okedCode: incoming.okedCode ?? existing.okedCode,
    comment: incoming.comment ?? existing.comment,
    currencyCode: incoming.currencyCode,
    currencySymbol: incoming.currencySymbol,
    documents: mergedDocs,
    docsCount: mergedDocs.length,
    leadSyncStatus: incoming.leadSyncStatus,
    updatedAt: incoming.updatedAt,
  };
}

/**
 * Вставляет или обновляет проект в списке с гарантированной уникальностью
 * по id и паре (email + название).
 */
export function upsertUniqueProject(
  projects: ProjectRecord[],
  updated: ProjectRecord
): ProjectRecord[] {
  const targetOwner = normalizeOwnerEmail(updated.email);
  const targetName = normalizeProjectName(updated.projectName);
  const filtered = projects.filter(
    (p) =>
      p.id !== updated.id &&
      !(
        targetName &&
        normalizeOwnerEmail(p.email) === targetOwner &&
        normalizeProjectName(p.projectName) === targetName
      )
  );
  return deduplicateProjects([updated, ...filtered]);
}

/**
 * Объединяет локальные проекты (с файлами) и проекты из общей БД (без файлов).
 */
export function mergeProjectRecordsList(
  localProjects: ProjectRecord[],
  remoteProjects: ProjectRecord[]
): ProjectRecord[] {
  return deduplicateProjects([...localProjects, ...remoteProjects]);
}

/**
 * Дедупликация карточек предпросмотра для неавторизованного режима.
 */
export function deduplicateProjectPreviews(
  previews: PublicProjectPreview[]
): PublicProjectPreview[] {
  if (!Array.isArray(previews) || previews.length === 0) return [];
  const byName = new Map<string, PublicProjectPreview>();

  for (const item of previews) {
    const normName = normalizeProjectName(item.projectName);
    const key = normName || `id:${item.id}`;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, item);
      continue;
    }
    if (existing.hasAnalysis !== item.hasAnalysis) {
      byName.set(key, item.hasAnalysis ? item : existing);
      continue;
    }
    const existingTime = getTimestampMs(existing.updatedAt);
    const itemTime = getTimestampMs(item.updatedAt);
    byName.set(key, itemTime > existingTime ? item : existing);
  }

  return Array.from(byName.values()).sort(
    (a, b) => getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt)
  );
}
