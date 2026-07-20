import { db } from '$lib/db/schema';
import type { PersonalRecord, PRBucket, PRCategory } from '$lib/db/schema';
import { schedulePush } from '$lib/services/sync';

// ─── Epley (kept for display purposes only) ───────────────────────────────────

/** Epley formula: estimated 1RM = weight * (1 + reps/30) */
export function epley(weight: number, reps: number): number {
	if (reps <= 1) return weight;
	return Math.round(weight * (1 + reps / 30));
}

// ─── Bucket logic ─────────────────────────────────────────────────────────────

export const ALL_BUCKETS: PRBucket[] = ['1RM', '3RM', '5RM', '8RM', '10RM', '12RM', '13+RM'];

/**
 * S3 fix: non-strength PRs use a sentinel bucket string so they can be indexed
 * in the Dexie compound index [exerciseId+category+bucket] without being dropped.
 * Only ever stored internally; never shown as a label.
 */
export const CARDIO_BUCKET_SENTINEL = '-';

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

// ─── Deterministic PR id (S5) ─────────────────────────────────────────────────
// Idempotent across recompute — no unbounded duplication on Supabase.

function prId(setId: string, category: PRCategory, bucket: string): string {
	return `${setId}|${category}|${bucket}`;
}

// ─── Best-per-bucket helpers ──────────────────────────────────────────────────

export async function getBestPerBucket(exerciseId: string): Promise<Record<PRBucket, PersonalRecord | null>> {
	const records = await db.personalRecords
		.where('[exerciseId+category+bucket]')
		.between(
			[exerciseId, 'strength', ''],
			[exerciseId, 'strength', '\uffff']
		)
		.toArray();

	const result = {} as Record<PRBucket, PersonalRecord | null>;
	for (const b of ALL_BUCKETS) result[b] = null;

	for (const r of records) {
		if (!r.bucket || !(ALL_BUCKETS as string[]).includes(r.bucket)) continue;
		const bucket = r.bucket as PRBucket;
		const current = result[bucket];
		if (!current) {
			result[bucket] = r;
			continue;
		}
		// Bug fix: previously compared `r.weight ?? r.reps` directly against
		// `current.weight ?? current.reps`, which mixes kg and rep counts when
		// an exercise has both weighted and bodyweight-only entries in the same
		// bucket (e.g. a 20-rep bodyweight set numerically "beating" a 15kg
		// weighted set). Weighted records always take priority; only compare
		// by reps when neither record has a weight.
		const currentHasWeight = current.weight != null;
		const newHasWeight = r.weight != null;
		if (newHasWeight && !currentHasWeight) {
			result[bucket] = r;
		} else if (newHasWeight === currentHasWeight) {
			const newVal = r.weight ?? r.reps ?? 0;
			const curVal = current.weight ?? current.reps ?? 0;
			if (newVal > curVal) result[bucket] = r;
		}
		// else: current already has weight and the new one doesn't — keep current
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
 * Scans all completed sets in a finished workout, compares against current best
 * per (exerciseId, category, bucket), and saves new PRs with deterministic IDs.
 * Returns newly created PR records.
 */
export async function detectPRsForWorkout(workoutId: string): Promise<PersonalRecord[]> {
	const wes = await db.workoutExercises.where('workoutId').equals(workoutId).toArray();
	const newPRs: PersonalRecord[] = [];
	const existingBests = new Map<string, number>();

	for (const we of wes) {
		const sets = await db.sets
			.where('workoutExerciseId').equals(we.id)
			.filter((s) => s.completed)
			.toArray();

		for (const set of sets) {
			const candidates = buildCandidates(set, we.exerciseId, workoutId);

			for (const candidate of candidates) {
				const key = `${candidate.exerciseId}|${candidate.category}|${candidate.bucket}`;

				// Load from DB if not cached — C2: exclude PRs from THIS workout so we
			// compare against historical bests only, not our own in-progress PRs
			if (!existingBests.has(key)) {
				const existing = await db.personalRecords
					.where('[exerciseId+category+bucket]')
					// Dexie doesn't statically type compound-index `.equals()` args
					// from a string index name — this is the standard/documented
					// workaround (see Dexie's own compound-index examples).
					.equals([candidate.exerciseId, candidate.category, candidate.bucket] as unknown as string)
					.filter((r) => r.workoutId !== workoutId) // C2: historical only
					.toArray();
					const best = existing.reduce((b, r) => Math.max(b, prValue(r)), 0);
					existingBests.set(key, best);
				}

				const currentBest = existingBests.get(key)!;
				const newValue = prValue(candidate as PersonalRecord);

				if (newValue > currentBest) {
					const id = prId(set.id, candidate.category, candidate.bucket!);
					// Upsert with deterministic id (put = insert-or-replace)
					const pr: PersonalRecord = { id, ...candidate };
					await db.personalRecords.put(pr);
					existingBests.set(key, newValue);
					newPRs.push(pr);
				}
			}
		}
	}

	if (newPRs.length) schedulePush();
	return newPRs;
}

// ─── Full recompute from workout history ──────────────────────────────────────

/** Module-level recompute mutex — prevents concurrent runs (S4) */
let recomputeInFlight: Promise<void> | null = null;

/**
 * Wipes personalRecords and recomputes from all finished workouts chronologically.
 * Uses deterministic IDs (S5) so re-running is fully idempotent.
 * Guard is set at the START (S4) to prevent infinite re-runs on error.
 */
export async function recomputeAllPRs(): Promise<void> {
	if (recomputeInFlight) return recomputeInFlight;

	recomputeInFlight = (async () => {
		// S4: Guard is set AFTER successful completion (not at start) so a crash during
		// recompute doesn't permanently block future attempts.

		// Bug fix: previously this cleared personalRecords locally without writing
		// tombstones, so any PR already pushed to Supabase stayed there forever —
		// on the next pull, those stale/obsolete remote PRs (e.g. from since-edited
		// or since-deleted sets) got pulled back down and resurrected locally.
		// Tombstone every existing local PR first so the eventual re-push also
		// deletes the corresponding remote rows; the recompute below then
		// re-inserts whichever PRs still apply (see buildCandidates/prValue),
		// which is safe because deterministic ids mean a delete-then-recreate in
		// the same sync pass is a no-op for the ones that still apply.
		const existing = await db.personalRecords.toArray();
		await Promise.all(
			existing.map((pr) =>
				db.tombstones.put({ id: pr.id, entity: 'personalRecord', entityId: pr.id, deletedAt: new Date(), _synced: false })
			)
		);

		await db.personalRecords.clear();

		const workouts = await db.workouts
			.filter((w) => !!w.finishedAt)
			.toArray();
		workouts.sort((a, b) =>
			new Date(a.finishedAt!).getTime() - new Date(b.finishedAt!).getTime()
		);

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
					const candidates = buildCandidates(set, we.exerciseId, workout.id, new Date(workout.finishedAt!));

					for (const candidate of candidates) {
						const key = `${candidate.exerciseId}|${candidate.category}|${candidate.bucket}`;
						const currentBest = runningBests.get(key) ?? 0;
						const newValue = prValue(candidate as PersonalRecord);

						if (newValue > currentBest) {
							const id = prId(set.id, candidate.category, candidate.bucket!);
							toInsert.push({ id, ...candidate });
							runningBests.set(key, newValue);
						}
					}
				}
			}
		}

		if (toInsert.length) {
			// bulkPut (not bulkAdd) — deterministic IDs mean duplicates are safe overwrites
			await db.personalRecords.bulkPut(toInsert);
		}
		// Bug fix: schedulePush unconditionally (not just when toInsert.length) —
		// otherwise the tombstones written above for stale PRs never get pushed
		// when the recompute removes PRs without replacing them with new ones.
		if (existing.length || toInsert.length) {
			schedulePush();
		}

		// C1: Set guard AFTER successful completion so a mid-run crash allows retry
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('prRecomputeV4Done', '1');
		}
	})().finally(() => { recomputeInFlight = null; });

	return recomputeInFlight;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

import type { ExerciseSet } from '$lib/db/schema';

function buildCandidates(
	set: ExerciseSet,
	exerciseId: string,
	workoutId: string,
	date: Date = new Date()
): Omit<PersonalRecord, 'id'>[] {
	const candidates: Omit<PersonalRecord, 'id'>[] = [];
	const base = { exerciseId, date, workoutId, setId: set.id, ...syncMeta() };

	// Strength: weight + reps (weighted exercises)
	if (set.weight != null && set.weight > 0 && set.reps != null && set.reps > 0) {
		candidates.push({
			...base,
			category: 'strength',
			bucket: bucketOf(set.reps),
			weight: set.weight,
			reps: set.reps
		});
	}

	// M1 fix: bodyweight reps-only (no weight field, just reps)
	if ((set.weight == null || set.weight === 0) && set.reps != null && set.reps > 0) {
		candidates.push({
			...base,
			category: 'strength',
			bucket: bucketOf(set.reps),
			reps: set.reps
		});
	}

	// Duration PR — use sentinel bucket so compound index works (S3)
	if (set.durationSec != null && set.durationSec > 0) {
		candidates.push({
			...base,
			category: 'duration',
			bucket: CARDIO_BUCKET_SENTINEL,
			durationSec: set.durationSec
		});
	}

	// Distance PR — use sentinel bucket (S3)
	if (set.distanceM != null && set.distanceM > 0) {
		candidates.push({
			...base,
			category: 'distance',
			bucket: CARDIO_BUCKET_SENTINEL,
			distanceM: set.distanceM
		});
	}

	return candidates;
}

function prValue(pr: Omit<PersonalRecord, 'id'> | PersonalRecord): number {
	if (pr.category === 'strength') return pr.weight ?? pr.reps ?? 0;
	if (pr.category === 'duration') return pr.durationSec ?? 0;
	if (pr.category === 'distance') return pr.distanceM ?? 0;
	return 0;
}
