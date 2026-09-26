const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFlatNavigationList, navigateHighlightIndex, shouldHandleKeyboardNavigation } = require('../src/search-results.js');

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

test('buildFlatNavigationList - accepts persisted collapsed windows as an array', () => {
  const groups = {
    1: [{ id: 10 }],
    2: [{ id: 20 }, { id: 21 }]
  };

  const flat = buildFlatNavigationList([2, 1], groups, [2]);

  assert.deepEqual(flat.map(tab => tab.id), [10]);
});

test('buildFlatNavigationList - skips missing groups and preserves rendered order', () => {
  const groups = {
    2: [{ id: 20 }, { id: 21 }],
    5: [{ id: 50 }]
  };

  const flat = buildFlatNavigationList([5, 3, 2], groups, new Set());

  assert.deepEqual(flat.map(tab => tab.id), [50, 20, 21]);
});

test('shouldHandleKeyboardNavigation - allows navigation when focus is on searchInput', () => {
  const searchInput = { id: 'search', tagName: 'INPUT' };
  assert.equal(shouldHandleKeyboardNavigation(searchInput, searchInput, false), true);
});

test('shouldHandleKeyboardNavigation - allows navigation on non-interactive elements or null target', () => {
  const searchInput = { id: 'search' };
  const divElement = {
    tagName: 'DIV',
    closest: (selector) => null
  };
  assert.equal(shouldHandleKeyboardNavigation(null, searchInput, false), true);
  assert.equal(shouldHandleKeyboardNavigation(divElement, searchInput, false), true);
});

test('shouldHandleKeyboardNavigation - ignores navigation when event is already defaultPrevented', () => {
  const searchInput = { id: 'search' };
  assert.equal(shouldHandleKeyboardNavigation(searchInput, searchInput, true), false);
  assert.equal(shouldHandleKeyboardNavigation(null, searchInput, true), false);
});

test('shouldHandleKeyboardNavigation - ignores navigation when focus is on interactive controls', () => {
  const searchInput = { id: 'search' };

  // Button
  const button = {
    closest: (sel) => sel.includes('button') ? {} : null
  };
  assert.equal(shouldHandleKeyboardNavigation(button, searchInput, false), false);

  // Link inside tab list
  const link = {
    closest: (sel) => sel.includes('a') ? {} : null
  };
  assert.equal(shouldHandleKeyboardNavigation(link, searchInput, false), false);

  // Range slider or other input
  const rangeInput = {
    closest: (sel) => sel.includes('input') ? {} : null
  };
  assert.equal(shouldHandleKeyboardNavigation(rangeInput, searchInput, false), false);

  // Accessible accordion header with role="button"
  const header = {
    closest: (sel) => sel.includes('[role="button"]') ? {} : null
  };
  assert.equal(shouldHandleKeyboardNavigation(header, searchInput, false), false);
});

