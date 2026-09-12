# Data Model: Virtual Search Results Dashboard

This document details the configuration settings, extension storage keys, and run-time state representation for the Virtual Search Results feature.

## Extension Storage (`browser.storage.local`)

Settings are persisted in the extension's local storage to ensure consistency across search sessions and popup interactions.

### 1. `virtualDashboard` (Search Mode Preference)
* **Type**: `boolean`
* **Default**: `false`
* **Description**: Controls the behavior when a search is executed from the popup.
  * `false` (default): Traditional mode. Hides non-matching tabs in each window.
  * `true`: Dashboard mode. Opens a dedicated singleton tab (`search-results.html`) showing matching tabs.

### 2. `keepDashboardOpen` (Dashboard Close Behavior)
* **Type**: `boolean`
* **Default**: `false`
* **Description**: Controls whether the dashboard remains open after a result is selected.
  * `false` (default): Closes the dashboard tab immediately after activating the selected tab.
  * `true`: Keeps the dashboard tab open and focused in the background/foreground.

### 3. `collapsedWindows` (Dashboard Collapse States)
* **Type**: `Array<number>`
* **Default**: `[]`
* **Description**: Persists the list of window IDs that have been collapsed by the user in the dashboard.

---

## Runtime State (Dashboard Page State in `search-results.js`)

This represents the state managed by the dashboard tab when active.

### 1. `currentQuery`
* **Type**: `string`
* **Description**: The query string currently entered in the input box, initially populated from the URL query parameter `?q=...` or passed from the background.

### 2. `collapsedWindows`
* **Type**: `Set<number>` (Set of Window IDs)
* **Description**: Keeps track of the IDs of the window sections that the user has collapsed in the UI. Instantiated from `collapsedWindows` storage on load and written back to storage on updates.

### 3. `focusedIndex`
* **Type**: `number`
* **Description**: The zero-based index of the currently highlighted result in the keyboard navigation list. Used for keyboard arrow key selection. Default is `-1` (no result highlighted).
