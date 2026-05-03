import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/db/schema';

describe('Unilateral Exercises (L/R)', () => {
    beforeEach(async () => {
        await db.sets.clear();
        await db.workoutExercises.clear();
        await db.workouts.clear();
        await db.exercises.clear();
    });

    it('can create sets with left and right sides', async () => {
        const workoutId = crypto.randomUUID();
        const weId = crypto.randomUUID();
        await db.workouts.add({ id: workoutId, date: new Date() });
        await db.workoutExercises.add({ id: weId, workoutId, exerciseId: crypto.randomUUID(), order: 0 });

        const leftId = crypto.randomUUID();
        const rightId = crypto.randomUUID();

        await db.sets.add({ id: leftId, workoutExerciseId: weId, order: 0, weight: 20, reps: 10, isWarmup: false, completed: true, side: 'left' });
        await db.sets.add({ id: rightId, workoutExerciseId: weId, order: 1, weight: 20, reps: 10, isWarmup: false, completed: true, side: 'right' });

        const allSets = await db.sets.where('workoutExerciseId').equals(weId).toArray();
        expect(allSets).toHaveLength(2);

        const leftSets = allSets.filter((s) => s.side === 'left');
        const rightSets = allSets.filter((s) => s.side === 'right');

        expect(leftSets).toHaveLength(1);
        expect(rightSets).toHaveLength(1);
    });

    it('exercise can be marked as unilateral', async () => {
        const id = crypto.randomUUID();
        await db.exercises.add({
            id,
            name: 'Single Arm Row',
            type: 'weightReps',
            muscleGroup: 'back',
            isCustom: true,
            isUnilateral: true,
        });

        const ex = await db.exercises.get(id);
        expect(ex?.isUnilateral).toBe(true);
    });

    it('sets without side are treated as left (default)', async () => {
        const workoutId = crypto.randomUUID();
        const weId = crypto.randomUUID();
        await db.workouts.add({ id: workoutId, date: new Date() });
        await db.workoutExercises.add({ id: weId, workoutId, exerciseId: crypto.randomUUID(), order: 0 });

        await db.sets.add({ id: crypto.randomUUID(), workoutExerciseId: weId, order: 0, isWarmup: false, completed: false });

        const sets = await db.sets.where('workoutExerciseId').equals(weId).toArray();
        expect(sets[0].side).toBeUndefined();
        const effectiveSide = sets[0].side ?? 'left';
        expect(effectiveSide).toBe('left');
    });
});
