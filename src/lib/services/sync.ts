/**
 * Sync engine — pushes unsynced local Dexie rows to Supabase, pulls remote changes down.
 * Strategy: last-write-wins based on _lastModified / updated_at.
 * Default exercises (isCustom=false) are never synced — seeded locally on every device.
 */

import { db } from '$lib/db/schema';
import { supabase } from '$lib/supabase';
import { writable, get } from 'svelte/store';

// ─── Sync status store ────────────────────────────────────────────────────────

interface SyncStatus {
	syncing: boolean;
	lastSyncedAt: Date | null;
	error: string | null;
}

export const syncStatus = writable<SyncStatus>({
	syncing: false,
	lastSyncedAt: null,
	error: null
});

// ─── Last pull timestamp ──────────────────────────────────────────────────────

const LAST_PULL_KEY = 'ironlog_last_pull';

function getLastPull(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(LAST_PULL_KEY);
}

function setLastPull(ts: string) {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(LAST_PULL_KEY, ts);
	}
}

// ─── Debounce ─────────────────────────────────────────────────────────────────

let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePush() {
	if (pushTimer) clearTimeout(pushTimer);
	pushTimer = setTimeout(() => {
		syncNow().catch(console.error);
	}, 1500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Main sync ────────────────────────────────────────────────────────────────

export async function syncNow(): Promise<void> {
	const { data: { session } } = await supabase.auth.getSession();
	if (!session?.user) return; // not signed in, skip

	const userId = session.user.id;
	syncStatus.update((s) => ({ ...s, syncing: true, error: null }));

	try {
		await pushUnsynced(userId);
		await pullChanges(userId);
		syncStatus.update((s) => ({ ...s, syncing: false, lastSyncedAt: new Date(), error: null }));
	} catch (err: any) {
		console.error('[sync] error:', err);
		syncStatus.update((s) => ({ ...s, syncing: false, error: err?.message ?? 'Sync failed' }));
	}
}

// ─── Push ─────────────────────────────────────────────────────────────────────

async function pushUnsynced(userId: string) {
	// ── Tombstones first (deletes must land before any re-upsert of same id) ──
	const unsyncedTombstones = await db.tombstones.where('_synced').equals(0).toArray();
	if (unsyncedTombstones.length) {
		// Order: sets → workout_exercises → workouts (FK-safe)
		const order = { set: 0, workoutExercise: 1, workout: 2 };
		const sorted = [...unsyncedTombstones].sort((a, b) => order[a.entity] - order[b.entity]);
		for (const t of sorted) {
			const tableMap: Record<string, string> = {
				set: 'sets',
				workoutExercise: 'workout_exercises',
				workout: 'workouts'
			};
			const { error } = await supabase.from(tableMap[t.entity]).delete().eq('id', t.entityId).eq('user_id', userId);
			if (error && error.code !== 'PGRST116') throw error; // ignore "not found"
		}
		// Delete tombstones locally after successful push
		await db.tombstones.bulkDelete(sorted.map((t) => t.id));
	}

	// Bug 20 fix: use Dexie index instead of full table scan (booleans stored as 0/1)
	// Exercises — only custom ones
	const unsyncedExercises = await db.exercises
		.where('_synced').equals(0)
		.filter((e) => e.isCustom === true)
		.toArray();
	if (unsyncedExercises.length) {
		const rows = unsyncedExercises.map((e) => ({
			id: e.id,
			user_id: userId,
			name: e.name,
			type: e.type,
			muscle_group: e.muscleGroup,
			is_custom: e.isCustom,
			notes: e.notes ?? null,
			updated_at: new Date((e as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('exercises').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedExercises.map((e) => db.exercises.update(e.id, { _synced: true } as any)));
	}

	// Workouts
	const unsyncedWorkouts = await db.workouts
		.where('_synced').equals(0)
		.toArray();
	if (unsyncedWorkouts.length) {
		const rows = unsyncedWorkouts.map((w) => ({
			id: w.id,
			user_id: userId,
			date: toSupabaseDate(w.date),
			name: w.name ?? null,
			notes: w.notes ?? null,
			duration_sec: w.durationSec ?? null,
			finished_at: toSupabaseDate(w.finishedAt),
			updated_at: new Date((w as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('workouts').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedWorkouts.map((w) => db.workouts.update(w.id, { _synced: true } as any)));
	}

	// WorkoutExercises
	const unsyncedWEs = await db.workoutExercises
		.where('_synced').equals(0)
		.toArray();
	if (unsyncedWEs.length) {
		const rows = unsyncedWEs.map((we) => ({
			id: we.id,
			user_id: userId,
			workout_id: we.workoutId,
			exercise_id: we.exerciseId,
			order: we.order,
			notes: we.notes ?? null,
			updated_at: new Date((we as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('workout_exercises').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedWEs.map((we) => db.workoutExercises.update(we.id, { _synced: true } as any)));
	}

	// Sets
	const unsyncedSets = await db.sets
		.where('_synced').equals(0)
		.toArray();
	if (unsyncedSets.length) {
		const rows = unsyncedSets.map((s) => ({
			id: s.id,
			user_id: userId,
			workout_exercise_id: s.workoutExerciseId,
			order: s.order,
			weight: s.weight ?? null,
			reps: s.reps ?? null,
			duration_sec: s.durationSec ?? null,
			distance_m: s.distanceM ?? null,
			is_warmup: s.isWarmup,
			completed: s.completed,
			notes: s.notes ?? null,
			updated_at: new Date((s as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('sets').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedSets.map((s) => db.sets.update(s.id, { _synced: true } as any)));
	}

	// Routines
	const unsyncedRoutines = await db.routines
		.where('_synced').equals(0)
		.toArray();
	if (unsyncedRoutines.length) {
		const rows = unsyncedRoutines.map((r) => ({
			id: r.id,
			user_id: userId,
			name: r.name,
			created_at: toSupabaseDate(r.createdAt),
			updated_at: new Date((r as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('routines').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedRoutines.map((r) => db.routines.update(r.id, { _synced: true } as any)));
	}

	// RoutineExercises
	const unsyncedREs = await db.routineExercises
		.where('_synced').equals(0)
		.toArray();
	if (unsyncedREs.length) {
		const rows = unsyncedREs.map((re) => ({
			id: re.id,
			user_id: userId,
			routine_id: re.routineId,
			exercise_id: re.exerciseId,
			order: re.order,
			target_sets: re.targetSets ?? null,
			target_reps: re.targetReps ?? null,
			updated_at: new Date((re as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('routine_exercises').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedREs.map((re) => db.routineExercises.update(re.id, { _synced: true } as any)));
	}

	// PersonalRecords
	const unsyncedPRs = await db.personalRecords
		.where('_synced').equals(0)
		.toArray();
	if (unsyncedPRs.length) {
		const rows = unsyncedPRs.map((pr) => ({
			id: pr.id,
			user_id: userId,
			exercise_id: pr.exerciseId,
			category: pr.category ?? 'strength',
			bucket: pr.bucket ?? null,
			workout_id: pr.workoutId ?? null,
			set_id: pr.setId ?? null,
			date: toSupabaseDate(pr.date),
			weight: pr.weight ?? null,
			reps: pr.reps ?? null,
			duration_sec: pr.durationSec ?? null,
			distance_m: pr.distanceM ?? null,
			updated_at: new Date((pr as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('personal_records').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedPRs.map((pr) => db.personalRecords.update(pr.id, { _synced: true } as any)));
	}
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pullChanges(userId: string) {
	const lastPull = getLastPull();
	const now = new Date().toISOString();

	// Collect tombstoned ids so we skip them during pull (prevents zombie re-downloads)
	const tombstones = await db.tombstones.toArray();
	const tombstonedIds = new Set(tombstones.map((t) => t.entityId));

	// Helper: fetch rows updated since lastPull
	async function fetchSince(table: string) {
		let q = supabase.from(table).select('*').eq('user_id', userId);
		if (lastPull) q = q.gt('updated_at', lastPull);
		const { data, error } = await q;
		if (error) throw error;
		return (data ?? []).filter((r: any) => !tombstonedIds.has(r.id));
	}

	// Custom exercises
	const remoteExercises = await fetchSince('exercises');
	for (const r of remoteExercises) {
		const local = await db.exercises.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.exercises.put({
				id: r.id,
				name: r.name,
				type: r.type,
				muscleGroup: r.muscle_group,
				isCustom: r.is_custom,
				notes: r.notes ?? undefined,
				_synced: true,
				_lastModified: remoteTs
			} as any);
		}
	}

	// Workouts
	const remoteWorkouts = await fetchSince('workouts');
	for (const r of remoteWorkouts) {
		const local = await db.workouts.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.workouts.put({
				id: r.id,
				date: new Date(r.date),
				name: r.name ?? undefined,
				notes: r.notes ?? undefined,
				durationSec: r.duration_sec ?? undefined,
				finishedAt: r.finished_at ? new Date(r.finished_at) : undefined,
				_synced: true,
				_lastModified: remoteTs
			} as any);
		}
	}

	// WorkoutExercises
	const remoteWEs = await fetchSince('workout_exercises');
	for (const r of remoteWEs) {
		const local = await db.workoutExercises.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.workoutExercises.put({
				id: r.id,
				workoutId: r.workout_id,
				exerciseId: r.exercise_id,
				order: r.order,
				notes: r.notes ?? undefined,
				_synced: true,
				_lastModified: remoteTs
			} as any);
		}
	}

	// Sets
	const remoteSets = await fetchSince('sets');
	for (const r of remoteSets) {
		const local = await db.sets.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.sets.put({
				id: r.id,
				workoutExerciseId: r.workout_exercise_id,
				order: r.order,
				weight: r.weight ?? undefined,
				reps: r.reps ?? undefined,
				durationSec: r.duration_sec ?? undefined,
				distanceM: r.distance_m ?? undefined,
				isWarmup: r.is_warmup,
				completed: r.completed,
				notes: r.notes ?? undefined,
				_synced: true,
				_lastModified: remoteTs
			} as any);
		}
	}

	// Routines
	const remoteRoutines = await fetchSince('routines');
	for (const r of remoteRoutines) {
		const local = await db.routines.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.routines.put({
				id: r.id,
				name: r.name,
				createdAt: new Date(r.created_at),
				_synced: true,
				_lastModified: remoteTs
			} as any);
		}
	}

	// RoutineExercises
	const remoteREs = await fetchSince('routine_exercises');
	for (const r of remoteREs) {
		const local = await db.routineExercises.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.routineExercises.put({
				id: r.id,
				routineId: r.routine_id,
				exerciseId: r.exercise_id,
				order: r.order,
				targetSets: r.target_sets ?? undefined,
				targetReps: r.target_reps ?? undefined,
				_synced: true,
				_lastModified: remoteTs
			} as any);
		}
	}

	// PersonalRecords
	const remotePRs = await fetchSince('personal_records');
	for (const r of remotePRs) {
		const local = await db.personalRecords.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.personalRecords.put({
				id: r.id,
				exerciseId: r.exercise_id,
				category: r.category ?? 'strength',
				bucket: r.bucket ?? undefined,
				workoutId: r.workout_id ?? '',
				setId: r.set_id ?? '',
				date: new Date(r.date),
				weight: r.weight ?? undefined,
				reps: r.reps ?? undefined,
				durationSec: r.duration_sec ?? undefined,
				distanceM: r.distance_m ?? undefined,
				_synced: true,
				_lastModified: remoteTs
			} as any);
		}
	}

	setLastPull(now);
}
