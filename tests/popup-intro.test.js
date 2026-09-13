const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const POPUP_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'popup.js'),
  'utf8'
);

/**
 * Helper to create a test harness for popup.js DOMContentLoaded and storage handling.
 *
 * @param {Object} [initialStorage={}] - Initial stored preferences.
 * @returns {Object} Test harness containing DOM elements, storage, messages, and dispatchers.
 */
function createPopupTestHarness(initialStorage = {}) {
  const messages = [];
  const storedData = { ...initialStorage };
  const elements = new Map();
  const listeners = new Map();

  const getOrCreateElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        hidden: false,
        disabled: false,
        value: '',
        checked: false,
        tabIndex: 0,
        offsetParent: {},
        closest() {
          return {
            classList: {
              add() {},
              remove() {}
            }
          };
        },
        eventListeners: {},
        addEventListener(event, handler) {
          if (!this.eventListeners[event]) this.eventListeners[event] = [];
          this.eventListeners[event].push(handler);
        },
        click() {
          if (this.eventListeners.click) {
            this.eventListeners.click.forEach(h => h({ preventDefault() {} }));
          }
        },
        focus() {
          this.isFocused = true;
        },
        select() {}
      });
    }
    return elements.get(id);
  };

  // Pre-seed known elements
  const introScreen = getOrCreateElement('intro-screen');
  introScreen.hidden = true;
  const searchForm = getOrCreateElement('search-form');
  searchForm.hidden = false;
  getOrCreateElement('intro-enable-btn');
  getOrCreateElement('search');
  getOrCreateElement('search-btn');
  getOrCreateElement('audio-search-btn');
  getOrCreateElement('search-urls');
  getOrCreateElement('search-titles');
  getOrCreateElement('search-contents');
  getOrCreateElement('realtime-search');
  getOrCreateElement('fuzzy-search');
  getOrCreateElement('fuzzy-threshold');
  getOrCreateElement('threshold-row');
  getOrCreateElement('threshold-value');
  getOrCreateElement('select-matching-tabs');
  getOrCreateElement('disable-empty-tab');
  getOrCreateElement('tst-support');
  getOrCreateElement('tst-auto-expand');
  getOrCreateElement('tst-auto-expand-row');
  getOrCreateElement('virtual-dashboard');

  let closeCount = 0;

  const context = vm.createContext({
    browser: {
      runtime: {
        sendMessage(message) {
          messages.push(message);
          return Promise.resolve();
        }
      },
      storage: {
        local: {
          get(keys) {
            const result = {};
            const keyList = Array.isArray(keys) ? keys : [keys];
            for (const k of keyList) {
              if (storedData[k] !== undefined) {
                result[k] = storedData[k];
              }
            }
            return Promise.resolve(result);
          },
          set(values) {
            Object.assign(storedData, values);
            return Promise.resolve();
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    },
    console: { error() {}, log() {}, warn() {} },
    document: {
      addEventListener(event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      getElementById: getOrCreateElement,
      body: { appendChild() {} },
      activeElement: null
    },
    window: {
      addEventListener(event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      close() {
        closeCount++;
      }
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => fn(),
    parseFloat,
    Date
  });

  vm.runInContext(POPUP_SOURCE, context, { filename: 'popup.js' });

  return {
    closeCount: () => closeCount,
    dispatchDomContentLoaded: async () => {
      const domHandlers = listeners.get('DOMContentLoaded') || [];
      for (const h of domHandlers) {
        h();
      }
      await new Promise(resolve => setImmediate(resolve));
    },
    elements,
    getElement: getOrCreateElement,
    messages,
    storedData
  };
}

test('popup renders intro screen and hides search form when hasCompletedIntroPrompt is not set', async () => {
  const harness = createPopupTestHarness({});
  await harness.dispatchDomContentLoaded();

  const introScreen = harness.getElement('intro-screen');
  const searchForm = harness.getElement('search-form');

  assert.equal(introScreen.hidden, false, 'intro screen must be visible');
  assert.equal(searchForm.hidden, true, 'search form must be hidden');
});

test('popup renders search form directly when hasCompletedIntroPrompt is true', async () => {
  const harness = createPopupTestHarness({ hasCompletedIntroPrompt: true });
  await harness.dispatchDomContentLoaded();

  const introScreen = harness.getElement('intro-screen');
  const searchForm = harness.getElement('search-form');

  assert.equal(introScreen.hidden, true, 'intro screen must be hidden');
  assert.equal(searchForm.hidden, false, 'search form must be visible');
});

test('clicking enable tab hiding button prompts tab-hide, saves hasCompletedIntroPrompt, and dismisses popup without showing search form', async () => {
  const harness = createPopupTestHarness({});
  await harness.dispatchDomContentLoaded();

  const introScreen = harness.getElement('intro-screen');
  const searchForm = harness.getElement('search-form');
  const enableBtn = harness.getElement('intro-enable-btn');

  assert.equal(introScreen.hidden, false);
  assert.equal(searchForm.hidden, true);

  enableBtn.click();

  // Storage must be updated
  assert.equal(harness.storedData.hasCompletedIntroPrompt, true);

  // Initial tab-hide message must be sent with force: true
  const triggerMsg = harness.messages.find(m => m.action === 'trigger-initial-hide');
  assert.ok(triggerMsg, 'trigger-initial-hide message must be dispatched');
  assert.equal(triggerMsg.force, true);

  // Popup must be dismissed immediately so it never sits on top of the doorhanger
  assert.equal(harness.closeCount(), 1);
  assert.equal(searchForm.hidden, true);
});
