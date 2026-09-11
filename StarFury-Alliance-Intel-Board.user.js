// ==UserScript==
// @name         StarFury - Alliance Intel Board
// @namespace    starfuryx.com
// @version      0.16.0
// @author       Zathman
// @license      MIT
// @description  Builds a compact alliance intelligence board with scan freshness, current sector data, break order, target heuristics, and cached alliance-war news.
// @homepageURL  https://github.com/Katorthoma/star-fury-scripts
// @updateURL    https://raw.githubusercontent.com/Katorthoma/star-fury-scripts/main/StarFury-Alliance-Intel-Board.user.js
// @downloadURL  https://raw.githubusercontent.com/Katorthoma/star-fury-scripts/main/StarFury-Alliance-Intel-Board.user.js
// @match        https://game.starfuryx.com/*
// @icon         https://game.starfuryx.com/images/favicon/favicon-32x32.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    /*
     * StarFury - Alliance Intel Board 0.16.0
     * -------------------------------------------------------------------------
     * PUBLIC RELEASE
     * - v0.16.0 is the first publication-ready build. Runtime behavior is the
     *   stabilized v0.15.x feature set; this release formalizes metadata and
     *   licensing for distribution.
     *
     * PURPOSE
     * - Read scan posts already present in an Alliance Forum thread.
     * - Merge them into one row per scanned empire.
     * - Show scan coverage/freshness, general intel, probe counts, defence,
     *   ship composition, shield/warp state, assignments, and notes.
     * - Keep full scan detail available without destroying or rewriting the
     *   native forum posts.
     * - Open the board in a full-screen modal so the alliance forum layout does
     *   not constrain the intelligence table.
     * - Provide a compact Share View intended for screenshots into Discord.
     * - Use a centralized typography/color hierarchy so information importance
     *   is consistent across the board, detail panels, legend, and controls.
     *
     * COEXISTENCE CONTRACT
     * - Standalone companion to StarFury UX Suite. No UX Suite JS globals are
     *   required or touched.
     * - Uses its own sfib-* IDs/classes. It reads the native scan-thread DOM
     *   and Alliance News, but does not rewrite either data source.
     * - Inserts only a small launcher before the native scan thread; the board
     *   itself is appended as an isolated full-screen modal. Alliance News pages
     *   are only passively read into cache and receive no visual modifications.
     * - Does not alter forms, game values, links, submissions, or game timers.
     * - Uses StarFury UX Suite CSS variables when available, with fallbacks when
     *   the Suite is disabled.
     * - Alliance News is cached locally. Routine refresh is at most once every
     *   30 minutes while the board is actually being used; additional paged
     *   requests are made only when needed to bridge a gap in cached history.
     * - Visiting Alliance News passively contributes the already-loaded page to
     *   the cache without generating another request.
     * - Sector Browser data is cached locally by sector and refreshed at most once
     *   per hour while the board is open. One sector request enriches every empire
     *   returned on that browser page; the script never fetches once per empire.
     * - Visiting Sector Browser passively contributes the already-loaded sector page
     *   to the cache with zero additional requests.
     * - Expanded detail tables are isolated from main-table sizing/sticky CSS,
     *   use a responsive full-width history layout, and keep readable text sizes.
     * - Detail cards use a content-aware responsive grid: the ship table no longer
     *   monopolizes horizontal space, War Activity receives a larger share, and on
     *   narrower content-fit boards War Activity drops to a full-width row rather
     *   than becoming an unreadably narrow sidebar.
     * - Ship summaries and detail rows use the current Ship Stats hull progression,
     *   displaying the most advanced/largest hulls first.
     * - Every main-table column except Empire can be shown/hidden independently
     *   from Config. Ast/Land, Ship Picture, and Notes default off; preferences stay local.
     * - Board width has two modes. Content-fit is the default: the modal shrink-wraps
     *   its visible columns, stays centered, and exposes a horizontal scrollbar when
     *   the content is wider than the viewport. Optional Flexible Width restores the
     *   full-window behavior for users who want the board to expand with wide windows.
     * - The scan-thread URL is configurable from the userscript extension menu.
     *   Only the configured Alliance Forum TID renders the board, so round/season
     *   changes do not require editing the script source.
     * - Placeholder em dashes use one deliberately quiet visual treatment across
     *   the board so zero/missing values never compete with tactical data.
     * - Notes can still be hidden quickly from its header; individual empires
     *   can also be hidden locally and restored from the Config panel.
     * - Scan freshness has four states: fresh <1h, warm <12h, old <48h,
     *   and tactically dead at 48h+.
     * - Scan/news age calculations use a stable server-clock snapshot captured at
     *   page load, preventing a news refresh or DOM rewrite from resetting scan
     *   ages to "now".
     * - A built-in Legend panel explains scan freshness, ship-status shorthand,
     *   shield/warp badges, war-intel heuristics, and the meaning of key numbers.
     * - Main column headers include concise hover help for fast in-context reference.
     * - Detail evidence rows wrap safely inside their cards. Current Sector uses a two-row
     *   layout so its label/cache age and current values cannot overlap in narrow cards.
     * - Raw scan visibility is controlled from the compact launcher only; the
     *   full-screen board omits that low-frequency control to keep its toolbar focused.
     * - Defence Scan Break Order / Pulls are surfaced beside Defence, and a clearly
     *   labeled relative target heuristic ranks likely good targets without pretending
     *   to know alliance attack strength. Top-target stars are configurable.
     * - Recent Attack Shields and Warp Shields apply small explicit heuristic target
     *   penalties (-10 / -4 points) as operational friction, not as claimed combat math.
     * - No external libraries. No telemetry. Stored data never leaves the browser.
     */

    const pageUrl = new URL(window.location.href);
    const IS_ALLIANCE_THREAD = /\/thread\.php$/i.test(pageUrl.pathname) && pageUrl.searchParams.get('forum') === 'alliance';
    const IS_ALLIANCE_NEWS_PAGE = /\/news\.php$/i.test(pageUrl.pathname) && pageUrl.searchParams.get('n') === 'alliance';
    const IS_SECTOR_BROWSER_PAGE = /\/browser\.php$/i.test(pageUrl.pathname);

    const SCAN_THREAD_CONFIG_KEY = 'sfib:scan-thread-url:v1';
    const DEFAULT_SCAN_THREAD_URL = 'https://game.starfuryx.com/thread.php?forum=alliance&TID=3';

    function getGlobalSetting(key, fallback = '') {
        try {
            if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        } catch { /* fall through */ }
        try { return localStorage.getItem(key) ?? fallback; }
        catch { return fallback; }
    }

    function setGlobalSetting(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
                return;
            }
        } catch { /* fall through */ }
        try { localStorage.setItem(key, value); }
        catch { /* optional local setting */ }
    }

    function normalizeScanThreadUrl(value) {
        try {
            const url = new URL(String(value || '').trim(), window.location.origin);
            if (url.origin !== window.location.origin) return '';
            if (!/\/thread\.php$/i.test(url.pathname)) return '';
            if (url.searchParams.get('forum') !== 'alliance') return '';
            const tid = text(url.searchParams.get('TID'));
            if (!/^\d+$/.test(tid)) return '';
            const normalized = new URL('/thread.php', window.location.origin);
            normalized.searchParams.set('forum', 'alliance');
            normalized.searchParams.set('TID', tid);
            return normalized.toString();
        } catch {
            return '';
        }
    }

    function scanThreadIdentity(value) {
        const normalized = normalizeScanThreadUrl(value);
        if (!normalized) return '';
        const url = new URL(normalized);
        return `${url.searchParams.get('forum')}:${url.searchParams.get('TID')}`;
    }

    const CONFIGURED_SCAN_THREAD_URL = normalizeScanThreadUrl(getGlobalSetting(SCAN_THREAD_CONFIG_KEY, DEFAULT_SCAN_THREAD_URL))
        || DEFAULT_SCAN_THREAD_URL;
    const CONFIGURED_SCAN_THREAD_ID = new URL(CONFIGURED_SCAN_THREAD_URL).searchParams.get('TID') || 'unknown';
    const IS_CONFIGURED_SCAN_THREAD = IS_ALLIANCE_THREAD
        && scanThreadIdentity(pageUrl.toString()) === scanThreadIdentity(CONFIGURED_SCAN_THREAD_URL);

    function registerUserscriptMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand('Configure Alliance Scan Thread URL…', () => {
            const current = normalizeScanThreadUrl(getGlobalSetting(SCAN_THREAD_CONFIG_KEY, CONFIGURED_SCAN_THREAD_URL))
                || CONFIGURED_SCAN_THREAD_URL;
            const entered = window.prompt(
                'Paste the Alliance Forum thread URL where scans are posted.\n\nExample:\nhttps://game.starfuryx.com/thread.php?forum=alliance&TID=3',
                current
            );
            if (entered == null) return;
            const normalized = normalizeScanThreadUrl(entered);
            if (!normalized) {
                window.alert('That does not look like a valid StarFury Alliance Forum thread URL. Expected thread.php?forum=alliance&TID=<number>.');
                return;
            }
            setGlobalSetting(SCAN_THREAD_CONFIG_KEY, normalized);
            const changed = normalized !== current;
            window.alert(`Alliance Scan Thread saved:\n${normalized}${changed ? '\n\nReload/open that thread to use the Intel Board.' : ''}`);
        });
        GM_registerMenuCommand('Open Configured Alliance Scan Thread', () => {
            const configured = normalizeScanThreadUrl(getGlobalSetting(SCAN_THREAD_CONFIG_KEY, CONFIGURED_SCAN_THREAD_URL))
                || CONFIGURED_SCAN_THREAD_URL;
            window.location.href = configured;
        });
    }

    registerUserscriptMenu();

    // The userscript menu is intentionally available on every StarFury page,
    // but all page-reading/rendering work remains restricted to the three data
    // surfaces used by the board.
    if (!IS_ALLIANCE_THREAD && !IS_ALLIANCE_NEWS_PAGE && !IS_SECTOR_BROWSER_PAGE) return;

    const STYLE_ID = 'sfib-intel-board-styles';
    const BOARD_ID = 'sfib-intel-board';
    const THREAD_ID = IS_ALLIANCE_THREAD
        ? (pageUrl.searchParams.get('TID') || CONFIGURED_SCAN_THREAD_ID)
        : CONFIGURED_SCAN_THREAD_ID;
    const STORAGE_PREFIX = `sfib:${THREAD_ID}:`;
    const NEWS_CACHE_KEY = 'sfib:alliance-news-cache:v1';
    const SECTOR_CACHE_KEY = 'sfib:sector-browser-cache:v1';
    const NEWS_TTL_MS = 30 * 60 * 1000;
    const SECTOR_TTL_MS = 60 * 60 * 1000;
    const NEWS_RETENTION_MS = 50 * 60 * 60 * 1000;
    const NEWS_EPISODE_GAP_MS = 20 * 60 * 1000;
    const POST_DEFEAT_PROTECTION_MS = 48 * 60 * 60 * 1000;
    const FRESH_MS = 60 * 60 * 1000;   // green: under 1 hour
    const WARM_MS = 12 * 60 * 60 * 1000; // yellow: 1h to 11h59m
    const DEAD_INTEL_MS = 48 * 60 * 60 * 1000; // grey: intel old enough to be tactically dead
    const DEFAULT_TARGET_STAR_COUNT = 5;

    // Main-table column visibility. Empire is intentionally mandatory so the
    // board always retains a stable row identity even in highly customized views.
    const COLUMN_DEFS = Object.freeze([
        { id: 'networth', label: 'Networth / #', defaultVisible: true },
        { id: 'territory', label: 'Ast / Land', defaultVisible: false },
        { id: 'race', label: 'Race', defaultVisible: true },
        { id: 'scans', label: 'Scans / Age', defaultVisible: true },
        { id: 'probes', label: 'Probes', defaultVisible: true },
        { id: 'infra', label: 'Infra', defaultVisible: true },
        { id: 'def', label: 'Def', defaultVisible: true },
        { id: 'bo', label: 'BO / Pulls', defaultVisible: true },
        { id: 'ships', label: 'Ship Picture', defaultVisible: false },
        { id: 'shields', label: 'S/W', defaultVisible: true },
        { id: 'war', label: 'War', defaultVisible: true },
        { id: 'target', label: 'Target?', defaultVisible: true },
        { id: 'assigned', label: 'Assigned', defaultVisible: true },
        { id: 'notes', label: 'Notes', defaultVisible: false }
    ]);
    const COLUMN_IDS = new Set(COLUMN_DEFS.map(column => column.id));

    function loadColumnVisibility() {
        const visibility = {};
        for (const column of COLUMN_DEFS) {
            const key = `column-visible:${column.id}`;
            const stored = getStored(key, '');
            if (stored === 'true' || stored === 'false') {
                visibility[column.id] = stored !== 'false';
                continue;
            }
            // Migrate the two display preferences that existed before v0.12.
            // If no preference has ever been stored, use the current column default.
            if (column.id === 'race') {
                const legacy = getStored('race-visible', '');
                visibility[column.id] = legacy === 'true' || legacy === 'false'
                    ? legacy !== 'false'
                    : column.defaultVisible !== false;
            } else if (column.id === 'notes') {
                const legacy = getStored('notes-visible', '');
                visibility[column.id] = legacy === 'true' || legacy === 'false'
                    ? legacy !== 'false'
                    : column.defaultVisible !== false;
            } else {
                visibility[column.id] = column.defaultVisible !== false;
            }
        }
        return visibility;
    }

    const MONTHS = Object.freeze({
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, sept: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11
    });

    const TYPE_ORDER = Object.freeze(['general', 'defence', 'fullDock', 'stealth']);
    const TYPE_META = Object.freeze({
        general:  { short: 'GEN',  name: 'General Scan' },
        defence:  { short: 'DEF',  name: 'Defence Scan' },
        fullDock: { short: 'DOCK', name: 'Full Dock Scan' },
        stealth:  { short: 'STL',  name: 'Stealth Scan' }
    });

    const CLASS_SHORT = Object.freeze({
        'Corvette': 'Vette',
        'Wolverine': 'Wolv',
        'Talon': 'Talon',
        'Raven': 'Raven',
        'Raptor': 'Raptor',
        'Eagle': 'Eagle',
        'Frigate': 'Frig',
        'Destroyer': 'Dest',
        'GunShip': 'GunShip',
        'Falcon': 'Falcon',
        'Cruiser': 'Cruiser',
        'Defender': 'Defender',
        'Spectre': 'Spectre',
        'Sovereign': 'Sov',
        'Scorpio': 'Scorpio',
        'Dreadnought': 'Dread',
        'Vanguard': 'Vanguard',
        'Sentinal': 'Sentinal',
        'Sentinel': 'Sentinel',
        'Star Fury': 'Star Fury'
    });

    // Canonical hull progression from the current Ship Stats table. The board
    // displays this in reverse so the largest/most advanced hulls are read first.
    const SHIP_CLASS_ORDER = Object.freeze([
        'Corvette', 'Wolverine', 'Talon', 'Raven', 'Raptor', 'Eagle', 'Frigate',
        'Destroyer', 'GunShip', 'Falcon', 'Cruiser', 'Defender', 'Spectre',
        'Sovereign', 'Scorpio', 'Dreadnought', 'Vanguard', 'Sentinal', 'Star Fury'
    ]);
    const SHIP_CLASS_RANK = new Map(SHIP_CLASS_ORDER.map((name, index) => [name.toLowerCase(), index]));
    SHIP_CLASS_RANK.set('sentinel', SHIP_CLASS_RANK.get('sentinal'));

    function shipClassRank(className) {
        const rank = SHIP_CLASS_RANK.get(text(className).toLowerCase());
        return Number.isInteger(rank) ? rank : -1;
    }

    function compareShipClassesDesc(a, b) {
        const ar = shipClassRank(a);
        const br = shipClassRank(b);
        if (ar !== br) return br - ar;
        return text(a).localeCompare(text(b));
    }

    const DOCK_ORDER = Object.freeze({ Attack: 0, Defence: 1, Raider: 2, Leecher: 3 });

    function compareShipRows(a, b) {
        // Preserve Full Dock role grouping when it exists, but order hulls within
        // each dock from most advanced to least advanced.
        const ad = Object.prototype.hasOwnProperty.call(DOCK_ORDER, a.dock) ? DOCK_ORDER[a.dock] : 99;
        const bd = Object.prototype.hasOwnProperty.call(DOCK_ORDER, b.dock) ? DOCK_ORDER[b.dock] : 99;
        if (ad !== bd) return ad - bd;
        const byClass = compareShipClassesDesc(a.className, b.className);
        if (byClass) return byClass;
        return text(a.status).localeCompare(text(b.status));
    }

    function text(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function placeholderHtml(title = '') {
        const label = title || 'No value';
        return `<span class="sfib-placeholder" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">—</span>`;
    }


    function compactZeroPlaceholderHtml(value, title = '') {
        return Number.isFinite(value) && value !== 0
            ? escapeHtml(formatCompact(value))
            : placeholderHtml(title || (value === 0 ? '0' : 'No value reported'));
    }

    function numeric(value) {
        const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
    }

    function formatNumber(value) {
        return Number.isFinite(value) ? Math.round(value).toLocaleString() : '—';
    }

    function formatCompact(value) {
        if (!Number.isFinite(value)) return '—';
        const abs = Math.abs(value);
        if (abs >= 1_000_000) {
            const digits = abs >= 10_000_000 ? 1 : 2;
            return `${(value / 1_000_000).toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/g, '')}m`;
        }
        if (abs >= 100_000) return `${Math.round(value / 1_000)}k`;
        if (abs >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
        return Math.round(value).toLocaleString();
    }


    function displayEmpireName(value) {
        return text(value).replace(/\s*\(\d+:\d+\)\s*$/, '');
    }

    function getStored(key, fallback = '') {
        try {
            if (typeof GM_getValue === 'function') return GM_getValue(`${STORAGE_PREFIX}${key}`, fallback);
        } catch { /* fall through */ }
        try { return localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? fallback; }
        catch { return fallback; }
    }

    function setStored(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(`${STORAGE_PREFIX}${key}`, value);
                return;
            }
        } catch { /* fall through */ }
        try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, value); }
        catch { /* optional local preference */ }
    }

    function getGlobalJson(key, fallback) {
        let raw = null;
        try {
            if (typeof GM_getValue === 'function') raw = GM_getValue(key, null);
        } catch { /* fall through */ }
        if (raw == null) {
            try { raw = localStorage.getItem(key); } catch { /* ignore */ }
        }
        if (raw == null || raw === '') return fallback;
        try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
        catch { return fallback; }
    }

    function setGlobalJson(key, value) {
        const raw = JSON.stringify(value);
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, raw);
                return;
            }
        } catch { /* fall through */ }
        try { localStorage.setItem(key, raw); }
        catch { /* optional local cache */ }
    }

    function empireStorageKey(empireName, field) {
        return `empire:${text(empireName).toLowerCase()}:${field}`;
    }

    function naiveEpoch(parts) {
        return Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
    }

    function parseFullServerClock(value) {
        const match = text(value).match(/([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/i);
        if (!match) return null;
        const month = MONTHS[match[1].toLowerCase()];
        if (!Number.isInteger(month)) return null;
        return {
            year: Number(match[3]),
            month,
            day: Number(match[2]),
            hour: Number(match[4]),
            minute: Number(match[5]),
            second: Number(match[6])
        };
    }

    function detectServerClockAnchor() {
        // Prefer StarFury's full server timestamp embedded in the original page.
        // We snapshot it once and advance it with elapsed wall-clock time. This
        // keeps scan ages stable even if another script temporarily rewrites,
        // hides, duplicates, or removes #headertext while this board is open.
        for (const script of Array.from(document.scripts || [])) {
            const match = script.textContent?.match(/var\s+currenttime\s*=\s*['"]([^'"]+)['"]/i);
            const parts = match ? parseFullServerClock(match[1]) : null;
            if (parts) return parts;
        }

        // Fallback to the visible StarFury clock. It omits the year, so use the
        // browser year only for this one-time fallback rather than on every age
        // refresh.
        const headerText = text(document.querySelector('#headertext')?.textContent || '');
        const match = headerText.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*-\s*(\d{1,2}):(\d{2}):(\d{2})/i);
        if (match) {
            const month = MONTHS[match[2].toLowerCase()];
            if (Number.isInteger(month)) {
                return {
                    year: new Date().getFullYear(),
                    month,
                    day: Number(match[1]),
                    hour: Number(match[3]),
                    minute: Number(match[4]),
                    second: Number(match[5])
                };
            }
        }

        const candidate = new Date();
        return {
            year: candidate.getFullYear(),
            month: candidate.getMonth(),
            day: candidate.getDate(),
            hour: candidate.getHours(),
            minute: candidate.getMinutes(),
            second: candidate.getSeconds()
        };
    }

    const SERVER_CLOCK_ANCHOR_PARTS = Object.freeze(detectServerClockAnchor());
    const SERVER_CLOCK_ANCHOR_EPOCH = naiveEpoch(SERVER_CLOCK_ANCHOR_PARTS);
    const SERVER_CLOCK_ANCHOR_WALL = Date.now();

    function getServerEpoch() {
        return SERVER_CLOCK_ANCHOR_EPOCH + Math.max(0, Date.now() - SERVER_CLOCK_ANCHOR_WALL);
    }

    function getServerParts() {
        // Convert our stable, advancing server-clock snapshot back into calendar
        // components for scan timestamps that omit the year.
        const candidate = new Date(getServerEpoch());
        return {
            year: candidate.getUTCFullYear(),
            month: candidate.getUTCMonth(),
            day: candidate.getUTCDate(),
            hour: candidate.getUTCHours(),
            minute: candidate.getUTCMinutes(),
            second: candidate.getUTCSeconds()
        };
    }

    function parseNewsTimestamp(value) {
        const match = text(value).match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d{2})\s*-\s*(\d{1,2}):(\d{2}):(\d{2})/i);
        if (!match) return null;
        const month = MONTHS[match[2].toLowerCase()];
        if (!Number.isInteger(month)) return null;
        return naiveEpoch({
            year: Number(match[3]),
            month,
            day: Number(match[1]),
            hour: Number(match[4]),
            minute: Number(match[5]),
            second: Number(match[6])
        });
    }

    function normalizeEmpireKey(value) {
        return text(value).toLowerCase();
    }

    function classifyNewsMessage(message) {
        const value = text(message);
        let match;

        match = value.match(/^(.+?\(\d+:\d+\)) successfully defended their Empire against attack from (.+?\(\d+:\d+\)) \[([^\]]+)\]$/i);
        if (match) return { kind: 'enemyFail', defender: text(match[1]), attacker: text(match[2]), alliance: text(match[3]) };

        match = value.match(/^(.+?\(\d+:\d+\)) unsuccessfully defended their Empire and lost ([\d,]+) (.+?) to (.+?\(\d+:\d+\)) \[([^\]]+)\]$/i);
        if (match) return {
            kind: 'enemySuccess', defender: text(match[1]), attacker: text(match[4]), alliance: text(match[5]),
            amount: numeric(match[2]), resource: text(match[3])
        };

        match = value.match(/^(.+?\(\d+:\d+\)) was defeated by (.+?\(\d+:\d+\)) \[([^\]]+)\]$/i);
        if (match) return { kind: 'allianceDefeatedByEnemy', defender: text(match[1]), attacker: text(match[2]), alliance: text(match[3]) };

        match = value.match(/^(.+?\(\d+:\d+\)) attacked and defeated (.+?\(\d+:\d+\)) \[([^\]]+)\]$/i);
        if (match) return { kind: 'enemyDefeated', attacker: text(match[1]), target: text(match[2]), alliance: text(match[3]) };

        match = value.match(/^(.+?\(\d+:\d+\)) attacked, but did not manage to break through the defences of (.+?\(\d+:\d+\)) \[([^\]]+)\]$/i);
        if (match) return { kind: 'allyFailAgainstEnemy', attacker: text(match[1]), target: text(match[2]), alliance: text(match[3]) };

        match = value.match(/^(.+?\(\d+:\d+\)) conquered (.+?) from (.+?\(\d+:\d+\)) \[([^\]]+)\]$/i);
        if (match) return { kind: 'allySuccessAgainstEnemy', attacker: text(match[1]), target: text(match[3]), alliance: text(match[4]), conquest: text(match[2]) };

        match = value.match(/^(.+?)(?: \(\d+:\d+\))? has Respawned$/i);
        if (match) return { kind: 'respawn', empire: text(match[1]) };

        return { kind: 'other' };
    }

    function newsEventSignature(event) {
        return `${event.epoch || 0}|${event.message}`;
    }

    function parseAllianceNewsDocument(doc) {
        const table = doc.querySelector('table.newstable');
        if (!table) return { events: [], offsets: [] };
        const events = [];
        for (const row of Array.from(table.rows || []).slice(1)) {
            const cells = cellTexts(row);
            if (cells.length < 2) continue;
            const epoch = parseNewsTimestamp(cells[0]);
            const message = cells.slice(1).join(' ');
            if (!Number.isFinite(epoch) || !message) continue;
            const messageCell = row.children?.[1] || null;
            const color = text(messageCell?.querySelector('font')?.getAttribute('color') || '');
            const parsed = classifyNewsMessage(message);
            events.push({
                epoch,
                dateText: cells[0],
                message,
                color,
                ...parsed
            });
        }
        const offsets = Array.from(doc.querySelectorAll('.newspagelinks a'))
            .map(anchor => {
                try { return Number(new URL(anchor.getAttribute('href') || '', window.location.origin).searchParams.get('start') || 0); }
                catch { return 0; }
            })
            .filter(value => Number.isFinite(value) && value >= 0)
            .filter((value, index, array) => array.indexOf(value) === index)
            .sort((a, b) => a - b);
        return { events, offsets };
    }

    function loadNewsCache() {
        const cache = getGlobalJson(NEWS_CACHE_KEY, null);
        if (!cache || !Array.isArray(cache.events)) {
            return { version: 1, initialized: false, lastSyncWall: 0, lastPassiveWall: 0, events: [] };
        }
        return {
            version: 1,
            initialized: Boolean(cache.initialized),
            lastSyncWall: Number(cache.lastSyncWall) || 0,
            lastPassiveWall: Number(cache.lastPassiveWall) || 0,
            events: cache.events.filter(event => event && Number.isFinite(Number(event.epoch)) && event.message)
        };
    }

    function mergeNewsEvents(existing, incoming) {
        const map = new Map();
        for (const event of [...(existing || []), ...(incoming || [])]) map.set(newsEventSignature(event), event);
        const cutoff = getServerEpoch() - NEWS_RETENTION_MS;
        return Array.from(map.values())
            .filter(event => event.epoch >= cutoff)
            .sort((a, b) => b.epoch - a.epoch);
    }

    function saveNewsCache(cache) {
        cache.events = mergeNewsEvents([], cache.events || []);
        setGlobalJson(NEWS_CACHE_KEY, cache);
    }

    function passivelyCacheCurrentNewsPage() {
        const parsed = parseAllianceNewsDocument(document);
        if (!parsed.events.length) return;
        const cache = loadNewsCache();
        cache.events = mergeNewsEvents(cache.events, parsed.events);
        cache.lastPassiveWall = Date.now();
        // If a complete cache already exists, viewing page 1 itself is a valid
        // fresh read of the newest news and can satisfy the 30-minute TTL.
        const start = Number(pageUrl.searchParams.get('start') || 0);
        if (cache.initialized && start === 0) cache.lastSyncWall = Date.now();
        saveNewsCache(cache);
    }

    function sectorCoordsFromTarget(value) {
        const match = text(value).match(/\((\d+):(\d+)\)\s*$/);
        if (!match) return null;
        return { gid: Number(match[1]), sid: Number(match[2]), key: `${Number(match[1])}:${Number(match[2])}` };
    }

    function detectSectorStatus(cell) {
        const classes = Array.from(cell?.classList || []).join(' ').toLowerCase();
        if (/sectornewbmode|newb/.test(classes)) return 'newb';
        if (/vacation/.test(classes)) return 'vacation';
        if (/delet|disband/.test(classes)) return 'deleting';
        if (/dead/.test(classes)) return 'dead';
        if (/ownempire/.test(classes)) return 'own';
        return 'active';
    }

    function parseSectorBrowserDocument(doc, gid, sid) {
        const table = doc.querySelector('table.sectorbrowsertable');
        if (!table) return { gid, sid, empires: [] };
        const empires = [];
        for (const row of Array.from(table.rows || [])) {
            const cell = row.cells?.[1] || null;
            if (!cell) continue;
            const empireLink = cell.querySelector('a[href*="messages.php?view=new"]');
            const empireName = text(empireLink?.textContent || '');
            if (!empireName) continue;
            const statLine = Array.from(cell.querySelectorAll('p')).map(node => text(node.textContent)).find(value => /Asteroids:/i.test(value)) || '';
            const match = statLine.match(/Asteroids:\s*([\d,]+)\s*-\s*Land:\s*([\d,]+)\s*-\s*Networth:\s*([\d,]+)\s*-\s*Rank:\s*([\d,]+)/i);
            if (!match) continue;
            const fullTarget = `${empireName} (${gid}:${sid})`;
            const tag = text(cell.querySelector('.GLtag, .SLtag')?.textContent || '');
            empires.push({
                target: fullTarget,
                key: normalizeEmpireKey(fullTarget),
                empireName,
                gid,
                sid,
                asteroids: numeric(match[1]),
                land: numeric(match[2]),
                networth: numeric(match[3]),
                rank: numeric(match[4]),
                status: detectSectorStatus(cell),
                leaderTag: tag
            });
        }
        return { gid, sid, empires };
    }

    function loadSectorCache() {
        const cache = getGlobalJson(SECTOR_CACHE_KEY, null);
        if (!cache || !cache.sectors || typeof cache.sectors !== 'object') {
            return { version: 1, sectors: {} };
        }
        return { version: 1, sectors: cache.sectors };
    }

    function saveSectorCache(cache) {
        setGlobalJson(SECTOR_CACHE_KEY, { version: 1, sectors: cache?.sectors || {} });
    }

    function browserPageCoords(doc = document) {
        const gid = Number(pageUrl.searchParams.get('GID') || doc.querySelector('select[name="GID"] option:checked')?.value || 0);
        const sid = Number(pageUrl.searchParams.get('SID') || doc.querySelector('select[name="SID"] option:checked')?.value || 0);
        return Number.isFinite(gid) && gid > 0 && Number.isFinite(sid) && sid > 0 ? { gid, sid, key: `${gid}:${sid}` } : null;
    }

    function cacheSectorParse(parsed, passive = false) {
        if (!parsed?.empires?.length) return false;
        const cache = loadSectorCache();
        const key = `${parsed.gid}:${parsed.sid}`;
        cache.sectors[key] = {
            gid: parsed.gid,
            sid: parsed.sid,
            lastSyncWall: Date.now(),
            capturedEpoch: getServerEpoch(),
            passive: Boolean(passive),
            empires: Object.fromEntries(parsed.empires.map(item => [item.key, item]))
        };
        saveSectorCache(cache);
        return true;
    }

    function passivelyCacheCurrentSectorPage() {
        const coords = browserPageCoords(document);
        if (!coords) return;
        const parsed = parseSectorBrowserDocument(document, coords.gid, coords.sid);
        cacheSectorParse(parsed, true);
    }

    function sectorCacheWallAgeForKey(key) {
        const last = Number(state.sectorCache?.sectors?.[key]?.lastSyncWall) || 0;
        return last ? Math.max(0, Date.now() - last) : Infinity;
    }

    function sectorIntelForEmpire(empire) {
        const coords = sectorCoordsFromTarget(empire?.target);
        if (!coords) return null;
        const sector = state.sectorCache?.sectors?.[coords.key] || null;
        if (!sector) return null;
        const item = sector.empires?.[normalizeEmpireKey(empire.target)] || null;
        if (!item) return null;
        return { ...item, cacheAge: sectorCacheWallAgeForKey(coords.key), capturedEpoch: Number(sector.capturedEpoch) || 0 };
    }

    function sectorStatusLabel(status) {
        if (status === 'newb') return 'Newbie';
        if (status === 'vacation') return 'Vacation';
        if (status === 'deleting') return 'Disbanding';
        if (status === 'dead') return 'Dead';
        if (status === 'own') return 'Own empire';
        return 'Active';
    }

    function sectorDataTitle(empire) {
        const data = sectorIntelForEmpire(empire);
        if (!data) return 'No cached Sector Browser data; falling back to scan data where possible.';
        return `Sector Browser ${data.gid}:${data.sid} · cached ${newsAgeCompact(data.cacheAge)} ago · ${sectorStatusLabel(data.status)}`;
    }

    function sectorSearchText(empire) {
        const data = sectorIntelForEmpire(empire);
        if (!data) return '';
        return [data.networth, data.rank, data.asteroids, data.land, sectorStatusLabel(data.status), data.leaderTag].filter(value => value !== '' && value != null).join(' ');
    }

    function newsAgeCompact(milliseconds) {
        if (!Number.isFinite(milliseconds)) return '—';
        const minutes = Math.max(0, Math.floor(milliseconds / 60000));
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h`;
        return `${Math.floor(hours / 24)}d`;
    }

    function eventInvolvesEmpire(event, key) {
        const fields = ['defender', 'attacker', 'target', 'empire'];
        return fields.some(field => normalizeEmpireKey(event[field] || '') === key);
    }

    function analyzeAllianceNews(events) {
        const byEmpire = new Map();
        const ensure = empireName => {
            const key = normalizeEmpireKey(empireName);
            if (!key) return null;
            if (!byEmpire.has(key)) byEmpire.set(key, {
                key,
                name: empireName,
                related: [],
                defeats: [],
                kills: [],
                enemyAttackEvents: [],
                breaker: null
            });
            return byEmpire.get(key);
        };

        for (const event of events || []) {
            for (const name of [event.defender, event.attacker, event.target, event.empire].filter(Boolean)) {
                ensure(name)?.related.push(event);
            }
            if (event.kind === 'enemyDefeated') ensure(event.target)?.defeats.push(event);
            if (event.kind === 'allianceDefeatedByEnemy') ensure(event.attacker)?.kills.push(event);
            if (event.kind === 'enemyFail' || event.kind === 'enemySuccess' || event.kind === 'allianceDefeatedByEnemy') {
                ensure(event.attacker)?.enemyAttackEvents.push(event);
            }
        }

        const attackByDefender = new Map();
        for (const event of events || []) {
            if (!['enemyFail', 'enemySuccess', 'allianceDefeatedByEnemy'].includes(event.kind)) continue;
            const key = normalizeEmpireKey(event.defender);
            if (!attackByDefender.has(key)) attackByDefender.set(key, []);
            attackByDefender.get(key).push(event);
        }

        const breakerStats = new Map();
        const getBreaker = attacker => {
            const key = normalizeEmpireKey(attacker);
            if (!breakerStats.has(key)) breakerStats.set(key, {
                attacker,
                failCount: 0,
                firstSuccessCount: 0,
                successAfterFailuresCount: 0,
                leadCount: 0,
                earlyCount: 0,
                targets: new Set(),
                firstEpoch: Infinity,
                lastEpoch: 0,
                evidence: []
            });
            return breakerStats.get(key);
        };

        for (const defenderEvents of attackByDefender.values()) {
            const ordered = defenderEvents.slice().sort((a, b) => a.epoch - b.epoch);
            const episodes = [];
            let episode = [];
            let previousEpoch = null;
            for (const event of ordered) {
                if (previousEpoch != null && event.epoch - previousEpoch > NEWS_EPISODE_GAP_MS) {
                    if (episode.length) episodes.push(episode);
                    episode = [];
                }
                episode.push(event);
                previousEpoch = event.epoch;
                if (event.kind === 'allianceDefeatedByEnemy') {
                    episodes.push(episode);
                    episode = [];
                    previousEpoch = null;
                }
            }
            if (episode.length) episodes.push(episode);

            for (const eventsInEpisode of episodes) {
                const firstSuccessIndex = eventsInEpisode.findIndex(event => event.kind === 'enemySuccess' || event.kind === 'allianceDefeatedByEnemy');
                const firstSuccessEvent = firstSuccessIndex >= 0 ? eventsInEpisode[firstSuccessIndex] : null;
                const opening = (firstSuccessIndex >= 0 ? eventsInEpisode.slice(0, firstSuccessIndex) : eventsInEpisode)
                    .filter(event => event.kind === 'enemyFail');

                // Failed attacks before the first successful enemy hit are classic breaker evidence.
                opening.forEach((event, index) => {
                    const stats = getBreaker(event.attacker);
                    stats.failCount += 1;
                    if (index === 0) stats.leadCount += 1;
                    if (index < 3) stats.earlyCount += 1;
                    stats.targets.add(event.defender);
                    stats.firstEpoch = Math.min(stats.firstEpoch, event.epoch);
                    stats.lastEpoch = Math.max(stats.lastEpoch, event.epoch);
                    stats.evidence.push(event);
                });

                // The attacker landing the first successful hit may itself be the breaker.
                // This matters when the breaker succeeds on its first attempt, so there is no
                // failed-opening event for the old heuristic to observe. Treat a first success
                // after visible opening failures as strong evidence; a first success with no
                // visible failures remains a possible inference because the sequence may have
                // begun before the cached/news window we can see.
                if (firstSuccessEvent) {
                    const stats = getBreaker(firstSuccessEvent.attacker);
                    stats.firstSuccessCount += 1;
                    if (opening.length) stats.successAfterFailuresCount += 1;
                    stats.targets.add(firstSuccessEvent.defender);
                    stats.firstEpoch = Math.min(stats.firstEpoch, firstSuccessEvent.epoch);
                    stats.lastEpoch = Math.max(stats.lastEpoch, firstSuccessEvent.epoch);
                    stats.evidence.push(firstSuccessEvent);
                }
            }
        }

        for (const [key, stats] of breakerStats.entries()) {
            const intel = byEmpire.get(key) || ensure(stats.attacker);
            if (!intel) continue;
            intel.breaker = {
                failCount: stats.failCount,
                firstSuccessCount: stats.firstSuccessCount,
                successAfterFailuresCount: stats.successAfterFailuresCount,
                leadCount: stats.leadCount,
                earlyCount: stats.earlyCount,
                targetCount: stats.targets.size,
                targets: Array.from(stats.targets),
                firstEpoch: stats.firstEpoch,
                lastEpoch: stats.lastEpoch,
                strength: (
                    stats.successAfterFailuresCount > 0 ||
                    stats.firstSuccessCount >= 2 ||
                    stats.leadCount > 0 ||
                    stats.failCount >= 2 ||
                    stats.targets.size >= 2
                ) ? 'strong' : 'possible',
                evidence: stats.evidence.sort((a, b) => b.epoch - a.epoch)
            };
        }

        for (const intel of byEmpire.values()) {
            intel.related.sort((a, b) => b.epoch - a.epoch);
            intel.defeats.sort((a, b) => b.epoch - a.epoch);
            intel.kills.sort((a, b) => b.epoch - a.epoch);
            intel.enemyAttackEvents.sort((a, b) => b.epoch - a.epoch);
        }
        return byEmpire;
    }

    function parseTaken(value) {
        const match = text(value).match(/Taken:\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*@\s*(\d{1,2}):(\d{2}):(\d{2})/i);
        if (!match) return null;

        const now = getServerParts();
        const month = MONTHS[match[2].toLowerCase()];
        if (!Number.isInteger(month)) return null;

        let year = now.year;
        const parts = {
            year,
            month,
            day: Number(match[1]),
            hour: Number(match[3]),
            minute: Number(match[4]),
            second: Number(match[5])
        };
        const currentEpoch = naiveEpoch(now);
        let epoch = naiveEpoch(parts);

        // Scan posts do not include a year. If a month/day would land well in
        // the future relative to the page's server clock, it belongs to last year.
        if (epoch > currentEpoch + 36 * 60 * 60 * 1000) {
            parts.year -= 1;
            epoch = naiveEpoch(parts);
        }

        return {
            epoch,
            raw: text(value).replace(/^Taken:\s*/i, ''),
            parts
        };
    }

    function ageMs(epoch) {
        return Number.isFinite(epoch) ? Math.max(0, getServerEpoch() - epoch) : Infinity;
    }

    function ageLabel(milliseconds) {
        if (!Number.isFinite(milliseconds)) return '—';
        const seconds = Math.floor(milliseconds / 1000);
        if (seconds < 60) return 'now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            const remainder = minutes % 60;
            return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
        }
        const days = Math.floor(hours / 24);
        if (days < 7) {
            const remainder = hours % 24;
            return remainder ? `${days}d ${remainder}h` : `${days}d`;
        }
        return `${days}d`;
    }

    function ageLevel(milliseconds) {
        if (!Number.isFinite(milliseconds)) return 'missing';
        if (milliseconds < FRESH_MS) return 'fresh';
        if (milliseconds < WARM_MS) return 'warm';
        if (milliseconds < DEAD_INTEL_MS) return 'old';
        return 'dead';
    }

    function baseStatus(value) {
        return text(value).replace(/\s*\[[^\]]+\]\s*$/, '');
    }

    function parseFraction(value) {
        const match = text(value).match(/([\d,]+)\s*\/\s*([\d,]+)/);
        return match ? { current: numeric(match[1]), max: numeric(match[2]) } : { current: null, max: null };
    }

    function cellTexts(row) {
        return Array.from(row.children)
            .filter(node => /^(TD|TH)$/.test(node.tagName))
            .map(node => text(node.textContent));
    }

    function tableLooksGeneral(table) {
        const labels = Array.from(table.rows || [])
            .map(row => cellTexts(row)[0] || '')
            .map(label => label.replace(/:$/, '').toLowerCase());
        return labels.includes('empire') && labels.includes('race') && labels.includes('networth');
    }

    function tableLooksShips(table) {
        const firstRow = table.rows?.[0];
        if (!firstRow) return false;
        const headers = cellTexts(firstRow).map(value => value.toLowerCase());
        return headers.includes('name') && headers.includes('class') && headers.includes('status') && headers.includes('weapon');
    }

    function parseGeneralTable(table) {
        const result = {};
        for (const row of Array.from(table.rows || [])) {
            const cells = cellTexts(row);
            if (cells.length < 2) continue;
            const key = cells[0].replace(/:$/, '');
            result[key] = cells.slice(1).join(' ');
        }
        return result;
    }

    function parseShipTable(table, dock = '') {
        const headerRow = table.rows?.[0];
        if (!headerRow) return [];
        const headers = cellTexts(headerRow).map(value => value.toLowerCase());
        const index = name => headers.indexOf(name);
        const result = [];

        for (const row of Array.from(table.rows || []).slice(1)) {
            const cells = cellTexts(row);
            if (!cells.length) continue;
            const shipClass = cells[index('class')] || '';
            if (!shipClass) continue;

            const hull = parseFraction(cells[index('hull')]);
            const shields = parseFraction(cells[index('shields')]);
            result.push({
                dock,
                no: numeric(cells[index('no')]),
                name: cells[index('name')] || '',
                className: shipClass,
                status: cells[index('status')] || '',
                hull,
                shields,
                weapon: numeric(cells[index('weapon')]),
                engine: numeric(cells[index('engine')]),
                sensor: numeric(cells[index('sensor')])
            });
        }
        return result;
    }

    function sectionDockName(sectionText) {
        const value = text(sectionText).replace(/:$/, '').toLowerCase();
        if (value.startsWith('attacker')) return 'Attack';
        if (value.startsWith('defender')) return 'Defence';
        if (value.startsWith('raider')) return 'Raider';
        if (value.startsWith('leecher')) return 'Leecher';
        return text(sectionText).replace(/:$/, '');
    }

    function findPostStrongNodes() {
        const threadTable = document.querySelector('table.forumthreadtable');
        if (!threadTable) return [];
        return Array.from(threadTable.querySelectorAll('strong')).filter(strong => {
            const paragraph = strong.closest('p');
            return paragraph && /^Scan of\b/i.test(text(paragraph.textContent));
        });
    }

    function parseScanPost(strong, index) {
        const bodyCell = strong.closest('td');
        if (!bodyCell) return null;
        const postRow = bodyCell.parentElement;
        const siblings = postRow ? Array.from(postRow.children).filter(node => node.tagName === 'TD') : [];
        const bodyIndex = siblings.indexOf(bodyCell);
        const authorCell = bodyIndex > 0 ? siblings[bodyIndex - 1] : null;

        const target = text(strong.textContent);
        const paragraphs = Array.from(bodyCell.querySelectorAll('p')).map(node => text(node.textContent));
        const takenText = paragraphs.find(value => /^Taken:/i.test(value)) || '';
        const taken = parseTaken(takenText);
        if (!target || !taken) return null;

        const tables = Array.from(bodyCell.querySelectorAll('table.basictable'));
        const generalTable = tables.find(tableLooksGeneral) || null;
        const sectionTitles = Array.from(bodyCell.querySelectorAll('.sectionTitle'));
        const hasDockSections = sectionTitles.some(node => /Attackers|Defenders|Raiders|Leechers/i.test(text(node.textContent)));
        const shipTables = tables.filter(tableLooksShips);

        let type = 'unknown';
        if (generalTable) type = 'general';
        else if (hasDockSections && shipTables.length) type = 'fullDock';
        else if (shipTables.length) type = 'defence';
        else if (paragraphs.some(value => /^Empire Defence:/i.test(value))) type = 'stealth';

        if (type === 'unknown') return null;

        let general = null;
        let ships = [];
        if (generalTable) general = parseGeneralTable(generalTable);

        if (shipTables.length) {
            let currentDock = '';
            const ordered = Array.from(bodyCell.querySelectorAll('.sectionTitle, table.basictable'));
            for (const node of ordered) {
                if (node.classList?.contains('sectionTitle')) {
                    currentDock = sectionDockName(node.textContent);
                    continue;
                }
                if (node.tagName === 'TABLE' && tableLooksShips(node)) {
                    ships.push(...parseShipTable(node, currentDock));
                }
            }
            // Some legacy markup can keep a ship table outside the direct ordered
            // sequence. Do not lose it merely because a wrapper was inserted.
            if (!ships.length) ships = shipTables.flatMap(table => parseShipTable(table, ''));
        }

        const empireDefenceText = paragraphs.find(value => /^Empire Defence:/i.test(value)) || '';
        const empireDefence = numeric(empireDefenceText.replace(/^Empire Defence:\s*/i, ''));

        const breakText = paragraphs.find(value => /^Break Calc:/i.test(value)) || '';
        let breakCalc = '';
        let pulls = '';
        if (breakText) {
            const remainder = breakText.replace(/^Break Calc:\s*/i, '');
            const parts = remainder.split(/\s*\|\|\s*Pulls:\s*/i);
            breakCalc = text(parts[0]);
            pulls = text(parts[1] || '');
        }

        const author = text(authorCell?.querySelector('.bold')?.textContent || authorCell?.querySelector('p')?.textContent || 'Unknown');
        const posted = text(authorCell?.querySelector('.forumpostdate')?.textContent || '').replace(/^Posted:\s*/i, '');

        if (postRow && !postRow.id) postRow.id = `sfib-source-${index + 1}`;

        return {
            target,
            author,
            posted,
            taken,
            type,
            general,
            ships,
            empireDefence,
            breakCalc,
            pulls,
            sourceRow: postRow || null,
            sourceId: postRow?.id || ''
        };
    }

    function scanSignature(scan) {
        return [
            scan.target.toLowerCase(),
            scan.type,
            scan.taken.epoch,
            scan.general?.Probes || '',
            scan.empireDefence ?? '',
            scan.breakCalc,
            scan.ships.length,
            scan.ships.map(ship => `${ship.dock}:${ship.className}:${ship.status}:${ship.hull.current}/${ship.hull.max}:${ship.shields.current}/${ship.shields.max}:${ship.weapon}/${ship.engine}/${ship.sensor}`).join(';')
        ].join('|');
    }

    function collectScans() {
        const seen = new Set();
        const scans = [];
        for (const [index, strong] of findPostStrongNodes().entries()) {
            const scan = parseScanPost(strong, index);
            if (!scan) continue;
            const signature = scanSignature(scan);
            if (seen.has(signature)) continue;
            seen.add(signature);
            scans.push(scan);
        }
        return scans.sort((a, b) => b.taken.epoch - a.taken.epoch);
    }

    function buildEmpires(scans) {
        const map = new Map();
        for (const scan of scans) {
            const key = scan.target.toLowerCase();
            if (!map.has(key)) map.set(key, { target: scan.target, scans: [] });
            map.get(key).scans.push(scan);
        }

        const empires = [];
        for (const empire of map.values()) {
            empire.scans.sort((a, b) => b.taken.epoch - a.taken.epoch);
            empire.latestOverall = empire.scans[0] || null;
            empire.latestByType = {};
            for (const type of TYPE_ORDER) empire.latestByType[type] = empire.scans.find(scan => scan.type === type) || null;
            empire.generalScans = empire.scans.filter(scan => scan.type === 'general');
            empire.latestGeneral = empire.generalScans[0] || null;
            empire.previousGeneral = empire.generalScans[1] || null;
            empire.latestShip = empire.scans.find(scan => scan.ships.length) || null;
            empire.latestDefenceValue = empire.scans.find(scan => Number.isFinite(scan.empireDefence)) || null;
            empire.assigned = getStored(empireStorageKey(empire.target, 'assigned'), '');
            empire.notes = getStored(empireStorageKey(empire.target, 'notes'), '');
            empire.hidden = getStored(empireStorageKey(empire.target, 'hidden'), 'false') === 'true';
            empires.push(empire);
        }
        return empires;
    }

    function generalValue(empire, key) {
        return empire.latestGeneral?.general?.[key] ?? '';
    }

    function generalNumber(empire, key) {
        return numeric(generalValue(empire, key));
    }

    function browserOrGeneralNumber(empire, browserField, generalField) {
        const browser = sectorIntelForEmpire(empire);
        if (browser && Number.isFinite(browser[browserField])) return browser[browserField];
        return generalNumber(empire, generalField);
    }

    function networthRankHtml(empire) {
        const browser = sectorIntelForEmpire(empire);
        if (browser) {
            const rank = Number.isFinite(browser.rank) ? `#${formatNumber(browser.rank)}` : '';
            const rankLabel = Number.isFinite(browser.rank) ? ` title="Sector rank ${formatNumber(browser.rank)}"` : ' aria-label="Sector rank unavailable"';
            const networth = Number.isFinite(browser.networth) ? formatNumber(browser.networth) : placeholderHtml('No Networth reported');
            return `<span class="sfib-current-stat" title="${escapeHtml(sectorDataTitle(empire))}"><span class="sfib-networth-value">${networth}</span><span class="sfib-rank"${rankLabel}>${rank}</span></span>`;
        }
        const fallbackNetworth = generalNumber(empire, 'Networth');
        const title = empire.latestGeneral ? `Fallback: Networth from General Scan ${empire.latestGeneral.taken.raw}` : 'No current Sector Browser or General Scan Networth';
        const value = Number.isFinite(fallbackNetworth) ? formatNumber(fallbackNetworth) : placeholderHtml('No Networth reported');
        return `<span class="sfib-current-stat sfib-current-fallback" title="${escapeHtml(title)}"><span class="sfib-networth-value">${value}</span><span class="sfib-rank" aria-label="Sector rank unavailable"></span></span>`;
    }

    function astLandHtml(empire) {
        const browser = sectorIntelForEmpire(empire);
        if (browser) {
            const asteroids = Number.isFinite(browser.asteroids) ? formatNumber(browser.asteroids) : placeholderHtml('No Asteroid value reported');
            const land = Number.isFinite(browser.land) ? formatNumber(browser.land) : placeholderHtml('No Land value reported');
            return `<span class="sfib-territory" title="${escapeHtml(sectorDataTitle(empire))}"><span>${asteroids}</span><span class="sfib-territory-sep">/</span><span>${land}</span></span>`;
        }
        const asteroids = generalNumber(empire, 'Roids');
        const land = generalNumber(empire, 'Land');
        const title = empire.latestGeneral ? `Fallback: Asteroids / Land from General Scan ${empire.latestGeneral.taken.raw}` : 'No current Sector Browser or General Scan territory data';
        const asteroidsHtml = Number.isFinite(asteroids) ? formatNumber(asteroids) : placeholderHtml('No Asteroid value reported');
        const landHtml = Number.isFinite(land) ? formatNumber(land) : placeholderHtml('No Land value reported');
        return `<span class="sfib-territory sfib-current-fallback" title="${escapeHtml(title)}"><span>${asteroidsHtml}</span><span class="sfib-territory-sep">/</span><span>${landHtml}</span></span>`;
    }

    function currentSectorDetailHtml(empire) {
        const browser = sectorIntelForEmpire(empire);
        if (!browser) {
            return '<div class="sfib-current-sector sfib-current-sector-missing"><div class="sfib-current-sector-head"><b>Current Sector</b></div><div class="sfib-current-sector-data">Not cached yet. Sector Browser refreshes at most once per hour while the board is open.</div></div>';
        }
        const bits = [
            `NW ${formatNumber(browser.networth)}`,
            Number.isFinite(browser.rank) ? `#${formatNumber(browser.rank)}` : '',
            `Ast ${formatNumber(browser.asteroids)}`,
            `Land ${formatNumber(browser.land)}`,
            sectorStatusLabel(browser.status),
            browser.leaderTag || ''
        ].filter(Boolean);
        return `<div class="sfib-current-sector"><div class="sfib-current-sector-head"><b>Current Sector <span class="sfib-sector-coords">${escapeHtml(`${browser.gid}:${browser.sid}`)}</span></b><small>${escapeHtml(`cached ${newsAgeCompact(browser.cacheAge)} ago`)}</small></div><div class="sfib-current-sector-data">${escapeHtml(bits.join(' · '))}</div></div>`;
    }

    function probeDelta(empire) {
        const latest = numeric(empire.latestGeneral?.general?.Probes);
        const previous = numeric(empire.previousGeneral?.general?.Probes);
        if (!Number.isFinite(latest) || !Number.isFinite(previous)) return null;
        return latest - previous;
    }

    function classComposition(ships) {
        const counts = new Map();
        for (const ship of ships || []) counts.set(ship.className, (counts.get(ship.className) || 0) + 1);
        return Array.from(counts.entries())
            .sort((a, b) => compareShipClassesDesc(a[0], b[0]) || b[1] - a[1])
            .map(([className, count]) => `${count} ${CLASS_SHORT[className] || className}`)
            .join(' · ');
    }

    function nonDefendingSummary(ships) {
        const counts = new Map();
        for (const ship of ships || []) {
            const status = baseStatus(ship.status);
            if (!status || /^Defending$/i.test(status)) continue;
            counts.set(status, (counts.get(status) || 0) + 1);
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => `${count} ${status.toLowerCase()}`)
            .join(' · ');
    }

    const SHIP_STATUS_CODES = Object.freeze([
        [/^Returning$/i, 'R'],
        [/^Disabled$/i, 'D'],
        [/^Building$/i, 'B'],
        [/^Upgrading$/i, 'U'],
        [/^Exploring Asteroids$/i, 'EA'],
        [/^Exploring Planets$/i, 'EP'],
        [/^Exploring$/i, 'E'],
        [/^Attacking$/i, 'A'],
        [/^Raiding$/i, 'RD']
    ]);

    function shipStatusCode(status) {
        const clean = baseStatus(status);
        if (!clean || /^Defending$/i.test(clean)) return '';
        const known = SHIP_STATUS_CODES.find(([pattern]) => pattern.test(clean));
        if (known) return known[1];
        const words = clean.match(/[A-Za-z0-9]+/g) || [];
        return (words.length > 1 ? words.map(word => word[0]).join('') : (words[0] || '?')[0]).toUpperCase().slice(0, 3);
    }

    function shipStatusCssClass(code) {
        if (code === 'R') return 'returning';
        if (code === 'D') return 'disabled';
        if (code === 'B') return 'building';
        if (code === 'U') return 'upgrading';
        return 'other';
    }

    function classCompositionStatusHtml(ships) {
        const classes = new Map();
        for (const ship of ships || []) {
            if (!classes.has(ship.className)) classes.set(ship.className, { count: 0, statuses: new Map() });
            const entry = classes.get(ship.className);
            entry.count += 1;
            const status = baseStatus(ship.status);
            if (!status || /^Defending$/i.test(status)) continue;
            const code = shipStatusCode(status);
            const key = `${code}|${status}`;
            const prior = entry.statuses.get(key) || { code, status, count: 0 };
            prior.count += 1;
            entry.statuses.set(key, prior);
        }

        return Array.from(classes.entries())
            .sort((a, b) => compareShipClassesDesc(a[0], b[0]) || b[1].count - a[1].count)
            .map(([className, entry]) => {
                const label = `${entry.count} ${CLASS_SHORT[className] || className}`;
                const statusOrder = ['R', 'D', 'B', 'U', 'EA', 'EP', 'E', 'A', 'RD'];
                const statuses = Array.from(entry.statuses.values())
                    .sort((a, b) => {
                        const ai = statusOrder.indexOf(a.code);
                        const bi = statusOrder.indexOf(b.code);
                        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.status.localeCompare(b.status);
                    });
                if (!statuses.length) return `<span class="sfib-fleet-class">${escapeHtml(label)}</span>`;
                const title = statuses.map(item => `${item.count} ${item.status}`).join(', ');
                const tokens = statuses.map(item => `<span class="sfib-status-token ${shipStatusCssClass(item.code)}">${escapeHtml(`${item.count}${item.code}`)}</span>`).join('<span class="sfib-status-space"> </span>');
                return `<span class="sfib-fleet-class">${escapeHtml(label)} <span class="sfib-class-status" title="${escapeHtml(title)}"><span class="sfib-status-bracket">[</span>${tokens}<span class="sfib-status-bracket">]</span></span></span>`;
            })
            .join('<span class="sfib-fleet-sep"> · </span>');
    }

    function latestBreakScan(empire) {
        const scan = empire?.latestByType?.defence || null;
        return scan && (scan.breakCalc || scan.pulls) ? scan : null;
    }

    function breakOrderNumbers(value) {
        return text(value).split('|').map(part => numeric(part)).filter(Number.isFinite);
    }

    function breakOrderTotal(value) {
        const values = breakOrderNumbers(value);
        return values.length ? values.reduce((sum, item) => sum + item, 0) : null;
    }

    function boPullsHtml(empire) {
        const scan = latestBreakScan(empire);
        if (!scan) return placeholderHtml('No value reported');
        const parts = [];
        if (scan.breakCalc) parts.push(`<span class="sfib-bo-main">${escapeHtml(scan.breakCalc)}</span>`);
        if (scan.pulls) parts.push(`<span class="sfib-bo-pulls">P${escapeHtml(scan.pulls)}</span>`);
        const level = ageLevel(ageMs(scan.taken.epoch));
        const title = [`Defence Scan ${scan.taken.raw}`, scan.breakCalc ? `Break Order ${scan.breakCalc}` : '', scan.pulls ? `Pulls ${scan.pulls}` : '', `Freshness ${level}`].filter(Boolean).join(' · ');
        return `<span class="sfib-bo ${level}" title="${escapeHtml(title)}"><span class="sfib-bo-freshness" aria-hidden="true"></span>${parts.join('<span class="sfib-bo-sep"> · </span>')}</span>`;
    }

    function percentileScore(value, values, higherIsBetter) {
        if (!Number.isFinite(value)) return null;
        const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!clean.length) return null;
        if (clean.length === 1) return 50;
        let below = 0;
        let equal = 0;
        for (const item of clean) {
            if (item < value) below += 1;
            else if (item === value) equal += 1;
        }
        const percentile = (below + Math.max(0, equal - 1) / 2) / (clean.length - 1);
        const score = higherIsBetter ? percentile : 1 - percentile;
        return Math.max(0, Math.min(100, score * 100));
    }

    function targetFreshnessScore(milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds >= WARM_MS) return 0;
        return Math.max(50, 100 - (milliseconds / WARM_MS) * 50);
    }

    function buildTargetAssessments(empires) {
        const assessments = new Map();
        const candidates = [];

        for (const empire of empires) {
            const { postDefeatProtected, recentDefeat, breaker, protectedByBrowser, sectorStatus } = newsIntelForEmpire(empire);
            const defenceScan = empire.latestDefenceValue || null;
            const defence = defenceScan?.empireDefence;
            const defenceAge = defenceScan ? ageMs(defenceScan.taken.epoch) : Infinity;
            const breakScan = latestBreakScan(empire);
            const breakAge = breakScan ? ageMs(breakScan.taken.epoch) : Infinity;
            const boTotal = breakScan && breakAge < WARM_MS ? breakOrderTotal(breakScan.breakCalc) : null;
            const gen = empire.latestGeneral;
            const genAge = gen ? ageMs(gen.taken.epoch) : Infinity;
            const sector = sectorIntelForEmpire(empire);
            const genEpoch = gen?.taken?.epoch || 0;
            const sectorEpoch = sector?.capturedEpoch || 0;
            let land = null;
            let roids = null;
            let territorySource = '';
            if (sector && sector.cacheAge < SECTOR_TTL_MS && sectorEpoch >= genEpoch) {
                land = sector.land;
                roids = sector.asteroids;
                territorySource = `Sector Browser ${newsAgeCompact(sector.cacheAge)} old`;
            } else if (genAge < WARM_MS) {
                land = generalNumber(empire, 'Land');
                roids = generalNumber(empire, 'Roids');
                territorySource = `General Scan ${ageLabel(genAge)} old`;
            }
            const territory = Number.isFinite(land) || Number.isFinite(roids) ? (land || 0) + (roids || 0) : null;
            const shieldOnline = genAge < WARM_MS && /^online$/i.test(text(generalValue(empire, 'Shields')));
            const warpOnline = genAge < WARM_MS && /^online$/i.test(text(generalValue(empire, 'Warp')));

            let status = 'candidate';
            if (postDefeatProtected) status = 'down';
            else if (!Number.isFinite(defence)) status = 'no-def';
            else if (defenceAge >= DEAD_INTEL_MS) status = 'dead';
            else if (defenceAge >= WARM_MS) status = 'recheck';

            const item = {
                empire, status, defence, defenceAge, boTotal, breakScan, breakAge,
                territory, territorySource, genAge, shieldOnline, warpOnline, recentDefeat, breaker,
                protectedByBrowser, sectorStatus,
                score: null, baseScore: null, shieldPenalty: 0, label: '', rank: null, starred: false, components: null
            };
            assessments.set(empire.target.toLowerCase(), item);
            if (status === 'candidate') candidates.push(item);
        }

        const defenceValues = candidates.map(item => item.defence).filter(Number.isFinite);
        const boValues = candidates.map(item => item.boTotal).filter(Number.isFinite);
        const territoryValues = candidates.map(item => item.territory).filter(Number.isFinite);

        for (const item of candidates) {
            const defScore = percentileScore(item.defence, defenceValues, false);
            const boScore = percentileScore(item.boTotal, boValues, false);
            const territoryScore = percentileScore(item.territory, territoryValues, true);
            const freshScore = targetFreshnessScore(item.defenceAge);
            const weighted = [
                [defScore, 50],
                [boScore, 25],
                [territoryScore, 15],
                [freshScore, 10]
            ].filter(([value]) => Number.isFinite(value));
            const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
            const baseScore = totalWeight ? weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight : null;

            // Shields are deliberately NOT modeled as combat multipliers here. The exact
            // mechanics are not confirmed well enough for that. Instead, recent ON states
            // receive small fixed target-attractiveness penalties representing operational
            // friction: Attack Shields -10, Warp Shields an additional -4.
            const shieldPenalty = (item.shieldOnline ? 10 : 0) + (item.warpOnline ? 4 : 0);
            const adjustedScore = Number.isFinite(baseScore) ? Math.max(0, baseScore - shieldPenalty) : null;

            item.baseScore = Number.isFinite(baseScore) ? Math.round(baseScore) : null;
            item.shieldPenalty = shieldPenalty;
            item.score = Number.isFinite(adjustedScore) ? Math.round(adjustedScore) : null;
            item.components = { defScore, boScore, territoryScore, freshScore };
            item.label = item.score >= 75 ? 'PRIME' : item.score >= 60 ? 'GOOD' : item.score >= 45 ? 'FAIR' : 'HARD';
        }

        candidates.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.defence - b.defence || a.empire.target.localeCompare(b.empire.target));
        const starCount = Math.max(0, Math.min(10, Number(state.targetStarCount) || 0));
        candidates.forEach((item, index) => {
            item.rank = index + 1;
            item.starred = index < starCount;
        });
        return assessments;
    }

    function targetAssessment(empire) {
        return state.targetAssessments?.get(empire.target.toLowerCase()) || null;
    }

    function targetAssessmentTitle(item) {
        if (!item) return 'No target assessment available.';
        if (item.status === 'down') return item.protectedByBrowser ? 'Current Sector Browser marks this empire in Newbie status. Excluded from target ranking.' : 'Recent defeat with no fresh Sector Browser confirmation; using the 48-hour protection fallback. Excluded from target ranking.';
        if (item.status === 'no-def') return 'No usable Empire Defence value. Scan before treating this as a target candidate.';
        if (item.status === 'dead') return 'Defence intel is 48 hours or older and treated as tactically dead. Rescan before targeting.';
        if (item.status === 'recheck') return 'Defence intel is 12–47 hours old. Potentially informative, but too stale for the actionable target ranking.';
        const parts = [`Relative target score ${item.score}/100`, `rank #${item.rank}`];
        const c = item.components || {};
        if (Number.isFinite(c.defScore)) parts.push(`Defence ease ${Math.round(c.defScore)}`);
        if (Number.isFinite(c.boScore)) parts.push(`BO ease ${Math.round(c.boScore)}`);
        if (Number.isFinite(c.territoryScore)) parts.push(`territory value ${Math.round(c.territoryScore)}${item.territorySource ? ` (${item.territorySource})` : ''}`);
        if (Number.isFinite(c.freshScore)) parts.push(`intel freshness ${Math.round(c.freshScore)}`);
        if (item.shieldPenalty) {
            const states = [item.shieldOnline ? 'Attack Shields ON (-10)' : '', item.warpOnline ? 'Warp Shields ON (-4)' : ''].filter(Boolean).join(', ');
            parts.push(`heuristic shield penalty -${item.shieldPenalty} (${states})`);
            if (Number.isFinite(item.baseScore)) parts.push(`pre-shield score ${item.baseScore}`);
        }
        if (item.breaker) parts.push('breaker candidate; role inference does not change the score');
        return `${parts.join(' · ')}. Heuristic only: relative opportunity from scan evidence plus cached Sector Browser data, not guaranteed breakability for a specific attacker.`;
    }

    function targetAssessmentHtml(empire) {
        const item = targetAssessment(empire);
        if (!item) return placeholderHtml('No target assessment');
        const title = targetAssessmentTitle(item);
        const starredPrefix = item.starred
            ? `<span class="sfib-target-star-inline" aria-hidden="true">★</span><span class="sfib-sr-only">Top target candidate. </span>`
            : '';
        const starredTitle = item.starred
            ? `Top ${escapeHtml(String(state.targetStarCount))} relative target candidate · #${item.rank} · ${escapeHtml(title)}`
            : escapeHtml(title);
        let badge = '';
        if (item.status === 'down') badge = `<span class="sfib-target-badge down${item.protectedByBrowser ? ' newb' : ''}" title="${starredTitle}">${starredPrefix}${item.protectedByBrowser ? 'NEWB' : 'DOWN'}</span>`;
        else if (item.status === 'no-def') badge = `<span class="sfib-target-badge unknown" title="${starredTitle}">${starredPrefix}NO DEF</span>`;
        else if (item.status === 'dead') badge = `<span class="sfib-target-badge dead" title="${starredTitle}">${starredPrefix}DEAD</span>`;
        else if (item.status === 'recheck') badge = `<span class="sfib-target-badge recheck" title="${starredTitle}">${starredPrefix}RECHECK</span>`;
        else badge = `<span class="sfib-target-badge ${item.label.toLowerCase()}" title="${starredTitle}">${starredPrefix}${escapeHtml(item.label)}</span>`;
        return badge;
    }

    function targetSearchText(empire) {
        const item = targetAssessment(empire);
        return item ? [item.label, item.status, item.starred ? 'star top target prime' : ''].join(' ') : '';
    }

    function powerSummary(ships) {
        const counts = new Map();
        for (const ship of ships || []) {
            const key = `W${ship.weapon ?? '?'} E${ship.engine ?? '?'} S${ship.sensor ?? '?'}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([allocation, count]) => `${count}× ${allocation}`)
            .join(' · ');
    }

    function scanAgeHtml(scan) {
        if (!scan) return `<span class="sfib-scan-pill missing">${placeholderHtml('No scan retained')}</span>`;
        const level = ageLevel(ageMs(scan.taken.epoch));
        return `<span class="sfib-scan-pill ${level}" title="${escapeHtml(TYPE_META[scan.type].name)} taken ${escapeHtml(scan.taken.raw)} by ${escapeHtml(scan.author)}"><b>${TYPE_META[scan.type].short}</b><span class="sfib-age" data-epoch="${scan.taken.epoch}">${ageLabel(ageMs(scan.taken.epoch))}</span></span>`;
    }

    function scansCellHtml(empire) {
        return TYPE_ORDER.map(type => {
            const scan = empire.latestByType[type];
            if (!scan && type === 'stealth' && !state.hasStealth) return '';
            if (!scan) return `<span class="sfib-scan-pill missing" title="No ${TYPE_META[type].name} found"><b>${TYPE_META[type].short}</b>${placeholderHtml(`No ${TYPE_META[type].name} retained`)}</span>`;
            return scanAgeHtml(scan);
        }).join('');
    }

    function shieldsWarpHtml(empire) {
        const shields = text(generalValue(empire, 'Shields'));
        const warp = text(generalValue(empire, 'Warp'));
        if (!shields && !warp) return placeholderHtml('No shield-state value reported');
        const badge = (label, value) => {
            const on = /^online$/i.test(value);
            const off = /^offline$/i.test(value);
            const cls = on ? 'on' : off ? 'off' : 'neutral';
            const display = on ? 'ON' : off ? 'OFF' : value || '—';
            return `<span class="sfib-state-pill ${cls}" title="${label === 'S' ? 'Attack Shields' : 'Warp Shields'}: ${escapeHtml(value || 'Unknown')}"><b>${label}</b><span>${escapeHtml(display)}</span></span>`;
        };
        return `<span class="sfib-state-grid">${badge('S', shields)}${badge('W', warp)}</span>`;
    }

    function fleetHtml(empire) {
        const scan = empire.latestShip;
        if (!scan) return '<span class="sfib-muted">No ship scan</span>';
        const composition = classCompositionStatusHtml(scan.ships) || placeholderHtml('No ship composition reported');
        return `<div class="sfib-fleet-main" title="${escapeHtml(powerSummary(scan.ships))}">${composition}</div>`;
    }

    function probesHtml(empire) {
        const probes = generalNumber(empire, 'Probes');
        if (!Number.isFinite(probes)) return placeholderHtml('No probe count reported');
        const delta = probeDelta(empire);
        const deltaHtml = Number.isFinite(delta) && delta !== 0
            ? `<span class="sfib-delta" title="Change since previous General Scan">${delta > 0 ? '▲' : '▼'}${formatCompact(Math.abs(delta))}</span>`
            : '';
        const scan = empire.latestGeneral;
        const probeValue = probes === 0
            ? placeholderHtml('0 probes')
            : `<span class="sfib-primary-number" title="${formatNumber(probes)} probes from ${escapeHtml(scan?.taken.raw || '')}">${formatCompact(probes)}</span>`;
        return `${probeValue}${deltaHtml}`;
    }

    function newsIntelForEmpire(empire) {
        const key = normalizeEmpireKey(empire.target);
        const intel = state.newsIntel?.get(key) || null;
        const latestDefeat = intel?.defeats?.[0] || null;
        const recentDefeat = latestDefeat && ageMs(latestDefeat.epoch) < POST_DEFEAT_PROTECTION_MS ? latestDefeat : null;
        let postDefeatActivity = false;
        if (recentDefeat && intel) {
            const laterScan = empire.latestOverall?.taken?.epoch || 0;
            const laterOutgoingAttack = Math.max(0, ...(intel.enemyAttackEvents || []).map(event => event.epoch));
            postDefeatActivity = Math.max(laterScan, laterOutgoingAttack) > recentDefeat.epoch;
        }

        // Sector Browser is the authoritative current-state source when it has
        // been refreshed within its one-hour TTL. If it explicitly says NEWB,
        // use that rather than merely assuming 48 hours from a defeat event.
        // If current browser data is unavailable/stale, retain the defeat-based
        // 48-hour fallback so the board degrades safely.
        const sector = sectorIntelForEmpire(empire);
        const sectorCurrent = Boolean(sector && sector.cacheAge < SECTOR_TTL_MS);
        const protectedByBrowser = sectorCurrent && sector.status === 'newb';
        const postDefeatProtected = protectedByBrowser || (!sectorCurrent && Boolean(recentDefeat));

        return {
            intel,
            recentDefeat,
            breaker: intel?.breaker || null,
            postDefeatActivity,
            postDefeatProtected,
            protectedByBrowser,
            sectorStatus: sectorCurrent ? sector.status : ''
        };
    }

    function warIntelHtml(empire) {
        const { recentDefeat, breaker, postDefeatActivity, protectedByBrowser } = newsIntelForEmpire(empire);
        const badges = [];
        if (protectedByBrowser) {
            badges.push(`<span class="sfib-war-badge newb" title="Current cached Sector Browser marks this empire in Newbie status.">NEWB</span>`);
        }
        if (recentDefeat && !protectedByBrowser) {
            const activityNote = postDefeatActivity ? ' Later scan or hostile activity was observed, but the 48-hour post-defeat protection window is still in effect.' : ' Treated as protected for 48 hours after defeat.';
            const title = `Defeated by ${recentDefeat.attacker} at ${recentDefeat.dateText}.${activityNote}`;
            badges.push(`<span class="sfib-war-badge defeated" title="${escapeHtml(title)}">DEFEATED <span class="sfib-news-age" data-epoch="${recentDefeat.epoch}">${newsAgeCompact(ageMs(recentDefeat.epoch))}</span></span>`);
        }
        if (breaker) {
            const confidence = breaker.strength === 'strong' ? 'strong' : 'possible';
            const targetText = breaker.targets.slice(0, 3).join(', ');
            const evidenceParts = [];
            if (breaker.failCount) evidenceParts.push(`${breaker.failCount} opening failure${breaker.failCount === 1 ? '' : 's'}`);
            if (breaker.firstSuccessCount) evidenceParts.push(`${breaker.firstSuccessCount} first successful hit${breaker.firstSuccessCount === 1 ? '' : 's'}`);
            const sequenceNote = breaker.successAfterFailuresCount
                ? ` ${breaker.successAfterFailuresCount} first successful hit${breaker.successAfterFailuresCount === 1 ? '' : 's'} followed visible opening failures.`
                : '';
            const title = `Breaker candidate (${confidence} inference): ${evidenceParts.join(' + ')} across ${breaker.targetCount} assault target${breaker.targetCount === 1 ? '' : 's'}${targetText ? `: ${targetText}` : ''}.${sequenceNote} First-success evidence is included because a breaker can succeed on its first attempt. This is heuristic, not a confirmed StarFury role.`;
            badges.push(`<span class="sfib-war-badge breaker ${breaker.strength}" title="${escapeHtml(title)}">BRK? <span class="sfib-news-age" data-epoch="${breaker.lastEpoch}">${newsAgeCompact(ageMs(breaker.lastEpoch))}</span></span>`);
        }
        return badges.length ? badges.join('') : placeholderHtml('No recent war indicator');
    }

    function warSearchText(empire) {
        const { recentDefeat, breaker } = newsIntelForEmpire(empire);
        return [recentDefeat ? 'defeated down' : '', breaker ? 'breaker brk' : ''].join(' ');
    }

    function warSortScore(empire) {
        const { recentDefeat, breaker } = newsIntelForEmpire(empire);
        let score = 0;
        if (recentDefeat) score += 10000000000000 - Math.min(10000000000000, ageMs(recentDefeat.epoch));
        if (breaker) {
            score += 5000000000000;
            if (breaker.strength === 'strong') score += 1000000000000;
            score += Math.min(999, breaker.failCount) * 1000000;
            score += Math.min(999, breaker.firstSuccessCount || 0) * 2000000;
            score += breaker.lastEpoch / 1e6;
        }
        return score;
    }

    function newsEventSummary(event, empireKey) {
        if (!event) return '';
        switch (event.kind) {
            case 'enemyFail':
                return `Failed attack on ${event.defender}`;
            case 'enemySuccess':
                return `Took ${formatNumber(event.amount)} ${event.resource} from ${event.defender}`;
            case 'allianceDefeatedByEnemy':
                return `Defeated ${event.defender}`;
            case 'enemyDefeated':
                return `Defeated by ${event.attacker}`;
            case 'allyFailAgainstEnemy':
                return `Held against ${event.attacker}`;
            case 'allySuccessAgainstEnemy':
                return `Lost ${event.conquest} to ${event.attacker}`;
            default:
                return event.message;
        }
    }

    function warDetailHtml(empire) {
        const { intel, recentDefeat, breaker } = newsIntelForEmpire(empire);
        const targetDetail = targetDetailHtml(empire);
        if (!intel?.related?.length && !breaker && !recentDefeat) return `${targetDetail}<div class="sfib-detail-empty">No cached alliance-war news found for this empire.</div>`;

        const evidence = [];
        if (breaker) {
            const parts = [];
            if (breaker.failCount) parts.push(`${breaker.failCount} opening failure${breaker.failCount === 1 ? '' : 's'}`);
            if (breaker.firstSuccessCount) parts.push(`${breaker.firstSuccessCount} first successful hit${breaker.firstSuccessCount === 1 ? '' : 's'}`);
            if (breaker.successAfterFailuresCount) parts.push(`${breaker.successAfterFailuresCount} success-after-failures sequence${breaker.successAfterFailuresCount === 1 ? '' : 's'}`);
            evidence.push(`<div class="sfib-war-evidence"><b>Breaker candidate</b><span>${escapeHtml(`${parts.join(' · ')} across ${breaker.targetCount} target${breaker.targetCount === 1 ? '' : 's'}; ${breaker.strength} heuristic confidence`)}</span></div>`);
        }
        if (recentDefeat) {
            evidence.push(`<div class="sfib-war-evidence"><b>Recent defeat</b><span>${escapeHtml(`${recentDefeat.dateText} by ${recentDefeat.attacker}`)}</span></div>`);
        }
        if (intel.kills?.length) {
            const latestKill = intel.kills[0];
            evidence.push(`<div class="sfib-war-evidence"><b>Alliance kill</b><span>${escapeHtml(`${latestKill.dateText}: defeated ${latestKill.defender}`)}</span></div>`);
        }

        const rows = (intel.related || []).slice(0, 12).map(event => `<tr>
            <td><span class="sfib-news-age" data-epoch="${event.epoch}">${newsAgeCompact(ageMs(event.epoch))}</span></td>
            <td>${escapeHtml(newsEventSummary(event, normalizeEmpireKey(empire.target)))}</td>
        </tr>`).join('');

        return `${targetDetail}${evidence.join('')}<table class="sfib-history-table sfib-war-history"><thead><tr><th>Age</th><th>Alliance News</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function targetDetailHtml(empire) {
        const item = targetAssessment(empire);
        if (!item) return '';
        const rows = [];
        if (item.status === 'candidate') {
            rows.push(`<div class="sfib-war-evidence sfib-target-evidence"><b>Target assessment</b><span>${escapeHtml(`${item.label} · ${item.score}/100 · rank #${item.rank}`)}</span></div>`);
            const c = item.components || {};
            const factors = [
                Number.isFinite(c.defScore) ? `DEF ${Math.round(c.defScore)}` : '',
                Number.isFinite(c.boScore) ? `BO ${Math.round(c.boScore)}` : '',
                Number.isFinite(c.territoryScore) ? `Territory ${Math.round(c.territoryScore)}${item.territorySource ? ` (${item.territorySource})` : ''}` : '',
                Number.isFinite(c.freshScore) ? `Freshness ${Math.round(c.freshScore)}` : ''
            ].filter(Boolean).join(' · ');
            if (factors) rows.push(`<div class="sfib-war-evidence sfib-target-evidence"><b>Relative factors</b><span>${escapeHtml(factors)}</span></div>`);
            if (item.shieldPenalty) {
                const states = [item.shieldOnline ? 'Attack Shields ON: -10' : '', item.warpOnline ? 'Warp Shields ON: -4' : ''].filter(Boolean).join(' · ');
                rows.push(`<div class="sfib-war-evidence sfib-target-evidence"><b>Shield penalty</b><span>${escapeHtml(`${states} · heuristic only${Number.isFinite(item.baseScore) ? ` · pre-shield ${item.baseScore}/100` : ''}`)}</span></div>`);
            }
        } else {
            rows.push(`<div class="sfib-war-evidence sfib-target-evidence"><b>Target assessment</b><span>${escapeHtml(targetAssessmentTitle(item))}</span></div>`);
        }
        return rows.join('');
    }

    function editableCellHtml(empire, field, value, placeholder) {
        const assigned = field === 'assigned';
        const visibleLength = Math.max(1, Math.min(14, text(value || placeholder).length));
        const size = assigned ? ` size="${visibleLength}"` : '';
        const extraClass = assigned ? ' sfib-meta-input-assigned' : '';
        return `<input class="sfib-meta-input${extraClass}" type="text" data-empire="${escapeHtml(empire.target)}" data-field="${field}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off"${size}>`;
    }

    function infraHtml(empire) {
        const fab = generalNumber(empire, 'Fab');
        const dplats = generalNumber(empire, 'DPlats');
        if (!Number.isFinite(fab) && !Number.isFinite(dplats)) return placeholderHtml('No infrastructure values reported');
        return `<span class="sfib-infra" title="Fabrication Plants / Defence Platforms from the newest General Scan"><span class="sfib-infra-label">F</span><span class="sfib-infra-value">${compactZeroPlaceholderHtml(fab, '0 Fabrication Plants')}</span><span class="sfib-infra-label">D</span><span class="sfib-infra-value">${compactZeroPlaceholderHtml(dplats, '0 Defence Platforms')}</span></span>`;
    }

    function rowHtml(empire) {
        const latestGeneral = empire.latestGeneral;
        const latestShip = empire.latestShip;
        const defence = empire.latestDefenceValue?.empireDefence;
        const rowKey = encodeURIComponent(empire.target.toLowerCase()).replace(/%/g, '');

        const archivedClass = /(?:^|\b)(?:rip|dead|archived)(?:\b|$)/i.test(empire.notes) ? ' sfib-archived' : '';
        const { postDefeatProtected, recentDefeat } = newsIntelForEmpire(empire);
        const defeatedProtectedClass = postDefeatProtected ? ' sfib-defeated-protected' : '';
        const engagedClass = state.expandedEmpire === empire.target.toLowerCase() ? ' sfib-engaged' : '';
        return `<tr class="sfib-empire-row${archivedClass}${defeatedProtectedClass}${engagedClass}" data-empire-key="${rowKey}" data-target="${escapeHtml(empire.target.toLowerCase())}">
            <td class="sfib-empire-cell">
                <div class="sfib-empire-line">
                    ${recentDefeat ? `<span class="sfib-defeat-skull" title="Defeated ${escapeHtml(newsAgeCompact(ageMs(recentDefeat.epoch)))} ago${newsIntelForEmpire(empire).protectedByBrowser ? '; Sector Browser currently confirms Newbie status' : '; 48-hour protection fallback used if Browser data is unavailable'}">☠</span>` : ''}
                    <button type="button" class="sfib-empire-button" data-action="toggle-detail" data-empire="${escapeHtml(empire.target)}" aria-expanded="${state.expandedEmpire === empire.target.toLowerCase() ? 'true' : 'false'}" aria-controls="sfib-detail-${escapeHtml(empire.target.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" title="Open scan detail">${escapeHtml(displayEmpireName(empire.target))}</button>
                </div>
            </td>
            <td class="sfib-number sfib-current-nw" data-col="networth">${networthRankHtml(empire)}</td>
            <td class="sfib-number sfib-current-territory" data-col="territory">${astLandHtml(empire)}</td>
            <td class="sfib-race" data-col="race">${generalValue(empire, 'Race') ? escapeHtml(generalValue(empire, 'Race')) : placeholderHtml('No Race reported')}</td>
            <td class="sfib-scans" data-col="scans"><div class="sfib-scan-grid">${scansCellHtml(empire)}</div></td>
            <td class="sfib-number sfib-probes-cell" data-col="probes">${probesHtml(empire)}</td>
            <td class="sfib-number sfib-infra-cell" data-col="infra">${infraHtml(empire)}</td>
            <td class="sfib-number sfib-def-cell" data-col="def" title="Most recent Empire Defence value">${Number.isFinite(defence) ? `<span class="sfib-primary-number">${formatCompact(defence)}</span>` : placeholderHtml('No Defence value reported')}</td>
            <td class="sfib-bo-cell" data-col="bo">${boPullsHtml(empire)}</td>
            <td class="sfib-fleet" data-col="ships" title="Ship composition from ${latestShip ? `${TYPE_META[latestShip.type].name}, ${escapeHtml(latestShip.taken.raw)}` : 'no ship scan'}">${fleetHtml(empire)}</td>
            <td class="sfib-shields" data-col="shields">${shieldsWarpHtml(empire)}</td>
            <td class="sfib-war" data-col="war">${warIntelHtml(empire)}</td>
            <td class="sfib-target" data-col="target">${targetAssessmentHtml(empire)}</td>
            <td class="sfib-meta sfib-assigned" data-col="assigned">${editableCellHtml(empire, 'assigned', empire.assigned, '—')}</td>
            <td class="sfib-notes sfib-meta" data-col="notes">${editableCellHtml(empire, 'notes', empire.notes, '—')}</td>
        </tr>`;
    }

    function generalDetailHtml(scan) {
        if (!scan?.general) return '<div class="sfib-detail-empty">No General Scan found.</div>';
        const priority = ['Race', 'Networth', 'Land', 'Roids', 'Credits', 'Power', 'Population', 'Shields', 'Warp', 'Residents', 'Power Plants', 'DPlats', 'Fab', 'Probes', 'Metal', 'Deuterium', 'Iridium'];
        const fields = priority.filter(key => scan.general[key] !== undefined);
        return `<div class="sfib-kv-grid">${fields.map(key => `<div><span>${escapeHtml(key)}</span><b>${escapeHtml(scan.general[key])}</b></div>`).join('')}</div>`;
    }

    function detailStatusHtml(status) {
        const clean = baseStatus(status);
        if (!clean) return placeholderHtml('No status reported');
        const code = shipStatusCode(clean);
        const cls = shipStatusCssClass(code);
        return `<span class="sfib-detail-status ${cls}">${escapeHtml(status)}</span>`;
    }

    function shipsDetailHtml(scan) {
        if (!scan?.ships?.length) return '<div class="sfib-detail-empty">No ship scan found.</div>';

        // Full Dock Scan explicitly exposes the ship's dock. The retained forum
        // output for Defence Scans exposes the contributing ships and statuses,
        // but not an exact per-ship dock field. Do not fill that gap by inference.
        // Instead, omit the otherwise-empty Dock column unless the source is a
        // Full Dock Scan. This keeps the detail table honest and removes clutter.
        const showDock = scan.type === 'fullDock';
        const sortedShips = [...scan.ships].sort(compareShipRows);
        const rows = sortedShips.map(ship => {
            const hpCurrent = (ship.hull.current ?? 0) + (ship.shields.current ?? 0);
            const hpMax = (ship.hull.max ?? 0) + (ship.shields.max ?? 0);
            return `<tr>
                ${showDock ? `<td>${ship.dock ? escapeHtml(ship.dock) : placeholderHtml('No dock reported')}</td>` : ''}
                <td class="sfib-detail-class">${escapeHtml(ship.className)}</td>
                <td>${detailStatusHtml(ship.status)}</td>
                <td class="sfib-number">${formatNumber(hpCurrent)} / ${formatNumber(hpMax)}</td>
                <td class="sfib-number">${Number.isFinite(ship.weapon) ? ship.weapon : placeholderHtml('No weapon-power value')}</td>
                <td class="sfib-number">${Number.isFinite(ship.engine) ? ship.engine : placeholderHtml('No engine-power value')}</td>
                <td class="sfib-number">${Number.isFinite(ship.sensor) ? ship.sensor : placeholderHtml('No sensor-power value')}</td>
            </tr>`;
        }).join('');
        const dockHeader = showDock ? '<th scope="col">Dock</th>' : '';
        return `<div class="sfib-detail-summary"><b>${escapeHtml(classComposition(scan.ships))}</b><span>${escapeHtml(nonDefendingSummary(scan.ships) || 'All scanned ships defending')}</span></div>
            <div class="sfib-mini-table-wrap"><table class="sfib-mini-table"><thead><tr>${dockHeader}<th scope="col">Class</th><th scope="col">Status</th><th scope="col">HP</th><th scope="col">W</th><th scope="col">E</th><th scope="col">S</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function historyHtml(empire) {
        const rows = empire.scans.slice(0, 12).map(scan => {
            const source = scan.sourceId ? `<button type="button" class="sfib-source-button" data-source="${escapeHtml(scan.sourceId)}">raw</button>` : '';
            return `<tr>
                <td><span class="sfib-type-label">${TYPE_META[scan.type].short}</span></td>
                <td>${escapeHtml(scan.taken.raw)}</td>
                <td><span class="sfib-age" data-epoch="${scan.taken.epoch}">${ageLabel(ageMs(scan.taken.epoch))}</span></td>
                <td>${escapeHtml(scan.author)}</td>
                <td>${source}</td>
            </tr>`;
        }).join('');
        return `<div class="sfib-history-table-wrap"><table class="sfib-mini-table sfib-history-table"><thead><tr><th scope="col">Type</th><th scope="col">Taken</th><th scope="col">Age</th><th scope="col">Scanner</th><th scope="col"><span class="sfib-visually-hidden">Source</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function detailRowHtml(empire) {
        const gen = empire.latestGeneral;
        const ship = empire.latestShip;
        const fullDock = empire.latestByType.fullDock;
        const defence = empire.latestByType.defence;
        const defenceMeta = defence ? [
            Number.isFinite(defence.empireDefence) ? `Empire Defence ${formatNumber(defence.empireDefence)}` : '',
            defence.breakCalc ? `BO ${defence.breakCalc}` : '',
            defence.pulls ? `Pulls ${defence.pulls}` : ''
        ].filter(Boolean).join(' · ') : '';

        return `<tr id="sfib-detail-${escapeHtml(empire.target.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" class="sfib-detail-row" data-detail-for="${escapeHtml(empire.target.toLowerCase())}">
            <td colspan="${visibleColumnCount()}">
                <div class="sfib-detail-viewport">
                <div class="sfib-detail-grid">
                    <section class="sfib-detail-card sfib-detail-general">
                        <h4>Latest General <span>${gen ? `${escapeHtml(gen.taken.raw)} · ${escapeHtml(gen.author)}` : 'not scanned'}</span></h4>
                        ${currentSectorDetailHtml(empire)}
                        ${generalDetailHtml(gen)}
                        <div class="sfib-detail-card-footer">
                            <button type="button" class="sfib-detail-action danger" data-action="hide-empire" data-empire="${escapeHtml(empire.target)}" title="Hide this empire from the intelligence board. You can restore it from Config.">Hide Empire</button>
                        </div>
                    </section>
                    <section class="sfib-detail-card sfib-detail-card-wide sfib-detail-ships">
                        <h4>Latest Ship Picture <span>${ship ? `${TYPE_META[ship.type].name} · ${escapeHtml(ship.taken.raw)} · ${escapeHtml(ship.author)}` : 'not scanned'}</span></h4>
                        ${defenceMeta ? `<div class="sfib-defence-meta">${escapeHtml(defenceMeta)}</div>` : ''}
                        ${shipsDetailHtml(ship)}
                    </section>
                    ${fullDock && fullDock !== ship ? `<section class="sfib-detail-card sfib-detail-card-wide sfib-detail-full-dock"><h4>Latest Full Dock <span>${escapeHtml(fullDock.taken.raw)} · ${escapeHtml(fullDock.author)}</span></h4>${shipsDetailHtml(fullDock)}</section>` : ''}
                    <section class="sfib-detail-card sfib-detail-war">
                        <h4>War Activity <span>${state.newsCache?.initialized ? 'cached Alliance News' : 'news cache not yet initialized'}</span></h4>
                        ${warDetailHtml(empire)}
                    </section>
                    <section class="sfib-detail-card sfib-detail-history">
                        <h4>Recent Scan History <span>${empire.scans.length} scan${empire.scans.length === 1 ? '' : 's'} retained on page</span></h4>
                        ${historyHtml(empire)}
                    </section>
                </div>
                </div>
            </td>
        </tr>`;
    }

    function compareEmpires(a, b, sortMode) {
        if (sortMode === 'target-desc') {
            const at = targetAssessment(a);
            const bt = targetAssessment(b);
            const aScore = at?.status === 'candidate' ? (at.score ?? -Infinity) : -Infinity;
            const bScore = bt?.status === 'candidate' ? (bt.score ?? -Infinity) : -Infinity;
            return bScore - aScore || (a.latestDefenceValue?.empireDefence ?? Infinity) - (b.latestDefenceValue?.empireDefence ?? Infinity) || a.target.localeCompare(b.target);
        }
        if (sortMode === 'war-desc') return warSortScore(b) - warSortScore(a) || (b.latestOverall?.taken.epoch || 0) - (a.latestOverall?.taken.epoch || 0) || a.target.localeCompare(b.target);
        if (sortMode === 'empire-asc') return a.target.localeCompare(b.target);
        if (sortMode === 'newest-desc') return (b.latestOverall?.taken.epoch || 0) - (a.latestOverall?.taken.epoch || 0) || a.target.localeCompare(b.target);
        if (sortMode === 'gen-oldest') {
            const aEpoch = a.latestGeneral?.taken.epoch ?? -Infinity;
            const bEpoch = b.latestGeneral?.taken.epoch ?? -Infinity;
            return aEpoch - bEpoch || a.target.localeCompare(b.target);
        }
        if (sortMode === 'def-oldest') {
            const aEpoch = a.latestByType.defence?.taken.epoch ?? -Infinity;
            const bEpoch = b.latestByType.defence?.taken.epoch ?? -Infinity;
            return aEpoch - bEpoch || a.target.localeCompare(b.target);
        }
        const aNw = browserOrGeneralNumber(a, 'networth', 'Networth') ?? -Infinity;
        const bNw = browserOrGeneralNumber(b, 'networth', 'Networth') ?? -Infinity;
        return bNw - aNw || a.target.localeCompare(b.target);
    }

    const state = {
        scans: [],
        empires: [],
        hasStealth: false,
        search: '',
        sortMode: getStored('sort', 'networth-desc'),
        rawHidden: getStored('raw-hidden', 'true') !== 'false',
        columnVisibility: loadColumnVisibility(),
        flexibleWidth: getStored('flexible-width', 'false') === 'true',
        fitFrame: null,
        targetStarCount: (() => { const value = Number(getStored('target-star-count', String(DEFAULT_TARGET_STAR_COUNT))); return Number.isFinite(value) ? Math.max(0, Math.min(10, value)) : DEFAULT_TARGET_STAR_COUNT; })(),
        targetAssessments: new Map(),
        configOpen: false,
        helpOpen: false,
        statusOpen: false,
        expandedEmpire: '',
        threadTable: document.querySelector('table.forumthreadtable'),
        threadBox: document.querySelector('table.forumthreadtable')?.closest('.contentbox') || null,
        board: null,
        host: null,
        modal: null,
        modalOpen: false,
        newsCache: loadNewsCache(),
        newsEvents: [],
        newsIntel: new Map(),
        newsSyncPromise: null,
        newsError: '',
        sectorCache: loadSectorCache(),
        sectorSyncPromise: null,
        sectorError: ''
    };

    function rebuildNewsIntel() {
        state.newsEvents = mergeNewsEvents([], state.newsCache?.events || []);
        state.newsIntel = analyzeAllianceNews(state.newsEvents);
    }

    function newsCacheWallAge() {
        const last = Number(state.newsCache?.lastSyncWall) || 0;
        return last ? Math.max(0, Date.now() - last) : Infinity;
    }

    function newsCacheLabel() {
        if (state.newsSyncPromise) return 'REFRESHING…';
        if (state.newsError) return 'REFRESH NEWS !';
        return 'REFRESH NEWS';
    }

    function updateNewsUi() {
        const button = state.board?.querySelector('#sfib-news-refresh');
        if (button) {
            button.textContent = newsCacheLabel();
            button.disabled = Boolean(state.newsSyncPromise);
            const syncText = state.newsCache?.lastSyncWall
                ? `${newsAgeCompact(newsCacheWallAge())} ago`
                : 'never';
            button.title = state.newsError
                ? `Alliance News refresh failed: ${state.newsError}. Click to retry.`
                : `Cached Alliance News: ${state.newsEvents.length} events, last synced ${syncText}. Automatic refresh is limited to once every 30 minutes while the board is open. Click to refresh now.`;
        }
    }

    async function fetchAllianceNewsPage(start = 0) {
        const url = new URL('/news.php', window.location.origin);
        url.searchParams.set('n', 'alliance');
        if (start) url.searchParams.set('start', String(start));
        const response = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return parseAllianceNewsDocument(doc);
    }

    function sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    async function syncAllianceNews(force = false) {
        if (!IS_ALLIANCE_THREAD) return;
        if (state.newsSyncPromise) return state.newsSyncPromise;
        if (!force && state.newsCache?.initialized && newsCacheWallAge() < NEWS_TTL_MS) {
            updateNewsUi();
            return;
        }

        state.newsError = '';
        state.newsSyncPromise = (async () => {
            const known = new Set((state.newsCache?.events || []).map(newsEventSignature));
            const collected = [];
            const first = await fetchAllianceNewsPage(0);
            collected.push(...first.events);

            const firstHasOverlap = first.events.some(event => known.has(newsEventSignature(event)));
            const offsets = first.offsets.filter(offset => offset > 0);
            const firstSync = !state.newsCache?.initialized || known.size === 0;

            // Normal refresh is one request. Only walk older pages when the
            // newest page no longer overlaps our cache, or on the first sync.
            if (firstSync || (!firstHasOverlap && known.size)) {
                for (const offset of offsets) {
                    await sleep(500); // be polite to the game server
                    const page = await fetchAllianceNewsPage(offset);
                    collected.push(...page.events);
                    if (!firstSync && page.events.some(event => known.has(newsEventSignature(event)))) break;
                }
            }

            state.newsCache.events = mergeNewsEvents(state.newsCache.events || [], collected);
            state.newsCache.initialized = true;
            state.newsCache.lastSyncWall = Date.now();
            saveNewsCache(state.newsCache);
            rebuildNewsIntel();
            state.newsError = '';
            renderRows();
            updateSubtitle();
        })().catch(error => {
            state.newsError = error?.message || String(error);
        }).finally(() => {
            state.newsSyncPromise = null;
            updateNewsUi();
        });

        updateNewsUi();
        return state.newsSyncPromise;
    }

    function maybeSyncAllianceNews() {
        if (!state.modalOpen) return;
        if (!state.newsCache?.initialized || newsCacheWallAge() >= NEWS_TTL_MS) syncAllianceNews(false);
        else updateNewsUi();
    }

    function requiredSectorCoords() {
        const map = new Map();
        for (const empire of state.empires || []) {
            const coords = sectorCoordsFromTarget(empire.target);
            if (coords) map.set(coords.key, coords);
        }
        return Array.from(map.values()).sort((a, b) => a.gid - b.gid || a.sid - b.sid);
    }

    async function fetchSectorBrowserPage(coords) {
        const url = new URL('/browser.php', window.location.origin);
        url.searchParams.set('GID', String(coords.gid));
        url.searchParams.set('SID', String(coords.sid));
        const response = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return parseSectorBrowserDocument(doc, coords.gid, coords.sid);
    }

    async function syncSectorBrowserData() {
        if (!IS_ALLIANCE_THREAD) return;
        if (state.sectorSyncPromise) return state.sectorSyncPromise;
        const stale = requiredSectorCoords().filter(coords => sectorCacheWallAgeForKey(coords.key) >= SECTOR_TTL_MS);
        if (!stale.length) {
            updateSubtitle();
            return;
        }

        state.sectorError = '';
        state.sectorSyncPromise = (async () => {
            for (let index = 0; index < stale.length; index += 1) {
                if (index) await sleep(650); // deliberately serialize multi-sector requests
                const parsed = await fetchSectorBrowserPage(stale[index]);
                cacheSectorParse(parsed, false);
                state.sectorCache = loadSectorCache();
            }
            state.sectorError = '';
            renderRows();
            updateSubtitle();
        })().catch(error => {
            state.sectorError = error?.message || String(error);
        }).finally(() => {
            state.sectorSyncPromise = null;
            updateSubtitle();
        });
        return state.sectorSyncPromise;
    }

    function maybeSyncSectorBrowserData() {
        if (!state.modalOpen) return;
        // Re-read the global cache so a normal Browser visit in another tab can
        // satisfy the TTL without this board generating another request.
        state.sectorCache = loadSectorCache();
        const needsSync = requiredSectorCoords().some(coords => sectorCacheWallAgeForKey(coords.key) >= SECTOR_TTL_MS);
        if (needsSync) syncSectorBrowserData();
    }

    function browserSyncSummary() {
        const coords = requiredSectorCoords();
        if (!coords.length) return 'browser n/a';
        let matched = 0;
        const ages = [];
        for (const item of coords) {
            const sector = state.sectorCache?.sectors?.[item.key];
            if (sector) ages.push(sectorCacheWallAgeForKey(item.key));
        }
        for (const empire of state.empires || []) if (sectorIntelForEmpire(empire)) matched += 1;
        if (!ages.length) return state.sectorError ? 'browser sync failed' : 'browser not yet synced';
        const oldest = Math.max(...ages);
        return `browser ${matched}/${state.empires.length} · synced ${newsAgeCompact(oldest)} ago`;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${BOARD_ID}, #${BOARD_ID} * { box-sizing: border-box; }

            /* Typography system
               ---------------------------------------------------------------
               Meaningful UI text never drops below 12px. Size communicates
               hierarchy; weight communicates importance; color communicates
               state. Do not use semantic colors merely for emphasis. */
            .sfib-launcher,
            #${BOARD_ID} {
                --sfib-font-small: 12px;      /* metadata, badges, controls */
                --sfib-font-body: 13px;       /* ordinary table/detail data */
                --sfib-font-section: 14px;    /* card/section headings */
                --sfib-font-key: 15px;        /* primary tactical numbers */
                --sfib-font-title: 16px;      /* board title */
                --sfib-weight-regular: 400;
                --sfib-weight-medium: 600;
                --sfib-weight-bold: 700;
                --sfib-weight-heavy: 800;
                --sfib-line-compact: 1.15;
                --sfib-line-body: 1.3;
            }
            #${BOARD_ID} {
                --sfib-bg: var(--sfux-bg-panel, #141719);
                --sfib-bg-raised: var(--sfux-bg-panel-raised, #1a1e21);
                --sfib-row: var(--sfux-bg-row, #202224);
                --sfib-row-alt: var(--sfux-bg-row-alt, #1c1e20);
                --sfib-header: var(--sfux-bg-header, #222a2f);
                --sfib-border: var(--sfux-border-normal, rgba(255,255,255,.18));
                --sfib-border-soft: var(--sfux-border-subtle, rgba(255,255,255,.10));
                --sfib-text: var(--sfux-text-primary, rgba(255,255,255,.96));
                --sfib-text2: var(--sfux-text-secondary, rgba(220,226,230,.78));
                --sfib-muted: var(--sfux-text-muted, rgba(190,198,204,.58));
                --sfib-info: var(--sfux-info, #38bfe8);
                --sfib-success: var(--sfux-success, #79cf91);
                --sfib-warning: var(--sfux-warning, #e4c56f);
                --sfib-danger: var(--sfux-danger, #d45d5d);
                --sfib-purple: #b786e8;
                /* Color semantics:
                   primary = current facts / key values
                   secondary = supporting facts
                   muted = metadata, zero/missing/inactive, dead intel
                   green = fresh/positive, amber = aging/caution,
                   red = stale/hostile/returning, blue = informational state,
                   purple = construction/building. */
                width: 100%;
                height: 100%;
                color: var(--sfib-text);
                font-family: "Titillium Web", Arial, sans-serif;
                font-size: var(--sfib-font-body);
                font-weight: var(--sfib-weight-regular);
                line-height: var(--sfib-line-compact);
            }
            .sfib-launcher {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 8px 10px;
                border: 1px solid var(--sfux-border-normal, rgba(255,255,255,.18));
                background: var(--sfux-bg-panel, #141719);
                color: var(--sfux-text-primary, rgba(255,255,255,.96));
                font-family: "Titillium Web", Arial, sans-serif;
            }
            .sfib-launcher-copy { min-width: 0; }
            .sfib-launcher-title { font-size: var(--sfib-font-body); font-weight: var(--sfib-weight-bold); line-height: 1.1; }
            .sfib-launcher-subtitle { margin-top: 2px; color: var(--sfux-text-muted, rgba(190,198,204,.58)); font-size: var(--sfib-font-small); font-weight: var(--sfib-weight-regular); line-height: 1.1; }
            .sfib-launcher-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
            .sfib-launcher button,
            #${BOARD_ID} .sfib-control,
            #${BOARD_ID} button.sfib-control,
            #${BOARD_ID} select.sfib-control,
            #${BOARD_ID} input.sfib-control {
                width: auto !important;
                min-height: 26px !important;
                height: 26px !important;
                margin: 0 !important;
                padding: 3px 7px !important;
                border: 1px solid var(--sfib-border, var(--sfux-border-normal, rgba(255,255,255,.18))) !important;
                border-radius: 3px !important;
                background: var(--sfib-bg-raised, var(--sfux-bg-panel-raised, #1a1e21)) !important;
                color: var(--sfib-text, var(--sfux-text-primary, rgba(255,255,255,.96))) !important;
                font-family: "Titillium Web", Arial, sans-serif !important;
                font-size: var(--sfib-font-small) !important;
                font-weight: var(--sfib-weight-medium) !important;
                line-height: 1 !important;
                cursor: pointer;
            }
            .sfib-launcher button:hover,
            #${BOARD_ID} button.sfib-control:hover { border-color: var(--sfib-info, #38bfe8) !important; }
            /* Persistent active state for toolbar controls that expose panels.
               Keep this intentionally calmer than the hover/focus cyan so an
               open LEGEND/CONFIG reads as selected without looking neon. */
            #${BOARD_ID} button.sfib-control[aria-expanded="true"],
            #${BOARD_ID} button.sfib-control[aria-pressed="true"] {
                border-color: rgba(114,154,178,.72) !important;
                background: rgba(76,101,116,.34) !important;
                color: rgba(245,249,251,.98) !important;
                box-shadow: inset 0 0 0 1px rgba(160,190,207,.10) !important;
            }
            .sfib-launcher .sfib-open-button {
                border-color: rgba(56,191,232,.55) !important;
                color: #dff7ff !important;
            }
            #sfib-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 99990;
                box-sizing: border-box;
                padding: 10px;
                align-items: flex-start;
                justify-content: center;
                overflow: hidden;
                background: rgba(3,5,7,.88);
                backdrop-filter: blur(2px);
            }
            body.sfib-modal-open { overflow: hidden !important; }
            body.sfib-modal-open #sfib-modal { display: flex; }
            #sfib-modal-shell {
                box-sizing: border-box;
                width: 100%;
                height: auto;
                max-height: calc(100vh - 20px);
                min-width: 0;
                overflow: hidden;
                border: 1px solid rgba(255,255,255,.24);
                border-radius: 4px;
                background: #101315;
                box-shadow: 0 18px 70px rgba(0,0,0,.65);
            }
            #${BOARD_ID} .sfib-box {
                position: relative;
                display: flex;
                flex-direction: column;
                width: 100%;
                height: auto;
                max-height: calc(100vh - 20px);
                overflow: hidden;
                background: var(--sfib-bg);
            }
            #${BOARD_ID} .sfib-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                min-height: 38px;
                padding: 5px 8px 5px 10px;
                border-bottom: 1px solid var(--sfib-border);
                background: var(--sfib-header);
                flex: 0 0 auto;
            }
            #${BOARD_ID} .sfib-title-wrap {
                min-width: 0;
                display: flex;
                align-items: center;
                gap: 8px;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-title-wrap::before {
                content: "";
                width: 3px;
                height: 18px;
                flex: 0 0 3px;
                border-radius: 2px;
                background: var(--sfib-info);
                box-shadow: 0 0 10px rgba(56,191,232,.18);
            }
            #${BOARD_ID} .sfib-title {
                margin: 0;
                color: var(--sfib-text);
                font-size: var(--sfib-font-title);
                font-weight: var(--sfib-weight-heavy);
                letter-spacing: .01em;
                line-height: 1.05;
            }
            #${BOARD_ID} .sfib-title-status {
                flex: 0 0 auto;
                padding-left: 6px !important;
                padding-right: 6px !important;
            }
            #${BOARD_ID} .sfib-controls {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
            }
            #${BOARD_ID} .sfib-config-panel,
            #${BOARD_ID} .sfib-help-panel,
            #${BOARD_ID} .sfib-status-panel {
                position: absolute;
                top: 43px;
                z-index: 30;
                max-height: min(76vh, 700px);
                overflow: auto;
                padding: 10px;
                border: 1px solid var(--sfib-border);
                border-radius: 4px;
                background: #171b1e;
                box-shadow: 0 12px 36px rgba(0,0,0,.58);
                color: var(--sfib-text2);
                font-size: var(--sfib-font-body);
                line-height: var(--sfib-line-body);
            }
            #${BOARD_ID} .sfib-config-panel,
            #${BOARD_ID} .sfib-help-panel { right: 10px; }
            #${BOARD_ID} .sfib-status-panel {
                left: 10px;
                width: min(390px, calc(100% - 20px));
                overflow: hidden;
            }
            #${BOARD_ID} .sfib-status-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 7px;
            }
            #${BOARD_ID} .sfib-status-title { color: var(--sfib-text); font-size: var(--sfib-font-section); font-weight: var(--sfib-weight-bold); }
            #${BOARD_ID} .sfib-status-grid {
                display: grid;
                gap: 0;
                border: 1px solid var(--sfib-border-soft);
                border-radius: 3px;
                overflow: hidden;
                background: rgba(255,255,255,.012);
            }
            #${BOARD_ID} .sfib-status-row {
                display: grid;
                grid-template-columns: 118px minmax(0,1fr);
                align-items: center;
                gap: 10px;
                min-height: 30px;
                padding: 5px 8px;
                border-bottom: 1px solid var(--sfib-border-soft);
            }
            #${BOARD_ID} .sfib-status-row:last-child { border-bottom: 0; }
            #${BOARD_ID} .sfib-status-label {
                color: var(--sfib-muted);
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-medium);
            }
            #${BOARD_ID} .sfib-status-value {
                min-width: 0;
                color: var(--sfib-text2);
                font-size: var(--sfib-font-body);
                font-weight: var(--sfib-weight-regular);
                overflow-wrap: anywhere;
            }
            #${BOARD_ID} .sfib-status-thread-value {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                min-width: 0;
            }
            #${BOARD_ID} .sfib-status-thread-id {
                color: var(--sfib-text);
                font-weight: var(--sfib-weight-bold);
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-status-link {
                flex: 0 0 auto;
                color: var(--sfib-info) !important;
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-bold);
                text-decoration: none !important;
                letter-spacing: .03em;
            }
            #${BOARD_ID} .sfib-status-link:hover { text-decoration: underline !important; }
            #${BOARD_ID} .sfib-config-panel { width: min(440px, calc(100% - 20px)); }
            #${BOARD_ID} .sfib-help-panel { width: min(860px, calc(100% - 20px)); max-height: min(82vh, 780px); }
            #${BOARD_ID} .sfib-config-panel[hidden],
            #${BOARD_ID} .sfib-help-panel[hidden] { display: none !important; }
            #${BOARD_ID} .sfib-config-section + .sfib-config-section {
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid var(--sfib-border-soft);
            }
            #${BOARD_ID} .sfib-config-heading {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 6px;
                color: var(--sfib-text);
                font-size: var(--sfib-font-body);
            }
            #${BOARD_ID} .sfib-config-count { color: var(--sfib-muted); font-weight: var(--sfib-weight-regular); }
            #${BOARD_ID} .sfib-config-check {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                cursor: pointer;
            }
            #${BOARD_ID} .sfib-config-check input { margin: 0; }
            #${BOARD_ID} .sfib-config-columns-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 4px 14px;
            }
            #${BOARD_ID} .sfib-config-columns-grid .sfib-config-check { min-width: 0; }
            #${BOARD_ID} .sfib-config-inline { justify-content: space-between; gap: 12px; }
            #${BOARD_ID} .sfib-config-select {
                height: 26px !important;
                min-height: 26px !important;
                margin: 0 !important;
                padding: 1px 24px 1px 7px !important;
                border: 1px solid var(--sfib-border) !important;
                border-radius: 3px !important;
                background: var(--sfib-bg-raised) !important;
                color: var(--sfib-text) !important;
                font: inherit !important;
            }
            #${BOARD_ID} .sfib-config-footnote-tight { margin-top: 6px; }
            #${BOARD_ID} .sfib-config-list { display: grid; gap: 4px; }
            #${BOARD_ID} .sfib-config-empire {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                min-height: 28px;
                padding: 2px 0;
            }
            #${BOARD_ID} .sfib-config-action,
            #${BOARD_ID} .sfib-detail-action {
                width: auto !important;
                min-height: 24px !important;
                height: 24px !important;
                margin: 0 !important;
                padding: 2px 7px !important;
                border: 1px solid var(--sfib-border) !important;
                border-radius: 3px !important;
                background: var(--sfib-bg-raised) !important;
                color: var(--sfib-text2) !important;
                font-family: "Titillium Web", Arial, sans-serif !important;
                font-size: var(--sfib-font-small) !important;
                font-weight: var(--sfib-weight-medium) !important;
                line-height: 1 !important;
                cursor: pointer;
            }
            #${BOARD_ID} .sfib-config-action:hover,
            #${BOARD_ID} .sfib-detail-action:hover { border-color: var(--sfib-info) !important; color: var(--sfib-text) !important; }
            #${BOARD_ID} .sfib-detail-action.danger:hover { border-color: var(--sfib-danger) !important; color: #ffdede !important; }
            #${BOARD_ID} .sfib-config-empty,
            #${BOARD_ID} .sfib-config-footnote { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-config-footnote { margin-top: 10px; font-size: var(--sfib-font-small); }
            #${BOARD_ID} .sfib-help-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 8px;
                padding-bottom: 7px;
                border-bottom: 1px solid var(--sfib-border-soft);
            }
            #${BOARD_ID} .sfib-help-title {
                color: var(--sfib-text);
                font-size: var(--sfib-font-key);
                font-weight: var(--sfib-weight-bold);
                line-height: 1.1;
            }
            #${BOARD_ID} .sfib-help-close {
                width: 26px !important;
                min-width: 26px !important;
                height: 24px !important;
                min-height: 24px !important;
                padding: 0 !important;
                border: 1px solid var(--sfib-border) !important;
                border-radius: 3px !important;
                background: var(--sfib-bg-raised) !important;
                color: var(--sfib-text2) !important;
                font: 17px/22px "Titillium Web", Arial, sans-serif !important;
                cursor: pointer;
            }
            #${BOARD_ID} .sfib-help-close:hover { border-color: var(--sfib-info) !important; color: var(--sfib-text) !important; }
            #${BOARD_ID} .sfib-help-columns {
                display: grid;
                grid-template-columns: repeat(2, minmax(0,1fr));
                gap: 12px;
            }
            #${BOARD_ID} .sfib-help-section {
                min-width: 0;
                padding: 10px 11px;
                border: 1px solid var(--sfib-border-soft);
                border-radius: 3px;
                background: rgba(255,255,255,.018);
                text-align: left;
            }
            #${BOARD_ID} .sfib-help-section.wide { grid-column: 1 / -1; }
            #${BOARD_ID} .sfib-help-heading {
                margin: 0 0 8px;
                color: var(--sfib-text);
                font-size: var(--sfib-font-section);
                font-weight: var(--sfib-weight-bold);
                line-height: var(--sfib-line-compact);
                text-align: left;
            }
            #${BOARD_ID} .sfib-help-row {
                display: grid;
                grid-template-columns: 108px minmax(0,1fr);
                align-items: center;
                gap: 10px;
                min-height: 25px;
                color: var(--sfib-text2);
                text-align: left;
            }
            #${BOARD_ID} .sfib-help-row + .sfib-help-row { margin-top: 5px; }
            #${BOARD_ID} .sfib-help-copy { min-width: 0; line-height: 1.35; text-align: left; }
            #${BOARD_ID} .sfib-help-copy b { color: var(--sfib-text); }
            #${BOARD_ID} .sfib-help-muted { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-help-status-sample {
                display: inline-flex;
                align-items: center;
                min-width: 108px;
                font-size: var(--sfib-font-body);
                font-weight: var(--sfib-weight-bold);
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-help-probe-sample {
                display: inline-flex;
                align-items: baseline;
                min-width: 108px;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-help-probe-sample .sfib-primary-number { font-size: var(--sfib-font-key); }
            #${BOARD_ID} .sfib-help-note {
                margin-top: 8px;
                padding-top: 7px;
                border-top: 1px solid var(--sfib-border-soft);
                color: var(--sfib-muted);
                font-size: var(--sfib-font-small);
                line-height: 1.35;
                text-align: left;
            }
            #${BOARD_ID} input.sfib-control { width: 190px !important; cursor: text; }
            #${BOARD_ID} select.sfib-control { cursor: default; }
            #${BOARD_ID} .sfib-close-button {
                width: 30px !important;
                min-width: 30px !important;
                padding: 0 !important;
                font-size: 20px !important;
                font-weight: 300 !important;
                line-height: 26px !important;
            }
            #${BOARD_ID} .sfib-table-wrap {
                /* The wrapper is the single scroll viewport for the main grid.
                   It must be allowed to become narrower than the table itself so
                   content-fit mode exposes a real horizontal scroll range. */
                flex: 0 1 auto;
                min-width: 0;
                min-height: 0;
                width: 100%;
                max-width: 100%;
                box-sizing: border-box;
                overflow-x: auto !important;
                overflow-y: auto;
                scrollbar-gutter: stable;
                overscroll-behavior: contain;
                touch-action: pan-x pan-y;
                background: var(--sfib-bg);
            }
            #${BOARD_ID} .sfib-table-wrap.sfib-has-x-overflow {
                overflow-x: scroll !important;
            }
            /* Keep the native vertical scrollbar, but do not rely on the macOS/Safari
               horizontal overlay scrollbar: it auto-hides even while overflow remains.
               A persistent SFIB scrollbar rail below the grid handles x navigation. */
            #${BOARD_ID} .sfib-table-wrap::-webkit-scrollbar:vertical { width: 9px; }
            #${BOARD_ID} .sfib-table-wrap::-webkit-scrollbar:horizontal { height: 0; }
            #${BOARD_ID} .sfib-table-wrap::-webkit-scrollbar-track { background: rgba(255,255,255,.025); }
            #${BOARD_ID} .sfib-table-wrap::-webkit-scrollbar-thumb {
                background: rgba(160,176,186,.28);
                border: 2px solid transparent;
                border-radius: 999px;
                background-clip: padding-box;
            }
            #${BOARD_ID} .sfib-table-wrap::-webkit-scrollbar-thumb:hover { background: rgba(180,198,208,.40); background-clip: padding-box; }
            #${BOARD_ID} .sfib-x-scrollbar {
                flex: 0 0 14px;
                height: 14px;
                min-height: 14px;
                padding: 4px 7px;
                border-top: 1px solid var(--sfib-border-soft);
                background: #111517;
                user-select: none;
            }
            #${BOARD_ID} .sfib-x-scrollbar[hidden] { display: none !important; }
            #${BOARD_ID} .sfib-x-scroll-track {
                position: relative;
                width: 100%;
                height: 6px;
                border-radius: 999px;
                background: rgba(190,198,204,.10);
                cursor: pointer;
                outline: none;
            }
            #${BOARD_ID} .sfib-x-scroll-track:focus-visible {
                outline: 1px solid rgba(114,154,178,.72) !important;
                outline-offset: 2px !important;
            }
            #${BOARD_ID} .sfib-x-scroll-thumb {
                position: absolute;
                top: 0;
                left: 0;
                width: 48px;
                min-width: 48px;
                height: 6px;
                border-radius: 999px;
                background: rgba(178,194,204,.46);
                cursor: grab;
                will-change: transform, width;
            }
            #${BOARD_ID} .sfib-x-scroll-thumb:hover { background: rgba(194,209,218,.60); }
            #${BOARD_ID} .sfib-x-scroll-thumb.sfib-dragging {
                background: rgba(204,218,226,.72);
                cursor: grabbing;
            }
            /* Main-grid hierarchy:
               15/700 = primary tactical numbers (Probes, Def)
               13/700 = primary identifiers/composition/BO
               13/400 = ordinary current data
               12/600-700 = badges, deltas, labels, metadata
               Semantic color is reserved for state, not importance. */
            #${BOARD_ID} .sfib-table {
                width: 100%;
                min-width: 0;
                margin: 0;
                border-collapse: collapse;
                table-layout: auto;
                background: var(--sfib-bg);
                color: var(--sfib-text);
                font-size: var(--sfib-font-body);
                font-weight: var(--sfib-weight-regular);
                line-height: var(--sfib-line-compact);
                --sfib-cell-pad-x: 6px;
            }
            /* Columns 1-14 hug their actual content. Notes remains the elastic
               column and absorbs leftover width instead of forcing denser data. */
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(-n+14),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(-n+14) {
                width: 1%;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(1),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(1) { min-width: 165px; }
            /* Alignment needs some real horizontal room to be visually meaningful.
               These are modest minimums, not fixed widths, so content can still grow. */
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(2),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(2) { min-width: 108px; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(3),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(3) { min-width: 104px; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(5),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(5) { min-width: 296px; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(6),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(6) { min-width: 90px; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(8),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(8) { min-width: 70px; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(11),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(11) { min-width: 92px; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(12),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(12) { min-width: 0; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(13),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(13) { min-width: 78px; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(14),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(14) { min-width: 0; }
            #${BOARD_ID} .sfib-table > thead > tr > th:nth-child(15),
            #${BOARD_ID} .sfib-table > tbody > tr > td:nth-child(15) {
                width: auto;
                min-width: 180px;
            }
            #${BOARD_ID} .sfib-table > thead > tr > th,
            #${BOARD_ID} .sfib-table > tbody > tr > td {
                height: var(--sfib-row-h, 30px);
                /* Keep row height compact. Breathing room is horizontal only;
                   vertical centering comes from the row height + vertical-align. */
                padding: 0 var(--sfib-cell-pad-x);
                box-sizing: border-box;
                border-right: 1px solid var(--sfib-border-soft);
                border-bottom: 1px solid var(--sfib-border-soft);
                vertical-align: middle;
                text-align: left;
                overflow: hidden;
            }
            /* Semantic alignment must come after the generic cell reset above.
               Numbers compare on an edge; compact state/instrument groups center. */
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-current-nw,
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-current-territory,
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-probes-cell {
                text-align: right;
            }
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-scans,
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-infra-cell,
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-def-cell,
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-shields,
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-war,
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-target {
                text-align: center;
            }
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-infra-cell .sfib-infra {
                margin-inline: auto;
            }
            #${BOARD_ID} .sfib-th-inline {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
            }
            #${BOARD_ID} .sfib-th-hide {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 17px !important;
                min-width: 17px !important;
                height: 17px !important;
                min-height: 17px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 1px solid rgba(255,255,255,.14) !important;
                border-radius: 3px !important;
                background: transparent !important;
                color: var(--sfib-muted) !important;
                font: 14px/15px Arial, sans-serif !important;
                cursor: pointer;
            }
            #${BOARD_ID} .sfib-th-hide:hover { color: var(--sfib-text) !important; border-color: var(--sfib-info) !important; }
            #${BOARD_ID} .sfib-table > thead > tr > th:last-child,
            #${BOARD_ID} .sfib-table > tbody > tr > td:last-child { border-right: 0; }
            #${BOARD_ID} .sfib-table > thead > tr > th {
                position: sticky;
                top: 0;
                z-index: 2;
                background: var(--sfib-header);
                color: var(--sfib-text);
                font-weight: var(--sfib-weight-bold);
                text-align: center;
                white-space: nowrap;
                box-shadow: 0 1px 0 rgba(255,255,255,.08);
            }
            /* Freeze the Empire rail while the main grid scrolls horizontally.
               Only the actual empire cells participate; expanded detail colspan
               rows remain normal full-width content. */
            #${BOARD_ID} .sfib-table > thead > tr > th:first-child {
                left: 0;
                z-index: 4;
                box-shadow: 0 1px 0 rgba(255,255,255,.08);
            }
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > .sfib-empire-cell {
                position: sticky;
                left: 0;
                z-index: 3;
                box-shadow: none;
            }
            /* Once the grid actually moves under the frozen Empire rail, add a
               directional edge shadow so it is obvious that data continues
               behind the sticky column. Keep it absent at scrollLeft=0. */
            #${BOARD_ID} .sfib-table-wrap.sfib-is-x-scrolled .sfib-table > thead > tr > th:first-child {
                box-shadow: 0 1px 0 rgba(255,255,255,.08), 10px 0 14px -10px rgba(0,0,0,.96), 1px 0 0 rgba(255,255,255,.08);
            }
            #${BOARD_ID} .sfib-table-wrap.sfib-is-x-scrolled .sfib-table > tbody > .sfib-empire-row > .sfib-empire-cell {
                box-shadow: 10px 0 14px -10px rgba(0,0,0,.96), 1px 0 0 rgba(255,255,255,.06);
            }
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row:hover > .sfib-empire-cell {
                background: #1d292e !important;
                background: color-mix(in srgb, var(--sfib-row) 93%, var(--sfib-info) 7%) !important;
            }
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row.sfib-engaged > .sfib-empire-cell {
                background: #1d2c32 !important;
                background: color-mix(in srgb, var(--sfib-row) 90%, var(--sfib-info) 10%) !important;
            }
            #${BOARD_ID} .sfib-empire-row:nth-of-type(odd) td { background: var(--sfib-row); }
            #${BOARD_ID} .sfib-empire-row:nth-of-type(even) td { background: var(--sfib-row-alt); }
            /* Hover/engaged rows must remain opaque. A translucent background on the
               frozen Empire cell lets horizontally scrolled columns show through it. */
            #${BOARD_ID} .sfib-empire-row:hover td {
                background: #1d292e;
                background: color-mix(in srgb, var(--sfib-row) 93%, var(--sfib-info) 7%);
            }
            #${BOARD_ID} .sfib-empire-row.sfib-engaged td {
                background: #1d2c32 !important;
                background: color-mix(in srgb, var(--sfib-row) 90%, var(--sfib-info) 10%) !important;
            }
            #${BOARD_ID} .sfib-empire-row.sfib-engaged > td:first-child {
                box-shadow: inset 3px 0 0 rgba(56,191,232,.62);
            }
            #${BOARD_ID} .sfib-table-wrap.sfib-is-x-scrolled .sfib-empire-row.sfib-engaged > td:first-child {
                box-shadow: inset 3px 0 0 rgba(56,191,232,.62), 10px 0 14px -10px rgba(0,0,0,.96), 1px 0 0 rgba(255,255,255,.06);
            }
            #${BOARD_ID} .sfib-empire-row.sfib-engaged .sfib-empire-button {
                color: var(--sfib-info);
            }
            #${BOARD_ID} .sfib-empire-row.sfib-archived { opacity: .46; }
            /* A defeated enemy is treated as protected for 48 hours. Dim only
               neutral/white row content; semantic badges keep their own colors. */
            #${BOARD_ID} .sfib-empire-row.sfib-defeated-protected td { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-empire-row.sfib-defeated-protected .sfib-empire-button { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-empire-row.sfib-defeated-protected .sfib-meta-input { color: var(--sfib-muted) !important; }
            #${BOARD_ID} .sfib-empire-cell {
                /* position is sticky above; keep this selector for local child anchoring. */
            }
            #${BOARD_ID} .sfib-empire-line {
                display: flex;
                align-items: baseline;
                gap: 5px;
                min-width: 0;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-empire-button {
                display: block;
                width: auto;
                min-width: 0;
                flex: 1 1 auto;
                margin: 0;
                padding: 0 0 1px;
                border: 0;
                background: transparent;
                color: var(--sfib-text);
                font: inherit;
                font-weight: var(--sfib-weight-bold);
                text-align: left;
                cursor: pointer;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #${BOARD_ID} .sfib-empire-button:hover { color: var(--sfib-info); }
            #${BOARD_ID} .sfib-defeat-skull {
                display: inline-flex;
                flex: 0 0 auto;
                align-items: center;
                justify-content: center;
                color: var(--sfib-success);
                font-size: var(--sfib-font-section);
                line-height: 1;
                cursor: help;
            }
            /* Main-table alignment standard:
               - identifiers/prose/sequences: left
               - comparable numeric values: right
               - compact state/instrument groups: center
               Headers remain centered for a consistent visual rail. */
            #${BOARD_ID} .sfib-number { text-align: right; font-variant-numeric: tabular-nums; }
            #${BOARD_ID} .sfib-empire-cell,
            #${BOARD_ID} .sfib-race,
            #${BOARD_ID} .sfib-bo-cell,
            #${BOARD_ID} .sfib-fleet,
            #${BOARD_ID} .sfib-assigned { text-align: left; }
            #${BOARD_ID} .sfib-scans,
            #${BOARD_ID} .sfib-infra-cell,
            #${BOARD_ID} .sfib-shields,
            #${BOARD_ID} .sfib-war,
            #${BOARD_ID} .sfib-target { text-align: center; }
            #${BOARD_ID} .sfib-current-nw,
            #${BOARD_ID} .sfib-current-territory,
            #${BOARD_ID} .sfib-probes-cell { text-align: right; }
            #${BOARD_ID} .sfib-def-cell { text-align: center !important; }
            #${BOARD_ID} .sfib-primary-number { display: inline-block; font-size: var(--sfib-font-key); font-weight: var(--sfib-weight-bold); line-height: 1; }
            #${BOARD_ID} .sfib-def-cell .sfib-primary-number { width: 100%; text-align: center; }
            #${BOARD_ID} .sfib-delta { display: inline; margin-left: 4px; color: var(--sfib-muted); font-size: var(--sfib-font-small); }
            #${BOARD_ID} .sfib-current-stat { display: flex; width: 100%; align-items: baseline; justify-content: flex-end; gap: 5px; font-weight: var(--sfib-weight-bold); white-space: nowrap; font-variant-numeric: tabular-nums; }
            #${BOARD_ID} .sfib-networth-value { display: inline-block; text-align: right; }
            #${BOARD_ID} .sfib-rank {
                display: inline-block;
                flex: 0 0 4ch;
                width: 4ch;
                text-align: right;
                color: var(--sfib-muted);
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-medium);
                font-variant-numeric: tabular-nums;
            }
            #${BOARD_ID} .sfib-territory { display: flex; width: 100%; align-items: baseline; justify-content: flex-end; gap: 4px; white-space: nowrap; }
            #${BOARD_ID} .sfib-territory-sep { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-infra {
                display: inline-grid;
                grid-template-columns: 11px 46px 19px 46px;
                column-gap: 3px;
                align-items: baseline;
                white-space: nowrap;
                color: var(--sfib-text2);
                font-variant-numeric: tabular-nums;
            }
            #${BOARD_ID} .sfib-infra-label {
                color: var(--sfib-muted);
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-bold);
                text-align: left;
            }
            #${BOARD_ID} .sfib-infra-label:nth-child(3) {
                padding-left: 8px;
                box-sizing: border-box;
            }
            #${BOARD_ID} .sfib-infra-value {
                color: var(--sfib-text2);
                font-size: var(--sfib-font-body);
                font-weight: var(--sfib-weight-regular);
                text-align: right;
                min-width: 0;
            }
            #${BOARD_ID} .sfib-current-fallback { color: var(--sfib-text2); }
            #${BOARD_ID} .sfib-current-sector {
                display: block;
                margin: 0 0 7px;
                padding: 5px 7px;
                border: 1px solid var(--sfib-border-soft);
                background: rgba(56,191,232,.045);
                font-size: var(--sfib-font-body);
                line-height: 1.2;
                min-width: 0;
            }
            #${BOARD_ID} .sfib-current-sector-head {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 8px;
                min-width: 0;
            }
            #${BOARD_ID} .sfib-current-sector-head > b {
                color: var(--sfib-info);
                white-space: nowrap;
                flex: 0 0 auto;
            }
            #${BOARD_ID} .sfib-current-sector-head > b .sfib-sector-coords {
                margin-left: 3px;
                color: var(--sfib-muted);
                font-weight: var(--sfib-weight-regular);
            }
            #${BOARD_ID} .sfib-current-sector-head > small {
                min-width: 0;
                color: var(--sfib-muted);
                font-size: var(--sfib-font-small);
                white-space: nowrap;
                flex: 0 1 auto;
                text-align: right;
            }
            #${BOARD_ID} .sfib-current-sector-data {
                margin-top: 3px;
                min-width: 0;
                color: var(--sfib-text);
                overflow-wrap: anywhere;
                white-space: normal;
            }
            #${BOARD_ID} .sfib-current-sector-missing { background: transparent; }
            #${BOARD_ID} .sfib-current-sector-missing .sfib-current-sector-data { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-bo-cell { text-align: left; white-space: nowrap; }
            #${BOARD_ID} .sfib-bo {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-size: var(--sfib-font-body);
                line-height: 1.1;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
                color: var(--sfib-text);
            }
            #${BOARD_ID} .sfib-bo-freshness {
                display: inline-block;
                flex: 0 0 3px;
                width: 3px;
                height: 13px;
                border-radius: 2px;
                background: var(--sfib-muted);
            }
            #${BOARD_ID} .sfib-bo-main { font-weight: var(--sfib-weight-bold); color: var(--sfib-text); }
            #${BOARD_ID} .sfib-bo-pulls { font-weight: var(--sfib-weight-medium); color: var(--sfib-text2); }
            #${BOARD_ID} .sfib-bo-sep { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-bo.fresh .sfib-bo-freshness { background: var(--sfib-success); }
            #${BOARD_ID} .sfib-bo.warm .sfib-bo-freshness { background: var(--sfib-warning); }
            #${BOARD_ID} .sfib-bo.old .sfib-bo-freshness { background: var(--sfib-danger); }
            #${BOARD_ID} .sfib-bo.dead .sfib-bo-freshness { background: var(--sfib-muted); }
            #${BOARD_ID} .sfib-bo.dead .sfib-bo-main,
            #${BOARD_ID} .sfib-bo.dead .sfib-bo-pulls,
            #${BOARD_ID} .sfib-bo.dead .sfib-bo-sep { color: var(--sfib-muted); opacity: .65; }
            #${BOARD_ID} .sfib-target { text-align: center; white-space: nowrap; }
            #${BOARD_ID} .sfib-target-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 58px;
                min-height: 20px;
                padding: 1px 5px;
                border: 1px solid var(--sfib-border-soft);
                border-radius: 3px;
                background: var(--sfib-bg-raised);
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-bold);
                line-height: 1;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-target-badge.prime {
                border-color: rgba(121,207,145,.80);
                background: rgba(121,207,145,.13);
                color: var(--sfib-success);
            }
            #${BOARD_ID} .sfib-target-badge.good {
                border-color: rgba(121,207,145,.48);
                background: rgba(121,207,145,.075);
                color: var(--sfib-success);
            }
            #${BOARD_ID} .sfib-target-badge.fair,
            #${BOARD_ID} .sfib-target-badge.recheck {
                border-color: rgba(228,197,111,.60);
                background: rgba(228,197,111,.09);
                color: var(--sfib-warning);
            }
            #${BOARD_ID} .sfib-target-badge.hard {
                border-color: rgba(212,93,93,.60);
                background: rgba(212,93,93,.09);
                color: var(--sfib-danger);
            }
            #${BOARD_ID} .sfib-target-badge.dead,
            #${BOARD_ID} .sfib-target-badge.unknown {
                color: var(--sfib-muted);
                border-color: rgba(137,146,153,.28);
                background: rgba(137,146,153,.035);
            }
            #${BOARD_ID} .sfib-target-badge.down {
                color: var(--sfib-success);
                border-color: rgba(121,207,145,.38);
                background: rgba(121,207,145,.045);
                opacity: .72;
            }
            #${BOARD_ID} .sfib-target-badge.down.newb {
                color: var(--sfib-info);
                border-color: rgba(56,191,232,.42);
                background: rgba(56,191,232,.055);
                opacity: .78;
            }
            #${BOARD_ID} .sfib-target-combo { display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; }
            #${BOARD_ID} .sfib-target-star-inline {
                display: inline-block;
                margin-right: 4px;
                color: var(--sfib-warning);
                font-size: var(--sfib-font-small);
                line-height: 1;
                transform: translateY(-.25px);
            }
            #${BOARD_ID} .sfib-sr-only {
                position: absolute !important;
                width: 1px !important;
                height: 1px !important;
                padding: 0 !important;
                margin: -1px !important;
                overflow: hidden !important;
                clip: rect(0,0,0,0) !important;
                white-space: nowrap !important;
                border: 0 !important;
            }
            #${BOARD_ID} .sfib-muted { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-placeholder {
                display: inline-block;
                min-width: .65em;
                color: var(--sfib-muted) !important;
                opacity: .38;
                font-size: var(--sfib-font-small) !important;
                font-weight: var(--sfib-weight-regular) !important;
                line-height: 1 !important;
                text-align: center;
                vertical-align: baseline;
            }
            #${BOARD_ID} .sfib-primary-number .sfib-placeholder,
            #${BOARD_ID} .sfib-current-stat .sfib-placeholder,
            #${BOARD_ID} .sfib-infra-value .sfib-placeholder {
                font-size: var(--sfib-font-small) !important;
                font-weight: var(--sfib-weight-regular) !important;
            }
            #${BOARD_ID} .sfib-scans { padding: 0 var(--sfib-cell-pad-x) !important; text-align: center; }
            #${BOARD_ID} .sfib-scan-grid {
                display: flex;
                width: 100%;
                align-items: center;
                justify-content: center;
                gap: 4px;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-scan-pill {
                display: inline-flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                width: 92px;
                min-width: 92px;
                padding: 2px 5px;
                border: 1px solid var(--sfib-border-soft);
                border-radius: 3px;
                background: var(--sfib-bg-raised);
                font-size: var(--sfib-font-small);
                line-height: 1.1;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-scan-pill b {
                flex: 0 0 auto;
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-bold);
                letter-spacing: .02em;
            }
            #${BOARD_ID} .sfib-scan-pill span {
                flex: 0 0 auto;
                overflow: visible;
                text-align: right;
                font-weight: var(--sfib-weight-regular);
            }
            #${BOARD_ID} .sfib-scan-pill.fresh {
                border-color: rgba(121,207,145,.60);
                background: rgba(121,207,145,.09);
                color: var(--sfib-success);
            }
            #${BOARD_ID} .sfib-scan-pill.warm {
                border-color: rgba(228,197,111,.60);
                background: rgba(228,197,111,.09);
                color: var(--sfib-warning);
            }
            #${BOARD_ID} .sfib-scan-pill.old {
                border-color: rgba(212,93,93,.65);
                background: rgba(212,93,93,.09);
                color: var(--sfib-danger);
            }
            #${BOARD_ID} .sfib-scan-pill.dead {
                border-color: rgba(137,146,153,.28);
                background: rgba(137,146,153,.035);
                color: var(--sfib-muted);
                opacity: .62;
            }
            #${BOARD_ID} .sfib-scan-pill.missing {
                color: var(--sfib-muted);
                opacity: .50;
            }
            #${BOARD_ID} .sfib-fleet { white-space: nowrap; }
            #${BOARD_ID} .sfib-fleet-main {
                display: inline;
                font-weight: var(--sfib-weight-bold);
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-fleet-class { white-space: nowrap; }
            #${BOARD_ID} .sfib-class-status {
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-medium);
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
                opacity: .82;
            }
            #${BOARD_ID} .sfib-status-bracket,
            #${BOARD_ID} .sfib-status-space { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-status-token.returning { color: var(--sfib-danger); }
            #${BOARD_ID} .sfib-status-token.disabled { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-status-token.upgrading { color: var(--sfib-info); }
            #${BOARD_ID} .sfib-status-token.building { color: var(--sfib-purple); }
            #${BOARD_ID} .sfib-status-token.other { color: var(--sfib-warning); }
            #${BOARD_ID} .sfib-fleet-sep { color: var(--sfib-muted); font-weight: var(--sfib-weight-regular); }
            #${BOARD_ID} .sfib-shields { text-align: center; white-space: nowrap; }
            #${BOARD_ID} .sfib-state-grid {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-state-pill {
                display: inline-flex;
                align-items: center;
                justify-content: space-between;
                gap: 5px;
                width: 49px;
                min-width: 49px;
                padding: 2px 5px;
                border: 1px solid var(--sfib-border-soft);
                border-radius: 3px;
                background: var(--sfib-bg-raised);
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-bold);
                line-height: 1.1;
                font-variant-numeric: tabular-nums;
                box-sizing: border-box;
            }
            #${BOARD_ID} .sfib-state-pill b { font-size: var(--sfib-font-small); }
            #${BOARD_ID} .sfib-state-pill.off {
                border-color: transparent;
                background: transparent;
                color: var(--sfib-muted);
                opacity: .55;
            }
            #${BOARD_ID} .sfib-state-pill.on {
                border-color: rgba(212,93,93,.70);
                background: rgba(212,93,93,.11);
                color: var(--sfib-danger);
            }
            #${BOARD_ID} .sfib-state-pill.neutral {
                color: var(--sfib-muted);
                opacity: .75;
            }
            #${BOARD_ID} .sfib-war { text-align: center; white-space: nowrap; }
            #${BOARD_ID} .sfib-war-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                min-height: 20px;
                padding: 1px 5px;
                border: 1px solid var(--sfib-border-soft);
                border-radius: 3px;
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-bold);
                line-height: 1;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-war-badge + .sfib-war-badge { margin-left: 4px; }
            #${BOARD_ID} .sfib-war-badge.defeated {
                border-color: rgba(121,207,145,.70);
                background: rgba(121,207,145,.11);
                color: var(--sfib-success);
            }
            #${BOARD_ID} .sfib-war-badge.newb {
                border-color: rgba(56,191,232,.70);
                background: rgba(56,191,232,.10);
                color: var(--sfib-info);
            }
            #${BOARD_ID} .sfib-war-badge.breaker {
                border-color: rgba(228,197,111,.60);
                background: rgba(228,197,111,.09);
                color: var(--sfib-warning);
            }
            #${BOARD_ID} .sfib-war-badge.breaker.strong {
                border-color: rgba(228,197,111,.85);
                background: rgba(228,197,111,.14);
            }
            #${BOARD_ID} .sfib-news-age { font-variant-numeric: tabular-nums; }
            #${BOARD_ID} .sfib-war-evidence {
                display: grid;
                grid-template-columns: max-content minmax(0, 1fr);
                align-items: start;
                gap: 10px;
                min-width: 0;
                padding: 3px 0;
                border-bottom: 1px solid rgba(255,255,255,.045);
                color: var(--sfib-text2);
                font-size: var(--sfib-font-body);
                line-height: var(--sfib-line-body);
            }
            #${BOARD_ID} .sfib-war-evidence b {
                color: var(--sfib-warning);
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-war-evidence span {
                min-width: 0;
                max-width: 100%;
                text-align: right;
                white-space: normal;
                overflow-wrap: anywhere;
                word-break: normal;
            }
            #${BOARD_ID} .sfib-war-history { margin-top: 6px; }
            #${BOARD_ID} #sfib-news-refresh[disabled] { opacity: .60; cursor: wait; }
            #${BOARD_ID} .sfib-meta-input {
                width: 100% !important;
                min-width: 0 !important;
                height: 21px !important;
                min-height: 21px !important;
                margin: 0 !important;
                padding: 1px 3px !important;
                border: 1px solid transparent !important;
                border-radius: 2px !important;
                background: transparent !important;
                color: var(--sfib-text) !important;
                font: inherit !important;
                line-height: 1.1 !important;
            }
            #${BOARD_ID} .sfib-meta-input:hover,
            #${BOARD_ID} .sfib-meta-input:focus {
                border-color: var(--sfib-border) !important;
                background: var(--sfib-bg-raised) !important;
                outline: none !important;
            }
            #${BOARD_ID} .sfib-meta-input::placeholder { color: var(--sfib-muted); opacity: .38; font-weight: var(--sfib-weight-regular); }
            #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > td:nth-child(14) .sfib-meta-input {
                width: auto !important;
                min-width: 1ch !important;
                max-width: 14ch !important;
                field-sizing: content;
            }
            #${BOARD_ID} .sfib-visually-hidden {
                position: absolute !important;
                width: 1px !important;
                height: 1px !important;
                padding: 0 !important;
                margin: -1px !important;
                overflow: hidden !important;
                clip: rect(0, 0, 0, 0) !important;
                white-space: nowrap !important;
                border: 0 !important;
            }
            #${BOARD_ID} button:focus-visible,
            #${BOARD_ID} input:focus-visible,
            #${BOARD_ID} select:focus-visible {
                outline: 1px solid rgba(114, 154, 178, 0.72) !important;
                outline-offset: 1px !important;
                box-shadow: 0 0 0 1px rgba(114, 154, 178, 0.14) !important;
            }
            #${BOARD_ID} .sfib-detail-row,
            #${BOARD_ID} .sfib-detail-row > td {
                height: auto !important;
            }
            #${BOARD_ID} .sfib-detail-row > td {
                padding: 0 !important;
                background: #121619 !important;
            }
            #${BOARD_ID} .sfib-detail-viewport {
                /* Expanded detail is a viewport-level panel, not another source
                   of table width. Keep it inside the currently visible board
                   width even when the main grid itself is horizontally scrollable. */
                position: sticky;
                left: 0;
                width: var(--sfib-detail-viewport-w, 100%);
                max-width: var(--sfib-detail-viewport-w, 100%);
                min-width: 0;
                box-sizing: border-box;
                overflow: hidden;
                background: #121619;
            }
            #${BOARD_ID} .sfib-detail-card-footer {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                margin-top: 8px;
                padding-top: 7px;
                border-top: 1px solid rgba(255,255,255,.06);
            }
            #${BOARD_ID} .sfib-detail-grid {
                display: grid;
                /* Detail-view priority: General stays compact, Ship Picture gets
                   enough room for its dense table, and War Activity gets a larger
                   share than before so evidence text does not feel squeezed. */
                grid-template-columns: minmax(280px,.9fr) minmax(500px,1.45fr) minmax(360px,1.15fr);
                align-items: start;
                gap: 10px;
                padding: 10px;
            }
            #${BOARD_ID} .sfib-detail-full-dock,
            #${BOARD_ID} .sfib-detail-history { grid-column: 1 / -1; }
            #${BOARD_ID} .sfib-detail-card {
                min-width: 0;
                overflow: hidden;
                padding: 10px;
                border: 1px solid var(--sfib-border-soft);
                border-radius: 3px;
                background: var(--sfib-bg-raised);
            }
            #${BOARD_ID} .sfib-detail-card h4 {
                display: flex;
                flex-wrap: wrap;
                align-items: baseline;
                justify-content: space-between;
                gap: 3px 12px;
                margin: 0 0 8px;
                padding-bottom: 6px;
                border-bottom: 1px solid rgba(255,255,255,.06);
                color: var(--sfib-text);
                font-size: var(--sfib-font-section);
                font-weight: var(--sfib-weight-bold);
                line-height: 1.25;
            }
            #${BOARD_ID} .sfib-detail-card h4 span {
                min-width: 0;
                color: var(--sfib-muted);
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-regular);
                line-height: 1.35;
                overflow-wrap: anywhere;
            }
            #${BOARD_ID} .sfib-kv-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0,1fr));
                gap: 0 12px;
            }
            #${BOARD_ID} .sfib-kv-grid > div {
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                gap: 10px;
                min-width: 0;
                padding: 4px 0;
                border-bottom: 1px solid rgba(255,255,255,.045);
                color: var(--sfib-text2);
                font-size: var(--sfib-font-body);
                line-height: 1.25;
            }
            #${BOARD_ID} .sfib-kv-grid span { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-kv-grid b { text-align: right; white-space: nowrap; }
            #${BOARD_ID} .sfib-detail-summary {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                align-items: baseline;
                gap: 5px 14px;
                margin-bottom: 8px;
                color: var(--sfib-text2);
                font-size: var(--sfib-font-body);
                line-height: var(--sfib-line-body);
            }
            #${BOARD_ID} .sfib-detail-summary b { color: var(--sfib-text); }
            #${BOARD_ID} .sfib-defence-meta { margin: -1px 0 8px; color: var(--sfib-info); font-size: var(--sfib-font-body); line-height: var(--sfib-line-body); }
            #${BOARD_ID} .sfib-mini-table-wrap,
            #${BOARD_ID} .sfib-history-table-wrap { width: 100%; overflow-x: auto; }
            #${BOARD_ID} .sfib-mini-table,
            #${BOARD_ID} .sfib-history-table {
                width: 100%;
                margin: 0;
                border-collapse: collapse;
                color: var(--sfib-text2);
                font-size: var(--sfib-font-body);
                line-height: 1.25;
            }
            /* Expanded-detail tables share one explicit row geometry.
               This is intentionally applied to TR as well as TH/TD so Recent
               Scan History cannot grow taller than Latest Ship Picture due to
               inherited site/table styles. */
            #${BOARD_ID} .sfib-mini-table,
            #${BOARD_ID} .sfib-history-table {
                --sfib-detail-row-h: 26px;
            }
            #${BOARD_ID} .sfib-mini-table tr,
            #${BOARD_ID} .sfib-history-table tr {
                height: var(--sfib-detail-row-h) !important;
                min-height: var(--sfib-detail-row-h) !important;
            }
            #${BOARD_ID} .sfib-mini-table th,
            #${BOARD_ID} .sfib-mini-table td,
            #${BOARD_ID} .sfib-history-table th,
            #${BOARD_ID} .sfib-history-table td {
                height: var(--sfib-detail-row-h) !important;
                min-height: 0 !important;
                padding: 0 7px !important;
                box-sizing: border-box;
                border-right: 0 !important;
                border-bottom: 1px solid var(--sfib-border-soft);
                vertical-align: middle;
                text-align: left;
                white-space: nowrap;
                overflow: visible;
                line-height: 1.2;
            }
            #${BOARD_ID} .sfib-mini-table thead th,
            #${BOARD_ID} .sfib-history-table thead th {
                position: static !important;
                background: rgba(255,255,255,.035);
                color: var(--sfib-text);
                font-weight: var(--sfib-weight-bold);
                text-align: left;
                box-shadow: none !important;
            }
            #${BOARD_ID} .sfib-mini-table tbody tr:hover td,
            #${BOARD_ID} .sfib-history-table tbody tr:hover td { background: rgba(56,191,232,.035); }
            #${BOARD_ID} .sfib-detail-class { color: var(--sfib-text); font-weight: var(--sfib-weight-medium); }
            #${BOARD_ID} .sfib-detail-status {
                display: inline-flex;
                align-items: center;
                min-height: 20px;
                padding: 1px 5px;
                border: 1px solid transparent;
                border-radius: 3px;
                font-size: var(--sfib-font-small);
                font-weight: var(--sfib-weight-medium);
                line-height: var(--sfib-line-compact);
                white-space: nowrap;
            }
            #${BOARD_ID} .sfib-detail-status.returning { color: var(--sfib-danger); border-color: rgba(212,93,93,.35); background: rgba(212,93,93,.06); }
            #${BOARD_ID} .sfib-detail-status.disabled { color: var(--sfib-muted); border-color: rgba(190,198,204,.20); background: rgba(190,198,204,.03); }
            #${BOARD_ID} .sfib-detail-status.upgrading { color: var(--sfib-info); border-color: rgba(56,191,232,.35); background: rgba(56,191,232,.06); }
            #${BOARD_ID} .sfib-detail-status.building { color: var(--sfib-purple); border-color: rgba(177,120,218,.38); background: rgba(177,120,218,.07); }
            #${BOARD_ID} .sfib-detail-status.other { color: var(--sfib-warning); border-color: rgba(228,197,111,.30); background: rgba(228,197,111,.05); }
            #${BOARD_ID} .sfib-detail-status.neutral { color: var(--sfib-muted); }
            #${BOARD_ID} .sfib-type-label { color: var(--sfib-info); font-weight: var(--sfib-weight-bold); }
            /* StarFury's native button rules can impose a control height/line-height.
               Fully reset the RAW source control so it cannot inflate history rows. */
            #${BOARD_ID} .sfib-source-button {
                display: inline !important;
                width: auto !important;
                height: auto !important;
                min-width: 0 !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                border-radius: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                color: var(--sfib-info) !important;
                font: inherit !important;
                font-size: inherit !important;
                font-weight: inherit !important;
                line-height: 1.2 !important;
                vertical-align: baseline !important;
                cursor: pointer;
                text-decoration: underline;
                text-transform: none !important;
            }
            /* Recent Scan History uses the exact same compact row geometry as
               Latest Ship Picture. Reset descendants too, because native form
               control styling can otherwise make a table row taller than its TD. */
            #${BOARD_ID} .sfib-history-table td > *,
            #${BOARD_ID} .sfib-history-table th > * {
                max-height: none;
                line-height: 1.2;
                vertical-align: middle;
            }
            #${BOARD_ID} .sfib-detail-empty { color: var(--sfib-muted); font-size: var(--sfib-font-body); line-height: 1.35; }
            #${BOARD_ID} .sfib-empty-row td { padding: 18px !important; color: var(--sfib-muted); text-align: center; }
            .sfib-raw-hidden table.forumthreadtable { display: none !important; }

            /* Width modes
               Default: content-fit. The board shrink-wraps the visible columns and
               stays centered in the viewport. Flexible Width opts back into the
               previous full-window behavior. */
            #sfib-modal:not(.sfib-flex-width) {
                align-items: center;
                justify-content: center;
            }
            #sfib-modal:not(.sfib-flex-width) #sfib-modal-shell {
                /* JS resolves the exact content-fit width after render. This CSS
                   is the safe fallback and hard viewport ceiling. */
                width: fit-content;
                max-width: calc(100vw - 20px);
                min-width: 0;
            }
            #sfib-modal:not(.sfib-flex-width) #${BOARD_ID},
            #sfib-modal:not(.sfib-flex-width) #${BOARD_ID} .sfib-box {
                width: 100%;
                max-width: 100%;
                min-width: 0;
                height: auto;
            }
            #sfib-modal:not(.sfib-flex-width) #${BOARD_ID} .sfib-table-wrap {
                width: 100%;
                max-width: 100%;
                min-width: 0;
                overflow-x: auto;
                overflow-y: auto;
            }
            #sfib-modal:not(.sfib-flex-width) #${BOARD_ID} .sfib-table {
                width: max-content;
                min-width: 0;
                max-width: none;
            }
            #sfib-modal:not(.sfib-flex-width) #${BOARD_ID} .sfib-table > thead > tr > th,
            #sfib-modal:not(.sfib-flex-width) #${BOARD_ID} .sfib-table > tbody > .sfib-empire-row > td {
                width: 1%;
                min-width: 0;
            }

            /* In content-fit mode, opening a detail row must not change the
               frame that the user was looking at. Lock the collapsed shell and
               main-table dimensions, then let detail content reflow/scroll
               inside that frame. This prevents the modal from jumping upward
               and stops a colspan detail row from inflating table width. */
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #sfib-modal-shell {
                width: var(--sfib-fit-shell-w) !important;
                height: var(--sfib-fit-shell-h) !important;
                max-width: calc(100vw - 20px) !important;
                max-height: calc(100vh - 20px) !important;
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID},
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-box {
                width: 100% !important;
                height: 100% !important;
                max-width: 100% !important;
                max-height: 100% !important;
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-table-wrap {
                width: 100% !important;
                max-width: 100% !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
                flex: 1 1 auto;
                scrollbar-gutter: stable;
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-table {
                width: var(--sfib-fit-table-w) !important;
                min-width: var(--sfib-fit-table-w) !important;
                max-width: var(--sfib-fit-table-w) !important;
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-detail-row > td {
                width: auto !important;
                min-width: 0 !important;
                max-width: none !important;
                overflow: hidden !important;
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-detail-viewport {
                width: var(--sfib-detail-viewport-w) !important;
                max-width: var(--sfib-detail-viewport-w) !important;
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-detail-grid {
                width: 100% !important;
                max-width: 100% !important;
                box-sizing: border-box;
                /* In content-fit mode the detail must live inside the already
                   locked board width. Give War Activity roughly a third of the
                   usable width instead of letting the ship table dominate it. */
                grid-template-columns: minmax(0,.9fr) minmax(0,1.45fr) minmax(0,1.15fr);
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-detail-card,
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-mini-table-wrap,
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-history-table-wrap {
                min-width: 0 !important;
                max-width: 100% !important;
            }
            #sfib-modal:not(.sfib-flex-width).sfib-detail-open #${BOARD_ID} .sfib-detail-row > td {
                container-type: inline-size;
            }
            @container (max-width: 1100px) {
                #${BOARD_ID} .sfib-detail-grid {
                    grid-template-columns: minmax(0,.8fr) minmax(0,1.2fr) !important;
                }
                /* Once three useful columns would become cramped, let War Activity
                   take a full row instead of forcing it into a narrow sidebar. */
                #${BOARD_ID} .sfib-detail-war,
                #${BOARD_ID} .sfib-detail-full-dock,
                #${BOARD_ID} .sfib-detail-history { grid-column: 1 / -1; }
            }
            @container (max-width: 760px) {
                #${BOARD_ID} .sfib-detail-grid { grid-template-columns: minmax(0,1fr) !important; }
                #${BOARD_ID} .sfib-detail-general,
                #${BOARD_ID} .sfib-detail-ships,
                #${BOARD_ID} .sfib-detail-war,
                #${BOARD_ID} .sfib-detail-full-dock,
                #${BOARD_ID} .sfib-detail-history { grid-column: 1 !important; }
            }

            #sfib-modal.sfib-flex-width {
                align-items: flex-start;
                justify-content: center;
            }
            #sfib-modal.sfib-flex-width #sfib-modal-shell,
            #sfib-modal.sfib-flex-width #${BOARD_ID},
            #sfib-modal.sfib-flex-width #${BOARD_ID} .sfib-box,
            #sfib-modal.sfib-flex-width #${BOARD_ID} .sfib-table-wrap,
            #sfib-modal.sfib-flex-width #${BOARD_ID} .sfib-table {
                width: 100%;
            }

            body.sfib-share-mode #sfib-modal { padding: 0; background: #0b0d0f; }
            body.sfib-share-mode #sfib-modal-shell,
            body.sfib-share-mode #${BOARD_ID} .sfib-box { max-height: 100vh; }
            body.sfib-share-mode #sfib-modal-shell { border: 0; border-radius: 0; box-shadow: none; }
            body.sfib-share-mode #${BOARD_ID} .sfib-controls > :not(#sfib-share-toggle):not(#sfib-close) { display: none !important; }
            body.sfib-share-mode #${BOARD_ID} .sfib-config-panel { display: none !important; }
            body.sfib-share-mode #${BOARD_ID} .sfib-help-panel { display: none !important; }
            body.sfib-share-mode #${BOARD_ID} .sfib-status-panel { display: none !important; }
            body.sfib-share-mode #${BOARD_ID} .sfib-th-hide { display: none !important; }
            body.sfib-share-mode #${BOARD_ID} #sfib-share-toggle { opacity: .28; }
            body.sfib-share-mode #${BOARD_ID} #sfib-close { opacity: .28; }
            body.sfib-share-mode #${BOARD_ID} .sfib-header { min-height: 38px; padding: 5px 8px; }
            body.sfib-share-mode #${BOARD_ID} .sfib-table { min-width: 0; font-size: var(--sfib-font-body); }
            body.sfib-share-mode #${BOARD_ID} .sfib-table > thead > tr > th,
            body.sfib-share-mode #${BOARD_ID} .sfib-table > tbody > tr > td { padding: 0 var(--sfib-cell-pad-x); }
            body.sfib-share-mode #${BOARD_ID} .sfib-meta-input {
                pointer-events: none;
                height: auto !important;
                min-height: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                background: transparent !important;
            }

            @media (max-width: 1280px) {
                #${BOARD_ID} .sfib-detail-grid { grid-template-columns: minmax(280px,.85fr) minmax(520px,1.6fr); }
                #${BOARD_ID} .sfib-detail-war,
                #${BOARD_ID} .sfib-detail-full-dock,
                #${BOARD_ID} .sfib-detail-history { grid-column: 1 / -1; }
            }
            @media (max-width: 900px) {
                #sfib-modal { padding: 4px; }
                #sfib-modal:not(.sfib-flex-width) #sfib-modal-shell,
                #sfib-modal:not(.sfib-flex-width) #${BOARD_ID} .sfib-table-wrap { max-width: calc(100vw - 8px); }
                #sfib-modal-shell,
                #${BOARD_ID} .sfib-box { max-height: calc(100vh - 8px); }
                #${BOARD_ID} .sfib-header { align-items: flex-start; flex-direction: column; }
                #${BOARD_ID} .sfib-title-wrap { white-space: normal; flex-wrap: wrap; }
                #${BOARD_ID} .sfib-controls { width: 100%; justify-content: flex-start; }
                #${BOARD_ID} .sfib-config-panel,
                #${BOARD_ID} .sfib-help-panel { top: 82px; right: 6px; width: calc(100% - 12px); }
                #${BOARD_ID} .sfib-status-panel { top: 82px; left: 6px; width: calc(100% - 12px); }
                #${BOARD_ID} .sfib-help-columns { grid-template-columns: minmax(0,1fr); }
                #${BOARD_ID} .sfib-config-columns-grid { grid-template-columns: minmax(0,1fr); }
                #${BOARD_ID} .sfib-help-section.wide { grid-column: 1; }
                #${BOARD_ID} .sfib-detail-grid { grid-template-columns: minmax(0,1fr); padding: 6px; gap: 6px; }
                #${BOARD_ID} .sfib-detail-general,
                #${BOARD_ID} .sfib-detail-ships,
                #${BOARD_ID} .sfib-detail-war,
                #${BOARD_ID} .sfib-detail-full-dock,
                #${BOARD_ID} .sfib-detail-history { grid-column: 1; }
                #${BOARD_ID} .sfib-kv-grid { grid-template-columns: minmax(0,1fr); }
                #${BOARD_ID} .sfib-current-sector-head { align-items: flex-start; }
                #${BOARD_ID} .sfib-current-sector-head > small { white-space: normal; }
                #${BOARD_ID} .sfib-war-evidence { grid-template-columns: minmax(0,1fr); gap: 2px; }
                #${BOARD_ID} .sfib-war-evidence span { text-align: left; }
                #${BOARD_ID} .sfib-close-button { margin-left: auto !important; }
                .sfib-launcher { align-items: flex-start; flex-direction: column; }
            }
            @media (max-width: 520px) {
                #${BOARD_ID} input.sfib-control { width: 135px !important; }
                #${BOARD_ID} .sfib-title { font-size: var(--sfib-font-section); }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function makeBoardHost() {
        const threadBox = state.threadBox;
        if (!threadBox?.parentNode) return null;

        const host = document.createElement('div');
        host.className = 'contentbox contentBoxWide sfib-host-box';
        host.innerHTML = `<div class="sfib-launcher">
            <div class="sfib-launcher-copy">
                <div class="sfib-launcher-title">Alliance Intelligence Board</div>
                <div class="sfib-launcher-subtitle" id="sfib-launcher-subtitle">Loading scan summary…</div>
            </div>
            <div class="sfib-launcher-actions">
                <button type="button" id="sfib-open" class="sfib-open-button">Open Intel Board</button>
                <button type="button" id="sfib-launcher-raw"></button>
            </div>
        </div>`;
        threadBox.parentNode.insertBefore(host, threadBox);
        state.host = host;

        const modal = document.createElement('div');
        modal.id = 'sfib-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Alliance Intelligence Board');
        modal.innerHTML = `<div id="sfib-modal-shell"><div id="${BOARD_ID}"><div class="sfib-box">
            <div class="sfib-header">
                <div class="sfib-title-wrap">
                    <h3 class="sfib-title">Alliance Intelligence Board</h3>
                    <button type="button" id="sfib-status-toggle" class="sfib-control sfib-title-status sfib-hide-in-share" aria-expanded="false" aria-controls="sfib-status-panel" title="Show board/cache status">STATUS</button>
                </div>
                <div class="sfib-controls">
                    <input id="sfib-search" class="sfib-control sfib-hide-in-share" type="search" placeholder="Filter empires…" aria-label="Filter empires">
                    <select id="sfib-sort" class="sfib-control sfib-hide-in-share" aria-label="Sort intelligence board">
                        <option value="networth-desc">Networth ↓</option>
                        <option value="war-desc">War intel</option>
                        <option value="target-desc">Target score</option>
                        <option value="newest-desc">Newest scan</option>
                        <option value="gen-oldest">GEN oldest first</option>
                        <option value="def-oldest">DEF oldest first</option>
                        <option value="empire-asc">Empire A–Z</option>
                    </select>
                    <button type="button" id="sfib-news-refresh" class="sfib-control sfib-hide-in-share" title="Refresh cached Alliance News">REFRESH NEWS</button>
                    <button type="button" id="sfib-help-toggle" class="sfib-control sfib-hide-in-share" aria-expanded="false" aria-controls="sfib-help-panel" title="Explain colors, abbreviations, and war-intel indicators">LEGEND</button>
                    <button type="button" id="sfib-config-toggle" class="sfib-control sfib-hide-in-share" aria-expanded="false" aria-controls="sfib-config-panel">CONFIG</button>
                    <button type="button" id="sfib-share-toggle" class="sfib-control">Share View</button>
                    <button type="button" id="sfib-close" class="sfib-control sfib-close-button" aria-label="Close intelligence board" title="Close">×</button>
                </div>
            </div>
            <div id="sfib-status-panel" class="sfib-status-panel sfib-hide-in-share" role="region" aria-label="Alliance Intelligence Board status" hidden></div>
            <div id="sfib-help-panel" class="sfib-help-panel sfib-hide-in-share" role="region" aria-label="Alliance Intelligence Board legend" hidden></div>
            <div id="sfib-config-panel" class="sfib-config-panel sfib-hide-in-share" hidden></div>
            <div class="sfib-table-wrap">
                <table class="sfib-table">
                    <colgroup><col>${COLUMN_DEFS.map(column => `<col data-col="${column.id}">`).join('')}</colgroup>
                    <thead><tr>
                        <th title="Empire name. Click a row name to open full scan, current-sector, target, and war detail.">Empire</th><th data-col="networth" title="Current Networth and galaxy Rank from the cached Sector Browser. Falls back to General Scan Networth until browser data is available.">Networth / #</th><th data-col="territory" title="Current Asteroids / Land from the cached Sector Browser. Falls back to the newest General Scan until browser data is available.">Ast / Land</th><th data-col="race" title="Race from the newest General Scan. Can be hidden in Config.">Race</th><th data-col="scans" title="GEN = General, DEF = Defence, DOCK = Full Dock. Green <1h, yellow <12h, red <48h, gray 48h+.">Scans / Age</th><th data-col="probes" title="Probe count from the newest General Scan. Arrow shows change from the previous General Scan.">Probes</th><th data-col="infra" title="Infrastructure from the newest General Scan. F = Fabrication Plants, D = Defence Platforms.">Infra</th><th data-col="def" title="Most recent Empire Defence value from any scan that reports it.">Def</th><th data-col="bo" title="Break Order and Pulls from the newest Defence Scan. BO is direct scan data; P = Pulls.">BO / Pulls</th><th data-col="ships" title="Known ship composition, ordered largest/most advanced first. Brackets show non-normal ship states.">Ship Picture</th><th data-col="shields" title="S = Attack Shields, W = Warp Shields. ON is emphasized; OFF is intentionally quiet.">S/W</th><th data-col="war" title="Alliance News-derived war intelligence. BRK? is a heuristic; DEFEATED is shown only when current Browser data does not already confirm NEWB.">War</th><th data-col="target" title="Relative target assessment. A star inside the badge marks a configurable top candidate. PRIME/GOOD/FAIR/HARD uses recent Defence, Break Order, the freshest available territory data, intel freshness, plus small heuristic penalties for recent S/W ON states.">Target?</th><th data-col="assigned" title="Locally stored alliance assignment/owner.">Assigned</th><th data-col="notes" class="sfib-notes-head" title="Locally stored notes. Use × to hide quickly, or Config to restore/show it."><span class="sfib-th-inline"><span>Notes</span><button type="button" class="sfib-th-hide" data-action="hide-notes" aria-label="Hide Notes column" title="Hide Notes column">×</button></span></th>
                    </tr></thead>
                    <tbody id="sfib-tbody"></tbody>
                </table>
            </div>
            <div id="sfib-x-scrollbar" class="sfib-x-scrollbar" hidden>
                <div id="sfib-x-scroll-track" class="sfib-x-scroll-track" role="scrollbar" tabindex="0" aria-label="Horizontal intelligence table scroll" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
                    <div id="sfib-x-scroll-thumb" class="sfib-x-scroll-thumb"></div>
                </div>
            </div>
        </div></div></div>`;
        document.body.appendChild(modal);
        state.modal = modal;
        state.board = modal.querySelector(`#${BOARD_ID}`);
        return host;
    }

    function boardStatusSnapshot() {
        const newest = state.scans[0];
        const newestAge = newest ? ageLabel(ageMs(newest.taken.epoch)) : '—';
        const hiddenCount = state.empires.filter(empire => empire.hidden).length;
        const visibleCount = state.empires.length - hiddenCount;
        const empirePart = hiddenCount
            ? `${visibleCount} visible · ${hiddenCount} hidden`
            : `${state.empires.length} empires`;
        const browserPart = browserSyncSummary();
        const newsPart = state.newsCache?.initialized
            ? `news ${state.newsEvents.length} · synced ${newsAgeCompact(newsCacheWallAge())} ago`
            : 'news not yet synced';
        return {
            newestAge,
            hiddenCount,
            visibleCount,
            empirePart,
            browserPart,
            newsPart,
            summary: `${empirePart} · ${state.scans.length} unique scans · newest ${newestAge} · ${browserPart} · ${newsPart}`
        };
    }

    function renderStatusPanel() {
        const panel = state.board?.querySelector('#sfib-status-panel');
        const toggle = state.board?.querySelector('#sfib-status-toggle');
        if (!panel || !toggle) return;
        panel.hidden = !state.statusOpen;
        toggle.setAttribute('aria-expanded', state.statusOpen ? 'true' : 'false');
        if (!state.statusOpen) return;

        const status = boardStatusSnapshot();
        const configuredThreadTid = CONFIGURED_SCAN_THREAD_ID || pageUrl.searchParams.get('TID') || '—';
        panel.innerHTML = `
            <div class="sfib-status-head">
                <div class="sfib-status-title">Board Status</div>
                <button type="button" class="sfib-help-close" data-action="close-status" aria-label="Close board status" title="Close board status">×</button>
            </div>
            <div class="sfib-status-grid">
                <div class="sfib-status-row"><span class="sfib-status-label">Empires</span><span class="sfib-status-value">${escapeHtml(status.empirePart)}</span></div>
                <div class="sfib-status-row"><span class="sfib-status-label">Scans</span><span class="sfib-status-value">${state.scans.length} unique · newest ${escapeHtml(status.newestAge)}</span></div>
                <div class="sfib-status-row"><span class="sfib-status-label">Sector Browser</span><span class="sfib-status-value">${escapeHtml(status.browserPart.replace(/^browser\s*/i, ''))}</span></div>
                <div class="sfib-status-row"><span class="sfib-status-label">Alliance News</span><span class="sfib-status-value">${escapeHtml(status.newsPart.replace(/^news\s*/i, ''))}</span></div>
                <div class="sfib-status-row"><span class="sfib-status-label">Scan Thread</span><span class="sfib-status-value sfib-status-thread-value"><span class="sfib-status-thread-id">TID ${escapeHtml(configuredThreadTid)}</span><a class="sfib-status-link" href="${escapeHtml(CONFIGURED_SCAN_THREAD_URL)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(CONFIGURED_SCAN_THREAD_URL)}">OPEN</a></span></div>
            </div>`;
    }

    function toggleStatusPanel(force) {
        state.statusOpen = typeof force === 'boolean' ? force : !state.statusOpen;
        if (state.statusOpen) {
            state.helpOpen = false;
            state.configOpen = false;
        }
        renderStatusPanel();
        renderHelpPanel();
        renderConfigPanel();
        if (state.statusOpen) requestAnimationFrame(() => state.board?.querySelector('#sfib-status-panel .sfib-help-close')?.focus({ preventScroll: true }));
    }

    function updateSubtitle() {
        const status = boardStatusSnapshot();
        const launcherSubtitle = state.host?.querySelector('#sfib-launcher-subtitle');
        if (launcherSubtitle) launcherSubtitle.textContent = status.summary;
        if (state.statusOpen) renderStatusPanel();
        updateNewsUi();
    }

    function setEmpireHidden(empireName, hidden) {
        const empire = state.empires.find(item => item.target === empireName);
        if (!empire) return;
        empire.hidden = Boolean(hidden);
        setStored(empireStorageKey(empireName, 'hidden'), String(empire.hidden));
        if (empire.hidden && state.expandedEmpire === empire.target.toLowerCase()) {
            state.expandedEmpire = '';
            releaseContentFitFrame();
        }
    }

    function isColumnVisible(columnId) {
        return columnId === 'empire' || state.columnVisibility[columnId] !== false;
    }

    function visibleColumnCount() {
        return 1 + COLUMN_DEFS.reduce((count, column) => count + (isColumnVisible(column.id) ? 1 : 0), 0);
    }

    function setColumnVisible(columnId, visible) {
        if (!COLUMN_IDS.has(columnId)) return;
        state.columnVisibility[columnId] = Boolean(visible);
        setStored(`column-visible:${columnId}`, String(state.columnVisibility[columnId]));
        // Keep legacy preference keys synchronized for painless rollback/migration.
        if (columnId === 'race') setStored('race-visible', String(state.columnVisibility[columnId]));
        if (columnId === 'notes') setStored('notes-visible', String(state.columnVisibility[columnId]));
    }

    function applyColumnVisibility() {
        if (!state.board) return;
        for (const column of COLUMN_DEFS) {
            const visible = isColumnVisible(column.id);
            for (const node of state.board.querySelectorAll(`.sfib-table > colgroup > [data-col="${column.id}"], .sfib-table > thead [data-col="${column.id}"], .sfib-table > tbody > .sfib-empire-row > [data-col="${column.id}"]`)) {
                node.hidden = !visible;
            }
            const checkbox = state.board.querySelector(`#sfib-config-column-${column.id}`);
            if (checkbox) checkbox.checked = visible;
        }
        // Expanded/detail and empty/error rows use colspan rather than individual
        // cells, so keep their span synchronized with the visible main columns.
        for (const cell of state.board.querySelectorAll('.sfib-detail-row > td[colspan], .sfib-empty-row > td[colspan], .sfib-render-error > td[colspan]')) {
            cell.colSpan = visibleColumnCount();
        }
    }

    function renderHelpPanel() {
        const panel = state.board?.querySelector('#sfib-help-panel');
        const toggle = state.board?.querySelector('#sfib-help-toggle');
        if (!panel || !toggle) return;
        panel.hidden = !state.helpOpen;
        toggle.setAttribute('aria-expanded', state.helpOpen ? 'true' : 'false');
        if (!state.helpOpen) return;

        panel.innerHTML = `
            <div class="sfib-help-head">
                <div class="sfib-help-title">Board Legend</div>
                <button type="button" class="sfib-help-close" data-action="close-help" aria-label="Close legend" title="Close legend">×</button>
            </div>
            <div class="sfib-help-columns">
                <section class="sfib-help-section">
                    <div class="sfib-help-heading">Scan freshness</div>
                    <div class="sfib-help-row"><span class="sfib-scan-pill fresh"><b>GEN</b><span>&lt;1h</span></span><span class="sfib-help-copy"><b>Fresh.</b> Current tactical intel.</span></div>
                    <div class="sfib-help-row"><span class="sfib-scan-pill warm"><b>GEN</b><span>1–11h</span></span><span class="sfib-help-copy"><b>Aging.</b> Useful, but verify before a costly action.</span></div>
                    <div class="sfib-help-row"><span class="sfib-scan-pill old"><b>GEN</b><span>12–47h</span></span><span class="sfib-help-copy"><b>Stale.</b> Treat as historical unless corroborated.</span></div>
                    <div class="sfib-help-row"><span class="sfib-scan-pill dead"><b>GEN</b><span>48h+</span></span><span class="sfib-help-copy"><b>Dead intel.</b> Too old for tactical assumptions.</span></div>
                    <div class="sfib-help-note">GEN = General Scan · DEF = Defence Scan · DOCK = Full Dock Scan. A gray empty badge means that scan type is not retained on this thread page.</div>
                </section>

                <section class="sfib-help-section">
                    <div class="sfib-help-heading">Ship annotations</div>
                    <div class="sfib-help-row"><span class="sfib-help-status-sample"><span class="sfib-status-bracket">[</span><span class="sfib-status-token returning">4R</span><span class="sfib-status-space"> </span><span class="sfib-status-token disabled">1D</span><span class="sfib-status-space"> </span><span class="sfib-status-token upgrading">1U</span><span class="sfib-status-space"> </span><span class="sfib-status-token building">2B</span><span class="sfib-status-bracket">]</span></span><span class="sfib-help-copy">Counts are attached to the affected hull class.</span></div>
                    <div class="sfib-help-row"><span class="sfib-help-status-sample"><span class="sfib-status-token returning">R Returning</span></span><span class="sfib-help-copy">Red. Ship is away and returning.</span></div>
                    <div class="sfib-help-row"><span class="sfib-help-status-sample"><span class="sfib-status-token disabled">D Disabled</span></span><span class="sfib-help-copy">Gray. Ship is disabled.</span></div>
                    <div class="sfib-help-row"><span class="sfib-help-status-sample"><span class="sfib-status-token upgrading">U Upgrading</span></span><span class="sfib-help-copy">Blue. Ship is being upgraded.</span></div>
                    <div class="sfib-help-row"><span class="sfib-help-status-sample"><span class="sfib-status-token building">B Building</span></span><span class="sfib-help-copy">Purple. Ship is still under construction.</span></div>
                    <div class="sfib-help-note">Ship Picture runs largest/most advanced hull to smallest. Other unusual states remain yellow and show full wording on hover.</div>
                </section>

                <section class="sfib-help-section">
                    <div class="sfib-help-heading">Defence state</div>
                    <div class="sfib-help-row"><span class="sfib-state-grid"><span class="sfib-state-pill on"><b>S</b><span>ON</span></span><span class="sfib-state-pill off"><b>W</b><span>OFF</span></span></span><span class="sfib-help-copy"><b>S</b> = Attack Shields · <b>W</b> = Warp Shields.</span></div>
                    <div class="sfib-help-row"><span class="sfib-help-probe-sample"><span class="sfib-primary-number">42.8k</span><span class="sfib-delta">▲2,523</span></span><span class="sfib-help-copy"><b>Probes:</b> latest count plus change from the previous GEN scan.</span></div>
                    <div class="sfib-help-row"><span class="sfib-help-probe-sample"><span class="sfib-primary-number">816k</span></span><span class="sfib-help-copy"><b>Def:</b> latest Empire Defence reported by a Defence Scan.</span></div>
                    <div class="sfib-help-row"><span class="sfib-infra"><span class="sfib-infra-label">F</span><span class="sfib-infra-value">556</span><span class="sfib-infra-label">D</span><span class="sfib-infra-value">2,472</span></span><span class="sfib-help-copy"><b>Infra:</b> F = Fabrication Plants · D = Defence Platforms. F and D use fixed aligned slots for quick row-to-row comparison.</span></div>
                    <div class="sfib-help-note">For Probes and Infra, “—” is used for a confirmed zero and can also appear where no value was reported. Open the row detail/source when that distinction matters.</div>
                </section>

                <section class="sfib-help-section">
                    <div class="sfib-help-heading">War intelligence</div>
                    <div class="sfib-help-row"><span class="sfib-war-badge breaker">BRK? <span>2h</span></span><span class="sfib-help-copy"><b>Breaker candidate.</b> Inferred from opening failures before a target breaks and from the first successful attacker in an assault sequence. A breaker can succeed on its first attempt, so first-success evidence is included. It remains a heuristic, not a confirmed player role.</span></div>
                    <div class="sfib-help-row"><span class="sfib-war-badge defeated">DEFEATED <span>3h</span></span><span class="sfib-help-copy"><b>Confirmed defeat.</b> Shown when Alliance News confirms a defeat but current Browser data does not already confirm NEWB.</span></div>
                    <div class="sfib-help-row"><span class="sfib-war-badge newb">NEWB</span><span class="sfib-help-copy"><b>Current Newbie status.</b> Confirmed by cached Sector Browser data under one hour old; this replaces the redundant DEFEATED badge in the main grid.</span></div>
                    <div class="sfib-help-row"><span class="sfib-defeat-skull">☠</span><span class="sfib-help-copy"><b>Recent defeat.</b> Marks a defeat in the cached news. Row muting uses current Browser Newbie status when available; otherwise the board falls back to the 48-hour defeat window.</span></div>
                    <div class="sfib-help-note">War indicators come from locally cached Alliance News. Auto-refresh is limited to once every 30 minutes while open; REFRESH NEWS forces a sync.</div>
                </section>

                <section class="sfib-help-section">
                    <div class="sfib-help-heading">Break order</div>
                    <div class="sfib-help-row"><span class="sfib-bo warm"><span class="sfib-bo-freshness" aria-hidden="true"></span><span class="sfib-bo-main">980 | 80</span><span class="sfib-bo-sep"> · </span><span class="sfib-bo-pulls">P140</span></span><span class="sfib-help-copy"><b>BO / Pulls</b> comes directly from the newest Defence Scan. The colored pip shows that scan's freshness while the values stay neutral.</span></div>
                    <div class="sfib-help-note">BO stages are shown in order. P = Pulls. Freshness belongs to the observation, not to target quality.</div>
                </section>

                <section class="sfib-help-section">
                    <div class="sfib-help-heading">Target helpers</div>
                    <div class="sfib-help-row"><span class="sfib-target-badge prime">PRIME</span><span class="sfib-help-copy"><b>Target?</b> is a relative heuristic, not a promise of breakability. It favors lower Defence and total BO, then territory value and fresher intel.</span></div>
                    <div class="sfib-help-row"><span class="sfib-target-badge good"><span class="sfib-target-star-inline" aria-hidden="true">★</span>GOOD</span><span class="sfib-help-copy">A star inside the Target badge marks a configurable top candidate. Only Defence intel under 12 hours old is eligible.</span></div>
                    <div class="sfib-help-note">S ON subtracts 10 points and W ON another 4 as small operational-friction penalties. RECHECK = 12–47h Defence intel · DEAD = 48h+ · NEWB = current Browser-confirmed Newbie status · DOWN = defeat-window fallback when Browser data is unavailable · NO DEF = no usable Defence value. Pulls and BRK? are not numerically scored.</div>
                </section>

                <section class="sfib-help-section wide">
                    <div class="sfib-help-heading">Current sector data</div>
                    <div class="sfib-help-row"><span class="sfib-current-stat">5,748,906 <span class="sfib-rank">#1</span></span><span class="sfib-help-copy"><b>Networth / #</b> is current Networth plus galaxy Rank from Sector Browser.</span></div>
                    <div class="sfib-help-row"><span class="sfib-territory"><span>6,158</span><span class="sfib-territory-sep">/</span><span>8,291</span></span><span class="sfib-help-copy"><b>Ast / Land</b> is current Asteroids / Land from the same sector snapshot. Target scoring uses this territory when it is newer than the General Scan.</span></div>
                    <div class="sfib-help-note">Sector Browser is cached by sector, not by empire. One request can refresh every empire in that sector. Automatic refresh is capped at once per sector per hour while the board is open, and visiting Browser passively updates the cache without another request.</div>
                </section>

                <section class="sfib-help-section wide">
                    <div class="sfib-help-heading">Reading the board</div>
                    <div class="sfib-help-copy"><b>Scan data is historical evidence; Sector Browser data is a cached current snapshot.</b> Scan ages tell you how old each observation is, while STATUS shows Browser and Alliance News cache ages. Click an empire for source detail, target assessment, scan history, war activity, and RAW links. Assigned, Notes, hidden empires, and display preferences stay local to this browser. The active scan-thread URL is selected from the userscript extension menu, so a new round can use a different Alliance Forum TID without editing this script.</div>
                </section>
            </div>`;
    }

    function toggleHelpPanel(force) {
        state.helpOpen = typeof force === 'boolean' ? force : !state.helpOpen;
        if (state.helpOpen) { state.configOpen = false; state.statusOpen = false; }
        renderHelpPanel();
        renderConfigPanel();
        renderStatusPanel();
        if (state.helpOpen) requestAnimationFrame(() => state.board?.querySelector('.sfib-help-close')?.focus({ preventScroll: true }));
    }

    function renderConfigPanel() {
        const panel = state.board?.querySelector('#sfib-config-panel');
        const toggle = state.board?.querySelector('#sfib-config-toggle');
        if (!panel || !toggle) return;
        const hiddenEmpires = state.empires.filter(empire => empire.hidden).sort((a, b) => a.target.localeCompare(b.target));
        panel.hidden = !state.configOpen;
        toggle.setAttribute('aria-expanded', state.configOpen ? 'true' : 'false');
        if (!state.configOpen) return;

        const hiddenRows = hiddenEmpires.length
            ? hiddenEmpires.map(empire => `<div class="sfib-config-empire"><span>${escapeHtml(displayEmpireName(empire.target))}</span><button type="button" class="sfib-config-action" data-action="unhide-empire" data-empire="${escapeHtml(empire.target)}">Unhide</button></div>`).join('')
            : '<div class="sfib-config-empty">No hidden empires.</div>';

        panel.innerHTML = `
            <div class="sfib-config-section">
                <div class="sfib-config-heading"><b>Columns</b></div>
                <div class="sfib-config-columns-grid">
                    ${COLUMN_DEFS.map(column => `<label class="sfib-config-check"><input id="sfib-config-column-${column.id}" data-column-id="${column.id}" type="checkbox" ${isColumnVisible(column.id) ? 'checked' : ''}> <span>${escapeHtml(column.label)}</span></label>`).join('')}
                </div>
                <div class="sfib-config-footnote sfib-config-footnote-tight">Empire is always shown. Ast / Land, Ship Picture, and Notes default off; the other columns default on. Column changes apply immediately and the board recalculates its width automatically.</div>
            </div>
            <div class="sfib-config-section">
                <div class="sfib-config-heading"><b>Layout</b></div>
                <label class="sfib-config-check sfib-config-inline"><span>Allow flexible width</span>
                    <input id="sfib-config-flexible-width" type="checkbox" ${state.flexibleWidth ? 'checked' : ''} aria-describedby="sfib-config-flexible-width-note">
                </label>
                <div id="sfib-config-flexible-width-note" class="sfib-config-footnote sfib-config-footnote-tight">Off by default: the board fits the visible column contents and stays centered in the viewport. Turn it on to let the board expand to the full available window width.</div>
            </div>
            <div class="sfib-config-section">
                <div class="sfib-config-heading"><b>Target Helpers</b></div>
                <label class="sfib-config-check sfib-config-inline"><span>Star top targets</span>
                    <select id="sfib-config-target-stars" class="sfib-config-select" aria-label="Number of top target candidates to star">
                        ${[0,3,5,8,10].map(value => `<option value="${value}" ${state.targetStarCount === value ? 'selected' : ''}>${value === 0 ? 'Off' : value}</option>`).join('')}
                    </select>
                </label>
                <div class="sfib-config-footnote sfib-config-footnote-tight">Stars only apply to candidates with Defence intel under 12 hours old. Recent S/W ON states apply small heuristic penalties (-10/-4). The score is relative and does not know any attacker's available Attack/Damage.</div>
            </div>
            <div class="sfib-config-section">
                <div class="sfib-config-heading"><b>Hidden Empires <span class="sfib-config-count">${hiddenEmpires.length}</span></b>${hiddenEmpires.length ? '<button type="button" class="sfib-config-action" data-action="unhide-all">Unhide all</button>' : ''}</div>
                <div class="sfib-config-list">${hiddenRows}</div>
            </div>
            <div class="sfib-config-footnote">Display preferences are stored locally in this browser.</div>`;
    }

    function toggleConfigPanel(force) {
        state.configOpen = typeof force === 'boolean' ? force : !state.configOpen;
        if (state.configOpen) { state.helpOpen = false; state.statusOpen = false; }
        renderConfigPanel();
        renderHelpPanel();
        renderStatusPanel();
    }

    function measureIntrinsicTableWidth() {
        if (!state.board) return 0;
        const table = state.board.querySelector('.sfib-table');
        if (!table) return 0;

        // Tables are unusual sizing objects: a max-content table can still be
        // squeezed by a constrained ancestor before scrollWidth is sampled.
        // Measure a short-lived clone outside the scroll viewport but still
        // inside #BOARD_ID so all scoped SFIB CSS continues to apply.
        const clone = table.cloneNode(true);
        clone.classList.add('sfib-measure-table');
        clone.querySelectorAll('.sfib-detail-row').forEach(node => node.remove());
        Object.assign(clone.style, {
            position: 'fixed',
            left: '-100000px',
            top: '0',
            width: 'max-content',
            minWidth: 'max-content',
            maxWidth: 'none',
            height: 'auto',
            visibility: 'hidden',
            pointerEvents: 'none',
            zIndex: '-1'
        });
        state.board.appendChild(clone);
        const width = Math.ceil(Math.max(clone.getBoundingClientRect().width, clone.scrollWidth));
        clone.remove();
        return width;
    }

    function syncContentFitWidth() {
        if (!state.modal || !state.board || !state.modalOpen || state.flexibleWidth || state.fitFrame) return;
        const shell = state.modal.querySelector('#sfib-modal-shell');
        const table = state.board.querySelector('.sfib-table');
        const wrap = state.board.querySelector('.sfib-table-wrap');
        const header = state.board.querySelector('.sfib-header');
        if (!shell || !table || !wrap) return;

        const viewportPad = window.innerWidth <= 900 ? 8 : 20;
        const viewportCap = Math.max(320, window.innerWidth - viewportPad);
        const naturalTableWidth = Math.max(1, measureIntrinsicTableWidth());
        const headerWidth = Math.ceil(header?.scrollWidth || 0);
        // scrollbar-gutter: stable reserves space for the vertical scrollbar even
        // before it is needed. If the shell only equals the table's intrinsic
        // width, that reserved gutter makes scrollWidth exceed clientWidth by a
        // few pixels and falsely triggers the persistent horizontal rail. Add the
        // reserved gutter to the shell only when the viewport has room for it.
        const verticalGutter = Math.max(0, Math.ceil(wrap.offsetWidth - wrap.clientWidth));
        const tableViewportWidth = naturalTableWidth + verticalGutter;
        const desiredShellWidth = Math.min(viewportCap, Math.max(tableViewportWidth, headerWidth));

        // Make the table's width explicit. This guarantees scrollWidth >
        // clientWidth whenever the visible columns exceed the viewport instead
        // of trusting browser table-layout/max-content edge cases.
        table.style.width = `${naturalTableWidth}px`;
        table.style.minWidth = `${naturalTableWidth}px`;
        table.style.maxWidth = `${naturalTableWidth}px`;

        shell.style.width = `${desiredShellWidth}px`;
        shell.style.maxWidth = `${viewportCap}px`;

        // Force the scroll viewport to the shell's actual inner width. Without
        // this, Safari can let the flex child keep the table's intrinsic width,
        // which clips the right-most column without producing x-overflow.
        const wrapWidth = Math.max(1, Math.floor(shell.clientWidth));
        wrap.style.width = `${wrapWidth}px`;
        wrap.style.maxWidth = `${wrapWidth}px`;

        const finalVerticalGutter = Math.max(0, Math.ceil(wrap.offsetWidth - wrap.clientWidth));
        const effectiveClientWidth = wrap.clientWidth + finalVerticalGutter;
        const hasXOverflow = naturalTableWidth > effectiveClientWidth + 2;
        wrap.dataset.sfibContentOverflow = hasXOverflow ? 'true' : 'false';
        if (!hasXOverflow) wrap.scrollLeft = 0;
        else wrap.scrollLeft = Math.min(wrap.scrollLeft, Math.max(0, naturalTableWidth - wrap.clientWidth));
        syncHorizontalScrollbar();
        // Showing the persistent rail consumes a few vertical pixels but not width.
        // Run once more after layout so thumb geometry is based on final dimensions.
        if (hasXOverflow) requestAnimationFrame(syncHorizontalScrollbar);
    }

    function syncHorizontalScrollbar() {
        if (!state.board) return;
        const wrap = state.board.querySelector('.sfib-table-wrap');
        const table = state.board.querySelector('.sfib-table');
        const bar = state.board.querySelector('#sfib-x-scrollbar');
        const track = state.board.querySelector('#sfib-x-scroll-track');
        const thumb = state.board.querySelector('#sfib-x-scroll-thumb');
        if (!wrap || !table || !bar || !track || !thumb) return;

        const rawMaxScroll = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
        const reservedVerticalGutter = Math.max(0, wrap.offsetWidth - wrap.clientWidth);

        // scrollbar-gutter: stable deliberately reserves room for the vertical
        // scrollbar. Safari may expose that reserved strip as horizontal scroll
        // range even though the right-most table column is already fully visible.
        // Only overflow beyond the reserved vertical gutter is actionable x-overflow.
        const effectiveOverflow = Math.max(0, rawMaxScroll - reservedVerticalGutter);
        const contentFitFlag = wrap.dataset.sfibContentOverflow;
        const hasOverflow = state.flexibleWidth
            ? effectiveOverflow > 2
            : contentFitFlag === 'true' && effectiveOverflow > 2;

        bar.hidden = !hasOverflow;
        wrap.classList.toggle('sfib-has-x-overflow', hasOverflow);
        wrap.classList.toggle('sfib-is-x-scrolled', hasOverflow && wrap.scrollLeft > 2);

        if (!hasOverflow) {
            wrap.scrollLeft = 0;
            wrap.classList.remove('sfib-is-x-scrolled');
            track.setAttribute('aria-valuemax', '0');
            track.setAttribute('aria-valuenow', '0');
            thumb.style.width = '100%';
            thumb.style.transform = 'translateX(0px)';
            return;
        }

        // Use the browser's real scroll range for navigation once genuine
        // overflow exists. The gutter is ignored only for the show/hide test.
        const maxScroll = rawMaxScroll;
        const trackWidth = Math.max(1, track.clientWidth);
        const effectiveScrollableWidth = Math.max(wrap.clientWidth + effectiveOverflow, wrap.clientWidth + 1);
        const viewportRatio = Math.max(0.05, Math.min(1, wrap.clientWidth / effectiveScrollableWidth));
        const thumbWidth = Math.max(48, Math.min(trackWidth, Math.round(trackWidth * viewportRatio)));
        const travel = Math.max(0, trackWidth - thumbWidth);
        const left = travel > 0 ? Math.round((wrap.scrollLeft / maxScroll) * travel) : 0;

        thumb.style.width = `${thumbWidth}px`;
        thumb.style.transform = `translateX(${left}px)`;
        track.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
        track.setAttribute('aria-valuenow', String(Math.round(wrap.scrollLeft)));
    }

    function syncDetailViewportWidth() {
        if (!state.board) return;
        const wrap = state.board.querySelector('.sfib-table-wrap');
        if (!wrap) return;
        const width = Math.max(0, Math.floor(wrap.clientWidth));
        if (width) state.board.style.setProperty('--sfib-detail-viewport-w', `${width}px`);
        else state.board.style.removeProperty('--sfib-detail-viewport-w');
    }

    function captureContentFitFrame() {
        if (!state.modal || !state.board || state.flexibleWidth || !state.modalOpen) return;
        const shell = state.modal.querySelector('#sfib-modal-shell');
        const table = state.board.querySelector('.sfib-table');
        if (!shell || !table) return;

        const shellRect = shell.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        if (shellRect.width <= 0 || shellRect.height <= 0 || tableRect.width <= 0) return;

        state.fitFrame = {
            shellWidth: Math.ceil(shellRect.width),
            shellHeight: Math.ceil(shellRect.height),
            tableWidth: Math.ceil(tableRect.width)
        };
        state.modal.style.setProperty('--sfib-fit-shell-w', `${state.fitFrame.shellWidth}px`);
        state.modal.style.setProperty('--sfib-fit-shell-h', `${state.fitFrame.shellHeight}px`);
        state.modal.style.setProperty('--sfib-fit-table-w', `${state.fitFrame.tableWidth}px`);
        state.modal.classList.add('sfib-detail-open');
    }

    function releaseContentFitFrame() {
        if (!state.modal) return;
        state.fitFrame = null;
        state.modal.classList.remove('sfib-detail-open');
        state.modal.style.removeProperty('--sfib-fit-shell-w');
        state.modal.style.removeProperty('--sfib-fit-shell-h');
        state.modal.style.removeProperty('--sfib-fit-table-w');
    }

    function applyWidthMode() {
        if (!state.modal) return;
        state.modal.classList.toggle('sfib-flex-width', Boolean(state.flexibleWidth));
        const shell = state.modal.querySelector('#sfib-modal-shell');
        const table = state.board?.querySelector('.sfib-table');
        const wrap = state.board?.querySelector('.sfib-table-wrap');
        if (state.flexibleWidth) {
            releaseContentFitFrame();
            // Content-fit mode sets explicit dimensions to guarantee a real
            // internal x-scroll range. Clear all of them when flexible width is on.
            shell?.style.removeProperty('width');
            shell?.style.removeProperty('max-width');
            table?.style.removeProperty('width');
            table?.style.removeProperty('min-width');
            table?.style.removeProperty('max-width');
            wrap?.style.removeProperty('width');
            wrap?.style.removeProperty('max-width');
            if (wrap) delete wrap.dataset.sfibContentOverflow;
            wrap?.classList.remove('sfib-has-x-overflow');
        } else {
            table?.style.removeProperty('width');
            table?.style.removeProperty('min-width');
            table?.style.removeProperty('max-width');
            wrap?.style.removeProperty('width');
            wrap?.style.removeProperty('max-width');
        }
        const checkbox = state.board?.querySelector('#sfib-config-flexible-width');
        if (checkbox) checkbox.checked = Boolean(state.flexibleWidth);
        requestAnimationFrame(() => {
            syncContentFitWidth();
            syncHorizontalScrollbar();
            syncDetailViewportWidth();
            fitBoardRows();
        });
    }

    function reflowAfterColumnChange() {
        const expanded = state.expandedEmpire;

        // A content-fit detail frame deliberately locks the collapsed geometry.
        // Column changes therefore need one clean collapsed measurement pass,
        // then we can restore the same detail row against the new frame.
        if (expanded && !state.flexibleWidth) {
            state.expandedEmpire = '';
            releaseContentFitFrame();
            renderRows();
            requestAnimationFrame(() => {
                syncContentFitWidth();
                syncDetailViewportWidth();
                captureContentFitFrame();
                state.expandedEmpire = expanded;
                renderRows();
            });
            return;
        }

        renderRows();
        requestAnimationFrame(() => {
            syncContentFitWidth();
            syncHorizontalScrollbar();
            syncDetailViewportWidth();
            fitBoardRows();
        });
    }

    function applyRawVisibility() {
        if (!state.threadBox) return;
        state.threadBox.classList.toggle('sfib-raw-hidden', state.rawHidden);
        const label = state.rawHidden ? 'Show Raw Scans' : 'Hide Raw Scans';
        const launcherButton = state.host?.querySelector('#sfib-launcher-raw');
        if (launcherButton) launcherButton.textContent = label;
        setStored('raw-hidden', String(state.rawHidden));
    }

    function filteredEmpires() {
        const query = text(state.search).toLowerCase();
        return state.empires
            .filter(empire => !empire.hidden)
            .filter(empire => {
                if (!query) return true;
                return [empire.target, generalValue(empire, 'Race'), empire.assigned, empire.notes, sectorSearchText(empire), warSearchText(empire), targetSearchText(empire)]
                    .some(value => text(value).toLowerCase().includes(query));
            })
            .sort((a, b) => compareEmpires(a, b, state.sortMode));
    }

    function renderRows() {
        const tbody = state.board?.querySelector('#sfib-tbody');
        if (!tbody) return;
        state.targetAssessments = buildTargetAssessments(state.empires.filter(empire => !empire.hidden));
        const empires = filteredEmpires();
        if (!empires.length) {
            tbody.innerHTML = `<tr class="sfib-empty-row"><td colspan="${visibleColumnCount()}">No visible empires match this filter.</td></tr>`;
            return;
        }

        tbody.innerHTML = empires.map(empire => {
            try {
                const detail = state.expandedEmpire === empire.target.toLowerCase() ? detailRowHtml(empire) : '';
                return rowHtml(empire) + detail;
            } catch (error) {
                console.error('[SFIB] Failed to render empire row:', empire?.target, error);
                return `<tr class="sfib-empire-row sfib-render-error"><td colspan="${visibleColumnCount()}"><strong>${escapeHtml(displayEmpireName(empire?.target || 'Unknown empire'))}</strong> could not be rendered. Reload the page or check the browser console for SFIB details.</td></tr>`;
            }
        }).join('');
        applyColumnVisibility();
        updateAges();
        requestAnimationFrame(() => {
            syncContentFitWidth();
            syncHorizontalScrollbar();
            syncDetailViewportWidth();
            fitBoardRows();
        });
    }

    function saveMetaInput(input) {
        const empireName = input.dataset.empire || '';
        const field = input.dataset.field || '';
        if (!empireName || !['assigned', 'notes'].includes(field)) return;
        const value = text(input.value);
        const empire = state.empires.find(item => item.target === empireName);
        if (empire) empire[field] = value;
        setStored(empireStorageKey(empireName, field), value);
    }

    function fitBoardRows() {
        const table = state.board?.querySelector('.sfib-table');
        const rows = state.board?.querySelectorAll('.sfib-empire-row');
        const header = state.board?.querySelector('.sfib-header');
        if (!table || !rows?.length) {
            state.board?.style.removeProperty('--sfib-row-h');
            return;
        }
        if (state.expandedEmpire) {
            // Preserve the collapsed row geometry while a content-fit detail
            // frame is open so the surrounding table does not visually jump.
            if (!(state.fitFrame && !state.flexibleWidth)) state.board?.style.removeProperty('--sfib-row-h');
            return;
        }

        const modalPad = window.innerWidth <= 900 ? 8 : 20;
        const headHeight = table.tHead?.getBoundingClientRect().height || 24;
        const headerHeight = header?.getBoundingClientRect().height || 38;
        const available = Math.max(0, window.innerHeight - modalPad - headerHeight - headHeight - 4);
        // Size rows against the viewport ceiling, not the wrapper's current
        // height. That lets the modal shrink to the last visible row when the
        // list is short, while still capping dense lists at one viewport.
        const rowHeight = Math.max(28, Math.min(34, Math.floor(available / rows.length)));
        state.board.style.setProperty('--sfib-row-h', `${rowHeight}px`);
    }

    function openModal() {
        state.modalOpen = true;
        applyWidthMode();
        document.body.classList.add('sfib-modal-open');
        requestAnimationFrame(() => {
            syncContentFitWidth();
            syncHorizontalScrollbar();
            syncDetailViewportWidth();
            fitBoardRows();
            state.board?.querySelector('#sfib-search')?.focus({ preventScroll: true });
        });
        maybeSyncAllianceNews();
        maybeSyncSectorBrowserData();
    }

    function closeModal() {
        if (document.body.classList.contains('sfib-share-mode')) exitShareMode();
        state.configOpen = false;
        state.helpOpen = false;
        state.statusOpen = false;
        state.expandedEmpire = '';
        releaseContentFitFrame();
        renderConfigPanel();
        renderHelpPanel();
        renderStatusPanel();
        renderRows();
        state.modalOpen = false;
        document.body.classList.remove('sfib-modal-open');
        state.host?.querySelector('#sfib-open')?.focus({ preventScroll: true });
    }

    function revealSource(sourceId) {
        if (!sourceId) return;
        state.rawHidden = false;
        applyRawVisibility();
        closeModal();
        const source = document.getElementById(sourceId);
        source?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (source) {
            source.animate([
                { outline: '1px solid rgba(114,154,178,.72)' },
                { outline: '1px solid rgba(114,154,178,0)' }
            ], { duration: 1800, easing: 'ease-out' });
        }
    }

    function enterShareMode() {
        if (!state.modalOpen) openModal();
        state.expandedEmpire = '';
        releaseContentFitFrame();
        state.configOpen = false;
        state.helpOpen = false;
        state.statusOpen = false;
        renderConfigPanel();
        renderHelpPanel();
        renderStatusPanel();
        renderRows();
        document.body.classList.add('sfib-share-mode');
        const shareButton = state.board?.querySelector('#sfib-share-toggle');
        if (shareButton) shareButton.textContent = 'Exit Share View';
        const wrap = state.board?.querySelector('.sfib-table-wrap');
        if (wrap) wrap.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    function exitShareMode() {
        document.body.classList.remove('sfib-share-mode');
        const shareButton = state.board?.querySelector('#sfib-share-toggle');
        if (shareButton) shareButton.textContent = 'Share View';
    }

    function toggleShareMode() {
        document.body.classList.contains('sfib-share-mode') ? exitShareMode() : enterShareMode();
    }

    function updateAges() {
        for (const node of document.querySelectorAll(`#${BOARD_ID} .sfib-age[data-epoch]`)) {
            const epoch = Number(node.dataset.epoch);
            const ms = ageMs(epoch);
            node.textContent = ageLabel(ms);
            const pill = node.closest('.sfib-scan-pill');
            if (pill) {
                pill.classList.remove('fresh', 'warm', 'old', 'dead', 'missing');
                pill.classList.add(ageLevel(ms));
            }
        }
        for (const node of document.querySelectorAll(`#${BOARD_ID} .sfib-news-age[data-epoch]`)) {
            const epoch = Number(node.dataset.epoch);
            node.textContent = newsAgeCompact(ageMs(epoch));
        }
        updateSubtitle();
    }

    function bindEvents() {
        const search = state.board.querySelector('#sfib-search');
        const sort = state.board.querySelector('#sfib-sort');
        const newsRefresh = state.board.querySelector('#sfib-news-refresh');
        const statusToggle = state.board.querySelector('#sfib-status-toggle');
        const helpToggle = state.board.querySelector('#sfib-help-toggle');
        const configToggle = state.board.querySelector('#sfib-config-toggle');
        const shareToggle = state.board.querySelector('#sfib-share-toggle');
        const closeButton = state.board.querySelector('#sfib-close');
        const openButton = state.host.querySelector('#sfib-open');
        const launcherRaw = state.host.querySelector('#sfib-launcher-raw');
        const tableWrap = state.board.querySelector('.sfib-table-wrap');
        const xScrollTrack = state.board.querySelector('#sfib-x-scroll-track');
        const xScrollThumb = state.board.querySelector('#sfib-x-scroll-thumb');

        tableWrap?.addEventListener('scroll', syncHorizontalScrollbar, { passive: true });

        let xDrag = null;
        xScrollThumb?.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !tableWrap || !xScrollTrack) return;
            event.preventDefault();
            const maxScroll = Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth);
            const travel = Math.max(0, xScrollTrack.clientWidth - xScrollThumb.offsetWidth);
            if (!maxScroll || !travel) return;
            xDrag = { pointerId: event.pointerId, startX: event.clientX, startScroll: tableWrap.scrollLeft, maxScroll, travel };
            xScrollThumb.classList.add('sfib-dragging');
            xScrollThumb.setPointerCapture?.(event.pointerId);
        });
        xScrollThumb?.addEventListener('pointermove', event => {
            if (!xDrag || event.pointerId !== xDrag.pointerId || !tableWrap) return;
            const delta = event.clientX - xDrag.startX;
            tableWrap.scrollLeft = Math.max(0, Math.min(xDrag.maxScroll, xDrag.startScroll + (delta / xDrag.travel) * xDrag.maxScroll));
        });
        const finishXDrag = event => {
            if (!xDrag || (event?.pointerId != null && event.pointerId !== xDrag.pointerId)) return;
            xScrollThumb?.classList.remove('sfib-dragging');
            xDrag = null;
        };
        xScrollThumb?.addEventListener('pointerup', finishXDrag);
        xScrollThumb?.addEventListener('pointercancel', finishXDrag);

        xScrollTrack?.addEventListener('pointerdown', event => {
            if (event.target === xScrollThumb || event.button !== 0 || !tableWrap) return;
            const maxScroll = Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth);
            if (!maxScroll) return;
            const rect = xScrollTrack.getBoundingClientRect();
            const thumbWidth = xScrollThumb?.offsetWidth || 48;
            const travel = Math.max(1, rect.width - thumbWidth);
            const desired = Math.max(0, Math.min(travel, event.clientX - rect.left - thumbWidth / 2));
            tableWrap.scrollLeft = (desired / travel) * maxScroll;
        });
        xScrollTrack?.addEventListener('keydown', event => {
            if (!tableWrap) return;
            const maxScroll = Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth);
            if (!maxScroll) return;
            const step = Math.max(60, Math.round(tableWrap.clientWidth * .12));
            let next = tableWrap.scrollLeft;
            if (event.key === 'ArrowLeft') next -= step;
            else if (event.key === 'ArrowRight') next += step;
            else if (event.key === 'PageUp') next -= Math.round(tableWrap.clientWidth * .8);
            else if (event.key === 'PageDown') next += Math.round(tableWrap.clientWidth * .8);
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = maxScroll;
            else return;
            event.preventDefault();
            tableWrap.scrollLeft = Math.max(0, Math.min(maxScroll, next));
        });

        search.addEventListener('input', () => {
            state.search = search.value;
            state.expandedEmpire = '';
            releaseContentFitFrame();
            renderRows();
        });

        sort.value = state.sortMode;
        sort.addEventListener('change', () => {
            state.sortMode = sort.value;
            setStored('sort', state.sortMode);
            renderRows();
        });

        const toggleRaw = () => {
            state.rawHidden = !state.rawHidden;
            applyRawVisibility();
        };
        newsRefresh.addEventListener('click', () => syncAllianceNews(true));
        statusToggle.addEventListener('click', () => toggleStatusPanel());
        helpToggle.addEventListener('click', () => toggleHelpPanel());
        configToggle.addEventListener('click', () => toggleConfigPanel());
        launcherRaw.addEventListener('click', toggleRaw);

        openButton.addEventListener('click', openModal);
        closeButton.addEventListener('click', closeModal);
        shareToggle.addEventListener('click', toggleShareMode);

        state.modal.addEventListener('mousedown', event => {
            if (event.target === state.modal) closeModal();
        });

        state.board.addEventListener('click', event => {
            const closeStatus = event.target.closest('[data-action="close-status"]');
            if (closeStatus) {
                toggleStatusPanel(false);
                state.board?.querySelector('#sfib-status-toggle')?.focus({ preventScroll: true });
                return;
            }

            const closeHelp = event.target.closest('[data-action="close-help"]');
            if (closeHelp) {
                toggleHelpPanel(false);
                state.board?.querySelector('#sfib-help-toggle')?.focus({ preventScroll: true });
                return;
            }

            const hideNotes = event.target.closest('[data-action="hide-notes"]');
            if (hideNotes) {
                setColumnVisible('notes', false);
                applyColumnVisibility();
                renderConfigPanel();
                reflowAfterColumnChange();
                return;
            }

            const hideEmpire = event.target.closest('[data-action="hide-empire"]');
            if (hideEmpire) {
                setEmpireHidden(hideEmpire.dataset.empire || '', true);
                renderConfigPanel();
                renderRows();
                return;
            }

            const unhideEmpire = event.target.closest('[data-action="unhide-empire"]');
            if (unhideEmpire) {
                setEmpireHidden(unhideEmpire.dataset.empire || '', false);
                renderConfigPanel();
                renderRows();
                return;
            }

            const unhideAll = event.target.closest('[data-action="unhide-all"]');
            if (unhideAll) {
                for (const empire of state.empires) {
                    if (empire.hidden) setEmpireHidden(empire.target, false);
                }
                renderConfigPanel();
                renderRows();
                return;
            }

            const empireButton = event.target.closest('[data-action="toggle-detail"]');
            if (empireButton) {
                const target = empireButton.dataset.empire?.toLowerCase() || '';
                const opening = state.expandedEmpire !== target;
                if (opening && !state.expandedEmpire && !state.flexibleWidth) {
                    syncContentFitWidth();
                    syncDetailViewportWidth();
                    captureContentFitFrame();
                }
                state.expandedEmpire = opening ? target : '';
                if (!state.expandedEmpire) releaseContentFitFrame();
                renderRows();
                return;
            }

            const sourceButton = event.target.closest('.sfib-source-button');
            if (sourceButton) revealSource(sourceButton.dataset.source);
        });

        state.board.addEventListener('change', event => {
            const columnCheckbox = event.target?.closest?.('[data-column-id]');
            if (columnCheckbox) {
                setColumnVisible(columnCheckbox.dataset.columnId || '', Boolean(columnCheckbox.checked));
                applyColumnVisibility();
                reflowAfterColumnChange();
                return;
            }
            if (event.target?.id === 'sfib-config-flexible-width') {
                if (state.expandedEmpire) {
                    state.expandedEmpire = '';
                    releaseContentFitFrame();
                    renderRows();
                }
                state.flexibleWidth = Boolean(event.target.checked);
                setStored('flexible-width', String(state.flexibleWidth));
                applyWidthMode();
                return;
            }
            if (event.target?.id === 'sfib-config-target-stars') {
                state.targetStarCount = Math.max(0, Math.min(10, Number(event.target.value) || 0));
                setStored('target-star-count', String(state.targetStarCount));
                renderConfigPanel();
                renderRows();
                return;
            }
            const input = event.target.closest('.sfib-meta-input');
            if (input) saveMetaInput(input);
        });
        state.board.addEventListener('blur', event => {
            const input = event.target.closest?.('.sfib-meta-input');
            if (input) saveMetaInput(input);
        }, true);

        window.addEventListener('resize', () => requestAnimationFrame(() => {
            if (!state.expandedEmpire) syncContentFitWidth();
            syncHorizontalScrollbar();
            syncDetailViewportWidth();
            fitBoardRows();
        }), { passive: true });

        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            if (state.statusOpen) {
                toggleStatusPanel(false);
                state.board?.querySelector('#sfib-status-toggle')?.focus({ preventScroll: true });
                return;
            }
            if (state.helpOpen) {
                toggleHelpPanel(false);
                state.board?.querySelector('#sfib-help-toggle')?.focus({ preventScroll: true });
                return;
            }
            if (state.configOpen) {
                toggleConfigPanel(false);
                return;
            }
            if (document.body.classList.contains('sfib-share-mode')) {
                exitShareMode();
                return;
            }
            if (state.modalOpen) closeModal();
        });
    }

    function initialize() {
        if (IS_ALLIANCE_NEWS_PAGE) {
            // Zero-request cache assist: merely visiting Alliance News records
            // the page that StarFury already sent to the browser.
            passivelyCacheCurrentNewsPage();
            return;
        }
        if (IS_SECTOR_BROWSER_PAGE) {
            // Zero-request cache assist: merely visiting Sector Browser records
            // the sector page StarFury already sent to the browser.
            passivelyCacheCurrentSectorPage();
            return;
        }

        // The board only attaches to the Alliance Forum thread selected from the
        // userscript extension menu. This keeps future rounds/seasons independent
        // of whatever TID happens to be used today.
        if (!IS_CONFIGURED_SCAN_THREAD) return;

        state.scans = collectScans();
        if (!state.scans.length) return;
        state.hasStealth = state.scans.some(scan => scan.type === 'stealth');
        state.empires = buildEmpires(state.scans);
        rebuildNewsIntel();

        injectStyles();
        if (!makeBoardHost()) return;
        bindEvents();
        applyWidthMode();
        applyRawVisibility();
        applyColumnVisibility();
        renderHelpPanel();
        renderConfigPanel();
        renderStatusPanel();
        renderRows();
        updateAges();
        setInterval(updateAges, 30_000);
        // This timer only checks the local TTL. It performs a request only if
        // the board is open and the cached Alliance News is >=30 minutes old.
        setInterval(maybeSyncAllianceNews, 60_000);
        // Same lightweight TTL check for Sector Browser. Actual requests are
        // capped at once per sector per hour and only happen while the board is open.
        setInterval(maybeSyncSectorBrowserData, 60_000);
    }

    initialize();
})();
