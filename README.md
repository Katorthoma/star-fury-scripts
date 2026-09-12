# Star Fury Scripts

A collection of unofficial userscripts for **Star Fury V5**, maintained by **Zathman**.

The goal is straightforward: improve Star Fury's usability, information density, responsiveness, and visual presentation without replacing the game's native logic. Where a script interacts with a form or game action, the native Star Fury control remains authoritative whenever practical.

## Scripts

| Script | Current version | Purpose | Install |
| --- | ---: | --- | --- |
| **StarFury UX Suite** | 2.2.6 | Broad UI/UX improvements across research, buildings, Star Dock, ship management, navigation, and mobile layouts | [Install](https://raw.githubusercontent.com/Katorthoma/star-fury-scripts/main/StarFury-UX-Suite.user.js) |
| **Alliance Intel Board** | 0.16.0 | Consolidates alliance scan posts into a tactical intelligence board with freshness, ship composition, sector data, war activity, and target helpers | [Install](https://raw.githubusercontent.com/Katorthoma/star-fury-scripts/main/StarFury-Alliance-Intel-Board.user.js) |
| **Custom Race Portraits** | 1.2.2 | Replaces native race portraits with an embedded portrait set or locally stored custom images | [Install](https://raw.githubusercontent.com/Katorthoma/star-fury-scripts/main/StarFury-Custom-Race-Portraits.user.js) |

All three scripts are standalone. They can be installed independently or used together.

## StarFury UX Suite

The UX Suite combines the earlier Star Fury interface projects into one modular userscript.

It currently covers:

- responsive navigation and empire-status HUD
- unified Advisor + compact Star Dock with persistent open/closed state and reduced page-load flashing
- Research redesign with progress information, ETAs, queue presentation, and completed/max-state handling
- Buildings and Raze redesigns with production projections and economic summaries
- standardized numeric inputs and safer non-negative construction controls
- CIC-style Star Dock overview with compact multi-column ship cards, live operational states, hull/shield telemetry, and contextual repair controls
- per-dock bulk Repair/Disable actions that reuse Star Fury's native confirmed actions and refresh once after the batch
- ship power-routing helpers, presets, Leecher-specific controls, role transfer/swap helpers, and Fixed/Flexible handling
- mobile layouts designed separately where desktop tables do not translate cleanly

The suite is designed to reduce repetitive interaction and improve presentation while preserving native links, form controls, validation, and submission behavior.

## Alliance Intel Board

The Alliance Intel Board turns scan posts from a configured Alliance Forum thread into a compact, sortable intelligence view intended for active war coordination and Discord sharing.

### Board data

It can consolidate and surface:

- General, Defence, and Dock scan coverage with scan age/freshness
- current Networth and rank from the Sector Browser
- Asteroids and Land when that column is enabled
- probe counts and recent probe changes
- Fabrication Plants and Defence Platforms
- reported Empire Defence
- Defence Scan Break Order and Pulls
- ship composition ordered from larger/more advanced hulls downward
- per-ship states such as Returning, Disabled, Upgrading, and Building
- Attack Shields and Warp Shields state
- alliance assignments and local notes
- locally cached Alliance News relevant to each enemy

Expanded detail views retain the underlying scan history and expose the latest General/Defence information without altering the original forum posts.

### Tactical helpers

The board includes several deliberately labeled **heuristics**, not authoritative combat predictions:

- scan freshness states to distinguish current intel from aging, stale, and tactically dead observations
- Breaker-candidate detection based on attack sequencing in Alliance News
- defeated/newbie-protection indicators after a recorded enemy defeat
- relative target ratings based on available Defence, Break Order, territory, freshness, and small operational-friction adjustments
- configurable stars for the strongest current target candidates

These indicators are decision aids. They do not know your alliance's available attack strength, hidden modifiers, or every current game-state change. Confirm important attacks against the native game data.

### Server-friendly caching

The Intel Board is intentionally conservative about requests to Star Fury:

- Alliance News is cached locally and normally refreshed no more than once every **30 minutes** while the board is in use
- Sector Browser data is cached locally and normally refreshed no more than once per **hour**
- one Sector Browser request enriches all empires returned by that sector page rather than fetching once per empire
- visiting Alliance News or Sector Browser can contribute the page already loaded in your browser to the local cache without another request
- scan posts are read from the configured Alliance Forum thread rather than copied to an external service

There is no telemetry and stored board data remains in the browser.

### Configuration and layout

The board supports:

- configurable Alliance scan-thread URL, so a new round/season does not require editing the userscript
- per-column visibility controls, with Empire always retained
- hidden-empires management
- content-fit mode for a compact centered board
- optional flexible-width mode for very wide displays
- a frozen Empire column during horizontal scrolling
- compact Share View for screenshots
- built-in Status and Legend panels

To change the scan thread, use your userscript manager's menu while on Star Fury and choose the Alliance Intel Board scan-thread configuration command.

## Custom Race Portraits

A standalone cosmetic userscript for replacing the five native race portraits:

- Ferrion
- Terran
- Versuden
- Herogen
- Marvion

The script includes an embedded portrait set and also allows custom local images. User-provided portraits are stored in userscript-manager storage and are not uploaded to Star Fury or a third-party image host.

It supports per-race replacement and restore controls, built-in portraits, and crop/contain fit behavior.

## Installation

You will need a userscript manager such as **Tampermonkey** or **Violentmonkey**.

1. Choose the **Install** link for the script you want from the table above, or open its `.user.js` file on GitHub and click **Raw**.
2. Your userscript manager should detect the userscript and offer to install it.
3. Accept the installation.
4. Reload Star Fury.

The scripts include GitHub `@updateURL` and `@downloadURL` metadata, so compatible userscript managers can detect later versions from this repository.

## Design and safety principles

These scripts are intentionally conservative about game state.

**Native behavior first.** The scripts generally restyle, summarize, or reorganize information and controls rather than attempting to replace Star Fury's server-side behavior.

**No unattended gameplay automation.** The scripts do not autonomously raid, attack, research, construct ships, or make strategic decisions for the player.

**No telemetry.** The scripts contain no analytics or tracking.

**Minimal data access.** Most UX work is performed against the current page. Features that enrich the interface may read other authenticated Star Fury pages on the same origin when the game already exposes that information to the logged-in player.

**Local preferences and caches.** Settings, caches, hidden-empires lists, notes, assignments, power presets, and portrait choices may use browser or userscript-manager storage.

**Fail conservatively.** Star Fury is an evolving game. When a native form or interface contract changes, the preferred behavior is to preserve or expose the native control rather than silently invent a replacement mechanic.

## Development

The repository contains the directly installable `.user.js` files. There is currently no separate build system or generated source tree.

If you contribute a change, edit the relevant `.user.js` source directly and test the affected Star Fury pages before submitting a pull request.

The current public scripts are:

- `StarFury-UX-Suite.user.js`
- `StarFury-Alliance-Intel-Board.user.js`
- `StarFury-Custom-Race-Portraits.user.js`

## Maintenance and contributions

This project is maintained on a best-effort basis.

There is no guarantee that these scripts will remain compatible with future Star Fury updates, receive timely fixes, or continue to be actively developed.

Forks, pull requests, bug fixes, documentation improvements, testing, and other contributions are welcome. If the project becomes inactive or no longer meets your needs, feel free to fork it and continue development independently.

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

These scripts are licensed under the [MIT License](LICENSE).

Star Fury names, artwork, and other game assets remain the property of their respective owners.
