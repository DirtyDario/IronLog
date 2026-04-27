<script lang="ts">
	import { db } from '$lib/db/schema';
	import type { Workout } from '$lib/db/schema';
	import { onMount } from 'svelte';

	let workouts: Workout[] = $state([]);

	onMount(async () => {
		workouts = await db.workouts.orderBy('date').reverse().toArray();
	});

	function formatDate(d: Date) {
		return new Date(d).toLocaleDateString('en-GB', {
			weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
		});
	}

	function formatDuration(sec?: number) {
		if (!sec) return '';
		const m = Math.floor(sec / 60);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}

	// Group by month
	let grouped = $derived(() => {
		const map = new Map<string, Workout[]>();
		for (const w of workouts) {
			const key = new Date(w.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(w);
		}
		return map;
	});
</script>

<div class="p-4 pt-4 pb-8">
	<h1 class="mb-6 text-3xl font-bold tracking-tight">History</h1>

	{#if workouts.length === 0}
		<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
			<p class="text-4xl">📅</p>
			<p class="mt-2 font-medium">No workouts yet</p>
		</div>
	{:else}
		{#each grouped() as [month, wks]}
			<section class="mb-6">
				<h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">{month}</h2>
				<div class="flex flex-col gap-2">
					{#each wks as workout}
						<a
							href="/history/{workout.id}"
							class="flex items-center justify-between rounded-xl bg-zinc-900 p-4 active:bg-zinc-800"
						>
							<div>
								<p class="font-semibold">{workout.name ?? 'Workout'}</p>
								<p class="text-sm text-zinc-400">{formatDate(workout.date)}</p>
								{#if workout.notes}
									<p class="mt-0.5 text-xs text-zinc-500 line-clamp-1">{workout.notes}</p>
								{/if}
							</div>
							<div class="text-right">
								{#if workout.durationSec}
									<p class="text-sm font-medium text-zinc-300">{formatDuration(workout.durationSec)}</p>
								{/if}
								<p class="text-xs text-zinc-500">→</p>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>
