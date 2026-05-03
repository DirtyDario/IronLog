<script lang="ts">
	import type { ExerciseSet, ExerciseType } from '$lib/db/schema';

	interface Props {
		set: ExerciseSet;
		index: number;
		exerciseType: ExerciseType;
		// Placeholders from last workout — shown greyed out, never auto-filled as values
		placeholderWeight?: number;
		placeholderReps?: number;
		placeholderDurationSec?: number;
		placeholderDistanceKm?: number;
		onComplete: (resolved?: ResolvedValues) => void;
		onChange: (changes: Partial<ExerciseSet>) => void;
		onDelete: () => void;
		// Parent registers a getValues fn to read current inputs on finish
		onRegister?: (getValues: () => ResolvedValues | null) => void;
		// S10: parent unregisters when set is destroyed
		onUnregister?: () => void;
	}

	export interface ResolvedValues {
		id: string;
		weight?: number;
		reps?: number;
		durationSec?: number;
		distanceM?: number;
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
		onDelete,
		onRegister,
		onUnregister
	}: Props = $props();

	let weight = $state('');
	let reps = $state('');
	let durationSec = $state('');
	let distanceKm = $state('');

	// Re-initialise when a different set is passed (Bug 3 fix)
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

	// Register getValues with parent so finish() can collect all inputs
	// S10/H17: return cleanup fn so parent can unregister when component is destroyed
	$effect(() => {
		onRegister?.(() => getResolvedValues());
		return () => onUnregister?.();
	});

	/**
	 * Resolve the current input state into final values.
	 * - Weight empty → use placeholder (last workout value)
	 * - Reps empty → return null (set is skipped, not counted)
	 * - Already completed → return null (no re-processing needed)
	 */
	function getResolvedValues(): ResolvedValues | null {
		if (set.completed) return null;
		if (exerciseType === 'weightReps') {
			const r = parseInt(reps);
			if (!r) return null; // reps empty → skip this set
			const w = parseFloat(weight) || placeholderWeight;
			return { id: set.id, weight: w, reps: r };
		} else if (exerciseType === 'bodyweightReps') {
			const r = parseInt(reps);
			if (!r) return null;
			return { id: set.id, reps: r };
		} else if (exerciseType === 'time') {
			const d = parseInt(durationSec) || placeholderDurationSec;
			if (!d) return null;
			return { id: set.id, durationSec: d };
		} else if (exerciseType === 'distance') {
			const km = parseFloat(distanceKm) || placeholderDistanceKm;
			if (!km) return null;
			return { id: set.id, distanceM: km * 1000 };
		}
		return null;
	}

	function handleComplete() {
		const resolved = getResolvedValues();
		if (!resolved) return; // reps empty → don't complete
		// H13: Do NOT call onChange here — onComplete passes resolved values to the
		// parent's handleSetComplete which does the single DB write (avoids double write).
		onComplete(resolved); // parent writes completed:true + resolved values
	}

	function handleUncomplete() {
		onChange({ completed: false });
	}
</script>

<div class="flex items-center gap-2 py-1 {set.completed ? 'opacity-50' : ''}">
	<span class="w-6 shrink-0 text-center text-sm font-medium text-zinc-400">{index + 1}</span>

	<div class="flex flex-1 gap-2">
		{#if exerciseType === 'weightReps'}
			<input
				type="text"
				inputmode="decimal"
				autocorrect="off"
				spellcheck="false"
				autocomplete="off"
				placeholder={placeholderWeight != null ? String(placeholderWeight) : 'kg'}
				bind:value={weight}
				onblur={() => onChange({ weight: parseFloat(weight) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:text-zinc-500"
			/>
			<input
				type="text"
				inputmode="numeric"
				autocorrect="off"
				spellcheck="false"
				autocomplete="off"
				placeholder={placeholderReps != null ? String(placeholderReps) : 'reps'}
				bind:value={reps}
				onblur={() => onChange({ reps: parseInt(reps) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'bodyweightReps'}
			<input
				type="text"
				inputmode="numeric"
				autocorrect="off"
				spellcheck="false"
				autocomplete="off"
				placeholder={placeholderReps != null ? String(placeholderReps) : 'reps'}
				bind:value={reps}
				onblur={() => onChange({ reps: parseInt(reps) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'time'}
			<input
				type="text"
				inputmode="numeric"
				autocorrect="off"
				spellcheck="false"
				autocomplete="off"
				placeholder={placeholderDurationSec != null ? String(placeholderDurationSec) : 'sec'}
				bind:value={durationSec}
				onblur={() => onChange({ durationSec: parseInt(durationSec) || undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:text-zinc-500"
			/>
		{:else if exerciseType === 'distance'}
			<input
				type="text"
				inputmode="decimal"
				autocorrect="off"
				spellcheck="false"
				autocomplete="off"
				placeholder={placeholderDistanceKm != null ? String(placeholderDistanceKm) : 'km'}
				bind:value={distanceKm}
				onblur={() => onChange({ distanceM: parseFloat(distanceKm) ? parseFloat(distanceKm) * 1000 : undefined })}
				disabled={set.completed}
				class="w-0 flex-1 rounded-lg bg-zinc-800 py-2.5 text-center text-base font-medium focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:text-zinc-500"
			/>
		{/if}
	</div>

	{#if set.completed}
		<button
			onclick={handleUncomplete}
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-green-500 active:text-zinc-400"
			aria-label="Completed — tap to undo"
		>✓</button>
	{:else}
		<button
			onclick={handleComplete}
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 active:bg-accent-500 active:text-white transition-colors"
			aria-label="Complete set"
		>✓</button>
	{/if}
</div>
