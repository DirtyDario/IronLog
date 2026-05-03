import { db } from '$lib/db/schema';
import type { Exercise, MuscleGroup, ExerciseType } from '$lib/db/schema';

/**
 * Heuristic: returns true if an exercise name suggests it is unilateral (single-arm/single-leg).
 * Used both for seed patching and wger import.
 */
export function isLikelyUnilateral(name: string): boolean {
	const n = name.toLowerCase();
	const patterns = [
		'single arm', 'single-arm', 'one arm', 'one-arm',
		'single leg', 'single-leg', 'one leg', 'one-leg',
		'unilateral',
		'dumbbell row', 'db row',
		'dumbbell curl', 'db curl',
		'hammer curl',
		'incline curl',
		'concentration curl',
		'preacher curl',
		'cable curl',
		'dumbbell fly', 'db fly',
		'incline dumbbell fly',
		'lateral raise',
		'front raise',
		'lunge',
		'split squat',
		'step-up', 'step up',
		'pistol squat',
		'kickback',
		'dumbbell shoulder press', 'db shoulder press',
		'dumbbell incline', 'db incline',
		'dumbbell decline', 'db decline',
		'cable fly',
		'cable crossover',
	];
	return patterns.some((p) => n.includes(p));
}

// wger.de muscle group ID → IronLog MuscleGroup mapping
const MUSCLE_MAP: Record<number, MuscleGroup> = {
	1: 'shoulders',   // Deltoids
	2: 'biceps',
	3: 'chest',
	4: 'triceps',
	5: 'back',        // Latissimus dorsi
	6: 'legs',        // Quadriceps
	7: 'back',        // Trapezius (näher an back)
	8: 'glutes',      // Gluteus maximus
	10: 'back',       // Biceps femoris (hamstrings)
	11: 'core',       // Rectus abdominis
	12: 'legs',       // Gastrocnemius (calves)
	13: 'core',       // Iliopsoas
	14: 'legs',       // Soleus (calves)
	15: 'core',       // Transversus abdominis
};

interface WgerExercise {
	id: number;
	name: string;
	category: { id: number; name: string };
	muscles: Array<{ id: number; name_en: string }>;
	muscles_secondary: Array<{ id: number; name_en: string }>;
	equipment: Array<{ id: number; name: string }>;
	description: string;
}

interface WgerResponse {
	count: number;
	next: string | null;
	results: WgerExercise[];
}

function guessExerciseType(equipment: Array<{ id: number; name: string }>, categoryId: number): ExerciseType {
	const equipNames = equipment.map((e) => e.name.toLowerCase());
	// Category 10 = Cardio in wger
	if (categoryId === 10) return 'distance';
	if (equipNames.includes('body weight') || equipNames.includes('bodyweight') || equipment.length === 0) return 'bodyweightReps';
	return 'weightReps';
}

function getMuscleGroup(muscles: Array<{ id: number }>, muscles_secondary: Array<{ id: number }>, categoryId: number): MuscleGroup {
	// wger category IDs: 8=Arms, 9=Legs, 10=Cardio, 11=Chest, 12=Back, 13=Shoulders, 14=Core
	const categoryMap: Record<number, MuscleGroup> = {
		8: 'biceps',
		9: 'legs',
		10: 'cardio',
		11: 'chest',
		12: 'back',
		13: 'shoulders',
		14: 'core',
	};
	if (categoryMap[categoryId]) return categoryMap[categoryId];

	// Try primary muscles
	const all = [...muscles, ...muscles_secondary];
	for (const m of all) {
		if (MUSCLE_MAP[m.id]) return MUSCLE_MAP[m.id];
	}
	return 'other';
}

export interface ImportPreview {
	wgerId: number;
	name: string;
	muscleGroup: MuscleGroup;
	type: ExerciseType;
	alreadyExists: boolean;
}

/**
 * Fetches exercises from wger.de API and returns a preview list.
 * Only English exercises (language=2) are fetched.
 */
export async function fetchImportPreview(limit = 100): Promise<ImportPreview[]> {
	const url = `https://wger.de/api/v2/exercise/?format=json&language=2&limit=${limit}&offset=0`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`wger API error: ${response.status}`);
	const data: WgerResponse = await response.json();

	// Get existing exercise names for dedup
	const existing = await db.exercises.toArray();
	const existingNames = new Set(existing.map((e) => e.name.toLowerCase().trim()));

	const previews: ImportPreview[] = [];
	for (const ex of data.results) {
		if (!ex.name?.trim()) continue;
		previews.push({
			wgerId: ex.id,
			name: ex.name.trim(),
			muscleGroup: getMuscleGroup(ex.muscles, ex.muscles_secondary, ex.category?.id ?? 0),
			type: guessExerciseType(ex.equipment ?? [], ex.category?.id ?? 0),
			alreadyExists: existingNames.has(ex.name.toLowerCase().trim()),
		});
	}

	return previews.filter((p) => !p.alreadyExists).slice(0, 100);
}

/**
 * Imports selected exercises into the local database.
 * Marks them as isCustom: false (built-in, not user-created) but imported.
 */
export async function importExercises(selected: ImportPreview[]): Promise<number> {
	const now = Date.now();
	const exercises: Exercise[] = selected.map((p) => ({
		id: `wger_${p.wgerId}`,
		name: p.name,
		type: p.type,
		muscleGroup: p.muscleGroup,
		isCustom: false,
		_synced: false,
		_lastModified: now,
	}));

	// Filter out already existing by id
	const existingIds = new Set((await db.exercises.bulkGet(exercises.map((e) => e.id))).filter(Boolean).map((e) => e!.id));
	const toInsert = exercises.filter((e) => !existingIds.has(e.id));

	if (toInsert.length > 0) {
		await db.exercises.bulkAdd(toInsert);
	}
	return toInsert.length;
}

interface WgerInfoExercise {
	id: number;
	category: { id: number; name: string };
	muscles: Array<{ id: number }>;
	muscles_secondary: Array<{ id: number }>;
	equipment: Array<{ id: number; name: string }>;
	translations: Array<{ language: number; name: string }>;
}

interface WgerInfoResponse {
	count: number;
	next: string | null;
	results: WgerInfoExercise[];
}

/**
 * Fetches exercises from wger.de exerciseinfo API (has names!) and seeds them into the DB.
 * Uses localStorage guard 'wgerSeedV1Done' to run only once.
 * Silently fails if offline.
 * Imports up to 400 exercises (2 pages of 200).
 */
export async function autoSeedFromWger(): Promise<void> {
	if (typeof localStorage !== 'undefined' && localStorage.getItem('wgerSeedV1Done')) return;

	try {
		const allExercises: WgerInfoExercise[] = [];

		// Fetch 2 pages (200 + 200 = up to 400 exercises)
		const urls = [
			'https://wger.de/api/v2/exerciseinfo/?format=json&limit=200&offset=0',
			'https://wger.de/api/v2/exerciseinfo/?format=json&limit=200&offset=200',
		];

		for (const url of urls) {
			try {
				const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
				if (!res.ok) break;
				const data: WgerInfoResponse = await res.json();
				allExercises.push(...data.results);
			} catch {
				break; // offline or timeout → stop, try again next time
			}
		}

		if (allExercises.length === 0) return;

		// Get existing exercise names and ids for dedup
		const existing = await db.exercises.toArray();
		const existingNames = new Set(existing.map((e) => e.name.toLowerCase().trim()));
		const existingIds = new Set(existing.map((e) => e.id));

		const now = Date.now();
		const toInsert: Exercise[] = [];

		for (const ex of allExercises) {
			// Find English translation (language=2)
			const enTranslation = ex.translations?.find((t) => t.language === 2);
			if (!enTranslation?.name?.trim()) continue;

			const name = enTranslation.name.trim();
			const id = `wger_${ex.id}`;

			// Skip duplicates
			if (existingNames.has(name.toLowerCase()) || existingIds.has(id)) continue;

			const muscleGroup = getMuscleGroup(ex.muscles, ex.muscles_secondary, ex.category?.id ?? 0);
			const type = guessExerciseType(ex.equipment ?? [], ex.category?.id ?? 0);

			toInsert.push({
				id,
				name,
				type,
				muscleGroup,
				isCustom: false,
				isUnilateral: isLikelyUnilateral(name),
				_synced: false,
				_lastModified: now,
			});
		}

		if (toInsert.length > 0) {
			await db.exercises.bulkAdd(toInsert);
		}

		// Mark as done (even if 0 exercises were added — avoid repeated calls)
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('wgerSeedV1Done', '1');
		}
	} catch (e) {
		// Silently fail — will retry on next app start
		console.warn('wger auto-seed failed:', e);
	}
}
