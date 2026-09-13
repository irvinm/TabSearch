const test = require('node:test');
const assert = require('node:assert/strict');
const { filterMatchingTabs } = require('../src/search-results.js');
const { getFuse } = require('./helpers/load-fuse.js');

const Fuse = getFuse();

const SAMPLE_TABS = [
  { id: 1, title: 'GitHub - irvinm/TabSearch', url: 'https://github.com/irvinm/TabSearch', windowId: 1 },
  { id: 2, title: 'Mozilla Developer Network', url: 'https://developer.mozilla.org/en-US/', windowId: 1 },
  { id: 3, title: 'YouTube - Video Player', url: 'https://www.youtube.com/watch?v=12345', windowId: 2 },
  { id: 4, title: 'Wikipedia - Browser Extension', url: 'https://en.wikipedia.org/wiki/Browser_extension', windowId: 2 },
  { id: 5, title: 'Hacker News', url: 'https://news.ycombinator.com', windowId: 3 }
];

test('filterMatchingTabs - empty or whitespace query returns all tabs', () => {
  assert.equal(filterMatchingTabs(SAMPLE_TABS, '').length, 5);
  assert.equal(filterMatchingTabs(SAMPLE_TABS, '   ').length, 5);
  assert.equal(filterMatchingTabs(SAMPLE_TABS, null).length, 5);
  assert.equal(filterMatchingTabs(SAMPLE_TABS, undefined).length, 5);
});

test('filterMatchingTabs - returns empty array when all search scopes are disabled', () => {
  const options = { searchUrls: false, searchTitles: false, searchContents: false };
  assert.deepEqual(filterMatchingTabs(SAMPLE_TABS, 'github', options), []);
  assert.deepEqual(filterMatchingTabs(SAMPLE_TABS, '', options), []);
});

test('filterMatchingTabs - title-only search matches title and ignores URL matches', () => {
  const options = { searchUrls: false, searchTitles: true, searchContents: false };
  // "ycombinator" is in the URL of tab 5, but title is "Hacker News"
  const urlOnlyMatch = filterMatchingTabs(SAMPLE_TABS, 'ycombinator', options);
  assert.equal(urlOnlyMatch.length, 0);

  // "Hacker News" is in the title of tab 5
  const titleMatch = filterMatchingTabs(SAMPLE_TABS, 'Hacker', options);
  assert.equal(titleMatch.length, 1);
  assert.equal(titleMatch[0].id, 5);
});

test('filterMatchingTabs - URL-only search matches URL and ignores title matches', () => {
  const options = { searchUrls: true, searchTitles: false, searchContents: false };
  // "Hacker" is only in title of tab 5
  const titleOnlyMatch = filterMatchingTabs(SAMPLE_TABS, 'Hacker', options);
  assert.equal(titleOnlyMatch.length, 0);

  // "ycombinator" is in URL of tab 5
  const urlMatch = filterMatchingTabs(SAMPLE_TABS, 'ycombinator', options);
  assert.equal(urlMatch.length, 1);
  assert.equal(urlMatch[0].id, 5);
});

test('filterMatchingTabs - case insensitive and whitespace trimming in substring search', () => {
  const options = { searchUrls: true, searchTitles: true };
  const r1 = filterMatchingTabs(SAMPLE_TABS, 'GITHUB', options);
  const r2 = filterMatchingTabs(SAMPLE_TABS, '  github  ', options);
  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
  assert.equal(r1[0].id, 1);
  assert.equal(r2[0].id, 1);
});

test('filterMatchingTabs - substring partial matching', () => {
  const options = { searchUrls: true, searchTitles: true };
  const results = filterMatchingTabs(SAMPLE_TABS, 'moz', options);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 2);
});

test('filterMatchingTabs - fuzzy matching finds matches with typos using Fuse.js', () => {
  const options = {
    searchUrls: true,
    searchTitles: true,
    fuzzySearch: true,
    fuzzyThreshold: 0.35
  };
  // Typo: "githb" instead of "github"
  const results = filterMatchingTabs(SAMPLE_TABS, 'githb', options, Fuse);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 1);
});

test('filterMatchingTabs - fuzzy matching threshold sensitivity', () => {
  // Strict threshold (0.1) rejects significant typos
  const strictOptions = {
    searchUrls: true,
    searchTitles: true,
    fuzzySearch: true,
    fuzzyThreshold: 0.1
  };
  const strictResults = filterMatchingTabs(SAMPLE_TABS, 'youtb', strictOptions, Fuse);
  assert.equal(strictResults.length, 0);

  // Forgiving threshold (0.4) matches the typo
  const looseOptions = {
    searchUrls: true,
    searchTitles: true,
    fuzzySearch: true,
    fuzzyThreshold: 0.4
  };
  const looseResults = filterMatchingTabs(SAMPLE_TABS, 'youtb', looseOptions, Fuse);
  assert.equal(looseResults.length, 1);
  assert.equal(looseResults[0].id, 3);
});

test('filterMatchingTabs - handles invalid tab collections without throwing', () => {
  assert.deepEqual(filterMatchingTabs(null, 'github'), []);
  assert.deepEqual(filterMatchingTabs(undefined, 'github'), []);
  assert.deepEqual(filterMatchingTabs({ id: 1 }, 'github'), []);
});

test('filterMatchingTabs - tolerates missing titles and URLs', () => {
  const tabs = [
    { id: 1, title: null, url: 'https://example.com/docs' },
    { id: 2, title: 'Documentation', url: null },
    { id: 3 }
  ];

  assert.deepEqual(
    filterMatchingTabs(tabs, 'docs', { searchUrls: true, searchTitles: false }).map(tab => tab.id),
    [1]
  );
  assert.deepEqual(
    filterMatchingTabs(tabs, 'documentation', { searchUrls: false, searchTitles: true }).map(tab => tab.id),
    [2]
  );
});

test('filterMatchingTabs - falls back to substring matching when Fuse is unavailable', () => {
  const options = {
    searchUrls: true,
    searchTitles: true,
    fuzzySearch: true
  };

  assert.deepEqual(filterMatchingTabs(SAMPLE_TABS, 'githb', options), []);
  assert.deepEqual(filterMatchingTabs(SAMPLE_TABS, 'github', options).map(tab => tab.id), [1]);
});

test('filterMatchingTabs - returns a new array for an empty query', () => {
  const results = filterMatchingTabs(SAMPLE_TABS, '', { searchUrls: true, searchTitles: true });

  assert.deepEqual(results, SAMPLE_TABS);
  assert.notEqual(results, SAMPLE_TABS);
});
