<script lang="ts">
	import { page } from '$app/stores';
	import { db } from '$lib/db/schema';
	import type { Routine, RoutineExercise, Exercise } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import ExercisePicker from '$lib/components/ExercisePicker.svelte';

	let routine: Routine | null = $state(null);
	let items: Array<{ re: RoutineExercise; exercise: Exercise }> = $state([]);
	let showPicker = $state(false);

	onMount(async () => {
		const id = $page.params.id;
		routine = (await db.routines.get(id)) ?? null;
		await loadItems();
	});

	async function loadItems() {
		if (!routine) return;
		const res = await db.routineExercises.where('routineId').equals(routine.id).sortBy('order');
		const out = [];
		for (const re of res) {
			const exercise = await db.exercises.get(re.exerciseId);
			if (exercise) out.push({ re, exercise });
		}
		items = out;
	}

	async function addExercise(exerciseId: string) {
		if (!routine) return;
		const re: RoutineExercise = {
			id: crypto.randomUUID(),
			routineId: routine.id,
			exerciseId,
			order: items.length,
			targetSets: 3,
			targetReps: 10
		};
		await db.routineExercises.add(re);
		await loadItems();
		showPicker = false;
	}

	async function removeExercise(id: string) {
		await db.routineExercises.delete(id);
		items = items.filter((i) => i.re.id !== id);
	}

	async function updateTargets(reId: string, targetSets: number, targetReps: number) {
		await db.routineExercises.update(reId, { targetSets, targetReps });
	}
</script>

<div class="p-4 pt-12 pb-8">
	<a href="/routines" class="text-sm text-zinc-500 mb-2 block">← Routines</a>
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold">{routine?.name ?? 'Routine'}</h1>
		<button
			onclick={() => (showPicker = true)}
			class="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white active:bg-orange-600"
		>
			+ Exercise
		</button>
	</div>

	{#if items.length === 0}
		<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
			<p>No exercises yet — tap "+ Exercise" to add</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each items as { re, exercise }}
				<div class="rounded-2xl bg-zinc-900 p-4">
					<div class="flex items-center justify-between mb-3">
						<div>
							<p class="font-semibold">{exercise.name}</p>
							<p class="text-xs text-zinc-500 capitalize">{exercise.muscleGroup}</p>
						</div>
						<button
							onclick={() => removeExercise(re.id)}
							class="text-xs text-red-500 font-medium px-2 py-1 rounded active:bg-zinc-800"
						>
							Remove
						</button>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<p class="text-xs text-zinc-500 mb-1">Target Sets</p>
							<input
								type="number"
								inputmode="numeric"
								value={re.targetSets ?? 3}
								onchange={(e) => updateTargets(re.id, parseInt((e.target as HTMLInputElement).value), re.targetReps ?? 10)}
								class="w-full rounded-xl bg-zinc-800 px-3 py-2 text-center font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
							/>
						</div>
						<div>
							<p class="text-xs text-zinc-500 mb-1">Target Reps</p>
							<input
								type="number"
								inputmode="numeric"
								value={re.targetReps ?? 10}
								onchange={(e) => updateTargets(re.id, re.targetSets ?? 3, parseInt((e.target as HTMLInputElement).value))}
								class="w-full rounded-xl bg-zinc-800 px-3 py-2 text-center font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
							/>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showPicker}
	<ExercisePicker
		onSelect={addExercise}
		onClose={() => (showPicker = false)}
	/>
{/if}
