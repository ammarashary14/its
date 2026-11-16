import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCrop, sourcePoint } from '../assets/photo-cropper.js';

const near = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
};
const pointNear = (actual, expected) => {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
};
const corners = crop => [[0, 0], [crop.targetWidth, 0], [0, crop.targetHeight], [crop.targetWidth, crop.targetHeight]];

test('landscape photo covers the portrait frame with the expected center crop', () => {
  const crop = computeCrop(1200, 800, {});
  near(crop.scale, 1);
  near(crop.maxX, 280);
  near(crop.maxY, 0);
  pointNear(sourcePoint(crop, 0, 0), { x: 280, y: 0 });
  pointNear(sourcePoint(crop, 640, 800), { x: 920, y: 800 });
});

test('portrait photo fills the width and trims evenly from the top and bottom', () => {
  const crop = computeCrop(800, 1200, {});
  near(crop.scale, 0.8);
  near(crop.maxX, 0);
  near(crop.maxY, 80);
  pointNear(sourcePoint(crop, 0, 0), { x: 0, y: 100 });
  pointNear(sourcePoint(crop, 640, 800), { x: 800, y: 1100 });
});

test('a matching 4:5 image is preserved in full when centered at minimum zoom', () => {
  const crop = computeCrop(1280, 1600, { zoom: 1 });
  near(crop.scale, 0.5);
  near(crop.maxX, 0);
  near(crop.maxY, 0);
  pointNear(sourcePoint(crop, 0, 0), { x: 0, y: 0 });
  pointNear(sourcePoint(crop, 640, 800), { x: 1280, y: 1600 });
});

test('quarter turns swap the covering dimensions and have a consistent inverse', () => {
  const crop = computeCrop(800, 1200, { rotation: 90 });
  assert.equal(crop.rotatedWidth, 1200);
  assert.equal(crop.rotatedHeight, 800);
  near(crop.scale, 1);
  pointNear(sourcePoint(crop, 0, 0), { x: 0, y: 920 });
  pointNear(sourcePoint(crop, 640, 800), { x: 800, y: 280 });
});

test('rotation wraps without changing the crop or inverse mapping', () => {
  const positive = computeCrop(900, 1500, { rotation: 450, zoom: 2, x: 41, y: -72 });
  const canonical = computeCrop(900, 1500, { rotation: 90, zoom: 2, x: 41, y: -72 });
  assert.equal(positive.rotation, 90);
  assert.equal(computeCrop(900, 1500, { rotation: -90 }).rotation, 270);
  assert.equal(computeCrop(900, 1500, { rotation: 720 }).rotation, 0);
  for (const [x, y] of corners(canonical)) pointNear(sourcePoint(positive, x, y), sourcePoint(canonical, x, y));
});

test('zoom is constrained to the supported range and scales the image consistently', () => {
  const fit = computeCrop(800, 1000, { zoom: -5 });
  const enlarged = computeCrop(800, 1000, { zoom: 99 });
  assert.equal(fit.zoom, 1);
  assert.equal(enlarged.zoom, 4);
  near(enlarged.scale, fit.scale * 4);
  near(enlarged.maxX, 960);
  near(enlarged.maxY, 1200);
});

test('drag offsets are clamped at both edges instead of exposing empty canvas', () => {
  const right = computeCrop(1600, 1000, { x: 1e8, y: 1e8 });
  const left = computeCrop(1600, 1000, { x: -1e8, y: -1e8 });
  near(right.x, right.maxX);
  near(left.x, -left.maxX);
  near(right.y, 0);
  near(left.y, 0);
  pointNear(sourcePoint(right, 0, 0), { x: 0, y: 0 });
  pointNear(sourcePoint(left, 640, 800), { x: 1600, y: 1000 });
});

test('every corner remains inside the source for portrait, landscape, small, and rotated images', () => {
  for (const [width, height] of [[13, 23], [3000, 500], [500, 3000], [1600, 1600], [4032, 3024]]) {
    for (const rotation of [0, 90, 180, 270]) {
      for (const zoom of [1, 1.5, 4]) {
        for (const [x, y] of [[0, 0], [-1e9, -1e9], [1e9, -1e9], [-1e9, 1e9], [1e9, 1e9]]) {
          const crop = computeCrop(width, height, { rotation, zoom, x, y });
          for (const corner of corners(crop)) {
            const point = sourcePoint(crop, ...corner);
            assert.ok(point.x >= -1e-6 && point.x <= width + 1e-6, `x boundary: ${JSON.stringify({ width, height, rotation, zoom, x, y, point })}`);
            assert.ok(point.y >= -1e-6 && point.y <= height + 1e-6, `y boundary: ${JSON.stringify({ width, height, rotation, zoom, x, y, point })}`);
          }
        }
      }
    }
  }
});

test('preview and output sizes map to the same source coordinates', () => {
  const output = computeCrop(1800, 2400, { rotation: 270, zoom: 2.3, x: 120, y: -93 });
  const preview = computeCrop(1800, 2400, { rotation: 270, zoom: 2.3, x: 60, y: -46.5 }, 320, 400);
  for (const [x, y] of [[0, 0], [640, 800], [320, 400], [101, 673]]) {
    pointNear(sourcePoint(output, x, y), sourcePoint(preview, x / 2, y / 2));
  }
});

test('invalid dimensions and non-finite transform values are rejected', () => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => computeCrop(invalid, 800, {}));
    assert.throws(() => computeCrop(640, invalid, {}));
    assert.throws(() => computeCrop(640, 800, {}, invalid, 800));
    assert.throws(() => computeCrop(640, 800, {}, 640, invalid));
  }
  for (const key of ['zoom', 'rotation', 'x', 'y']) {
    for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => computeCrop(640, 800, { [key]: invalid }));
  }
});
