# Research: Virtual Search Results Dashboard

## Decision 1: Architecture of the Results Page
* **Decision**: Host the dashboard as a local extension page (`src/search-results.html` and `src/search-results.js`).
* **Rationale**: Hosting as a local extension page allows the dashboard to run in the extension's privileged context. It has direct access to the `browser.tabs`, `browser.windows`, and `browser.storage` APIs, permitting fast rendering of results and smooth window/tab activation. It also facilitates easy dark/light mode CSS styling without injecting scripts into external web pages.
* **Alternatives considered**:
  * *Injected Content Script*: Injecting a search dashboard UI into an existing tab. Discarded because it leaks extension context, is subject to Content Security Policy (CSP) of the host website, and could be styled incorrectly by the parent website's stylesheet.

## Decision 2: Singleton Tab Management
* **Decision**: Implement a singleton pattern using a cached `dashboardTabId` in the background script's memory, with a fallback `browser.tabs.query` check.
* **Rationale**: Caching the tab ID in background memory allows instant checking and updating of the tab. If the tab was closed or the background script was reloaded, a fallback check queries browser tabs for the `search-results.html` URL. If found, it updates the tab ID reference; otherwise, it creates a new tab.
* **Alternatives considered**:
  * *Always query tabs by URL*: Discarded as the sole method due to asynchronous query latency.
  * *Allow multiple dashboard tabs*: Discarded because it creates clutter and goes against the goal of a consolidated, clean workspace view.

## Decision 3: Preference Persistence & Communication
* **Decision**: Use `browser.storage.local` to store the search mode setting (`virtualDashboard`) and query preferences, and use a URL query parameter (e.g. `search-results.html?q=term`) to pass the initial search term from the popup to the dashboard.
* **Rationale**: `browser.storage.local` provides simple, persistent settings. Passing the search term via URL query parameters allows the dashboard page to load and display matching results immediately upon creation without waiting for background message round-trips.
* **Alternatives considered**:
  * *Post-creation message passing*: The popup or background script sends a message to the dashboard tab once it's created. Discarded because it causes a flashing layout state (empty screen -> query results).

## Decision 4: Rendering & Filtering Strategy at Scale
* **Decision**: Render the full grouped result list in a single synchronous DOM pass over the `browser.tabs.query` snapshot; no virtualization or incremental rendering.
* **Rationale**: The scoped latency targets (SC-001 <1s initial render, SC-004 <100ms per keypress for URL/title/fuzzy matching) apply to in-memory matching plus one DOM render, which fits within budget at the target scale (500+ tabs). Per-tab content search (`browser.find`) is explicitly excluded from the latency bounds (spec SC-001/SC-004), so it does not block the interactive targets.
* **Alternatives considered**:
  * *rAF-batched or virtualized rendering*: Discarded as premature — it would add complexity (Principle I) without a measured need. Revisit only if quickstart Scenario 5 fails at larger scales (Principle III then requires batching/deferral as the remediation).
