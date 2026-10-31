-- 0004: the learning hub - modules, lessons, interactive scenarios, quizzes,
-- progress and achievements. Content is admin-editable (feature 15).

create table public.learning_modules (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null check (length(btrim(title)) between 3 and 120),
  summary     text not null check (length(summary) <= 400),
  category    text not null
                constraint learning_modules_category_valid
                check (category in ('fundamentals', 'privacy', 'phishing', 'accounts', 'devices', 'incident_response')),
  level       text not null default 'beginner'
                constraint learning_modules_level_valid
                check (level in ('beginner', 'intermediate', 'advanced')),
  icon        text,
  est_minutes integer not null default 10 check (est_minutes between 1 and 240),
  position    integer not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint learning_modules_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create trigger learning_modules_touch_updated_at
  before update on public.learning_modules
  for each row execute function public.touch_updated_at();

create table public.learning_lessons (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references public.learning_modules (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 3 and 160),
  -- Ordered content blocks: [{type: 'paragraph'|'list'|'callout', ...}]
  body        jsonb not null default '[]'::jsonb,
  position    integer not null default 0,
  est_minutes integer not null default 5 check (est_minutes between 1 and 120),
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint learning_lessons_body_array check (jsonb_typeof(body) = 'array'),
  constraint learning_lessons_per_module_position unique (module_id, position)
);

create index learning_lessons_module_idx on public.learning_lessons (module_id, position);

create trigger learning_lessons_touch_updated_at
  before update on public.learning_lessons
  for each row execute function public.touch_updated_at();

-- Scenario-style prompts live here too: kind = 'scenario' shows a situation,
-- options and per-option feedback instead of a single right answer.
create table public.quiz_questions (
  id                 uuid primary key default gen_random_uuid(),
  lesson_id          uuid not null references public.learning_lessons (id) on delete cascade,
  kind               text not null default 'quiz'
                       constraint quiz_questions_kind_valid
                       check (kind in ('quiz', 'scenario')),
  prompt             text not null check (length(btrim(prompt)) between 5 and 800),
  -- [{id,label,feedback}] - feedback is shown after answering, for every option.
  options            jsonb not null check (jsonb_typeof(options) = 'array'),
  correct_option_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(correct_option_ids) = 'array'),
  explanation        text not null check (length(explanation) <= 2000),
  position           integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index quiz_questions_lesson_idx on public.quiz_questions (lesson_id, position);

create trigger quiz_questions_touch_updated_at
  before update on public.quiz_questions
  for each row execute function public.touch_updated_at();

create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  lesson_id     uuid not null references public.learning_lessons (id) on delete cascade,
  -- [{questionId,selectedOptionId,correct}]
  answers       jsonb not null check (jsonb_typeof(answers) = 'array'),
  correct_count integer not null check (correct_count >= 0),
  total_count   integer not null check (total_count >= 1),
  score_percent smallint not null check (score_percent between 0 and 100),
  passed        boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint quiz_attempts_counts_fit check (correct_count <= total_count),
  constraint quiz_attempts_percent_matches check (
    score_percent = round((correct_count::numeric / total_count::numeric) * 100)
  )
);

create index quiz_attempts_user_idx on public.quiz_attempts (user_id, created_at desc);
create index quiz_attempts_lesson_idx on public.quiz_attempts (lesson_id, user_id);

create table public.lesson_progress (
  user_id          uuid not null references public.users (id) on delete cascade,
  lesson_id        uuid not null references public.learning_lessons (id) on delete cascade,
  status           text not null default 'in_progress'
                     constraint lesson_progress_status_valid
                     check (status in ('in_progress', 'completed')),
  first_opened_at  timestamptz not null default now(),
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, lesson_id),
  constraint lesson_progress_completion_consistency check (
    (status = 'completed' and completed_at is not null) or (status = 'in_progress' and completed_at is null)
  )
);

create index lesson_progress_user_status_idx on public.lesson_progress (user_id, status);

create trigger lesson_progress_touch_updated_at
  before update on public.lesson_progress
  for each row execute function public.touch_updated_at();

create table public.achievements (
  key         text primary key,
  title       text not null,
  description text not null,
  icon        text,
  -- [{metric,target}] evaluated by the achievement service.
  criteria    jsonb not null check (jsonb_typeof(criteria) = 'array'),
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.user_achievements (
  user_id         uuid not null references public.users (id) on delete cascade,
  achievement_key text not null references public.achievements (key) on delete cascade,
  earned_at       timestamptz not null default now(),
  primary key (user_id, achievement_key)
);

create index user_achievements_user_idx on public.user_achievements (user_id, earned_at desc);
