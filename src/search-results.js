// Virtual Search Results Dashboard Logic

let currentQuery = '';
let allTabs = [];
let matchedTabs = [];
let flatResults = []; // Flat array of currently visible tab objects, for keyboard navigation
let renderedGroups = {}; // windowId -> matched tabs, from the latest render
let renderedWindowIds = []; // Window IDs in displayed order, from the latest render
let focusedIndex = -1; // No highlight by default
let collapsedWindows = new Set();
let keepDashboardOpen = false;

// Search Options loaded from local storage
let searchUrls = true;
let searchTitles = true;
let searchContents = false;
let fuzzySearch = false;
let fuzzyThreshold = 0.35;

if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', async () => {
  const searchInput = document.getElementById('search');
  const keepOpenCheckbox = document.getElementById('keep-dashboard-open');
  const resultsContainer = document.getElementById('results-container');

  // 1. Retrieve query from URL parameter ?q=...
  const urlParams = new URLSearchParams(window.location.search);
  currentQuery = urlParams.get('q') || '';
  searchInput.value = currentQuery;

  // 2. Load stored options from storage
  await loadStoredOptions();

  // Populate options checkboxes and sliders on dashboard DOM
  document.getElementById('search-urls').checked = searchUrls;
  document.getElementById('search-titles').checked = searchTitles;
  document.getElementById('search-contents').checked = searchContents;
  document.getElementById('fuzzy-search').checked = fuzzySearch;
  document.getElementById('fuzzy-threshold').value = fuzzyThreshold;
  document.getElementById('threshold-value').textContent = fuzzyThreshold.toFixed(2);
  document.getElementById('threshold-row').hidden = !fuzzySearch;

  // Bind settings change listeners to persist preferences and update results
  document.getElementById('search-urls').addEventListener('change', (e) => {
    searchUrls = e.target.checked;
    browser.storage.local.set({ searchUrls });
    if (currentQuery.trim() || (!searchUrls && !searchTitles && !searchContents)) {
      performSearch();
    }
  });
  document.getElementById('search-titles').addEventListener('change', (e) => {
    searchTitles = e.target.checked;
    browser.storage.local.set({ searchTitles });
    if (currentQuery.trim() || (!searchUrls && !searchTitles && !searchContents)) {
      performSearch();
    }
  });
  document.getElementById('search-contents').addEventListener('change', (e) => {
    searchContents = e.target.checked;
    browser.storage.local.set({ searchContents });
    if (currentQuery.trim() || (!searchUrls && !searchTitles && !searchContents)) {
      performSearch();
    }
  });
  document.getElementById('fuzzy-search').addEventListener('change', (e) => {
    fuzzySearch = e.target.checked;
    document.getElementById('threshold-row').hidden = !fuzzySearch;
    browser.storage.local.set({ fuzzySearch });
    if (currentQuery.trim()) {
      performSearch();
    }
  });
  document.getElementById('fuzzy-threshold').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('threshold-value').textContent = val.toFixed(2);
  });
  document.getElementById('fuzzy-threshold').addEventListener('change', (e) => {
    fuzzyThreshold = parseFloat(e.target.value);
    browser.storage.local.set({ fuzzyThreshold });
    if (currentQuery.trim()) {
      performSearch();
    }
  });

  // Bind option changes
  keepOpenCheckbox.checked = keepDashboardOpen;
  keepOpenCheckbox.addEventListener('change', (e) => {
    keepDashboardOpen = e.target.checked;
    browser.storage.local.set({ keepDashboardOpen: keepDashboardOpen });
  });

  // Bind Collapse All and Expand All buttons
  document.getElementById('collapse-all-btn').addEventListener('click', () => {
    const sections = document.querySelectorAll('.window-section');
    sections.forEach(section => {
      section.classList.add('collapsed');
      const winId = parseInt(section.dataset.windowId);
      if (!isNaN(winId)) {
        collapsedWindows.add(winId);
      }
    });
    saveCollapsedWindows();
    rebuildFlatResults();
    updateHighlightUI();
  });

  document.getElementById('expand-all-btn').addEventListener('click', () => {
    const sections = document.querySelectorAll('.window-section');
    sections.forEach(section => {
      section.classList.remove('collapsed');
      const winId = parseInt(section.dataset.windowId);
      if (!isNaN(winId)) {
        collapsedWindows.delete(winId);
      }
    });
    saveCollapsedWindows();
    rebuildFlatResults();
    updateHighlightUI();
  });

  // 3. Perform initial search
  await performSearch();

  // 4. Listen to real-time search refinement inputs
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    currentQuery = e.target.value;
    // Update URL query parameters without reloading page
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('q', currentQuery);
    window.history.replaceState(null, '', newUrl.searchString || newUrl.pathname + newUrl.search);

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      await performSearch();
    }, 100);
  });

  // Focus the search input initially
  searchInput.focus();

  // 5. Handle message updates from background (singleton update-query)
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((msg) => {
      console.log('[TabSearch][Dashboard] Received message:', msg);
      if (msg.action === 'update-query') {
        currentQuery = msg.query || '';
        searchInput.value = currentQuery;
        
        // Update URL
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('q', currentQuery);
        window.history.replaceState(null, '', newUrl.searchString || newUrl.pathname + newUrl.search);

        performSearch();
        searchInput.focus();
      }
    });
  }

  // Listen for storage changes to sync preferences from the popup in real-time
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes) => {
      let preferenceChanged = false;
      const keys = ['searchUrls', 'searchTitles', 'searchContents', 'fuzzySearch', 'fuzzyThreshold'];
      for (const key of keys) {
        if (changes[key]) {
          preferenceChanged = true;
          break;
        }
      }
      if (preferenceChanged) {
        loadStoredOptions().then(() => {
          document.getElementById('search-urls').checked = searchUrls;
          document.getElementById('search-titles').checked = searchTitles;
          document.getElementById('search-contents').checked = searchContents;
          document.getElementById('fuzzy-search').checked = fuzzySearch;
          document.getElementById('fuzzy-threshold').value = fuzzyThreshold;
          document.getElementById('threshold-value').textContent = fuzzyThreshold.toFixed(2);
          document.getElementById('threshold-row').hidden = !fuzzySearch;
          performSearch();
        });
      }
    });
  }

  // 6. Handle Keyboard Navigation
  window.addEventListener('keydown', (e) => {
    if (flatResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHighlight(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHighlight(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetIndex = focusedIndex >= 0 ? focusedIndex : 0;
      if (flatResults[targetIndex]) {
        activateTab(flatResults[targetIndex]);
      }
    }
  });
});
}

/**
 * Load options from browser storage
 */
async function loadStoredOptions() {
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    try {
      const items = await browser.storage.local.get([
        'searchUrls',
        'searchTitles',
        'searchContents',
        'fuzzySearch',
        'fuzzyThreshold',
        'keepDashboardOpen',
        'collapsedWindows'
      ]);
      
      searchUrls = items.searchUrls !== undefined ? !!items.searchUrls : true;
      searchTitles = items.searchTitles !== undefined ? !!items.searchTitles : true;
      searchContents = items.searchContents !== undefined ? !!items.searchContents : false;
      fuzzySearch = items.fuzzySearch !== undefined ? !!items.fuzzySearch : false;
      fuzzyThreshold = items.fuzzyThreshold !== undefined ? parseFloat(items.fuzzyThreshold) : 0.35;
      keepDashboardOpen = items.keepDashboardOpen !== undefined ? !!items.keepDashboardOpen : false;
      if (items.collapsedWindows && Array.isArray(items.collapsedWindows)) {
        collapsedWindows = new Set(items.collapsedWindows);
      }
    } catch (e) {
      console.warn('[TabSearch] Failed to load stored options:', e);
    }
  }
}

function saveCollapsedWindows() {
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    browser.storage.local.set({ collapsedWindows: Array.from(collapsedWindows) })
      .catch(e => console.warn('[TabSearch] Failed to save collapsedWindows:', e));
  }
}

let isSearching = false;
let pendingSearchRerun = false;
let searchDebounceTimer = null;

/**
 * Schedule search with debounce to prevent overlapping runs on rapid tab events
 */
function scheduleSearch(delay = 100) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch();
  }, delay);
}

/**
 * Perform search filtering and trigger DOM render
 */

/**
 * Filter tabs based on search query, active search scopes, and fuzzy search options.
 */
function filterMatchingTabs(tabsList, query, options = {}, FuseClass = null) {
  if (!tabsList || !Array.isArray(tabsList)) return [];
  const sUrls = options.searchUrls !== undefined ? !!options.searchUrls : true;
  const sTitles = options.searchTitles !== undefined ? !!options.searchTitles : true;
  const sContents = options.searchContents !== undefined ? !!options.searchContents : false;
  const fSearch = options.fuzzySearch !== undefined ? !!options.fuzzySearch : false;
  const fThreshold = options.fuzzyThreshold !== undefined ? parseFloat(options.fuzzyThreshold) : 0.35;

  if (!sUrls && !sTitles && !sContents) {
    return [];
  }

  const term = (query || "").trim().toLowerCase();
  if (!term) {
    return [...tabsList];
  }

  if (fSearch && (sTitles || sUrls)) {
    const FuseConstructor = FuseClass || (typeof Fuse !== "undefined" ? Fuse : null);
    if (FuseConstructor) {
      const keys = [];
      if (sTitles) keys.push("title");
      if (sUrls) keys.push("url");

      const fuse = new FuseConstructor(tabsList, {
        keys: keys,
        threshold: fThreshold,
        distance: 100,
        ignoreLocation: true,
        useTokenSearch: true
      });
      const results = fuse.search(term);
      return results.map(r => r.item);
    }
  }

  return tabsList.filter(tab => {
    const title = (tab.title || "").toLowerCase();
    const url = (tab.url || "").toLowerCase();
    let matches = false;
    if (sTitles && title.includes(term)) matches = true;
    if (sUrls && url.includes(term)) matches = true;
    return matches;
  });
}

/**
 * Group matched tabs by window ID and order windows with activeWindowId first,
 * followed by remaining windows in ascending numeric ID order.
 */
function groupAndSortWindows(allTabsList, matchedTabsList, activeWindowId) {
  const totalTabsPerWindow = {};
  (allTabsList || []).forEach(tab => {
    if (!totalTabsPerWindow[tab.windowId]) {
      totalTabsPerWindow[tab.windowId] = 0;
    }
    totalTabsPerWindow[tab.windowId]++;
  });

  const groups = {};
  (matchedTabsList || []).forEach(tab => {
    if (!groups[tab.windowId]) {
      groups[tab.windowId] = [];
    }
    groups[tab.windowId].push(tab);
  });

  const windowIds = Object.keys(totalTabsPerWindow).map(Number).sort((a, b) => {
    if (a === activeWindowId) return -1;
    if (b === activeWindowId) return 1;
    return a - b;
  });

  return { groups, windowIds, totalTabsPerWindow };
}

/**
 * Rebuild the flat keyboard navigation list from the latest render,
 * skipping tabs inside collapsed window sections (FR-010).
 */
function buildFlatNavigationList(renderedWindowIds, renderedGroups, collapsedWindows) {
  const flat = [];
  const collapsedSet = collapsedWindows instanceof Set ? collapsedWindows : new Set(collapsedWindows || []);
  (renderedWindowIds || []).forEach((windowId) => {
    if (collapsedSet.has(windowId)) {
      return;
    }
    (renderedGroups[windowId] || []).forEach((tab) => flat.push(tab));
  });
  return flat;
}

/**
 * Calculate next highlight index for keyboard navigation, wrapping at boundaries.
 */
function navigateHighlightIndex(currentIndex, totalCount, direction) {
  if (!totalCount || totalCount <= 0) return -1;
  if (currentIndex === -1) {
    return direction === 1 ? 0 : totalCount - 1;
  }
  let next = currentIndex + direction;
  if (next < 0) {
    return totalCount - 1;
  }
  if (next >= totalCount) {
    return 0;
  }
  return next;
}

/**
 * Remove stale/closed window IDs from the collapsedWindows set.
 */
function cleanStaleCollapsedWindows(collapsedWindows, currentWindowIds) {
  if (!collapsedWindows) return false;
  const currentSet = currentWindowIds instanceof Set ? currentWindowIds : new Set(currentWindowIds || []);
  let hasStale = false;
  const toDelete = [];
  for (const winId of collapsedWindows) {
    if (!currentSet.has(winId)) {
      toDelete.push(winId);
      hasStale = true;
    }
  }
  toDelete.forEach(id => collapsedWindows.delete(id));
  return hasStale;
}

async function performSearch() {
  if (typeof browser === 'undefined' || !browser.tabs) return;

  if (isSearching) {
    pendingSearchRerun = true;
    return;
  }
  isSearching = true;

  try {
    // Query all open tabs across all windows
    const rawTabs = await browser.tabs.query({});
    
    // Exclude the dashboard tab itself from search results
    let currentTab = null;
    try {
      currentTab = await browser.tabs.getCurrent();
    } catch (e) {
      console.warn('[TabSearch] Failed to get current tab for dashboard exclusion:', e);
    }
    allTabs = currentTab ? rawTabs.filter(tab => tab.id !== currentTab.id) : rawTabs;

        const term = currentQuery.trim().toLowerCase();
    matchedTabs = filterMatchingTabs(allTabs, currentQuery, {
      searchUrls,
      searchTitles,
      searchContents,
      fuzzySearch,
      fuzzyThreshold
    });

    // Optional page content search
    if (term && searchContents && term.length >= 3 && browser.find && browser.find.find) {
      for (const tab of allTabs) {
        // Skip if already matched
        if (matchedTabs.some(t => t.id === tab.id)) continue;

        if (tab.url && tab.url.startsWith('http')) {
          try {
            const findResult = await browser.find.find(term, { tabId: tab.id, caseSensitive: false });
            if (findResult && findResult.count && findResult.count > 0) {
              matchedTabs.push(tab);
            }
          } catch (e) {
            // Ignore find failures on unloaded/protected pages
          }
        }
      }
    }

    // Determine active window ID to sort priority
    let activeWindowId = null;
    try {
      const currentWindow = await browser.windows.getCurrent({ populate: false });
      activeWindowId = currentWindow.id;
    } catch (e) {
      console.warn('[TabSearch] Failed to get current window ID:', e);
    }

    // Render results grouped by window
    renderResults(activeWindowId);
  } catch (e) {
    console.error('[TabSearch] Error during dashboard search:', e);
  } finally {
    isSearching = false;
    if (pendingSearchRerun) {
      pendingSearchRerun = false;
      scheduleSearch(50);
    }
  }
}

/**
 * Rebuild the flat keyboard navigation list from the latest render,
 * skipping tabs inside collapsed window sections (FR-010).
 */
function rebuildFlatResults() {
  flatResults = buildFlatNavigationList(renderedWindowIds, renderedGroups, collapsedWindows);
  if (focusedIndex >= flatResults.length) {
    focusedIndex = -1;
  }
}

/**
 * Determine appropriate favicon URL for a tab, using native Firefox icons for protected/internal pages
 */
function getTabFaviconUrl(tab) {
  if (!tab) return 'images/firefox.svg';

  const url = (tab.url || '').trim();

  // If empty URL, about:blank, or any native Firefox about: page
  if (!url || url === 'about:blank' || url.startsWith('about:')) {
    if (url.startsWith('about:')) {
      const path = url.slice(6).toLowerCase();
      if (path.startsWith('addons')) return 'images/addon.svg';
      if (path.startsWith('preferences') || path.startsWith('settings') || path.startsWith('config')) return 'images/settings.svg';
      if (path.startsWith('downloads')) return 'images/downloads.svg';
      if (path.startsWith('history')) return 'images/history.svg';
      if (path.startsWith('bookmarks')) return 'images/bookmark.svg';
      if (path.startsWith('debugging') || path.startsWith('devtools') || path.startsWith('processes') || path.startsWith('performance') || path.startsWith('profiling')) return 'images/developer.svg';
    }
    // Native Firefox tabs (about:blank, about:newtab, about:home, about:welcome, etc.) use the Firefox logo
    return 'images/firefox.svg';
  }

  // Extension pages (moz-extension://)
  if (url.startsWith('moz-extension://')) {
    // If it's TabSearch's own page
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL && url.startsWith(browser.runtime.getURL(''))) {
      return 'images/search16.png';
    }
    // Other extensions
    return 'images/addon.svg';
  }

  // Regular web page with a valid favIconUrl that is not chrome:// or a loading placeholder
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://') && !tab.favIconUrl.includes('loading')) {
    return tab.favIconUrl;
  }

  // Fallback to domain /favicon.ico for http/https
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      return new URL(url).origin + '/favicon.ico';
    } catch (e) {}
  }

  return 'images/default-favicon.svg';
}

/**
 * Render grouped results list to DOM
 */
function renderResults(activeWindowId) {
  const container = document.getElementById('results-container');
  container.innerHTML = '';
  flatResults = [];

  if (matchedTabs.length === 0) {
    const noResultsDiv = document.createElement('div');
    noResultsDiv.className = 'no-results';
    noResultsDiv.textContent = 'No matching tabs found.';
    container.appendChild(noResultsDiv);
    focusedIndex = -1;
    return;
  }

    const { groups, windowIds, totalTabsPerWindow } = groupAndSortWindows(allTabs, matchedTabs, activeWindowId);

  if (cleanStaleCollapsedWindows(collapsedWindows, windowIds)) {
    saveCollapsedWindows();
  }

  // Reset keyboard focusedIndex to -1 (no highlight by default)
  focusedIndex = -1;

  windowIds.forEach((windowId, winIndex) => {
      const tabsInWindow = groups[windowId] || [];
      const isCurrentActiveWin = windowId === activeWindowId;
      const totalTabsCount = totalTabsPerWindow[windowId] || 0;

      // Create window section element
      const section = document.createElement('div');
      section.className = 'window-section';
      section.dataset.windowId = windowId;
      if (collapsedWindows.has(windowId)) {
        section.classList.add('collapsed');
      }

      // Create header
      const header = document.createElement('div');
      header.className = 'window-header';
      
      const titleSpan = document.createElement('div');
      titleSpan.className = 'window-title';
      titleSpan.textContent = `Window ${windowId} `;
      if (isCurrentActiveWin) {
        const activeSpan = document.createElement("span");
        activeSpan.textContent = "(Active) ";
        titleSpan.appendChild(activeSpan);
      }
      
      const badge = document.createElement('span');
      badge.className = 'window-badge';
      badge.textContent = `${tabsInWindow.length} \\ ${totalTabsCount} tabs`;
      
      titleSpan.appendChild(badge);

      const toggleIcon = document.createElement('span');
      toggleIcon.className = 'window-toggle-icon';
      toggleIcon.textContent = '▼';

      header.appendChild(titleSpan);
      header.appendChild(toggleIcon);

      // Toggle collapse click listener
      header.addEventListener('click', () => {
        if (collapsedWindows.has(windowId)) {
          collapsedWindows.delete(windowId);
          section.classList.remove('collapsed');
        } else {
          collapsedWindows.add(windowId);
          section.classList.add('collapsed');
        }
        saveCollapsedWindows();
        rebuildFlatResults();
        updateHighlightUI();
      });

      section.appendChild(header);

      // Create tab list
      const tabListDiv = document.createElement('div');
      tabListDiv.className = 'tab-list';

      if (tabsInWindow.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-window-message';
        emptyMsg.textContent = 'No matching tabs in this window';
        tabListDiv.appendChild(emptyMsg);
      } else {
        tabsInWindow.forEach(tab => {
        const anchor = document.createElement('a');
        anchor.className = 'tab-item-link';
        anchor.href = '#';
        anchor.addEventListener('click', (e) => {
          e.preventDefault();
          activateTab(tab);
        });

        const tabItem = document.createElement('div');
        tabItem.className = 'tab-result-item';
        tabItem.dataset.tabId = tab.id;

        // Favicon
        const faviconImg = document.createElement('img');
        faviconImg.className = 'tab-favicon';
        faviconImg.addEventListener('error', () => {
          const tabUrl = (tab.url || '').trim();
          if (!tabUrl || tabUrl === 'about:blank' || tabUrl.startsWith('about:')) {
            faviconImg.src = 'images/firefox.svg';
          } else if (!faviconImg.src.endsWith('default-favicon.svg')) {
            faviconImg.src = 'images/default-favicon.svg';
          }
        });
        faviconImg.src = getTabFaviconUrl(tab);

        // Tab Information (Title, URL)
        const tabInfo = document.createElement('div');
        tabInfo.className = 'tab-info';

        const titleText = document.createElement('span');
        titleText.className = 'tab-title-text';
        titleText.textContent = tab.title || 'Untitled Tab';

        const urlText = document.createElement('span');
        urlText.className = 'tab-url-text';
        urlText.textContent = tab.url || '';

        tabInfo.appendChild(titleText);
        tabInfo.appendChild(urlText);

        tabItem.appendChild(faviconImg);
        tabItem.appendChild(tabInfo);

        anchor.appendChild(tabItem);
        tabListDiv.appendChild(anchor);
        });
      }

      section.appendChild(tabListDiv);
      container.appendChild(section);
    });

    renderedGroups = groups;
    renderedWindowIds = windowIds;
    rebuildFlatResults();
    updateHighlightUI();
  }

/**
 * Navigate focused highlight through list
 */
function navigateHighlight(direction) {
  if (flatResults.length === 0) return;

    focusedIndex = navigateHighlightIndex(focusedIndex, flatResults.length, direction);

  updateHighlightUI();
}

/**
 * Update DOM highlight classes and scroll focused item into view
 */
function updateHighlightUI() {
  const items = document.querySelectorAll('.window-section:not(.collapsed) .tab-result-item');
  items.forEach((item, index) => {
    if (index === focusedIndex) {
      item.classList.add('highlighted');
      // Scroll into view if needed
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('highlighted');
    }
  });
}

/**
 * Focus the target window, activate the tab, and close dashboard if needed
 */
async function activateTab(tab) {
  if (typeof browser === 'undefined') return;

  try {
    // 1. Focus parent window
    await browser.windows.update(tab.windowId, { focused: true });
    // 2. Activate tab
    await browser.tabs.update(tab.id, { active: true });

    // 3. Close the dashboard if keepDashboardOpen is disabled
    if (!keepDashboardOpen) {
      const currentTab = await browser.tabs.getCurrent();
      await browser.tabs.remove(currentTab.id);
    }
  } catch (e) {
    console.error('[TabSearch] Failed to activate tab:', e);
  }
}

// 7. Dynamic listeners to sync tab state in real-time
if (typeof browser !== 'undefined' && browser.tabs) {
  // Reflect closed tabs immediately
  if (browser.tabs.onRemoved) {
    browser.tabs.onRemoved.addListener((tabId) => {
      console.log('[TabSearch] Tab removed:', tabId);
      scheduleSearch(50);
    });
  }

  // Reflect newly opened tabs
  if (browser.tabs.onCreated) {
    browser.tabs.onCreated.addListener((tab) => {
      console.log('[TabSearch] Tab created:', tab.id);
      scheduleSearch(100);
    });
  }

  // Reflect URL, title, favicon, loading status, or other tab updates
  if (browser.tabs.onUpdated) {
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      scheduleSearch(100);
    });
  }

  // Reflect tabs moved within or across windows
  if (browser.tabs.onMoved) {
    browser.tabs.onMoved.addListener(() => {
      scheduleSearch(100);
    });
  }
  if (browser.tabs.onAttached) {
    browser.tabs.onAttached.addListener(() => {
      scheduleSearch(100);
    });
  }
  if (browser.tabs.onDetached) {
    browser.tabs.onDetached.addListener(() => {
      scheduleSearch(100);
    });
  }

  // Reflect opened or closed windows
  if (typeof browser.windows !== 'undefined') {
    if (browser.windows.onCreated) {
      browser.windows.onCreated.addListener(() => {
        scheduleSearch(100);
      });
    }
    if (browser.windows.onRemoved) {
      browser.windows.onRemoved.addListener(() => {
        scheduleSearch(50);
      });
    }
  }
}

  // Refresh whenever this dashboard tab or window regains focus or visibility
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        scheduleSearch(0);
      }
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      scheduleSearch(0);
    });
  }

  // Automatically close dashboard when user activates another tab unless keepDashboardOpen is enabled
  if (typeof browser !== "undefined" && browser.tabs && browser.tabs.onActivated) {
    browser.tabs.onActivated.addListener(async (activeInfo) => {
      if (keepDashboardOpen) return;
      try {
        const currentTab = await browser.tabs.getCurrent();
        if (currentTab && activeInfo.tabId !== currentTab.id) {
          console.log('[TabSearch] Another tab activated; closing dashboard tab', currentTab.id);
          await browser.tabs.remove(currentTab.id);
        }
      } catch (e) {
        console.warn('[TabSearch] Failed to close dashboard on tab deactivation:', e);
      }
    });
  }

  // Automatically close dashboard when user switches window focus unless keepDashboardOpen is enabled
  if (typeof browser !== "undefined" && browser.windows && browser.windows.onFocusChanged) {
    browser.windows.onFocusChanged.addListener(async (focusedWindowId) => {
      if (keepDashboardOpen || focusedWindowId === browser.windows.WINDOW_ID_NONE) return;
      try {
        const currentTab = await browser.tabs.getCurrent();
        if (currentTab && currentTab.windowId !== focusedWindowId) {
          console.log('[TabSearch] Window focus changed; closing dashboard tab', currentTab.id);
          await browser.tabs.remove(currentTab.id);
        }
      } catch (e) {
        console.warn('[TabSearch] Failed to close dashboard on window blur:', e);
      }
    });
  }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getTabFaviconUrl,
    filterMatchingTabs,
    groupAndSortWindows,
    buildFlatNavigationList,
    navigateHighlightIndex,
    cleanStaleCollapsedWindows
  };
}
