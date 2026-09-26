const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'search-results.js'),
  'utf8'
);

const CSS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'common.css'),
  'utf8'
);

const HTML_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'search-results.html'),
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
 * @returns {{context: Object, container: Object}} VM context and results container element.
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

test('renderResults outputs window-badge with count and window-toggle-icon with carat', () => {
  const { context, container, totalSummaryBadge } = setupDashboardDom();

  // Set up mock allTabs and matchedTabs
  const allTabs = [
    { id: 1, windowId: 10, title: 'Tab 1' },
    { id: 2, windowId: 10, title: 'Tab 2' },
    { id: 3, windowId: 10, title: 'Tab 3' },
    { id: 4, windowId: 20, title: 'Tab 4' }
  ];
  const matchedTabs = [
    { id: 1, windowId: 10, title: 'Tab 1' },
    { id: 4, windowId: 20, title: 'Tab 4' }
  ];

  context.testTabs = allTabs;
  context.testMatches = matchedTabs;
  vm.runInContext('allTabs = testTabs; matchedTabs = testMatches; renderResults(10);', context);

  // Assert sections created
  assert.equal(container.children.length, 2);

  const firstSection = container.children[0];
  assert.equal(firstSection.classList.contains('window-section'), true);

  const header = firstSection.children.find(c => c.classList.contains('window-header'));
  assert.ok(header, 'window-header element must exist');

  const titleSpan = header.children.find(c => c.classList.contains('window-title'));
  assert.ok(titleSpan, 'window-title element must exist');

  const windowName = titleSpan.children.find(c => c.classList.contains('window-name'));
  assert.ok(windowName, 'window-name element must exist');
  assert.equal(windowName.textContent, 'Window 1');

  const badge = titleSpan.children.find(c => c.classList.contains('window-badge'));
  assert.ok(badge, 'window-badge element must exist inside window-title');
  assert.equal(badge.textContent, '1 / 3 tabs');

  const toggleIcon = header.children.find(c => c.classList.contains('window-toggle-icon'));
  assert.ok(toggleIcon, 'window-toggle-icon element must exist inside window-header');
  assert.equal(toggleIcon.textContent, '▼');

  // Verify total summary badge under the search bar
  assert.equal(totalSummaryBadge.textContent, '2 / 4 tabs');
});

test('renderResults updates total-summary-badge correctly when 0 matches found', () => {
  const { context, totalSummaryBadge } = setupDashboardDom();

  const allTabs = [
    { id: 1, windowId: 10, title: 'Tab 1' },
    { id: 2, windowId: 10, title: 'Tab 2' }
  ];
  const matchedTabs = [];

  context.testTabs = allTabs;
  context.testMatches = matchedTabs;
  vm.runInContext('allTabs = testTabs; matchedTabs = testMatches; renderResults(10);', context);

  assert.equal(totalSummaryBadge.textContent, '0 / 2 tabs');
});

test('window-header click toggles section collapsed class and aria-expanded', () => {
  const { context, container } = setupDashboardDom();

  const allTabs = [{ id: 1, windowId: 10, title: 'Tab 1' }];
  const matchedTabs = [{ id: 1, windowId: 10, title: 'Tab 1' }];

  context.testTabs = allTabs;
  context.testMatches = matchedTabs;
  vm.runInContext('allTabs = testTabs; matchedTabs = testMatches; renderResults(10);', context);

  const section = container.children[0];
  const header = section.children.find(c => c.classList.contains('window-header'));

  // Initially expanded
  assert.equal(section.classList.contains('collapsed'), false);
  assert.equal(header.getAttribute('aria-expanded'), 'true');

  // Click to collapse
  header.dispatchEvent({ type: 'click' });
  assert.equal(section.classList.contains('collapsed'), true);
  assert.equal(header.getAttribute('aria-expanded'), 'false');

  // Click to expand
  header.dispatchEvent({ type: 'click' });
  assert.equal(section.classList.contains('collapsed'), false);
  assert.equal(header.getAttribute('aria-expanded'), 'true');
});

test('common.css and search-results.html define total-summary badge and styling under search bar', () => {
  assert.match(HTML_SOURCE, /id="total-summary"/);
  assert.match(HTML_SOURCE, /id="total-summary-badge"/);
  assert.match(CSS_SOURCE, /\.dashboard-search-area\s*\{[^}]*display:\s*flex/);
  assert.match(CSS_SOURCE, /\.dashboard-total-summary\s*\{[^}]*display:\s*flex/);
  assert.match(CSS_SOURCE, /\.window-badge\s*\{[^}]*display:\s*inline-block/);
  assert.match(CSS_SOURCE, /\.window-badge\s*\{[^}]*background:\s*var\(--dash-badge-bg,\s*var\(--dash-primary\)\)/);
  assert.match(CSS_SOURCE, /--dash-badge-bg:\s*#2366d1;/);
  assert.match(CSS_SOURCE, /\.window-toggle-icon[^{]*\{[^}]*display:\s*inline-block/);
  assert.match(CSS_SOURCE, /\.window-toggle-icon[^{]*\{[^}]*transition:\s*transform/);
  assert.match(CSS_SOURCE, /\.window-section\.collapsed\s+\.window-toggle-icon[^{]*\{[^}]*transform:\s*rotate\(-90deg\)/);
});
