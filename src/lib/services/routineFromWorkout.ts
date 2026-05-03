import { db } from '$lib/db/schema';
import type { Routine, RoutineExercise } from '$lib/db/schema';

function syncMeta() {
    return { _synced: false as const, _lastModified: Date.now() };
}

/**
 * Creates a new Routine from a finished workout.
 * Sets targetSets = number of completed sets per exercise,
 * targetReps = average reps of completed sets (for weightReps/bodyweightReps).
 */
export async function saveWorkoutAsRoutine(workoutId: string, routineName: string): Promise<string> {
    const routine: Routine = {
        id: crypto.randomUUID(),
        name: routineName,
        createdAt: new Date(),
        ...syncMeta()
    };
    await db.routines.add(routine);

    const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order');
    
    for (let i = 0; i < wes.length; i++) {
        const we = wes[i];
        const sets = await db.sets.where('workoutExerciseId').equals(we.id).toArray();
        const completedSets = sets.filter((s) => s.completed);
        if (completedSets.length === 0) continue;

        const avgReps = completedSets.some((s) => s.reps != null)
            ? Math.round(completedSets.reduce((sum, s) => sum + (s.reps ?? 0), 0) / completedSets.filter((s) => s.reps != null).length)
            : undefined;

        const re: RoutineExercise = {
            id: crypto.randomUUID(),
            routineId: routine.id,
            exerciseId: we.exerciseId,
            order: i,
            targetSets: completedSets.length,
            targetReps: avgReps,
            ...syncMeta()
        };
        await db.routineExercises.add(re);
    }

    return routine.id;
}
