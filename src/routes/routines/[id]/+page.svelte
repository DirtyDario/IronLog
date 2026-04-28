<script lang="ts">
	import { page } from '$app/stores';
	import { db } from '$lib/db/schema';
	import type { Routine, RoutineExercise, Exercise } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import ExercisePicker from '$lib/components/ExercisePicker.svelte';
	import { schedulePush } from '$lib/services/sync';
	import { dragHandleZone, dragHandle, type DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';

	const FLIP_MS = 200;

	// Each item MUST have a top-level `id` for dragHandleZone to track items
	type Item = { id: string; re: RoutineExercise; exercise: Exercise };

	let routine: Routine | null = $state(null);

	// Source-of-truth list (loaded from DB)
	let savedItems: Item[] = $state([]);

	// Local working copy — updated immediately on consider for smooth animation
	let items: Item[] = $state([]);

	// Keep local copy in sync whenever savedItems changes (add/remove)
	$effect(() => {
		items = [...savedItems];
	});

	let showPicker = $state(false);

	onMount(async () => {
		const id = $page.params.id;
		routine = (await db.routines.get(id)) ?? null;
		await loadItems();
	});

	async function loadItems() {
		if (!routine) return;
		const res = await db.routineExercises.where('routineId').equals(routine.id).sortBy('order');
		const out: Item[] = [];
		for (const re of res) {
			const exercise = await db.exercises.get(re.exerciseId);
			if (exercise) out.push({ id: re.id, re, exercise });
		}
		savedItems = out;
	}

	async function addExercise(exerciseId: string) {
		if (!routine) return;
		const re: RoutineExercise = {
			id: crypto.randomUUID(),
			routineId: routine.id,
			exerciseId,
			order: savedItems.length,
			targetSets: 3,
			targetReps: 10,
			_synced: false,
			_lastModified: Date.now()
		};
		await db.routineExercises.add(re);
		schedulePush();
		await loadItems();
		showPicker = false;
	}

	async function removeExercise(id: string) {
		await db.routineExercises.delete(id);
		savedItems = savedItems.filter((i) => i.id !== id);
	}

	async function updateTargets(reId: string, targetSets: number, targetReps: number) {
		await db.routineExercises.update(reId, {
			targetSets,
			targetReps,
			_synced: false,
			_lastModified: Date.now()
		});
		schedulePush();
	}

	// During drag — update local copy only, no DB writes (keeps animation smooth)
	function handleConsider(e: CustomEvent<DndEvent<Item>>) {
		items = e.detail.items;
	}

	// On drop — persist new order to DB
	async function handleFinalize(e: CustomEvent<DndEvent<Item>>) {
		items = e.detail.items;
		savedItems = e.detail.items;
		await Promise.all(
			items.map((item, i) =>
				db.routineExercises.update(item.id, {
					order: i,
					_synced: false,
					_lastModified: Date.now()
				})
			)
		);
		schedulePush();
	}
</script>

<div class="p-4 pt-4 pb-8">
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
		<div
			use:dragHandleZone={{ items, flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
			onconsider={handleConsider}
			onfinalize={handleFinalize}
			class="flex flex-col gap-3"
		>
			{#each items as item (item.id)}
				<div animate:flip={{ duration: FLIP_MS }} class="rounded-2xl bg-zinc-900 p-4">
					<div class="flex items-center gap-2 mb-3">
						<!-- Drag handle — bigger tap area, same icon size -->
						<div
							use:dragHandle
							role="button"
							tabindex="0"
							aria-label="Drag to reorder"
							class="cursor-grab active:cursor-grabbing touch-none select-none
							       text-zinc-500 text-xl leading-none flex-shrink-0
							       flex items-center justify-center w-10 h-10 -ml-1 rounded-lg"
						>
							⠿
						</div>
						<div class="flex-1 flex items-center justify-between">
							<div>
								<p class="font-semibold">{item.exercise.name}</p>
								<p class="text-xs text-zinc-500 capitalize">{item.exercise.muscleGroup}</p>
							</div>
							<button
								onclick={() => removeExercise(item.id)}
								class="text-xs text-red-500 font-medium px-2 py-1 rounded active:bg-zinc-800"
							>
								Remove
							</button>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<p class="text-xs text-zinc-500 mb-1">Target Sets</p>
							<input
								type="number"
								inputmode="numeric"
								value={item.re.targetSets ?? 3}
								onchange={(e) =>
									updateTargets(
										item.id,
										parseInt((e.target as HTMLInputElement).value),
										item.re.targetReps ?? 10
									)}
								class="w-full rounded-xl bg-zinc-800 px-3 py-2 text-center font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
							/>
						</div>
						<div>
							<p class="text-xs text-zinc-500 mb-1">Target Reps</p>
							<input
								type="number"
								inputmode="numeric"
								value={item.re.targetReps ?? 10}
								onchange={(e) =>
									updateTargets(
										item.id,
										item.re.targetSets ?? 3,
										parseInt((e.target as HTMLInputElement).value)
									)}
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
