<script lang="ts">
	import { db } from '$lib/db/schema';
	import type { Exercise, MuscleGroup } from '$lib/db/schema';
	import { onMount } from 'svelte';
	import { schedulePush } from '$lib/services/sync';
	import { fetchImportPreview, importExercises, type ImportPreview } from '$lib/services/exerciseImport';

	let exercises: Exercise[] = $state([]);
	let search = $state('');
	let showAdd = $state(false);
	let newName = $state('');
	let newType = $state<Exercise['type']>('weightReps');
	let newMuscle = $state<MuscleGroup>('other');
	let newIsUnilateral = $state(false);

	let showImportModal = $state(false);
	let importPreviews = $state<ImportPreview[]>([]);
	let importSelected = $state<Set<number>>(new Set());
	let importLoading = $state(false);
	let importError = $state<string | null>(null);
	let importSuccess = $state<string | null>(null);

	const muscleGroups: MuscleGroup[] = [
		'chest', 'back', 'shoulders', 'biceps', 'triceps',
		'legs', 'glutes', 'core', 'cardio', 'full body', 'other'
	];

	onMount(async () => {
		exercises = await db.exercises.orderBy('name').toArray();
	});

	let filtered = $derived(
		search.trim()
			? exercises.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
			: exercises
	);

	async function addCustom() {
		if (!newName.trim()) return;
		const ex: Exercise = {
			id: crypto.randomUUID(),
			name: newName.trim(),
			type: newType,
			muscleGroup: newMuscle,
			isCustom: true,
			_synced: false,
			_lastModified: Date.now()
		};
		await db.exercises.add(ex);
		schedulePush();
		exercises = [...exercises, ex].sort((a, b) => a.name.localeCompare(b.name));
		newName = '';
		showAdd = false;
	}

	async function deleteExercise(id: string) {
		// H9: tombstone so remote copy is cleaned up on next sync
		await db.tombstones.put({ id, entity: 'exercise', entityId: id, deletedAt: new Date(), _synced: false });
		await db.exercises.delete(id);
		schedulePush();
		exercises = exercises.filter((e) => e.id !== id);
	}

	async function openImportModal() {
		showImportModal = true;
		importLoading = true;
		importError = null;
		importPreviews = [];
		importSelected = new Set();
		try {
			importPreviews = await fetchImportPreview(100);
		} catch (e) {
			importError = 'Konnte keine Verbindung zu wger.de herstellen. Bitte prüfe deine Internetverbindung.';
		} finally {
			importLoading = false;
		}
	}

	async function handleImport() {
		const selected = importPreviews.filter((p) => importSelected.has(p.wgerId));
		if (selected.length === 0) return;
		importLoading = true;
		try {
			const count = await importExercises(selected);
			showImportModal = false;
			importSuccess = `${count} Übungen importiert.`;
			setTimeout(() => { importSuccess = null; }, 4000);
			window.location.reload();
		} catch (e) {
			importError = 'Fehler beim Importieren.';
		} finally {
			importLoading = false;
		}
	}
</script>

<div class="p-4 pt-4 pb-8">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-3xl font-bold tracking-tight">Exercises</h1>
		<button
			onclick={() => (showAdd = !showAdd)}
			class="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white active:bg-orange-600"
		>
			+ Add
		</button>
	</div>

	<button
		onclick={openImportModal}
		class="mb-4 w-full rounded-2xl border border-zinc-700 py-3 text-sm font-medium text-zinc-300 active:bg-zinc-900"
	>
		+ Übungen importieren (wger.de)
	</button>

	{#if showAdd}
		<div class="mb-4 rounded-2xl bg-zinc-900 p-4 flex flex-col gap-3">
			<input
				type="text"
				placeholder="Exercise name"
				bind:value={newName}
				class="rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
			/>
			<div class="grid grid-cols-2 gap-2">
				<select bind:value={newType} class="rounded-xl bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none">
					<option value="weightReps">Weight × Reps</option>
					<option value="bodyweightReps">Bodyweight × Reps</option>
					<option value="time">Time</option>
					<option value="distance">Distance</option>
				</select>
				<select bind:value={newMuscle} class="rounded-xl bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none capitalize">
					{#each muscleGroups as mg}
						<option value={mg} class="capitalize">{mg}</option>
					{/each}
				</select>
			</div>
			<button onclick={addCustom} class="w-full rounded-xl bg-orange-500 py-3 font-semibold text-white active:bg-orange-600">
				Save Exercise
			</button>
		</div>
	{/if}

	<input
		type="search"
		placeholder="Search..."
		bind:value={search}
		class="mb-4 w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
	/>

	<div class="flex flex-col gap-2">
		{#each filtered as exercise}
			<div class="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
				<div>
					<p class="font-medium">{exercise.name}</p>
					<p class="text-xs text-zinc-500 capitalize">{exercise.muscleGroup} ·
						{exercise.type === 'weightReps' ? 'kg × reps' :
						 exercise.type === 'bodyweightReps' ? 'reps' :
						 exercise.type === 'time' ? 'time' : 'distance'}
					</p>
				</div>
				{#if exercise.isCustom}
					<button
						onclick={() => deleteExercise(exercise.id)}
						class="text-xs text-red-500 font-medium px-2 py-1 rounded-lg active:bg-zinc-800"
					>
						Delete
					</button>
				{/if}
			</div>
		{/each}
	</div>
</div>

{#if importSuccess}
	<div class="fixed bottom-20 left-4 right-4 z-50 rounded-2xl bg-green-900/80 p-3 text-sm text-green-300 text-center">
		{importSuccess}
	</div>
{/if}

{#if showImportModal}
	<div class="fixed inset-0 z-50 flex flex-col bg-[#09090b]">
		<div class="flex items-center justify-between px-4 pt-safe pt-4 pb-3 border-b border-zinc-800">
			<h2 class="text-lg font-bold">Übungen importieren</h2>
			<button onclick={() => (showImportModal = false)} class="text-zinc-400 text-2xl leading-none">×</button>
		</div>

		{#if importLoading}
			<div class="flex-1 flex items-center justify-center">
				<p class="text-zinc-400">Lade Übungen von wger.de...</p>
			</div>
		{:else if importError}
			<div class="flex-1 flex items-center justify-center p-4">
				<p class="text-red-400 text-center">{importError}</p>
			</div>
		{:else}
			<div class="flex items-center justify-between px-4 py-2 text-xs text-zinc-500">
				<span>{importPreviews.length} neue Übungen verfügbar</span>
				<button
					onclick={() => {
						if (importSelected.size === importPreviews.length) {
							importSelected = new Set();
						} else {
							importSelected = new Set(importPreviews.map((p) => p.wgerId));
						}
					}}
					class="text-orange-500"
				>
					{importSelected.size === importPreviews.length ? 'Alle abwählen' : 'Alle auswählen'}
				</button>
			</div>
			<div class="flex-1 overflow-y-auto px-4 pb-32">
				{#each importPreviews as preview}
					<button
						onclick={() => {
							const s = new Set(importSelected);
							if (s.has(preview.wgerId)) s.delete(preview.wgerId); else s.add(preview.wgerId);
							importSelected = s;
						}}
						class="flex items-center gap-3 w-full py-3 border-b border-zinc-800/50 text-left"
					>
						<div class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0
							{importSelected.has(preview.wgerId) ? 'bg-orange-500 border-orange-500' : 'border-zinc-600'}">
							{#if importSelected.has(preview.wgerId)}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 text-white">
									<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
								</svg>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium text-zinc-200 truncate">{preview.name}</p>
							<p class="text-xs text-zinc-500 capitalize">{preview.muscleGroup} · {preview.type}</p>
						</div>
					</button>
				{/each}
			</div>
			<div class="fixed bottom-0 left-0 right-0 p-4 bg-[#09090b] border-t border-zinc-800">
				<button
					onclick={handleImport}
					disabled={importSelected.size === 0 || importLoading}
					class="w-full rounded-2xl bg-orange-500 py-4 text-base font-bold text-white disabled:opacity-50"
				>
					{importSelected.size} Übungen importieren
				</button>
			</div>
		{/if}
	</div>
{/if}
