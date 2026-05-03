import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/db/schema';
import { saveWorkoutAsRoutine } from '../lib/services/routineFromWorkout';

describe('saveWorkoutAsRoutine', () => {
    beforeEach(async () => {
        await db.sets.clear();
        await db.workoutExercises.clear();
        await db.workouts.clear();
        await db.routineExercises.clear();
        await db.routines.clear();
        await db.exercises.clear();
    });

    it('creates a routine with correct exercises from workout', async () => {
        const exerciseId = crypto.randomUUID();
        await db.exercises.add({ id: exerciseId, name: 'Bench Press', type: 'weightReps', muscleGroup: 'chest', isCustom: false });

        const workoutId = crypto.randomUUID();
        await db.workouts.add({ id: workoutId, date: new Date(), name: 'Test Workout', finishedAt: new Date() });

        const weId = crypto.randomUUID();
        await db.workoutExercises.add({ id: weId, workoutId, exerciseId, order: 0 });

        for (let i = 0; i < 3; i++) {
            await db.sets.add({
                id: crypto.randomUUID(),
                workoutExerciseId: weId,
                order: i,
                weight: 100,
                reps: 8,
                isWarmup: false,
                completed: true,
            });
        }

        const routineId = await saveWorkoutAsRoutine(workoutId, 'My Routine');
        expect(routineId).toBeTruthy();

        const routine = await db.routines.get(routineId);
        expect(routine?.name).toBe('My Routine');

        const routineExercises = await db.routineExercises.where('routineId').equals(routineId).toArray();
        expect(routineExercises).toHaveLength(1);
        expect(routineExercises[0].exerciseId).toBe(exerciseId);
        expect(routineExercises[0].targetSets).toBe(3);
        expect(routineExercises[0].targetReps).toBe(8);
    });

    it('includes exercises with only uncompleted sets (fallback)', async () => {
        const exerciseId = crypto.randomUUID();
        await db.exercises.add({ id: exerciseId, name: 'Squat', type: 'weightReps', muscleGroup: 'legs', isCustom: false });

        const workoutId = crypto.randomUUID();
        await db.workouts.add({ id: workoutId, date: new Date(), finishedAt: new Date() });

        const weId = crypto.randomUUID();
        await db.workoutExercises.add({ id: weId, workoutId, exerciseId, order: 0 });

        await db.sets.add({ id: crypto.randomUUID(), workoutExerciseId: weId, order: 0, isWarmup: false, completed: false });

        const routineId = await saveWorkoutAsRoutine(workoutId, 'Fallback Routine');
        const routineExercises = await db.routineExercises.where('routineId').equals(routineId).toArray();
        // Falls back to all sets when no completed sets exist
        expect(routineExercises).toHaveLength(1);
        expect(routineExercises[0].targetSets).toBe(1);
    });

    it('returns routine id as string', async () => {
        const workoutId = crypto.randomUUID();
        await db.workouts.add({ id: workoutId, date: new Date(), finishedAt: new Date() });

        const routineId = await saveWorkoutAsRoutine(workoutId, 'Test');
        expect(typeof routineId).toBe('string');
        expect(routineId.length).toBeGreaterThan(0);
    });
});
