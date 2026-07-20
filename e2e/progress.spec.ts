import { test, expect } from '@playwright/test';

// Real end-to-end regression test: logs a set for an exercise through the
// actual live-workout UI (not the data layer directly), finishes the
// workout, then checks the Stats > Progress tab renders that data.
//
// This class of bug (a Svelte $effect infinite-loop crash) is invisible to
// the data-layer unit tests in src/tests — those never mount a real Svelte
// component, so a runtime-only bug in a page's reactive effect can slip
// through entirely. This test exists specifically to catch that.
//
// Bug found by this exact test: `progressLoadSeq` in stats/+page.svelte was
// a `$state` variable that got both read and written synchronously inside
// the same `$effect` (`const seq = ++progressLoadSeq;`). Svelte 5 detects
// that self-triggering pattern and throws `effect_update_depth_exceeded`,
// aborting the effect before it ever assigned `sessionData` — so the
// Progress tab showed "No data yet for this exercise" for every exercise,
// regardless of whether real weight+reps data existed. Fixed by making
// progressLoadSeq a plain (non-reactive) counter, since it's only used for
// internal cancellation bookkeeping and never read in the template.
test('logging a set through the live workout flow shows up in Stats > Progress', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (err) => errors.push(err.message));

	await page.goto('/');
	await page.waitForTimeout(500); // let onMount seed default exercises into IndexedDB

	await page.click('text=+ Start Workout');
	await page.waitForURL('**/workout/active');

	await page.click('text=+ Add Exercise');
	await page.locator('input[placeholder="Search exercises..."]').fill('Incline Dumbbell Bench Press');
	await page.click('text=Incline Dumbbell Bench Press');

	await page.click('text=+ Add Set');
	const kgInput = page.locator('input[inputmode="decimal"]').first();
	const repsInput = page.locator('input[inputmode="numeric"]').first();
	await kgInput.fill('20');
	await repsInput.fill('10');
	await page.click('h1'); // blur the reps field so onblur fires and saves it

	await page.click('button[aria-label="Complete set"]');

	await page.click('text=Finish');
	await page.click('div.fixed button:has-text("Finish")');
	await page.waitForURL('**/workout/summary/**');

	await page.goto('/stats');
	await page.waitForTimeout(500);
	await page.click('text=Progress');
	await page.waitForTimeout(300);

	const select = page.locator('select').first();
	await select.selectOption({ label: 'Incline Dumbbell Bench Press (1)' });

	await expect(page.locator('text=All-Time Best')).toBeVisible();
	await expect(page.locator('text=20 kg × 10 reps')).toBeVisible();
	await expect(page.locator('text=No data yet for this exercise')).not.toBeVisible();

	expect(errors.filter((e) => e.includes('effect_update_depth_exceeded'))).toEqual([]);
	expect(errors).toEqual([]);
});
