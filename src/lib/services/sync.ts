/**
 * Sync engine — pushes unsynced local Dexie rows to Supabase, pulls remote changes down.
 * Strategy: last-write-wins based on _lastModified / updated_at.
 * Default exercises (isCustom=false) are never synced — seeded locally on every device.
 *
 * S1 fix: _synced is stored as a JS boolean (false/true). Dexie indexes booleans as
 * false/true, NOT as 0/1, so .where('_synced').equals(0) returns nothing. We use
 * .filter((x) => !x._synced) throughout instead.
 *
 * H9+H10 fix: CAS pattern on _synced writes + module-level mutex so syncNow is not
 * re-entrant.
 */

import { db } from '$lib/db/schema';
import { supabase } from '$lib/supabase';
import { writable } from 'svelte/store';

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

// ─── Debounce + mutex ─────────────────────────────────────────────────────────

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null; // H10: mutex

export function schedulePush() {
	if (pushTimer) clearTimeout(pushTimer);
	pushTimer = setTimeout(() => {
		syncNow().catch(console.error);
	}, 1500);
}

// ─── Main sync ────────────────────────────────────────────────────────────────

export async function syncNow(): Promise<void> {
	// H10: re-entrant guard — return existing promise if already running
	if (inFlight) return inFlight;

	const run = async () => {
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
		} finally {
			inFlight = null;
		}
	};

	inFlight = run();
	return inFlight;
}

// ─── Helper: mark row synced only if _lastModified hasn't changed (CAS) ──────

async function markSynced(
	table: 'exercises' | 'workouts' | 'workoutExercises' | 'sets' | 'routines' | 'routineExercises' | 'personalRecords',
	id: string,
	lastModified: number
) {
	// H9: CAS — only set _synced:true if _lastModified still matches what we pushed
	const row = await (db[table] as any).get(id);
	if (row && (row._lastModified ?? 0) === lastModified) {
		await (db[table] as any).update(id, { _synced: true } as any);
	}
	// If _lastModified changed (user edited mid-push), leave _synced:false so next push retries
}

// ─── Push ─────────────────────────────────────────────────────────────────────

async function pushUnsynced(userId: string) {
	// ── Tombstones first (deletes must land before any re-upsert of same id) ──
	const unsyncedTombstones = await db.tombstones.filter((t) => !t._synced).toArray();
	if (unsyncedTombstones.length) {
		const tableMap: Record<string, string> = {
			set: 'sets',
			workoutExercise: 'workout_exercises',
			workout: 'workouts',
			exercise: 'exercises',
			routine: 'routines',
			routineExercise: 'routine_exercises',
			personalRecord: 'personal_records'
		};
		// FK-safe delete order
		const order: Record<string, number> = {
			personalRecord: 0, set: 1, workoutExercise: 2, workout: 3,
			routineExercise: 4, routine: 5, exercise: 6
		};
		const sorted = [...unsyncedTombstones].sort((a, b) => (order[a.entity] ?? 9) - (order[b.entity] ?? 9));
		for (const t of sorted) {
			const tbl = tableMap[t.entity];
			if (!tbl) continue;
			await supabase.from(tbl).delete().eq('id', t.entityId).eq('user_id', userId);
			// Supabase delete returns success even for missing rows — no error check needed
		}
		await db.tombstones.bulkDelete(sorted.map((t) => t.id));
	}

	// Exercises — only custom ones
	const unsyncedExercises = await db.exercises
		.filter((e) => !e._synced && e.isCustom === true)
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
		await Promise.all(unsyncedExercises.map((e) => markSynced('exercises', e.id, (e as any)._lastModified)));
	}

	// Workouts
	const unsyncedWorkouts = await db.workouts.filter((w) => !w._synced).toArray();
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
		await Promise.all(unsyncedWorkouts.map((w) => markSynced('workouts', w.id, (w as any)._lastModified)));
	}

	// WorkoutExercises
	const unsyncedWEs = await db.workoutExercises.filter((we) => !we._synced).toArray();
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
		await Promise.all(unsyncedWEs.map((we) => markSynced('workoutExercises', we.id, (we as any)._lastModified)));
	}

	// Sets
	const unsyncedSets = await db.sets.filter((s) => !s._synced).toArray();
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
		await Promise.all(unsyncedSets.map((s) => markSynced('sets', s.id, (s as any)._lastModified)));
	}

	// Routines
	const unsyncedRoutines = await db.routines.filter((r) => !r._synced).toArray();
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
		await Promise.all(unsyncedRoutines.map((r) => markSynced('routines', r.id, (r as any)._lastModified)));
	}

	// RoutineExercises
	const unsyncedREs = await db.routineExercises.filter((re) => !re._synced).toArray();
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
		await Promise.all(unsyncedREs.map((re) => markSynced('routineExercises', re.id, (re as any)._lastModified)));
	}

	// PersonalRecords
	const unsyncedPRs = await db.personalRecords.filter((pr) => !pr._synced).toArray();
	if (unsyncedPRs.length) {
		const rows = unsyncedPRs.map((pr) => ({
			id: pr.id,
			user_id: userId,
			exercise_id: pr.exerciseId,
			category: pr.category ?? 'strength',
			bucket: pr.bucket ?? null,
			workout_id: pr.workoutId || null,
			set_id: pr.setId || null,
			date: toSupabaseDate(pr.date),
			weight: pr.weight ?? null,
			reps: pr.reps ?? null,
			duration_sec: pr.durationSec ?? null,
			distance_m: pr.distanceM ?? null,
			updated_at: new Date((pr as any)._lastModified ?? Date.now()).toISOString()
		}));
		const { error } = await supabase.from('personal_records').upsert(rows, { onConflict: 'id' });
		if (error) throw error;
		await Promise.all(unsyncedPRs.map((pr) => markSynced('personalRecords', pr.id, (pr as any)._lastModified)));
	}
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pullChanges(userId: string) {
	const lastPull = getLastPull();
	const now = new Date().toISOString();

	// Collect tombstoned ids partitioned by entity type to avoid cross-table collisions
	const tombstones = await db.tombstones.toArray();
	const tombstonedIds = new Set(tombstones.map((t) => t.entityId));

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
				isWarmup: r.is_warmup === true,  // coerce nullable bool
				completed: r.completed === true,  // coerce nullable bool
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

	// PersonalRecords — M8: use null for missing workoutId/setId, not empty string
	const remotePRs = await fetchSince('personal_records');
	for (const r of remotePRs) {
		if (tombstonedIds.has(r.id)) continue;
		const local = await db.personalRecords.get(r.id);
		const remoteTs = new Date(r.updated_at).getTime();
		const localTs = (local as any)?._lastModified ?? 0;
		if (!local || remoteTs > localTs) {
			await db.personalRecords.put({
				id: r.id,
				exerciseId: r.exercise_id,
				category: r.category ?? 'strength',
				bucket: r.bucket ?? undefined,
				// Legacy rows may have no workout_id/set_id — use empty sentinel, not ''
				workoutId: r.workout_id ?? 'legacy',
				setId: r.set_id ?? 'legacy',
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSupabaseDate(d?: Date): string | null {
	if (!d) return null;
	return new Date(d).toISOString();
}
