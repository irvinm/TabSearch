/**
 * TabSearch native vertical-tabs integration (Firefox Autoconfig/userChrome).
 *
 * This file runs with browser-chrome privileges. config.js loads it once in
 * the Autoconfig sandbox; init()/initWindow() manage each browser window and
 * host the TabSearch panel page inside the native #vertical-tabs container.
 * It deliberately contains no search logic: queries and tab visibility are
 * handled by the WebExtension.
 *
 * The extension page is created as a real extension "sidebar" view
 * (webextension-view-type + extension remote type) so it receives full
 * WebExtension APIs. Communication back to chrome uses page-title signals,
 * because a remote extension view cannot call browser-chrome APIs directly.
 */
var TabSearchNativeTabs = (() => {
  'use strict';

  const VERSION = '0.9.0';
  const LOG_PREFIX = '[TabSearch Native]';
  const EXTENSION_ID = 'TabSearch@irvinm.addons.mozilla.org';
  const PANEL_PAGE = 'vtab-search.html';
  const PANEL_HOST_ID = 'tabsearch-native-panel-host';
  const PANEL_BROWSER_ID = 'tabsearch-native-panel-browser';
  const STYLE_ID = 'tabsearch-native-panel-style';
  const TITLE_PREFIX = 'TabSearch:';
  const COLLAPSED_HEIGHT = 38;
  const EXPANDED_HEIGHT = 64;
  const STARTUP_RETRY_MS = 500;
  const STARTUP_RETRY_MAX = 40;

  /**
   * Resolves the Services module in either a window or a sandbox global.
   *
   * @returns {Object} Services module.
   */
  function getServices() {
    if (typeof Services !== 'undefined') return Services;
    return ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;
  }

  /**
   * Writes a diagnostic message to the Browser Console.
   *
   * @param {...*} args - Values to log.
   * @returns {void}
   */
  function log(...args) {
    const message = `${LOG_PREFIX} ${args.map(value => String(value)).join(' ')}`;
    try {
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info(LOG_PREFIX, ...args);
        return;
      }
    } catch {
      // Console may be unavailable during shutdown or in an autoconfig sandbox.
    }
    try {
      getServices().console.logStringMessage(message);
    } catch {
      // Last-resort logging is optional.
    }
  }

  /**
   * Writes a warning to the Browser Console.
   *
   * @param {...*} args - Values to log.
   * @returns {void}
   */
  function warn(...args) {
    const message = `${LOG_PREFIX} ${args.map(value => String(value)).join(' ')}`;
    try {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(LOG_PREFIX, ...args);
      }
    } catch {
      // Console may be unavailable during shutdown or in an autoconfig sandbox.
    }
    try {
      Cu.reportError(message);
    } catch {
      try {
        getServices().console.logStringMessage(message);
      } catch {
        // Last-resort logging is optional.
      }
    }
  }

  /**
   * Returns the Firefox application version.
   *
   * @returns {string} Version string or "unknown".
   */
  function getFirefoxVersion() {
    try {
      return getServices().appinfo.version;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Checks whether the window contains the native vertical-tabs DOM.
   *
   * @param {Window} win - Browser chrome window.
   * @returns {boolean} True when the expected elements exist.
   */
  function hasVerticalTabsDom(win) {
    try {
      return !!(
        win &&
        win.document &&
        win.document.getElementById('vertical-tabs') &&
        win.document.getElementById('tabbrowser-tabs')
      );
    } catch {
      return false;
    }
  }

  /**
   * Resolves the WebExtensionPolicy constructor. It is a browser-window global
   * but is not always present in an Autoconfig sandbox.
   *
   * @returns {Function|null} WebExtensionPolicy constructor.
   */
  function getWebExtensionPolicyClass() {
    if (typeof WebExtensionPolicy !== 'undefined' && WebExtensionPolicy.getByID) {
      return WebExtensionPolicy;
    }
    try {
      const { ExtensionParent } = ChromeUtils.importESModule(
        'resource://gre/modules/ExtensionParent.sys.mjs'
      );
      return ExtensionParent.WebExtensionPolicy || null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the installed/enabled TabSearch extension and its UUID.
   *
   * @returns {Object|null} Extension info or null while unavailable.
   */
  function getExtensionInfo() {
    try {
      const policyClass = getWebExtensionPolicyClass();
      if (!policyClass || !policyClass.getByID) {
        return null;
      }
      const policy = policyClass.getByID(EXTENSION_ID);
      if (!policy || !policy.active || !policy.mozExtensionHostname) return null;
      const extension = policy.extension || null;
      if (!extension) return null;
      return {
        id: policy.id,
        uuid: policy.mozExtensionHostname,
        extension,
        remote: !!extension.remote,
        // "extension" is Firefox's standard remote type for extension pages.
        // It is required for the page to receive the full WebExtension API.
        remoteType: extension.remote ? extension.remoteType || 'extension' : null,
        browsingContextGroupId:
          extension.browsingContextGroupId != null ? extension.browsingContextGroupId : null,
      };
    } catch (err) {
      warn('Could not resolve the TabSearch extension policy:', err);
      return null;
    }
  }

  /**
   * Returns the WebExtension window ID for a browser window.
   *
   * Firefox maps extension window IDs to outer window IDs. The extension's
   * window manager is used first so this keeps working if the mapping changes.
   *
   * @param {Window} win - Browser chrome window.
   * @param {Object|null} extension - Extension object from the policy.
   * @returns {number|null} WebExtension window ID or null.
   */
  function getExtensionWindowId(win, extension) {
    try {
      const outerWindowId = win.windowGlobalChild && win.windowGlobalChild.outerWindowId;
      if (extension && extension.windowManager && typeof extension.windowManager.get === 'function') {
        const extensionWindow = extension.windowManager.get(outerWindowId, null, false);
        if (extensionWindow && Number.isInteger(extensionWindow.id)) {
          return extensionWindow.id;
        }
      }
      if (Number.isInteger(outerWindowId) && outerWindowId > 0) {
        return outerWindowId;
      }
    } catch (err) {
      warn('Could not resolve extension window ID:', err);
    }
    return null;
  }

  /**
   * Injects the layout stylesheet once per browser window.
   *
   * @param {Document} doc - Browser chrome document.
   * @returns {void}
   */
  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
    style.id = STYLE_ID;
    style.textContent = `
      /* The native #vertical-tabs is a row by default. Turn it into a column
         only while vertical tabs are actually visible, so the field sits
         directly above the tab strip. */
      #vertical-tabs[visible] {
        flex-direction: column !important;
      }
      #vertical-tabs[visible] > #${PANEL_HOST_ID} {
        flex: 0 0 auto !important;
        width: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
      }
      #vertical-tabs[visible] > #tabbrowser-tabs {
        flex: 1 1 auto !important;
        min-height: 0 !important;
      }
      #${PANEL_HOST_ID} > browser {
        display: flex !important;
        width: 100% !important;
        height: 100% !important;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  /**
   * Checks whether the vertical-tabs launcher is currently expanded.
   *
   * @param {Window} win - Browser chrome window.
   * @returns {boolean} True when tab titles are visible.
   */
  function isLauncherExpanded(win) {
    try {
      const tabContainer = win.document.getElementById('tabbrowser-tabs');
      if (tabContainer && tabContainer.hasAttribute('expanded')) return true;
      const sidebarMain = win.document.querySelector('sidebar-main');
      if (sidebarMain && (sidebarMain.expanded === true || sidebarMain.hasAttribute('expanded'))) {
        return true;
      }
      if (win.SidebarController && win.SidebarController._state) {
        return !!win.SidebarController._state.launcherExpanded;
      }
    } catch {
      // Fall through to collapsed.
    }
    return false;
  }

  /**
   * Updates the host height for the current expanded/collapsed state.
   *
   * @param {Object} instance - Per-window integration state.
   * @returns {void}
   */
  function updateLayout(instance) {
    if (!instance || !instance.host) return;
    const expanded = isLauncherExpanded(instance.win);
    instance.host.style.height = `${expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT}px`;
    // Do NOT use a bare "collapsed" attribute here: XUL applies
    // visibility: collapse to any element carrying it, which would make the
    // panel (and its search icon) disappear in the collapsed launcher.
    instance.host.toggleAttribute('data-collapsed', !expanded);
    instance.host.style.display = 'flex';
    instance.host.style.flex = '0 0 auto';
    instance.host.style.width = '100%';
    instance.host.style.minWidth = '0';
    instance.host.style.overflow = 'hidden';
  }

  /**
   * Expands (or reveals) the native vertical-tabs launcher.
   *
   * @param {Window} win - Browser chrome window.
   * @returns {boolean} True when an expansion path succeeded.
   */
  function expandSidebar(win) {
    const controller = win.SidebarController;
    if (!controller) return false;

    try {
      const state = controller._state;
      if (state) {
        // SidebarState exposes launcherVisible/launcherExpanded setters. The
        // old updateVisibility helper is not available on all Firefox builds.
        if ('launcherVisible' in state) {
          try {
            state.launcherVisible = true;
          } catch {
            // Visibility may be fixed by the current sidebar.visibility pref.
          }
        }
        try {
          state.launcherExpanded = true;
          return true;
        } catch (err) {
          warn('SidebarState.launcherExpanded failed:', err);
        }
        if (typeof state.updateVisibility === 'function') {
          state.updateVisibility(true, true);
          return true;
        }
      }
    } catch (err) {
      warn('SidebarController._state expansion failed:', err);
    }

    try {
      const sidebarMain = controller.sidebarMain || win.document.querySelector('sidebar-main');
      if (sidebarMain) {
        sidebarMain.expanded = true;
        return true;
      }
    } catch (err) {
      warn('Could not expand sidebar-main directly:', err);
    }

    try {
      if (typeof controller.handleToolbarButtonClick === 'function') {
        controller.handleToolbarButtonClick();
        return true;
      }
    } catch (err) {
      warn('Could not toggle the sidebar toolbar button:', err);
    }

    return false;
  }

  /**
   * Focuses the embedded extension view after expansion.
   *
   * @param {Object} instance - Per-window integration state.
   * @returns {void}
   */
  function focusPanel(instance) {
    if (!instance || !instance.browser) return;
    try {
      instance.browser.focus();
    } catch {
      // The extension page also retries focus on window resize/focus.
    }
  }

  /**
   * Handles title signals emitted by the extension page.
   *
   * @param {Object} instance - Per-window integration state.
   * @returns {void}
   */
  function onPanelTitleChanged(instance) {
    if (!instance || !instance.browser) return;
    let title = '';
    try {
      title = String(instance.browser.contentTitle || '');
    } catch {
      return;
    }
    if (!title.startsWith(TITLE_PREFIX)) return;
    if (title === instance.lastTitle) return;
    instance.lastTitle = title;

    if (
      title.startsWith(`${TITLE_PREFIX}expand`) ||
      title.startsWith(`${TITLE_PREFIX}focus`)
    ) {
      expandSidebar(instance.win);
      updateLayout(instance);
      instance.win.setTimeout(() => focusPanel(instance), 40);
      instance.win.setTimeout(() => focusPanel(instance), 200);
    }
  }

  /**
   * Creates the panel host and embedded extension browser.
   *
   * @param {Window} win - Browser chrome window.
   * @param {Object} extensionInfo - Result of getExtensionInfo().
   * @returns {Object|null} Instance state or null on failure.
   */
  function createPanel(win, extensionInfo) {
    let doc;
    let verticalTabs;
    let extensionParent;
    try {
      doc = win.document;
      verticalTabs = doc.getElementById('vertical-tabs');
      extensionParent = ChromeUtils.importESModule(
        'resource://gre/modules/ExtensionParent.sys.mjs'
      ).ExtensionParent;
    } catch (err) {
      warn('Could not import ExtensionParent:', err);
      return null;
    }

    if (!verticalTabs) return null;

    // Remove a stale host from a previous integration instance.
    const staleHost = doc.getElementById(PANEL_HOST_ID);
    if (staleHost) staleHost.remove();

    ensureStyle(doc);

    const host = doc.createXULElement('box');
    host.id = PANEL_HOST_ID;
    host.setAttribute('data-tabsearch-native-panel', 'true');
    host.style.height = `${COLLAPSED_HEIGHT}px`;

    const browser = doc.createXULElement('browser');
    browser.id = PANEL_BROWSER_ID;
    browser.setAttribute('type', 'content');
    browser.setAttribute('transparent', 'true');
    browser.setAttribute('disablehistory', 'true');
    browser.setAttribute('nodefaultsrc', 'true');
    browser.setAttribute('manualactiveness', 'true');
    browser.setAttribute('messagemanagergroup', 'webext-browsers');
    browser.setAttribute('webextension-view-type', 'sidebar');

    if (extensionInfo.remote) {
      browser.setAttribute('remote', 'true');
      if (extensionInfo.remoteType) {
        browser.setAttribute('remoteType', extensionInfo.remoteType);
      }
    }
    if (extensionInfo.browsingContextGroupId != null) {
      browser.setAttribute(
        'initialBrowsingContextGroupId',
        String(extensionInfo.browsingContextGroupId)
      );
    }

    host.appendChild(browser);
    verticalTabs.prepend(host);

    // Register the element as an extension view so the child process injects
    // the full WebExtension API into the panel page (not just content APIs).
    try {
      if (extensionParent.apiManager && typeof extensionParent.apiManager.emit === 'function') {
        extensionParent.apiManager.emit('extension-browser-inserted', browser, {});
      } else if (extensionParent.GlobalManager && extensionParent.GlobalManager.frameData) {
        extensionParent.GlobalManager.frameData.set(browser, { viewType: 'sidebar' });
      }
    } catch (err) {
      warn('Could not register the panel as an extension view:', err);
    }

    // manualactiveness keeps the panel from stealing focus during startup;
    // activate its docshell so clicks/typing reach the embedded field.
    try {
      browser.docShellIsActive = true;
    } catch (err) {
      warn('Could not activate the panel docshell:', err);
    }

    const windowId = getExtensionWindowId(win, extensionInfo.extension);
    // The Autoconfig sandbox does not expose URLSearchParams, so build the
    // tiny query string directly from numeric/safe values.
    let panelUrl = `moz-extension://${extensionInfo.uuid}/${PANEL_PAGE}?integration=${VERSION}`;
    if (windowId != null) {
      panelUrl += `&windowId=${windowId}`;
    }

    const instance = {
      win,
      doc,
      host,
      browser,
      windowId,
      lastTitle: '',
      observers: [],
      unloadListener: null,
      disposed: false,
    };

    browser.addEventListener('pagetitlechanged', () => onPanelTitleChanged(instance));
    browser.addEventListener('DOMTitleChanged', () => onPanelTitleChanged(instance));

    // A crashed extension view should recover instead of leaving a blank hole.
    browser.addEventListener('oop-browser-crashed', () => {
      warn('Panel browser crashed; reloading the extension page.');
      try {
        browser.reload();
      } catch (err) {
        warn('Could not reload the panel browser:', err);
      }
    });

    browser.setAttribute('src', panelUrl);
    updateLayout(instance);

    // Keep the panel first even if Firefox or CustomizableUI rebuilds the
    // vertical tabstrip children.
    try {
      const childObserver = new win.MutationObserver(() => {
        if (instance.disposed) return;
        if (!verticalTabs.isConnected) return;
        if (host.parentNode !== verticalTabs) {
          verticalTabs.prepend(host);
        }
        updateLayout(instance);
      });
      childObserver.observe(verticalTabs, { childList: true });
      instance.observers.push(childObserver);
    } catch (err) {
      warn('Could not observe the vertical tabstrip:', err);
    }

    // React to expand/collapse and vertical-tabs visibility changes.
    try {
      const layoutObserver = new win.MutationObserver(() => updateLayout(instance));
      const tabContainer = doc.getElementById('tabbrowser-tabs');
      const sidebarMain = doc.querySelector('sidebar-main');
      if (tabContainer) {
        layoutObserver.observe(tabContainer, {
          attributes: true,
          attributeFilter: ['expanded'],
        });
      }
      if (sidebarMain) {
        layoutObserver.observe(sidebarMain, {
          attributes: true,
          attributeFilter: ['expanded'],
        });
      }
      layoutObserver.observe(verticalTabs, {
        attributes: true,
        attributeFilter: ['visible'],
      });
      instance.observers.push(layoutObserver);
    } catch (err) {
      warn('Could not observe the vertical tabstrip layout:', err);
    }

    // If #vertical-tabs itself is replaced, re-create the panel.
    try {
      const sidebarContainer = doc.getElementById('sidebar-container');
      if (sidebarContainer) {
        const replaceObserver = new win.MutationObserver(() => {
          if (instance.disposed) return;
          if (!doc.getElementById('vertical-tabs')) return;
          if (!doc.getElementById(PANEL_HOST_ID)) {
            initWindow(win);
          }
        });
        replaceObserver.observe(sidebarContainer, { childList: true });
        instance.observers.push(replaceObserver);
      }
    } catch (err) {
      warn('Could not observe sidebar-container:', err);
    }

    log(
      'Panel mounted for browser window' +
        (windowId != null ? ` ${windowId}` : '') +
        `; Firefox ${getFirefoxVersion()}`
    );

    return instance;
  }

  /**
   * Tears down one window's panel and observers.
   *
   * @param {Object} instance - Per-window integration state.
   * @returns {void}
   */
  function shutdownInstance(instance) {
    if (!instance || instance.disposed) return;
    instance.disposed = true;
    if (instance.unloadListener) {
      try {
        instance.win.removeEventListener('unload', instance.unloadListener);
      } catch {
        // Window may already be closing.
      }
      instance.unloadListener = null;
    }
    for (const observer of instance.observers) {
      try {
        observer.disconnect();
      } catch {
        // Observer may already be gone.
      }
    }
    instance.observers = [];
    try {
      instance.host.remove();
    } catch {
      // The window may already be closing.
    }
    try {
      const style = instance.doc.getElementById(STYLE_ID);
      if (style && !instance.doc.getElementById(PANEL_HOST_ID)) {
        style.remove();
      }
    } catch {
      // Ignore shutdown races.
    }
  }

  /**
   * Initialises the panel in one browser window.
   *
   * @param {Window} win - Browser chrome window.
   * @returns {void}
   */
  function initWindow(win) {
    if (!win || win.closed) return;

    // Recover from a replaced #vertical-tabs / sidebar rebuild: a stale
    // instance whose host is detached must be torn down before remounting.
    if (win.__tabSearchNativeTabsInstance) {
      const existing = win.__tabSearchNativeTabsInstance;
      if (existing.host && existing.host.isConnected) return;
      shutdownWindow(win);
    }

    if (!hasVerticalTabsDom(win)) {
      warn('Native vertical-tabs DOM not found; integration is inactive in this window.');
      return;
    }

    let attempts = 0;
    const tryMount = () => {
      if (win.closed) return;
      if (win.__tabSearchNativeTabsInstance) return;
      const extensionInfo = getExtensionInfo();
      if (!extensionInfo) {
        attempts++;
        if (attempts <= STARTUP_RETRY_MAX) {
          win.setTimeout(tryMount, STARTUP_RETRY_MS);
        } else {
          warn(
            'TabSearch extension was not available after startup; restart Firefox after installing it.'
          );
        }
        return;
      }

      let instance = null;
      try {
        instance = createPanel(win, extensionInfo);
      } catch (err) {
        warn('Could not mount the native panel; native vertical tabs left untouched:', err);
        return;
      }
      if (!instance) {
        warn('Could not mount the native panel; native vertical tabs left untouched.');
        return;
      }

      const unloadListener = () => shutdownWindow(win);
      win.addEventListener('unload', unloadListener, { once: true });
      instance.unloadListener = unloadListener;

      win.__tabSearchNativeTabsInstance = instance;
      windowRefs.add(win);
    };

    tryMount();
  }

  /**
   * Removes the panel from one browser window.
   *
   * @param {Window} win - Browser chrome window.
   * @returns {void}
   */
  function shutdownWindow(win) {
    if (!win) return;
    const instance = win.__tabSearchNativeTabsInstance;
    if (instance) {
      shutdownInstance(instance);
      delete win.__tabSearchNativeTabsInstance;
    }
    windowRefs.delete(win);
    try {
      const style = win.document.getElementById(STYLE_ID);
      if (style) style.remove();
    } catch {
      // Window may already be closed.
    }
  }

  const windowRefs = new Set();
  let initialized = false;
  let observer = null;

  /**
   * Starts the integration for all existing and future browser windows.
   *
   * @returns {void}
   */
  function init() {
    if (initialized) return;
    initialized = true;

    const services = getServices();
    const enumerator = services.wm.getEnumerator('navigator:browser');
    const windows = [];
    while (enumerator.hasMoreElements()) {
      windows.push(enumerator.getNext());
    }
    for (const win of windows) {
      initWindow(win);
    }

    observer = {
      observe(subject, topic) {
        if (topic !== 'browser-delayed-startup-finished') return;
        try {
          if (
            subject &&
            subject.document &&
            subject.document.documentURI === 'chrome://browser/content/browser.xhtml'
          ) {
            initWindow(subject);
          }
        } catch (err) {
          warn('browser-delayed-startup-finished handler failed:', err);
        }
      },
    };
    services.obs.addObserver(observer, 'browser-delayed-startup-finished');
    log(`Integration loaded (Firefox ${getFirefoxVersion()}, v${VERSION}).`);
  }

  /**
   * Removes the integration, its observers and injected UI.
   *
   * @returns {void}
   */
  function shutdown() {
    if (!initialized) return;
    initialized = false;
    const services = getServices();
    if (observer) {
      try {
        services.obs.removeObserver(observer, 'browser-delayed-startup-finished');
      } catch {
        // Observer may already be gone.
      }
      observer = null;
    }
    for (const win of Array.from(windowRefs)) {
      shutdownWindow(win);
    }
  }

  return {
    version: VERSION,
    init,
    shutdown,
    initWindow,
    shutdownWindow,
  };
})();
