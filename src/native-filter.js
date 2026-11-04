/**
 * Native vertical-tabs filter engine.
 *
 * This module is loaded in the MV3 background context before background.js.
 * It contains the pure matching/visibility-planning helpers and a per-window
 * session controller that only ever restores tabs it hid itself.
 *
 * The privileged browser-chrome integration (integration/firefox) only hosts
 * the search field; all search and visibility decisions stay in this engine.
 */
const TabSearchNativeFilter = (() => {
  const STORAGE_KEY_SESSIONS = 'nativeFilterSessions';
  const STATE_VERSION = 1;
  const HIDE_VERIFY_DELAY_MS = 0;
  const PERSIST_DEBOUNCE_MS = 150;
  const APPLY_EVENT_GRACE_MS = 350;

  /**
   * Converts an arbitrary value into a trimmed search query.
   *
   * @param {*} query - Raw query value.
   * @returns {string} Trimmed query string.
   */
  function normalizeQuery(query) {
    return String(query == null ? '' : query).trim();
  }

  /**
   * Splits a query into lower-case tokens used for AND matching.
   *
   * @param {string} query - Search query.
   * @returns {string[]} Non-empty lower-case tokens.
   */
  function tokenizeQuery(query) {
    return normalizeQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
  }

  /**
   * Safely extracts a hostname from a URL.
   *
   * @param {string} url - Tab URL.
   * @returns {string} Lower-case hostname or an empty string for non-URL values.
   */
  function getHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  /**
   * Builds the lower-case haystack used for a tab (title, URL and hostname).
   *
   * @param {browser.tabs.Tab|Object} tab - Tab-like object.
   * @returns {string} Combined searchable text.
   */
  function getTabSearchText(tab) {
    const title = tab && tab.title ? String(tab.title) : '';
    const url = tab && (tab.url || tab.pendingUrl) ? String(tab.url || tab.pendingUrl) : '';
    const hostname = getHostname(url);
    return `${title}\n${url}\n${hostname}`.toLowerCase();
  }

  /**
   * Checks whether every query token occurs in a tab's title, URL or hostname.
   *
   * @param {browser.tabs.Tab|Object} tab - Tab-like object.
   * @param {string[]} tokens - Lower-case query tokens.
   * @returns {boolean} True when all tokens match.
   */
  function tabMatchesTokens(tab, tokens) {
    if (!tokens || tokens.length === 0) return false;
    const haystack = getTabSearchText(tab);
    return tokens.every(token => haystack.includes(token));
  }

  /**
   * Filters tabs by title/URL/domain using the existing fuzzy preference when
   * available, otherwise a case-insensitive token AND search.
   *
   * Content search is deliberately not used here: running browser.find.find()
   * on every keystroke over hundreds of tabs would be prohibitively expensive.
   *
   * @param {Array<browser.tabs.Tab|Object>} tabs - Tabs to filter.
   * @param {string} query - Search query.
   * @param {Object} [options={}] - Search options.
   * @param {boolean} [options.fuzzySearch=false] - Use Fuse.js fuzzy matching.
   * @param {number} [options.fuzzyThreshold=0.35] - Fuse.js threshold.
   * @param {Function|null} [FuseClass=null] - Fuse constructor, if available.
   * @returns {number[]} Matching tab IDs in input order.
   */
  function filterMatchingTabs(tabs, query, options = {}, FuseClass = null) {
    if (!Array.isArray(tabs) || tabs.length === 0) return [];
    const normalized = normalizeQuery(query);
    if (!normalized) return [];

    const tokens = tokenizeQuery(normalized);

    if (options.fuzzySearch && typeof FuseClass === 'function') {
      try {
        const searchableTabs = tabs.map(tab => {
          const searchableUrl = tab.url || tab.pendingUrl || '';
          return {
            ...tab,
            url: searchableUrl,
            hostname: getHostname(searchableUrl),
          };
        });
        const fuse = new FuseClass(searchableTabs, {
          keys: ['title', 'url', 'hostname'],
          threshold: Number.isFinite(Number(options.fuzzyThreshold))
            ? Number(options.fuzzyThreshold)
            : 0.35,
          distance: 100,
          ignoreLocation: true,
          useTokenSearch: true,
        });
        return fuse.search(normalized).map(result => result.item.id);
      } catch (err) {
        // Fall through to deterministic token matching when Fuse is broken.
        console.warn('[TabSearch] Native fuzzy search failed; falling back to tokens:', err);
      }
    }

    return tabs.filter(tab => tabMatchesTokens(tab, tokens)).map(tab => tab.id);
  }

  /**
   * Builds a safe visibility plan for one window.
   *
   * Rules:
   * - Active and pinned tabs are never hidden.
   * - Tabs hidden before the session (not present in ownedHidden) are never shown.
   * - Only tabs in ownedHidden may be shown when they start matching.
   * - A tab hidden by this session that became active/pinned is restored.
   *
   * @param {Array<browser.tabs.Tab|Object>} tabs - Current tabs in the window.
   * @param {Array<number>} matchedIds - Tab IDs matching the query.
   * @param {Set<number>|Array<number>} [ownedHidden=new Set()] - Tab IDs hidden by this session.
   * @param {Set<number>|Array<number>} [protectedIds=new Set()] - Non-matching tabs that were active during the session and must stay visible for a quick return.
   * @returns {{
   *   toHide: number[],
   *   toShow: number[],
   *   blockedActive: number,
   *   blockedPinned: number,
   *   protectedCount: number,
   *   matchedCount: number,
   *   visibleMatched: number,
   *   hiddenMatched: number,
   *   keptVisible: number
   * }} Visibility plan and counters.
   */
  function buildVisibilityPlan(
    tabs,
    matchedIds,
    ownedHidden = new Set(),
    protectedIds = new Set()
  ) {
    const safeTabs = Array.isArray(tabs) ? tabs : [];
    const matched = new Set(Array.isArray(matchedIds) ? matchedIds : []);
    const owned = ownedHidden instanceof Set ? ownedHidden : new Set(ownedHidden || []);
    const protectedTabs =
      protectedIds instanceof Set ? protectedIds : new Set(protectedIds || []);
    const toHide = [];
    const toShow = [];
    let blockedActive = 0;
    let blockedPinned = 0;
    let protectedCount = 0;
    let matchedCount = 0;
    let visibleMatched = 0;
    let hiddenMatched = 0;

    for (const tab of safeTabs) {
      if (!tab || typeof tab.id !== 'number') continue;
      const isMatch = matched.has(tab.id);
      const isOwned = owned.has(tab.id);

      if (isMatch) {
        matchedCount++;
        if (tab.hidden) {
          hiddenMatched++;
          if (isOwned) toShow.push(tab.id);
        } else {
          visibleMatched++;
        }
        continue;
      }

      // A previously hidden tab that has become active or pinned must be
      // restored because Firefox will not allow it to stay hidden safely.
      if (tab.hidden) {
        if (isOwned && (tab.active || tab.pinned)) {
          toShow.push(tab.id);
        }
        continue;
      }

      if (tab.active) {
        blockedActive++;
        continue;
      }
      if (tab.pinned) {
        blockedPinned++;
        continue;
      }
      if (protectedTabs.has(tab.id)) {
        // The user was on this non-matching tab during the filter session.
        // Keep it available so switching back does not require clearing the
        // search, but do not force-show tabs hidden by someone else.
        protectedCount++;
        continue;
      }

      toHide.push(tab.id);
    }

    return {
      toHide,
      toShow,
      blockedActive,
      blockedPinned,
      protectedCount,
      matchedCount,
      visibleMatched,
      hiddenMatched,
      keptVisible: blockedActive + blockedPinned + protectedCount,
    };
  }

  /**
   * Creates a new empty per-window filter session.
   *
   * @param {number} windowId - Firefox window ID.
   * @returns {Object} Session state.
   */
  function createSession(windowId) {
    return {
      windowId,
      query: '',
      version: 0,
      ownedHidden: new Set(),
      exempt: new Set(),
      protectedActive: new Set(),
      recentlyChanged: new Map(),
      closed: false,
      applying: false,
      lastApplyAt: 0,
      state: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Returns a human-readable, serialisable state snapshot.
   *
   * @param {Object} session - Filter session.
   * @returns {Object} Snapshot safe to send to the panel.
   */
  function snapshotSession(session) {
    if (!session || !session.state) {
      return {
        active: false,
        windowId: session ? session.windowId : null,
        query: session ? session.query : '',
        total: 0,
        matched: 0,
        visibleMatched: 0,
        hiddenMatched: 0,
        hiddenByFilter: 0,
        blockedActive: 0,
        blockedPinned: 0,
        blockedUnsupported: 0,
        protectedCount: 0,
        keptVisible: 0,
        updatedAt: Date.now(),
      };
    }
    return JSON.parse(JSON.stringify(session.state));
  }

  /**
   * Creates the background controller for native-panel filtering.
   *
   * @param {Object} deps - Dependencies.
   * @param {Object} deps.browserApi - Promise-based WebExtensions API namespace.
   * @param {Function|null} [deps.FuseClass=null] - Fuse.js constructor.
   * @param {Function|null} [deps.onState=null] - Called with (windowId, state) after every update.
   * @param {Object|null} [deps.logger=null] - Logger-like object with warn/info methods.
   * @returns {Object} Native filter controller.
   */
  function createController({
    browserApi,
    FuseClass = null,
    onState = null,
    logger = null,
  } = {}) {
    if (!browserApi || !browserApi.tabs) {
      throw new Error('TabSearchNativeFilter.createController requires a tabs API');
    }

    const log = logger || console;
    const sessions = new Map();
    const queues = new Map();
    const ownedByTab = new Map();
    const inactiveRefreshTimers = new Map();
    let persistTimer = null;
    let pendingPersist = null;

    /**
     * Returns the extension session storage area when it exists.
     *
     * @returns {Object|null} storage.session area or null.
     */
    function getSessionStorage() {
      try {
        return browserApi.storage && browserApi.storage.session ? browserApi.storage.session : null;
      } catch {
        return null;
      }
    }

    /**
     * Queues a task for a window so hide/show operations never overlap.
     *
     * @param {number} windowId - Firefox window ID.
     * @param {function(): Promise<void>} task - Task to serialise.
     * @returns {Promise<void>} Resolves when the task completes.
     */
    function enqueue(windowId, task) {
      const previous = queues.get(windowId) || Promise.resolve();
      const run = previous.catch(() => {}).then(task);
      let tail;
      tail = run.finally(() => {
        if (queues.get(windowId) === tail) {
          queues.delete(windowId);
        }
      });
      queues.set(windowId, tail);
      return run;
    }

    /**
     * Waits for all currently queued window work to finish.
     *
     * @returns {Promise<void>} Resolves when all queues are idle.
     */
    async function flush() {
      while (queues.size > 0) {
        await Promise.allSettled(Array.from(queues.values()));
      }
    }

    /**
     * Reads the search preferences shared with the popup.
     *
     * @returns {Promise<{fuzzySearch: boolean, fuzzyThreshold: number}>} Options.
     */
    async function getSearchOptions() {
      try {
        const items = await browserApi.storage.local.get(['fuzzySearch', 'fuzzyThreshold']);
        return {
          fuzzySearch: !!items.fuzzySearch,
          fuzzyThreshold:
            items.fuzzyThreshold === undefined ? 0.35 : Number(items.fuzzyThreshold),
        };
      } catch {
        return { fuzzySearch: false, fuzzyThreshold: 0.35 };
      }
    }

    /**
     * Marks a tab as hidden by this session.
     *
     * @param {Object} session - Filter session.
     * @param {number} tabId - Tab ID.
     * @returns {void}
     */
    function addOwned(session, tabId) {
      const otherWindow = ownedByTab.get(tabId);
      if (typeof otherWindow === 'number' && otherWindow !== session.windowId) {
        return;
      }
      session.ownedHidden.add(tabId);
      ownedByTab.set(tabId, session.windowId);
    }

    /**
     * Removes this session's ownership of a tab.
     *
     * @param {Object} session - Filter session.
     * @param {number} tabId - Tab ID.
     * @returns {void}
     */
    function removeOwned(session, tabId) {
      session.ownedHidden.delete(tabId);
      if (ownedByTab.get(tabId) === session.windowId) {
        ownedByTab.delete(tabId);
      }
    }

    /**
     * Calls tabs.hide() and verifies which tabs were actually hidden.
     *
     * @param {number[]} tabIds - Tab IDs to hide.
     * @returns {Promise<number[]>} IDs reported as hidden.
     */
    async function hideTabs(tabIds) {
      if (!tabIds.length || typeof browserApi.tabs.hide !== 'function') return [];
      const unique = Array.from(new Set(tabIds));
      try {
        const result = await browserApi.tabs.hide(unique);
        if (Array.isArray(result)) {
          return result.filter(id => unique.includes(id));
        }
        return unique;
      } catch (err) {
        log.warn('[TabSearch] Batch tab hide failed; retrying individually:', err);
        const hidden = [];
        for (const tabId of unique) {
          try {
            const result = await browserApi.tabs.hide([tabId]);
            if (!Array.isArray(result) || result.includes(tabId)) {
              hidden.push(tabId);
            }
          } catch (singleErr) {
            log.warn(`[TabSearch] Tab ${tabId} cannot be hidden (Firefox restriction):`, singleErr);
          }
        }
        return hidden;
      }
    }

    /**
     * Calls tabs.show() and verifies which tabs were actually shown.
     *
     * @param {number[]} tabIds - Tab IDs to show.
     * @returns {Promise<number[]>} IDs reported as shown.
     */
    async function showTabs(tabIds) {
      if (!tabIds.length || typeof browserApi.tabs.show !== 'function') return [];
      const unique = Array.from(new Set(tabIds));
      try {
        const result = await browserApi.tabs.show(unique);
        if (Array.isArray(result)) {
          return result.filter(id => unique.includes(id));
        }
        return unique;
      } catch (err) {
        log.warn('[TabSearch] Batch tab show failed; retrying individually:', err);
        const shown = [];
        for (const tabId of unique) {
          try {
            const result = await browserApi.tabs.show([tabId]);
            if (!Array.isArray(result) || result.includes(tabId)) {
              shown.push(tabId);
            }
          } catch (singleErr) {
            log.warn(`[TabSearch] Tab ${tabId} could not be shown:`, singleErr);
          }
        }
        return shown;
      }
    }

    /**
     * Shows every tab owned by a session and clears ownership.
     *
     * @param {Object} session - Filter session about to be removed.
     * @returns {Promise<void>} Resolves after restore attempts.
     */
    async function showOwned(session) {
      const ownedIds = Array.from(session.ownedHidden).filter(
        tabId => ownedByTab.get(tabId) === session.windowId
      );
      if (ownedIds.length === 0) {
        session.ownedHidden.clear();
        return;
      }

      session.applying = true;
      try {
        await showTabs(ownedIds);
      } finally {
        session.applying = false;
        session.lastApplyAt = Date.now();
      }

      for (const tabId of ownedIds) {
        removeOwned(session, tabId);
      }
    }

    /**
     * Notifies listeners with the current panel state.
     *
     * @param {Object} session - Filter session.
     * @returns {void}
     */
    function emitState(session) {
      const state = snapshotSession(session);
      if (typeof onState === 'function') {
        try {
          onState(session.windowId, state);
        } catch (err) {
          log.warn('[TabSearch] Native panel state listener failed:', err);
        }
      }
    }

    /**
     * Schedules a debounced write of session metadata to storage.session.
     *
     * @returns {void}
     */
    function schedulePersist() {
      if (persistTimer) {
        clearTimeout(persistTimer);
      }
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persist().catch(() => {});
      }, PERSIST_DEBOUNCE_MS);
    }

    /**
     * Persists minimal session state (query + owned tab IDs) to memory-only
     * storage.session so an event-page restart can recover it. No tab titles,
     * URLs or full tab lists are written to disk.
     *
     * @returns {Promise<void>} Resolves after the write attempt.
     */
    async function persist() {
      if (pendingPersist) {
        return pendingPersist;
      }
      const storage = getSessionStorage();
      if (!storage) return;

      const data = {};
      for (const [windowId, session] of sessions.entries()) {
        if (session.closed || !session.query) continue;
        data[windowId] = {
          version: STATE_VERSION,
          windowId: session.windowId,
          query: session.query,
          owned: Array.from(session.ownedHidden),
          protected: Array.from(session.protectedActive),
          updatedAt: Date.now(),
        };
      }

      pendingPersist = storage
        .set({ [STORAGE_KEY_SESSIONS]: data })
        .catch(err => {
          log.warn('[TabSearch] Failed to persist native filter state:', err);
        })
        .finally(() => {
          pendingPersist = null;
        });
      return pendingPersist;
    }

    /**
     * Reconciles one window against its current query.
     *
     * @param {Object} session - Filter session.
     * @returns {Promise<void>} Resolves after visibility and state updates.
     */
    async function reconcileSession(session) {
      if (session.closed) return;

      const options = await getSearchOptions();
      let tabs;
      try {
        tabs = await browserApi.tabs.query({ windowId: session.windowId });
      } catch (err) {
        // The window may have closed between scheduling and execution.
        log.warn(`[TabSearch] Could not query tabs for window ${session.windowId}:`, err);
        return;
      }
      if (session.closed) return;

      const tabById = new Map(tabs.map(tab => [tab.id, tab]));

      // Release ownership for tabs that another actor has already shown.
      for (const tabId of Array.from(session.ownedHidden)) {
        const tab = tabById.get(tabId);
        if (tab && !tab.hidden) {
          removeOwned(session, tabId);
          session.exempt.add(tabId);
        }
      }

      const matchedIds = filterMatchingTabs(tabs, session.query, options, FuseClass);
      if (session.closed) return;

      const matchedSet = new Set(matchedIds);
      // Protect tabs that the user was actually on while they did not match
      // the query. They stay visible after switching to a result, so the user
      // can switch back without clearing the whole filter.
      for (const tab of tabs) {
        if (tab.active && !tab.pinned && !matchedSet.has(tab.id)) {
          session.protectedActive.add(tab.id);
        }
      }
      for (const tabId of Array.from(session.protectedActive)) {
        if (!tabById.has(tabId)) {
          session.protectedActive.delete(tabId);
        }
      }

      const plan = buildVisibilityPlan(
        tabs,
        matchedIds,
        session.ownedHidden,
        session.protectedActive
      );

      // Never fight a tab that was externally shown during this session.
      const toHide = plan.toHide.filter(tabId => !session.exempt.has(tabId));
      const toShow = Array.from(new Set(plan.toShow));

      session.applying = true;
      let hiddenIds = [];
      let shownIds = [];
      const changeStamp = Date.now();
      try {
        // Claim before hiding so lifecycle events cannot mistake our own hide
        // for a pre-existing hidden tab.
        for (const tabId of toHide) {
          addOwned(session, tabId);
          session.recentlyChanged.set(tabId, changeStamp);
        }
        for (const tabId of toShow) {
          session.recentlyChanged.set(tabId, changeStamp);
        }

        if (toHide.length > 0) {
          hiddenIds = await hideTabs(toHide);
        }
        for (const tabId of toHide) {
          if (!hiddenIds.includes(tabId)) {
            removeOwned(session, tabId);
          }
        }

        if (session.closed) {
          return;
        }

        if (toShow.length > 0) {
          shownIds = await showTabs(toShow);
        }
        for (const tabId of shownIds) {
          removeOwned(session, tabId);
        }
      } finally {
        session.applying = false;
        session.lastApplyAt = Date.now();
      }

      if (session.closed) {
        return;
      }

      const shownMatched = shownIds.filter(tabId => matchedSet.has(tabId)).length;
      const hiddenMatchedAfter = Math.max(0, plan.hiddenMatched - shownMatched);
      const unsupported = toHide.filter(tabId => !hiddenIds.includes(tabId));
      const exemptVisible = tabs.filter(
        tab =>
          session.exempt.has(tab.id) &&
          !tab.hidden &&
          !tab.active &&
          !tab.pinned &&
          !matchedSet.has(tab.id)
      ).length;
      const blockedUnsupported = unsupported.length + exemptVisible;
      session.updatedAt = Date.now();
      session.state = {
        active: true,
        version: STATE_VERSION,
        windowId: session.windowId,
        query: session.query,
        total: tabs.length,
        matched: plan.matchedCount,
        visibleMatched: Math.max(0, plan.matchedCount - hiddenMatchedAfter),
        hiddenMatched: hiddenMatchedAfter,
        hiddenByFilter: session.ownedHidden.size,
        blockedActive: plan.blockedActive,
        blockedPinned: plan.blockedPinned,
        blockedUnsupported,
        protectedCount: plan.protectedCount,
        keptVisible: plan.keptVisible + blockedUnsupported,
        updatedAt: session.updatedAt,
      };

      emitState(session);
      schedulePersist();
    }

    /**
     * Schedules a reconcile unless the session was superseded.
     *
     * @param {Object} session - Filter session.
     * @param {number} version - Query version captured by the caller.
     * @returns {Promise<void>} Resolves when the reconcile completes or is skipped.
     */
    function scheduleReconcile(session, version) {
      return enqueue(session.windowId, async () => {
        if (session.closed || session.version !== version) return;
        await reconcileSession(session);
      });
    }

    /**
     * Sets the query for one window and immediately schedules filtering.
     *
     * @param {number} windowId - Firefox window ID.
     * @param {string} query - Search query.
     * @returns {Promise<Object>} Panel state after the operation.
     */
    async function setQuery(windowId, query) {
      const normalized = normalizeQuery(query);
      if (!normalized) {
        return clearWindow(windowId, { reason: 'empty-query' });
      }

      let session = sessions.get(windowId);
      if (!session || session.closed) {
        session = createSession(windowId);
        sessions.set(windowId, session);
      }

      session.query = normalized;
      session.version++;
      const version = session.version;

      await scheduleReconcile(session, version);
      return getPanelState(windowId);
    }

    /**
     * Clears one window's session and restores only tabs hidden by it.
     *
     * @param {number} windowId - Firefox window ID.
     * @param {Object} [options={}] - Options.
     * @param {string} [options.reason='cleared'] - Diagnostic reason.
     * @param {boolean} [options.silent=false] - Skip the final state broadcast.
     * @returns {Promise<Object>} Empty panel state.
     */
    async function clearWindow(windowId, { reason = 'cleared', silent = false } = {}) {
      const session = sessions.get(windowId);
      if (!session) {
        const state = await getPanelState(windowId);
        if (!silent && typeof onState === 'function') {
          onState(windowId, state);
        }
        return state;
      }

      session.closed = true;
      session.version++;
      sessions.delete(windowId);

      await enqueue(windowId, async () => {
        await showOwned(session);
      });

      log.info(`[TabSearch] Native filter cleared for window ${windowId} (${reason})`);
      schedulePersist();

      const state = await getPanelState(windowId);
      if (!silent && typeof onState === 'function') {
        onState(windowId, state);
      }
      return state;
    }

    /**
     * Clears all per-window sessions.
     *
     * @param {Object} [options={}] - Options forwarded to clearWindow.
     * @returns {Promise<void>} Resolves when all sessions are cleared.
     */
    async function clearAll(options = {}) {
      const windowIds = Array.from(sessions.keys());
      for (const windowId of windowIds) {
        await clearWindow(windowId, options);
      }
    }

    /**
     * Returns the current panel state for a window, including a tab total even
     * when no filter session is active.
     *
     * @param {number} windowId - Firefox window ID.
     * @returns {Promise<Object>} Panel state.
     */
    async function getPanelState(windowId) {
      const session = sessions.get(windowId);
      if (session && session.state) {
        return snapshotSession(session);
      }

      let total = 0;
      try {
        const tabs = await browserApi.tabs.query({ windowId });
        total = tabs.length;
      } catch {
        total = 0;
      }

      return {
        active: false,
        version: STATE_VERSION,
        windowId,
        query: '',
        total,
        matched: 0,
        visibleMatched: 0,
        hiddenMatched: 0,
        hiddenByFilter: 0,
        blockedActive: 0,
        blockedPinned: 0,
        blockedUnsupported: 0,
        protectedCount: 0,
        keptVisible: 0,
        updatedAt: Date.now(),
      };
    }

    /**
     * Re-applies all active sessions (used after settings changes).
     *
     * @returns {Promise<void>} Resolves when all reconciles finish.
     */
    async function refreshAll() {
      for (const session of sessions.values()) {
        if (session.closed) continue;
        session.version++;
        await scheduleReconcile(session, session.version);
      }
    }

    /**
     * Handles a tab-created event.
     *
     * @param {browser.tabs.Tab} tab - Newly created tab.
     * @returns {void}
     */
    function onTabCreated(tab) {
      if (!tab || typeof tab.windowId !== 'number') return;
      scheduleWindow(tab.windowId);
      scheduleInactiveStateRefresh(tab.windowId);
    }

    /**
     * Handles a tab-updated event.
     *
     * @param {number} tabId - Tab ID.
     * @param {Object} changeInfo - Changed properties.
     * @param {browser.tabs.Tab} tab - Updated tab.
     * @returns {void}
     */
    function onTabUpdated(tabId, changeInfo, tab) {
      if (!tab || typeof tab.windowId !== 'number') return;
      const session = sessions.get(tab.windowId);
      if (!session) return;

      // Ignore only the hide/show events caused by our own API calls for the
      // specific tabs we touched. A broad window-wide grace period could miss
      // an external extension showing a tab.
      const lastOwnChange = session.recentlyChanged.get(tabId) || 0;
      const ownEvent =
        session.applying || Date.now() - lastOwnChange < APPLY_EVENT_GRACE_MS;
      if (changeInfo && changeInfo.hidden !== undefined) {
        if (ownEvent) return;
        if (changeInfo.hidden === false && session.ownedHidden.has(tabId)) {
          // Something else showed a tab we owned. Release it and never fight
          // over visibility for the rest of this session.
          removeOwned(session, tabId);
          session.exempt.add(tabId);
        }
      }

      if (changeInfo && (changeInfo.url || changeInfo.title || changeInfo.hidden !== undefined)) {
        scheduleWindow(tab.windowId);
      }
    }

    /**
     * Handles a tab-activated event.
     *
     * @param {Object} activeInfo - Event payload.
     * @returns {void}
     */
    function onTabActivated(activeInfo) {
      if (!activeInfo || typeof activeInfo.windowId !== 'number') return;
      scheduleWindow(activeInfo.windowId);
    }

    /**
     * Handles a tab-moved event.
     *
     * @param {number} tabId - Tab ID.
     * @param {Object} moveInfo - Move payload containing windowId.
     * @returns {void}
     */
    function onTabMoved(tabId, moveInfo) {
      if (!moveInfo || typeof moveInfo.windowId !== 'number') return;
      scheduleWindow(moveInfo.windowId);
    }

    /**
     * Handles a tab attached to another window.
     *
     * @param {number} tabId - Tab ID.
     * @param {Object} attachInfo - Attach payload containing newWindowId.
     * @returns {void}
     */
    function onTabAttached(tabId, attachInfo) {
      if (!attachInfo || typeof attachInfo.newWindowId !== 'number') return;
      scheduleWindow(attachInfo.newWindowId);
      scheduleInactiveStateRefresh(attachInfo.newWindowId);
    }

    /**
     * Handles a tab detached from a window.
     *
     * @param {number} tabId - Tab ID.
     * @param {Object} detachInfo - Detach payload containing oldWindowId.
     * @returns {void}
     */
    function onTabDetached(tabId, detachInfo) {
      if (!detachInfo || typeof detachInfo.oldWindowId !== 'number') return;
      scheduleWindow(detachInfo.oldWindowId);
      scheduleInactiveStateRefresh(detachInfo.oldWindowId);
    }

    /**
     * Handles a tab removal and clears ownership immediately.
     *
     * @param {number} tabId - Closed tab ID.
     * @param {Object} removeInfo - Remove payload containing windowId.
     * @returns {void}
     */
    function onTabRemoved(tabId, removeInfo) {
      for (const session of sessions.values()) {
        removeOwned(session, tabId);
      }
      if (removeInfo && typeof removeInfo.windowId === 'number') {
        scheduleWindow(removeInfo.windowId);
        scheduleInactiveStateRefresh(removeInfo.windowId);
      }
    }

    /**
     * Refreshes the panel's total-tab counter while no filter is active.
     * Coalesces bursts (opening dozens of tabs) into one tab query.
     *
     * @param {number} windowId - Firefox window ID.
     * @returns {void}
     */
    function scheduleInactiveStateRefresh(windowId) {
      if (sessions.has(windowId)) return;
      const existing = inactiveRefreshTimers.get(windowId);
      if (existing) clearTimeout(existing);
      inactiveRefreshTimers.set(
        windowId,
        setTimeout(async () => {
          inactiveRefreshTimers.delete(windowId);
          if (sessions.has(windowId)) return;
          try {
            const state = await getPanelState(windowId);
            if (typeof onState === 'function') onState(windowId, state);
          } catch (err) {
            log.warn(`[TabSearch] Could not refresh native panel count for window ${windowId}:`, err);
          }
        }, 150)
      );
    }

    /**
     * Schedules a reconcile for an existing session.
     *
     * @param {number} windowId - Firefox window ID.
     * @returns {void}
     */
    function scheduleWindow(windowId) {
      const session = sessions.get(windowId);
      if (!session || session.closed) return;
      session.version++;
      scheduleReconcile(session, session.version).catch(err => {
        log.warn(`[TabSearch] Native filter reconcile failed for window ${windowId}:`, err);
      });
    }

    /**
     * Handles a closed window and restores any tabs that moved elsewhere.
     *
     * @param {number} windowId - Closed Firefox window ID.
     * @returns {Promise<void>} Resolves after cleanup.
     */
    async function onWindowRemoved(windowId) {
      const session = sessions.get(windowId);
      if (!session) return;
      session.closed = true;
      sessions.delete(windowId);
      await enqueue(windowId, async () => {
        await showOwned(session);
      });
      schedulePersist();
    }

    /**
     * Restores persisted sessions after the MV3 event page is restarted.
     * storage.session survives background-context restarts but NOT browser
     * restarts, so stale tab IDs can never leak across a browser restart.
     *
     * @returns {Promise<void>} Resolves when sessions are rehydrated.
     */
    async function rehydrate() {
      const storage = getSessionStorage();
      if (!storage || typeof storage.get !== 'function') return;

      let saved;
      try {
        const items = await storage.get([STORAGE_KEY_SESSIONS]);
        saved = items[STORAGE_KEY_SESSIONS];
      } catch (err) {
        log.warn('[TabSearch] Could not read persisted native filter state:', err);
        return;
      }
      if (!saved || typeof saved !== 'object') return;

      for (const [windowKey, record] of Object.entries(saved)) {
        const windowId = Number(windowKey);
        if (!Number.isInteger(windowId) || !record || !record.query) continue;
        if (sessions.has(windowId)) continue;

        let windowExists = false;
        try {
          const win = await browserApi.windows.get(windowId);
          windowExists = !!win;
        } catch {
          windowExists = false;
        }
        if (!windowExists) {
          const restored = new Set(Array.isArray(record.owned) ? record.owned : []);
          if (restored.size > 0) {
            await showTabs(Array.from(restored));
          }
          continue;
        }

        const session = createSession(windowId);
        session.query = normalizeQuery(record.query);
        session.version = 1;
        session.ownedHidden = new Set(Array.isArray(record.owned) ? record.owned : []);
        session.protectedActive = new Set(
          Array.isArray(record.protected) ? record.protected : []
        );
        for (const tabId of session.ownedHidden) {
          ownedByTab.set(tabId, windowId);
        }
        sessions.set(windowId, session);
        scheduleReconcile(session, session.version).catch(() => {});
      }
    }

    /**
     * Removes ownership records with no session (used at browser startup).
     *
     * @returns {Promise<void>} Resolves after cleanup.
     */
    async function clearStaleState() {
      const storage = getSessionStorage();
      if (!storage || typeof storage.remove !== 'function') return;
      try {
        await storage.remove([STORAGE_KEY_SESSIONS]);
      } catch {
        // storage.session may be unavailable; nothing to clean up.
      }
    }

    /**
     * Returns the number of active sessions (for diagnostics/tests).
     *
     * @returns {number} Active session count.
     */
    function getSessionCount() {
      return sessions.size;
    }

    /**
     * Stops pending timers and drops in-memory sessions without touching tabs.
     * Intended for tests and extension shutdown, not normal filtering.
     *
     * @returns {void}
     */
    function dispose() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      for (const timer of inactiveRefreshTimers.values()) {
        clearTimeout(timer);
      }
      inactiveRefreshTimers.clear();
      sessions.clear();
      ownedByTab.clear();
    }

    return {
      setQuery,
      clearWindow,
      clearAll,
      getPanelState,
      refreshAll,
      rehydrate,
      clearStaleState,
      flush,
      getSessionCount,
      dispose,
      handleTabCreated: onTabCreated,
      handleTabUpdated: onTabUpdated,
      handleTabActivated: onTabActivated,
      handleTabMoved: onTabMoved,
      handleTabAttached: onTabAttached,
      handleTabDetached: onTabDetached,
      handleTabRemoved: onTabRemoved,
      handleWindowRemoved: onWindowRemoved,
      // Exposed for focused unit tests.
      _test: {
        sessions,
        ownedByTab,
        buildVisibilityPlan,
      },
    };
  }

  return {
    STORAGE_KEY_SESSIONS,
    STATE_VERSION,
    normalizeQuery,
    tokenizeQuery,
    getHostname,
    getTabSearchText,
    tabMatchesTokens,
    filterMatchingTabs,
    buildVisibilityPlan,
    createSession,
    createController,
    snapshotSession,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TabSearchNativeFilter;
}
