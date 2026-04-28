<script lang="ts">
	import type { ExerciseSet, ExerciseType } from '$lib/db/schema';

	interface Props {
		set: ExerciseSet;
		index: number;
		exerciseType: ExerciseType;
		// Cascade placeholders — shown greyed out when the input is empty
		placeholderWeight?: number;
		placeholderReps?: number;
		placeholderDurationSec?: number;
		placeholderDistanceKm?: number;
		onComplete: () => void;
		onChange: (changes: Partial<ExerciseSet>) => void;
		onDelete: () => void;
	}

	let {
		set,
		index,
		exerciseType,
		placeholderWeight,
		placeholderReps,
		placeholderDurationSec,
		placeholderDistanceKm,
		onComplete,
		onChange,
		onDelete
	}: Props = $props();

	// Use local mutable state — empty until the user types
	let weight = $state('');
	let reps = $state('');
	let durationSec = $state('');
	let distanceKm = $state('');

	// Re-initialise when a different set is passed as prop (Bug 3 fix)
	let currentSetId = $state('');
	$effect(() => {
		if (set.id !== currentSetId) {
			currentSetId = set.id;
			// Only populate if the set already has a stored value (e.g. restored from DB)
			weight = set.weight?.toString() ?? '';
			reps = set.reps?.toString() ?? '';
			durationSec = set.durationSec?.toString() ?? '';
			distanceKm = set.distanceM ? (set.distanceM / 1000).toString() : '';
		}
	});

	// Auto-complete: called on blur — if both required fields are valid and not yet
	// completed, silently mark the set done WITHOUT triggering the rest timer
	function maybeAutoComplete() {
		if (set.completed) return;
		let valid = false;
		let changes: Partial<ExerciseSet> = {};

		if (exerciseType === 'weightReps') {
			const w = parseFloat(weight);
			const r = parseInt(reps);
			if (w > 0 && r > 0) {
				valid = true;
				changes = { weight: w, reps: r, completed: true };
			}
		} else if (exerciseType === 'bodyweightReps') {
			const r = parseInt(reps);
			if (r > 0) { valid = true; changes = { reps: r, completed: true }; }
		} else if (exerciseType === 'time') {
			const d = parseInt(durationSec);
			if (d > 0) { valid = true; changes = { durationSec: d, completed: true }; }
		} else if (exerciseType === 'distance') {
			const dist = parseFloat(distanceKm);
			if (dist > 0) { valid = true; changes = { distanceM: dist * 1000, completed: true }; }
		}

		if (valid) {
			// onChange but NOT onComplete (no rest timer)
			onChange(changes);
		}
	}

	function handleComplete() {
		// Manual tap: persist values + start rest timer
		let changes: Partial<ExerciseSet> = { completed: true };
		if (exerciseType === 'weightReps') {
			const w = parseFloat(weight) || (placeholderWeight ?? undefined);
			const r = parseInt(reps) || (placeholderReps ?? undefined);
			changes = { weight: w, reps: r, completed: true };
		} else if (exerciseType === 'bodyweightReps') {
			changes = { reps: parseInt(reps) || (placeholderReps ?? undefined), completed: true };
		} else if (exerciseType === 'time') {
			changes = { durationSec: parseInt(durationSec) || (placeholderDurationSec ?? undefined), completed: true };
		} else if (exerciseType === 'distance') {
			const d = parseFloat(distanceKm) || (placeholderDistanceKm ?? undefined);
			changes = { distanceM: d != null ? d * 1000 : undefined, completed: true };
		}
		onChange(changes);
		onComplete(); // triggers rest timer
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
				placeholder={placeholderWeight != null ? String(placeholderWeight) : 'kg'}
				bind:value={weight}
				onblur={() => { onChange({ weight: parseFloat(weight) || undefined }); maybeAutoComplete(); }}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
			<input
				type="number"
				inputmode="numeric"
				placeholder={placeholderReps != null ? String(placeholderReps) : 'reps'}
				bind:value={reps}
				onblur={() => { onChange({ reps: parseInt(reps) || undefined }); maybeAutoComplete(); }}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'bodyweightReps'}
			<input
				type="number"
				inputmode="numeric"
				placeholder={placeholderReps != null ? String(placeholderReps) : 'reps'}
				bind:value={reps}
				onblur={() => { onChange({ reps: parseInt(reps) || undefined }); maybeAutoComplete(); }}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'time'}
			<input
				type="number"
				inputmode="numeric"
				placeholder={placeholderDurationSec != null ? String(placeholderDurationSec) : 'sec'}
				bind:value={durationSec}
				onblur={() => { onChange({ durationSec: parseInt(durationSec) || undefined }); maybeAutoComplete(); }}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'distance'}
			<input
				type="number"
				inputmode="decimal"
				placeholder={placeholderDistanceKm != null ? String(placeholderDistanceKm) : 'km'}
				bind:value={distanceKm}
				onblur={() => { onChange({ distanceM: parseFloat(distanceKm) ? parseFloat(distanceKm) * 1000 : undefined }); maybeAutoComplete(); }}
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
