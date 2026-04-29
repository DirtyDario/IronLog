import { writable, get } from 'svelte/store';
import { db } from '$lib/db/schema';
import type { Workout, WorkoutExercise, ExerciseSet } from '$lib/db/schema';
import { schedulePush } from '$lib/services/sync';
import { getLastFinishedSetsFor, type LastWorkoutInfo } from '$lib/services/lastWorkout';
import { restTimer } from '$lib/stores/restTimer';
import { detectPRsForWorkout } from '$lib/services/pr';

interface ActiveWorkoutState {
	workout: Workout | null;
	workoutExercises: WorkoutExercise[];
	sets: Record<string, ExerciseSet[]>; // keyed by workoutExerciseId
	startedAt: Date | null;
	previousSets: Record<string, LastWorkoutInfo | null>; // keyed by workoutExerciseId
	lastDiscarded: {
		workout: Workout;
		workoutExercises: WorkoutExercise[];
		sets: Record<string, ExerciseSet[]>;
		previousSets: Record<string, LastWorkoutInfo | null>;
		startedAt: Date | null;
	} | null;
	rehydrating: boolean; // H12: true while async rehydrate() is in progress
}

function syncMeta() {
	return { _synced: false as const, _lastModified: Date.now() };
}

async function writeTombstone(entity: 'workout' | 'workoutExercise' | 'set', entityId: string) {
	await db.tombstones.put({
		id: entityId,
		entity,
		entityId,
		deletedAt: new Date(),
		_synced: false
	});
}

function createActiveWorkoutStore() {
	const { subscribe, set, update } = writable<ActiveWorkoutState>({
		workout: null,
		workoutExercises: [],
		sets: {},
		startedAt: null,
		previousSets: {},
		lastDiscarded: null,
		rehydrating: false
	});

	return {
		subscribe,

		async rehydrate() {
			// H12: On app load (e.g. after page refresh), restore an in-progress workout
			// from IDB if the store is empty. Looks for the most recent unfinished workout.
			update((s) => ({ ...s, rehydrating: true }));
			try {
				const unfinished = await db.workouts
					.filter((w) => !w.finishedAt)
					.toArray();
				if (!unfinished.length) return;
				// Use most recently started (latest date)
				const workout = unfinished.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
				const workoutExercises = await db.workoutExercises.where('workoutId').equals(workout.id).sortBy('order');
				const sets: Record<string, ExerciseSet[]> = {};
				const previousSets: Record<string, LastWorkoutInfo | null> = {};
				for (const we of workoutExercises) {
					sets[we.id] = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order');
					previousSets[we.id] = await getLastFinishedSetsFor(we.exerciseId);
				}
				set({
					workout,
					workoutExercises,
					sets,
					startedAt: new Date(workout.date),
					previousSets,
					lastDiscarded: null,
					rehydrating: false
				});
			} finally {
				update((s) => ({ ...s, rehydrating: false }));
			}
		},

		async start(name?: string) {
			// Reset rest timer defensively
			restTimer.stop();
			const workout: Workout = {
				id: crypto.randomUUID(),
				date: new Date(),
				name,
				...syncMeta()
			};
			await db.workouts.add(workout);
			schedulePush();
			set({
				workout,
				workoutExercises: [],
				sets: {},
				startedAt: new Date(),
				previousSets: {},
				lastDiscarded: null,
				rehydrating: false
			});
			return workout;
		},

		async addExercise(exerciseId: string) {
			const state = get({ subscribe });
			if (!state.workout) return;
			const we: WorkoutExercise = {
				id: crypto.randomUUID(),
				workoutId: state.workout.id,
				exerciseId,
				order: state.workoutExercises.length,
				...syncMeta()
			};
			await db.workoutExercises.add(we);
			schedulePush();

			// Fetch last workout's sets for this exercise (for placeholder + header)
			const lastInfo = await getLastFinishedSetsFor(exerciseId);

			update((s) => ({
				...s,
				workoutExercises: [...s.workoutExercises, we],
				sets: { ...s.sets, [we.id]: [] },
				previousSets: { ...s.previousSets, [we.id]: lastInfo }
			}));
			return we;
		},

		async addSet(workoutExerciseId: string) {
			const state = get({ subscribe });
			const existing = state.sets[workoutExerciseId] ?? [];
			// Do NOT pre-populate weight/reps — show as placeholder only
			const newSet: ExerciseSet = {
				id: crypto.randomUUID(),
				workoutExerciseId,
				order: existing.length,
				weight: undefined,
				reps: undefined,
				durationSec: undefined,
				distanceM: undefined,
				isWarmup: false,
				completed: false,
				...syncMeta()
			};
			await db.sets.add(newSet);
			schedulePush();
			update((s) => ({
				...s,
				sets: {
					...s.sets,
					[workoutExerciseId]: [...(s.sets[workoutExerciseId] ?? []), newSet]
				}
			}));
			return newSet;
		},

		async updateSet(setId: string, workoutExerciseId: string, changes: Partial<ExerciseSet>) {
			const meta = syncMeta();
			await db.sets.update(setId, { ...changes, ...meta });
			schedulePush();
			update((s) => ({
				...s,
				sets: {
					...s.sets,
					[workoutExerciseId]: s.sets[workoutExerciseId].map((st) =>
						st.id === setId ? { ...st, ...changes, ...meta } : st
					)
				}
			}));
		},

		async deleteSet(setId: string, workoutExerciseId: string) {
			await writeTombstone('set', setId); // H5: tombstone so remote copy is deleted
			await db.sets.delete(setId);
			schedulePush();
			update((s) => ({
				...s,
				sets: {
					...s.sets,
					[workoutExerciseId]: s.sets[workoutExerciseId].filter((st) => st.id !== setId)
				}
			}));
		},

		async deleteExercise(workoutExerciseId: string) {
			// H6: tombstone all sets and the workoutExercise before hard-deleting
			const setsToDelete = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray();
			await Promise.all(setsToDelete.map((s) => writeTombstone('set', s.id)));
			await writeTombstone('workoutExercise', workoutExerciseId);
			await db.sets.where('workoutExerciseId').equals(workoutExerciseId).delete();
			await db.workoutExercises.delete(workoutExerciseId);
			schedulePush();
			update((s) => {
				const sets = { ...s.sets };
				const previousSets = { ...s.previousSets };
				delete sets[workoutExerciseId];
				delete previousSets[workoutExerciseId];
				return {
					...s,
					workoutExercises: s.workoutExercises.filter((we) => we.id !== workoutExerciseId),
					sets,
					previousSets
				};
			});
		},

		async finish(resolvedSets?: Array<{ id: string; weight?: number; reps?: number; durationSec?: number; distanceM?: number }>) {
			const state = get({ subscribe });
			if (!state.workout || !state.startedAt) return [];

			// Apply pre-resolved set values from the page (which knows placeholder values)
			// then mark completed. Only sets included in resolvedSets (reps/value present) are completed.
			if (resolvedSets && resolvedSets.length > 0) {
				await Promise.all(
					resolvedSets.map((r) =>
						db.sets.update(r.id, {
							...(r.weight != null ? { weight: r.weight } : {}),
							...(r.reps != null ? { reps: r.reps } : {}),
							...(r.durationSec != null ? { durationSec: r.durationSec } : {}),
							...(r.distanceM != null ? { distanceM: r.distanceM } : {}),
							completed: true,
							...syncMeta()
						})
					)
				);
			}

			const workoutId = state.workout.id;
			const durationSec = Math.round((Date.now() - state.startedAt.getTime()) / 1000);
			await db.workouts.update(workoutId, { finishedAt: new Date(), durationSec, ...syncMeta() });
			schedulePush();

			// S9: Detect PRs BEFORE clearing store (detectPRsForWorkout queries DB by workoutId,
			// but store clear is synchronous — workout data is still in IDB at this point,
			// so order doesn't strictly matter for DB queries, but clearing store first
			// caused a race where navigation happened before PRs were saved).
			const newPRs = await detectPRsForWorkout(workoutId);

			// Reset rest timer
			restTimer.stop();

			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, previousSets: {}, lastDiscarded: null, rehydrating: false });

			return newPRs;
		},

		async renameWorkout(name: string) {
			const state = get({ subscribe });
			if (!state.workout) return;
			await db.workouts.update(state.workout.id, { name, ...syncMeta() });
			schedulePush();
			update((s) => s.workout ? { ...s, workout: { ...s.workout, name } } : s);
		},

		async reorderExercises(newList: WorkoutExercise[]) {
			const updated = newList.map((we, i) => ({ ...we, order: i }));
			await Promise.all(
				updated.map((we) =>
					db.workoutExercises.update(we.id, { order: we.order, _synced: false, _lastModified: Date.now() })
				)
			);
			schedulePush();
			update((s) => ({ ...s, workoutExercises: updated }));
		},

		async discard() {
			const state = get({ subscribe });
			if (!state.workout) return;

			// Snapshot for undo BEFORE clearing state
			// M8: use structuredClone to deep-clone so Svelte proxy objects don't leak into Dexie
			const snapshot = structuredClone({
				workout: state.workout,
				workoutExercises: [...state.workoutExercises],
				sets: { ...state.sets },
				previousSets: { ...state.previousSets },
				startedAt: state.startedAt
			});

			// Clear UI immediately (feels instant)
			restTimer.stop();
			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, previousSets: {}, lastDiscarded: snapshot });

			// Write tombstones + delete from Dexie
			const weIds = snapshot.workoutExercises.map((we) => we.id);
			const setIds = Object.values(snapshot.sets).flat().map((s) => s.id);

			// Tombstones (FK order: sets → workoutExercises → workouts)
			await Promise.all(setIds.map((id) => writeTombstone('set', id)));
			await Promise.all(weIds.map((id) => writeTombstone('workoutExercise', id)));
			await writeTombstone('workout', snapshot.workout.id);

			// Hard-delete from Dexie
			for (const weId of weIds) {
				await db.sets.where('workoutExerciseId').equals(weId).delete();
			}
			await db.workoutExercises.where('workoutId').equals(snapshot.workout.id).delete();
			await db.workouts.delete(snapshot.workout.id);

			// C4: Do NOT call schedulePush immediately — wait until the undo window closes.
			// If sync runs before the user can tap Undo, tombstones are pushed to Supabase
			// and restoreDiscarded can't fully recover. Delay push until after 5s undo window.
			// Auto-clear undo after 5 seconds, THEN schedule push
			setTimeout(() => {
				update((s) => {
					if (s.lastDiscarded?.workout.id === snapshot.workout.id) {
						schedulePush(); // user didn't undo — safe to push deletes now
						return { ...s, lastDiscarded: null };
					}
					return s;
				});
			}, 5000);
		},

		async restoreDiscarded() {
			const state = get({ subscribe });
			const snap = state.lastDiscarded;
			if (!snap) return;

			// H13: Remove tombstones BEFORE re-inserting — otherwise sync might push the delete
			const weIds = snap.workoutExercises.map((we) => we.id);
			const setIds = Object.values(snap.sets).flat().map((s) => s.id);
			await db.tombstones.bulkDelete([snap.workout.id, ...weIds, ...setIds]);

			// H14: Mark everything as _synced: false so it gets pushed again
			const meta = syncMeta();
			await db.workouts.put({ ...snap.workout, ...meta });
			await db.workoutExercises.bulkPut(snap.workoutExercises.map((we) => ({ ...we, ...meta })));
			await db.sets.bulkPut(Object.values(snap.sets).flat().map((s) => ({ ...s, ...meta })));
			schedulePush();

			// Restore state
			set({
				workout: snap.workout,
				workoutExercises: snap.workoutExercises,
				sets: snap.sets,
				startedAt: snap.startedAt,
				previousSets: snap.previousSets,
				lastDiscarded: null
			});
		}
	};
}

export const activeWorkout = createActiveWorkoutStore();
