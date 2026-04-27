import Dexie, { type EntityTable } from 'dexie';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExerciseType = 'weightReps' | 'bodyweightReps' | 'time' | 'distance';

export type MuscleGroup =
	| 'chest'
	| 'back'
	| 'shoulders'
	| 'biceps'
	| 'triceps'
	| 'legs'
	| 'glutes'
	| 'core'
	| 'cardio'
	| 'full body'
	| 'other';

export interface Exercise {
	id: string;
	name: string;
	type: ExerciseType;
	muscleGroup: MuscleGroup;
	isCustom: boolean;
	notes?: string;
}

export interface Workout {
	id: string;
	date: Date;
	name?: string;
	notes?: string;
	durationSec?: number;
	finishedAt?: Date;
}

export interface WorkoutExercise {
	id: string;
	workoutId: string;
	exerciseId: string;
	order: number;
	notes?: string;
}

export interface ExerciseSet {
	id: string;
	workoutExerciseId: string;
	order: number;
	weight?: number; // kg
	reps?: number;
	durationSec?: number;
	distanceM?: number;
	isWarmup: boolean;
	completed: boolean;
	notes?: string;
}

export interface Routine {
	id: string;
	name: string;
	createdAt: Date;
}

export interface RoutineExercise {
	id: string;
	routineId: string;
	exerciseId: string;
	order: number;
	targetSets?: number;
	targetReps?: number;
}

export interface PersonalRecord {
	id: string;
	exerciseId: string;
	date: Date;
	weight?: number;
	reps?: number;
	estimatedOneRM?: number; // Epley formula
	durationSec?: number;
	distanceM?: number;
}

// ─── Database ─────────────────────────────────────────────────────────────────

export class IronLogDB extends Dexie {
	exercises!: EntityTable<Exercise, 'id'>;
	workouts!: EntityTable<Workout, 'id'>;
	workoutExercises!: EntityTable<WorkoutExercise, 'id'>;
	sets!: EntityTable<ExerciseSet, 'id'>;
	routines!: EntityTable<Routine, 'id'>;
	routineExercises!: EntityTable<RoutineExercise, 'id'>;
	personalRecords!: EntityTable<PersonalRecord, 'id'>;

	constructor() {
		super('IronLog');
		this.version(1).stores({
			exercises: 'id, name, type, muscleGroup, isCustom',
			workouts: 'id, date, finishedAt',
			workoutExercises: 'id, workoutId, exerciseId, order',
			sets: 'id, workoutExerciseId, order',
			routines: 'id, name, createdAt',
			routineExercises: 'id, routineId, exerciseId, order',
			personalRecords: 'id, exerciseId, date'
		});
	}
}

export const db = new IronLogDB();
