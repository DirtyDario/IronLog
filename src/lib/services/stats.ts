import { db } from '$lib/db/schema';

// ── Lifetime totals ──────────────────────────────────────────────────────────

export async function getLifetimeTotals() {
	const workouts = await db.workouts.toArray();
	const totalWorkouts = workouts.length; // count all saved workouts
	const totalTimeSec = workouts.reduce((sum, w) => sum + (w.durationSec ?? 0), 0);

	const allSets = await db.sets.filter((s) => s.completed === true).toArray();
	const totalVolume = allSets.reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
	const totalSets = allSets.length;
	const totalReps = allSets.reduce((sum, s) => sum + (s.reps ?? 0), 0);

	return { totalWorkouts, totalTimeSec, totalVolume, totalSets, totalReps };
}

// ── Training streak (consecutive weeks with ≥1 workout) ─────────────────────

export async function getStreak(): Promise<number> {
	const workouts = await db.workouts.toArray();

	if (!workouts.length) return 0;

	// Get unique ISO week strings (YYYY-Www)
	const weeks = new Set(
		workouts.map((w) => {
			const d = new Date(w.date);
			const jan4 = new Date(d.getFullYear(), 0, 4);
			const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
			return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
		})
	);

	// Current week
	const now = new Date();
	const jan4 = new Date(now.getFullYear(), 0, 4);
	const currentWeek = Math.ceil(((now.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);

	let streak = 0;
	let checkYear = now.getFullYear();
	let checkWeek = currentWeek;

	while (true) {
		const key = `${checkYear}-W${String(checkWeek).padStart(2, '0')}`;
		if (!weeks.has(key)) break;
		streak++;
		checkWeek--;
		if (checkWeek < 1) {
			checkYear--;
			checkWeek = 52;
		}
	}

	return streak;
}

// ── Workout frequency (last 12 weeks) ───────────────────────────────────────

export interface WeekCount { label: string; count: number }

export async function getWeeklyFrequency(): Promise<WeekCount[]> {
	const workouts = await db.workouts.toArray();

	const weeks: WeekCount[] = [];
	const now = new Date();

	for (let i = 11; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i * 7);
		const start = new Date(d);
		start.setDate(start.getDate() - start.getDay() + 1); // Monday
		start.setHours(0, 0, 0, 0);
		const end = new Date(start);
		end.setDate(end.getDate() + 7);

		const count = workouts.filter((w) => {
			const wd = new Date(w.date);
			return wd >= start && wd < end;
		}).length;

		weeks.push({
			label: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
			count
		});
	}

	return weeks;
}

// ── Muscle group distribution ────────────────────────────────────────────────

export interface MuscleCount { muscle: string; count: number }

export async function getMuscleDistribution(): Promise<MuscleCount[]> {
	const wes = await db.workoutExercises.toArray();
	const map = new Map<string, number>();

	for (const we of wes) {
		const ex = await db.exercises.get(we.exerciseId);
		if (!ex) continue;
		const mg = ex.muscleGroup ?? 'other';
		map.set(mg, (map.get(mg) ?? 0) + 1);
	}

	return Array.from(map.entries())
		.map(([muscle, count]) => ({ muscle, count }))
		.sort((a, b) => b.count - a.count);
}

// ── All-time bests ───────────────────────────────────────────────────────────

export interface ExerciseBest {
	exerciseId: string;
	exerciseName: string;
	muscleGroup: string;
	bestWeight?: number;
	bestReps?: number;
	bestOneRM?: number;
	bestDuration?: number;
	bestDistance?: number;
}

export async function getAllTimeBests(): Promise<ExerciseBest[]> {
	const prs = await db.personalRecords.toArray();
	const map = new Map<string, ExerciseBest>();

	for (const pr of prs) {
		const ex = await db.exercises.get(pr.exerciseId);
		if (!ex) continue;

		const existing = map.get(pr.exerciseId);
		if (!existing) {
			map.set(pr.exerciseId, {
				exerciseId: pr.exerciseId,
				exerciseName: ex.name,
				muscleGroup: ex.muscleGroup ?? 'other',
				bestWeight: pr.weight,
				bestReps: pr.reps,
				bestOneRM: pr.estimatedOneRM,
				bestDuration: pr.durationSec,
				bestDistance: pr.distanceM
			});
		} else {
			if (pr.estimatedOneRM && (!existing.bestOneRM || pr.estimatedOneRM > existing.bestOneRM)) {
				existing.bestOneRM = pr.estimatedOneRM;
				existing.bestWeight = pr.weight;
				existing.bestReps = pr.reps;
			}
			if (pr.durationSec && (!existing.bestDuration || pr.durationSec > existing.bestDuration)) {
				existing.bestDuration = pr.durationSec;
			}
			if (pr.distanceM && (!existing.bestDistance || pr.distanceM > existing.bestDistance)) {
				existing.bestDistance = pr.distanceM;
			}
		}
	}

	return Array.from(map.values()).sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatDuration(sec: number): string {
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}h ${m % 60}m`;
	return `${m}m`;
}

export function formatVolume(kg: number): string {
	if (kg >= 1000000) return `${(kg / 1000000).toFixed(1)}M kg`;
	if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k kg`;
	return `${kg} kg`;
}
