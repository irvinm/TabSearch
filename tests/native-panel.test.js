const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reads a project file as UTF-8.
 *
 * @param {string} relativePath - Path relative to the repository root.
 * @returns {string} File contents.
 */
function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

/**
 * Returns true when a relative project file exists.
 *
 * @param {string} relativePath - Path relative to the repository root.
 * @returns {boolean} True when present.
 */
function exists(relativePath) {
  return fs.existsSync(path.resolve(__dirname, '..', relativePath));
}

test('native panel - manifest loads the filter engine before background.js', () => {
  const manifest = JSON.parse(read('src/manifest.json'));
  const scripts = manifest.background.scripts;
  const engineIndex = scripts.indexOf('native-filter.js');
  const backgroundIndex = scripts.indexOf('background.js');

  assert.ok(engineIndex >= 0, 'native-filter.js must be a background script');
  assert.ok(backgroundIndex > engineIndex, 'native-filter.js must load before background.js');
});

test('native panel - integration version matches the extension manifest', () => {
  const manifest = JSON.parse(read('src/manifest.json'));
  const source = read('integration/firefox/tabsearch-native-tabs.js');
  const escaped = manifest.version.replace(/\./g, '\\.');
  assert.match(source, new RegExp(`const VERSION = '${escaped}'`));
});

test('native panel - manifest exposes the configurable focus command', () => {
  const manifest = JSON.parse(read('src/manifest.json'));
  const command = manifest.commands['focus-native-tab-search'];

  assert.ok(command, 'focus-native-tab-search command must exist');
  assert.match(command.suggested_key.default, /Ctrl\+Alt\+F/);
  assert.match(command.description, /vertical tabs/i);
});

test('native panel - HTML includes the field, clear control, counter and collapsed icon', () => {
  const html = read('src/vtab-search.html');

  assert.match(html, /<html lang="en">/);
  assert.match(html, /placeholder="Search tabs\.\.\."/);
  assert.match(html, /id="tab-search-input"/);
  assert.match(html, /id="clear-button"/);
  assert.match(html, /id="result-count"/);
  assert.match(html, /id="blocked-note"/);
  assert.match(html, /id="expand-button"/);
  assert.match(html, /vtab-search\.css/);
  assert.match(html, /vtab-search\.js/);
});

test('native panel - script is CSP-safe and implements required keyboard behavior', () => {
  const source = read('src/vtab-search.js');

  assert.doesNotMatch(source, /\.innerHTML\s*=/, 'must not assign innerHTML');
  assert.doesNotMatch(source, /\beval\s*\(/, 'must not use eval');
  assert.doesNotMatch(source, /new\s+Function\s*\(/, 'must not use new Function');
  assert.match(source, /native-tab-filter-panel/);
  assert.match(source, /Escape/);
  assert.match(source, /ctrlKey/);
  assert.match(source, /toLowerCase\(\) === 'a'/);
  assert.match(source, /TabSearch:/);
  assert.match(source, /requestFocus/);
  assert.match(source, /protectedCount/);
  assert.match(source, /kept for return/);
});

test('native panel - privileged integration targets the real vertical tabs container', () => {
  const source = read('integration/firefox/tabsearch-native-tabs.js');

  assert.match(source, /#vertical-tabs/);
  assert.match(source, /#tabbrowser-tabs/);
  assert.match(source, /webextension-view-type/);
  assert.match(source, /remoteType/);
  assert.match(source, /extension-browser-inserted/);
  assert.match(source, /pagetitlechanged/);
  assert.match(source, /SidebarController/);
  assert.match(source, /hasVerticalTabsDom/);
  assert.doesNotMatch(source, /toggleAttribute\('collapsed'/, 'bare collapsed triggers XUL visibility:collapse');
  assert.match(source, /data-collapsed/);
  assert.match(source, /state\.launcherExpanded = true/);
  assert.match(source, /host\.isConnected/, 'must recover when the sidebar DOM is rebuilt');
  assert.doesNotMatch(source, /\beval\s*\(/, 'must not use eval');
  assert.doesNotMatch(source, /new\s+Function\s*\(/, 'must not use new Function');
});

test('native panel - collapsed mode uses ID specificity for the expanded panel', () => {
  const css = read('src/vtab-search.css');
  assert.match(css, /@media \(max-width: 110px\)/);
  assert.match(css, /#expanded-panel\s*\{\s*display:\s*none/);
});

test('native panel - field matches Firefox tab pill radius and spacing', () => {
  const css = read('src/vtab-search.css');
  const integration = read('integration/firefox/tabsearch-native-tabs.js');

  assert.match(css, /border-radius:\s*24px/, 'field must match --tab-border-radius');
  assert.match(css, /height:\s*32px/);
  assert.match(css, /gap:\s*8px/);
  assert.match(integration, /EXPANDED_HEIGHT = 64/);
});

test('native panel - focus command uses the port instead of relying on a sendMessage reply', () => {
  const background = read('src/background.js');
  const page = read('src/vtab-search.js');

  assert.match(background, /panelPort\.postMessage\(\{ type: 'focus' \}\)/);
  assert.match(page, /message\.type === 'focus'/);
});

test('native panel - autoconfig file is self-contained and loads no remote code', () => {
  const source = read('integration/firefox/config.js');
  const prefs = read('integration/firefox/autoconfig-prefs.js');

  assert.match(source, /var TabSearchNativeTabs =/);
  assert.match(source, /TabSearchNativeTabs\.init\(\)/);
  assert.match(source, /browser-delayed-startup-finished/);
  assert.doesNotMatch(source, /scriptloader\.loadSubScript/, 'must not load untrusted file subscripts');
  assert.doesNotMatch(
    source,
    /\b(fetch|XMLHttpRequest|importScripts)\s*\(/,
    'autoconfig loader must not fetch remote code'
  );
  assert.match(prefs, /general\.config\.filename/);
  assert.match(prefs, /tabsearch-autoconfig\.cfg/);
});

test('native panel - integration package includes install and uninstall instructions', () => {
  assert.ok(exists('integration/firefox/install.cmd'));
  assert.ok(exists('integration/firefox/install.ps1'));
  assert.ok(exists('integration/firefox/uninstall.ps1'));
  assert.ok(exists('integration/firefox/README.md'));

  const readme = read('integration/firefox/README.md');
  assert.match(readme, /install\.cmd/i);
  assert.match(readme, /install\.ps1/i);
  assert.match(readme, /uninstall\.ps1/i);
});
