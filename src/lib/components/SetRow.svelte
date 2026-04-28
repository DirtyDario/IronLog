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

	// Bug 3 fix: track set.id to re-initialise when a different set is passed as prop
	let currentSetId = $state('');
	$effect(() => {
		if (set.id !== currentSetId) {
			currentSetId = set.id;
			weight = set.weight?.toString() ?? '';
			reps = set.reps?.toString() ?? '';
			durationSec = set.durationSec?.toString() ?? '';
			distanceKm = set.distanceM ? (set.distanceM / 1000).toString() : '';
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

<div class="flex items-center gap-2 py-1 {set.completed ? 'opacity-50' : ''}">
	<!-- Set number -->
	<span class="w-6 shrink-0 text-center text-sm font-medium text-zinc-400">{index + 1}</span>

	<!-- Inputs -->
	<div class="flex flex-1 gap-2">
		{#if exerciseType === 'weightReps'}
			<input
				type="number"
				inputmode="decimal"
				placeholder="kg"
				bind:value={weight}
				onblur={() => onChange({ weight: parseFloat(weight) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
			<input
				type="number"
				inputmode="numeric"
				placeholder="reps"
				bind:value={reps}
				onblur={() => onChange({ reps: parseInt(reps) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'bodyweightReps'}
			<input
				type="number"
				inputmode="numeric"
				placeholder="reps"
				bind:value={reps}
				onblur={() => onChange({ reps: parseInt(reps) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'time'}
			<input
				type="number"
				inputmode="numeric"
				placeholder="sec"
				bind:value={durationSec}
				onblur={() => onChange({ durationSec: parseInt(durationSec) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'distance'}
			<input
				type="number"
				inputmode="decimal"
				placeholder="km"
				bind:value={distanceKm}
				onblur={() => onChange({ distanceM: parseFloat(distanceKm) ? parseFloat(distanceKm) * 1000 : undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
		{/if}
	</div>

	<!-- Complete / done button -->
	{#if set.completed}
		<button
			onclick={onDelete}
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-green-500"
			aria-label="Completed — tap to delete"
		>
			✓
		</button>
	{:else}
		<button
			onclick={handleComplete}
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 active:bg-orange-500 active:text-white transition-colors"
			aria-label="Complete set"
		>
			✓
		</button>
	{/if}
</div>
