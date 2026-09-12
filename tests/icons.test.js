const test = require('node:test');
const assert = require('node:assert/strict');
const { getTabFaviconUrl } = require('../src/search-results.js');

test('getTabFaviconUrl - null or undefined tab', () => {
  assert.equal(getTabFaviconUrl(null), 'images/firefox.svg');
  assert.equal(getTabFaviconUrl(undefined), 'images/firefox.svg');
  assert.equal(getTabFaviconUrl({ url: '' }), 'images/firefox.svg');
});

test('getTabFaviconUrl - native Firefox internal pages', () => {
  assert.equal(getTabFaviconUrl({ url: 'about:blank' }), 'images/firefox.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:newtab' }), 'images/firefox.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:home' }), 'images/firefox.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:welcome' }), 'images/firefox.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:addons' }), 'images/addon.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:preferences' }), 'images/settings.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:config' }), 'images/settings.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:downloads' }), 'images/downloads.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:history' }), 'images/history.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:bookmarks' }), 'images/bookmark.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:debugging' }), 'images/developer.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:devtools' }), 'images/developer.svg');
  assert.equal(getTabFaviconUrl({ url: 'about:support' }), 'images/firefox.svg');
});

test('getTabFaviconUrl - extension pages', () => {
  assert.equal(
    getTabFaviconUrl({ url: 'moz-extension://some-uuid-1234/page.html' }),
    'images/addon.svg'
  );
});

test('getTabFaviconUrl - web pages with existing favIconUrl', () => {
  const tab = {
    url: 'https://developer.mozilla.org/en-US/',
    favIconUrl: 'https://developer.mozilla.org/favicon-48x48.png'
  };
  assert.equal(getTabFaviconUrl(tab), 'https://developer.mozilla.org/favicon-48x48.png');
});

test('getTabFaviconUrl - web pages without favIconUrl fall back to domain /favicon.ico', () => {
  const tab = {
    url: 'https://github.com/irvinm/TabSearch'
  };
  assert.equal(getTabFaviconUrl(tab), 'https://github.com/favicon.ico');
});

test('getTabFaviconUrl - web pages with invalid chrome:// favIconUrl fall back to domain', () => {
  const tab = {
    url: 'https://news.ycombinator.com/news',
    favIconUrl: 'chrome://favicon/https://news.ycombinator.com'
  };
  assert.equal(getTabFaviconUrl(tab), 'https://news.ycombinator.com/favicon.ico');
});
