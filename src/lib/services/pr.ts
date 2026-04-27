import { db } from '$lib/db/schema';
import type { ExerciseSet } from '$lib/db/schema';

/** Epley formula: estimated 1RM = weight * (1 + reps/30) */
export function epley(weight: number, reps: number): number {
	if (reps === 1) return weight;
	return Math.round(weight * (1 + reps / 30));
}

export async function checkAndSavePR(
	exerciseId: string,
	set: ExerciseSet,
	date: Date
): Promise<boolean> {
	if (!set.completed) return false;

	const existing = await db.personalRecords
		.where('exerciseId')
		.equals(exerciseId)
		.sortBy('date');

	let isNewPR = false;

	if (set.weight && set.reps) {
		const newOneRM = epley(set.weight, set.reps);
		const bestOneRM = existing.reduce((best, pr) => Math.max(best, pr.estimatedOneRM ?? 0), 0);
		if (newOneRM > bestOneRM) {
			await db.personalRecords.add({
				id: crypto.randomUUID(),
				exerciseId,
				date,
				weight: set.weight,
				reps: set.reps,
				estimatedOneRM: newOneRM
			});
			isNewPR = true;
		}
	} else if (set.durationSec) {
		const bestDuration = existing.reduce((best, pr) => Math.max(best, pr.durationSec ?? 0), 0);
		if (set.durationSec > bestDuration) {
			await db.personalRecords.add({
				id: crypto.randomUUID(),
				exerciseId,
				date,
				durationSec: set.durationSec
			});
			isNewPR = true;
		}
	} else if (set.distanceM) {
		const bestDist = existing.reduce((best, pr) => Math.max(best, pr.distanceM ?? 0), 0);
		if (set.distanceM > bestDist) {
			await db.personalRecords.add({
				id: crypto.randomUUID(),
				exerciseId,
				date,
				distanceM: set.distanceM
			});
			isNewPR = true;
		}
	}

	return isNewPR;
}

export async function getBestForExercise(exerciseId: string) {
	const prs = await db.personalRecords.where('exerciseId').equals(exerciseId).sortBy('date');
	if (!prs.length) return null;
	return prs.reduce((best, pr) => {
		if ((pr.estimatedOneRM ?? 0) > (best.estimatedOneRM ?? 0)) return pr;
		return best;
	});
}
