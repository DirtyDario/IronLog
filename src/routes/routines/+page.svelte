<script lang="ts">
	import { db } from '$lib/db/schema';
	import type { Routine, RoutineExercise, Exercise } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeWorkout } from '$lib/stores/activeWorkout';
	import { schedulePush } from '$lib/services/sync';

	let routines: Routine[] = $state([]);
	let showCreate = $state(false);
	let newRoutineName = $state('');

	onMount(async () => {
		routines = await db.routines.orderBy('createdAt').reverse().toArray();
	});

	async function createRoutine() {
		if (!newRoutineName.trim()) return;
		const routine: Routine = {
			id: crypto.randomUUID(),
			name: newRoutineName.trim(),
			createdAt: new Date(),
			_synced: false,
			_lastModified: Date.now()
		};
		await db.routines.add(routine);
		schedulePush();
		routines = [routine, ...routines];
		newRoutineName = '';
		showCreate = false;
	}

	async function startFromRoutine(routineId: string, routineName: string) {
		// Bug 13 fix: if workout already active, redirect there instead of silently overwriting it
		if ($activeWorkout.workout) {
			goto('/workout/active');
			return;
		}
		const routineExercises = await db.routineExercises
			.where('routineId')
			.equals(routineId)
			.sortBy('order');

		// M4: guard empty routines — don't start a workout with no exercises
		if (!routineExercises.length) return;

		await activeWorkout.start(routineName);

		for (const re of routineExercises) {
			const we = await activeWorkout.addExercise(re.exerciseId);
			if (!we || !re.targetSets) continue;

			// Bug fix: for unilateral (L/R) exercises, previously always created
			// bilateral sets (no side) regardless of the routine — so a routine
			// with "One-Arm Row" started with plain bilateral sets instead of
			// separate Left/Right sets. Note: targetReps is intentionally NOT
			// pre-filled into the actual `reps` field here — sets only ever show
			// placeholders (never pre-populated values, see addSet), since a
			// pre-filled reps value would make the set look "already entered"
			// and could get silently auto-completed on Finish with the *target*
			// rep count instead of what was actually performed.
			const exercise = await db.exercises.get(re.exerciseId);
			const sides: Array<'left' | 'right' | undefined> = exercise?.isUnilateral
				? ['left', 'right']
				: [undefined];

			for (const side of sides) {
				for (let i = 0; i < re.targetSets; i++) {
					await activeWorkout.addSet(we.id, side);
				}
			}
		}
		goto('/workout/active');
	}

	async function deleteRoutine(id: string) {
		// H10: tombstone routine exercises and the routine itself
		const routineExercises = await db.routineExercises.where('routineId').equals(id).toArray();
		await Promise.all(routineExercises.map((re) =>
			db.tombstones.put({ id: re.id, entity: 'routineExercise', entityId: re.id, deletedAt: new Date(), _synced: false })
		));
		await db.tombstones.put({ id, entity: 'routine', entityId: id, deletedAt: new Date(), _synced: false });
		await db.routineExercises.where('routineId').equals(id).delete();
		await db.routines.delete(id);
		schedulePush();
		routines = routines.filter((r) => r.id !== id);
	}
</script>

<div class="p-4 pt-4 pb-8">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-3xl font-bold tracking-tight">Routines</h1>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-xl bg-accent-500 px-3 py-2 text-sm font-semibold text-white active:bg-accent-600"
		>
			+ New
		</button>
	</div>

	{#if showCreate}
		<div class="mb-4 rounded-2xl bg-zinc-900 p-4 flex gap-2">
			<input
				type="text"
				placeholder="Routine name (e.g. Push Day)"
				bind:value={newRoutineName}
				class="flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-500"
			/>
			<button
				onclick={createRoutine}
				class="rounded-xl bg-accent-500 px-4 py-3 font-semibold text-white active:bg-accent-600"
			>
				Save
			</button>
		</div>
	{/if}

	{#if routines.length === 0}
		<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
			<p class="text-4xl">📋</p>
			<p class="mt-2 font-medium">No routines yet</p>
			<p class="text-sm">Create a routine to quickly start a pre-planned workout</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each routines as routine}
				<div class="rounded-2xl bg-zinc-900 p-4">
					<div class="flex items-center justify-between mb-3">
						<h2 class="font-semibold text-lg">{routine.name}</h2>
						<button
							onclick={() => deleteRoutine(routine.id)}
							class="text-xs text-red-500 font-medium px-2 py-1 rounded-lg active:bg-zinc-800"
						>
							Delete
						</button>
					</div>
					<div class="flex gap-2">
						<button
							onclick={() => startFromRoutine(routine.id, routine.name)}
							class="flex-1 rounded-xl bg-accent-500 py-3 text-sm font-bold text-white active:bg-accent-600"
						>
							Start Workout
						</button>
						<a
							href="/routines/{routine.id}"
							class="flex-1 rounded-xl border border-zinc-700 py-3 text-center text-sm font-medium text-zinc-300 active:bg-zinc-800"
						>
							Edit
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
