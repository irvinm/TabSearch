const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanStaleCollapsedWindows } = require('../src/search-results.js');

test('cleanStaleCollapsedWindows - returns false when all collapsed windows are active', () => {
  const collapsed = new Set([1, 2]);
  const activeWindows = new Set([1, 2, 3]);

  const changed = cleanStaleCollapsedWindows(collapsed, activeWindows);
  assert.equal(changed, false);
  assert.equal(collapsed.size, 2);
  assert.equal(collapsed.has(1), true);
  assert.equal(collapsed.has(2), true);
});

test('cleanStaleCollapsedWindows - removes closed window IDs and returns true', () => {
  const collapsed = new Set([1, 2, 99]); // Window 99 was closed
  const activeWindows = [1, 2, 3];

  const changed = cleanStaleCollapsedWindows(collapsed, activeWindows);
  assert.equal(changed, true);
  assert.equal(collapsed.has(99), false);
  assert.equal(collapsed.size, 2);
});

test('cleanStaleCollapsedWindows - removes multiple closed window IDs', () => {
  const collapsed = new Set([10, 20, 30]);
  const activeWindows = new Set([10]); // Windows 20 and 30 closed

  const changed = cleanStaleCollapsedWindows(collapsed, activeWindows);
  assert.equal(changed, true);
  assert.equal(collapsed.size, 1);
  assert.deepEqual(Array.from(collapsed), [10]);
});

test('cleanStaleCollapsedWindows - handles null or empty arguments gracefully', () => {
  assert.equal(cleanStaleCollapsedWindows(null, [1]), false);
  const empty = new Set();
  assert.equal(cleanStaleCollapsedWindows(empty, [1]), false);
});
