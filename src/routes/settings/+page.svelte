<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { supabase } from '$lib/supabase';
	import { settings, ACCENT_COLORS, REST_TIMER_PRESETS, type AccentColor, type Language } from '$lib/stores/settings';
	import { restTimer, formatTime } from '$lib/stores/restTimer';
	import { syncNow } from '$lib/services/sync';
	import { db } from '$lib/db/schema';

	// ── Auth / OTP ─────────────────────────────────────────────────────────────
	let email = $state('');
	let otpCode = $state('');
	let step = $state<'email' | 'code'>('email');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let syncing = $state(false);
	let syncMsg = $state<string | null>(null);

	async function sendOtp() {
		if (!email.trim() || loading) return;
		loading = true;
		error = null;
		const { error: err } = await supabase.auth.signInWithOtp({
			email: email.trim(),
			options: { shouldCreateUser: true }
		});
		loading = false;
		if (err) { error = err.message; } else { step = 'code'; }
	}

	async function verifyOtp() {
		if (otpCode.trim().length < 6 || loading) return;
		loading = true;
		error = null;
		const { error: err } = await supabase.auth.verifyOtp({
			email: email.trim(),
			token: otpCode.trim(),
			type: 'email'
		});
		loading = false;
		if (err) { error = err.message; otpCode = ''; }
	}

	async function handleSignOut() {
		await auth.signOut();
		step = 'email';
		email = '';
		otpCode = '';
		error = null;
	}

	function handleCodeInput(e: Event) {
		const val = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
		otpCode = val;
		if (val.length === 6) verifyOtp();
	}

	async function handleForceSync() {
		syncing = true;
		syncMsg = null;
		try {
			await syncNow();
			syncMsg = 'Synced successfully.';
		} catch {
			syncMsg = 'Sync failed. Check connection.';
		} finally {
			syncing = false;
			setTimeout(() => (syncMsg = null), 3000);
		}
	}

	// ── Accent color ────────────────────────────────────────────────────────────
	function selectAccent(id: AccentColor) {
		settings.setAccentColor(id);
	}

	// ── Rest timer ──────────────────────────────────────────────────────────────
	function selectRestTimer(sec: number) {
		settings.setRestTimerDefault(sec);
		restTimer.setDefault(sec);
	}

	// ── Language ────────────────────────────────────────────────────────────────
	function selectLanguage(lang: Language) {
		settings.setLanguage(lang);
	}

	// ── App version ─────────────────────────────────────────────────────────────
	const version = '0.0.1';
</script>

<div class="p-4 pt-4 pb-10 max-w-md mx-auto flex flex-col gap-6">
	<h1 class="text-2xl font-bold">Settings</h1>

	<!-- ── Account ── -->
	<section class="flex flex-col gap-3">
		<h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 px-1">Account</h2>

		{#if $auth.loading}
			<div class="rounded-2xl bg-zinc-900 p-5">
				<p class="text-zinc-500 text-sm">Loading…</p>
			</div>

		{:else if $auth.user}
			<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
				<div>
					<p class="text-xs text-zinc-500 mb-1">Signed in as</p>
					<p class="font-semibold text-base break-all">{$auth.user.email}</p>
				</div>
				<div class="rounded-xl bg-zinc-800 p-3">
					<p class="text-xs text-zinc-400">Workouts sync automatically across devices when online.</p>
				</div>

				<!-- Force Sync -->
				<button
					onclick={handleForceSync}
					disabled={syncing}
					class="w-full rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300 active:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
				>
					{#if syncing}
						<span class="inline-block animate-spin text-base">↻</span> Syncing…
					{:else}
						↻ Force Sync
					{/if}
				</button>
				{#if syncMsg}
					<p class="text-xs text-center {syncMsg.includes('failed') ? 'text-red-400' : 'text-zinc-400'}">{syncMsg}</p>
				{/if}

				<button
					onclick={handleSignOut}
					class="w-full rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300 active:bg-zinc-800"
				>
					Sign Out
				</button>
			</div>

		{:else if step === 'email'}
			<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
				<p class="text-sm text-zinc-400">
					Enter your email to enable cross-device sync. You'll receive a 6-digit code —
					<span class="text-accent-400 font-medium">enter the code, don't tap the link.</span>
				</p>
				<div>
					<label for="email-input" class="text-xs text-zinc-500 block mb-1">Email</label>
					<input
						id="email-input"
						type="email"
						inputmode="email"
						autocomplete="email"
						placeholder="you@example.com"
						bind:value={email}
						onkeydown={(e) => e.key === 'Enter' && sendOtp()}
						class="w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-accent-500"
					/>
				</div>
				{#if error}<p class="text-sm text-red-400">{error}</p>{/if}
				<button
					onclick={sendOtp}
					disabled={loading || !email.trim()}
					class="w-full rounded-xl bg-accent-500 py-3 font-bold text-white active:bg-accent-600 disabled:opacity-50"
				>
					{loading ? 'Sending…' : 'Send Code'}
				</button>
			</div>

		{:else}
			<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
				<div class="text-center">
					<p class="text-sm text-zinc-400 mb-1">Code sent to</p>
					<p class="font-semibold">{email}</p>
				</div>
				<div class="rounded-xl bg-zinc-800 p-4 flex flex-col gap-2">
					<p class="text-sm font-semibold text-white">Check your email</p>
					<p class="text-xs text-zinc-400 leading-relaxed">
						The email contains a link and a 6-digit code.
						<span class="text-accent-400 font-medium">Do not tap the link</span> — it opens in Safari and won't log you in here.
					</p>
					<p class="text-xs text-zinc-400 leading-relaxed">
						Instead, <span class="text-white font-medium">copy the 6-digit number</span> and paste it below.
					</p>
				</div>
				<div>
					<label for="otp-input" class="text-xs text-zinc-500 block mb-2 text-center">6-digit code</label>
					<input
						id="otp-input"
						type="text"
						inputmode="numeric"
						autocomplete="one-time-code"
						placeholder="000000"
						maxlength="6"
						value={otpCode}
						oninput={handleCodeInput}
						class="w-full rounded-xl bg-zinc-800 px-4 py-4 text-3xl text-center tracking-[0.5em] font-bold focus:outline-none focus:ring-2 focus:ring-accent-500"
					/>
				</div>
				{#if error}
					<p class="text-sm text-red-400 text-center">{error}</p>
				{/if}
				{#if loading}
					<p class="text-center text-sm text-zinc-400">Verifying…</p>
				{:else}
					<button
						onclick={verifyOtp}
						disabled={otpCode.trim().length < 6}
						class="w-full rounded-xl bg-accent-500 py-3 font-bold text-white active:bg-accent-600 disabled:opacity-50"
					>
						Verify Code
					</button>
				{/if}
				<button
					onclick={() => { step = 'email'; error = null; otpCode = ''; }}
					class="text-sm text-zinc-500 text-center py-1"
				>
					← Try a different email
				</button>
			</div>
		{/if}
	</section>

	<!-- ── Appearance ── -->
	<section class="flex flex-col gap-3">
		<h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 px-1">Appearance</h2>
		<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
			<div>
				<p class="text-sm font-medium text-zinc-200 mb-3">Accent Color</p>
				<div class="flex flex-wrap gap-3">
					{#each ACCENT_COLORS as color}
						<button
							onclick={() => selectAccent(color.id)}
							title={color.label}
							class="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-90"
							style="background-color: {color.hex}; box-shadow: {$settings.accentColor === color.id ? `0 0 0 2px #09090b, 0 0 0 4px ${color.hex}` : 'none'};"
						>
							{#if $settings.accentColor === color.id}
								<span class="text-white font-bold text-base leading-none">✓</span>
							{/if}
						</button>
					{/each}
				</div>
				<p class="mt-2 text-xs text-zinc-500">
					{ACCENT_COLORS.find(c => c.id === $settings.accentColor)?.label ?? ''}
				</p>
			</div>
		</div>
	</section>

	<!-- ── Preferences ── -->
	<section class="flex flex-col gap-3">
		<h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 px-1">Preferences</h2>
		<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-5">

			<!-- Rest timer default -->
			<div>
				<p class="text-sm font-medium text-zinc-200 mb-2">Default Rest Timer</p>
				<div class="flex flex-wrap gap-2">
					{#each REST_TIMER_PRESETS as sec}
						<button
							onclick={() => selectRestTimer(sec)}
							class="rounded-xl px-3 py-2 text-sm font-medium transition-colors
								{$settings.restTimerDefault === sec
									? 'bg-accent-500 text-white'
									: 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'}"
						>
							{formatTime(sec)}
						</button>
					{/each}
				</div>
			</div>

			<div class="h-px bg-zinc-800"></div>

			<!-- Language -->
			<div>
				<p class="text-sm font-medium text-zinc-200 mb-1">Language</p>
				<p class="text-xs text-zinc-500 mb-2">Full translations coming soon.</p>
				<div class="flex gap-2">
					{#each (['en', 'de'] as Language[]) as lang}
						<button
							onclick={() => selectLanguage(lang)}
							class="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors
								{$settings.language === lang
									? 'bg-accent-500 text-white'
									: 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'}"
						>
							{lang === 'en' ? '🇬🇧 English' : '🇩🇪 Deutsch'}
						</button>
					{/each}
				</div>
			</div>
		</div>
	</section>

	<!-- ── About ── -->
	<section class="flex flex-col gap-3">
		<h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 px-1">About</h2>
		<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<span class="text-sm text-zinc-400">Version</span>
				<span class="text-sm font-medium text-zinc-200">{version}</span>
			</div>
			<div class="h-px bg-zinc-800"></div>
			<a
				href="https://github.com/anomalyco/opencode/issues"
				target="_blank"
				rel="noopener noreferrer"
				class="text-sm text-accent-400 font-medium"
			>
				Report a Bug ↗
			</a>
		</div>
	</section>
</div>
