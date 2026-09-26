const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createPinnedBadge, filterMatchingTabs } = require('../src/search-results.js');

const DASHBOARD_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'search-results.js'),
  'utf8'
);

const CSS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'common.css'),
  'utf8'
);

/**
 * Creates a mock DOM element for testing dashboard rendering.
 *
 * @param {string} tagName - Tag name of the element.
 * @returns {Object} Mock DOM element.
 */
function createMockElement(tagName) {
  const children = [];
  const eventListeners = {};
  const attributes = {};
  const classListSet = new Set();

  return {
    tagName: tagName.toUpperCase(),
    children,
    attributes,
    dataset: {},
    eventListeners,
    textContent: '',
    get innerHTML() {
      return '';
    },
    set innerHTML(val) {
      if (val === '') {
        children.length = 0;
      }
    },
    get className() {
      return Array.from(classListSet).join(' ');
    },
    set className(val) {
      classListSet.clear();
      if (val) {
        val.split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
      }
    },
    classList: {
      add(cls) { classListSet.add(cls); },
      remove(cls) { classListSet.delete(cls); },
      contains(cls) { return classListSet.has(cls); }
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
      if (name === 'class') {
        classListSet.clear();
        String(value).split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
      }
    },
    getAttribute(name) {
      return attributes[name];
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    addEventListener(event, handler) {
      if (!eventListeners[event]) {
        eventListeners[event] = [];
      }
      eventListeners[event].push(handler);
    },
    dispatchEvent(event) {
      const handlers = eventListeners[event.type] || [];
      handlers.forEach(h => h(event));
    },
    querySelector(selector) {
      const match = (el) => {
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) {
          return true;
        }
        return false;
      };
      for (const child of children) {
        if (match(child)) return child;
        if (child.querySelector) {
          const found = child.querySelector(selector);
          if (found) return found;
        }
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      const traverse = (el) => {
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) {
          results.push(el);
        }
        (el.children || []).forEach(traverse);
      };
      traverse(this);
      return results;
    }
  };
}

/**
 * Helper to load search-results.js inside a simulated DOM context.
 *
 * @param {Object} [overrides={}] - Optional context overrides.
 * @returns {{context: Object, container: Object, totalSummaryBadge: Object}} VM context and elements.
 */
function setupDashboardDom(overrides = {}) {
  const container = createMockElement('div');
  container.id = 'results-container';

  const totalSummaryBadge = createMockElement('span');
  totalSummaryBadge.id = 'total-summary-badge';

  const mockDocument = {
    addEventListener() {},
    getElementById(id) {
      if (id === 'results-container') return container;
      if (id === 'total-summary-badge') return totalSummaryBadge;
      return null;
    },
    createElement(tag) {
      return createMockElement(tag);
    },
    createElementNS(ns, tag) {
      return createMockElement(tag);
    },
    querySelectorAll() {
      return [];
    }
  };

  const browser = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    },
    tabs: {},
    windows: {}
  };

  const context = vm.createContext({
    browser,
    document: mockDocument,
    console: { log() {}, warn() {}, error() {} },
    clearTimeout,
    setTimeout,
    module: { exports: {} },
    ...overrides
  });

  vm.runInContext(DASHBOARD_SOURCE, context, { filename: 'search-results.js' });
  return { context, container, totalSummaryBadge };
}

test('createPinnedBadge generates a complete, accessible badge element', () => {
  const mockDoc = {
    createElement(tag) { return createMockElement(tag); },
    createElementNS(ns, tag) { return createMockElement(tag); }
  };
  const badge = createPinnedBadge(mockDoc);
  assert.ok(badge, 'Badge element must be created');
  assert.equal(badge.classList.contains('tab-pinned-badge'), true);
  assert.equal(badge.getAttribute('title'), 'Pinned tab');
  assert.equal(badge.getAttribute('aria-label'), 'Pinned tab');

  const svg = badge.children.find(c => c.tagName === 'SVG');
  assert.ok(svg, 'SVG icon must exist inside pinned badge');
  assert.equal(svg.classList.contains('tab-pinned-icon'), true);
  assert.equal(svg.getAttribute('aria-hidden'), 'true');

  const textSpan = badge.children.find(c => c.classList.contains('tab-pinned-text'));
  assert.ok(textSpan, 'Text element must exist inside pinned badge');
  assert.equal(textSpan.textContent, 'Pinned');
});

test('renderResults visually distinguishes pinned tabs from unpinned tabs', () => {
  const { context, container } = setupDashboardDom();

  const allTabs = [
    { id: 1, windowId: 10, title: 'Pinned Search Tab', url: 'https://example.com/pinned', pinned: true },
    { id: 2, windowId: 10, title: 'Regular Tab', url: 'https://example.com/regular', pinned: false }
  ];
  const matchedTabs = [...allTabs];

  context.testTabs = allTabs;
  context.testMatches = matchedTabs;
  vm.runInContext('allTabs = testTabs; matchedTabs = testMatches; renderResults(10);', context);

  const tabItems = container.querySelectorAll('.tab-result-item');
  assert.equal(tabItems.length, 2, 'Should render 2 tab items');

  // First tab is pinned
  const pinnedItem = tabItems[0];
  assert.equal(pinnedItem.classList.contains('pinned'), true, 'Pinned tab must have .pinned class');
  const pinnedBadge = pinnedItem.querySelector('.tab-pinned-badge');
  assert.ok(pinnedBadge, 'Pinned tab must contain .tab-pinned-badge');

  // Second tab is unpinned
  const regularItem = tabItems[1];
  assert.equal(regularItem.classList.contains('pinned'), false, 'Unpinned tab must NOT have .pinned class');
  const regularBadge = regularItem.querySelector('.tab-pinned-badge');
  assert.equal(regularBadge, null, 'Unpinned tab must NOT contain .tab-pinned-badge');
});

test('filterMatchingTabs includes matching pinned tabs in search results', () => {
  const tabs = [
    { id: 1, title: 'GitHub Dashboard', url: 'https://github.com', pinned: true },
    { id: 2, title: 'Bug Tracker', url: 'https://bugzilla.mozilla.org', pinned: true },
    { id: 3, title: 'Mozilla Developer Network', url: 'https://developer.mozilla.org', pinned: false }
  ];

  // Search matching both pinned and unpinned tabs
  const resultsMozilla = filterMatchingTabs(tabs, 'mozilla', { searchUrls: true, searchTitles: true });
  assert.equal(resultsMozilla.length, 2);
  assert.deepEqual(resultsMozilla.map(t => t.id), [2, 3]);
  assert.equal(resultsMozilla[0].pinned, true);
  assert.equal(resultsMozilla[1].pinned, false);

  // Search matching only a pinned tab
  const resultsGithub = filterMatchingTabs(tabs, 'github', { searchUrls: true, searchTitles: true });
  assert.equal(resultsGithub.length, 1);
  assert.equal(resultsGithub[0].id, 1);
  assert.equal(resultsGithub[0].pinned, true);
});

test('common.css defines styling for pinned badges and dark mode', () => {
  assert.match(CSS_SOURCE, /\.tab-pinned-badge\s*\{/);
  assert.match(CSS_SOURCE, /\.tab-pinned-icon\s*\{/);
  assert.match(CSS_SOURCE, /@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?\.tab-pinned-badge/);
});
