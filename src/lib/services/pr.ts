import { db } from '$lib/db/schema';
import type { PersonalRecord, PRBucket, PRCategory } from '$lib/db/schema';
import { schedulePush } from '$lib/services/sync';

// ─── Epley (kept for display purposes only — no longer used for PR detection) ─

/** Epley formula: estimated 1RM = weight * (1 + reps/30) */
export function epley(weight: number, reps: number): number {
	if (reps === 1) return weight;
	return Math.round(weight * (1 + reps / 30));
}

// ─── Bucket logic ─────────────────────────────────────────────────────────────

export const ALL_BUCKETS: PRBucket[] = ['1RM', '3RM', '5RM', '8RM', '10RM', '12RM', '13+RM'];

export function bucketOf(reps: number): PRBucket {
	if (reps <= 1) return '1RM';
	if (reps <= 3) return '3RM';
	if (reps <= 5) return '5RM';
	if (reps <= 8) return '8RM';
	if (reps <= 10) return '10RM';
	if (reps <= 12) return '12RM';
	return '13+RM';
}

function syncMeta() {
	return { _synced: false as const, _lastModified: Date.now() };
}

// ─── Best-per-bucket helpers ──────────────────────────────────────────────────

export async function getBestPerBucket(exerciseId: string): Promise<Record<PRBucket, PersonalRecord | null>> {
	const records = await db.personalRecords
		.where('exerciseId').equals(exerciseId)
		.filter((r) => r.category === 'strength')
		.toArray();

	const result = {} as Record<PRBucket, PersonalRecord | null>;
	for (const b of ALL_BUCKETS) result[b] = null;

	for (const r of records) {
		if (!r.bucket) continue;
		const current = result[r.bucket];
		if (!current || (r.weight ?? 0) > (current.weight ?? 0)) {
			result[r.bucket] = r;
		}
	}
	return result;
}

export async function getPRsForWorkout(workoutId: string): Promise<PersonalRecord[]> {
	return db.personalRecords.where('workoutId').equals(workoutId).toArray();
}

export async function getPRsForExercise(exerciseId: string): Promise<PersonalRecord[]> {
	const prs = await db.personalRecords.where('exerciseId').equals(exerciseId).sortBy('date');
	return prs;
}

// ─── Detect & save PRs for a finished workout ─────────────────────────────────

/**
 * Scans all completed sets in a finished workout, compares each against the
 * current best per (exerciseId, category, bucket), and saves new PRs.
 * Returns the list of new PR records created.
 */
export async function detectPRsForWorkout(workoutId: string): Promise<PersonalRecord[]> {
	const wes = await db.workoutExercises.where('workoutId').equals(workoutId).toArray();
	const newPRs: PersonalRecord[] = [];

	// Load all existing PR bests up-front for efficiency
	// Map key: `${exerciseId}|${category}|${bucket}`
	const existingBests = new Map<string, number>();

	for (const we of wes) {
		const sets = await db.sets
			.where('workoutExerciseId').equals(we.id)
			.filter((s) => s.completed)
			.toArray();

		for (const set of sets) {
			const candidates: Omit<PersonalRecord, 'id'>[] = [];

			// Strength PR candidate
			if (set.weight && set.reps) {
				const bucket = bucketOf(set.reps);
				candidates.push({
					exerciseId: we.exerciseId,
					category: 'strength',
					bucket,
					weight: set.weight,
					reps: set.reps,
					date: new Date(),
					workoutId,
					setId: set.id,
					...syncMeta()
				});
			}

			// Duration PR candidate
			if (set.durationSec) {
				candidates.push({
					exerciseId: we.exerciseId,
					category: 'duration',
					durationSec: set.durationSec,
					date: new Date(),
					workoutId,
					setId: set.id,
					...syncMeta()
				});
			}

			// Distance PR candidate
			if (set.distanceM) {
				candidates.push({
					exerciseId: we.exerciseId,
					category: 'distance',
					distanceM: set.distanceM,
					date: new Date(),
					workoutId,
					setId: set.id,
					...syncMeta()
				});
			}

			for (const candidate of candidates) {
				const key = `${candidate.exerciseId}|${candidate.category}|${candidate.bucket ?? ''}`;

				// Load from DB if not cached
				if (!existingBests.has(key)) {
					const existing = await db.personalRecords
						.where('[exerciseId+category+bucket]')
						.equals([candidate.exerciseId, candidate.category, candidate.bucket ?? ''])
						.toArray();
					let best = 0;
					for (const e of existing) {
						if (candidate.category === 'strength') best = Math.max(best, e.weight ?? 0);
						else if (candidate.category === 'duration') best = Math.max(best, e.durationSec ?? 0);
						else if (candidate.category === 'distance') best = Math.max(best, e.distanceM ?? 0);
					}
					existingBests.set(key, best);
				}

				const currentBest = existingBests.get(key)!;
				let newValue = 0;
				if (candidate.category === 'strength') newValue = candidate.weight ?? 0;
				else if (candidate.category === 'duration') newValue = candidate.durationSec ?? 0;
				else if (candidate.category === 'distance') newValue = candidate.distanceM ?? 0;

				if (newValue > currentBest) {
					// Check for duplicate setId
					const dupe = await db.personalRecords.where('setId').equals(set.id)
						.filter((r) => r.category === candidate.category && r.bucket === candidate.bucket)
						.first();
					if (!dupe) {
						const pr: PersonalRecord = { id: crypto.randomUUID(), ...candidate };
						await db.personalRecords.add(pr);
						existingBests.set(key, newValue);
						newPRs.push(pr);
					}
				}
			}
		}
	}

	if (newPRs.length) schedulePush();
	return newPRs;
}

// ─── Full recompute from workout history ──────────────────────────────────────

/**
 * Wipes all personalRecords and recomputes from every finished workout,
 * chronologically. Called once on v4 migration.
 */
export async function recomputeAllPRs(): Promise<void> {
	// Clear existing PR records
	await db.personalRecords.clear();

	// Process all finished workouts in chronological order
	const workouts = await db.workouts
		.filter((w) => !!w.finishedAt)
		.toArray();
	workouts.sort((a, b) =>
		new Date(a.finishedAt!).getTime() - new Date(b.finishedAt!).getTime()
	);

	// Track running bests in memory for efficiency
	const runningBests = new Map<string, number>();
	const toInsert: PersonalRecord[] = [];

	for (const workout of workouts) {
		const wes = await db.workoutExercises.where('workoutId').equals(workout.id).toArray();

		for (const we of wes) {
			const sets = await db.sets
				.where('workoutExerciseId').equals(we.id)
				.filter((s) => s.completed)
				.toArray();

			for (const set of sets) {
				const candidates: Omit<PersonalRecord, 'id'>[] = [];

				if (set.weight && set.reps) {
					const bucket = bucketOf(set.reps);
					candidates.push({
						exerciseId: we.exerciseId,
						category: 'strength',
						bucket,
						weight: set.weight,
						reps: set.reps,
						date: new Date(workout.finishedAt!),
						workoutId: workout.id,
						setId: set.id,
						...syncMeta()
					});
				}
				if (set.durationSec) {
					candidates.push({
						exerciseId: we.exerciseId,
						category: 'duration',
						durationSec: set.durationSec,
						date: new Date(workout.finishedAt!),
						workoutId: workout.id,
						setId: set.id,
						...syncMeta()
					});
				}
				if (set.distanceM) {
					candidates.push({
						exerciseId: we.exerciseId,
						category: 'distance',
						distanceM: set.distanceM,
						date: new Date(workout.finishedAt!),
						workoutId: workout.id,
						setId: set.id,
						...syncMeta()
					});
				}

				for (const candidate of candidates) {
					const key = `${candidate.exerciseId}|${candidate.category}|${candidate.bucket ?? ''}`;
					const currentBest = runningBests.get(key) ?? 0;

					let newValue = 0;
					if (candidate.category === 'strength') newValue = candidate.weight ?? 0;
					else if (candidate.category === 'duration') newValue = candidate.durationSec ?? 0;
					else if (candidate.category === 'distance') newValue = candidate.distanceM ?? 0;

					if (newValue > currentBest) {
						toInsert.push({ id: crypto.randomUUID(), ...candidate });
						runningBests.set(key, newValue);
					}
				}
			}
		}
	}

	if (toInsert.length) {
		await db.personalRecords.bulkAdd(toInsert);
		schedulePush();
	}

	localStorage.setItem('prRecomputeV4Done', '1');
}
