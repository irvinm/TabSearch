const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'search-results.js'),
  'utf8'
);

function loadDashboard(options = {}) {
  const calls = {
    find: [],
    messages: [],
    removed: [],
    tabUpdates: [],
    windowUpdates: []
  };
  const browser = {
    find: {
      find: async (term, findOptions) => {
        calls.find.push([term, findOptions]);
        return options.find ? options.find(term, findOptions) : { count: 0 };
      }
    },
    runtime: options.runtime === false ? {} : {
      sendMessage: async (message) => {
        calls.messages.push(message);
      }
    },
    storage: {
      local: {
        get: async () => options.storedOptions || {},
        set: async () => {}
      }
    },
    tabs: {
      getCurrent: async () => options.currentTab === undefined ? { id: 99, windowId: 1 } : options.currentTab,
      query: async () => options.tabs || [],
      remove: async (tabId) => { calls.removed.push(tabId); },
      update: async (tabId, updateProperties) => {
        calls.tabUpdates.push([tabId, updateProperties]);
      }
    },
    windows: {
      getCurrent: async () => ({ id: options.activeWindowId || 1 }),
      update: async (windowId, updateProperties) => {
        calls.windowUpdates.push([windowId, updateProperties]);
      }
    }
  };

  const context = vm.createContext({
    browser,
    clearTimeout,
    console: { error() {}, log() {}, warn() {} },
    module: { exports: {} },
    setTimeout
  });
  vm.runInContext(DASHBOARD_SOURCE, context, { filename: 'search-results.js' });
  return { calls, context };
}

function dashboardFunction(context, functionName) {
  return vm.runInContext(functionName, context);
}

function dashboardState(context) {
  return JSON.parse(vm.runInContext(
    'JSON.stringify({ allTabs, matchedTabs, keepDashboardOpen, searchUrls, searchTitles, searchContents, fuzzySearch, fuzzyThreshold, collapsedWindows: Array.from(collapsedWindows) })',
    context
  ));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('performSearch excludes the dashboard itself and augments title matches with page-content matches', async () => {
  const tabs = [
    { id: 99, windowId: 1, title: 'Dashboard', url: 'moz-extension://tabsearch/search-results.html' },
    { id: 1, windowId: 2, title: 'Needle documentation', url: 'https://docs.example/' },
    { id: 2, windowId: 3, title: 'Unrelated', url: 'https://content.example/' },
    { id: 3, windowId: 3, title: 'Protected', url: 'about:config' }
  ];
  const { calls, context } = loadDashboard({
    activeWindowId: 3,
    tabs,
    find: async (_term, { tabId }) => ({ count: tabId === 2 ? 1 : 0 })
  });
  const renderedWindowIds = [];
  context.captureRender = (windowId) => renderedWindowIds.push(windowId);
  vm.runInContext("currentQuery = 'needle'; searchContents = true; renderResults = captureRender", context);

  await dashboardFunction(context, 'performSearch')();

  const state = dashboardState(context);
  assert.deepEqual(state.allTabs.map(tab => tab.id), [1, 2, 3]);
  assert.deepEqual(state.matchedTabs.map(tab => tab.id), [1, 2]);
  assert.deepEqual(plain(calls.find), [['needle', { tabId: 2, caseSensitive: false }]]);
  assert.deepEqual(renderedWindowIds, [3]);
});

test('performSearch does not run page-content lookups for queries shorter than three characters', async () => {
  const { calls, context } = loadDashboard({
    tabs: [{ id: 1, windowId: 1, title: 'Other', url: 'https://example.com/' }],
    currentTab: null
  });
  context.captureRender = () => {};
  vm.runInContext("currentQuery = 'ab'; searchTitles = false; searchUrls = false; searchContents = true; renderResults = captureRender", context);

  await dashboardFunction(context, 'performSearch')();

  assert.equal(calls.find.length, 0);
  assert.deepEqual(dashboardState(context).matchedTabs, []);
});

test('loadStoredOptions applies persisted booleans, threshold, keep-open, and collapsed windows', async () => {
  const { context } = loadDashboard({
    storedOptions: {
      searchUrls: false,
      searchTitles: true,
      searchContents: true,
      fuzzySearch: true,
      fuzzyThreshold: '0.62',
      keepDashboardOpen: true,
      collapsedWindows: [4, 9]
    }
  });

  await dashboardFunction(context, 'loadStoredOptions')();

  assert.deepEqual(dashboardState(context), {
    allTabs: [],
    matchedTabs: [],
    keepDashboardOpen: true,
    searchUrls: false,
    searchTitles: true,
    searchContents: true,
    fuzzySearch: true,
    fuzzyThreshold: 0.62,
    collapsedWindows: [4, 9]
  });
});

test('activateTab delegates activation and requests dashboard closure by default', async () => {
  const { calls, context } = loadDashboard();

  await dashboardFunction(context, 'activateTab')({ id: 21, windowId: 8 });

  assert.deepEqual(plain(calls.messages), [{
    action: 'activate-tab',
    tabId: 21,
    windowId: 8,
    closeDashboard: true
  }]);
  assert.equal(calls.windowUpdates.length, 0, 'background messaging owns the activation transaction');
});

test('activateTab preserves the dashboard when keep-open is enabled', async () => {
  const { calls, context } = loadDashboard();
  vm.runInContext('keepDashboardOpen = true', context);

  await dashboardFunction(context, 'activateTab')({ id: 22, windowId: 9 });

  assert.equal(calls.messages[0].closeDashboard, false);
});

test('activateTab falls back to direct Firefox APIs when runtime messaging is unavailable', async () => {
  const { calls, context } = loadDashboard({
    runtime: false,
    currentTab: { id: 99, windowId: 1 }
  });

  await dashboardFunction(context, 'activateTab')({ id: 23, windowId: 10 });

  assert.deepEqual(plain(calls.windowUpdates), [[10, { focused: true }]]);
  assert.deepEqual(plain(calls.tabUpdates), [[23, { active: true }]]);
  assert.deepEqual(calls.removed, [99]);
});
