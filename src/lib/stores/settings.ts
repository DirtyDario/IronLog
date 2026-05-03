import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type AccentColor = 'orange' | 'blue' | 'green' | 'red' | 'purple' | 'pink' | 'teal';
export type Language = 'en' | 'de';

export interface AccentColorDef {
	id: AccentColor;
	label: string;
	hex: string;
	// Tailwind-style shades used across the app
	c400: string;
	c500: string;
	c600: string;
	c500_10: string;
	c500_20: string;
	c500_30: string;
}

export const ACCENT_COLORS: AccentColorDef[] = [
	{
		id: 'orange',
		label: 'Orange',
		hex: '#f97316',
		c400: '#fb923c',
		c500: '#f97316',
		c600: '#ea6b0c',
		c500_10: 'rgba(249,115,22,0.10)',
		c500_20: 'rgba(249,115,22,0.20)',
		c500_30: 'rgba(249,115,22,0.30)'
	},
	{
		id: 'blue',
		label: 'Blue',
		hex: '#3b82f6',
		c400: '#60a5fa',
		c500: '#3b82f6',
		c600: '#2563eb',
		c500_10: 'rgba(59,130,246,0.10)',
		c500_20: 'rgba(59,130,246,0.20)',
		c500_30: 'rgba(59,130,246,0.30)'
	},
	{
		id: 'green',
		label: 'Green',
		hex: '#22c55e',
		c400: '#4ade80',
		c500: '#22c55e',
		c600: '#16a34a',
		c500_10: 'rgba(34,197,94,0.10)',
		c500_20: 'rgba(34,197,94,0.20)',
		c500_30: 'rgba(34,197,94,0.30)'
	},
	{
		id: 'red',
		label: 'Red',
		hex: '#ef4444',
		c400: '#f87171',
		c500: '#ef4444',
		c600: '#dc2626',
		c500_10: 'rgba(239,68,68,0.10)',
		c500_20: 'rgba(239,68,68,0.20)',
		c500_30: 'rgba(239,68,68,0.30)'
	},
	{
		id: 'purple',
		label: 'Purple',
		hex: '#a855f7',
		c400: '#c084fc',
		c500: '#a855f7',
		c600: '#9333ea',
		c500_10: 'rgba(168,85,247,0.10)',
		c500_20: 'rgba(168,85,247,0.20)',
		c500_30: 'rgba(168,85,247,0.30)'
	},
	{
		id: 'pink',
		label: 'Pink',
		hex: '#ec4899',
		c400: '#f472b6',
		c500: '#ec4899',
		c600: '#db2777',
		c500_10: 'rgba(236,72,153,0.10)',
		c500_20: 'rgba(236,72,153,0.20)',
		c500_30: 'rgba(236,72,153,0.30)'
	},
	{
		id: 'teal',
		label: 'Teal',
		hex: '#14b8a6',
		c400: '#2dd4bf',
		c500: '#14b8a6',
		c600: '#0d9488',
		c500_10: 'rgba(20,184,166,0.10)',
		c500_20: 'rgba(20,184,166,0.20)',
		c500_30: 'rgba(20,184,166,0.30)'
	}
];

export const REST_TIMER_PRESETS = [30, 60, 90, 120, 150, 180, 300];

interface SettingsState {
	accentColor: AccentColor;
	restTimerDefault: number; // seconds
	language: Language;
}

const STORAGE_KEY = 'ironlog_settings';

function loadSettings(): SettingsState {
	if (!browser) return defaultSettings();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
	} catch {}
	return defaultSettings();
}

function defaultSettings(): SettingsState {
	return { accentColor: 'orange', restTimerDefault: 90, language: 'en' };
}

function saveSettings(s: SettingsState) {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function createSettingsStore() {
	const { subscribe, set, update } = writable<SettingsState>(loadSettings());

	function persist(s: SettingsState) {
		saveSettings(s);
		applyAccentColor(s.accentColor);
	}

	return {
		subscribe,
		setAccentColor(color: AccentColor) {
			update((s) => {
				const next = { ...s, accentColor: color };
				persist(next);
				return next;
			});
		},
		setRestTimerDefault(seconds: number) {
			update((s) => {
				const next = { ...s, restTimerDefault: seconds };
				persist(next);
				return next;
			});
		},
		setLanguage(lang: Language) {
			update((s) => {
				const next = { ...s, language: lang };
				persist(next);
				return next;
			});
		},
		/** Called once on app mount to apply persisted settings */
		init() {
			const s = loadSettings();
			set(s);
			applyAccentColor(s.accentColor);
		}
	};
}

export function applyAccentColor(id: AccentColor) {
	if (!browser) return;
	const color = ACCENT_COLORS.find((c) => c.id === id) ?? ACCENT_COLORS[0];
	const root = document.documentElement;
	root.style.setProperty('--accent-400', color.c400);
	root.style.setProperty('--accent-500', color.c500);
	root.style.setProperty('--accent-600', color.c600);
	root.style.setProperty('--accent-500-10', color.c500_10);
	root.style.setProperty('--accent-500-20', color.c500_20);
	root.style.setProperty('--accent-500-30', color.c500_30);
	// Also update the PWA theme-color meta tag
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', color.hex);
}

export const settings = createSettingsStore();
