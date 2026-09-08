import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.window = { addEventListener() {} };
const element = () => ({ children: [], style: { setProperty() {} }, setAttribute() {}, appendChild(c) { this.children.push(c); }, set innerHTML(_) { this.children = []; } });
globalThis.document = { createElementNS: element };
globalThis.location = { origin: 'https://example.test', pathname: '/sfbayswims/' };
const { integrateRoute, scanStarts, scanWindows } = await import('../js/engine/swim.js');
const { createSwimmer } = await import('../js/engine/animate.js');
const { CurrentSeries } = await import('../js/engine/current.js');
const { CONFIG } = await import('../js/engine/config.js');
const { state, set, updateObservations } = await import('../js/engine/state.js');
const { buildRoutes } = await import('../js/engine/routes.js');
const { createProjection } = await import('../js/engine/projection.js');
const { buildGeometry } = await import('../js/engine/geometry.js');
const { routeCrossesLand } = await import('../js/engine/world.js');
const { customSwim, paceFrom } = await import('../js/engine/validate.js');
const { customFromParams, planUrl } = await import('../js/planner/share.js');
const read = path => JSON.parse(fs.readFileSync(new URL('../' + path, import.meta.url)));
const route = { id: 'test', meters: 100, legs: [{ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }] };
const field = x => ({ sample: () => ({ x, y: 0 }), isWater: () => true });

test('still water and following current have analytical travel times', () => {
  assert.equal(integrateRoute(route, 0, 1, field(0)).totalSeconds, 100);
  assert.equal(integrateRoute(route, 0, 1, field(1)).totalSeconds, 50);
  assert.throws(() => integrateRoute(route, 0, Infinity, field(0)));
});

test('an immediately swept frame swimmer advances and completes', () => {
  const result = integrateRoute(route, 0, 1, field(-3));
  assert.equal(result.profile.sweptAt, 0);
  const swimmer = createSwimmer({ routeLayer: element(), swimmerLayer: element() });
  swimmer.setRoute(result, { realSeconds: 2, sweptRealSeconds: 6, crumbsPerSwim: 0 });
  swimmer.step(1 / 30); assert(swimmer.tau > 0);
  let complete = false;
  for (let i = 0; i < 300 && !complete; i++) complete = swimmer.step(1 / 30);
  assert(complete);
});

test('best starts and automatic windows exclude finishes beyond coverage', () => {
  const covers = (a, b) => a >= 0 && b <= 100000;
  const results = scanStarts(route, [0, 1000], 1, field(0), { covers });
  assert.deepEqual(results.map(r => r.feasible), [true, false]);
  assert.equal(scanWindows(route, 1000, 1, field(0), { hours: 1, covers }).next, null);
});

test('bundled predictions are marked approximate inside their coverage', () => {
  const series = new CurrentSeries({ t0: 0, dtMs: 1000, kn: [1, 2], dir: [90, 90] });
  assert.equal(series.at(500).approx, true);
  const combined = CurrentSeries.concat([{ t0: 0, dtMs: 1000, kn: [1, 2], dir: [90, 90] }]);
  assert.equal(combined.at(500).approx, true);
  assert.equal(new CurrentSeries({ samples: [{ t: 0, kn: 1, dir: 90 }, { t: 1000, kn: 2, dir: 90 }] }).at(500).approx, false);
});

test('observations update without invalidating current/physics version', () => {
  const version = state.data.version;
  updateObservations({ wind: { kn: 4 } }); assert.equal(state.data.version, version);
});

test('custom plans reject unbounded geometry and invalid pace', () => {
  for (const value of ['0:00', '-1', 'Infinity', '1:99', '99:00']) assert.equal(paceFrom(value), null);
  assert.equal(paceFrom('1:40'), 1);
  assert.equal(customFromParams(new URLSearchParams('wp=NaN,0;1,2')), null);
  assert.equal(customFromParams(new URLSearchParams('wp=91,0;1,2')), null);
  assert.equal(customFromParams(new URLSearchParams('wp=0,0;70,100')), null);
  assert.equal(customSwim({ mode: 'oneway', points: Array(101).fill({ lat: 37.81, lon: -122.42 }) }), null);
});

test('shared custom plan and start round-trip across DST', () => {
  const custom = { name: '<b>My swim</b>', mode: 'oneway', points: [{ lat: 37.81, lon: -122.42 }, { lat: 37.811, lon: -122.42 }] };
  for (const time of ['2026-03-08T01:30:00-08:00', '2026-11-01T01:30:00-07:00', '2026-11-01T01:30:00-08:00']) {
    set({ world: 'cove', routeId: 'custom', selectedTime: Date.parse(time), paceMps: 1 });
    const params = new URL(planUrl(custom)).searchParams;
    assert.equal(Date.parse(params.get('t')), Date.parse(time)); assert.deepEqual(customFromParams(params), custom);
  }
});

test('all Cove routes build without crossing land', () => {
  const proj = createProjection(CONFIG.origin), geom = buildGeometry(read('data/worlds/cove/shoreline.geojson'), read('data/worlds/cove/zones.json'), CONFIG, proj);
  const { routes } = buildRoutes(read('data/worlds/cove/routes.json'), read('data/worlds/cove/landmarks.json'), geom, { proj, followOffsetM: 15, keepRightM: 4, turnRadiusM: 20 });
  assert.equal(routes.length, 5);
  for (const route of routes) { assert(route.meters > 0); assert.equal(routeCrossesLand(route, geom), null); }
});
