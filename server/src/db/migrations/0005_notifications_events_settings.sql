-- 0005: notifications, the security activity history, and platform settings.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  kind       text not null
               constraint notifications_kind_valid
               check (kind in ('security_alert', 'recommendation', 'report_update', 'learning', 'emergency', 'system')),
  -- Severity is paired with an icon and a text label in the UI; colour alone
  -- is never the only signal.
  severity   text not null default 'info'
               constraint notifications_severity_valid
               check (severity in ('info', 'caution', 'warning', 'critical')),
  title      text not null check (length(btrim(title)) between 1 and 140),
  body       text not null check (length(body) <= 800),
  link       text,
  dedupe_key text,
  read_at    timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_dedupe_per_user unique (user_id, dedupe_key)
);

create index notifications_inbox_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.security_events (
  id          bigint generated always as identity primary key,
  -- Nullable so events about an unknown account (failed login for a non-existent
  -- email) are still auditable.
  user_id     uuid references public.users (id) on delete set null,
  actor_type  text not null default 'system'
                constraint security_events_actor_type_valid
                check (actor_type in ('user', 'admin', 'system', 'anonymous')),
  actor_id    uuid references public.users (id) on delete set null,
  category    text not null
                constraint security_events_category_valid
                check (category in (
                  'authentication', 'session', 'profile', 'mfa', 'account_asset', 'assessment',
                  'recommendation', 'analysis', 'report', 'incident', 'emergency', 'learning',
                  'privacy', 'notification', 'administration', 'system'
                )),
  event_type  text not null check (event_type ~ '^[a-z][a-z0-9_]{2,60}$'),
  message     text not null check (length(message) between 1 and 500),
  severity    text not null default 'info'
                constraint security_events_severity_valid
                check (severity in ('info', 'caution', 'warning', 'critical')),
  -- Only a salted digest of the client address is kept.
  ip_hash     text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint security_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index security_events_user_timeline_idx on public.security_events (user_id, created_at desc);
create index security_events_type_idx on public.security_events (event_type, created_at desc);
create index security_events_category_idx on public.security_events (category, created_at desc);
create index security_events_system_idx on public.security_events (created_at desc) where user_id is null;

create table public.system_settings (
  key        text primary key,
  label      text not null,
  description text,
  value      jsonb not null,
  -- Settings that only touch platform behaviour, never user secrets.
  is_public  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null
);

create trigger system_settings_touch_updated_at
  before update on public.system_settings
  for each row execute function public.touch_updated_at();

insert into public.system_settings (key, label, description, value, is_public) values
  ('maintenance_mode', 'Maintenance mode', 'When true, standard users see a status page while administrators keep access.', '{"enabled": false, "message": ""}', true),
  ('signup_open', 'New registrations', 'Controls whether the public sign-up form accepts new accounts.', '{"enabled": true}', true),
  ('assessment_cadence', 'Safety reassessment frequency', 'How often the score is recalculated for an inactive user.', '{"interval_days": 7}', false)
on conflict (key) do nothing;
