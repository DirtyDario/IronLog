import { writable, get } from 'svelte/store';
import { db } from '$lib/db/schema';
import type { Workout, WorkoutExercise, ExerciseSet } from '$lib/db/schema';
import { schedulePush } from '$lib/services/sync';
import { getLastFinishedSetsFor, type LastWorkoutInfo } from '$lib/services/lastWorkout';
import { restTimer } from '$lib/stores/restTimer';
import { detectPRsForWorkout } from '$lib/services/pr';

interface ActiveWorkoutState {
	workout: Workout | null;
	workoutExercises: WorkoutExercise[];
	sets: Record<string, ExerciseSet[]>; // keyed by workoutExerciseId
	startedAt: Date | null;
	previousSets: Record<string, LastWorkoutInfo | null>; // keyed by workoutExerciseId
	lastDiscarded: {
		workout: Workout;
		workoutExercises: WorkoutExercise[];
		sets: Record<string, ExerciseSet[]>;
		previousSets: Record<string, LastWorkoutInfo | null>;
		startedAt: Date | null;
		autoCompleteNotice: null;
	} | null;
	rehydrating: boolean; // H12: true while async rehydrate() is in progress
	autoCompleteNotice: 'finished' | 'discarded' | null;
}

function syncMeta() {
	return { _synced: false as const, _lastModified: Date.now() };
}

async function writeTombstone(entity: 'workout' | 'workoutExercise' | 'set', entityId: string) {
	await db.tombstones.put({
		id: entityId,
		entity,
		entityId,
		deletedAt: new Date(),
		_synced: false
	});
}

function createActiveWorkoutStore() {
	const { subscribe, set, update } = writable<ActiveWorkoutState>({
		workout: null,
		workoutExercises: [],
		sets: {},
		startedAt: null,
		previousSets: {},
		lastDiscarded: null,
		rehydrating: false,
		autoCompleteNotice: null
	});

	// Bug fix (undo-discard race): the pending "actually delete this" discard
	// for the current undo window. Tracked at module scope (not just a bare
	// timeout handle — see finalizePendingDiscard below for why) so
	// restoreDiscarded()/start()/discard() can all reason about it.
	let pendingDiscard: { snapshot: DiscardSnapshot; timeoutId: ReturnType<typeof setTimeout> } | null = null;

	type DiscardSnapshot = {
		workout: Workout;
		workoutExercises: WorkoutExercise[];
		sets: Record<string, ExerciseSet[]>;
		previousSets: Record<string, LastWorkoutInfo | null>;
		startedAt: Date | null;
		autoCompleteNotice: null;
	};

	// Actually tombstone + hard-delete a discarded workout from Dexie and push.
	// Split out so both the deferred (undo-able) and immediate (auto-discard)
	// discard paths share the exact same delete logic.
	async function performDiscardDelete(snapshot: DiscardSnapshot) {
		const weIds = snapshot.workoutExercises.map((we) => we.id);
		const setIds = Object.values(snapshot.sets).flat().map((s) => s.id);

		// Tombstones (FK order: sets → workoutExercises → workouts)
		await Promise.all(setIds.map((id) => writeTombstone('set', id)));
		await Promise.all(weIds.map((id) => writeTombstone('workoutExercise', id)));
		await writeTombstone('workout', snapshot.workout.id);

		// Hard-delete from Dexie
		for (const weId of weIds) {
			await db.sets.where('workoutExerciseId').equals(weId).delete();
		}
		await db.workoutExercises.where('workoutId').equals(snapshot.workout.id).delete();
		await db.workouts.delete(snapshot.workout.id);
	}

	// Bug fix: if a NEW discard() (or start()) happens while a PREVIOUS
	// discard's 5s undo window is still pending, that previous timer's data
	// must not be silently orphaned. Comparing against the store's current
	// `lastDiscarded` inside the timeout callback isn't enough, because any
	// subsequent `set(...)` call (e.g. starting a new workout) overwrites
	// `lastDiscarded` too, which would make the pending timeout think it was
	// "already restored" and skip the delete entirely — leaving the old
	// discarded workout's rows permanently in Dexie (unfinished, no
	// finishedAt), where rehydrate() could even resurrect them into view on
	// the next app load. So: whenever we're about to replace the pending
	// discard (new discard, or starting a fresh workout), finalize the
	// previous one's delete immediately instead of losing track of it.
	async function finalizePendingDiscard() {
		if (!pendingDiscard) return;
		const { snapshot, timeoutId } = pendingDiscard;
		clearTimeout(timeoutId);
		pendingDiscard = null;
		await performDiscardDelete(snapshot);
		schedulePush();
	}

	async function updateLastActivity(workoutId: string) {
		const ts = Date.now();
		await db.workouts.update(workoutId, { lastActivityAt: ts, _lastModified: ts });
		update((s) => s.workout ? { ...s, workout: { ...s.workout, lastActivityAt: ts } } : s);
	}

	return {
		subscribe,

		async rehydrate() {
			// H12: On app load (e.g. after page refresh), restore an in-progress workout
			// from IDB if the store is empty. Looks for the most recent unfinished workout.
			update((s) => ({ ...s, rehydrating: true }));
			try {
				// Bug fix: exclude workouts still marked pendingDiscardAt — these are
				// mid-discard (their 5s undo window's setTimeout was lost because the
				// app was closed/reloaded before it fired). Without this, closing the
				// app right after tapping Discard would resurrect the "discarded"
				// workout as if it were still active. finalizeOrphanedPendingDiscards()
				// (called from +layout.svelte on boot) actually deletes these shortly
				// after this runs.
				const unfinished = await db.workouts
					.filter((w) => !w.finishedAt && !w.pendingDiscardAt)
					.toArray();
				if (!unfinished.length) return;
				// Use most recently started (latest date)
				const workout = unfinished.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
				const workoutExercises = await db.workoutExercises.where('workoutId').equals(workout.id).sortBy('order');
				const sets: Record<string, ExerciseSet[]> = {};
				const previousSets: Record<string, LastWorkoutInfo | null> = {};
				for (const we of workoutExercises) {
					sets[we.id] = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order');
					previousSets[we.id] = await getLastFinishedSetsFor(we.exerciseId);
				}
				set({
					workout,
					workoutExercises,
					sets,
					startedAt: new Date(workout.date),
					previousSets,
					lastDiscarded: null,
					rehydrating: false,
					autoCompleteNotice: null
				});
			} finally {
				update((s) => ({ ...s, rehydrating: false }));
			}
		},

		async start(name?: string) {
			// Bug fix: if a previous discard's 5s undo window is still pending
			// when the user starts a new workout, finalize (actually delete) it
			// now instead of letting the upcoming `set(...)` call below silently
			// overwrite `lastDiscarded` and orphan that data forever.
			await finalizePendingDiscard();

			// Reset rest timer defensively. useDefault() (not just stop()) also
			// resets `total` back to the user's configured default — otherwise a
			// preset picked during a previous workout (e.g. tapping "3:00" once)
			// would silently carry over and keep being used for every future
			// workout's auto-started rests, ignoring the Settings default.
			restTimer.useDefault();
			const workout: Workout = {
				id: crypto.randomUUID(),
				date: new Date(),
				name,
				...syncMeta()
			};
			await db.workouts.add(workout);
			schedulePush();
			set({
				workout,
				workoutExercises: [],
				sets: {},
				startedAt: new Date(),
				previousSets: {},
				lastDiscarded: null,
				rehydrating: false,
				autoCompleteNotice: null
			});
			return workout;
		},

		async addExercise(exerciseId: string) {
			const state = get({ subscribe });
			if (!state.workout) return;
			const we: WorkoutExercise = {
				id: crypto.randomUUID(),
				workoutId: state.workout.id,
				exerciseId,
				order: state.workoutExercises.length,
				...syncMeta()
			};
			await db.workoutExercises.add(we);
			// Auto-fill pinned notes from the Exercise itself
			const exerciseData = await db.exercises.get(exerciseId);
			if (exerciseData?.notes) {
				we.notes = exerciseData.notes;
				await db.workoutExercises.update(we.id, { notes: exerciseData.notes });
			}
			schedulePush();
			if (state.workout) await updateLastActivity(state.workout.id);

			// Fetch last workout's sets for this exercise (for placeholder + header)
			const lastInfo = await getLastFinishedSetsFor(exerciseId);

			update((s) => ({
				...s,
				workoutExercises: [...s.workoutExercises, we],
				sets: { ...s.sets, [we.id]: [] },
				previousSets: { ...s.previousSets, [we.id]: lastInfo }
			}));
			return we;
		},

		async addSet(workoutExerciseId: string, side?: 'left' | 'right') {
			const state = get({ subscribe });
			const existing = state.sets[workoutExerciseId] ?? [];
			// Do NOT pre-populate weight/reps — show as placeholder only
			const newSet: ExerciseSet = {
				id: crypto.randomUUID(),
				workoutExerciseId,
				order: existing.length,
				side,
				weight: undefined,
				reps: undefined,
				durationSec: undefined,
				distanceM: undefined,
				isWarmup: false,
				completed: false,
				...syncMeta()
			};
			await db.sets.add(newSet);
			schedulePush();
			if (state.workout) await updateLastActivity(state.workout.id);
			update((s) => ({
				...s,
				sets: {
					...s.sets,
					[workoutExerciseId]: [...(s.sets[workoutExerciseId] ?? []), newSet]
				}
			}));
			return newSet;
		},

		async updateSet(setId: string, workoutExerciseId: string, changes: Partial<ExerciseSet>) {
			const meta = syncMeta();
			await db.sets.update(setId, { ...changes, ...meta });
			schedulePush();
			if (changes.completed === true) {
				const state = get({ subscribe });
				if (state.workout) await updateLastActivity(state.workout.id);
			}
			update((s) => ({
				...s,
				sets: {
					...s.sets,
					// Bug fix: guard against a missing sets array (unlike addSet's `?? []`,
					// this previously assumed s.sets[workoutExerciseId] always existed and
					// could throw "Cannot read properties of undefined" in edge cases (e.g.
					// updating a set for a workoutExercise whose sets array wasn't populated
					// yet, such as immediately after a rehydrate race).
					[workoutExerciseId]: (s.sets[workoutExerciseId] ?? []).map((st) =>
						st.id === setId ? { ...st, ...changes, ...meta } : st
					)
				}
			}));
		},

		async deleteSet(setId: string, workoutExerciseId: string) {
			await writeTombstone('set', setId); // H5: tombstone so remote copy is deleted
			await db.sets.delete(setId);
			schedulePush();
			update((s) => ({
				...s,
				sets: {
					...s.sets,
					[workoutExerciseId]: s.sets[workoutExerciseId].filter((st) => st.id !== setId)
				}
			}));
		},

		async deleteExercise(workoutExerciseId: string) {
			// H6: tombstone all sets and the workoutExercise before hard-deleting
			const setsToDelete = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray();
			await Promise.all(setsToDelete.map((s) => writeTombstone('set', s.id)));
			await writeTombstone('workoutExercise', workoutExerciseId);
			await db.sets.where('workoutExerciseId').equals(workoutExerciseId).delete();
			await db.workoutExercises.delete(workoutExerciseId);
			schedulePush();
			update((s) => {
				const sets = { ...s.sets };
				const previousSets = { ...s.previousSets };
				delete sets[workoutExerciseId];
				delete previousSets[workoutExerciseId];
				return {
					...s,
					workoutExercises: s.workoutExercises.filter((we) => we.id !== workoutExerciseId),
					sets,
					previousSets
				};
			});
		},

		async finish(resolvedSets?: Array<{ id: string; weight?: number; reps?: number; durationSec?: number; distanceM?: number }>) {
			const state = get({ subscribe });
			if (!state.workout || !state.startedAt) return [];

			// Apply pre-resolved set values from the page (which knows placeholder values)
			// then mark completed. Only sets included in resolvedSets (reps/value present) are completed.
			if (resolvedSets && resolvedSets.length > 0) {
				await Promise.all(
					resolvedSets.map((r) =>
						db.sets.update(r.id, {
							...(r.weight != null ? { weight: r.weight } : {}),
							...(r.reps != null ? { reps: r.reps } : {}),
							...(r.durationSec != null ? { durationSec: r.durationSec } : {}),
							...(r.distanceM != null ? { distanceM: r.distanceM } : {}),
							completed: true,
							...syncMeta()
						})
					)
				);
			}

			const workoutId = state.workout.id;
			const durationSec = Math.round((Date.now() - state.startedAt.getTime()) / 1000);
			await db.workouts.update(workoutId, { finishedAt: new Date(), durationSec, ...syncMeta() });
			schedulePush();

			// S9: Detect PRs BEFORE clearing store (detectPRsForWorkout queries DB by workoutId,
			// but store clear is synchronous — workout data is still in IDB at this point,
			// so order doesn't strictly matter for DB queries, but clearing store first
			// caused a race where navigation happened before PRs were saved).
			const newPRs = await detectPRsForWorkout(workoutId);

			// Reset rest timer
			restTimer.stop();

			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, previousSets: {}, lastDiscarded: null, rehydrating: false, autoCompleteNotice: null });

			return newPRs;
		},

		async renameWorkout(name: string) {
			const state = get({ subscribe });
			if (!state.workout) return;
			await db.workouts.update(state.workout.id, { name, ...syncMeta() });
			schedulePush();
			update((s) => s.workout ? { ...s, workout: { ...s.workout, name } } : s);
		},

		async reorderExercises(newList: WorkoutExercise[]) {
			const updated = newList.map((we, i) => ({ ...we, order: i }));
			await Promise.all(
				updated.map((we) =>
					db.workoutExercises.update(we.id, { order: we.order, _synced: false, _lastModified: Date.now() })
				)
			);
			schedulePush();
			update((s) => ({ ...s, workoutExercises: updated }));
		},

		async discard(opts?: { immediate?: boolean }) {
			const state = get({ subscribe });
			if (!state.workout) return;

			// Bug fix: if there's already a pending (undo-able) discard from
			// before this one, finalize it now rather than letting this new
			// discard's `set(...)` call silently overwrite `lastDiscarded` and
			// orphan the earlier snapshot's data forever.
			await finalizePendingDiscard();

			// Snapshot for undo BEFORE clearing state
			// M8: use structuredClone to deep-clone so Svelte proxy objects don't leak into Dexie
			const snapshot: DiscardSnapshot = structuredClone({
				workout: state.workout,
				workoutExercises: [...state.workoutExercises],
				sets: { ...state.sets },
				previousSets: { ...state.previousSets },
				startedAt: state.startedAt,
				autoCompleteNotice: null
			});

			// Clear UI immediately (feels instant)
			restTimer.stop();

			if (opts?.immediate) {
				// No undo window (used by checkAutoComplete for background
				// auto-discards, where there's no interactive snackbar) — delete
				// right away, same as before.
				set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, previousSets: {}, lastDiscarded: null, rehydrating: false, autoCompleteNotice: null });
				await performDiscardDelete(snapshot);
				schedulePush();
				return;
			}

			set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, previousSets: {}, lastDiscarded: snapshot, rehydrating: false, autoCompleteNotice: null });

			// Bug fix: persist a lightweight LOCAL-ONLY marker on the workout row
			// right away (never synced — see schema.ts) so that if the app is
			// closed/reloaded during the 5s undo window (the in-memory setTimeout
			// below would be lost), rehydrate() won't resurrect this workout as
			// still-active, and finalizeOrphanedPendingDiscards() (called on next
			// app boot) can actually finish deleting it.
			await db.workouts.update(snapshot.workout.id, { pendingDiscardAt: Date.now() });

			// Bug fix (undo-discard race): previously the tombstones + hard-delete
			// ran synchronously right here, and only the schedulePush() call was
			// delayed 5s (C4). But ANY unrelated schedulePush() elsewhere in the
			// app (e.g. a debounced push already queued from a prior set edit)
			// would flush these just-written tombstones to Supabase well before
			// the 5s undo window closed, defeating the undo guarantee.
			//
			// Fix: defer the tombstones + hard-delete themselves until the undo
			// window actually closes. Nothing is marked _synced:false or deleted
			// from Dexie until we're sure the user didn't tap Undo, so there is
			// nothing for a stray schedulePush() to prematurely flush.
			//
			// pendingDiscard (not just a bare timeout) is tracked at module scope
			// so start()/discard() can finalize a still-pending previous discard
			// instead of losing track of it (see finalizePendingDiscard above).
			const timeoutId = setTimeout(async () => {
				// Only proceed if we're still the current pending discard — if
				// restoreDiscarded()/finalizePendingDiscard() already handled us,
				// pendingDiscard will have moved on or been cleared.
				if (pendingDiscard?.snapshot !== snapshot) return;
				pendingDiscard = null;

				await performDiscardDelete(snapshot);
				schedulePush();
				update((st) =>
					st.lastDiscarded?.workout.id === snapshot.workout.id ? { ...st, lastDiscarded: null } : st
				);
			}, 5000);
			pendingDiscard = { snapshot, timeoutId };
		},

		async restoreDiscarded() {
			const state = get({ subscribe });
			const snap = state.lastDiscarded;
			if (!snap) return;

			// Cancel the pending delete. Since discard() now defers all Dexie
			// mutations until the undo window closes, nothing has actually been
			// tombstoned or deleted yet — we only need to stop the timer and
			// restore the in-memory state. No DB repair/undo needed.
			if (pendingDiscard?.snapshot.workout.id === snap.workout.id) {
				clearTimeout(pendingDiscard.timeoutId);
				pendingDiscard = null;
			}

			// Clear the local-only pendingDiscardAt marker written at discard()
			// time — the workout row itself was never actually deleted, only
			// flagged, so we just need to un-flag it.
			await db.workouts.update(snap.workout.id, { pendingDiscardAt: undefined });

			// Restore state
			set({
				workout: snap.workout,
				workoutExercises: snap.workoutExercises,
				sets: snap.sets,
				startedAt: snap.startedAt,
				previousSets: snap.previousSets,
				lastDiscarded: null,
				rehydrating: false,
				autoCompleteNotice: null
			});
		},

		async updateExerciseNotes(workoutExerciseId: string, notes: string) {
			const meta = syncMeta();
			await db.workoutExercises.update(workoutExerciseId, { notes, ...meta });
			schedulePush();
			update((s) => ({
				...s,
				workoutExercises: s.workoutExercises.map((we) =>
					we.id === workoutExerciseId ? { ...we, notes, ...meta } : we
				)
			}));
		},

		async pinExerciseNotes(exerciseId: string, notes: string) {
			// Save notes permanently on the Exercise itself
			const meta = syncMeta();
			await db.exercises.update(exerciseId, { notes: notes || undefined, ...meta });
			schedulePush();
		},

		clearAutoCompleteNotice() {
			update((s) => ({ ...s, autoCompleteNotice: null }));
		},

		async checkAutoComplete() {
			// Called from layout on app load after rehydrate()
			const state = get({ subscribe });
			if (!state.workout) return;
			const workout = state.workout;
			const lastActivity = workout.lastActivityAt ?? new Date(workout.date).getTime();
			const elapsed = Date.now() - lastActivity;
			if (elapsed < 60 * 60 * 1000) return; // less than 1h → do nothing

			// Check if there are any completed sets
			const allSets = Object.values(state.sets).flat();
			const completedSets = allSets.filter((s) => s.completed);

			if (completedSets.length === 0) {
				// No completed sets → discard immediately (no interactive undo
				// snackbar is shown for this background/automatic path, so there's
				// no reason to defer the delete).
				await activeWorkout.discard({ immediate: true });
				update((s) => ({ ...s, autoCompleteNotice: 'discarded' as const, lastDiscarded: null }));
			} else {
				// Has completed sets → finish with lastActivityAt as finishedAt
				const workoutId = workout.id;
				const finishedAt = new Date(lastActivity);
				const durationSec = Math.round((lastActivity - new Date(workout.date).getTime()) / 1000);

				// Remove incomplete sets (tombstone them)
				const incompleteSets = allSets.filter((s) => !s.completed);
				for (const s of incompleteSets) {
					await writeTombstone('set', s.id);
					await db.sets.delete(s.id);
				}

				await db.workouts.update(workoutId, { finishedAt, durationSec, ...syncMeta() });
				schedulePush();

				await detectPRsForWorkout(workoutId);

				set({ workout: null, workoutExercises: [], sets: {}, startedAt: null, previousSets: {}, lastDiscarded: null, rehydrating: false, autoCompleteNotice: 'finished' });
			}
		},

		// Bug fix: if the app was closed/reloaded during a discard's 5s undo
		// window, the in-memory setTimeout that would have finalized the delete
		// is lost — the pendingDiscardAt-marked workout would otherwise linger
		// in Dexie forever (rehydrate() already knows to skip it as "active",
		// but it should still actually be deleted). Call this once on app boot
		// (after rehydrate(), before checkAutoComplete()) to sweep those up.
		async finalizeOrphanedPendingDiscards() {
			const orphaned = await db.workouts.filter((w) => !!w.pendingDiscardAt).toArray();
			if (!orphaned.length) return;
			for (const workout of orphaned) {
				const wes = await db.workoutExercises.where('workoutId').equals(workout.id).toArray();
				const weIds = wes.map((we) => we.id);
				const sets = (
					await Promise.all(weIds.map((weId) => db.sets.where('workoutExerciseId').equals(weId).toArray()))
				).flat();

				await Promise.all(sets.map((s) => writeTombstone('set', s.id)));
				await Promise.all(weIds.map((id) => writeTombstone('workoutExercise', id)));
				await writeTombstone('workout', workout.id);

				await Promise.all(weIds.map((weId) => db.sets.where('workoutExerciseId').equals(weId).delete()));
				await db.workoutExercises.where('workoutId').equals(workout.id).delete();
				await db.workouts.delete(workout.id);
			}
			schedulePush();
		}
	};
}

export const activeWorkout = createActiveWorkoutStore();
