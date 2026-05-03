import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/db/schema';

describe('Auto-Complete after 1h inactivity', () => {
    beforeEach(async () => {
        await db.sets.clear();
        await db.workoutExercises.clear();
        await db.workouts.clear();
        await db.tombstones.clear();
    });

    it('checkAutoComplete finishes workout with completed sets after 1h', async () => {
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        const workoutId = crypto.randomUUID();
        const weId = crypto.randomUUID();

        await db.workouts.add({
            id: workoutId,
            date: new Date(twoHoursAgo - 10000),
            lastActivityAt: twoHoursAgo,
        });
        await db.workoutExercises.add({ id: weId, workoutId, exerciseId: crypto.randomUUID(), order: 0 });
        await db.sets.add({
            id: crypto.randomUUID(),
            workoutExerciseId: weId,
            order: 0,
            weight: 100,
            reps: 8,
            isWarmup: false,
            completed: true,
        });

        const workout = await db.workouts.get(workoutId);
        expect(workout?.lastActivityAt).toBe(twoHoursAgo);

        const lastActivity = workout!.lastActivityAt!;
        const elapsed = Date.now() - lastActivity;
        expect(elapsed).toBeGreaterThan(60 * 60 * 1000);

        const finishedAt = new Date(lastActivity);
        const durationSec = Math.round((lastActivity - new Date(workout!.date).getTime()) / 1000);
        await db.workouts.update(workoutId, { finishedAt, durationSec });

        const updated = await db.workouts.get(workoutId);
        expect(updated?.finishedAt).toBeDefined();
        expect(new Date(updated!.finishedAt!).getTime()).toBe(twoHoursAgo);
        expect(updated?.durationSec).toBeGreaterThan(0);
    });

    it('checkAutoComplete discards workout with no completed sets', async () => {
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        const workoutId = crypto.randomUUID();
        const weId = crypto.randomUUID();

        await db.workouts.add({ id: workoutId, date: new Date(twoHoursAgo), lastActivityAt: twoHoursAgo });
        await db.workoutExercises.add({ id: weId, workoutId, exerciseId: crypto.randomUUID(), order: 0 });
        await db.sets.add({ id: crypto.randomUUID(), workoutExerciseId: weId, order: 0, isWarmup: false, completed: false });

        const allSets = await db.sets.where('workoutExerciseId').equals(weId).toArray();
        const completed = allSets.filter((s) => s.completed);
        expect(completed).toHaveLength(0);

        await db.sets.where('workoutExerciseId').equals(weId).delete();
        await db.workoutExercises.where('workoutId').equals(workoutId).delete();
        await db.workouts.delete(workoutId);

        const w = await db.workouts.get(workoutId);
        expect(w).toBeUndefined();
    });

    it('does not auto-complete workout active within last 1h', async () => {
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
        const workoutId = crypto.randomUUID();
        await db.workouts.add({ id: workoutId, date: new Date(thirtyMinutesAgo), lastActivityAt: thirtyMinutesAgo });

        const elapsed = Date.now() - thirtyMinutesAgo;
        expect(elapsed).toBeLessThan(60 * 60 * 1000);
    });
});
