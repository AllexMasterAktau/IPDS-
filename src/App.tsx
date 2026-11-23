import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Menu, Plus } from 'lucide-react';
import { AdminPanelView } from './components/AdminPanelView';
import { AnalystDialogue } from './components/AnalystDialogue';
import { CreateProjectModal } from './components/CreateProjectModal';
import { EmailAuthModal } from './components/EmailAuthModal';
import { ProjectsListView } from './components/ProjectsListView';
import { ReportView } from './components/ReportView';
import { ActiveTab, Sidebar } from './components/Sidebar';
import { TopBarControls } from './components/TopBarControls';
import { WelcomeHero } from './components/WelcomeHero';
import { getTranslations } from './i18n/translations';
import { DEFAULT_FX_RATES, normalizeCurrencyCode } from './utils/financialModel';
import type {
  AdminUserSummary,
  CurrencyCode,
  FinancialInputs,
  FxRateMap,
  FxRatesState,
  Language,
  ProjectRecord,
  PublicProjectPreview,
  UserSession,
} from './types/ipds';

const ADMIN_EMAIL = 'allmasters13@gmail.com';
const LS_PROJECTS_KEY = 'ipds_projects_v1';
const LS_SESSION_KEY = 'ipds_session_v1';
const LS_ACTIVE_PROJECT_KEY = 'ipds_active_project_v1';
const LS_LANGUAGE_KEY = 'ipds_language_v1';
const LS_DISPLAY_CURRENCY_KEY = 'ipds_display_currency_v1';
const LS_FX_STATE_KEY = 'ipds_fx_state_v1';
const SYNC_CHANNEL_NAME = 'ipds_terminal_sync';

function readJsonFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isReportRoute = urlParams.get('view') === 'report';
  const routeProjectId = urlParams.get('projectId');

  const [projects, setProjects] = useState<ProjectRecord[]>(() =>
    readJsonFromStorage<ProjectRecord[]>(LS_PROJECTS_KEY, [])
  );
  const [session, setSession] = useState<UserSession | null>(() => {
    const stored = readJsonFromStorage<UserSession | null>(LS_SESSION_KEY, null);
    if (stored && stored.email?.trim() && stored.sessionToken?.trim()) {
      return stored;
    }
    const savedProjects = readJsonFromStorage<ProjectRecord[]>(LS_PROJECTS_KEY, []);
    if (savedProjects.length > 0) {
      const latest = savedProjects[0];
      return {
        email: latest.email,
        sessionToken: `local_sess_${Date.now()}`,
        verifiedAt: new Date().toISOString(),
        isAdmin: latest.email.trim().toLowerCase() === ADMIN_EMAIL,
      };
    }
    return null;
  });
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    routeProjectId || localStorage.getItem(LS_ACTIVE_PROJECT_KEY)
  );
  const gasWebhookUrl = useMemo(
    () => ((import.meta.env.VITE_GAS_WEBHOOK_URL as string | undefined) || '').trim(),
    []
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (isReportRoute) return 'report';
    return 'welcome';
  });

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [analyzingProjectId, setAnalyzingProjectId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [previewProjects, setPreviewProjects] = useState<PublicProjectPreview[]>([]);
  const [adminProjects, setAdminProjects] = useState<ProjectRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminGasConfigured, setAdminGasConfigured] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminSyncingPending, setAdminSyncingPending] = useState(false);

  const [language, setLanguage] = useState<Language>(() => {
    const stored = localStorage.getItem(LS_LANGUAGE_KEY);
    return stored === 'en' ? 'en' : 'ru';
  });

  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>(() => {
    const stored = localStorage.getItem(LS_DISPLAY_CURRENCY_KEY);
    if (stored === 'RUB' || stored === 'KZT' || stored === 'USD') {
      return stored;
    }
    const savedProjects = readJsonFromStorage<ProjectRecord[]>(LS_PROJECTS_KEY, []);
    const savedActiveId = routeProjectId || localStorage.getItem(LS_ACTIVE_PROJECT_KEY);
    const target =
      savedProjects.find((p) => p.id === savedActiveId) ?? savedProjects[0];
    return target ? normalizeCurrencyCode(target.currencyCode) : 'RUB';
  });

  const [fxState, setFxState] = useState<FxRatesState>(() =>
    readJsonFromStorage<FxRatesState>(LS_FX_STATE_KEY, {
      rates: DEFAULT_FX_RATES,
      source: 'fallback',
      updatedAt: new Date().toISOString(),
      provider: 'default',
    })
  );
  const [fxLoading, setFxLoading] = useState(false);

  const t = useMemo(() => getTranslations(language), [language]);

  // Local-First сохранение состояния в localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(projects));
    } catch {
      // Игнорируем переполнение quota, данные остаются в памяти/на сервере
    }
  }, [projects]);

  useEffect(() => {
    if (session) {
      localStorage.setItem(LS_SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(LS_SESSION_KEY);
    }
  }, [session]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem(LS_ACTIVE_PROJECT_KEY, activeProjectId);
    } else {
      localStorage.removeItem(LS_ACTIVE_PROJECT_KEY);
    }
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem(LS_LANGUAGE_KEY, language);
    document.documentElement.lang = language;
    document.title =
      language === 'en'
        ? 'IPDS Terminal — Investment & Project Analytics'
        : 'IPDS Терминал — Инвестиционная и проектная аналитика';
  }, [language]);

  useEffect(() => {
    localStorage.setItem(LS_DISPLAY_CURRENCY_KEY, displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_FX_STATE_KEY, JSON.stringify(fxState));
    } catch {
      // ignore storage errors
    }
  }, [fxState]);

  const broadcastPrefs = useCallback(
    (nextPrefs: {
      language?: Language;
      displayCurrency?: CurrencyCode;
      fxState?: FxRatesState;
    }) => {
      if (typeof BroadcastChannel === 'undefined') return;
      try {
        const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
        channel.postMessage({ type: 'prefs_updated', ...nextPrefs });
        channel.close();
      } catch {
        // ignore
      }
    },
    []
  );

  const fetchLiveFxRates = useCallback(async () => {
    setFxLoading(true);
    try {
      const res = await fetch('/api/fx-rates');
      const data = (await res.json()) as Partial<FxRatesState>;
      if (res.ok && data.rates) {
        const nextFx: FxRatesState = {
          rates: {
            USD: 1,
            RUB: Number(data.rates.RUB) || DEFAULT_FX_RATES.RUB,
            KZT: Number(data.rates.KZT) || DEFAULT_FX_RATES.KZT,
          },
          source: data.source === 'live' ? 'live' : 'fallback',
          updatedAt: data.updatedAt || new Date().toISOString(),
          provider: data.provider,
        };
        setFxState(nextFx);
        broadcastPrefs({ fxState: nextFx });
      }
    } catch {
      setFxState((prev) => ({
        ...prev,
        source: prev.source === 'manual' ? 'manual' : 'fallback',
        updatedAt: prev.updatedAt || new Date().toISOString(),
      }));
    } finally {
      setFxLoading(false);
    }
  }, [broadcastPrefs]);

  // Автоматическая загрузка актуального курса FX при старте (если не включён ручной курс)
  useEffect(() => {
    const initialStored = readJsonFromStorage<FxRatesState | null>(LS_FX_STATE_KEY, null);
    if (initialStored?.source === 'manual') return;
    void fetchLiveFxRates();
  }, [fetchLiveFxRates]);

  const handleChangeLanguage = useCallback(
    (nextLang: Language) => {
      setLanguage(nextLang);
      broadcastPrefs({ language: nextLang });
    },
    [broadcastPrefs]
  );

  const handleChangeCurrency = useCallback(
    (nextCurrency: CurrencyCode) => {
      setDisplayCurrency(nextCurrency);
      broadcastPrefs({ displayCurrency: nextCurrency });
    },
    [broadcastPrefs]
  );

  const handleApplyManualFx = useCallback(
    (rates: FxRateMap) => {
      const nextFx: FxRatesState = {
        rates,
        source: 'manual',
        updatedAt: new Date().toISOString(),
        provider: 'manual',
      };
      setFxState(nextFx);
      broadcastPrefs({ fxState: nextFx });
    },
    [broadcastPrefs]
  );

  const handleResetManualFx = useCallback(() => {
    void fetchLiveFxRates();
  }, [fetchLiveFxRates]);

  const activeUserEmail = useMemo(
    () => (session?.email ? session.email.trim().toLowerCase() : null),
    [session?.email]
  );

  const isAuthenticated = Boolean(session?.sessionToken && activeUserEmail);
  const isAdmin = Boolean(isAuthenticated && activeUserEmail === ADMIN_EMAIL);

  const fetchAdminOverview = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride || session?.sessionToken;
      if (!token) return;
      setAdminLoading(true);
      try {
        const res = await fetch('/api/admin/overview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          projects?: ProjectRecord[];
          users?: AdminUserSummary[];
          gasConfigured?: boolean;
        };
        if (Array.isArray(data.projects)) {
          setAdminProjects(data.projects);
        }
        if (Array.isArray(data.users)) {
          setAdminUsers(data.users);
        }
        setAdminGasConfigured(Boolean(data.gasConfigured));
      } catch {
        // ignore admin fetch network errors
      } finally {
        setAdminLoading(false);
      }
    },
    [session?.sessionToken]
  );

  const handleAdminSyncPending = useCallback(async () => {
    if (!session?.sessionToken) return;
    setAdminSyncingPending(true);
    setGlobalError(null);
    try {
      const res = await fetch('/api/admin/sync-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ gasWebhookUrl }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        projects?: ProjectRecord[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(
          data.message ||
            (language === 'en'
              ? 'Failed to sync pending leads to Google Sheet.'
              : 'Не удалось отправить ожидающие заявки в Google Таблицу.')
        );
      }
      if (Array.isArray(data.projects)) {
        setAdminProjects(data.projects);
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error
          ? err.message
          : language === 'en'
          ? 'Background sync error.'
          : 'Ошибка фоновой синхронизации.'
      );
    } finally {
      setAdminSyncingPending(false);
    }
  }, [gasWebhookUrl, language, session?.sessionToken]);

  const userProjects = useMemo(() => {
    const email = activeUserEmail || (projects[0]?.email ?? null);
    if (!email) return projects;
    const normalizedActive = email.trim().toLowerCase();
    if (normalizedActive === ADMIN_EMAIL || isAdmin) {
      const map = new Map<string, ProjectRecord>();
      for (const p of projects) map.set(p.id, p);
      for (const p of adminProjects) map.set(p.id, p);
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }
    return projects
      .filter((p) => (p.email || '').trim().toLowerCase() === normalizedActive)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [projects, adminProjects, activeUserEmail, isAdmin]);

  const fetchPublicPreviews = useCallback(async () => {
    try {
      const res = await fetch('/api/projects/preview');
      if (!res.ok) return;
      const data = (await res.json()) as { previews?: PublicProjectPreview[] };
      if (Array.isArray(data.previews)) {
        setPreviewProjects(data.previews.slice(0, 5));
      }
    } catch {
      // ignore network preview errors
    }
  }, []);

  // Загрузка последних 5 закрытых карточек предпросмотра в неавторизованном режиме
  useEffect(() => {
    if (activeUserEmail) return;
    void fetchPublicPreviews();
  }, [activeUserEmail, fetchPublicPreviews]);

  // Проверка сохранённой сессии на сервере при загрузке (синхронизация между устройствами)
  useEffect(() => {
    if (!session?.sessionToken) return;
    let cancelled = false;

    fetch('/api/auth/session', {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) {
            setSession(null);
            setProjects([]);
            setActiveProjectId(null);
          }
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.projects)) return;
        const verifiedEmail = String(data.email || session.email || '')
          .trim()
          .toLowerCase();
        setProjects((prev) => {
          const mergedMap = new Map<string, ProjectRecord>();
          for (const p of prev) {
            if (p.email.trim().toLowerCase() === verifiedEmail) {
              mergedMap.set(p.id, p);
            }
          }
          for (const sp of data.projects as ProjectRecord[]) {
            if (sp.email.trim().toLowerCase() !== verifiedEmail) continue;
            const local = mergedMap.get(sp.id);
            if (!local || new Date(sp.updatedAt) >= new Date(local.updatedAt)) {
              mergedMap.set(sp.id, sp);
            }
          }
          return Array.from(mergedMap.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });
        if (verifiedEmail === ADMIN_EMAIL) {
          void fetchAdminOverview(session.sessionToken);
          if (!isReportRoute) {
            setActiveTab((prev) => (prev === 'welcome' ? 'admin' : prev));
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [session?.sessionToken, session?.email, fetchAdminOverview, isReportRoute]);

  // Если открыто отдельное окно отчёта (?view=report&projectId=...), подгружаем свежий проект с сервера
  useEffect(() => {
    if (!isReportRoute || !routeProjectId || !session?.sessionToken) return;
    fetch(`/api/projects/${encodeURIComponent(routeProjectId)}`, {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.project) {
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.id === data.project.id);
            if (idx === -1) return [data.project, ...prev];
            const copy = [...prev];
            copy[idx] = data.project;
            return copy;
          });
        }
      })
      .catch(() => {});
  }, [isReportRoute, routeProjectId, session?.sessionToken]);

  // Кросс-вкладочная синхронизация пересчитанных цифр и настроек языка/валюты между окнами
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    channel.onmessage = (event) => {
      const payload = event.data as {
        type?: string;
        project?: ProjectRecord;
        language?: Language;
        displayCurrency?: CurrencyCode;
        fxState?: FxRatesState;
      };
      if (payload?.type === 'project_updated' && payload.project) {
        setProjects((prev) => {
          const idx = prev.findIndex((p) => p.id === payload.project!.id);
          if (idx === -1) return [payload.project!, ...prev];
          const next = [...prev];
          next[idx] = payload.project!;
          return next;
        });
      } else if (payload?.type === 'prefs_updated') {
        if (payload.language) setLanguage(payload.language);
        if (payload.displayCurrency) setDisplayCurrency(payload.displayCurrency);
        if (payload.fxState) setFxState(payload.fxState);
      } else if (payload?.type === 'session_cleared') {
        setSession(null);
        setProjects([]);
        setActiveProjectId(null);
      }
    };
    return () => channel.close();
  }, []);

  const broadcastProjectUpdate = useCallback((updated: ProjectRecord) => {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      channel.postMessage({ type: 'project_updated', project: updated });
      channel.close();
    } catch {
      // ignore
    }
  }, []);

  const activeProject = useMemo(() => {
    if (!activeUserEmail) return null;
    if (activeProjectId) {
      const fromUser = userProjects.find((p) => p.id === activeProjectId);
      if (fromUser) return fromUser;
      if (isAdmin) {
        const fromAdmin = adminProjects.find((p) => p.id === activeProjectId);
        if (fromAdmin) return fromAdmin;
      }
    }
    return userProjects[0] ?? (isAdmin ? adminProjects[0] ?? null : null);
  }, [activeUserEmail, userProjects, adminProjects, activeProjectId, isAdmin]);

  // Защита от попадания на закрытые вкладки без активного подтверждённого E-mail
  useEffect(() => {
    if (
      !isReportRoute &&
      !activeUserEmail &&
      (activeTab === 'dialogue' || activeTab === 'report' || activeTab === 'admin')
    ) {
      setActiveTab('projects');
    } else if (!isReportRoute && activeTab === 'admin' && activeUserEmail && !isAdmin) {
      setActiveTab('projects');
    }
  }, [isReportRoute, activeUserEmail, activeTab, isAdmin]);

  const upsertLocalProject = useCallback(
    (updated: ProjectRecord) => {
      setProjects((prev) => {
        const idx = prev.findIndex((p) => p.id === updated.id);
        const next = idx === -1 ? [updated, ...prev] : [...prev];
        if (idx !== -1) next[idx] = updated;
        return next.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
      setAdminProjects((prev) => {
        if (prev.length === 0) return prev;
        const idx = prev.findIndex((p) => p.id === updated.id);
        const next = idx === -1 ? [updated, ...prev] : [...prev];
        if (idx !== -1) next[idx] = updated;
        return next.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
      broadcastProjectUpdate(updated);
    },
    [broadcastProjectUpdate]
  );

  const handleProjectCreated = (
    project: ProjectRecord,
    sessionToken: string,
    accessKeyHint?: string
  ) => {
    const normalizedEmail = project.email.trim().toLowerCase();
    setProjects((prev) => {
      const sameEmailProjects = prev.filter(
        (p) => p.email.trim().toLowerCase() === normalizedEmail && p.id !== project.id
      );
      return [project, ...sameEmailProjects].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
    broadcastProjectUpdate(project);
    setPreviewProjects([]);
    setActiveProjectId(project.id);
    if (sessionToken) {
      setSession({
        email: project.email,
        sessionToken,
        accessKeyHint,
        verifiedAt: new Date().toISOString(),
        isAdmin: normalizedEmail === ADMIN_EMAIL,
      });
      if (normalizedEmail === ADMIN_EMAIL) {
        void fetchAdminOverview(sessionToken);
      }
    }
    setActiveTab('dialogue');
  };

  const handleAuthenticated = (newSession: UserSession, serverProjects: ProjectRecord[]) => {
    const verifiedEmail = newSession.email.trim().toLowerCase();
    const scopedServerProjects = serverProjects
      .filter((p) => p.email.trim().toLowerCase() === verifiedEmail)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const adminUser = verifiedEmail === ADMIN_EMAIL;
    setSession({ ...newSession, isAdmin: adminUser });
    setProjects(scopedServerProjects);
    setPreviewProjects([]);

    if (adminUser) {
      if (scopedServerProjects.length > 0) {
        setActiveProjectId(scopedServerProjects[0].id);
      }
      void fetchAdminOverview(newSession.sessionToken);
      setActiveTab('admin');
      return;
    }

    if (scopedServerProjects.length > 0) {
      setActiveProjectId(scopedServerProjects[0].id);
      setActiveTab('projects');
    } else {
      setActiveProjectId(null);
      setActiveTab(activeTab === 'projects' ? 'projects' : 'welcome');
    }
  };

  const resetToUnauthenticatedState = useCallback(
    (nextTab: ActiveTab) => {
      setSession(null);
      setProjects([]);
      setAdminProjects([]);
      setAdminUsers([]);
      setAdminGasConfigured(false);
      setActiveProjectId(null);
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_PROJECTS_KEY);
      localStorage.removeItem(LS_ACTIVE_PROJECT_KEY);
      setActiveTab(nextTab);
      void fetchPublicPreviews();
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
          channel.postMessage({ type: 'session_cleared' });
          channel.close();
        } catch {
          // ignore
        }
      }
    },
    [fetchPublicPreviews]
  );

  const handleLogout = useCallback(() => {
    resetToUnauthenticatedState(
      activeTab === 'dialogue' || activeTab === 'report' || activeTab === 'admin'
        ? 'welcome'
        : activeTab
    );
  }, [activeTab, resetToUnauthenticatedState]);

  const handleSwitchEmail = useCallback(() => {
    resetToUnauthenticatedState(
      activeTab === 'dialogue' || activeTab === 'report' || activeTab === 'admin'
        ? 'projects'
        : activeTab
    );
    setAuthModalOpen(true);
  }, [activeTab, resetToUnauthenticatedState]);

  const handleRunAnalysis = async (targetProject: ProjectRecord) => {
    setAnalyzingProjectId(targetProject.id);
    setGlobalError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(targetProject.id)}/analyze`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.sessionToken
              ? { Authorization: `Bearer ${session.sessionToken}` }
              : {}),
          },
          body: JSON.stringify({ project: targetProject, language }),
        }
      );

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          language === 'en'
            ? 'Server returned non-JSON response. Please check Gemini API key configuration.'
            : 'Сервер вернул невалидный ответ. Проверьте конфигурацию GEMINI_API_KEY на сервере.'
        );
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error ||
            (language === 'en'
              ? 'Failed to run project analysis.'
              : 'Не удалось выполнить анализ проекта.')
        );
      }
      upsertLocalProject(data.project);
      setActiveProjectId(data.project.id);
      setActiveTab('report');
    } catch (err) {
      setGlobalError(
        err instanceof Error
          ? err.message
          : language === 'en'
          ? 'Project analysis failed via Gemini API.'
          : 'Ошибка анализа проекта через Gemini API.'
      );
    } finally {
      setAnalyzingProjectId(null);
    }
  };

  const handleUpdateOverrides = useCallback(
    (project: ProjectRecord, overrides: Partial<FinancialInputs>) => {
      const updated: ProjectRecord = {
        ...project,
        manualOverrides: overrides,
        updatedAt: new Date().toISOString(),
      };
      upsertLocalProject(updated);

      if (session?.sessionToken) {
        fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({ patch: { manualOverrides: overrides } }),
        }).catch(() => {});
      }
    },
    [session?.sessionToken, upsertLocalProject]
  );

  const handleDeleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setAdminProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
    }
    if (session?.sessionToken) {
      fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      }).catch(() => {});
    }
  };

  // ============================================================================
  // ОТДЕЛЬНОЕ ОКНО ОТЧЁТА (?view=report&projectId=...)
  // ============================================================================
  if (isReportRoute) {
    const reportProject = activeUserEmail
      ? userProjects.find((p) => p.id === routeProjectId) ??
        (isAdmin
          ? projects.find((p) => p.id === routeProjectId) ??
            adminProjects.find((p) => p.id === routeProjectId)
          : undefined) ??
        activeProject
      : null;

    return (
      <div className="min-h-screen bg-[#F5F3EE] text-[#1E2022] flex flex-col">
        <header className="no-print border-b border-[#2A2D32] bg-[#16181A] px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src="/ibs_logo_transparent.png"
              alt="Intelligent Business Systems"
              className="h-9 w-auto object-contain"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.fallbackApplied) {
                  target.dataset.fallbackApplied = '1';
                  target.src = '/assets/aistudio/ibs_logo_transparent_98656fe4.png';
                }
              }}
            />
            <div className="hidden sm:block border-l border-[#2A2D32] pl-4">
              <div className="text-sm font-bold text-[#FAF8F5]">{t.common.appName}</div>
              <div className="text-[11px] text-[#C99B52]">{t.common.reportSubtitle}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <TopBarControls
              variant="dark"
              language={language}
              onChangeLanguage={handleChangeLanguage}
              displayCurrency={displayCurrency}
              onChangeCurrency={handleChangeCurrency}
              fxState={fxState}
              fxLoading={fxLoading}
              onRefreshFx={() => void fetchLiveFxRates()}
              onApplyManualFx={handleApplyManualFx}
              onResetManualFx={handleResetManualFx}
            />
            <a
              href="/"
              className="text-xs font-medium text-[#D3D1CB] hover:text-[#C99B52] transition-colors whitespace-nowrap"
            >
              {t.common.openMainTerminal}
            </a>
          </div>
        </header>

        <main className="flex-1">
          {reportProject ? (
            <ReportView
              project={reportProject}
              isStandaloneWindow={true}
              language={language}
              displayCurrency={displayCurrency}
              fxRates={fxState.rates}
              onUpdateOverrides={(overrides) =>
                handleUpdateOverrides(reportProject, overrides)
              }
              onRunAnalysis={() => void handleRunAnalysis(reportProject)}
              analyzing={analyzingProjectId === reportProject.id}
            />
          ) : (
            <div className="max-w-xl mx-auto py-16 px-6 text-center space-y-4">
              <h2 className="text-xl font-bold text-[#1E2022]">
                {activeUserEmail ? t.report.notFoundTitle : t.projects.lockedBadge}
              </h2>
              <p className="text-sm text-[#5C6066]">{t.report.notFoundDesc}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {!activeUserEmail && (
                  <button
                    type="button"
                    onClick={() => setAuthModalOpen(true)}
                    className="inline-flex items-center px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer"
                  >
                    {t.projects.unlockBtn}
                  </button>
                )}
                <a
                  href="/"
                  className="inline-flex items-center px-5 py-2.5 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors"
                >
                  {t.common.goToTerminal}
                </a>
              </div>
            </div>
          )}
        </main>

        <footer className="no-print border-t border-[#2A2D32] bg-[#16181A] px-4 sm:px-8 py-3 text-xs text-[#9A9EA6] flex items-center justify-end">
          <a
            href="https://t.me/AllexMaster"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[#C99B52] hover:text-[#E0B56E] hover:underline transition-colors"
          >
            <span>Intelligent Business Systems® 2026</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </footer>

        <EmailAuthModal
          isOpen={authModalOpen}
          gasWebhookUrl={gasWebhookUrl}
          language={language}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={handleAuthenticated}
        />
      </div>
    );
  }

  // ============================================================================
  // ОСНОВНОЙ РАБОЧИЙ ТЕРМИНАЛ
  // ============================================================================
  const currentBreadcrumb =
    activeTab === 'welcome'
      ? t.header.breadcrumbWelcome
      : activeTab === 'projects'
      ? t.header.breadcrumbProjects
      : activeTab === 'admin'
      ? t.header.breadcrumbAdmin
      : activeTab === 'dialogue'
      ? `${t.header.breadcrumbDialoguePrefix} / ${
          activeProject?.projectName || t.header.breadcrumbDialogueFallback
        }`
      : `${t.header.breadcrumbReportPrefix} / ${
          activeProject?.projectName || t.header.breadcrumbReportFallback
        }`;

  return (
    <div className="min-h-screen bg-[#F5F3EE] text-[#1E2022] flex">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onSwitchEmail={handleSwitchEmail}
        onLogout={handleLogout}
        isAuthenticated={isAuthenticated}
        isAdmin={isAdmin}
        adminProjectsCount={adminProjects.length}
        activeUserEmail={activeUserEmail}
        projects={userProjects}
        previewCount={previewProjects.length}
        activeProject={activeProject}
        onSelectProject={(id) => {
          setActiveProjectId(id);
          const target = userProjects.find((p) => p.id === id);
          setActiveTab(target?.analysis ? 'report' : 'dialogue');
        }}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        language={language}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Верхняя рабочая панель */}
        <header className="no-print sticky top-0 z-30 bg-[#FAF8F5]/95 backdrop-blur-md border-b border-[#E5E0D5] px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={t.header.openNav}
              className="lg:hidden p-2 -ml-2 rounded-lg border border-[#C9C1B2] hover:border-[#8C6D3F] text-[#1E2022] hover:bg-[#EAE5DB] transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-[#5C6066] truncate">
              {currentBreadcrumb}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <TopBarControls
              variant="light"
              language={language}
              onChangeLanguage={handleChangeLanguage}
              displayCurrency={displayCurrency}
              onChangeCurrency={handleChangeCurrency}
              fxState={fxState}
              fxLoading={fxLoading}
              onRefreshFx={() => void fetchLiveFxRates()}
              onApplyManualFx={handleApplyManualFx}
              onResetManualFx={handleResetManualFx}
            />

            {activeProject?.analysis && (
              <a
                href={`/?view=report&projectId=${encodeURIComponent(activeProject.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors whitespace-nowrap shadow-xs"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#F5F3EE]" />
                <span>{t.common.getReport}</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1A1C1F] hover:bg-[#26292E] active:bg-[#141618] border border-white/[0.22] hover:border-white/[0.36] text-[#F5F3EE] font-semibold text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1C1F]/40 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 text-[#F5F3EE]" />
              <span>{t.common.createProject}</span>
            </button>
          </div>
        </header>

        {/* Системное уведомление об ошибке */}
        {globalError && (
          <div className="mx-4 sm:mx-8 mt-4 rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-800 flex items-center justify-between gap-3">
            <span>{globalError}</span>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="text-rose-700 hover:text-rose-950 font-semibold cursor-pointer shrink-0"
            >
              {t.common.hide}
            </button>
          </div>
        )}

        {/* Основная рабочая область */}
        <main className="flex-1">
          {activeTab === 'welcome' && (
            <WelcomeHero
              session={isAuthenticated ? session : null}
              projectsCount={userProjects.length}
              latestProject={activeProject}
              language={language}
              onOpenCreateModal={() => setCreateModalOpen(true)}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              onOpenLatestProject={() => {
                if (activeProject) {
                  setActiveTab(activeProject.analysis ? 'report' : 'dialogue');
                } else {
                  setActiveTab('projects');
                }
              }}
            />
          )}

          {activeTab === 'projects' && (
            <ProjectsListView
              isAuthenticated={isAuthenticated}
              activeUserEmail={activeUserEmail}
              projects={userProjects}
              previewProjects={previewProjects}
              activeProjectId={activeProject?.id ?? null}
              analyzingProjectId={analyzingProjectId}
              language={language}
              displayCurrency={displayCurrency}
              fxRates={fxState.rates}
              onSelectProject={(id, targetTab) => {
                setActiveProjectId(id);
                setActiveTab(targetTab);
              }}
              onRunAnalysis={(proj) => void handleRunAnalysis(proj)}
              onDeleteProject={handleDeleteProject}
              onOpenCreateModal={() => setCreateModalOpen(true)}
              onOpenAuthModal={() => setAuthModalOpen(true)}
            />
          )}

          {activeTab === 'dialogue' && activeProject && (
            <AnalystDialogue
              project={activeProject}
              sessionToken={session?.sessionToken}
              analyzing={analyzingProjectId === activeProject.id}
              language={language}
              displayCurrency={displayCurrency}
              fxRates={fxState.rates}
              onRunAnalysis={() => void handleRunAnalysis(activeProject)}
              onProjectUpdated={upsertLocalProject}
              onApplySuggestedOverrides={(overrides) =>
                handleUpdateOverrides(activeProject, {
                  ...activeProject.manualOverrides,
                  ...overrides,
                })
              }
              onOpenReportTab={() => setActiveTab('report')}
            />
          )}

          {activeTab === 'report' && activeProject && (
            <ReportView
              project={activeProject}
              language={language}
              displayCurrency={displayCurrency}
              fxRates={fxState.rates}
              onUpdateOverrides={(overrides) =>
                handleUpdateOverrides(activeProject, overrides)
              }
              onRunAnalysis={() => void handleRunAnalysis(activeProject)}
              analyzing={analyzingProjectId === activeProject.id}
            />
          )}
          {activeTab === 'admin' && isAdmin && (
            <AdminPanelView
              language={language}
              displayCurrency={displayCurrency}
              fxRates={fxState.rates}
              projects={adminProjects}
              users={adminUsers}
              gasConfigured={adminGasConfigured}
              loading={adminLoading}
              syncingPending={adminSyncingPending}
              analyzingProjectId={analyzingProjectId}
              activeProjectId={activeProject?.id ?? null}
              onRefresh={() => void fetchAdminOverview()}
              onSyncPending={() => void handleAdminSyncPending()}
              onSelectProject={(id, targetTab) => {
                setActiveProjectId(id);
                setActiveTab(targetTab);
              }}
              onRunAnalysis={(proj) => void handleRunAnalysis(proj)}
              onDeleteProject={handleDeleteProject}
            />
          )}
        </main>

        {/* Основной футер с тёмной графитовой заливкой и ссылкой на Telegram */}
        <footer className="no-print border-t border-[#2A2D32] bg-[#16181A] px-4 sm:px-8 py-3.5 text-xs text-[#9A9EA6] flex items-center justify-end">
          <a
            href="https://t.me/AllexMaster"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[#C99B52] hover:text-[#E0B56E] hover:underline transition-colors"
          >
            <span>Intelligent Business Systems® 2026</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </footer>
      </div>

      {/* Модальные окна */}
      <CreateProjectModal
        isOpen={createModalOpen}
        defaultEmail={session?.email || ''}
        gasWebhookUrl={gasWebhookUrl}
        language={language}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleProjectCreated}
      />

      <EmailAuthModal
        isOpen={authModalOpen}
        gasWebhookUrl={gasWebhookUrl}
        language={language}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  );
}
