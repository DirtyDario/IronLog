<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { seedDefaultExercises } from '$lib/db/seed';

	let { children } = $props();

	onMount(() => {
		seedDefaultExercises();
	});

	const tabs = [
		{ href: '/', label: 'Workout', icon: '🏋️' },
		{ href: '/history', label: 'History', icon: '📅' },
		{ href: '/routines', label: 'Routines', icon: '📋' },
		{ href: '/exercises', label: 'Exercises', icon: '💪' },
		{ href: '/stats', label: 'Stats', icon: '📈' }
	];

	function isActive(href: string, pathname: string) {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}
</script>

<!-- Tab bar — fixed to TOP -->
<nav id="tab-bar">
	<div class="flex">
		{#each tabs as tab}
			<a
				href={tab.href}
				class="flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-xs transition-colors
					{isActive(tab.href, $page.url.pathname)
					? 'text-orange-500'
					: 'text-zinc-500 active:text-zinc-300'}"
			>
				<span class="text-xl leading-none">{tab.icon}</span>
				<span class="font-medium">{tab.label}</span>
			</a>
		{/each}
	</div>
</nav>

<!-- Scrollable content area -->
<main id="app-content">
	{@render children()}
</main>
