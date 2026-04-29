<script lang="ts">
	import { page } from '$app/stores';
	import { db } from '$lib/db/schema';
	import type { Workout, WorkoutExercise, ExerciseSet, Exercise } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let workout: Workout | null = $state(null);
	// H1: exercise can be null if exercise was deleted — show placeholder
	let exercises: Array<{ we: WorkoutExercise; exercise: Exercise | null; sets: ExerciseSet[] }> = $state([]);

	onMount(async () => {
		const id = $page.params.id;
		workout = (await db.workouts.get(id)) ?? null;
		// M6: redirect to 404-like state if workout not found
		if (!workout) { goto('/history'); return; }

		const wes = await db.workoutExercises.where('workoutId').equals(id).sortBy('order');
		const result = [];
		for (const we of wes) {
			const exercise = (await db.exercises.get(we.exerciseId)) ?? null; // H1: null if deleted
			const sets = (await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order'))
				.filter((s) => s.completed);
			result.push({ we, exercise, sets }); // H1: always push even if exercise is null
		}
		exercises = result;
	});

	function formatDate(d: Date) {
		return new Date(d).toLocaleDateString('en-GB', {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
		});
	}

	function formatSet(set: ExerciseSet, type: string) {
		if (type === 'weightReps') return `${set.weight ?? '-'} kg × ${set.reps ?? '-'}`;
		if (type === 'bodyweightReps') return `${set.reps ?? '-'} reps`;
		if (type === 'time') return `${set.durationSec ?? '-'}s`;
		if (type === 'distance') return `${set.distanceM ? (set.distanceM / 1000).toFixed(2) : '-'} km`;
		return '';
	}

	function formatDuration(sec?: number) {
		if (!sec) return '';
		const m = Math.floor(sec / 60);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}

	async function deleteWorkout() {
		if (!workout) return;
		const allSetIds: string[] = [];
		const allWeIds: string[] = [];
		for (const { we, sets } of exercises) {
			allSetIds.push(...sets.map((s) => s.id));
			allWeIds.push(we.id);
		}
		// M5: cascade delete PRs for this workout before deleting the workout
		await db.personalRecords.where('workoutId').equals(workout.id).delete();
		await db.sets.bulkDelete(allSetIds);
		await db.workoutExercises.bulkDelete(allWeIds);
		await db.workouts.delete(workout.id);
		goto('/history');
	}

	let showDelete = $state(false);
</script>

<div class="p-4 pt-4 pb-8">
	<div class="mb-6 flex items-start justify-between">
		<div>
			<a href="/history" class="text-sm text-zinc-500 mb-1 block">← History</a>
			<h1 class="text-2xl font-bold">{workout?.name ?? 'Workout'}</h1>
			{#if workout}
				<p class="text-sm text-zinc-400">{formatDate(workout.date)}</p>
				{#if workout.durationSec}
					<p class="text-sm text-zinc-500">{formatDuration(workout.durationSec)}</p>
				{/if}
			{/if}
		</div>
		<button
			onclick={() => (showDelete = true)}
			class="text-sm text-red-500 font-medium mt-6"
		>
			Delete
		</button>
	</div>

	<div class="flex flex-col gap-4">
		{#each exercises as { exercise, sets }}
			<div class="rounded-2xl bg-zinc-900 p-4">
				<!-- H1: show placeholder name if exercise was deleted -->
				<h2 class="mb-2 font-semibold {exercise ? '' : 'text-zinc-500 italic'}">
					{exercise?.name ?? 'Deleted exercise'}
				</h2>
				<div class="flex flex-col gap-1">
					{#each sets as set, i}
						<div class="flex justify-between text-sm">
							<span class="text-zinc-500">Set {i + 1}</span>
							<span class="font-medium">{formatSet(set, exercise?.type ?? 'weightReps')}</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

{#if showDelete}
	<div class="fixed inset-0 z-50 flex items-end bg-black/60 p-4">
		<div class="w-full rounded-2xl bg-zinc-900 p-6">
			<h2 class="text-xl font-bold">Delete Workout?</h2>
			<p class="mt-1 text-sm text-zinc-400">This cannot be undone.</p>
			<div class="mt-4 flex gap-3">
				<button onclick={() => (showDelete = false)} class="flex-1 rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300">Cancel</button>
				<button onclick={deleteWorkout} class="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white">Delete</button>
			</div>
		</div>
	</div>
{/if}
