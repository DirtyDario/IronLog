<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { seedDefaultExercises } from '$lib/db/seed';
	import { db } from '$lib/db/schema';
	import { auth } from '$lib/stores/auth';
	import { syncNow } from '$lib/services/sync';

	let { children } = $props();

	onMount(async () => {
		// Seed default exercises
		await seedDefaultExercises();

		// Clean up orphaned unfinished workouts from previous sessions (older than 12h)
		const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
		const orphaned = await db.workouts
			.filter((w) => !w.finishedAt && new Date(w.date) < cutoff)
			.toArray();
		for (const w of orphaned) {
			const wes = await db.workoutExercises.where('workoutId').equals(w.id).toArray();
			for (const we of wes) {
				await db.sets.where('workoutExerciseId').equals(we.id).delete();
			}
			await db.workoutExercises.where('workoutId').equals(w.id).delete();
			await db.workouts.delete(w.id);
		}

		// Initialize auth
		auth.init();

		// Sync once when user is confirmed signed in
		let hasSynced = false;
		auth.subscribe((state) => {
			if (!state.loading && state.user && !hasSynced) {
				hasSynced = true;
				syncNow().catch(console.error);
			}
			if (!state.user) {
				hasSynced = false; // reset on sign out
			}
		});
	});

	const tabs = [
		{ href: '/', label: 'Workout', icon: '🏋️' },
		{ href: '/history', label: 'History', icon: '📅' },
		{ href: '/routines', label: 'Routines', icon: '📋' },
		{ href: '/exercises', label: 'Exercises', icon: '💪' },
		{ href: '/stats', label: 'Stats', icon: '📈' },
		{ href: '/settings', label: 'Account', icon: '👤' }
	];

	function isActive(href: string, pathname: string) {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}
</script>

<nav id="tab-bar">
	<div class="flex">
		{#each tabs as tab}
			<a
				href={tab.href}
				class="flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-xs
					{isActive(tab.href, $page.url.pathname)
					? 'text-orange-500'
					: 'text-zinc-500'}"
			>
				<span class="text-xl leading-none">{tab.icon}</span>
				<span class="font-medium">{tab.label}</span>
			</a>
		{/each}
	</div>
</nav>

<main id="app-content">
	{@render children()}
</main>
