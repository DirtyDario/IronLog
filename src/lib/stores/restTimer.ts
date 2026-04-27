import { writable } from 'svelte/store';

interface TimerState {
	running: boolean;
	remaining: number; // seconds
	total: number;
}

function createRestTimer() {
	const { subscribe, set, update } = writable<TimerState>({
		running: false,
		remaining: 0,
		total: 90
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
			set({ running: true, remaining: seconds, total: seconds });
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
		setTotal(seconds: number) {
			update((s) => ({ ...s, total: seconds }));
		}
	};
}

export const restTimer = createRestTimer();

export function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toString().padStart(2, '0')}`;
}
