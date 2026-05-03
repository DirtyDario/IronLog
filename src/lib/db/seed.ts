import { db, type Exercise } from './schema';

const defaultExercises: Omit<Exercise, 'isCustom'>[] = [
	// Chest
	{ id: 'bench-press', name: 'Bench Press', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'incline-bench', name: 'Incline Bench Press', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'decline-bench', name: 'Decline Bench Press', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'db-bench-press', name: 'Dumbbell Bench Press', type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	{ id: 'db-incline-press', name: 'Incline Dumbbell Press', type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	{ id: 'db-decline-press', name: 'Decline Dumbbell Press', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'db-pullover', name: 'Dumbbell Pullover', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'dumbbell-fly', name: 'Dumbbell Fly', type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	{ id: 'db-incline-fly', name: 'Incline Dumbbell Fly', type: 'weightReps', muscleGroup: 'chest', isUnilateral: true },
	{ id: 'cable-fly', name: 'Cable Fly', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'chest-fly-machine', name: 'Chest Fly Machine', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'decline-chest-machine', name: 'Decline Chest Press Machine', type: 'weightReps', muscleGroup: 'chest' },
	{ id: 'pushup', name: 'Push-Up', type: 'bodyweightReps', muscleGroup: 'chest' },
	{ id: 'dip', name: 'Dip', type: 'bodyweightReps', muscleGroup: 'chest' },

	// Back
	{ id: 'deadlift', name: 'Deadlift', type: 'weightReps', muscleGroup: 'back' },
	{ id: 'pullup', name: 'Pull-Up', type: 'bodyweightReps', muscleGroup: 'back' },
	{ id: 'chinup', name: 'Chin-Up', type: 'bodyweightReps', muscleGroup: 'back' },
	{ id: 'barbell-row', name: 'Barbell Row', type: 'weightReps', muscleGroup: 'back' },
	{ id: 'dumbbell-row', name: 'Dumbbell Row', type: 'weightReps', muscleGroup: 'back', isUnilateral: true },
	{ id: 'lat-pulldown', name: 'Lat Pulldown', type: 'weightReps', muscleGroup: 'back' },
	{ id: 'seated-cable-row', name: 'Seated Cable Row', type: 'weightReps', muscleGroup: 'back' },
	{ id: 'tbar-row', name: 'T-Bar Row', type: 'weightReps', muscleGroup: 'back' },

	// Shoulders
	{ id: 'overhead-press', name: 'Overhead Press', type: 'weightReps', muscleGroup: 'shoulders' },
	{
		id: 'dumbbell-shoulder-press',
		name: 'Dumbbell Shoulder Press',
		type: 'weightReps',
		muscleGroup: 'shoulders',
		isUnilateral: true
	},
	{
		id: 'shoulder-press-machine',
		name: 'Shoulder Press Machine',
		type: 'weightReps',
		muscleGroup: 'shoulders'
	},
	{ id: 'lateral-raise', name: 'Lateral Raise', type: 'weightReps', muscleGroup: 'shoulders', isUnilateral: true },
	{ id: 'front-raise', name: 'Front Raise', type: 'weightReps', muscleGroup: 'shoulders', isUnilateral: true },
	{ id: 'face-pull', name: 'Face Pull', type: 'weightReps', muscleGroup: 'shoulders' },
	{ id: 'upright-row', name: 'Upright Row', type: 'weightReps', muscleGroup: 'shoulders' },

	// Biceps
	{ id: 'barbell-curl', name: 'Barbell Curl', type: 'weightReps', muscleGroup: 'biceps' },
	{ id: 'dumbbell-curl', name: 'Dumbbell Curl', type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },
	{ id: 'hammer-curl', name: 'Hammer Curl', type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },
	{ id: 'incline-curl', name: 'Incline Curl', type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },
	{ id: 'cable-curl', name: 'Cable Curl', type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },
	{ id: 'preacher-curl', name: 'Preacher Curl', type: 'weightReps', muscleGroup: 'biceps', isUnilateral: true },

	// Triceps
	{ id: 'tricep-pushdown', name: 'Tricep Pushdown', type: 'weightReps', muscleGroup: 'triceps' },
	{
		id: 'skull-crusher',
		name: 'Skull Crusher',
		type: 'weightReps',
		muscleGroup: 'triceps'
	},
	{
		id: 'overhead-tricep-ext',
		name: 'Overhead Tricep Extension',
		type: 'weightReps',
		muscleGroup: 'triceps'
	},
	{ id: 'close-grip-bench', name: 'Close Grip Bench Press', type: 'weightReps', muscleGroup: 'triceps' },
	{ id: 'tricep-dip', name: 'Tricep Dip', type: 'bodyweightReps', muscleGroup: 'triceps' },

	// Legs
	{ id: 'squat', name: 'Squat', type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'front-squat', name: 'Front Squat', type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'leg-press', name: 'Leg Press', type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'leg-extension', name: 'Leg Extension', type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'leg-curl', name: 'Leg Curl', type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'lunge', name: 'Lunge', type: 'weightReps', muscleGroup: 'legs', isUnilateral: true },
	{ id: 'bulgarian-split', name: 'Bulgarian Split Squat', type: 'weightReps', muscleGroup: 'legs', isUnilateral: true },
	{ id: 'calf-raise', name: 'Calf Raise', type: 'weightReps', muscleGroup: 'legs' },
	{ id: 'hack-squat', name: 'Hack Squat', type: 'weightReps', muscleGroup: 'legs' },

	// Glutes
	{ id: 'hip-thrust', name: 'Hip Thrust', type: 'weightReps', muscleGroup: 'glutes' },
	{ id: 'glute-bridge', name: 'Glute Bridge', type: 'weightReps', muscleGroup: 'glutes' },
	{ id: 'cable-kickback', name: 'Cable Kickback', type: 'weightReps', muscleGroup: 'glutes', isUnilateral: true },
	{ id: 'rdl', name: 'Romanian Deadlift', type: 'weightReps', muscleGroup: 'glutes' },

	// Core
	{ id: 'plank', name: 'Plank', type: 'time', muscleGroup: 'core' },
	{ id: 'crunch', name: 'Crunch', type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'situp', name: 'Sit-Up', type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'leg-raise', name: 'Leg Raise', type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'russian-twist', name: 'Russian Twist', type: 'bodyweightReps', muscleGroup: 'core' },
	{ id: 'cable-crunch', name: 'Cable Crunch', type: 'weightReps', muscleGroup: 'core' },
	{ id: 'ab-wheel', name: 'Ab Wheel Rollout', type: 'bodyweightReps', muscleGroup: 'core' },

	// Cardio
	{ id: 'running', name: 'Running', type: 'distance', muscleGroup: 'cardio' },
	{ id: 'cycling', name: 'Cycling', type: 'distance', muscleGroup: 'cardio' },
	{ id: 'rowing', name: 'Rowing', type: 'distance', muscleGroup: 'cardio' },
	{ id: 'crosstrainer', name: 'Crosstrainer', type: 'time', muscleGroup: 'cardio' },
	{ id: 'stairmaster', name: 'Stairmaster', type: 'time', muscleGroup: 'cardio' },
	{ id: 'jumping-jacks', name: 'Jumping Jacks', type: 'time', muscleGroup: 'cardio' },
	{ id: 'jump-rope', name: 'Jump Rope', type: 'time', muscleGroup: 'cardio' }
];

export async function seedDefaultExercises() {
	await db.exercises.bulkPut(
		defaultExercises.map((e) => ({ ...e, isCustom: false }))
	);
}
