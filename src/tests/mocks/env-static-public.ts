// Test mock for SvelteKit's `$env/static/public` — vitest runs outside the
// SvelteKit vite plugin, which is what normally resolves this virtual module.
export const PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
export const PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
