import test from 'node:test';
import assert from 'node:assert/strict';
import { createFramePacer } from '../js/engine/frame-pacer.js';

test('30 fps limit retains time at 35 Hz and 60 Hz without speeding up simulation', () => {
  for (const hz of [35, 60]) {
    const pace = createFramePacer(0);
    let frames = 0, elapsed = 0;
    for (let i = 1; i <= hz * 10; i++) {
      const dt = pace(i * 1000 / hz, 30);
      if (dt != null) { frames++; elapsed += dt; }
    }
    assert.equal(frames, 300);
    assert.ok(Math.abs(elapsed - 10) < 1e-8);
  }
});

test('a slower display can use every callback and long stalls do not cause catch-up bursts', () => {
  const pace = createFramePacer(0);
  for (let i = 1; i <= 20; i++) assert.ok(Math.abs(pace(i * 50, 30) - 0.05) < 1e-8);
  assert.equal(pace(5000, 30), 0.1);
  assert.equal(pace(5001, 30), null);
});

test('uncapped rendering uses the actual elapsed time on every callback', () => {
  const pace = createFramePacer(0);
  assert.equal(pace(10, 0), 0.01);
  assert.equal(pace(25, 0), 0.015);
});
