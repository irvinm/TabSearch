/**
 * Search field hosted inside Firefox's native vertical-tabs panel.
 *
 * The page is loaded by the privileged chrome integration as an extension
 * "sidebar" view, so it has full WebExtension API access. All filtering and
 * visibility state lives in the background controller; this file only renders
 * the field and forwards queries.
 */
(() => {
  'use strict';

  const PANEL_PORT_NAME = 'native-tab-filter-panel';
  const TITLE_PREFIX = 'TabSearch:';
  const NEUTRAL_TITLE = 'TabSearch panel';
  const COLLAPSED_MAX_WIDTH = 110;
  const INPUT_DEBOUNCE_MS = 60;
  const MAX_RECONNECT_DELAY_MS = 5000;

  const input = document.getElementById('tab-search-input');
  const clearButton = document.getElementById('clear-button');
  const expandButton = document.getElementById('expand-button');
  const activeDot = document.getElementById('active-dot');
  const resultCount = document.getElementById('result-count');
  const blockedNote = document.getElementById('blocked-note');

  let windowId = null;
  let port = null;
  let reconnectTimer = null;
  let reconnectDelay = 250;
  let inputTimer = null;
  let titleResetTimer = null;
  let pendingFocus = false;
  let composing = false;
  let pendingQuery = null;
  let lastState = null;
  let lastTotal = 0;

  /**
   * Updates the clear button visibility from the current input value.
   *
   * @returns {void}
   */
  function updateClearButton() {
    clearButton.hidden = input.value.length === 0;
  }

  /**
   * Updates the result counter and blocked-tab explanation.
   *
   * @param {Object|null} state - Latest background state.
   * @returns {void}
   */
  function updateStatus(state) {
    const total = state && Number.isFinite(state.total) ? state.total : lastTotal;
    lastTotal = total;

    if (!state || !state.active || !state.query) {
      resultCount.textContent = `Open tabs: ${total}`;
      blockedNote.textContent = '';
      blockedNote.removeAttribute('title');
      return;
    }

    if (state.matched === 0) {
      resultCount.textContent = 'No tabs found';
    } else {
      resultCount.textContent = `Found ${state.matched} of ${total} tabs`;
    }

    const blocked =
      (state.blockedActive || 0) +
      (state.blockedPinned || 0) +
      (state.blockedUnsupported || 0);
    const protectedCount = state.protectedCount || 0;
    const notes = [];
    const tips = [];

    // Keep the return hint first: in a narrow sidebar the status line can be
    // ellipsized, and this is the explanation users need most often.
    if (protectedCount > 0) {
      notes.push(`${protectedCount} kept for return`);
      tips.push(`Kept for return: ${protectedCount}`);
    }
    if (blocked > 0) {
      notes.push(`${blocked} can't be hidden`);
      tips.push(
        `Active tab: ${state.blockedActive || 0}`,
        `Pinned: ${state.blockedPinned || 0}`,
        `Protected by browser: ${state.blockedUnsupported || 0}`
      );
    }

    if (notes.length > 0) {
      blockedNote.textContent = ` · ${notes.join(' · ')}`;
      blockedNote.title = tips.join(' · ');
    } else {
      blockedNote.textContent = '';
      blockedNote.removeAttribute('title');
    }
  }

  /**
   * Shows or hides the small "filter active" dot in collapsed mode.
   *
   * @param {Object|null} state - Latest background state.
   * @returns {void}
   */
  function updateActiveDot(state) {
    const active = !!(state && state.active && state.query);
    activeDot.hidden = !active;
    expandButton.title = active ? 'Search tabs (filter active)' : 'Search tabs';
  }

  /**
   * Applies a state snapshot received from the background.
   *
   * @param {Object} state - Background panel state.
   * @returns {void}
   */
  function applyState(state) {
    if (!state || typeof state !== 'object') return;
    const wasActive = !!(lastState && lastState.active);
    lastState = state;

    if (state.active) {
      if (document.activeElement !== input && pendingQuery === null) {
        input.value = state.query || '';
      }
    } else if (wasActive || pendingQuery === null || pendingQuery === '') {
      // An external controller (for example the classic popup) ended the
      // native session. Clear the field even if it currently has focus, and
      // do not immediately re-send the old query.
      input.value = '';
      pendingQuery = null;
    }

    if (
      pendingQuery !== null &&
      pendingQuery !== state.query &&
      document.activeElement === input
    ) {
      sendQuery(pendingQuery);
    } else if (pendingQuery !== null && pendingQuery === state.query) {
      pendingQuery = null;
    }

    updateClearButton();
    updateStatus(state);
    updateActiveDot(state);
  }

  /**
   * Sends a query to the background.
   *
   * @param {string} query - Query text (may be empty to clear).
   * @returns {void}
   */
  function sendQuery(query) {
    const value = String(query == null ? '' : query);
    pendingQuery = value;
    if (!port) {
      connect();
      return;
    }
    try {
      port.postMessage({ type: 'set-query', query: value });
    } catch (err) {
      console.warn('[TabSearch] Native panel port write failed:', err);
      scheduleReconnect();
    }
  }

  /**
   * Sends the current input value immediately.
   *
   * @returns {void}
   */
  function sendCurrentValue() {
    sendQuery(input.value);
  }

  /**
   * Clears the query and keeps keyboard focus in the field.
   *
   * @param {boolean} [focus=true] - Whether to focus the field after clearing.
   * @returns {void}
   */
  function clearSearch(focus = true) {
    if (inputTimer) {
      clearTimeout(inputTimer);
      inputTimer = null;
    }
    input.value = '';
    pendingQuery = '';
    updateClearButton();
    sendQuery('');
    updateStatus(null);
    if (focus) {
      focusInput();
    }
  }

  /**
   * Handles the input event, debouncing only the background query dispatch.
   *
   * @returns {void}
   */
  function onInput() {
    updateClearButton();
    if (composing) return;

    const value = input.value;
    pendingQuery = value;

    if (inputTimer) clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      inputTimer = null;
      sendQuery(value);
    }, INPUT_DEBOUNCE_MS);
  }

  /**
   * Handles keyboard shortcuts inside the field.
   *
   * @param {KeyboardEvent} event - Keydown event.
   * @returns {void}
   */
  function onKeyDown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      event.stopPropagation();
      clearSearch(true);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      input.select();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      return;
    }

    // Keep typing from reaching browser chrome accelerators. Content events do
    // not normally bubble into chrome, but stopping propagation is cheap and
    // makes the field's ownership of keystrokes explicit.
    event.stopPropagation();
  }

  /**
   * Emits a one-way control signal to the privileged chrome host via the page
   * title (the only channel available from a remote extension view).
   *
   * @param {'expand'|'focus'} command - Command for the chrome host.
   * @returns {void}
   */
  function signalChrome(command) {
    document.title = `${TITLE_PREFIX}${command}:${Date.now()}`;
    if (titleResetTimer) clearTimeout(titleResetTimer);
    titleResetTimer = setTimeout(() => {
      document.title = NEUTRAL_TITLE;
      titleResetTimer = null;
    }, 700);
  }

  /**
   * Focuses and selects the search field, but only when the sidebar is wide
   * enough to show it.
   *
   * @returns {boolean} True when focus was applied.
   */
  function focusInput() {
    const width = document.documentElement.clientWidth || window.innerWidth || 0;
    if (width <= COLLAPSED_MAX_WIDTH) {
      return false;
    }
    try {
      input.focus({ preventScroll: true });
      input.select();
      pendingFocus = false;
      return true;
    } catch (err) {
      console.warn('[TabSearch] Could not focus native panel input:', err);
      return false;
    }
  }

  /**
   * Requests the chrome host to expand the sidebar and focuses the field.
   *
   * @returns {void}
   */
  function requestFocus() {
    pendingFocus = true;
    signalChrome('focus');
    focusInput();
    setTimeout(focusInput, 80);
    setTimeout(focusInput, 220);
    setTimeout(focusInput, 500);
  }

  /**
   * Handles the collapsed search icon click.
   *
   * @returns {void}
   */
  function onExpandClick() {
    pendingFocus = true;
    signalChrome('expand');
    focusInput();
    setTimeout(focusInput, 80);
    setTimeout(focusInput, 220);
    setTimeout(focusInput, 500);
  }

  /**
   * Schedules a background port reconnect.
   *
   * @returns {void}
   */
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  /**
   * Handles a message received from the background port.
   *
   * @param {Object} message - Port message.
   * @returns {void}
   */
  function handlePortMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'state') {
      applyState(message.state);
      return;
    }
    if (message.type === 'focus') {
      requestFocus();
      return;
    }
    if (message.type === 'error') {
      console.warn('[TabSearch] Native panel background error:', message.error);
      resultCount.textContent = 'Integration error';
      blockedNote.textContent = '';
    }
  }

  /**
   * Connects to the background controller and announces this window.
   *
   * @returns {void}
   */
  function connect() {
    if (port || windowId === null) return;
    try {
      port = browser.runtime.connect({ name: PANEL_PORT_NAME });
      reconnectDelay = 250;
      port.onMessage.addListener(handlePortMessage);
      port.onDisconnect.addListener(() => {
        port = null;
        if (!windowId) return;
        scheduleReconnect();
      });
      port.postMessage({ type: 'hello', windowId });
      port.postMessage({ type: 'get-state' });
    } catch (err) {
      port = null;
      console.warn('[TabSearch] Native panel could not connect to background:', err);
      scheduleReconnect();
    }
  }

  /**
   * Resolves this panel's Firefox window ID from the chrome-provided URL.
   *
   * @returns {Promise<void>} Resolves after windowId is set.
   */
  async function resolveWindowId() {
    try {
      const params = new URLSearchParams(location.search);
      const fromUrl = Number(params.get('windowId'));
      if (Number.isInteger(fromUrl) && fromUrl > 0) {
        windowId = fromUrl;
        return;
      }
    } catch {
      // Fall through to the windows API.
    }

    try {
      const current = await browser.windows.getCurrent();
      windowId = current && Number.isInteger(current.id) ? current.id : null;
    } catch {
      windowId = null;
    }
  }

  /**
   * Handles resize as the sidebar expands/collapses or is resized.
   *
   * @returns {void}
   */
  function onResize() {
    const width = document.documentElement.clientWidth || window.innerWidth || 0;
    document.documentElement.dataset.collapsed = String(width <= COLLAPSED_MAX_WIDTH);
    if (pendingFocus && width > COLLAPSED_MAX_WIDTH) {
      focusInput();
    }
  }

  /**
   * Handles window focus (for example after the chrome host expands the panel).
   *
   * @returns {void}
   */
  function onWindowFocus() {
    if (pendingFocus) {
      focusInput();
    }
  }

  /**
   * Initialises the panel.
   *
   * @returns {Promise<void>} Resolves when listeners are attached.
   */
  async function init() {
    document.title = NEUTRAL_TITLE;
    updateStatus(null);
    updateClearButton();

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => {
      composing = false;
      onInput();
    });
    clearButton.addEventListener('click', () => clearSearch(true));
    expandButton.addEventListener('click', onExpandClick);
    window.addEventListener('resize', onResize);
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('pageshow', onResize);

    browser.runtime.onMessage.addListener((message) => {
      if (!message || message.action !== 'native-panel-focus') return undefined;
      if (windowId !== null && message.windowId !== windowId) return undefined;
      requestFocus();
      return { handled: true };
    });

    await resolveWindowId();
    onResize();
    connect();
  }

  init().catch(err => {
    console.error('[TabSearch] Native panel failed to initialise:', err);
    resultCount.textContent = 'Integration error';
  });
})();
