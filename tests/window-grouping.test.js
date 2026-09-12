const test = require('node:test');
const assert = require('node:assert/strict');
const { groupAndSortWindows } = require('../src/search-results.js');

test('groupAndSortWindows - active window is always placed first (FR-005)', () => {
  const allTabs = [
    { id: 1, windowId: 5, title: 'Tab in Win 5' },
    { id: 2, windowId: 10, title: 'Tab in Win 10' },
    { id: 3, windowId: 2, title: 'Tab in Win 2' }
  ];
  const matchedTabs = [...allTabs];
  const activeWindowId = 10;

  const { windowIds } = groupAndSortWindows(allTabs, matchedTabs, activeWindowId);
  assert.equal(windowIds[0], 10, 'Active window ID 10 must be the first element');
});

test('groupAndSortWindows - remaining non-active windows are sorted ascending by ID', () => {
  const allTabs = [
    { id: 1, windowId: 40 },
    { id: 2, windowId: 15 },
    { id: 3, windowId: 30 },
    { id: 4, windowId: 5 }
  ];
  const matchedTabs = [...allTabs];
  const activeWindowId = 30;

  const { windowIds } = groupAndSortWindows(allTabs, matchedTabs, activeWindowId);
  // Active window (30) first, followed by remaining sorted: 5, 15, 40
  assert.deepEqual(windowIds, [30, 5, 15, 40]);
});

test('groupAndSortWindows - computes total tabs per window and groups matched tabs', () => {
  const allTabs = [
    { id: 1, windowId: 1, title: 'Doc 1' },
    { id: 2, windowId: 1, title: 'Doc 2' },
    { id: 3, windowId: 1, title: 'Doc 3' },
    { id: 4, windowId: 2, title: 'Sheet 1' }
  ];
  // Only tabs 1 and 4 match
  const matchedTabs = [allTabs[0], allTabs[3]];
  const activeWindowId = 1;

  const { groups, windowIds, totalTabsPerWindow } = groupAndSortWindows(allTabs, matchedTabs, activeWindowId);

  assert.equal(totalTabsPerWindow[1], 3);
  assert.equal(totalTabsPerWindow[2], 1);
  assert.equal(groups[1].length, 1);
  assert.equal(groups[2].length, 1);
  assert.equal(groups[1][0].id, 1);
  assert.equal(groups[2][0].id, 4);
});

test('groupAndSortWindows - handles windows with 0 matches', () => {
  const allTabs = [
    { id: 1, windowId: 1, title: 'Match' },
    { id: 2, windowId: 2, title: 'No Match' }
  ];
  const matchedTabs = [allTabs[0]]; // Window 2 has no matches
  const activeWindowId = 1;

  const { groups, windowIds, totalTabsPerWindow } = groupAndSortWindows(allTabs, matchedTabs, activeWindowId);

  assert.deepEqual(windowIds, [1, 2]);
  assert.equal(groups[1].length, 1);
  assert.equal(groups[2], undefined);
  assert.equal(totalTabsPerWindow[2], 1);
});
