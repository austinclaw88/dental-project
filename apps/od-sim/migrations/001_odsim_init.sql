-- OpenDental simulator schema (practice-side PMS stand-in).
-- Tables mimic OpenDental semantics (snake_case, minimal but recognizable).
-- All PKs are identity so the seed + connector can insert without id math;
-- reset with TRUNCATE ... RESTART IDENTITY CASCADE.

create table if not exists od_carrier (
  carrier_num  integer generated always as identity primary key,
  carrier_name text not null
);

create table if not exists od_patient (
  pat_num   integer generated always as identity primary key,
  l_name    text not null,
  f_name    text not null,
  birthdate date not null
);

create table if not exists od_insplan (
  plan_num   integer generated always as identity primary key,
  carrier_num integer not null references od_carrier(carrier_num),
  group_num  text,
  group_name text,
  plan_note  text not null default ''
);

create table if not exists od_inssub (
  inssub_num            integer generated always as identity primary key,
  plan_num              integer not null references od_insplan(plan_num),
  subscriber_external_id text not null,
  subscriber_name       text not null
);

create table if not exists od_patplan (
  patplan_num  integer generated always as identity primary key,
  pat_num      integer not null references od_patient(pat_num),
  inssub_num   integer not null references od_inssub(inssub_num),
  ordinal      integer not null default 1,
  relationship text not null default 'self'
);

create table if not exists od_appointment (
  apt_num      integer generated always as identity primary key,
  pat_num      integer not null references od_patient(pat_num),
  apt_datetime timestamptz not null,
  minutes      integer not null default 60,
  provider     text,
  status       text not null default 'scheduled'
);

create table if not exists od_procedurelog (
  proc_num integer generated always as identity primary key,
  apt_num  integer not null references od_appointment(apt_num),
  pat_num  integer not null references od_patient(pat_num),
  cdt_code text not null
);

create table if not exists od_insverify (
  insverify_num      integer generated always as identity primary key,
  plan_num           integer not null references od_insplan(plan_num),
  inssub_num         integer not null references od_inssub(inssub_num),
  date_last_verified timestamptz,
  verify_scope       text,
  unique (plan_num, inssub_num)
);

create table if not exists od_benefit (
  benefit_num  integer generated always as identity primary key,
  plan_num     integer not null references od_insplan(plan_num),
  cdt_from     text,
  cdt_to       text,
  percent      integer,
  category     text,
  entry_source text not null default 'human'   -- 'human' | 'nightshift'
);

create table if not exists od_commlog (
  commlog_num  integer generated always as identity primary key,
  pat_num      integer not null references od_patient(pat_num),
  log_datetime timestamptz not null default now(),
  note         text not null default ''
);

create table if not exists od_document (
  document_num integer generated always as identity primary key,
  pat_num      integer not null references od_patient(pat_num),
  title        text not null,
  body_text    text not null default '',
  created_at   timestamptz not null default now()
);
