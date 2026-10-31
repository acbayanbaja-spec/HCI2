-- 0006: refresh-token rotation needs its own revocation reason so a rotated
-- token is distinguishable from a logged-out or manually revoked one.
-- Applied as a new migration because 0001 has already run somewhere.

alter table public.auth_sessions
  drop constraint auth_sessions_revoke_reason_valid;

alter table public.auth_sessions
  add constraint auth_sessions_revoke_reason_valid
  check (
    revoked_reason is null
    or revoked_reason in (
      'logged_out', 'password_changed', 'mfa_changed', 'manual',
      'reuse_detected', 'expired', 'all_other_sessions', 'rotated'
    )
  );
