<script lang="ts">
	import { page } from '$app/stores';
	import { db } from '$lib/db/schema';
	import type { Workout, WorkoutExercise, ExerciseSet, Exercise, PersonalRecord } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { epley, getPRsForWorkout } from '$lib/services/pr';
	// S8: dynamic import to avoid SSR crash (canvas-confetti touches window/document)

	interface ExerciseSummary {
		exercise: Exercise;
		sets: ExerciseSet[];
		totalVolume: number;
		bestSet: ExerciseSet | null;
		bestOneRM: number | null;
		prSetIds: Set<string>; // set ids that are PRs in this workout
		prBuckets: string[];   // labels like '5RM', 'duration' for this exercise
	}

	let workout: Workout | null = $state(null);
	let summaries: ExerciseSummary[] = $state([]);
	let totalVolume = $state(0);
	let totalSets = $state(0);
	let totalReps = $state(0);
	let workoutPRs: PersonalRecord[] = $state([]);
	let exerciseNameMap: Record<string, string> = $state({});

	onMount(async () => {
		const id = $page.params.id;
		workout = (await db.workouts.get(id)) ?? null;
		if (!workout) { goto('/history'); return; }

		const wes = await db.workoutExercises.where('workoutId').equals(id).sortBy('order');
		const result: ExerciseSummary[] = [];

		// Load PRs for this workout
		const prs = await getPRsForWorkout(id);
		workoutPRs = prs;

		// Build setId → PR mapping
		const prBySetId = new Map<string, PersonalRecord[]>();
		for (const pr of prs) {
			const list = prBySetId.get(pr.setId) ?? [];
			list.push(pr);
			prBySetId.set(pr.setId, list);
		}

		let volTotal = 0, setsTotal = 0, repsTotal = 0;

		for (const we of wes) {
			const exercise = await db.exercises.get(we.exerciseId);
			if (!exercise) continue;
			const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order');
			const completedSets = sets.filter((s) => s.completed);

			const vol = completedSets.reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);

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

			// Which sets are PRs?
			const prSetIds = new Set<string>();
			const prBuckets: string[] = [];
			for (const s of completedSets) {
				const sePRs = prBySetId.get(s.id) ?? [];
				if (sePRs.length) {
					prSetIds.add(s.id);
					for (const pr of sePRs) {
						const label = pr.category === 'strength' ? (pr.bucket ?? 'PR') : pr.category;
						if (!prBuckets.includes(label)) prBuckets.push(label);
					}
				}
			}

			volTotal += vol;
			setsTotal += completedSets.length;
			repsTotal += completedSets.reduce((sum, s) => sum + (s.reps ?? 0), 0);

			exerciseNameMap[exercise.id] = exercise.name;
			result.push({ exercise, sets: completedSets, totalVolume: vol, bestSet, bestOneRM, prSetIds, prBuckets });
		}

		totalVolume = volTotal;
		totalSets = setsTotal;
		totalReps = repsTotal;
		summaries = result;

		// Fire confetti if any PRs were hit
		if (prs.length > 0) {
			setTimeout(async () => {
				const { default: confetti } = await import('canvas-confetti');
				confetti({
					particleCount: 120,
					spread: 80,
					origin: { y: 0.5 },
					colors: ['#fbbf24', '#f97316', '#ffffff', '#fde68a']
				});
			}, 300);
		}
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

	function formatVolSummary(kg: number) {
		if (kg >= 1000) return `${(kg / 1000).toFixed(2).replace(/\.?0+$/, '')}t`;
		return `${kg} kg`;
	}

	function prLabel(pr: PersonalRecord): string {
		if (pr.category === 'strength') {
			return `${pr.bucket} · ${pr.weight} kg × ${pr.reps}`;
		} else if (pr.category === 'duration') {
			return `Best duration · ${pr.durationSec}s`;
		} else {
			return `Best distance · ${pr.distanceM ? (pr.distanceM / 1000).toFixed(2) : '—'} km`;
		}
	}
</script>

<div class="flex flex-col gap-5 p-4 pt-12 pb-8">
	<!-- Header -->
	<div class="text-center">
		<div class="text-5xl mb-3">🏋️</div>
		<h1 class="text-2xl font-bold">Workout Complete!</h1>
		{#if workout}
			<p class="mt-1 text-zinc-400">{formatDate(workout.date)}</p>
			{#if workout.name}
				<p class="mt-0.5 text-sm font-semibold text-orange-400">{workout.name}</p>
			{/if}
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
			<p class="text-xl font-bold text-orange-500">{formatVolSummary(totalVolume)}</p>
			<p class="text-xs text-zinc-500 mt-0.5">Volume</p>
		</div>
	</div>

	<!-- PR Banner (if any PRs were hit) -->
	{#if workoutPRs.length > 0}
		<div class="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
			<p class="text-sm font-bold text-yellow-400 mb-2">
				🏆 {workoutPRs.length} new personal record{workoutPRs.length > 1 ? 's' : ''}!
			</p>
			<div class="flex flex-col gap-1">
				{#each workoutPRs as pr}
					<div class="flex items-center gap-2 text-sm">
						<span class="text-yellow-500 shrink-0">▲</span>
						<span class="text-zinc-200 font-medium">{exerciseNameMap[pr.exerciseId] ?? '...'}</span>
						<span class="text-zinc-400">·</span>
						<span class="text-zinc-300">{prLabel(pr)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

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
						{#if s.prBuckets.length > 0}
							<div class="flex flex-wrap gap-1 justify-end">
								{#each s.prBuckets as bucket}
									<span class="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-xs font-bold text-yellow-400">
										🏆 {bucket}
									</span>
								{/each}
							</div>
						{/if}
						{#if s.totalVolume > 0}
							<span class="text-xs text-zinc-500">{s.totalVolume} kg vol</span>
						{/if}
					</div>
				</div>

				<!-- Sets list -->
				<div class="flex flex-col gap-1">
					{#each s.sets as set, i}
						<div class="flex justify-between items-center text-sm {s.prSetIds.has(set.id) ? 'text-yellow-300' : ''}">
							<span class="text-zinc-500 flex items-center gap-1">
								Set {i + 1}
								{#if s.prSetIds.has(set.id)}
									<span class="text-yellow-500 text-xs">🏆</span>
								{/if}
							</span>
							<span class="font-medium {s.prSetIds.has(set.id) ? 'text-yellow-300' : ''}">{formatSet(set, s.exercise.type)}</span>
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
