<script lang="ts">
	import { restTimer, formatTime } from '$lib/stores/restTimer';

	const presets = [60, 90, 120, 180];
</script>

<div class="rounded-xl bg-zinc-900 border border-orange-500/20 p-3">
	<div class="flex items-center gap-3">
		<div class="flex-1">
			<div class="flex items-center justify-between mb-1">
				<span class="text-xs font-medium text-orange-400">Rest Timer</span>
			<!-- Bug 11 fix: remove erroneous 's' suffix (formatTime already formats as m:ss) -->
				<span class="text-xs text-zinc-500">{formatTime($restTimer.total)} preset</span>
			</div>
			<!-- Progress bar -->
			<div class="h-1.5 w-full rounded-full bg-zinc-800">
			<!-- Bug 10 fix: guard division by zero when total is 0 -->
			<div
				class="h-full rounded-full bg-orange-500 transition-all duration-1000"
				style="width: {$restTimer.total > 0 ? ($restTimer.remaining / $restTimer.total) * 100 : 0}%"
			></div>
			</div>
		</div>
		<div class="text-2xl font-bold tabular-nums text-orange-400 w-14 text-right">
			{formatTime($restTimer.remaining)}
		</div>
		<button
			onclick={() => restTimer.stop()}
			class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 active:bg-zinc-700"
		>
			Skip
		</button>
	</div>
	<!-- Quick presets -->
	<div class="mt-2 flex gap-2">
		{#each presets as sec}
			<button
				onclick={() => restTimer.start(sec)}
				class="flex-1 rounded-lg bg-zinc-800 py-1.5 text-xs font-medium text-zinc-400 active:bg-zinc-700
				{$restTimer.total === sec ? 'text-orange-400 border border-orange-500/30' : ''}"
			>
				{formatTime(sec)}
			</button>
		{/each}
	</div>
</div>
