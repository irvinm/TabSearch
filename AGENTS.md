# TabSearch Agent Guidelines & Rules

You are assisting development on **TabSearch**, a lightweight, Firefox-focused WebExtension that allows users to search open tabs across windows, hide non-matching tabs, and browse tabs in a dedicated dashboard tab.

---

## 1. Core Architecture & Tech Stack

- **Language & Frameworks**: Pure Vanilla JavaScript (ES6+), HTML5, and CSS3.
- **No Bundlers / No Transpilers**: Do NOT introduce Webpack, Rollup, Vite, or Babel. The extension must load directly as an unpacked directory from `src/`.
- **Target Platform**: **Firefox-only (Manifest V3)**. Chromium compatibility is explicitly out of scope.
- **APIs**: Always use the modern Promise-based `browser.*` WebExtensions API namespace (not `chrome.*` with callbacks).
- **Storage**: Use `browser.storage.local` for all persisted preferences.

---

## 2. Browser Extension & API Constraints

- **`tabHide` Permission Rules**:
  - Firefox **strictly prohibits** hiding the **active tab** in any window (`tab.active === true`).
  - Firefox **strictly prohibits** hiding **pinned tabs** (`tab.pinned === true`).
  - Never attempt to call `browser.tabs.hide()` on active or pinned tabs.
  - The initial startup tab-hiding behavior triggers Firefox's native permissions prompt; respect the `disableInitialHide` option.
- **Security & AMO Compliance**:
  - Avoid `eval()`, `new Function()`, or dynamic code execution.
  - Avoid unsanitized `innerHTML` assignments with external/untrusted content (e.g., tab titles or URLs). Prefer `textContent` or `document.createElement`.
  - Any new permissions must be strictly necessary, justified, and documented in `src/privacy.html`.

---

## 3. Tree Style Tab (TST) Integration

- TabSearch supports Tree Style Tab via external runtime messaging:
  - TST Extension ID: `"{3c624236-7235-452d-8952-957637c79241}"`.
- When TST is active, tabs are visually flattened during a search and restored to their original tree hierarchy when the search concludes.
- Preserve TST state management and message listener contracts when editing `src/background.js` or `src/popup.js`.

---

## 4. Vendor Files

- **`src/fuse.basic.min.js`** is a vendored minified build of Fuse.js v7.3.0.
- **DO NOT** edit, reformat, or refactor `src/fuse.basic.min.js`. Treat this file as read-only.

---

## 5. Verification & Release Quality Gates

- **Unit Testing Gate**: All new features and non-trivial logic changes MUST include associated automated unit tests in `tests/`. Run `npm test` (`node --test`) to ensure 100% passing tests with 0 failures before marking tasks complete.
- **Docstring & JSDoc Coverage Gate**: Every new or modified function/method touched in a diff MUST include comprehensive JSDoc docstrings (`/** ... */`) documenting its description, `@param` tags (with types and descriptions), and `@returns` tag. Docstring coverage MUST meet or exceed 80% to ensure clean automated review passes (e.g., CodeRabbit).
- **Documentation Review Gate**: For any new feature, option, or behavior change, explicitly review and update both `README.md` (documentation + changelog) and `AMO/AMO_DESCRIPTION.md` (Add-on store listing).
- **Linter Gate**: Run `npx web-ext lint` after making changes. The code must produce **0 errors**.
- **Version Synchronization**: The `version` field in `package.json` and `src/manifest.json` must always match and follow Semantic Versioning (`MAJOR.MINOR.PATCH`). An optional 4th component (`MAJOR.MINOR.PATCH.BUILD`) is permitted for pre-release builds to satisfy Mozilla AMO signing requirements during testing.
- **Release Artifacts**: Unsigned packages are built via `npm run build` (`npx web-ext build --source-dir src --overwrite-dest`) and placed in `web-ext-artifacts/`. Signed distribution packages are produced via `npm run sign` with AMO credentials.
