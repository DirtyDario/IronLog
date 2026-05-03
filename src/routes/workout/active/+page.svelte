<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { activeWorkout } from '$lib/stores/activeWorkout';
	import { restTimer, formatTime } from '$lib/stores/restTimer';
	import { db } from '$lib/db/schema';
	import { daysAgoLabel } from '$lib/services/lastWorkout';
	import type { Exercise, ExerciseSet, WorkoutExercise } from '$lib/db/schema';
	import ExercisePicker from '$lib/components/ExercisePicker.svelte';
	import SetRow from '$lib/components/SetRow.svelte';
	import RestTimerBar from '$lib/components/RestTimerBar.svelte';
	import { dragHandleZone, dragHandle, type DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';

	const FLIP_MS = 200;

	// Local copy of exercise list for DnD — separate from store to avoid mid-drag resets
	let exercises = $state<WorkoutExercise[]>([]);
	let isDragging = $state(false);

	// Bug 16 fix: only sync from store when exercise IDs change (add/remove), not on every set update
	$effect(() => {
		const incoming = $activeWorkout.workoutExercises;
		if (!isDragging && incoming.map((w) => w.id).join() !== exercises.map((w) => w.id).join()) {
			exercises = [...incoming];
		}
	});

	// Bug 25 fix: tick every second for elapsed time display
	let now = $state(Date.now());
	onMount(() => {
		// H12: Wait for rehydrate() to complete before deciding to redirect.
		// rehydrate() runs async in layout; if we redirect immediately we may kick
		// the user to '/' while their workout is still being loaded from IDB.
		if ($activeWorkout.rehydrating) {
			const unsub = activeWorkout.subscribe((state) => {
				if (!state.rehydrating) {
					unsub();
					if (!state.workout) goto('/');
				}
			});
		} else if (!$activeWorkout.workout) {
			goto('/');
			return;
		}
		const interval = setInterval(() => { now = Date.now(); }, 1000);
		return () => clearInterval(interval);
	});

	let elapsedSec = $derived(
		$activeWorkout.startedAt
			? Math.floor((now - new Date($activeWorkout.startedAt).getTime()) / 1000)
			: 0
	);

	let editingName = $state(false);
	let nameInput = $state('');
	let showPicker = $state(false);
	let showFinishConfirm = $state(false);
	let showDiscardConfirm = $state(false);
	let exerciseMap: Record<string, Exercise> = $state({});

	$effect(() => {
		const ids = $activeWorkout.workoutExercises.map((we) => we.exerciseId);
		if (ids.length) {
			db.exercises.bulkGet(ids).then((results) => {
				const map: Record<string, Exercise> = {};
				results.forEach((ex) => { if (ex) map[ex.id] = ex; });
				exerciseMap = map;
			});
		}
	});

	function handleConsider(e: CustomEvent<DndEvent<WorkoutExercise>>) {
		isDragging = true;
		exercises = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<WorkoutExercise>>) {
		isDragging = false;
		exercises = e.detail.items;
		activeWorkout.reorderExercises(e.detail.items);
	}

	async function handleSetComplete(set: ExerciseSet, workoutExerciseId: string, exerciseId: string, resolvedValues?: ResolvedValues) {
		// Use resolved values from SetRow (includes placeholder weight fill-in)
		const changes = resolvedValues
			? { ...resolvedValues, completed: true }
			: { completed: true };
		await activeWorkout.updateSet(set.id, workoutExerciseId, changes);
		restTimer.start($restTimer.total);
	}

	import type { ResolvedValues } from '$lib/components/SetRow.svelte';

	// Registry: setId → getValues fn registered by each SetRow
	const setValueRegistry = new Map<string, () => ResolvedValues | null>();

	function registerSet(setId: string, getFn: () => ResolvedValues | null) {
		setValueRegistry.set(setId, getFn);
	}

	// S10: clean up registry when a set is deleted
	function unregisterSet(setId: string) {
		setValueRegistry.delete(setId);
	}

	// Notes toggle state per exercise
	let notesOpen = $state<Record<string, boolean>>({});

	// Active side tab per exercise (for unilateral exercises)
	let activeSide = $state<Record<string, 'left' | 'right'>>({});

	// H8: guard against double-tap finish
	let isFinishing = $state(false);

	async function handleFinish() {
		const workoutId = $activeWorkout.workout?.id;
		if (!workoutId || isFinishing) return;
		isFinishing = true;

		// Collect resolved values from all live SetRow components
		const resolved: ResolvedValues[] = [];
		for (const [, getFn] of setValueRegistry) {
			const v = getFn();
			if (v) resolved.push(v);
		}

		await activeWorkout.finish(resolved);
		goto(`/workout/summary/${workoutId}`);
	}

	async function handleDiscard() {
		showDiscardConfirm = false;
		await activeWorkout.discard();
		goto('/');
	}

	// ── Placeholder cascade ────────────────────────────────────────────────────
	// Weight cascades from previous sets in current workout → fallback last workout.
	// Reps come only from last finished workout at same index (never cascade within workout).
	function getPlaceholders(weId: string, setIndex: number) {
		const sets = $activeWorkout.sets[weId] ?? [];
		const prev = $activeWorkout.previousSets[weId];

		let weight: number | undefined;
		let reps: number | undefined;
		let durationSec: number | undefined;
		let distanceKm: number | undefined;

		// Weight: walk backward through current workout sets
		for (let j = setIndex - 1; j >= 0; j--) {
			const s = sets[j];
			if (weight == null && s.weight != null) { weight = s.weight; break; }
		}

		// All fields: fallback to last-workout same-index set
		if (prev?.sets[setIndex]) {
			const ps = prev.sets[setIndex];
			if (weight == null && ps.weight != null) weight = ps.weight;
			if (reps == null && ps.reps != null) reps = ps.reps;
			if (durationSec == null && ps.durationSec != null) durationSec = ps.durationSec;
			if (distanceKm == null && ps.distanceM != null) distanceKm = ps.distanceM / 1000;
		}

		return { weight, reps, durationSec, distanceKm };
	}

	// ── Last workout summary text ─────────────────────────────────────────────
	function lastWorkoutSummary(weId: string, exerciseType: string): string | null {
		const info = $activeWorkout.previousSets[weId];
		if (!info || !info.sets.length) return null;
		const sets = info.sets;
		const label = daysAgoLabel(info.date);

		if (exerciseType === 'weightReps') {
			// Group consecutive sets with same weight×reps as "NxM @ Wkg"
			// Simple: show "Nx sets @ W kg × R reps" or just summarise
			const total = sets.length;
			const first = sets[0];
			if (sets.every((s) => s.weight === first.weight && s.reps === first.reps)) {
				return `Last time: ${total}×${first.reps ?? '?'} @ ${first.weight ?? '?'} kg · ${label}`;
			}
			return `Last time: ${total} sets · ${label}`;
		} else if (exerciseType === 'bodyweightReps') {
			const total = sets.length;
			const first = sets[0];
			return `Last time: ${total}×${first.reps ?? '?'} reps · ${label}`;
		} else if (exerciseType === 'time') {
			const totalSec = sets.reduce((a, s) => a + (s.durationSec ?? 0), 0);
			return `Last time: ${totalSec}s total · ${label}`;
		} else if (exerciseType === 'distance') {
			const totalM = sets.reduce((a, s) => a + (s.distanceM ?? 0), 0);
			return `Last time: ${(totalM / 1000).toFixed(1)} km · ${label}`;
		}
		return null;
	}
</script>

<!-- NOTE: "Undo discard" snackbar is in +page.svelte (home) because discard navigates there -->

<div class="flex flex-col gap-4 p-4 pt-2 pb-40">
	<!-- Sticky header: timer + actions -->
	<div
		class="sticky z-40 -mx-4 px-4 py-2 bg-[#09090b] border-b border-zinc-800/50 flex items-center justify-between"
		style="top: calc(58px + env(safe-area-inset-top, 44px))"
	>
		<div class="flex-1 min-w-0 mr-2">
			{#if editingName}
				<input
					type="text"
					bind:value={nameInput}
					onblur={() => {
						const trimmed = nameInput.trim();
						if (trimmed) activeWorkout.renameWorkout(trimmed);
						editingName = false;
					}}
					onkeydown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
					class="w-full rounded-lg bg-zinc-800 px-2 py-1 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
					autofocus
				/>
			{:else}
				<button
					onclick={() => { nameInput = $activeWorkout.workout?.name ?? ''; editingName = true; }}
					class="text-left w-full flex items-center gap-2"
					aria-label="Edit workout name"
				>
					<h1 class="text-2xl font-bold truncate">{$activeWorkout.workout?.name ?? 'Workout'}</h1>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 text-zinc-500 shrink-0">
						<path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343z" />
					</svg>
				</button>
			{/if}
			<p class="text-sm text-zinc-400">{formatTime(elapsedSec)}</p>
		</div>
		<div class="flex gap-2">
			<button
				onclick={() => (showDiscardConfirm = true)}
				class="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-400 active:bg-zinc-800"
			>
				Discard
			</button>
			<button
				onclick={() => (showFinishConfirm = true)}
				class="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white active:bg-orange-600 disabled:opacity-50"
				disabled={isFinishing}
			>
				Finish
			</button>
		</div>
	</div>

	<!-- Rest timer bar (sticky, directly below header) -->
	{#if $restTimer.running}
		<div class="sticky z-40 -mx-4 px-4" style="top: calc(58px + env(safe-area-inset-top, 44px) + 56px)">
			<RestTimerBar />
		</div>
	{/if}

	<!-- Exercises -->
	<div
		use:dragHandleZone={{ items: exercises, flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
		onconsider={handleConsider}
		onfinalize={handleFinalize}
		class="flex flex-col gap-4"
	>
		{#each exercises as we (we.id)}
			{@const exercise = exerciseMap[we.exerciseId]}
			{@const sets = $activeWorkout.sets[we.id] ?? []}
			{@const summary = lastWorkoutSummary(we.id, exercise?.type ?? 'weightReps')}
			{@const isUnilateral = exerciseMap[we.exerciseId]?.isUnilateral ?? false}
			<div animate:flip={{ duration: FLIP_MS }} class="rounded-2xl bg-zinc-900 p-4">
				<div class="mb-3 flex items-center gap-2">
					<!-- Drag handle -->
					<div
						use:dragHandle
						role="button"
						tabindex="0"
						aria-label="Drag to reorder"
						class="cursor-grab active:cursor-grabbing touch-none select-none
						       text-zinc-600 leading-none flex-shrink-0
						       flex items-center justify-center w-6 h-6 rounded"
					>
						⠿
					</div>
					<div class="flex-1">
						<h2 class="font-semibold text-base">{exercise?.name ?? '...'}
						{#if we.notes}
							<span class="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-orange-500"></span>
						{/if}
					</h2>
						{#if summary}
							<p class="text-xs text-zinc-500">{summary}</p>
						{:else if exercise?.muscleGroup}
							<span class="text-xs text-zinc-500 capitalize">{exercise.muscleGroup}</span>
						{/if}
					</div>
					<button
						onclick={() => activeWorkout.deleteExercise(we.id)}
						class="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-600 active:bg-zinc-800 active:text-red-400"
						aria-label="Remove exercise"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
							<path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
						</svg>
					</button>
				</div>

				<!-- Notes toggle -->
				<div class="mb-2">
					<div class="flex items-center justify-between">
						<button
							onclick={() => { notesOpen[we.id] = !notesOpen[we.id]; }}
							class="flex items-center gap-1.5 text-xs text-zinc-500 active:text-zinc-300"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
								<path fill-rule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 0 0 1.28.53l3.58-3.579a.78.78 0 0 1 .527-.224 41.202 41.202 0 0 0 5.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0 0 10 2Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
							</svg>
							{notesOpen[we.id] ? 'Notiz ausblenden' : (we.notes ? 'Notiz bearbeiten' : 'Notiz hinzufügen')}
						</button>
						{#if we.notes || notesOpen[we.id]}
							{@const isPinned = exerciseMap[we.exerciseId]?.notes === we.notes && !!we.notes}
							<button
								onclick={async () => {
									const currentNote = we.notes ?? '';
									if (isPinned) {
										await activeWorkout.pinExerciseNotes(we.exerciseId, '');
									} else {
										await activeWorkout.pinExerciseNotes(we.exerciseId, currentNote);
									}
									const ex = await db.exercises.get(we.exerciseId);
									if (ex) exerciseMap = { ...exerciseMap, [ex.id]: ex };
								}}
								title={isPinned ? 'Notiz ist gepinnt – tippen zum Lösen' : 'Notiz an Übung pinnen'}
								class="flex items-center justify-center w-7 h-7 rounded-lg text-xs
									{isPinned ? 'text-orange-500' : 'text-zinc-600 active:text-orange-400'}"
							>
								{#if isPinned}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
										<path fill-rule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5a3 3 0 1 0-6 0V9h6Z" clip-rule="evenodd" />
									</svg>
								{:else}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
										<path fill-rule="evenodd" d="M14.5 1A4.5 4.5 0 0 0 10 5.5V9H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1.5V5.5a3 3 0 1 1 6 0v2.75a.75.75 0 0 0 1.5 0V5.5A4.5 4.5 0 0 0 14.5 1Z" clip-rule="evenodd" />
									</svg>
								{/if}
							</button>
						{/if}
					</div>
					{#if notesOpen[we.id]}
						<textarea
							value={we.notes ?? ''}
							onblur={(e) => {
								const val = (e.target as HTMLTextAreaElement).value.trim();
								activeWorkout.updateExerciseNotes(we.id, val);
							}}
							placeholder="Notizen zu dieser Übung..."
							rows="2"
							class="mt-1.5 w-full rounded-xl bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
						></textarea>
					{/if}
				</div>

				<!-- Set header -->
				{#if isUnilateral}
					<!-- L/R Tab switcher -->
					<div class="flex gap-1 mb-2">
						{#each (['left', 'right'] as const) as side}
							<button
								onclick={() => { activeSide[we.id] = side; }}
								class="flex-1 rounded-lg py-1.5 text-sm font-semibold transition-colors
									{(activeSide[we.id] ?? 'left') === side
										? 'bg-orange-500 text-white'
										: 'bg-zinc-800 text-zinc-400'}"
							>
								{side === 'left' ? 'Links' : 'Rechts'}
							</button>
						{/each}
					</div>
				{/if}

				<!-- Set header -->
				<div class="mb-1 grid grid-cols-[2rem_1fr_1fr_2rem] gap-2 px-1 text-xs font-medium text-zinc-500">
					<span>Set</span>
					{#if exercise?.type === 'weightReps'}
						<span>kg</span><span>Reps</span>
					{:else if exercise?.type === 'bodyweightReps'}
						<span>Reps</span><span></span>
					{:else if exercise?.type === 'time'}
						<span>Sec</span><span></span>
					{:else}
						<span>km</span><span></span>
					{/if}
					<span></span>
				</div>

				{#each (isUnilateral ? sets.filter((s) => (s.side ?? 'left') === (activeSide[we.id] ?? 'left')) : sets) as set, i (set.id)}
					{@const ph = getPlaceholders(we.id, i)}
					<SetRow
						{set}
						index={i}
						exerciseType={exercise?.type ?? 'weightReps'}
						placeholderWeight={ph.weight}
						placeholderReps={ph.reps}
						placeholderDurationSec={ph.durationSec}
						placeholderDistanceKm={ph.distanceKm}
						onComplete={(resolved) => handleSetComplete(set, we.id, we.exerciseId, resolved)}
						onRegister={(getFn) => registerSet(set.id, getFn)}
						onUnregister={() => unregisterSet(set.id)}
						onChange={(changes) => activeWorkout.updateSet(set.id, we.id, changes)}
						onDelete={() => { unregisterSet(set.id); activeWorkout.deleteSet(set.id, we.id); }}
					/>
				{/each}

				<button
					onclick={() => activeWorkout.addSet(we.id, isUnilateral ? (activeSide[we.id] ?? 'left') : undefined)}
					class="mt-2 w-full rounded-xl border border-dashed border-zinc-700 py-3 text-sm text-zinc-400 active:bg-zinc-800"
				>
					+ {isUnilateral ? `Set ${(activeSide[we.id] ?? 'left') === 'left' ? 'Links' : 'Rechts'} hinzufügen` : 'Add Set'}
				</button>
			</div>
		{/each}
	</div>

	<button
		onclick={() => (showPicker = true)}
		class="w-full rounded-2xl border border-dashed border-zinc-700 py-5 text-base font-medium text-zinc-400 active:bg-zinc-900"
	>
		+ Add Exercise
	</button>
</div>

{#if showPicker}
	<ExercisePicker
		onSelect={async (exerciseId) => {
			await activeWorkout.addExercise(exerciseId);
			showPicker = false;
		}}
		onClose={() => (showPicker = false)}
	/>
{/if}

{#if showFinishConfirm}
	<div class="fixed inset-0 z-50 flex items-end bg-black/60 p-4">
		<div class="w-full rounded-2xl bg-zinc-900 p-6">
			<h2 class="text-xl font-bold">Finish Workout?</h2>
			<p class="mt-1 text-sm text-zinc-400">
				{$activeWorkout.workoutExercises.length} exercise{$activeWorkout.workoutExercises.length !== 1 ? 's' : ''} logged
			</p>
			<div class="mt-4 flex gap-3">
				<button onclick={() => (showFinishConfirm = false)} class="flex-1 rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300">Cancel</button>
				<button onclick={handleFinish} disabled={isFinishing} class="flex-1 rounded-xl bg-orange-500 py-3 font-bold text-white disabled:opacity-50">Finish</button>
			</div>
		</div>
	</div>
{/if}

{#if showDiscardConfirm}
	<div class="fixed inset-0 z-50 flex items-end bg-black/60 p-4">
		<div class="w-full rounded-2xl bg-zinc-900 p-6">
			<h2 class="text-xl font-bold">Discard Workout?</h2>
			<p class="mt-1 text-sm text-zinc-400">All progress will be lost.</p>
			<div class="mt-4 flex gap-3">
				<button onclick={() => (showDiscardConfirm = false)} class="flex-1 rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300">Keep Going</button>
				<button onclick={handleDiscard} class="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white">Discard</button>
			</div>
		</div>
	</div>
{/if}
