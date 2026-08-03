-- ============================================================
-- Migration 041: Performance testing — source links and extra measured fields
--
-- 1. youtube_url → source_url (both tables).
--    The column was named for the first source that turned up. In practice
--    results are cited from written road tests as often as videos — a Car and
--    Driver article is neither a video nor a spreadsheet — and a column called
--    youtube_url holding a magazine URL is a name that lies about its contents.
--    RENAME preserves the rows already entered.
--
-- 2. Two more measured figures that published test blocks routinely report and
--    the schema had no home for:
--      top_speed_mph — measured top speed (often governor-limited)
--      skidpad_g     — lateral grip on a 300 ft skidpad
--    Both are single scalars with no speed window, so they don't fit
--    performance_intervals. Distinct from the specs.performance fields of
--    similar name, which are published claims rather than measurements taken
--    under a known protocol.
--
--    Note: 0-100 mph and rolling-start figures (e.g. 5-60 mph) need no schema
--    change — they are speed windows and already fit performance_intervals.
-- ============================================================

ALTER TABLE performance_sessions  RENAME COLUMN youtube_url TO source_url;
ALTER TABLE performance_summaries RENAME COLUMN youtube_url TO source_url;

COMMENT ON COLUMN performance_sessions.source_url IS
    'Link to the source of this session — video, article, or post.';
COMMENT ON COLUMN performance_summaries.source_url IS
    'Link to the source of these figures — video, article, or post.';

ALTER TABLE performance_summaries
    ADD COLUMN IF NOT EXISTS top_speed_mph numeric,
    ADD COLUMN IF NOT EXISTS skidpad_g     numeric;

COMMENT ON COLUMN performance_summaries.top_speed_mph IS
    'Measured top speed. Frequently governor-limited rather than aerodynamically limited — the source usually says which.';
COMMENT ON COLUMN performance_summaries.skidpad_g IS
    'Lateral grip, conventionally measured on a 300 ft skidpad.';
