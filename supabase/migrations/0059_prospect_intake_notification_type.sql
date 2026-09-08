-- ============================================================================
-- 0059 — internal notification type for prospect intake submissions (P1).
--
-- Adds one value to the existing internal_notification_type enum so admins get
-- a real Portal notification (via notifyAdmins) when a prospect submits the
-- public intake — using the proper type, not an unrelated existing one.
--
-- Additive only: adds an enum value; changes no table, policy, or data.
-- (ALTER TYPE ... ADD VALUE only appends a label; existing rows are unaffected.)
--
-- NUMBERING: 0059.
-- ============================================================================

alter type public.internal_notification_type
  add value if not exists 'prospect_intake_submitted';
