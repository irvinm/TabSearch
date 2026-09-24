/**
 * Resets the search input and instructs the background script to restore the pre-search tab visibility state.
 *
 * @returns {void}
 */
function handleOptionChange() {
  // Reset the search input field
  document.getElementById('search').value = '';
  // Deselect all tabs in the browser (even if selectMatchingTabs is enabled)
  if (browser && browser.tabs && browser.tabs.query && browser.tabs.highlight) {
    browser.tabs.query({ currentWindow: true }, function (tabs) {
      const activeTab = tabs.find(tab => tab.active);
      if (activeTab) {
        browser.tabs.highlight({ tabs: [activeTab.index] });
      }
      tabs.forEach(tab => {
        if (!tab.active && tab.highlighted) {
          browser.tabs.update(tab.id, { highlighted: false });
        }
      });
    });
  }
  // Tell background to restore the pre-search tab state
  if (browser && browser.runtime && browser.runtime.sendMessage) {
    browser.runtime.sendMessage({ action: 'reset-search-state' });
  }
}

/**
 * Displays a non-intrusive modal overlay notifying the user that no tabs are actively playing audio.
 *
 * @returns {void}
 */
function showNoAudioTabsMessage() {
  // Create overlay
  let overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = 0;
  overlay.style.left = 0;
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.background = 'var(--popup-modal-bg, rgba(255,255,255,0.92))';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = 9999;
  overlay.style.textAlign = 'center';
  overlay.style.fontFamily = 'inherit';

  // Addon icon
  let icon = document.createElement('img');
  icon.src = 'images/search64.png';
  icon.alt = 'TabSearch';
  icon.style.width = '48px';
  icon.style.height = '48px';
  icon.style.marginBottom = '18px';

  // Message
  let msg = document.createElement('div');
  msg.textContent = 'No tabs are currently playing audio.';
  msg.style.fontSize = '18px';
  msg.style.color = 'var(--popup-primary, #2366d1)';
  msg.style.marginBottom = '12px';

  // Dismiss button
  let btn = document.createElement('button');
  btn.textContent = 'OK';
  btn.className = 'primary-btn';
  btn.style.fontSize = '16px';
  btn.style.padding = '8px 24px';
  btn.onclick = function () {
      overlay.remove();
  };

  overlay.appendChild(icon);
  overlay.appendChild(msg);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
}

/**
 * Searches for all tabs playing audio and either focuses the single audible tab or hides non-audible tabs.
 *
 * @returns {void}
 */
function searchAudioTabs() {
  if (!browser || !browser.tabs) return;
  browser.tabs.query({ audible: true })
    .then((audibleTabs) => {
      if (audibleTabs.length === 0) {
        showNoAudioTabsMessage();
        return;
      }
      if (audibleTabs.length === 1) {
        // Only one tab playing audio: switch directly
        browser.tabs.update(audibleTabs[0].id, { active: true });
        // Do NOT close the popup
        return;
      }
      // More than one: hide all other tabs (show only audible)
      browser.tabs.query({ currentWindow: true })
        .then((allTabs) => {
          const audibleTabIds = audibleTabs.map(tab => tab.id);
          const toHide = allTabs.filter(tab => !tab.audible && !tab.pinned && !tab.active).map(tab => tab.id);
          if (toHide.length > 0 && browser.tabs.hide) {
            browser.tabs.hide(toHide);
            // Do NOT change the current active tab or close the popup
          }
        })
        .catch((err) => {
          console.error('[TabSearch] Error querying all tabs for audio search:', err);
        });
    })
    .catch((err) => {
      console.error('[TabSearch] Error querying audible tabs:', err);
    });
}

let currentStoredTheme = undefined;

/**
 * Resolves the effective theme ('dark' or 'light') based on explicit user preference or system color scheme.
 *
 * @param {string|undefined} storedTheme - The persisted theme preference ('dark', 'light', or undefined).
 * @returns {string} The effective theme ('dark' or 'light').
 */
function getEffectiveTheme(storedTheme) {
  if (storedTheme === 'dark' || storedTheme === 'light') {
    return storedTheme;
  }
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Applies the specified theme to the document and updates the theme toggle button icon and accessible title.
 *
 * @param {string} theme - The theme to apply ('dark' or 'light').
 * @param {HTMLElement|null} [toggleBtn] - The theme toggle button element, if available.
 * @returns {void}
 */
function applyTheme(theme, toggleBtn) {
  if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.setAttribute === 'function') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  const btn = toggleBtn || (typeof document !== 'undefined' && document.getElementById ? document.getElementById('theme-toggle-btn') : null);
  if (!btn) return;
  const isDark = theme === 'dark';
  btn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  if (typeof btn.setAttribute === 'function') {
    btn.setAttribute('aria-label', btn.title);
  }

  // Clear existing icon content safely without innerHTML
  if (typeof btn.removeChild === 'function') {
    while (btn.firstChild) {
      btn.removeChild(btn.firstChild);
    }
  }

  if (typeof btn.appendChild === 'function' && typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    if (isDark) {
      // Sun icon
      if (svg.classList) {
        svg.classList.add('theme-icon-sun');
      }
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '5');
      svg.appendChild(circle);

      const rays = [
        ['12', '1', '12', '3'],
        ['12', '21', '12', '23'],
        ['4.22', '4.22', '5.64', '5.64'],
        ['18.36', '18.36', '19.78', '19.78'],
        ['1', '12', '3', '12'],
        ['21', '12', '23', '12'],
        ['4.22', '19.78', '5.64', '18.36'],
        ['18.36', '5.64', '19.78', '4.22']
      ];
      rays.forEach(([x1, y1, x2, y2]) => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        svg.appendChild(line);
      });
    } else {
      // Moon icon
      if (svg.classList) {
        svg.classList.add('theme-icon-moon');
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
      svg.appendChild(path);
    }
    btn.appendChild(svg);
  }
}

/**
 * Toggles between 'dark' and 'light' theme, updates the UI, and persists the choice to browser storage.
 *
 * @param {string} currentEffectiveTheme - The currently active effective theme ('dark' or 'light').
 * @param {function(string): void} [onSave] - Optional callback receiving the newly persisted theme.
 * @returns {string} The newly selected theme.
 */
function toggleTheme(currentEffectiveTheme, onSave) {
  const newTheme = currentEffectiveTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    browser.storage.local.set({ theme: newTheme }).catch((err) => {
      console.error('[TabSearch] Error saving theme:', err);
    });
  }
  if (typeof onSave === 'function') {
    onSave(newTheme);
  }
  return newTheme;
}

// Early theme initialization to eliminate white flash
if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
  browser.storage.local.get(['theme']).then((res) => {
    if (res && res.theme !== undefined) {
      currentStoredTheme = res.theme;
    }
    applyTheme(getEffectiveTheme(currentStoredTheme));
  }).catch(() => {
    applyTheme(getEffectiveTheme(undefined));
  });
} else {
  applyTheme(getEffectiveTheme(undefined));
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    var audioBtn = document.getElementById('audio-search-btn');
    if (audioBtn) {
      audioBtn.addEventListener('click', searchAudioTabs);
    }
    var themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function() {
        const effective = getEffectiveTheme(currentStoredTheme);
        currentStoredTheme = toggleTheme(effective, function(newTheme) {
          currentStoredTheme = newTheme;
        });
      });
    }
  });
}

// Log when popup.html is opened
console.warn('[TabSearch] popup.html opened at', new Date().toISOString());

// Connect a lifecycle port to ensure popup close is reliably detected by the background script
// even if asynchronous sendMessage calls in pagehide/unload are cancelled during process teardown.
// Also maintains an active heartbeat to keep the background event page alive during an open search.
let lifecyclePort = null;
let heartbeatIntervalId = null;
const POPUP_HEARTBEAT_INTERVAL_MS = 10000; // 10s keep-alive interval for Firefox 30s idle timeout

if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.connect) {
  try {
    lifecyclePort = browser.runtime.connect({ name: 'popup-lifecycle' });
    heartbeatIntervalId = setInterval(() => {
      if (lifecyclePort) {
        try {
          lifecyclePort.postMessage({ type: 'heartbeat' });
        } catch {
          if (heartbeatIntervalId) {
            clearInterval(heartbeatIntervalId);
            heartbeatIntervalId = null;
          }
        }
      }
    }, POPUP_HEARTBEAT_INTERVAL_MS);
  } catch (err) {
    console.warn('[TabSearch] Failed to connect popup lifecycle port:', err);
  }
}

let popupCloseMessageSent = false;

/**
 * Notifies the background script that the popup has closed or lost focus.
 *
 * @returns {void}
 */
function notifyPopupClosed() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }

  if (popupCloseMessageSent) {
    return;
  }

  popupCloseMessageSent = true;
  console.log('[TabSearch] focusout: Sending popup-closed message to background');
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
    browser.runtime.sendMessage({ action: 'popup-closed' }).catch(() => {});
  }
}

// Log document.activeElement on every focus change
document.addEventListener('focusin', (e) => {
  console.log('[TabSearch] focusin: document.activeElement:', document.activeElement, document.activeElement && document.activeElement.id);
});

// Use pagehide and unload to detect when the popup is closing
window.addEventListener('pagehide', () => {
  console.log('[TabSearch] pagehide: popup is closing');
  notifyPopupClosed();
});

window.addEventListener('unload', () => {
  console.log('[TabSearch] unload: popup is closing');
  notifyPopupClosed();
});

// Handle privacy info button click (must be in external JS due to CSP)
document.addEventListener('DOMContentLoaded', function() {
  /**
   * Resets tab filtering and opens a specified informational documentation page in a new active tab.
   *
   * @param {string} pageName - HTML filename of the documentation page to open.
   * @returns {Promise<void>} Resolves once the tab is created.
   */
  async function openInfoTab(pageName) {
    // Keep info pages out of an in-progress filtered state without re-highlighting tabs.
    const searchInput = document.getElementById('search');
    if (searchInput) {
      searchInput.value = '';
    }

    if (browser && browser.runtime && browser.runtime.sendMessage) {
      try {
        await browser.runtime.sendMessage({ action: 'reset-search-state' });
      } catch (err) {
        console.warn('[TabSearch] Failed to reset search state before opening info tab:', err);
      }
    }

    if (browser && browser.tabs && browser.tabs.create && browser.runtime && browser.runtime.getURL) {
      const url = browser.runtime.getURL(pageName);
      await browser.tabs.create({ url: url, active: true });
      window.close();
    }
  }

  var btn = document.getElementById('privacy-info-btn');
  if (btn) {
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      await openInfoTab('privacy.html');
    });
  }
  var contentsBtn = document.getElementById('search-contents-info-btn');
  if (contentsBtn) {
    contentsBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      await openInfoTab('search-contents.html');
    });
  }
  var fuzzyBtn = document.getElementById('fuzzy-info-btn');
  if (fuzzyBtn) {
    fuzzyBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      await openInfoTab('fuzzy_info.html');
    });
  }
});
// Utility to get and set options in storage

/**
 * Persists an object of configuration options into extension local storage.
 *
 * @param {Object.<string, any>} options - Key-value map of preferences to save.
 * @returns {void}
 */
function saveOptions(options) {
  console.log('[TabSearch] Saving options:', options);

  if (browser && browser.storage && browser.storage.local) {
    browser.storage.local.set(options).then(
      () => {},
      (err) => { console.error('[TabSearch] Failed to save options:', err); }
    );
  }
}

/**
 * Loads extension options from browser local storage and invokes the provided callback.
 *
 * @param {function(Object.<string, any>): void} callback - Callback receiving loaded options.
 * @returns {void}
 */
function loadOptions(callback) {
  if (browser && browser.storage && browser.storage.local) {
    browser.storage.local.get(["searchUrls", "searchTitles", "searchContents", "realtimeSearch", "fuzzySearch", "fuzzyThreshold", "disableEmptyTab", "selectMatchingTabs", "tstSupport", "tstAutoExpand", "virtualDashboard", "keepDashboardOpen", "hasCompletedIntroPrompt", "theme"]).then(callback);
  }
}

/**
 * Updates disabled/enabled DOM state and styles for options incompatible with Virtual Dashboard mode.
 *
 * @returns {void}
 */
function updateDisabledOptionsState() {
  const virtualDashboard = document.getElementById('virtual-dashboard').checked;
  const tstSupportInput = document.getElementById('tst-support');
  const tstSupportChecked = tstSupportInput ? tstSupportInput.checked : false;
  
  // List of options to disable when virtual dashboard is active
  const optionIds = [
    'realtime-search',
    'select-matching-tabs',
    'tst-support'
  ];
  
  optionIds.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.disabled = virtualDashboard;
      const label = input.closest('label');
      if (label) {
        if (virtualDashboard) {
          label.classList.add('disabled-label');
        } else {
          label.classList.remove('disabled-label');
        }
      }
    }
  });

  // Handle TST suboption separately
  const tstAutoExpandInput = document.getElementById('tst-auto-expand');
  const tstAutoExpandRow = document.getElementById('tst-auto-expand-row');
  if (tstAutoExpandInput) {
    const shouldDisableTSTSub = virtualDashboard || !tstSupportChecked;
    tstAutoExpandInput.disabled = shouldDisableTSTSub;
    const label = tstAutoExpandInput.closest('label');
    if (label) {
      if (shouldDisableTSTSub) {
        label.classList.add('disabled-label');
      } else {
        label.classList.remove('disabled-label');
      }
    }
  }
  if (tstAutoExpandRow) {
    tstAutoExpandRow.hidden = virtualDashboard || !tstSupportChecked;
  }
}

/**
 * Updates search button enabled state and search input disabled state based on active configuration.
 *
 * @returns {void}
 */
function updateSearchButtonState() {
  const searchBtn = document.getElementById('search-btn');
  const searchInput = document.getElementById('search');
  const urlsChecked = document.getElementById('search-urls').checked;
  const titlesChecked = document.getElementById('search-titles').checked;
  const contentsChecked = document.getElementById('search-contents').checked;
  const realtimeChecked = document.getElementById('realtime-search').checked;
  const virtualDashboard = document.getElementById('virtual-dashboard').checked;
  const enableSearch = urlsChecked || titlesChecked || contentsChecked;
  
  // Disable/grey out irrelevant options in virtual dashboard mode
  updateDisabledOptionsState();

  // Enable search button if virtual dashboard is active, otherwise disable it when real-time search is active
  searchBtn.disabled = !virtualDashboard && !!realtimeChecked;
  if (searchInput) {
    searchInput.disabled = !enableSearch;
  }
}

// Prevent form submit from reloading popup or resetting options
document.getElementById('search-form').addEventListener('submit', function(e) {
  e.preventDefault();
  doSearch();
});

document.getElementById('search').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    doSearch();
  } else if (e.key === 'Escape' || e.key === 'Esc') {
    // Send popup-closed message to background before popup closes
    notifyPopupClosed();
    // Let the popup close naturally
  }
});

document.getElementById('search-btn').addEventListener('click', function(e) {
  e.preventDefault();
  doSearch();
});

// Prevent Tab key from changing focus between elements in the popup (allow on intro screen)
window.addEventListener('keydown', function(event) {
  if (event.key === 'Tab') {
    const introScreen = document.getElementById('intro-screen');
    if (introScreen && !introScreen.hidden) {
      return;
    }
    event.preventDefault();
  }
});

// Attach all DOMContentLoaded logic in a single listener
window.addEventListener('DOMContentLoaded', function() {
  let searchInput;

  loadOptions(function(items) {
    // Only use defaults if all are undefined, otherwise use stored values
    const allUndefined =
      typeof items.searchUrls === 'undefined' &&
      typeof items.searchTitles === 'undefined' &&
      typeof items.searchContents === 'undefined' &&
      typeof items.realtimeSearch === 'undefined' &&
      typeof items.disableEmptyTab === 'undefined';

    let urlsChecked = allUndefined ? true : (typeof items.searchUrls === 'undefined' ? true : !!items.searchUrls);
    let titlesChecked = allUndefined ? true : (typeof items.searchTitles === 'undefined' ? true : !!items.searchTitles);
    let contentsChecked = allUndefined ? false : (typeof items.searchContents === 'undefined' ? false : !!items.searchContents); // default false
    let realtimeChecked = allUndefined ? true : (typeof items.realtimeSearch === 'undefined' ? true : !!items.realtimeSearch);
    let fuzzyChecked = allUndefined ? false : (typeof items.fuzzySearch === 'undefined' ? false : !!items.fuzzySearch);
    let fuzzyThreshold = allUndefined ? 0.35 : (typeof items.fuzzyThreshold === 'undefined' ? 0.35 : parseFloat(items.fuzzyThreshold));

    let selectMatchingTabsChecked = allUndefined ? false : (typeof items.selectMatchingTabs === 'undefined' ? false : !!items.selectMatchingTabs);
    let disableEmptyTabChecked = allUndefined ? false : (typeof items.disableEmptyTab === 'undefined' ? false : !!items.disableEmptyTab);
    let tstSupportChecked = allUndefined ? false : (typeof items.tstSupport === 'undefined' ? false : !!items.tstSupport);
    let tstAutoExpandChecked = allUndefined ? false : (typeof items.tstAutoExpand === 'undefined' ? false : !!items.tstAutoExpand);
    let virtualDashboardChecked = allUndefined ? false : (typeof items.virtualDashboard === 'undefined' ? false : !!items.virtualDashboard);

    document.getElementById('search-urls').checked = urlsChecked;
    document.getElementById('search-titles').checked = titlesChecked;
    document.getElementById('search-contents').checked = contentsChecked;
    document.getElementById('realtime-search').checked = realtimeChecked;
    document.getElementById('fuzzy-search').checked = fuzzyChecked;
    document.getElementById('fuzzy-threshold').value = fuzzyThreshold;
    document.getElementById('threshold-value').textContent = fuzzyThreshold.toFixed(2);
    document.getElementById('threshold-row').hidden = !fuzzyChecked;

    document.getElementById('select-matching-tabs').checked = selectMatchingTabsChecked;
    document.getElementById('disable-empty-tab').checked = disableEmptyTabChecked;
    document.getElementById('tst-support').checked = tstSupportChecked;
    document.getElementById('tst-auto-expand').checked = tstAutoExpandChecked;
    document.getElementById('virtual-dashboard').checked = virtualDashboardChecked;
    if (items.theme !== undefined) {
      currentStoredTheme = items.theme;
      applyTheme(getEffectiveTheme(currentStoredTheme));
    }

    const tstAutoExpandRow = document.getElementById('tst-auto-expand-row');
    const tstAutoExpandInput = document.getElementById('tst-auto-expand');

    function updateTSTSuboptionVisibility(enabled) {
      tstAutoExpandRow.hidden = !enabled;
      tstAutoExpandInput.disabled = !enabled;
    }

    updateTSTSuboptionVisibility(tstSupportChecked);

    // If all were undefined, save the defaults so future loads are correct
    if (allUndefined) {
      saveOptions({ searchUrls: true, searchTitles: true, searchContents: false, realtimeSearch: true, fuzzySearch: false, fuzzyThreshold: 0.35, disableEmptyTab: false, selectMatchingTabs: false, tstSupport: false, tstAutoExpand: false, virtualDashboard: false, keepDashboardOpen: false });
    }
    document.getElementById('tst-support').addEventListener('change', function() {
      const checked = this.checked;
      browser.storage.local.set({ tstSupport: checked });
      updateTSTSuboptionVisibility(checked);
      if (checked && window.TabSearchTST && window.TabSearchTST.registerWithTST) {
        window.TabSearchTST.registerWithTST();
      }
      handleOptionChange();
    });
    document.getElementById('tst-auto-expand').addEventListener('change', function() {
      const checked = this.checked;
      browser.storage.local.set({ tstAutoExpand: checked });
      handleOptionChange();
    });

  updateSearchButtonState();

  searchInput = document.getElementById('search');

  // If searchInput is not found, log an error and return
  if (!searchInput) {
    console.error('[TabSearch] Search input element not found');
  } else {
    console.log('[TabSearch] Search input element found:', searchInput);

    // Robustly focus/select using MutationObserver with logging
    console.log('[TabSearch] About to robustly focus/select search input');
    
    function robustFocusSelect(input) {
      // Defensive: skip if input is not present
      if (!input) {
        console.warn('[TabSearch] robustFocusSelect: input is null or undefined');
        return;
      }
      // Helper: check if input is visible and enabled
      function isInputReady(inp) {
        console.log('[TabSearch] Checking if input is ready:', inp);
        return inp.offsetParent !== null && !inp.disabled && inp.tabIndex !== -1;
      }
      // Focus/select logic with retry and blur detection
      let attempts = 0;
      let blurDetected = false;
      function tryFocusSelect() {
        if (blurDetected) return;
        if (isInputReady(input)) {
          console.log('[TabSearch] Input is ready, focusing and selecting:', input);
          input.focus();
          input.select();
          attempts++;
          // If input is focused, stop retrying
          if (document.activeElement === input) {
            console.log('[TabSearch] Search input === document.activeElement:', input, document.activeElement);
            return;
          }
        }
        if (attempts < 10 && !blurDetected) {
          setTimeout(tryFocusSelect, 100);
        }
      }
      // Listen for blur to stop retrying if user interacts elsewhere
      input.addEventListener('blur', function onBlur() {
        blurDetected = true;
        input.removeEventListener('blur', onBlur);
      });
      // If input is not ready, use MutationObserver to wait for it
      if (!isInputReady(input)) {
        const observer = new MutationObserver(() => {
          if (isInputReady(input)) {
            observer.disconnect();
            tryFocusSelect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      } else {
        setTimeout(tryFocusSelect, 0);
      }
    }

    const introScreen = document.getElementById('intro-screen');
    const searchForm = document.getElementById('search-form');
    const introEnableBtn = document.getElementById('intro-enable-btn');

    if (introEnableBtn) {
      introEnableBtn.addEventListener('click', function() {
        browser.storage.local.set({ hasCompletedIntroPrompt: true }).catch(() => {});
        browser.runtime.sendMessage({ action: 'trigger-initial-hide', force: true }).catch(() => {});
        window.close();
      });
    }

    if (!items.hasCompletedIntroPrompt) {
      if (introScreen) introScreen.hidden = false;
      if (searchForm) searchForm.hidden = true;
      if (introEnableBtn) {
        introEnableBtn.focus();
      }
    } else {
      if (introScreen) introScreen.hidden = true;
      if (searchForm) searchForm.hidden = false;
      robustFocusSelect(searchInput);
    }

    // Real-time search handler (must be inside this block so searchInput is defined)
    let debounceTimer;
    searchInput.addEventListener('input', function() {
      // If virtual dashboard is checked, ignore real-time trigger to prevent keystroke loss
      if (document.getElementById('virtual-dashboard').checked) {
        return;
      }
      if (document.getElementById('realtime-search').checked) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          doSearch();
        }, 150);
      }
    });
  }
  });

  /**
   * Reads all current option control states from the popup DOM and persists them into storage.
   *
   * @returns {void}
   */
  function saveAllOptions() {
    saveOptions({
      searchUrls: document.getElementById('search-urls').checked,
      searchTitles: document.getElementById('search-titles').checked,
      searchContents: document.getElementById('search-contents').checked,
      realtimeSearch: document.getElementById('realtime-search').checked,
      fuzzySearch: document.getElementById('fuzzy-search').checked,
      fuzzyThreshold: document.getElementById('fuzzy-threshold').value,
      disableEmptyTab: document.getElementById('disable-empty-tab').checked,
      selectMatchingTabs: document.getElementById('select-matching-tabs').checked,
      tstSupport: document.getElementById('tst-support').checked,
      tstAutoExpand: document.getElementById('tst-auto-expand').checked,
      virtualDashboard: document.getElementById('virtual-dashboard').checked
    });
  }

  // Attach event listeners for all options
  document.getElementById('select-matching-tabs').addEventListener('change', function() {
    saveAllOptions();
  });
  document.getElementById('search-urls').addEventListener('change', function(e) {
    const prev = document.activeElement;
    saveAllOptions();
    updateSearchButtonState();
    if (prev && prev !== document.getElementById('search')) prev.focus();
    handleOptionChange();
  });
  document.getElementById('search-titles').addEventListener('change', function(e) {
    const prev = document.activeElement;
    saveAllOptions();
    updateSearchButtonState();
    if (prev && prev !== document.getElementById('search')) prev.focus();
    handleOptionChange();
  });
  document.getElementById('search-contents').addEventListener('change', function(e) {
    const prev = document.activeElement;
    saveAllOptions();
    updateSearchButtonState();
    if (prev && prev !== document.getElementById('search')) prev.focus();
    handleOptionChange();
  });
  document.getElementById('realtime-search').addEventListener('change', function() {
    saveAllOptions();
    updateSearchButtonState();
    handleOptionChange();
  });
  document.getElementById('fuzzy-search').addEventListener('change', function() {
    saveAllOptions();
    document.getElementById('threshold-row').hidden = !this.checked;
    const currentQuery = document.getElementById('search').value;
    if (currentQuery) {
      doSearch();
    } else {
      handleOptionChange();
    }
  });
  document.getElementById('fuzzy-threshold').addEventListener('input', function() {
    document.getElementById('threshold-value').textContent = parseFloat(this.value).toFixed(2);
  });
  document.getElementById('fuzzy-threshold').addEventListener('change', function() {
    saveAllOptions();
    const currentQuery = document.getElementById('search').value;
    if (currentQuery) {
      doSearch();
    } else {
      handleOptionChange();
    }
  });

  document.getElementById('disable-empty-tab').addEventListener('change', function() {
    const isChecked = document.getElementById('disable-empty-tab').checked;
    saveAllOptions();
    if (!isChecked) {
      browser.runtime.sendMessage({ action: 'trigger-initial-hide' }).catch(() => {});
    }
  });

  document.getElementById('virtual-dashboard').addEventListener('change', function() {
    saveAllOptions();
    updateSearchButtonState();
    handleOptionChange();
  });

  // Listen for storage changes to sync preferences in real-time
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes) => {
      if (changes.theme) {
        currentStoredTheme = changes.theme.newValue;
        applyTheme(getEffectiveTheme(currentStoredTheme));
      }
      let optionsChanged = false;
      const keys = [
        'searchUrls', 'searchTitles', 'searchContents', 'realtimeSearch',
        'fuzzySearch', 'fuzzyThreshold', 'disableEmptyTab', 'selectMatchingTabs',
        'tstSupport', 'tstAutoExpand', 'virtualDashboard'
      ];
      for (const key of keys) {
        if (changes[key]) {
          optionsChanged = true;
          break;
        }
      }
      if (optionsChanged) {
        browser.storage.local.get(keys).then((items) => {
          if (items.searchUrls !== undefined) {
            document.getElementById('search-urls').checked = !!items.searchUrls;
          }
          if (items.searchTitles !== undefined) {
            document.getElementById('search-titles').checked = !!items.searchTitles;
          }
          if (items.searchContents !== undefined) {
            document.getElementById('search-contents').checked = !!items.searchContents;
          }
          if (items.realtimeSearch !== undefined) {
            document.getElementById('realtime-search').checked = !!items.realtimeSearch;
          }
          if (items.fuzzySearch !== undefined) {
            document.getElementById('fuzzy-search').checked = !!items.fuzzySearch;
            document.getElementById('threshold-row').hidden = !items.fuzzySearch;
          }
          if (items.fuzzyThreshold !== undefined) {
            document.getElementById('fuzzy-threshold').value = items.fuzzyThreshold;
            document.getElementById('threshold-value').textContent = parseFloat(items.fuzzyThreshold).toFixed(2);
          }
          if (items.disableEmptyTab !== undefined) {
            document.getElementById('disable-empty-tab').checked = !!items.disableEmptyTab;
          }
          if (items.selectMatchingTabs !== undefined) {
            document.getElementById('select-matching-tabs').checked = !!items.selectMatchingTabs;
          }
          if (items.tstSupport !== undefined) {
            document.getElementById('tst-support').checked = !!items.tstSupport;
            const tstAutoExpandRow = document.getElementById('tst-auto-expand-row');
            const tstAutoExpandInput = document.getElementById('tst-auto-expand');
            if (tstAutoExpandRow && tstAutoExpandInput) {
              tstAutoExpandRow.hidden = !items.tstSupport;
              tstAutoExpandInput.disabled = !items.tstSupport;
            }
          }
          if (items.tstAutoExpand !== undefined) {
            document.getElementById('tst-auto-expand').checked = !!items.tstAutoExpand;
          }
          if (items.virtualDashboard !== undefined) {
            document.getElementById('virtual-dashboard').checked = !!items.virtualDashboard;
          }
          updateSearchButtonState();
        }).catch(err => console.warn('[TabSearch] Failed to reload options on change:', err));
      }
    });
  }
});

/**
 * Gathers user input and active search scopes to dispatch search-tabs or open-dashboard messages.
 *
 * @returns {void}
 */
function doSearch() {
  const term = document.getElementById('search').value.trim();
  const searchUrls = document.getElementById('search-urls').checked;
  const searchTitles = document.getElementById('search-titles').checked;
  const searchContents = document.getElementById('search-contents').checked;
  const realtimeSearch = document.getElementById('realtime-search').checked;
  const fuzzySearch = document.getElementById('fuzzy-search').checked;
  const fuzzyThreshold = parseFloat(document.getElementById('fuzzy-threshold').value);
  const virtualDashboard = document.getElementById('virtual-dashboard').checked;

  if (!searchUrls && !searchTitles && !searchContents) return;

  if (virtualDashboard) {
    browser.runtime.sendMessage({ action: 'open-dashboard', query: term });
    window.close();
    return;
  }

  if (term || realtimeSearch) {
    browser.runtime.sendMessage({ action: 'search-tabs', term, searchUrls, searchTitles, searchContents, fuzzySearch, fuzzyThreshold });
    // Only close popup if not real-time
    if (!realtimeSearch) {
      // window.close(); // Optional: close popup after search
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getEffectiveTheme,
    applyTheme,
    toggleTheme
  };
}