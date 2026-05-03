import { writable } from 'svelte/store';
export const page = writable({ params: {}, url: new URL('http://localhost/') });
