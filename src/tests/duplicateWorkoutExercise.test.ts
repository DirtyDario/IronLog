import { describe, it, expect } from 'vitest';
import { db } from '$lib/db/schema';
import { getLastFinishedSetsFor } from '$lib/services/lastWorkout';

describe('duplicate workoutExercise per session regression', () => {
	it('getLastFinishedSetsFor finds data even when the FIRST workoutExercise row for that session is empty', async () => {
		const exId = crypto.randomUUID();
		await db.exercises.add({ id: exId, name: 'Incline DB Press', type: 'weightReps', muscleGroup: 'chest', isCustom: true });

		const w1 = { id: crypto.randomUUID(), date: new Date(Date.now() - 100000), finishedAt: new Date(Date.now() - 90000) };
		await db.workouts.add(w1 as any);

		// First workoutExercise row: added then removed/abandoned, no sets
		const weEmpty = { id: crypto.randomUUID(), workoutId: w1.id, exerciseId: exId, order: 0 };
		await db.workoutExercises.add(weEmpty as any);

		// Second workoutExercise row for the SAME exercise, SAME workout: has the real data
		const weReal = { id: crypto.randomUUID(), workoutId: w1.id, exerciseId: exId, order: 1 };
		await db.workoutExercises.add(weReal as any);
		await db.sets.add({ id: crypto.randomUUID(), workoutExerciseId: weReal.id, order: 0, weight: 20, reps: 10, isWarmup: false, completed: true } as any);

		const info = await getLastFinishedSetsFor(exId);
		expect(info).not.toBeNull();
		expect(info!.sets.length).toBe(1);
		expect(info!.sets[0].weight).toBe(20);
	});

	it('falls back to an older workout if the most recent one has no completed sets for this exercise', async () => {
		const exId = crypto.randomUUID();
		await db.exercises.add({ id: exId, name: 'Squat', type: 'weightReps', muscleGroup: 'legs', isCustom: true });

		const wOld = { id: crypto.randomUUID(), date: new Date(Date.now() - 200000), finishedAt: new Date(Date.now() - 190000) };
		await db.workouts.add(wOld as any);
		const weOld = { id: crypto.randomUUID(), workoutId: wOld.id, exerciseId: exId, order: 0 };
		await db.workoutExercises.add(weOld as any);
		await db.sets.add({ id: crypto.randomUUID(), workoutExerciseId: weOld.id, order: 0, weight: 100, reps: 5, isWarmup: false, completed: true } as any);

		// Most recent workout: exercise added but abandoned, no completed sets
		const wNew = { id: crypto.randomUUID(), date: new Date(Date.now() - 100000), finishedAt: new Date(Date.now() - 90000) };
		await db.workouts.add(wNew as any);
		const weNew = { id: crypto.randomUUID(), workoutId: wNew.id, exerciseId: exId, order: 0 };
		await db.workoutExercises.add(weNew as any);
		// no sets added for weNew

		const info = await getLastFinishedSetsFor(exId);
		expect(info).not.toBeNull();
		expect(info!.sets.length).toBe(1);
		expect(info!.sets[0].weight).toBe(100);
	});
});
