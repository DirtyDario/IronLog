import { writable } from 'svelte/store';

interface TimerState {
	running: boolean;
	remaining: number; // seconds
	total: number;
	// Bug fix: track the user's configured default (Settings) separately from
	// `total`. Previously `start(seconds)` always overwrote `total` with
	// whatever value was passed (including quick-preset taps in RestTimerBar),
	// so as soon as the user tapped any preset once, the Settings default was
	// permanently forgotten for the rest of the JS session — changing it in
	// Settings appeared to do nothing.
	default: number;
}

function createRestTimer() {
	const { subscribe, set, update } = writable<TimerState>({
		running: false,
		remaining: 0,
		total: 90, // overridden by settingsStore on init
		default: 90
	});

	let interval: ReturnType<typeof setInterval> | null = null;

	function clearTimer() {
		if (interval) {
			clearInterval(interval);
			interval = null;
		}
	}

	return {
		subscribe,
		start(seconds: number) {
			clearTimer();
			update((s) => ({ ...s, running: true, remaining: seconds, total: seconds }));
			interval = setInterval(() => {
				update((s) => {
					if (s.remaining <= 1) {
						clearTimer();
						// Vibrate if supported
						if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
						return { ...s, running: false, remaining: 0 };
					}
					return { ...s, remaining: s.remaining - 1 };
				});
			}, 1000);
		},
		stop() {
			clearTimer();
			update((s) => ({ ...s, running: false }));
		},
		reset() {
			clearTimer();
			update((s) => ({ ...s, running: false, remaining: s.total }));
		},
		// Sets the configured default (from Settings). Only touches `total` when
		// no rest is currently counting down, so changing the setting mid-rest
		// doesn't visually disrupt the active countdown.
		setDefault(seconds: number) {
			update((s) => ({ ...s, default: seconds, total: s.running ? s.total : seconds }));
		},
		// Resets the timer back to the configured default. Called whenever a new
		// workout starts, so a one-off preset picked during a previous workout
		// doesn't leak into the next session.
		useDefault() {
			clearTimer();
			update((s) => ({ ...s, running: false, total: s.default, remaining: s.default }));
		}
	};
}

export const restTimer = createRestTimer();

export function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toString().padStart(2, '0')}`;
}
