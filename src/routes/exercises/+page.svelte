<script lang="ts">
	import { db } from '$lib/db/schema';
	import type { Exercise, MuscleGroup } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { schedulePush } from '$lib/services/sync';

	let exercises: Exercise[] = $state([]);
	let search = $state('');
	let showAdd = $state(false);
	let newName = $state('');
	let newType = $state<Exercise['type']>('weightReps');
	let newMuscle = $state<MuscleGroup>('other');
	let newIsUnilateral = $state(false);

	const muscleGroups: MuscleGroup[] = [
		'chest', 'back', 'shoulders', 'biceps', 'triceps',
		'legs', 'glutes', 'core', 'cardio', 'full body', 'other'
	];

	onMount(async () => {
		exercises = await db.exercises.orderBy('name').toArray();
	});

	let filtered = $derived(
		search.trim()
			? exercises.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
			: exercises
	);

	async function addCustom() {
		if (!newName.trim()) return;
		const ex: Exercise = {
			id: crypto.randomUUID(),
			name: newName.trim(),
			type: newType,
			muscleGroup: newMuscle,
			isCustom: true,
			isUnilateral: newIsUnilateral,
			_synced: false,
			_lastModified: Date.now()
		};
		await db.exercises.add(ex);
		schedulePush();
		exercises = [...exercises, ex].sort((a, b) => a.name.localeCompare(b.name));
		newName = '';
		newIsUnilateral = false;
		showAdd = false;
	}

	async function deleteExercise(id: string) {
		// H9: tombstone so remote copy is cleaned up on next sync
		await db.tombstones.put({ id, entity: 'exercise', entityId: id, deletedAt: new Date(), _synced: false });
		await db.exercises.delete(id);
		schedulePush();
		exercises = exercises.filter((e) => e.id !== id);
	}
</script>

<div class="p-4 pt-4 pb-8">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-3xl font-bold tracking-tight">Exercises</h1>
		<button
			onclick={() => (showAdd = !showAdd)}
			class="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white active:bg-orange-600"
		>
			+ Add
		</button>
	</div>

	{#if showAdd}
		<div class="mb-4 rounded-2xl bg-zinc-900 p-4 flex flex-col gap-3">
			<input
				type="text"
				placeholder="Exercise name"
				bind:value={newName}
				class="rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
			/>
			<div class="grid grid-cols-2 gap-2">
				<select bind:value={newType} class="rounded-xl bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none">
					<option value="weightReps">Weight × Reps</option>
					<option value="bodyweightReps">Bodyweight × Reps</option>
					<option value="time">Time</option>
					<option value="distance">Distance</option>
				</select>
				<select bind:value={newMuscle} class="rounded-xl bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none capitalize">
					{#each muscleGroups as mg}
						<option value={mg} class="capitalize">{mg}</option>
					{/each}
				</select>
			</div>
			<label class="flex items-center gap-2 text-sm text-zinc-300">
				<input type="checkbox" bind:checked={newIsUnilateral} class="rounded accent-orange-500" />
				Einarmig / Einbeinig (L/R getrennt tracken)
			</label>
			<button onclick={addCustom} class="w-full rounded-xl bg-orange-500 py-3 font-semibold text-white active:bg-orange-600">
				Save Exercise
			</button>
		</div>
	{/if}

	<input
		type="search"
		placeholder="Search..."
		bind:value={search}
		class="mb-4 w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
	/>

	<div class="flex flex-col gap-2">
		{#each filtered as exercise}
			<div class="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
				<div>
					<p class="font-medium">{exercise.name}</p>
					<p class="text-xs text-zinc-500 capitalize">{exercise.muscleGroup} ·
						{exercise.type === 'weightReps' ? 'kg × reps' :
						 exercise.type === 'bodyweightReps' ? 'reps' :
						 exercise.type === 'time' ? 'time' : 'distance'}
					</p>
				</div>
				{#if exercise.isCustom}
					<button
						onclick={() => deleteExercise(exercise.id)}
						class="text-xs text-red-500 font-medium px-2 py-1 rounded-lg active:bg-zinc-800"
					>
						Delete
					</button>
				{/if}
			</div>
		{/each}
	</div>
</div>
