-- 0001: identity, roles, authentication state, sessions and audit tokens.
-- PostgreSQL only (Supabase compatible). No proprietary extensions are used, so
-- the same migrations run against the local dev cluster and Supabase unchanged.

create function public.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.roles (
  key         text primary key,
  label       text not null,
  description text,
  created_at  timestamptz not null default now(),
  constraint roles_key_shape check (key ~ '^[a-z][a-z0-9_]{1,30}$')
);

insert into public.roles (key, label, description) values
  ('user',  'Standard user',   'Can manage their own safety data and settings.'),
  ('admin', 'Administrator',   'Manages users, reports, content and platform settings without routine access to private user detail.')
on conflict (key) do nothing;

create table public.users (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null,
  email_normalized      text generated always as (lower(btrim(email))) stored,
  password_hash         text not null,
  role_key              text not null default 'user' references public.roles (key) on delete restrict,
  display_name          text not null,
  status                text not null default 'pending_verification'
                          constraint users_status_valid
                          check (status in ('pending_verification', 'active', 'locked', 'suspended')),
  email_verified_at     timestamptz,
  mfa_enabled           boolean not null default false,
  mfa_secret_ciphertext bytea,
  mfa_secret_iv         bytea,
  mfa_secret_tag        bytea,
  mfa_enrolled_at       timestamptz,
  mfa_enabled_at        timestamptz,
  failed_login_attempts integer not null default 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint users_email_looks_valid check (position('@' in email) > 1 and position('@' in email) < length(email) - 1),
  constraint users_display_name_not_blank check (length(btrim(display_name)) between 1 and 80),
  -- A password hash is always an encoded KDF output, never plaintext.
  constraint users_password_hash_encoded check (length(password_hash) > 20),
  constraint users_failed_logins_non_negative check (failed_login_attempts >= 0),
  -- MFA can only be on when an encrypted secret actually exists.
  constraint users_mfa_needs_secret check (
    (mfa_enabled = false)
    or (mfa_secret_ciphertext is not null and mfa_secret_iv is not null and mfa_secret_tag is not null)
  )
);

-- Partial so a deleted account frees its email for a new registration.
create unique index users_email_normalized_key on public.users (email_normalized) where deleted_at is null;
create index users_role_idx on public.users (role_key);
create index users_status_idx on public.users (status);

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

create table public.user_profiles (
  user_id        uuid primary key references public.users (id) on delete cascade,
  full_name      text,
  preferred_name text,
  phone_e164     text,
  recovery_email text,
  timezone       text not null default 'Asia/Manila',
  locale         text not null default 'en-PH',
  avatar_url     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint user_profiles_recovery_email_shape check (recovery_email is null or position('@' in recovery_email) > 1)
);

create trigger user_profiles_touch_updated_at
  before update on public.user_profiles
  for each row execute function public.touch_updated_at();

create table public.user_preferences (
  user_id       uuid primary key references public.users (id) on delete cascade,
  theme         text not null default 'system'
                  constraint user_preferences_theme_valid check (theme in ('system', 'light', 'dark')),
  -- Keys such as securityAlerts / recommendationDigests / reportUpdates /
  -- learningNudges / emergencyReminders. Absent keys fall back to safe defaults.
  notifications jsonb not null default '{}'::jsonb,
  privacy       jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  constraint user_preferences_theme_object check (jsonb_typeof(notifications) = 'object')
);

create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function public.touch_updated_at();

create table public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint mfa_recovery_codes_unique unique (user_id, code_hash)
);

create index mfa_recovery_codes_available_idx
  on public.mfa_recovery_codes (user_id)
  where used_at is null;

create table public.auth_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  -- Rotation family: every refresh token in one chain shares it, so a replayed
  -- (already-rotated) token revokes the whole family.
  family_id       uuid not null default gen_random_uuid(),
  token_hash      text not null unique,
  rotated_from_id uuid references public.auth_sessions (id) on delete set null,
  device_label    text,
  browser         text,
  os              text,
  platform        text,
  user_agent      text,
  ip_hash         text,
  approx_country  text,
  approx_region   text,
  auth_method     text not null default 'password'
                    constraint auth_sessions_auth_method_valid
                    check (auth_method in ('password', 'password_mfa', 'recovery_code')),
  mfa_verified    boolean not null default false,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_reason  text
                    constraint auth_sessions_revoke_reason_valid
                    check (revoked_reason is null or revoked_reason in (
                      'logged_out', 'password_changed', 'mfa_changed', 'manual',
                      'reuse_detected', 'expired', 'all_other_sessions'
                    )),
  constraint auth_sessions_valid_window check (expires_at > created_at),
  constraint auth_sessions_revoked_consistency check (
    (revoked_at is null and revoked_reason is null) or (revoked_at is not null and revoked_reason is not null)
  )
);

create index auth_sessions_active_idx on public.auth_sessions (user_id) where revoked_at is null;
create index auth_sessions_family_idx on public.auth_sessions (family_id);
create index auth_sessions_expiry_idx on public.auth_sessions (expires_at) where revoked_at is null;

create table public.login_attempts (
  id          bigint generated always as identity primary key,
  -- Emails are stored only as a salted digest so the attempt log cannot be used
  -- to harvest account addresses.
  email_hash  text,
  ip_hash     text,
  user_id     uuid references public.users (id) on delete set null,
  outcome     text not null
                constraint login_attempts_outcome_valid
                check (outcome in (
                  'success', 'invalid_credentials', 'unknown_email', 'mfa_required',
                  'mfa_failed', 'locked', 'rate_limited', 'logout'
                )),
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index login_attempts_email_idx on public.login_attempts (email_hash, created_at desc);
create index login_attempts_ip_idx on public.login_attempts (ip_hash, created_at desc);
create index login_attempts_user_idx on public.login_attempts (user_id, created_at desc);

create table public.auth_tokens (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  purpose           text not null
                      constraint auth_tokens_purpose_valid
                      check (purpose in ('email_verification', 'password_reset')),
  token_hash        text not null unique,
  requested_ip_hash text,
  consumed_at       timestamptz,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  constraint auth_tokens_valid_window check (expires_at > created_at)
);

create index auth_tokens_lookup_idx on public.auth_tokens (user_id, purpose, created_at desc);
