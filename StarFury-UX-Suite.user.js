// ==UserScript==
// @name         StarFury UX Suite
// @namespace    starfuryx.com
// @version      2.0.2
// @author       Zathman
// @license      MIT
// @homepageURL  https://github.com/Katorthoma/star-fury-scripts
// @updateURL    https://raw.githubusercontent.com/Katorthoma/star-fury-scripts/main/StarFury-UX-Suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Katorthoma/star-fury-scripts/main/StarFury-UX-Suite.user.js
// @description  Modular global, research, buildings, and military UX; native controls remain authoritative.
// @icon         https://game.starfuryx.com/images/favicon/favicon-32x32.png
// @match        https://game.starfuryx.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// ==/UserScript==

(() => {
'use strict';
/* StarFury UX Suite 2.0.1 | Shared runtime. No globals are published by the bundle. */
function createSFUX() {
    'use strict';
    const SFUX = { version: '2.0.1', modules: new Map(), dom: {}, format: {}, storage: {}, observe: {}, ui: {} };
    // UI ASSUMPTION: dense building columns and nine navigation items need earlier stacking.
    SFUX.responsive = Object.freeze({ mobile: 640, navigation: 768, buildings: 800, phone: 430, narrowHeader: 460, tinyHud: 360 });
    SFUX.page = new URL(window.location.href);
    SFUX.path = SFUX.page.pathname.toLowerCase();
    SFUX.safeRun = function safeRun(name, callback) {
        try {
            const result = callback();
            if (result && typeof result.then === 'function') return result.catch(error => {
                if (error.name !== 'AbortError') console.error(`[SFUX:${name}]`, error);
            });
            return result;
        } catch (error) {
            if (error.name !== 'AbortError') console.error(`[SFUX:${name}]`, error);
        }
    };
    SFUX.dom.text = value => String(value || '').replace(/\s+/g, ' ').trim();
    SFUX.dom.key = value => SFUX.dom.text(value).toLowerCase();
    SFUX.dom.setText = (element, value) => {
        const text = String(value);
        if (element && element.textContent !== text) element.textContent = text;
    };
    SFUX.dom.path = value => {
        try { return new URL(value, window.location.href).pathname.replace(/\/+$/, '').toLowerCase() || '/'; }
        catch { return ''; }
    };
    // These parsers deliberately differ: research accepts a stripped numeric cell;
    // Buildings extracts the FIRST number (for example "12 (4 ticks)").
    SFUX.format.researchNumber = value => {
        const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    };
    SFUX.format.number = value => {
        if (value == null) return null;
        const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
    };
    SFUX.format.integer = value => Math.floor(value).toLocaleString();
    SFUX.format.signed = value => value == null || !Number.isFinite(value) ? '' : `${Math.floor(value) > 0 ? '+' : ''}${Math.floor(value).toLocaleString()}`;
    SFUX.format.sign = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
    SFUX.format.clamp = (value, min = 0, max = Infinity, round = Math.round) => {
        const parsed = Number(value);
        return Math.min(max, Math.max(min, Number.isFinite(parsed) ? round(parsed) : min));
    };
    SFUX.storage.get = (key, fallback) => {
        try { return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback; }
        catch { return fallback; }
    };
    SFUX.storage.set = (key, value) => SFUX.safeRun('storage', () => {
        if (typeof GM_setValue === 'function') GM_setValue(key, value);
    });
    SFUX.storage.delete = key => SFUX.safeRun('storage', () => {
        if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
    });
    SFUX.storage.localGet = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
    SFUX.storage.localSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Optional preference. */ } };
    SFUX.storage.sessionGet = (key, fallback = null) => { try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; } };
    SFUX.storage.sessionSet = (key, value) => { try { sessionStorage.setItem(key, value); } catch { /* Optional preference. */ } };

    // One bounded discovery stream serves all late shell nodes. It is disconnected
    // once subscribers are resolved, and each subscriber expires after 3 seconds.
    const discoveries = new Set();
    let discoveryObserver = null;
    const stopDiscoveryIfIdle = () => { if (!discoveries.size) { discoveryObserver?.disconnect(); discoveryObserver = null; } };
    const scanDiscoveries = () => {
        for (const item of [...discoveries]) {
            if (!item.context.alive) { item.cancel(); continue; }
            const node = document.querySelector(item.selector);
            if (node) { item.cancel(); SFUX.safeRun(item.context.id, () => item.callback(node)); }
        }
    };
    SFUX.observe.find = (context, selector, callback) => {
        const found = document.querySelector(selector);
        if (found) return SFUX.safeRun(context.id, () => callback(found));
        const item = { context, selector, callback, cancel: null };
        let timeout;
        item.cancel = () => { discoveries.delete(item); clearTimeout(timeout); stopDiscoveryIfIdle(); };
        discoveries.add(item);
        context.cleanups.add(item.cancel);
        if (!discoveryObserver) {
            discoveryObserver = new MutationObserver(scanDiscoveries);
            discoveryObserver.observe(document, { childList: true, subtree: true });
        }
        timeout = setTimeout(item.cancel, 3000);
    };
    SFUX.observe.nativeDockChanges = mutations => mutations.some(mutation => {
        const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (element?.closest('.sfgu-dock-status-countdown')) return false;
        if (mutation.type === 'attributes') return true;
        const changed = [...mutation.addedNodes, ...mutation.removedNodes];
        return changed.some(node => !(node.nodeType === 1 && node.matches?.('[data-sfux-owner]')));
    });

    function createContext(id) {
        const controller = new AbortController();
        const ctx = { id, alive: true, cleanups: new Set() };
        ctx.on = (target, type, callback, options) => {
            const wrapped = function (...args) { if (ctx.alive) return SFUX.safeRun(id, () => callback.apply(this, args)); };
            target.addEventListener(type, wrapped, options);
            ctx.cleanups.add(() => target.removeEventListener(type, wrapped, options));
            return wrapped;
        };
        ctx.timeout = (callback, delay, ...args) => {
            const cleanup = () => clearTimeout(handle);
            const handle = setTimeout(() => {
                ctx.cleanups.delete(cleanup);
                if (ctx.alive) SFUX.safeRun(id, () => callback(...args));
            }, delay);
            ctx.cleanups.add(cleanup);
            return handle;
        };
        ctx.raf = callback => {
            const cleanup = () => cancelAnimationFrame(handle);
            const handle = requestAnimationFrame(time => {
                ctx.cleanups.delete(cleanup);
                if (ctx.alive) SFUX.safeRun(id, () => callback(time));
            });
            ctx.cleanups.add(cleanup);
            return handle;
        };
        ctx.observer = callback => {
            const observer = new MutationObserver((records, observer) => { if (ctx.alive) SFUX.safeRun(id, () => callback(records, observer)); });
            ctx.cleanups.add(() => observer.disconnect());
            return observer;
        };
        ctx.resizeObserver = callback => {
            const observer = new ResizeObserver((entries, observer) => { if (ctx.alive) SFUX.safeRun(id, () => callback(entries, observer)); });
            ctx.cleanups.add(() => observer.disconnect());
            return observer;
        };
        ctx.element = tag => {
            const element = document.createElement(tag);
            element.dataset.sfuxOwner = id;
            return element;
        };
        ctx.style = (styleId, css) => {
            if (document.getElementById(styleId)) return;
            const style = ctx.element('style'); style.id = styleId; style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        };
        ctx.fetch = async (url, options = {}) => {
            const target = new URL(url, SFUX.page);
            if (target.origin !== SFUX.page.origin) throw new Error('Expected a same-origin data page');
            const response = await fetch(target.href, { ...options, signal: controller.signal });
            if (!ctx.alive) throw new DOMException('Module stopped', 'AbortError');
            return response;
        };
        ctx.ready = callback => document.readyState === 'loading'
            ? ctx.on(document, 'DOMContentLoaded', callback, { once: true }) : SFUX.safeRun(id, callback);
        ctx.find = (selector, callback) => SFUX.observe.find(ctx, selector, callback);
        ctx.menu = (title, callback) => {
            if (typeof GM_registerMenuCommand !== 'function') return;
            const handle = GM_registerMenuCommand(title, () => SFUX.safeRun(id, callback));
            ctx.cleanups.add(() => { if (typeof GM_unregisterMenuCommand === 'function') GM_unregisterMenuCommand(handle); });
        };
        ctx.destroy = () => {
            if (!ctx.alive) return;
            ctx.alive = false; controller.abort();
            for (const cleanup of [...ctx.cleanups].reverse()) SFUX.safeRun(id, cleanup);
            ctx.cleanups.clear();
        };
        return ctx;
    }

    // Shared number control: opt in only to actual numeric inputs. It never
    // enables a native disabled/readonly control or changes form association.
    SFUX.ui.number = function configureNumber(ctx, input, { blankZero = false, min = 0, max, step, spinner = true } = {}) {
        if (!input || input.dataset.sfuxNumber === 'true') return;
        input.dataset.sfuxNumber = 'true';
        input.dataset.sfNonNegativeConfigured = 'true'; // Compatibility with existing Buildings selectors.
        input.classList.add('sfux-number'); input.inputMode = 'numeric';
        const nativeMin = input.min === '' ? min : Number(input.min);
        input.min = String(Math.max(min, Number.isFinite(nativeMin) ? nativeMin : min));
        if (max !== undefined) input.max = String(input.max === '' ? max : Math.min(max, Number(input.max)));
        if (step !== undefined && (input.step === '' || input.step === 'any')) input.step = String(step);
        const editable = () => !input.matches(':disabled') && !input.readOnly;
        const normalize = () => {
            if (!editable() || input.value === '') return;
            const value = SFUX.format.clamp(input.value, Number(input.min), input.max === '' ? Infinity : Number(input.max), Number(input.step) >= 1 ? Math.floor : x => x);
            if (String(value) !== input.value) { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }
        };
        if (blankZero && !input.required && editable() && input.value === '0') input.value = '';
        ctx.on(input, 'input', () => {
            if (editable() && input.value !== '' && Number(input.value) < Number(input.min)) {
                input.value = input.min; input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        ctx.on(input, 'blur', normalize);
        if (input.form && blankZero) {
            // Capture runs before native submit listeners; formdata also covers
            // native form.submit() and controls moved outside their form element.
            ctx.on(input.form, 'submit', () => { if (editable() && input.value === '') input.value = '0'; }, true);
            ctx.on(input.form, 'formdata', event => {
                if (editable() && input.name && input.value === '' && event.formData.has(input.name)) event.formData.set(input.name, '0');
            });
        }
        if (!spinner || !editable() || !input.parentNode) return;
        // Preserve effective form ownership after reparenting in legacy table markup.
        const wrapper = ctx.element('div'); wrapper.className = 'sfux-number-stepper sf-number-stepper';
        input.parentNode.insertBefore(wrapper, input); wrapper.append(input);
        const controls = ctx.element('div'); controls.className = 'sfux-number-controls';
        for (const [direction, symbol] of [[1, '▲'], [-1, '▼']]) {
            const button = ctx.element('button'); button.type = 'button'; button.textContent = symbol;
            button.className = 'sfux-number-button'; button.tabIndex = -1;
            button.setAttribute('aria-label', direction > 0 ? 'Increase value' : 'Decrease value');
            ctx.on(button, 'mousedown', event => event.preventDefault());
            ctx.on(button, 'click', () => {
                if (!editable()) return;
                if (input.value === '') input.value = '0';
                try { direction > 0 ? input.stepUp() : input.stepDown(); } catch { return; }
                normalize();
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.focus({ preventScroll: true });
            });
            controls.append(button);
        }
        wrapper.append(controls);
    };
    SFUX.ui.preserveFormExtras = form => {
        // Original transfer code replaces form children. Preserve hidden fields,
        // buttons and any future successful controls it did not explicitly move.
        const elements = [...form.elements];
        return () => { for (const element of elements) if (!form.contains(element) && !element.isConnected) form.append(element); };
    };
    SFUX.ui.submit = (form, submitter) => {
        if (!submitter || submitter.matches(':disabled')) return false;
        // click() runs the submitter's native click handler, constraint validation,
        // submit listeners, and submitter name/value. requestSubmit skips click.
        submitter.click();
        return true;
    };
    SFUX.register = definition => {
        if (SFUX.modules.has(definition.id)) throw new Error(`Duplicate module: ${definition.id}`);
        SFUX.modules.set(definition.id, { ...definition, instance: null, context: null, started: false });
    };
    SFUX.start = id => {
        const module = SFUX.modules.get(id);
        if (!module || module.started || !module.matches(SFUX.path, SFUX.page)) return;
        module.started = true;
        const context = module.context = createContext(id);
        return SFUX.safeRun(id, () => {
            module.instance = module.create(context);
            return module.instance.init();
        });
    };
    SFUX.destroy = () => {
        for (const module of SFUX.modules.values()) module.context?.destroy();
    };
    SFUX.boot = () => {
        const core = createContext('core');
        core.find('head', () => core.style('sfux-core-style', SFUX.css));
        for (const module of SFUX.modules.values()) if (module.phase === 'early') SFUX.start(module.id);
        core.ready(() => { for (const module of SFUX.modules.values()) if (module.phase !== 'early') SFUX.start(module.id); });
        // A bfcache document is suspended, not destroyed, and resumes with its listeners.
        core.on(window, 'pagehide', event => { if (!event.persisted) { SFUX.destroy(); core.destroy(); } });
    };
    SFUX.css = `:root {
    --sfux-bg-page: #0b0d0f;
    --sfux-bg-panel: #141719;
    --sfux-bg-panel-raised: #1a1e21;
    --sfux-bg-row: #202224;
    --sfux-bg-row-alt: #1c1e20;
    --sfux-bg-header: #222a2f;
    --sfux-bg-input: #202326;

    --sfux-border-subtle: rgba(255,255,255,0.10);
    --sfux-border-normal: rgba(255,255,255,0.18);
    --sfux-border-strong: rgba(255,255,255,0.30);

    --sfux-text-primary: rgba(255,255,255,0.96);
    --sfux-text-secondary: rgba(220,226,230,0.78);
    --sfux-text-muted: rgba(190,198,204,0.58);
    --sfux-text-disabled: rgba(190,198,204,0.32);

    --sfux-success: #79cf91;
    --sfux-success-soft: rgba(121,207,145,0.12);

    --sfux-warning: #e4c56f;
    --sfux-warning-soft: rgba(228,197,111,0.12);

    --sfux-danger: #d45d5d;
    --sfux-danger-soft: rgba(212,93,93,0.12);

    --sfux-info: #38bfe8;
    --sfux-info-soft: rgba(56,191,232,0.12);

    --sfux-active: #28a9e2;
    --sfux-active-soft: rgba(40,169,226,0.13);

    --sfux-raze: #b74242;
    --sfux-raze-border: rgba(215,75,75,0.72);

    --sfux-radius-xs: 2px;
    --sfux-radius-sm: 3px;
    --sfux-radius-md: 5px;

    --sfux-space-1: 4px;
    --sfux-space-2: 8px;
    --sfux-space-3: 12px;
    --sfux-space-4: 16px;
    --sfux-space-5: 24px;

    --sfux-font-xs: 11px;
    --sfux-font-sm: 12px;
    --sfux-font-md: 13px;
    --sfux-font-lg: 15px;
    --sfux-font-xl: 17px;

    --sfux-control-height: 34px;
    --sfux-control-width-number: 82px;

    --sfux-transition-fast: 120ms ease;

    --sfux-success-rgb: 121,207,145; --sfux-warning-rgb: 228,197,111; --sfux-danger-rgb: 212,93,93; --sfux-info-rgb: 56,191,232;
    --sfux-weapon: #d84c43; --sfux-weapon-rgb: 216,76,67;
    --sfux-sensor: #238bd6; --sfux-sensor-rgb: 35,139,214;
    --sfux-engine: #d2ad54; --sfux-engine-rgb: 210,173,84;
    --sfux-hull: 16,148,205; --sfux-shield: 113,171,0;
    --sfux-attack: 207,91,0; --sfux-damage: 211,18,18; --sfux-defence: 21,91,202;
    --sfux-role-attack: 216,76,67; --sfux-role-defence: 35,139,214; --sfux-role-raider: 225,132,34;
    --sfux-role-leecher: 76,180,91; --sfux-role-build: 164,86,190;
    /* Compact military labels retain their tested density. */
    --sfux-type-xs: 9px; --sfux-type-sm: 10px; --sfux-type-md: 11px;
    --sfux-type-label: 12px; --sfux-type-title: 14px;
}
/* Core owns numeric controls. Keep page-specific row/card layout in its module. */
.sfux-number-stepper { position: relative; display: inline-block; width: var(--sfux-control-width-number); max-width: 100%; margin: 0 auto; vertical-align: middle; }
html body input.sfux-number { box-sizing: border-box !important; background: var(--sfux-bg-input); color: var(--sfux-text-primary); border: 1px solid var(--sfux-border-normal) !important; border-radius: var(--sfux-radius-sm); min-height: var(--sfux-control-height); text-align: center !important; }
html body .sfux-number-stepper input.sfux-number { width: 100% !important; margin: 0 !important; padding-inline: 20px !important; appearance: textfield; }
.sfux-number-stepper input::-webkit-inner-spin-button, .sfux-number-stepper input::-webkit-outer-spin-button { appearance: none; margin: 0; }
html body input.sfux-number:focus { border-color: var(--sfux-info) !important; outline: 1px solid var(--sfux-info-soft); }
.sfux-number-controls { position: absolute; top: 1px; bottom: 1px; right: 1px; width: 19px; display: grid; grid-template-rows: 1fr 1fr; border-left: 1px solid var(--sfux-border-subtle); }
.sfux-number-button { display: flex !important; align-items: center; justify-content: center; border: 0 !important; padding: 0 !important; margin: 0 !important; height: auto !important; min-height: 0 !important; width: 100% !important; background: var(--sfux-bg-panel-raised) !important; color: var(--sfux-text-secondary) !important; font-size: 7px !important; line-height: 1 !important; cursor: pointer; }
.sfux-number-button:hover { background: var(--sfux-info-soft) !important; }
.sfux-number-stepper:has(input:disabled) .sfux-number-controls, .sfux-number-stepper:has(input[readonly]) .sfux-number-controls { display: none; }
html body input.sfux-number:disabled { color: var(--sfux-text-disabled); }
.sfux-leecher-native-row { display: grid; grid-template-columns: 76px minmax(0,1fr); gap: 8px; align-items: center; margin-bottom: 8px; font-size: var(--sfux-font-sm); }
.sfux-leecher-native-row input, .sfux-leecher-native-row select { width: 100% !important; min-width: 0; margin: 0 !important; text-align: center; }
.sfux-selection-empty { opacity: .6; }
/* Consistent status semantics; role and W/E/S identity retain the game palette. */
.sfro-queued td, .sfro-tech-table tr.sfro-queued { background: var(--sfux-warning-soft) !important; }
.sfro-queue-item { border-left-color: var(--sfux-warning); }
.sfro-queue-item:first-child .sfro-queue-order { color: var(--sfux-warning); }
.sfro-terminal-action-path { color: var(--sfux-text-muted) !important; }
.sf-credit-net-part.sf-net-neutral { color: var(--sfux-text-muted); }
@media (max-width: ${SFUX.responsive.mobile}px) {
    /* Keep native removal available for limited completed research on mobile. */
    .sfro-tech-table tr.sfro-completed.sfux-research-removable { grid-template-columns: minmax(0,1fr) auto !important; grid-template-areas: "tech status" "effect status" !important; }
    .sfro-tech-table tr.sfro-completed.sfux-research-removable > td:nth-child(5) { display: block !important; }
}
@media (max-width: ${SFUX.responsive.buildings}px) {
    .sf-construct-cell .sfux-number-stepper, .sf-raze-input .sfux-number-stepper { width: 72px; }
}
@media (max-width: ${SFUX.responsive.phone}px) {
    .sf-construct-cell .sfux-number-stepper, .sf-raze-input .sfux-number-stepper { width: 68px; }
}
`;
    return SFUX;
}

/* StarFury UX Suite 2.0.1 | Global UX module. */
function registerGlobalUX(SFUX) {
    SFUX.register({
        id: 'global', phase: 'early',
        matches(path, url) { return true; },
        create(ctx) {

            'use strict';


            /*
             * STARFURY GLOBAL UX FIXES - DEVELOPER HANDOFF
             * =========================================================================
             *
             * STATUS
             * - Runnable userscript and reference implementation.
             * - Functionality matches the user-tested v0.4.12 edition.
             * - Release-history commentary is intentionally omitted in this edition.
             *
             * INTENT
             * - Improve shared StarFury UI behavior without changing game rules,
             *   calculations, server data, destinations, or page-specific workflows.
             * - Preserve the native visual language while making the global shell
             *   denser, more responsive, more accessible, and easier to scan.
             *
             * SCOPE
             * 1. Primary navigation
             *    - Desktop alignment and active-section treatment.
             *    - Compact mobile menu with explicit submenu controls.
             *    - Native links remain authoritative.
             *
             * 2. Empire Status HUD (#statbar)
             *    - Converts the native inline stat strip into a one-row HUD.
             *    - Desktop retains exact values; mobile uses compact K/M formatting.
             *    - Exact values remain available through accessible/title text.
             *
             * 3. Advisor + compact Star Dock (#advisor-dock)
             *    - Treats Advisor and Star Dock as one shared context module.
             *    - Responsive 50/50 desktop layout and stacked mobile layout.
             *    - Advisor portrait uses a near-square 14:15 cover crop with restrained
             *      left/bottom edge bleed for legacy and custom artwork.
             *
             * 4. Compact Star Dock minimap
             *    - Fits up to 25 ships into the existing dock height where practical.
             *    - Keeps role identity through translucent slot backgrounds.
             *    - Timed states become compact status beacons:
             *        Returning -> red remaining-tick number
             *        Building  -> orange remaining-tick number
             *        Upgrading -> blue remaining-tick number
             *        Disabled  -> neutral gray "D"
             *        Exploring -> green "E"
             *    - Beacons anchor to the logical ship cell, not the ship artwork.
             *    - Full native status text remains available in tooltip/accessibility data.
             *    - The whole ship slot is clickable/tappable while preserving the native
             *      viewship.php link and normal modifier-key behavior.
             *
             * INTEGRATION CONTRACT
             * - No fetch/XHR calls.
             * - No localStorage/sessionStorage/cookie state.
             * - No game values or form submissions are modified.
             * - Designed to coexist with page-specific Research, Buildings, and
             *   Star Dock/Ship userscripts by owning only shared/global chrome.
             *
             * IMPORTANT NATIVE DOM DEPENDENCIES
             * - Navigation:       #cssmenu
             * - Empire stats:     #statbar, #newsCount, .stats
             * - Context row:      #advisor-dock
             * - Advisor:          .advisor-container, #advisor-content,
             *                     .advisorright, .advisorimg, .advice
             * - Compact dock:     .dock-container, #stardock-content, .minimap,
             *                     .minimapships > ul > li, .shipAvatar
             * - Ship link:        a[href*="viewship.php"]
             * - Ship status:      img.statusIcon plus link[data-tooltip]
             * - Ship role:        img.shipRoleIcon
             *
             * BROWSER / CSS ASSUMPTIONS
             * - Modern browsers with Grid/Flexbox, clamp(), MutationObserver,
             *   ResizeObserver, :scope selectors, and CSS custom properties.
             * - Safari is explicitly supported; portrait fading therefore includes both
             *   -webkit-mask-* and standards-based mask properties.
             * - Mobile breakpoint is centralized in BREAKPOINT below.
             *
             * CODE MAP
             * - injectStyles()
             *      Global visual rules. Major CSS sections are headed in the stylesheet.
             * - initializeStatHud()
             *      Parses the native #statbar and renders the accessible status HUD.
             * - initializeContextRow()
             *      Owns Advisor/Star Dock layout, minimap fitting, portrait treatment,
             *      tooltip behavior, status beacons, and whole-slot click targets.
             * - initializeNavigation()
             *      Normalizes desktop/mobile navigation and submenu interaction.
             * - start()
             *      Bootstraps early, then initializes once the required DOM exists.
             *
             * RECOMMENDED NATIVE IMPLEMENTATION
             * - Treat this userscript as tested behavioral/specification evidence, not
             *   as a requirement to copy every DOM mutation or !important declaration.
             * - Prefer emitting desired markup directly from StarFury templates and move
             *   corresponding CSS into the native theme.
             * - Replace MutationObserver/ResizeObserver work with explicit render/update
             *   hooks wherever the application already knows content has changed.
             * - Preserve the semantic source data exposed through native links, alt text,
             *   and data-tooltip attributes, or replace it with equivalent structured
             *   data-* attributes.
             * - Once selectors are owned natively, reduce specificity and remove
             *   compatibility overrides that are no longer necessary.
             *
             * ACCESSIBILITY
             * - Color is not the sole carrier of ship state; complete status text remains
             *   available through tooltip/accessibility text.
             * - Interactive controls remain real links/buttons with keyboard semantics.
             * - Compact mobile stat formatting is visual only; exact values are retained.
             * - Touch targets are enlarged without adding unnecessary vertical height.
             *
             * NON-GOALS
             * - No combat/build/research math.
             * - No resource calculations.
             * - No server caching or polling.
             * - No replacement of page-specific StarFury workflows.
             * =========================================================================
             */

            const STYLE_ID = 'sfgu-global-ux-styles';
            const NAV_CLASS = 'sfgu-nav';
            const STAT_HUD_CLASS = 'sfgu-stat-hud';
            const CONTEXT_ROW_CLASS = 'sfgu-context-row';
            const STARFIELD_FALLBACK_CLASS = 'sfgu-starfield-fallback';
            const DOCK_TOOLTIP_ID = 'sfgu-dock-tooltip';
            const DOCK_CLICKABLE_CLASS = 'sfgu-dock-ship-clickable';
            const DOCK_COUNTDOWN_CLASS = 'sfgu-dock-status-countdown';
            const DOCK_STATUS_REPLACED_CLASS = 'sfgu-status-countdown-replaced';
            const MOBILE_OPEN_CLASS = 'sfgu-open';
            const SUBMENU_OPEN_CLASS = 'sfgu-expanded';
            const BREAKPOINT = SFUX.responsive.navigation;

            function injectStyles() { ctx.style(STYLE_ID, `
                    /* ================================================================
                       GLOBAL NAVIGATION FOUNDATION
                       ================================================================ */

                    #cssmenu.${NAV_CLASS} {
                        position: relative !important;
                        z-index: 1000 !important;
                        box-sizing: border-box !important;
                        width: 100% !important;
                        height: auto !important;
                        min-height: 0 !important;
                        margin-left: 0 !important;
                        margin-right: 0 !important;
                        padding: 0 !important;
                        overflow: visible !important;
                        background: #171717 !important;
                        font-family: "Titillium Web", Arial, sans-serif !important;
                    }

                    #cssmenu.${NAV_CLASS},
                    #cssmenu.${NAV_CLASS} *,
                    #cssmenu.${NAV_CLASS} *::before,
                    #cssmenu.${NAV_CLASS} *::after {
                        box-sizing: border-box !important;
                    }

                    #cssmenu.${NAV_CLASS} ul,
                    #cssmenu.${NAV_CLASS} li {
                        margin: 0 !important;
                        list-style: none !important;
                    }

                    #cssmenu.${NAV_CLASS} a {
                        text-decoration: none !important;
                    }

                    /* Hide any native mobile submenu helper injected by cssmenu-script.js.
                       Global UX supplies its own dedicated submenu control instead. */
                    #cssmenu.${NAV_CLASS} .submenu-button {
                        display: none !important;
                    }

                    .sfgu-submenu-toggle {
                        appearance: none;
                        -webkit-appearance: none;
                        touch-action: manipulation;
                        -webkit-tap-highlight-color: transparent;
                        border: 0;
                        border-radius: 0;
                        margin: 0;
                        padding: 0;
                        background: transparent;
                        color: rgba(255,255,255,0.72);
                        font: inherit;
                        cursor: pointer;
                    }

                    /* ================================================================
                       DESKTOP / TABLET LANDSCAPE
                       ================================================================ */

                    @media (min-width: ${BREAKPOINT + 1}px) {
                        #cssmenu.${NAV_CLASS} #menu-button {
                            display: none !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul {
                            display: flex !important;
                            position: relative !important;
                            align-items: stretch !important;
                            justify-content: stretch !important;
                            width: 100% !important;
                            height: auto !important;
                            min-height: 52px !important;
                            padding: 0 10px !important;
                            overflow: visible !important;
                            background: #171717 !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li {
                            display: flex !important;
                            float: none !important;
                            position: relative !important;
                            flex: 1 1 0 !important;
                            width: auto !important;
                            min-width: 0 !important;
                            padding: 0 !important;
                            border: 0 !important;
                            background: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > a {
                            display: flex !important;
                            align-items: center !important;
                            justify-content: center !important;
                            gap: 8px !important;
                            width: 100% !important;
                            min-width: 0 !important;
                            min-height: 52px !important;
                            padding: 0 10px !important;
                            border: 0 !important;
                            color: rgba(255,255,255,0.88) !important;
                            background: transparent !important;
                            font-size: 13px !important;
                            font-weight: 700 !important;
                            line-height: 1 !important;
                            letter-spacing: 0.055em !important;
                            text-align: center !important;
                            text-transform: uppercase !important;
                            white-space: nowrap !important;
                            transition:
                                background-color 120ms ease,
                                color 120ms ease,
                                box-shadow 120ms ease !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li:hover > a,
                        #cssmenu.${NAV_CLASS} > ul > li:focus-within > a {
                            color: #ffffff !important;
                            background: rgba(255,255,255,0.055) !important;
                            box-shadow: inset 0 -2px 0 rgba(var(--sfux-info-rgb), 0.72) !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li.sfgu-current > a {
                            color: #ffffff !important;
                            background: rgba(255,255,255,0.035) !important;
                            box-shadow: inset 0 -2px 0 rgba(var(--sfux-info-rgb), 0.92) !important;
                        }

                        /* Replace inconsistent native plus markers with one compact
                           dropdown indicator aligned identically for every parent. */
                        #cssmenu.${NAV_CLASS} > ul > li.sfgu-has-submenu > a::after {
                            content: "\\25BE" !important;
                            display: inline-block !important;
                            position: static !important;
                            width: auto !important;
                            height: auto !important;
                            margin: 0 !important;
                            border: 0 !important;
                            color: rgba(255,255,255,0.66) !important;
                            background: none !important;
                            font-size: 9px !important;
                            line-height: 1 !important;
                            transform: translateY(-1px) !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li.sfgu-has-submenu > a::before {
                            display: none !important;
                            content: none !important;
                        }

                        .sfgu-submenu-toggle {
                            display: none !important;
                        }

                        /* Consistent dropdown panels. Kept in the document for smooth
                           focus handling but made non-interactive while closed. */
                        #cssmenu.${NAV_CLASS} > ul > li > ul {
                            display: block !important;
                            position: absolute !important;
                            top: 100% !important;
                            left: 50% !important;
                            z-index: 1100 !important;
                            width: max-content !important;
                            min-width: 190px !important;
                            max-width: 260px !important;
                            height: auto !important;
                            padding: 6px !important;
                            overflow: visible !important;
                            border: 1px solid rgba(255,255,255,0.12) !important;
                            background: rgba(18,18,18,0.985) !important;
                            box-shadow: 0 12px 28px rgba(0,0,0,0.48) !important;
                            opacity: 0 !important;
                            visibility: hidden !important;
                            pointer-events: none !important;
                            transform: translate(-50%, -5px) !important;
                            transition:
                                opacity 110ms ease,
                                transform 110ms ease,
                                visibility 110ms ease !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li:hover > ul,
                        #cssmenu.${NAV_CLASS} > ul > li:focus-within > ul {
                            opacity: 1 !important;
                            visibility: visible !important;
                            pointer-events: auto !important;
                            transform: translate(-50%, 0) !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > ul > li {
                            display: block !important;
                            float: none !important;
                            position: relative !important;
                            width: 100% !important;
                            height: auto !important;
                            padding: 0 !important;
                            border: 0 !important;
                            background: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > ul > li > a {
                            display: flex !important;
                            align-items: center !important;
                            justify-content: flex-start !important;
                            width: 100% !important;
                            min-height: 38px !important;
                            padding: 8px 11px !important;
                            border: 0 !important;
                            border-radius: 2px !important;
                            color: rgba(255,255,255,0.78) !important;
                            background: transparent !important;
                            font-size: 13px !important;
                            font-weight: 600 !important;
                            line-height: 1.25 !important;
                            letter-spacing: 0.01em !important;
                            text-align: left !important;
                            text-transform: none !important;
                            white-space: nowrap !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > ul > li > a:hover,
                        #cssmenu.${NAV_CLASS} > ul > li > ul > li > a:focus-visible {
                            color: #ffffff !important;
                            background: rgba(var(--sfux-info-rgb), 0.13) !important;
                            outline: none !important;
                        }
                    }

                    /* ================================================================
                       MOBILE / PORTRAIT TABLET
                       ================================================================ */

                    @media (max-width: ${BREAKPOINT}px) {
                        /*
                         * MOBILE HEADER COMPACTION
                         * ------------------------------------------------------------
                         * StarFury's native #header reserves desktop-era vertical space
                         * at narrow widths. The logo may disappear, but that height
                         * remains, creating the large blank block ABOVE the menu.
                         *
                         * Keep this deliberately separate from #cssmenu. The nav itself
                         * was already collapsing correctly.
                         */
                        .container > #header {
                            display: flex !important;
                            position: relative !important;
                            float: none !important;
                            align-items: center !important;
                            justify-content: flex-end !important;
                            gap: 8px !important;
                            width: 100% !important;
                            height: 64px !important;
                            min-height: 64px !important;
                            max-height: 64px !important;
                            margin: 0 !important;
                            padding: 10px !important;
                            overflow: hidden !important;
                            box-sizing: border-box !important;
                        }

                        .container > #header .help,
                        .container > #header #headertext {
                            position: static !important;
                            float: none !important;
                            top: auto !important;
                            right: auto !important;
                            bottom: auto !important;
                            left: auto !important;
                            display: flex !important;
                            align-items: center !important;
                            box-sizing: border-box !important;
                            width: auto !important;
                            height: 36px !important;
                            min-height: 36px !important;
                            max-height: 36px !important;
                            margin: 0 !important;
                            transform: none !important;
                            vertical-align: middle !important;
                            white-space: nowrap !important;
                        }

                        .container > #header .help {
                            order: 2 !important;
                        }

                        .container > #header #headertext {
                            order: 3 !important;
                            justify-content: center !important;
                            line-height: 1 !important;
                        }

                        .container > #header .help form {
                            display: flex !important;
                            align-items: stretch !important;
                            height: 36px !important;
                            min-height: 36px !important;
                            max-height: 36px !important;
                            margin: 0 !important;
                            padding: 0 !important;
                        }

                        .container > #header .help input[type="submit"],
                        .container > #header .help .helpMe {
                            box-sizing: border-box !important;
                            height: 36px !important;
                            min-height: 36px !important;
                            max-height: 36px !important;
                            margin: 0 !important;
                            padding-top: 0 !important;
                            padding-bottom: 0 !important;
                            vertical-align: middle !important;
                            white-space: nowrap !important;
                        }

                        /*
                         * Leave native logo visibility alone. If StarFury hides it at a
                         * particular breakpoint, it stays hidden. If visible, pin it to
                         * the left without allowing it to inflate the header.
                         */
                        .container > #header .logo {
                            order: 1 !important;
                            position: static !important;
                            float: none !important;
                            flex: 0 1 auto !important;
                            min-width: 0 !important;
                            max-height: 44px !important;
                            margin: 0 auto 0 0 !important;
                            padding: 0 !important;
                            overflow: hidden !important;
                        }

                        .container > #header .logo-image,
                        .container > #header .logo-image img {
                            position: static !important;
                            float: none !important;
                            display: block;
                            width: auto !important;
                            max-width: 120px !important;
                            height: auto !important;
                            max-height: 40px !important;
                            margin: 0 !important;
                            padding: 0 !important;
                        }

                        #cssmenu.${NAV_CLASS} {
                            min-height: 48px !important;
                            margin-top: 0 !important;
                            margin-bottom: 10px !important;
                            padding: 0 !important;
                            background: #171717 !important;
                        }

                        /* StarFury's native responsive menu reserves top spacing at
                           some very narrow widths. Reset every positioning offset so
                           the 48 px menu bar begins at the top of #cssmenu. */
                        #cssmenu.${NAV_CLASS} #menu-button {
                            top: auto !important;
                            right: auto !important;
                            bottom: auto !important;
                            left: auto !important;
                            transform: none !important;
                        }

                        #cssmenu.${NAV_CLASS} #menu-button {
                            display: flex !important;
                            position: relative !important;
                            align-items: center !important;
                            justify-content: space-between !important;
                            width: 100% !important;
                            height: 48px !important;
                            min-height: 48px !important;
                            margin: 0 !important;
                            padding: 0 15px !important;
                            border: 0 !important;
                            border-bottom: 1px solid rgba(255,255,255,0.07) !important;
                            background: #171717 !important;
                            color: rgba(255,255,255,0.88) !important;
                            font-size: 12px !important;
                            font-weight: 700 !important;
                            line-height: 1 !important;
                            letter-spacing: 0.07em !important;
                            text-transform: uppercase !important;
                            cursor: pointer !important;
                            user-select: none !important;
                            touch-action: manipulation !important;
                            -webkit-tap-highlight-color: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} #menu-button::before,
                        #cssmenu.${NAV_CLASS} #menu-button::after {
                            display: none !important;
                            content: none !important;
                        }

                        #cssmenu.${NAV_CLASS} .sfgu-menu-label {
                            display: inline-flex !important;
                            align-items: center !important;
                        }

                        #cssmenu.${NAV_CLASS} .sfgu-hamburger {
                            display: inline-flex !important;
                            flex-direction: column !important;
                            justify-content: center !important;
                            gap: 4px !important;
                            width: 24px !important;
                            height: 24px !important;
                        }

                        #cssmenu.${NAV_CLASS} .sfgu-hamburger > span {
                            display: block !important;
                            width: 20px !important;
                            height: 2px !important;
                            margin: 0 !important;
                            border: 0 !important;
                            border-radius: 1px !important;
                            background: rgba(255,255,255,0.84) !important;
                            transform-origin: center !important;
                            transition:
                                transform 80ms ease-out,
                                opacity 70ms ease-out !important;
                        }

                        #cssmenu.${NAV_CLASS}.${MOBILE_OPEN_CLASS}
                            .sfgu-hamburger > span:nth-child(1) {
                            transform: translateY(6px) rotate(45deg) !important;
                        }

                        #cssmenu.${NAV_CLASS}.${MOBILE_OPEN_CLASS}
                            .sfgu-hamburger > span:nth-child(2) {
                            opacity: 0 !important;
                        }

                        #cssmenu.${NAV_CLASS}.${MOBILE_OPEN_CLASS}
                            .sfgu-hamburger > span:nth-child(3) {
                            transform: translateY(-6px) rotate(-45deg) !important;
                        }

                        /* Critical bug fix: a closed menu occupies zero vertical space.
                           Native menu classes cannot leave a tall invisible box behind. */
                        #cssmenu.${NAV_CLASS} > ul {
                            display: none !important;
                            position: static !important;
                            width: 100% !important;
                            height: 0 !important;
                            min-height: 0 !important;
                            max-height: none !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            overflow: hidden !important;
                            border: 0 !important;
                            background: #151515 !important;
                        }

                        #cssmenu.${NAV_CLASS}.${MOBILE_OPEN_CLASS} > ul {
                            display: block !important;
                            height: auto !important;
                            overflow: visible !important;
                            border-top: 1px solid rgba(255,255,255,0.06) !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li {
                            display: grid !important;
                            float: none !important;
                            position: relative !important;
                            grid-template-columns: minmax(0, 1fr) 48px !important;
                            width: 100% !important;
                            height: auto !important;
                            min-height: 0 !important;
                            padding: 0 !important;
                            border: 0 !important;
                            border-bottom: 1px solid rgba(255,255,255,0.055) !important;
                            background: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li:not(.sfgu-has-submenu) > a {
                            grid-column: 1 / -1 !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > a {
                            display: flex !important;
                            position: static !important;
                            align-items: center !important;
                            justify-content: flex-start !important;
                            width: 100% !important;
                            min-height: 46px !important;
                            padding: 11px 15px !important;
                            border: 0 !important;
                            color: rgba(255,255,255,0.84) !important;
                            background: transparent !important;
                            font-size: 13px !important;
                            font-weight: 700 !important;
                            line-height: 1.15 !important;
                            letter-spacing: 0.045em !important;
                            text-align: left !important;
                            text-transform: uppercase !important;
                            touch-action: manipulation !important;
                            -webkit-tap-highlight-color: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > a::before,
                        #cssmenu.${NAV_CLASS} > ul > li > a::after {
                            display: none !important;
                            content: none !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li.sfgu-current > a {
                            color: #ffffff !important;
                            box-shadow: inset 3px 0 0 rgba(var(--sfux-info-rgb), 0.92) !important;
                            background: rgba(var(--sfux-info-rgb), 0.07) !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > a:active,
                        #cssmenu.${NAV_CLASS} > ul > li > a:focus-visible {
                            color: #ffffff !important;
                            background: rgba(255,255,255,0.085) !important;
                            outline: none !important;
                        }

                        #cssmenu.${NAV_CLASS}
                            > ul > li.${SUBMENU_OPEN_CLASS}
                            > a {
                            color: #ffffff !important;
                            background: rgba(var(--sfux-info-rgb), 0.085) !important;
                            box-shadow: inset 3px 0 0 rgba(var(--sfux-info-rgb), 0.72) !important;
                        }

                        #cssmenu.${NAV_CLASS}
                            > ul > li.sfgu-current.${SUBMENU_OPEN_CLASS}
                            > a {
                            background: rgba(var(--sfux-info-rgb), 0.115) !important;
                            box-shadow: inset 3px 0 0 rgba(var(--sfux-info-rgb), 0.98) !important;
                        }

                        #cssmenu.${NAV_CLASS} .sfgu-submenu-toggle {
                            display: flex !important;
                            grid-column: 2 !important;
                            grid-row: 1 !important;
                            align-items: center !important;
                            justify-content: center !important;
                            width: 48px !important;
                            min-width: 48px !important;
                            height: 46px !important;
                            min-height: 46px !important;
                            border-left: 1px solid rgba(255,255,255,0.055) !important;
                            color: rgba(255,255,255,0.66) !important;
                            background: transparent !important;
                            touch-action: manipulation !important;
                            -webkit-tap-highlight-color: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} .sfgu-submenu-toggle:active {
                            color: #ffffff !important;
                            background: rgba(255,255,255,0.085) !important;
                        }

                        #cssmenu.${NAV_CLASS} .sfgu-submenu-toggle:hover,
                        #cssmenu.${NAV_CLASS} .sfgu-submenu-toggle:focus-visible {
                            color: #ffffff !important;
                            background: rgba(255,255,255,0.05) !important;
                            outline: none !important;
                        }

                        #cssmenu.${NAV_CLASS} .sfgu-submenu-arrow {
                            display: block !important;
                            font-size: 14px !important;
                            line-height: 1 !important;
                            transform: rotate(0deg) !important;
                            transition: transform 80ms ease-out !important;
                        }

                        #cssmenu.${NAV_CLASS}
                            > ul > li.${SUBMENU_OPEN_CLASS}
                            > .sfgu-submenu-toggle
                            .sfgu-submenu-arrow {
                            transform: rotate(180deg) !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > ul {
                            display: none !important;
                            position: static !important;
                            grid-column: 1 / -1 !important;
                            grid-row: 2 !important;
                            width: 100% !important;
                            height: auto !important;
                            min-height: 0 !important;
                            margin: 0 !important;
                            padding: 4px 0 7px !important;
                            overflow: hidden !important;
                            border: 0 !important;
                            border-top: 1px solid rgba(255,255,255,0.045) !important;
                            background: rgba(0,0,0,0.17) !important;
                            opacity: 1 !important;
                            visibility: visible !important;
                            transform: none !important;
                        }

                        #cssmenu.${NAV_CLASS}
                            > ul > li.${SUBMENU_OPEN_CLASS}
                            > ul {
                            display: block !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > ul > li {
                            display: block !important;
                            float: none !important;
                            position: static !important;
                            width: 100% !important;
                            height: auto !important;
                            padding: 0 !important;
                            border: 0 !important;
                            background: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > ul > li > a {
                            display: flex !important;
                            align-items: center !important;
                            width: 100% !important;
                            min-height: 40px !important;
                            padding: 9px 18px 9px 28px !important;
                            border: 0 !important;
                            color: rgba(255,255,255,0.68) !important;
                            background: transparent !important;
                            font-size: 13px !important;
                            font-weight: 600 !important;
                            line-height: 1.2 !important;
                            letter-spacing: 0.01em !important;
                            text-align: left !important;
                            text-transform: none !important;
                            white-space: normal !important;
                            touch-action: manipulation !important;
                            -webkit-tap-highlight-color: transparent !important;
                        }

                        #cssmenu.${NAV_CLASS} > ul > li > ul > li > a:active,
                        #cssmenu.${NAV_CLASS} > ul > li > ul > li > a:focus-visible {
                            color: #ffffff !important;
                            background: rgba(var(--sfux-info-rgb), 0.09) !important;
                            outline: none !important;
                        }
                    }


                    /* ================================================================
                       ADVISOR + STAR DOCK CONTEXT ROW
                       ================================================================ */

                    #advisor-dock.${CONTEXT_ROW_CLASS} {
                        box-sizing: border-box !important;
                        width: 100% !important;
                        min-width: 0 !important;
                        margin-left: 0 !important;
                        margin-right: 0 !important;
                        font-family: "Titillium Web", Arial, sans-serif !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS},
                    #advisor-dock.${CONTEXT_ROW_CLASS} > .advisor-container,
                    #advisor-dock.${CONTEXT_ROW_CLASS} > .dock-container,
                    #advisor-dock.${CONTEXT_ROW_CLASS} > .sfgu-context-header {
                        box-sizing: border-box !important;
                    }

                    /*
                     * The native Advisor and Star Dock bars previously each owned their
                     * own animated-collapse control. Global UX replaces both with one
                     * shared header, so the two panels behave as one context module.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .advisor-container > .content-toggle,
                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .dock-container > .content-toggle {
                        display: none !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} > .sfgu-context-header {
                        position: relative !important;
                        display: grid !important;
                        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
                        align-items: stretch !important;
                        width: 100% !important;
                        min-width: 0 !important;
                        min-height: 28px !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        border: 1px solid rgba(255,255,255,0.14) !important;
                        background:
                            linear-gradient(
                                to bottom,
                                rgba(255,255,255,0.075),
                                rgba(255,255,255,0.015)
                            ) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .sfgu-context-header .sfgu-context-label {
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        min-width: 0 !important;
                        min-height: 28px !important;
                        padding: 3px 10px !important;
                        color: var(--sfux-text-primary) !important;
                        font-size: 14px !important;
                        font-weight: 700 !important;
                        line-height: 1.1 !important;
                        text-align: center !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .sfgu-context-header .sfgu-context-label + .sfgu-context-label {
                        border-left: 1px solid rgba(255,255,255,0.09) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .sfgu-context-header .sfgu-context-mobile-label {
                        display: none !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .sfgu-context-header .sfgu-context-toggle {
                        position: absolute !important;
                        top: 0 !important;
                        right: 0 !important;
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        width: 30px !important;
                        height: 28px !important;
                        min-width: 30px !important;
                        min-height: 28px !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        border: 0 !important;
                        border-left: 1px solid rgba(255,255,255,0.08) !important;
                        border-radius: 0 !important;
                        color: rgba(255,255,255,0.86) !important;
                        background: rgba(0,0,0,0.08) !important;
                        font: inherit !important;
                        line-height: 1 !important;
                        cursor: pointer !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .sfgu-context-header .sfgu-context-toggle:hover {
                        background: rgba(255,255,255,0.06) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .sfgu-context-header .sfgu-context-toggle:focus-visible {
                        outline: 2px solid var(--sfux-info) !important;
                        outline-offset: -2px !important;
                        background: rgba(var(--sfux-info-rgb), 0.09) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        > .sfgu-context-header .sfgu-context-toggle .fa {
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        width: 18px !important;
                        height: 18px !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        line-height: 1 !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} > .advisor-container,
                    #advisor-dock.${CONTEXT_ROW_CLASS} > .dock-container {
                        min-width: 0 !important;
                        margin: 0 !important;
                        border: 1px solid rgba(255,255,255,0.14) !important;
                        background: rgba(19,19,19,0.96) !important;
                    }

                    /*
                     * We intentionally take ownership of the two body display states.
                     * This prevents StarFury's old per-panel persisted state from hiding
                     * only one half of the new unified component.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS}:not(.sfgu-context-collapsed)
                        #advisor-content,
                    #advisor-dock.${CONTEXT_ROW_CLASS}:not(.sfgu-context-collapsed)
                        #stardock-content {
                        display: block !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}.sfgu-context-collapsed
                        > .advisor-container,
                    #advisor-dock.${CONTEXT_ROW_CLASS}.sfgu-context-collapsed
                        > .dock-container {
                        display: none !important;
                    }

                    @media (min-width: ${BREAKPOINT + 1}px) {
                        #advisor-dock.${CONTEXT_ROW_CLASS}.sfgu-context-collapsed {
                            grid-template-rows: 28px 0 !important;
                            height: 28px !important;
                            min-height: 28px !important;
                            max-height: 28px !important;
                        }
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} #advisor-content {
                        min-height: 0 !important;
                        height: 100% !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} #stardock-content {
                        min-height: 0 !important;
                        height: 100% !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advice {
                        max-width: 62ch !important;
                        padding-top: 10px !important;
                        padding-bottom: 10px !important;
                        color: rgba(255,255,255,0.94) !important;
                        font-size: 14px !important;
                        line-height: 1.42 !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advice p {
                        margin-top: 0 !important;
                        margin-bottom: 5px !important;
                        line-height: inherit !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advice .bold {
                        font-weight: 700 !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .advice .sfgu-advisor-meta {
                        color: rgba(255,255,255,0.78) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .advice .sfgu-advisor-meta .bold {
                        color: rgba(255,255,255,0.90) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advice a {
                        text-underline-offset: 2px !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advice a:focus-visible {
                        outline: 2px solid var(--sfux-info) !important;
                        outline-offset: 2px !important;
                        border-radius: 1px !important;
                    }

                    /*
                     * Integrated Advisor portrait.
                     *
                     * Keep the native 150x150 race artwork visually subordinate to the
                     * advisor copy. The image sits directly in the panel with only the
                     * same kind of quiet separator used elsewhere in Star Fury.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS} .advisorright {
                        position: relative !important;
                        box-sizing: border-box !important;
                        margin-left: 10px !important;
                        padding: 0 !important;
                        overflow: visible !important;
                        border: 0 !important;
                        border-radius: 0 !important;
                        background: transparent !important;
                        box-shadow: none !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advisorright::after {
                        content: none !important;
                        display: none !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advisorright .advisorimg {
                        box-sizing: border-box !important;
                        display: block !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        position: relative !important;
                        aspect-ratio: 14 / 15 !important;
                        height: auto !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow: hidden !important;
                        border: 0 !important;
                        border-radius: 0 !important;
                        background: transparent !important;
                        box-shadow: none !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advisorright .advisorimg img {
                        box-sizing: border-box !important;
                        position: absolute !important;
                        inset: 0 !important;
                        display: block !important;
                        width: 100% !important;
                        height: 100% !important;
                        min-width: 0 !important;
                        max-width: none !important;
                        min-height: 0 !important;
                        max-height: none !important;
                        aspect-ratio: auto !important;
                        object-fit: cover !important;
                        object-position: center center !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        border: 0 !important;
                        border-radius: 0 !important;
                        background: transparent !important;

                        /*
                         * Bleed the portrait into the panel rather than enclosing it
                         * in another card. The first mask fades the left edge inward;
                         * the second fades the bottom edge upward. Together they keep
                         * the top and right sides crisp.
                         */
                        -webkit-mask-image:
                            linear-gradient(
                                to right,
                                transparent 0%,
                                rgba(0,0,0,0.45) 7%,
                                #000 18%,
                                #000 100%
                            ),
                            linear-gradient(
                                to top,
                                transparent 0%,
                                rgba(0,0,0,0.45) 7%,
                                #000 18%,
                                #000 100%
                            ) !important;
                        -webkit-mask-composite: source-in !important;

                        mask-image:
                            linear-gradient(
                                to right,
                                transparent 0%,
                                rgba(0,0,0,0.45) 7%,
                                #000 18%,
                                #000 100%
                            ),
                            linear-gradient(
                                to top,
                                transparent 0%,
                                rgba(0,0,0,0.45) 7%,
                                #000 18%,
                                #000 100%
                            ) !important;
                        mask-composite: intersect !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .advisorright .advisortag {
                        display: none !important;
                    }

                    @media (min-width: ${BREAKPOINT + 1}px) {
                        #advisor-dock.${CONTEXT_ROW_CLASS} .advisorright {
                            width: 128px !important;
                            min-width: 128px !important;
                            max-width: 128px !important;
                            margin-left: 10px !important;
                            margin-right: 3px !important;
                        }
                    }

                    /*
                     * Star Dock minimap:
                     * Native StarFury imagery, overflow, tooltip behavior, and icon box
                     * models remain authoritative. Global UX only supplies a background
                     * fallback and lays out the <li> ship slots.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS} .minimap {
                        position: relative !important;
                        background-color: #010308 !important;
                        box-shadow:
                            inset 0 0 28px rgba(0,0,0,0.46) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimap.${STARFIELD_FALLBACK_CLASS} {
                        background-color: #010308 !important;
                        background-image:
                            radial-gradient(
                                circle at center,
                                rgba(255,255,255,0.82) 0 0.8px,
                                transparent 1.05px
                            ),
                            radial-gradient(
                                circle at center,
                                rgba(138,190,255,0.58) 0 0.65px,
                                transparent 0.95px
                            ),
                            radial-gradient(
                                circle at center,
                                rgba(255,255,255,0.44) 0 0.55px,
                                transparent 0.85px
                            ) !important;
                        background-size:
                            47px 43px,
                            83px 71px,
                            131px 109px !important;
                        background-position:
                            7px 9px,
                            29px 17px,
                            13px 51px !important;
                    }

                    /*
                     * Star Dock fit-all layout.
                     *
                     * JavaScript assigns each <li> a percentage basis and resizes only
                     * the visual ship avatar. The native tooltip anchor remains unscaled,
                     * which preserves StarFury's hover detail behavior.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS} .minimapships {
                        width: 100% !important;
                        height: 100% !important;
                        min-height: 100% !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .minimapships > ul {
                        box-sizing: border-box !important;
                        display: flex !important;
                        flex-flow: row wrap !important;
                        align-content: center !important;
                        align-items: stretch !important;
                        justify-content: flex-start !important;
                        width: 100% !important;
                        height: 100% !important;
                        min-height: 100% !important;
                        margin: 0 !important;
                        padding: 2px !important;
                        list-style: none !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS} .minimapships > ul > li {
                        box-sizing: border-box !important;
                        float: none !important;
                        position: relative !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        width: auto !important;
                        min-width: 0 !important;
                        max-width: none !important;
                        height: auto !important;
                        min-height: 0 !important;
                        margin: 0 !important;
                        padding: 1px !important;
                        overflow: visible !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li > .shipAvatar {
                        flex: 0 0 auto !important;
                        margin: 0 auto !important;
                        overflow: visible !important;
                        background-repeat: no-repeat !important;
                        background-position: center center !important;
                        background-size: contain !important;
                    }

                    /*
                     * Role is communicated by the ship slot itself rather than a tiny
                     * badge. The background is now deliberately visible at a glance,
                     * but still translucent enough that StarFury's ship/status artwork
                     * remains the dominant layer.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li[class*="sfgu-role-"] {
                        --sfgu-role-rgb: 140, 140, 140;
                        border-top:
                            1px solid rgba(var(--sfgu-role-rgb), 0.48) !important;
                        border-radius: 2px !important;
                        background:
                            linear-gradient(
                                to bottom,
                                rgba(var(--sfgu-role-rgb), 0.20) 0%,
                                rgba(var(--sfgu-role-rgb), 0.095) 42%,
                                rgba(var(--sfgu-role-rgb), 0.035) 74%,
                                rgba(var(--sfgu-role-rgb), 0.012) 100%
                            ),
                            radial-gradient(
                                ellipse at center,
                                rgba(var(--sfgu-role-rgb), 0.18) 0%,
                                rgba(var(--sfgu-role-rgb), 0.07) 54%,
                                transparent 82%
                            ) !important;
                        box-shadow:
                            inset 0 1px 0 rgba(255,255,255,0.025),
                            inset 0 0 12px rgba(var(--sfgu-role-rgb), 0.055) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.sfgu-role-attack {
                        --sfgu-role-rgb: var(--sfux-role-attack);
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.sfgu-role-defence {
                        --sfgu-role-rgb: var(--sfux-role-defence);
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.sfgu-role-raider {
                        --sfgu-role-rgb: var(--sfux-role-raider);
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.sfgu-role-leecher {
                        --sfgu-role-rgb: var(--sfux-role-leecher);
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.sfgu-role-building {
                        --sfgu-role-rgb: var(--sfux-role-build);
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships img.shipRoleIcon {
                        display: none !important;
                    }

                    /*
                     * Mini-dock status beacons favor compact glanceable information:
                     * timed states show remaining ticks, while non-timed Disabled uses
                     * a single-letter state marker. Full status remains available in
                     * the viewport tooltip and the link's accessible name.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships img.statusIcon.${DOCK_STATUS_REPLACED_CLASS} {
                        display: none !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships .${DOCK_COUNTDOWN_CLASS} {
                        position: absolute !important;
                        z-index: 8 !important;
                        top: 4px !important;
                        left: 4px !important;
                        transform: none !important;
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        box-sizing: border-box !important;
                        min-width: var(--sfgu-status-chip-height, 22px) !important;
                        height: var(--sfgu-status-chip-height, 22px) !important;
                        margin: 0 !important;
                        padding: 0 var(--sfgu-status-chip-pad, 5px) !important;
                        border: 1px solid var(--sfgu-status-border, rgba(255,255,255,0.78)) !important;
                        border-radius: 999px !important;
                        color: #fff !important;
                        background: var(--sfgu-status-bg, rgba(30,34,38,0.94)) !important;
                        font-family: "Titillium Web", Arial, sans-serif !important;
                        font-size: var(--sfgu-status-size, 16px) !important;
                        font-weight: 700 !important;
                        font-variant-numeric: tabular-nums !important;
                        line-height: 1 !important;
                        letter-spacing: -0.025em !important;
                        text-align: center !important;
                        text-shadow: 0 1px 2px rgba(0,0,0,0.95) !important;
                        box-shadow:
                            0 0 0 1px rgba(0,0,0,0.82),
                            0 2px 5px rgba(0,0,0,0.72),
                            0 0 8px var(--sfgu-status-glow, rgba(255,255,255,0.24))
                            !important;
                        pointer-events: none !important;
                        user-select: none !important;
                    }

                    /*
                     * Keep the tooltip anchor native in scale and positioning. Only its
                     * clickable box follows the resized avatar dimensions.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li > .shipAvatar > a {
                        position: relative !important;
                        display: block !important;
                        width: 100% !important;
                        height: 100% !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships a[href*="viewship.php"]:focus-visible {
                        outline: 2px solid var(--sfux-info) !important;
                        outline-offset: 2px !important;
                        box-shadow: 0 0 0 2px rgba(var(--sfux-info-rgb), 0.22) !important;
                    }

                    /*
                     * Whole-slot pointer target. Keyboard focus stays on StarFury's
                     * original anchor inside the slot.
                     */
                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.${DOCK_CLICKABLE_CLASS} {
                        cursor: pointer !important;
                        transition:
                            filter 90ms ease,
                            box-shadow 90ms ease !important;
                        -webkit-tap-highlight-color:
                            rgba(var(--sfux-info-rgb), 0.16) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.${DOCK_CLICKABLE_CLASS}:hover {
                        filter: brightness(1.08) !important;
                    }

                    #advisor-dock.${CONTEXT_ROW_CLASS}
                        .minimapships > ul > li.${DOCK_CLICKABLE_CLASS}:active {
                        filter: brightness(1.14) !important;
                        box-shadow:
                            inset 0 0 0 1px rgba(255,255,255,0.16),
                            inset 0 0 14px
                                rgba(var(--sfgu-role-rgb, 140,140,140), 0.12)
                            !important;
                    }

                    /*
                     * Viewport-level dock tooltip. Because it lives directly under
                     * <body>, panel overflow can never crop the first row.
                     */
                    #${DOCK_TOOLTIP_ID} {
                        position: fixed !important;
                        z-index: 2147483000 !important;
                        display: none;
                        box-sizing: border-box !important;
                        max-width: min(300px, calc(100vw - 16px)) !important;
                        padding: 7px 9px !important;
                        border: 1px solid rgba(255,255,255,0.22) !important;
                        border-radius: 3px !important;
                        background: rgba(8,10,13,0.97) !important;
                        box-shadow:
                            0 8px 22px rgba(0,0,0,0.48),
                            inset 0 1px 0 rgba(255,255,255,0.04)
                            !important;
                        color: var(--sfux-text-primary) !important;
                        font-family:
                            "Titillium Web", Arial, sans-serif !important;
                        font-size: 13px !important;
                        font-weight: 600 !important;
                        line-height: 1.3 !important;
                        white-space: pre-line !important;
                        text-align: left !important;
                        pointer-events: none !important;
                    }


                    @media (min-width: ${BREAKPOINT + 1}px) {
                        #advisor-dock.${CONTEXT_ROW_CLASS} {
                            display: grid !important;
                            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
                            grid-template-rows:
                                28px
                                var(--sfgu-context-body-height, 220px) !important;
                            align-items: stretch !important;
                            gap: 0 12px !important;
                            height:
                                var(--sfgu-context-total-height, 248px) !important;
                            min-height:
                                var(--sfgu-context-total-height, 248px) !important;
                            max-height:
                                var(--sfgu-context-total-height, 248px) !important;
                            overflow: visible !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .sfgu-context-header {
                            grid-column: 1 / -1 !important;
                            grid-row: 1 !important;
                            margin-bottom: 0 !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS} > .advisor-container {
                            grid-column: 1 !important;
                            grid-row: 2 !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS} > .dock-container {
                            grid-column: 2 !important;
                            grid-row: 2 !important;
                            display: flex !important;
                            flex-direction: column !important;
                            min-height: 0 !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS} > .advisor-container,
                        #advisor-dock.${CONTEXT_ROW_CLASS} > .dock-container {
                            float: none !important;
                            width: auto !important;
                            max-width: none !important;
                            height:
                                var(--sfgu-context-body-height, 220px) !important;
                            min-height: 0 !important;
                            max-height:
                                var(--sfgu-context-body-height, 220px) !important;
                            border-top: 0 !important;
                            overflow: hidden !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .dock-container #stardock-content,
                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .dock-container .minimap,
                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .dock-container .minimapships {
                            flex: 1 1 auto !important;
                            width: 100% !important;
                            height: 100% !important;
                            min-height: 0 !important;
                            max-height: 100% !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .dock-container .minimap {
                            box-sizing: border-box !important;
                            height: 100% !important;
                            max-height: 100% !important;
                        }
                    }

                    @media (max-width: ${BREAKPOINT}px) {
                        #advisor-dock.${CONTEXT_ROW_CLASS} {
                            display: block !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .sfgu-context-header {
                            display: flex !important;
                            align-items: center !important;
                            justify-content: center !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .sfgu-context-header .sfgu-context-label {
                            display: none !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .sfgu-context-header .sfgu-context-mobile-label {
                            display: flex !important;
                            align-items: center !important;
                            justify-content: center !important;
                            width: 100% !important;
                            min-height: 28px !important;
                            padding: 3px 34px 3px 10px !important;
                            color: var(--sfux-text-primary) !important;
                            font-size: 14px !important;
                            font-weight: 700 !important;
                            line-height: 1.1 !important;
                            text-align: center !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS} > .advisor-container,
                        #advisor-dock.${CONTEXT_ROW_CLASS} > .dock-container {
                            float: none !important;
                            width: 100% !important;
                            max-width: none !important;
                            border-top: 0 !important;
                            margin: 0 !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .dock-container {
                            margin-top: 8px !important;
                            border-top: 1px solid rgba(255,255,255,0.14) !important;
                        }

                        /*
                         * Mobile Advisor: own the internal layout instead of relying on
                         * StarFury's floated desktop structure. A two-column grid makes
                         * the panel genuinely content-sized and prevents stale native
                         * heights from creating dead space beneath short messages.
                         */
                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .advisor-container {
                            height: auto !important;
                            min-height: 0 !important;
                            max-height: none !important;
                            overflow: visible !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .advisor-container #advisor-content {
                            display: grid !important;
                            grid-template-columns: minmax(0, 1fr) auto !important;
                            grid-template-rows: auto !important;
                            align-items: start !important;
                            column-gap: 10px !important;
                            width: 100% !important;
                            height: auto !important;
                            min-height: 0 !important;
                            max-height: none !important;
                            margin: 0 !important;
                            padding: 9px 10px 8px !important;
                            overflow: visible !important;
                            box-sizing: border-box !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .advisor-container #advisor-content .advice {
                            grid-column: 1 !important;
                            grid-row: 1 !important;
                            float: none !important;
                            width: auto !important;
                            max-width: none !important;
                            min-width: 0 !important;
                            height: auto !important;
                            min-height: 0 !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            font-size: 14px !important;
                            line-height: 1.42 !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            > .advisor-container #advisor-content .advisorright {
                            grid-column: 2 !important;
                            grid-row: 1 !important;
                            float: none !important;
                            align-self: start !important;
                            width: clamp(100px, 25vw, 108px) !important;
                            min-width: 100px !important;
                            max-width: 108px !important;
                            height: auto !important;
                            margin: 0 3px 0 0 !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            .advice .sfgu-advisor-meta {
                            color: rgba(255,255,255,0.76) !important;
                        }

                        #advisor-dock.${CONTEXT_ROW_CLASS}
                            .advice .sfgu-advisor-meta .bold {
                            color: rgba(255,255,255,0.88) !important;
                        }
                    }


                    /* ================================================================
                       EMPIRE STATUS HUD
                       ================================================================ */

                    #statbar.sfgu-stat-hud {
                        display: block !important;
                        position: relative !important;
                        width: 100% !important;
                        height: auto !important;
                        min-height: 0 !important;
                        margin-left: 0 !important;
                        margin-right: 0 !important;
                        padding: 0 !important;
                        overflow: hidden !important;
                        border: 1px solid rgba(255,255,255,0.14) !important;
                        background: rgba(18,18,18,0.97) !important;
                        font-family: "Titillium Web", Arial, sans-serif !important;
                        font-variant-numeric: tabular-nums !important;
                    }

                    #statbar.sfgu-stat-hud,
                    #statbar.sfgu-stat-hud *,
                    #statbar.sfgu-stat-hud *::before,
                    #statbar.sfgu-stat-hud *::after {
                        box-sizing: border-box !important;
                    }

                    #statbar.sfgu-stat-hud > .sfgu-stat-source {
                        display: none !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-grid {
                        display: grid !important;
                        grid-template-columns: .68fr 1.03fr .78fr 1fr .9fr .86fr 1.32fr !important;
                        width: 100% !important;
                        min-width: 0 !important;
                        min-height: 34px !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: rgba(20,20,20,0.97) !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-cell {
                        display: flex !important;
                        flex-direction: column !important;
                        align-items: center !important;
                        justify-content: center !important;
                        gap: 1px !important;
                        min-width: 0 !important;
                        min-height: 34px !important;
                        margin: 0 !important;
                        padding: 2px 6px !important;
                        border: 0 !important;
                        border-right: 1px solid rgba(255,255,255,0.08) !important;
                        color: inherit !important;
                        background: transparent !important;
                        text-decoration: none !important;
                        overflow: hidden !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-cell:last-child {
                        border-right: 0 !important;
                    }

                    #statbar.sfgu-stat-hud a.sfgu-stat-cell:hover {
                        background: rgba(var(--sfux-info-rgb), 0.065) !important;
                    }

                    #statbar.sfgu-stat-hud a.sfgu-stat-cell:focus-visible {
                        position: relative !important;
                        z-index: 1 !important;
                        background: rgba(var(--sfux-info-rgb), 0.09) !important;
                        outline: 2px solid var(--sfux-info) !important;
                        outline-offset: -2px !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-label,
                    #statbar.sfgu-stat-hud .sfgu-stat-label-short {
                        display: block !important;
                        max-width: 100% !important;
                        color: rgba(255,255,255,0.72) !important;
                        font-size: 9.5px !important;
                        font-weight: 700 !important;
                        line-height: 1 !important;
                        letter-spacing: 0.045em !important;
                        text-align: center !important;
                        text-transform: uppercase !important;
                        white-space: nowrap !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-label-short {
                        display: none !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-value-line {
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        gap: 4px !important;
                        min-width: 0 !important;
                        max-width: 100% !important;
                        line-height: 1 !important;
                        white-space: nowrap !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-value-full,
                    #statbar.sfgu-stat-hud .sfgu-stat-value-compact {
                        display: block !important;
                        min-width: 0 !important;
                        max-width: 100% !important;
                        color: rgba(255,255,255,0.98) !important;
                        font-size: 13.5px !important;
                        font-weight: 700 !important;
                        line-height: 1 !important;
                        letter-spacing: 0 !important;
                        text-align: center !important;
                        white-space: nowrap !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-value-compact {
                        display: none !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-rank {
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        flex: 0 0 auto !important;
                        min-width: 24px !important;
                        height: 17px !important;
                        padding: 0 4px !important;
                        border: 1px solid rgba(255,255,255,0.20) !important;
                        border-radius: 2px !important;
                        color: rgba(255,255,255,0.84) !important;
                        background: rgba(255,255,255,0.045) !important;
                        font-size: 10.5px !important;
                        font-weight: 700 !important;
                        line-height: 1 !important;
                        letter-spacing: 0 !important;
                    }

                    #statbar.sfgu-stat-hud .sfgu-stat-cell.sfgu-stat-attention
                        .sfgu-stat-value-full,
                    #statbar.sfgu-stat-hud .sfgu-stat-cell.sfgu-stat-attention
                        .sfgu-stat-value-compact {
                        color: var(--sfux-info) !important;
                    }

                    @media (max-width: ${BREAKPOINT}px) {
                        #statbar.sfgu-stat-hud {
                            margin-top: 0 !important;
                            margin-bottom: 4px !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-grid {
                            grid-template-columns: .62fr .9fr .69fr .81fr .79fr .82fr 1.17fr !important;
                            min-height: 34px !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-cell {
                            min-height: 34px !important;
                            gap: 1px !important;
                            padding: 2px 2px !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-label {
                            display: none !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-label-short {
                            display: block !important;
                            font-size: 9px !important;
                            letter-spacing: 0.025em !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-value-full {
                            display: none !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-value-compact {
                            display: block !important;
                            font-size: 12px !important;
                            font-weight: 700 !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-value-line {
                            gap: 2px !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-rank {
                            min-width: 20px !important;
                            height: 16px !important;
                            padding: 0 3px !important;
                            font-size: 10px !important;
                            border-color: rgba(255,255,255,0.18) !important;
                        }
                    }

                    @media (max-width: ${SFUX.responsive.tinyHud}px) {
                        #statbar.sfgu-stat-hud .sfgu-stat-grid {
                            grid-template-columns: .58fr .91fr .68fr .8fr .79fr .8fr 1.2fr !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-cell {
                            padding-left: 1px !important;
                            padding-right: 1px !important;
                        }

                        /*
                         * Do not shrink typography below the accessible mobile baseline
                         * just to preserve the seven-column layout. Tighten spacing
                         * instead. If StarFury ever adds another stat, the layout should
                         * be redesigned rather than making text microscopic.
                         */
                        #statbar.sfgu-stat-hud .sfgu-stat-label-short {
                            font-size: 9px !important;
                            letter-spacing: 0 !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-value-compact {
                            font-size: 11.5px !important;
                        }

                        #statbar.sfgu-stat-hud .sfgu-stat-rank {
                            min-width: 18px !important;
                            padding-left: 2px !important;
                            padding-right: 2px !important;
                            font-size: 9.5px !important;
                        }
                    }


                    /*
                     * VERY NARROW PHONE HEADER
                     * ------------------------------------------------------------
                     * At <=460px, there is not enough horizontal room for the logo,
                     * empire switch, and clock to all retain useful visual weight.
                     * Hide only the logo and deliberately compact the header.
                     */
                    @media (max-width: ${SFUX.responsive.narrowHeader}px) {
                        .container > #header {
                            height: 56px !important;
                            min-height: 56px !important;
                            max-height: 56px !important;
                            padding: 8px 10px !important;
                            gap: 8px !important;
                        }

                        .container > #header .logo {
                            display: none !important;
                        }

                        .container > #header .help {
                            margin-left: auto !important;
                        }

                        .container > #header .help input[type="submit"],
                        .container > #header .help .helpMe,
                        .container > #header #headertext {
                            height: 36px !important;
                            min-height: 36px !important;
                            max-height: 36px !important;
                            margin: 0 !important;
                        }
                    }

                    @media (prefers-reduced-motion: reduce) {
                        #cssmenu.${NAV_CLASS} *,
                        #cssmenu.${NAV_CLASS} *::before,
                        #cssmenu.${NAV_CLASS} *::after {
                            transition: none !important;
                        }
                    }
                `); }

            /* ---------------------------------------------------------------------
             * MODULE: EMPIRE STATUS HUD
             * Reads native stat text, preserves exact values, and renders the compact
             * presentation. Keep STAT_DEFINITIONS as the single ordering/label map.
             * --------------------------------------------------------------------- */
            const STAT_DEFINITIONS = [
                { key: 'news', label: 'News', shortLabel: 'NEWS' },
                { key: 'credits', label: 'Credits', shortLabel: 'CR' },
                { key: 'power', label: 'Power', shortLabel: 'PWR' },
                { key: 'population', label: 'Population', shortLabel: 'POP' },
                { key: 'asteroids', label: 'Asteroids', shortLabel: 'AST' },
                { key: 'land', label: 'Land', shortLabel: 'LAND' },
                { key: 'networth', label: 'Networth', shortLabel: 'NW' }
            ];

            function normalizeStatKey(label) {
                return String(label || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '');
            }

            function numericValue(valueText) {
                const match = String(valueText || '').match(/-?[\d,]+(?:\.\d+)?/);
                if (!match) return null;

                const value = Number(match[0].replace(/,/g, ''));
                return Number.isFinite(value) ? value : null;
            }

            function trimCompact(value, maximumFractionDigits) {
                return value
                    .toFixed(maximumFractionDigits)
                    .replace(/\.0+$/, '')
                    .replace(/(\.\d*?)0+$/, '$1');
            }

            function compactNumber(valueText) {
                const value = numericValue(valueText);
                if (value === null) return String(valueText || '').trim();

                const absolute = Math.abs(value);
                const tiers = [
                    { threshold: 1e9, divisor: 1e9, suffix: 'B' },
                    { threshold: 1e6, divisor: 1e6, suffix: 'M' },
                    { threshold: 1e3, divisor: 1e3, suffix: 'K' }
                ];

                const tier = tiers.find(item => absolute >= item.threshold);
                if (!tier) {
                    return new Intl.NumberFormat('en-US', {
                        maximumFractionDigits: 0
                    }).format(value);
                }

                const scaled = value / tier.divisor;
                const scaledAbs = Math.abs(scaled);
                const digits = scaledAbs < 10 ? 2 : scaledAbs < 100 ? 1 : 0;
                return `${trimCompact(scaled, digits)}${tier.suffix}`;
            }

            function parseStatSources(statbar) {
                const values = new Map();

                const newsSource = statbar.querySelector('#newsCount');
                if (newsSource) {
                    const newsText = newsSource.textContent || '';
                    const newsValue = numericValue(newsText);
                    values.set('news', {
                        full: newsValue === null ? '0' : String(newsValue),
                        compact: newsValue === null ? '0' : String(newsValue),
                        numeric: newsValue ?? 0,
                        href: newsSource.closest('a')?.href || 'news.php'
                    });
                }

                for (const node of statbar.querySelectorAll(':scope > .stats')) {
                    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                    const separator = text.indexOf(':');
                    if (separator === -1) continue;

                    const label = text.slice(0, separator).trim();
                    let full = text.slice(separator + 1).trim();
                    const key = normalizeStatKey(label);

                    let rank = '';
                    if (key === 'networth') {
                        const rankMatch = full.match(/\[\s*#?\s*(\d+)\s*\]/i);
                        if (rankMatch) {
                            rank = `#${rankMatch[1]}`;
                            full = full.replace(rankMatch[0], '').trim();
                        }
                    }

                    values.set(key, {
                        full,
                        compact: compactNumber(full),
                        numeric: numericValue(full),
                        rank
                    });
                }

                return values;
            }

            function createStatCell(definition, data) {
                const cell = data?.href
                    ? ctx.element('a')
                    : ctx.element('div');

                cell.className = 'sfgu-stat-cell';
                cell.dataset.statKey = definition.key;

                if (data?.href) cell.href = data.href;
                if (definition.key === 'news' && (data?.numeric ?? 0) > 0) {
                    cell.classList.add('sfgu-stat-attention');
                }

                const exactValue = data?.full || 'not available';
                const rankText = data?.rank
                    ? `, universe rank ${data.rank.replace('#', '')}`
                    : '';
                const accessibleText = `${definition.label}: ${exactValue}${rankText}`;

                cell.setAttribute('aria-label', accessibleText);
                cell.setAttribute('title', accessibleText);

                const fullLabel = ctx.element('span');
                fullLabel.className = 'sfgu-stat-label';
                fullLabel.textContent = definition.label;

                const shortLabel = ctx.element('span');
                shortLabel.className = 'sfgu-stat-label-short';
                shortLabel.textContent = definition.shortLabel;

                const valueLine = ctx.element('span');
                valueLine.className = 'sfgu-stat-value-line';

                const fullValue = ctx.element('span');
                fullValue.className = 'sfgu-stat-value-full';
                fullValue.textContent = data?.full || '—';

                const compactValue = ctx.element('span');
                compactValue.className = 'sfgu-stat-value-compact';
                compactValue.textContent = data?.compact || '—';

                valueLine.append(fullValue, compactValue);

                if (data?.rank) {
                    const rank = ctx.element('span');
                    rank.className = 'sfgu-stat-rank';
                    rank.textContent = data.rank.replace(/^#\s*/, '');
                    valueLine.appendChild(rank);
                }

                cell.append(fullLabel, shortLabel, valueLine);
                return cell;
            }

            function renderStatHud(statbar) {
                const sourceValues = parseStatSources(statbar);
                if (sourceValues.size < 2) return false;

                let grid = statbar.querySelector(':scope > .sfgu-stat-grid');
                if (!grid) {
                    grid = ctx.element('div');
                    grid.className = 'sfgu-stat-grid';
                    statbar.appendChild(grid);
                }

                grid.replaceChildren();

                for (const definition of STAT_DEFINITIONS) {
                    const data = sourceValues.get(definition.key);
                    grid.appendChild(createStatCell(definition, data));
                }

                return true;
            }

            function initializeStatHud() {
                const statbar = document.querySelector('#statbar');
                if (!statbar || statbar.dataset.sfguStatInitialized === 'true') {
                    return Boolean(statbar);
                }

                const sourceElements = Array.from(statbar.children).filter(
                    element => !element.classList.contains('sfgu-stat-grid')
                );

                if (!sourceElements.length) return false;

                statbar.dataset.sfguStatInitialized = 'true';
                statbar.classList.add(STAT_HUD_CLASS);

                for (const element of sourceElements) {
                    element.classList.add('sfgu-stat-source');
                }

                if (!renderStatHud(statbar)) {
                    statbar.classList.remove(STAT_HUD_CLASS);
                    delete statbar.dataset.sfguStatInitialized;
                    for (const element of sourceElements) {
                        element.classList.remove('sfgu-stat-source');
                    }
                    return false;
                }

                let syncQueued = false;
                const sourceObserver = ctx.observer(mutations => {
                    const sourceChanged = mutations.some(mutation => {
                        const target = mutation.target instanceof Element
                            ? mutation.target
                            : mutation.target.parentElement;
                        return target && !target.closest('.sfgu-stat-grid');
                    });

                    if (!sourceChanged || syncQueued) return;
                    syncQueued = true;

                    ctx.raf(() => {
                        syncQueued = false;
                        renderStatHud(statbar);
                    });
                });

                for (const source of sourceElements) {
                    sourceObserver.observe(source, {
                        childList: true,
                        subtree: true,
                        characterData: true
                    });
                }

                return true;
            }

            /* ---------------------------------------------------------------------
             * MODULE: ADVISOR + COMPACT STAR DOCK
             * Everything from here through initializeContextRow() is presentation and
             * interaction for the shared global context row.
             * --------------------------------------------------------------------- */
            function backgroundImageIsPresent(element) {
                if (!element) return false;

                const value = window.getComputedStyle(element).backgroundImage;
                return Boolean(
                    value &&
                    value !== 'none' &&
                    value !== 'initial' &&
                    value !== 'unset'
                );
            }

            function ensureDockStarfield(contextRow) {
                const minimap = contextRow.querySelector('.minimap');
                if (!minimap) return;

                /*
                 * Detect native StarFury imagery before adding our fallback class.
                 * Check both the minimap itself and the immediate ship layer because
                 * StarFury themes can place the background on either element.
                 */
                minimap.classList.remove(STARFIELD_FALLBACK_CLASS);

                const shipLayer = minimap.querySelector('.minimapships');
                const nativeBackground =
                    backgroundImageIsPresent(minimap) ||
                    backgroundImageIsPresent(shipLayer);

                if (!nativeBackground) {
                    minimap.classList.add(STARFIELD_FALLBACK_CLASS);
                    minimap.dataset.sfguStarfield = 'fallback';
                } else {
                    minimap.dataset.sfguStarfield = 'native';
                }
            }

            function getDockStatusIndicator(link) {
                if (!link) return null;

                const lines = getDockTooltipText(link)
                    .split('\n')
                    .map(part => part.trim())
                    .filter(Boolean);

                const statusIcon = link.querySelector('img.statusIcon');
                const statusLine = lines[1] || statusIcon?.alt?.trim() || '';

                const timedMatch = statusLine.match(
                    /^(.+?)\s*\(\s*(\d+)\s*(?:ticks?|t)?\s*\)\s*$/i
                );

                if (timedMatch) {
                    const ticks = Number(timedMatch[2]);

                    return {
                        label: timedMatch[1].trim(),
                        display: String(ticks),
                        ticks,
                        kind: 'timed'
                    };
                }

                if (/^disabled\b/i.test(statusLine)) {
                    return {
                        label: 'Disabled',
                        display: 'D',
                        ticks: null,
                        kind: 'state'
                    };
                }

                if (/^explor/i.test(statusLine)) {
                    return {
                        label: statusLine,
                        display: 'E',
                        ticks: null,
                        kind: 'state'
                    };
                }

                return null;
            }

            function getDockStatusVisuals(statusLabel) {
                const key = String(statusLabel || '').toLowerCase();

                if (key.includes('return')) {
                    return {
                        color: '#ff3b52',
                        background: 'rgba(185,24,45,0.94)',
                        border: 'rgba(255,116,132,0.96)',
                        glow: 'rgba(255,59,82,0.48)'
                    };
                }

                if (key.includes('build')) {
                    return {
                        color: '#ff981f',
                        background: 'rgba(174,88,7,0.95)',
                        border: 'rgba(255,179,79,0.96)',
                        glow: 'rgba(255,152,31,0.46)'
                    };
                }

                if (key.includes('upgrad')) {
                    return {
                        color: '#2d9cff',
                        background: 'rgba(17,91,160,0.95)',
                        border: 'rgba(112,190,255,0.96)',
                        glow: 'rgba(45,156,255,0.48)'
                    };
                }

                if (key.includes('disable')) {
                    return {
                        color: '#eef1f5',
                        background: 'rgba(72,78,86,0.96)',
                        border: 'rgba(174,182,192,0.96)',
                        glow: 'rgba(185,193,203,0.30)'
                    };
                }

                if (key.includes('explor')) {
                    return {
                        color: '#dfffe5',
                        background: 'rgba(27,118,54,0.95)',
                        border: 'rgba(113,226,137,0.96)',
                        glow: 'rgba(73,211,104,0.42)'
                    };
                }

                if (key.includes('repair')) {
                    return {
                        color: '#f2cf62',
                        background: 'rgba(132,104,25,0.95)',
                        border: 'rgba(255,224,121,0.96)',
                        glow: 'rgba(242,207,98,0.42)'
                    };
                }

                return {
                    color: '#f4f6f8',
                    background: 'rgba(48,52,57,0.95)',
                    border: 'rgba(232,236,240,0.90)',
                    glow: 'rgba(244,246,248,0.28)'
                };
            }

            function renderDockStatusCountdown(avatar, scale = 1) {
                if (!avatar) return;

                const item = avatar.closest('li');
                const link = avatar.querySelector('a[href*="viewship.php"]');
                const statusIcon = avatar.querySelector('img.statusIcon');
                const statusIndicator = getDockStatusIndicator(link);
                let countdown = item?.querySelector(`.${DOCK_COUNTDOWN_CLASS}`);

                if (!statusIcon || !statusIndicator || !item) {
                    statusIcon?.classList.remove(DOCK_STATUS_REPLACED_CLASS);
                    countdown?.remove();
                    return;
                }

                statusIcon.classList.add(DOCK_STATUS_REPLACED_CLASS);

                if (!countdown) {
                    countdown = ctx.element('span');
                    countdown.className = DOCK_COUNTDOWN_CLASS;
                    countdown.setAttribute('aria-hidden', 'true');
                    item.appendChild(countdown);
                }

                const visuals = getDockStatusVisuals(statusIndicator.label);
                const safeScale = Math.max(0.64, Math.min(1, Number(scale) || 1));
                const fontSize = Math.max(13, Math.round(17 * safeScale));
                const chipHeight = Math.max(18, Math.round(23 * safeScale));
                const chipPad = Math.max(4, Math.round(6 * safeScale));

                SFUX.dom.setText(countdown, statusIndicator.display);
                countdown.dataset.sfguStatus = statusIndicator.label;
                countdown.dataset.sfguKind = statusIndicator.kind;
                if (statusIndicator.ticks == null) {
                    delete countdown.dataset.sfguTicks;
                } else {
                    countdown.dataset.sfguTicks = String(statusIndicator.ticks);
                }
                countdown.style.setProperty(
                    '--sfgu-status-color',
                    visuals.color
                );
                countdown.style.setProperty(
                    '--sfgu-status-bg',
                    visuals.background
                );
                countdown.style.setProperty(
                    '--sfgu-status-border',
                    visuals.border
                );
                countdown.style.setProperty(
                    '--sfgu-status-glow',
                    visuals.glow
                );
                countdown.style.setProperty(
                    '--sfgu-status-size',
                    `${fontSize}px`
                );
                countdown.style.setProperty(
                    '--sfgu-status-chip-height',
                    `${chipHeight}px`
                );
                countdown.style.setProperty(
                    '--sfgu-status-chip-pad',
                    `${chipPad}px`
                );
            }

            function layoutMinimapShips(contextRow) {
                const minimap = contextRow.querySelector('.minimap');
                const list = minimap?.querySelector('.minimapships > ul');
                if (!minimap || !list) return;

                const items = Array.from(list.children).filter(
                    child => child.matches('li')
                );

                if (!items.length) return;

                const minimapRect = minimap.getBoundingClientRect();
                if (minimapRect.width < 1 || minimapRect.height < 1) return;

                /*
                 * Keep the dock spatially stable.
                 *
                 * Five columns is StarFury's native visual language and gives us a
                 * predictable 5 x 5 maximum for 25 ships. On genuinely tiny screens,
                 * four columns avoids crushing the ship/status art.
                 */
                const columns = minimapRect.width < 340 ? 4 : 5;
                const actualRows = Math.ceil(items.length / columns);

                /*
                 * Small fleets used to occupy all available vertical space, which made
                 * a 5-9 ship empire look oversized compared with a 20-25 ship empire.
                 * Reserve a little empty grid space and center the occupied rows.
                 */
                let visualRows = actualRows;

                if (items.length <= columns) {
                    visualRows = Math.max(actualRows, 2);
                } else if (items.length <= columns * 2) {
                    visualRows = Math.max(actualRows, 3);
                }

                const usableWidth = Math.max(1, minimapRect.width - 6);
                const usableHeight = Math.max(1, minimapRect.height - 6);
                const cellWidth = usableWidth / columns;
                const cellHeight = usableHeight / visualRows;
                const basis = 100 / columns;

                const finalRowCount = items.length % columns || columns;
                const finalRowStart = items.length - finalRowCount;
                const finalRowOffset =
                    finalRowCount < columns
                        ? ((columns - finalRowCount) * basis) / 2
                        : 0;

                const roleMap = {
                    '1': {
                        className: 'sfgu-role-attack',
                        label: 'Attack'
                    },
                    '2': {
                        className: 'sfgu-role-defence',
                        label: 'Defence'
                    },
                    '3': {
                        className: 'sfgu-role-raider',
                        label: 'Raider'
                    },
                    '4': {
                        className: 'sfgu-role-leecher',
                        label: 'Leecher'
                    },
                    '6': {
                        className: 'sfgu-role-building',
                        label: 'Building'
                    }
                };

                const roleClasses = [
                    'sfgu-role-attack',
                    'sfgu-role-defence',
                    'sfgu-role-raider',
                    'sfgu-role-leecher',
                    'sfgu-role-building'
                ];

                for (let index = 0; index < items.length; index += 1) {
                    const item = items[index];
                    const avatar = item.querySelector('.shipAvatar');
                    if (!avatar) continue;

                    item.classList.remove(...roleClasses);
                    item.style.removeProperty('margin-left');

                    /*
                     * StarFury exposes the dock/role as the shipRoleIcon alt value.
                     * The original badge remains in the DOM but is visually replaced by
                     * a translucent slot tint, preserving the game's own data model.
                     */
                    const roleIcon = avatar.querySelector('img.shipRoleIcon');
                    const roleValue = roleIcon?.getAttribute('alt')?.trim() || '';
                    const role = roleMap[roleValue];

                    if (role) {
                        item.classList.add(role.className);
                        item.dataset.sfguRole = role.label;

                        const link = avatar.querySelector(
                            'a[href*="viewship.php"]'
                        );
                        if (link) {
                            link.dataset.sfguRoleLabel = role.label;
                        }
                    } else {
                        delete item.dataset.sfguRole;
                    }

                    item.style.setProperty(
                        'flex',
                        `0 0 ${basis}%`,
                        'important'
                    );
                    item.style.setProperty(
                        'height',
                        `${100 / visualRows}%`,
                        'important'
                    );

                    /*
                     * Center an incomplete final row rather than stretching its ships
                     * wider than every previous row.
                     */
                    if (
                        index === finalRowStart &&
                        finalRowOffset > 0
                    ) {
                        item.style.setProperty(
                            'margin-left',
                            `${finalRowOffset}%`,
                            'important'
                        );
                    }

                    /*
                     * Capture StarFury's native avatar dimensions only once. Subsequent
                     * responsive passes always calculate from the original geometry.
                     */
                    let nativeWidth = Number(avatar.dataset.sfguNativeWidth || 0);
                    let nativeHeight = Number(avatar.dataset.sfguNativeHeight || 0);

                    if (!nativeWidth || !nativeHeight) {
                        const rect = avatar.getBoundingClientRect();
                        nativeWidth = Math.max(1, rect.width);
                        nativeHeight = Math.max(1, rect.height);

                        avatar.dataset.sfguNativeWidth = String(nativeWidth);
                        avatar.dataset.sfguNativeHeight = String(nativeHeight);

                        /*
                         * Status banners remain real StarFury DOM elements. Capture
                         * their native geometry before resizing the avatar.
                         *
                         * shipRoleIcon is intentionally excluded here because v0.3.5
                         * replaces it visually with the role tint.
                         */
                        for (const badge of avatar.querySelectorAll(
                            'img.statusIcon'
                        )) {
                            const badgeRect = badge.getBoundingClientRect();
                            const avatarRect = avatar.getBoundingClientRect();
                            const style = window.getComputedStyle(badge);

                            badge.dataset.sfguNativeWidth =
                                String(Math.max(1, badgeRect.width));
                            badge.dataset.sfguNativeHeight =
                                String(Math.max(1, badgeRect.height));
                            badge.dataset.sfguNativeLeft =
                                String(badgeRect.left - avatarRect.left);
                            badge.dataset.sfguNativeTop =
                                String(badgeRect.top - avatarRect.top);
                            badge.dataset.sfguNativePosition = style.position || '';
                        }
                    }

                    const horizontalPadding = 8;
                    const verticalPadding = 6;

                    const widthScale = Math.max(
                        0.18,
                        (cellWidth - horizontalPadding) / nativeWidth
                    );
                    const heightScale = Math.max(
                        0.18,
                        (cellHeight - verticalPadding) / nativeHeight
                    );

                    /*
                     * Never enlarge above StarFury's native art size. Density only ever
                     * causes a downscale.
                     */
                    const scale = Math.min(1, widthScale, heightScale);

                    const targetWidth = Math.max(
                        24,
                        Math.floor(nativeWidth * scale)
                    );
                    const targetHeight = Math.max(
                        18,
                        Math.floor(nativeHeight * scale)
                    );

                    avatar.style.setProperty(
                        'width',
                        `${targetWidth}px`,
                        'important'
                    );
                    avatar.style.setProperty(
                        'height',
                        `${targetHeight}px`,
                        'important'
                    );
                    avatar.style.setProperty(
                        'background-size',
                        'contain',
                        'important'
                    );

                    /*
                     * Resize only the native status banner. Role identity now comes from
                     * the translucent slot background.
                     */
                    for (const badge of avatar.querySelectorAll(
                        'img.statusIcon'
                    )) {
                        const badgeWidth = Number(
                            badge.dataset.sfguNativeWidth || badge.width || 1
                        );
                        const badgeHeight = Number(
                            badge.dataset.sfguNativeHeight || badge.height || 1
                        );
                        const badgeLeft = Number(
                            badge.dataset.sfguNativeLeft || 0
                        );
                        const badgeTop = Number(
                            badge.dataset.sfguNativeTop || 0
                        );

                        badge.style.setProperty(
                            'width',
                            `${Math.max(12, Math.round(badgeWidth * scale))}px`,
                            'important'
                        );
                        badge.style.setProperty(
                            'height',
                            `${Math.max(8, Math.round(badgeHeight * scale))}px`,
                            'important'
                        );

                        if (
                            badge.dataset.sfguNativePosition === 'absolute' ||
                            badge.dataset.sfguNativePosition === 'relative'
                        ) {
                            badge.style.setProperty(
                                'left',
                                `${Math.round(badgeLeft * scale)}px`,
                                'important'
                            );
                            badge.style.setProperty(
                                'top',
                                `${Math.round(badgeTop * scale)}px`,
                                'important'
                            );
                        }
                    }

                    renderDockStatusCountdown(avatar, scale);
                }

                list.dataset.sfguColumns = String(columns);
                list.dataset.sfguRows = String(actualRows);
                list.dataset.sfguVisualRows = String(visualRows);
                list.style.setProperty('overflow', 'visible', 'important');
                list.style.setProperty('align-content', 'center', 'important');
            }


            function ensureDockTooltipElement() {
                let tooltip = document.getElementById(DOCK_TOOLTIP_ID);
                if (tooltip) return tooltip;

                tooltip = ctx.element('div');
                tooltip.id = DOCK_TOOLTIP_ID;
                tooltip.setAttribute('role', 'tooltip');
                tooltip.setAttribute('aria-hidden', 'true');
                document.body.appendChild(tooltip);
                return tooltip;
            }

            function getDockTooltipText(link) {
                return (link?.getAttribute('data-tooltip') || '')
                    .replace(/&#010;/gi, '\n')
                    .replace(/\r/g, '')
                    .split('\n')
                    .map(part => part.trim())
                    .filter(Boolean)
                    .join('\n');
            }

            function positionDockTooltip(tooltip, anchor) {
                if (!tooltip || !anchor) return;

                const margin = 8;
                const gap = 9;
                const anchorRect = anchor.getBoundingClientRect();
                const tooltipRect = tooltip.getBoundingClientRect();

                let left =
                    anchorRect.left +
                    (anchorRect.width / 2) -
                    (tooltipRect.width / 2);

                left = Math.max(
                    margin,
                    Math.min(
                        left,
                        window.innerWidth - tooltipRect.width - margin
                    )
                );

                const roomAbove = anchorRect.top - gap;
                const roomBelow =
                    window.innerHeight - anchorRect.bottom - gap;

                let top;

                if (
                    roomAbove >= tooltipRect.height + margin ||
                    roomAbove >= roomBelow
                ) {
                    top =
                        anchorRect.top -
                        tooltipRect.height -
                        gap;
                } else {
                    top = anchorRect.bottom + gap;
                }

                top = Math.max(
                    margin,
                    Math.min(
                        top,
                        window.innerHeight - tooltipRect.height - margin
                    )
                );

                tooltip.style.left = `${Math.round(left)}px`;
                tooltip.style.top = `${Math.round(top)}px`;
            }

            function showDockTooltip(link, slot) {
                const text = getDockTooltipText(link);
                if (!text) return;

                const tooltip = ensureDockTooltipElement();
                tooltip.textContent = text;
                tooltip.style.display = 'block';
                tooltip.setAttribute('aria-hidden', 'false');

                ctx.raf(() => {
                    positionDockTooltip(tooltip, slot || link);
                });
            }

            function hideDockTooltip() {
                const tooltip = document.getElementById(DOCK_TOOLTIP_ID);
                if (!tooltip) return;

                tooltip.style.display = 'none';
                tooltip.setAttribute('aria-hidden', 'true');
            }

            function initializeDockShipInteractions(contextRow) {
                if (!contextRow) return;

                const slots = contextRow.querySelectorAll(
                    '.minimapships > ul > li'
                );

                for (const slot of slots) {
                    const link = slot.querySelector(
                        'a[href*="viewship.php"]'
                    );
                    if (!link) continue;

                    slot.classList.add(DOCK_CLICKABLE_CLASS);

                    /*
                     * Keep StarFury's data-tooltip payload as the source, but disable
                     * its dock-only CSS tooltip classes so we don't render two tooltips.
                     */
                    link.classList.remove(
                        'tooltip',
                        'tooltip-top',
                        'tooltip-bottom',
                        'tooltip-left',
                        'tooltip-right'
                    );

                    if (slot.dataset.sfguDockInteractionBound === 'true') {
                        continue;
                    }

                    slot.dataset.sfguDockInteractionBound = 'true';

                    ctx.on(slot, 'mouseenter', () => {
                        showDockTooltip(link, slot);
                    });

                    ctx.on(slot, 'mouseleave', hideDockTooltip);

                    ctx.on(link, 'focus', () => {
                        showDockTooltip(link, slot);
                    });

                    ctx.on(link, 'blur', hideDockTooltip);

                    /*
                     * Any otherwise-unused area of the colored slot navigates to the
                     * same ship. Clicking the original <a> remains fully native.
                     */
                    ctx.on(slot, 'click', event => {
                        if (event.defaultPrevented) return;

                        if (event.target.closest('a[href]')) {
                            return;
                        }

                        hideDockTooltip();
                        window.location.href = link.href;
                    });
                }
            }


            function improveMinimapAccessibility(contextRow) {
                const links = contextRow.querySelectorAll(
                    '.minimapships a[href*="viewship.php"]'
                );

                for (const link of links) {
                    if (link.hasAttribute('aria-label')) continue;

                    const tooltip = (link.getAttribute('data-tooltip') || '')
                        .replace(/&#010;/gi, '\n')
                        .replace(/\r/g, '')
                        .split('\n')
                        .map(part => part.trim())
                        .filter(Boolean);

                    if (tooltip.length) {
                        const [shipClass, status] = tooltip;
                        const pieces = ['Ship'];
                        if (shipClass) pieces.push(shipClass);

                        const role = link.dataset.sfguRoleLabel;
                        if (role) pieces.push(`${role} dock`);

                        if (status) pieces.push(status);
                        link.setAttribute('aria-label', pieces.join(', '));
                        continue;
                    }

                    const shipImage = link.querySelector('img[alt]');
                    const fallback = shipImage?.getAttribute('alt')?.trim();
                    if (fallback) {
                        link.setAttribute('aria-label', `Ship, ${fallback}`);
                    }
                }
            }






            function improveAdvisorInformation(contextRow) {
                const advice = contextRow?.querySelector(
                    '.advisor-container .advice'
                );
                if (!advice) return;

                const paragraphs = advice.querySelectorAll('p');

                for (const paragraph of paragraphs) {
                    const normalized = paragraph.textContent
                        .replace(/\s+/g, ' ')
                        .trim();

                    /*
                     * The word "Current" carries no information here and makes the
                     * identity/status block harder to scan on narrow screens.
                     */
                    if (/^Current\s+Global Rank:/i.test(normalized)) {
                        for (const node of paragraph.childNodes) {
                            if (
                                node.nodeType === Node.TEXT_NODE &&
                                /Current\s+/i.test(node.nodeValue || '')
                            ) {
                                node.nodeValue = (node.nodeValue || '')
                                    .replace(/Current\s+/i, '');
                                break;
                            }
                        }
                    }

                    /*
                     * These lines are useful but transient. Mark them for a quieter
                     * visual treatment rather than hiding or rewriting their values.
                     */
                    const refreshed = paragraph.textContent
                        .replace(/\s+/g, ' ')
                        .trim();

                    if (
                        /last visited:/i.test(refreshed) ||
                        /you have\s+\d+\s+new messages?/i.test(refreshed)
                    ) {
                        paragraph.classList.add('sfgu-advisor-meta');
                    }
                }
            }


            function captureNativeContextHeight(contextRow) {
                if (!contextRow) return;

                /*
                 * Measure before CONTEXT_ROW_CLASS is added. This gives us StarFury's
                 * actual expanded panel height on the current page/theme. The unified
                 * block is then forbidden from becoming taller than that baseline.
                 */
                const advisor = contextRow.querySelector('.advisor-container');
                const dock = contextRow.querySelector('.dock-container');

                const heights = [advisor, dock]
                    .filter(Boolean)
                    .map(element => element.getBoundingClientRect().height)
                    .filter(height => Number.isFinite(height) && height > 40);

                if (!heights.length) return;

                const nativeTotalHeight = Math.max(...heights);

                const nativeHeader =
                    advisor?.querySelector(':scope > .content-toggle') ||
                    dock?.querySelector(':scope > .content-toggle');

                const nativeHeaderHeight = Math.max(
                    24,
                    Math.round(
                        nativeHeader?.getBoundingClientRect().height || 28
                    )
                );

                /*
                 * Our shared header is fixed at 28px. Give every remaining pixel back to
                 * the body so the new combined component equals, rather than exceeds,
                 * the old native panel height.
                 */
                const sharedHeaderHeight = 28;
                const bodyHeight = Math.max(
                    120,
                    Math.round(nativeTotalHeight - sharedHeaderHeight)
                );

                contextRow.style.setProperty(
                    '--sfgu-context-total-height',
                    `${Math.round(nativeTotalHeight)}px`
                );
                contextRow.style.setProperty(
                    '--sfgu-context-body-height',
                    `${bodyHeight}px`
                );
                contextRow.dataset.sfguNativeContextHeight =
                    String(Math.round(nativeTotalHeight));
                contextRow.dataset.sfguNativeHeaderHeight =
                    String(nativeHeaderHeight);
            }


            function initializeUnifiedContextHeader(contextRow) {
                if (!contextRow) return;

                let header = contextRow.querySelector(':scope > .sfgu-context-header');

                if (!header) {
                    header = ctx.element('div');
                    header.className = 'sfgu-context-header';

                    const advisorLabel = ctx.element('div');
                    advisorLabel.className = 'sfgu-context-label';
                    advisorLabel.textContent = 'Advisor';

                    const dockLabel = ctx.element('div');
                    dockLabel.className = 'sfgu-context-label';
                    dockLabel.textContent = 'Star Dock';

                    const mobileLabel = ctx.element('div');
                    mobileLabel.className = 'sfgu-context-mobile-label';
                    mobileLabel.textContent = 'Advisor + Star Dock';

                    const toggle = ctx.element('button');
                    toggle.type = 'button';
                    toggle.className = 'sfgu-context-toggle';
                    toggle.setAttribute('aria-expanded', 'true');
                    toggle.setAttribute(
                        'aria-label',
                        'Collapse Advisor and Star Dock'
                    );

                    const icon = ctx.element('span');
                    icon.className = 'fa fa-compress';
                    icon.setAttribute('aria-hidden', 'true');

                    toggle.appendChild(icon);
                    header.append(advisorLabel, dockLabel, mobileLabel, toggle);
                    contextRow.prepend(header);

                    ctx.on(toggle, 'click', () => {
                        const collapsed = contextRow.classList.toggle(
                            'sfgu-context-collapsed'
                        );

                        toggle.setAttribute(
                            'aria-expanded',
                            collapsed ? 'false' : 'true'
                        );
                        toggle.setAttribute(
                            'aria-label',
                            collapsed
                                ? 'Expand Advisor and Star Dock'
                                : 'Collapse Advisor and Star Dock'
                        );

                        icon.classList.toggle('fa-compress', !collapsed);
                        icon.classList.toggle('fa-expand', collapsed);

                        if (!collapsed) {
                            ctx.raf(() => {
                                ensureDockStarfield(contextRow);
                                layoutMinimapShips(contextRow);
                            });
                        }
                    });
                }

                /*
                 * The new group control is authoritative. Remove any stale collapsed
                 * class left by partial script reloads and ensure its ARIA state agrees.
                 */
                const toggle = header.querySelector('.sfgu-context-toggle');
                const collapsed = contextRow.classList.contains(
                    'sfgu-context-collapsed'
                );

                if (toggle) {
                    toggle.setAttribute(
                        'aria-expanded',
                        collapsed ? 'false' : 'true'
                    );
                }
            }


            function initializeContextRow() {
                const contextRow = document.querySelector('#advisor-dock');
                if (!contextRow) return false;

                if (contextRow.dataset.sfguContextInitialized === 'true') {
                    if (
                        !contextRow.style.getPropertyValue(
                            '--sfgu-context-total-height'
                        )
                    ) {
                        contextRow.style.setProperty(
                            '--sfgu-context-total-height',
                            '248px'
                        );
                        contextRow.style.setProperty(
                            '--sfgu-context-body-height',
                            '220px'
                        );
                    }

                    initializeUnifiedContextHeader(contextRow);
                    improveAdvisorInformation(contextRow);
                    ensureDockStarfield(contextRow);
                    layoutMinimapShips(contextRow);
                    improveMinimapAccessibility(contextRow);
                    initializeDockShipInteractions(contextRow);
                    return true;
                }

                captureNativeContextHeight(contextRow);

                contextRow.dataset.sfguContextInitialized = 'true';
                contextRow.classList.add(CONTEXT_ROW_CLASS);
                initializeUnifiedContextHeader(contextRow);
                improveAdvisorInformation(contextRow);

                const advisor = contextRow.querySelector('.advisor-container');
                const dock = contextRow.querySelector('.dock-container');

                if (advisor) {
                    advisor.setAttribute('role', 'region');
                    advisor.setAttribute('aria-label', 'Advisor');
                }

                if (dock) {
                    dock.setAttribute('role', 'region');
                    dock.setAttribute('aria-label', 'Star Dock');
                }

                ensureDockStarfield(contextRow);
                layoutMinimapShips(contextRow);
                improveMinimapAccessibility(contextRow);
                initializeDockShipInteractions(contextRow);

                /*
                 * The minimap contents can be rebuilt by native page logic. Watch only
                 * this small local subtree and re-apply accessibility/fallback handling
                 * when that happens. This observer is entirely client-side.
                 */
                const dockContent = contextRow.querySelector('#stardock-content');
                if (dockContent) {
                    let queued = false;
                    const observer = ctx.observer(mutations => {
                        if (!SFUX.observe.nativeDockChanges(mutations)) return;
                        if (queued) return;
                        queued = true;

                        ctx.raf(() => {
                            queued = false;
                            ensureDockStarfield(contextRow);
                            layoutMinimapShips(contextRow);
                            improveMinimapAccessibility(contextRow);
                            initializeDockShipInteractions(contextRow);
                        });
                    });

                    observer.observe(dockContent, {
                        childList: true, subtree: true, attributes: true,
                        attributeFilter: ['data-tooltip', 'alt', 'src']
                    });
                }

                /*
                 * Re-check after window load in case the native theme's image stylesheet
                 * resolves later than DOMContentLoaded. Native imagery replaces the
                 * procedural fallback automatically when detected.
                 */
                ctx.on(window, 'load', () => {
                    ensureDockStarfield(contextRow);
                    layoutMinimapShips(contextRow);
                    initializeDockShipInteractions(contextRow);
                }, { once: true });

                /*
                 * Reflow on actual panel-size changes, including responsive breakpoints
                 * and expanded/collapsed surrounding layout. ResizeObserver is local and
                 * performs no network activity.
                 */
                ctx.on(window, 'scroll', hideDockTooltip, {
                    passive: true
                });
                ctx.on(window, 'resize', hideDockTooltip, {
                    passive: true
                });

                const minimap = contextRow.querySelector('.minimap');
                if (minimap && typeof ResizeObserver === 'function') {
                    let resizeQueued = false;
                    const resizeObserver = ctx.resizeObserver(() => {
                        if (resizeQueued) return;
                        resizeQueued = true;

                        ctx.raf(() => {
                            resizeQueued = false;
                            layoutMinimapShips(contextRow);
                        });
                    });

                    resizeObserver.observe(minimap);
                }

                return true;
            }

            /* ---------------------------------------------------------------------
             * MODULE: PRIMARY NAVIGATION
             * Desktop and mobile navigation behavior. Native hrefs remain untouched.
             * --------------------------------------------------------------------- */
            const normalizedPath = SFUX.dom.path;

            function markCurrentSection(nav) {
                const currentPath = normalizedPath(window.location.href);
                const topItems = Array.from(nav.querySelectorAll(':scope > ul > li'));

                for (const item of topItems) {
                    item.classList.remove('sfgu-current');

                    const links = Array.from(item.querySelectorAll('a[href]'));
                    const exactMatch = links.some(link => {
                        const href = link.getAttribute('href') || '';
                        if (!href || href === '#' || href.startsWith('javascript:')) return false;
                        return normalizedPath(link.href) === currentPath;
                    });

                    if (exactMatch) {
                        item.classList.add('sfgu-current');
                        return;
                    }
                }

                // StarFury pages that live within a section but are not directly present
                // in the primary navigation.
                const aliases = {
                    empire: [
                        '/buildings.php',
                        '/production.php',
                        '/techtree.php'
                    ],
                    military: [
                        '/stardock.php',
                        '/viewship.php',
                        '/ships.php',
                        '/defence.php',
                        '/exploration.php'
                    ],
                    'war room': [
                        '/attack.php',
                        '/bossbattle.php',
                        '/intel.php',
                        '/raid.php',
                        '/breakcalc.php'
                    ],
                    alliance: [
                        '/alliance.php',
                        '/astation.php',
                        '/forums.php'
                    ],
                    universe: [
                        '/browser.php',
                        '/leaders.php',
                        '/scores.php'
                    ],
                    comms: [
                        '/messages.php'
                    ],
                    options: [
                        '/reward.php',
                        '/preferences.php',
                        '/support.php'
                    ]
                };

                for (const item of topItems) {
                    const label = (item.querySelector(':scope > a')?.textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                    if (aliases[label]?.includes(currentPath)) {
                        item.classList.add('sfgu-current');
                        return;
                    }
                }
            }

            function setSubmenuState(item, expanded) {
                const toggle = item.querySelector(':scope > .sfgu-submenu-toggle');
                item.classList.toggle(SUBMENU_OPEN_CLASS, expanded);
                if (toggle) toggle.setAttribute('aria-expanded', String(expanded));
            }

            function collapseSiblingSubmenus(item) {
                const list = item.parentElement;
                if (!list) return;

                for (const sibling of list.children) {
                    if (sibling !== item && sibling.matches('li')) {
                        setSubmenuState(sibling, false);
                    }
                }
            }

            function addSubmenuControls(nav) {
                const topItems = Array.from(nav.querySelectorAll(':scope > ul > li'));

                for (const item of topItems) {
                    const submenu = item.querySelector(':scope > ul');
                    if (!submenu) continue;

                    item.classList.add('sfgu-has-submenu');

                    let toggle = item.querySelector(':scope > .sfgu-submenu-toggle');
                    if (!toggle) {
                        toggle = ctx.element('button');
                        toggle.type = 'button';
                        toggle.className = 'sfgu-submenu-toggle';
                        toggle.setAttribute('aria-label', 'Toggle submenu');
                        toggle.setAttribute('aria-expanded', 'false');

                        const arrow = ctx.element('span');
                        arrow.className = 'sfgu-submenu-arrow';
                        arrow.setAttribute('aria-hidden', 'true');
                        arrow.textContent = '▼';

                        toggle.appendChild(arrow);
                        item.insertBefore(toggle, submenu);
                    }

                    ctx.on(toggle, 'click', event => {
                        event.preventDefault();
                        event.stopPropagation();

                        const willOpen = !item.classList.contains(SUBMENU_OPEN_CLASS);
                        collapseSiblingSubmenus(item);
                        setSubmenuState(item, willOpen);
                    });

                    const primaryLink = item.querySelector(':scope > a');
                    const rawHref = primaryLink?.getAttribute('href')?.trim();

                    // StarFury uses "#" as a category label for most parents. On mobile,
                    // make those labels useful touch targets by expanding their submenu.
                    if (primaryLink && (!rawHref || rawHref === '#')) {
                        ctx.on(primaryLink, 'click', event => {
                            if (window.innerWidth > BREAKPOINT) return;

                            event.preventDefault();
                            event.stopImmediatePropagation();

                            const willOpen = !item.classList.contains(SUBMENU_OPEN_CLASS);
                            collapseSiblingSubmenus(item);
                            setSubmenuState(item, willOpen);
                        }, true);
                    }
                }
            }

            function prepareMenuButton(nav) {
                // StarFury's cssmenu-script creates its own #menu-button on DOM ready.
                // Remove every existing copy and create one fresh, owned control. This
                // also strips any native jQuery click handlers from the final button.
                for (const candidate of nav.querySelectorAll(':scope > #menu-button')) {
                    candidate.remove();
                }

                const button = ctx.element('div');
                button.id = 'menu-button';
                button.dataset.sfguOwned = 'true';
                nav.insertBefore(button, nav.firstElementChild);

                button.textContent = '';
                button.setAttribute('role', 'button');
                button.setAttribute('tabindex', '0');
                button.setAttribute('aria-controls', 'sfgu-primary-menu');
                button.setAttribute('aria-expanded', 'false');

                const label = ctx.element('span');
                label.className = 'sfgu-menu-label';
                label.textContent = 'Menu';

                const icon = ctx.element('span');
                icon.className = 'sfgu-hamburger';
                icon.setAttribute('aria-hidden', 'true');

                for (let i = 0; i < 3; i += 1) {
                    icon.appendChild(ctx.element('span'));
                }

                button.append(label, icon);

                const list = nav.querySelector(':scope > ul');
                if (list) list.id = 'sfgu-primary-menu';

                const toggleMenu = () => {
                    if (window.innerWidth > BREAKPOINT) return;

                    const willOpen = !nav.classList.contains(MOBILE_OPEN_CLASS);
                    nav.classList.toggle(MOBILE_OPEN_CLASS, willOpen);
                    button.setAttribute('aria-expanded', String(willOpen));

                    if (!willOpen) {
                        for (const item of nav.querySelectorAll(
                            `:scope > ul > li.${SUBMENU_OPEN_CLASS}`
                        )) {
                            setSubmenuState(item, false);
                        }
                    }
                };

                ctx.on(button, 'click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleMenu();
                });

                ctx.on(button, 'keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleMenu();
                    }
                });

                return button;
            }

            function getOwnedMenuButton(nav) {
                return nav.querySelector(
                    ':scope > #menu-button[data-sfgu-owned="true"]'
                );
            }

            function closeMobileMenu(nav) {
                nav.classList.remove(MOBILE_OPEN_CLASS);
                getOwnedMenuButton(nav)?.setAttribute('aria-expanded', 'false');

                for (const item of nav.querySelectorAll(
                    `:scope > ul > li.${SUBMENU_OPEN_CLASS}`
                )) {
                    setSubmenuState(item, false);
                }
            }

            function initializeNavigation() {
                const nav = document.querySelector('#cssmenu');
                if (!nav || nav.dataset.sfguInitialized === 'true') return;

                const topList = nav.querySelector(':scope > ul');
                if (!topList) return;

                nav.dataset.sfguInitialized = 'true';
                nav.classList.add(NAV_CLASS);

                // Native mobile state can survive a prior handler. Start from a known
                // state and let Global UX own mobile expansion.
                topList.classList.remove('open');

                injectStyles();
                addSubmenuControls(nav);
                markCurrentSection(nav);
                prepareMenuButton(nav);

                ctx.on(document, 'keydown', event => {
                    if (
                        event.key === 'Escape' &&
                        nav.classList.contains(MOBILE_OPEN_CLASS)
                    ) {
                        closeMobileMenu(nav);
                        getOwnedMenuButton(nav)?.focus();
                    }
                });

                ctx.on(document, 'click', event => {
                    if (
                        window.innerWidth <= BREAKPOINT &&
                        nav.classList.contains(MOBILE_OPEN_CLASS) &&
                        !nav.contains(event.target)
                    ) {
                        closeMobileMenu(nav);
                    }
                });

                let wasMobile = window.innerWidth <= BREAKPOINT;
                ctx.on(window, 'resize', () => {
                    const isMobile = window.innerWidth <= BREAKPOINT;

                    if (wasMobile !== isMobile) {
                        closeMobileMenu(nav);
                        wasMobile = isMobile;
                    }
                }, { passive: true });

                // Some versions of StarFury's cssmenu script can finish their DOM-ready
                // work a moment after ours. Watch briefly for a second native button.
                // If one appears, rebuild one clean owned button again.
                let repairing = false;
                const buttonObserver = ctx.observer(() => {
                    if (repairing) return;

                    const buttons = Array.from(
                        nav.querySelectorAll(':scope > #menu-button')
                    );
                    const ownedButtons = buttons.filter(
                        button => button.dataset.sfguOwned === 'true'
                    );

                    if (buttons.length === 1 && ownedButtons.length === 1) return;

                    repairing = true;
                    const wasOpen = nav.classList.contains(MOBILE_OPEN_CLASS);
                    prepareMenuButton(nav);

                    if (wasOpen) {
                        nav.classList.add(MOBILE_OPEN_CLASS);
                        getOwnedMenuButton(nav)?.setAttribute('aria-expanded', 'true');
                    }

                    repairing = false;
                });

                buttonObserver.observe(nav, {
                    childList: true
                });

                ctx.timeout(() => buttonObserver.disconnect(), 2500);
            }

            function prepareEarlyNavigationShell() {
                const nav = document.querySelector('#cssmenu');
                if (!nav) return false;

                nav.classList.add(NAV_CLASS);
                injectStyles();
                return true;
            }

            /* ---------------------------------------------------------------------
             * BOOTSTRAP
             * document-start compatible initialization. Observers exist to adapt this
             * reference userscript to StarFury's current page lifecycle; a native
             * integration should prefer explicit lifecycle hooks when available.
             * --------------------------------------------------------------------- */
            function start() {
                ctx.find('#cssmenu', prepareEarlyNavigationShell);
                ctx.ready(() => ctx.timeout(() => {
                    ctx.find('#cssmenu', initializeNavigation);
                    ctx.find('#statbar', initializeStatHud);
                    ctx.find('#advisor-dock', initializeContextRow);
                }, 60));
            }

            return { init() { return start(); }, destroy: ctx.destroy };
        }
    });
}

/* StarFury UX Suite 2.0.1 | Research Optimizer module. */
function registerResearchOptimizer(SFUX) {
    SFUX.register({
        id: 'research', phase: 'ready',
        matches(path, url) { return path === '/techtree.php'; },
        create(ctx) {
            const STYLE_ID = 'sf-research-optimizer-styles';

            const HIDE_COMPLETED_KEY = 'sfro-hide-completed';


            /*
             * Short summaries designed to fit on one line at StarFury's native page width.
             */
            const TECH_SUMMARIES = {
                'Population Tax I': '+1 credit / population / tick',
                'Population Tax II': '+1 more credit / population / tick',
                'Advanced Power I': '+50% Fusion Plant production',
                'Advanced Power II': '+50% Fusion output; +50 storage / plant',
                'Advanced Mines I': '+25 credits / Tri-Lithium Mine / tick',
                'Advanced Mines II': '+25 more credits / mine / tick',
                'Iridium Mines': 'Unlocks Iridium mining',
                'Advanced Buildings I': '-25% building construction time',
                'Advanced Buildings II': 'Further -25% building time',

                'Pulsar Technology': 'Unlocks medium Pulsar ships',
                'Particle Technology': 'Unlocks medium-large Particle ships',
                'Plasma Technology': 'Unlocks Plasma ships; conflicts with Probe Retention II',

                'Big Hammer I': '+15% scrap return; -15% ship build time',
                'Big Hammer II': '+20% scrap return; further -20% build time',
                'Build Dock Expansion': '+2 Build Dock slots',
                'Advanced Engines': '-25% return time; excludes Leecher Dock',
                'Repair Drones': 'Up to 40% faster repairs',
                'Speed Repair': '1-tick Defence repair; costs 20% original resources',
                'Transfer Drones': '-50% internal / Alliance Station transfer time',
                'Ship Salvage': 'Recover resources from destroyed Defending ships',

                'Fourth Leecher': 'Increases Leecher Dock ship limit',

                'Fabrication Plants': 'Unlocks probe production',
                'General Scan': 'Resources, probes & ships; no statuses',
                'Defence Scan': 'Defence docks, total defence, bonuses & platforms',
                'Full Dock Scan': 'All ships, docks & statuses; no total defence',
                'Stealth Scan': 'Defence-only scan; success stays hidden',

                'Advanced Fabrication Plants I': '+50% probe production',
                'Advanced Fabrication Plants II': '+50% of base probe production again',
                'Probe Loss Reduction I': '-50% probes lost on intelligence',
                'Probe Loss Reduction II': 'Further -50% probe losses',

                'Reinforced Intelligence I': 'Temporary +10% defensive probes',
                'Reinforced Intelligence II': 'Additional temporary +15% defensive probes',
                'Counter Combat': 'Capture probes from failed enemy scans',

                'Base Expansion': 'Respawn with 600 Land / 450 Asteroids',
                'Resource Bunker': 'Double standard respawn resources',
                'Raid Eagle': 'Respawn with extra Fixed Raid Eagle',
                'Probe Retention I': 'Retain 50% of probes on respawn',
                'Probe Retention II': 'Retain 75% of probes; conflicts with Plasma'
            };

            // ---------------------------------------------------------------------
            // Generic helpers
            // ---------------------------------------------------------------------
            const normalizeText = SFUX.dom.text;

            const parseNumber = SFUX.format.researchNumber;

            // ---------------------------------------------------------------------
            // Presentation layer
            // Userscript-only: native StarFury should move these rules to a stylesheet.
            // ---------------------------------------------------------------------
            function injectStyles() { ctx.style(STYLE_ID, `
                    /*
                     * IMPORTANT:
                     * Do NOT alter .container, #contentWide, or StarFury's native page width.
                     * Only the Tech Tree table itself is optimized.
                     */

                    .sfro-tech-table {
                        width: 100% !important;
                        table-layout: auto !important;
                        font-size: 14px !important;
                    }

                    .sfro-tech-table td {
                        box-sizing: border-box;
                        vertical-align: middle !important;
                    }

                    /*
                     * Content-aware columns.
                     *
                     * 1% + nowrap means "use only as much width as the content needs".
                     * Effect receives the remaining horizontal space.
                     */
                    .sfro-tech-table tr > td:nth-child(1) {
                        width: 1% !important;
                        white-space: nowrap !important;
                        text-align: center !important;
                    }

                    .sfro-tech-table tr > td:nth-child(2) {
                        width: 1% !important;
                        white-space: nowrap !important;
                    }

                    .sfro-tech-table tr > td:nth-child(3) {
                        width: auto !important;
                        white-space: nowrap !important;
                    }

                    .sfro-tech-table tr > td:nth-child(4) {
                        width: 1% !important;
                        white-space: nowrap !important;
                        text-align: center !important;
                    }

                    .sfro-tech-table tr > td:nth-child(5) {
                        width: 1% !important;
                        white-space: nowrap !important;
                        text-align: center !important;
                    }

                    .sfro-tech-table tr.sfro-tech-row > td {
                        height: 34px;
                        padding: 6px 8px !important;
                    }

                    .sfro-tech-table .tableheader {
                        padding: 7px 8px !important;
                        font-size: 14px !important;
                        font-weight: 700 !important;
                    }

                    /* Clear column labels without forcing equal-width columns. */
                    .sfro-column-head td {
                        position: sticky !important;
                        top: 0 !important;
                        z-index: 20 !important;
                        padding: 7px 8px !important;
                        background: rgba(38,42,46,0.98) !important;
                        border-top: 1px solid rgba(255,255,255,0.07) !important;
                        border-bottom: 1px solid rgba(109,148,176,0.30) !important;
                        box-shadow: 0 3px 6px rgba(0,0,0,0.34);
                        color: rgba(255,255,255,0.70) !important;
                        font-size: 12px !important;
                        font-weight: 700 !important;
                        letter-spacing: 0.04em;
                        text-transform: uppercase;
                        white-space: nowrap !important;
                    }

                    /*
                     * "Hide finished" collapses both:
                     *   - researched technologies
                     *   - terminal alternatives that are no longer researchable because
                     *     the section is Max Reached or the path is closed
                     *
                     * Section headers remain visible, so Complete / Max Reached
                     * still explains why the category has no visible rows.
                     */
                    .sfro-tech-table.sfro-hide-completed .sfro-completed,
                    .sfro-tech-table.sfro-hide-completed .sfro-terminal-locked {
                        display: none !important;
                    }

                    .sfro-completed-toggle {
                        display: inline-block;
                        margin-left: 8px;
                        padding: 2px 7px;
                        border: 1px solid rgba(255,255,255,0.13);
                        border-radius: 4px;
                        background: rgba(255,255,255,0.035);
                        color: rgba(255,255,255,0.72) !important;
                        font-size: 12px !important;
                        font-weight: 600;
                        line-height: 1.35;
                        text-decoration: none !important;
                        vertical-align: 1px;
                        cursor: pointer;
                        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
                    }

                    .sfro-completed-toggle:hover {
                        background: rgba(255,255,255,0.075);
                        border-color: rgba(255,255,255,0.22);
                        color: rgba(255,255,255,0.94) !important;
                    }

                    .sfro-completed-toggle.sfro-toggle-active {
                        border-color: rgba(var(--sfux-success-rgb), 0.28);
                        background: rgba(var(--sfux-success-rgb), 0.07);
                        color: rgba(var(--sfux-success-rgb), 0.92) !important;
                    }


                    /* Completed research */
                    .sfro-completed td {
                        background: rgba(57,166,83,0.060);
                    }

                    .sfro-completed td:nth-child(2) {
                        font-weight: 700 !important;
                        color: var(--sfux-success) !important;
                    }

                    .sfro-done-icon {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 17px;
                        height: 17px;
                        margin: 0 auto;
                        border: 1px solid rgba(var(--sfux-success-rgb), 0.66);
                        border-radius: 50%;
                        color: var(--sfux-success);
                        font-size: 11px;
                        font-weight: 700;
                        line-height: 1;
                        vertical-align: middle;
                    }

                    /*
                     * Section headers carry their own totals now. A subtle steel/blue-charcoal
                     * tint separates categories from the neutral row background without
                     * making the page look alien to StarFury.
                     */
                    .sfro-tech-table .tableheader {
                        padding: 8px 10px !important;
                        border-top: 2px solid rgba(109,148,176,0.30) !important;
                        border-bottom: 1px solid rgba(0,0,0,0.52) !important;
                        background: linear-gradient(
                            180deg,
                            rgba(68,88,104,0.34),
                            rgba(43,56,67,0.30)
                        ) !important;
                        box-shadow:
                            inset 0 1px 0 rgba(255,255,255,0.035),
                            0 -1px 0 rgba(0,0,0,0.28);
                        color: rgba(255,255,255,0.94) !important;
                        white-space: nowrap !important;
                    }

                    .sfro-section-header-inner {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 14px;
                        width: 100%;
                    }

                    .sfro-section-name {
                        min-width: 0;
                        font-size: 14px;
                        font-weight: 700;
                        color: rgba(255,255,255,0.95);
                        white-space: nowrap;
                    }

                    .sfro-section-meta {
                        flex: 0 0 auto;
                        font-size: 12.5px;
                        font-weight: 500;
                        color: rgba(255,255,255,0.68);
                        white-space: nowrap;
                    }

                    .sfro-section-meta-mobile {
                        display: none;
                    }

                    .sfro-section-meta-label {
                        color: rgba(255,255,255,0.58);
                    }

                    .sfro-section-meta-rp {
                        margin-left: 5px;
                        color: rgba(255,255,255,0.86);
                        font-weight: 700;
                    }

                    .sfro-section-meta-time {
                        margin-left: 7px;
                        color: rgba(var(--sfux-warning-rgb), 0.94);
                        font-weight: 700;
                    }

                    .sfro-section-complete-meta {
                        color: rgba(var(--sfux-success-rgb), 0.96);
                        font-weight: 700;
                    }

                    /*
                     * Terminal section states are unified:
                     *   - Complete when every row is researched
                     *   - Max Reached for any other valid terminal state
                     *
                     * Individual Path Closed alternatives remain amber.
                     */
                    .sfro-section-path-meta {
                        color: rgba(var(--sfux-success-rgb), 0.96);
                        font-weight: 700;
                    }

                    /*
                     * When a limited/path section is terminal, native Research/Queue
                     * actions are no longer meaningful. Preserve the row as historical
                     * context, but replace the action with an explicit terminal state.
                     */
                    .sfro-terminal-action {
                        display: inline-block;
                        font-size: 13px !important;
                        font-weight: 600;
                        white-space: nowrap;
                        cursor: default;
                        user-select: none;
                    }

                    .sfro-terminal-action-max {
                        color: rgba(var(--sfux-success-rgb), 0.58) !important;
                    }

                    .sfro-terminal-action-path {
                        color: rgba(var(--sfux-warning-rgb), 0.68) !important;
                    }

                    .sfro-terminal-locked td:nth-child(5) {
                        background: rgba(255,255,255,0.008);
                    }

                    /*
                     * Zero-RP research state
                     * -------------------------------------------------------------
                     * If the empire has 0 RP/t and no work in flight, Active Research
                     * + Research Queue collapse into one concise status card.
                     *
                     * If work does exist at 0 RP/t, the native sections remain visible
                     * and receive an explicit stalled badge instead.
                     */
                    .sfro-research-inactive-card {
                        margin: 8px 10px 14px;
                        padding: 12px 14px;
                        border: 1px solid rgba(113,160,183,0.34);
                        border-left: 3px solid rgba(113,160,183,0.72);
                        background:
                            linear-gradient(
                                180deg,
                                rgba(50,70,80,0.18),
                                rgba(20,24,28,0.14)
                            );
                    }

                    .sfro-research-inactive-title {
                        margin-bottom: 5px;
                        color: rgba(220,230,235,0.96);
                        font-size: 15px;
                        font-weight: 700;
                    }

                    .sfro-research-inactive-meta {
                        margin-bottom: 4px;
                        color: rgba(180,194,201,0.88);
                        font-size: 12px;
                        font-weight: 600;
                    }

                    .sfro-research-inactive-note {
                        color: rgba(157,169,176,0.86);
                        font-size: 12px;
                    }

                    .sfro-research-stalled-badge {
                        margin-left: 7px;
                        padding: 2px 6px;
                        border: 1px solid rgba(var(--sfux-warning-rgb), 0.30);
                        border-radius: var(--sfux-radius-sm);
                        background: rgba(var(--sfux-warning-rgb), 0.08);
                        color: rgba(var(--sfux-warning-rgb), 0.96);
                        font-size: 11px;
                        font-weight: 700;
                        white-space: nowrap;
                    }

                    .sfro-all-research-maxed {
                        display: inline-block;
                        margin-left: 8px;
                        padding: 2px 7px;
                        border: 1px solid rgba(var(--sfux-success-rgb), 0.32);
                        border-radius: 4px;
                        background: rgba(var(--sfux-success-rgb), 0.08);
                        color: rgba(var(--sfux-success-rgb), 0.96) !important;
                        font-size: 12px !important;
                        font-weight: 700;
                        line-height: 1.35;
                        vertical-align: 1px;
                        white-space: nowrap;
                    }

                    .sfro-completed .sfro-cost {
                        color: transparent !important;
                        font-size: 0 !important;
                        user-select: none;
                    }

                    .sfro-completed .sfro-cost::after {
                        content: "—";
                        color: rgba(255,255,255,0.22);
                        font-size: 15px;
                    }

                    .sfro-completed .sfro-remove {
                        opacity: 0.32;
                        transition: opacity 120ms ease;
                    }

                    .sfro-completed .sfro-remove:hover {
                        opacity: 1;
                    }

                    /* Current research */
                    .sfro-active td {
                        background: rgba(218,171,64,0.10) !important;
                    }

                    .sfro-active td:nth-child(2) {
                        color: var(--sfux-warning) !important;
                        font-weight: 700 !important;
                    }

                    /* Queued technology */
                    .sfro-queued td {
                        background: var(--sfux-warning-soft);
                    }

                    .sfro-queued td:nth-child(2) {
                        font-weight: 600;
                    }

                    /* Effect column */
                    .sfro-summary-cell {
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        color: rgba(255,255,255,0.74) !important;
                        text-align: left !important;
                    }

                    .sfro-completed .sfro-summary-cell {
                        color: rgba(174,210,183,0.68) !important;
                    }

                    .sfro-summary-text {
                        font-size: 13.5px !important;
                        vertical-align: middle;
                    }

                    .sfro-info-icon {
                        display: inline-block;
                        margin-left: 6px;
                        opacity: 0.68;
                        vertical-align: middle;
                        border: 0 !important;
                        border-bottom: 0 !important;
                        text-decoration: none !important;
                        box-shadow: none !important;
                        background-image: none !important;
                    }

                    .sfro-info-icon:hover,
                    .sfro-info-icon:focus,
                    .sfro-info-icon:active {
                        opacity: 1;
                        border: 0 !important;
                        border-bottom: 0 !important;
                        text-decoration: none !important;
                        box-shadow: none !important;
                        background-image: none !important;
                    }

                    .sfro-info-icon .mobile-hidden {
                        display: none !important;
                    }

                    /* RP + ETA */
                    .sfro-rp-cell {
                        text-align: center !important;
                        white-space: nowrap !important;
                    }

                    .sfro-rp-value {
                        display: inline-block;
                        font-size: 14px !important;
                        font-weight: 600;
                        color: rgba(255,255,255,0.88);
                        vertical-align: middle;
                    }

                    .sfro-eta {
                        display: inline-block;
                        margin-left: 6px;
                        padding: 2px 5px;
                        border: 1px solid rgba(255,255,255,.16);
                        border-radius: 4px;
                        background: rgba(255,255,255,.055);
                        color: rgba(255,255,255,.78);
                        font-size: 12.5px !important;
                        font-weight: 700;
                        line-height: 1.2;
                        text-align: center;
                        white-space: nowrap;
                        vertical-align: middle;
                    }

                    .sfro-active .sfro-eta {
                        border-color: rgba(var(--sfux-warning-rgb), .42);
                        background: rgba(var(--sfux-warning-rgb), .09);
                        color: var(--sfux-warning);
                    }

                    .sfro-queued .sfro-eta {
                        border-color: rgba(var(--sfux-warning-rgb), .28);
                    }

                    .sfro-rp-rate {
                        display: inline-block;
                        margin-left: 8px;
                        padding: 2px 6px;
                        border: 1px solid rgba(255,255,255,.12);
                        border-radius: 4px;
                        background: rgba(255,255,255,.035);
                        color: rgba(255,255,255,.66);
                        font-size: 12px !important;
                        font-weight: 600;
                        vertical-align: 1px;
                    }

                    .sfro-tech-table td:nth-child(5),
                    .sfro-tech-table td:nth-child(5) a,
                    .sfro-tech-table td:nth-child(5) span {
                        font-size: 13px !important;
                        white-space: nowrap !important;
                    }

                    /* Active Research dashboard card */
                    .sfro-active-card {
                        margin: 0;
                        padding: 12px 14px 13px;
                        border: 1px solid rgba(var(--sfux-warning-rgb), 0.22);
                        border-left: 3px solid rgba(var(--sfux-warning-rgb), 0.72);
                        background: linear-gradient(
                            180deg,
                            rgba(78,66,38,0.22),
                            rgba(38,34,27,0.18)
                        );
                        box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
                    }

                    .sfro-active-card-top {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 14px;
                        min-width: 0;
                    }

                    .sfro-active-card-title-wrap {
                        min-width: 0;
                        flex: 1 1 auto;
                    }

                    .sfro-active-card-title {
                        color: var(--sfux-text-primary);
                        font-size: 17px;
                        font-weight: 700;
                        line-height: 1.2;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .sfro-active-card-effect {
                        margin-top: 3px;
                        color: rgba(255,255,255,0.60);
                        font-size: 12.5px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .sfro-active-card-actions {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        flex: 0 0 auto;
                    }

                    .sfro-active-big-eta {
                        display: inline-block;
                        padding: 4px 8px;
                        border: 1px solid rgba(var(--sfux-warning-rgb), 0.38);
                        border-radius: 4px;
                        background: rgba(var(--sfux-warning-rgb), 0.08);
                        color: var(--sfux-warning);
                        font-size: 13px;
                        font-weight: 700;
                        white-space: nowrap;
                    }

                    .sfro-active-cancel {
                        opacity: 0.46;
                        font-size: 12px !important;
                        transition: opacity 120ms ease;
                        white-space: nowrap;
                    }

                    .sfro-active-cancel:hover {
                        opacity: 1;
                    }

                    .sfro-active-progress {
                        position: relative;
                        height: 8px;
                        margin-top: 11px;
                        overflow: hidden;
                        border: 1px solid rgba(255,255,255,0.08);
                        border-radius: 999px;
                        background: rgba(0,0,0,0.32);
                    }

                    .sfro-active-progress-fill {
                        height: 100%;
                        border-radius: inherit;
                        background: linear-gradient(
                            90deg,
                            rgba(203,170,76,0.72),
                            rgba(var(--sfux-warning-rgb), 0.92)
                        );
                    }

                    .sfro-active-meta {
                        display: flex;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 5px 14px;
                        margin-top: 9px;
                        color: rgba(255,255,255,0.67);
                        font-size: 12.5px;
                    }

                    .sfro-active-meta strong {
                        color: rgba(255,255,255,0.88);
                        font-weight: 700;
                    }

                    .sfro-active-meta .sfro-active-percent {
                        color: var(--sfux-warning);
                    }

                    .sfro-active-rate {
                        color: rgba(255,255,255,0.58);
                    }

                    /* Queue summary appended to the native section heading. */
                    .sfro-queue-title-summary {
                        display: inline-block;
                        margin-left: 8px;
                        color: rgba(255,255,255,0.56);
                        font-size: 12px;
                        font-weight: 500;
                        vertical-align: 1px;
                    }

                    /* Research Queue timeline/cards */
                    .sfro-queue-list {
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                    }

                    .sfro-queue-item {
                        display: grid;
                        grid-template-columns: auto minmax(0,1fr) auto auto;
                        align-items: center;
                        gap: 10px;
                        padding: 9px 11px;
                        border: 1px solid rgba(255,255,255,0.07);
                        border-left: 3px solid rgba(var(--sfux-warning-rgb), .45);
                        background: rgba(255,255,255,0.022);
                    }

                    .sfro-queue-item:not(:first-child) {
                        border-left-color: rgba(109,148,176,0.34);
                    }

                    .sfro-queue-order {
                        min-width: 36px;
                        color: rgba(255,255,255,0.52);
                        font-size: 11px;
                        font-weight: 700;
                        text-align: center;
                        text-transform: uppercase;
                        letter-spacing: .035em;
                    }

                    .sfro-queue-item:first-child .sfro-queue-order {
                        color: var(--sfux-warning);
                    }

                    .sfro-queue-main {
                        min-width: 0;
                    }

                    .sfro-queue-tech {
                        color: rgba(255,255,255,0.91);
                        font-size: 13.5px;
                        font-weight: 700;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .sfro-queue-effect {
                        margin-top: 2px;
                        color: rgba(255,255,255,0.50);
                        font-size: 11.5px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .sfro-queue-metrics {
                        display: flex;
                        align-items: center;
                        gap: 7px;
                        color: rgba(255,255,255,0.69);
                        font-size: 12.5px;
                        font-weight: 600;
                        white-space: nowrap;
                    }

                    .sfro-queue-duration {
                        padding: 2px 5px;
                        border: 1px solid rgba(255,255,255,0.13);
                        border-radius: 4px;
                        background: rgba(255,255,255,0.045);
                        color: rgba(255,255,255,0.79);
                        font-weight: 700;
                    }

                    .sfro-queue-complete {
                        color: rgba(var(--sfux-warning-rgb), 0.88);
                        font-weight: 700;
                    }

                    .sfro-queue-remove {
                        opacity: 0.40;
                        font-size: 12px !important;
                        transition: opacity 120ms ease;
                        white-space: nowrap;
                    }

                    .sfro-queue-remove:hover {
                        opacity: 1;
                    }

                    .sfro-queue-empty {
                        padding: 10px 12px;
                        border: 1px dashed rgba(255,255,255,0.10);
                        color: rgba(255,255,255,0.46);
                        font-size: 12.5px;
                        text-align: center;
                    }

                    /*
                     * Mobile layout
                     * Desktop remains untouched. On narrow screens the Tech Tree becomes
                     * a compact two-line card list with full-width section headers.
                     */
                    @media (max-width: ${SFUX.responsive.mobile}px) {
                        .sfro-tech-title,
                        .sfro-queue-title {
                            display: flex;
                            align-items: center;
                            flex-wrap: wrap;
                            gap: 5px 0;
                        }

                        .sfro-rp-rate,
                        .sfro-completed-toggle,
                        .sfro-queue-title-summary,
                        .sfro-all-research-maxed {
                            margin-left: 7px;
                        }

                        .sfro-tech-table {
                            display: block !important;
                            width: 100% !important;
                            table-layout: auto !important;
                            font-size: 13px !important;
                        }

                        .sfro-tech-table > tbody {
                            display: block !important;
                            width: 100% !important;
                        }

                        /* Desktop headings do not map cleanly to mobile cards. */
                        .sfro-column-head {
                            display: none !important;
                        }

                        /*
                         * Override the desktop nth-child width:1% rule with higher
                         * specificity. This is the key fix for crushed section headers.
                         */
                        .sfro-tech-table tr:has(> td.tableheader) {
                            display: block !important;
                            width: 100% !important;
                        }

                        .sfro-tech-table tr:has(> td.tableheader) > td.tableheader {
                            display: block !important;
                            width: 100% !important;
                            min-width: 100% !important;
                            max-width: 100% !important;
                            box-sizing: border-box !important;
                            padding: 8px 9px !important;
                            white-space: normal !important;
                        }

                        .sfro-section-header-inner {
                            display: grid;
                            grid-template-columns: minmax(0, 1fr) auto;
                            align-items: center;
                            gap: 6px 10px;
                            width: 100%;
                        }

                        .sfro-section-name {
                            min-width: 0;
                            font-size: 13px;
                            line-height: 1.2;
                            white-space: normal;
                        }

                        .sfro-section-meta {
                            width: auto;
                            min-width: 0;
                            font-size: 11.5px;
                            line-height: 1.2;
                            text-align: right;
                            white-space: nowrap;
                        }

                        .sfro-section-meta-desktop {
                            display: none;
                        }

                        .sfro-section-meta-mobile {
                            display: inline;
                        }

                        .sfro-section-complete-meta {
                            font-size: 11.5px;
                            white-space: nowrap;
                        }

                        /* Technology rows become compact two-line cards. */
                        .sfro-tech-table tr.sfro-tech-row {
                            display: grid !important;
                            grid-template-columns: minmax(0, 1fr) auto;
                            grid-template-areas:
                                "tech rp"
                                "effect status";
                            width: 100% !important;
                            min-width: 0 !important;
                            height: auto !important;
                            border-bottom: 1px solid rgba(255,255,255,0.055);
                            box-shadow: inset 0 1px 0 rgba(0,0,0,0.10);
                        }

                        .sfro-tech-table tr.sfro-tech-row > td {
                            width: auto !important;
                            height: auto !important;
                            min-width: 0 !important;
                            border: 0 !important;
                            box-sizing: border-box;
                        }

                        /*
                         * Mobile grid cells otherwise retain StarFury's individual TD
                         * backgrounds, which creates dark rectangles beneath RP/ETA on
                         * active and queued rows. Let the row own the state background.
                         */
                        .sfro-tech-table tr.sfro-active {
                            background: rgba(218,171,64,0.10) !important;
                        }

                        .sfro-tech-table tr.sfro-queued {
                            background: var(--sfux-warning-soft) !important;
                        }

                        .sfro-tech-table tr.sfro-completed {
                            background: rgba(57,166,83,0.060) !important;
                        }

                        .sfro-tech-table tr.sfro-active > td,
                        .sfro-tech-table tr.sfro-queued > td,
                        .sfro-tech-table tr.sfro-completed > td {
                            background: transparent !important;
                        }

                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(1) {
                            display: none !important;
                        }

                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(2) {
                            grid-area: tech;
                            padding: 8px 6px 2px 9px !important;
                            white-space: normal !important;
                            text-align: left !important;
                            line-height: 1.2;
                            font-weight: 600;
                        }

                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(3) {
                            grid-area: effect;
                            padding: 2px 6px 8px 9px !important;
                            white-space: normal !important;
                            overflow: visible !important;
                            text-overflow: clip !important;
                            line-height: 1.25;
                            color: rgba(255,255,255,0.64) !important;
                        }

                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(4) {
                            grid-area: rp;
                            align-self: start;
                            padding: 8px 9px 2px 4px !important;
                            white-space: nowrap !important;
                            text-align: right !important;
                        }

                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(5) {
                            grid-area: status;
                            align-self: end;
                            padding: 2px 9px 8px 4px !important;
                            white-space: nowrap !important;
                            text-align: right !important;
                        }

                        /*
                         * Completed rows have no useful RP or Status information on mobile.
                         * Let their Technology and Effect use the full card width instead of
                         * leaving dark, empty boxes on the right.
                         */
                        .sfro-tech-table tr.sfro-completed {
                            grid-template-columns: minmax(0, 1fr) !important;
                            grid-template-areas:
                                "tech"
                                "effect" !important;
                        }

                        .sfro-tech-table tr.sfro-completed > td:nth-child(4),
                        .sfro-tech-table tr.sfro-completed > td:nth-child(5) {
                            display: none !important;
                        }

                        .sfro-tech-table tr.sfro-completed > td:nth-child(2),
                        .sfro-tech-table tr.sfro-completed > td:nth-child(3) {
                            padding-right: 9px !important;
                        }

                        /* Restore the completion cue lost when the No. column is hidden. */
                        .sfro-tech-table tr.sfro-completed > td:nth-child(2)::before {
                            content: "✓";
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 15px;
                            height: 15px;
                            margin-right: 6px;
                            border: 1px solid rgba(var(--sfux-success-rgb), 0.58);
                            border-radius: 50%;
                            color: rgba(var(--sfux-success-rgb), 0.95);
                            font-size: 10px;
                            font-weight: 700;
                            line-height: 1;
                            vertical-align: 1px;
                        }

                        /*
                         * Touch targets: enlarge clickable areas without making the UI look
                         * visually oversized. These paddings improve thumb usability while
                         * preserving the existing text scale.
                         */
                        .sfro-info-icon,
                        .sfro-completed-toggle,
                        .sfro-active-cancel,
                        .sfro-queue-remove,
                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(5) a {
                            min-height: 30px;
                            box-sizing: border-box;
                        }

                        .sfro-info-icon {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            min-width: 30px;
                            margin-left: 2px;
                            padding: 6px;
                            border: 0 !important;
                            border-bottom: 0 !important;
                            text-decoration: none !important;
                            box-shadow: none !important;
                            background-image: none !important;
                        }

                        .sfro-active-cancel,
                        .sfro-queue-remove,
                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(5) a {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            padding: 6px 8px;
                            margin: -4px -3px -4px 3px;
                            border-radius: var(--sfux-radius-sm);
                        }

                        .sfro-completed-toggle {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            padding-top: 6px;
                            padding-bottom: 6px;
                        }

                        /*
                         * When StarFury disables Queue Item (often because the single queue
                         * slot is already occupied), it is mostly noise on a phone.
                         * Clickable/current statuses remain visible.
                         */
                        .sfro-tech-table tr.sfro-tech-row > td:nth-child(5) > .disabledLink {
                            display: none !important;
                        }

                        .sfro-summary-text {
                            font-size: 12.5px !important;
                        }

                        .sfro-rp-value {
                            font-size: 13px !important;
                        }

                        .sfro-eta {
                            min-width: 0;
                            margin-left: 4px;
                            padding: 2px 5px;
                            font-size: 11.5px !important;
                        }

                        .sfro-tech-table td:nth-child(5),
                        .sfro-tech-table td:nth-child(5) a,
                        .sfro-tech-table td:nth-child(5) span {
                            font-size: 12px !important;
                        }

                        /* Active Research */
                        .sfro-active-card {
                            padding: 11px 10px 12px;
                        }

                        .sfro-active-card-top {
                            align-items: flex-start;
                            gap: 8px;
                        }

                        .sfro-active-card-title {
                            font-size: 16px;
                            line-height: 1.15;
                            white-space: normal;
                            overflow: visible;
                        }

                        .sfro-active-card-effect {
                            margin-top: 2px;
                            font-size: 12px;
                            line-height: 1.25;
                            white-space: normal;
                            overflow: visible;
                        }

                        .sfro-active-progress {
                            margin-top: 9px;
                        }

                        .sfro-active-meta {
                            display: grid;
                            grid-template-columns: repeat(2, minmax(0, 1fr));
                            gap: 5px 10px;
                            margin-top: 8px;
                            font-size: 12px;
                        }

                        /* Queue */
                        .sfro-queue-item {
                            grid-template-columns: auto minmax(0, 1fr) auto;
                            grid-template-areas:
                                "order main action"
                                ". metrics metrics";
                            gap: 5px 8px;
                            padding: 9px 8px;
                        }

                        .sfro-queue-order {
                            grid-area: order;
                            min-width: 29px;
                        }

                        .sfro-queue-main {
                            grid-area: main;
                            min-width: 0;
                        }

                        .sfro-queue-metrics {
                            grid-area: metrics;
                            justify-self: end;
                            flex-wrap: wrap;
                            justify-content: flex-end;
                            gap: 5px 6px;
                            font-size: 12px;
                        }

                        .sfro-queue-item > :last-child {
                            grid-area: action;
                            justify-self: end;
                        }

                        .sfro-queue-tech {
                            font-size: 13px;
                            line-height: 1.2;
                        }

                        .sfro-queue-effect {
                            font-size: 11px;
                            line-height: 1.2;
                            white-space: normal;
                            overflow: visible;
                        }

                        .sfro-queue-title-summary {
                            font-size: 11.5px;
                        }
                    }

                    @media (max-width: ${SFUX.responsive.narrowHeader}px) {
                        .sfro-tech-title {
                            align-items: center;
                        }

                        .sfro-rp-rate,
                        .sfro-completed-toggle {
                            font-size: 11px !important;
                        }

                        .sfro-section-header-inner {
                            grid-template-columns: 1fr;
                            gap: 3px;
                        }

                        .sfro-section-meta {
                            text-align: left;
                        }

                        .sfro-active-card-top {
                            flex-direction: column;
                            gap: 8px;
                        }

                        .sfro-active-card-actions {
                            width: 100%;
                            justify-content: space-between;
                        }

                        .sfro-active-meta {
                            grid-template-columns: 1fr 1fr;
                        }

                        .sfro-queue-item {
                            grid-template-columns: auto minmax(0, 1fr);
                            grid-template-areas:
                                "order main"
                                ". metrics"
                                ". action";
                        }

                        .sfro-queue-item > :last-child {
                            justify-self: end;
                            padding-top: 1px;
                        }

                        .sfro-completed-toggle {
                            margin-left: 6px;
                            padding-left: 7px;
                            padding-right: 7px;
                        }

                        .sfro-info-icon {
                            min-width: 28px;
                            min-height: 28px;
                            padding: 5px;
                        }

                        .sfro-active-cancel,
                        .sfro-queue-remove {
                            min-height: 28px;
                            padding: 5px 7px;
                        }
                    }
                `); }

            // ---------------------------------------------------------------------
            // Current-page adapters
            // Userscript-only: these functions read state back out of rendered HTML.
            // A native implementation should receive these values as structured data.
            // ---------------------------------------------------------------------
            function getResearchRate() {
                const advisor = document.querySelector('#advisor-content');
                const text = normalizeText(advisor ? advisor.textContent : document.body.textContent);

                const patterns = [
                    /([\d,]+)\s+Research Points Per Tick/i,
                    /([\d,]+)\s+RP\s*\/?\s*tick/i
                ];

                for (const pattern of patterns) {
                    const match = text.match(pattern);
                    if (match) {
                        const value = parseNumber(match[1]);
                        if (value !== null && value >= 0) return value;
                    }
                }

                return null;
            }

            function getActiveResearch() {
                const sectionTitles = [...document.querySelectorAll('.sectionTitle')];
                const title = sectionTitles.find(el => /Active Research/i.test(normalizeText(el.textContent)));
                if (!title) return null;

                let node = title.nextElementSibling;
                while (node && !node.classList.contains('noticeBody')) {
                    node = node.nextElementSibling;
                }

                const table = node?.querySelector('table.basictable');
                const rows = table?.querySelectorAll('tr');
                if (!rows || rows.length < 2) return null;

                const cells = rows[1].querySelectorAll('td');
                if (cells.length < 4) return null;

                const name = normalizeText(cells[0].textContent);
                const achieved = parseNumber(cells[1].textContent);
                const total = parseNumber(cells[2].textContent);

                if (!name || achieved === null || total === null) return null;

                return {
                    name,
                    achieved,
                    total,
                    remaining: Math.max(0, total - achieved)
                };
            }

            function isTechTreeTable(table) {
                return [...table.querySelectorAll('td.tableheader')].some(td =>
                    /^(Empire|Star Dock Technology|Ship Technology|Offence & Defence|Intelligence|Advanced Intelligence|Counter Intelligence|Respawn Technology)/i
                        .test(normalizeText(td.textContent))
                );
            }

            function getInfoModal(row) {
                const cells = row.querySelectorAll(':scope > td');
                if (cells.length !== 5) return null;

                const link = cells[2].querySelector('a[href^="#"]');
                if (!link) return null;

                const href = link.getAttribute('href');
                if (!href || href.length < 2) return null;

                return document.getElementById(href.slice(1));
            }

            function parseSectionLimit(sectionName) {
                const match = normalizeText(sectionName).match(/\[Limit:\s*(\d+)\]/i);
                if (!match) return null;

                const limit = Number(match[1]);
                return Number.isFinite(limit) && limit > 0 ? limit : null;
            }

            /*
             * Parse StarFury's own "Invalidates" text instead of hard-coding specific
             * mutually-exclusive technologies. This lets a completed choice make the
             * opposing row terminal for the current research path without confusing a
             * globally disabled Queue Item (which may simply mean the queue is full).
             */
            function getInvalidatedTechnologyNames(row) {
                const modal = getInfoModal(row);
                if (!modal) return [];

                const paragraphs = [...modal.querySelectorAll('.popContent p')];
                const names = [];
                let inInvalidates = false;

                for (const paragraph of paragraphs) {
                    const text = normalizeText(paragraph.textContent);
                    if (!text) continue;

                    if (/^Invalidates:?$/i.test(text)) {
                        inInvalidates = true;
                        continue;
                    }

                    if (!inInvalidates) continue;
                    if (/^(Requirements|Modifier\(s\)):/i.test(text)) break;

                    for (const strong of paragraph.querySelectorAll('strong')) {
                        const candidate = normalizeText(strong.textContent).replace(/:$/, '');
                        if (!candidate || /^Invalidates$/i.test(candidate)) continue;
                        if (!names.includes(candidate)) names.push(candidate);
                    }
                }

                return names;
            }

            /*
             * Parse StarFury's own Requirements text so limited-section range
             * calculations can respect prerequisite chains such as:
             *
             *   Advanced Fabrication Plants I -> II
             *   Probe Loss Reduction I -> II
             *   Reinforced Intelligence I -> II
             *
             * Only requirements within the same section constrain that section's
             * completion-range calculation. External prerequisites belong to another
             * section and are therefore intentionally not charged to this section.
             */
            function getRequirementTechnologyNames(row) {
                const modal = getInfoModal(row);
                if (!modal) return [];

                const paragraphs = [...modal.querySelectorAll('.popContent p')];
                const names = [];
                let inRequirements = false;

                for (const paragraph of paragraphs) {
                    const text = normalizeText(paragraph.textContent);
                    if (!text) continue;

                    if (/^Requirements:?$/i.test(text)) {
                        inRequirements = true;
                        continue;
                    }

                    if (!inRequirements) continue;
                    if (/^(Invalidates|Modifier\(s\)):/i.test(text)) break;
                    if (!/^Requires:/i.test(text)) continue;

                    for (const strong of paragraph.querySelectorAll('strong')) {
                        const candidate = normalizeText(strong.textContent).replace(/:$/, '');
                        if (!candidate || /^Requirements$/i.test(candidate)) continue;
                        if (!names.includes(candidate)) names.push(candidate);
                    }
                }

                return names;
            }

            function isCounterIntelligenceSection(section) {
                return /^Counter Intelligence\b/i.test(normalizeText(section.name));
            }

            function getTechByName(section, techName) {
                return section.techs.find(tech => tech.name === techName) || null;
            }

            function getCounterIntelligenceProgress(section) {
                if (!isCounterIntelligenceSection(section)) return null;

                const counterCombat = getTechByName(section, 'Counter Combat');
                const reinforcedI = getTechByName(section, 'Reinforced Intelligence I');
                const reinforcedII = getTechByName(section, 'Reinforced Intelligence II');

                /*
                 * Counter Intelligence is modeled as one path worth 1.0 total:
                 *
                 *   Counter Combat                = 1.0 / 1
                 *   Reinforced Intelligence I     = 0.5 / 1
                 *   Reinforced Intelligence II    = 1.0 / 1
                 *
                 * RI II requires RI I, so the Reinforced branch reaches half-progress
                 * after RI I and full progress only after RI II.
                 */
                if (counterCombat?.completed || reinforcedII?.completed) return 1;
                if (reinforcedI?.completed) return 0.5;
                return 0;
            }

            function formatCounterIntelligenceProgress(progress) {
                if (progress === 0.5) return '0.5/1';
                if (progress >= 1) return '1/1';
                return '0/1';
            }

            function getCounterIntelligenceTerminalState(section) {
                if (!isCounterIntelligenceSection(section)) return null;

                const counterCombat = getTechByName(section, 'Counter Combat');
                const reinforcedI = getTechByName(section, 'Reinforced Intelligence I');
                const reinforcedII = getTechByName(section, 'Reinforced Intelligence II');

                /*
                 * Counter Intelligence is the one known oddball:
                 * [Limit: 1], but Reinforced Intelligence II requires I.
                 *
                 * Working model, explicitly treated as an inference:
                 *   - Counter Combat is one complete path.
                 *   - Reinforced Intelligence I -> II is the other complete path.
                 *
                 * Do not treat RI I alone as "Max Reached" merely because the header
                 * says Limit: 1.
                 */
                if (counterCombat?.completed || reinforcedII?.completed) {
                    return {
                        terminal: true,
                        kind: 'max',
                        desktop: '✓ Max Reached',
                        mobile: '✓ Max Reached',
                        title:
                            'Counter Intelligence has reached one complete research path. ' +
                            'Counter Combat completes the category directly; Reinforced Intelligence reaches half-progress at RI I and completes at RI II. ' +
                            'The branch interpretation remains an informed inference from the Limit: 1 label and RI II prerequisite.'
                    };
                }

                // RI I by itself is progress down the Reinforced path, not completion.
                if (reinforcedI?.completed) {
                    return { terminal: false, kind: 'open', counterBranch: 'reinforced' };
                }

                return { terminal: false, kind: 'open', counterBranch: null };
            }

            function classifySectionState(section) {
                const hasRows = section.techCount > 0;
                const allResearched =
                    hasRows && section.completedCount >= section.techCount;

                /*
                 * Simple terminal-state rule:
                 *
                 *   1. If every technology in the section is researched -> Complete.
                 *   2. Otherwise, if the section has reached any valid terminal/max
                 *      state -> Max Reached.
                 *
                 * This intentionally avoids exposing selection counts or a separate
                 * "Path Complete" label in the section header.
                 */
                if (allResearched) {
                    return {
                        terminal: true,
                        kind: 'complete',
                        desktop: '✓ Complete',
                        mobile: '✓ Complete',
                        title: 'Every technology in this section is researched.'
                    };
                }

                const counterState = getCounterIntelligenceTerminalState(section);
                // INFERRED MECHANIC: RI I is half a path; the generic selection count must not override it.
                if (counterState) {
                    return counterState;
                }

                const limitReached =
                    section.limit !== null && section.completedCount >= section.limit;

                const pathComplete =
                    hasRows &&
                    !allResearched &&
                    section.blockedCount > 0 &&
                    (section.completedCount + section.blockedCount >= section.techCount);

                if (limitReached) {
                    return {
                        terminal: true,
                        kind: 'max',
                        desktop: '✓ Max Reached',
                        mobile: '✓ Max Reached',
                        title:
                            'This category has reached its research selection limit. ' +
                            'Other listed technologies are alternatives, not additional research capacity.'
                    };
                }

                if (pathComplete) {
                    return {
                        terminal: true,
                        kind: 'max',
                        desktop: '✓ Max Reached',
                        mobile: '✓ Max Reached',
                        title:
                            'This category has reached the maximum research available on the selected path. ' +
                            'Remaining listed technologies are mutually exclusive alternatives.'
                    };
                }

                if (counterState) {
                    return counterState;
                }

                return { terminal: false, kind: 'open' };
            }

            function chooseCombinations(items, count) {
                if (count < 0) return [];
                if (count === 0) return [[]];
                if (count > items.length) return [];

                const results = [];

                function walk(startIndex, remaining, current) {
                    if (remaining === 0) {
                        results.push([...current]);
                        return;
                    }

                    for (let index = startIndex; index <= items.length - remaining; index += 1) {
                        current.push(items[index]);
                        walk(index + 1, remaining - 1, current);
                        current.pop();
                    }
                }

                walk(0, count, []);
                return results;
            }

            function routeRespectsSectionPrerequisites(section, route) {
                const sectionNames = new Set(section.techs.map(tech => tech.name));
                const selectedNames = new Set(
                    section.techs
                        .filter(tech => tech.completed)
                        .map(tech => tech.name)
                );

                for (const tech of route) selectedNames.add(tech.name);

                return route.every(tech =>
                    tech.requirements.every(requirement =>
                        !sectionNames.has(requirement) || selectedNames.has(requirement)
                    )
                );
            }

            function measureResearchRoute(route, researchRate) {
                const rp = route.reduce((sum, tech) => sum + tech.remainingRp, 0);
                const ticks = researchRate && researchRate > 0
                    ? route.reduce(
                        (sum, tech) => sum + Math.ceil(tech.remainingRp / researchRate),
                        0
                    )
                    : 0;

                return { rp, ticks };
            }

            function summarizeRoutes(routes, researchRate, note = '') {
                if (!routes.length) return null;

                const measurements = routes.map(route => measureResearchRoute(route, researchRate));
                const rpValues = measurements.map(item => item.rp);
                const tickValues = measurements.map(item => item.ticks);

                return {
                    minRp: Math.min(...rpValues),
                    maxRp: Math.max(...rpValues),
                    minTicks: researchRate && researchRate > 0 ? Math.min(...tickValues) : 0,
                    maxTicks: researchRate && researchRate > 0 ? Math.max(...tickValues) : 0,
                    routeCount: routes.length,
                    note
                };
            }

            function calculateGenericLimitedRange(section, researchRate) {
                const slotsNeeded = Math.max(0, section.limit - section.completedCount);
                if (slotsNeeded <= 0) return null;

                const candidates = section.techs.filter(tech =>
                    !tech.completed &&
                    !tech.blocked &&
                    tech.remainingRp > 0
                );

                const committed = candidates.filter(tech => tech.active || tech.queued);
                if (committed.length > slotsNeeded) return null;

                const committedNames = new Set(committed.map(tech => tech.name));
                const optional = candidates.filter(tech => !committedNames.has(tech.name));
                const chooseCount = slotsNeeded - committed.length;

                const routes = [];

                for (const combination of chooseCombinations(optional, chooseCount)) {
                    const route = [...committed, ...combination];

                    if (!routeRespectsSectionPrerequisites(section, route)) continue;
                    routes.push(route);
                }

                return summarizeRoutes(
                    routes,
                    researchRate,
                    'Range is the cheapest-to-most-expensive valid way to reach this section’s selection cap. ' +
                    'In-section prerequisite chains are respected, and active/queued research is treated as committed. ' +
                    'Tick ranges sum each research item’s individually rounded ETA.'
                );
            }

            function calculateCounterIntelligenceRange(section, researchRate) {
                const counterCombat = getTechByName(section, 'Counter Combat');
                const reinforcedI = getTechByName(section, 'Reinforced Intelligence I');
                const reinforcedII = getTechByName(section, 'Reinforced Intelligence II');

                if (!counterCombat || !reinforcedI || !reinforcedII) return null;
                if (counterCombat.completed || reinforcedII.completed) return null;

                const routeForNames = names => {
                    const route = [];

                    for (const name of names) {
                        const tech = getTechByName(section, name);
                        if (!tech) return null;
                        if (tech.completed) continue;
                        if (tech.blocked || tech.remainingRp <= 0) return null;
                        route.push(tech);
                    }

                    return route;
                };

                const committedNames = new Set(
                    section.techs
                        .filter(tech => !tech.completed && (tech.active || tech.queued))
                        .map(tech => tech.name)
                );

                let routes = [];

                if (
                    reinforcedI.completed ||
                    committedNames.has('Reinforced Intelligence I') ||
                    committedNames.has('Reinforced Intelligence II')
                ) {
                    const reinforcedRoute = routeForNames([
                        'Reinforced Intelligence I',
                        'Reinforced Intelligence II'
                    ]);
                    if (reinforcedRoute) routes = [reinforcedRoute];
                } else if (committedNames.has('Counter Combat')) {
                    const combatRoute = routeForNames(['Counter Combat']);
                    if (combatRoute) routes = [combatRoute];
                } else {
                    const combatRoute = routeForNames(['Counter Combat']);
                    const reinforcedRoute = routeForNames([
                        'Reinforced Intelligence I',
                        'Reinforced Intelligence II'
                    ]);

                    routes = [combatRoute, reinforcedRoute].filter(Boolean);
                }

                return summarizeRoutes(
                    routes,
                    researchRate,
                    'Counter Intelligence is modeled as a unique one-path category: Counter Combat, or Reinforced Intelligence I → II. ' +
                    'This is an informed inference from the Limit: 1 label and the RI II prerequisite, not an explicit StarFury rules statement. ' +
                    'Tick ranges sum each research item’s individually rounded ETA.'
                );
            }

            function calculateLimitedSectionRange(section, researchRate) {
                if (section.limit === null || section.state?.terminal) return null;

                return isCounterIntelligenceSection(section)
                    ? calculateCounterIntelligenceRange(section, researchRate)
                    : calculateGenericLimitedRange(section, researchRate);
            }

            function formatNumericRange(minValue, maxValue) {
                if (minValue === maxValue) return minValue.toLocaleString();
                return `${minValue.toLocaleString()}–${maxValue.toLocaleString()}`;
            }

            function formatTickRange(minTicks, maxTicks) {
                if (minTicks === maxTicks) return `≈${minTicks} ticks`;
                return `≈${minTicks}–${maxTicks} ticks`;
            }

            function setTerminalActionStatus(tech, label, kind, title) {
                if (!tech || tech.completed || tech.active || tech.queued) return;

                const span = ctx.element('span');
                span.className = `sfro-terminal-action sfro-terminal-action-${kind}`;
                span.textContent = label;
                span.title = title;

                tech.actionCell.replaceChildren(span);
                tech.row.classList.add('sfro-terminal-locked');
            }

            function applyTerminalSectionRowStatuses(section) {
                if (!section.state?.terminal) return;

                for (const tech of section.techs) {
                    if (tech.completed) continue;

                    if (
                        tech.blocked ||
                        isCounterIntelligenceSection(section)
                    ) {
                        setTerminalActionStatus(
                            tech,
                            'Path Closed',
                            'path',
                            'This technology is outside the completed research path. Remove a conflicting/selected technology first if you intend to reopen alternatives.'
                        );
                        continue;
                    }

                    if (section.state.kind === 'max') {
                        setTerminalActionStatus(
                            tech,
                            'Max Reached',
                            'max',
                            'This category has reached its selection cap. Remove one completed selection before choosing another.'
                        );
                    }
                }
            }

            function updateOverallResearchState(sections) {
                const sectionTitle = [...document.querySelectorAll('.sectionTitle')]
                    .find(el => /^Tech Tree$/i.test(normalizeText(el.childNodes[0]?.textContent || el.textContent)));

                if (!sectionTitle) return;

                let badge = sectionTitle.querySelector('.sfro-all-research-maxed');
                const maxed = sections.length > 0 && sections.every(section => section.state?.terminal);

                if (!maxed) {
                    badge?.remove();
                    return;
                }

                if (!badge) {
                    badge = ctx.element('span');
                    badge.className = 'sfro-all-research-maxed';
                    sectionTitle.appendChild(badge);
                }

                badge.textContent = '✓ All Research Maxed';
                badge.title =
                    'No additional research can be added under the current selections. ' +
                    'Limited categories are at their caps, uncapped categories are complete, and mutually-exclusive paths are resolved.';
            }

            function fallbackSummaryFromModal(row, techName) {
                const modal = getInfoModal(row);
                if (!modal) return '';

                const paragraphs = [...modal.querySelectorAll('.popContent p')];

                for (const paragraph of paragraphs) {
                    const text = normalizeText(paragraph.textContent);
                    if (!text) continue;
                    if (text.startsWith(techName)) continue;
                    if (/^(Modifier\(s\)|Requirements|Invalidates):?$/i.test(text)) continue;
                    if (/^(Requires:|cannot be researched)/i.test(text)) continue;

                    return text.length > 72
                        ? text.slice(0, 69).replace(/\s+\S*$/, '') + '…'
                        : text;
                }

                return '';
            }

            // ---------------------------------------------------------------------
            // Tech Tree render helpers
            // ---------------------------------------------------------------------
            function addTechnologySummary(row) {
                if (row.dataset.sfroSummaryDone === '1') return;

                const cells = row.querySelectorAll(':scope > td');
                if (cells.length !== 5) return;

                const techName = normalizeText(cells[1].textContent);
                if (!techName) return;

                const infoCell = cells[2];
                const infoLink = infoCell.querySelector('a[rel*="modal"]');
                if (!infoLink) return;

                const summary = TECH_SUMMARIES[techName] || fallbackSummaryFromModal(row, techName);
                if (!summary) return;

                infoCell.classList.add('sfro-summary-cell');

                const summarySpan = ctx.element('span');
                summarySpan.className = 'sfro-summary-text';
                summarySpan.textContent = summary;
                summarySpan.title = summary;

                infoLink.classList.add('sfro-info-icon');
                infoLink.title = `Full details: ${techName}`;

                infoCell.replaceChildren(summarySpan, infoLink);
                row.dataset.sfroSummaryDone = '1';
            }

            function addDoneIcon(numberCell) {
                if (numberCell.querySelector('.sfro-done-icon')) return;

                const icon = ctx.element('span');
                icon.className = 'sfro-done-icon';
                icon.textContent = '✓';
                icon.title = 'Researched';
                numberCell.replaceChildren(icon);
            }

            function renderRpEta(costCell, points, researchRate, active = false) {
                if (!researchRate || researchRate <= 0 || points <= 0) return;
                if (costCell.dataset.sfroEtaDone === '1') return;

                const originalCost = parseNumber(costCell.textContent);
                if (originalCost === null || originalCost <= 0) return;

                const ticks = Math.ceil(points / researchRate);
                const existingText = normalizeText(costCell.textContent);

                costCell.classList.add('sfro-rp-cell');
                costCell.textContent = '';

                const value = ctx.element('span');
                value.className = 'sfro-rp-value';
                value.textContent = existingText;

                const eta = ctx.element('span');
                eta.className = 'sfro-eta';
                eta.textContent = active ? `${ticks} ticks left` : `${ticks} ticks`;
                eta.title = active
                    ? `${points.toLocaleString()} RP remaining ÷ ${researchRate.toLocaleString()} RP/tick = ${ticks} ticks`
                    : `${points.toLocaleString()} RP ÷ ${researchRate.toLocaleString()} RP/tick = ${ticks} ticks`;

                costCell.append(value, eta);
                costCell.dataset.sfroEtaDone = '1';
            }

            function addColumnHeader(table) {
                if (table.querySelector('.sfro-column-head')) return;

                const firstCategoryRow = [...table.querySelectorAll('tr')]
                    .find(row => row.querySelector('td.tableheader'));

                if (!firstCategoryRow) return;

                const header = ctx.element('tr');
                header.className = 'sfro-column-head';
                header.innerHTML = `
                    <td>No.</td>
                    <td>Technology</td>
                    <td>Effect</td>
                    <td>RP / ETA</td>
                    <td>Status</td>
                `;

                firstCategoryRow.parentNode.insertBefore(header, firstCategoryRow);
            }

            const readHideCompletedPreference = () => SFUX.storage.localGet(HIDE_COMPLETED_KEY) === '1';

            const writeHideCompletedPreference = hidden => SFUX.storage.localSet(HIDE_COMPLETED_KEY, hidden ? '1' : '0');

            function addCompletedToggle(table) {
                const sectionTitle = [...document.querySelectorAll('.sectionTitle')]
                    .find(el => /^Tech Tree/i.test(normalizeText(el.textContent)));

                if (!sectionTitle) return;
                sectionTitle.classList.add('sfro-tech-title');

                let toggle = sectionTitle.querySelector('.sfro-completed-toggle');

                if (!toggle) {
                    toggle = ctx.element('a');
                    toggle.href = '#';
                    toggle.className = 'sfro-completed-toggle';
                    toggle.setAttribute('role', 'button');
                    toggle.title =
                        'Show or hide finished research rows: completed technologies plus alternatives that are no longer researchable because a section is Max Reached or Path Closed. Section headers remain visible. This preference is saved in this browser.';

                    ctx.on(toggle, 'click', event => {
                        event.preventDefault();

                        const hidden = !table.classList.contains('sfro-hide-completed');
                        table.classList.toggle('sfro-hide-completed', hidden);
                        writeHideCompletedPreference(hidden);
                        updateCompletedToggle(toggle, table, hidden);
                    });

                    sectionTitle.appendChild(toggle);
                }

                const hidden = readHideCompletedPreference();
                table.classList.toggle('sfro-hide-completed', hidden);
                updateCompletedToggle(toggle, table, hidden);
            }

            function updateCompletedToggle(toggle, table, hidden) {
                const completedCount = table.querySelectorAll('tr.sfro-completed').length;
                const terminalCount = table.querySelectorAll(
                    'tr.sfro-terminal-locked:not(.sfro-completed)'
                ).length;
                const finishedCount = completedCount + terminalCount;

                toggle.textContent = hidden
                    ? `Show finished (${finishedCount})`
                    : `Hide finished (${finishedCount})`;

                toggle.title =
                    `${completedCount} researched · ${terminalCount} unavailable/closed. ` +
                    'Finished rows include researched technologies and alternatives that cannot currently be researched because the section is Max Reached or the row is Path Closed. Section headers remain visible.';

                toggle.classList.toggle('sfro-toggle-active', hidden);
                toggle.setAttribute('aria-pressed', hidden ? 'true' : 'false');
                toggle.setAttribute('aria-label', hidden ? 'Show finished research rows' : 'Hide finished research rows');
            }


            function markResearchRate(researchRate) {
                if (!researchRate) return;

                const sectionTitle = [...document.querySelectorAll('.sectionTitle')]
                    .find(el => /^Tech Tree$/i.test(normalizeText(el.textContent)));

                if (!sectionTitle) return;
                sectionTitle.classList.add('sfro-tech-title');
                if (sectionTitle.querySelector('.sfro-rp-rate')) return;

                const badge = ctx.element('span');
                badge.className = 'sfro-rp-rate';
                badge.textContent = `${researchRate.toLocaleString()} RP/tick`;
                badge.title = 'All ETAs use the current Research Points per Tick shown by the Advisor.';
                sectionTitle.appendChild(badge);
            }

            function addSectionSummaries(table, researchRate) {
                const hasResearchRate = Boolean(researchRate && researchRate > 0);
                const sections = [];
                let currentSection = null;

                for (const row of [...table.querySelectorAll('tr')]) {
                    const headerCell = row.querySelector(':scope > td.tableheader');

                    if (headerCell) {
                        const originalName =
                            headerCell.dataset.sfroOriginalSectionName ||
                            normalizeText(headerCell.textContent);

                        headerCell.dataset.sfroOriginalSectionName = originalName;

                        currentSection = {
                            headerCell,
                            name: originalName,
                            limit: parseSectionLimit(originalName),
                            remainingRp: 0,
                            etaTicks: 0,
                            techCount: 0,
                            completedCount: 0,
                            blockedCount: 0,
                            techs: [],
                            state: null,
                            range: null
                        };

                        sections.push(currentSection);
                        continue;
                    }

                    if (!currentSection || !row.classList.contains('sfro-tech-row')) continue;

                    const cells = row.querySelectorAll(':scope > td');
                    if (cells.length !== 5) continue;

                    const completed = row.classList.contains('sfro-completed');
                    const blocked = row.dataset.sfroTerminalBlocked === '1';
                    const active = row.classList.contains('sfro-active');
                    const queued = row.classList.contains('sfro-queued');
                    const remainingRp = Number(row.dataset.sfroRemainingRp || 0);
                    const etaTicks = Number(row.dataset.sfroEtaTicks || 0);
                    const techName = normalizeText(cells[1].textContent);

                    const tech = {
                        row,
                        actionCell: cells[4],
                        name: techName,
                        completed,
                        blocked,
                        active,
                        queued,
                        remainingRp,
                        etaTicks,
                        requirements: getRequirementTechnologyNames(row)
                    };

                    currentSection.techs.push(tech);
                    currentSection.techCount += 1;

                    if (completed) {
                        currentSection.completedCount += 1;
                        continue;
                    }

                    if (blocked) {
                        currentSection.blockedCount += 1;
                        continue;
                    }

                    currentSection.remainingRp += remainingRp;
                    currentSection.etaTicks += etaTicks;
                }

                for (const section of sections) {
                    const headerCell = section.headerCell;
                    section.state = classifySectionState(section);
                    section.range = calculateLimitedSectionRange(section, researchRate);

                    applyTerminalSectionRowStatuses(section);

                    const inner = ctx.element('div');
                    inner.className = 'sfro-section-header-inner';

                    const name = ctx.element('span');
                    name.className = 'sfro-section-name';
                    name.textContent = section.name;

                    const meta = ctx.element('span');

                    if (section.state.terminal) {
                        meta.className = 'sfro-section-meta sfro-section-complete-meta';
                        const desktopState = ctx.element('span');
                        desktopState.className = 'sfro-section-meta-desktop';
                        desktopState.textContent = section.state.desktop;

                        const mobileState = ctx.element('span');
                        mobileState.className = 'sfro-section-meta-mobile';
                        mobileState.textContent = section.state.mobile;

                        meta.title = section.state.title;
                        meta.append(desktopState, mobileState);
                    } else {
                        meta.className = 'sfro-section-meta';

                        const desktopMeta = ctx.element('span');
                        desktopMeta.className = 'sfro-section-meta-desktop';

                        if (section.limit !== null) {
                            const progress = ctx.element('span');
                            progress.className = 'sfro-section-meta-label';

                            if (isCounterIntelligenceSection(section)) {
                                const counterProgress = getCounterIntelligenceProgress(section);
                                progress.textContent =
                                    `Selected ${formatCounterIntelligenceProgress(counterProgress)}`;
                            } else {
                                progress.textContent = `Selected ${section.completedCount}/${section.limit}`;
                            }

                            desktopMeta.appendChild(progress);

                            if (section.range) {
                                const separator = ctx.element('span');
                                separator.className = 'sfro-section-meta-label';
                                separator.textContent = ' · To max:';
                                desktopMeta.appendChild(separator);

                                const rp = ctx.element('span');
                                rp.className = 'sfro-section-meta-rp';
                                rp.textContent =
                                    `${formatNumericRange(section.range.minRp, section.range.maxRp)} RP`;
                                desktopMeta.appendChild(rp);

                                if (hasResearchRate && section.range.maxTicks > 0) {
                                    const time = ctx.element('span');
                                    time.className = 'sfro-section-meta-time';
                                    time.textContent =
                                        `· ${formatTickRange(section.range.minTicks, section.range.maxTicks)}`;
                                    desktopMeta.appendChild(time);
                                }
                            } else if (section.remainingRp > 0) {
                                const separator = ctx.element('span');
                                separator.className = 'sfro-section-meta-label';
                                separator.textContent = ' · Available:';
                                desktopMeta.appendChild(separator);

                                const rp = ctx.element('span');
                                rp.className = 'sfro-section-meta-rp';
                                rp.textContent = `${section.remainingRp.toLocaleString()} RP`;
                                desktopMeta.appendChild(rp);

                                if (hasResearchRate && section.etaTicks > 0) {
                                    const time = ctx.element('span');
                                    time.className = 'sfro-section-meta-time';
                                    time.textContent = `· ≈${section.etaTicks} ticks`;
                                    desktopMeta.appendChild(time);
                                }
                            }
                        } else {
                            const label = ctx.element('span');
                            label.className = 'sfro-section-meta-label';
                            label.textContent = 'Remaining:';
                            desktopMeta.appendChild(label);

                            if (section.remainingRp > 0) {
                                const rp = ctx.element('span');
                                rp.className = 'sfro-section-meta-rp';
                                rp.textContent = `${section.remainingRp.toLocaleString()} RP`;
                                desktopMeta.appendChild(rp);
                            }

                            if (hasResearchRate && section.etaTicks > 0) {
                                const time = ctx.element('span');
                                time.className = 'sfro-section-meta-time';
                                time.textContent = `· ≈${section.etaTicks} ticks`;
                                desktopMeta.appendChild(time);
                            }
                        }

                        const mobileMeta = ctx.element('span');
                        mobileMeta.className = 'sfro-section-meta-mobile';

                        const pieces = [];

                        if (section.limit !== null) {
                            if (isCounterIntelligenceSection(section)) {
                                const counterProgress = getCounterIntelligenceProgress(section);
                                pieces.push(
                                    `${formatCounterIntelligenceProgress(counterProgress)} selected`
                                );
                            } else {
                                pieces.push(`${section.completedCount}/${section.limit} selected`);
                            }

                            if (section.range) {
                                pieces.push(
                                    `${formatNumericRange(section.range.minRp, section.range.maxRp)} RP`
                                );

                                if (hasResearchRate && section.range.maxTicks > 0) {
                                    pieces.push(
                                        formatTickRange(section.range.minTicks, section.range.maxTicks)
                                    );
                                }
                            } else if (section.remainingRp > 0) {
                                pieces.push(`${section.remainingRp.toLocaleString()} RP`);

                                if (hasResearchRate && section.etaTicks > 0) {
                                    pieces.push(`≈${section.etaTicks} ticks`);
                                }
                            }
                        } else {
                            if (section.remainingRp > 0) {
                                pieces.push(`${section.remainingRp.toLocaleString()} RP`);
                            }
                            if (hasResearchRate && section.etaTicks > 0) {
                                pieces.push(`≈${section.etaTicks} ticks`);
                            }
                        }

                        mobileMeta.textContent = pieces.join(' · ');

                        if (section.range?.note) {
                            meta.title = section.range.note;
                        } else if (section.limit !== null) {
                            meta.title =
                                'This category has a selection limit. "To max" shows the cheapest-to-most-expensive valid remaining route when the script can determine one.';
                        } else {
                            meta.title =
                                'Total currently attainable remaining RP. ETA is shown only when the empire has a positive Research Points per Tick rate.';
                        }

                        meta.append(desktopMeta, mobileMeta);
                    }

                    inner.append(name, meta);
                    headerCell.replaceChildren(inner);
                }

                updateOverallResearchState(sections);
            }

            // ---------------------------------------------------------------------
            // Tech Tree component
            // ---------------------------------------------------------------------
            function optimizeTechTree(table, researchRate, activeResearch) {
                if (!isTechTreeTable(table)) return;

                table.classList.add('sfro-tech-table');
                addColumnHeader(table);
                markResearchRate(researchRate);

                const completedTechs = new Set(
                    [...table.querySelectorAll('tr')]
                        .filter(row => row.querySelector('a[href^="#remove"]'))
                        .map(row => {
                            const cells = row.querySelectorAll(':scope > td');
                            return cells.length === 5 ? normalizeText(cells[1].textContent) : '';
                        })
                        .filter(Boolean)
                );

                const invalidatedByCompleted = new Set();
                for (const row of table.querySelectorAll('tr')) {
                    const cells = row.querySelectorAll(':scope > td');
                    if (cells.length !== 5 || cells[0].hasAttribute('colspan')) continue;

                    const techName = normalizeText(cells[1].textContent);
                    if (!completedTechs.has(techName)) continue;

                    for (const invalidatedName of getInvalidatedTechnologyNames(row)) {
                        invalidatedByCompleted.add(invalidatedName);
                    }
                }

                let currentSectionName = '';
                let currentSectionLimited = false;

                for (const row of table.querySelectorAll('tr')) {
                    const sectionHeader = row.querySelector(':scope > td.tableheader');

                    if (sectionHeader) {
                        currentSectionName = normalizeText(sectionHeader.textContent);
                        currentSectionLimited = /\[Limit:\s*\d+\]/i.test(currentSectionName);
                        continue;
                    }

                    const cells = row.querySelectorAll(':scope > td');
                    if (cells.length !== 5 || cells[0].hasAttribute('colspan')) continue;
                    if (row.classList.contains('sfro-column-head')) continue;

                    row.classList.add('sfro-tech-row');

                    const techName = normalizeText(cells[1].textContent);
                    const actionCell = cells[4];
                    const actionText = normalizeText(actionCell.textContent);

                    const removeLink = actionCell.querySelector('a[href^="#remove"]');
                    const isActive = /Active Item/i.test(actionText);
                    const isQueued = /Queued Item/i.test(actionText);

                    addTechnologySummary(row);

                    if (removeLink) {
                        row.classList.add('sfro-completed');
                        row.dataset.sfroTerminalBlocked = '0';
                        row.dataset.sfroRemainingRp = '0';
                        row.dataset.sfroEtaTicks = '0';

                        cells[3].classList.add('sfro-cost');
                        addDoneIcon(cells[0]);

                        if (currentSectionLimited) {
                            row.classList.add('sfux-research-removable');
                            removeLink.classList.add('sfro-remove');
                            removeLink.title = 'Remove completed research (loses its benefits)';
                        } else {
                            actionCell.replaceChildren();
                        }

                        continue;
                    }

                    row.dataset.sfroTerminalBlocked = invalidatedByCompleted.has(techName) ? '1' : '0';

                    const fullCost = parseNumber(cells[3].textContent);
                    if (!fullCost || fullCost <= 0) {
                        row.dataset.sfroRemainingRp = '0';
                        row.dataset.sfroEtaTicks = '0';
                        continue;
                    }

                    let remainingPoints = fullCost;

                    if (isActive && activeResearch && activeResearch.name === techName) {
                        remainingPoints = activeResearch.remaining;
                        row.classList.add('sfro-active');
                        renderRpEta(cells[3], remainingPoints, researchRate, true);
                    } else {
                        if (isQueued) {
                            row.classList.add('sfro-queued');
                        }

                        renderRpEta(cells[3], remainingPoints, researchRate, false);
                    }

                    const etaTicks = researchRate > 0
                        ? Math.ceil(remainingPoints / researchRate)
                        : 0;

                    row.dataset.sfroRemainingRp = String(remainingPoints);
                    row.dataset.sfroEtaTicks = String(etaTicks);
                    row.dataset.sfroSection = currentSectionName;

                }

                addSectionSummaries(table, researchRate);
                addCompletedToggle(table);
            }

            function findResearchSectionTitle(pattern) {
                return [...document.querySelectorAll('.sectionTitle')]
                    .find(el => pattern.test(normalizeText(el.textContent))) || null;
            }

            function getSectionNoticeBody(sectionTitle) {
                if (!sectionTitle) return null;

                let node = sectionTitle.nextElementSibling;
                while (node && !node.classList.contains('noticeBody')) {
                    node = node.nextElementSibling;
                }

                return node || null;
            }

            function addResearchStalledBadge(sectionTitle) {
                if (!sectionTitle || sectionTitle.querySelector('.sfro-research-stalled-badge')) return;

                const badge = ctx.element('span');
                badge.className = 'sfro-research-stalled-badge';
                badge.textContent = 'Research Stalled · 0 RP/t';
                badge.title =
                    'Research work exists, but the empire is currently producing 0 Research Points per Tick.';

                sectionTitle.appendChild(badge);
            }

            function handleZeroResearchState(researchRate, activeResearch) {
                if (researchRate !== 0) return false;

                const activeTitle = findResearchSectionTitle(/Active Research/i);
                const queueTitle = findResearchSectionTitle(/Research Queue/i);
                const activeBody = getSectionNoticeBody(activeTitle);
                const queueState = queueTitle
                    ? getQueueRows(queueTitle)
                    : { noticeBody: null, table: null, items: [] };

                const hasActiveResearch = Boolean(activeResearch);
                const hasQueuedResearch = queueState.items.length > 0;

                /*
                 * Fully idle + 0 RP/t:
                 * Collapse the two empty work-management sections into one explicit
                 * status panel. We intentionally say "no research capacity" rather
                 * than "0 Research Labs", because RP/t is directly observed while lab
                 * count is not independently verified on this page.
                 */
                if (!hasActiveResearch && !hasQueuedResearch) {
                    if (!activeTitle || !activeBody) return false;

                    activeTitle.textContent = 'Research Status';

                    const card = ctx.element('div');
                    card.className = 'sfro-research-inactive-card';

                    const title = ctx.element('div');
                    title.className = 'sfro-research-inactive-title';
                    title.textContent = 'Research Inactive';

                    const meta = ctx.element('div');
                    meta.className = 'sfro-research-inactive-meta';
                    meta.textContent = '0 RP/t · No active research · Queue empty';

                    const note = ctx.element('div');
                    note.className = 'sfro-research-inactive-note';
                    note.textContent =
                        'This empire currently has no research capacity.';

                    card.append(title, meta, note);
                    activeBody.replaceChildren(card);

                    if (queueTitle) {
                        const queueBody = queueState.noticeBody;
                        queueTitle.remove();
                        if (queueBody) queueBody.remove();
                    }

                    return true;
                }

                /*
                 * Work exists + 0 RP/t:
                 * Keep the sections visible so stalled research is never hidden, but
                 * clearly mark the affected work as stalled.
                 */
                if (hasActiveResearch) addResearchStalledBadge(activeTitle);
                if (hasQueuedResearch) addResearchStalledBadge(queueTitle);

                return false;
            }

            // ---------------------------------------------------------------------
            // Active Research component
            // ---------------------------------------------------------------------
            function optimizeActiveResearch(researchRate, activeResearch) {
                if (!researchRate || !activeResearch) return;

                const sectionTitle = findResearchSectionTitle(/Active Research/i);
                if (!sectionTitle) return;

                const node = getSectionNoticeBody(sectionTitle);
                const table = node?.querySelector('table.basictable');
                if (!table || node.querySelector('.sfro-active-card')) return;

                const rows = table.querySelectorAll('tr');
                if (rows.length < 2) return;

                const cells = rows[1].querySelectorAll('td');
                if (cells.length < 5) return;

                const cancelLink = cells[4].querySelector('a');
                const percentExact = activeResearch.total > 0
                    ? (activeResearch.achieved / activeResearch.total) * 100
                    : 0;
                const ticks = Math.ceil(activeResearch.remaining / researchRate);
                const effect = TECH_SUMMARIES[activeResearch.name] || '';

                const card = ctx.element('div');
                card.className = 'sfro-active-card';

                const top = ctx.element('div');
                top.className = 'sfro-active-card-top';

                const titleWrap = ctx.element('div');
                titleWrap.className = 'sfro-active-card-title-wrap';

                const title = ctx.element('div');
                title.className = 'sfro-active-card-title';
                title.textContent = activeResearch.name;

                titleWrap.appendChild(title);

                if (effect) {
                    const effectLine = ctx.element('div');
                    effectLine.className = 'sfro-active-card-effect';
                    effectLine.textContent = effect;
                    effectLine.title = effect;
                    titleWrap.appendChild(effectLine);
                }

                const actions = ctx.element('div');
                actions.className = 'sfro-active-card-actions';

                const eta = ctx.element('span');
                eta.className = 'sfro-active-big-eta';
                eta.textContent = `≈${ticks} ticks left`;
                eta.title = `${activeResearch.remaining.toLocaleString()} RP remaining ÷ ${researchRate.toLocaleString()} RP/tick = ${ticks} ticks`;

                actions.appendChild(eta);

                if (cancelLink) {
                    cancelLink.classList.add('sfro-active-cancel');
                    cancelLink.title = 'Cancel research and lose all current progress';
                    actions.appendChild(cancelLink);
                }

                top.append(titleWrap, actions);

                const progress = ctx.element('div');
                progress.className = 'sfro-active-progress';
                progress.title = `${percentExact.toFixed(1)}% complete`;

                const fill = ctx.element('div');
                fill.className = 'sfro-active-progress-fill';
                fill.style.width = `${Math.max(0, Math.min(100, percentExact))}%`;
                progress.appendChild(fill);

                const meta = ctx.element('div');
                meta.className = 'sfro-active-meta';

                const progressText = ctx.element('span');
                progressText.innerHTML =
                    `<strong>${activeResearch.achieved.toLocaleString()}</strong> / ${activeResearch.total.toLocaleString()} RP`;

                const percent = ctx.element('span');
                percent.className = 'sfro-active-percent';
                percent.innerHTML = `<strong>${percentExact.toFixed(1)}%</strong> complete`;

                const remaining = ctx.element('span');
                remaining.innerHTML = `<strong>${activeResearch.remaining.toLocaleString()}</strong> RP remaining`;

                const rate = ctx.element('span');
                rate.className = 'sfro-active-rate';
                rate.textContent = `${researchRate.toLocaleString()} RP/tick`;

                meta.append(progressText, percent, remaining, rate);
                card.append(top, progress, meta);

                table.replaceWith(card);
            }

            // ---------------------------------------------------------------------
            // Research Queue component
            // ---------------------------------------------------------------------
            function getQueueRows(sectionTitle) {
                let node = sectionTitle.nextElementSibling;
                while (node && !node.classList.contains('noticeBody')) {
                    node = node.nextElementSibling;
                }

                if (!node) return { noticeBody: null, table: null, items: [] };

                const table = node.querySelector('table.basictable');
                if (!table) return { noticeBody: node, table: null, items: [] };

                const items = [];

                for (const row of [...table.querySelectorAll('tr')].slice(1)) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 4) continue;

                    const order = parseNumber(cells[0].textContent);
                    const name = normalizeText(cells[1].textContent);
                    const points = parseNumber(cells[2].textContent);
                    const removeLink = cells[3].querySelector('a');

                    if (!name || !points || points <= 0) continue;

                    items.push({
                        order: order || items.length + 1,
                        name,
                        points,
                        removeLink
                    });
                }

                return { noticeBody: node, table, items };
            }

            function optimizeQueue(researchRate, activeResearch) {
                if (!researchRate) return;

                const sectionTitle = [...document.querySelectorAll('.sectionTitle')]
                    .find(el => /Research Queue/i.test(normalizeText(el.textContent)));
                if (!sectionTitle) return;
                sectionTitle.classList.add('sfro-queue-title');
                if (sectionTitle.dataset.sfroQueueDone === '1') return;

                const { noticeBody, table, items } = getQueueRows(sectionTitle);
                if (!noticeBody) return;

                const activeTicks = activeResearch
                    ? Math.ceil(activeResearch.remaining / researchRate)
                    : 0;

                const totalQueueRp = items.reduce((sum, item) => sum + item.points, 0);
                const totalQueueTicks = items.reduce(
                    (sum, item) => sum + Math.ceil(item.points / researchRate),
                    0
                );

                const titleSummary = ctx.element('span');
                titleSummary.className = 'sfro-queue-title-summary';

                if (items.length) {
                    titleSummary.textContent =
                        `· ${totalQueueRp.toLocaleString()} RP · ≈${totalQueueTicks} queued ticks`;
                    titleSummary.title =
                        'Queued ticks are the sum of each item rounded up separately at the current RP/tick rate.';
                } else {
                    titleSummary.textContent = '· Empty';
                }

                sectionTitle.appendChild(titleSummary);
                sectionTitle.dataset.sfroQueueDone = '1';

                if (!items.length) {
                    if (table) table.remove();

                    const empty = ctx.element('div');
                    empty.className = 'sfro-queue-empty';
                    empty.textContent = 'No research queued';
                    noticeBody.replaceChildren(empty);
                    return;
                }

                const list = ctx.element('div');
                list.className = 'sfro-queue-list';

                let cumulativeTicks = activeTicks;

                items.forEach((item, index) => {
                    const durationTicks = Math.ceil(item.points / researchRate);
                    cumulativeTicks += durationTicks;

                    const row = ctx.element('div');
                    row.className = 'sfro-queue-item';

                    const order = ctx.element('div');
                    order.className = 'sfro-queue-order';
                    order.textContent = index === 0 ? 'NEXT' : `#${item.order}`;

                    const main = ctx.element('div');
                    main.className = 'sfro-queue-main';

                    const tech = ctx.element('div');
                    tech.className = 'sfro-queue-tech';
                    tech.textContent = item.name;

                    main.appendChild(tech);

                    const effect = TECH_SUMMARIES[item.name] || '';
                    if (effect) {
                        const effectLine = ctx.element('div');
                        effectLine.className = 'sfro-queue-effect';
                        effectLine.textContent = effect;
                        effectLine.title = effect;
                        main.appendChild(effectLine);
                    }

                    const metrics = ctx.element('div');
                    metrics.className = 'sfro-queue-metrics';

                    const rp = ctx.element('span');
                    rp.textContent = `${item.points.toLocaleString()} RP`;

                    const duration = ctx.element('span');
                    duration.className = 'sfro-queue-duration';
                    duration.textContent = `${durationTicks} ticks`;
                    duration.title = `${item.points.toLocaleString()} RP ÷ ${researchRate.toLocaleString()} RP/tick = ${durationTicks} ticks`;

                    const complete = ctx.element('span');
                    complete.className = 'sfro-queue-complete';
                    complete.textContent = `≈${cumulativeTicks} ticks from now`;
                    complete.title =
                        'Approximate completion from now. Assumes the current RP/tick rate stays constant and conservatively rounds each research item separately; RP carryover between finishing ticks is not assumed.';

                    metrics.append(rp, duration, complete);

                    let action = ctx.element('span');

                    if (item.removeLink) {
                        item.removeLink.classList.add('sfro-queue-remove');
                        item.removeLink.title = 'Remove this item from the research queue';
                        action = item.removeLink;
                    }

                    row.append(order, main, metrics, action);
                    list.appendChild(row);
                });

                if (table) {
                    table.replaceWith(list);
                } else {
                    noticeBody.replaceChildren(list);
                }
            }

            // ---------------------------------------------------------------------
            // Bootstrap
            // ---------------------------------------------------------------------
            function run() {
                injectStyles();

                const researchRate = getResearchRate();
                const activeResearch = getActiveResearch();

                for (const table of document.querySelectorAll('.noticeBody table.basictable')) {
                    optimizeTechTree(table, researchRate, activeResearch);
                }

                handleZeroResearchState(researchRate, activeResearch);

                optimizeActiveResearch(researchRate, activeResearch);
                optimizeQueue(researchRate, activeResearch);
            }


            return { init() { return run(); }, destroy: ctx.destroy };
        }
    });
}

/* StarFury UX Suite 2.0.1 | Buildings UX module. */
function registerBuildingsUX(SFUX) {
    SFUX.register({
        id: 'buildings', phase: 'ready',
        matches(path, url) { return path === '/buildings.php'; },
        create(ctx) {
            const SETTINGS_KEY = 'sfBuildingCalculatorSettingsV2';
            const CACHE_VERSION = 7;

            const PRODUCTION_RESEARCH = [
                'Population Tax I',
                'Population Tax II',
                'Advanced Power I',
                'Advanced Power II',
                'Advanced Mines I',
                'Advanced Mines II',
                'Iridium Mines',
                'Fabrication Plants',
                'Advanced Fabrication Plants I',
                'Advanced Fabrication Plants II'
            ];

            const DEFAULT_SETTINGS = {
                autoDetectResearch: true,
                autoCalibrateProduction: true,
                manualResearch: {
                    'Population Tax I': false,
                    'Population Tax II': false,
                    'Advanced Power I': false,
                    'Advanced Power II': false,
                    'Advanced Mines I': false,
                    'Advanced Mines II': false,
                    'Iridium Mines': false,
                    'Fabrication Plants': false,
                    'Advanced Fabrication Plants I': false,
                    'Advanced Fabrication Plants II': false
                },
                fallbackResearchPerLab: 3.75,

                /*
                 * Defence Platforms are unlocked through alliance leadership and are
                 * not reported on /production.php. Use a configurable raw defence
                 * value until the live Season 8 mechanic is confirmed.
                 *
                 * Confirmed value: 15 defence points/platform.
                 * No race/research/shield/global modifier is applied here.
                 */
                fallbackDefencePerPlatform: 15 /* CONFIRMED GAME MECHANIC: unmodified platform defence. */
            };

            const runtimeContext = {
                empireKey: null,
                serverHourBucket: null,
                detectedResearch: null
            };

            // ---------------------------------------------------------------------
            // Generic helpers and safe input behavior
            // ---------------------------------------------------------------------
            const normalizeText = SFUX.dom.key;





            const configureNonNegativeIntegerInput = input => SFUX.ui.number(ctx, input, { blankZero: true, step: 1 });

            const parseNumber = SFUX.format.number;

            function getCellNumber(cell) {
                return parseNumber(cell?.textContent) ?? 0;
            }

            const formatNumber = SFUX.format.integer;

            function inferSimpleRate(displayedTotal, builtCount) {
                if (
                    displayedTotal == null ||
                    !Number.isFinite(displayedTotal) ||
                    !builtCount
                ) {
                    return null;
                }

                const rawRate = displayedTotal / builtCount;
                const candidateSteps = [
                    1,
                    0.5,
                    0.25,
                    0.1,
                    0.05,
                    0.025,
                    0.01,
                    0.005,
                    0.001
                ];

                for (const step of candidateSteps) {
                    const candidate = Math.round(rawRate / step) * step;
                    const resultingTotal = Math.floor((candidate * builtCount) + 1e-9);

                    if (resultingTotal === Math.floor(displayedTotal)) {
                        return candidate;
                    }
                }

                return rawRate;
            }

            function getServerClock() {
                const header = document.querySelector('#headertext');
                const time = document.querySelector('#displayTime')?.textContent?.trim();

                if (!header || !time) return null;

                const dateText = header.textContent
                    .replace(time, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .replace(/-\s*$/, '')
                    .trim();

                const hourMatch = time.match(/^(\d{2}):\d{2}:\d{2}$/);
                if (!hourMatch) return null;

                return {
                    dateText,
                    time,
                    hourBucket: `${dateText}|${hourMatch[1]}`,
                    fullLabel: `${dateText} - ${time}`
                };
            }

            function identifyCurrentEmpire() {
                const switchButton = document.querySelector(
                    'form[action*="switchempire"] input[type="submit"]'
                );

                if (!switchButton) return null;

                const buttonText = normalizeText(switchButton.value);

                // The button names the empire you would switch TO.
                if (buttonText.includes('second empire')) return 'primary';
                if (buttonText.includes('primary empire')) return 'secondary';

                return null;
            }

            function getCacheKey(empireKey) {
                return empireKey
                    ? `sfBuildingCalculatorCacheV${CACHE_VERSION}:${empireKey}`
                    : null;
            }

            function readCache(empireKey, serverHourBucket) {
                const cacheKey = getCacheKey(empireKey);
                if (!cacheKey || !serverHourBucket) return null;

                const cached = SFUX.storage.get(cacheKey, null);

                if (
                    !cached ||
                    cached.version !== CACHE_VERSION ||
                    cached.serverHourBucket !== serverHourBucket ||
                    !cached.research ||
                    !cached.rates ||
                    !cached.snapshot
                ) {
                    return null;
                }

                return cached;
            }

            function writeCache(empireKey, serverClock, research, rates, snapshot) {
                const cacheKey = getCacheKey(empireKey);
                if (!cacheKey || !serverClock?.hourBucket) return;

                SFUX.storage.set(cacheKey, {
                    version: CACHE_VERSION,
                    serverHourBucket: serverClock.hourBucket,
                    cachedAtServerTime: serverClock.time,
                    cachedAtServerLabel: serverClock.fullLabel,
                    savedAt: Date.now(),
                    research,
                    rates,
                    snapshot
                });
            }

            function clearEmpireCache(empireKey) {
                const cacheKey = getCacheKey(empireKey);
                if (cacheKey) SFUX.storage.delete(cacheKey);
            }

            function clearAllCaches() {
                clearEmpireCache('primary');
                clearEmpireCache('secondary');
            }

            function loadSettings() {
                const saved = SFUX.storage.get(SETTINGS_KEY, {});

                return {
                    ...DEFAULT_SETTINGS,
                    ...saved,
                    manualResearch: {
                        ...DEFAULT_SETTINGS.manualResearch,
                        ...(saved.manualResearch || {})
                    }
                };
            }

            function saveSettings(settings) {
                SFUX.storage.set(SETTINGS_KEY, settings);
                clearAllCaches();
            }

            // ---------------------------------------------------------------------
            // Userscript-only data adapters
            // Native StarFury should pass this data directly to the Buildings template.
            // ---------------------------------------------------------------------
            async function fetchDocument(path) {
                const url = new URL(path, window.location.origin);
                const response = await ctx.fetch(url.href, {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store'
                });

                if (!response.ok) {
                    throw new Error(`Unable to fetch ${path}: HTTP ${response.status}`);
                }

                const html = await response.text();
                return new DOMParser().parseFromString(html, 'text/html');
            }

            function getCurrentPopulation() {
                const stats = Array.from(document.querySelectorAll('#statbar .stats'));
                const populationStat = stats.find(stat =>
                    normalizeText(stat.textContent).startsWith('population:')
                );

                return populationStat ? parseNumber(populationStat.textContent) : null;
            }

            function detectCompletedResearch(techDocument) {
                const detected = {};

                for (const name of PRODUCTION_RESEARCH) {
                    detected[name] = false;
                }

                for (const row of techDocument.querySelectorAll('tr')) {
                    const rowText = normalizeText(row.textContent);
                    if (!rowText) continue;

                    for (const researchName of PRODUCTION_RESEARCH) {
                        if (
                            Array.from(row.cells || []).some(cell => normalizeText(cell.textContent) === normalizeText(researchName)) &&
                            row.querySelector('a[href^="#remove"]')
                        ) {
                            detected[researchName] = true;
                        }
                    }
                }

                return detected;
            }

            function getResearchPointsPerTick(techDocument) {
                const bodyText = techDocument.body?.textContent || '';
                const match = bodyText.match(/([\d,]+)\s*Research Points Per Tick/i);
                return match ? parseNumber(match[1]) : null;
            }

            function getProductionValue(productionDocument, label) {
                const wantedLabel = normalizeText(label);

                for (const row of productionDocument.querySelectorAll('tr')) {
                    const cells = Array.from(row.cells || []);
                    if (cells.length < 2) continue;

                    if (normalizeText(cells[0].textContent) === wantedLabel) {
                        return parseNumber(cells[cells.length - 1].textContent);
                    }
                }

                return null;
            }

            function readProductionPage(productionDocument) {
                return {
                    power: getProductionValue(productionDocument, 'Power Production'),
                    metal: getProductionValue(productionDocument, 'Metal Production'),
                    deuterium: getProductionValue(productionDocument, 'Deuterium Production'),
                    iridium: getProductionValue(productionDocument, 'Iridium Production'),
                    population: getProductionValue(productionDocument, 'Population Per Tick'),
                    populationCapacity: getProductionValue(productionDocument, 'Population Capacity'),
                    recruits: getProductionValue(productionDocument, 'Recruits Per Tick'),
                    probes: getProductionValue(productionDocument, 'Probe Production'),
                    credits: getProductionValue(productionDocument, 'Credit Production'),
                    militaryRunningCosts: getProductionValue(productionDocument, 'Military Ship Running Costs'),
                    netCredits: getProductionValue(productionDocument, 'Credits Per Tick')
                };
            }

            // ---------------------------------------------------------------------
            // Presentation layer
            // Userscript-only: native StarFury should move these rules into its stylesheet.
            // ---------------------------------------------------------------------
            function addStyles() { ctx.style('sfux-buildings-style', `
                    /* -------------------------------------------------------------
                     * Building page design system
                     * ----------------------------------------------------------- */
                    table.buildings.sf-buildings-enhanced {
            width: 100%;
            border-collapse: collapse;
            font-variant-numeric: tabular-nums;
                    }

                    /*
                     * Keep every building row on the same neutral surface. Construction
                     * state is communicated locally in the In Progress cell rather than
                     * tinting an entire Asteroid/Land table differently.
                     */
                    table.buildings.sf-buildings-enhanced tr.sf-building-row > td {
            background: rgba(255, 255, 255, 0.018) !important;
                    }

                    table.buildings.sf-buildings-enhanced .sf-built-cell,
                    table.buildings.sf-buildings-enhanced .sf-building-cell,
                    table.buildings.sf-buildings-enhanced .sf-total-cell,
                    table.buildings.sf-buildings-enhanced .sf-max-cell,
                    table.buildings.sf-buildings-enhanced .sf-construct-cell {
            text-align: center;
                    }

                    /*
                     * Availability matters at the point of action. Keep the section-level
                     * summary for context, but repeat the relevant pool immediately beneath
                     * each Construct input so the player does not need to scan back left/up.
                     */
                    .sf-construct-available {
            margin-top: 4px;
            color: rgba(255,255,255,0.46);
            font-size: 10.5px;
            font-weight: 500;
            line-height: 1.15;
            text-align: center;
            white-space: nowrap;
                    }

                    .sf-construct-available strong {
            color: rgba(255,255,255,0.82);
            font-size: 11px;
            font-weight: 700;
                    }

                    table.buildings.sf-buildings-enhanced tr.sf-under-construction > .sf-building-cell {
            background: rgba(218, 171, 64, 0.065) !important;
            box-shadow: inset 2px 0 0 rgba(var(--sfux-warning-rgb), 0.42);
                    }

                    .sf-main-number,
                    .sf-total-number {
            font-size: 14px;
            line-height: 1.2;
            font-weight: 700;
                    }

                    .sf-under-construction .sf-building-cell .sf-main-number,
                    .sf-under-construction .sf-building-cell .sf-subtext {
            color: var(--sfux-warning);
                    }

                    .sf-subtext,
                    .sf-current-production,
                    .sf-projected-production,
                    .sf-production-delta {
            margin-top: 3px;
            font-size: 11px;
            line-height: 1.2;
            font-weight: 400;
            white-space: normal;
                    }

                    .sf-subtext,
                    .sf-current-production {
            color: rgba(255, 255, 255, 0.58);
                    }

                    .sf-projected-production {
            color: rgba(255, 255, 255, 0.76);
                    }

                    .sf-current-production,
                    .sf-projected-production {
            min-height: 14px;
                    }

                    .sf-production-delta {
            color: rgba(var(--sfux-success-rgb), 0.88);
            font-weight: 700;
                    }

                    .sf-production-delta:empty {
            display: none;
                    }

                    .sf-mobile-building-summary {
            display: none;
                    }

                    .sf-credit-line {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            white-space: nowrap;
                    }

                    .sf-credit-status-dot {
            display: inline-block;
            width: 7px;
            height: 7px;
            flex: 0 0 7px;
            border-radius: 50%;
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
                    }

                    .sf-credit-positive { background: var(--sfux-success); }
                    .sf-credit-negative { background: var(--sfux-danger); }
                    .sf-credit-neutral  { background: var(--sfux-text-muted); }

                    /* Empire-level credit economics do not belong inside the Residents row. */
                    .sf-credit-economy {
            display: none;
            margin: 7px 10px 2px;
            padding: 0;
            border: 1px solid rgba(255,255,255,0.065);
            border-left: 2px solid rgba(109,148,176,0.34);
            background: rgba(255,255,255,0.018);
            font-variant-numeric: tabular-nums;
                    }

                    .sf-credit-economy.sf-visible {
            display: block;
                    }

                    .sf-credit-economy > .sf-credit-economy-title,
                    .sf-credit-economy > .sf-credit-economy-state,
                    .sf-credit-economy > .sf-credit-economy-detail {
            display: none !important;
                    }

                    /*
                     * Desktop uses the same Gross / Military Upkeep / Net data model as
                     * mobile, but takes advantage of the width to keep the metric groups
                     * together on a compact second row.
                     */
                    .sf-credit-economy-ledger {
            display: grid;
            grid-template-columns:
                minmax(0, 1fr)
                auto auto
                auto auto
                auto auto;
            grid-template-areas:
                "title gross-label gross-value military-label military-value net-label net-value";
            align-items: center;
            row-gap: 0;
            column-gap: 6px;
            padding: 7px 10px 8px;
            color: rgba(255,255,255,0.68);
            font-size: 11px;
            line-height: 1.2;
                    }

                    .sf-credit-ledger-title {
            grid-area: title;
            justify-self: start;
            text-align: left;
            color: rgba(255,255,255,0.58);
            font-size: 10.5px;
            font-weight: 700;
            letter-spacing: 0.045em;
            text-transform: uppercase;
            white-space: nowrap;
                    }

                    .sf-credit-ledger-progress {
            display: none;
            grid-area: progress;
            justify-self: end;
            color: rgba(255,255,255,0.54);
            font-size: 10.5px;
            font-weight: 500;
            text-align: right;
            white-space: nowrap;
                    }

                    .sf-credit-ledger-label {
            color: rgba(255,255,255,0.54);
            font-weight: 600;
            white-space: nowrap;
            text-align: left;
            justify-self: start;
                    }

                    .sf-credit-ledger-value {
            color: rgba(255,255,255,0.82);
            font-weight: 700;
            text-align: right;
            justify-self: end;
            white-space: nowrap;
                    }

                    .sf-credit-ledger-gross-label { grid-area: gross-label; }
                    .sf-credit-ledger-gross-value { grid-area: gross-value; }
                    .sf-credit-ledger-military-label {
            grid-area: military-label;
            margin-left: 18px;
                    }
                    .sf-credit-ledger-military-value { grid-area: military-value; }
                    .sf-credit-ledger-net-label {
            grid-area: net-label;
            margin-left: 18px;
                    }
                    .sf-credit-ledger-net-value {
            grid-area: net-value;
            color: rgba(255,255,255,0.62);
                    }

                    /*
                     * Current and projected Net can cross zero independently.
                     * Color each number rather than the entire transition container.
                     */
                    .sf-credit-net-part.sf-net-positive {
            color: rgba(var(--sfux-success-rgb), 0.94);
                    }

                    .sf-credit-net-part.sf-net-negative {
            color: rgba(var(--sfux-danger-rgb), 0.94);
                    }

                    .sf-credit-net-part.sf-net-neutral {
            color: rgba(var(--sfux-warning-rgb), 0.92);
                    }

                    .sf-credit-net-arrow {
            margin: 0 4px;
            color: rgba(255,255,255,0.42);
            font-weight: 500;
                    }

                    /* Section-level state belongs in the section header, not a repeated Max column. */
                    .sectionTitle.sf-building-section-title {
            display: flex;
            align-items: center;
            gap: 12px;
            box-sizing: border-box;
            width: 100%;
            margin-top: 10px !important;
            padding: 8px 10px !important;
            border-top: 2px solid rgba(109, 148, 176, 0.28);
            border-bottom: 1px solid rgba(0, 0, 0, 0.48);
            background: linear-gradient(
                180deg,
                rgba(68, 88, 104, 0.32),
                rgba(43, 56, 67, 0.28)
            );
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
                    }

                    .sectionTitle.sf-building-section-title + .hrBar {
            display: none;
                    }

                    .sf-building-section-main {
            display: flex;
            align-items: baseline;
            gap: 10px;
            min-width: 0;
            flex: 1 1 auto;
                    }

                    .sf-building-section-name {
            color: var(--sfux-text-primary);
            font-size: 14px;
            font-weight: 700;
            white-space: nowrap;
                    }

                    .sf-building-section-meta {
            color: rgba(255,255,255,0.60);
            font-size: 12px;
            font-weight: 500;
            white-space: nowrap;
                    }

                    .sectionTitle.sf-building-section-title > .right.sf-building-section-action {
            float: none !important;
            margin: 0 0 0 auto !important;
            flex: 0 0 auto;
                    }

                    .sf-building-section-action .button {
            min-height: 0 !important;
            margin: 0 !important;
            padding: 3px 7px !important;
            border: 1px solid rgba(255,255,255,0.10) !important;
            background: rgba(255,255,255,0.025) !important;
            color: rgba(255,255,255,0.42) !important;
            font-size: 11px !important;
            line-height: 1.35 !important;
            opacity: 1 !important;
            text-transform: none !important;
            transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
                    }

                    .sf-building-section-action .button:hover,
                    .sf-building-section-action .button:focus {
            border-color: rgba(220, 126, 68, 0.45) !important;
            background: rgba(220, 126, 68, 0.07) !important;
            color: rgba(239, 157, 101, 0.92) !important;
                    }

                    /* Calculator freshness is useful, but should not compete with page content. */
                    .sf-calculator-header-meta {
            float: right;
            display: flex;
            align-items: center;
            gap: 7px;
            margin-right: 4px;
            font-size: 11px;
            font-weight: 400;
            line-height: inherit;
            color: rgba(255, 255, 255, 0.50);
                    }

                    .sf-refresh-link {
            color: rgba(255, 255, 255, 0.72) !important;
            text-decoration: none !important;
            cursor: pointer;
            font-weight: 600;
                    }

                    .sf-refresh-link:hover {
            color: #fff !important;
            text-decoration: none !important;
                    }

                    /* -------------------------------------------------------------
                     * Desktop table layout
                     * ----------------------------------------------------------- */
                    @media (min-width: ${SFUX.responsive.buildings + 1}px) {
            table.buildings.sf-buildings-enhanced {
                table-layout: auto !important;
            }

            table.buildings.sf-buildings-enhanced tr:first-child > td {
                position: sticky;
                top: 0;
                z-index: 15;
                padding-top: 8px !important;
                padding-bottom: 8px !important;
                background: rgba(38, 42, 46, 0.98) !important;
                border-top: 1px solid rgba(255,255,255,0.06) !important;
                border-bottom: 1px solid rgba(109,148,176,0.28) !important;
                box-shadow: 0 3px 6px rgba(0,0,0,0.30);
                white-space: nowrap;
            }

            table.buildings.sf-buildings-enhanced tr:not(:first-child) > td {
                padding-top: 7px !important;
                padding-bottom: 7px !important;
                vertical-align: middle !important;
            }

            /*
             * Give production values enough room to remain readable instead of
             * forcing them into tall word-wrapped columns. Building Type absorbs
             * whatever horizontal space remains.
             */
            table.buildings.sf-buildings-enhanced tr > td:nth-child(1) {
                width: 66px !important;
                min-width: 66px !important;
                max-width: 66px !important;
                white-space: nowrap;
            }

            table.buildings.sf-buildings-enhanced tr > td:nth-child(2) {
                width: auto !important;
                min-width: 165px;
            }

            table.buildings.sf-buildings-enhanced tr > td:nth-child(3) {
                width: 142px !important;
                min-width: 142px !important;
            }

            table.buildings.sf-buildings-enhanced tr > td:nth-child(4) {
                width: 92px !important;
                min-width: 92px !important;
            }

            table.buildings.sf-buildings-enhanced tr > td:nth-child(5) {
                width: 158px !important;
                min-width: 158px !important;
            }

            table.buildings.sf-buildings-enhanced tr > td:nth-child(6) {
                width: 112px !important;
                min-width: 112px !important;
            }

            table.buildings.sf-buildings-enhanced .sf-current-production,
            table.buildings.sf-buildings-enhanced .sf-projected-production,
            table.buildings.sf-buildings-enhanced .sf-production-delta {
                white-space: nowrap;
            }

            table.buildings.sf-buildings-enhanced .mobile-hidden img {
                display: block;
                width: 58px;
                max-width: 58px;
                height: auto;
                margin: 0 auto;
            }

            table.buildings.sf-buildings-enhanced .sf-construct-cell .buildingsInput {
                width: 84px !important;
                min-height: 36px;
                margin-bottom: 0 !important;
                box-sizing: border-box;
                text-align: center;
            }
                    }

                    /* -------------------------------------------------------------
                     * Mobile cards
                     * ----------------------------------------------------------- */
                    @media (max-width: ${SFUX.responsive.buildings}px) {
            /*
             * Mobile reflows the universal credit ledger into the same compact
             * two-column grammar used by the Raze demolition summary.
             */
            .sf-credit-economy {
                margin: 6px 8px 1px;
                border-left-color: rgba(109,148,176,0.32);
            }

            .sf-credit-economy-ledger {
                grid-template-columns: minmax(0, 1fr) auto;
                grid-template-areas:
                    "title progress"
                    "gross-label gross-value"
                    "military-label military-value"
                    "net-label net-value";
                gap: 4px 10px;
                padding: 7px 8px 8px;
                font-size: 11px;
            }

            .sf-credit-ledger-progress {
                display: block;
            }

            .sf-credit-ledger-military-label,
            .sf-credit-ledger-net-label {
                margin-left: 0;
            }

            .sf-buildings-boxheader {
                display: flex !important;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                min-width: 0;
                padding-right: 6px !important;
            }

            .sf-calculator-header-meta {
                float: none !important;
                flex: 0 0 auto;
                justify-content: flex-end;
                margin: 0 !important;
                font-size: 10.5px;
                line-height: 1.15;
                white-space: nowrap;
            }

            .sf-calculator-header-meta #sf-cache-status {
                white-space: nowrap;
            }

            .sectionTitle.sf-building-section-title {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 6px 8px;
                padding: 8px 8px !important;
            }

            .sf-building-section-main {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 2px;
            }

            .sf-building-section-name {
                font-size: 13px;
                white-space: normal;
            }

            .sf-building-section-meta {
                font-size: 11px;
                line-height: 1.2;
                white-space: normal;
            }

            .sf-building-section-action .button {
                min-height: 30px !important;
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                padding: 6px 8px !important;
            }

            html[data-sfux-page="buildings"] .responsive-table-container {
                overflow: visible !important;
            }

            table.buildings.sf-buildings-enhanced,
            table.buildings.sf-buildings-enhanced > tbody {
                display: block !important;
                width: 100% !important;
            }

            table.buildings.sf-buildings-enhanced tr:first-child {
                display: none !important;
            }

            /*
             * On mobile, the type cell contains the compact building summary.
             * Built/In Progress/Total desktop cells are hidden to avoid repeating
             * the same facts as three vertically expensive labelled blocks.
             */
            table.buildings.sf-buildings-enhanced tr.sf-building-row {
                display: grid !important;
                grid-template-columns: minmax(0, 1fr) 86px;
                grid-template-areas: "type construct";
                width: 100% !important;
                min-width: 0 !important;
                border-bottom: 1px solid rgba(255,255,255,0.055);
                border-left: 2px solid transparent;
                background: rgba(255,255,255,0.018) !important;
            }

            table.buildings.sf-buildings-enhanced tr.sf-under-construction {
                border-left-color: rgba(var(--sfux-warning-rgb), 0.52);
                background: rgba(255,255,255,0.018) !important;
            }

            table.buildings.sf-buildings-enhanced tr.sf-building-row > td {
                width: auto !important;
                min-width: 0 !important;
                height: auto !important;
                box-sizing: border-box;
                border: 0 !important;
                background: transparent !important;
            }

            table.buildings.sf-buildings-enhanced tr.sf-building-row > td.mobile-hidden,
            table.buildings.sf-buildings-enhanced tr.sf-building-row > td.sf-built-cell,
            table.buildings.sf-buildings-enhanced tr.sf-building-row > td.sf-building-cell,
            table.buildings.sf-buildings-enhanced tr.sf-building-row > td.sf-total-cell {
                display: none !important;
            }

            table.buildings.sf-buildings-enhanced tr.sf-building-row > td.sf-type-cell {
                grid-area: type;
                padding: 8px 7px 8px 8px !important;
                font-size: 13px;
                font-weight: 700;
                line-height: 1.2;
                text-align: left !important;
            }

            table.buildings.sf-buildings-enhanced tr.sf-building-row > td.sf-construct-cell {
                grid-area: construct;
                display: flex !important;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 7px 4px !important;
                align-self: stretch;
            }

            .sf-mobile-building-summary {
                display: block;
                margin-top: 5px;
                font-weight: 400;
            }

            .sf-mobile-count-line {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 2px 10px;
                color: rgba(255,255,255,0.64);
                font-size: 10.5px;
                line-height: 1.25;
            }

            .sf-mobile-count-line strong {
                color: rgba(255,255,255,0.90);
                font-size: 11.5px;
                font-weight: 700;
            }

            .sf-mobile-progress {
                color: rgba(var(--sfux-warning-rgb), 0.94);
                font-weight: 700;
                white-space: nowrap;
            }

            .sf-mobile-production-line {
                margin-top: 3px;
                color: rgba(255,255,255,0.54);
                font-size: 10.5px;
                line-height: 1.3;
                font-weight: 400;
            }

            .sf-mobile-production-line .sf-mobile-projected {
                color: rgba(255,255,255,0.76);
            }

            .sf-mobile-production-line .sf-mobile-delta {
                color: rgba(var(--sfux-success-rgb), 0.92);
                font-weight: 700;
            }

            table.buildings.sf-buildings-enhanced .sf-construct-cell .buildingsInput {
                width: 72px !important;
                min-height: 36px;
                margin: 0 auto !important;
                box-sizing: border-box;
                font-size: 14px !important;
                text-align: center;
            }

            .sf-construct-available {
                margin-top: 3px;
                font-size: 9.5px;
            }

            .sf-construct-available strong {
                font-size: 10px;
            }

            .buttoncenter .button-primary {
                min-height: 42px;
            }
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
            .sf-credit-economy-ledger {
                gap: 3px 7px;
                padding: 6px 7px 7px;
                font-size: 10.5px;
            }

            .sf-credit-ledger-title,
            .sf-credit-ledger-progress {
                font-size: 10px;
            }

            .sf-buildings-boxheader {
                gap: 5px;
            }

            .sf-calculator-header-meta {
                font-size: 10px;
            }

            .sectionTitle.sf-building-section-title {
                grid-template-columns: 1fr auto;
            }

            table.buildings.sf-buildings-enhanced tr.sf-building-row > td.sf-type-cell {
                font-size: 12.5px;
            }

            table.buildings.sf-buildings-enhanced tr.sf-building-row {
                grid-template-columns: minmax(0, 1fr) 82px;
            }

            table.buildings.sf-buildings-enhanced .sf-construct-cell .buildingsInput {
                width: 68px !important;
            }

            .sf-mobile-count-line,
            .sf-mobile-production-line {
                font-size: 10px;
            }
                    }

                    /* -------------------------------------------------------------
                     * Raze Buildings
                     * Neutral data surfaces with localized destructive-state accents.
                     * ----------------------------------------------------------- */
                    .sf-raze-summary {
            display: none;
            grid-template-columns: auto 1fr auto auto;
            align-items: center;
            gap: 8px 14px;
            margin: 8px 10px 2px;
            padding: 8px 10px;
            border: 1px solid rgba(199,92,92,0.18);
            border-left: 2px solid rgba(199,92,92,0.45);
            background: rgba(255,255,255,0.018);
            color: rgba(255,255,255,0.68);
            font-size: 12px;
            line-height: 1.2;
                    }

                    .sf-raze-summary.sf-visible {
            display: grid;
                    }

                    .sf-raze-summary-title {
            color: rgba(255,255,255,0.58);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .035em;
            text-transform: uppercase;
            white-space: nowrap;
                    }

                    .sf-raze-summary-rate {
            color: rgba(255,255,255,0.72);
            white-space: nowrap;
                    }

                    .sf-raze-summary-selected,
                    .sf-raze-summary-cost {
            white-space: nowrap;
            font-weight: 700;
                    }

                    .sf-raze-summary-selected {
            color: rgba(255,255,255,0.78);
                    }

                    .sf-raze-summary-cost {
            color: rgba(var(--sfux-danger-rgb), 0.94);
                    }

                    .sectionTitle.sf-raze-section-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-top: 16px !important;
            padding: 8px 10px !important;
            border-top: 2px solid rgba(205,78,78,0.62) !important;
            border-bottom: 1px solid rgba(205,78,78,0.38) !important;
            border-left: 1px solid rgba(205,78,78,0.20) !important;
            border-right: 1px solid rgba(205,78,78,0.20) !important;
            background: linear-gradient(
                180deg,
                rgba(82,58,62,0.34),
                rgba(48,42,47,0.30)
            ) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
                    }

                    .sectionTitle.sf-raze-section-title + .hrBar {
            display: none !important;
                    }

                    .sf-raze-section-name {
            color: rgba(255,255,255,0.95);
            font-size: 14px;
            font-weight: 700;
            white-space: nowrap;
                    }

                    .sf-raze-section-meta {
            color: rgba(255,255,255,0.58);
            font-size: 12px;
            font-weight: 500;
            white-space: nowrap;
                    }

                    table.buildingsRaze.sf-raze-enhanced {
            width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse;
            border-left: 1px solid rgba(205,78,78,0.18);
            border-right: 1px solid rgba(205,78,78,0.18);
            border-bottom: 1px solid rgba(205,78,78,0.22);
            font-size: 13px;
                    }

                    table.buildingsRaze.sf-raze-enhanced tr:first-child td {
            position: sticky;
            top: 0;
            z-index: 8;
            padding: 8px 8px !important;
            background: rgba(38,42,46,0.98) !important;
            border-top: 1px solid rgba(205,78,78,0.22) !important;
            border-bottom: 1px solid rgba(205,78,78,0.48) !important;
            box-shadow: 0 3px 6px rgba(0,0,0,0.28);
            color: rgba(255,255,255,0.74) !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            white-space: nowrap !important;
                    }

                    #contentWide table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row > td {
            padding: 8px 8px !important;
            background: rgba(255,255,255,0.018) !important;
            background-color: rgba(255,255,255,0.018) !important;
            background-image: none !important;
            border-color: rgba(205,78,78,0.10) !important;
            vertical-align: middle !important;
                    }

                    #contentWide table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row.sf-raze-selected > td {
            background: rgba(199,92,92,0.055) !important;
            background-color: rgba(199,92,92,0.055) !important;
            background-image: none !important;
                    }

                    table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row.sf-raze-selected > td:first-child {
            box-shadow: inset 2px 0 0 rgba(var(--sfux-danger-rgb), 0.58);
                    }

                    table.buildingsRaze.sf-raze-enhanced td.sf-raze-icon-cell,
                    table.buildingsRaze.sf-raze-enhanced tr:first-child td:first-child {
            width: 60px !important;
            min-width: 60px !important;
            max-width: 60px !important;
            padding-left: 5px !important;
            padding-right: 5px !important;
            text-align: center !important;
                    }

                    table.buildingsRaze.sf-raze-enhanced td.sf-raze-icon-cell img {
            display: block;
            width: 50px !important;
            height: auto !important;
            max-width: 50px !important;
            margin: 0 auto;
                    }

                    table.buildingsRaze.sf-raze-enhanced td.sf-raze-type,
                    table.buildingsRaze.sf-raze-enhanced tr:first-child td:nth-child(2) {
            width: auto !important;
            text-align: center !important;
                    }

                    table.buildingsRaze.sf-raze-enhanced td.sf-raze-built,
                    table.buildingsRaze.sf-raze-enhanced tr:first-child td:nth-child(3) {
            width: 120px !important;
            min-width: 120px !important;
            text-align: center !important;
                    }

                    table.buildingsRaze.sf-raze-enhanced td.sf-raze-building,
                    table.buildingsRaze.sf-raze-enhanced tr:first-child td:nth-child(4) {
            width: 125px !important;
            min-width: 125px !important;
            text-align: center !important;
                    }

                    table.buildingsRaze.sf-raze-enhanced td.sf-raze-input,
                    table.buildingsRaze.sf-raze-enhanced tr:first-child td:nth-child(5) {
            width: 120px !important;
            min-width: 120px !important;
            text-align: center !important;
                    }

                    table.buildingsRaze.sf-raze-enhanced .sf-raze-main-number {
            color: rgba(255,255,255,0.92);
            font-size: 15px;
            font-weight: 700;
            line-height: 1.15;
                    }

                    table.buildingsRaze.sf-raze-enhanced .buildingsInput {
            width: 84px !important;
            min-height: 36px;
            box-sizing: border-box;
            border-color: rgba(255,255,255,0.28) !important;
            text-align: center;
                    }

                    .sf-raze-mobile-summary {
            display: none;
                    }

                    .sf-raze-submit.button-primary {
            border-color: rgba(199,92,92,0.74) !important;
            background: rgba(154,48,48,0.88) !important;
            color: #fff !important;
                    }

                    .sf-raze-submit.button-primary:hover,
                    .sf-raze-submit.button-primary:focus {
            background: rgba(177,56,56,0.96) !important;
                    }

                    @media (max-width: ${SFUX.responsive.buildings}px) {
            .sf-raze-summary {
                grid-template-columns: minmax(0, 1fr) auto;
                grid-template-areas:
                    "title rate"
                    "selected cost";
                gap: 4px 10px;
                margin: 6px 8px 2px;
                padding: 7px 8px;
            }

            .sf-raze-summary-title {
                grid-area: title;
                align-self: center;
                text-align: left;
            }

            .sf-raze-summary-rate {
                grid-area: rate;
                align-self: center;
                color: rgba(255,255,255,0.52);
                font-size: 10.5px;
                text-align: right;
                white-space: nowrap;
            }

            .sf-raze-summary-selected {
                grid-area: selected;
                align-self: center;
                font-size: 11.5px;
                text-align: left;
            }

            .sf-raze-summary-cost {
                grid-area: cost;
                align-self: center;
                color: rgba(var(--sfux-danger-rgb), 0.94);
                font-size: 11.5px;
                text-align: right;
            }

            .sectionTitle.sf-raze-section-title {
                display: grid;
                grid-template-columns: 1fr;
                gap: 2px;
                padding: 8px !important;
            }

            .sf-raze-section-name {
                font-size: 13px;
            }

            .sf-raze-section-meta {
                font-size: 11px;
                white-space: normal;
            }

            table.buildingsRaze.sf-raze-enhanced,
            table.buildingsRaze.sf-raze-enhanced > tbody {
                display: block !important;
                width: 100% !important;
            }

            table.buildingsRaze.sf-raze-enhanced tr:first-child {
                display: none !important;
            }

            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row {
                display: grid !important;
                grid-template-columns: minmax(0, 1fr) 86px;
                grid-template-areas: "type input";
                width: 100% !important;
                min-width: 0 !important;
                border-bottom: 1px solid rgba(255,255,255,0.055);
                border-left: 2px solid transparent;
                background: rgba(255,255,255,0.018) !important;
            }

            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row.sf-raze-selected {
                border-left-color: rgba(var(--sfux-danger-rgb), 0.62);
                background: rgba(199,92,92,0.045) !important;
            }

            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row > td {
                width: auto !important;
                min-width: 0 !important;
                max-width: none !important;
                height: auto !important;
                box-sizing: border-box;
                border: 0 !important;
                background: transparent !important;
            }

            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row > td.sf-raze-icon-cell,
            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row > td.sf-raze-built,
            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row > td.sf-raze-building {
                display: none !important;
            }

            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row > td.sf-raze-type {
                grid-area: type;
                padding: 8px 7px 8px 8px !important;
                text-align: left !important;
                font-size: 13px;
                font-weight: 700;
                line-height: 1.2;
            }

            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row > td.sf-raze-input {
                grid-area: input;
                display: flex !important;
                align-items: center;
                justify-content: center;
                padding: 7px 4px !important;
                align-self: stretch;
            }

            table.buildingsRaze.sf-raze-enhanced .buildingsInput {
                width: 72px !important;
                min-height: 36px;
                margin: 0 auto !important;
                font-size: 14px !important;
            }

            .sf-raze-mobile-summary {
                display: block;
                margin-top: 5px;
                color: rgba(255,255,255,0.56);
                font-size: 10.5px;
                font-weight: 400;
                line-height: 1.25;
            }

            .sf-raze-mobile-summary strong {
                color: rgba(255,255,255,0.90);
                font-size: 11.5px;
                font-weight: 700;
            }

            .sf-raze-mobile-building {
                margin-left: 7px;
                color: rgba(var(--sfux-warning-rgb), 0.90);
                font-weight: 700;
                white-space: nowrap;
            }

            .sf-raze-submit.button-primary {
                min-height: 42px;
            }
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
            .sf-raze-summary {
                gap: 3px 7px;
                padding: 6px 7px;
            }

            .sf-raze-summary-title,
            .sf-raze-summary-rate {
                font-size: 10px;
            }

            .sf-raze-summary-selected,
            .sf-raze-summary-cost {
                font-size: 11px;
            }

            table.buildingsRaze.sf-raze-enhanced tr.sf-raze-row {
                grid-template-columns: minmax(0, 1fr) 82px;
            }

            table.buildingsRaze.sf-raze-enhanced .buildingsInput {
                width: 68px !important;
            }
                    }

                    /* -------------------------------------------------------------
                     * Enhanced number steppers
                     *
                     * Browser-native number arrows are shadow/native UI and are only
                     * partially styleable. Hide them on our enhanced fields and provide
                     * a consistent StarFury control instead.
                     * ----------------------------------------------------------- */
                    #sf-building-settings-overlay {
            position: fixed;
            inset: 0;
            z-index: 999999;
            background: rgba(0, 0, 0, 0.72);
            display: flex;
            align-items: center;
            justify-content: center;
                    }

                    #sf-building-settings {
            width: min(560px, calc(100vw - 40px));
            max-height: calc(100vh - 60px);
            overflow-y: auto;
            box-sizing: border-box;
            padding: 22px;
            border: 1px solid #555;
            background: #1b1b1b;
            color: #eee;
            box-shadow: 0 12px 40px rgba(0,0,0,0.55);
            font-family: inherit;
                    }

                    #sf-building-settings h2 { margin: 0 0 18px; font-size: 20px; }
                    #sf-building-settings h3 { margin: 22px 0 10px; font-size: 15px; }
                    .sf-settings-row { margin: 10px 0; }
                    .sf-settings-row label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
                    .sf-settings-note { margin-top: 5px; font-size: 12px; color: #aaa; line-height: 1.4; }
                    .sf-settings-detected { margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.045); font-size: 12px; line-height: 1.5; }
                    .sf-settings-number { width: 90px; margin-left: 8px; padding: 4px 6px; background: #222; color: #fff; border: 1px solid #666; }
                    .sf-settings-buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
                    .sf-settings-buttons button { padding: 7px 14px; cursor: pointer; }
                `); }

            // ---------------------------------------------------------------------
            // Construct view: header metadata and credit-economy ledger
            // ---------------------------------------------------------------------
            function addCalculatorHeaderMeta() {
                const boxHeader = document.querySelector('#contentWide .contentbox .boxheader');
                if (!boxHeader) return;

                boxHeader.classList.add('sf-buildings-boxheader');
                if (boxHeader.querySelector('.sf-calculator-header-meta')) return;

                const meta = ctx.element('div');
                meta.className = 'sf-calculator-header-meta';

                const status = ctx.element('span');
                status.id = 'sf-cache-status';
                status.textContent = 'Calc: loading';

                const separator = ctx.element('span');
                separator.textContent = '·';

                const refresh = ctx.element('a');
                refresh.href = '#';
                refresh.className = 'sf-refresh-link';
                refresh.textContent = 'refresh';
                refresh.title = "Clear this empire's cached calculator data and fetch fresh Research and Production values.";
                ctx.on(refresh, 'click', event => {
                    event.preventDefault();
                    clearEmpireCache(runtimeContext.empireKey);
                    window.location.reload();
                });

                meta.append(status, separator, refresh);
                boxHeader.appendChild(meta);
            }

            function ensureCreditEconomySummary() {
                let summary = document.getElementById('sf-credit-economy');
                if (summary) return summary;

                const boxHeader = document.querySelector('#contentWide .contentbox .boxheader');
                if (!boxHeader) return null;

                summary = ctx.element('div');
                summary.id = 'sf-credit-economy';
                summary.className = 'sf-credit-economy';
                summary.setAttribute('aria-label', 'Credit economy');

                const title = ctx.element('div');
                title.className = 'sf-credit-economy-title';
                title.textContent = 'Credits / tick';

                const current = ctx.element('div');
                current.className = 'sf-credit-economy-state';
                current.dataset.state = 'current';

                const projected = ctx.element('div');
                projected.className = 'sf-credit-economy-state';
                projected.dataset.state = 'projected';

                const detail = ctx.element('div');
                detail.className = 'sf-credit-economy-detail';

                const ledger = ctx.element('div');
                ledger.className = 'sf-credit-economy-ledger';

                const mobileTitle = ctx.element('div');
                mobileTitle.className = 'sf-credit-ledger-title';
                mobileTitle.textContent = 'Credits / tick';

                const ledgerProgress = ctx.element('div');
                ledgerProgress.className = 'sf-credit-ledger-progress';

                const grossLabel = ctx.element('div');
                grossLabel.className = 'sf-credit-ledger-label sf-credit-ledger-gross-label';
                grossLabel.textContent = 'Gross';

                const grossValue = ctx.element('div');
                grossValue.className = 'sf-credit-ledger-value sf-credit-ledger-gross-value';

                const militaryLabel = ctx.element('div');
                militaryLabel.className = 'sf-credit-ledger-label sf-credit-ledger-military-label';
                militaryLabel.textContent = 'Military Upkeep';
                militaryLabel.title = 'Military Ship Running Costs';

                const militaryValue = ctx.element('div');
                militaryValue.className = 'sf-credit-ledger-value sf-credit-ledger-military-value';
                militaryValue.title = 'Military Ship Running Costs';

                const netLabel = ctx.element('div');
                netLabel.className = 'sf-credit-ledger-label sf-credit-ledger-net-label';
                netLabel.textContent = 'Net';

                const netValue = ctx.element('div');
                netValue.className = 'sf-credit-ledger-value sf-credit-ledger-net-value';

                ledger.append(
                    mobileTitle,
                    ledgerProgress,
                    grossLabel,
                    grossValue,
                    militaryLabel,
                    militaryValue,
                    netLabel,
                    netValue
                );

                summary.append(title, current, projected, detail, ledger);
                boxHeader.insertAdjacentElement('afterend', summary);
                return summary;
            }

            const getNetStateClass = value => `sf-net-${SFUX.format.sign(value)}`;

            function renderCreditEconomySummary({
                currentGross,
                projectedGross,
                militaryRunningCosts,
                currentNet,
                projectedNet,
                projectedAtCap,
                incomeBuildingsInProgress = 0
            }) {
                const summary = ensureCreditEconomySummary();
                if (!summary || currentGross == null || projectedGross == null) return;

                const renderState = (element, label, gross, net, showMilitary = false) => {
                    if (!element) return;

                    const military = showMilitary && militaryRunningCosts != null
                        ? `<span class="sf-credit-economy-military">−${formatNumber(militaryRunningCosts)} military</span>`
                        : '';

                    const netMarkup = net != null
                        ? `<span class="sf-credit-economy-net ${getNetStateClass(net)}">${getCreditStatusDot(net, `${label} net credits`)}${formatSignedNumber(net)} net</span>`
                        : '';

                    element.innerHTML = `
                        <span class="sf-credit-economy-label">${label}</span>
                        <span class="sf-credit-economy-gross">${formatNumber(gross)} gross</span>
                        ${military}
                        ${netMarkup}
                    `;
                };

                renderState(
                    summary.querySelector('[data-state="current"]'),
                    'Current',
                    currentGross,
                    currentNet,
                    true
                );

                renderState(
                    summary.querySelector('[data-state="projected"]'),
                    projectedAtCap ? 'After builds*' : 'After builds',
                    projectedGross,
                    projectedNet,
                    false
                );

                const detail = summary.querySelector('.sf-credit-economy-detail');
                if (detail) {
                    detail.textContent = militaryRunningCosts != null
                        ? `Military running costs: ${formatNumber(militaryRunningCosts)}/tick`
                        : '';
                }

                const ledgerProgress = summary.querySelector('.sf-credit-ledger-progress');
                const ledgerGross = summary.querySelector('.sf-credit-ledger-gross-value');
                const ledgerMilitary = summary.querySelector('.sf-credit-ledger-military-value');
                const ledgerNet = summary.querySelector('.sf-credit-ledger-net-value');

                if (ledgerProgress) {
                    ledgerProgress.textContent =
                        `${incomeBuildingsInProgress.toLocaleString()} income ${incomeBuildingsInProgress === 1 ? 'building' : 'buildings'} in progress`;
                }

                if (ledgerGross) {
                    ledgerGross.textContent = currentGross === projectedGross
                        ? formatNumber(currentGross)
                        : `${formatNumber(currentGross)} → ${formatNumber(projectedGross)}`;
                }

                if (ledgerMilitary) {
                    ledgerMilitary.textContent = militaryRunningCosts != null
                        ? formatNumber(militaryRunningCosts)
                        : '—';
                }

                if (ledgerNet) {
                    ledgerNet.textContent = '';

                    const appendNetPart = (value) => {
                        const part = ctx.element('span');
                        part.className = `sf-credit-net-part ${getNetStateClass(value)}`;
                        part.textContent = formatSignedNumber(value);
                        ledgerNet.appendChild(part);
                    };

                    if (currentNet != null && projectedNet != null) {
                        appendNetPart(currentNet);

                        if (currentNet !== projectedNet) {
                            const arrow = ctx.element('span');
                            arrow.className = 'sf-credit-net-arrow';
                            arrow.textContent = '→';
                            ledgerNet.appendChild(arrow);

                            appendNetPart(projectedNet);
                        }
                    } else if (currentNet != null) {
                        appendNetPart(currentNet);
                    } else if (projectedNet != null) {
                        appendNetPart(projectedNet);
                    } else {
                        ledgerNet.textContent = '—';
                    }
                }

                const assumptionParts = [];
                if (militaryRunningCosts != null) {
                    assumptionParts.push(`Military running costs held at ${formatNumber(militaryRunningCosts)} credits/tick.`);
                }
                if (projectedAtCap) {
                    assumptionParts.push('Projected Population Tax assumes the projected Residents capacity is filled.');
                }
                summary.title = assumptionParts.join(' ');
                summary.classList.add('sf-visible');
            }

            function updateCacheStatus(text, title = '') {
                const status = document.getElementById('sf-cache-status');
                if (!status) return;

                status.textContent = text;
                status.title = title;
            }

            function getTickCountFromCell(cell) {
                if (!cell) return null;
                const match = cell.textContent.match(/\((\d+)\s*Ticks?\)/i);
                return match ? Number(match[1]) : null;
            }

            function restyleBuildingCell(cell, count, ticksRemaining = null) {
                if (!cell) return;

                cell.classList.add('sf-building-cell');
                cell.textContent = '';

                const main = ctx.element('div');
                main.className = 'sf-main-number';
                main.textContent = count.toLocaleString();
                cell.appendChild(main);

                if (ticksRemaining != null && count > 0) {
                    const ticks = ctx.element('div');
                    ticks.className = 'sf-subtext';
                    ticks.textContent = `${ticksRemaining} ticks`;
                    cell.appendChild(ticks);
                }
            }

            function findSectionTitleForTable(table) {
                let node = table.closest('.responsive-table-container')?.previousElementSibling || null;

                while (node) {
                    if (node.classList?.contains('sectionTitle')) return node;
                    node = node.previousElementSibling;
                }

                return null;
            }

            function getSectionName(sectionTitle) {
                if (!sectionTitle) return '';

                return Array.from(sectionTitle.childNodes)
                    .filter(node => node.nodeType === Node.TEXT_NODE)
                    .map(node => node.textContent)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            function decorateBuildingSection(table, sectionRows, sharedAvailable) {
                const sectionTitle = findSectionTitleForTable(table);
                if (!sectionTitle || sectionTitle.dataset.sfUxDecorated === 'true') return;

                const name = getSectionName(sectionTitle) || 'Construction';
                const action = sectionTitle.querySelector(':scope > .right');
                const totalBuilding = sectionRows.reduce((sum, item) => sum + item.building, 0);
                const tickValues = sectionRows
                    .filter(item => item.building > 0 && item.ticksRemaining != null)
                    .map(item => item.ticksRemaining);

                const metaParts = [];

                if (sharedAvailable != null) {
                    metaParts.push(`${sharedAvailable.toLocaleString()} available`);
                }

                metaParts.push(`${totalBuilding.toLocaleString()} building`);

                if (tickValues.length) {
                    const minTicks = Math.min(...tickValues);
                    const maxTicks = Math.max(...tickValues);
                    metaParts.push(
                        minTicks === maxTicks
                            ? `${maxTicks} ticks`
                            : `${minTicks}–${maxTicks} ticks`
                    );
                }

                for (const child of Array.from(sectionTitle.childNodes)) {
                    if (child !== action) child.remove();
                }

                const main = ctx.element('div');
                main.className = 'sf-building-section-main';

                const nameSpan = ctx.element('span');
                nameSpan.className = 'sf-building-section-name';
                nameSpan.textContent = name;

                const meta = ctx.element('span');
                meta.className = 'sf-building-section-meta';
                meta.textContent = metaParts.join(' · ');

                main.append(nameSpan, meta);
                sectionTitle.insertBefore(main, action || null);
                sectionTitle.classList.add('sf-building-section-title');
                sectionTitle.dataset.sfUxDecorated = 'true';

                if (action) {
                    action.classList.add('sf-building-section-action');
                    const link = action.querySelector('a');
                    if (link) {
                        const originalText = link.textContent.trim();
                        link.title = originalText;
                        link.textContent = 'Cancel';
                    }
                }
            }

            // ---------------------------------------------------------------------
            // Construct view: DOM-to-state adapter and responsive row composition
            // ---------------------------------------------------------------------
            function collectBuildingRows() {
                const buildingRows = {};

                document.querySelectorAll('table.buildings').forEach(table => {
                    if (table.dataset.sfTotalAdded === 'true') return;

                    const rows = Array.from(table.rows);
                    if (rows.length < 2) return;

                    const headerRow = rows[0];
                    const headers = Array.from(headerRow.cells).map(cell =>
                        normalizeText(cell.textContent).replace(/\.$/, '')
                    );

                    const typeIndex = headers.indexOf('building type');
                    const builtIndex = headers.indexOf('built');
                    const buildingIndex = headers.indexOf('building');
                    let maxIndex = headers.indexOf('available');
                    if (maxIndex === -1) maxIndex = headers.indexOf('max');

                    if (
                        typeIndex === -1 ||
                        builtIndex === -1 ||
                        buildingIndex === -1 ||
                        maxIndex === -1
                    ) {
                        return;
                    }

                    const rawData = rows.slice(1).map(row => ({
                        row,
                        name: row.cells[typeIndex]?.textContent.trim() || '',
                        built: getCellNumber(row.cells[builtIndex]),
                        building: getCellNumber(row.cells[buildingIndex]),
                        ticksRemaining: getTickCountFromCell(row.cells[buildingIndex]),
                        available: getCellNumber(row.cells[maxIndex])
                    })).filter(item => item.name);

                    if (!rawData.length) return;

                    const uniqueAvailable = [...new Set(rawData.map(item => item.available))];
                    const sharedAvailable = uniqueAvailable.length === 1
                        ? uniqueAvailable[0]
                        : null;

                    headerRow.cells[buildingIndex].textContent = 'In Progress';

                    const totalHeader = ctx.element('td');
                    totalHeader.className = 'tableheader sf-total-header';
                    totalHeader.textContent = 'Total';
                    headerRow.insertBefore(totalHeader, headerRow.cells[maxIndex]);

                    for (const item of rawData) {
                        const { row, name, built, building, ticksRemaining, available } = item;
                        const total = built + building;

                        row.classList.add('sf-building-row');
                        if (building > 0) row.classList.add('sf-under-construction');

                        const typeCell = row.cells[typeIndex];
                        typeCell?.classList.add('sf-type-cell');

                        const mobileSummary = ctx.element('div');
                        mobileSummary.className = 'sf-mobile-building-summary';
                        typeCell?.appendChild(mobileSummary);

                        const builtCell = row.cells[builtIndex];
                        builtCell.classList.add('sf-built-cell');
                        builtCell.textContent = '';

                        const builtNumber = ctx.element('div');
                        builtNumber.className = 'sf-main-number';
                        builtNumber.textContent = built.toLocaleString();

                        const currentProduction = ctx.element('div');
                        currentProduction.className = 'sf-current-production';
                        currentProduction.textContent = 'calculating...';

                        builtCell.append(builtNumber, currentProduction);

                        restyleBuildingCell(row.cells[buildingIndex], building, ticksRemaining);

                        const totalCell = ctx.element('td');
                        totalCell.className = 'sf-total-cell';

                        const totalNumber = ctx.element('div');
                        totalNumber.className = 'sf-total-number';
                        totalNumber.textContent = total.toLocaleString();

                        const projectedProduction = ctx.element('div');
                        projectedProduction.className = 'sf-projected-production';
                        projectedProduction.textContent = 'calculating...';

                        const productionDelta = ctx.element('div');
                        productionDelta.className = 'sf-production-delta';

                        totalCell.append(totalNumber, projectedProduction, productionDelta);
                        row.insertBefore(totalCell, row.cells[maxIndex]);

                        // Total insertion shifts Max/Available and Construct right by one.
                        const maxCell = row.cells[maxIndex + 1];
                        const constructCell = row.cells[maxIndex + 2];
                        maxCell?.classList.add('sf-max-cell');
                        constructCell?.classList.add('sf-construct-cell');

                        const constructInput = constructCell?.querySelector('input[type="number"]');
                        configureNonNegativeIntegerInput(constructInput);

                        if (constructCell && constructInput && !constructCell.querySelector('.sf-construct-available')) {
                            const availableHint = ctx.element('div');
                            availableHint.className = 'sf-construct-available';
                            availableHint.title = `${available.toLocaleString()} construction slots/resources currently available in this section.`;

                            const availableNumber = ctx.element('strong');
                            availableNumber.textContent = available.toLocaleString();

                            availableHint.append(availableNumber, ' available');

                            const inputVisual = constructInput.closest('.sf-number-stepper') || constructInput;
                            inputVisual.insertAdjacentElement('afterend', availableHint);
                        }

                        buildingRows[name] = {
                            name,
                            built,
                            building,
                            total,
                            ticksRemaining,
                            available,
                            row,
                            currentProductionElement: currentProduction,
                            projectedProductionElement: projectedProduction,
                            productionDeltaElement: productionDelta,
                            mobileSummaryElement: mobileSummary
                        };

                        renderMobileBuildingSummary(buildingRows[name]);
                    }

                    /*
                     * Max/Available is section-level state on the current Buildings page.
                     * Promote it into the section header only when every row agrees. If a
                     * future StarFury change makes availability row-specific, keep the
                     * native column rather than silently discarding information.
                     */
                    if (sharedAvailable != null) {
                        headerRow.cells[maxIndex + 1]?.remove();
                        for (const item of rawData) {
                            item.row.cells[maxIndex + 1]?.remove();
                        }
                    }

                    table.classList.add('sf-buildings-enhanced');
                    decorateBuildingSection(table, rawData, sharedAvailable);
                    table.dataset.sfTotalAdded = 'true';
                });

                return buildingRows;
            }

            // ---------------------------------------------------------------------
            // Production model
            // Fallbacks exist for the userscript only. Native StarFury should use exact
            // backend production formulas/values and should not infer its own mechanics.
            // ---------------------------------------------------------------------
            function getFallbackRates(research, settings) {
                const advancedMineLevels =
                    Number(Boolean(research['Advanced Mines I'])) +
                    Number(Boolean(research['Advanced Mines II']));

                const advancedPowerLevels =
                    Number(Boolean(research['Advanced Power I'])) +
                    Number(Boolean(research['Advanced Power II']));

                const advancedFabricationLevels =
                    Number(Boolean(research['Advanced Fabrication Plants I'])) +
                    Number(Boolean(research['Advanced Fabrication Plants II']));

                return {
                    triLithiumCredits: 150 + (25 * advancedMineLevels),
                    metal: 5,
                    deuterium: 2,
                    residentPopulation: 2,
                    residentCapacity: 50,
                    recruitsPerPopulation: 0.005,
                    fabricationProbes: research['Fabrication Plants']
                        ? 0.5 * (1 + (0.50 * advancedFabricationLevels))
                        : 0,
                    fusionPower: 1.25 * (1 + (0.50 * advancedPowerLevels)),

                    /*
                     * Iridium can come from two building types:
                     *   - Iridium Mines (Asteroids): 1 iridium/t each
                     *   - Iridium Plants (Land):     0.5 iridium/t each
                     *
                     * Production.php reports only their combined empire total, so the
                     * two rates must remain distinct for row-level projections.
                     */
                    iridiumMine: 1,
                    iridiumPlant: 0.5,

                    /*
                     * Raw defensive contribution per completed Defence Platform.
                     * This remains separate from ship/race/research defence modifiers
                     * until live evidence confirms how those systems interact.
                     */
                    defencePlatform: settings.fallbackDefencePerPlatform,
                    research: settings.fallbackResearchPerLab
                };
            }

            function calculateLiveRates({
                buildingRows,
                research,
                settings,
                production,
                researchPointsPerTick,
                snapshotPopulation
            }) {
                const rates = getFallbackRates(research, settings);

                if (!settings.autoCalibrateProduction) return rates;

                const metalBuilt = buildingRows['Metal Mines']?.built;
                const deutBuilt = buildingRows['Deuterium Mines']?.built;
                const iridiumMineBuilt = buildingRows['Iridium Mines']?.built || 0;
                const iridiumPlantBuilt = buildingRows['Iridium Plants']?.built || 0;
                const fusionBuilt = buildingRows['Fusion Plants']?.built;
                const residentBuilt = buildingRows['Residents']?.built;
                const researchBuilt = buildingRows['Research Labs']?.built;
                const triLithiumBuilt = buildingRows['Tri-Lithium Mines']?.built;
                const fabricationBuilt = buildingRows['Fabrication Plants']?.built;

                if (production.metal != null && metalBuilt) {
                    rates.metal = inferSimpleRate(production.metal, metalBuilt);
                }

                if (production.deuterium != null && deutBuilt) {
                    rates.deuterium = inferSimpleRate(production.deuterium, deutBuilt);
                }

                if (
                    production.iridium != null &&
                    (iridiumMineBuilt > 0 || iridiumPlantBuilt > 0)
                ) {
                    /*
                     * Production.php exposes a single aggregate Iridium Production value.
                     * Keep the canonical 1.0 / 0.5 rates when their floored aggregate
                     * already matches StarFury. This prevents integer display flooring
                     * from producing noisy inferred decimals.
                     *
                     * If a future modifier changes the aggregate, preserve the
                     * Mine:Plant ratio with a shared scale. If only one producer type
                     * exists, infer that rate directly.
                     */
                    const expectedIridium =
                        (iridiumMineBuilt * rates.iridiumMine) +
                        (iridiumPlantBuilt * rates.iridiumPlant);

                    if (Math.floor(expectedIridium + 1e-9) !== Math.floor(production.iridium)) {
                        if (iridiumMineBuilt > 0 && iridiumPlantBuilt === 0) {
                            rates.iridiumMine =
                                inferSimpleRate(production.iridium, iridiumMineBuilt) ??
                                rates.iridiumMine;
                        } else if (iridiumPlantBuilt > 0 && iridiumMineBuilt === 0) {
                            rates.iridiumPlant =
                                inferSimpleRate(production.iridium, iridiumPlantBuilt) ??
                                rates.iridiumPlant;
                        } else if (expectedIridium > 0) {
                            const scale = production.iridium / expectedIridium;
                            rates.iridiumMine *= scale;
                            rates.iridiumPlant *= scale;
                        }
                    }
                }

                if (production.power != null && fusionBuilt) {
                    rates.fusionPower = inferSimpleRate(production.power, fusionBuilt);
                }

                if (production.population != null && residentBuilt) {
                    rates.residentPopulation = inferSimpleRate(production.population, residentBuilt);
                }

                if (production.populationCapacity != null && residentBuilt) {
                    rates.residentCapacity = inferSimpleRate(production.populationCapacity, residentBuilt);
                }

                if (production.recruits != null && snapshotPopulation) {
                    rates.recruitsPerPopulation = inferSimpleRate(
                        production.recruits,
                        snapshotPopulation
                    );
                }

                if (production.probes != null && fabricationBuilt) {
                    rates.fabricationProbes = inferSimpleRate(
                        production.probes,
                        fabricationBuilt
                    );
                }

                if (researchPointsPerTick != null && researchBuilt) {
                    rates.research = inferSimpleRate(researchPointsPerTick, researchBuilt);
                }

                if (
                    production.credits != null &&
                    triLithiumBuilt &&
                    snapshotPopulation != null
                ) {
                    const taxPerPopulation =
                        Number(Boolean(research['Population Tax I'])) +
                        Number(Boolean(research['Population Tax II']));

                    const populationTaxIncome = snapshotPopulation * taxPerPopulation;
                    const mineCreditIncome = production.credits - populationTaxIncome;

                    if (mineCreditIncome >= 0) {
                        rates.triLithiumCredits = inferSimpleRate(
                            mineCreditIncome,
                            triLithiumBuilt
                        );
                    }
                }

                return rates;
            }

            function getCompactElementText(element) {
                if (!element) return '';

                return String(element.innerText || element.textContent || '')
                    .replace(/\n+/g, ' · ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            function renderMobileBuildingSummary(rowData) {
                const container = rowData?.mobileSummaryElement;
                if (!container) return;

                container.textContent = '';

                const countLine = ctx.element('div');
                countLine.className = 'sf-mobile-count-line';

                const counts = ctx.element('span');

                const builtStrong = ctx.element('strong');
                builtStrong.textContent = rowData.built.toLocaleString();
                counts.appendChild(builtStrong);

                if (rowData.building > 0) {
                    counts.append(' built → ');

                    const totalStrong = ctx.element('strong');
                    totalStrong.textContent = rowData.total.toLocaleString();
                    counts.append(totalStrong, ' total');
                } else {
                    counts.append(' built');
                }

                countLine.appendChild(counts);

                if (rowData.building > 0) {
                    const progress = ctx.element('span');
                    progress.className = 'sf-mobile-progress';

                    const tickText = rowData.ticksRemaining != null
                        ? ` · ${rowData.ticksRemaining} ticks`
                        : '';

                    progress.textContent = `${rowData.building.toLocaleString()} building${tickText}`;
                    countLine.appendChild(progress);
                }

                const productionLine = ctx.element('div');
                productionLine.className = 'sf-mobile-production-line';

                const currentText = getCompactElementText(rowData.currentProductionElement);
                const projectedText = getCompactElementText(rowData.projectedProductionElement);
                const deltaText = getCompactElementText(rowData.productionDeltaElement);

                if (currentText) {
                    const current = ctx.element('span');
                    current.textContent = currentText;
                    productionLine.appendChild(current);
                }

                if (
                    rowData.building > 0 &&
                    projectedText &&
                    projectedText !== currentText
                ) {
                    productionLine.append(' → ');

                    const projected = ctx.element('span');
                    projected.className = 'sf-mobile-projected';
                    projected.textContent = projectedText;
                    productionLine.appendChild(projected);
                }

                if (deltaText) {
                    productionLine.append(' · ');

                    const delta = ctx.element('span');
                    delta.className = 'sf-mobile-delta';
                    delta.textContent = deltaText;
                    productionLine.appendChild(delta);
                }

                container.appendChild(countLine);

                if (productionLine.textContent.trim()) {
                    container.appendChild(productionLine);
                }
            }

            function setCurrentProduction(buildingRows, buildingName, html, tooltip = '') {
                const element = buildingRows[buildingName]?.currentProductionElement;
                if (!element) return;

                element.innerHTML = html;
                element.title = tooltip;
                renderMobileBuildingSummary(buildingRows[buildingName]);
            }

            function setProjectedProduction(buildingRows, buildingName, html, tooltip = '') {
                const element = buildingRows[buildingName]?.projectedProductionElement;
                if (!element) return;

                element.innerHTML = html;
                element.title = tooltip;
                renderMobileBuildingSummary(buildingRows[buildingName]);
            }

            function setProductionDelta(buildingRows, buildingName, delta, unit, tooltip = '') {
                const row = buildingRows[buildingName];
                const element = row?.productionDeltaElement;
                if (!element) return;

                if (!row.building || delta == null || !Number.isFinite(delta) || delta === 0) {
                    element.textContent = '';
                    element.removeAttribute('title');
                    renderMobileBuildingSummary(row);
                    return;
                }

                const rounded = Math.floor(delta);
                const sign = rounded > 0 ? '+' : '';
                element.textContent = `${sign}${rounded.toLocaleString()} ${unit}`;
                element.title = tooltip || 'Projected change when the buildings currently under construction complete.';
                renderMobileBuildingSummary(row);
            }

            const formatSignedNumber = SFUX.format.signed;

            function getCreditStatusDot(netCredits, contextLabel = 'Net credits') {
                if (netCredits == null || !Number.isFinite(netCredits)) return '';

                const state = netCredits > 0
                    ? 'positive'
                    : netCredits < 0
                        ? 'negative'
                        : 'neutral';

                const stateLabel = netCredits > 0
                    ? 'positive'
                    : netCredits < 0
                        ? 'negative'
                        : 'break-even';

                const netText = `${formatSignedNumber(netCredits)} cr/t net`;
                const label = `${contextLabel}: ${stateLabel} (${netText})`;

                return `<span class="sf-credit-status-dot sf-credit-${state}" title="${label}" role="img" aria-label="${label}"></span>`;
            }

            // ---------------------------------------------------------------------
            // Construct view: current/projected production and economic rendering
            // ---------------------------------------------------------------------
            function renderProduction(buildingRows, rates, research, snapshot) {
                const taxPerPopulation =
                    Number(Boolean(research['Population Tax I'])) +
                    Number(Boolean(research['Population Tax II']));

                const tri = buildingRows['Tri-Lithium Mines'];
                const metal = buildingRows['Metal Mines'];
                const deut = buildingRows['Deuterium Mines'];
                const residents = buildingRows['Residents'];
                const fusion = buildingRows['Fusion Plants'];
                const iridiumMines = buildingRows['Iridium Mines'];
                const iridiumPlants = buildingRows['Iridium Plants'];
                const fabrication = buildingRows['Fabrication Plants'];
                const defencePlatforms = buildingRows['Defence Platforms'];
                const labs = buildingRows['Research Labs'];

                /*
                 * Credit production is empire-level state, not Resident-row state.
                 * Show it once above the construction sections, including the current
                 * military expense and the projected net after all listed builds finish.
                 */
                const currentTax = snapshot.population != null
                    ? snapshot.population * taxPerPopulation
                    : null;

                const currentMineCredits = tri && rates.triLithiumCredits != null
                    ? Math.floor(tri.built * rates.triLithiumCredits)
                    : null;

                const currentGrossCredits = snapshot.production.credits != null
                    ? snapshot.production.credits
                    : currentMineCredits != null && currentTax != null
                        ? currentMineCredits + currentTax
                        : null;

                const projectedMineCreditsForSummary = tri && rates.triLithiumCredits != null
                    ? Math.floor(tri.total * rates.triLithiumCredits)
                    : currentMineCredits;

                const projectedCapacityForSummary = residents && rates.residentCapacity != null
                    ? Math.floor(residents.total * rates.residentCapacity)
                    : snapshot.population;

                const projectedTaxForSummary = projectedCapacityForSummary != null
                    ? projectedCapacityForSummary * taxPerPopulation
                    : currentTax;

                const projectedGrossCreditsForSummary = projectedMineCreditsForSummary != null && projectedTaxForSummary != null
                    ? projectedMineCreditsForSummary + projectedTaxForSummary
                    : currentGrossCredits;

                const currentMilitaryRunningCosts = snapshot.production.militaryRunningCosts;
                const currentNetCreditsForSummary = snapshot.production.netCredits != null
                    ? snapshot.production.netCredits
                    : currentGrossCredits != null && currentMilitaryRunningCosts != null
                        ? currentGrossCredits - currentMilitaryRunningCosts
                        : null;

                const projectedNetCreditsForSummary = projectedGrossCreditsForSummary != null && currentMilitaryRunningCosts != null
                    ? projectedGrossCreditsForSummary - currentMilitaryRunningCosts
                    : null;

                const incomeBuildingsInProgress =
                    (tri?.building ?? 0) +
                    (taxPerPopulation > 0 ? (residents?.building ?? 0) : 0);

                renderCreditEconomySummary({
                    currentGross: currentGrossCredits,
                    projectedGross: projectedGrossCreditsForSummary,
                    militaryRunningCosts: currentMilitaryRunningCosts,
                    currentNet: currentNetCreditsForSummary,
                    projectedNet: projectedNetCreditsForSummary,
                    projectedAtCap: Boolean(residents?.building && taxPerPopulation > 0),
                    incomeBuildingsInProgress
                });

                if (tri && rates.triLithiumCredits != null) {
                    const currentMineCredits = snapshot.production.credits != null && snapshot.population != null
                        ? snapshot.production.credits - (snapshot.population * taxPerPopulation)
                        : Math.floor(tri.built * rates.triLithiumCredits);

                    const projectedMineCredits = Math.floor(tri.total * rates.triLithiumCredits);

                    setCurrentProduction(
                        buildingRows,
                        'Tri-Lithium Mines',
                        `${formatNumber(currentMineCredits)} cr/t`,
                        'Current mine credit production. Population Tax is shown under Residents.'
                    );

                    setProjectedProduction(
                        buildingRows,
                        'Tri-Lithium Mines',
                        `${formatNumber(projectedMineCredits)} cr/t`,
                        `${tri.total} total × ${rates.triLithiumCredits} credits/t.`
                    );
                    setProductionDelta(
                        buildingRows,
                        'Tri-Lithium Mines',
                        projectedMineCredits - currentMineCredits,
                        'cr/t'
                    );
                }

                if (metal && rates.metal != null) {
                    const current = snapshot.production.metal ?? Math.floor(metal.built * rates.metal);
                    const projected = Math.floor(metal.total * rates.metal);

                    setCurrentProduction(buildingRows, 'Metal Mines', `${formatNumber(current)} metal/t`);
                    setProjectedProduction(buildingRows, 'Metal Mines', `${formatNumber(projected)} metal/t`);
                    setProductionDelta(buildingRows, 'Metal Mines', projected - current, 'metal/t');
                }

                if (deut && rates.deuterium != null) {
                    const current = snapshot.production.deuterium ?? Math.floor(deut.built * rates.deuterium);
                    const projected = Math.floor(deut.total * rates.deuterium);

                    setCurrentProduction(buildingRows, 'Deuterium Mines', `${formatNumber(current)} deut/t`);
                    setProjectedProduction(buildingRows, 'Deuterium Mines', `${formatNumber(projected)} deut/t`);
                    setProductionDelta(buildingRows, 'Deuterium Mines', projected - current, 'deut/t');
                }

                if (residents && rates.residentPopulation != null && rates.residentCapacity != null) {
                    const currentPopProduction = snapshot.production.population ??
                        Math.floor(residents.built * rates.residentPopulation);

                    const currentCapacity = snapshot.production.populationCapacity ??
                        Math.floor(residents.built * rates.residentCapacity);

                    const currentRecruits = snapshot.production.recruits;
                    const currentTax = snapshot.population != null
                        ? snapshot.population * taxPerPopulation
                        : null;

                    const projectedPopProduction = Math.floor(
                        residents.total * rates.residentPopulation
                    );

                    const projectedCapacity = Math.floor(
                        residents.total * rates.residentCapacity
                    );

                    const projectedRecruits = rates.recruitsPerPopulation != null
                        ? Math.floor(projectedCapacity * rates.recruitsPerPopulation)
                        : null;

                    const projectedTaxAtCap = projectedCapacity * taxPerPopulation;
                    const currentPartsLine1 = [
                        `${formatNumber(currentPopProduction)} pop/t`,
                        currentRecruits != null ? `${formatNumber(currentRecruits)} rec/t` : null
                    ].filter(Boolean);

                    const currentPartsLine2 = [];

                    // Capacity is useful only when it differs from actual current population.
                    if (
                        currentCapacity != null &&
                        snapshot.population != null &&
                        currentCapacity !== snapshot.population
                    ) {
                        currentPartsLine2.push(`${formatNumber(currentCapacity)} cap`);
                    }

                    if (currentTax != null && taxPerPopulation > 0) {
                        currentPartsLine2.push(`${formatNumber(currentTax)} tax/t`);
                    }

                    const currentLines = [currentPartsLine1.join(' · ')];

                    if (currentPartsLine2.length) {
                        currentLines.push(currentPartsLine2.join(' · '));
                    }

                    setCurrentProduction(
                        buildingRows,
                        'Residents',
                        currentLines.join('<br>'),
                        'Current population, recruit production, capacity, and Population Tax.'
                    );

                    const projectedPartsLine1 = [
                        `${formatNumber(projectedPopProduction)} pop/t`,
                        projectedRecruits != null ? `~${formatNumber(projectedRecruits)} rec/t` : null
                    ].filter(Boolean);

                    const projectedPartsLine2 = [
                        `${formatNumber(projectedCapacity)} cap`,
                        taxPerPopulation > 0 && projectedTaxAtCap !== projectedCapacity
                            ? `${formatNumber(projectedTaxAtCap)} tax/t`
                            : null
                    ].filter(Boolean);

                    const projectedLines = [projectedPartsLine1.join(' · ')];

                    if (projectedPartsLine2.length) {
                        projectedLines.push(projectedPartsLine2.join(' · '));
                    }

                    setProjectedProduction(
                        buildingRows,
                        'Residents',
                        projectedLines.join('<br>'),
                        'Projected recruit production is inferred from the current recruits/population ratio.'
                    );
                    setProductionDelta(
                        buildingRows,
                        'Residents',
                        projectedPopProduction - currentPopProduction,
                        'pop/t',
                        'Direct population-production increase from the Residents currently under construction.'
                    );
                }

                if (fusion && rates.fusionPower != null) {
                    const current = snapshot.production.power ?? Math.floor(fusion.built * rates.fusionPower);
                    const projected = Math.floor(fusion.total * rates.fusionPower);

                    setCurrentProduction(buildingRows, 'Fusion Plants', `${formatNumber(current)} power/t`);
                    setProjectedProduction(buildingRows, 'Fusion Plants', `${formatNumber(projected)} power/t`);
                    setProductionDelta(buildingRows, 'Fusion Plants', projected - current, 'power/t');
                }

                /*
                 * Iridium Production is aggregate on /production.php, but Buildings has
                 * two producer rows after Iridium Mines is unlocked. Render each row's
                 * contribution independently so neither is left on "calculating...".
                 */
                if (iridiumMines && rates.iridiumMine != null) {
                    const current = Math.floor(iridiumMines.built * rates.iridiumMine);
                    const projected = Math.floor(iridiumMines.total * rates.iridiumMine);

                    setCurrentProduction(
                        buildingRows,
                        'Iridium Mines',
                        `${formatNumber(current)} irid/t`,
                        'Iridium contribution from asteroid Iridium Mines.'
                    );
                    setProjectedProduction(
                        buildingRows,
                        'Iridium Mines',
                        `${formatNumber(projected)} irid/t`,
                        `${iridiumMines.total} total × ${rates.iridiumMine} iridium/t.`
                    );
                    setProductionDelta(
                        buildingRows,
                        'Iridium Mines',
                        projected - current,
                        'irid/t'
                    );
                }

                if (iridiumPlants && rates.iridiumPlant != null) {
                    const current = Math.floor(iridiumPlants.built * rates.iridiumPlant);
                    const projected = Math.floor(iridiumPlants.total * rates.iridiumPlant);

                    setCurrentProduction(
                        buildingRows,
                        'Iridium Plants',
                        `${formatNumber(current)} irid/t`,
                        'Iridium contribution from land-based Iridium Plants.'
                    );
                    setProjectedProduction(
                        buildingRows,
                        'Iridium Plants',
                        `${formatNumber(projected)} irid/t`,
                        `${iridiumPlants.total} total × ${rates.iridiumPlant} iridium/t.`
                    );
                    setProductionDelta(
                        buildingRows,
                        'Iridium Plants',
                        projected - current,
                        'irid/t'
                    );
                }

                if (fabrication && rates.fabricationProbes != null) {
                    const current = snapshot.production.probes ??
                        Math.floor(fabrication.built * rates.fabricationProbes);
                    const projected = Math.floor(
                        fabrication.total * rates.fabricationProbes
                    );

                    setCurrentProduction(
                        buildingRows,
                        'Fabrication Plants',
                        `${formatNumber(current)} probes/t`,
                        'Current Probe Production from the Production page.'
                    );
                    setProjectedProduction(
                        buildingRows,
                        'Fabrication Plants',
                        `${formatNumber(projected)} probes/t`,
                        `${fabrication.total} total × ${rates.fabricationProbes} probes/t.`
                    );
                    setProductionDelta(buildingRows, 'Fabrication Plants', projected - current, 'probes/t');
                }

                /*
                 * Defence Platforms are a defensive building effect rather than a
                 * production rate. The live Buildings page exposes the row, but not
                 * the platform's defence value. We therefore use the configurable
                 * fallback value and explicitly leave race/research/global defence
                 * modifiers out of the calculation until confirmed.
                 */
                if (defencePlatforms && rates.defencePlatform != null) {
                    const current = Math.floor(
                        defencePlatforms.built * rates.defencePlatform
                    );
                    const projected = Math.floor(
                        defencePlatforms.total * rates.defencePlatform
                    );

                    const assumptionTooltip =
                        (rates.defencePlatform === 15 ? 'Confirmed platform value: 15 defence points/platform. ' : `Configured override: ${rates.defencePlatform} defence points/platform; confirmed default is 15. `) +
                        'No race, research, shield, alliance, or other defence modifier is applied.';

                    setCurrentProduction(
                        buildingRows,
                        'Defence Platforms',
                        `${formatNumber(current)} defence`,
                        assumptionTooltip
                    );
                    setProjectedProduction(
                        buildingRows,
                        'Defence Platforms',
                        `${formatNumber(projected)} defence`,
                        `${defencePlatforms.total} total × ${rates.defencePlatform} defence/platform. ` +
                        'Raw platform contribution only, not total empire defence.'
                    );
                    setProductionDelta(
                        buildingRows,
                        'Defence Platforms',
                        projected - current,
                        'defence',
                        assumptionTooltip
                    );
                }

                if (labs && rates.research != null) {
                    const current = snapshot.researchPointsPerTick ?? Math.floor(labs.built * rates.research);
                    const projected = Math.floor(labs.total * rates.research);

                    setCurrentProduction(buildingRows, 'Research Labs', `${formatNumber(current)} RP/tick`);
                    setProjectedProduction(buildingRows, 'Research Labs', `${formatNumber(projected)} RP/tick`);
                    setProductionDelta(buildingRows, 'Research Labs', projected - current, 'RP/tick');
                }
            }

            // ---------------------------------------------------------------------
            // Userscript settings / fallback controls
            // Native StarFury would normally not need these calibration controls.
            // ---------------------------------------------------------------------
            function openSettingsModal() {
                document.getElementById('sf-building-settings-overlay')?.remove();

                const settings = loadSettings();
                const overlay = ctx.element('div');
                overlay.id = 'sf-building-settings-overlay';

                const modal = ctx.element('div');
                modal.id = 'sf-building-settings';

                let detectedText = 'No automatic research result is available yet.';

                if (runtimeContext.detectedResearch) {
                    const completed = PRODUCTION_RESEARCH.filter(
                        name => runtimeContext.detectedResearch[name]
                    );

                    detectedText = completed.length
                        ? `Current empire: ${completed.join(', ')}`
                        : 'No production-related completed research detected.';
                }

                modal.innerHTML = `
                    <h2>Building Calculator Settings</h2>

                    <div class="sf-settings-row">
                        <label>
                            <input type="checkbox" id="sf-auto-research" ${settings.autoDetectResearch ? 'checked' : ''}>
                            Auto-detect completed research
                        </label>
                        <div class="sf-settings-note">
                            Reads Tech Tree at most once per StarFury server hour unless manually refreshed.
                        </div>
                        <div class="sf-settings-detected">${detectedText}</div>
                    </div>

                    <div class="sf-settings-row">
                        <label>
                            <input type="checkbox" id="sf-auto-production" ${settings.autoCalibrateProduction ? 'checked' : ''}>
                            Auto-calibrate production
                        </label>
                        <div class="sf-settings-note">
                            Reads Production at most once per StarFury server hour unless manually refreshed. No background polling.
                        </div>
                    </div>

                    <h3>Manual / fallback research</h3>
                    <div id="sf-research-checkboxes"></div>

                    <h3>Advanced fallback</h3>
                    <div class="sf-settings-row">
                        <label>
                            Research Labs RP per lab/tick:
                            <input class="sf-settings-number" type="number" id="sf-research-rate" min="0" step="0.05" value="${settings.fallbackResearchPerLab}">
                        </label>
                    </div>

                    <div class="sf-settings-row">
                        <label>
                            Defence points per Defence Platform:
                            <input class="sf-settings-number" type="number" id="sf-defence-platform-rate" min="0" step="1" value="${settings.fallbackDefencePerPlatform}">
                        </label>
                        <div class="sf-settings-note">
                            Confirmed value: 15 defence/platform. No extra race/research/global modifier is applied.
                        </div>
                    </div>

                    <div class="sf-settings-buttons">
                        <button id="sf-settings-cancel">Cancel</button>
                        <button id="sf-settings-save">Save</button>
                    </div>
                `;

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                const checkboxContainer = modal.querySelector('#sf-research-checkboxes');

                for (const researchName of PRODUCTION_RESEARCH) {
                    const row = ctx.element('div');
                    row.className = 'sf-settings-row';
                    const checked = settings.manualResearch[researchName] ? 'checked' : '';

                    row.innerHTML = `
                        <label>
                            <input type="checkbox" class="sf-manual-research" data-research="${researchName}" ${checked}>
                            ${researchName}
                        </label>
                    `;

                    checkboxContainer.appendChild(row);
                }

                ctx.on(modal.querySelector('#sf-settings-cancel'), 'click', () => overlay.remove());
                ctx.on(overlay, 'click', event => {
                    if (event.target === overlay) overlay.remove();
                });

                ctx.on(modal.querySelector('#sf-settings-save'), 'click', () => {
                    const newSettings = {
                        autoDetectResearch: modal.querySelector('#sf-auto-research').checked,
                        autoCalibrateProduction: modal.querySelector('#sf-auto-production').checked,
                        manualResearch: {},
                        fallbackResearchPerLab:
                            Number(modal.querySelector('#sf-research-rate').value) ||
                            DEFAULT_SETTINGS.fallbackResearchPerLab,
                        fallbackDefencePerPlatform:
                            Number(modal.querySelector('#sf-defence-platform-rate').value) ||
                            DEFAULT_SETTINGS.fallbackDefencePerPlatform
                    };

                    for (const checkbox of modal.querySelectorAll('.sf-manual-research')) {
                        newSettings.manualResearch[checkbox.dataset.research] = checkbox.checked;
                    }

                    saveSettings(newSettings);
                    overlay.remove();
                    window.location.reload();
                });
            }

            function forceRefresh() {
                clearEmpireCache(runtimeContext.empireKey);
                window.location.reload();
            }

            // ---------------------------------------------------------------------
            // Raze view
            // Presentation-only enhancement. Existing StarFury confirmation remains the
            // source of truth and no destructive action is automatically submitted.
            // ---------------------------------------------------------------------
            function isRazePage() {
                return document.querySelector('table.buildingsRaze') != null;
            }

            function getRazeCostPerBuilding() {
                const advisorText = document.querySelector('#advisor-content .advice')?.textContent || '';
                const match = advisorText.match(/costs\s+([\d,]+)\s*credits?\s+per\s+building\s+to\s+raze/i);
                return match ? Number(match[1].replace(/,/g, '')) : 50;
            }

            function ensureRazeSummary(costPerBuilding) {
                let summary = document.getElementById('sf-raze-summary');
                if (summary) return summary;

                const boxHeader = document.querySelector('#contentWide .contentbox .boxheader');
                if (!boxHeader) return null;

                summary = ctx.element('div');
                summary.id = 'sf-raze-summary';
                summary.className = 'sf-raze-summary';
                summary.setAttribute('aria-label', 'Raze selection summary');

                const title = ctx.element('div');
                title.className = 'sf-raze-summary-title';
                title.textContent = 'Demolition';

                const rate = ctx.element('div');
                rate.className = 'sf-raze-summary-rate';
                rate.textContent = `${costPerBuilding.toLocaleString()} credits / building`;

                const selected = ctx.element('div');
                selected.className = 'sf-raze-summary-selected';
                selected.textContent = '0 buildings selected';

                const cost = ctx.element('div');
                cost.className = 'sf-raze-summary-cost';
                cost.textContent = '0 credits';

                summary.append(title, rate, selected, cost);
                boxHeader.insertAdjacentElement('afterend', summary);
                summary.classList.add('sf-visible');

                return summary;
            }

            function decorateRazeSection(table, rowData) {
                const sectionTitle = findSectionTitleForTable(table);
                if (!sectionTitle || sectionTitle.dataset.sfRazeDecorated === 'true') return;

                const name = getSectionName(sectionTitle) || 'Raze Buildings';
                const builtTotal = rowData.reduce((sum, item) => sum + item.built, 0);
                const buildingTotal = rowData.reduce((sum, item) => sum + item.building, 0);

                sectionTitle.textContent = '';

                const nameSpan = ctx.element('span');
                nameSpan.className = 'sf-raze-section-name';
                nameSpan.textContent = name;

                const meta = ctx.element('span');
                meta.className = 'sf-raze-section-meta';
                meta.textContent = `${builtTotal.toLocaleString()} built · ${buildingTotal.toLocaleString()} building`;

                sectionTitle.append(nameSpan, meta);
                sectionTitle.classList.add('sf-raze-section-title');
                sectionTitle.dataset.sfRazeDecorated = 'true';
            }

            function setRazeRowSurface(row, selected) {
                if (!row) return;

                const background = selected
                    ? 'rgba(199,92,92,0.055)'
                    : 'rgba(255,255,255,0.018)';

                row.style.setProperty('background', background, 'important');
                row.style.setProperty('background-color', background, 'important');
                row.style.setProperty('background-image', 'none', 'important');

                for (const cell of row.cells) {
                    cell.style.setProperty('background', background, 'important');
                    cell.style.setProperty('background-color', background, 'important');
                    cell.style.setProperty('background-image', 'none', 'important');
                }
            }

            function updateRazeSummary(summary, rowData, costPerBuilding) {
                if (!summary) return;

                let selectedCount = 0;

                for (const item of rowData) {
                    const raw = parseNumber(item.input?.value) ?? 0;
                    const selected = Math.max(0, Math.floor(raw));
                    selectedCount += selected;
                    item.row.classList.toggle('sf-raze-selected', selected > 0);
                    setRazeRowSurface(item.row, selected > 0);
                }

                const selected = summary.querySelector('.sf-raze-summary-selected');
                const cost = summary.querySelector('.sf-raze-summary-cost');

                if (selected) {
                    selected.textContent = `${selectedCount.toLocaleString()} ${selectedCount === 1 ? 'building' : 'buildings'} selected`;
                }

                if (cost) {
                    cost.textContent = `${(selectedCount * costPerBuilding).toLocaleString()} credits`;
                }
            }

            function enhanceRazePage() {
                const tables = [...document.querySelectorAll('table.buildingsRaze')];
                if (!tables.length) return;

                const costPerBuilding = getRazeCostPerBuilding();
                const summary = ensureRazeSummary(costPerBuilding);
                const allRows = [];

                for (const table of tables) {
                    if (table.dataset.sfRazeEnhanced === 'true') continue;

                    const rows = [...table.rows];
                    if (rows.length < 2) continue;

                    const headerRow = rows[0];
                    const headers = [...headerRow.cells].map(cell => normalizeText(cell.textContent));
                    const typeIndex = headers.indexOf('building type');
                    const builtIndex = headers.indexOf('built');
                    const buildingIndex = headers.indexOf('building');
                    const demolishIndex = headers.indexOf('demolish');

                    if ([typeIndex, builtIndex, buildingIndex, demolishIndex].some(index => index === -1)) {
                        continue;
                    }

                    headerRow.cells[buildingIndex].textContent = 'In Progress';
                    table.classList.add('sf-raze-enhanced');
                    table.dataset.sfRazeEnhanced = 'true';

                    table.style.setProperty('background', 'transparent', 'important');
                    table.style.setProperty('background-color', 'transparent', 'important');
                    table.style.setProperty('background-image', 'none', 'important');

                    if (table.tBodies[0]) {
                        table.tBodies[0].style.setProperty('background', 'transparent', 'important');
                        table.tBodies[0].style.setProperty('background-color', 'transparent', 'important');
                        table.tBodies[0].style.setProperty('background-image', 'none', 'important');
                    }

                    const sectionRows = [];

                    for (const row of rows.slice(1)) {
                        const name = row.cells[typeIndex]?.textContent?.trim() || '';
                        if (!name) continue;

                        row.classList.add('sf-raze-row');

                        const iconCell = row.cells[0];
                        const typeCell = row.cells[typeIndex];
                        const builtCell = row.cells[builtIndex];
                        const buildingCell = row.cells[buildingIndex];
                        const inputCell = row.cells[demolishIndex];
                        const input = inputCell?.querySelector('input[type="number"]');
                        configureNonNegativeIntegerInput(input);

                        iconCell?.classList.add('sf-raze-icon-cell');
                        typeCell?.classList.add('sf-raze-type');
                        builtCell?.classList.add('sf-raze-built');
                        buildingCell?.classList.add('sf-raze-building');
                        inputCell?.classList.add('sf-raze-input');

                        const built = getCellNumber(builtCell);
                        const building = getCellNumber(buildingCell);

                        if (builtCell) {
                            builtCell.textContent = '';
                            const main = ctx.element('div');
                            main.className = 'sf-raze-main-number';
                            main.textContent = built.toLocaleString();
                            builtCell.appendChild(main);
                        }

                        if (buildingCell) {
                            buildingCell.textContent = '';
                            const main = ctx.element('div');
                            main.className = 'sf-raze-main-number';
                            main.textContent = building.toLocaleString();
                            buildingCell.appendChild(main);
                        }

                        const mobileSummary = ctx.element('div');
                        mobileSummary.className = 'sf-raze-mobile-summary';

                        const builtStrong = ctx.element('strong');
                        builtStrong.textContent = built.toLocaleString();
                        mobileSummary.append(builtStrong, ' built');

                        if (building > 0) {
                            const progress = ctx.element('span');
                            progress.className = 'sf-raze-mobile-building';
                            progress.textContent = `${building.toLocaleString()} building`;
                            mobileSummary.appendChild(progress);
                        }

                        typeCell?.appendChild(mobileSummary);

                        const item = { row, name, built, building, input };
                        sectionRows.push(item);
                        allRows.push(item);

                        if (input) {
                            ctx.on(input, 'input', () => {
                                updateRazeSummary(summary, allRows, costPerBuilding);
                            });
                        }
                    }

                    decorateRazeSection(table, sectionRows);
                }

                const submit = document.querySelector('form[action*="raze"][action*="confirm"] input[type="submit"]');
                if (submit) {
                    submit.classList.add('sf-raze-submit');
                    submit.title = "Continue to StarFury's raze confirmation step.";
                }

                updateRazeSummary(summary, allRows, costPerBuilding);
            }

            // ---------------------------------------------------------------------
            // Bootstrap / page dispatch
            // ---------------------------------------------------------------------
            async function main() {
                addStyles();

                const serverClock = getServerClock();
                runtimeContext.empireKey = identifyCurrentEmpire();
                runtimeContext.serverHourBucket = serverClock?.hourBucket ?? null;

                if (isRazePage()) {
                    enhanceRazePage();
                    return;
                }

                addCalculatorHeaderMeta();

                const buildingRows = collectBuildingRows();
                if (!Object.keys(buildingRows).length) return;

                const settings = loadSettings();
                const cached = readCache(
                    runtimeContext.empireKey,
                    runtimeContext.serverHourBucket
                );

                if (cached) {
                    runtimeContext.detectedResearch = { ...cached.research };

                    renderProduction(
                        buildingRows,
                        cached.rates,
                        cached.research,
                        cached.snapshot
                    );

                    const cacheTime = cached.cachedAtServerTime || 'cached';
                    updateCacheStatus(
                        `Calc: ${cacheTime}`,
                        cached.cachedAtServerLabel
                            ? `Calculator data cached at ${cached.cachedAtServerLabel}. No additional StarFury pages were requested.`
                            : 'No additional StarFury pages were requested.'
                    );

                    return;
                }

                updateCacheStatus('Calc: refreshing');

                let research = { ...settings.manualResearch };
                let techDocument = null;
                let researchPointsPerTick = null;

                if (settings.autoDetectResearch) {
                    try {
                        techDocument = await fetchDocument('/techtree.php');
                        research = detectCompletedResearch(techDocument);
                        researchPointsPerTick = getResearchPointsPerTick(techDocument);
                        runtimeContext.detectedResearch = { ...research };
                    } catch (error) {
                        console.warn(
                            '[StarFury Building Calculator] Research detection failed; using fallback.',
                            error
                        );
                    }
                }

                if (settings.autoCalibrateProduction && !techDocument) {
                    try {
                        techDocument = await fetchDocument('/techtree.php');
                        researchPointsPerTick = getResearchPointsPerTick(techDocument);
                    } catch (error) {
                        console.warn(
                            '[StarFury Building Calculator] Could not read RP/tick.',
                            error
                        );
                    }
                }

                let production = {
                    power: null,
                    metal: null,
                    deuterium: null,
                    iridium: null,
                    population: null,
                    populationCapacity: null,
                    recruits: null,
                    probes: null,
                    credits: null,
                    militaryRunningCosts: null,
                    netCredits: null
                };

                if (settings.autoCalibrateProduction) {
                    try {
                        const productionDocument = await fetchDocument('/production.php');
                        production = readProductionPage(productionDocument);
                    } catch (error) {
                        console.warn(
                            '[StarFury Building Calculator] Production calibration failed; using fallback.',
                            error
                        );
                    }
                }

                const snapshotPopulation = getCurrentPopulation();
                const snapshot = {
                    population: snapshotPopulation,
                    production,
                    researchPointsPerTick
                };

                const rates = calculateLiveRates({
                    buildingRows,
                    research,
                    settings,
                    production,
                    researchPointsPerTick,
                    snapshotPopulation
                });

                renderProduction(buildingRows, rates, research, snapshot);

                const cacheClock = getServerClock() || serverClock;
                writeCache(
                    runtimeContext.empireKey,
                    cacheClock,
                    research,
                    rates,
                    snapshot
                );

                updateCacheStatus(
                    `Calc: ${cacheClock?.time || 'fresh'}`,
                    cacheClock?.fullLabel
                        ? `Fresh calculator data captured at ${cacheClock.fullLabel}.`
                        : 'Fresh calculator data captured.'
                );
            }

            ctx.menu('Building Calculator Settings', openSettingsModal);
            ctx.menu('Refresh Building Calculator Data', forceRefresh);


            return { init() { document.documentElement.dataset.sfuxPage = 'buildings'; return main(); }, destroy: ctx.destroy };
        }
    });
}

/* StarFury UX Suite 2.0.1 | Ship Power Routing module. */
function registerShipPowerRouting(SFUX) {
    SFUX.register({
        id: 'ship', phase: 'ready',
        matches(path, url) { return path === '/viewship.php' || path === '/stardock.php'; },
        create(ctx) {

            'use strict';

            /*
             * StarFury Ship UX 0.8.4 - Developer Handoff Edition
             * -------------------------------------------------------------------------
             * This file intentionally serves two purposes:
             *
             * 1. It remains a functioning userscript for StarFury's View Ship and
             *    Star Dock workflows.
             * 2. It is a reference implementation for integrating the accepted UX
             *    directly into StarFury.
             *
             * PORT CONCEPTS, NOT DOM ARCHAEOLOGY:
             * - Keep the information hierarchy, state treatments, responsive layouts,
             *   power-routing workflows, transfer workflow, construction planning,
             *   role colors, typography, and action semantics.
             * - Replace DOM scraping, rendered-text parsing, injected CSS, table
             *   surgery, URL-state reconstruction, and ship-name hydration requests
             *   with structured server/template data and semantic markup.
             *
             * IMPORTANT:
             * - Existing StarFury forms remain authoritative. The userscript moves or
             *   restyles native controls rather than inventing new backend endpoints.
             * - Ship-name lookups on Star Dock are a compatibility workaround. A native
             *   implementation should include ship name/id/class directly in roster data.
             * - The accompanying README.md documents the intended native data model,
             *   page modes, caching behavior, and implementation sequence.
             */

            // ---------------------------------------------------------------------
            // Persistent state, low-impact ship-name cache, and generic helpers
            // ---------------------------------------------------------------------
            const STYLE_ID = 'sfux-ship-power-routing-style';
            const PROFILE_KEY = 'sfuxShipPowerProfilesV1';
            const SHIP_NAME_CACHE_KEY = 'sfuxShipNamesV1';
            // Client-side request/cache budgets, not game rules.
            const NAME_CACHE_MAX = 400;
            const NAME_CACHE_RETAIN = 350;
            const NAME_LOOKUPS_PER_LOAD = 12;
            const NAME_LOOKUP_DELAY_MS = 250;

            const shipNameCache = (() => {
                const saved = SFUX.storage.get(SHIP_NAME_CACHE_KEY, {});
                return saved && typeof saved === 'object' ? saved : {};
            })();

            function cachedShipName(shipId) {
                if (!shipId) return '';
                return String(shipNameCache[shipId]?.name || '').trim();
            }

            function rememberShipName(shipId, name) {
                const cleanId = String(shipId || '').trim();
                const cleanName = String(name || '').replace(/\s+/g, ' ').trim();

                if (!cleanId || !cleanName) return;

                if (shipNameCache[cleanId]?.name === cleanName) {
                    shipNameCache[cleanId].seenAt = Date.now();
                    return;
                }

                shipNameCache[cleanId] = {
                    name: cleanName,
                    seenAt: Date.now()
                };

                // Keep the cache bounded in case the account accumulates many old ships.
                const entries = Object.entries(shipNameCache);
                if (entries.length > NAME_CACHE_MAX) {
                    entries
                        .sort((a, b) => (a[1]?.seenAt || 0) - (b[1]?.seenAt || 0))
                        .slice(0, entries.length - NAME_CACHE_RETAIN)
                        .forEach(([id]) => delete shipNameCache[id]);
                }

                SFUX.storage.set(SHIP_NAME_CACHE_KEY, shipNameCache);
            }

            function shipNameFromDocument(doc) {
                const form = Array.from(doc.forms || []).find(candidate => {
                    const action = candidate.getAttribute('action') || '';
                    return action.includes('rn=1') && candidate.querySelector('input[name="name"]');
                });

                const input = form?.querySelector('input[name="name"]');
                return String(input?.value || '').replace(/\s+/g, ' ').trim();
            }

            function rememberCurrentViewShipName() {
                const shipId = getShipId();
                if (!shipId) return;

                const name = shipNameFromDocument(document);
                if (name) rememberShipName(shipId, name);
            }

            const DEFAULT_PROFILES = {
                weapons: {
                    primary: 100,
                    engine: 0
                },
                sensors: {
                    primary: 100,
                    engine: 0
                }
            };

            const clampPercent = value => SFUX.format.clamp(value, 0, 100);

            function loadProfiles() {
                const saved = SFUX.storage.get(PROFILE_KEY, null) || {};

                return {
                    weapons: {
                        primary: clampPercent(saved.weapons?.primary ?? DEFAULT_PROFILES.weapons.primary),
                        engine: clampPercent(saved.weapons?.engine ?? DEFAULT_PROFILES.weapons.engine)
                    },
                    sensors: {
                        primary: clampPercent(saved.sensors?.primary ?? DEFAULT_PROFILES.sensors.primary),
                        engine: clampPercent(saved.sensors?.engine ?? DEFAULT_PROFILES.sensors.engine)
                    }
                };
            }

            function normalizeProfile(profile) {
                const engine = clampPercent(profile.engine);
                return {
                    primary: 100 - engine,
                    engine
                };
            }

            function saveProfiles(profiles) {
                const normalized = {
                    weapons: normalizeProfile(profiles.weapons),
                    sensors: normalizeProfile(profiles.sensors)
                };

                SFUX.storage.set(PROFILE_KEY, normalized);
                return normalized;
            }

            const normalizeText = SFUX.dom.key;

            function parsePercent(value) {
                const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
                return match ? clampPercent(match[0]) : null;
            }

            function getShipId() {
                return new URLSearchParams(window.location.search).get('ShipID');
            }

            function getPowerFields(form) {
                if (!form) return null;
                const named = name => Array.from(form.elements).find(element => element.name === name);
                const weapons = named('weapons');
                const engine = named('eng') || named('engines');
                const sensors = named('sensors');
                return weapons && engine && sensors ? { weapons, engine, sensors } : null;
            }

            function isLeecherPowerForm(form) {
                const fields = getPowerFields(form);
                if (!fields || fields.weapons.tagName !== 'SELECT') return false;

                const legalValues = Array.from(fields.weapons.options || [])
                    .map(option => String(option.value || '').trim())
                    .filter(Boolean);

                return (
                    legalValues.includes('5') &&
                    legalValues.includes('25') &&
                    legalValues.every(value => value === '5' || value === '25')
                );
            }

            function findPowerForm() {
                return Array.from(document.forms).find(form => {
                    const action = form.getAttribute('action') || '';
                    return action.includes('power=1') && Boolean(getPowerFields(form));
                }) || null;
            }

            function hideNativePowerDistributionTable() {
                const tables = Array.from(document.querySelectorAll('table.shipviewtable'));

                const powerTable = tables.find(table => {
                    const firstRow = table.rows?.[0];
                    return normalizeText(firstRow?.textContent).includes('power distribution');
                });

                if (powerTable) {
                    powerTable.classList.add('sfux-power-distribution-hidden');
                }
            }

            function readDisplayedDistribution(form) {
                const tables = Array.from(document.querySelectorAll('table.shipviewtable'));
                const powerTable = tables.find(table => {
                    const firstRow = table.rows?.[0];
                    return normalizeText(firstRow?.textContent).includes('power distribution');
                });

                if (powerTable) {
                    const distribution = {
                        weapons: null,
                        engine: null,
                        sensors: null
                    };

                    for (const row of Array.from(powerTable.rows).slice(1)) {
                        const cells = Array.from(row.cells || []);
                        if (cells.length < 2) continue;

                        const label = normalizeText(cells[0].textContent);
                        const value = parsePercent(cells[cells.length - 1].textContent);

                        if (label === 'weapons') distribution.weapons = value;
                        if (label === 'engines') distribution.engine = value;
                        if (label === 'sensors') distribution.sensors = value;
                    }

                    if (
                        distribution.weapons !== null &&
                        distribution.engine !== null &&
                        distribution.sensors !== null
                    ) {
                        return distribution;
                    }
                }

                const fields = getPowerFields(form);

                return {
                    weapons: parsePercent(fields?.weapons?.value) ?? 0,
                    engine: parsePercent(fields?.engine?.value) ?? 0,
                    sensors: parsePercent(fields?.sensors?.value) ?? 0
                };
            }

            function allocationFor(mode, profile) {
                const normalized = normalizeProfile(profile);

                if (mode === 'weapons') {
                    return {
                        weapons: normalized.primary,
                        engine: normalized.engine,
                        sensors: 0
                    };
                }

                return {
                    weapons: 0,
                    engine: normalized.engine,
                    sensors: normalized.primary
                };
            }

            function distributionsMatch(left, right) {
                return (
                    left.weapons === right.weapons &&
                    left.engine === right.engine &&
                    left.sensors === right.sensors
                );
            }

            function setNativePowerValues(form, allocation) {
                const fields = getPowerFields(form);
                if (!fields) return false;
                const changes = [[fields.weapons, allocation.weapons], [fields.engine, allocation.engine], [fields.sensors, allocation.sensors]];
                // Respect native capability flags. No partial allocation is applied if a
                // disabled/read-only field would have to change to represent the preset.
                if (changes.some(([field, value]) => (field.matches(':disabled') || field.readOnly) && Number(field.value) !== value)) return false;
                for (const [field, value] of changes) if (!field.matches(':disabled') && !field.readOnly) field.value = String(value);
                for (const [field] of changes) if (!field.matches(':disabled') && !field.readOnly) {
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return changes.every(([field, value]) => Number(field.value) === value);
            }

            // ---------------------------------------------------------------------
            // Shared visual system and responsive component styling
            // ---------------------------------------------------------------------
            function injectStyles() { ctx.style(STYLE_ID, `


                    .sfux-power-native-hidden,
                    .sfux-power-distribution-hidden {
                        display: none !important;
                    }

                    /* -------------------------------------------------------------
                     * Rename Ship
                     * ----------------------------------------------------------- */
                    .sfux-rename-form p {
                        margin: 0 !important;
                    }

                    .sfux-rename-label {
                        display: block;
                        margin-bottom: 6px;
                        color: rgba(255,255,255,0.88);
                        font-size: var(--sfux-type-label);
                        line-height: 1.2;
                    }

                    .sfux-rename-row {
                        display: grid;
                        grid-template-columns: minmax(0, 1fr) auto;
                        align-items: stretch;
                        gap: 7px;
                    }

                    .sfux-rename-row .inputBox {
                        width: 100% !important;
                        min-width: 0;
                        height: 36px !important;
                        box-sizing: border-box;
                        margin: 0 !important;
                    }

                    .sfux-rename-row .button-primary {
                        min-width: 78px;
                        height: 36px !important;
                        box-sizing: border-box;
                        margin: 0 !important;
                        padding: 0 12px !important;
                    }

                    /* -------------------------------------------------------------
                     * Power routing
                     * ----------------------------------------------------------- */
                    .sfux-power-router {
                        margin: 1px 0 4px;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-power-current {
                        display: grid;
                        grid-template-columns: auto 1fr;
                        align-items: center;
                        gap: 8px;
                        margin: 0 0 7px;
                        padding: 6px 8px;
                        border: 1px solid rgba(255,255,255,0.07);
                        background: rgba(255,255,255,0.022);
                        color: rgba(255,255,255,0.52);
                        font-size: var(--sfux-type-md);
                        line-height: 1.2;
                    }

                    .sfux-power-current-label {
                        color: rgba(255,255,255,0.72);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        letter-spacing: .04em;
                        text-transform: uppercase;
                        white-space: nowrap;
                    }

                    .sfux-power-current-values {
                        display: flex;
                        justify-content: flex-end;
                        align-items: center;
                        gap: 12px;
                        min-width: 0;
                        white-space: nowrap;
                    }

                    .sfux-power-current-value {
                        font-weight: 700;
                    }

                    .sfux-power-current-value--weapons { color: rgba(var(--sfux-weapon-rgb), .96); }
                    .sfux-power-current-value--engines { color: rgba(var(--sfux-engine-rgb), .96); }
                    .sfux-power-current-value--sensors { color: rgba(var(--sfux-sensor-rgb), .96); }

                    .sfux-power-route {
                        --route-color: 255,255,255;
                        margin: 0;
                        padding: 8px 0;
                        border-bottom: 1px solid rgba(255,255,255,0.11);
                    }

                    .sfux-power-route:last-of-type {
                        border-bottom: 0;
                    }

                    .sfux-power-route--weapons {
                        --route-color: var(--sfux-weapon-rgb);
                    }

                    .sfux-power-route--sensors {
                        --route-color: var(--sfux-sensor-rgb);
                    }

                    .sfux-power-route-main {
                        display: grid;
                        grid-template-columns: minmax(0, 1fr) 116px 34px;
                        align-items: center;
                        gap: 6px;
                    }

                    .sfux-power-route-label {
                        min-width: 0;
                    }

                    .sfux-power-route-name {
                        display: block;
                        color: rgba(var(--route-color), .98);
                        font-size: var(--sfux-type-label);
                        font-weight: 700;
                        line-height: 1.15;
                    }

                    .sfux-power-route-split {
                        display: block;
                        margin-top: 3px;
                        color: rgba(255,255,255,0.46);
                        font-size: var(--sfux-type-sm);
                        line-height: 1.15;
                        white-space: nowrap;
                    }

                    .sfux-power-action,
                    .sfux-power-gear,
                    .sfux-power-editor button {
                        box-sizing: border-box;
                        margin: 0 !important;
                        border-radius: var(--sfux-radius-sm);
                        font-family: inherit;
                        font-weight: 700;
                        cursor: pointer;
                    }

                    .sfux-power-action {
                        width: 116px;
                        height: 34px;
                        padding: 0 8px;
                        border: 1px solid rgba(var(--route-color), .76);
                        background: rgba(var(--route-color), .88);
                        color: #fff;
                        font-size: var(--sfux-type-md);
                        line-height: 32px;
                        text-align: center;
                        text-transform: uppercase;
                        letter-spacing: .025em;
                        white-space: nowrap;
                    }

                    .sfux-power-action:hover:not(:disabled) {
                        filter: brightness(1.10);
                    }

                    .sfux-power-action.sfux-power-active {
                        border-color: rgba(var(--route-color), .64);
                        background: rgba(var(--route-color), .17);
                        color: rgba(var(--route-color), 1);
                        cursor: default;
                    }

                    .sfux-power-action:disabled {
                        opacity: 1;
                    }

                    .sfux-power-gear {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 34px;
                        height: 34px;
                        padding: 0;
                        border: 1px solid rgba(var(--route-color), .30);
                        background: rgba(var(--route-color), .045);
                        color: rgba(var(--route-color), .82);
                        font-size: var(--sfux-type-title);
                        line-height: 1;
                    }

                    .sfux-power-gear:hover,
                    .sfux-power-gear.sfux-power-gear-open {
                        border-color: rgba(var(--route-color), .58);
                        background: rgba(var(--route-color), .12);
                        color: rgba(var(--route-color), 1);
                    }

                    /* -------------------------------------------------------------
                     * Preset editor
                     * ----------------------------------------------------------- */
                    .sfux-power-editor {
                        display: none;
                        margin-top: 8px;
                        padding: 9px;
                        border: 1px solid rgba(var(--route-color), .25);
                        border-left: 2px solid rgba(var(--route-color), .72);
                        background:
                            linear-gradient(180deg,
                                rgba(var(--route-color), .055),
                                rgba(0,0,0,.16));
                        box-shadow: inset 0 1px 0 rgba(255,255,255,.025);
                    }

                    .sfux-power-editor.sfux-power-editor-open {
                        display: block;
                    }

                    .sfux-power-editor-head {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        margin-bottom: 8px;
                    }

                    .sfux-power-editor-title {
                        color: rgba(var(--route-color), .94);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        letter-spacing: .045em;
                        text-transform: uppercase;
                        white-space: nowrap;
                    }

                    .sfux-power-editor-total {
                        color: rgba(255,255,255,.42);
                        font-size: var(--sfux-type-sm);
                        font-weight: 600;
                        white-space: nowrap;
                    }

                    .sfux-power-allocation-bar {
                        display: flex;
                        width: 100%;
                        height: 8px;
                        overflow: hidden;
                        border: 1px solid rgba(255,255,255,.08);
                        border-radius: var(--sfux-radius-xs);
                        background: rgba(255,255,255,.025);
                    }

                    .sfux-power-allocation-primary {
                        width: 100%;
                        min-width: 0;
                        background: rgba(var(--route-color), .82);
                        transition: width .12s ease;
                    }

                    .sfux-power-allocation-engine {
                        width: 0%;
                        min-width: 0;
                        background: rgba(var(--sfux-engine-rgb), .84);
                        transition: width .12s ease;
                    }

                    .sfux-power-allocation-legend {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        margin-top: 5px;
                        font-size: var(--sfux-type-sm);
                        line-height: 1.15;
                    }

                    .sfux-power-allocation-primary-label {
                        color: rgba(var(--route-color), .95);
                        font-weight: 700;
                    }

                    .sfux-power-allocation-engine-label {
                        color: rgba(var(--sfux-engine-rgb), .95);
                        font-weight: 700;
                        text-align: right;
                    }

                    .sfux-power-engine-control {
                        display: grid;
                        grid-template-columns: auto minmax(0,1fr) 62px;
                        align-items: center;
                        gap: 7px;
                        margin-top: 10px;
                    }

                    .sfux-power-engine-control-label {
                        color: rgba(255,255,255,.56);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        text-transform: uppercase;
                        white-space: nowrap;
                    }

                    .sfux-power-engine-range {
                        width: 100%;
                        min-width: 0;
                        margin: 0;
                        accent-color: rgb(var(--sfux-engine-rgb));
                        cursor: pointer;
                    }

                    .sfux-power-engine-number-wrap {
                        display: grid;
                        grid-template-columns: 1fr auto;
                        align-items: center;
                        gap: 2px;
                        min-width: 0;
                    }

                    .sfux-power-engine-input {
                        width: 48px !important;
                        height: 28px !important;
                        box-sizing: border-box !important;
                        margin: 0 !important;
                        padding: 2px 6px !important;
                        text-align: center;
                        font-size: 11.5px !important;
                        appearance: textfield;
                        -moz-appearance: textfield;
                    }

                    .sfux-power-engine-input::-webkit-outer-spin-button,
                    .sfux-power-engine-input::-webkit-inner-spin-button {
                        margin: 0;
                        -webkit-appearance: none;
                    }

                    .sfux-power-engine-percent {
                        color: rgba(255,255,255,.60);
                        font-size: var(--sfux-type-md);
                    }

                    .sfux-power-editor-actions {
                        display: flex;
                        align-items: center;
                        justify-content: flex-end;
                        gap: 6px;
                        margin-top: 9px;
                        padding-top: 8px;
                        border-top: 1px solid rgba(255,255,255,.07);
                    }

                    .sfux-power-editor button {
                        height: 28px;
                        padding: 0 8px;
                        border: 1px solid rgba(255,255,255,.13);
                        background: rgba(255,255,255,.035);
                        color: rgba(255,255,255,.69);
                        font-size: var(--sfux-type-sm);
                        line-height: 26px;
                    }

                    .sfux-power-editor button.sfux-power-save {
                        border-color: rgba(var(--route-color), .46);
                        background: rgba(var(--route-color), .09);
                        color: rgba(var(--route-color), .98);
                    }

                    .sfux-power-editor button:hover {
                        background: rgba(255,255,255,.08);
                        color: #fff;
                    }


                    /* -------------------------------------------------------------
                     * Leecher power routing
                     * ----------------------------------------------------------- */
                    .sfux-leecher-router {
                        margin-top: 8px;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-leecher-preset .sfux-power-route-main {
                        grid-template-columns: minmax(0, 1fr) 116px;
                    }

                    .sfux-leecher-preset .sfux-power-route-name {
                        color: rgba(var(--sfux-weapon-rgb), .98);
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
                        .sfux-leecher-preset .sfux-power-route-main {
                            grid-template-columns: minmax(0, 1fr) 108px;
                        }
                    }

                    .sfux-leecher-rule {
                        display: grid;
                        grid-template-columns: auto 1fr;
                        align-items: center;
                        gap: 8px;
                        margin-top: 8px;
                        padding: 8px;
                        border: 1px solid rgba(255,255,255,.07);
                        background: rgba(255,255,255,.018);
                    }

                    .sfux-leecher-rule-label {
                        color: rgba(255,255,255,.46);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        line-height: 1.2;
                        letter-spacing: .03em;
                        text-transform: uppercase;
                    }

                    .sfux-leecher-weapon-options {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0,1fr));
                        gap: 5px;
                    }

                    .sfux-leecher-weapon-option {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        min-width: 0;
                        height: 36px;
                        padding: 0 10px;
                        border: 1px solid rgba(var(--sfux-weapon-rgb), .30);
                        border-radius: var(--sfux-radius-xs);
                        background: rgba(var(--sfux-weapon-rgb), .035);
                        color: rgba(238,113,104,.80);
                        font-family: inherit;
                        font-size: var(--sfux-type-title);
                        font-weight: 700;
                        line-height: 1;
                        text-align: center;
                        cursor: pointer;
                    }

                    .sfux-leecher-weapon-option:hover {
                        border-color: rgba(var(--sfux-weapon-rgb), .55);
                        background: rgba(var(--sfux-weapon-rgb), .07);
                    }

                    .sfux-leecher-weapon-option.sfux-leecher-weapon-option--selected {
                        border-color: rgba(var(--sfux-weapon-rgb), .72);
                        background: rgba(var(--sfux-weapon-rgb), .12);
                        color: rgba(244,133,125,.98);
                        box-shadow: inset 0 0 0 1px rgba(var(--sfux-weapon-rgb), .12);
                    }

                    .sfux-leecher-budget {
                        margin-top: 8px;
                        padding: 8px;
                        border: 1px solid rgba(255,255,255,.07);
                        background: rgba(0,0,0,.10);
                    }

                    .sfux-leecher-budget-head {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        margin-bottom: 7px;
                    }

                    .sfux-leecher-budget-title {
                        color: rgba(255,255,255,.48);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        letter-spacing: .03em;
                        text-transform: uppercase;
                    }

                    .sfux-leecher-budget-value {
                        color: rgba(255,255,255,.72);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                    }

                    .sfux-leecher-routing-labels {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        margin-bottom: 5px;
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                    }

                    .sfux-leecher-engine-label {
                        color: rgba(var(--sfux-engine-rgb), .96);
                    }

                    .sfux-leecher-sensor-label {
                        color: rgba(var(--sfux-sensor-rgb), .96);
                        text-align: right;
                    }

                    .sfux-leecher-slider {
                        width: 100%;
                        margin: 0;
                        accent-color: var(--sfux-sensor);
                        cursor: pointer;
                    }

                    .sfux-leecher-scale {
                        display: flex;
                        justify-content: space-between;
                        margin-top: 2px;
                        color: rgba(255,255,255,.25);
                        font-size: var(--sfux-type-xs);
                    }

                    .sfux-leecher-actions {
                        display: flex;
                        justify-content: flex-end;
                        margin-top: 8px;
                    }

                    .sfux-leecher-apply {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        min-width: 108px;
                        height: 34px;
                        padding: 0 12px;
                        border: 1px solid rgba(var(--sfux-sensor-rgb), .55);
                        border-radius: var(--sfux-radius-xs);
                        background: rgba(var(--sfux-sensor-rgb), .82);
                        color: #fff;
                        font-family: inherit;
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        line-height: 1;
                        text-align: center;
                        text-transform: uppercase;
                        cursor: pointer;
                    }

                    .sfux-leecher-apply:hover:not(:disabled) {
                        background: rgba(var(--sfux-sensor-rgb), .96);
                    }

                    .sfux-leecher-apply:disabled {
                        border-color: rgba(255,255,255,.10);
                        background: rgba(255,255,255,.035);
                        color: rgba(255,255,255,.28);
                        cursor: default;
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
                        .sfux-leecher-rule {
                            grid-template-columns: 1fr;
                        }

                        .sfux-leecher-actions {
                            display: block;
                        }

                        .sfux-leecher-apply {
                            width: 100%;
                        }
                    }

                    /* -------------------------------------------------------------
                     * Ship Transfer dashboard
                     * ----------------------------------------------------------- */
                    .sfux-transfer-native-hidden {
                        display: none !important;
                    }

                    .sfux-transfer-dashboard {
                        display: grid;
                        gap: 10px;
                        margin: 0;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-transfer-card {
                        border: 1px solid rgba(255,255,255,.07);
                        border-top-color: rgba(73,114,137,.48);
                        background: rgba(255,255,255,.015);
                    }

                    .sfux-transfer-card-header {
                        display: flex;
                        align-items: baseline;
                        justify-content: space-between;
                        gap: 12px;
                        padding: 7px 9px;
                        border-bottom: 1px solid rgba(255,255,255,.065);
                        background: rgba(44,64,76,.20);
                    }

                    .sfux-transfer-card-title {
                        color: rgba(255,255,255,.88);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        line-height: 1.2;
                    }

                    .sfux-transfer-card-summary {
                        color: rgba(255,255,255,.43);
                        font-size: var(--sfux-type-sm);
                        line-height: 1.2;
                        text-align: right;
                        white-space: nowrap;
                    }

                    .sfux-transfer-body {
                        display: grid;
                        gap: 8px;
                        padding: 9px;
                    }

                    .sfux-transfer-route {
                        display: grid;
                        grid-template-columns: 72px 18px minmax(150px, 220px) minmax(0,1fr);
                        align-items: center;
                        gap: 8px;
                    }

                    .sfux-transfer-current,
                    .sfux-transfer-target-chip {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 30px;
                        padding: 3px 9px;
                        box-sizing: border-box;
                        border: 1px solid rgba(255,255,255,.11);
                        border-radius: var(--sfux-radius-xs);
                        background: rgba(255,255,255,.025);
                        color: rgba(255,255,255,.70);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        line-height: 1;
                        letter-spacing: .03em;
                        text-transform: uppercase;
                        white-space: nowrap;
                    }

                    .sfux-transfer-current {
                        width: 100%;
                    }

                    .sfux-transfer-current--attack,
                    .sfux-transfer-target-chip--attack {
                        border-color: rgba(var(--sfux-weapon-rgb), .38);
                        color: rgba(238,113,104,.97);
                    }

                    .sfux-transfer-current--defence,
                    .sfux-transfer-target-chip--defence {
                        border-color: rgba(var(--sfux-defence), .42);
                        color: rgba(91,153,255,.97);
                    }

                    .sfux-transfer-current--raider,
                    .sfux-transfer-target-chip--raider {
                        border-color: rgba(221,125,43,.42);
                        color: rgba(235,151,73,.97);
                    }

                    .sfux-transfer-current--leecher,
                    .sfux-transfer-target-chip--leecher {
                        border-color: rgba(82,185,87,.40);
                        color: rgba(116,208,121,.96);
                    }

                    .sfux-transfer-current--build,
                    .sfux-transfer-target-chip--build {
                        border-color: rgba(169,83,193,.42);
                        color: rgba(194,121,216,.97);
                    }

                    .sfux-transfer-arrow {
                        color: rgba(255,255,255,.35);
                        font-size: var(--sfux-type-title);
                        font-weight: 700;
                        text-align: center;
                    }

                    .sfux-transfer-route .selectList,
                    .sfux-transfer-target-row .selectList {
                        width: 100% !important;
                        max-width: none !important;
                        min-width: 0 !important;
                        height: 34px !important;
                        margin: 0 !important;
                        box-sizing: border-box !important;
                    }

                    .sfux-transfer-action {
                        justify-self: end;
                        min-width: 112px;
                        height: 34px !important;
                        margin: 0 !important;
                        padding: 0 13px !important;
                        box-sizing: border-box !important;
                    }

                    .sfux-transfer-action:disabled {
                        opacity: .42;
                        cursor: default;
                    }

                    .sfux-transfer-note {
                        grid-column: 3 / -1;
                        color: rgba(255,255,255,.42);
                        font-size: var(--sfux-type-sm);
                        line-height: 1.25;
                    }

                    .sfux-transfer-target-row {
                        display: grid;
                        grid-template-columns: 72px 18px minmax(150px, 220px) minmax(0,1fr);
                        align-items: center;
                        gap: 8px;
                        padding-top: 8px;
                        border-top: 1px solid rgba(255,255,255,.055);
                    }

                    .sfux-transfer-target-label {
                        grid-column: 1 / 3;
                        color: rgba(255,255,255,.46);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        letter-spacing: .025em;
                        text-transform: uppercase;
                    }

                    .sfux-transfer-target-row .selectList {
                        grid-column: 3;
                    }

                    .sfux-transfer-target-row .sfux-transfer-action {
                        grid-column: 4;
                        justify-self: end;
                    }

                    .sfux-transfer-stage-note {
                        display: flex;
                        align-items: center;
                        min-height: 32px;
                        padding: 0 9px;
                        border: 1px solid rgba(255,255,255,.055);
                        background: rgba(0,0,0,.10);
                        color: rgba(255,255,255,.43);
                        font-size: var(--sfux-type-sm);
                        line-height: 1.25;
                    }

                    @media (max-width: ${SFUX.responsive.mobile}px) {
                        .sfux-transfer-card-header {
                            align-items: center;
                        }

                        .sfux-transfer-route {
                            grid-template-columns: auto 18px minmax(0,1fr);
                        }

                        .sfux-transfer-route .sfux-transfer-action {
                            grid-column: 1 / -1;
                            justify-self: stretch;
                            width: 100%;
                        }

                        .sfux-transfer-note {
                            grid-column: 1 / -1;
                        }

                        .sfux-transfer-target-row {
                            grid-template-columns: 1fr;
                        }

                        .sfux-transfer-target-label,
                        .sfux-transfer-target-row .selectList,
                        .sfux-transfer-target-row .sfux-transfer-action {
                            grid-column: 1;
                        }

                        .sfux-transfer-target-label {
                            margin-bottom: -2px;
                        }

                        .sfux-transfer-target-row .sfux-transfer-action {
                            width: 100%;
                            justify-self: stretch;
                        }
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
                        .sfux-transfer-card-summary {
                            white-space: normal;
                        }

                        .sfux-transfer-current {
                            min-width: 0;
                            padding-inline: 7px;
                        }

                        .sfux-transfer-route {
                            grid-template-columns: auto 14px minmax(0,1fr);
                            gap: 6px;
                        }
                    }

                    /* -------------------------------------------------------------
                     * Ship Viewer dashboard
                     * ----------------------------------------------------------- */
                    .sfux-ship-native-hidden {
                        display: none !important;
                    }

                    .sfux-ship-dashboard {





                        margin: 0;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-ship-hero {
                        display: grid;
                        grid-template-columns: minmax(0, 1.22fr) minmax(235px, .78fr);
                        gap: 10px;
                        align-items: stretch;
                    }

                    .sfux-ship-image-card,
                    .sfux-ship-profile {
                        min-width: 0;
                        border: 1px solid rgba(255,255,255,.065);
                        background: rgba(255,255,255,.018);
                    }

                    .sfux-ship-image-card {
                        position: relative;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 250px;
                        overflow: hidden;
                        background:
                            radial-gradient(circle at 50% 45%,
                                rgba(52,89,116,.16),
                                rgba(0,0,0,.03) 44%,
                                rgba(0,0,0,.20) 100%);
                    }

                    .sfux-ship-image-card img {
                        display: block;
                        width: 100%;
                        max-width: 430px;
                        height: auto;
                        margin: auto;
                    }

                    .sfux-ship-status {
                        position: absolute;
                        top: 8px;
                        left: 8px;
                        max-width: calc(100% - 16px);
                        padding: 4px 8px;
                        border: 1px solid rgba(255,255,255,.12);
                        border-radius: var(--sfux-radius-xs);
                        background: rgba(18,18,18,.82);
                        color: rgba(255,255,255,.86);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        line-height: 1.2;
                        letter-spacing: .035em;
                        text-transform: uppercase;
                        white-space: nowrap;
                    }

                    .sfux-ship-status--upgrading {
                        border-color: rgba(var(--sfux-sensor-rgb), .48);
                        background: rgba(var(--sfux-sensor-rgb), .12);
                        color: rgba(103,190,249,.98);
                    }

                    .sfux-ship-status--returning {
                        border-color: rgba(var(--sfux-weapon-rgb), .45);
                        background: rgba(var(--sfux-weapon-rgb), .10);
                        color: rgba(238,113,104,.96);
                    }

                    .sfux-ship-status--defending {
                        border-color: rgba(var(--sfux-defence), .45);
                        background: rgba(var(--sfux-defence), .11);
                        color: rgba(91,153,255,.96);
                    }

                    .sfux-ship-profile {
                        display: flex;
                        flex-direction: column;
                        padding: 11px;
                    }

                    .sfux-ship-name {
                        color: var(--sfux-text-primary);
                        font-size: 18px;
                        font-weight: 700;
                        line-height: 1.12;
                    }

                    .sfux-ship-classline {
                        margin-top: 3px;
                        color: rgba(255,255,255,.49);
                        font-size: var(--sfux-type-md);
                        line-height: 1.25;
                    }

                    .sfux-ship-tags {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 5px;
                        margin-top: 9px;
                    }

                    .sfux-ship-tag {
                        display: inline-flex;
                        align-items: center;
                        min-height: 22px;
                        padding: 2px 7px;
                        box-sizing: border-box;
                        border: 1px solid rgba(255,255,255,.10);
                        border-radius: var(--sfux-radius-xs);
                        background: rgba(255,255,255,.025);
                        color: rgba(255,255,255,.69);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        line-height: 1;
                        letter-spacing: .025em;
                        text-transform: uppercase;
                    }

                    .sfux-ship-tag--attack {
                        border-color: rgba(var(--sfux-weapon-rgb), .35);
                        color: rgba(238,113,104,.96);
                    }

                    .sfux-ship-tag--defence {
                        border-color: rgba(var(--sfux-defence), .38);
                        color: rgba(91,153,255,.96);
                    }

                    .sfux-ship-tag--raider,
                    .sfux-ship-tag--raid {
                        border-color: rgba(221,125,43,.40);
                        color: rgba(235,151,73,.96);
                    }

                    .sfux-ship-tag--leecher {
                        border-color: rgba(82,185,87,.38);
                        color: rgba(116,208,121,.95);
                    }

                    .sfux-ship-tag--build {
                        border-color: rgba(169,83,193,.38);
                        color: rgba(194,121,216,.95);
                    }

                    .sfux-ship-tag--flexible {
                        border-color: rgba(82,185,87,.42);
                        background: rgba(82,185,87,.055);
                        color: rgba(116,208,121,.98);
                    }

                    .sfux-ship-tag--fixed {
                        border-color: rgba(var(--sfux-weapon-rgb), .42);
                        background: rgba(var(--sfux-weapon-rgb), .055);
                        color: rgba(238,113,104,.98);
                    }

                    .sfux-ship-systems {
                        display: grid;
                        grid-template-columns: minmax(76px,1.16fr) minmax(70px,1fr) minmax(62px,.92fr);
                        gap: 6px;
                        margin-top: 11px;
                    }

                    .sfux-ship-system {
                        min-width: 0;
                        padding: 7px;
                        border: 1px solid rgba(255,255,255,.065);
                        background: rgba(0,0,0,.12);
                    }

                    .sfux-ship-system-label {
                        display: block;
                        color: rgba(255,255,255,.42);
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        line-height: 1.1;
                        letter-spacing: .025em;
                        text-transform: uppercase;
                        white-space: nowrap;
                    }

                    .sfux-ship-system-value {
                        display: block;
                        margin-top: 3px;
                        overflow: visible;
                        color: rgba(255,255,255,.88);
                        font-size: var(--sfux-type-label);
                        font-weight: 700;
                        line-height: 1.1;
                        white-space: nowrap;
                    }

                    .sfux-ship-system-value--negative {
                        color: rgba(239,101,92,.98);
                    }

                    .sfux-ship-system-value--positive {
                        color: rgba(104,205,125,.97);
                    }

                    .sfux-ship-loadout {
                        display: grid;
                        grid-template-columns: auto minmax(0,1fr);
                        align-items: center;
                        gap: 8px;
                        margin-top: 6px;
                        padding: 7px;
                        border: 1px solid rgba(255,255,255,.065);
                        background: rgba(0,0,0,.12);
                    }

                    .sfux-ship-loadout-label {
                        color: rgba(255,255,255,.42);
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        letter-spacing: .035em;
                        text-transform: uppercase;
                    }

                    .sfux-ship-loadout-value {
                        overflow: hidden;
                        color: rgba(255,255,255,.84);
                        font-size: var(--sfux-type-md);
                        font-weight: 600;
                        text-align: right;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }

                    .sfux-ship-power-inline {
                        display: flex;
                        justify-content: flex-end;
                        align-items: center;
                        gap: 10px;
                        min-width: 0;
                        white-space: nowrap;
                    }

                    .sfux-ship-power-inline span {
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                    }

                    .sfux-ship-power-inline .sfux-power-w {
                        color: rgba(var(--sfux-weapon-rgb), .96);
                    }

                    .sfux-ship-power-inline .sfux-power-e {
                        color: rgba(var(--sfux-engine-rgb), .96);
                    }

                    .sfux-ship-power-inline .sfux-power-s {
                        color: rgba(var(--sfux-sensor-rgb), .96);
                    }

                    .sfux-ship-power-inline .sfux-power-zero {
                        color: rgba(255,255,255,.38) !important;
                        font-weight: 600;
                    }

                    .sfux-ship-power-inline .sfux-power-full {
                        font-weight: 800;
                        text-shadow: 0 0 5px currentColor;
                    }

                    .sfux-ship-profile-spacer {
                        flex: 1 1 auto;
                        min-height: 7px;
                    }

                    .sfux-ship-retire {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        margin-top: 8px;
                        padding-top: 8px;
                        border-top: 1px solid rgba(255,255,255,.07);
                    }

                    .sfux-ship-retire-label {
                        color: rgba(255,255,255,.42);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: .035em;
                    }

                    .sfux-ship-retire-link {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 5px;
                        min-height: 28px;
                        padding: 2px 8px;
                        border: 1px solid rgba(var(--sfux-damage), .26);
                        border-radius: var(--sfux-radius-sm);
                        background: rgba(var(--sfux-damage), .045);
                        color: rgba(222,105,105,.78);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        text-decoration: none;
                        text-transform: uppercase;
                    }

                    .sfux-ship-retire-link img {
                        width: 18px !important;
                        height: 18px !important;
                        opacity: .72;
                    }

                    .sfux-ship-retire-link--disabled {
                        opacity: .42;
                        cursor: default;
                    }

                    .sfux-ship-combat {
                        display: grid;
                        grid-template-columns: minmax(0, 1fr) minmax(0, 1.18fr);
                        gap: 10px;
                        margin-top: 10px;
                    }

                    .sfux-ship-stat-panel {
                        min-width: 0;
                        border: 1px solid rgba(255,255,255,.065);
                        background: rgba(255,255,255,.014);
                    }

                    .sfux-ship-stat-header {
                        padding: 6px 8px;
                        border-bottom: 1px solid rgba(255,255,255,.065);
                        background: rgba(59,78,91,.19);
                        color: rgba(255,255,255,.79);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        letter-spacing: .025em;
                        text-transform: uppercase;
                    }

                    .sfux-ship-bars {
                        padding: 8px;
                    }

                    .sfux-ship-bar-row + .sfux-ship-bar-row {
                        margin-top: 7px;
                    }

                    .sfux-ship-bar-meta {
                        display: flex;
                        align-items: baseline;
                        justify-content: space-between;
                        gap: 8px;
                        margin-bottom: 3px;
                    }

                    .sfux-ship-bar-label {
                        color: rgba(255,255,255,.55);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        text-transform: uppercase;
                    }

                    .sfux-ship-bar-value {
                        color: rgba(255,255,255,.88);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        white-space: nowrap;
                    }

                    .sfux-ship-bar-track {
                        height: 8px;
                        overflow: hidden;
                        border: 1px solid rgba(255,255,255,.055);
                        background: rgba(255,255,255,.025);
                    }

                    .sfux-ship-bar-fill {
                        height: 100%;
                        min-width: 0;
                    }

                    .sfux-ship-bar-fill--hull {
                        background: rgba(var(--sfux-hull), .88);
                    }

                    .sfux-ship-bar-fill--shield {
                        background: rgba(var(--sfux-shield), .88);
                    }

                    .sfux-ship-combat-stats {
                        display: grid;
                        grid-template-columns: repeat(3, minmax(0,1fr));
                        gap: 6px;
                        padding: 8px;
                    }

                    .sfux-ship-combat-stat {
                        min-width: 0;
                        padding: 8px 6px;
                        border: 1px solid rgba(255,255,255,.055);
                        border-top-width: 2px;
                        background: rgba(0,0,0,.12);
                        text-align: center;
                    }

                    .sfux-ship-combat-stat--attack {
                        border-top-color: rgba(var(--sfux-attack), .90);
                    }

                    .sfux-ship-combat-stat--damage {
                        border-top-color: rgba(var(--sfux-damage), .90);
                    }

                    .sfux-ship-combat-stat--defence {
                        border-top-color: rgba(var(--sfux-defence), .90);
                    }

                    .sfux-ship-combat-stat-label {
                        display: block;
                        color: rgba(255,255,255,.43);
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        line-height: 1.1;
                        text-transform: uppercase;
                    }

                    .sfux-ship-combat-stat-value {
                        display: block;
                        margin-top: 4px;
                        overflow: hidden;
                        color: rgba(255,255,255,.91);
                        font-size: 15px;
                        font-weight: 700;
                        line-height: 1.1;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }

                    .sfux-ship-dashboard--upgrading .sfux-ship-combat-stat-value {
                        color: rgba(255,255,255,.52);
                    }

                    @media (max-width: ${SFUX.responsive.mobile}px) {
                        .sfux-ship-hero,
                        .sfux-ship-combat {
                            grid-template-columns: 1fr;
                        }

                        .sfux-ship-image-card {
                            min-height: 0;
                        }

                        .sfux-ship-image-card img {
                            max-width: 100%;
                        }

                        .sfux-ship-profile {
                            padding: 9px;
                        }

                        .sfux-ship-systems {
                            grid-template-columns: repeat(3, minmax(0,1fr));
                        }

                        .sfux-ship-combat-stats {
                            grid-template-columns: repeat(3, minmax(0,1fr));
                        }
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
                        .sfux-ship-name {
                            font-size: 16px;
                        }

                        .sfux-ship-systems {
                            grid-template-columns: repeat(2, minmax(0,1fr));
                        }

                        .sfux-ship-system:first-child,
                        .sfux-ship-system:nth-child(2) {
                            min-width: 0;
                        }

                        .sfux-ship-system:last-child {
                            grid-column: 1 / -1;
                        }

                        .sfux-ship-combat-stats {
                            gap: 4px;
                            padding: 6px;
                        }

                        .sfux-ship-combat-stat {
                            padding: 7px 4px;
                        }

                        .sfux-ship-combat-stat-value {
                            font-size: var(--sfux-type-title);
                        }
                    }


                    /* -------------------------------------------------------------
                     * Ship Construction dashboard
                     * ----------------------------------------------------------- */
                    .sfux-construction-native-hidden {
                        display: none !important;
                    }

                    .sfux-construction-dashboard {




                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-construction-hero {
                        display: grid;
                        grid-template-columns: minmax(0, 1.12fr) minmax(250px, .88fr);
                        gap: 10px;
                        align-items: stretch;
                    }

                    .sfux-construction-image-card,
                    .sfux-construction-profile,
                    .sfux-construction-panel,
                    .sfux-construction-config {
                        min-width: 0;
                        border: 1px solid rgba(255,255,255,.065);
                        background: rgba(255,255,255,.016);
                    }

                    .sfux-construction-image-card {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 255px;
                        overflow: hidden;
                        background:
                            radial-gradient(circle at 50% 45%,
                                rgba(52,89,116,.16),
                                rgba(0,0,0,.03) 44%,
                                rgba(0,0,0,.20) 100%);
                    }

                    .sfux-construction-image-card img {
                        display: block;
                        width: 100%;
                        max-width: 430px;
                        height: auto;
                        margin: auto;
                    }

                    .sfux-construction-profile {
                        display: flex;
                        flex-direction: column;
                        padding: 11px;
                    }

                    .sfux-construction-class {
                        color: var(--sfux-text-primary);
                        font-size: 19px;
                        font-weight: 700;
                        line-height: 1.12;
                    }

                    .sfux-construction-costs {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0,1fr));
                        gap: 6px;
                        margin-top: 8px;
                    }

                    .sfux-construction-cost {
                        min-width: 0;
                        padding: 7px;
                        border: 1px solid rgba(255,255,255,.06);
                        background: rgba(0,0,0,.12);
                    }

                    .sfux-construction-cost-label,
                    .sfux-construction-detail-label {
                        display: block;
                        color: rgba(255,255,255,.42);
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        line-height: 1.1;
                        letter-spacing: .03em;
                        text-transform: uppercase;
                    }

                    .sfux-construction-cost-value,
                    .sfux-construction-detail-value {
                        display: block;
                        margin-top: 3px;
                        color: rgba(255,255,255,.90);
                        font-size: var(--sfux-type-label);
                        font-weight: 700;
                        line-height: 1.15;
                        white-space: nowrap;
                    }

                    .sfux-construction-cost--positive .sfux-construction-cost-value {
                        color: rgba(104,205,125,.97);
                    }

                    .sfux-construction-cost--negative .sfux-construction-cost-value {
                        color: rgba(239,101,92,.98);
                    }

                    .sfux-construction-details {
                        display: grid;
                        grid-template-columns: minmax(0,1fr);
                        gap: 6px;
                        margin-top: 6px;
                    }

                    .sfux-construction-detail {
                        min-width: 0;
                        padding: 7px;
                        border: 1px solid rgba(255,255,255,.06);
                        background: rgba(0,0,0,.12);
                    }

                    .sfux-construction-detail--weapons .sfux-construction-detail-value {
                        white-space: normal;
                        overflow-wrap: anywhere;
                        line-height: 1.2;
                    }

                    .sfux-construction-lower {
                        display: grid;
                        grid-template-columns: minmax(0,1fr) minmax(0,1fr);
                        gap: 10px;
                        margin-top: 10px;
                    }

                    .sfux-construction-panel-title {
                        padding: 6px 8px;
                        border-bottom: 1px solid rgba(255,255,255,.065);
                        background: rgba(59,78,91,.19);
                        color: rgba(255,255,255,.79);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        letter-spacing: .025em;
                        text-transform: uppercase;
                    }

                    .sfux-construction-capacities,
                    .sfux-construction-combat {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0,1fr));
                        gap: 6px;
                        padding: 8px;
                    }

                    .sfux-construction-capacity {
                        min-width: 0;
                        padding: 8px;
                        border: 1px solid rgba(255,255,255,.055);
                        background: rgba(0,0,0,.12);
                        text-align: center;
                    }

                    .sfux-construction-capacity--hull {
                        border-top: 2px solid rgba(var(--sfux-hull), .88);
                    }

                    .sfux-construction-capacity--shield {
                        border-top: 2px solid rgba(var(--sfux-shield), .88);
                    }

                    .sfux-construction-capacity-label {
                        display: block;
                        color: rgba(255,255,255,.43);
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        text-transform: uppercase;
                    }

                    .sfux-construction-capacity-value {
                        display: block;
                        margin-top: 4px;
                        color: rgba(255,255,255,.91);
                        font-size: 15px;
                        font-weight: 700;
                        line-height: 1.1;
                    }

                    .sfux-construction-combat-card {
                        min-width: 0;
                        padding: 8px 6px;
                        border: 1px solid rgba(255,255,255,.055);
                        border-top-width: 2px;
                        background: rgba(0,0,0,.12);
                        text-align: center;
                    }

                    .sfux-construction-combat-card--attack {
                        border-top-color: rgba(var(--sfux-attack), .90);
                    }

                    .sfux-construction-combat-card--damage {
                        border-top-color: rgba(var(--sfux-damage), .90);
                    }

                    .sfux-construction-combat-label {
                        display: block;
                        color: rgba(255,255,255,.43);
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        line-height: 1.1;
                        text-transform: uppercase;
                    }

                    .sfux-construction-combat-value {
                        display: block;
                        margin-top: 4px;
                        color: rgba(255,255,255,.92);
                        font-size: 15px;
                        font-weight: 700;
                        line-height: 1.1;
                    }

                    .sfux-construction-combat-note {
                        grid-column: 1 / -1;
                        color: rgba(255,255,255,.40);
                        font-size: var(--sfux-type-sm);
                        text-align: center;
                    }

                    .sfux-construction-config {
                        margin-top: 10px;
                        padding: 10px;
                    }

                    .sfux-construction-config-head {
                        display: flex;
                        align-items: baseline;
                        justify-content: space-between;
                        gap: 10px;
                        margin-bottom: 7px;
                    }

                    .sfux-construction-config-title {
                        color: rgba(255,255,255,.84);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: .025em;
                    }

                    .sfux-construction-total {
                        color: rgba(255,255,255,.48);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                    }

                    .sfux-construction-total--valid {
                        color: rgba(255,255,255,.48);
                    }

                    .sfux-construction-total--invalid {
                        color: rgba(239,101,92,.98);
                    }

                    .sfux-construction-power-bar {
                        display: flex;
                        width: 100%;
                        height: 8px;
                        overflow: hidden;
                        border: 1px solid rgba(255,255,255,.07);
                        background: rgba(255,255,255,.025);
                    }

                    .sfux-construction-power-segment {
                        height: 100%;
                        min-width: 0;
                        transition: width .12s ease;
                    }

                    .sfux-construction-power-segment--weapons {
                        background: rgba(var(--sfux-weapon-rgb), .90);
                    }

                    .sfux-construction-power-segment--engines {
                        background: rgba(var(--sfux-engine-rgb), .90);
                    }

                    .sfux-construction-power-segment--sensors {
                        background: rgba(var(--sfux-sensor-rgb), .90);
                    }

                    .sfux-construction-presets {
                        display: flex;
                        gap: 6px;
                        margin-top: 8px;
                    }

                    .sfux-construction-preset {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 34px;
                        padding: 3px 12px;
                        border: 1px solid rgba(255,255,255,.11);
                        border-radius: var(--sfux-radius-xs);
                        background: rgba(255,255,255,.025);
                        color: rgba(255,255,255,.68);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        line-height: 1;
                        text-align: center;
                        text-transform: uppercase;
                        cursor: pointer;
                    }

                    .sfux-construction-preset--weapons {
                        border-color: rgba(var(--sfux-weapon-rgb), .34);
                        color: rgba(238,113,104,.96);
                    }

                    .sfux-construction-preset--sensors {
                        border-color: rgba(var(--sfux-sensor-rgb), .38);
                        color: rgba(91,173,235,.97);
                    }

                    .sfux-construction-power-fields {
                        display: grid;
                        grid-template-columns: repeat(3, minmax(0,1fr));
                        gap: 7px;
                        margin-top: 8px;
                    }

                    .sfux-construction-power-field {
                        min-width: 0;
                        padding: 7px;
                        border: 1px solid rgba(255,255,255,.06);
                        background: rgba(0,0,0,.12);
                    }

                    .sfux-construction-power-field label {
                        display: block;
                        margin-bottom: 5px;
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        letter-spacing: .025em;
                        text-transform: uppercase;
                    }

                    .sfux-construction-power-field--weapons label {
                        color: rgba(var(--sfux-weapon-rgb), .96);
                    }

                    .sfux-construction-power-field--engines label {
                        color: rgba(var(--sfux-engine-rgb), .96);
                    }

                    .sfux-construction-power-field--sensors label {
                        color: rgba(var(--sfux-sensor-rgb), .96);
                    }

                    .sfux-construction-power-input-wrap {
                        display: grid;
                        grid-template-columns: minmax(0,1fr) auto;
                        align-items: center;
                        gap: 4px;
                    }

                    .sfux-construction-power-input-wrap .inputBox,
                    .sfux-construction-power-input-wrap select {
                        width: 100% !important;
                        min-width: 0;
                        height: 34px !important;
                        box-sizing: border-box;
                        margin: 0 !important;
                        text-align: center;
                        font-variant-numeric: tabular-nums;
                        -moz-appearance: textfield;
                    }

                    .sfux-construction-power-input-wrap input[type="number"]::-webkit-inner-spin-button,
                    .sfux-construction-power-input-wrap input[type="number"]::-webkit-outer-spin-button {
                        -webkit-appearance: none;
                        margin: 0;
                    }

                    .sfux-construction-power-percent {
                        color: rgba(255,255,255,.45);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                    }

                    .sfux-construction-options {
                        display: grid;
                        grid-template-columns: minmax(0,1fr) minmax(0,1fr);
                        gap: 7px;
                        margin-top: 8px;
                    }

                    .sfux-construction-option {
                        min-width: 0;
                        padding: 8px;
                        border: 1px solid rgba(255,255,255,.06);
                        background: rgba(0,0,0,.12);
                    }

                    .sfux-construction-option-head {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        margin-bottom: 5px;
                    }

                    .sfux-construction-option-label {
                        color: rgba(255,255,255,.43);
                        font-size: var(--sfux-type-xs);
                        font-weight: 700;
                        letter-spacing: .025em;
                        text-transform: uppercase;
                    }

                    .sfux-construction-help {
                        color: rgba(255,255,255,.48);
                        font-size: var(--sfux-type-sm);
                        text-decoration: underline;
                    }

                    .sfux-construction-mode-control {
                        width: 100% !important;
                        height: 34px !important;
                        margin: 0 !important;
                        box-sizing: border-box;
                        text-align: center;
                        font-weight: 700;
                    }

                    .sfux-construction-mode-control--flexible {
                        border-color: rgba(82,185,87,.45) !important;
                        color: rgba(116,208,121,.98) !important;
                    }

                    .sfux-construction-mode-control--fixed {
                        border-color: rgba(var(--sfux-weapon-rgb), .45) !important;
                        color: rgba(238,113,104,.98) !important;
                    }

                    .sfux-construction-mode-control[readonly] {
                        opacity: .78;
                        cursor: default;
                    }

                    .sfux-construction-destination {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 100%;
                        min-height: 28px;
                        margin: 0;
                        padding: 4px 8px;
                        border: 0 !important;
                        background: transparent !important;
                        box-shadow: none !important;
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        line-height: 1;
                        text-align: center;
                    }

                    .sfux-construction-submit-row {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 10px;
                        margin-top: 10px;
                        padding-top: 10px;
                        border-top: 1px solid rgba(255,255,255,.065);
                    }

                    .sfux-construction-validation {
                        min-width: 0;
                        color: rgba(255,255,255,.42);
                        font-size: var(--sfux-type-sm);
                    }

                    .sfux-construction-validation--invalid {
                        color: rgba(239,101,92,.90);
                    }

                    .sfux-construction-submit-row .button-primary {
                        min-width: 180px;
                        margin: 0 !important;
                    }

                    .sfux-construction-leecher {
                        margin-top: 8px;
                    }

                    .sfux-cadet-inline-form {
                        display: grid;
                        grid-template-columns: minmax(0, 1fr) 82px;
                        gap: 7px;
                        align-items: center;
                        margin-top: 8px;
                    }

                    .sfux-cadet-inline-form .inputBox,
                    .sfux-cadet-inline-form .button-primary {
                        width: 100% !important;
                        height: 38px !important;
                        box-sizing: border-box;
                        margin: 0 !important;
                    }

                    .sfux-cadet-inline-form .inputBox {
                        text-align: center;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-cadet-inline-form .sfux-number-stepper {
                        width: 100%;
                        max-width: none;
                        margin: 0;
                    }

                    .sfux-cadet-inline-form .button-primary {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        min-width: 0;
                        padding-inline: 8px;
                    }

                    @media (max-width: ${SFUX.responsive.mobile}px) {
                        .sfux-construction-hero,
                        .sfux-construction-lower {
                            grid-template-columns: 1fr;
                        }

                        .sfux-construction-image-card {
                            min-height: 0;
                        }

                        .sfux-construction-image-card img {
                            max-width: 100%;
                        }

                        .sfux-construction-profile {
                            padding: 9px;
                        }

                        .sfux-construction-costs {
                            grid-template-columns: repeat(2, minmax(0,1fr));
                        }

                        .sfux-construction-power-fields {
                            grid-template-columns: repeat(3, minmax(0,1fr));
                        }

                        .sfux-construction-submit-row {
                            align-items: stretch;
                        }
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
                        .sfux-construction-class {
                            font-size: 17px;
                        }

                        .sfux-construction-options {
                            grid-template-columns: 1fr;
                        }

                        .sfux-construction-power-fields {
                            gap: 5px;
                        }

                        .sfux-construction-power-field {
                            padding: 6px 5px;
                        }

                        .sfux-construction-power-field label {
                            font-size: var(--sfux-type-xs);
                        }

                        .sfux-construction-submit-row {
                            flex-direction: column;
                        }

                        .sfux-construction-submit-row .button-primary {
                            width: 100%;
                        }
                    }

                    @media (max-width: ${SFUX.responsive.mobile}px) {
                        .sfux-rename-row {
                            grid-template-columns: minmax(0, 1fr) 78px;
                        }

                        .sfux-power-route-main {
                            grid-template-columns: minmax(0, 1fr) 116px 34px;
                        }
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
                        .sfux-power-route-main {
                            grid-template-columns: minmax(0, 1fr) 108px 32px;
                            gap: 5px;
                        }

                        .sfux-power-action {
                            width: 108px;
                            padding: 0 6px;
                            font-size: var(--sfux-type-sm);
                        }

                        .sfux-power-gear {
                            width: 32px;
                        }

                        .sfux-power-engine-control {
                            grid-template-columns: auto minmax(0, 1fr) 58px;
                            gap: 5px;
                        }
                    }

                    /* -------------------------------------------------------------
                     * Star Dock overview
                     * ----------------------------------------------------------- */
                    #subMenu.sfux-dock-tabs {
                        margin-bottom: 4px;
                    }

                    #subMenu.sfux-dock-tabs .subMenu {
                        overflow: hidden;
                    }

                    #subMenu.sfux-dock-tabs .subMenu ul {
                        display: flex !important;
                        align-items: stretch;
                        gap: 3px;
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow-x: auto;
                        scrollbar-width: thin;
                    }

                    #subMenu.sfux-dock-tabs .subMenu li {
                        float: none !important;
                        flex: 0 0 auto;
                        margin: 0 !important;
                        padding: 0 !important;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a {
                        display: inline-flex !important;
                        align-items: center;
                        justify-content: center;
                        gap: 5px;
                        min-height: 32px;
                        padding: 0 11px !important;
                        border: 1px solid rgba(255,255,255,.10);
                        border-bottom: 2px solid rgba(255,255,255,.12);
                        background: #24292d;
                        color: rgba(255,255,255,.88) !important;
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        line-height: 1;
                        text-decoration: none !important;
                        white-space: nowrap;
                        box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
                    }

                    #subMenu.sfux-dock-tabs .subMenu a.sfux-dock-tab--overview {
                        background: #22272b;
                        border-color: #343a3f;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a.sfux-dock-tab--attack {
                        background: #3d201e;
                        border-color: #6e302c;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a.sfux-dock-tab--defence {
                        background: #183247;
                        border-color: #275476;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a.sfux-dock-tab--raider {
                        background: #3f301b;
                        border-color: #735427;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a.sfux-dock-tab--leecher {
                        background: #1d3824;
                        border-color: #32613d;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a.sfux-dock-tab--build {
                        background: #34233b;
                        border-color: #654270;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a:hover {
                        filter: brightness(1.12);
                        color: #fff !important;
                    }

                    #subMenu.sfux-dock-tabs .subMenu a.sfux-dock-tab-active {
                        color: #fff !important;
                        border-bottom-color: rgba(255,255,255,.88);
                        box-shadow:
                            inset 0 -2px 0 rgba(255,255,255,.18),
                            inset 0 1px 0 rgba(255,255,255,.05);
                        filter: brightness(1.16);
                    }

                    .sfux-dock-tab-count {
                        color: rgba(255,255,255,.62);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-dock-overview-summary {
                        float: right;
                        margin-right: 8px;
                        color: rgba(255,255,255,.45);
                        font-size: var(--sfux-type-md);
                        font-weight: 600;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-dock-category {
                        --sfux-dock-role-rgb: 80, 170, 220;
                        margin-top: 8px;
                    }

                    .sfux-dock-category--attack {
                        --sfux-dock-role-rgb: var(--sfux-role-attack);
                    }

                    .sfux-dock-category--defence {
                        --sfux-dock-role-rgb: var(--sfux-role-defence);
                    }

                    .sfux-dock-category--raider {
                        --sfux-dock-role-rgb: var(--sfux-role-raider);
                    }

                    .sfux-dock-category--leecher {
                        --sfux-dock-role-rgb: var(--sfux-role-leecher);
                    }

                    .sfux-dock-category--build {
                        --sfux-dock-role-rgb: var(--sfux-role-build);
                    }

                    .sfux-dock-category > .sectionTitle.sfux-dock-category-head {
                        display: flex;
                        align-items: center;
                        min-height: 34px;
                        gap: 8px;
                        padding: 7px 9px !important;
                        border-top: 1px solid rgba(var(--sfux-dock-role-rgb), .6);
                        border-bottom: 1px solid rgba(255,255,255,.07);
                        background:
                            linear-gradient(
                                180deg,
                                rgba(var(--sfux-dock-role-rgb), .09),
                                rgba(255,255,255,.025)
                            );
                    }

                    .sfux-dock-category-title {
                        color: var(--sfux-text-primary);
                        font-size: var(--sfux-type-title);
                        font-weight: 700;
                    }

                    .sfux-dock-category-capacity {
                        color: rgba(255,255,255,.56);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        font-variant-numeric: tabular-nums;
                    }

                    .sfux-dock-category-capacity.sfux-dock-category-capacity--full {
                        color: rgba(var(--sfux-engine-rgb), .96);
                    }

                    .sfux-dock-category-comms {
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        margin-left: auto;
                        color: rgba(110,215,130,.9);
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                        text-transform: uppercase;
                    }

                    .sfux-dock-category-comms::before {
                        content: "";
                        width: 6px;
                        height: 6px;
                        border-radius: 50%;
                        background: currentColor;
                        box-shadow: 0 0 6px currentColor;
                    }

                    .sfux-counter-emp-control {
                        float: none !important;
                        display: inline-flex;
                        align-items: center;
                        flex: 0 0 auto;
                        margin: 0 0 0 4px !important;
                    }

                    .sfux-counter-emp-control .button {
                        display: inline-flex !important;
                        align-items: center;
                        justify-content: center;
                        min-height: 26px;
                        margin: 0 !important;
                        padding: 4px 9px !important;
                        line-height: 1.1 !important;
                        white-space: nowrap;
                        text-transform: uppercase;
                        font-family: 'Titillium Web', sans-serif !important;
                        font-size: var(--sfux-type-xs) !important;
                        font-weight: 700 !important;
                        letter-spacing: .03em;
                    }

                    .sfux-dock-category .hrBar {
                        display: none !important;
                    }

                    .sfux-dock-category .noticeBody {
                        margin: 0 !important;
                        padding: 0 !important;
                    }

                    .sfux-dock-category .responsive-table-container {
                        overflow: visible !important;
                    }

                    table.stardocktable.sfux-dock-table {
                        width: 100% !important;
                        margin: 0 !important;
                        border-collapse: separate !important;
                        border-spacing: 0 5px !important;
                        table-layout: fixed;
                        background: transparent !important;
                    }

                    table.stardocktable.sfux-dock-table tr.sfux-dock-row > td {
                        height: auto !important;
                        padding: 8px !important;
                        border-top: 1px solid rgba(255,255,255,.055);
                        border-bottom: 1px solid rgba(255,255,255,.055);
                        background: rgba(255,255,255,.026) !important;
                        vertical-align: middle !important;
                        box-sizing: border-box;
                    }

                    table.stardocktable.sfux-dock-table tr.sfux-dock-row:hover > td {
                        background: rgba(var(--sfux-dock-role-rgb), .055) !important;
                    }

                    table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:first-child {
                        width: 72px !important;
                        padding: 6px !important;
                        border-left: 2px solid rgba(var(--sfux-dock-role-rgb), .55);
                    }

                    table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:nth-child(2) {
                        width: 33% !important;
                    }

                    table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:nth-child(3) {
                        width: auto !important;
                    }

                    table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:last-child {
                        width: 112px !important;
                        padding-inline: 7px !important;
                        border-right: 1px solid rgba(255,255,255,.055);
                    }

                    .sfux-dock-image-cell {
                        position: relative;
                        text-align: center;
                    }

                    .sfux-dock-image-cell a {
                        position: relative;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 58px;
                        height: 58px;
                    }

                    .sfux-dock-image-cell .dock-ship-image {
                        display: block;
                        width: 56px !important;
                        height: 56px !important;
                        object-fit: contain;
                    }

                    .sfux-dock-image-cell .fixflexIcon {
                        right: 1px !important;
                        bottom: 1px !important;
                    }

                    .sfux-dock-identity {
                        min-width: 0;
                    }

                    .sfux-dock-identity-head {
                        display: flex;
                        align-items: center;
                        gap: 7px;
                        min-width: 0;
                    }

                    .sfux-dock-ship-name {
                        overflow: hidden;
                        min-width: 0;
                        color: var(--sfux-text-primary) !important;
                        font-size: var(--sfux-type-title);
                        font-weight: 700;
                        line-height: 1.15;
                        text-decoration: none !important;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }

                    .sfux-dock-class-meta {
                        display: inline-flex;
                        align-items: center;
                        min-height: 19px;
                        color: rgba(255,255,255,.45);
                        font-size: var(--sfux-type-sm);
                        font-weight: 600;
                        line-height: 1;
                        white-space: nowrap;
                    }

                    .sfux-dock-identity-tags {
                        display: flex;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 5px;
                        margin-top: 6px;
                    }

                    .sfux-dock-primary-tags {
                        display: inline-flex;
                        align-items: center;
                        flex: 0 0 auto;
                        gap: 5px;
                        white-space: nowrap;
                    }

                    .sfux-dock-status {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 19px;
                        padding: 2px 6px;
                        border: 1px solid rgba(255,255,255,.1);
                        background: rgba(255,255,255,.035);
                        color: rgba(255,255,255,.68);
                        font-size: var(--sfux-type-sm);
                        font-weight: 700;
                        line-height: 1;
                        text-transform: uppercase;
                    }

                    .sfux-dock-status--defending {
                        border-color: rgba(90,205,105,.38);
                        color: rgba(110,225,125,.95);
                    }

                    .sfux-dock-status--returning {
                        border-color: rgba(var(--sfux-engine-rgb), .42);
                        color: rgba(var(--sfux-engine-rgb), .96);
                    }

                    .sfux-dock-status--upgrading {
                        border-color: rgba(var(--sfux-sensor-rgb), .5);
                        color: rgba(70,175,240,.98);
                    }

                    .sfux-dock-status--exploring {
                        border-color: rgba(120,180,240,.4);
                        color: rgba(130,195,250,.95);
                    }

                    .sfux-dock-engine {
                        color: rgba(255,255,255,.52);
                        font-size: var(--sfux-type-md);
                        font-weight: 600;
                        white-space: nowrap;
                    }

                    .sfux-dock-power {
                        display: flex;
                        align-items: center;
                        gap: 9px;
                        width: 100%;
                        margin-top: 6px;
                        white-space: nowrap;
                    }

                    .sfux-dock-power > .sfux-dock-engine {
                        margin-left: auto;
                        padding-left: 10px;
                        color: rgba(255,255,255,.50);
                    }

                    .sfux-dock-power span {
                        font-size: var(--sfux-type-md);
                        font-weight: 700;
                    }

                    .sfux-dock-power .sfux-power-w {
                        color: rgba(var(--sfux-weapon-rgb), .96);
                    }

                    .sfux-dock-power .sfux-power-e {
                        color: rgba(var(--sfux-engine-rgb), .96);
                    }

                    .sfux-dock-power .sfux-power-s {
                        color: rgba(var(--sfux-sensor-rgb), .96);
                    }

                    .sfux-dock-power .sfux-power-zero {
                        color: rgba(255,255,255,.3) !important;
                        font-weight: 600;
                    }

                    .sfux-dock-power .sfux-power-full {
                        font-weight: 800;
                        text-shadow: 0 0 4px currentColor;
                    }

                    .sfux-dock-vitals {
                        display: grid;
                        gap: 6px;
                        width: 100%;
                    }

                    .sfux-dock-vital-head {
                        display: flex;
                        align-items: baseline;
                        justify-content: space-between;
                        gap: 8px;
                        margin-bottom: 2px;
                        font-size: var(--sfux-type-sm);
                        line-height: 1;
                    }

                    .sfux-dock-vital-label {
                        color: rgba(255,255,255,.42);
                        font-weight: 700;
                        text-transform: uppercase;
                    }

                    .sfux-dock-vital-value {
                        color: rgba(255,255,255,.88);
                        font-weight: 700;
                        font-variant-numeric: tabular-nums;
                        white-space: nowrap;
                    }

                    .sfux-dock-vital-track {
                        position: relative;
                        height: 13px;
                        overflow: hidden;
                        border: 1px solid rgba(255,255,255,.055);
                        background: rgba(0,0,0,.28);
                    }

                    .sfux-dock-vital-fill {
                        height: 100%;
                        min-width: 0;
                    }

                    .sfux-dock-vital--hull .sfux-dock-vital-fill {
                        background: rgb(13,126,172);
                    }

                    .sfux-dock-vital--shield .sfux-dock-vital-fill {
                        background: rgb(92,153,0);
                    }

                    .sfux-dock-actions {
                        text-align: center;
                    }

                    .sfux-dock-actions .dropdown {
                        display: inline-block;
                        width: 100%;
                        max-width: 98px;
                    }

                    .sfux-dock-actions .dd-button {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 38px;
                        padding: 0 24px 0 10px !important;
                        box-sizing: border-box;
                        font-size: var(--sfux-type-md);
                    }

                    .sfux-dock-actions .dd-menu {
                        right: 0 !important;
                        left: auto !important;
                        min-width: 120px;
                    }

                    @media (max-width: ${SFUX.responsive.mobile}px) {
                        .sfux-dock-overview-summary {
                            display: none;
                        }

                        .sfux-stardock-overview > .boxheader {
                            display: none !important;
                        }

                        #subMenu.sfux-dock-tabs {
                            margin-bottom: 2px;
                        }

                        #subMenu.sfux-dock-tabs .subMenu ul {
                            gap: 3px;
                            padding: 0 0 3px !important;
                            scroll-snap-type: x proximity;
                        }

                        #subMenu.sfux-dock-tabs .subMenu a {
                            min-height: 38px;
                            padding-inline: 11px !important;
                            font-size: var(--sfux-type-md);
                            scroll-snap-align: start;
                        }

                        table.stardocktable.sfux-dock-table {
                            display: block !important;
                            border-spacing: 0 !important;
                        }

                        table.stardocktable.sfux-dock-table tbody {
                            display: block !important;
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row {
                            display: grid !important;
                            grid-template-columns: 58px minmax(0,1fr) 94px;
                            align-items: center;
                            margin: 0 0 5px !important;
                            border-left: 2px solid rgba(var(--sfux-dock-role-rgb), .55);
                            background: rgba(255,255,255,.026);
                            transition: background-color .12s ease;
                        }

                        /* On mobile the native table-cell hover paints individual grid
                           cells, which creates a visible T-shaped highlight. Apply the
                           hover treatment to the card itself and keep its cells clear. */
                        table.stardocktable.sfux-dock-table tr.sfux-dock-row:hover,
                        table.stardocktable.sfux-dock-table tr.sfux-dock-row:focus-within {
                            background: rgba(var(--sfux-dock-role-rgb), .055) !important;
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row:hover > td,
                        table.stardocktable.sfux-dock-table tr.sfux-dock-row:focus-within > td {
                            background: transparent !important;
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row > td {
                            display: block !important;
                            width: auto !important;
                            min-width: 0 !important;
                            padding: 7px !important;
                            border: 0 !important;
                            background: transparent !important;
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:first-child {
                            grid-column: 1;
                            grid-row: 1;
                            width: auto !important;
                            padding: 4px !important;
                            border: 0 !important;
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:nth-child(2) {
                            grid-column: 2;
                            grid-row: 1;
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:nth-child(3) {
                            grid-column: 2 / 4;
                            grid-row: 2;
                            padding-top: 2px !important;
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row > td:last-child {
                            grid-column: 3;
                            grid-row: 1;
                            align-self: center;
                            justify-self: end;
                            width: 100% !important;
                            padding: 5px 7px 5px 3px !important;
                            box-sizing: border-box;
                            overflow: visible !important;
                            text-align: right;
                        }

                        .sfux-dock-image-cell a {
                            width: 52px;
                            height: 52px;
                        }

                        .sfux-dock-image-cell .dock-ship-image {
                            width: 50px !important;
                            height: 50px !important;
                        }

                        .sfux-dock-ship-name {
                            font-size: var(--sfux-type-label);
                        }

                        .sfux-dock-class-meta {
                            min-height: 17px;
                            font-size: var(--sfux-type-xs);
                        }

                        .sfux-dock-identity-tags {
                            gap: 4px;
                            margin-top: 4px;
                        }

                        .sfux-dock-primary-tags {
                            gap: 4px;
                        }

                        .sfux-dock-status,
                        .sfux-dock-primary-tags > .sfux-ship-tag {
                            min-height: 18px;
                            padding: 2px 5px;
                            font-size: var(--sfux-type-xs);
                            line-height: 1;
                        }

                        .sfux-dock-engine,
                        .sfux-dock-power span {
                            font-size: var(--sfux-type-sm);
                        }

                        .sfux-dock-power {
                            gap: 8px;
                        }

                        .sfux-dock-power > .sfux-dock-engine {
                            padding-left: 6px;
                        }

                        .sfux-dock-power {
                            gap: 7px;
                            margin-top: 4px;
                        }

                        .sfux-dock-vitals {
                            grid-template-columns: 1fr;
                            gap: 6px;
                        }

                        .sfux-dock-vital-track {
                            height: 8px;
                        }

                        .sfux-dock-vital-head {
                            font-size: var(--sfux-type-xs);
                        }

                        .sfux-dock-actions .dropdown {
                            display: block;
                            width: 86px !important;
                            max-width: 86px;
                            min-width: 0;
                            margin-left: auto;
                        }

                        .sfux-dock-actions .dd-button {
                            width: 100% !important;
                            min-width: 0 !important;
                            max-width: 100% !important;
                            min-height: 38px;
                            padding: 0 19px 0 9px !important;
                            box-sizing: border-box;
                            font-size: var(--sfux-type-sm);
                            font-weight: 700;
                            white-space: nowrap;
                        }

                        .sfux-dock-actions .dd-menu {
                            right: 0 !important;
                            left: auto !important;
                            max-width: calc(100vw - 18px);
                        }
                    }

                    @media (max-width: ${SFUX.responsive.phone}px) {
                        .sfux-dock-category > .sectionTitle.sfux-dock-category-head {
                            flex-wrap: wrap;
                            row-gap: 5px;
                            padding-inline: 7px !important;
                        }

                        .sfux-counter-emp-control {
                            margin-left: auto !important;
                        }

                        .sfux-counter-emp-control .button {
                            min-height: 28px;
                            padding-inline: 8px !important;
                            font-size: 10px !important;
                        }

                        .sfux-dock-category-title {
                            font-size: var(--sfux-type-md);
                        }

                        .sfux-dock-category-comms {
                            font-size: var(--sfux-type-xs);
                        }

                        table.stardocktable.sfux-dock-table tr.sfux-dock-row {
                            grid-template-columns: 54px minmax(0,1fr) 88px;
                        }

                        .sfux-dock-actions .dropdown {
                            width: 80px !important;
                            max-width: 80px;
                        }

                        .sfux-dock-actions .dd-button {
                            min-height: 36px;
                            padding: 0 17px 0 8px !important;
                            font-size: var(--sfux-type-xs);
                        }
                    }

                `); }

            // ---------------------------------------------------------------------
            // Non-Leecher power preset editor
            // ---------------------------------------------------------------------
            function createEditor(mode, profiles, onSaved) {
                const routeLabel = mode === 'weapons' ? 'Weapons' : 'Sensors';

                const editor = ctx.element('div');
                editor.className = 'sfux-power-editor';

                const head = ctx.element('div');
                head.className = 'sfux-power-editor-head';

                const title = ctx.element('div');
                title.className = 'sfux-power-editor-title';
                title.textContent = `${routeLabel} preset`;

                const total = ctx.element('div');
                total.className = 'sfux-power-editor-total';
                total.textContent = '100% total';

                head.append(title, total);

                const bar = ctx.element('div');
                bar.className = 'sfux-power-allocation-bar';

                const primaryBar = ctx.element('div');
                primaryBar.className = 'sfux-power-allocation-primary';

                const engineBar = ctx.element('div');
                engineBar.className = 'sfux-power-allocation-engine';

                bar.append(primaryBar, engineBar);

                const legend = ctx.element('div');
                legend.className = 'sfux-power-allocation-legend';

                const primaryLegend = ctx.element('span');
                primaryLegend.className = 'sfux-power-allocation-primary-label';

                const engineLegend = ctx.element('span');
                engineLegend.className = 'sfux-power-allocation-engine-label';

                legend.append(primaryLegend, engineLegend);

                const control = ctx.element('div');
                control.className = 'sfux-power-engine-control';

                const controlLabel = ctx.element('span');
                controlLabel.className = 'sfux-power-engine-control-label';
                controlLabel.textContent = 'Engine share';

                const engineRange = ctx.element('input');
                engineRange.type = 'range';
                engineRange.min = '0';
                engineRange.max = '100';
                engineRange.step = '5';
                engineRange.className = 'sfux-power-engine-range';

                const engineNumberWrap = ctx.element('div');
                engineNumberWrap.className = 'sfux-power-engine-number-wrap';

                const engineInput = ctx.element('input');
                engineInput.type = 'number';
                engineInput.min = '0';
                engineInput.max = '100';
                engineInput.step = '1';
                engineInput.inputMode = 'numeric';
                engineInput.className = 'inputBox sfux-power-engine-input';

                const percent = ctx.element('span');
                percent.className = 'sfux-power-engine-percent';
                percent.textContent = '%';

                engineNumberWrap.append(engineInput, percent);
                control.append(controlLabel, engineRange, engineNumberWrap);

                const actions = ctx.element('div');
                actions.className = 'sfux-power-editor-actions';

                const reset = ctx.element('button');
                reset.type = 'button';
                reset.textContent = 'Reset 100 / 0';

                const save = ctx.element('button');
                save.type = 'button';
                save.className = 'sfux-power-save';
                save.textContent = 'Save preset';

                actions.append(reset, save);
                editor.append(head, bar, legend, control, actions);
                SFUX.ui.number(ctx, engineInput, { min: 0, max: 100, step: 1 });

                function setEngineValue(value) {
                    const engine = clampPercent(value);
                    const primary = 100 - engine;

                    engineInput.value = String(engine);
                    engineRange.value = String(engine);

                    primaryBar.style.width = `${primary}%`;
                    engineBar.style.width = `${engine}%`;

                    primaryLegend.textContent = `${routeLabel} ${primary}%`;
                    engineLegend.textContent = `Engines ${engine}%`;
                }

                function open() {
                    setEngineValue(normalizeProfile(profiles[mode]).engine);
                    editor.classList.add('sfux-power-editor-open');
                }

                function close() {
                    editor.classList.remove('sfux-power-editor-open');
                }

                function isOpen() {
                    return editor.classList.contains('sfux-power-editor-open');
                }

                ctx.on(engineRange, 'input', () => {
                    setEngineValue(engineRange.value);
                });

                ctx.on(engineInput, 'input', () => {
                    if (engineInput.value === '') return;
                    setEngineValue(engineInput.value);
                });

                ctx.on(engineInput, 'blur', () => {
                    setEngineValue(engineInput.value);
                });

                ctx.on(reset, 'click', () => {
                    setEngineValue(0);
                });

                ctx.on(save, 'click', () => {
                    profiles[mode] = normalizeProfile({
                        engine: clampPercent(engineInput.value)
                    });

                    const savedProfiles = saveProfiles(profiles);
                    profiles.weapons = savedProfiles.weapons;
                    profiles.sensors = savedProfiles.sensors;

                    close();
                    onSaved();
                });

                return {
                    element: editor,
                    open,
                    close,
                    isOpen
                };
            }

            // ---------------------------------------------------------------------
            // View Ship data adapters and responsive Ship Viewer dashboard
            // ---------------------------------------------------------------------
            function readShipViewerDetails() {
                const table = Array.from(document.querySelectorAll('table.shipviewtable')).find(candidate => {
                    const firstRow = candidate.rows?.[0];
                    return normalizeText(firstRow?.cells?.[0]?.textContent) === 'name';
                });

                if (!table) return null;

                const details = {};

                for (const row of Array.from(table.rows)) {
                    const cells = Array.from(row.cells || []);
                    if (cells.length < 2) continue;

                    const label = normalizeText(cells[0].textContent)
                        .replace(/\.$/, '')
                        .replace(/\s+/g, ' ');
                    const value = String(cells[cells.length - 1].textContent || '').trim();

                    details[label] = value;
                }

                const allShipTables = Array.from(
                    table.closest('.shipviewstats, .responsive-table-container')?.querySelectorAll('table.shipviewtable') || []
                );

                const powerTable = allShipTables.find(candidate =>
                    normalizeText(candidate.rows?.[0]?.textContent).includes('power distribution')
                );

                const powerDistribution = {
                    weapons: '',
                    engines: '',
                    sensors: ''
                };

                if (powerTable) {
                    for (const row of Array.from(powerTable.rows || [])) {
                        const cells = Array.from(row.cells || []);
                        if (cells.length < 2) continue;

                        const label = normalizeText(cells[0].textContent);
                        const value = String(cells[cells.length - 1].textContent || '').trim();

                        if (label === 'weapons') powerDistribution.weapons = value;
                        if (label === 'engines') powerDistribution.engines = value;
                        if (label === 'sensors') powerDistribution.sensors = value;
                    }
                }

                return {
                    table,
                    name: details.name || '',
                    category: details.category || '',
                    modification: details.modification || '',
                    status: details.status || '',
                    className: details.class || '',
                    maintenance: details['maint. cost'] || details['maint cost'] || '',
                    powerCore: details['power core'] || '',
                    engines: details.engines || '',
                    hullCap: details['hull cap'] || '',
                    shieldsCap: details['shields cap'] || '',
                    weapons: details.weapons || '',
                    powerDistribution
                };
            }

            function parseCurrentMaximum(text) {
                const match = String(text || '').match(/([\d,]+)\s*\/\s*([\d,]+)/);
                if (!match) return null;

                const current = Number(match[1].replace(/,/g, ''));
                const maximum = Number(match[2].replace(/,/g, ''));

                if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) {
                    return null;
                }

                return {
                    current,
                    maximum,
                    percent: Math.max(0, Math.min(100, (current / maximum) * 100))
                };
            }

            function findNativeShipStatsTable() {
                return Array.from(document.querySelectorAll('table.stardocktable')).find(table => {
                    const text = normalizeText(table.rows?.[0]?.textContent);
                    return (
                        text.includes('hull/shield stats') &&
                        text.includes('ship stats') &&
                        text.includes('retire ship')
                    );
                }) || null;
            }

            function readNativeShipStats(table) {
                if (!table) return null;

                const labels = Array.from(
                    table.querySelectorAll('.cssProgress-label, .mobile-show')
                ).map(node => String(node.textContent || '').trim());

                const getLabel = prefix => labels.find(value =>
                    normalizeText(value).startsWith(normalizeText(prefix))
                ) || '';

                const hullText = getLabel('Hull:');
                const shieldText = getLabel('Shields:');
                const attackText = getLabel('Attack Points:');
                const damageText = getLabel('Damage Points:');
                const defenceText = getLabel('Defence Points:');

                const numberAfterColon = text => {
                    const match = String(text || '').match(/:\s*([\d,]+)/);
                    return match ? match[1] : '—';
                };

                return {
                    hullText,
                    shieldText,
                    hull: parseCurrentMaximum(hullText),
                    shield: parseCurrentMaximum(shieldText),
                    attack: numberAfterColon(attackText),
                    damage: numberAfterColon(damageText),
                    defence: numberAfterColon(defenceText),
                    retireLink: table.querySelector('.dockmodrepairdel a')
                };
            }

            function shipTagClass(value) {
                const normalized = normalizeText(value);

                if (normalized.includes('attack')) return 'attack';
                if (normalized.includes('defence') || normalized.includes('defense')) return 'defence';
                if (normalized.includes('raider') || normalized.includes('raid')) return 'raider';
                if (normalized.includes('leecher')) return 'leecher';
                if (normalized.includes('build')) return 'build';

                return 'neutral';
            }

            function shipStatusClass(value) {
                const normalized = normalizeText(value);

                if (normalized.includes('upgrad')) return 'upgrading';
                if (normalized.includes('return')) return 'returning';
                if (normalized.includes('defend')) return 'defending';

                return 'neutral';
            }

            function createShipTag(value, extraClass = '') {
                const tag = ctx.element('span');
                tag.className = 'sfux-ship-tag';

                if (extraClass) {
                    tag.classList.add(`sfux-ship-tag--${extraClass}`);
                }

                tag.textContent = value;
                return tag;
            }

            function createSystemMetric(label, value, state = 'neutral') {
                const metric = ctx.element('div');
                metric.className = 'sfux-ship-system';

                const metricLabel = ctx.element('span');
                metricLabel.className = 'sfux-ship-system-label';
                metricLabel.textContent = label;

                const metricValue = ctx.element('span');
                metricValue.className = 'sfux-ship-system-value';

                if (state === 'negative') {
                    metricValue.classList.add('sfux-ship-system-value--negative');
                } else if (state === 'positive') {
                    metricValue.classList.add('sfux-ship-system-value--positive');
                }

                metricValue.textContent = value || '—';
                metricValue.title = value || '';

                metric.append(metricLabel, metricValue);
                return metric;
            }

            function createShipBar(label, rawText, parsed, kind) {
                const row = ctx.element('div');
                row.className = 'sfux-ship-bar-row';

                const meta = ctx.element('div');
                meta.className = 'sfux-ship-bar-meta';

                const labelEl = ctx.element('span');
                labelEl.className = 'sfux-ship-bar-label';
                labelEl.textContent = label;

                const value = ctx.element('span');
                value.className = 'sfux-ship-bar-value';
                value.textContent = (rawText.replace(/^[^:]+:\s*/, '') || '—')
                    .replace(/\s*\/\s*/g, ' / ');

                meta.append(labelEl, value);

                const track = ctx.element('div');
                track.className = 'sfux-ship-bar-track';

                const fill = ctx.element('div');
                fill.className = `sfux-ship-bar-fill sfux-ship-bar-fill--${kind}`;
                fill.style.width = `${parsed?.percent ?? 0}%`;

                track.appendChild(fill);
                row.append(meta, track);

                return row;
            }

            function createCombatStat(label, value, kind) {
                const card = ctx.element('div');
                card.className = `sfux-ship-combat-stat sfux-ship-combat-stat--${kind}`;

                const labelEl = ctx.element('span');
                labelEl.className = 'sfux-ship-combat-stat-label';
                labelEl.textContent = label;

                const valueEl = ctx.element('span');
                valueEl.className = 'sfux-ship-combat-stat-value';
                valueEl.textContent = value || '—';

                card.append(labelEl, valueEl);
                return card;
            }

            function readRoleTransferTime() {
                const advisor = document.querySelector('#advisor-content');
                if (!advisor) return '';

                const text = String(advisor.textContent || '').replace(/\s+/g, ' ');
                const match = text.match(/role transfer time is:\s*(\d+)\s*ticks?/i);

                return match ? `${match[1]} ticks` : '';
            }

            const transferRoleKind = shipTagClass;

            function createTransferRoleChip(role, target = false) {
                const chip = ctx.element('span');
                const kind = transferRoleKind(role);

                chip.className = target
                    ? `sfux-transfer-target-chip sfux-transfer-target-chip--${kind}`
                    : `sfux-transfer-current sfux-transfer-current--${kind}`;

                chip.textContent = role || 'Current';
                return chip;
            }

            function getSwapRoleFromLocation(roleSelect) {
                const currentUrl = new URL(window.location.href);
                const selectedRole = currentUrl.searchParams.get('switchrole');
                if (!selectedRole || !roleSelect) return null;

                const cleanBase = new URL(currentUrl.pathname, currentUrl.origin);

                for (const [index, option] of Array.from(roleSelect.options || []).entries()) {
                    const rawValue = String(option.value || '').trim();

                    // "#" is StarFury's "Select Role" placeholder. Resolving it
                    // against the current URL would incorrectly inherit switchrole.
                    if (!rawValue || rawValue === '#' || rawValue === '0') continue;

                    try {
                        const optionUrl = new URL(rawValue, cleanBase);
                        if (optionUrl.searchParams.get('switchrole') === selectedRole) {
                            return {
                                id: selectedRole,
                                text: String(option.textContent || '').trim(),
                                value: option.value,
                                index
                            };
                        }
                    } catch (_) {
                        // Ignore malformed/non-URL option values.
                    }
                }

                return null;
            }

            function stripTransferFormSpacing(form) {
                for (const node of Array.from(form.childNodes)) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
                        node.remove();
                    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
                        node.remove();
                    }
                }
            }

            // ---------------------------------------------------------------------
            // Simple Role Transfer and two-stage Ship Swap Transfer
            // ---------------------------------------------------------------------
            function enhanceShipTransfer() {
                const shipDetails = readShipViewerDetails();

                const box = Array.from(document.querySelectorAll('#content .contentbox')).find(candidate =>
                    normalizeText(candidate.querySelector('.boxheadertext')?.textContent) === 'ship transfer'
                );

                const content = box?.querySelector('.content');
                if (!shipDetails || !content || content.querySelector('.sfux-transfer-dashboard')) {
                    return;
                }

                const forms = Array.from(content.querySelectorAll('form'));
                const simpleForm = forms.find(form =>
                    normalizeText(form.getAttribute('action')).includes('transfer')
                );
                const swapForm = forms.find(form =>
                    normalizeText(form.getAttribute('action')).includes('swap')
                );

                if (!simpleForm && !swapForm) return;

                const dashboard = ctx.element('div');
                dashboard.className = 'sfux-transfer-dashboard';

                const transferTime = readRoleTransferTime();
                const currentRole = shipDetails.category || 'Current Role';

                if (simpleForm) {
                    stripTransferFormSpacing(simpleForm);
                    const restoreSimpleExtras = SFUX.ui.preserveFormExtras(simpleForm);

                    const roleSelect = simpleForm.querySelector('select[name="role"]');
                    const submit = simpleForm.querySelector('input[type="submit"], button[type="submit"]');

                    if (roleSelect && submit) {
                        const card = ctx.element('section');
                        card.className = 'sfux-transfer-card';

                        const header = ctx.element('div');
                        header.className = 'sfux-transfer-card-header';

                        const title = ctx.element('div');
                        title.className = 'sfux-transfer-card-title';
                        title.textContent = 'Simple Role Transfer';

                        const summary = ctx.element('div');
                        summary.className = 'sfux-transfer-card-summary';
                        summary.textContent = transferTime ? `Transfer time: ${transferTime}` : 'Change this ship’s role';

                        header.append(title, summary);

                        const body = ctx.element('div');
                        body.className = 'sfux-transfer-body';

                        const route = ctx.element('div');
                        route.className = 'sfux-transfer-route';

                        const current = createTransferRoleChip(currentRole);

                        const arrow = ctx.element('span');
                        arrow.className = 'sfux-transfer-arrow';
                        arrow.textContent = '→';

                        submit.value = 'Transfer';
                        submit.classList.add('sfux-transfer-action');

                        const syncSimpleState = () => {
                            submit.classList.toggle('sfux-selection-empty', !roleSelect.value || roleSelect.value === '0');
                        };

                        ctx.on(roleSelect, 'change', syncSimpleState);
                        syncSimpleState();

                        route.append(current, arrow, roleSelect, submit);

                        simpleForm.classList.add('sfux-transfer-form');
                        simpleForm.replaceChildren(route);
                        restoreSimpleExtras();
                        body.appendChild(simpleForm);
                        card.append(header, body);
                        dashboard.appendChild(card);
                    }
                }

                if (swapForm) {
                    stripTransferFormSpacing(swapForm);
                    const restoreSwapExtras = SFUX.ui.preserveFormExtras(swapForm);

                    const swapSelects = Array.from(swapForm.querySelectorAll('select'));
                    const roleSelect = swapSelects.find(select => !select.name);
                    const targetSelect = swapForm.querySelector('select[name="swap_ship"]');
                    const submit = swapForm.querySelector('input[type="submit"], button[type="submit"]');

                    if (roleSelect) {
                        const selectedSwapRole = getSwapRoleFromLocation(roleSelect);

                        if (selectedSwapRole?.value) {
                            roleSelect.selectedIndex = selectedSwapRole.index;
                            roleSelect.value = selectedSwapRole.value;
                        }

                        const card = ctx.element('section');
                        card.className = 'sfux-transfer-card';

                        const header = ctx.element('div');
                        header.className = 'sfux-transfer-card-header';

                        const title = ctx.element('div');
                        title.className = 'sfux-transfer-card-title';
                        title.textContent = 'Ship Swap Transfer';

                        const summary = ctx.element('div');
                        summary.className = 'sfux-transfer-card-summary';

                        if (targetSelect) {
                            const eligibleCount = Array.from(targetSelect.options || []).filter(option =>
                                Boolean(option.value)
                            ).length;
                            summary.textContent = `${eligibleCount} eligible ship${eligibleCount === 1 ? '' : 's'}`;
                        } else {
                            summary.textContent = 'Two-stage swap';
                        }

                        header.append(title, summary);

                        const body = ctx.element('div');
                        body.className = 'sfux-transfer-body';

                        const route = ctx.element('div');
                        route.className = 'sfux-transfer-route';

                        const current = createTransferRoleChip(currentRole);

                        const arrow = ctx.element('span');
                        arrow.className = 'sfux-transfer-arrow';
                        arrow.textContent = '⇄';

                        route.append(current, arrow, roleSelect);

                        if (!targetSelect) {
                            const note = ctx.element('div');
                            note.className = 'sfux-transfer-note';
                            note.textContent = 'Choose a role to load eligible ships.';
                            route.appendChild(note);

                            if (submit) {
                                submit.classList.add('sfux-transfer-native-hidden');
                            }
                        }

                        body.appendChild(route);

                        if (targetSelect && submit) {
                            submit.value = 'Swap Ships';
                            submit.classList.add('sfux-transfer-action');

                            const targetRow = ctx.element('div');
                            targetRow.className = 'sfux-transfer-target-row';

                            const targetLabel = ctx.element('span');
                            targetLabel.className = 'sfux-transfer-target-label';
                            targetLabel.textContent = 'Swap with';

                            const syncSwapState = () => {
                                submit.classList.toggle('sfux-selection-empty', !targetSelect.value);
                            };

                            ctx.on(targetSelect, 'change', syncSwapState);
                            syncSwapState();

                            targetRow.append(targetLabel, targetSelect, submit);
                            body.appendChild(targetRow);
                        }

                        swapForm.classList.add('sfux-transfer-form');
                        swapForm.replaceChildren(...Array.from(body.childNodes));
                        restoreSwapExtras();
                        body.replaceChildren(swapForm);

                        card.append(header, body);
                        dashboard.appendChild(card);
                    }
                }

                if (!dashboard.children.length) return;

                content.insertBefore(dashboard, content.firstChild);

                for (const child of Array.from(content.children)) {
                    if (child === dashboard) continue;

                    if (
                        child.classList?.contains('sectionTitle') ||
                        child.classList?.contains('hrBar') ||
                        child.classList?.contains('noticeBody')
                    ) {
                        child.classList.add('sfux-transfer-native-hidden');
                    }
                }
            }

            function enhanceShipViewer() {
                const shipDetails = readShipViewerDetails();
                const nativeStatsTable = findNativeShipStatsTable();
                const shipStats = readNativeShipStats(nativeStatsTable);

                const contentBox = Array.from(document.querySelectorAll('#content .contentbox')).find(box =>
                    normalizeText(box.querySelector('.boxheadertext')?.textContent) === 'ship viewer'
                );

                const content = contentBox?.querySelector('.content');
                const nativeImageWrap = content?.querySelector('.shipviewimg');
                const nativeImage = nativeImageWrap?.querySelector('img');

                if (
                    !shipDetails ||
                    !shipStats ||
                    !content ||
                    !nativeImage ||
                    content.querySelector('.sfux-ship-dashboard')
                ) {
                    return;
                }

                const dashboard = ctx.element('div');
                dashboard.className = 'sfux-ship-dashboard';

                if (normalizeText(shipDetails.status).includes('upgrad')) {
                    dashboard.classList.add('sfux-ship-dashboard--upgrading');
                }

                const hero = ctx.element('div');
                hero.className = 'sfux-ship-hero';

                const imageCard = ctx.element('div');
                imageCard.className = 'sfux-ship-image-card';

                const image = nativeImage.cloneNode(true);
                image.removeAttribute('height');
                image.removeAttribute('width');
                imageCard.appendChild(image);

                if (shipDetails.status) {
                    const status = ctx.element('div');
                    const statusKind = shipStatusClass(shipDetails.status);
                    status.className = `sfux-ship-status sfux-ship-status--${statusKind}`;
                    status.textContent = shipDetails.status;
                    imageCard.appendChild(status);
                }

                const profile = ctx.element('div');
                profile.className = 'sfux-ship-profile';

                const name = ctx.element('div');
                name.className = 'sfux-ship-name';
                name.textContent = shipDetails.name || nativeImage.alt || 'Ship';

                const classLine = ctx.element('div');
                classLine.className = 'sfux-ship-classline';

                const classParts = [];
                if (shipDetails.className) classParts.push(shipDetails.className);
                if (shipDetails.weapons) classParts.push(shipDetails.weapons);
                classLine.textContent = classParts.join(' · ');

                profile.append(name, classLine);

                const tags = ctx.element('div');
                tags.className = 'sfux-ship-tags';

                if (shipDetails.category) {
                    tags.appendChild(createShipTag(
                        shipDetails.category,
                        shipTagClass(shipDetails.category)
                    ));
                }

                if (shipDetails.modification) {
                    const modificationKind = normalizeText(shipDetails.modification) === 'flexible'
                        ? 'flexible'
                        : normalizeText(shipDetails.modification) === 'fixed'
                            ? 'fixed'
                            : 'neutral';

                    tags.appendChild(createShipTag(
                        shipDetails.modification,
                        modificationKind
                    ));
                }

                profile.appendChild(tags);

                const systems = ctx.element('div');
                systems.className = 'sfux-ship-systems';
                systems.append(
                    createSystemMetric('Maint. Cost', shipDetails.maintenance),
                    createSystemMetric('Power Core', shipDetails.powerCore),
                    createSystemMetric('Engines', shipDetails.engines)
                );
                profile.appendChild(systems);

                if (shipDetails.weapons) {
                    const loadout = ctx.element('div');
                    loadout.className = 'sfux-ship-loadout';

                    const loadoutLabel = ctx.element('span');
                    loadoutLabel.className = 'sfux-ship-loadout-label';
                    loadoutLabel.textContent = 'Weapons';

                    const loadoutValue = ctx.element('span');
                    loadoutValue.className = 'sfux-ship-loadout-value';
                    loadoutValue.textContent = shipDetails.weapons;

                    loadout.append(loadoutLabel, loadoutValue);
                    profile.appendChild(loadout);
                }

                const power = shipDetails.powerDistribution;
                const hasPowerValues = power && (
                    power.weapons || power.engines || power.sensors
                );

                if (hasPowerValues) {
                    const powerRow = ctx.element('div');
                    powerRow.className = 'sfux-ship-loadout';

                    const powerLabel = ctx.element('span');
                    powerLabel.className = 'sfux-ship-loadout-label';
                    powerLabel.textContent = 'Power';

                    const powerValue = ctx.element('span');
                    powerValue.className = 'sfux-ship-power-inline';

                    function makePowerValue(label, rawValue, baseClass) {
                        const item = ctx.element('span');
                        const valueText = rawValue || '—';
                        const numeric = parsePercent(valueText);

                        item.className = baseClass;

                        if (numeric === 0) {
                            item.classList.add('sfux-power-zero');
                        } else if (numeric === 100) {
                            item.classList.add('sfux-power-full');
                        }

                        item.textContent = `${label} ${valueText}`;
                        return item;
                    }

                    const weapon = makePowerValue('W', power.weapons, 'sfux-power-w');
                    const engine = makePowerValue('E', power.engines, 'sfux-power-e');
                    const sensor = makePowerValue('S', power.sensors, 'sfux-power-s');

                    powerValue.append(weapon, engine, sensor);
                    powerRow.append(powerLabel, powerValue);
                    profile.appendChild(powerRow);
                }

                const spacer = ctx.element('div');
                spacer.className = 'sfux-ship-profile-spacer';
                profile.appendChild(spacer);

                if (shipStats.retireLink) {
                    const retire = ctx.element('div');
                    retire.className = 'sfux-ship-retire';

                    const retireLabel = ctx.element('span');
                    retireLabel.className = 'sfux-ship-retire-label';
                    retireLabel.textContent = 'Retire Ship';

                    const retireLink = shipStats.retireLink;
                    retireLink.classList.add('sfux-ship-retire-link');

                    const retireTitle = retireLink.getAttribute('title') || '';
                    const disabled = Boolean(
                        retireLink.querySelector('.dockyardIconDisabled') ||
                        normalizeText(retireTitle).includes('unable')
                    );

                    if (disabled) {
                        retireLink.classList.add('sfux-ship-retire-link--disabled');
                        retireLink.removeAttribute('href');
                        retireLink.setAttribute('aria-disabled', 'true');
                        ctx.on(retireLink, 'click', event => event.preventDefault());
                    }

                    const retireText = ctx.element('span');
                    retireText.textContent = disabled ? 'Unavailable' : 'Retire';

                    retireLink.appendChild(retireText);
                    retire.append(retireLabel, retireLink);
                    profile.appendChild(retire);
                }

                hero.append(imageCard, profile);
                dashboard.appendChild(hero);

                const combat = ctx.element('div');
                combat.className = 'sfux-ship-combat';

                const survivalPanel = ctx.element('section');
                survivalPanel.className = 'sfux-ship-stat-panel';

                const survivalHeader = ctx.element('div');
                survivalHeader.className = 'sfux-ship-stat-header';
                survivalHeader.textContent = 'Hull / Shields';

                const bars = ctx.element('div');
                bars.className = 'sfux-ship-bars';
                bars.append(
                    createShipBar('Hull', shipStats.hullText, shipStats.hull, 'hull'),
                    createShipBar('Shields', shipStats.shieldText, shipStats.shield, 'shield')
                );

                survivalPanel.append(survivalHeader, bars);

                const combatPanel = ctx.element('section');
                combatPanel.className = 'sfux-ship-stat-panel';

                const combatHeader = ctx.element('div');
                combatHeader.className = 'sfux-ship-stat-header';
                combatHeader.textContent = 'Ship Stats';

                const combatStats = ctx.element('div');
                combatStats.className = 'sfux-ship-combat-stats';
                combatStats.append(
                    createCombatStat('Attack', shipStats.attack, 'attack'),
                    createCombatStat('Damage', shipStats.damage, 'damage'),
                    createCombatStat('Defence', shipStats.defence, 'defence')
                );

                combatPanel.append(combatHeader, combatStats);
                combat.append(survivalPanel, combatPanel);
                dashboard.appendChild(combat);

                content.insertBefore(dashboard, content.firstChild);

                nativeImageWrap.classList.add('sfux-ship-native-hidden');

                const nativeStatsWrap = shipDetails.table.closest('.shipviewstats, .responsive-table-container');
                nativeStatsWrap?.classList.add('sfux-ship-native-hidden');

                const nativeBottomWrap = nativeStatsTable.closest('.responsive-table-container');
                nativeBottomWrap?.classList.add('sfux-ship-native-hidden');

                for (const clear of Array.from(content.children).filter(child =>
                    child.classList?.contains('floatClear')
                )) {
                    clear.classList.add('sfux-ship-native-hidden');
                }
            }

            // ---------------------------------------------------------------------
            // Native View Ship control enhancements
            // ---------------------------------------------------------------------
            function enhanceRenameForm() {
                const form = Array.from(document.forms).find(candidate => {
                    const action = candidate.getAttribute('action') || '';
                    return action.includes('rn=1') && candidate.querySelector('input[name="name"]');
                });

                if (!form || form.dataset.sfuxRenameEnhanced === 'true') return;

                const restoreRenameExtras = SFUX.ui.preserveFormExtras(form);
                const nameInput = form.querySelector('input[name="name"]');
                const submit = form.querySelector('input[type="submit"]');
                const paragraph = form.querySelector('p');

                if (!nameInput || !submit || !paragraph) return;

                form.dataset.sfuxRenameEnhanced = 'true';
                form.classList.add('sfux-rename-form');

                const label = ctx.element('label');
                label.className = 'sfux-rename-label';
                label.htmlFor = nameInput.id || 'HTTPContent';
                label.textContent = 'Ship Name';

                const row = ctx.element('div');
                row.className = 'sfux-rename-row';

                row.append(nameInput, submit);
                paragraph.replaceChildren(label, row);
                restoreRenameExtras();
            }

            // ---------------------------------------------------------------------
            // Leecher-specific native 5%/25% one-click routing
            // ---------------------------------------------------------------------
            function buildLeecherPowerRouter(form) {
                const fields = getPowerFields(form);
                const nativeTable = form.querySelector('table.formtable');
                const nativeSubmit = Array.from(form.querySelectorAll('input[type="submit"], button[type="submit"]'))
                    .find(input => normalizeText(input.value || input.textContent).includes('modify power'));

                if (!fields || !nativeTable || !nativeSubmit || form.querySelector('.sfux-leecher-preset')) return;

                // CONFIRMED NATIVE UI (2026-09-10): Modify Ship exposes only 5% or
                // 25% Weapons. Star Fury's own change handler maps those selections to
                // 95% or 75% Engines respectively; Sensors remains disabled at 0.
                // If that contract changes, leave the native form visible instead of
                // guessing at a replacement behavior.
                const legalValues = Array.from(fields.weapons.options || [])
                    .map(option => Number(option.value))
                    .filter(Number.isFinite)
                    .sort((a, b) => a - b);

                const exactNativeOptions = (
                    legalValues.length === 2 &&
                    legalValues[0] === 5 &&
                    legalValues[1] === 25
                );

                const nativeShapeMatches = (
                    fields.weapons.tagName === 'SELECT' &&
                    exactNativeOptions &&
                    fields.engine.readOnly &&
                    fields.sensors.matches(':disabled') &&
                    Number(fields.sensors.value) === 0
                );

                if (!nativeShapeMatches) return;

                injectStyles();

                const presets = [
                    { weapons: 5, engine: 95, sensors: 0 },
                    { weapons: 25, engine: 75, sensors: 0 }
                ];

                let current = readDisplayedDistribution(form);
                const router = ctx.element('div');
                router.className = 'sfux-power-router sfux-leecher-router sfux-leecher-preset';

                const states = [];

                function restoreNativeFallback() {
                    router.remove();
                    nativeTable.classList.remove('sfux-power-native-hidden');
                    nativeSubmit.classList.remove('sfux-power-native-hidden');
                }

                function applyPreset(preset, state) {
                    if (nativeSubmit.matches(':disabled')) return;

                    fields.weapons.value = String(preset.weapons);
                    fields.weapons.dispatchEvent(new Event('input', { bubbles: true }));
                    fields.weapons.dispatchEvent(new Event('change', { bubbles: true }));

                    // Star Fury's native onchange is authoritative. Verify that it
                    // produced the confirmed complementary Engine value before using
                    // the native Modify Power submit path.
                    const nativeResultMatches = (
                        Number(fields.weapons.value) === preset.weapons &&
                        Number(fields.engine.value) === preset.engine &&
                        Number(fields.sensors.value) === preset.sensors &&
                        fields.engine.readOnly &&
                        fields.sensors.matches(':disabled')
                    );

                    if (!nativeResultMatches) {
                        restoreNativeFallback();
                        return;
                    }

                    state.action.disabled = true;
                    state.action.classList.remove('sfux-power-active');
                    state.action.textContent = 'Applying…';

                    SFUX.ui.submit(form, nativeSubmit);

                    // If native validation cancels navigation, keep the helper usable.
                    refresh();
                }

                function createPreset(preset) {
                    const route = ctx.element('div');
                    route.className = 'sfux-power-route sfux-power-route--weapons';

                    const main = ctx.element('div');
                    main.className = 'sfux-power-route-main';

                    const labelWrap = ctx.element('div');
                    labelWrap.className = 'sfux-power-route-label';

                    const name = ctx.element('span');
                    name.className = 'sfux-power-route-name';
                    name.textContent = `${preset.weapons}% Weapons`;

                    const split = ctx.element('span');
                    split.className = 'sfux-power-route-split';
                    split.textContent = `${preset.weapons}% W · ${preset.engine}% engines · 0% sensors`;

                    labelWrap.append(name, split);

                    const action = ctx.element('button');
                    action.type = 'button';
                    action.className = 'sfux-power-action';

                    const state = { preset, route, action };
                    states.push(state);
                    ctx.on(action, 'click', () => applyPreset(preset, state));

                    main.append(labelWrap, action);
                    route.appendChild(main);
                    router.appendChild(route);
                }

                function refresh() {
                    current = readDisplayedDistribution(form);

                    for (const state of states) {
                        const active = distributionsMatch(current, state.preset);
                        state.action.disabled = active || nativeSubmit.matches(':disabled');
                        state.action.classList.toggle('sfux-power-active', active);
                        state.action.textContent = active ? 'Active' : 'Switch';
                    }
                }

                for (const preset of presets) createPreset(preset);

                form.insertBefore(router, nativeTable);
                nativeTable.classList.add('sfux-power-native-hidden');
                nativeSubmit.classList.add('sfux-power-native-hidden');
                refresh();
                hideNativePowerDistributionTable();
            }

            // ---------------------------------------------------------------------
            // Standard Weapons/Sensors routing and saved custom engine shares
            // ---------------------------------------------------------------------
            function buildPowerRouter(form) {
                const shipId = getShipId();
                if (!shipId) return;

                const fields = getPowerFields(form);
                const weaponsInput = fields?.weapons;
                const engineInput = fields?.engine;
                const sensorsInput = fields?.sensors;
                const nativeTable = form.querySelector('table.formtable');
                const nativeSubmit = Array.from(form.querySelectorAll('input[type="submit"]'))
                    .find(input => normalizeText(input.value).includes('modify power'));

                if (!weaponsInput || !engineInput || !sensorsInput || !nativeTable) return;
                if ([weaponsInput, engineInput, sensorsInput].some(field => field.matches(':disabled') || field.readOnly)) return;

                injectStyles();

                nativeTable.classList.add('sfux-power-native-hidden');
                if (nativeSubmit) nativeSubmit.classList.add('sfux-power-native-hidden');

                const profiles = loadProfiles();
                let current = readDisplayedDistribution(form);

                const router = ctx.element('div');
                router.className = 'sfux-power-router';

                const routeState = {};

                function submitAllocation(mode) {
                    const allocation = allocationFor(mode, profiles[mode]);

                    if (!setNativePowerValues(form, allocation)) return;

                    const button = routeState[mode].action;
                    button.disabled = true;
                    button.classList.remove('sfux-power-active');
                    button.textContent = 'Applying…';

                    SFUX.ui.submit(form, nativeSubmit);
                    // Validation cancellation must not leave a helper permanently disabled.
                    refresh();
                }

                function createRoute(mode) {
                    const label = mode === 'weapons' ? 'Weapons' : 'Sensors';

                    const route = ctx.element('div');
                    route.className = `sfux-power-route sfux-power-route--${mode}`;

                    const main = ctx.element('div');
                    main.className = 'sfux-power-route-main';

                    const labelWrap = ctx.element('div');
                    labelWrap.className = 'sfux-power-route-label';

                    const name = ctx.element('span');
                    name.className = 'sfux-power-route-name';
                    name.textContent = `${label} Power`;

                    const split = ctx.element('span');
                    split.className = 'sfux-power-route-split';

                    labelWrap.append(name, split);

                    const action = ctx.element('button');
                    action.type = 'button';
                    action.className = 'sfux-power-action';

                    const gear = ctx.element('button');
                    gear.type = 'button';
                    gear.className = 'sfux-power-gear';
                    gear.title = `Configure ${label} / Engine preset`;
                    gear.setAttribute('aria-label', gear.title);
                    gear.innerHTML = '<span class="fa fa-cog" aria-hidden="true"></span>';

                    const editor = createEditor(mode, profiles, refresh);

                    ctx.on(gear, 'click', () => {
                        for (const otherMode of ['weapons', 'sensors']) {
                            if (otherMode !== mode && routeState[otherMode]?.editor?.isOpen()) {
                                routeState[otherMode].editor.close();
                                routeState[otherMode].gear.classList.remove('sfux-power-gear-open');
                            }
                        }

                        if (editor.isOpen()) {
                            editor.close();
                            gear.classList.remove('sfux-power-gear-open');
                        } else {
                            editor.open();
                            gear.classList.add('sfux-power-gear-open');
                        }
                    });

                    ctx.on(action, 'click', () => submitAllocation(mode));

                    main.append(labelWrap, action, gear);
                    route.append(main, editor.element);
                    router.appendChild(route);

                    routeState[mode] = {
                        route,
                        split,
                        action,
                        gear,
                        editor
                    };
                }

                createRoute('weapons');
                createRoute('sensors');

                function refresh() {
                    current = readDisplayedDistribution(form);

                    for (const mode of ['weapons', 'sensors']) {
                        const state = routeState[mode];
                        state.gear.classList.toggle('sfux-power-gear-open', state.editor.isOpen());
                        const profile = normalizeProfile(profiles[mode]);
                        const allocation = allocationFor(mode, profile);
                        const label = mode === 'weapons' ? 'Weapons' : 'Sensors';
                        const shortLabel = mode === 'weapons' ? 'W' : 'S';

                        state.split.textContent =
                            `${profile.primary}% ${shortLabel} · ${profile.engine}% engines`;

                        const active = distributionsMatch(current, allocation);

                        state.action.disabled = active || !nativeSubmit || nativeSubmit.matches(':disabled');
                        state.action.classList.toggle('sfux-power-active', active);
                        state.action.textContent = active
                            ? 'Active'
                            : 'Switch';
                    }
                }

                form.insertBefore(router, nativeTable);
                refresh();
                hideNativePowerDistributionTable();
            }



            // ---------------------------------------------------------------------
            // Star Dock roster overview, role tabs, roster cards, and name hydration
            // ---------------------------------------------------------------------
            function isStarDockOverviewPage() {
                if (window.location.pathname.toLowerCase() !== '/stardock.php') return false;
                if (isShipConstructionPage()) return false;

                const params = new URLSearchParams(window.location.search);

                if (
                    params.has('fleet') ||
                    params.has('buildship') ||
                    params.has('construct')
                ) {
                    return false;
                }

                // Training posts back to ?dock=...&train, but StarFury still renders the
                // normal Star Dock overview beneath the success/warning message. Treat
                // that response as an overview page so the roster styling survives the
                // reload after training cadets.

                return Boolean(document.querySelector('#content table.stardocktable'));
            }

            function dockRoleKind(value) {
                const normalized = normalizeText(value);

                if (normalized.startsWith('attacker') || normalized === 'attack') return 'attack';
                if (normalized.startsWith('defender') || normalized.startsWith('defence') || normalized.startsWith('defense')) return 'defence';
                if (normalized.startsWith('raider') || normalized === 'raid') return 'raider';
                if (normalized.startsWith('leecher')) return 'leecher';
                if (normalized.startsWith('building') || normalized.startsWith('build')) return 'build';

                return 'neutral';
            }

            function parseDockCategoryHeader(text) {
                const normalized = String(text || '').replace(/\s+/g, ' ').trim();

                // Tolerate trailing native controls/status text. StarFury can append
                // Counter EMP UI to the same sectionTitle node as the role header.
                const match = normalized.match(
                    /^(.+?):\s*(\d+)\s*\/\s*(\d+)\s*\[\s*Comms:\s*([^\]]+)\s*\]/i
                );

                if (!match) {
                    return {
                        title: normalized || 'Ships',
                        current: null,
                        maximum: null,
                        comms: ''
                    };
                }

                return {
                    title: match[1].trim(),
                    current: Number(match[2]),
                    maximum: Number(match[3]),
                    comms: match[4].trim()
                };
            }

            function detachDockHeaderNativeActions(sectionTitle) {
                if (!sectionTitle) {
                    return { counterControl: null, counterModal: null };
                }

                // StarFury renders Counter EMP inside sectionTitle. Detach those exact
                // native nodes before rebuilding the visual header, then reinsert them.
                // This preserves the original modal target and backend action URL.
                const directChildren = Array.from(sectionTitle.children || []);

                const counterControl = directChildren.find(child =>
                    child.classList?.contains('right') &&
                    /counter\s*emp/i.test(String(child.textContent || ''))
                ) || null;

                const counterModal = directChildren.find(child =>
                    child.classList?.contains('modal') &&
                    (
                        /^counter\d+$/i.test(String(child.id || '')) ||
                        /counter\s*emp/i.test(String(child.textContent || ''))
                    )
                ) || null;

                if (counterControl) {
                    counterControl.remove();
                    counterControl.classList.add('sfux-counter-emp-control');
                }

                if (counterModal) {
                    counterModal.remove();
                    counterModal.classList.add('sfux-counter-emp-modal');
                }

                return { counterControl, counterModal };
            }

            function parseDockShipRow(row) {
                const cells = Array.from(row.cells || []);
                if (cells.length < 4) return null;

                const imageCell = cells[0];
                const infoCell = cells[1];
                const healthCell = cells[2];
                const actionCell = cells[3];

                const shipLink =
                    imageCell.querySelector('a[href*="viewship.php?ShipID="]') ||
                    infoCell.querySelector('a[href*="viewship.php?ShipID="]');

                if (!shipLink) return null;

                let shipId = '';
                try {
                    shipId = new URL(shipLink.href, window.location.href).searchParams.get('ShipID') || '';
                } catch (error) {
                    shipId = '';
                }

                const classLink =
                    infoCell.querySelector('a[href*="viewship.php?ShipID="]') ||
                    shipLink;

                const className = String(classLink.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim() || 'Ship';

                const rawInfo = String(infoCell.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();

                const statusMatch = rawInfo.match(
                    /Status:\s*(.*?)\s*Eng\.\s*:/i
                );

                const status = statusMatch
                    ? statusMatch[1].trim()
                    : String(infoCell.querySelector('.primaryColour')?.textContent || '').trim();

                const engineMatch = rawInfo.match(/Eng\.\s*:\s*(\d+)/i);
                const engineTicks = engineMatch ? Number(engineMatch[1]) : null;

                const powerMatch = rawInfo.match(
                    /W:\s*(\d+).*?E:\s*(\d+).*?S:\s*(\d+)/i
                );

                const power = powerMatch
                    ? {
                        weapons: Number(powerMatch[1]),
                        engines: Number(powerMatch[2]),
                        sensors: Number(powerMatch[3])
                    }
                    : {
                        weapons: null,
                        engines: null,
                        sensors: null
                    };

                const healthLabels = Array.from(
                    healthCell.querySelectorAll('.cssProgress-label, .mobile-show p')
                ).map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim());

                const hullText = healthLabels.find(value =>
                    normalizeText(value).startsWith('hull:')
                ) || '';

                const shieldText = healthLabels.find(value =>
                    normalizeText(value).startsWith('shields:')
                ) || '';

                const hull = parseCurrentMaximum(hullText);
                const shield = parseCurrentMaximum(shieldText);

                let mode = '';
                if (imageCell.querySelector('.fixedIcon')) mode = 'Fixed';
                if (imageCell.querySelector('.flexIcon')) mode = 'Flexible';

                let shipName = '';
                if (shipId) {
                    const modalName = document
                        .getElementById(`disable${shipId}`)
                        ?.querySelector('strong');

                    if (modalName) {
                        shipName = String(modalName.textContent || '')
                            .replace(/\s*\[[^\]]+\]\s*$/, '')
                            .replace(/\s+/g, ' ')
                            .trim();

                        if (shipName) rememberShipName(shipId, shipName);
                    }

                    if (!shipName) {
                        shipName = cachedShipName(shipId);
                    }
                }

                return {
                    cells,
                    imageCell,
                    infoCell,
                    healthCell,
                    actionCell,
                    shipLink,
                    classLink,
                    shipId,
                    className,
                    shipName,
                    status,
                    engineTicks,
                    power,
                    hull,
                    shield,
                    mode
                };
            }

            function createDockPowerMetric(label, value, className) {
                const item = ctx.element('span');
                item.className = className;

                if (value === 0) {
                    item.classList.add('sfux-power-zero');
                } else if (value === 100) {
                    item.classList.add('sfux-power-full');
                }

                item.textContent = `${label} ${value ?? '—'}%`;
                return item;
            }

            function createDockVital(kind, label, stats) {
                const wrap = ctx.element('div');
                wrap.className = `sfux-dock-vital sfux-dock-vital--${kind}`;

                const head = ctx.element('div');
                head.className = 'sfux-dock-vital-head';

                const labelEl = ctx.element('span');
                labelEl.className = 'sfux-dock-vital-label';
                labelEl.textContent = label;

                const valueEl = ctx.element('span');
                valueEl.className = 'sfux-dock-vital-value';

                if (stats) {
                    valueEl.textContent =
                        `${stats.current.toLocaleString()} / ${stats.maximum.toLocaleString()}`;
                } else {
                    valueEl.textContent = '—';
                }

                head.append(labelEl, valueEl);

                const track = ctx.element('div');
                track.className = 'sfux-dock-vital-track';

                const fill = ctx.element('div');
                fill.className = 'sfux-dock-vital-fill';
                fill.style.width = `${stats?.percent ?? 0}%`;

                track.appendChild(fill);
                wrap.append(head, track);

                return wrap;
            }

            function enhanceDockRow(row) {
                if (row.classList.contains('sfux-dock-row')) return false;

                const data = parseDockShipRow(row);
                if (!data) return false;

                row.classList.add('sfux-dock-row');

                data.imageCell.classList.add('sfux-dock-image-cell');
                data.actionCell.classList.add('sfux-dock-actions');

                const identity = ctx.element('div');
                identity.className = 'sfux-dock-identity';

                const identityHead = ctx.element('div');
                identityHead.className = 'sfux-dock-identity-head';

                const identityLink = ctx.element('a');
                identityLink.className = 'sfux-dock-ship-name';
                identityLink.href = data.shipLink.href;
                identityLink.textContent = data.shipName || data.className;

                if (data.shipId) {
                    identityLink.dataset.sfuxShipId = data.shipId;
                }

                if (!data.shipName) {
                    identityLink.classList.add('sfux-dock-ship-name--fallback');
                }

                identityHead.appendChild(identityLink);
                identity.appendChild(identityHead);

                const tags = ctx.element('div');
                tags.className = 'sfux-dock-identity-tags';

                const primaryTags = ctx.element('span');
                primaryTags.className = 'sfux-dock-primary-tags';

                if (data.status) {
                    const status = ctx.element('span');
                    const normalizedStatus = normalizeText(data.status);
                    const statusKind = normalizedStatus.includes('explor')
                        ? 'exploring'
                        : shipStatusClass(data.status);
                    status.className = `sfux-dock-status sfux-dock-status--${statusKind}`;

                    const compactStatus = data.status
                        .replace(/exploring\s+planets?/i, 'Exploring')
                        .replace(/\(\s*(\d+)\s*ticks?\s*\)/i, ' · $1t')
                        .replace(/\s+/g, ' ')
                        .trim();

                    status.textContent = compactStatus;

                    primaryTags.appendChild(status);
                }

                if (data.mode) {
                    const modeKindValue = modeKind(data.mode);
                    const modeTag = createShipTag(
                        data.mode,
                        modeKindValue === 'neutral' ? '' : modeKindValue
                    );
                    primaryTags.appendChild(modeTag);
                }

                if (primaryTags.children.length) {
                    tags.appendChild(primaryTags);
                }

                if (
                    data.className &&
                    (!data.shipName || normalizeText(data.shipName) !== normalizeText(data.className))
                ) {
                    const classMeta = ctx.element('span');
                    classMeta.className = 'sfux-dock-class-meta';
                    classMeta.textContent = data.className;
                    tags.appendChild(classMeta);
                }

                if (tags.children.length) {
                    identity.appendChild(tags);
                }

                const hasPower =
                    data.power.weapons !== null ||
                    data.power.engines !== null ||
                    data.power.sensors !== null;

                if (hasPower) {
                    const power = ctx.element('div');
                    power.className = 'sfux-dock-power';

                    power.append(
                        createDockPowerMetric('W', data.power.weapons, 'sfux-power-w'),
                        createDockPowerMetric('E', data.power.engines, 'sfux-power-e'),
                        createDockPowerMetric('S', data.power.sensors, 'sfux-power-s')
                    );

                    if (Number.isFinite(data.engineTicks)) {
                        const engine = ctx.element('span');
                        engine.className = 'sfux-dock-engine';
                        engine.textContent = `ENG ${data.engineTicks}t`;
                        power.appendChild(engine);
                    }

                    identity.appendChild(power);
                } else if (Number.isFinite(data.engineTicks)) {
                    const engine = ctx.element('span');
                    engine.className = 'sfux-dock-engine';
                    engine.textContent = `ENG ${data.engineTicks}t`;
                    tags.appendChild(engine);

                    if (!tags.isConnected) {
                        identity.appendChild(tags);
                    }
                }

                data.infoCell.replaceChildren(identity);

                const vitals = ctx.element('div');
                vitals.className = 'sfux-dock-vitals';
                vitals.append(
                    createDockVital('hull', 'Hull', data.hull),
                    createDockVital('shield', 'Shields', data.shield)
                );

                data.healthCell.replaceChildren(vitals);

                const dropdown = data.actionCell.querySelector('.dropdown');
                if (dropdown) {
                    dropdown.classList.add('sfux-dock-action-menu');
                }

                return true;
            }

            async function fetchShipNameFromViewPage(link) {
                try {
                    const response = await ctx.fetch(link.href, {
                        method: 'GET',
                        credentials: 'same-origin'
                    });

                    if (!response.ok) return '';

                    const html = await response.text();
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    return shipNameFromDocument(doc);
                } catch (error) {
                    return '';
                }
            }

            async function hydrateMissingDockShipNames() {
                const pending = Array.from(
                    document.querySelectorAll(
                        '.sfux-dock-ship-name.sfux-dock-ship-name--fallback[data-sfux-ship-id]'
                    )
                );

                if (!pending.length) return;

                // Be intentionally gentle with StarFury:
                // - cached names are always resolved locally
                // - at most 12 unknown ships are looked up per Star Dock load
                // - only one request is in flight at a time
                // - requests are spaced by 250 ms
                const lookupBudget = NAME_LOOKUPS_PER_LOAD;
                let lookupsUsed = 0;

                for (const link of pending) {
                    if (!ctx.alive) return;
                    const shipId = link.dataset.sfuxShipId || '';

                    const cached = cachedShipName(shipId);
                    if (cached) {
                        link.textContent = cached;
                        link.classList.remove('sfux-dock-ship-name--fallback');
                        continue;
                    }

                    if (lookupsUsed >= lookupBudget) continue;
                    lookupsUsed += 1;

                    const name = await fetchShipNameFromViewPage(link);
                    if (!ctx.alive) return;

                    if (name) {
                        rememberShipName(shipId, name);

                        if (link.isConnected) {
                            link.textContent = name;
                            link.classList.remove('sfux-dock-ship-name--fallback');
                        }
                    }

                    await new Promise(resolve => ctx.timeout(resolve, NAME_LOOKUP_DELAY_MS));
                }
            }

            function enhanceStarDockOverview() {
                if (!isStarDockOverviewPage()) return;

                injectStyles();
                enhanceCadetTraining();

                const contentBox = Array.from(
                    document.querySelectorAll('#content .contentbox')
                ).find(box =>
                    normalizeText(box.querySelector('.boxheadertext')?.textContent) ===
                    'star dock overview'
                );

                if (!contentBox || contentBox.classList.contains('sfux-stardock-overview')) {
                    return;
                }

                contentBox.classList.add('sfux-stardock-overview');

                const containers = Array.from(
                    contentBox.querySelectorAll('.categoryContainer')
                );

                const categoryData = new Map();
                let totalShips = 0;
                let totalCapacity = 0;

                for (const container of containers) {
                    const sectionTitle = container.querySelector(':scope > .sectionTitle');

                    // Keep native Counter EMP UI out of the text parser while preserving
                    // StarFury's own button, confirmation modal, and confirm link.
                    const nativeHeaderActions = detachDockHeaderNativeActions(sectionTitle);
                    const parsed = parseDockCategoryHeader(sectionTitle?.textContent);
                    const role = dockRoleKind(parsed.title);

                    container.classList.add(
                        'sfux-dock-category',
                        `sfux-dock-category--${role}`
                    );

                    if (sectionTitle) {
                        sectionTitle.classList.add('sfux-dock-category-head');
                        sectionTitle.replaceChildren();

                        const title = ctx.element('span');
                        title.className = 'sfux-dock-category-title';
                        title.textContent = parsed.title;

                        const capacity = ctx.element('span');
                        capacity.className = 'sfux-dock-category-capacity';

                        if (
                            Number.isFinite(parsed.current) &&
                            Number.isFinite(parsed.maximum)
                        ) {
                            capacity.textContent = `${parsed.current} / ${parsed.maximum}`;

                            if (parsed.maximum > 0 && parsed.current >= parsed.maximum) {
                                capacity.classList.add(
                                    'sfux-dock-category-capacity--full'
                                );
                            }

                            totalShips += parsed.current;
                            totalCapacity += parsed.maximum;
                        }

                        const comms = ctx.element('span');
                        comms.className = 'sfux-dock-category-comms';
                        comms.textContent = parsed.comms || 'Online';

                        sectionTitle.append(title, capacity, comms);

                        if (nativeHeaderActions.counterControl) {
                            sectionTitle.append(nativeHeaderActions.counterControl);
                        }

                        // Keep the hidden modal outside the flex header. The preserved
                        // native button still targets the same element ID via rel=modal:open.
                        if (nativeHeaderActions.counterModal) {
                            sectionTitle.insertAdjacentElement(
                                'afterend',
                                nativeHeaderActions.counterModal
                            );
                        }
                    }

                    const table = container.querySelector('table.stardocktable');
                    if (table) {
                        table.classList.add('sfux-dock-table');

                        for (const row of Array.from(table.rows || [])) {
                            enhanceDockRow(row);
                        }
                    }

                    categoryData.set(normalizeText(parsed.title), {
                        title: parsed.title,
                        current: parsed.current,
                        maximum: parsed.maximum
                    });
                }

                const boxHeader = contentBox.querySelector('.boxheader');
                if (
                    boxHeader &&
                    totalCapacity > 0 &&
                    !boxHeader.querySelector('.sfux-dock-overview-summary')
                ) {
                    const summary = ctx.element('span');
                    summary.className = 'sfux-dock-overview-summary';
                    summary.textContent = `${totalShips} ships · ${totalCapacity} slots`;
                    boxHeader.appendChild(summary);
                }

                const subMenu = document.getElementById('subMenu');
                if (subMenu) {
                    subMenu.classList.add('sfux-dock-tabs');

                    const links = Array.from(subMenu.querySelectorAll('a'));
                    const storageKey = `sfuxStarDockTab:${new URLSearchParams(window.location.search).get('dock') || 'default'}`;

                    function tabCategory(link) {
                        const href = String(link.getAttribute('href') || '');
                        const match = href.match(/changeCategory\((?:["']([^"']+)["'])?\)/i);
                        return match ? (match[1] || 'Overview') : String(link.textContent || '').trim();
                    }

                    function applyFilter(name) {
                        const wanted = normalizeText(name);
                        const showAll = wanted === 'overview';

                        for (const container of containers) {
                            const sectionTitle = container.querySelector(
                                '.sfux-dock-category-title'
                            );
                            const containerName = normalizeText(sectionTitle?.textContent);

                            container.style.display =
                                showAll || containerName === wanted
                                    ? ''
                                    : 'none';
                        }

                        for (const link of links) {
                            link.classList.toggle(
                                'sfux-dock-tab-active',
                                normalizeText(tabCategory(link)) === wanted
                            );
                        }
                    }

                    for (const link of links) {
                        const name = tabCategory(link);
                        const data = categoryData.get(normalizeText(name));
                        const normalizedName = normalizeText(name);
                        const tabRole = normalizedName === 'overview'
                            ? 'overview'
                            : dockRoleKind(name);

                        link.classList.add(`sfux-dock-tab--${tabRole}`);

                        if (
                            data &&
                            Number.isFinite(data.current) &&
                            Number.isFinite(data.maximum) &&
                            !link.querySelector('.sfux-dock-tab-count')
                        ) {
                            const count = ctx.element('span');
                            count.className = 'sfux-dock-tab-count';
                            count.textContent = `${data.current}/${data.maximum}`;
                            link.appendChild(count);
                        }

                        ctx.on(link, 'click', event => {
                            event.preventDefault();

                            try {
                                SFUX.storage.sessionSet(storageKey, name);
                            } catch (error) {
                                // Storage is only a convenience.
                            }

                            applyFilter(name);
                        });
                    }

                    let remembered = 'Overview';
                    try {
                        remembered = SFUX.storage.sessionGet(storageKey) || 'Overview';
                    } catch (error) {
                        remembered = 'Overview';
                    }

                    const rememberedLink = links.find(link =>
                        normalizeText(tabCategory(link)) === normalizeText(remembered)
                    );

                    applyFilter(rememberedLink ? remembered : 'Overview');
                }

                // Some native Star Dock rows contain only the class because StarFury
                // omits custom names while a ship cannot expose a Disable confirmation
                // (for example Returning, Exploring, or Upgrading ships). Fill those
                // names from cache or their View Ship page without delaying the roster.
                void hydrateMissingDockShipNames();
            }

            // ---------------------------------------------------------------------
            // Ship Construction dashboard and cadet-training controls
            // ---------------------------------------------------------------------
            function isShipConstructionPage() {
                if (window.location.pathname.toLowerCase() !== '/stardock.php') return false;

                const params = new URLSearchParams(window.location.search);
                return (
                    params.has('construct') &&
                    params.has('role') &&
                    params.has('class')
                );
            }

            function constructionValue(table, label) {
                if (!table) return null;

                const wanted = normalizeText(label).replace(/\.$/, '');

                for (const row of Array.from(table.rows || [])) {
                    const cells = Array.from(row.cells || []);
                    if (cells.length < 2) continue;

                    const rowLabel = normalizeText(cells[0].textContent).replace(/\.$/, '');
                    if (rowLabel !== wanted) continue;

                    const valueCell = cells[cells.length - 1];
                    let state = 'neutral';

                    if (valueCell.querySelector('.positiveamount')) state = 'positive';
                    if (valueCell.querySelector('.negativeamount')) state = 'negative';

                    return {
                        text: String(valueCell.textContent || '').replace(/\s+/g, ' ').trim(),
                        state
                    };
                }

                return null;
            }

            function readConstructionPage() {
                const box = Array.from(document.querySelectorAll('#content .contentbox')).find(candidate =>
                    normalizeText(candidate.querySelector('.boxheadertext')?.textContent) === 'ship construction'
                );

                const content = box?.querySelector('.content');
                if (!content) return null;

                const imageWrap = content.querySelector('.shipviewimg');
                const image = imageWrap?.querySelector('img');
                const statsWrap = content.querySelector('.shipviewstats');
                const shipTables = Array.from(statsWrap?.querySelectorAll('table.shipviewtable') || []);

                const detailsTable = shipTables.find(table =>
                    normalizeText(table.rows?.[0]?.cells?.[0]?.textContent) === 'class'
                );

                const combatTable = shipTables.find(table =>
                    normalizeText(table.textContent).includes('base attack p') &&
                    normalizeText(table.textContent).includes('base damage p')
                );

                const form = Array.from(content.querySelectorAll('form')).find(candidate =>
                    normalizeText(candidate.getAttribute('action')).includes('buildship')
                );

                const nativeConfigTable = form?.querySelector('table.basictable');
                const submit = form?.querySelector('input[type="submit"], button[type="submit"]');
                const fields = getPowerFields(form);
                const modeControl = form?.querySelector('[name="fixed"], [name="build_flex"]');
                const helpLink = form?.querySelector('a.explainer[href*="ffhelp"]');

                const destination = String(
                    form?.querySelector('.primaryColour')?.textContent || ''
                ).replace(/\s+/g, ' ').trim();

                if (
                    !image ||
                    !detailsTable ||
                    !combatTable ||
                    !form ||
                    !nativeConfigTable ||
                    !submit ||
                    !fields
                ) {
                    return null;
                }

                const get = label => constructionValue(detailsTable, label) || { text: '—', state: 'neutral' };
                const attack = constructionValue(combatTable, 'Base Attack P.') || { text: '—', state: 'neutral' };
                const damage = constructionValue(combatTable, 'Base Damage P.') || { text: '—', state: 'neutral' };

                return {
                    box,
                    content,
                    imageWrap,
                    image,
                    statsWrap,
                    shipTables,
                    detailsTable,
                    combatTable,
                    form,
                    nativeConfigTable,
                    submit,
                    fields,
                    modeControl,
                    helpLink,
                    destination,
                    className: get('Class').text,
                    buildTime: get('Build Time'),
                    powerCore: get('Power Core'),
                    cost: get('Cost'),
                    metal: get('Metal'),
                    deuterium: get('Deuterium'),
                    iridium: constructionValue(detailsTable, 'Iridium'),
                    crew: get('Crew'),
                    engines: get('Engines'),
                    maintenance: get('Maint. Cost'),
                    hull: get('Hull'),
                    shields: get('Shields'),
                    weapons: get('Weapons'),
                    attack,
                    damage
                };
            }

            function createConstructionCost(label, detail) {
                const card = ctx.element('div');
                card.className = 'sfux-construction-cost';

                if (detail?.state === 'positive') {
                    card.classList.add('sfux-construction-cost--positive');
                } else if (detail?.state === 'negative') {
                    card.classList.add('sfux-construction-cost--negative');
                }

                const labelEl = ctx.element('span');
                labelEl.className = 'sfux-construction-cost-label';
                labelEl.textContent = label;

                const valueEl = ctx.element('span');
                valueEl.className = 'sfux-construction-cost-value';
                valueEl.textContent = detail?.text || '—';

                card.append(labelEl, valueEl);
                return card;
            }

            function createConstructionDetail(label, detail) {
                const card = ctx.element('div');
                card.className = 'sfux-construction-detail';

                const detailKind = String(label || '')
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                if (detailKind) {
                    card.classList.add(`sfux-construction-detail--${detailKind}`);
                }

                const labelEl = ctx.element('span');
                labelEl.className = 'sfux-construction-detail-label';
                labelEl.textContent = label;

                const valueEl = ctx.element('span');
                valueEl.className = 'sfux-construction-detail-value';
                valueEl.textContent = detail?.text || '—';

                card.append(labelEl, valueEl);
                return card;
            }

            function createConstructionCapacity(label, detail, kind) {
                const card = ctx.element('div');
                card.className = `sfux-construction-capacity sfux-construction-capacity--${kind}`;

                const labelEl = ctx.element('span');
                labelEl.className = 'sfux-construction-capacity-label';
                labelEl.textContent = label;

                const valueEl = ctx.element('span');
                valueEl.className = 'sfux-construction-capacity-value';
                valueEl.textContent = detail?.text || '—';

                card.append(labelEl, valueEl);
                return card;
            }

            function createConstructionCombat(label, detail, kind) {
                const card = ctx.element('div');
                card.className = `sfux-construction-combat-card sfux-construction-combat-card--${kind}`;

                const labelEl = ctx.element('span');
                labelEl.className = 'sfux-construction-combat-label';
                labelEl.textContent = label;

                const valueEl = ctx.element('span');
                valueEl.className = 'sfux-construction-combat-value';
                valueEl.textContent = detail?.text || '—';

                card.append(labelEl, valueEl);
                return card;
            }

            function modeKind(value) {
                const normalized = normalizeText(value);
                if (normalized.includes('flex')) return 'flexible';
                if (normalized.includes('fixed')) return 'fixed';
                return 'neutral';
            }

            function modeDisplayValue(control) {
                if (!control) return '';

                if (control.tagName === 'SELECT') {
                    return String(
                        control.selectedOptions?.[0]?.textContent ||
                        control.options?.[control.selectedIndex]?.textContent ||
                        control.value ||
                        ''
                    ).trim();
                }

                return String(control.value || '').trim();
            }

            function createConstructionPowerField(label, field, kind) {
                const wrap = ctx.element('div');
                wrap.className = `sfux-construction-power-field sfux-construction-power-field--${kind}`;

                const labelEl = ctx.element('label');
                labelEl.textContent = label;

                const inputWrap = ctx.element('div');
                inputWrap.className = 'sfux-construction-power-input-wrap';

                field.classList.add('inputBox');
                field.min = '0';
                field.max = '100';
                field.inputMode = 'numeric';

                const percent = ctx.element('span');
                percent.className = 'sfux-construction-power-percent';
                percent.textContent = '%';

                inputWrap.append(field, percent);
                wrap.append(labelEl, inputWrap);
                SFUX.ui.number(ctx, field, { min: 0, max: 100, spinner: false });
                return wrap;
            }

            function buildConstructionLeecherControl(details, parent, onChanged) {
                const controls = createNativeLeecherControls(details.fields, onChanged);
                controls.classList.add('sfux-construction-leecher');
                parent.append(controls);
                // Initialization is completed by enhanceShipConstruction after all state exists.
                return true;
            }

            function createNativeLeecherControls(fields, onChanged = () => {}) {
                // CONFIRMED NATIVE UI (2026-09-10 Modify Ship HTML): select 5 or 25;
                // changeValue() sets the readonly Engines field to 95 or 75; Sensors is
                // disabled at 0 and omitted from the native POST. Server rules are not inferred.
                // Construction uses its own native controls/handlers, without assuming its
                // capability flags or form schema equal Modify Ship's.
                const shell = ctx.element('div'); shell.className = 'sfux-leecher-router';
                for (const [label, field, kind] of [['Weapons', fields.weapons, 'weapons'], ['Engines', fields.engine, 'engines'], ['Sensors', fields.sensors, 'sensors']]) {
                    const row = ctx.element('label'); row.className = 'sfux-leecher-native-row';
                    const title = ctx.element('span'); title.textContent = label;
                    row.append(title, field); shell.append(row);
                    if (field.type === 'number') SFUX.ui.number(ctx, field, { min: 0, max: 100, spinner: !field.readOnly && !field.disabled });
                    ctx.on(field, 'change', () => { ctx.raf(onChanged); });
                    ctx.on(field, 'input', () => { ctx.raf(onChanged); });
                }
                return shell;
            }

            function enhanceCadetTraining() {
                const controls = document.querySelector('#controls-content .content');
                if (!controls || controls.querySelector('.sfux-cadet-inline-form')) return;

                const form = Array.from(controls.querySelectorAll('form')).find(candidate => {
                    const action = String(candidate.getAttribute('action') || '').toLowerCase();
                    return action.includes('train') && candidate.querySelector('[name="recruits"]');
                });

                if (!form) return;

                const input = form.querySelector('[name="recruits"]');
                const submit = form.querySelector('input[type="submit"], button[type="submit"]');
                if (!input || !submit) return;

                const inline = ctx.element('div');
                inline.className = 'sfux-cadet-inline-form';

                input.type = 'number';
                input.min = '0';
                input.inputMode = 'numeric';

                if (submit.tagName === 'INPUT') {
                    submit.value = 'Train';
                } else {
                    submit.textContent = 'Train';
                }

                const oldParents = [input.parentElement, submit.parentElement];

                inline.append(input, submit);
                SFUX.ui.number(ctx, input, { min: 0, step: 1 });
                form.insertBefore(inline, form.firstChild);

                for (const parent of oldParents) {
                    if (
                        parent &&
                        parent !== form &&
                        parent !== inline &&
                        parent.children.length === 0 &&
                        !String(parent.textContent || '').trim()
                    ) {
                        parent.remove();
                    }
                }
            }

            function enhanceShipConstruction() {
                const details = readConstructionPage();
                if (!details || details.content.querySelector('.sfux-construction-dashboard')) return;

                injectStyles();

                // The enhanced construction UI moves native form controls into the
                // dashboard, which sits outside the original <form>. Form-associated
                // elements stop submitting when they are merely moved in the DOM, so
                // bind every relocated native control back to its original form.
                // This preserves Star Fury's native POST target and payload exactly.
                if (!details.form.id) {
                    details.form.id = 'sfux-construction-native-form';
                }

                for (const control of [
                    details.submit,
                    details.fields.weapons,
                    details.fields.engine,
                    details.fields.sensors,
                    details.modeControl
                ]) {
                    if (control) control.setAttribute('form', details.form.id);
                }

                const dashboard = ctx.element('div');
                dashboard.className = 'sfux-construction-dashboard';

                const hero = ctx.element('div');
                hero.className = 'sfux-construction-hero';

                const imageCard = ctx.element('div');
                imageCard.className = 'sfux-construction-image-card';
                const imageClone = details.image.cloneNode(true);
                imageClone.removeAttribute('height');
                imageClone.removeAttribute('width');
                imageCard.appendChild(imageClone);

                const profile = ctx.element('div');
                profile.className = 'sfux-construction-profile';

                const className = ctx.element('div');
                className.className = 'sfux-construction-class';
                className.textContent = details.className || 'Ship';

                const tags = ctx.element('div');
                tags.className = 'sfux-ship-tags';

                const destinationRole = (details.destination || '')
                    .replace(/\s+dock$/i, '')
                    .trim();

                if (destinationRole) {
                    tags.appendChild(
                        createShipTag(destinationRole, shipTagClass(destinationRole))
                    );
                }

                let modeTag = null;
                if (details.modeControl) {
                    const displayedMode = modeDisplayValue(details.modeControl);
                    if (displayedMode) {
                        const kind = modeKind(displayedMode);
                        modeTag = createShipTag(
                            displayedMode,
                            kind === 'neutral' ? '' : kind
                        );
                        tags.appendChild(modeTag);
                    }
                }

                const systems = ctx.element('div');
                systems.className = 'sfux-ship-systems';
                systems.append(
                    createSystemMetric('Build Time', details.buildTime.text),
                    createSystemMetric(
                        'Power Core',
                        details.powerCore.text.replace(/\s*GW$/i, ''),
                        details.powerCore.state
                    ),
                    createSystemMetric('Maint. Cost', details.maintenance.text)
                );

                const costs = ctx.element('div');
                costs.className = 'sfux-construction-costs';
                costs.append(
                    createConstructionCost('Credits', details.cost),
                    createConstructionCost('Metal', details.metal),
                    createConstructionCost('Deuterium', details.deuterium),
                    createConstructionCost('Crew', details.crew)
                );

                if (details.iridium?.text && details.iridium.text !== '—') {
                    costs.appendChild(createConstructionCost('Iridium', details.iridium));
                }

                // Engines is compact numeric/tick data and fits the resource grid much
                // better than sharing a line with potentially very long weapon names.
                // On ships with Iridium this becomes: Iridium | Engines.
                costs.appendChild(createConstructionDetail('Engines', details.engines));

                const extra = ctx.element('div');
                extra.className = 'sfux-construction-details';
                extra.append(
                    createConstructionDetail('Weapons', details.weapons)
                );

                profile.append(className, tags, systems, costs, extra);
                hero.append(imageCard, profile);

                const lower = ctx.element('div');
                lower.className = 'sfux-construction-lower';

                const capacityPanel = ctx.element('section');
                capacityPanel.className = 'sfux-construction-panel';

                const capacityTitle = ctx.element('div');
                capacityTitle.className = 'sfux-construction-panel-title';
                capacityTitle.textContent = 'Hull / Shields';

                const capacities = ctx.element('div');
                capacities.className = 'sfux-construction-capacities';
                capacities.append(
                    createConstructionCapacity('Hull', details.hull, 'hull'),
                    createConstructionCapacity('Shields', details.shields, 'shield')
                );

                capacityPanel.append(capacityTitle, capacities);

                const combatPanel = ctx.element('section');
                combatPanel.className = 'sfux-construction-panel';

                const combatTitle = ctx.element('div');
                combatTitle.className = 'sfux-construction-panel-title';
                combatTitle.textContent = 'Base Combat';

                const combat = ctx.element('div');
                combat.className = 'sfux-construction-combat';
                combat.append(
                    createConstructionCombat('Attack', details.attack, 'attack'),
                    createConstructionCombat('Damage', details.damage, 'damage')
                );

                const combatNote = ctx.element('div');
                combatNote.className = 'sfux-construction-combat-note';
                combatNote.textContent = '100% weapons • bonuses excluded';
                combat.appendChild(combatNote);

                combatPanel.append(combatTitle, combat);
                lower.append(capacityPanel, combatPanel);

                const config = ctx.element('section');
                config.className = 'sfux-construction-config';

                const configHead = ctx.element('div');
                configHead.className = 'sfux-construction-config-head';

                const configTitle = ctx.element('div');
                configTitle.className = 'sfux-construction-config-title';
                configTitle.textContent = 'Power Distribution';

                const total = ctx.element('div');
                total.className = 'sfux-construction-total';

                configHead.append(configTitle, total);

                const powerBar = ctx.element('div');
                powerBar.className = 'sfux-construction-power-bar';

                const weaponBar = ctx.element('div');
                weaponBar.className = 'sfux-construction-power-segment sfux-construction-power-segment--weapons';

                const engineBar = ctx.element('div');
                engineBar.className = 'sfux-construction-power-segment sfux-construction-power-segment--engines';

                const sensorBar = ctx.element('div');
                sensorBar.className = 'sfux-construction-power-segment sfux-construction-power-segment--sensors';

                powerBar.append(weaponBar, engineBar, sensorBar);

                const presets = ctx.element('div');
                presets.className = 'sfux-construction-presets';

                const fullWeapons = ctx.element('button');
                fullWeapons.type = 'button';
                fullWeapons.className = 'sfux-construction-preset sfux-construction-preset--weapons';
                fullWeapons.textContent = 'Full Weapons';

                const fullSensors = ctx.element('button');
                fullSensors.type = 'button';
                fullSensors.className = 'sfux-construction-preset sfux-construction-preset--sensors';
                fullSensors.textContent = 'Full Sensors';

                presets.append(fullWeapons, fullSensors);

                const powerFields = ctx.element('div');
                powerFields.className = 'sfux-construction-power-fields';

                const isLeecher = isLeecherPowerForm(details.form);

                if (!isLeecher) {
                    powerFields.append(
                        createConstructionPowerField('Weapons', details.fields.weapons, 'weapons'),
                        createConstructionPowerField('Engines', details.fields.engine, 'engines'),
                        createConstructionPowerField('Sensors', details.fields.sensors, 'sensors')
                    );
                }

                const options = ctx.element('div');
                options.className = 'sfux-construction-options';

                if (details.modeControl) {
                    const modeBox = ctx.element('div');
                    modeBox.className = 'sfux-construction-option';

                    const modeHead = ctx.element('div');
                    modeHead.className = 'sfux-construction-option-head';

                    const modeLabel = ctx.element('span');
                    modeLabel.className = 'sfux-construction-option-label';
                    modeLabel.textContent = 'Ship Type';

                    modeHead.appendChild(modeLabel);

                    if (details.helpLink) {
                        details.helpLink.classList.add('sfux-construction-help');
                        details.helpLink.textContent = 'What is this?';
                        modeHead.appendChild(details.helpLink);
                    }

                    details.modeControl.classList.add('sfux-construction-mode-control');
                    modeBox.append(modeHead, details.modeControl);
                    options.appendChild(modeBox);
                }

                if (details.destination) {
                    const destinationBox = ctx.element('div');
                    destinationBox.className = 'sfux-construction-option';

                    const destinationHead = ctx.element('div');
                    destinationHead.className = 'sfux-construction-option-head';

                    const destinationLabel = ctx.element('span');
                    destinationLabel.className = 'sfux-construction-option-label';
                    destinationLabel.textContent = 'Destination';

                    destinationHead.appendChild(destinationLabel);

                    const destinationValue = ctx.element('div');
                    destinationValue.className = 'sfux-construction-destination';

                    const destinationRoleClass = shipTagClass(details.destination);
                    if (destinationRoleClass) {
                        destinationValue.classList.add(`sfux-ship-tag--${destinationRoleClass}`);
                    }

                    destinationValue.textContent = details.destination;

                    destinationBox.append(destinationHead, destinationValue);
                    options.appendChild(destinationBox);
                }

                const submitRow = ctx.element('div');
                submitRow.className = 'sfux-construction-submit-row';

                const validation = ctx.element('div');
                validation.className = 'sfux-construction-validation';

                details.submit.value = 'Start Construction';

                submitRow.append(validation, details.submit);

                config.append(configHead, powerBar);

                if (!isLeecher) {
                    config.append(presets, powerFields);
                } else {
                    presets.remove();
                    buildConstructionLeecherControl(details, config, syncPowerState);
                }

                config.append(options, submitRow);

                dashboard.append(hero, lower, config);
                details.content.insertBefore(dashboard, details.content.firstChild);



                function numericPower(field) {
                    return parsePercent(field?.value) ?? 0;
                }

                function syncModeState() {
                    if (!details.modeControl) return;

                    const displayedMode = modeDisplayValue(details.modeControl);
                    const kind = modeKind(displayedMode);

                    details.modeControl.classList.toggle(
                        'sfux-construction-mode-control--flexible',
                        kind === 'flexible'
                    );
                    details.modeControl.classList.toggle(
                        'sfux-construction-mode-control--fixed',
                        kind === 'fixed'
                    );

                    if (modeTag) {
                        modeTag.className = 'sfux-ship-tag';
                        if (kind !== 'neutral') {
                            modeTag.classList.add(`sfux-ship-tag--${kind}`);
                        }
                        modeTag.textContent = displayedMode;
                    }
                }

                function syncPowerState() {
                    const weapons = numericPower(details.fields.weapons);
                    const engines = numericPower(details.fields.engine);
                    const sensors = numericPower(details.fields.sensors);
                    const sum = weapons + engines + sensors;
                    const valid = sum === 100;

                    weaponBar.style.width = `${Math.min(100, weapons)}%`;
                    engineBar.style.width = `${Math.min(100, engines)}%`;
                    sensorBar.style.width = `${Math.min(100, sensors)}%`;

                    total.textContent = `${sum}% total`;
                    total.classList.remove('sfux-construction-total--valid');
                    total.classList.toggle('sfux-construction-total--invalid', !valid);

                    validation.textContent = valid
                        ? ''
                        : `Allocate exactly 100% power. Current total: ${sum}%.`;

                    validation.classList.toggle(
                        'sfux-construction-validation--invalid',
                        !valid
                    );

                    // Native submit disabled state is intentionally untouched.
                }

                function setPower(weapons, engines, sensors) {
                        setNativePowerValues(details.form, { weapons, engine: engines, sensors });
                        syncPowerState();
                    }

                if (!isLeecher) {
                    for (const field of [
                        details.fields.weapons,
                        details.fields.engine,
                        details.fields.sensors
                    ]) {
                        ctx.on(field, 'input', syncPowerState);
                        ctx.on(field, 'change', syncPowerState);
                        ctx.on(field, 'blur', () => {
                            if (field.matches(':disabled') || field.readOnly) return;
                            if (field.value === '') field.value = '0';
                            field.value = String(clampPercent(field.value));
                            syncPowerState();
                        });
                    }

                    ctx.on(fullWeapons, 'click', () => setPower(100, 0, 0));
                    ctx.on(fullSensors, 'click', () => setPower(0, 0, 100));
                }

                if (details.modeControl) {
                    ctx.on(details.modeControl, 'change', syncModeState);
                    syncModeState();
                }

                syncPowerState();

                details.imageWrap.classList.add('sfux-construction-native-hidden');
                details.statsWrap?.classList.add('sfux-construction-native-hidden');
                details.nativeConfigTable.classList.add('sfux-construction-native-hidden');

                for (const child of Array.from(details.content.children)) {
                    if (child === dashboard || child === details.form) continue;

                    if (
                        child.classList?.contains('floatClear') ||
                        child.tagName === 'BR'
                    ) {
                        child.classList.add('sfux-construction-native-hidden');
                    }
                }

                // The form must remain in the document because it owns all native
                // inputs and submission semantics. Its visible controls have been
                // moved into the dashboard above.
                details.form.classList.add('sfux-construction-form');
            }

            // ---------------------------------------------------------------------
            // Page-mode routing / bootstrap
            // ---------------------------------------------------------------------
            function main() {
                const pathname = window.location.pathname.toLowerCase();

                if (pathname === '/viewship.php') {
                    if (!getShipId()) return;

                    // Base View Ship UX is available regardless of whether this ship can
                    // currently expose the Modify Power form.
                    injectStyles();
                    rememberCurrentViewShipName();
                    SFUX.safeRun('military:rename', enhanceRenameForm);

                    // Power routing is capability/state-dependent in StarFury.
                    const form = findPowerForm();
                    if (form) {
                        if (isLeecherPowerForm(form)) {
                            SFUX.safeRun('military:leecher', () => buildLeecherPowerRouter(form));
                        } else {
                            SFUX.safeRun('military:power', () => buildPowerRouter(form));
                        }
                    }

                    // Ship Viewer data exists even when modification controls do not.
                    SFUX.safeRun('military:viewer', enhanceShipViewer);

                    // Role transfer/swap is an independent workflow and may exist even
                    // when Modify Power controls do not.
                    SFUX.safeRun('military:transfer', enhanceShipTransfer);
                    return;
                }

                if (isShipConstructionPage()) {
                    injectStyles();
                    enhanceCadetTraining();
                    enhanceShipConstruction();
                    return;
                }

                if (isStarDockOverviewPage()) {
                    enhanceStarDockOverview();
                }
            }

            return { init() { return main(); }, destroy: ctx.destroy };
        }
    });
}

const SFUX = createSFUX();
registerGlobalUX(SFUX);
registerResearchOptimizer(SFUX);
registerBuildingsUX(SFUX);
registerShipPowerRouting(SFUX);
SFUX.boot();
})();
