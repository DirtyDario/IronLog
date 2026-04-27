import { writable, get } from 'svelte/store';
import { db } from '$lib/db/schema';
import type { Workout, WorkoutExercise, ExerciseSet } from '$lib/db/schema';

interface ActiveWorkoutState {
	workout: Workout | null;
	workoutExercises: WorkoutExercise[];
	sets: Record<string, ExerciseSet[]>; // keyed by workoutExerciseId
	startedAt: Date | null;
	prAlerts: string[]; // exercise names that got a new PR this session
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
				name
			};
			await db.workouts.add(workout);
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
				order: state.workoutExercises.length
			};
			await db.workoutExercises.add(we);
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
				completed: false
			};
			await db.sets.add(newSet);
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
			await db.sets.update(setId, changes);
			update((s) => ({
				...s,
				sets: {
					...s.sets,
					[workoutExerciseId]: s.sets[workoutExerciseId].map((st) =>
						st.id === setId ? { ...st, ...changes } : st
					)
				}
			}));
		},

		async deleteSet(setId: string, workoutExerciseId: string) {
			await db.sets.delete(setId);
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
			await db.workouts.update(state.workout.id, { finishedAt: new Date(), durationSec });
			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, prAlerts: [] });
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
