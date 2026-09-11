import { test, expect } from '@playwright/test';
const fixed = 't=2026-09-08T12%3A00%3A00-07%3A00&offline=1&seed=1';
const ready = page => page.waitForFunction(() => window.APP?.planner || window.APP?.frame);
const set = (page, patch) => page.evaluate(async patch => (await import('/js/engine/state.js')).set(patch), patch);

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const path of ['/', '/frame/']) test(`${path} boots, computes, and switches worlds`, async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${path}?${fixed}&persist=0&frames=20`); await ready(page);
  await expect(page.locator('html')).toHaveClass(/snapshot-ready/);
  await page.evaluate(() => APP.frame?.cycle.stop());
  expect(await page.evaluate(() => APP.state.physics.byRoute.size)).toBeGreaterThan(0);
  if (path === '/') await page.getByRole('button', { name: 'San Francisco Bay', exact: true }).click();
  else await page.evaluate(() => APP.frame.switchView());
  await expect.poll(() => page.evaluate(() => APP.state.world)).toBe('bay');
  await page.evaluate(() => APP.app.recompute());
  expect(await page.evaluate(() => APP.state.physics.byRoute.has('alcatraz'))).toBe(true);
  if (path === '/') await page.getByRole('button', { name: 'Aquatic Park', exact: true }).click();
  else await page.evaluate(() => APP.frame.switchView());
  await expect.poll(() => page.evaluate(() => APP.state.world)).toBe('cove');
  expect(errors).toEqual([]);
});

test('shared route names and saved names stay text', async ({ page }) => {
  const name = '<img src=x onerror="window.__injected=1">';
  const query = new URLSearchParams({ name, wp: '37.809,-122.424;37.8095,-122.424', mode: 'oneway', route: 'custom' });
  await page.goto(`/?${fixed}&${query}`); await ready(page);
  await expect(page.locator('#swims')).toContainText(name);
  await expect(page.locator('#swims img')).toHaveCount(0);
  await page.locator('#panel details').filter({ has: page.locator('#fav-save') }).locator('summary').click();
  await page.locator('#fav-save').click();
  await expect(page.locator('#favs')).toContainText(name);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
});

test('invalid plans and stored settings do not break startup', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('plan.settings', '{"swim":null,"units":null}'); localStorage.setItem('plan.favourites', '{}'); });
  await page.goto(`/?${fixed}&pace=0:00&wp=91,0;0,0`); await ready(page);
  expect(await page.evaluate(() => Number.isFinite(APP.state.paceMps) && APP.state.paceMps > 0)).toBe(true);
  expect(await page.evaluate(() => APP.state.routeId)).not.toBe('custom');
  await expect(page.locator('#banner')).toBeHidden();
});

test('Planner avoids Bay preload and loads next year on date selection', async ({ page }) => {
  const requests = []; page.on('request', r => requests.push(r.url()));
  await page.goto(`/?${fixed}`); await ready(page);
  await page.waitForTimeout(5500);
  expect(requests.some(u => u.includes('/worlds/bay/'))).toBe(false);
  expect(requests.some(u => u.includes('currents-2027'))).toBe(false);
  await set(page, { selectedTime: Date.parse('2027-06-01T12:00:00-07:00') });
  await expect.poll(() => requests.some(u => u.includes('currents-2027'))).toBe(true);
  await expect.poll(() => page.evaluate(() => APP.app.covers(Date.parse('2027-06-01T12:00:00-07:00'), Date.parse('2027-06-01T18:00:00-07:00')))).toBe(true);
});

test('search cancellation discards old pace results', async ({ page }) => {
  await page.goto(`/?${fixed}&world=bay`); await ready(page);
  await page.locator('#bs summary').click();
  await page.locator('#bs-cycles').fill('8');
  await page.locator('#bs-find').click();
  await set(page, { paceMps: 1.2 });
  await expect(page.locator('#bs-find')).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(page.locator('#bs-results')).toBeEmpty();
});

test('observation updates preserve physics and playback preserves timeline background', async ({ page }) => {
  await page.goto(`/?${fixed}&frames=20`); await ready(page);
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.oldPhysics = APP.state.physics; window.oldCurve = document.querySelector('#tl .flood'); });
  await page.evaluate(async () => (await import('/js/engine/state.js')).updateObservations({ wind: { t: Date.now(), kn: 4 } }));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => APP.state.physics === window.oldPhysics)).toBe(true);
  await page.evaluate(() => APP.app.stepFrames(40));
  expect(await page.evaluate(() => document.querySelector('#tl .flood') === window.oldCurve)).toBe(true);
});

test('frame uses preset fade timings and ignores stale sensor data', async ({ page }) => {
  await page.route('**/data/frame.local.json', route => route.fulfill({ json: { holdSeconds: 0.2, fadeSeconds: 0.3 } }));
  await page.route('**/ambient.json', route => route.fulfill({ json: { lux: 0, t: Date.now() - 120000 } }));
  await page.goto(`/frame/?${fixed}&persist=0&kiosk=1`); await ready(page);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hold-seconds').trim())).toBe('0.2s');
  await page.waitForTimeout(600);
  expect(await page.locator('#dim').evaluate(el => Number(el.style.opacity))).toBe(0);
});

test('Pages subdirectory loads both products and runtime assets only', async ({ page }) => {
  const bad = []; page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('frame.local.json')) bad.push(r.url()); });
  for (const path of ['/sfbayswims/', '/sfbayswims/frame/']) {
    await page.goto(`${path}?${fixed}&frames=20&persist=0`); await ready(page);
    expect(await page.evaluate(() => APP.live.photo && APP.state.physics.byRoute.size > 0)).toBe(true);
  }
  expect(bad).toEqual([]);
});

test('search can load the following year independently of the selected start', async ({ page }) => {
  await page.goto(`/?${fixed}&frames=20`); await ready(page);
  await page.locator('#bs summary').click();
  await page.locator('#bs-date').fill('2027-06-01');
  await page.locator('#bs-find').click();
  await expect(page.locator('#bs-find')).toBeEnabled();
  await expect(page.locator('#bs-results .bs').first()).toBeVisible();
  expect(await page.evaluate(() => APP.app.covers(Date.parse('2027-06-01T12:00:00-07:00'), Date.parse('2027-06-01T13:00:00-07:00')))).toBe(true);
});

test('changing world during search leaves no old results', async ({ page }) => {
  await page.goto(`/?${fixed}&world=bay`); await ready(page);
  await page.locator('#bs summary').click(); await page.locator('#bs-cycles').fill('8');
  await page.locator('#bs-find').click();
  await page.getByRole('button', { name: 'Aquatic Park', exact: true }).click();
  await expect.poll(() => page.evaluate(() => APP.state.world)).toBe('cove');
  await page.waitForTimeout(300); await expect(page.locator('#bs-results')).toBeEmpty();
});

test('frame repeats the selected swim until the dial chooses another', async ({ page }) => {
  await page.route('**/data/frame.local.json', route => route.fulfill({ json: { swimSeconds: 1, sweptSeconds: 1, holdSeconds: 0.1, fadeSeconds: 0.1, restSeconds: 0.1 } }));
  await page.goto(`/frame/?${fixed}&world=bay&persist=0&swimmer=1&kn=-10`); await ready(page);
  await expect.poll(() => page.evaluate(() => APP.frame.cycle.current?.id)).toBe('alcatraz');
  await page.waitForTimeout(3500);
  await expect.poll(() => page.evaluate(() => APP.frame.cycle.current?.id)).toBe('alcatraz');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => APP.frame.cycle.current?.id)).toBe('escape');
});

test('phone layout keeps planner controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?${fixed}`); await ready(page);
  await expect(page.locator('#handle')).toBeVisible();
  await page.locator('#collapse').click(); await expect(page.locator('html')).toHaveClass(/panel-collapsed/);
  await page.locator('#handle').click(); await expect(page.locator('#pace')).toBeVisible();
});


test('custom plan survives a round trip between worlds', async ({ page }) => {
  await page.goto(`/?${fixed}&wp=37.809,-122.424;37.8095,-122.424&name=My+swim&mode=oneway&route=custom`); await ready(page);
  const original = await page.evaluate(() => APP.planner.draw.custom);
  await page.getByRole('button', { name: 'San Francisco Bay', exact: true }).click();
  await expect.poll(() => page.evaluate(() => APP.state.world)).toBe('bay');
  await page.getByRole('button', { name: 'Aquatic Park', exact: true }).click();
  await expect.poll(() => page.evaluate(() => APP.state.world)).toBe('cove');
  expect(await page.evaluate(() => APP.planner.draw.custom)).toEqual(original);
});


test('frame button and dial preserve time and photograph mode', async ({ page }) => {
  await page.goto(`/frame/?${fixed}&persist=0`); await ready(page);
  expect(await page.evaluate(() => APP.state.show.swimmer)).toBe(false);
  await expect(page.locator('#current-wave')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('frame-current-wave.png') });
  const curveBefore = await page.locator('#current-wave .wave-curve').getAttribute('d');
  const original = await page.evaluate(() => APP.state.selectedTime);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => APP.state.selectedTime)).toBe(original + 300000);
  await expect(page.locator('#current-wave .wave-curve')).toHaveAttribute('d', /M/);
  expect(await page.locator('#current-wave .wave-curve').getAttribute('d')).not.toBe(curveBefore);
  const press = async n => {
    for (let i = 0; i < n; i++) await page.keyboard.press('b');
    await page.waitForTimeout(350);
  };
  await press(2);
  await expect.poll(() => page.evaluate(() => APP.state.swimming)).toBe(true);
  const at = await page.evaluate(() => APP.state.selectedTime);
  await page.keyboard.press('ArrowRight');
  const route = await page.evaluate(() => APP.state.routeId);
  expect(await page.evaluate(() => APP.state.selectedTime)).toBe(at);
  await press(3);
  await expect(page.locator('html')).toHaveClass(/photograph/);
  await expect(page.locator('#svg')).toBeHidden();
  await expect(page.locator('#particles')).toBeHidden();
  await expect(page.locator('#conditions')).toBeHidden();
  await expect(page.locator('#hint')).toBeHidden();
  await expect(page.locator('#current-wave')).toBeHidden();
  expect(await page.evaluate(() => APP.state.swimming)).toBe(false);
  await press(3);
  await expect.poll(() => page.evaluate(() => APP.state.swimming)).toBe(true);
  expect(await page.evaluate(() => APP.state.routeId)).toBe(route);
  await press(2);
  expect(await page.evaluate(() => APP.state.show.swimmer)).toBe(false);
  expect(await page.evaluate(() => APP.state.selectedTime)).toBe(at);
  await page.keyboard.down('b'); await page.waitForTimeout(650); await page.keyboard.up('b');
  await expect.poll(() => page.evaluate(() => APP.state.world)).toBe('bay');
  expect(await page.evaluate(() => APP.state.selectedTime)).toBe(at);
  await page.waitForTimeout(1100);
  await press(1);
  expect(await page.evaluate(() => APP.state.selectedTime)).toBeNull();
  expect(await page.evaluate(() => APP.state.show.swimmer)).toBe(false);
});


test('frame wave keeps slack current and matches the conditions width', async ({ page }) => {
  await page.goto(`/frame/?${fixed}&persist=0`); await ready(page);
  for (const world of ['cove', 'bay']) {
    if (world === 'bay') await page.evaluate(() => APP.frame.switchView());
    await expect.poll(() => page.evaluate(() => {
      const wave = document.querySelector('#current-wave').getBoundingClientRect();
      const conditions = document.querySelector('#conditions').getBoundingClientRect();
      return Math.abs(wave.width - conditions.width);
    })).toBeLessThan(1);
    expect(await page.locator('#current-wave text').allTextContents()).not.toContain('EBB');
    expect(await page.locator('#current-wave text').allTextContents()).not.toContain('FLOOD');
    const slackTime = await page.evaluate(() => {
      const at = APP.state.selectedTime;
      for (let t = at - 12 * 3600000; t <= at + 12 * 3600000; t += 120000) {
        const o = APP.live.field.reference(t);
        if (o.label === 'SLACK' && Math.abs(o.signedKn) > 0.01) return t;
      }
      return null;
    });
    expect(slackTime).not.toBeNull();
    await set(page, { selectedTime: slackTime });
    await expect(page.locator('#conditions')).toContainText('slack');
    expect(Number(await page.locator('#current-wave circle').getAttribute('cy'))).not.toBe(25);
    await expect(page.locator('#current-wave .wave-curve')).toHaveAttribute('d', /C/);
  }
});


test('frame date crosses midnight and dial offset clears on return to now', async ({ page }) => {
  await page.goto(`/frame/?${fixed}&persist=0`); await ready(page);
  await expect(page.locator('#clock')).toContainText('Sep 8, 2026');
  await expect(page.locator('#clock')).not.toContainText('LIVE');
  const labels = await page.evaluate(async () => {
    const { set } = await import('/js/engine/state.js');
    const at = Date.parse('2026-09-08T23:58:00-07:00');
    set({ now: at, selectedTime: at });
    APP.frame.controls.turn(1);
    const forward = document.querySelector('#clock').textContent;
    APP.frame.controls.now();
    const restored = document.querySelector('#clock').textContent;
    APP.frame.controls.swimmer();
    const swimmer = document.querySelector('#clock').textContent;
    return { forward, restored, swimmer };
  });
  expect(labels.forward).toBe('Sep 9, 2026 · 12:03am · +5M');
  expect(labels.restored).toBe('Sep 8, 2026 · 11:58pm');
  expect(labels.swimmer).toBe('Sep 8, 2026 · 11:58pm');
});
