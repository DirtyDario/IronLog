<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { seedDefaultExercises } from '$lib/db/seed';
	import { db } from '$lib/db/schema';
	import { auth } from '$lib/stores/auth';
	import { syncNow } from '$lib/services/sync';
	import { activeWorkout } from '$lib/stores/activeWorkout';
	import { recomputeAllPRs } from '$lib/services/pr';
	import { get } from 'svelte/store';

	let { children } = $props();

	// Auto-dismiss auto-complete notice after 8 seconds
	$effect(() => {
		if ($activeWorkout.autoCompleteNotice) {
			const timer = setTimeout(() => activeWorkout.clearAutoCompleteNotice(), 8000);
			return () => clearTimeout(timer);
		}
	});

	onMount(() => {
		// H16: onMount must return a sync cleanup fn (not async).
		// All async work is fired-and-forgotten inside, cleanup fn is returned synchronously.
		let authUnsub: (() => void) | null = null;

		(async () => {
			await seedDefaultExercises();

			// S7: localStorage guard is set OUTSIDE the IDB upgrade transaction (in schema.ts
			// the removeItem was moved out). Here we clear it after DB has opened so recompute
			// runs on next load after a v4 migration.
			if (!localStorage.getItem('prRecomputeV4Done')) {
				recomputeAllPRs().catch(console.error);
			}

			// H12: Rehydrate active workout from IDB on app load in case the store is empty
			// (e.g. after a page refresh mid-workout)
			if (!get(activeWorkout).workout) {
				await activeWorkout.rehydrate();
			}

			// Check auto-complete (1h inactivity)
			await activeWorkout.checkAutoComplete();

			// Orphan cleanup: never delete currently active workout; 48h cutoff
			const activeId = get(activeWorkout).workout?.id;
			const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
			const orphaned = await db.workouts
				.filter((w) => !w.finishedAt && w.id !== activeId && new Date(w.date) < cutoff)
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

			// H16: store unsub reference for cleanup
			let hasSynced = false;
			authUnsub = auth.subscribe((state) => {
				if (!state.loading && state.user && !hasSynced) {
					hasSynced = true;
					syncNow().catch(console.error);
				}
				if (!state.user) {
					hasSynced = false;
				}
			});
		})();

		// H16: return sync cleanup fn — unsubscribes auth if it was set up
		return () => { authUnsub?.(); };
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

{#if $activeWorkout.autoCompleteNotice}
	<div class="fixed bottom-20 left-4 right-4 z-50 rounded-2xl bg-zinc-800 p-4 shadow-xl flex items-start justify-between gap-3">
		<div>
			<p class="text-sm font-semibold text-zinc-100">
				{$activeWorkout.autoCompleteNotice === 'finished' 
					? 'Workout automatisch beendet' 
					: 'Workout automatisch verworfen'}
			</p>
			<p class="text-xs text-zinc-400 mt-0.5">
				{$activeWorkout.autoCompleteNotice === 'finished'
					? 'Dein Workout war länger als 1h inaktiv und wurde mit den abgeschlossenen Sets beendet.'
					: 'Dein Workout hatte keine abgeschlossenen Sets und wurde nach 1h Inaktivität verworfen.'}
			</p>
		</div>
		<button
			onclick={() => activeWorkout.clearAutoCompleteNotice()}
			class="shrink-0 text-zinc-500 active:text-zinc-300 text-lg leading-none"
		>
			×
		</button>
	</div>
{/if}
