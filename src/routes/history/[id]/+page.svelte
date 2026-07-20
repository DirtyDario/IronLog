<script lang="ts">
	import { page } from '$app/stores';
	import { db } from '$lib/db/schema';
	import type { Workout, WorkoutExercise, ExerciseSet, Exercise } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { schedulePush } from '$lib/services/sync';
	import { activeWorkout } from '$lib/stores/activeWorkout';
	import { recomputeAllPRs } from '$lib/services/pr';

	let workout: Workout | null = $state(null);
	// H1: exercise can be null if exercise was deleted — show placeholder
	let exercises: Array<{ we: WorkoutExercise; exercise: Exercise | null; sets: ExerciseSet[] }> = $state([]);

	onMount(async () => {
		const id = $page.params.id;
		// Guard against a missing route param (also narrows string|undefined ->
		// string for TypeScript, since $page.params is typed generically).
		if (!id) { goto('/history'); return; }
		workout = (await db.workouts.get(id)) ?? null;
		// M6: redirect to 404-like state if workout not found
		if (!workout) { goto('/history'); return; }

		const wes = await db.workoutExercises.where('workoutId').equals(id).sortBy('order');
		const result = [];
		for (const we of wes) {
			const exercise = (await db.exercises.get(we.exerciseId)) ?? null; // H1: null if deleted
			const sets = (await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order'))
				.filter((s) => s.completed);
			result.push({ we, exercise, sets }); // H1: always push even if exercise is null
		}
		exercises = result;
	});

	function formatDate(d: Date) {
		return new Date(d).toLocaleDateString('en-GB', {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
		});
	}

	function formatSet(set: ExerciseSet, type: string) {
		if (type === 'weightReps') return `${set.weight ?? '-'} kg × ${set.reps ?? '-'}`;
		if (type === 'bodyweightReps') return `${set.reps ?? '-'} reps`;
		if (type === 'time') return `${set.durationSec ?? '-'}s`;
		if (type === 'distance') return `${set.distanceM ? (set.distanceM / 1000).toFixed(2) : '-'} km`;
		return '';
	}

	function formatDuration(sec?: number) {
		if (!sec) return '';
		const m = Math.floor(sec / 60);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}

	async function deleteWorkout() {
		if (!workout) return;
		// H7: get ALL sets (not just completed) so nothing leaks
		// H8: write tombstones so remote copies are deleted on next sync
		for (const { we } of exercises) {
			const allSets = await db.sets.where('workoutExerciseId').equals(we.id).toArray();
			await Promise.all(allSets.map((s) => db.tombstones.put({
				id: s.id, entity: 'set', entityId: s.id, deletedAt: new Date(), _synced: false
			})));
			await db.tombstones.put({ id: we.id, entity: 'workoutExercise', entityId: we.id, deletedAt: new Date(), _synced: false });
			await db.sets.bulkDelete(allSets.map((s) => s.id));
			await db.workoutExercises.delete(we.id);
		}
		await db.personalRecords.where('workoutId').equals(workout.id).delete();
		await db.tombstones.put({ id: workout.id, entity: 'workout', entityId: workout.id, deletedAt: new Date(), _synced: false });
		await db.workouts.delete(workout.id);
		schedulePush();
		goto('/history');
	}

	let showDelete = $state(false);
	let isStarting = $state(false);

	// ── Edit mode: fix forgotten/wrong sets on an already-finished workout ─────
	let editMode = $state(false);
	function syncMeta() {
		return { _synced: false as const, _lastModified: Date.now() };
	}

	async function reloadExercises() {
		if (!workout) return;
		const wes = await db.workoutExercises.where('workoutId').equals(workout.id).sortBy('order');
		const result = [];
		for (const we of wes) {
			const exercise = (await db.exercises.get(we.exerciseId)) ?? null;
			const sets = (await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order'))
				.filter((s) => s.completed);
			result.push({ we, exercise, sets });
		}
		exercises = result;
	}

	async function updateEditedSet(setId: string, type: string, field: 'weight' | 'reps' | 'durationSec' | 'distanceKm', raw: string) {
		const changes: Partial<ExerciseSet> = {};
		// Bug fix: `parseFloat(raw) || undefined` treated a legitimately-entered
		// 0 the same as an empty/invalid input, silently erasing it. Use an
		// explicit isNaN check instead so 0 is preserved as a real value.
		if (field === 'distanceKm') {
			const km = parseFloat(raw);
			changes.distanceM = isNaN(km) ? undefined : km * 1000;
		} else if (field === 'weight') {
			const w = parseFloat(raw);
			changes.weight = isNaN(w) ? undefined : w;
		} else if (field === 'reps') {
			const r = parseInt(raw);
			changes.reps = isNaN(r) ? undefined : r;
		} else if (field === 'durationSec') {
			const d = parseInt(raw);
			changes.durationSec = isNaN(d) ? undefined : d;
		}
		await db.sets.update(setId, { ...changes, ...syncMeta() });
		schedulePush();
		await reloadExercises();
		// Edited values may change all-time bests — safe (idempotent) full recompute
		recomputeAllPRs();
	}

	async function addForgottenSet(weId: string, side?: 'left' | 'right') {
		const existing = await db.sets.where('workoutExerciseId').equals(weId).toArray();
		const newSet: ExerciseSet = {
			id: crypto.randomUUID(),
			workoutExerciseId: weId,
			order: existing.length,
			side,
			isWarmup: false,
			completed: true,
			...syncMeta()
		};
		await db.sets.add(newSet);
		schedulePush();
		await reloadExercises();
	}

	async function deleteEditedSet(setId: string) {
		await db.tombstones.put({ id: setId, entity: 'set', entityId: setId, deletedAt: new Date(), _synced: false });
		await db.sets.delete(setId);
		schedulePush();
		await reloadExercises();
		recomputeAllPRs();
	}

	// Start a brand-new workout that mirrors this one: same exercises, same
	// number of sets per exercise (and per side for unilateral exercises),
	// with empty values so the user logs fresh numbers.
	async function startSameWorkout() {
		if (isStarting) return;
		if ($activeWorkout.workout) {
			// Bug 13 pattern: don't silently overwrite an already-active workout
			goto('/workout/active');
			return;
		}
		isStarting = true;
		try {
			await activeWorkout.start(workout?.name);
			for (const { we, sets } of exercises) {
				const newWe = await activeWorkout.addExercise(we.exerciseId);
				if (!newWe) continue;
				if (!sets.length) continue;
				// Preserve per-side set counts for unilateral exercises
				const sides = sets.map((s) => s.side);
				for (const side of sides) {
					await activeWorkout.addSet(newWe.id, side);
				}
			}
			goto('/workout/active');
		} finally {
			isStarting = false;
		}
	}

</script>

<div class="p-4 pt-4 pb-8">
	<div class="mb-6 flex items-start justify-between">
		<div>
			<a href="/history" class="text-sm text-zinc-500 mb-1 block">← History</a>
			<h1 class="text-2xl font-bold">{workout?.name ?? 'Workout'}</h1>
			{#if workout}
				<p class="text-sm text-zinc-400">{formatDate(workout.date)}</p>
				{#if workout.durationSec}
					<p class="text-sm text-zinc-500">{formatDuration(workout.durationSec)}</p>
				{/if}
			{/if}
		</div>
		<div class="flex items-center gap-3 mt-6">
			<button
				onclick={() => (editMode = !editMode)}
				class="text-sm font-medium {editMode ? 'text-accent-400' : 'text-zinc-400'}"
			>
				{editMode ? 'Done' : 'Edit'}
			</button>
			<button
				onclick={() => (showDelete = true)}
				class="text-sm text-red-500 font-medium"
			>
				Delete
			</button>
		</div>
	</div>

	<div class="flex flex-col gap-4">
		{#each exercises as { we, exercise, sets }}
			<div class="rounded-2xl bg-zinc-900 p-4">
				<!-- H1: show placeholder name if exercise was deleted -->
				<h2 class="mb-2 font-semibold {exercise ? '' : 'text-zinc-500 italic'}">
					{exercise?.name ?? 'Deleted exercise'}
				</h2>
				<div class="flex flex-col gap-1">
					{#each sets as set, i}
						{#if editMode}
							{@const type = exercise?.type ?? 'weightReps'}
							<div class="flex items-center gap-2 py-1">
								<span class="w-14 shrink-0 text-xs text-zinc-500">
									Set {i + 1}{#if set.side}<span class="ml-0.5">{set.side === 'left' ? 'L' : 'R'}</span>{/if}
								</span>
								<div class="flex flex-1 gap-2">
									{#if type === 'weightReps'}
										<input
											type="text" inputmode="decimal"
											value={set.weight ?? ''}
											onblur={(e) => updateEditedSet(set.id, type, 'weight', (e.target as HTMLInputElement).value)}
											placeholder="kg"
											class="w-0 flex-1 rounded-lg bg-zinc-800 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
										/>
										<input
											type="text" inputmode="numeric"
											value={set.reps ?? ''}
											onblur={(e) => updateEditedSet(set.id, type, 'reps', (e.target as HTMLInputElement).value)}
											placeholder="reps"
											class="w-0 flex-1 rounded-lg bg-zinc-800 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
										/>
									{:else if type === 'bodyweightReps'}
										<input
											type="text" inputmode="numeric"
											value={set.reps ?? ''}
											onblur={(e) => updateEditedSet(set.id, type, 'reps', (e.target as HTMLInputElement).value)}
											placeholder="reps"
											class="w-0 flex-1 rounded-lg bg-zinc-800 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
										/>
									{:else if type === 'time'}
										<input
											type="text" inputmode="numeric"
											value={set.durationSec ?? ''}
											onblur={(e) => updateEditedSet(set.id, type, 'durationSec', (e.target as HTMLInputElement).value)}
											placeholder="sec"
											class="w-0 flex-1 rounded-lg bg-zinc-800 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
										/>
									{:else}
										<input
											type="text" inputmode="decimal"
											value={set.distanceM ? (set.distanceM / 1000) : ''}
											onblur={(e) => updateEditedSet(set.id, type, 'distanceKm', (e.target as HTMLInputElement).value)}
											placeholder="km"
											class="w-0 flex-1 rounded-lg bg-zinc-800 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
										/>
									{/if}
								</div>
								<button
									onclick={() => deleteEditedSet(set.id)}
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 active:bg-zinc-800 active:text-red-400"
									aria-label="Delete set"
								>✕</button>
							</div>
						{:else}
							<div class="flex justify-between text-sm">
								<span class="text-zinc-500">Set {i + 1}{#if set.side}<span class="text-xs text-zinc-500 ml-0.5">{set.side === 'left' ? 'L' : 'R'}</span>{/if}</span>
								<span class="font-medium">{formatSet(set, exercise?.type ?? 'weightReps')}</span>
							</div>
						{/if}
					{/each}
				</div>
				{#if editMode}
					<div class="mt-2 flex gap-2">
						<button
							onclick={() => addForgottenSet(we.id)}
							class="flex-1 rounded-xl border border-dashed border-zinc-700 py-2 text-xs text-zinc-400 active:bg-zinc-800"
						>
							+ {exercise?.isUnilateral ? 'Left ' : ''}Set
						</button>
						{#if exercise?.isUnilateral}
							<button
								onclick={() => addForgottenSet(we.id, 'right')}
								class="flex-1 rounded-xl border border-dashed border-zinc-700 py-2 text-xs text-zinc-400 active:bg-zinc-800"
							>
								+ Right Set
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>


	<button
		onclick={startSameWorkout}
		disabled={isStarting}
		class="mt-4 w-full rounded-2xl bg-accent-500 py-4 text-base font-bold text-white active:bg-accent-600 disabled:opacity-50"
	>
		{isStarting ? 'Starting...' : '↻ Start Same Workout'}
	</button>
</div>

{#if showDelete}
	<div class="fixed inset-0 z-50 flex items-end bg-black/60 p-4">
		<div class="w-full rounded-2xl bg-zinc-900 p-6">
			<h2 class="text-xl font-bold">Delete Workout?</h2>
			<p class="mt-1 text-sm text-zinc-400">This cannot be undone.</p>
			<div class="mt-4 flex gap-3">
				<button onclick={() => (showDelete = false)} class="flex-1 rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300">Cancel</button>
				<button onclick={deleteWorkout} class="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white">Delete</button>
			</div>
		</div>
	</div>
{/if}
