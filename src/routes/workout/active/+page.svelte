<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { activeWorkout } from '$lib/stores/activeWorkout';
	import { restTimer, formatTime } from '$lib/stores/restTimer';
	import { db } from '$lib/db/schema';
	import { checkAndSavePR } from '$lib/services/pr';
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
		// Bug 4 fix: check redirect in onMount (synchronous, no setTimeout race)
		if (!$activeWorkout.workout) {
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

	async function handleSetComplete(set: ExerciseSet, workoutExerciseId: string, exerciseId: string) {
		await activeWorkout.updateSet(set.id, workoutExerciseId, { completed: true });
		restTimer.start($restTimer.total);
		const exercise = exerciseMap[exerciseId];
		if (exercise) {
			const isNewPR = await checkAndSavePR(exerciseId, { ...set, completed: true }, new Date());
			if (isNewPR) activeWorkout.addPrAlert(exercise.name);
		}
	}

	async function handleFinish() {
		// Bug 5 fix: guard undefined, prevent double-tap
		const workoutId = $activeWorkout.workout?.id;
		if (!workoutId) return;
		await activeWorkout.finish();
		// Bug 12 fix: navigate directly — no $effect-based redirect will fire because
		// goto() is called synchronously here before the effect re-runs
		goto(`/workout/summary/${workoutId}`);
	}

	async function handleDiscard() {
		await activeWorkout.discard();
		goto('/');
	}
</script>

<!-- PR Alert -->
{#if $activeWorkout.prAlerts.length > 0}
	<button
		onclick={() => activeWorkout.clearPrAlerts()}
		class="fixed top-4 left-0 right-0 z-50 flex justify-center px-4 border-0 bg-transparent cursor-pointer"
		aria-label="Dismiss PR alert"
	>
		<div class="rounded-2xl bg-orange-500 px-6 py-3 text-center shadow-xl">
			<p class="text-lg font-bold">🏆 New PR!</p>
			<p class="text-sm font-medium opacity-90">{$activeWorkout.prAlerts.join(', ')}</p>
		</div>
	</button>
{/if}

<div class="flex flex-col gap-4 p-4 pt-4 pb-40">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">{$activeWorkout.workout?.name ?? 'Workout'}</h1>
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
				class="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white active:bg-orange-600"
			>
				Finish
			</button>
		</div>
	</div>

	<!-- Rest timer bar -->
	{#if $restTimer.running}
		<RestTimerBar />
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
			<div animate:flip={{ duration: FLIP_MS }} class="rounded-2xl bg-zinc-900 p-4">
				<div class="mb-3 flex items-center gap-2">
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
					<div class="flex-1">
						<h2 class="font-semibold text-base">{exercise?.name ?? '...'}</h2>
						{#if exercise?.muscleGroup}
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

				{#each sets as set, i (set.id)}
					<SetRow
						{set}
						index={i}
						exerciseType={exercise?.type ?? 'weightReps'}
						onComplete={() => handleSetComplete(set, we.id, we.exerciseId)}
						onChange={(changes) => activeWorkout.updateSet(set.id, we.id, changes)}
						onDelete={() => activeWorkout.deleteSet(set.id, we.id)}
					/>
				{/each}

				<button
					onclick={() => activeWorkout.addSet(we.id)}
					class="mt-2 w-full rounded-xl border border-dashed border-zinc-700 py-3 text-sm text-zinc-400 active:bg-zinc-800"
				>
					+ Add Set
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
				<button onclick={handleFinish} class="flex-1 rounded-xl bg-orange-500 py-3 font-bold text-white">Finish</button>
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
