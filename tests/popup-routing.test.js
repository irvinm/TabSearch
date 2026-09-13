const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const POPUP_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'popup.js'),
  'utf8'
);

function loadPopup(values = {}) {
  const messages = [];
  let closeCount = 0;
  const elements = new Map();

  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        addEventListener() {},
        checked: false,
        value: '',
        ...values[id]
      });
    }
    return elements.get(id);
  };

  const context = vm.createContext({
    browser: {
      runtime: {
        sendMessage(message) {
          messages.push(message);
          return Promise.resolve();
        }
      }
    },
    console: { error() {}, log() {}, warn() {} },
    document: {
      addEventListener() {},
      getElementById: element
    },
    MutationObserver: class {},
    setTimeout,
    clearTimeout,
    window: {
      addEventListener() {},
      close() { closeCount++; }
    }
  });
  vm.runInContext(POPUP_SOURCE, context, { filename: 'popup.js' });
  return {
    closeCount: () => closeCount,
    doSearch: vm.runInContext('doSearch', context),
    messages
  };
}

function searchControls(overrides = {}) {
  return {
    search: { value: '  release notes  ' },
    'search-urls': { checked: true },
    'search-titles': { checked: true },
    'search-contents': { checked: false },
    'realtime-search': { checked: false },
    'fuzzy-search': { checked: true },
    'fuzzy-threshold': { value: '0.42' },
    'virtual-dashboard': { checked: false },
    ...overrides
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('doSearch routes virtual-dashboard searches to the singleton dashboard and closes the popup', () => {
  const popup = loadPopup(searchControls({
    'virtual-dashboard': { checked: true }
  }));

  popup.doSearch();

  assert.deepEqual(plain(popup.messages), [{ action: 'open-dashboard', query: 'release notes' }]);
  assert.equal(popup.closeCount(), 1);
});

test('doSearch preserves the traditional search contract when virtual mode is disabled', () => {
  const popup = loadPopup(searchControls());

  popup.doSearch();

  assert.deepEqual(plain(popup.messages), [{
    action: 'search-tabs',
    term: 'release notes',
    searchUrls: true,
    searchTitles: true,
    searchContents: false,
    fuzzySearch: true,
    fuzzyThreshold: 0.42
  }]);
  assert.equal(popup.closeCount(), 0);
});

test('doSearch does nothing when every search scope is disabled', () => {
  const popup = loadPopup(searchControls({
    'search-urls': { checked: false },
    'search-titles': { checked: false },
    'search-contents': { checked: false },
    'virtual-dashboard': { checked: true }
  }));

  popup.doSearch();

  assert.deepEqual(popup.messages, []);
  assert.equal(popup.closeCount(), 0);
});

test('doSearch skips a blank traditional query unless real-time search is enabled', () => {
  const idlePopup = loadPopup(searchControls({ search: { value: '   ' } }));
  const realtimePopup = loadPopup(searchControls({
    search: { value: '   ' },
    'realtime-search': { checked: true }
  }));

  idlePopup.doSearch();
  realtimePopup.doSearch();

  assert.deepEqual(idlePopup.messages, []);
  assert.equal(realtimePopup.messages.length, 1);
  assert.equal(realtimePopup.messages[0].action, 'search-tabs');
  assert.equal(realtimePopup.messages[0].term, '');
});
