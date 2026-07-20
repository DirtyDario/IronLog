-- IronLog: provision the full cloud-sync schema.
--
-- Ground-truth audit (2026-07-20) found only `public.personal_records` existed,
-- and even that table used `uuid` primary/foreign key columns while the client
-- (src/lib/db/schema.ts + src/lib/services/sync.ts) writes plain TEXT ids:
--   - default exercise ids are slugs, e.g. 'bench-press' (src/lib/db/seed.ts)
--   - PR ids are deterministic composite strings, e.g. '<setId>|strength|5RM'
--     (src/lib/services/pr.ts prId())
--   - all other ids are crypto.randomUUID() strings, which happen to be valid
--     UUIDs but are still generated/compared as TEXT by the client and never
--     need real FK/uuid typing.
--
-- This migration creates the 7 missing tables (workouts, exercises,
-- workout_exercises, sets, routines, routine_exercises) and recreates
-- personal_records with TEXT ids so every id type matches the client exactly.
-- personal_records is currently empty (verified via `select count(*)`), so
-- dropping and recreating it loses no data.
--
-- Note: the client's local Dexie `tombstones` table has NO server-side
-- counterpart — sync.ts uses local tombstone rows purely to trigger a
-- `DELETE FROM <table> WHERE id = ...` against the real entity table, then
-- deletes the local tombstone row. No `tombstones` table is created here.

-- ─────────────────────────────────────────────────────────────────────────
-- personal_records: recreate with TEXT ids (currently empty, uuid-typed)
-- ─────────────────────────────────────────────────────────────────────────
drop table if exists public.personal_records;

create table public.personal_records (
	id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	exercise_id text not null,
	category text not null,
	bucket text,
	workout_id text,
	set_id text,
	date timestamptz not null,
	weight numeric,
	reps integer,
	duration_sec integer,
	distance_m numeric,
	updated_at timestamptz not null default now()
);

alter table public.personal_records enable row level security;

create policy "Users own their PRs"
	on public.personal_records for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index personal_records_user_id_idx on public.personal_records (user_id);
create index personal_records_exercise_id_idx on public.personal_records (exercise_id);
create index personal_records_workout_id_idx on public.personal_records (workout_id);
create index personal_records_updated_at_idx on public.personal_records (updated_at);

-- ─────────────────────────────────────────────────────────────────────────
-- exercises
-- ─────────────────────────────────────────────────────────────────────────
create table public.exercises (
	id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	name text not null,
	type text not null,
	muscle_group text not null,
	is_custom boolean not null default true,
	is_unilateral boolean,
	notes text,
	updated_at timestamptz not null default now()
);

alter table public.exercises enable row level security;

create policy "Users own their exercises"
	on public.exercises for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index exercises_user_id_idx on public.exercises (user_id);
create index exercises_updated_at_idx on public.exercises (updated_at);

-- ─────────────────────────────────────────────────────────────────────────
-- workouts
-- ─────────────────────────────────────────────────────────────────────────
create table public.workouts (
	id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	date timestamptz not null,
	name text,
	notes text,
	duration_sec integer,
	finished_at timestamptz,
	last_activity_at bigint,
	updated_at timestamptz not null default now()
);

alter table public.workouts enable row level security;

create policy "Users own their workouts"
	on public.workouts for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index workouts_user_id_idx on public.workouts (user_id);
create index workouts_updated_at_idx on public.workouts (updated_at);
create index workouts_finished_at_idx on public.workouts (finished_at);

-- ─────────────────────────────────────────────────────────────────────────
-- workout_exercises
-- ─────────────────────────────────────────────────────────────────────────
create table public.workout_exercises (
	id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	workout_id text not null,
	exercise_id text not null,
	"order" integer not null default 0,
	notes text,
	updated_at timestamptz not null default now()
);

alter table public.workout_exercises enable row level security;

create policy "Users own their workout exercises"
	on public.workout_exercises for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index workout_exercises_user_id_idx on public.workout_exercises (user_id);
create index workout_exercises_workout_id_idx on public.workout_exercises (workout_id);
create index workout_exercises_exercise_id_idx on public.workout_exercises (exercise_id);
create index workout_exercises_updated_at_idx on public.workout_exercises (updated_at);

-- ─────────────────────────────────────────────────────────────────────────
-- sets
-- ─────────────────────────────────────────────────────────────────────────
create table public.sets (
	id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	workout_exercise_id text not null,
	"order" integer not null default 0,
	weight numeric,
	reps integer,
	duration_sec integer,
	distance_m numeric,
	is_warmup boolean not null default false,
	completed boolean not null default false,
	side text,
	notes text,
	updated_at timestamptz not null default now()
);

alter table public.sets enable row level security;

create policy "Users own their sets"
	on public.sets for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index sets_user_id_idx on public.sets (user_id);
create index sets_workout_exercise_id_idx on public.sets (workout_exercise_id);
create index sets_updated_at_idx on public.sets (updated_at);

-- ─────────────────────────────────────────────────────────────────────────
-- routines
-- ─────────────────────────────────────────────────────────────────────────
create table public.routines (
	id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	name text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.routines enable row level security;

create policy "Users own their routines"
	on public.routines for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index routines_user_id_idx on public.routines (user_id);
create index routines_updated_at_idx on public.routines (updated_at);

-- ─────────────────────────────────────────────────────────────────────────
-- routine_exercises
-- ─────────────────────────────────────────────────────────────────────────
create table public.routine_exercises (
	id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	routine_id text not null,
	exercise_id text not null,
	"order" integer not null default 0,
	target_sets integer,
	target_reps integer,
	updated_at timestamptz not null default now()
);

alter table public.routine_exercises enable row level security;

create policy "Users own their routine exercises"
	on public.routine_exercises for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index routine_exercises_user_id_idx on public.routine_exercises (user_id);
create index routine_exercises_routine_id_idx on public.routine_exercises (routine_id);
create index routine_exercises_updated_at_idx on public.routine_exercises (updated_at);
