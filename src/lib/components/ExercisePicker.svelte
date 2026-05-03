<script lang="ts">
	import { db } from '$lib/db/schema';
	import type { Exercise, MuscleGroup } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { schedulePush } from '$lib/services/sync';

	interface Props {
		onSelect: (exerciseId: string) => void;
		onClose: () => void;
	}

	let { onSelect, onClose }: Props = $props();

	let search = $state('');
	let exercises: Exercise[] = $state([]);
	let showAddCustom = $state(false);
	let customName = $state('');
	let customMuscle = $state<MuscleGroup>('other');

	const muscleGroups: MuscleGroup[] = [
		'chest', 'back', 'shoulders', 'biceps', 'triceps',
		'legs', 'glutes', 'core', 'cardio', 'full body', 'other'
	];

	const muscleOrder: MuscleGroup[] = [
		'chest', 'back', 'shoulders', 'biceps', 'triceps',
		'legs', 'glutes', 'core', 'cardio', 'full body', 'other'
	];

	// Bug 2 fix: use onMount (runs once) instead of $effect (re-runs on every render)
	onMount(async () => {
		exercises = await db.exercises.orderBy('name').toArray();
	});

	let filtered = $derived(
		search.trim()
			? exercises.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
			: exercises
	);

	// Bug 1 fix: $derived.by() for multi-statement block, value used directly (no call parens)
	let grouped = $derived.by(() => {
		const map = new Map<string, Exercise[]>();
		for (const e of filtered) {
			const g = e.muscleGroup ?? 'other';
			if (!map.has(g)) map.set(g, []);
			map.get(g)!.push(e);
		}
		const sorted = new Map<string, Exercise[]>();
		for (const mg of muscleOrder) {
			if (map.has(mg)) sorted.set(mg, map.get(mg)!);
		}
		for (const [k, v] of map) {
			if (!sorted.has(k)) sorted.set(k, v);
		}
		return sorted;
	});

	async function addCustom() {
		if (!customName.trim()) return;
		const id = crypto.randomUUID();
		// Bug 14 fix: add sync metadata so custom exercises get pushed to Supabase
		await db.exercises.add({
			id,
			name: customName.trim(),
			type: 'weightReps',
			muscleGroup: customMuscle,
			isCustom: true,
			_synced: false,
			_lastModified: Date.now()
		} as any);
		schedulePush();
		// Refresh exercise list to show the new entry
		exercises = await db.exercises.orderBy('name').toArray();
		onSelect(id);
	}
</script>

<div class="fixed inset-0 z-40 flex flex-col bg-zinc-950">
	<!-- Header -->
	<div class="flex items-center gap-3 border-b border-zinc-800 p-4 pt-12">
		<button onclick={onClose} class="text-2xl text-zinc-400 leading-none">✕</button>
		<h2 class="flex-1 text-lg font-semibold">Add Exercise</h2>
		<button
			onclick={() => (showAddCustom = !showAddCustom)}
			class="text-sm text-accent-400 font-medium"
		>
			{showAddCustom ? 'Cancel' : '+ Custom'}
		</button>
	</div>

	{#if showAddCustom}
		<div class="border-b border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
			<input
				type="text"
				placeholder="Exercise name"
				bind:value={customName}
				class="w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-500"
			/>
			<div>
				<p class="mb-1.5 text-xs font-medium text-zinc-500">Muscle Group</p>
				<div class="flex flex-wrap gap-2">
					{#each muscleGroups as mg}
						<button
							onclick={() => (customMuscle = mg)}
							class="rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors
								{customMuscle === mg
								? 'bg-accent-500 text-white'
								: 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'}"
						>
							{mg}
						</button>
					{/each}
				</div>
			</div>
			<button
				onclick={addCustom}
				class="w-full rounded-xl bg-accent-500 py-3 font-semibold text-white active:bg-accent-600"
			>
				Add Exercise
			</button>
		</div>
	{/if}

	<!-- Search -->
	<div class="p-4 pb-2">
		<input
			type="search"
			placeholder="Search exercises..."
			bind:value={search}
			class="w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-500"
		/>
	</div>

	<!-- List -->
	<div class="flex-1 overflow-y-auto px-4 pb-8">
		{#each grouped as [group, exs]}
			<div class="mb-4">
				<p class="mb-2 mt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 capitalize">
					{group}
				</p>
				<div class="flex flex-col gap-1">
					{#each exs as ex}
						<button
							onclick={() => onSelect(ex.id)}
							class="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 text-left active:bg-zinc-800"
						>
							<span class="font-medium">{ex.name}</span>
							<span class="text-xs text-zinc-500">
								{ex.type === 'weightReps' ? 'kg × reps' :
								 ex.type === 'bodyweightReps' ? 'reps' :
								 ex.type === 'time' ? 'time' : 'distance'}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
