-- ── Access logs ────────────────────────────────────────────────────────────
-- Captures RLS violations and other unauthorised write attempts so we can
-- distinguish genuine attacks from UI bugs showing actions to the wrong users.
--
-- Rows are written via a SECURITY DEFINER function so anonymous sessions can
-- record attempts without direct table access. Admins can query via dashboard.

CREATE TABLE IF NOT EXISTS access_logs (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       uuid,           -- null = anonymous / unauthenticated
    user_email    text,           -- denormalised for readability in dashboard
    operation     text NOT NULL,  -- e.g. 'delete_run', 'update_vehicle'
    resource_type text,           -- e.g. 'run', 'vehicle', 'tag'
    resource_id   text,           -- stringified resource id
    error_code    text,           -- PostgREST / Supabase error code
    error_message text,           -- raw error message
    user_agent    text,           -- navigator.userAgent from client
    created_at    timestamptz DEFAULT now()
);

ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;

-- No direct INSERT or SELECT — all writes go through the SECURITY DEFINER fn.
CREATE POLICY "access_logs: no direct access"
    ON access_logs USING (false) WITH CHECK (false);

-- Admins can read logs via the dashboard or direct query.
CREATE POLICY "access_logs: admin read"
    ON access_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- SECURITY DEFINER so any caller (including anonymous) can write a log row.
-- The function itself validates nothing sensitive — it just records what happened.
CREATE OR REPLACE FUNCTION log_access_attempt(
    p_user_id       uuid,
    p_user_email    text,
    p_operation     text,
    p_resource_type text,
    p_resource_id   text,
    p_error_code    text,
    p_error_message text,
    p_user_agent    text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO access_logs
        (user_id, user_email, operation, resource_type, resource_id,
         error_code, error_message, user_agent)
    VALUES
        (p_user_id, p_user_email, p_operation, p_resource_type, p_resource_id,
         p_error_code, p_error_message, p_user_agent);
END;
$$;
