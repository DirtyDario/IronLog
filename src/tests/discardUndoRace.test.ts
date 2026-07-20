import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '$lib/db/schema';
import { activeWorkout } from '$lib/stores/activeWorkout';
import { get } from 'svelte/store';

vi.mock('$lib/services/sync', () => ({
	schedulePush: vi.fn()
}));

beforeEach(async () => {
	await db.workouts.clear();
	await db.workoutExercises.clear();
	await db.sets.clear();
	await db.tombstones.clear();
});

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('discard/undo race', () => {
	it('does not tombstone or delete anything from Dexie until the undo window actually closes', async () => {
		const workout = await activeWorkout.start('Test Workout');
		const we = await activeWorkout.addExercise('bench-press');
		if (!we) throw new Error('addExercise failed');
		await activeWorkout.addSet(we.id);

		await activeWorkout.discard();

		// Bug fix: previously discard() wrote tombstones and hard-deleted from
		// Dexie synchronously, so an unrelated schedulePush() call anywhere in
		// the app during the 5s undo window could flush the delete to Supabase
		// before the user tapped Undo. Now nothing should be touched in Dexie
		// until the timer actually fires.
		expect(await db.workouts.get(workout.id)).toBeDefined();
		expect(await db.tombstones.where('entity').equals('workout').count()).toBe(0);

		// UI state should already reflect the discard (instant feedback)
		expect(get(activeWorkout).workout).toBeNull();
		expect(get(activeWorkout).lastDiscarded?.workout.id).toBe(workout.id);
	});

	it(
		'restoreDiscarded works even if called just before the deferred delete would run',
		async () => {
			const workout = await activeWorkout.start('Test Workout 2');
			await activeWorkout.discard();

			// Undo well before the 5s window closes
			await wait(500);
			await activeWorkout.restoreDiscarded();

			expect(get(activeWorkout).workout?.id).toBe(workout.id);
			expect(await db.workouts.get(workout.id)).toBeDefined();

			// Wait past where the original timer would have fired — since it was
			// cancelled by restoreDiscarded, the workout must still exist.
			await wait(5000);
			expect(await db.workouts.get(workout.id)).toBeDefined();
			expect(await db.tombstones.count()).toBe(0);
		},
		15000
	);

	it(
		'actually deletes after the undo window closes without an undo',
		async () => {
			const workout = await activeWorkout.start('Test Workout 3');
			await activeWorkout.discard();

			await wait(5300);

			expect(await db.workouts.get(workout.id)).toBeUndefined();
			expect(await db.tombstones.where('entityId').equals(workout.id).count()).toBe(1);
		},
		15000
	);
});
