-- 0003: suspicious content analysis, the abuse report queue, incident management
-- and the guided emergency response workflow.

create table public.content_analyses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  input_kind    text not null
                  constraint content_analyses_kind_valid
                  check (input_kind in ('url', 'message', 'email')),
  -- Truncated copy so history stays useful without hoarding whole conversations.
  input_excerpt text not null check (length(input_excerpt) between 1 and 500),
  input_hash    text not null,
  verdict       text not null
                  constraint content_analyses_verdict_valid
                  check (verdict in ('low', 'caution', 'suspicious', 'high')),
  risk_score    smallint not null check (risk_score between 0 and 100),
  -- [{code,label,severity,detail,advice}]
  indicators    jsonb not null default '[]'::jsonb,
  guidance      jsonb not null default '[]'::jsonb,
  links_found   jsonb not null default '[]'::jsonb,
  engine_version integer not null default 1,
  created_at    timestamptz not null default now(),
  constraint content_analyses_indicators_object check (jsonb_typeof(indicators) = 'array'),
  constraint content_analyses_guidance_object check (jsonb_typeof(guidance) = 'array')
);

create index content_analyses_recent_idx on public.content_analyses (user_id, created_at desc);
create index content_analyses_risky_idx on public.content_analyses (user_id, verdict) where verdict in ('suspicious', 'high');

create table public.content_reports (
  id               uuid primary key default gen_random_uuid(),
  analysis_id      uuid references public.content_analyses (id) on delete set null,
  reporter_user_id uuid not null references public.users (id) on delete cascade,
  target           text not null check (length(target) between 1 and 500),
  target_hash      text not null,
  claimed_brand    text,
  user_reason      text check (user_reason is null or length(user_reason) <= 1000),
  status           text not null default 'new'
                     constraint content_reports_status_valid
                     check (status in ('new', 'reviewing', 'confirmed', 'dismissed', 'resolved')),
  admin_notes      text check (admin_notes is null or length(admin_notes) <= 2000),
  reviewed_by      uuid references public.users (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint content_reports_review_consistency check (
    (status in ('confirmed', 'dismissed', 'resolved') and reviewed_at is not null)
    or (status in ('new', 'reviewing'))
  )
);

create index content_reports_queue_idx on public.content_reports (status, created_at);
create index content_reports_target_idx on public.content_reports (target_hash);

create trigger content_reports_touch_updated_at
  before update on public.content_reports
  for each row execute function public.touch_updated_at();

create table public.incidents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  incident_type    text not null
                     constraint incidents_type_valid
                     check (incident_type in (
                       'phishing', 'suspicious_message', 'unauthorized_access', 'account_takeover',
                       'malware', 'data_exposure', 'privacy_breach', 'lost_device', 'other'
                     )),
  title            text not null check (length(btrim(title)) between 3 and 120),
  description      text not null default '' check (length(description) <= 4000),
  severity         text not null default 'medium'
                     constraint incidents_severity_valid
                     check (severity in ('low', 'medium', 'high', 'critical')),
  status           text not null default 'open'
                     constraint incidents_status_valid
                     check (status in ('open', 'investigating', 'contained', 'resolved', 'closed')),
  affected_account text,
  occurred_at      timestamptz not null default now(),
  reported_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  resolution_notes text check (resolution_notes is null or length(resolution_notes) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint incidents_resolution_consistency check (
    (status in ('resolved', 'closed') and resolved_at is not null)
    or (status in ('open', 'investigating', 'contained'))
  ),
  constraint incidents_occurred_not_future check (occurred_at <= now() + interval '5 minutes')
);

create index incidents_user_recent_idx on public.incidents (user_id, created_at desc);
create index incidents_user_open_idx on public.incidents (user_id, status) where status in ('open', 'investigating', 'contained');

create trigger incidents_touch_updated_at
  before update on public.incidents
  for each row execute function public.touch_updated_at();

-- Append-only timeline: every status change, note and action lands here.
create table public.incident_events (
  id             uuid primary key default gen_random_uuid(),
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  actor_user_id  uuid references public.users (id) on delete set null,
  actor_type     text not null
                   constraint incident_events_actor_type_valid
                   check (actor_type in ('user', 'admin', 'system')),
  kind           text not null
                   constraint incident_events_kind_valid
                   check (kind in (
                     'created', 'note', 'status_change', 'severity_change', 'action_added',
                     'action_completed', 'action_reopened', 'evidence_added', 'resolved'
                   )),
  message        text not null check (length(message) between 1 and 1000),
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint incident_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index incident_events_timeline_idx on public.incident_events (incident_id, created_at);

create table public.incident_actions (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  label       text not null check (length(btrim(label)) between 2 and 200),
  detail      text check (detail is null or length(detail) <= 500),
  position    integer not null default 0,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint incident_actions_done_consistency check (
    (done = true and done_at is not null) or (done = false)
  )
);

create index incident_actions_incident_idx on public.incident_actions (incident_id, position);

-- Guided Emergency Mode. One plan per user; progress survives a refresh.
create table public.emergency_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references public.users (id) on delete cascade,
  status        text not null default 'in_progress'
                  constraint emergency_plans_status_valid
                  check (status in ('in_progress', 'complete')),
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  incident_id   uuid references public.incidents (id) on delete set null,
  constraint emergency_plans_completion_consistency check (
    (status = 'complete' and completed_at is not null) or (status = 'in_progress' and completed_at is null)
  )
);

create trigger emergency_plans_touch_updated_at
  before update on public.emergency_plans
  for each row execute function public.touch_updated_at();

create table public.emergency_steps (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.emergency_plans (id) on delete cascade,
  step_key     text not null,
  label        text not null,
  guidance     text not null,
  action_href  text,
  position     integer not null check (position >= 1),
  completed    boolean not null default false,
  completed_at timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint emergency_steps_per_plan_key unique (plan_id, step_key),
  constraint emergency_steps_per_plan_position unique (plan_id, position),
  constraint emergency_steps_completion_consistency check (
    (completed = true and completed_at is not null) or (completed = false)
  )
);

create index emergency_steps_plan_idx on public.emergency_steps (plan_id, position);
