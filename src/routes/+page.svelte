<script lang="ts">
	import { goto } from '$app/navigation';
	import { activeWorkout } from '$lib/stores/activeWorkout';
	import { db } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import type { Workout } from '$lib/db/schema';

	let recentWorkouts: Workout[] = $state([]);
	let showDiscardConfirm = $state(false);

	onMount(async () => {
		recentWorkouts = await db.workouts
			.orderBy('date')
			.reverse()
			.limit(3)
			.toArray();
	});

	function formatDate(d: Date) {
		return new Date(d).toLocaleDateString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}

	function formatDuration(sec?: number) {
		if (!sec) return '';
		const m = Math.floor(sec / 60);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}
</script>

<div class="flex flex-col gap-6 p-5 pt-12">
	<!-- Header -->
	<div>
		<h1 class="text-3xl font-bold tracking-tight">IronLog</h1>
		<p class="mt-1 text-zinc-400">
			{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
		</p>
	</div>

	<!-- Active workout banner or start button -->
	{#if $activeWorkout.workout}
		<a
			href="/workout/active"
			class="block rounded-2xl bg-orange-500/10 border border-orange-500/30 p-4"
		>
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-orange-400">Workout in progress</p>
					<p class="mt-0.5 text-lg font-semibold">
						{$activeWorkout.workout.name ?? 'Quick Workout'}
					</p>
					<p class="text-sm text-zinc-400">
						{$activeWorkout.workoutExercises.length} exercise{$activeWorkout.workoutExercises.length !== 1 ? 's' : ''}
					</p>
				</div>
				<div class="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white">
					Resume →
				</div>
			</div>
		</a>
	{:else}
		<div class="flex flex-col gap-3">
			<button
				onclick={() => goto('/workout/active')}
				class="w-full rounded-2xl bg-orange-500 py-5 text-lg font-bold text-white shadow-lg active:scale-95 transition-transform"
			>
				+ Start Workout
			</button>
			<a
				href="/routines"
				class="block w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-4 text-center text-base font-medium text-zinc-200 active:bg-zinc-800 transition-colors"
			>
				Start from Routine
			</a>
		</div>
	{/if}

	<!-- Recent workouts -->
	{#if recentWorkouts.length > 0}
		<section>
			<h2 class="mb-3 text-lg font-semibold">Recent</h2>
			<div class="flex flex-col gap-2">
				{#each recentWorkouts as workout}
					<a
						href="/history/{workout.id}"
						class="flex items-center justify-between rounded-xl bg-zinc-900 p-4 active:bg-zinc-800 transition-colors"
					>
						<div>
							<p class="font-medium">{workout.name ?? 'Workout'}</p>
							<p class="text-sm text-zinc-400">{formatDate(workout.date)}</p>
						</div>
						{#if workout.durationSec}
							<span class="text-sm text-zinc-500">{formatDuration(workout.durationSec)}</span>
						{/if}
					</a>
				{/each}
			</div>
		</section>
	{:else}
		<div class="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
			<p class="text-4xl">🏋️</p>
			<p class="mt-2 font-medium">No workouts yet</p>
			<p class="text-sm">Tap "Start Workout" to log your first session</p>
		</div>
	{/if}
</div>
