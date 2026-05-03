import { describe, it, expect, beforeEach } from 'vitest';
import { IronLogDB } from '../lib/db/schema';

describe('Schema v5 - New Fields', () => {
    let db: IronLogDB;

    beforeEach(async () => {
        // Use a unique DB name per test to avoid conflicts
        db = new IronLogDB();
        await db.open();
    });

    it('Exercise has isUnilateral field', async () => {
        const id = crypto.randomUUID();
        await db.exercises.add({
            id,
            name: 'Test Exercise',
            type: 'weightReps',
            muscleGroup: 'chest',
            isCustom: true,
            isUnilateral: true,
        });
        const ex = await db.exercises.get(id);
        expect(ex?.isUnilateral).toBe(true);
    });

    it('ExerciseSet has side field', async () => {
        const workoutId = crypto.randomUUID();
        const weId = crypto.randomUUID();
        const setId = crypto.randomUUID();

        await db.workouts.add({ id: workoutId, date: new Date() });
        await db.workoutExercises.add({ id: weId, workoutId, exerciseId: crypto.randomUUID(), order: 0 });
        await db.sets.add({
            id: setId,
            workoutExerciseId: weId,
            order: 0,
            isWarmup: false,
            completed: false,
            side: 'left',
        });

        const set = await db.sets.get(setId);
        expect(set?.side).toBe('left');
    });

    it('Workout has lastActivityAt field', async () => {
        const id = crypto.randomUUID();
        const now = Date.now();
        await db.workouts.add({ id, date: new Date(), lastActivityAt: now });
        const w = await db.workouts.get(id);
        expect(w?.lastActivityAt).toBe(now);
    });

    it('WorkoutExercise has notes field', async () => {
        const workoutId = crypto.randomUUID();
        const weId = crypto.randomUUID();
        await db.workouts.add({ id: workoutId, date: new Date() });
        await db.workoutExercises.add({
            id: weId,
            workoutId,
            exerciseId: crypto.randomUUID(),
            order: 0,
            notes: 'Test note',
        });
        const we = await db.workoutExercises.get(weId);
        expect(we?.notes).toBe('Test note');
    });
});
