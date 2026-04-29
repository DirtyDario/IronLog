<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { supabase } from '$lib/supabase';

	let email = $state('');
	let otpCode = $state('');
	let step = $state<'email' | 'code'>('email');
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function sendOtp() {
		if (!email.trim() || loading) return; // H15: guard double-submit
		loading = true;
		error = null;
		const { error: err } = await supabase.auth.signInWithOtp({
			email: email.trim(),
			options: { shouldCreateUser: true }
		});
		loading = false;
		if (err) {
			error = err.message;
		} else {
			step = 'code';
		}
	}

	async function verifyOtp() {
		if (otpCode.trim().length < 6 || loading) return; // H15: guard double-submit
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
			otpCode = '';
		}
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
</script>

<div class="p-4 pt-4 pb-8 max-w-md mx-auto">
	<h1 class="text-2xl font-bold mb-6">Account</h1>

	{#if $auth.loading}
		<p class="text-zinc-500 text-sm">Loading…</p>

	{:else if $auth.user}
		<div class="rounded-2xl bg-zinc-900 p-5 flex flex-col gap-4">
			<div>
				<p class="text-xs text-zinc-500 mb-1">Signed in as</p>
				<p class="font-semibold text-base break-all">{$auth.user.email}</p>
			</div>
			<div class="rounded-xl bg-zinc-800 p-3">
				<p class="text-xs text-zinc-400">Workouts sync automatically across devices.</p>
			</div>
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
				Enter your email. You'll get a 6-digit code —
				<span class="text-orange-400 font-medium">look for the code in the email, don't tap the link.</span>
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
					class="w-full rounded-xl bg-zinc-800 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
				/>
			</div>
			{#if error}<p class="text-sm text-red-400">{error}</p>{/if}
			<button
				onclick={sendOtp}
				disabled={loading || !email.trim()}
				class="w-full rounded-xl bg-orange-500 py-3 font-bold text-white active:bg-orange-600 disabled:opacity-50"
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

			<!-- Clear warning about the link -->
			<div class="rounded-xl bg-zinc-800 p-4 flex flex-col gap-2">
				<p class="text-sm font-semibold text-white">Check your email</p>
				<p class="text-xs text-zinc-400 leading-relaxed">
					The email contains a link and a 6-digit code.
					<span class="text-orange-400 font-medium">Do not tap the link</span> — it opens in Safari and won't log you in here.
				</p>
				<p class="text-xs text-zinc-400 leading-relaxed">
					Instead, <span class="text-white font-medium">copy the 6-digit number</span> from the email and paste it below.
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
					class="w-full rounded-xl bg-zinc-800 px-4 py-4 text-3xl text-center tracking-[0.5em] font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
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
					class="w-full rounded-xl bg-orange-500 py-3 font-bold text-white active:bg-orange-600 disabled:opacity-50"
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
</div>
