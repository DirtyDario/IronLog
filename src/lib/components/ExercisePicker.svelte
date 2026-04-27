<script lang="ts">
	import { db } from '$lib/db/schema';
	import type { Exercise, MuscleGroup } from '$lib/db/schema';

	interface Props {
		onSelect: (exerciseId: string) => void;
		onClose: () => void;
	}

	let { onSelect, onClose }: Props = $props();

	let search = $state('');
	let exercises: Exercise[] = $state([]);
	let showAddCustom = $state(false);
	let customName = $state('');

	const muscleOrder: MuscleGroup[] = [
		'chest', 'back', 'shoulders', 'biceps', 'triceps',
		'legs', 'glutes', 'core', 'cardio', 'full body', 'other'
	];

	$effect(() => {
		db.exercises.orderBy('name').toArray().then((all) => {
			exercises = all;
		});
	});

	let filtered = $derived(
		search.trim()
			? exercises.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
			: exercises
	);

	let grouped = $derived(() => {
		const map = new Map<string, Exercise[]>();
		for (const e of filtered) {
			const g = e.muscleGroup ?? 'other';
			if (!map.has(g)) map.set(g, []);
			map.get(g)!.push(e);
		}
		// Sort by muscleOrder
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
		await db.exercises.add({
			id,
			name: customName.trim(),
			type: 'weightReps',
			muscleGroup: 'other',
			isCustom: true
		});
		onSelect(id);
	}
</script>

<div class="fixed inset-0 z-40 flex flex-col bg-zinc-950">
	<!-- Header -->
	<div class="flex items-center gap-3 border-b border-zinc-800 p-4 pt-12">
		<button onclick={onClose} class="text-zinc-400 text-xl">✕</button>
		<h2 class="flex-1 text-lg font-semibold">Add Exercise</h2>
		<button
			onclick={() => (showAddCustom = !showAddCustom)}
			class="text-sm text-orange-400 font-medium"
		>
			+ Custom
		</button>
	</div>

	{#if showAddCustom}
		<div class="border-b border-zinc-800 p-4 flex gap-2">
			<input
				type="text"
				placeholder="Exercise name"
				bind:value={customName}
				class="flex-1 rounded-xl bg-zinc-800 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
			/>
			<button
				onclick={addCustom}
				class="rounded-xl bg-orange-500 px-4 py-2.5 font-semibold text-white active:bg-orange-600"
			>
				Add
			</button>
		</div>
	{/if}

	<!-- Search -->
	<div class="p-4">
		<input
			type="search"
			placeholder="Search exercises..."
			bind:value={search}
			class="w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
		/>
	</div>

	<!-- List -->
	<div class="flex-1 overflow-y-auto px-4 pb-8">
		{#each grouped() as [group, exs]}
			<div class="mb-4">
				<p class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 capitalize">
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
