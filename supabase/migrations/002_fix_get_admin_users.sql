-- ============================================================
-- Patch: fix get_admin_users() to include users without a
-- profiles row (signed up before the insert trigger existed),
-- and backfill missing profile rows.
-- ============================================================

-- 1. Backfill profiles rows for any auth user who doesn't have one yet
INSERT INTO public.profiles (id, role)
SELECT au.id, 'user'
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = au.id
);

-- 2. Replace get_admin_users() with a LEFT JOIN so users without
--    a profiles row still appear (shown as role='user')
CREATE OR REPLACE FUNCTION public.get_admin_users()
  RETURNS TABLE (
    id          uuid,
    email       text,
    created_at  timestamptz,
    role        text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    au.id,
    au.email::text,
    au.created_at,
    COALESCE(p.role, 'user')::text AS role
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  ORDER BY au.created_at DESC;
END;
$$;
