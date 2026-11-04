# TabSearch — Native Vertical Tabs Integration

This optional package adds the TabSearch field directly to **Firefox's built-in
vertical tabs sidebar**, above the first tab. It is not a popup, a separate
window, or a custom extension sidebar.

The regular TabSearch `.xpi` keeps working normally without this package. The
field itself needs one privileged browser-chrome component because WebExtensions
do not have an API for injecting HTML into browser chrome.

---

## Requirements

- Firefox Desktop with native vertical tabs enabled.
  Tested on **Firefox Nightly 161** (Windows) and designed for the current
  stable Firefox channel.
- TabSearch **0.9.0** or newer installed and enabled.
- Administrator rights to install files next to `firefox.exe`.
- The integration never changes Firefox preferences or profile data.

---

## Architecture

```text
Firefox browser chrome (#vertical-tabs)
  └── #tabsearch-native-panel-host
        └── <browser webextension-view-type="sidebar">
              └── moz-extension://<uuid>/vtab-search.html
                    │  runtime port "native-tab-filter-panel"
                    ▼
              TabSearch background
              (native-filter.js: per-window sessions, tabs.hide/show)
                    ▲
                    │ "TabSearch:expand/focus" title signals
              browser chrome expands the sidebar and focuses the field
```

- **UI** — a normal extension page loaded as an extension view. It receives the
  full WebExtension API but cannot call browser-chrome APIs directly.
- **Search and visibility** — handled by `native-filter.js` inside TabSearch.
  The chrome code only hosts the field, expands the sidebar, and focuses it.
- **Extension → chrome bridge** — a one-way `document.title` signal observed by
  the chrome host with `pagetitlechanged`. No remote code or unsafe DOM access
  is involved.
- **Safe restoration** — each session remembers only the tabs it hid itself.
  `tabs.show()` is never called for tabs hidden by another extension or by the
  user. Tabs that were active while non-matching stay visible for the rest of
  the session so the user can switch back to them.

### Files

| File | Purpose |
| --- | --- |
| `config.js` | Self-contained Autoconfig file; installed as `tabsearch-autoconfig.cfg` |
| `autoconfig-prefs.js` | Points Firefox at the Autoconfig file; installed in `defaults/pref/` |
| `tabsearch-native-tabs.js` | Readable privileged chrome source, compiled into `config.js` by `build-config.ps1` |
| `build-config.ps1` | Rebuilds `config.js` after changing the chrome source |
| `install.cmd` | One-click Windows installer; requests UAC and runs `install.ps1` |
| `install.ps1` | Installs with a backup; detects stable Firefox first |
| `uninstall.ps1` | Removes the integration and restores the latest backup |

---

## Install

1. Install TabSearch **0.9.0+** and enable it.
2. Enable native vertical tabs in Firefox.
3. Quit Firefox **completely** (Quit, not just close the window).
4. Double-click **`install.cmd`** and approve the UAC prompt.

`install.cmd` targets the stable Firefox installation by default. If both stable
Firefox and Nightly are installed, the stable installation is selected. For a
different installation:

```powershell
cd "path\to\integration\firefox"
.\install.ps1 -FirefoxDir "D:\Apps\Firefox Nightly"
```

Reinstall over the same version (a backup is created):

```powershell
.\install.ps1 -Force
```

The installer only touches TabSearch's integration files. If it finds another
`general.config.filename`, it stops and prints merge instructions instead of
overwriting the existing Autoconfig setup.

### Manual install

Copy these files (administrator rights required):

```text
config.js           → <Firefox>\tabsearch-autoconfig.cfg
autoconfig-prefs.js → <Firefox>\defaults\pref\zz-tabsearch-autoconfig.js
```

`<Firefox>` is the folder containing `firefox.exe` (usually
`C:\Program Files\Mozilla Firefox`).

`config.js` already contains the complete chrome code. A separate `.js` file is
not needed: current Firefox versions reject arbitrary `file://` subscripts from
Autoconfig as untrusted. If you edit `tabsearch-native-tabs.js`, rebuild the
config first:

```powershell
.\build-config.ps1
```

If you already maintain an Autoconfig setup, do not overwrite it. Add only these
prefs to your existing config:

```js
pref("general.config.obscure_value", 0);
pref("general.config.filename", "tabsearch-autoconfig.cfg");
```

and copy `config.js` as `tabsearch-autoconfig.cfg` next to `firefox.exe`.

---

## Usage

- Start typing in the field above the tabs. Filtering applies immediately; no
  Enter key is needed.
- `Esc` clears the query.
- `Ctrl+A` selects the current query.
- The `×` button clears the query.
- The counter shows `Found N of M tabs` and explains tabs that remain visible:
  `N can't be hidden` (active, pinned, or protected by Firefox) and
  `N kept for return` (the tab you were on while it did not match).
- If you start on YouTube, filter for `github`, and then open a GitHub result,
  YouTube stays visible for the rest of the session. Switch back at any time;
  clearing the filter releases the protection.
- In the collapsed icon-only launcher, a compact search icon remains visible.
  Click it to expand the sidebar and focus the field.
- `Ctrl+Alt+F` focuses the field from anywhere. The shortcut is configurable in
  `about:addons` → TabSearch → Manage Extension Shortcuts. If the privileged
  integration is not installed, the shortcut opens the regular TabSearch popup
  as a safe fallback.

Search covers title, URL, and domain. Multiple words use AND matching. Fuzzy
matching follows the existing TabSearch preference. Page-content search is
intentionally not used in the native panel because scanning hundreds of pages
on every keystroke is too expensive.

---

## Update

1. Update the TabSearch `.xpi` normally.
2. If the chrome integration changed, run `install.cmd` again (or
   `install.ps1 -Force`) before starting Firefox.
3. Restart Firefox completely.

The panel page and search engine ship inside the `.xpi` and update with the
extension. The chrome host lives in the Firefox application directory and is
independent: a new extension version that changes the host height or bridge
requires a matching integration update. When in doubt, rebuild `config.js` and
reinstall with `-Force`.

---

## Uninstall and restore the original UI

Quit Firefox completely, then run PowerShell as administrator:

```powershell
cd "path\to\integration\firefox"
.\uninstall.ps1
```

The script removes:

```text
<Firefox>\tabsearch-autoconfig.cfg
<Firefox>\tabsearch-native-tabs.js   (legacy versions)
<Firefox>\defaults\pref\zz-tabsearch-autoconfig.js
```

and restores files from the newest `tabsearch-native-backup-*` folder, if one
exists. Restart Firefox to return the sidebar to its original appearance.

Removing the integration does **not** remove TabSearch, its settings, or the
profile. Removing the extension leaves the field empty/inactive until the
integration is removed as well.

---

## Troubleshooting

- **No field:** check that TabSearch 0.9.0+ is enabled, native vertical tabs are
  on, Firefox was fully restarted, and the integration was installed into the
  same Firefox installation.
- Open the Browser Console (`Ctrl+Shift+J`) and search for
  `[TabSearch Native]`. The integration reports a clear warning if it cannot
  find `#vertical-tabs`, `#tabbrowser-tabs`, or the extension policy, and leaves
  the tab strip untouched.
- **Field present but filtering does not work:** inspect the extension's
  background console in `about:debugging` → TabSearch → Inspect.
- **Shortcut opens the popup:** the privileged integration is not loaded; this
  is the documented fallback. Reinstall and restart Firefox.
- **Autoconfig conflict:** the installer refuses to overwrite another
  `general.config.filename`. Merge the two pref lines manually, as described
  above.
- **Panel looks clipped after an extension update:** the chrome host is older
  than the panel page. Run the current `install.cmd` / `install.ps1 -Force`.
- **Firefox update removed the field:** reinstall the integration. Firefox
  application updates may replace files under `Program Files`.

---

## Known limitations

- Firefox cannot hide the active tab, pinned tabs, or tabs using a camera,
  microphone, or screen sharing. They remain visible and the counter explains
  why.
- Tabs you were on while they did not match the query remain visible until the
  filter is cleared, so you can switch back to the page you started from. This
  never force-shows tabs hidden by another extension.
- The integration uses Firefox's internal `#vertical-tabs` and
  `#tabbrowser-tabs` elements and `SidebarController._state` to expand the
  launcher. All access is guarded; if Firefox changes the DOM, the integration
  disables itself with a warning instead of breaking the sidebar.
- Opening the classic TabSearch popup ends the native session first (restoring
  only its tabs) so two visibility controllers never fight over the tab strip.
- Filter state is session-only. Firefox does not persist `tabs.hide()` across
  browser restarts, so all tabs are visible again after a restart.
- The integration is **not** part of the AMO `.xpi`. It is a separate privileged
  package installed manually. AMO extensions cannot write to the Firefox
  application directory or enable Autoconfig.
- Shortcut availability depends on the operating system; if `Ctrl+Alt+F` is
  reserved, choose another combination in `about:addons`.

---

## Security and privacy

- No `eval`, `new Function`, or remote JavaScript.
- Autoconfig loads only the local `config.js` from the Firefox application
  directory.
- No data is sent over the network. TabSearch does not collect telemetry.
- The installer does not change `prefs.js`, `user.js`, or profile settings.
- Backups are created only for TabSearch integration files.

License: MIT (see `LICENSE` in the repository root).
