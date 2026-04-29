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

export type PRBucket = '1RM' | '3RM' | '5RM' | '8RM' | '10RM' | '12RM' | '13+RM';
export type PRCategory = 'strength' | 'duration' | 'distance';

export interface Exercise {
	id: string;
	name: string;
	type: ExerciseType;
	muscleGroup: MuscleGroup;
	isCustom: boolean;
	notes?: string;
	_synced?: boolean;
	_lastModified?: number;
}

export interface Workout {
	id: string;
	date: Date;
	name?: string;
	notes?: string;
	durationSec?: number;
	finishedAt?: Date;
	_synced?: boolean;
	_lastModified?: number;
}

export interface WorkoutExercise {
	id: string;
	workoutId: string;
	exerciseId: string;
	order: number;
	notes?: string;
	_synced?: boolean;
	_lastModified?: number;
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
	_synced?: boolean;
	_lastModified?: number;
}

export interface Routine {
	id: string;
	name: string;
	createdAt: Date;
	_synced?: boolean;
	_lastModified?: number;
}

export interface RoutineExercise {
	id: string;
	routineId: string;
	exerciseId: string;
	order: number;
	targetSets?: number;
	targetReps?: number;
	_synced?: boolean;
	_lastModified?: number;
}

/** v4 shape — bucketed, per-set PRs */
export interface PersonalRecord {
	id: string;
	exerciseId: string;
	category: PRCategory;          // 'strength' | 'duration' | 'distance'
	bucket?: PRBucket;             // strength only: '1RM' | '3RM' | '5RM' | '8RM' | '10RM' | '12RM' | '13+RM'
	weight?: number;               // strength: kg lifted
	reps?: number;                 // strength: actual reps performed
	durationSec?: number;          // duration PR
	distanceM?: number;            // distance PR
	date: Date;
	workoutId: string;
	setId: string;
	_synced?: boolean;
	_lastModified?: number;
}

export interface Tombstone {
	id: string; // same as the deleted entity's id
	// S6/H11: all entity types that can be hard-deleted and need remote cleanup
	entity: 'workout' | 'workoutExercise' | 'set' | 'exercise' | 'routine' | 'routineExercise' | 'personalRecord';
	entityId: string;
	deletedAt: Date;
	_synced: boolean;
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
	tombstones!: EntityTable<Tombstone, 'id'>;

	constructor() {
		super('IronLog');

		// v1 — original schema
		this.version(1).stores({
			exercises: 'id, name, type, muscleGroup, isCustom',
			workouts: 'id, date, finishedAt',
			workoutExercises: 'id, workoutId, exerciseId, order',
			sets: 'id, workoutExerciseId, order',
			routines: 'id, name, createdAt',
			routineExercises: 'id, routineId, exerciseId, order',
			personalRecords: 'id, exerciseId, date'
		});

		// v2 — add _synced and _lastModified for cloud sync
		this.version(2)
			.stores({
				exercises: 'id, name, type, muscleGroup, isCustom, _synced',
				workouts: 'id, date, finishedAt, _synced',
				workoutExercises: 'id, workoutId, exerciseId, order, _synced',
				sets: 'id, workoutExerciseId, order, _synced',
				routines: 'id, name, createdAt, _synced',
				routineExercises: 'id, routineId, exerciseId, order, _synced',
				personalRecords: 'id, exerciseId, date, _synced'
			})
			.upgrade((tx) => {
				const now = Date.now();
				return Promise.all([
					tx.table('exercises').toCollection().modify({ _synced: false, _lastModified: now }),
					tx.table('workouts').toCollection().modify({ _synced: false, _lastModified: now }),
					tx.table('workoutExercises').toCollection().modify({ _synced: false, _lastModified: now }),
					tx.table('sets').toCollection().modify({ _synced: false, _lastModified: now }),
					tx.table('routines').toCollection().modify({ _synced: false, _lastModified: now }),
					tx.table('routineExercises').toCollection().modify({ _synced: false, _lastModified: now }),
					tx.table('personalRecords').toCollection().modify({ _synced: false, _lastModified: now })
				]);
			});

		// v3 — add tombstones table for reliable cloud deletes
		this.version(3).stores({
			exercises: 'id, name, type, muscleGroup, isCustom, _synced',
			workouts: 'id, date, finishedAt, _synced',
			workoutExercises: 'id, workoutId, exerciseId, order, _synced',
			sets: 'id, workoutExerciseId, order, _synced',
			routines: 'id, name, createdAt, _synced',
			routineExercises: 'id, routineId, exerciseId, order, _synced',
			personalRecords: 'id, exerciseId, date, _synced',
			tombstones: 'id, entity, entityId, _synced'
		});

		// v4 — bucketed PRs: new shape with category, bucket, workoutId, setId
		this.version(4)
			.stores({
				exercises: 'id, name, type, muscleGroup, isCustom, _synced',
				workouts: 'id, date, finishedAt, _synced',
				workoutExercises: 'id, workoutId, exerciseId, order, _synced',
				sets: 'id, workoutExerciseId, order, _synced',
				routines: 'id, name, createdAt, _synced',
				routineExercises: 'id, routineId, exerciseId, order, _synced',
				personalRecords: 'id, exerciseId, category, bucket, workoutId, setId, date, [exerciseId+category+bucket], _synced',
				tombstones: 'id, entity, entityId, _synced'
			})
			.upgrade(async (tx) => {
				// Wipe old-format PRs — recomputeAllPRs() runs on next app load
				await tx.table('personalRecords').clear();
				// S7: localStorage must NOT be called inside the IDB upgrade transaction.
				// The guard is removed in +layout.svelte's onMount AFTER the DB opens.
			});
	}
}

export const db = new IronLogDB();
