import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { analyzeProjectWithGemini, chatWithAnalystGemini } from './server/gemini';
import {
  createOtpForEmail,
  deleteProjectById,
  ensureUserAndSession,
  getProjectById,
  getPublicProjectPreviews,
  getUserBySessionToken,
  normalizeEmail,
  upsertProjectRecord,
  verifyAccessForEmail,
} from './server/store';
import type { Language, LocalDocumentDigest, ProjectRecord } from './src/types/ipds';

/**
 * ============================================================================
 * КОНФИГУРАЦИЯ ИНТЕГРАЦИЙ IPDS ТЕРМИНАЛ (Intelligent Business Systems)
 * ============================================================================
 * 1. GEMINI_API_KEY:
 *    В Google AI Studio задаётся автоматически через панель Settings -> Secrets.
 *    При локальном запуске укажите GEMINI_API_KEY="..." в файле .env.
 *
 * 2. GOOGLE APPS SCRIPT WEB APP URL (Таблица «IPDS — Заявки и контакты МСБ»):
 *    Вставьте URL вашего развёрнутого веб-приложения Google Apps Script ниже
 *    в DEFAULT_GAS_WEBHOOK_URL или задайте переменную окружения GAS_WEBHOOK_URL.
 *    Также URL можно подключить прямо в интерфейсе (раздел «Настройки интеграции»).
 * ============================================================================
 */
const DEFAULT_GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL?.trim() || '';

const PORT = 3000;

function extractBearerToken(req: express.Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return undefined;
  return auth.slice(7).trim();
}

function resolveGasUrl(clientOverrideUrl?: string): string {
  const candidate = (clientOverrideUrl || DEFAULT_GAS_WEBHOOK_URL || '').trim();
  if (!candidate) return '';
  if (!candidate.startsWith('https://script.google.com/')) {
    return candidate;
  }
  return candidate;
}

async function postToGasWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; status: 'synced' | 'unconfigured' | 'error'; message: string }> {
  if (!webhookUrl) {
    return {
      ok: false,
      status: 'unconfigured',
      message:
        'URL Google Apps Script Web App не задан. Заявка сохранена локально (Local-First) и в очереди синхронизации.',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        status: 'error',
        message: `Google Apps Script вернул статус ${response.status}`,
      };
    }

    const rawText = await response.text();
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as { ok?: boolean; error?: string };
        if (parsed && parsed.ok === false) {
          return {
            ok: false,
            status: 'error',
            message: `Google Apps Script вернул ошибку: ${parsed.error || 'Неизвестная ошибка'}`,
          };
        }
      } catch {
        // Не JSON-ответ от GAS игнорируем при HTTP 200
      }
    }

    return {
      ok: true,
      status: 'synced',
      message: 'Контакты переданы в таблицу «IPDS — Заявки и контакты МСБ».',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Сетевая ошибка при обращении к GAS';
    return {
      ok: false,
      status: 'error',
      message: `Не удалось подключиться к Google Apps Script: ${msg}`,
    };
  }
}

async function fetchSheetRowsFromGas(webhookUrl: string): Promise<{
  ok: boolean;
  status: 'ok' | 'unconfigured' | 'error';
  rows: unknown[][];
  message: string;
  error?: string;
}> {
  if (!webhookUrl) {
    return {
      ok: false,
      status: 'unconfigured',
      rows: [],
      message: 'URL Google Apps Script Web App не задан.',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);

    const response = await fetch(webhookUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        status: 'error',
        rows: [],
        message: `Google Apps Script вернул статус ${response.status}`,
        error: `HTTP ${response.status}`,
      };
    }

    const rawText = await response.text();
    let parsed: { ok?: boolean; rows?: unknown; error?: string } | null = null;
    try {
      parsed = JSON.parse(rawText) as { ok?: boolean; rows?: unknown; error?: string };
    } catch {
      return {
        ok: false,
        status: 'error',
        rows: [],
        message:
          'Google Apps Script вернул не JSON-ответ. Проверьте, что в коде есть doGet(e) и доступ развёрнут как «Все» (Anyone).',
        error: 'Invalid JSON response from GAS doGet',
      };
    }

    if (!parsed?.ok) {
      return {
        ok: false,
        status: 'error',
        rows: [],
        message: parsed?.error || 'Google Apps Script вернул ошибку при чтении таблицы.',
        error: parsed?.error,
      };
    }

    const rows = Array.isArray(parsed.rows) ? (parsed.rows as unknown[][]) : [];
    return {
      ok: true,
      status: 'ok',
      rows,
      message: `Получено строк из таблицы: ${rows.length}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Сетевая ошибка при обращении к GAS';
    return {
      ok: false,
      status: 'error',
      rows: [],
      message: `Не удалось подключиться к Google Apps Script: ${msg}`,
      error: msg,
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // --------------------------------------------------------------------------
  // API: Health & Интеграционная справка
  // --------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      gasConfigured: Boolean(DEFAULT_GAS_WEBHOOK_URL),
    });
  });

  // --------------------------------------------------------------------------
  // API: Актуальные курсы валют (USD / RUB / KZT) с резервным fallback
  // --------------------------------------------------------------------------
  app.get('/api/fx-rates', async (_req, res) => {
    const fallbackPayload = {
      rates: { USD: 1, RUB: 97.5, KZT: 495.0 },
      source: 'fallback' as const,
      updatedAt: new Date().toISOString(),
      provider: 'Default fallback rates',
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const primary = await fetch('https://open.er-api.com/v6/latest/USD', {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (primary.ok) {
        const data = (await primary.json()) as {
          rates?: { RUB?: number; KZT?: number };
          time_last_update_utc?: string;
        };
        const rub = Number(data?.rates?.RUB);
        const kzt = Number(data?.rates?.KZT);
        if (Number.isFinite(rub) && rub > 0 && Number.isFinite(kzt) && kzt > 0) {
          return res.json({
            rates: {
              USD: 1,
              RUB: Number(rub.toFixed(2)),
              KZT: Number(kzt.toFixed(2)),
            },
            source: 'live',
            updatedAt: data.time_last_update_utc
              ? new Date(data.time_last_update_utc).toISOString()
              : new Date().toISOString(),
            provider: 'open.er-api.com',
          });
        }
      }
    } catch {
      // Переходим к резервному источнику
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const secondary = await fetch(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
        { signal: controller.signal }
      );
      clearTimeout(timer);

      if (secondary.ok) {
        const data = (await secondary.json()) as {
          date?: string;
          usd?: { rub?: number; kzt?: number };
        };
        const rub = Number(data?.usd?.rub);
        const kzt = Number(data?.usd?.kzt);
        if (Number.isFinite(rub) && rub > 0 && Number.isFinite(kzt) && kzt > 0) {
          return res.json({
            rates: {
              USD: 1,
              RUB: Number(rub.toFixed(2)),
              KZT: Number(kzt.toFixed(2)),
            },
            source: 'live',
            updatedAt: data.date
              ? new Date(`${data.date}T12:00:00Z`).toISOString()
              : new Date().toISOString(),
            provider: 'currency-api',
          });
        }
      }
    } catch {
      // Используем резервные значения
    }

    return res.json(fallbackPayload);
  });

  // --------------------------------------------------------------------------
  // API: Вход / Восстановление доступа по E-mail (OTP или Персональный ключ)
  // --------------------------------------------------------------------------
  app.post('/api/auth/request-code', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim();
      const gasWebhookUrl = resolveGasUrl(req.body?.gasWebhookUrl);
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Укажите корректный адрес электронной почты.' });
      }

      const otpInfo = createOtpForEmail(email);

      let emailDispatchedViaGas = false;
      if (gasWebhookUrl) {
        const gasRes = await postToGasWebhook(gasWebhookUrl, {
          action: 'send_otp',
          email: otpInfo.email,
          otpCode: otpInfo.otpCode,
          expiresInMinutes: otpInfo.expiresInMinutes,
          timestamp: new Date().toISOString(),
        });
        emailDispatchedViaGas = gasRes.ok;
      }

      return res.json({
        email: otpInfo.email,
        accountExists: otpInfo.exists,
        expiresInMinutes: otpInfo.expiresInMinutes,
        emailDispatchedViaGas,
        // В среде предпросмотра / Local-First без SMTP-релея возвращаем сгенерированный код
        // для мгновенной проверки доступа (если не настроена внешняя отправка).
        demoOtpCode: emailDispatchedViaGas ? undefined : otpInfo.otpCode,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка генерации кода';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/auth/verify', (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim();
      const credential = String(req.body?.credential ?? '').trim();
      const mode = req.body?.mode === 'key' ? 'key' : 'otp';

      if (!email || !credential) {
        return res.status(400).json({ error: 'Укажите E-mail и код или ключ доступа.' });
      }

      const result = verifyAccessForEmail(email, credential, mode);
      if (!result.valid) {
        return res.status(401).json({ error: result.reason || 'Доступ не подтверждён.' });
      }

      return res.json({
        email: normalizeEmail(email),
        sessionToken: result.sessionToken,
        accessKeyHint: result.accessKeyHint,
        projects: result.projects ?? [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка проверки доступа';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/auth/session', (req, res) => {
    const token = extractBearerToken(req);
    const sessionData = getUserBySessionToken(token);
    if (!sessionData) {
      return res.status(401).json({ error: 'Сессия не найдена или истекла.' });
    }
    return res.json(sessionData);
  });

  // --------------------------------------------------------------------------
  // API: Проекты, Local-First синхронизация и Google Таблица контактов МСБ
  // --------------------------------------------------------------------------
  app.post('/api/projects', async (req, res) => {
    try {
      const payload = req.body?.project as ProjectRecord | undefined;
      const gasWebhookUrl = resolveGasUrl(req.body?.gasWebhookUrl);

      if (!payload || !payload.email || !payload.projectName || !payload.fullName) {
        return res.status(400).json({
          error: 'Обязательные поля: ФИО, E-mail, Название проекта и Регион.',
        });
      }

      const { sessionToken, newlyGeneratedKey, user } = ensureUserAndSession(payload.email);

      const regionDisplay =
        payload.region === 'Свой вариант' && payload.customRegion
          ? payload.customRegion
          : payload.region;

      // Отправка контактов в Google Таблицу «IPDS — Заявки и контакты МСБ»
      const leadSync = await postToGasWebhook(gasWebhookUrl, {
        action: 'create_lead',
        sheetName: 'IPDS — Заявки и контакты МСБ',
        fullName: payload.fullName,
        email: normalizeEmail(payload.email),
        projectName: payload.projectName,
        region: regionDisplay,
        category: payload.category || '',
        comment: payload.comment || '',
        createdAt: payload.createdAt || new Date().toISOString(),
        source: 'IPDS Терминал',
      });

      const saved = upsertProjectRecord({
        ...payload,
        email: normalizeEmail(payload.email),
        leadSyncStatus: leadSync.status,
        leadSyncMessage: leadSync.message,
      });

      return res.json({
        project: saved,
        sessionToken,
        accessKeyHint: user.accessKeyHint,
        newlyGeneratedKey,
        leadSync,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка создания проекта';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/projects/preview', (_req, res) => {
    const previews = getPublicProjectPreviews(5);
    return res.json({ previews });
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Проект не найден.' });
    }
    const token = extractBearerToken(req);
    const sessionData = getUserBySessionToken(token);
    if (!sessionData || normalizeEmail(sessionData.email) !== normalizeEmail(project.email)) {
      return res.status(403).json({
        error: 'Требуется подтверждение доступа по E-mail для просмотра этого проекта.',
      });
    }
    return res.json({ project });
  });

  app.patch('/api/projects/:id', (req, res) => {
    try {
      const existing = getProjectById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Проект не найден.' });
      }
      const token = extractBearerToken(req);
      const sessionData = getUserBySessionToken(token);
      if (!sessionData || normalizeEmail(sessionData.email) !== normalizeEmail(existing.email)) {
        return res.status(403).json({ error: 'Нет доступа к изменению этого проекта.' });
      }

      const patch = req.body?.patch as Partial<ProjectRecord> | undefined;
      const updated = upsertProjectRecord({
        ...existing,
        ...(patch ?? {}),
        id: existing.id,
        email: existing.email,
      });
      return res.json({ project: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка сохранения проекта';
      return res.status(500).json({ error: message });
    }
  });

  app.delete('/api/projects/:id', (req, res) => {
    const token = extractBearerToken(req);
    const sessionData = getUserBySessionToken(token);
    if (!sessionData) {
      return res.status(401).json({ error: 'Требуется авторизация.' });
    }
    const deleted = deleteProjectById(req.params.id, sessionData.email);
    if (!deleted) {
      return res.status(404).json({ error: 'Проект не найден или недоступен.' });
    }
    return res.json({ ok: true });
  });

  app.post('/api/leads/sync', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId ?? '').trim();
      const gasWebhookUrl = resolveGasUrl(req.body?.gasWebhookUrl);
      const existing = projectId ? getProjectById(projectId) : null;
      const lead = existing || (req.body?.lead as ProjectRecord | undefined);

      if (!lead) {
        return res.status(400).json({ error: 'Не переданы данные заявки.' });
      }

      const regionDisplay =
        lead.region === 'Свой вариант' && lead.customRegion
          ? lead.customRegion
          : lead.region;

      const syncRes = await postToGasWebhook(gasWebhookUrl, {
        action: 'create_lead',
        sheetName: 'IPDS — Заявки и контакты МСБ',
        fullName: lead.fullName,
        email: normalizeEmail(lead.email),
        projectName: lead.projectName,
        region: regionDisplay,
        category: lead.category || '',
        comment: lead.comment || '',
        createdAt: lead.createdAt || new Date().toISOString(),
        source: 'IPDS Терминал (повторная синхронизация)',
      });

      if (existing) {
        const updated = upsertProjectRecord({
          ...existing,
          leadSyncStatus: syncRes.status,
          leadSyncMessage: syncRes.message,
        });
        return res.json({ ...syncRes, project: updated });
      }

      return res.json(syncRes);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка синхронизации';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/leads/sheet', async (req, res) => {
    try {
      const gasWebhookUrl = resolveGasUrl(req.body?.gasWebhookUrl);
      const sheetRes = await fetchSheetRowsFromGas(gasWebhookUrl);
      if (sheetRes.status === 'unconfigured') {
        return res.status(400).json(sheetRes);
      }
      if (!sheetRes.ok) {
        return res.status(502).json(sheetRes);
      }
      return res.json(sheetRes);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка чтения таблицы Google Sheets';
      return res.status(500).json({ ok: false, rows: [], error: message, message });
    }
  });

  // --------------------------------------------------------------------------
  // API: ИИ-Аналитика и Диалог по проекту (@google/genai)
  // --------------------------------------------------------------------------
  app.post('/api/projects/:id/analyze', async (req, res) => {
    try {
      const existing = getProjectById(req.params.id);
      const clientSnapshot = req.body?.project as ProjectRecord | undefined;
      const targetProject = existing || clientSnapshot;

      if (!targetProject) {
        return res.status(404).json({ error: 'Проект не найден.' });
      }

      const token = extractBearerToken(req);
      const sessionData = getUserBySessionToken(token);
      if (
        existing &&
        (!sessionData || normalizeEmail(sessionData.email) !== normalizeEmail(existing.email))
      ) {
        return res.status(403).json({ error: 'Доступ к проекту не подтверждён.' });
      }

      const mergedProject: ProjectRecord = {
        ...targetProject,
        documents: clientSnapshot?.documents ?? targetProject.documents,
        comment: clientSnapshot?.comment ?? targetProject.comment,
        category: clientSnapshot?.category ?? targetProject.category,
      };

      const language: Language = req.body?.language === 'en' ? 'en' : 'ru';
      const analysis = await analyzeProjectWithGemini(mergedProject, language);
      const saved = upsertProjectRecord({
        ...mergedProject,
        analysis,
        manualOverrides: {},
      });

      return res.json({ project: saved, analysis });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка выполнения анализа ИИ';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/projects/:id/chat', async (req, res) => {
    try {
      const existing = getProjectById(req.params.id);
      const clientSnapshot = req.body?.project as ProjectRecord | undefined;
      const targetProject = existing || clientSnapshot;

      if (!targetProject) {
        return res.status(404).json({ error: 'Проект не найден.' });
      }

      const token = extractBearerToken(req);
      const sessionData = getUserBySessionToken(token);
      if (
        existing &&
        (!sessionData || normalizeEmail(sessionData.email) !== normalizeEmail(existing.email))
      ) {
        return res.status(403).json({ error: 'Доступ к проекту не подтверждён.' });
      }

      const userMessage = String(req.body?.message ?? '').trim();
      const newDocuments = (req.body?.newDocuments ?? []) as LocalDocumentDigest[];
      const currentEffectiveInputs = req.body?.currentEffectiveInputs;

      if (!userMessage && newDocuments.length === 0) {
        return res.status(400).json({ error: 'Введите вопрос или прикрепите локальный документ.' });
      }

      const promptText =
        userMessage ||
        `Проанализируй прикреплённые локальные документы (${newDocuments
          .map((d) => d.name)
          .join(', ')}) и дополни оценку проекта с учётом сохранённого паспорта.`;

      const language: Language = req.body?.language === 'en' ? 'en' : 'ru';
      const aiResponse = await chatWithAnalystGemini(
        targetProject,
        promptText,
        newDocuments,
        currentEffectiveInputs,
        language
      );

      const now = new Date().toISOString();
      const userMsgRecord = {
        id: `msg_u_${Date.now()}`,
        role: 'user' as const,
        content: promptText,
        attachments: newDocuments.map((d) => ({
          name: d.name,
          fileType: d.fileType,
          sizeBytes: d.sizeBytes,
        })),
        createdAt: now,
      };

      const assistantMsgRecord = {
        id: `msg_a_${Date.now() + 1}`,
        role: 'assistant' as const,
        content: aiResponse.reply,
        suggestedOverrides: aiResponse.suggestedOverrides,
        createdAt: new Date(Date.now() + 10).toISOString(),
      };

      const saved = upsertProjectRecord({
        ...targetProject,
        documents: [...targetProject.documents, ...newDocuments],
        dialogue: [...targetProject.dialogue, userMsgRecord, assistantMsgRecord],
      });

      return res.json({
        project: saved,
        assistantMessage: assistantMsgRecord,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка диалога с аналитиком ИИ';
      return res.status(500).json({ error: message });
    }
  });

  // --------------------------------------------------------------------------
  // Vite Middleware (dev) или раздача собранного бандла (production)
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IPDS Терминал запущен на http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Критическая ошибка запуска сервера IPDS Терминал:', err);
  process.exit(1);
});
