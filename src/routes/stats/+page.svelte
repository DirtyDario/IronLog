<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db/schema';
	import type { Exercise, PersonalRecord } from '$lib/db/schema';
	import {
		getLifetimeTotals,
		getStreak,
		getWeeklyFrequency,
		getMuscleDistribution,
		getAllTimeBests,
		getExerciseProgressCounts,
		setHasUsableData,
		formatDuration,
		formatVolume,
		type WeekCount,
		type MuscleCount,
		type ExerciseBest
	} from '$lib/services/stats';
	import { getBestPerBucket, getPRsForExercise, ALL_BUCKETS, epley } from '$lib/services/pr';
	import type { PRBucket } from '$lib/db/schema';
	import { Bar, Doughnut, Line } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		CategoryScale,
		LinearScale,
		BarElement,
		PointElement,
		LineElement,
		ArcElement,
		Title,
		Tooltip,
		Filler,
		Legend
	} from 'chart.js';

	ChartJS.register(
		CategoryScale, LinearScale, BarElement,
		PointElement, LineElement, ArcElement,
		Title, Tooltip, Filler, Legend
	);

	// State
	let loaded = $state(false);
	let totalWorkouts = $state(0);
	let totalTimeSec = $state(0);
	let totalVolume = $state(0);
	let totalSets = $state(0);
	let streak = $state(0);
	let weeklyData: WeekCount[] = $state([]);
	let muscleData: MuscleCount[] = $state([]);
	let bests: ExerciseBest[] = $state([]);
	let exercises: Exercise[] = $state([]);
	let exercisePrCounts: Record<string, number> = $state({});
	let selectedExId: string | null = $state(null);
	let prs: PersonalRecord[] = $state([]);
	let sessionData: { date: string; value: number }[] = $state([]);
	// Temporary diagnostic surfaced in the "no data" placeholder — helps pin
	// down exactly which stage of the Progress-tab query chain comes up empty
	// on a real device, without needing dev tools access.
	let progressDebug: string | null = $state(null);

	// Active section
	let activeTab = $state<'overview' | 'frequency' | 'muscles' | 'progress' | 'bests' | 'prs'>('overview');

	// PR tab state
	let prSelectedExId = $state<string | null>(null);
	let prBests = $state<Record<PRBucket, PersonalRecord | null> | null>(null);
	let prTimeline: PersonalRecord[] = $state([]);
	let prExercises: Exercise[] = $state([]);  // exercises that have ≥1 PR
	let prExerciseMap: Record<string, Exercise> = $state({});

	$effect(() => {
		if (prSelectedExId) {
			// M16: cancellation token for PR tab
			const id = prSelectedExId;
			(async () => {
				const [bests, timeline] = await Promise.all([
					getBestPerBucket(id),
					getPRsForExercise(id)
				]);
				if (prSelectedExId !== id) return; // M16: stale
				prBests = bests;
				prTimeline = timeline.slice().reverse(); // newest first
			})();
		} else {
			prBests = null;
			prTimeline = [];
		}
	});

	onMount(async () => {
		const [totals, str, weekly, muscle, allBests, exs] = await Promise.all([
			getLifetimeTotals(),
			getStreak(),
			getWeeklyFrequency(),
			getMuscleDistribution(),
			getAllTimeBests(),
			db.exercises.orderBy('name').toArray()
		]);
		totalWorkouts = totals.totalWorkouts;
		totalTimeSec = totals.totalTimeSec;
		totalVolume = totals.totalVolume;
		totalSets = totals.totalSets;
		streak = str;
		weeklyData = weekly;
		muscleData = muscle;
		bests = allBests;

		// Build exercise list for Progress tab:
		// Only show exercises that have at least one completed set with actual data written.
		//
		// This uses the same type-aware criteria (see setHasUsableData in
		// stats.ts) as the Progress chart itself, so the "(N)" count shown next
		// to each exercise name can never disagree with whether the chart
		// actually renders data for it.
		const countsByEx = await getExerciseProgressCounts();
		const exIds = new Set(Object.keys(countsByEx));
		exercises = exs
			.filter((e) => exIds.has(e.id))
			.sort((a, b) => (countsByEx[b.id] ?? 0) - (countsByEx[a.id] ?? 0) || a.name.localeCompare(b.name));
		exercisePrCounts = countsByEx;

		// PR tab: exercises that have at least one PR record
		const allPRs = await db.personalRecords.toArray();
		const prExIds = new Set(allPRs.map((p) => p.exerciseId));
		const exMap: Record<string, Exercise> = {};
		for (const e of exs) exMap[e.id] = e;
		prExerciseMap = exMap;
		prExercises = exs
			.filter((e) => prExIds.has(e.id))
			.sort((a, b) => a.name.localeCompare(b.name));

		loaded = true;
	});

	// M1: cancellation counter — incremented each time selectedExId changes
	let progressLoadSeq = $state(0);

	$effect(() => {
		if (selectedExId) {
			sessionData = [];
			prs = [];
			progressDebug = null;
			// M1: capture current seq at start of this async run
			const seq = ++progressLoadSeq;
			(async () => {
				try {
					const prData = await db.personalRecords
						.where('exerciseId').equals(selectedExId).sortBy('date');
					if (progressLoadSeq !== seq) return; // stale — discard
					prs = prData;

					const wes = await db.workoutExercises.where('exerciseId').equals(selectedExId).toArray();
					const workoutIds = [...new Set(wes.map((w) => w.workoutId))];
					const workouts = await db.workouts
						.where('id').anyOf(workoutIds)
						.filter((w) => !!w.finishedAt)
						.toArray();
					workouts.sort((a, b) => new Date(a.finishedAt!).getTime() - new Date(b.finishedAt!).getTime());

					const exRecord = await db.exercises.get(selectedExId);
					const exType = exRecord?.type ?? 'weightReps';

					const sessionPoints: { date: string; value: number }[] = [];
					let setsSeen = 0;
					let setsUsable = 0;
					for (const workout of workouts) {
						// Bug fix: use ALL workoutExercise rows for this exercise in this
						// workout, not just the first match. If the exercise was added
						// more than once in the same session (e.g. removed & re-added),
						// `.find()` could grab an empty leftover row and hide real data
						// for that session — this is why some exercises showed "No data
						// yet" in Progress even though sets were logged for the workout.
						const wesInWorkout = wes.filter((w) => w.workoutId === workout.id);
						if (!wesInWorkout.length) continue;
						const allSets = (
							await Promise.all(wesInWorkout.map((we) => db.sets.where('workoutExerciseId').equals(we.id).toArray()))
						).flat();
						setsSeen += allSets.length;

						let maxVal = 0;
						if (exType === 'weightReps') {
							// Bug fix: previously plotted the max raw weight per session,
							// ignoring reps entirely — a 100kg×1 single would outrank a
							// 95kg×12 set, showing "progress" trending the wrong way. Use
							// estimated 1RM (Epley) per set instead, consistent with the
							// Bests tab and PR system.
							const sets = allSets.filter((s) => setHasUsableData(s, exType));
							setsUsable += sets.length;
							if (!sets.length) continue;
							maxVal = Math.max(...sets.map((s) => epley(s.weight!, s.reps!)));
						} else if (exType === 'bodyweightReps') {
							const sets = allSets.filter((s) => setHasUsableData(s, exType));
							setsUsable += sets.length;
							if (!sets.length) continue;
							maxVal = Math.max(...sets.map((s) => s.reps!));
						} else if (exType === 'time') {
							const sets = allSets.filter((s) => setHasUsableData(s, exType));
							setsUsable += sets.length;
							if (!sets.length) continue;
							maxVal = Math.max(...sets.map((s) => s.durationSec!));
						} else if (exType === 'distance') {
							const sets = allSets.filter((s) => setHasUsableData(s, exType));
							setsUsable += sets.length;
							if (!sets.length) continue;
							maxVal = Math.max(...sets.map((s) => s.distanceM!));
						}
						sessionPoints.push({
							date: new Date(workout.finishedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
							value: maxVal
						});
					}
					if (progressLoadSeq !== seq) return; // stale
					sessionData = sessionPoints;
					if (!sessionPoints.length) {
						progressDebug =
							`debug: exType=${exType}, workoutExerciseRows=${wes.length}, ` +
							`distinctWorkoutIds=${workoutIds.length}, finishedWorkoutsFound=${workouts.length}, ` +
							`totalSetsSeen=${setsSeen}, usableSets=${setsUsable}`;
					}
				} catch (err) {
					if (progressLoadSeq !== seq) return;
					progressDebug = `error: ${err instanceof Error ? err.message : String(err)}`;
				}
			})();
		}
	});

	// Chart data
	let freqChartData = $derived({
		labels: weeklyData.map((w) => w.label),
		datasets: [{
			label: 'Workouts',
			data: weeklyData.map((w) => w.count),
			backgroundColor: '#f97316cc',
			borderRadius: 6,
			borderSkipped: false
		}]
	});

	const muscleColors = [
		'#f97316', // orange  — chest
		'#3b82f6', // blue    — back
		'#22c55e', // green   — legs
		'#a855f7', // purple  — shoulders
		'#ef4444', // red     — biceps
		'#eab308', // yellow  — triceps
		'#06b6d4', // cyan    — glutes
		'#ec4899', // pink    — core
		'#14b8a6', // teal    — cardio
		'#f59e0b', // amber   — full body
		'#6366f1', // indigo  — other
	];

	let muscleChartData = $derived({
		labels: muscleData.map((m) => m.muscle),
		datasets: [{
			data: muscleData.map((m) => m.count),
			backgroundColor: muscleColors.slice(0, muscleData.length),
			borderWidth: 0
		}]
	});

	// Bug 17 fix: $derived.by() for multi-statement block, use as value not function call
	let progressChartData = $derived.by(() => {
		if (!sessionData.length) return null;
		// H2: label depends on exercise type
		// Bug fix: relabeled to match the Epley-1RM values now plotted for
		// weightReps exercises (see the sessionData-building effect above).
		const type = selectedExercise?.type ?? 'weightReps';
		const label = type === 'weightReps' ? 'Est. 1RM (kg)'
			: type === 'bodyweightReps' ? 'Max reps'
			: type === 'time' ? 'Max duration (s)'
			: 'Max distance (m)';
		return {
			labels: sessionData.map((p) => p.date),
			datasets: [{
				label,
				data: sessionData.map((p) => p.value),
				borderColor: '#f97316',
				backgroundColor: 'rgba(249,115,22,0.1)',
				tension: 0.3,
				fill: true,
				pointRadius: 4,
				pointBackgroundColor: '#f97316'
			}]
		};
	});

	const chartOpts = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: false } },
		scales: {
			x: { grid: { color: '#27272a' }, ticks: { color: '#71717a', maxTicksLimit: 6 } },
			y: { grid: { color: '#27272a' }, ticks: { color: '#71717a' }, beginAtZero: true }
		}
	};

	// H2: progress chart opts — y-axis label adapts to exercise type
	let progressChartOpts = $derived.by(() => {
		const type = selectedExercise?.type ?? 'weightReps';
		// Bug fix: Chart.js's tick callback signature is
		// `(tickValue: string | number, ...) => ...`, not `(value: number) => ...`
		// — the previous narrower type caused a type error. Coerce to number
		// since our y-axis is always numeric.
		const yLabel = (tickValue: string | number) => {
			const value = typeof tickValue === 'number' ? tickValue : parseFloat(tickValue);
			return type === 'weightReps' ? `${value} kg`
			: type === 'bodyweightReps' ? `${value} reps`
			: type === 'time' ? `${value}s`
			: `${(value / 1000).toFixed(1)} km`;
		};
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				x: { grid: { color: '#27272a' }, ticks: { color: '#71717a', maxTicksLimit: 6 } },
				y: {
					grid: { color: '#27272a' },
					ticks: { color: '#71717a', callback: yLabel },
					beginAtZero: false
				}
			}
		};
	});

	const doughnutOpts = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: { display: true, position: 'bottom' as const, labels: { color: '#a1a1aa', boxWidth: 12, padding: 8 } }
		}
	};

	const tabs = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'frequency', label: 'Frequency' },
		{ id: 'muscles', label: 'Muscles' },
		{ id: 'progress', label: 'Progress' },
		{ id: 'bests', label: 'Bests' },
		{ id: 'prs', label: 'PRs' }
	] as const;

	let selectedExercise = $derived(exercises.find((e) => e.id === selectedExId));

	// Frequency summary stats
	let freqAvg = $derived(weeklyData.length ? (weeklyData.reduce((s, w) => s + w.count, 0) / weeklyData.length).toFixed(1) : '0');
	let freqMax = $derived(weeklyData.length ? Math.max(...weeklyData.map((w) => w.count)) : 0);
	let freqActive = $derived(weeklyData.filter((w) => w.count > 0).length);
</script>

<div class="flex flex-col pb-8">
	<!-- Header -->
	<div class="px-4 pt-4 pb-4">
		<h1 class="text-3xl font-bold tracking-tight">Stats</h1>
	</div>

	<!-- Section tabs -->
	<div class="flex gap-2 overflow-x-auto px-4 pb-4 scrollbar-hide">
		{#each tabs as tab}
			<button
				onclick={() => (activeTab = tab.id)}
				class="shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors
					{activeTab === tab.id
					? 'bg-accent-500 text-white'
					: 'bg-zinc-900 text-zinc-400 active:bg-zinc-800'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#if !loaded}
		<div class="flex justify-center py-16 text-zinc-500">Loading...</div>
	{:else}

	<!-- ── OVERVIEW ─────────────────────────────────────────── -->
	{#if activeTab === 'overview'}
		<div class="flex flex-col gap-4 px-4">
			<!-- Streak banner -->
			{#if streak > 0}
				<div class="rounded-2xl bg-accent-500/10 border border-accent-500/30 p-4 flex items-center gap-4">
					<div class="text-4xl">🔥</div>
					<div>
						<p class="text-2xl font-bold text-accent-400">{streak} week{streak !== 1 ? 's' : ''}</p>
						<p class="text-sm text-zinc-400">Current training streak</p>
					</div>
				</div>
			{/if}

			<!-- Stat grid -->
			<div class="grid grid-cols-2 gap-3">
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-accent-500">{totalWorkouts}</p>
					<p class="text-sm text-zinc-400 mt-0.5">Workouts</p>
				</div>
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-accent-500">{formatDuration(totalTimeSec)}</p>
					<p class="text-sm text-zinc-400 mt-0.5">Total Time</p>
				</div>
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-accent-500">{formatVolume(totalVolume)}</p>
					<p class="text-sm text-zinc-400 mt-0.5">Volume Lifted</p>
				</div>
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-accent-500">{totalSets}</p>
					<p class="text-sm text-zinc-400 mt-0.5">Sets Completed</p>
				</div>
			</div>

			{#if totalWorkouts === 0}
				<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
					<p class="text-4xl">📊</p>
					<p class="mt-2 font-medium">No data yet</p>
					<p class="text-sm">Complete some workouts to see your stats</p>
				</div>
			{/if}
		</div>

	<!-- ── FREQUENCY ────────────────────────────────────────── -->
	{:else if activeTab === 'frequency'}
		<div class="px-4">
			<h2 class="mb-3 text-lg font-semibold">Workouts per Week</h2>
			<p class="mb-4 text-sm text-zinc-500">Last 12 weeks</p>
			{#if weeklyData.some((w) => w.count > 0)}
				<div class="rounded-2xl bg-zinc-900 p-4">
					<div class="h-52">
						<Bar data={freqChartData} options={chartOpts} />
					</div>
				</div>
				<div class="mt-4 grid grid-cols-3 gap-3">
					<div class="rounded-2xl bg-zinc-900 p-3 text-center">
						<p class="text-2xl font-bold text-accent-500">{freqAvg}</p>
						<p class="text-xs text-zinc-500 mt-0.5">Avg / week</p>
					</div>
					<div class="rounded-2xl bg-zinc-900 p-3 text-center">
						<p class="text-2xl font-bold text-accent-500">{freqMax}</p>
						<p class="text-xs text-zinc-500 mt-0.5">Best week</p>
					</div>
					<div class="rounded-2xl bg-zinc-900 p-3 text-center">
						<p class="text-2xl font-bold text-accent-500">{freqActive}</p>
						<p class="text-xs text-zinc-500 mt-0.5">Active weeks</p>
					</div>
				</div>
			{:else}
				<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
					<p>No workouts in the last 12 weeks</p>
				</div>
			{/if}
		</div>

	<!-- ── MUSCLES ───────────────────────────────────────────── -->
	{:else if activeTab === 'muscles'}
		<div class="px-4">
			<h2 class="mb-1 text-lg font-semibold">Muscle Group Split</h2>
			<p class="mb-4 text-sm text-zinc-500">Based on all exercises logged</p>
			{#if muscleData.length > 0}
				<div class="rounded-2xl bg-zinc-900 p-4">
					<div class="h-64">
						<Doughnut data={muscleChartData} options={doughnutOpts} />
					</div>
				</div>
				<div class="mt-4 flex flex-col gap-2">
					{#each muscleData as { muscle, count }, i}
						<div class="flex items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3">
							<div class="h-3 w-3 rounded-full shrink-0" style="background:{muscleColors[i % muscleColors.length]}"></div>
							<span class="flex-1 capitalize font-medium">{muscle}</span>
							<span class="text-sm text-zinc-400">{count} exercise{count !== 1 ? 's' : ''}</span>
							<div class="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
								<div class="h-full rounded-full" style="width:{(count / muscleData[0].count) * 100}%;background:{muscleColors[i % muscleColors.length]}"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
					<p>No data yet — log some workouts first</p>
				</div>
			{/if}
		</div>

	<!-- ── PROGRESS ──────────────────────────────────────────── -->
	{:else if activeTab === 'progress'}
		<div class="px-4">
			<h2 class="mb-3 text-lg font-semibold">Exercise Progress</h2>
			<select
				bind:value={selectedExId}
				class="mb-4 w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none"
			>
				<option value={null}>Select an exercise...</option>
				{#each exercises as ex}
					<option value={ex.id}>{ex.name} ({exercisePrCounts[ex.id] ?? 0})</option>
				{/each}
			</select>

			{#if selectedExId && progressChartData}
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="mb-3 font-semibold">{selectedExercise?.name}</p>
					<div class="h-48">
						<Line data={progressChartData} options={progressChartOpts} />
					</div>
			{#if prs.length}
					{@const best = prs.reduce((b, pr) => {
						// M2: compare using the right field per category, not always weight
						const bVal = b.weight ?? b.reps ?? b.durationSec ?? b.distanceM ?? 0;
						const pVal = pr.weight ?? pr.reps ?? pr.durationSec ?? pr.distanceM ?? 0;
						return pVal > bVal ? pr : b;
					})}
						<div class="mt-4 rounded-xl bg-accent-500/10 border border-accent-500/20 p-3">
							<p class="text-xs font-medium text-accent-400 mb-1">All-Time Best</p>
							{#if best.weight && best.reps}
								<p class="text-lg font-bold">{best.weight} kg × {best.reps} reps</p>
								<p class="text-sm text-zinc-400">~{epley(best.weight, best.reps)} kg est. 1RM</p>
							{:else if best.reps}
								<!-- Bug fix: bodyweight (reps-only, no weight) PRs previously
								     matched none of the branches here and rendered a blank card
								     with just the "All-Time Best" header and no value. -->
								<p class="text-lg font-bold">{best.reps} reps</p>
							{:else if best.durationSec}
								<p class="text-lg font-bold">{best.durationSec}s</p>
							{:else if best.distanceM}
								<p class="text-lg font-bold">{(best.distanceM / 1000).toFixed(2)} km</p>
							{/if}
						</div>
					{/if}
				</div>
			{:else if selectedExId}
				<div class="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500">
					<p>No data yet for this exercise</p>
					{#if progressDebug}
						<p class="mt-2 text-xs text-zinc-600 break-all">{progressDebug}</p>
					{/if}
				</div>
			{/if}
		</div>

	<!-- ── BESTS ─────────────────────────────────────────────── -->
	{:else if activeTab === 'bests'}
		<div class="px-4">
			<h2 class="mb-1 text-lg font-semibold">Personal Records</h2>
			<p class="mb-4 text-sm text-zinc-500">Your all-time best for every exercise</p>
			{#if bests.length === 0}
				<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
					<p>No PRs yet — complete some sets!</p>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each bests as b}
						<div class="rounded-xl bg-zinc-900 px-4 py-3 flex items-center justify-between">
							<div>
								<p class="font-medium">{b.exerciseName}</p>
								<p class="text-xs text-zinc-500 capitalize">{b.muscleGroup}</p>
								{#if b.bestWeight && b.bestReps}
									<p class="text-sm text-zinc-300 mt-0.5">{b.bestWeight} kg × {b.bestReps} reps</p>
								{:else if b.bestDuration}
									<p class="text-sm text-zinc-300 mt-0.5">{b.bestDuration}s</p>
								{:else if b.bestDistance}
									<p class="text-sm text-zinc-300 mt-0.5">{(b.bestDistance / 1000).toFixed(2)} km</p>
								{/if}
							</div>
							{#if b.bestOneRM}
								<div class="text-right">
									<p class="text-base font-bold text-accent-400">~{b.bestOneRM} kg</p>
									<p class="text-xs text-zinc-500">est. 1RM</p>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

	<!-- ── PRs ────────────────────────────────────────────────── -->
	{:else if activeTab === 'prs'}
		<div class="px-4">
			<h2 class="mb-1 text-lg font-semibold">Personal Records</h2>
			<p class="mb-4 text-sm text-zinc-500">Best per rep range, per exercise</p>

			<select
				bind:value={prSelectedExId}
				class="mb-4 w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none"
			>
				<option value={null}>Select an exercise...</option>
				{#each prExercises as ex}
					<option value={ex.id}>{ex.name}</option>
				{/each}
			</select>

			{#if prSelectedExId && prBests}
				<!-- M9: only show strength bucket grid if exercise has strength PRs -->
				{@const hasStrengthPRs = ALL_BUCKETS.some((b) => prBests![b] !== null)}
				{#if hasStrengthPRs}
				<div class="grid grid-cols-3 gap-2 mb-4 sm:grid-cols-4">
					{#each ALL_BUCKETS as bucket}
						{@const pr = prBests[bucket]}
						<div class="rounded-xl {pr ? 'bg-zinc-900 border border-yellow-500/20' : 'bg-zinc-900/50 border border-zinc-800'} p-3 text-center">
							<p class="text-xs font-bold {pr ? 'text-yellow-400' : 'text-zinc-600'} mb-1">{bucket}</p>
							{#if pr}
								{#if pr.weight}
									<p class="text-sm font-bold text-white leading-tight">{pr.weight} kg</p>
									<p class="text-xs text-zinc-400">× {pr.reps}</p>
								{:else}
									<p class="text-sm font-bold text-white leading-tight">{pr.reps} reps</p>
								{/if}
								<p class="text-xs text-zinc-600 mt-1">{new Date(pr.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
							{:else}
								<p class="text-xs text-zinc-700 mt-2">—</p>
							{/if}
						</div>
					{/each}
				</div>
				{/if}

				<!-- H3: Cardio PRs — best = max over all PRs (not just find-first) -->
				{@const durationPR = prTimeline.reduce<typeof prTimeline[0] | null>((best, p) =>
					p.category === 'duration' && (best === null || (p.durationSec ?? 0) > (best.durationSec ?? 0)) ? p : best, null)}
				{@const distancePR = prTimeline.reduce<typeof prTimeline[0] | null>((best, p) =>
					p.category === 'distance' && (best === null || (p.distanceM ?? 0) > (best.distanceM ?? 0)) ? p : best, null)}
				{#if durationPR || distancePR}
					<div class="flex gap-2 mb-4">
						{#if durationPR}
							<div class="flex-1 rounded-xl bg-zinc-900 border border-yellow-500/20 p-3 text-center">
								<p class="text-xs font-bold text-yellow-400 mb-1">Best Duration</p>
								<p class="text-sm font-bold">{durationPR.durationSec}s</p>
							</div>
						{/if}
						{#if distancePR}
							<div class="flex-1 rounded-xl bg-zinc-900 border border-yellow-500/20 p-3 text-center">
								<p class="text-xs font-bold text-yellow-400 mb-1">Best Distance</p>
								<p class="text-sm font-bold">{distancePR.distanceM ? (distancePR.distanceM / 1000).toFixed(2) : '—'} km</p>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Timeline -->
			{#if prTimeline.length > 0}
				<h3 class="text-sm font-semibold text-zinc-400 mb-2">PR History</h3>
				<div class="flex flex-col gap-1.5">
					{#each prTimeline as pr}
						<!-- M4: only navigate if workoutId is a real ID (not null/'legacy') -->
						{@const isLinked = !!(pr.workoutId && pr.workoutId !== 'legacy')}
						<div
							role={isLinked ? 'link' : undefined}
							tabindex={isLinked ? 0 : undefined}
							onclick={() => isLinked && goto(`/history/${pr.workoutId}`)}
							onkeydown={(e) => e.key === 'Enter' && isLinked && goto(`/history/${pr.workoutId}`)}
							class="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 {isLinked ? 'cursor-pointer active:bg-zinc-800' : ''}"
						>
							<div>
								<span class="text-xs font-bold text-yellow-400 mr-2">
									{pr.category === 'strength' ? pr.bucket : pr.category}
								</span>
								{#if pr.category === 'strength'}
									<span class="text-sm font-semibold">{pr.weight != null ? `${pr.weight} kg × ${pr.reps}` : `${pr.reps} reps`}</span>
								{:else if pr.category === 'duration'}
									<span class="text-sm font-semibold">{pr.durationSec}s</span>
								{:else}
									<span class="text-sm font-semibold">{pr.distanceM ? (pr.distanceM / 1000).toFixed(2) : '—'} km</span>
								{/if}
							</div>
							<span class="text-xs text-zinc-500">
								{new Date(pr.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
							</span>
						</div>
					{/each}
				</div>
			{/if}
			{:else if prSelectedExId}
				<div class="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500">
					<p>No PRs found for this exercise</p>
				</div>
			{:else if prExercises.length === 0}
				<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
					<p class="text-3xl mb-2">🏆</p>
					<p class="font-medium">No PRs yet</p>
					<p class="text-sm">Finish a workout to start tracking records</p>
				</div>
			{/if}
		</div>
	{/if}

	{/if}
</div>
