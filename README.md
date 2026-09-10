# Star Fury Scripts

A collection of unofficial userscripts for **Star Fury V5**, maintained by **Zathman**.

The goal is straightforward: improve the game's usability, information density, responsiveness, and visual presentation without replacing Star Fury's native game logic. Where a script interacts with a form or game action, the native Star Fury control remains authoritative whenever practical.

## Scripts

### StarFury UX Suite 2.x

The UX Suite combines the earlier Star Fury interface projects into one modular userscript.

It currently covers:

- responsive navigation and empire-status HUD
- Advisor and compact Star Dock improvements
- Research page redesign, progress information, ETAs, queue presentation, and completion/max-state handling
- Buildings and Raze redesigns with production projections and economic summaries
- standardized numeric inputs and safer non-negative construction controls
- Star Dock and ship-management interface improvements
- ship power routing helpers, presets, and Leecher-specific controls
- mobile layouts designed separately where the desktop table structure does not translate well

The suite is designed to improve presentation and reduce repetitive interaction while preserving native links, form controls, validation, and submission behavior.

### Star Fury - Custom Race Portraits

A standalone cosmetic userscript for replacing the five native race portraits:

- Ferrion
- Terran
- Versuden
- Herogen
- Marvion

The script includes an embedded portrait set and also allows custom local images. User-provided portraits are stored in userscript-manager storage and are not uploaded to Star Fury or a third-party image host.

It supports per-race replacement and restore controls, built-in portraits, and crop/contain fit behavior.

This script is independent of the UX Suite and can be enabled or disabled separately.

## Installation

You will need a userscript manager such as **Tampermonkey** or **Violentmonkey**.

1. Open the `.user.js` file for the script you want to install.
2. Click **Raw** on GitHub.
3. Your userscript manager should detect the file and offer to install it.
4. Reload Star Fury.

## Design and safety principles

These scripts are intentionally conservative about game state.

**Native behavior first.** The scripts generally restyle or reorganize existing controls rather than reimplementing Star Fury's server-side behavior.

**No gameplay automation.** The scripts do not automate raids, combat, research decisions, construction strategy, or other unattended gameplay.

**No telemetry.** The scripts do not contain analytics or tracking.

**Minimal data access.** Most UX work is performed entirely against the current page. Some UX Suite features read other authenticated Star Fury pages on the same origin to calculate or display information that the game already exposes to the logged-in player.

**Local preferences.** Settings, caches, custom power presets, and portrait choices may use browser or userscript-manager storage.

**Fail conservatively.** Star Fury is an evolving game. When a native form or interface contract changes, the preferred behavior is to expose or preserve the native control rather than silently guess at a new mechanic.

## Development

The repository contains the installable `.user.js` files directly.

There is currently no separate build system, generated source tree, or matching `.txt` release maintained in the repository. The UX Suite 2.x code is internally organized into shared/core and page-specific modules within the combined userscript.

If you contribute a change, please edit the relevant `.user.js` source directly and test the affected Star Fury pages before submitting a pull request.

The Custom Race Portraits script is also distributed as a standalone `.user.js` file.

## Maintenance and contributions

This project is maintained on a best-effort basis.

There is no guarantee that these scripts will remain compatible with future Star Fury updates, receive timely fixes, or continue to be actively developed.

Forks, pull requests, bug fixes, documentation improvements, testing, and other contributions are welcome.

If the project becomes inactive or no longer meets your needs, feel free to fork it and continue development independently.

## Reporting problems

Star Fury's HTML and game mechanics can change, so a previously working userscript may occasionally need to be updated.

For a useful bug report, include:

- script name and version
- affected Star Fury page
- browser and userscript manager
- what you expected to happen
- what actually happened
- screenshot, console error, or relevant page source when applicable

Please avoid including session identifiers, account tokens, private messages, or other sensitive account information in reports.

## AI-assisted development

These scripts were developed with substantial AI assistance for code generation, refactoring, review, testing, and documentation.

Design decisions, game-mechanic observations, live testing, and release decisions are human-directed. AI-generated code is treated like any other contributed code: it must be reviewed and tested, and its presence is not a guarantee that a script is correct or compatible with future Star Fury changes.

## Disclaimer

This is an **unofficial fan project**. It is not affiliated with, endorsed by, or maintained by Star Fury or its developers.

These scripts are provided as-is and may stop working as Star Fury changes. No ongoing maintenance, compatibility, or support is guaranteed.

Before committing an important in-game action, verify the values and action shown by the native game interface.

## License

These scripts are licensed under the MIT License. See [`LICENSE`](LICENSE) for details.

Star Fury names, artwork, and other game assets remain the property of their respective owners.
