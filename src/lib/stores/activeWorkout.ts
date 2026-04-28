import { writable, get } from 'svelte/store';
import { db } from '$lib/db/schema';
import type { Workout, WorkoutExercise, ExerciseSet } from '$lib/db/schema';
import { schedulePush } from '$lib/services/sync';

interface ActiveWorkoutState {
	workout: Workout | null;
	workoutExercises: WorkoutExercise[];
	sets: Record<string, ExerciseSet[]>; // keyed by workoutExerciseId
	startedAt: Date | null;
	prAlerts: string[]; // exercise names that got a new PR this session
}

function syncMeta() {
	return { _synced: false, _lastModified: Date.now() };
}

function createActiveWorkoutStore() {
	const { subscribe, set, update } = writable<ActiveWorkoutState>({
		workout: null,
		workoutExercises: [],
		sets: {},
		startedAt: null,
		prAlerts: []
	});

	return {
		subscribe,

		async start(name?: string) {
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
				prAlerts: []
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
			update((s) => ({
				...s,
				workoutExercises: [...s.workoutExercises, we],
				sets: { ...s.sets, [we.id]: [] }
			}));
			return we;
		},

		async addSet(workoutExerciseId: string) {
			const state = get({ subscribe });
			const existing = state.sets[workoutExerciseId] ?? [];
			const last = existing[existing.length - 1];
			const newSet: ExerciseSet = {
				id: crypto.randomUUID(),
				workoutExerciseId,
				order: existing.length,
				weight: last?.weight,
				reps: last?.reps,
				durationSec: last?.durationSec,
				distanceM: last?.distanceM,
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

		addPrAlert(exerciseName: string) {
			update((s) => ({ ...s, prAlerts: [...s.prAlerts, exerciseName] }));
		},

		clearPrAlerts() {
			update((s) => ({ ...s, prAlerts: [] }));
		},

		async finish() {
			const state = get({ subscribe });
			if (!state.workout || !state.startedAt) return;
			const durationSec = Math.round((Date.now() - state.startedAt.getTime()) / 1000);
			await db.workouts.update(state.workout.id, { finishedAt: new Date(), durationSec, ...syncMeta() });
			schedulePush();
			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, prAlerts: [] });
		},

		async deleteExercise(workoutExerciseId: string) {
			await db.sets.where('workoutExerciseId').equals(workoutExerciseId).delete();
			await db.workoutExercises.delete(workoutExerciseId);
			schedulePush();
			update((s) => {
				const sets = { ...s.sets };
				delete sets[workoutExerciseId];
				return {
					...s,
					workoutExercises: s.workoutExercises.filter((we) => we.id !== workoutExerciseId),
					sets
				};
			});
		},

		async reorderExercises(newList: WorkoutExercise[]) {
			// Update order values and persist
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
			// Delete all sets and workout exercises, then the workout
			for (const weId of Object.keys(state.sets)) {
				await db.sets.where('workoutExerciseId').equals(weId).delete();
			}
			await db.workoutExercises.where('workoutId').equals(state.workout.id).delete();
			await db.workouts.delete(state.workout.id);
			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, prAlerts: [] });
		}
	};
}

export const activeWorkout = createActiveWorkoutStore();
