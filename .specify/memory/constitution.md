<!--
  Sync Impact Report
  ==================
  Version change: 1.1.0 -> 1.2.0
  Bump rationale: MINOR — Principle V amended to mandate automated unit tests
    for all new feature logic; Principle VII amended to mandate synchronized
    review and updates to both README.md and AMO/AMO_DESCRIPTION.md; Section 3
    (Development Workflow & Quality Gates) expanded to include explicit Automated
    Testing and Documentation Review gates.
  Version change: 1.3.0 -> 1.4.0
  Bump rationale: MINOR — Principle VII (Versioning & Release Hygiene) amended
    to explicitly permit an optional 4th component (MAJOR.MINOR.PATCH.BUILD)
    for pre-release AMO test signing while retaining MAJOR.MINOR.PATCH for public releases.
  Modified principles (this amendment):
    - VII. Versioning & Release Hygiene -> Permitted optional 4th component for pre-release AMO signing
  Modified sections (this amendment): none
  Prior history:
    - 1.3.0 (2026-09-12): Added docstring & JSDoc coverage gate (>= 80%).
    - 1.2.0 (2026-09-12): Added automated testing and documentation review gates.
    - 1.1.0 (2026-09-12): Principle II redefined to "Firefox-Only Target".
    - 1.0.0 (2026-08-28): First ratification; established 7-principle set.
  Templates requiring updates:
    - .specify/templates/plan-template.md        (Constitution Check gate)  ✅ aligned (generic gate, dynamic from constitution)
    - .specify/templates/spec-template.md        (requirements alignment)   ✅ aligned (generic gate)
    - .specify/templates/tasks-template.md       (task categorization)      ✅ aligned (generic gate)
    - .specify/templates/constitution-template.md (source template)         ✅ unchanged (operated on memory copy)
  Follow-up TODOs: none
-->

# TabSearch Constitution

## Core Principles

### I. Simplicity
TabSearch is a small, dependency-light browser extension. Favor the simplest
solution that satisfies the requirement. New abstractions, modules, or
configuration surface MUST be justified by a concrete need; speculative
generality is rejected. Code MUST remain readable by a developer who has not
worked on the extension before.

### II. Firefox-Only Target
TabSearch is a **Firefox-only** extension (Manifest V3). Features MUST work on
Firefox using the `browser` API surface; Chromium compatibility is out of scope
and MUST NOT be a design constraint. Where a Firefox limitation is unavoidable
(e.g., the `tabs.hide()` permission dialog), it MUST be documented in the
README and handled gracefully.

### III. Performance
The extension MUST remain responsive at the target scale of 50+ windows and
500+ tabs. Operations that touch many tabs (hiding, showing, querying,
rendering) MUST be batched or deferred where practical and MUST NOT block the
UI thread for perceptible durations. Performance regressions on large tab sets
are a defect, not an acceptable trade-off.

### IV. Privacy & Permissions
The extension MUST request only the permissions it needs and MUST NOT collect,
transmit, or persist user browsing data beyond what is required for the
declared feature. Any new permission MUST be justified in the feature spec and
disclosed in the privacy page (`src/privacy.html`). Tab content is read only
for the explicit "search contents" feature and only from loaded tabs.

### V. Verification (NON-NEGOTIABLE)
No feature is complete until it has been verified with automated unit tests for
all non-trivial logic (parsing, filtering algorithms, state transitions, helper
utilities), documented with standard JSDoc comments (`@param`, `@returns`) meeting
or exceeding 80% docstring coverage, AND manually verified against the feature's
`quickstart.md` scenarios on Firefox. Unit tests MUST be executable via `npm test`
with zero failures. A feature that cannot be demonstrated working or fails automated
tests MUST NOT be marked complete or released.

### VI. Minimal Dependencies
The extension MUST prefer vanilla JavaScript and the existing `Fuse.js`
utility. Adding a new runtime dependency MUST be justified in the feature
plan (Complexity Tracking) with the simpler alternative and the reason it was
rejected. Dependencies MUST be vendored into `src/` (no build-time network
fetches) to keep the extension self-contained.

### VII. Versioning & Release Hygiene
The extension version in `package.json` and `src/manifest.json` MUST follow
Semantic Versioning (MAJOR.MINOR.PATCH) for public releases and MUST stay in sync.
An optional 4th component (MAJOR.MINOR.PATCH.BUILD) is permitted during pre-release
AMO test signing. Every release MUST include a changelog entry in the README and a
built `.xpi` artifact in `web-ext-artifacts/`. All new features, options, or behavior
changes MUST review and synchronize both `README.md` (user documentation and changelog)
and `AMO/AMO_DESCRIPTION.md` (Add-on store listing). Breaking changes to user-facing
behavior or storage keys MUST bump MAJOR and be called out in the changelog.

## Technology & Platform Constraints

- **Language**: JavaScript (ES6+), HTML5, CSS3. No transpilation step.
- **Manifest**: Manifest V3 for Firefox.
- **Storage**: `browser.storage.local` for all persisted preferences.
- **Distribution**: Mozilla Add-ons (AMO) via `web-ext build`.
- **No build toolchain**: The extension MUST load as an unpacked directory
  without a build step.

## Development Workflow & Quality Gates

- **Spec-driven**: Features are specified (`spec.md`), planned (`plan.md`),
  and broken into tasks (`tasks.md`) before implementation.
- **Constitution Check**: Every plan MUST pass the Constitution Check gate
  before Phase 0 research; violations MUST be recorded in Complexity Tracking
  with justification.
- **Automated Testing Gate**: All new feature logic MUST have automated unit
  tests; `npm test` MUST pass with 0 failures before merge or release (Principle V).
- **Docstring & JSDoc Coverage Gate**: Every new or modified function touched in
  a diff MUST include complete JSDoc docstrings (`/** ... */`) documenting its
  description, `@param` types/descriptions, and `@returns`. Docstring coverage
  MUST meet or exceed 80% (Principle V).
- **Verification Gate**: A feature MUST NOT be merged or released without the
  `quickstart.md` scenarios passing (Principle V).
- **Documentation Review Gate**: `README.md` and `AMO/AMO_DESCRIPTION.md`
  MUST be reviewed and updated to reflect any new features, configuration
  options, or UI behaviors before release (Principle VII).
- **Review**: Changes touching permissions, storage keys, or Firefox-specific
  behavior MUST be reviewed against Principles II and IV.

## Governance

This constitution supersedes all other development practices for this project.
Amendments require: (1) a documented rationale, (2) a version bump per the
Semantic Versioning rules in Principle VII, and (3) propagation of any changed
principle across the dependent templates and active feature artifacts.
Compliance is verified at the plan gate and again before release.

**Version**: 1.4.0 | **Ratified**: 2026-08-28 | **Last Amended**: 2026-09-26
