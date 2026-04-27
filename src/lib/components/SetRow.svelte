<script lang="ts">
	import type { ExerciseSet, ExerciseType } from '$lib/db/schema';

	interface Props {
		set: ExerciseSet;
		index: number;
		exerciseType: ExerciseType;
		onComplete: () => void;
		onChange: (changes: Partial<ExerciseSet>) => void;
		onDelete: () => void;
	}

	let { set, index, exerciseType, onComplete, onChange, onDelete }: Props = $props();

	// Use local mutable state, initialised from prop (user types here)
	let weight = $state('');
	let reps = $state('');
	let durationSec = $state('');
	let distanceKm = $state('');

	// Sync from incoming prop only once on mount via $effect
	let initialised = false;
	$effect(() => {
		if (!initialised) {
			weight = set.weight?.toString() ?? '';
			reps = set.reps?.toString() ?? '';
			durationSec = set.durationSec?.toString() ?? '';
			distanceKm = set.distanceM ? (set.distanceM / 1000).toString() : '';
			initialised = true;
		}
	});

	function handleComplete() {
		if (exerciseType === 'weightReps') {
			onChange({ weight: parseFloat(weight) || undefined, reps: parseInt(reps) || undefined });
		} else if (exerciseType === 'bodyweightReps') {
			onChange({ reps: parseInt(reps) || undefined });
		} else if (exerciseType === 'time') {
			onChange({ durationSec: parseInt(durationSec) || undefined });
		} else if (exerciseType === 'distance') {
			onChange({ distanceM: parseFloat(distanceKm) ? parseFloat(distanceKm) * 1000 : undefined });
		}
		onComplete();
	}
</script>

<div
	class="grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 py-1 items-center
	{set.completed ? 'opacity-50' : ''}"
>
	<span class="text-center text-sm font-medium text-zinc-400">{index + 1}</span>

	{#if exerciseType === 'weightReps'}
		<input
			type="number"
			inputmode="decimal"
			placeholder="0"
			bind:value={weight}
			onblur={() => onChange({ weight: parseFloat(weight) || undefined })}
			disabled={set.completed}
			class="rounded-lg bg-zinc-800 px-3 py-2 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
		/>
		<input
			type="number"
			inputmode="numeric"
			placeholder="0"
			bind:value={reps}
			onblur={() => onChange({ reps: parseInt(reps) || undefined })}
			disabled={set.completed}
			class="rounded-lg bg-zinc-800 px-3 py-2 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
		/>
	{:else if exerciseType === 'bodyweightReps'}
		<input
			type="number"
			inputmode="numeric"
			placeholder="0"
			bind:value={reps}
			onblur={() => onChange({ reps: parseInt(reps) || undefined })}
			disabled={set.completed}
			class="col-span-2 rounded-lg bg-zinc-800 px-3 py-2 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
		/>
	{:else if exerciseType === 'time'}
		<input
			type="number"
			inputmode="numeric"
			placeholder="0"
			bind:value={durationSec}
			onblur={() => onChange({ durationSec: parseInt(durationSec) || undefined })}
			disabled={set.completed}
			class="col-span-2 rounded-lg bg-zinc-800 px-3 py-2 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
		/>
	{:else if exerciseType === 'distance'}
		<input
			type="number"
			inputmode="decimal"
			placeholder="0.00"
			bind:value={distanceKm}
			onblur={() => onChange({ distanceM: parseFloat(distanceKm) ? parseFloat(distanceKm) * 1000 : undefined })}
			disabled={set.completed}
			class="col-span-2 rounded-lg bg-zinc-800 px-3 py-2 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
		/>
	{/if}

	{#if set.completed}
		<button
			onclick={onDelete}
			class="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-800"
			aria-label="Delete set"
		>
			✓
		</button>
	{:else}
		<button
			onclick={handleComplete}
			class="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-base active:bg-orange-500 active:text-white transition-colors"
			aria-label="Complete set"
		>
			✓
		</button>
	{/if}
</div>
