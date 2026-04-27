<script lang="ts">
	import { goto } from '$app/navigation';
	import { activeWorkout } from '$lib/stores/activeWorkout';
	import { restTimer, formatTime } from '$lib/stores/restTimer';
	import { db } from '$lib/db/schema';
	import { checkAndSavePR } from '$lib/services/pr';
	import type { Exercise, ExerciseSet } from '$lib/db/schema';
	import ExercisePicker from '$lib/components/ExercisePicker.svelte';
	import SetRow from '$lib/components/SetRow.svelte';
	import RestTimerBar from '$lib/components/RestTimerBar.svelte';

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

	$effect(() => {
		if (!$activeWorkout.workout) {
			activeWorkout.start();
		}
	});

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
		await activeWorkout.finish();
		goto('/history');
	}

	async function handleDiscard() {
		await activeWorkout.discard();
		goto('/');
	}

	function elapsedTime() {
		if (!$activeWorkout.startedAt) return '0:00';
		const sec = Math.floor((Date.now() - new Date($activeWorkout.startedAt).getTime()) / 1000);
		return formatTime(sec);
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

<div class="flex flex-col gap-4 p-4 pt-12 pb-40">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">{$activeWorkout.workout?.name ?? 'Workout'}</h1>
			<p class="text-sm text-zinc-400">{elapsedTime()}</p>
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
	{#each $activeWorkout.workoutExercises as we (we.id)}
		{@const exercise = exerciseMap[we.exerciseId]}
		{@const sets = $activeWorkout.sets[we.id] ?? []}
		<div class="rounded-2xl bg-zinc-900 p-4">
			<div class="mb-3 flex items-center justify-between">
				<div>
					<h2 class="font-semibold text-base">{exercise?.name ?? '...'}</h2>
					{#if exercise?.muscleGroup}
						<span class="text-xs text-zinc-500 capitalize">{exercise.muscleGroup}</span>
					{/if}
				</div>
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
