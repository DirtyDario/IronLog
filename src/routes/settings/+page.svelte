<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { supabase } from '$lib/supabase';

	let email = $state('');
	let otpCode = $state('');
	let step = $state<'email' | 'code' | 'done'>('email');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);

	async function sendOtp() {
		if (!email.trim()) return;
		loading = true;
		error = null;
		// Request OTP — no emailRedirectTo so no magic link is sent,
		// just a 6-digit code the user types in here inside the PWA.
		const { error: err } = await supabase.auth.signInWithOtp({
			email: email.trim(),
			options: { shouldCreateUser: true }
		});
		loading = false;
		if (err) {
			error = err.message;
		} else {
			step = 'code';
			message = `Code sent to ${email.trim()}`;
		}
	}

	async function verifyOtp() {
		if (!otpCode.trim()) return;
		loading = true;
		error = null;
		const { error: err } = await supabase.auth.verifyOtp({
			email: email.trim(),
			token: otpCode.trim(),
			type: 'email'
		});
		loading = false;
		if (err) {
			error = err.message;
		} else {
			step = 'done';
			message = null;
		}
	}

	async function handleSignOut() {
		await auth.signOut();
		step = 'email';
		email = '';
		otpCode = '';
		message = null;
		error = null;
	}
</script>

<div class="p-4 pt-4 pb-8 max-w-md mx-auto">
	<h1 class="text-2xl font-bold mb-6">Account</h1>

	{#if $auth.loading}
		<p class="text-zinc-500 text-sm">Loading…</p>

	{:else if $auth.user}
		<!-- Signed in -->
		<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
			<div>
				<p class="text-xs text-zinc-500 mb-1">Signed in as</p>
				<p class="font-semibold text-base break-all">{$auth.user.email}</p>
			</div>
			<div class="rounded-xl bg-zinc-800 p-3">
				<p class="text-xs text-zinc-400">Your workouts sync automatically across devices while you're signed in.</p>
			</div>
			<button
				onclick={handleSignOut}
				class="w-full rounded-xl border border-zinc-700 py-3 font-medium text-zinc-300 active:bg-zinc-800"
			>
				Sign Out
			</button>
		</div>

	{:else if step === 'email'}
		<!-- Step 1: enter email -->
		<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
			<div>
				<p class="text-sm text-zinc-400 mb-4">Sign in to sync your workouts across devices. We'll send a 6-digit code to your email.</p>
				<label for="email-input" class="text-xs text-zinc-500 block mb-1">Email</label>
				<input
					id="email-input"
					type="email"
					inputmode="email"
					autocomplete="email"
					placeholder="you@example.com"
					bind:value={email}
					onkeydown={(e) => e.key === 'Enter' && sendOtp()}
					class="w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
				/>
			</div>
			{#if error}
				<p class="text-sm text-red-400">{error}</p>
			{/if}
			<button
				onclick={sendOtp}
				disabled={loading || !email.trim()}
				class="w-full rounded-xl bg-orange-500 py-3 font-bold text-white active:bg-orange-600 disabled:opacity-50"
			>
				{loading ? 'Sending…' : 'Send Code'}
			</button>
		</div>

	{:else if step === 'code'}
		<!-- Step 2: enter 6-digit code -->
		<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
			{#if message}
				<p class="text-sm text-zinc-400">{message}</p>
			{/if}
			<div>
				<label for="otp-input" class="text-xs text-zinc-500 block mb-1">6-digit code</label>
				<input
					id="otp-input"
					type="text"
					inputmode="numeric"
					autocomplete="one-time-code"
					placeholder="123456"
					maxlength="6"
					bind:value={otpCode}
					onkeydown={(e) => e.key === 'Enter' && verifyOtp()}
					class="w-full rounded-xl bg-zinc-800 px-4 py-3 text-2xl text-center tracking-widest font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
				/>
			</div>
			{#if error}
				<p class="text-sm text-red-400">{error}</p>
			{/if}
			<button
				onclick={verifyOtp}
				disabled={loading || otpCode.trim().length < 6}
				class="w-full rounded-xl bg-orange-500 py-3 font-bold text-white active:bg-orange-600 disabled:opacity-50"
			>
				{loading ? 'Verifying…' : 'Verify Code'}
			</button>
			<button
				onclick={() => { step = 'email'; error = null; message = null; }}
				class="text-sm text-zinc-500 text-center active:text-zinc-300"
			>
				← Use a different email
			</button>
		</div>
	{/if}
</div>
