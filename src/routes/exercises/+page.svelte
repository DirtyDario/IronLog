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

		// Bug fix: deleting an exercise previously left dangling references
		// behind — routineExercises pointing at it silently vanished from the
		// routine UI (exercise lookup returned undefined) while still existing
		// in the DB, and personalRecords for it kept showing up in Bests/PRs
		// forever. Clean those up too. Historical workoutExercises/sets in past
		// workouts are intentionally left alone — history already renders a
		// "Deleted exercise" placeholder for them (see history/[id]/+page.svelte).
		const orphanedRoutineExercises = await db.routineExercises.where('exerciseId').equals(id).toArray();
		await Promise.all(
			orphanedRoutineExercises.map((re) =>
				db.tombstones.put({ id: re.id, entity: 'routineExercise', entityId: re.id, deletedAt: new Date(), _synced: false })
			)
		);
		await db.routineExercises.where('exerciseId').equals(id).delete();

		const orphanedPRs = await db.personalRecords.where('exerciseId').equals(id).toArray();
		await Promise.all(
			orphanedPRs.map((pr) =>
				db.tombstones.put({ id: pr.id, entity: 'personalRecord', entityId: pr.id, deletedAt: new Date(), _synced: false })
			)
		);
		await db.personalRecords.where('exerciseId').equals(id).delete();

		schedulePush();
		exercises = exercises.filter((e) => e.id !== id);
	}

	async function toggleUnilateral(exercise: Exercise) {
		const updated = !exercise.isUnilateral;
		await db.exercises.update(exercise.id, { isUnilateral: updated, _synced: false, _lastModified: Date.now() });
		schedulePush();
		exercises = exercises.map((e) => e.id === exercise.id ? { ...e, isUnilateral: updated } : e);
	}
</script>

<div class="p-4 pt-4 pb-8">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-3xl font-bold tracking-tight">Exercises</h1>
		<button
			onclick={() => (showAdd = !showAdd)}
			class="rounded-xl bg-accent-500 px-3 py-2 text-sm font-semibold text-white active:bg-accent-600"
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
				class="rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-500"
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
				<input type="checkbox" bind:checked={newIsUnilateral} class="rounded accent-accent-500" />
				One-arm / One-leg (track L/R separately)
			</label>
			<button onclick={addCustom} class="w-full rounded-xl bg-accent-500 py-3 font-semibold text-white active:bg-accent-600">
				Save Exercise
			</button>
		</div>
	{/if}

	<input
		type="search"
		placeholder="Search..."
		bind:value={search}
		class="mb-4 w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-500"
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
				<div class="flex items-center gap-1">
					<button
						onclick={() => toggleUnilateral(exercise)}
						title={exercise.isUnilateral ? 'Disable L/R tracking' : 'Enable L/R tracking'}
						class="text-xs font-bold px-2 py-1 rounded-lg active:bg-zinc-800
							{exercise.isUnilateral ? 'text-accent-500' : 'text-zinc-600'}"
					>
						L|R
					</button>
					{#if exercise.isCustom}
						<button
							onclick={() => deleteExercise(exercise.id)}
							class="text-xs text-red-500 font-medium px-2 py-1 rounded-lg active:bg-zinc-800"
						>
							Delete
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
