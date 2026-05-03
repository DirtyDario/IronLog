import { db, type Exercise } from './schema';

const defaultExercises: Omit<Exercise, 'isCustom'>[] = [
	// ── CHEST ──────────────────────────────────────────────────────────────
	// Barbell
	{ id: 'bench-press',            name: 'Bench Press',                       type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'incline-bench',          name: 'Incline Bench Press',               type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'decline-bench',          name: 'Decline Bench Press',               type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'close-grip-bench',       name: 'Close Grip Bench Press',            type: 'weightReps', muscleGroup: 'triceps' },
	// Dumbbell
	{ id: 'flat-db-bench',          name: 'Flat Dumbbell Bench Press',         type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'db-incline-press',       name: 'Incline Dumbbell Bench Press',      type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'db-decline-press',       name: 'Decline Dumbbell Bench Press',      type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'dumbbell-fly',           name: 'Dumbbell Chest Fly (Flat)',         type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'db-incline-fly',         name: 'Incline Dumbbell Fly',              type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'decline-db-fly',         name: 'Decline Dumbbell Fly',              type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'db-pullover',            name: 'Dumbbell Pullover',                 type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'one-arm-db-bench',       name: 'One-Arm Dumbbell Bench Press',      type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	{ id: 'one-arm-incline-db-press', name: 'One-Arm Incline Dumbbell Press', type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	// Machine
	{ id: 'chest-press-machine',    name: 'Chest Press Machine',               type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'incline-chest-press-machine', name: 'Incline Chest Press Machine',  type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'decline-chest-press-machine', name: 'Decline Chest Press Machine',  type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'pec-deck',               name: 'Pec Deck',                          type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'plate-loaded-chest-press', name: 'Plate-Loaded Chest Press',        type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'iso-lateral-chest-press', name: 'Iso-Lateral Chest Press',          type: 'weightReps', muscleGroup: 'chest' },
	// Cable
	{ id: 'cable-chest-press',      name: 'Cable Chest Press',                 type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'incline-cable-press',    name: 'Incline Cable Press',               type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'decline-cable-press',    name: 'Decline Cable Press',               type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'cable-fly',              name: 'Cable Fly',                         type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'incline-cable-fly',      name: 'Incline Cable Fly',                 type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'decline-cable-fly',      name: 'Decline Cable Fly',                 type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'single-arm-cable-chest-press', name: 'Single-Arm Cable Chest Press', type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	{ id: 'single-arm-cable-fly',   name: 'Single-Arm Cable Fly',              type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	// Bodyweight
	{ id: 'pushup',                 name: 'Push-Up',                           type: 'bodyweightReps', muscleGroup: 'chest' },
	{ id: 'dip',                    name: 'Dip',                               type: 'bodyweightReps', muscleGroup: 'chest' },

	// ── BACK ───────────────────────────────────────────────────────────────
	// Barbell
	{ id: 'deadlift',               name: 'Deadlift',                          type: 'weightReps', muscleGroup: 'back' },
	{ id: 'barbell-row',            name: 'Barbell Row',                       type: 'weightReps', muscleGroup: 'back' },
	{ id: 'tbar-row',               name: 'T-Bar Row',                         type: 'weightReps', muscleGroup: 'back' },
	// Dumbbell
	{ id: 'dumbbell-row',           name: 'Dumbbell Row',                      type: 'weightReps', muscleGroup: 'back' },
	{ id: 'one-arm-db-row',         name: 'One-Arm Dumbbell Row',              type: 'weightReps', muscleGroup: 'back', isUnilateral: true },
	{ id: 'incline-db-row',         name: 'Incline Dumbbell Row',              type: 'weightReps', muscleGroup: 'back' },
	{ id: 'renegade-row',           name: 'Renegade Row',                      type: 'weightReps', muscleGroup: 'back' },
	{ id: 'incline-rear-delt-row',  name: 'Incline Rear Delt Row',             type: 'weightReps', muscleGroup: 'back' },
	// Machine
	{ id: 'lat-pulldown',           name: 'Lat Pulldown',                      type: 'weightReps', muscleGroup: 'back' },
	{ id: 'pullup',                 name: 'Pull-Up',                           type: 'bodyweightReps', muscleGroup: 'back' },
	{ id: 'chinup',                 name: 'Chin-Up',                           type: 'bodyweightReps', muscleGroup: 'back' },
	{ id: 'assisted-pullup-machine', name: 'Assisted Pull-Up Machine',         type: 'weightReps', muscleGroup: 'back' },
	{ id: 'seated-row-machine',     name: 'Seated Row Machine',                type: 'weightReps', muscleGroup: 'back' },
	{ id: 'chest-supported-row-machine', name: 'Chest-Supported Row Machine',  type: 'weightReps', muscleGroup: 'back' },
	{ id: 'hammer-strength-row',    name: 'Hammer Strength Row',               type: 'weightReps', muscleGroup: 'back' },
	{ id: 'reverse-pec-deck',       name: 'Reverse Pec Deck',                  type: 'weightReps', muscleGroup: 'back' },
	// Cable
	{ id: 'seated-cable-row',       name: 'Seated Cable Row',                  type: 'weightReps', muscleGroup: 'back' },
	{ id: 'one-arm-cable-row',      name: 'One-Arm Cable Row',                 type: 'weightReps', muscleGroup: 'back', isUnilateral: true },
	{ id: 'straight-arm-pulldown',  name: 'Straight-Arm Pulldown',             type: 'weightReps', muscleGroup: 'back' },
	{ id: 'single-arm-lat-pulldown', name: 'Single-Arm Lat Pulldown',          type: 'weightReps', muscleGroup: 'back', isUnilateral: true },
	{ id: 'face-pull',              name: 'Face Pull',                         type: 'weightReps', muscleGroup: 'back' },
	{ id: 'high-row-cable',         name: 'High Row (Cable)',                   type: 'weightReps', muscleGroup: 'back' },

	// ── SHOULDERS ──────────────────────────────────────────────────────────
	// Barbell
	{ id: 'overhead-press',         name: 'Overhead Press',                    type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'upright-row',            name: 'Upright Row',                       type: 'weightReps', muscleGroup: 'shoulders' },
	// Dumbbell
	{ id: 'seated-db-shoulder-press', name: 'Seated Dumbbell Shoulder Press',  type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'standing-db-press',      name: 'Standing Dumbbell Press',           type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'arnold-press',           name: 'Arnold Press',                      type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'lateral-raise',          name: 'Lateral Raise',                     type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'incline-lateral-raise',  name: 'Incline Lateral Raise',             type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'rear-delt-fly',          name: 'Rear Delt Fly',                     type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'front-raise',            name: 'Front Raise',                       type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'one-arm-shoulder-press', name: 'One-Arm Shoulder Press',            type: 'weightReps', muscleGroup: 'shoulders', isUnilateral: true },
	{ id: 'one-arm-lateral-raise',  name: 'One-Arm Lateral Raise',             type: 'weightReps', muscleGroup: 'shoulders', isUnilateral: true },
	// Machine
	{ id: 'shoulder-press-machine', name: 'Shoulder Press Machine',            type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'lateral-raise-machine',  name: 'Lateral Raise Machine',             type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'rear-delt-machine',      name: 'Rear Delt Machine',                 type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'plate-loaded-shoulder-press', name: 'Plate-Loaded Shoulder Press',  type: 'weightReps', muscleGroup: 'shoulders' },
	// Cable
	{ id: 'cable-lateral-raise',    name: 'Cable Lateral Raise',               type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'one-arm-cable-lateral-raise', name: 'One-Arm Cable Lateral Raise',  type: 'weightReps', muscleGroup: 'shoulders', isUnilateral: true },
	{ id: 'cable-front-raise',      name: 'Cable Front Raise',                 type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'cable-rear-delt-fly',    name: 'Cable Rear Delt Fly',               type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'one-arm-cable-shoulder-press', name: 'One-Arm Cable Shoulder Press', type: 'weightReps', muscleGroup: 'shoulders', isUnilateral: true },

	// ── BICEPS ─────────────────────────────────────────────────────────────
	// Barbell
	{ id: 'barbell-curl',           name: 'Barbell Curl',                      type: 'weightReps', muscleGroup: 'biceps' },
	// Dumbbell
	{ id: 'dumbbell-curl',          name: 'Dumbbell Curl',                     type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'alternating-db-curl',    name: 'Alternating Dumbbell Curl',         type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'incline-curl',           name: 'Incline Dumbbell Curl',             type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'decline-db-curl',        name: 'Decline Dumbbell Curl',             type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'hammer-curl',            name: 'Hammer Curl',                       type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'concentration-curl',     name: 'Concentration Curl',                type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },
	{ id: 'one-arm-preacher-curl',  name: 'One-Arm Preacher Curl',             type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },
	// Machine
	{ id: 'preacher-curl',          name: 'Preacher Curl Machine',             type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'biceps-curl-machine',    name: 'Biceps Curl Machine',               type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'iso-lateral-curl-machine', name: 'Iso-Lateral Curl Machine',        type: 'weightReps', muscleGroup: 'biceps' },
	// Cable
	{ id: 'cable-curl',             name: 'Cable Curl',                        type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'rope-cable-curl',        name: 'Rope Cable Curl',                   type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'one-arm-cable-curl',     name: 'One-Arm Cable Curl',                type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },
	{ id: 'high-cable-curl',        name: 'High Cable Curl',                   type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'bayesian-curl',          name: 'Bayesian Curl',                     type: 'weightReps', muscleGroup: 'biceps' },

	// ── TRICEPS ────────────────────────────────────────────────────────────
	// Barbell
	{ id: 'skull-crusher',          name: 'Skull Crushers',                    type: 'weightReps', muscleGroup: 'triceps' },
	// Dumbbell
	{ id: 'overhead-db-extension',  name: 'Overhead Dumbbell Extension',       type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'one-arm-overhead-extension', name: 'One-Arm Overhead Extension',    type: 'weightReps', muscleGroup: 'triceps', isUnilateral: true },
	{ id: 'db-skull-crushers',      name: 'Dumbbell Skull Crushers',           type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'close-grip-db-press',    name: 'Close-Grip Dumbbell Press',         type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'db-kickbacks',           name: 'Dumbbell Kickbacks',                type: 'weightReps', muscleGroup: 'triceps', isUnilateral: true },
	// Machine
	{ id: 'tricep-dip',             name: 'Tricep Dip',                        type: 'bodyweightReps', muscleGroup: 'triceps' },
	{ id: 'triceps-dip-machine',    name: 'Triceps Dip Machine',               type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'assisted-dip-machine',   name: 'Assisted Dip Machine',              type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'triceps-extension-machine', name: 'Triceps Extension Machine',      type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'overhead-tricep-ext',    name: 'Overhead Tricep Extension',         type: 'weightReps', muscleGroup: 'triceps' },
	// Cable
	{ id: 'tricep-pushdown',        name: 'Triceps Pushdown (Bar)',             type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'rope-pushdown',          name: 'Rope Pushdown',                     type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'one-arm-cable-pushdown', name: 'One-Arm Cable Pushdown',            type: 'weightReps', muscleGroup: 'triceps', isUnilateral: true },
	{ id: 'overhead-cable-extension', name: 'Overhead Cable Extension',        type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'one-arm-overhead-cable-ext', name: 'One-Arm Overhead Cable Extension', type: 'weightReps', muscleGroup: 'triceps', isUnilateral: true },
	{ id: 'reverse-grip-pushdown',  name: 'Reverse Grip Pushdown',             type: 'weightReps', muscleGroup: 'triceps' },

	// ── LEGS ───────────────────────────────────────────────────────────────
	// Barbell
	{ id: 'squat',                  name: 'Squat',                             type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'front-squat',            name: 'Front Squat',                       type: 'weightReps', muscleGroup: 'legs' },
	// Dumbbell
	{ id: 'goblet-squat',           name: 'Goblet Squat',                      type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'db-squat',               name: 'Dumbbell Squat',                    type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'db-rdl',                 name: 'Dumbbell Romanian Deadlift',        type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'db-lunges',              name: 'Dumbbell Lunges',                   type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'walking-lunges',         name: 'Walking Lunges',                    type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'lunge',                  name: 'Lunge',                             type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'bulgarian-split',        name: 'Bulgarian Split Squat',             type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'step-ups',               name: 'Step-Ups',                          type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'single-leg-rdl',         name: 'Single-Leg Romanian Deadlift',      type: 'weightReps', muscleGroup: 'legs', isUnilateral: true },
	// Machine
	{ id: 'leg-press',              name: 'Leg Press',                         type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'incline-leg-press',      name: 'Incline Leg Press',                 type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'hack-squat',             name: 'Hack Squat',                        type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'hack-squat-machine',     name: 'Hack Squat Machine',                type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'leg-extension',          name: 'Leg Extension',                     type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'leg-curl',               name: 'Leg Curl',                          type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'seated-leg-curl',        name: 'Seated Leg Curl',                   type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'smith-machine-squat',    name: 'Smith Machine Squat',               type: 'weightReps', muscleGroup: 'legs' },
	// Cable
	{ id: 'cable-pull-through',     name: 'Cable Pull-Through',                type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'cable-squats',           name: 'Cable Squats',                      type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'cable-lunges',           name: 'Cable Lunges',                      type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'cable-rdl',              name: 'Cable Romanian Deadlift',           type: 'weightReps', muscleGroup: 'legs' },

	// ── GLUTES ─────────────────────────────────────────────────────────────
	{ id: 'hip-thrust',             name: 'Hip Thrust',                        type: 'weightReps', muscleGroup: 'glutes' },
	{ id: 'hip-thrust-machine',     name: 'Hip Thrust Machine',                type: 'weightReps', muscleGroup: 'glutes' },
	{ id: 'glute-bridge',           name: 'Glute Bridge',                      type: 'weightReps', muscleGroup: 'glutes' },
	{ id: 'glute-kickback-machine', name: 'Glute Kickback Machine',            type: 'weightReps', muscleGroup: 'glutes' },
	{ id: 'cable-kickback',         name: 'Cable Kickback',                    type: 'weightReps', muscleGroup: 'glutes' },
	{ id: 'one-leg-cable-kickback', name: 'One-Leg Cable Kickback',            type: 'weightReps', muscleGroup: 'glutes', isUnilateral: true },
	{ id: 'rdl',                    name: 'Romanian Deadlift',                 type: 'weightReps', muscleGroup: 'glutes' },

	// ── CORE ───────────────────────────────────────────────────────────────
	{ id: 'plank',                  name: 'Plank',                             type: 'time',           muscleGroup: 'core' },
	{ id: 'crunch',                 name: 'Crunch',                            type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'situp',                  name: 'Sit-Up',                            type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'weighted-situps',        name: 'Weighted Sit-Ups',                  type: 'weightReps',     muscleGroup: 'core' },
	{ id: 'leg-raise',              name: 'Leg Raise',                         type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'russian-twist',          name: 'Russian Twists',                    type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'side-bends',             name: 'Side Bends',                        type: 'weightReps',     muscleGroup: 'core' },
	{ id: 'one-arm-farmers-carry',  name: "One-Arm Farmer's Carry",            type: 'weightReps',     muscleGroup: 'core', isUnilateral: true },
	{ id: 'cable-crunch',           name: 'Cable Crunch',                      type: 'weightReps',     muscleGroup: 'core' },
	{ id: 'ab-crunch-machine',      name: 'Ab Crunch Machine',                 type: 'weightReps',     muscleGroup: 'core' },
	{ id: 'rotary-torso-machine',   name: 'Rotary Torso Machine',              type: 'weightReps',     muscleGroup: 'core' },
	{ id: 'ab-wheel',               name: 'Ab Wheel Rollout',                  type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'hanging-cable-crunch',   name: 'Hanging Cable Crunch',              type: 'weightReps',     muscleGroup: 'core' },
	{ id: 'pallof-press',           name: 'Pallof Press',                      type: 'weightReps',     muscleGroup: 'core' },
	{ id: 'one-arm-pallof-press',   name: 'One-Arm Pallof Press',              type: 'weightReps',     muscleGroup: 'core', isUnilateral: true },
	{ id: 'cable-woodchoppers',     name: 'Cable Woodchoppers',                type: 'weightReps',     muscleGroup: 'core' },

	// ── CARDIO ─────────────────────────────────────────────────────────────
	{ id: 'running',                name: 'Running',                           type: 'distance', muscleGroup: 'cardio' },
	{ id: 'cycling',                name: 'Cycling',                           type: 'distance', muscleGroup: 'cardio' },
	{ id: 'rowing',                 name: 'Rowing',                            type: 'distance', muscleGroup: 'cardio' },
	{ id: 'crosstrainer',           name: 'Crosstrainer',                      type: 'time',     muscleGroup: 'cardio' },
	{ id: 'stairmaster',            name: 'Stairmaster',                       type: 'time',     muscleGroup: 'cardio' },
	{ id: 'jumping-jacks',          name: 'Jumping Jacks',                     type: 'time',     muscleGroup: 'cardio' },
	{ id: 'jump-rope',              name: 'Jump Rope',                         type: 'time',     muscleGroup: 'cardio' },
];

export async function seedDefaultExercises() {
	const entries = defaultExercises.map((e) => ({ ...e, isCustom: false }));
	await db.exercises.bulkPut(entries);

	// One-time migration: clear isUnilateral from built-in exercises that no longer have it set.
	if (typeof localStorage !== 'undefined' && !localStorage.getItem('unilateralCleanV1')) {
		const ids = entries.filter((e) => !e.isUnilateral).map((e) => e.id);
		await db.exercises.where('id').anyOf(ids).modify((ex) => { ex.isUnilateral = false; });
		localStorage.setItem('unilateralCleanV1', '1');
	}
}
