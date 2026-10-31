-- 0002: digital account inventory, the safety score model, recommendations and
-- the privacy checklist. Passwords for external accounts are deliberately
-- impossible to store here - there is no password column on any table.

create table public.digital_accounts (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.users (id) on delete cascade,
  provider_name             text not null,
  category                  text not null default 'other'
                              constraint digital_accounts_category_valid
                              check (category in (
                                'email', 'social', 'school', 'work', 'finance', 'shopping',
                                'health', 'government', 'entertainment', 'developer', 'other'
                              )),
  -- A masked hint such as "a***@university.edu.ph". Never a credential.
  username_hint             text,
  sign_in_url               text,
  mfa_enabled               boolean not null default false,
  mfa_method                text not null default 'none'
                              constraint digital_accounts_mfa_method_valid
                              check (mfa_method in ('none', 'authenticator_app', 'sms', 'security_key', 'passkey')),
  stored_in_password_manager boolean not null default false,
  unique_password_claimed   boolean not null default false,
  recovery_configured       boolean not null default false,
  -- Self-reported exposure only; the platform never queries external services.
  reported_breached         boolean not null default false,
  last_reviewed_at          timestamptz,
  review_interval_days      integer not null default 90
                              constraint digital_accounts_review_interval_valid
                              check (review_interval_days between 7 and 365),
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint digital_accounts_provider_not_blank check (length(btrim(provider_name)) between 1 and 60),
  constraint digital_accounts_notes_length check (notes is null or length(notes) <= 400),
  constraint digital_accounts_mfa_method_consistent check (
    (mfa_enabled = true and mfa_method <> 'none') or (mfa_enabled = false)
  )
);

create index digital_accounts_user_idx on public.digital_accounts (user_id);
create index digital_accounts_user_category_idx on public.digital_accounts (user_id, category);
-- Supports the "accounts needing review" factor; the staleness test itself uses
-- now(), which cannot appear in a partial index predicate.
create index digital_accounts_review_idx on public.digital_accounts (user_id, last_reviewed_at);

create trigger digital_accounts_touch_updated_at
  before update on public.digital_accounts
  for each row execute function public.touch_updated_at();

-- Current state, one row per user. History lives in security_assessments.
create table public.security_scores (
  user_id           uuid primary key references public.users (id) on delete cascade,
  score             smallint not null constraint security_scores_range check (score between 0 and 100),
  band              text not null
                      constraint security_scores_band_valid
                      check (band in ('critical', 'at_risk', 'fair', 'protected', 'strong')),
  headline          text not null,
  attention_count   integer not null default 0 check (attention_count >= 0),
  -- Ordered, explainable factor breakdown:
  -- [{key,label,weight,earned,deducted,status,reason,actionHref}]
  factors           jsonb not null default '[]'::jsonb,
  input_fingerprint text not null,
  model_version     integer not null default 1,
  computed_at       timestamptz not null default now(),
  constraint security_scores_factors_object check (jsonb_typeof(factors) = 'array')
);

create table public.security_assessments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  score          smallint not null check (score between 0 and 100),
  band           text not null check (band in ('critical', 'at_risk', 'fair', 'protected', 'strong')),
  factors        jsonb not null default '[]'::jsonb,
  trigger_source text not null
                   constraint security_assessments_trigger_valid
                   check (trigger_source in (
                     'signup', 'account_created', 'account_updated', 'review_logged', 'checklist_updated',
                     'learning_completed', 'recommendation_updated', 'incident_updated', 'analysis_run',
                     'mfa_updated', 'manual', 'periodic'
                   )),
  created_at     timestamptz not null default now(),
  constraint security_assessments_factors_object check (jsonb_typeof(factors) = 'array')
);

create index security_assessments_recent_idx on public.security_assessments (user_id, created_at desc);

create table public.recommendations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  -- Stable engine key so re-derivation updates instead of duplicating.
  key          text not null,
  category     text not null
                 constraint recommendations_category_valid
                 check (category in (
                   'authentication', 'accounts', 'recovery', 'alerts',
                   'learning', 'privacy', 'incidents', 'sessions'
                 )),
  priority     text not null
                 constraint recommendations_priority_valid
                 check (priority in ('high', 'medium', 'low')),
  title        text not null,
  detail       text not null,
  action_label text,
  action_href  text,
  learn_href   text,
  status       text not null default 'open'
                 constraint recommendations_status_valid
                 check (status in ('open', 'completed', 'dismissed')),
  -- Points this item is worth in the score model; kept visible for transparency.
  weight       smallint not null default 0 check (weight between 0 and 100),
  reason       text,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  dismissed_at  timestamptz,
  constraint recommendations_per_user_key unique (user_id, key),
  constraint recommendations_completed_has_timestamp check (
    (status = 'completed' and completed_at is not null) or (status <> 'completed')
  ),
  constraint recommendations_dismissed_has_timestamp check (
    (status = 'dismissed' and dismissed_at is not null) or (status <> 'dismissed')
  )
);

create index recommendations_open_idx on public.recommendations (user_id, priority) where status = 'open';

create trigger recommendations_touch_updated_at
  before update on public.recommendations
  for each row execute function public.touch_updated_at();

-- Admin-editable catalogue of privacy checklist items.
create table public.privacy_items (
  key        text primary key,
  label      text not null,
  guidance   text,
  category   text not null
               constraint privacy_items_category_valid
               check (category in ('data', 'visibility', 'permissions', 'identity', 'financial', 'social')),
  position   integer not null default 0,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_items_key_shape check (key ~ '^[a-z][a-z0-9_]{2,60}$')
);

create trigger privacy_items_touch_updated_at
  before update on public.privacy_items
  for each row execute function public.touch_updated_at();

create table public.privacy_checklist_states (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  item_key   text not null references public.privacy_items (key) on delete cascade,
  done       boolean not null default false,
  done_at    timestamptz,
  updated_at timestamptz not null default now(),
  constraint privacy_checklist_per_user_item unique (user_id, item_key),
  constraint privacy_checklist_done_consistency check (
    (done = true and done_at is not null) or (done = false)
  )
);

create index privacy_checklist_user_idx on public.privacy_checklist_states (user_id, done);
