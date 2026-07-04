// Virtual Search Results Dashboard Logic

let currentQuery = '';
let allTabs = [];
let matchedTabs = [];
let flatResults = []; // Flat array of tab objects currently rendered, for keyboard navigation
let focusedIndex = -1; // No highlight by default
let collapsedWindows = new Set();
let keepDashboardOpen = false;

// Search Options loaded from local storage
let searchUrls = true;
let searchTitles = true;
let searchContents = false;
let fuzzySearch = false;
let fuzzyThreshold = 0.35;

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

/**
 * Perform search filtering and trigger DOM render
 */
async function performSearch() {
  if (typeof browser === 'undefined' || !browser.tabs) return;

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

    if (!term) {
      // If search query is empty, show all tabs
      matchedTabs = [...allTabs];
    } else if (fuzzySearch && (searchTitles || searchUrls)) {
      // Fuzzy search matching
      const keys = [];
      if (searchTitles) keys.push('title');
      if (searchUrls) keys.push('url');

      const fuse = new Fuse(allTabs, {
        keys: keys,
        threshold: fuzzyThreshold,
        distance: 100,
        ignoreLocation: true,
        useTokenSearch: true
      });
      const results = fuse.search(term);
      matchedTabs = results.map(r => r.item);
    } else {
      // Regular substring matching
      matchedTabs = allTabs.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        let matches = false;
        if (searchTitles && title.includes(term)) matches = true;
        if (searchUrls && url.includes(term)) matches = true;
        return matches;
      });
    }

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
  }
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

  // Calculate total tabs per window (Z count)
  const totalTabsPerWindow = {};
  allTabs.forEach(tab => {
    if (!totalTabsPerWindow[tab.windowId]) {
      totalTabsPerWindow[tab.windowId] = 0;
    }
    totalTabsPerWindow[tab.windowId]++;
  });

  // Group matched tabs by Window ID
  const groups = {};
  matchedTabs.forEach(tab => {
    if (!groups[tab.windowId]) {
      groups[tab.windowId] = [];
    }
    groups[tab.windowId].push(tab);
  });

  // Sort window IDs based on all open windows, current active window first
  const windowIds = Object.keys(totalTabsPerWindow).map(Number).sort((a, b) => {
    if (a === activeWindowId) return -1;
    if (b === activeWindowId) return 1;
    return a - b;
  });

  // Cleanup stale/closed window IDs from the collapsedWindows storage set
  let hasStaleWindow = false;
  const currentWindowIds = new Set(windowIds);
  for (const winId of collapsedWindows) {
    if (!currentWindowIds.has(winId)) {
      collapsedWindows.delete(winId);
      hasStaleWindow = true;
    }
  }
  if (hasStaleWindow) {
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
      titleSpan.innerHTML = `Window ${windowId} ${isCurrentActiveWin ? '<span>(Active)</span>' : ''}`;
      
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
        // Append tab to keyboard list
        flatResults.push(tab);
        const tabIndexInFlat = flatResults.length - 1;

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
        if (tabIndexInFlat === focusedIndex) {
          tabItem.classList.add('highlighted');
        }

        // Favicon
        const faviconImg = document.createElement('img');
        faviconImg.className = 'tab-favicon';
        faviconImg.addEventListener('error', () => {
          faviconImg.src = 'images/search16.png';
        });
        
        let favUrl = 'images/search16.png';
        if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://') && !tab.favIconUrl.includes('loading')) {
          favUrl = tab.favIconUrl;
        } else if (tab.url && tab.url.startsWith('http')) {
          try {
            favUrl = new URL(tab.url).origin + '/favicon.ico';
          } catch (e) {}
        }
        faviconImg.src = favUrl;

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

    updateHighlightUI();
}

/**
 * Navigate focused highlight through list
 */
function navigateHighlight(direction) {
  if (flatResults.length === 0) return;

  if (focusedIndex === -1) {
    if (direction === 1) {
      focusedIndex = 0;
    } else {
      focusedIndex = flatResults.length - 1;
    }
  } else {
    focusedIndex += direction;
    if (focusedIndex < 0) {
      focusedIndex = flatResults.length - 1;
    } else if (focusedIndex >= flatResults.length) {
      focusedIndex = 0;
    }
  }

  updateHighlightUI();
}

/**
 * Update DOM highlight classes and scroll focused item into view
 */
function updateHighlightUI() {
  const items = document.querySelectorAll('.tab-result-item');
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
if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.onRemoved) {
  browser.tabs.onRemoved.addListener(async (tabId) => {
    // If the removed tab was a match in our view, update
    if (allTabs.some(t => t.id === tabId)) {
      console.log('[TabSearch] Tab removed in background, refreshing results');
      await performSearch();
    }
  });

  browser.tabs.onCreated.addListener(async () => {
    await performSearch();
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    // Only refresh if title, URL or loading state finished
    if (changeInfo.title || changeInfo.url || changeInfo.status === 'complete') {
      await performSearch();
    }
  });
}
