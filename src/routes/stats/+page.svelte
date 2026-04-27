<script lang="ts">
	import { db } from '$lib/db/schema';
	import type { Exercise, PersonalRecord } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { Line } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		CategoryScale,
		LinearScale,
		PointElement,
		LineElement,
		Title,
		Tooltip,
		Filler
	} from 'chart.js';

	ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler);

	let exercises: Exercise[] = $state([]);
	let selectedId: string | null = $state(null);
	let prs: PersonalRecord[] = $state([]);
	let totalWorkouts = $state(0);
	let totalSets = $state(0);

	onMount(async () => {
		exercises = await db.exercises.orderBy('name').toArray();
		totalWorkouts = await db.workouts.count();
		totalSets = await db.sets.where('completed').equals(1).count();
	});

	$effect(() => {
		if (selectedId) {
			db.personalRecords
				.where('exerciseId')
				.equals(selectedId)
				.sortBy('date')
				.then((result) => {
					prs = result;
				});
		}
	});

	let selectedExercise = $derived(exercises.find((e) => e.id === selectedId));

	let chartData = $derived(() => {
		if (!prs.length) return null;
		return {
			labels: prs.map((pr) =>
				new Date(pr.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
			),
			datasets: [
				{
					label: 'Est. 1RM (kg)',
					data: prs.map((pr) => pr.estimatedOneRM ?? pr.weight ?? 0),
					borderColor: '#f97316',
					backgroundColor: 'rgba(249,115,22,0.1)',
					tension: 0.3,
					fill: true,
					pointRadius: 4,
					pointBackgroundColor: '#f97316'
				}
			]
		};
	});

	const chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: false } },
		scales: {
			x: { grid: { color: '#27272a' }, ticks: { color: '#71717a', maxTicksLimit: 6 } },
			y: { grid: { color: '#27272a' }, ticks: { color: '#71717a' } }
		}
	};
</script>

<div class="p-4 pt-12 pb-8">
	<h1 class="mb-6 text-3xl font-bold tracking-tight">Stats</h1>

	<!-- Summary cards -->
	<div class="mb-6 grid grid-cols-2 gap-3">
		<div class="rounded-2xl bg-zinc-900 p-4">
			<p class="text-3xl font-bold text-orange-500">{totalWorkouts}</p>
			<p class="mt-0.5 text-sm text-zinc-400">Workouts</p>
		</div>
		<div class="rounded-2xl bg-zinc-900 p-4">
			<p class="text-3xl font-bold text-orange-500">{totalSets}</p>
			<p class="mt-0.5 text-sm text-zinc-400">Sets completed</p>
		</div>
	</div>

	<!-- Progress chart -->
	<section class="mb-6">
		<h2 class="mb-3 text-lg font-semibold">Progress</h2>
		<select
			bind:value={selectedId}
			class="mb-4 w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none"
		>
			<option value={null}>Select an exercise...</option>
			{#each exercises as ex}
				<option value={ex.id}>{ex.name}</option>
			{/each}
		</select>

		{#if selectedId && chartData()}
			<div class="rounded-2xl bg-zinc-900 p-4">
				<p class="mb-3 font-semibold">{selectedExercise?.name}</p>
				<div class="h-48">
					<Line data={chartData()!} options={chartOptions} />
				</div>
				<!-- Best PR -->
				{#if prs.length}
					{@const best = prs.reduce((b, pr) => ((pr.estimatedOneRM ?? 0) > (b.estimatedOneRM ?? 0) ? pr : b))}
					<div class="mt-4 rounded-xl bg-orange-500/10 border border-orange-500/20 p-3">
						<p class="text-xs font-medium text-orange-400">Best</p>
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
		{:else if selectedId}
			<div class="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500">
				<p>No data yet for this exercise</p>
			</div>
		{/if}
	</section>

	<!-- All PRs -->
	<section>
		<h2 class="mb-3 text-lg font-semibold">Personal Records</h2>
		{#if exercises.length === 0}
			<p class="text-zinc-500 text-sm">No PRs yet — complete some sets!</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each exercises as ex}
					{#await db.personalRecords.where('exerciseId').equals(ex.id).reverse().first() then pr}
						{#if pr}
							<div class="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
								<div>
									<p class="font-medium">{ex.name}</p>
									{#if pr.weight && pr.reps}
										<p class="text-sm text-zinc-400">{pr.weight} kg × {pr.reps} reps</p>
									{:else if pr.durationSec}
										<p class="text-sm text-zinc-400">{pr.durationSec}s</p>
									{:else if pr.distanceM}
										<p class="text-sm text-zinc-400">{(pr.distanceM / 1000).toFixed(2)} km</p>
									{/if}
								</div>
								{#if pr.estimatedOneRM}
									<div class="text-right">
										<p class="text-sm font-bold text-orange-400">~{pr.estimatedOneRM} kg</p>
										<p class="text-xs text-zinc-500">1RM</p>
									</div>
								{/if}
							</div>
						{/if}
					{/await}
				{/each}
			</div>
		{/if}
	</section>
</div>
