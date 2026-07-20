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
	it(
		'does not tombstone or delete anything from Dexie until the undo window actually closes',
		async () => {
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

			// Let this discard's pending timer resolve naturally before the next
			// test runs — `pendingDiscard` is module-scoped (shared across tests
			// in this file), so a dangling pending discard from this test would
			// otherwise get finalized by the *next* test's start()/discard() call
			// and contaminate its tombstone-count assertions.
			await wait(5300);
		},
		15000
	);

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

			// The local-only pendingDiscardAt marker (set at discard() time so
			// rehydrate() knows to ignore this workout) must be cleared again on
			// undo, otherwise a subsequent app reload's rehydrate() would
			// wrongly skip resuming it.
			const row = await db.workouts.get(workout.id);
			expect(row?.pendingDiscardAt).toBeFalsy();

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

	it('finalizes a still-pending discard immediately when a new workout is started, instead of orphaning it', async () => {
		const workout1 = await activeWorkout.start('Test Workout 4a');
		await activeWorkout.discard();
		// workout1's 5s undo window is still pending — do NOT wait for it.

		// Bug fix: starting a new workout used to just overwrite `lastDiscarded`
		// in the store; the OLD pending timeout then compared against the NEW
		// (unrelated) `lastDiscarded` value, saw a mismatch, and concluded it
		// had "already been restored" — silently skipping the delete forever
		// and leaving workout1 permanently lingering in Dexie as an
		// unfinished workout (which rehydrate() could even resurrect later).
		const workout2 = await activeWorkout.start('Test Workout 4b');

		// workout1 must have been finalized (tombstoned + deleted) right away,
		// not orphaned.
		expect(await db.workouts.get(workout1.id)).toBeUndefined();
		expect(await db.tombstones.where('entityId').equals(workout1.id).count()).toBe(1);

		// workout2 is the current active workout and must be untouched.
		expect(get(activeWorkout).workout?.id).toBe(workout2.id);
		expect(await db.workouts.get(workout2.id)).toBeDefined();

		await activeWorkout.discard();
		await wait(5300);
	}, 15000);

	it('rehydrate() ignores a workout mid-discard, and finalizeOrphanedPendingDiscards() cleans it up (simulates the app being closed before the undo window\'s setTimeout could fire)', async () => {
		const workout = await activeWorkout.start('Test Workout 5');
		await activeWorkout.discard();
		// Do NOT wait for the 5s timer — simulate the app process ending right
		// here (e.g. tab closed) by directly checking the persisted DB state
		// rather than relying on the in-memory setTimeout, which a real reload
		// would lose entirely.

		// Bug fix: the workout row itself is deliberately NOT deleted yet at
		// this point (see the "does not tombstone..." test above) — but it
		// must be marked pendingDiscardAt so a fresh rehydrate() (as would run
		// on the next app boot) doesn't resurrect it as still-active.
		const row = await db.workouts.get(workout.id);
		expect(row?.pendingDiscardAt).toBeTypeOf('number');

		const before = get(activeWorkout);
		expect(before.workout).toBeNull();

		await activeWorkout.rehydrate();
		// Bug fix: previously rehydrate() would pick this workout back up as
		// "the most recent unfinished workout" and resume it as active, since
		// its hard-delete was deferred and never touched by rehydrate()'s
		// query.
		expect(get(activeWorkout).workout).toBeNull();

		// Simulates the boot-time sweep that finishes what the lost setTimeout
		// would have done.
		await activeWorkout.finalizeOrphanedPendingDiscards();
		expect(await db.workouts.get(workout.id)).toBeUndefined();
		expect(await db.tombstones.where('entityId').equals(workout.id).count()).toBe(1);
	}, 15000);
});
