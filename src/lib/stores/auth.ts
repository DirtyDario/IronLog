import { writable, get } from 'svelte/store';
import { supabase } from '$lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
	user: User | null;
	session: Session | null;
	loading: boolean;
}

const { subscribe, set } = writable<AuthState>({
	user: null,
	session: null,
	loading: true
});

// Wire up the auth state listener immediately at module load time.
// This fires for SIGNED_IN (including magic link callback via implicit flow hash),
// SIGNED_OUT, TOKEN_REFRESHED, etc.
if (typeof window !== 'undefined') {
	supabase.auth.onAuthStateChange((_event, session) => {
		set({ user: session?.user ?? null, session, loading: false });
	});

	// Also check storage for an existing session on first load
	supabase.auth.getSession().then(({ data }) => {
		const current = get({ subscribe });
		if (current.loading) {
			set({
				user: data.session?.user ?? null,
				session: data.session ?? null,
				loading: false
			});
		}
	});
}

export const auth = {
	subscribe,

	// No-op init — kept for backwards compat with layout calls
	init() {},

	async signOut() {
		await supabase.auth.signOut();
	}
};
