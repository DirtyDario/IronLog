<script lang="ts">
	import { onMount } from 'svelte';
	import { db } from '$lib/db/schema';
	import type { Exercise, PersonalRecord } from '$lib/db/schema';
	import {
		getLifetimeTotals,
		getStreak,
		getWeeklyFrequency,
		getMuscleDistribution,
		getAllTimeBests,
		formatDuration,
		formatVolume,
		type WeekCount,
		type MuscleCount,
		type ExerciseBest
	} from '$lib/services/stats';
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

	// Active section
	let activeTab = $state<'overview' | 'frequency' | 'muscles' | 'progress' | 'bests'>('overview');

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
		const finishedWorkouts = await db.workouts.filter((w) => !!w.finishedAt).toArray();
		const finishedWorkoutIds = new Set(finishedWorkouts.map((w) => w.id));
		const allWEs = await db.workoutExercises.toArray();
		const finishedWEs = allWEs.filter((we) => finishedWorkoutIds.has(we.workoutId));

		// Count by exercise: only count WEs that have at least one completed set with a value
		const countsByEx: Record<string, number> = {};
		for (const we of finishedWEs) {
			const hasData = await db.sets
				.where('workoutExerciseId').equals(we.id)
				.filter((s) => s.completed && (s.weight != null || s.reps != null || s.durationSec != null || s.distanceM != null))
				.first();
			if (hasData) {
				countsByEx[we.exerciseId] = (countsByEx[we.exerciseId] ?? 0) + 1;
			}
		}
		const exIds = new Set(Object.keys(countsByEx));
		exercises = exs
			.filter((e) => exIds.has(e.id))
			.sort((a, b) => (countsByEx[b.id] ?? 0) - (countsByEx[a.id] ?? 0) || a.name.localeCompare(b.name));
		exercisePrCounts = countsByEx;

		loaded = true;
	});

	$effect(() => {
		if (selectedExId) {
			sessionData = [];
			prs = [];
			// Load max weight (or reps/duration) per finished workout session for progress chart
			(async () => {
				// Also still load PRs for the "All-Time Best" badge
				const prData = await db.personalRecords
					.where('exerciseId').equals(selectedExId).sortBy('date');
				prs = prData;

				// Build per-session max values from actual sets
				const wes = await db.workoutExercises.where('exerciseId').equals(selectedExId).toArray();
				const workoutIds = [...new Set(wes.map((w) => w.workoutId))];
				const workouts = await db.workouts
					.where('id').anyOf(workoutIds)
					.filter((w) => !!w.finishedAt)
					.toArray();
				workouts.sort((a, b) => new Date(a.finishedAt!).getTime() - new Date(b.finishedAt!).getTime());

				const sessionPoints: { date: string; value: number }[] = [];
				for (const workout of workouts) {
					const we = wes.find((w) => w.workoutId === workout.id);
					if (!we) continue;
					const sets = await db.sets
						.where('workoutExerciseId').equals(we.id)
						.filter((s) => s.completed && s.weight != null)
						.toArray();
					if (!sets.length) continue;
					const maxWeight = Math.max(...sets.map((s) => s.weight!));
					sessionPoints.push({
						date: new Date(workout.finishedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
						value: maxWeight
					});
				}
				sessionData = sessionPoints;
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
		return {
			labels: sessionData.map((p) => p.date),
			datasets: [{
				label: 'Max weight (kg)',
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

	const progressChartOpts = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: false } },
		scales: {
			x: { grid: { color: '#27272a' }, ticks: { color: '#71717a', maxTicksLimit: 6 } },
			y: {
				grid: { color: '#27272a' },
				ticks: {
					color: '#71717a',
					callback: (value: number) => `${value} kg`
				},
				beginAtZero: false
			}
		}
	};

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
		{ id: 'bests', label: 'Bests' }
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
					? 'bg-orange-500 text-white'
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
				<div class="rounded-2xl bg-orange-500/10 border border-orange-500/30 p-4 flex items-center gap-4">
					<div class="text-4xl">🔥</div>
					<div>
						<p class="text-2xl font-bold text-orange-400">{streak} week{streak !== 1 ? 's' : ''}</p>
						<p class="text-sm text-zinc-400">Current training streak</p>
					</div>
				</div>
			{/if}

			<!-- Stat grid -->
			<div class="grid grid-cols-2 gap-3">
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-orange-500">{totalWorkouts}</p>
					<p class="text-sm text-zinc-400 mt-0.5">Workouts</p>
				</div>
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-orange-500">{formatDuration(totalTimeSec)}</p>
					<p class="text-sm text-zinc-400 mt-0.5">Total Time</p>
				</div>
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-orange-500">{formatVolume(totalVolume)}</p>
					<p class="text-sm text-zinc-400 mt-0.5">Volume Lifted</p>
				</div>
				<div class="rounded-2xl bg-zinc-900 p-4">
					<p class="text-3xl font-bold text-orange-500">{totalSets}</p>
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
						<p class="text-2xl font-bold text-orange-500">{freqAvg}</p>
						<p class="text-xs text-zinc-500 mt-0.5">Avg / week</p>
					</div>
					<div class="rounded-2xl bg-zinc-900 p-3 text-center">
						<p class="text-2xl font-bold text-orange-500">{freqMax}</p>
						<p class="text-xs text-zinc-500 mt-0.5">Best week</p>
					</div>
					<div class="rounded-2xl bg-zinc-900 p-3 text-center">
						<p class="text-2xl font-bold text-orange-500">{freqActive}</p>
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
						{@const best = prs.reduce((b, pr) => ((pr.estimatedOneRM ?? 0) > (b.estimatedOneRM ?? 0) ? pr : b))}
						<div class="mt-4 rounded-xl bg-orange-500/10 border border-orange-500/20 p-3">
							<p class="text-xs font-medium text-orange-400 mb-1">All-Time Best</p>
							{#if best.weight && best.reps}
								<p class="text-lg font-bold">{best.weight} kg × {best.reps} reps</p>
								{#if best.estimatedOneRM}
									<p class="text-sm text-zinc-400">~{best.estimatedOneRM} kg est. 1RM</p>
								{/if}
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
									<p class="text-base font-bold text-orange-400">~{b.bestOneRM} kg</p>
									<p class="text-xs text-zinc-500">est. 1RM</p>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{/if}
</div>
