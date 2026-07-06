-- Cloud schema (TDD §4). All PHI lives here; artifacts on disk/object store by id.

create extension if not exists pgcrypto;

create table practice (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tz text not null default 'America/Chicago',
  plan_tier text not null default 'core',
  opendental_mode text not null default 'server' check (opendental_mode in ('server','cloud')),
  created_at timestamptz not null default now()
);

create table connector (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practice(id),
  version text,
  last_seen_at timestamptz
);

create table payer (
  id uuid primary key default gen_random_uuid(),
  payer_key text not null unique,          -- stable match key, e.g. 'mock-delta'
  name text not null,
  portal_domain text,
  phone text,
  ivr_map_version text,
  tos_posture text not null default 'standard',
  capabilities jsonb not null default '{}'::jsonb   -- FieldCoverageMap from adapter
);

create table payer_plan (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null references payer(id),
  group_number text,
  employer_name text,
  quirks jsonb not null default '{}'::jsonb,        -- the corpus (de-identified)
  unique (payer_id, group_number)
);

create table patient_link (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practice(id),
  od_patnum bigint not null,
  first_name text not null,
  last_name text not null,
  birthdate date not null,
  unique (practice_id, od_patnum)
);

create table coverage (
  id uuid primary key default gen_random_uuid(),
  patient_link_id uuid not null references patient_link(id),
  payer_id uuid not null references payer(id),
  payer_plan_id uuid references payer_plan(id),
  od_inssub_num bigint not null,
  od_plan_num bigint not null,
  carrier_name text not null,
  subscriber_id text not null,
  subscriber_name text not null,
  relationship text not null default 'self',
  ordinal int not null default 1,
  last_verified_at timestamptz,
  unique (patient_link_id, od_inssub_num)
);

create table appointment (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practice(id),
  patient_link_id uuid not null references patient_link(id),
  od_aptnum bigint not null,
  starts_at timestamptz not null,
  minutes int not null default 60,
  provider text,
  cdt_codes text[] not null default '{}',
  status text not null default 'scheduled',
  unique (practice_id, od_aptnum)
);

create table verification (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practice(id),
  coverage_id uuid not null references coverage(id),
  appointment_id uuid references appointment(id),
  appt_date date not null,
  scope text not null check (scope in ('eligibility_only','full_breakdown')),
  status text not null default 'PLANNED',
  requested_by text not null default 'nightly_batch',
  deadline_at timestamptz,
  completed_at timestamptz,
  superseded_by uuid references verification(id),
  created_at timestamptz not null default now()
);
create index on verification (practice_id, appt_date);
create index on verification (status);

create table verification_step (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references verification(id),
  kind text not null,
  status text not null default 'running',
  detail text,
  artifact_ids text[] not null default '{}',
  cost_cents int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on verification_step (verification_id);

create table benefit_snapshot (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references verification(id) unique,
  canonical jsonb not null,                 -- BenefitBreakdown
  validator_issues jsonb not null default '[]'::jsonb,
  version text not null default '1.0',
  created_at timestamptz not null default now()
);

create table exception (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references verification(id),
  type text not null,
  severity text not null default 'warning',
  message text not null,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index on exception (verification_id);

create table writeback (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references verification(id),
  practice_id uuid not null references practice(id),
  target text not null,
  payload jsonb not null,
  before_image jsonb,
  status text not null default 'pending' check (status in ('pending','applied','failed','reverted')),
  error text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  reverted_at timestamptz
);
create index on writeback (practice_id, status);

create table review_task (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references verification(id),
  status text not null default 'open' check (status in ('open','in_progress','done')),
  assignee text,
  reason text not null,
  draft jsonb,                              -- partial BenefitBreakdown to correct
  labels jsonb,                             -- field-level corrections {field: {model, human}}
  sla_due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table artifact (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid references verification(id),
  kind text not null,                       -- screenshot|dom|transcript|x12|pdf|audio
  content_type text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  object text not null,
  phi_scope text,
  at timestamptz not null default now()
);

-- Durable job queue for the workflow runner (Temporal stand-in, TDD §3.2 note).
create table job (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- 'verify_patient' | 'nightly_batch' | ...
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on job (status, run_after);
