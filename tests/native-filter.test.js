const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterMatchingTabs,
  buildVisibilityPlan,
  tokenizeQuery,
  getHostname,
} = require('../src/native-filter.js');
const { getFuse } = require('./helpers/load-fuse.js');

const Fuse = getFuse();

/**
 * Creates an in-memory fake of the small browser surface used by the native
 * filter controller.
 *
 * @returns {Object} Fake browser and helpers.
 */
function createFakeBrowser() {
  let nextId = 1;
  const windows = new Map([
    [1, { id: 1 }],
    [2, { id: 2 }],
  ]);
  const tabs = [];
  const unsupported = new Set();
  const calls = { hide: [], show: [] };
  const sessionStore = {};
  const storage = { fuzzySearch: false, fuzzyThreshold: 0.35 };

  /**
   * Returns a defensive copy of a tab.
   *
   * @param {Object} tab - Tab to clone.
   * @returns {Object} Clone.
   */
  const clone = (tab) => ({ ...tab });

  /**
   * Adds a tab to the fake browser.
   *
   * @param {Object} [options={}] - Tab properties.
   * @returns {Object} Added tab.
   */
  function addTab(options = {}) {
    const windowId = options.windowId || 1;
    const tab = {
      id: nextId++,
      windowId,
      title: options.title || 'Tab',
      url: options.url || 'https://example.com/',
      active: !!options.active,
      pinned: !!options.pinned,
      hidden: !!options.hidden,
      index: tabs.length,
    };
    if (tab.active) {
      for (const other of tabs) {
        if (other.windowId === windowId) other.active = false;
      }
    }
    tabs.push(tab);
    return tab;
  }

  /**
   * Changes the active tab in a window.
   *
   * @param {number} windowId - Window ID.
   * @param {number} tabId - New active tab ID.
   * @returns {Object} Updated tab.
   */
  function setActive(windowId, tabId) {
    for (const tab of tabs) {
      if (tab.windowId === windowId) tab.active = tab.id === tabId;
    }
    return tabs.find(tab => tab.id === tabId);
  }

  /**
   * Removes a tab from the fake browser.
   *
   * @param {number} tabId - Tab ID.
   * @returns {void}
   */
  function removeTab(tabId) {
    const index = tabs.findIndex(tab => tab.id === tabId);
    if (index >= 0) tabs.splice(index, 1);
  }

  /**
   * Moves a tab to another window.
   *
   * @param {number} tabId - Tab ID.
   * @param {number} windowId - Destination window ID.
   * @returns {void}
   */
  function moveTab(tabId, windowId) {
    const tab = tabs.find(item => item.id === tabId);
    if (tab) tab.windowId = windowId;
  }

  /**
   * Updates a tab in place.
   *
   * @param {number} tabId - Tab ID.
   * @param {Object} changes - Properties to merge.
   * @returns {Object|undefined} Updated tab.
   */
  function updateTab(tabId, changes) {
    const tab = tabs.find(item => item.id === tabId);
    if (!tab) return undefined;
    Object.assign(tab, changes);
    return tab;
  }

  const api = {
    tabs: {
      /**
       * Queries tabs.
       *
       * @param {Object} [filter={}] - Query filter.
       * @returns {Promise<Array<Object>>} Matching tab copies.
       */
      async query(filter = {}) {
        return tabs
          .filter(tab => filter.windowId === undefined || tab.windowId === filter.windowId)
          .map(clone);
      },
      /**
       * Hides tabs, respecting Firefox's active/pinned restrictions.
       *
       * @param {number[]} ids - Tab IDs.
       * @returns {Promise<number[]>} Hidden tab IDs.
       */
      async hide(ids) {
        calls.hide.push([...ids]);
        const hidden = [];
        for (const id of ids) {
          const tab = tabs.find(item => item.id === id);
          if (!tab || tab.active || tab.pinned || unsupported.has(id)) continue;
          tab.hidden = true;
          hidden.push(id);
        }
        return hidden;
      },
      /**
       * Shows tabs.
       *
       * @param {number[]} ids - Tab IDs.
       * @returns {Promise<number[]>} Shown tab IDs.
       */
      async show(ids) {
        calls.show.push([...ids]);
        const shown = [];
        for (const id of ids) {
          const tab = tabs.find(item => item.id === id);
          if (!tab) continue;
          tab.hidden = false;
          shown.push(id);
        }
        return shown;
      },
      /**
       * Gets one tab.
       *
       * @param {number} id - Tab ID.
       * @returns {Promise<Object>} Tab copy.
       */
      async get(id) {
        const tab = tabs.find(item => item.id === id);
        if (!tab) throw new Error('No such tab');
        return clone(tab);
      },
    },
    windows: {
      /**
       * Gets a window.
       *
       * @param {number} id - Window ID.
       * @returns {Promise<Object>} Window.
       */
      async get(id) {
        if (!windows.has(id)) throw new Error('No such window');
        return { id };
      },
      /**
       * Gets all windows.
       *
       * @returns {Promise<Array<Object>>} Windows.
       */
      async getAll() {
        return Array.from(windows.values());
      },
      /**
       * Gets the last focused window.
       *
       * @returns {Promise<Object>} Window.
       */
      async getLastFocused() {
        return { id: 1 };
      },
    },
    storage: {
      local: {
        /**
         * Reads fake local storage.
         *
         * @param {string[]} keys - Keys to read.
         * @returns {Promise<Object>} Values.
         */
        async get(keys) {
          const result = {};
          for (const key of keys) result[key] = storage[key];
          return result;
        },
      },
      session: {
        /**
         * Reads fake session storage.
         *
         * @param {string[]} keys - Keys to read.
         * @returns {Promise<Object>} Values.
         */
        async get(keys) {
          const result = {};
          for (const key of keys) result[key] = sessionStore[key];
          return result;
        },
        /**
         * Writes fake session storage.
         *
         * @param {Object} values - Values to store.
         * @returns {Promise<void>} Resolves when written.
         */
        async set(values) {
          Object.assign(sessionStore, values);
        },
        /**
         * Removes fake session storage keys.
         *
         * @param {string[]} keys - Keys to remove.
         * @returns {Promise<void>} Resolves when removed.
         */
        async remove(keys) {
          for (const key of keys) delete sessionStore[key];
        },
      },
    },
  };

  return {
    api,
    tabs,
    calls,
    unsupported,
    sessionStore,
    storage,
    addTab,
    setActive,
    removeTab,
    moveTab,
    updateTab,
  };
}

/**
 * Creates a controller bound to a fake browser.
 *
 * @param {Object} fake - Fake browser.
 * @param {Function|null} [FuseClass=null] - Optional Fuse constructor.
 * @returns {Object} Controller plus captured state updates.
 */
function createController(fake, FuseClass = null) {
  const { createController: factory } = require('../src/native-filter.js');
  const updates = [];
  const controller = factory({
    browserApi: fake.api,
    FuseClass,
    onState: (windowId, state) => updates.push({ windowId, state }),
    logger: { info() {}, warn() {} },
  });
  return { controller, updates };
}

test('native filter - tokenizes and normalizes whitespace/case', () => {
  assert.deepEqual(tokenizeQuery('  Unreal   MCP  '), ['unreal', 'mcp']);
  assert.equal(getHostname('https://www.GitHub.com/a/b'), 'www.github.com');
  assert.equal(getHostname('not a url'), '');
});

test('native filter - matches title, URL and domain case-insensitively', () => {
  const tabs = [
    { id: 1, title: 'GitHub - irvinm/TabSearch', url: 'https://github.com/irvinm/TabSearch' },
    { id: 2, title: 'Unreal Engine 5.8', url: 'https://www.unrealengine.com/docs' },
    { id: 3, title: 'Local MCP notes', url: 'https://notes.example.com/mcp' },
  ];

  assert.deepEqual(filterMatchingTabs(tabs, 'GITHUB'), [1]);
  assert.deepEqual(filterMatchingTabs(tabs, 'unrealengine'), [2]);
  assert.deepEqual(filterMatchingTabs(tabs, 'example.com'), [3]);
  assert.deepEqual(
    filterMatchingTabs(
      [{ id: 4, title: 'Loading…', pendingUrl: 'https://pending.example.test/docs' }],
      'pending.example'
    ),
    [4]
  );
});

test('native filter - multi-word queries require every token', () => {
  const tabs = [
    { id: 1, title: 'Unreal MCP tools', url: 'https://example.com/unreal' },
    { id: 2, title: 'Unreal Engine', url: 'https://unrealengine.com/' },
    { id: 3, title: 'MCP server docs', url: 'https://example.com/mcp' },
  ];

  assert.deepEqual(filterMatchingTabs(tabs, 'unreal mcp'), [1]);
});

test('native filter - falls back to token matching when Fuse is unavailable', () => {
  const tabs = [
    { id: 1, title: 'GitHub', url: 'https://github.com/' },
  ];
  assert.deepEqual(filterMatchingTabs(tabs, 'github', { fuzzySearch: true }, null), [1]);
  assert.deepEqual(filterMatchingTabs(tabs, 'githb', { fuzzySearch: true }, null), []);
});

test('native filter - fuzzy matching uses Fuse when enabled', () => {
  const tabs = [
    { id: 1, title: 'GitHub', url: 'https://github.com/' },
    { id: 2, title: 'YouTube', url: 'https://youtube.com/' },
  ];
  const results = filterMatchingTabs(
    tabs,
    'githb',
    { fuzzySearch: true, fuzzyThreshold: 0.35 },
    Fuse
  );
  assert.equal(results.length, 1);
  assert.equal(results[0], 1);
});

test('native filter - filters and plans 500 tabs quickly', () => {
  const tabs = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1,
    title: `Tab ${String(index).padStart(3, '0')}`,
    url: `https://example.com/${index}`,
    active: index === 0,
    pinned: index === 1,
    hidden: false,
  }));

  const started = Date.now();
  const matched = filterMatchingTabs(tabs, 'tab 499', { searchUrls: true, searchTitles: true });
  const plan = buildVisibilityPlan(tabs, matched, new Set());
  const elapsed = Date.now() - started;

  assert.equal(matched.length, 1);
  assert.equal(plan.toHide.length, 497); // active, pinned and the one match stay visible
  assert.ok(elapsed < 250, `500-tab filter/plan took ${elapsed}ms`);
});

test('native filter - visibility plan never hides active/pinned or reveals pre-hidden tabs', () => {
  const tabs = [
    { id: 1, title: 'Active non-match', active: true, pinned: false, hidden: false },
    { id: 2, title: 'Pinned non-match', active: false, pinned: true, hidden: false },
    { id: 3, title: 'Regular non-match', active: false, pinned: false, hidden: false },
    { id: 4, title: 'Pre-hidden match', active: false, pinned: false, hidden: true },
    { id: 5, title: 'Owned hidden match', active: false, pinned: false, hidden: true },
    { id: 6, title: 'Owned hidden non-match', active: false, pinned: false, hidden: true },
    { id: 7, title: 'Owned pinned non-match', active: false, pinned: true, hidden: true },
    { id: 8, title: 'Protected non-match', active: false, pinned: false, hidden: false },
  ];

  const plan = buildVisibilityPlan(tabs, [4, 5], new Set([5, 6, 7]), new Set([8]));

  assert.deepEqual(plan.toHide, [3]);
  assert.deepEqual(plan.toShow.sort((a, b) => a - b), [5, 7]);
  assert.equal(plan.blockedActive, 1);
  assert.equal(plan.blockedPinned, 1);
  assert.equal(plan.protectedCount, 1);
  assert.equal(plan.matchedCount, 2);
  assert.equal(plan.visibleMatched, 0);
  assert.equal(plan.hiddenMatched, 2);
  assert.equal(plan.keptVisible, 3);
});

test('native filter - setQuery hides non-matches and reports blocked tabs', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const active = fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/', active: true });
  const regular = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/' });
  const pinned = fake.addTab({ windowId: 1, title: 'Pinned', url: 'https://pinned.example/', pinned: true });

  await controller.setQuery(1, 'github');

  assert.equal(fake.tabs.find(tab => tab.id === active.id).hidden, false);
  assert.equal(fake.tabs.find(tab => tab.id === regular.id).hidden, true);
  assert.equal(fake.tabs.find(tab => tab.id === pinned.id).hidden, false);

  const state = await controller.getPanelState(1);
  assert.equal(state.active, true);
  assert.equal(state.query, 'github');
  assert.equal(state.total, 3);
  assert.equal(state.matched, 1);
  assert.equal(state.blockedPinned, 1);
  assert.equal(state.hiddenByFilter, 1);

  controller.dispose();
});

test('native filter - clearing restores only tabs hidden by this session', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const preHidden = fake.addTab({ windowId: 1, title: 'Other extension', hidden: true });
  fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });
  const filtered = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/' });

  await controller.setQuery(1, 'github');
  assert.equal(fake.tabs.find(tab => tab.id === filtered.id).hidden, true);

  await controller.clearWindow(1, { reason: 'test' });

  assert.equal(fake.tabs.find(tab => tab.id === filtered.id).hidden, false);
  assert.equal(fake.tabs.find(tab => tab.id === preHidden.id).hidden, true);
  assert.equal(controller.getSessionCount(), 0);

  controller.dispose();
});

test('native filter - keeps a non-matching origin tab visible after switching to a result', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const origin = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/', active: true });
  const github = fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });

  await controller.setQuery(1, 'github');
  assert.equal(fake.tabs.find(tab => tab.id === origin.id).hidden, false);

  fake.setActive(1, github.id);
  controller.handleTabActivated({ tabId: github.id, windowId: 1 });
  await controller.flush();

  // The origin tab must stay available for a quick switch back, even though
  // it is no longer active and does not match the query.
  assert.equal(fake.tabs.find(tab => tab.id === origin.id).hidden, false);
  assert.equal(fake.tabs.find(tab => tab.id === github.id).hidden, false);
  const state = await controller.getPanelState(1);
  assert.equal(state.protectedCount, 1);
  assert.equal(state.keptVisible, 1);

  await controller.clearWindow(1, { reason: 'test' });
  assert.equal(fake.tabs.find(tab => tab.id === origin.id).hidden, false);

  controller.dispose();
});

test('native filter - inactive panel counter refreshes when tabs open or close', async () => {
  const fake = createFakeBrowser();
  const { controller, updates } = createController(fake);
  fake.addTab({ windowId: 1, title: 'One' });
  fake.addTab({ windowId: 1, title: 'Two' });

  const created = fake.addTab({ windowId: 1, title: 'Three' });
  controller.handleTabCreated(created);
  await new Promise(resolve => setTimeout(resolve, 250));

  const afterCreate = updates[updates.length - 1];
  assert.ok(afterCreate, 'panel state must be emitted when no filter is active');
  assert.equal(afterCreate.state.active, false);
  assert.equal(afterCreate.state.total, 3);

  fake.removeTab(created.id);
  controller.handleTabRemoved(created.id, { windowId: 1 });
  await new Promise(resolve => setTimeout(resolve, 250));

  const afterRemove = updates[updates.length - 1];
  assert.equal(afterRemove.state.total, 2);

  controller.dispose();
});

test('native filter - new tabs are filtered automatically', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });

  await controller.setQuery(1, 'github');
  const created = fake.addTab({ windowId: 1, title: 'Reddit', url: 'https://reddit.com/', active: false });
  controller.handleTabCreated(created);
  await controller.flush();

  assert.equal(fake.tabs.find(tab => tab.id === created.id).hidden, true);

  controller.dispose();
});

test('native filter - title and URL changes are re-evaluated', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const tab = fake.addTab({ windowId: 1, title: 'Reddit', url: 'https://reddit.com/' });

  await controller.setQuery(1, 'github');
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, true);

  fake.updateTab(tab.id, { title: 'GitHub Docs', url: 'https://docs.github.com/' });
  controller.handleTabUpdated(tab.id, { title: 'GitHub Docs', url: 'https://docs.github.com/' }, fake.tabs.find(item => item.id === tab.id));
  await controller.flush();

  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, false);

  controller.dispose();
});

test('native filter - two windows keep independent queries and visibility', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const win1Match = fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });
  const win1Other = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/' });
  const win2Match = fake.addTab({ windowId: 2, title: 'YouTube', url: 'https://youtube.com/' });
  const win2Other = fake.addTab({ windowId: 2, title: 'GitHub', url: 'https://github.com/' });

  await controller.setQuery(1, 'github');
  await controller.setQuery(2, 'youtube');

  assert.equal(fake.tabs.find(tab => tab.id === win1Match.id).hidden, false);
  assert.equal(fake.tabs.find(tab => tab.id === win1Other.id).hidden, true);
  assert.equal(fake.tabs.find(tab => tab.id === win2Match.id).hidden, false);
  assert.equal(fake.tabs.find(tab => tab.id === win2Other.id).hidden, true);

  await controller.clearWindow(1, { reason: 'test' });

  assert.equal(fake.tabs.find(tab => tab.id === win1Other.id).hidden, false);
  assert.equal(fake.tabs.find(tab => tab.id === win2Other.id).hidden, true);

  controller.dispose();
});

test('native filter - tabs Firefox refuses to hide are reported, not retried forever', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const blocked = fake.addTab({ windowId: 1, title: 'Camera call', url: 'https://meet.example/' });
  fake.unsupported.add(blocked.id);
  fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });

  await controller.setQuery(1, 'github');
  const state = await controller.getPanelState(1);
  assert.equal(state.blockedUnsupported, 1);
  assert.equal(fake.tabs.find(tab => tab.id === blocked.id).hidden, false);

  await controller.clearWindow(1, { reason: 'test' });
  assert.equal(fake.tabs.find(tab => tab.id === blocked.id).hidden, false);

  controller.dispose();
});

test('native filter - externally shown tabs are released and not fought over', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const tab = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/' });
  fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });

  await controller.setQuery(1, 'github');
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, true);
  const hideCallsBefore = fake.calls.hide.length;

  // Simulate another extension showing the tab outside our apply window.
  const session = controller._test.sessions.get(1);
  session.recentlyChanged.clear();
  fake.updateTab(tab.id, { hidden: false });
  controller.handleTabUpdated(tab.id, { hidden: false }, fake.tabs.find(item => item.id === tab.id));
  await controller.flush();

  assert.equal(fake.calls.hide.length, hideCallsBefore, 'must not re-hide an externally shown tab');
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, false);

  await controller.clearWindow(1, { reason: 'test' });
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, false);

  controller.dispose();
});

test('native filter - closed tabs are removed from ownership safely', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const tab = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/' });
  fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });

  await controller.setQuery(1, 'github');
  fake.removeTab(tab.id);
  controller.handleTabRemoved(tab.id, { windowId: 1 });
  await controller.flush();

  await controller.clearWindow(1, { reason: 'test' });
  assert.equal(controller.getSessionCount(), 0);

  controller.dispose();
});

test('native filter - rehydrates memory-only session state after a background restart', async () => {
  const fake = createFakeBrowser();
  const first = createController(fake);
  const origin = fake.addTab({ windowId: 1, title: 'Reddit', url: 'https://reddit.com/', active: true });
  const tab = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/' });
  const github = fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });

  await first.controller.setQuery(1, 'github');
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, true);

  fake.setActive(1, github.id);
  first.controller.handleTabActivated({ tabId: github.id, windowId: 1 });
  await first.controller.flush();
  assert.equal(fake.tabs.find(item => item.id === origin.id).hidden, false);
  await new Promise(resolve => setTimeout(resolve, 250));

  const second = createController(fake);
  await second.controller.rehydrate();
  await second.controller.flush();

  const state = await second.controller.getPanelState(1);
  assert.equal(state.active, true);
  assert.equal(state.query, 'github');
  assert.equal(state.hiddenByFilter, 1);
  assert.equal(state.protectedCount, 1);
  assert.equal(fake.tabs.find(item => item.id === origin.id).hidden, false);

  await second.controller.clearWindow(1, { reason: 'test' });
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, false);
  assert.equal(fake.tabs.find(item => item.id === origin.id).hidden, false);

  first.controller.dispose();
  second.controller.dispose();
});

test('native filter - moving an owned tab to another window still restores it on clear', async () => {
  const fake = createFakeBrowser();
  const { controller } = createController(fake);
  const tab = fake.addTab({ windowId: 1, title: 'YouTube', url: 'https://youtube.com/' });
  fake.addTab({ windowId: 1, title: 'GitHub', url: 'https://github.com/' });

  await controller.setQuery(1, 'github');
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, true);

  fake.moveTab(tab.id, 2);
  controller.handleTabAttached(tab.id, { newWindowId: 2, newPosition: 0 });
  controller.handleTabDetached(tab.id, { oldWindowId: 1, oldPosition: 0 });
  await controller.flush();

  await controller.clearWindow(1, { reason: 'test' });
  assert.equal(fake.tabs.find(item => item.id === tab.id).hidden, false);

  controller.dispose();
});
