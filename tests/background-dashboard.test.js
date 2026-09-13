const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BACKGROUND_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'background.js'),
  'utf8'
);

function createEvent() {
  let listener;
  return {
    addListener(callback) {
      listener = callback;
    },
    get listener() {
      return listener;
    }
  };
}

function loadBackground(options = {}) {
  const calls = {
    created: [],
    hidden: [],
    removed: [],
    sentMessages: [],
    shown: [],
    stored: [],
    tabUpdates: [],
    windowUpdates: []
  };
  const events = {
    message: createEvent(),
    tabActivated: createEvent(),
    tabRemoved: createEvent(),
    windowFocusChanged: createEvent()
  };

  const storageGet = async (keys) => {
    if (keys.length === 1 && keys[0] === 'virtualDashboard') {
      return { virtualDashboard: true };
    }
    return options.storageGet ? options.storageGet(keys) : {};
  };

  const browser = {
    runtime: {
      getURL: (resource = '') => `moz-extension://tabsearch/${resource}`,
      onMessage: events.message,
      sendMessage: async (...args) => {
        calls.sentMessages.push(args);
        if (options.sendMessage) return options.sendMessage(...args);
        return undefined;
      }
    },
    storage: {
      local: {
        get: storageGet,
        set: async (value) => {
          calls.stored.push(value);
        }
      }
    },
    tabs: {
      create: async (createProperties) => {
        calls.created.push(createProperties);
        if (options.createTab) return options.createTab(createProperties);
        return { id: 50, windowId: createProperties.windowId, ...createProperties };
      },
      get: async (tabId) => {
        if (options.getTab) return options.getTab(tabId);
        return { id: tabId, windowId: 7 };
      },
      hide: async (tabIds) => {
        calls.hidden.push(tabIds);
        if (options.hideTabs) return options.hideTabs(tabIds);
        return undefined;
      },
      onActivated: events.tabActivated,
      onRemoved: events.tabRemoved,
      query: async (queryInfo) => {
        if (options.queryTabs) return options.queryTabs(queryInfo);
        return [];
      },
      remove: async (tabId) => {
        calls.removed.push(tabId);
      },
      show: async (tabIds) => {
        calls.shown.push(tabIds);
      },
      update: async (tabId, updateProperties) => {
        calls.tabUpdates.push([tabId, updateProperties]);
        return { id: tabId, ...updateProperties };
      }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getCurrent: async () => ({ id: 7 }),
      getLastFocused: async () => ({ id: 7 }),
      onFocusChanged: events.windowFocusChanged,
      update: async (windowId, updateProperties) => {
        calls.windowUpdates.push([windowId, updateProperties]);
        return { id: windowId, ...updateProperties };
      }
    }
  };

  const context = vm.createContext({
    browser,
    clearInterval,
    clearTimeout,
    console: { error() {}, log() {}, warn() {} },
    encodeURIComponent,
    module: { exports: {} },
    setInterval,
    setTimeout: (callback) => {
      callback();
      return 1;
    }
  });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });

  return { calls, context, events };
}

function backgroundFunction(context, functionName) {
  return vm.runInContext(functionName, context);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('handleOpenDashboard creates an encoded dashboard URL in the active window', async () => {
  const { calls, context } = loadBackground();

  await backgroundFunction(context, 'handleOpenDashboard')('release notes & tabs');

  assert.deepEqual(plain(calls.created), [{
    url: 'moz-extension://tabsearch/search-results.html?q=release%20notes%20%26%20tabs',
    active: true,
    windowId: 7
  }]);
  assert.equal(calls.sentMessages.length, 0);
});

test('handleOpenDashboard reuses its cached singleton and focuses its original window', async () => {
  const { calls, context } = loadBackground();
  const handleOpenDashboard = backgroundFunction(context, 'handleOpenDashboard');

  await handleOpenDashboard('first');
  await handleOpenDashboard('second');

  assert.equal(calls.created.length, 1, 'a second dashboard tab must not be created');
  assert.deepEqual(plain(calls.sentMessages.at(-1)), [{ action: 'update-query', query: 'second' }]);
  assert.deepEqual(plain(calls.tabUpdates.at(-1)), [50, { active: true }]);
  assert.deepEqual(plain(calls.windowUpdates.at(-1)), [7, { focused: true }]);
});

test('handleOpenDashboard discovers an existing dashboard after its cached ID is lost', async () => {
  const existingDashboard = {
    id: 81,
    windowId: 12,
    url: 'moz-extension://tabsearch/search-results.html?q=old'
  };
  const { calls, context } = loadBackground({
    queryTabs: async () => [
      { id: 1, windowId: 2, url: 'https://example.com/search-results.html' },
      existingDashboard
    ]
  });

  await backgroundFunction(context, 'handleOpenDashboard')('new query');

  assert.equal(calls.created.length, 0);
  assert.deepEqual(plain(calls.tabUpdates), [[81, { active: true }]]);
  assert.deepEqual(plain(calls.windowUpdates), [[12, { focused: true }]]);
  assert.deepEqual(plain(calls.sentMessages), [[{ action: 'update-query', query: 'new query' }]]);
});

test('handleOpenDashboard recovers from a stale cached tab ID by creating a replacement', async () => {
  const { calls, context } = loadBackground({
    getTab: async () => { throw new Error('missing tab'); }
  });
  vm.runInContext('dashboardTabId = 999', context);

  await backgroundFunction(context, 'handleOpenDashboard')('replacement');

  assert.equal(calls.created.length, 1);
  assert.match(calls.created[0].url, /\?q=replacement$/);
});

test('activate-tab message focuses and activates the target, then closes the dashboard by default', async () => {
  const { calls, context, events } = loadBackground();
  await backgroundFunction(context, 'handleOpenDashboard')('query');

  await events.message.listener({
    action: 'activate-tab',
    tabId: 91,
    windowId: 13,
    closeDashboard: true
  }, {});

  assert.deepEqual(plain(calls.windowUpdates.at(-1)), [13, { focused: true }]);
  assert.deepEqual(plain(calls.tabUpdates.at(-1)), [91, { active: true }]);
  assert.deepEqual(calls.removed, [50]);
  assert.equal(vm.runInContext('dashboardTabId', context), null);
});

test('verifyTabHidePermission uses a safe web tab and persists successful verification', async () => {
  const tabs = [
    { id: 1, active: true, pinned: false, url: 'https://active.example/' },
    { id: 2, active: false, pinned: true, url: 'https://pinned.example/' },
    { id: 3, active: false, pinned: false, url: 'moz-extension://other/page.html' },
    { id: 4, active: false, pinned: false, url: 'chrome-extension://other/page.html' },
    { id: 5, active: false, pinned: false, url: 'https://safe.example/' }
  ];
  const { calls, context } = loadBackground({ queryTabs: async () => tabs });

  const granted = await backgroundFunction(context, 'verifyTabHidePermission')(false);

  assert.equal(granted, true);
  assert.deepEqual(plain(calls.hidden), [[5]]);
  assert.deepEqual(plain(calls.shown), [[5]], 'an existing tab must be restored after probing');
  assert.deepEqual(plain(calls.stored), [{ tabHideConfirmed: true }]);
  assert.equal(calls.created.length, 0);
});

test('verifyTabHidePermission creates and removes a temporary tab when no safe tab exists', async () => {
  const { calls, context } = loadBackground({
    queryTabs: async () => [
      { id: 1, active: true, pinned: false, url: 'https://active.example/' },
      { id: 2, active: false, pinned: false, url: 'moz-extension://tabsearch/popup.html' }
    ],
    createTab: async (createProperties) => ({ id: 44, windowId: 7, ...createProperties })
  });

  const granted = await backgroundFunction(context, 'verifyTabHidePermission')(false);

  assert.equal(granted, true);
  assert.deepEqual(plain(calls.created), [{ active: false, windowId: 7 }]);
  assert.deepEqual(plain(calls.hidden), [[44]]);
  assert.deepEqual(calls.removed, [44]);
  assert.equal(calls.shown.length, 0, 'temporary tabs should be removed instead of shown');
});

test('verifyTabHidePermission records a failed probe and cleans up its temporary tab', async () => {
  const { calls, context } = loadBackground({
    queryTabs: async () => [
      { id: 1, active: true, pinned: false, url: 'https://active.example/' }
    ],
    createTab: async (createProperties) => ({ id: 45, windowId: 7, ...createProperties }),
    hideTabs: async () => { throw new Error('permission denied'); }
  });

  const granted = await backgroundFunction(context, 'verifyTabHidePermission')(true);

  assert.equal(granted, false);
  assert.deepEqual(plain(calls.stored), [{ tabHideConfirmed: false }]);
  assert.deepEqual(calls.removed, [45]);
});

test('verifyTabHidePermission honors cached success and the user opt-out without probing tabs', async () => {
  const cached = loadBackground({
    storageGet: async () => ({ tabHideConfirmed: true, disableEmptyTab: false })
  });
  const optedOut = loadBackground({
    storageGet: async () => ({ tabHideConfirmed: false, disableEmptyTab: true })
  });

  assert.equal(await backgroundFunction(cached.context, 'verifyTabHidePermission')(false), true);
  assert.equal(await backgroundFunction(optedOut.context, 'verifyTabHidePermission')(false), false);
  assert.equal(cached.calls.hidden.length, 0);
  assert.equal(optedOut.calls.hidden.length, 0);
});
