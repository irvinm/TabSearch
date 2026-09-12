const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFlatNavigationList, navigateHighlightIndex } = require('../src/search-results.js');

test('buildFlatNavigationList - excludes tabs from collapsed windows (FR-010)', () => {
  const windowIds = [1, 2, 3];
  const groups = {
    1: [{ id: 10, title: 'Tab 10' }, { id: 11, title: 'Tab 11' }],
    2: [{ id: 20, title: 'Tab 20' }],
    3: [{ id: 30, title: 'Tab 30' }]
  };
  const collapsedWindows = new Set([2]); // Window 2 is collapsed

  const flat = buildFlatNavigationList(windowIds, groups, collapsedWindows);

  // Should only contain tabs from Window 1 and Window 3
  const flatTabIds = flat.map(t => t.id);
  assert.deepEqual(flatTabIds, [10, 11, 30]);
  assert.equal(flatTabIds.includes(20), false, 'Collapsed window tabs must be excluded from navigation');
});

test('buildFlatNavigationList - returns empty array when all windows collapsed', () => {
  const windowIds = [1, 2];
  const groups = {
    1: [{ id: 10 }],
    2: [{ id: 20 }]
  };
  const collapsedWindows = new Set([1, 2]);
  const flat = buildFlatNavigationList(windowIds, groups, collapsedWindows);
  assert.equal(flat.length, 0);
});

test('navigateHighlightIndex - starts at first or last item from unhighlighted state (-1)', () => {
  const totalCount = 5;
  // Down from -1 -> 0
  assert.equal(navigateHighlightIndex(-1, totalCount, 1), 0);
  // Up from -1 -> 4 (last item)
  assert.equal(navigateHighlightIndex(-1, totalCount, -1), 4);
});

test('navigateHighlightIndex - advances sequentially', () => {
  const totalCount = 5;
  assert.equal(navigateHighlightIndex(0, totalCount, 1), 1);
  assert.equal(navigateHighlightIndex(1, totalCount, 1), 2);
  assert.equal(navigateHighlightIndex(2, totalCount, -1), 1);
});

test('navigateHighlightIndex - wraps boundaries cleanly', () => {
  const totalCount = 3;
  // Wrapping from end to beginning
  assert.equal(navigateHighlightIndex(2, totalCount, 1), 0);
  // Wrapping from beginning to end
  assert.equal(navigateHighlightIndex(0, totalCount, -1), 2);
});

test('navigateHighlightIndex - returns -1 when list is empty', () => {
  assert.equal(navigateHighlightIndex(-1, 0, 1), -1);
  assert.equal(navigateHighlightIndex(0, 0, 1), -1);
});
