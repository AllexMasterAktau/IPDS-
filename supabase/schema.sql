-- ============================================================================
-- IPDS Терминал — Схема общей базы данных (Supabase / PostgreSQL)
-- Хранит паспорта проектов и готовые результаты анализа БЕЗ исходных файлов.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Таблица сохранённых проектов и готовых анализов (без тяжёлых файлов)
CREATE TABLE IF NOT EXISTS public.ipds_shared_analyses (
  id text PRIMARY KEY,
  author_email text NOT NULL,
  full_name text NOT NULL,
  project_name text NOT NULL,
  region text NOT NULL,
  custom_region text,
  category text,
  business_scope text,
  activity_type text,
  oked_code text,
  comment text,
  currency_code text NOT NULL DEFAULT 'RUB',
  currency_symbol text NOT NULL DEFAULT '₽',
  has_analysis boolean NOT NULL DEFAULT false,
  verdict text,
  docs_count integer NOT NULL DEFAULT 0,
  analysis jsonb,
  manual_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  dialogue jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipds_shared_analyses_author
  ON public.ipds_shared_analyses (lower(author_email), updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ipds_shared_analyses_ready
  ON public.ipds_shared_analyses (has_analysis, updated_at DESC);

-- 2. Таблица настроек доступа создателя площадки (доступна только RPC внутри БД)
CREATE TABLE IF NOT EXISTS public.ipds_creator_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_email text NOT NULL,
  admin_key_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ЗАМЕНИТЕ 'ЗАДАЙТЕ_СВОЙ_СЕКРЕТНЫЙ_КЛЮЧ' на ваш личный пароль/ключ администратора перед выполнением:
INSERT INTO public.ipds_creator_config (id, admin_email, admin_key_hash)
VALUES (
  1,
  'allmasters13@gmail.com',
  encode(extensions.digest('ЗАДАЙТЕ_СВОЙ_СЕКРЕТНЫЙ_КЛЮЧ', 'sha256'), 'hex')
)
ON CONFLICT (id) DO NOTHING;

-- 3. Включаем RLS и закрываем прямой SELECT/INSERT/UPDATE/DELETE для anon/authenticated
--    (доступ выполняется только через проверенные RPC-функции ниже)
ALTER TABLE public.ipds_shared_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipds_creator_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ipds_shared_analyses FROM anon, authenticated;
REVOKE ALL ON TABLE public.ipds_creator_config FROM anon, authenticated;

-- 4. RPC: Сохранение/обновление анализа (без исходных файлов)
CREATE OR REPLACE FUNCTION public.ipds_upsert_shared_analysis(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id text;
  v_email text;
  v_full_name text;
  v_project_name text;
  v_analysis jsonb;
  v_has_analysis boolean;
  v_verdict text;
  v_created_at timestamptz;
  v_updated_at timestamptz;
BEGIN
  v_id := trim(coalesce(p_payload->>'id', ''));
  v_email := lower(trim(coalesce(p_payload->>'author_email', '')));
  v_full_name := trim(coalesce(p_payload->>'full_name', ''));
  v_project_name := trim(coalesce(p_payload->>'project_name', ''));

  IF v_id = '' OR v_email = '' OR position('@' IN v_email) = 0 OR v_project_name = '' THEN
    RAISE EXCEPTION 'Invalid project payload: id, author_email and project_name are required'
      USING ERRCODE = '22023';
  END IF;

  v_analysis := p_payload->'analysis';
  IF jsonb_typeof(v_analysis) = 'null' THEN
    v_analysis := NULL;
  END IF;

  v_has_analysis := (v_analysis IS NOT NULL);
  v_verdict := nullif(trim(coalesce(p_payload->>'verdict', v_analysis->>'investmentCommitteeVerdict', '')), '');
  v_created_at := coalesce(nullif(p_payload->>'created_at', '')::timestamptz, now());
  v_updated_at := coalesce(nullif(p_payload->>'updated_at', '')::timestamptz, now());

  INSERT INTO public.ipds_shared_analyses (
    id,
    author_email,
    full_name,
    project_name,
    region,
    custom_region,
    category,
    business_scope,
    activity_type,
    oked_code,
    comment,
    currency_code,
    currency_symbol,
    has_analysis,
    verdict,
    docs_count,
    analysis,
    manual_overrides,
    dialogue,
    created_at,
    updated_at
  )
  VALUES (
    v_id,
    v_email,
    coalesce(nullif(v_full_name, ''), v_email),
    v_project_name,
    coalesce(nullif(trim(p_payload->>'region'), ''), 'Казахстан'),
    nullif(trim(p_payload->>'custom_region'), ''),
    nullif(trim(p_payload->>'category'), ''),
    nullif(trim(p_payload->>'business_scope'), ''),
    nullif(trim(p_payload->>'activity_type'), ''),
    nullif(trim(p_payload->>'oked_code'), ''),
    nullif(trim(p_payload->>'comment'), ''),
    coalesce(nullif(trim(p_payload->>'currency_code'), ''), 'RUB'),
    coalesce(nullif(trim(p_payload->>'currency_symbol'), ''), '₽'),
    v_has_analysis,
    v_verdict,
    greatest(0, coalesce((p_payload->>'docs_count')::integer, 0)),
    v_analysis,
    coalesce(p_payload->'manual_overrides', '{}'::jsonb),
    coalesce(p_payload->'dialogue', '[]'::jsonb),
    v_created_at,
    v_updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    project_name = EXCLUDED.project_name,
    region = EXCLUDED.region,
    custom_region = EXCLUDED.custom_region,
    category = EXCLUDED.category,
    business_scope = EXCLUDED.business_scope,
    activity_type = EXCLUDED.activity_type,
    oked_code = EXCLUDED.oked_code,
    comment = EXCLUDED.comment,
    currency_code = EXCLUDED.currency_code,
    currency_symbol = EXCLUDED.currency_symbol,
    has_analysis = EXCLUDED.has_analysis,
    verdict = EXCLUDED.verdict,
    docs_count = EXCLUDED.docs_count,
    analysis = EXCLUDED.analysis,
    manual_overrides = EXCLUDED.manual_overrides,
    dialogue = EXCLUDED.dialogue,
    updated_at = EXCLUDED.updated_at
  WHERE lower(public.ipds_shared_analyses.author_email) = lower(EXCLUDED.author_email);

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'updated_at', v_updated_at);
END;
$$;

-- 5. RPC: Загрузка ТОЛЬКО своих проектов для обычного пользователя
CREATE OR REPLACE FUNCTION public.ipds_list_my_analyses(p_email text)
RETURNS SETOF public.ipds_shared_analyses
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT *
  FROM public.ipds_shared_analyses
  WHERE trim(coalesce(p_email, '')) <> ''
    AND lower(author_email) = lower(trim(p_email))
  ORDER BY updated_at DESC;
$$;

-- 6. RPC: Загрузка ВСЕХ сохранённых анализов пользователей для создателя площадки
CREATE OR REPLACE FUNCTION public.ipds_list_all_analyses_creator(
  p_email text,
  p_admin_key text
)
RETURNS SETOF public.ipds_shared_analyses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key text := trim(coalesce(p_admin_key, ''));
  v_hash text;
  v_valid boolean := false;
BEGIN
  IF v_email = '' OR v_key = '' THEN
    RAISE EXCEPTION 'Creator email and admin key are required'
      USING ERRCODE = '42501';
  END IF;

  v_hash := encode(extensions.digest(v_key, 'sha256'), 'hex');

  SELECT EXISTS (
    SELECT 1
    FROM public.ipds_creator_config cfg
    WHERE cfg.id = 1
      AND lower(trim(cfg.admin_email)) = v_email
      AND lower(trim(cfg.admin_key_hash)) = v_hash
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid creator credentials'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.ipds_shared_analyses
  ORDER BY has_analysis DESC, updated_at DESC;
END;
$$;

-- 7. RPC: Удаление проекта (своего — автором, любого — создателем с ключом)
CREATE OR REPLACE FUNCTION public.ipds_delete_shared_analysis(
  p_id text,
  p_email text,
  p_admin_key text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key text := trim(coalesce(p_admin_key, ''));
  v_is_creator boolean := false;
  v_deleted integer := 0;
BEGIN
  IF v_key <> '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.ipds_creator_config cfg
      WHERE cfg.id = 1
        AND lower(trim(cfg.admin_email)) = v_email
        AND lower(trim(cfg.admin_key_hash)) = encode(extensions.digest(v_key, 'sha256'), 'hex')
    ) INTO v_is_creator;
  END IF;

  IF v_is_creator THEN
    DELETE FROM public.ipds_shared_analyses WHERE id = p_id;
  ELSE
    DELETE FROM public.ipds_shared_analyses
    WHERE id = p_id
      AND lower(author_email) = v_email;
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ipds_upsert_shared_analysis(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ipds_list_my_analyses(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ipds_list_all_analyses_creator(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ipds_delete_shared_analysis(text, text, text) TO anon, authenticated;
