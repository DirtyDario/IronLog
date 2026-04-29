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
		lastDiscarded: null
	});

	return {
		subscribe,

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
				lastDiscarded: null
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

			// Reset rest timer
			restTimer.stop();

			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, previousSets: {}, lastDiscarded: null });

			// Detect and save PRs now that the workout is fully persisted
			const newPRs = await detectPRsForWorkout(workoutId);
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
			const snapshot = {
				workout: state.workout,
				workoutExercises: [...state.workoutExercises],
				sets: { ...state.sets },
				previousSets: { ...state.previousSets },
				startedAt: state.startedAt
			};

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

			schedulePush();

			// Auto-clear undo after 5 seconds
			setTimeout(() => {
				update((s) => {
					if (s.lastDiscarded?.workout.id === snapshot.workout.id) {
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

			// Remove tombstones for this workout
			const weIds = snap.workoutExercises.map((we) => we.id);
			const setIds = Object.values(snap.sets).flat().map((s) => s.id);
			await db.tombstones.bulkDelete([snap.workout.id, ...weIds, ...setIds]);

			// Re-insert everything
			await db.workouts.put(snap.workout);
			await db.workoutExercises.bulkPut(snap.workoutExercises);
			await db.sets.bulkPut(Object.values(snap.sets).flat());
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
