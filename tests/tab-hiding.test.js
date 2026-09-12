const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTabsToHideAndShow } = require('../src/background.js');

test('calculateTabsToHideAndShow - active tabs MUST NEVER be hidden (Firefox constraint)', () => {
  const tabs = [
    { id: 101, title: 'Non-matching Active Tab', active: true, pinned: false, hidden: false }
  ];
  const matchedTabIds = []; // matches nothing
  const { toHide, toShow } = calculateTabsToHideAndShow(tabs, matchedTabIds);

  assert.equal(toHide.includes(101), false, 'Active tab must never be placed in toHide');
  assert.equal(toHide.length, 0);
  assert.equal(toShow.length, 0);
});

test('calculateTabsToHideAndShow - pinned tabs MUST NEVER be hidden (Firefox constraint)', () => {
  const tabs = [
    { id: 102, title: 'Non-matching Pinned Tab', active: false, pinned: true, hidden: false }
  ];
  const matchedTabIds = []; // matches nothing
  const { toHide, toShow } = calculateTabsToHideAndShow(tabs, matchedTabIds);

  assert.equal(toHide.includes(102), false, 'Pinned tab must never be placed in toHide');
  assert.equal(toHide.length, 0);
  assert.equal(toShow.length, 0);
});

test('calculateTabsToHideAndShow - non-matching unpinned inactive tab is placed in toHide', () => {
  const tabs = [
    { id: 103, title: 'Non-matching Regular Tab', active: false, pinned: false, hidden: false }
  ];
  const matchedTabIds = [];
  const { toHide, toShow } = calculateTabsToHideAndShow(tabs, matchedTabIds);

  assert.deepEqual(toHide, [103]);
  assert.equal(toShow.length, 0);
});

test('calculateTabsToHideAndShow - already-hidden non-matching tab is omitted from toHide', () => {
  const tabs = [
    { id: 104, title: 'Already Hidden Non-matching Tab', active: false, pinned: false, hidden: true }
  ];
  const matchedTabIds = [];
  const { toHide, toShow } = calculateTabsToHideAndShow(tabs, matchedTabIds);

  // Since it is already hidden, avoid calling browser.tabs.hide again
  assert.equal(toHide.length, 0);
  assert.equal(toShow.length, 0);
});

test('calculateTabsToHideAndShow - matching hidden tab is placed in toShow', () => {
  const tabs = [
    { id: 105, title: 'Matching Hidden Tab', active: false, pinned: false, hidden: true },
    { id: 106, title: 'Matching Visible Tab', active: false, pinned: false, hidden: false }
  ];
  const matchedTabIds = [105, 106];
  const { toHide, toShow } = calculateTabsToHideAndShow(tabs, matchedTabIds);

  assert.deepEqual(toShow, [105], 'Only previously hidden matching tab should be in toShow');
  assert.equal(toHide.length, 0);
});

test('calculateTabsToHideAndShow - mixed tab set partitions correctly and safely', () => {
  const tabs = [
    { id: 1, active: true, pinned: false, hidden: false },   // active, non-matching -> stay visible
    { id: 2, active: false, pinned: true, hidden: false },   // pinned, non-matching -> stay visible
    { id: 3, active: false, pinned: false, hidden: false },  // non-matching visible -> hide
    { id: 4, active: false, pinned: false, hidden: true },   // matching hidden -> show
    { id: 5, active: false, pinned: false, hidden: true },   // non-matching already hidden -> stay hidden
    { id: 6, active: false, pinned: false, hidden: false }   // matching visible -> stay visible
  ];
  const matchedTabIds = [4, 6];
  const { toHide, toShow } = calculateTabsToHideAndShow(tabs, matchedTabIds);

  assert.deepEqual(toHide, [3]);
  assert.deepEqual(toShow, [4]);
});
