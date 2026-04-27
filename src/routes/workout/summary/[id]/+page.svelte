<script lang="ts">
	import { page } from '$app/stores';
	import { db } from '$lib/db/schema';
	import type { Workout, WorkoutExercise, ExerciseSet, Exercise } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { epley } from '$lib/services/pr';

	interface ExerciseSummary {
		exercise: Exercise;
		sets: ExerciseSet[];
		totalVolume: number;
		bestSet: ExerciseSet | null;
		bestOneRM: number | null;
		isNewPR: boolean;
	}

	let workout: Workout | null = $state(null);
	let summaries: ExerciseSummary[] = $state([]);
	let totalVolume = $state(0);
	let totalSets = $state(0);
	let totalReps = $state(0);

	onMount(async () => {
		const id = $page.params.id;
		workout = (await db.workouts.get(id)) ?? null;
		if (!workout) { goto('/history'); return; }

		const wes = await db.workoutExercises.where('workoutId').equals(id).sortBy('order');
		const result: ExerciseSummary[] = [];

		for (const we of wes) {
			const exercise = await db.exercises.get(we.exerciseId);
			if (!exercise) continue;
			const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order');
			const completedSets = sets.filter((s) => s.completed);

			// Volume
			const vol = completedSets.reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);

			// Best set by estimated 1RM
			let bestSet: ExerciseSet | null = null;
			let bestOneRM: number | null = null;
			for (const s of completedSets) {
				if (s.weight && s.reps) {
					const orm = epley(s.weight, s.reps);
					if (!bestOneRM || orm > bestOneRM) {
						bestOneRM = orm;
						bestSet = s;
					}
				}
			}

			// Check if this is a PR
			const allPRs = await db.personalRecords.where('exerciseId').equals(exercise.id).sortBy('date');
			const recentPR = allPRs[allPRs.length - 1];
			const isNewPR = recentPR
				? new Date(recentPR.date).getTime() > (workout?.date ? new Date(workout.date).getTime() - 5000 : 0)
				: false;

			totalVolume += vol;
			totalSets += completedSets.length;
			totalReps += completedSets.reduce((sum, s) => sum + (s.reps ?? 0), 0);

			result.push({ exercise, sets: completedSets, totalVolume: vol, bestSet, bestOneRM, isNewPR });
		}

		summaries = result;
	});

	function formatDuration(sec?: number) {
		if (!sec) return '—';
		const m = Math.floor(sec / 60);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}

	function formatDate(d: Date) {
		return new Date(d).toLocaleDateString('en-GB', {
			weekday: 'long', day: 'numeric', month: 'long'
		});
	}

	function formatSet(set: ExerciseSet, type: string) {
		if (type === 'weightReps') return `${set.weight ?? '—'} kg × ${set.reps ?? '—'}`;
		if (type === 'bodyweightReps') return `${set.reps ?? '—'} reps`;
		if (type === 'time') return `${set.durationSec ?? '—'}s`;
		if (type === 'distance') return `${set.distanceM ? (set.distanceM / 1000).toFixed(2) : '—'} km`;
		return '';
	}
</script>

<div class="flex flex-col gap-5 p-4 pt-4 pb-8">
	<!-- Header -->
	<div class="text-center">
		<div class="text-5xl mb-3">🏆</div>
		<h1 class="text-2xl font-bold">Workout Complete!</h1>
		{#if workout}
			<p class="mt-1 text-zinc-400">{formatDate(workout.date)}</p>
		{/if}
	</div>

	<!-- Stats bar -->
	<div class="grid grid-cols-3 gap-3">
		<div class="rounded-2xl bg-zinc-900 p-3 text-center">
			<p class="text-xl font-bold text-orange-500">{formatDuration(workout?.durationSec)}</p>
			<p class="text-xs text-zinc-500 mt-0.5">Duration</p>
		</div>
		<div class="rounded-2xl bg-zinc-900 p-3 text-center">
			<p class="text-xl font-bold text-orange-500">{totalSets}</p>
			<p class="text-xs text-zinc-500 mt-0.5">Sets</p>
		</div>
		<div class="rounded-2xl bg-zinc-900 p-3 text-center">
			<p class="text-xl font-bold text-orange-500">
				{totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume}
			</p>
			<p class="text-xs text-zinc-500 mt-0.5">Vol (kg)</p>
		</div>
	</div>

	<!-- Per-exercise summary -->
	<div class="flex flex-col gap-3">
		{#each summaries as s}
			<div class="rounded-2xl bg-zinc-900 p-4">
				<div class="flex items-start justify-between mb-3">
					<div>
						<h2 class="font-semibold">{s.exercise.name}</h2>
						<p class="text-xs text-zinc-500 capitalize">{s.exercise.muscleGroup}</p>
					</div>
					<div class="flex flex-col items-end gap-1">
						{#if s.isNewPR}
							<span class="rounded-full bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 text-xs font-semibold text-orange-400">
								🏆 New PR
							</span>
						{/if}
						{#if s.totalVolume > 0}
							<span class="text-xs text-zinc-500">{s.totalVolume} kg vol</span>
						{/if}
					</div>
				</div>

				<!-- Sets list -->
				<div class="flex flex-col gap-1">
					{#each s.sets as set, i}
						<div class="flex justify-between text-sm">
							<span class="text-zinc-500">Set {i + 1}</span>
							<span class="font-medium">{formatSet(set, s.exercise.type)}</span>
						</div>
					{/each}
				</div>

				{#if s.bestOneRM && s.bestSet}
					<div class="mt-3 rounded-xl bg-zinc-800 px-3 py-2 flex justify-between items-center">
						<span class="text-xs text-zinc-400">Best set</span>
						<div class="text-right">
							<span class="text-sm font-semibold">{formatSet(s.bestSet, s.exercise.type)}</span>
							<span class="ml-2 text-xs text-orange-400">~{s.bestOneRM} kg 1RM</span>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Actions -->
	<div class="flex flex-col gap-2 pt-2">
		<button
			onclick={() => goto('/')}
			class="w-full rounded-2xl bg-orange-500 py-4 text-base font-bold text-white active:bg-orange-600"
		>
			Done
		</button>
		<a
			href="/history/{workout?.id}"
			class="block w-full rounded-2xl border border-zinc-800 py-3 text-center text-sm font-medium text-zinc-400 active:bg-zinc-900"
		>
			View Full History Entry
		</a>
	</div>
</div>
