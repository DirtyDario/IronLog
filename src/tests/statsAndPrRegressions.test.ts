import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/schema';
import {
	getStreak,
	getWeeklyFrequency,
	getMuscleDistribution,
	getExerciseProgressCounts,
	setHasUsableData
} from '$lib/services/stats';
import { getBestPerBucket } from '$lib/services/pr';

function daysAgo(n: number): Date {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return d;
}

beforeEach(async () => {
	// Bug in the TEST itself (not the app) otherwise: getWeeklyFrequency/getStreak
	// scan ALL workouts in the DB, so leftover rows from a previous test in this
	// file would inflate later assertions. Isolate each test.
	await db.workouts.clear();
	await db.workoutExercises.clear();
	await db.sets.clear();
	await db.personalRecords.clear();
	await db.exercises.clear();
});

describe('getStreak', () => {
	it('keeps a streak alive during an in-progress week with no workout yet', async () => {
		// Trained last week and the week before, but NOT yet this week. Use
		// exact 7/14-day offsets (same weekday, shifted whole weeks) so these
		// land in the correct week bucket regardless of what weekday "today" is.
		await db.workouts.add({
			id: crypto.randomUUID(),
			date: daysAgo(7),
			finishedAt: daysAgo(7)
		} as any);
		await db.workouts.add({
			id: crypto.randomUUID(),
			date: daysAgo(14),
			finishedAt: daysAgo(14)
		} as any);

		const streak = await getStreak();
		// Bug fix: previously this returned 0 because the check started at
		// "this week" (which has no workout yet) instead of falling back to
		// last week.
		expect(streak).toBeGreaterThanOrEqual(2);
	});
});

describe('getWeeklyFrequency', () => {
	it('buckets a Sunday-finished workout into the week it belongs to, consistent with getStreak', async () => {
		// Find the most recent Sunday and put a finished workout there.
		const now = new Date();
		const sunday = new Date(now);
		const day = sunday.getDay();
		sunday.setDate(sunday.getDate() - day); // day 0 = Sunday, so this lands exactly on Sunday
		sunday.setHours(12, 0, 0, 0);

		await db.workouts.add({
			id: crypto.randomUUID(),
			date: sunday,
			finishedAt: sunday
		} as any);

		const weeks = await getWeeklyFrequency();
		const total = weeks.reduce((sum, w) => sum + w.count, 0);
		// Bug fix: previously a Sunday workout could be bucketed into the
		// *following* week (off-by-one in the Monday-snapping math), or land in
		// no week / double-counted depending on today's weekday. At minimum the
		// workout must be counted exactly once across the 12-week window.
		expect(total).toBe(1);
	});
});

describe('getMuscleDistribution', () => {
	it('does not count a workoutExercise with zero completed sets', async () => {
		const exId = crypto.randomUUID();
		await db.exercises.add({ id: exId, name: 'Abandoned Exercise', type: 'weightReps', muscleGroup: 'chest', isCustom: true } as any);
		const workoutId = crypto.randomUUID();
		await db.workouts.add({ id: workoutId, date: new Date(), finishedAt: new Date() } as any);
		const weId = crypto.randomUUID();
		await db.workoutExercises.add({ id: weId, workoutId, exerciseId: exId, order: 0 } as any);
		// No sets, or only incomplete sets — added then abandoned
		await db.sets.add({ id: crypto.randomUUID(), workoutExerciseId: weId, order: 0, isWarmup: false, completed: false } as any);

		const dist = await getMuscleDistribution();
		const chest = dist.find((d) => d.muscle === 'chest');
		expect(chest).toBeUndefined();
	});
});

describe('getBestPerBucket', () => {
	it('does not let a bodyweight (reps-only) PR outrank a weighted PR in the same bucket', async () => {
		const exId = crypto.randomUUID();
		// Weighted PR: 15kg x 8 reps (bucket 8RM), value comparison should use weight (15), not reps.
		await db.personalRecords.put({
			id: 'set-a|strength|8RM',
			exerciseId: exId,
			category: 'strength',
			bucket: '8RM',
			weight: 15,
			reps: 8,
			date: new Date(),
			workoutId: 'w1',
			setId: 'set-a'
		} as any);
		// Bodyweight (reps-only) PR: 20 reps, same bucket — numerically 20 > 15,
		// but must NOT be treated as better since it's a different kind of record.
		await db.personalRecords.put({
			id: 'set-b|strength|8RM',
			exerciseId: exId,
			category: 'strength',
			bucket: '8RM',
			reps: 20,
			date: new Date(),
			workoutId: 'w2',
			setId: 'set-b'
		} as any);

		const best = await getBestPerBucket(exId);
		expect(best['8RM']?.weight).toBe(15);
	});
});

describe('getExerciseProgressCounts', () => {
	it('does not count a weightReps set as having usable data when only one of weight/reps is filled in', async () => {
		// Bug repro: a "weightReps" exercise's Progress-tab dropdown showed
		// "Incline Dumbbell Bench Press (7)" (i.e. 7 sessions counted as having
		// data) yet the chart underneath rendered "No data yet for this
		// exercise". Root cause: the count used a loose "any field present"
		// check (weight OR reps OR ...) while the chart required BOTH weight
		// AND reps for a weightReps exercise. A completed set with e.g. weight
		// logged but reps left blank satisfied the loose check but not the
		// chart's strict one.
		const exId = crypto.randomUUID();
		await db.exercises.add({ id: exId, name: 'Incline Dumbbell Bench Press', type: 'weightReps' } as any);

		const workoutId = crypto.randomUUID();
		await db.workouts.add({ id: workoutId, date: new Date(), finishedAt: new Date() } as any);

		const weId = crypto.randomUUID();
		await db.workoutExercises.add({ id: weId, workoutId, exerciseId: exId, order: 0 } as any);

		// Completed, but only weight was ever filled in — reps left blank.
		await db.sets.add({
			id: crypto.randomUUID(),
			workoutExerciseId: weId,
			order: 0,
			completed: true,
			weight: 20,
			reps: null
		} as any);

		const counts = await getExerciseProgressCounts();
		expect(counts[exId] ?? 0).toBe(0);
	});

	it('counts a session once real weight+reps data is present, and setHasUsableData agrees per-type', async () => {
		const exId = crypto.randomUUID();
		await db.exercises.add({ id: exId, name: 'Incline Dumbbell Bench Press', type: 'weightReps' } as any);

		const workoutId = crypto.randomUUID();
		await db.workouts.add({ id: workoutId, date: new Date(), finishedAt: new Date() } as any);

		const weId = crypto.randomUUID();
		await db.workoutExercises.add({ id: weId, workoutId, exerciseId: exId, order: 0 } as any);

		await db.sets.add({
			id: crypto.randomUUID(),
			workoutExerciseId: weId,
			order: 0,
			completed: true,
			weight: 20,
			reps: 10
		} as any);

		const counts = await getExerciseProgressCounts();
		expect(counts[exId]).toBe(1);

		expect(setHasUsableData({ completed: true, weight: 20, reps: null }, 'weightReps')).toBe(false);
		expect(setHasUsableData({ completed: true, weight: 20, reps: 10 }, 'weightReps')).toBe(true);
		expect(setHasUsableData({ completed: true, reps: 12 }, 'bodyweightReps')).toBe(true);
		expect(setHasUsableData({ completed: false, weight: 20, reps: 10 }, 'weightReps')).toBe(false);
	});
});
