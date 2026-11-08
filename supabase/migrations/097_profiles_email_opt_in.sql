-- ============================================================
-- 097: email opt-in, and profiles locked to their owner
--
-- The sign-in modal now promises: we store only your email, send no email
-- unless you opt in, and never share it. Two things in production broke that
-- promise, and both are fixed here with the opt-in itself.
--
-- 1. "Anyone can view profiles" (USING true) let ANY caller, including the
--    public anon key, read every row, email included. Every policy and
--    function that reads profiles reads only the caller's own row (still
--    allowed by "Users can view their own profile") or is SECURITY DEFINER,
--    so nothing needs the open read.
--
-- 2. "Users can update own profile" guarded is_owner but not role: a signed-in
--    viewer could set their own role to 'admin'. Rather than chase each column
--    in a WITH CHECK, users may now update only email_opt_in. Role changes go
--    through set_user_role (SECURITY DEFINER, admin-only); new rows come from
--    handle_new_user (SECURITY DEFINER).
--
-- Safe to run twice.
-- ============================================================

-- Off by default: only a user's own click turns it on.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.email_opt_in IS
  'User agreed to rare emails about major changes, at most once a quarter. Set only by the user.';

DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (email_opt_in) ON public.profiles TO authenticated;
-- Row scope stays with "Users can update own profile" (auth.uid() = id).
