import { db } from '$lib/db/schema';
import type { ExerciseSet } from '$lib/db/schema';

export interface LastWorkoutInfo {
	sets: ExerciseSet[];
	date: Date;
	workoutName?: string;
}

/**
 * Returns the sets (ordered by `order`) from the most recent *finished* workout
 * that included the given exercise. Returns null if no previous workout found.
 */
export async function getLastFinishedSetsFor(exerciseId: string): Promise<LastWorkoutInfo | null> {
	// Find all workoutExercises for this exercise
	const wes = await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray();
	if (!wes.length) return null;

	// Get all workouts that contain these workoutExercises, must be finished
	const workoutIds = [...new Set(wes.map((we) => we.workoutId))];
	const workouts = await db.workouts
		.where('id')
		.anyOf(workoutIds)
		.filter((w) => !!w.finishedAt)
		.toArray();

	if (!workouts.length) return null;

	// Walk workouts newest → oldest and use the first one that actually has
	// completed set data for this exercise. Bug fix: previously we only ever
	// looked at the single most-recent workout containing this exercise — if
	// that particular session had the exercise added but no completed sets
	// (e.g. added then abandoned, or a duplicate empty row from removing and
	// re-adding it), the placeholder/"last time" data silently disappeared
	// even though a real, fully-logged session existed a bit further back.
	// This is also why the Stats → Progress chart looked "empty" for some
	// exercises but not others — same underlying data-selection bug.
	workouts.sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime());

	for (const workout of workouts) {
		// Find ALL workoutExercise rows for this exercise in that workout — a
		// second related bug: previously used `wes.find(...)` which only grabbed
		// the FIRST match. If the same exercise was added more than once in a
		// single workout (e.g. removed and re-added), the first row could be an
		// empty leftover with no completed sets while a sibling row had the
		// real data.
		const wesInWorkout = wes.filter((w) => w.workoutId === workout.id);
		if (!wesInWorkout.length) continue;

		const setsByWe = await Promise.all(
			wesInWorkout.map((we) => db.sets.where('workoutExerciseId').equals(we.id).sortBy('order'))
		);
		const sets = setsByWe.flat().filter((s) => s.completed);

		if (sets.length) {
			return { sets, date: new Date(workout.finishedAt!), workoutName: workout.name };
		}
	}

	return null;
}

/**
 * Human-readable "X days ago" label
 */
export function daysAgoLabel(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	if (diffDays === 0) return 'today';
	if (diffDays === 1) return 'yesterday';
	if (diffDays < 7) return `${diffDays} days ago`;
	const weeks = Math.floor(diffDays / 7);
	return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
}
