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

	// Most recent finished workout
	const latest = workouts.sort(
		(a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime()
	)[0];

	// Find the workoutExercise in that workout
	const we = wes.find((w) => w.workoutId === latest.id);
	if (!we) return null;

	// Get its sets
	const sets = await db.sets
		.where('workoutExerciseId')
		.equals(we.id)
		.sortBy('order');

	return { sets, date: new Date(latest.finishedAt!), workoutName: latest.name };
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
