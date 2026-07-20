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
		// Bug fix: this subscription was previously never unsubscribed if the
		// component unmounted (e.g. user quickly navigated away) before
		// rehydrating finished — it kept firing after unmount and could call
		// goto('/') from a torn-down component. Track it and unsubscribe in the
		// same cleanup function returned below.
		let rehydrateUnsub: (() => void) | null = null;
		if ($activeWorkout.rehydrating) {
			rehydrateUnsub = activeWorkout.subscribe((state) => {
				if (!state.rehydrating) {
					rehydrateUnsub?.();
					rehydrateUnsub = null;
					if (!state.workout) goto('/');
				}
			});
		} else if (!$activeWorkout.workout) {
			goto('/');
			return;
		}
		const interval = setInterval(() => { now = Date.now(); }, 1000);
		return () => {
			clearInterval(interval);
			rehydrateUnsub?.();
		};
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
	// Registry: setId → hasPartialInput fn (true when a field was typed but the
	// set won't be auto-completed on finish, e.g. weight without reps)
	const partialInputRegistry = new Map<string, () => boolean>();

	function registerSet(setId: string, getFn: () => ResolvedValues | null, hasPartialFn: () => boolean) {
		setValueRegistry.set(setId, getFn);
		partialInputRegistry.set(setId, hasPartialFn);
	}

	// S10: clean up registry when a set is deleted
	function unregisterSet(setId: string) {
		setValueRegistry.delete(setId);
		partialInputRegistry.delete(setId);
	}

	// Notes toggle state per exercise
	let notesOpen = $state<Record<string, boolean>>({});

	// Draft note text per exercise (local buffer so textarea is controlled)
	let noteDraft = $state<Record<string, string>>({});

	function getNoteText(weId: string, storeNotes: string | undefined): string {
		return weId in noteDraft ? noteDraft[weId] : (storeNotes ?? '');
	}

	// Debounce timer refs for note saving
	const noteTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	// Bug fix: a note typed within the 400ms debounce window was silently lost
	// if the user tapped Finish/Discard right after typing — the setTimeout
	// save never got a chance to run before the workout was finished/cleared.
	// Call this before finishing/discarding to force any pending note writes
	// through immediately.
	async function flushPendingNotes() {
		const pendingWeIds = Object.keys(noteDraft);
		await Promise.all(
			pendingWeIds.map(async (weId) => {
				if (noteTimers[weId]) clearTimeout(noteTimers[weId]);
				await activeWorkout.updateExerciseNotes(weId, noteDraft[weId].trim());
			})
		);
	}

	// Active side tab per exercise (for unilateral exercises)
	let activeSide = $state<Record<string, 'left' | 'right'>>({});

	// H8: guard against double-tap finish
	let isFinishing = $state(false);

	// Set ids with unsaved partial input (e.g. kg typed but no reps) — shown with a red border
	let flaggedSetIds = $state<Set<string>>(new Set());
	let showPartialInputWarning = $state(false);

	function findPartialInputSets(): string[] {
		const ids: string[] = [];
		for (const [setId, hasPartialFn] of partialInputRegistry) {
			if (hasPartialFn()) ids.push(setId);
		}
		return ids;
	}

	// Entry point for the "Finish" button — checks for partial/unsaved input first
	function requestFinish() {
		const partialIds = findPartialInputSets();
		if (partialIds.length > 0) {
			flaggedSetIds = new Set(partialIds);
			// If a flagged set is on the inactive L/R side, switch to it so the
			// red-bordered set is actually visible to the user.
			for (const [weId, weSets] of Object.entries($activeWorkout.sets)) {
				for (const s of weSets) {
					if (flaggedSetIds.has(s.id) && s.side) {
						activeSide[weId] = s.side;
					}
				}
			}
			showPartialInputWarning = true;
			return;
		}
		showFinishConfirm = true;
	}

	// Called when the user confirms they want to finish despite partial input
	function confirmDespitePartialInput() {
		showPartialInputWarning = false;
		showFinishConfirm = true;
	}

	async function handleFinish() {
		const workoutId = $activeWorkout.workout?.id;
		if (!workoutId || isFinishing) return;
		isFinishing = true;

		// Flush any note still sitting in its 400ms debounce window before we
		// collect resolved set values / finish — otherwise a note typed right
		// before tapping Finish never gets saved.
		await flushPendingNotes();

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
	function getPlaceholders(weId: string, setIndex: number, side?: 'left' | 'right') {
		const allCurrentSets = $activeWorkout.sets[weId] ?? [];
		const prev = $activeWorkout.previousSets[weId];

		// For unilateral exercises, scope both current and previous sets to the active side
		const currentSets = side
			? allCurrentSets.filter((s) => (s.side ?? 'left') === side)
			: allCurrentSets;
		const prevSets = side
			? (prev?.sets ?? []).filter((s) => (s.side ?? 'left') === side)
			: (prev?.sets ?? []);

		let weight: number | undefined;
		let reps: number | undefined;
		let durationSec: number | undefined;
		let distanceKm: number | undefined;

		// Weight: walk backward through current workout sets (same side only)
		// Bug fix: guard against a missing element — currentSets can be shorter
		// than `setIndex` expects in edge cases (e.g. right after switching L/R
		// sides mid-edit, or a set deleted concurrently), which previously threw
		// "Cannot read properties of undefined" and crashed the whole set list.
		for (let j = setIndex - 1; j >= 0; j--) {
			const s = currentSets[j];
			if (s && weight == null && s.weight != null) { weight = s.weight; break; }
		}

		// All fields: fallback to last-workout same-index, same-side set
		if (prevSets[setIndex]) {
			const ps = prevSets[setIndex];
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
					class="w-full rounded-lg bg-zinc-800 px-2 py-1 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-accent-500"
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
				onclick={requestFinish}
				class="rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-white active:bg-accent-600 disabled:opacity-50"
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
							<span class="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-accent-500"></span>
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
					<div class="flex items-center justify-between gap-2">
						<button
							onclick={() => { notesOpen[we.id] = !notesOpen[we.id]; }}
							class="flex items-center gap-1.5 text-xs min-w-0
								{we.notes && !notesOpen[we.id] ? 'text-zinc-300' : 'text-zinc-500'} active:text-zinc-300"
						>
							<!-- Pencil / note icon -->
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
								<path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343z" />
							</svg>
							{#if notesOpen[we.id]}
								<span>Hide note</span>
							{:else if we.notes}
								<span class="truncate max-w-[180px]">{we.notes}</span>
							{:else}
								<span>Add note</span>
							{/if}
						</button>
						{#if we.notes || notesOpen[we.id]}
							{@const currentNoteText = getNoteText(we.id, we.notes)}
							{@const isPinned = exerciseMap[we.exerciseId]?.notes === currentNoteText && !!currentNoteText}
							<button
								onclick={async () => {
									// If there's an unsaved draft, save it first
									if (we.id in noteDraft) {
										clearTimeout(noteTimers[we.id]);
										await activeWorkout.updateExerciseNotes(we.id, noteDraft[we.id].trim());
									}
									const noteToPin = getNoteText(we.id, we.notes);
									if (isPinned) {
										await activeWorkout.pinExerciseNotes(we.exerciseId, '');
									} else {
										await activeWorkout.pinExerciseNotes(we.exerciseId, noteToPin);
									}
									const ex = await db.exercises.get(we.exerciseId);
									if (ex) exerciseMap = { ...exerciseMap, [ex.id]: ex };
								}}
								title={isPinned ? 'Unpin note from exercise' : 'Pin note to exercise'}
								class="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg
									{isPinned ? 'text-accent-500' : 'text-zinc-600 active:text-accent-400'}"
							>
							{#if isPinned}
									<!-- Heroicons 20/solid lock-closed -->
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
										<path fill-rule="evenodd" d="M10 1C7.51472 1 5.5 3.01472 5.5 5.5V9H5C3.89543 9 3 9.89543 3 11V17C3 18.1046 3.89543 19 5 19H15C16.1046 19 17 18.1046 17 17V11C17 9.89543 16.1046 9 15 9H14.5V5.5C14.5 3.01472 12.4853 1 10 1ZM13 9V5.5C13 3.84315 11.6569 2.5 10 2.5C8.34315 2.5 7 3.84315 7 5.5V9H13Z" clip-rule="evenodd" />
									</svg>
								{:else}
									<!-- Heroicons 20/solid lock-open -->
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
										<path fill-rule="evenodd" d="M14.5 1C12.0147 1 10 3.01472 10 5.5V9H3C1.89543 9 1 9.89543 1 11V17C1 18.1046 1.89543 19 3 19H13C14.1046 19 15 18.1046 15 17V11C15 9.89543 14.1046 9 13 9H11.5V5.5C11.5 3.84315 12.8431 2.5 14.5 2.5C16.1569 2.5 17.5 3.84315 17.5 5.5V8.25C17.5 8.66421 17.8358 9 18.25 9C18.6642 9 19 8.66421 19 8.25V5.5C19 3.01472 16.9853 1 14.5 1Z" clip-rule="evenodd" />
									</svg>
								{/if}
							</button>
						{/if}
					</div>
					{#if notesOpen[we.id]}
						<textarea
							value={getNoteText(we.id, we.notes)}
							oninput={(e) => {
								const val = (e.target as HTMLTextAreaElement).value;
								noteDraft[we.id] = val;
								clearTimeout(noteTimers[we.id]);
								noteTimers[we.id] = setTimeout(() => {
									activeWorkout.updateExerciseNotes(we.id, val.trim());
								}, 400);
							}}
							placeholder="Notes for this exercise..."
							rows="2"
							class="mt-1.5 w-full rounded-xl bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
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
										? 'bg-accent-500 text-white'
										: 'bg-zinc-800 text-zinc-400'}"
							>
								{side === 'left' ? 'Left' : 'Right'}
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

				<!-- Bug fix: for unilateral exercises, keep BOTH sides' SetRows mounted at all times
				     and only hide the inactive side with CSS. Previously the inactive side's sets
				     were filtered out of the {#each} entirely, which destroyed those SetRow
				     components (and their onRegister callback) whenever the user switched tabs.
				     That caused two bugs: (1) typed-but-not-yet-completed values on the side you
				     switched away from were silently lost when finishing the workout, and
				     (2) switching tabs removed focused DOM nodes, making the page jump to the
				     top and get covered by the sticky rest-timer bar. Keeping everything mounted
				     fixes both. -->
				{#each sets as set, i (set.id)}
					{@const side = set.side ?? 'left'}
					{@const isActiveSide = !isUnilateral || side === (activeSide[we.id] ?? 'left')}
					{@const sideIndex = isUnilateral ? sets.filter((s) => (s.side ?? 'left') === side).findIndex((s) => s.id === set.id) : i}
					{@const ph = getPlaceholders(we.id, sideIndex, isUnilateral ? side : undefined)}
					<div class={isActiveSide ? '' : 'hidden'}>
						<SetRow
							{set}
							index={sideIndex}
							exerciseType={exercise?.type ?? 'weightReps'}
							placeholderWeight={ph.weight}
							placeholderReps={ph.reps}
							placeholderDurationSec={ph.durationSec}
							placeholderDistanceKm={ph.distanceKm}
							flagIncomplete={flaggedSetIds.has(set.id)}
							onComplete={(resolved) => handleSetComplete(set, we.id, we.exerciseId, resolved)}
							onRegister={(getFn, hasPartialFn) => registerSet(set.id, getFn, hasPartialFn)}
							onUnregister={() => unregisterSet(set.id)}
							onChange={(changes) => activeWorkout.updateSet(set.id, we.id, changes)}
							onDelete={() => { unregisterSet(set.id); activeWorkout.deleteSet(set.id, we.id); }}
						/>
					</div>
				{/each}

				<button
					onclick={() => activeWorkout.addSet(we.id, isUnilateral ? (activeSide[we.id] ?? 'left') : undefined)}
					class="mt-2 w-full rounded-xl border border-dashed border-zinc-700 py-3 text-sm text-zinc-400 active:bg-zinc-800"
				>
					+ {isUnilateral ? `Add ${(activeSide[we.id] ?? 'left') === 'left' ? 'Left' : 'Right'} Set` : 'Add Set'}
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

{#if showPartialInputWarning}
	<div class="fixed inset-0 z-50 flex items-end bg-black/60 p-4">
		<div class="w-full rounded-2xl bg-zinc-900 p-6">
			<h2 class="text-xl font-bold">Unvollständige Eingabe</h2>
			<p class="mt-1 text-sm text-zinc-400">
				Mindestens ein Feld (z. B. kg) wurde ausgefüllt, aber der Satz wurde nicht abgeschlossen —
				die Werte sind rot markiert und gehen sonst verloren. Wirklich beenden?
			</p>
			<div class="mt-4 flex gap-3">
				<button
					onclick={() => (showPartialInputWarning = false)}
					class="flex-1 rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300"
				>
					Zurück
				</button>
				<button
					onclick={confirmDespitePartialInput}
					class="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white"
				>
					Trotzdem beenden
				</button>
			</div>
		</div>
	</div>
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
				<button onclick={handleFinish} disabled={isFinishing} class="flex-1 rounded-xl bg-accent-500 py-3 font-bold text-white disabled:opacity-50">Finish</button>
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
