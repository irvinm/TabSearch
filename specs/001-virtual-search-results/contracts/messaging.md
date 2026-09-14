# Extension Messaging Contracts

This document outlines the message contracts exchanged via `browser.runtime` between the Popup, Background script, and the Virtual Search Results Dashboard tab.

## 1. Open / Focus Dashboard
* **Direction**: Popup $\rightarrow$ Background
* **Action**: `open-dashboard`
* **Payload**:
  ```typescript
  {
    action: 'open-dashboard',
    query: string
  }
  ```
* **Description**: Sent by the popup when the user submits a search query in Virtual Search Results mode. The background script checks if the dashboard tab is already open. If not, it creates a new tab with `search-results.html?q=<query>`. If it is open, it focuses that tab, brings its parent window to the front, and forwards the new query using the `update-query` message.

---

## 2. Update Search Query
* **Direction**: Background $\rightarrow$ Dashboard
* **Action**: `update-query`
* **Payload**:
  ```typescript
  {
    action: 'update-query',
    query: string
  }
  ```
* **Description**: Sent by the background script to the existing dashboard tab to update its search query in real-time without reloading the page.

---

## 3. Activate Tab
* **Direction**: Dashboard $\rightarrow$ Background
* **Action**: `activate-tab`
* **Payload**:
  ```typescript
  {
    action: 'activate-tab',
    tabId: number,
    windowId: number,
    closeDashboard: boolean
  }
  ```
* **Description**: Sent by the dashboard page when a user clicks or selects a search result. The background script restores the parent window (if minimized), focuses the window, activates the target tab, and closes the dashboard tab unless `closeDashboard` is false (`keepDashboardOpen` enabled).
