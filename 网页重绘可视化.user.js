// ==UserScript==
// @name         网页重绘可视化
// @name:en      Page Repaint Visualizer
// @namespace    https://github.com/Micropue
// @version      1.3.0
// @description  多个虚拟 Agent 光标自动协同重绘页面元素，自动滚动，可调绘制/滚动速度，默认暂停。
// @description:en  Virtual agent cursors automatically redraw a page while it auto-scrolls. Adjustable drawing/scroll speed, paused by default.
// @author       Micropue
// @match        http://*/*
// @match        https://*/*
// @grant        none
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
    'use strict'

    if (window.PageRepaintVisualizer) {
        window.PageRepaintVisualizer.destroy()
    }

    if (!document.body) return

    // ==============================
    // 配置
    // ==============================

    const MAX_AGENTS = 64
    const MIN_SPEED = .5
    const MAX_SPEED = 3

    const MAX_OBSERVED = 8000
    const BASE_SCROLL_SPEED = 95
    const IDLE_SCROLL_SPEED = 220
    const RETARGET_COOLDOWN = 20000
    const REJECT_COOLDOWN = 4000
    const DRAW_SPEED = 760
    const REVEAL_TIME = 320

    const PALETTE = [
        ['#3ddc97', '61, 220, 151'],
        ['#7ab8ff', '122, 184, 255'],
        ['#ffc857', '255, 200, 87'],
        ['#ff8fb8', '255, 143, 184'],
        ['#b9a0ff', '185, 160, 255'],
        ['#63e3ff', '99, 227, 255'],
        ['#ffa36b', '255, 163, 107'],
        ['#8bf0c2', '139, 240, 194'],
        ['#d3b6ff', '211, 182, 255'],
        ['#ff7f9f', '255, 127, 159']
    ]

    const NAMES = [
        'Nova', 'Kai', 'Mira', 'Theo', 'Iris', 'Leo', 'Aria', 'Ren',
        'Zoe', 'Max', 'Luna', 'Eli', 'Ada', 'Neo', 'Ivy', 'Sol',
        'Yuki', 'Ravi', 'Maya', 'Finn', 'Cleo', 'Ezra', 'Nia', 'Otis',
        'Sage', 'Remy', 'Juno', 'Kian', 'Opal', 'Vera', 'Milo', 'Isla'
    ]

    const SKIP_TAGS = new Set([
        'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT',
        'TEMPLATE', 'BR', 'WBR', 'IFRAME', 'OBJECT', 'EMBED', 'SOURCE',
        'TRACK', 'PARAM', 'BASE'
    ])

    const LAYOUT_TAGS = new Set([
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'TD', 'TH',
        'DT', 'DD', 'LABEL', 'BUTTON', 'A', 'SUMMARY', 'BLOCKQUOTE',
        'FIGCAPTION'
    ])

    const MEDIA_TAGS = new Set([
        'IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'INPUT', 'TEXTAREA',
        'SELECT'
    ])

    const BOX_TAGS = new Set([
        'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV',
        'MAIN', 'UL', 'OL', 'TABLE', 'FORM', 'FIELDSET', 'FIGURE'
    ])

    const ICONS = {
        play: '<svg viewBox="0 0 16 16" aria-hidden="true">' +
            '<path d="M5 3.1v9.8L13.2 8z" fill="currentColor"/></svg>',
        pause: '<svg viewBox="0 0 16 16" aria-hidden="true">' +
            '<rect x="3.4" y="2.6" width="3.2" height="10.8" rx="1.2" ' +
            'fill="currentColor"/>' +
            '<rect x="9.4" y="2.6" width="3.2" height="10.8" rx="1.2" ' +
            'fill="currentColor"/></svg>',
        expand: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" ' +
            'stroke="currentColor" stroke-width="1.4" ' +
            'stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M2.8 6.2V2.8h3.4M9.8 2.8h3.4v3.4' +
            'M13.2 9.8v3.4H9.8M6.2 13.2H2.8V9.8"/></svg>',
        collapse: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" ' +
            'stroke="currentColor" stroke-width="1.4" ' +
            'stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M6.4 2.8v3.6H2.8M13.2 6.4H9.6V2.8' +
            'M9.6 13.2V9.6h3.6M2.8 9.6h3.6v3.6"/></svg>'
    }

    // ==============================
    // 工具函数
    // ==============================

    const clamp = (value, min, max) =>
        Math.min(max, Math.max(min, value))

    const rand = (min, max) =>
        min + Math.random() * (max - min)

    const easeInOutCubic = t => t < .5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2

    const layerFormatter = new Intl.NumberFormat('en-US')

    // ==============================
    // 创建 UI
    // ==============================

    const host = document.createElement('div')

    host.id = 'page-repaint-visualizer'

    host.style.setProperty('position', 'fixed', 'important')
    host.style.setProperty('inset', '0', 'important')
    host.style.setProperty('z-index', '2147483647', 'important')
    host.style.setProperty('pointer-events', 'none', 'important')
    host.style.setProperty('margin', '0', 'important')
    host.style.setProperty('padding', '0', 'important')
    host.style.setProperty('border', '0', 'important')

    const shadow = host.attachShadow({ mode: 'open' })

    shadow.innerHTML = `
        <style>
            :host {
                all: initial;
            }

            * {
                box-sizing: border-box;
            }

            .canvas {
                position: absolute;
                inset: 0;
                display: block;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }

            .bar {
                position: absolute;
                left: 50%;
                bottom: calc(22px + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%);
                display: flex;
                align-items: center;
                gap: 12px;
                height: 46px;
                max-width: calc(100vw - 20px);
                padding: 0 9px 0 15px;
                border: 1px solid rgba(255, 255, 255, .1);
                border-radius: 14px;
                background: rgba(14, 17, 23, .86);
                box-shadow:
                    0 16px 50px rgba(0, 0, 0, .38),
                    inset 0 1px rgba(255, 255, 255, .06);
                color: #eef2f8;
                font: 500 12px/1 -apple-system, BlinkMacSystemFont,
                    "SF Pro Text", "Segoe UI", sans-serif;
                letter-spacing: .01em;
                white-space: nowrap;
                pointer-events: auto;
                user-select: none;
                -webkit-user-select: none;
                backdrop-filter: blur(18px) saturate(150%);
                -webkit-backdrop-filter: blur(18px) saturate(150%);
            }

            .status {
                display: flex;
                align-items: center;
                gap: 7px;
                font-weight: 600;
            }

            .pulse {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #3ddc97;
                box-shadow: 0 0 0 0 rgba(61, 220, 151, .45);
                animation: pulse 2.2s ease-out infinite;
            }

            .bar[data-state="paused"] .pulse {
                background: #ffc857;
                animation: none;
                box-shadow: 0 0 8px rgba(255, 200, 87, .35);
            }

            .bar[data-state="done"] .pulse {
                background: #8b95a7;
                animation: none;
                box-shadow: none;
            }

            @keyframes pulse {
                0% {
                    box-shadow: 0 0 0 0 rgba(61, 220, 151, .45);
                }
                65% {
                    box-shadow: 0 0 0 6px rgba(61, 220, 151, 0);
                }
                100% {
                    box-shadow: 0 0 0 0 rgba(61, 220, 151, 0);
                }
            }

            .sep {
                width: 1px;
                height: 18px;
                background: rgba(255, 255, 255, .11);
            }

            .agents {
                display: flex;
                align-items: center;
                gap: 7px;
                color: #d7dee9;
                font-variant-numeric: tabular-nums;
            }

            .agents b {
                font-weight: 600;
                color: #fff;
            }

            .agent-dots {
                display: inline-flex;
                gap: 2px;
            }

            .agent-dots i {
                width: 3px;
                height: 3px;
                border-radius: 50%;
                background: #7ab8ff;
            }

            .agent-dots i:nth-child(2) {
                background: #3ddc97;
            }

            .agent-dots i:nth-child(3) {
                background: #ffc857;
            }

            .layers {
                color: #98a3b4;
                font-variant-numeric: tabular-nums;
            }

            .layers b {
                color: #e8eef8;
                font-weight: 600;
            }

            .speed {
                display: flex;
                align-items: center;
                gap: 6px;
                color: #aeb8c7;
            }

            .speed-icon {
                display: block;
                flex: 0 0 auto;
                width: 14px;
                height: 14px;
                color: #91a6c2;
            }

            .speed-range {
                --p: 20%;
                -webkit-appearance: none;
                appearance: none;
                width: 72px;
                height: 16px;
                margin: 0;
                padding: 0;
                background: transparent;
                cursor: pointer;
            }

            .speed-range::-webkit-slider-runnable-track {
                height: 3px;
                border-radius: 99px;
                background: linear-gradient(
                    90deg,
                    #7ab8ff 0 var(--p),
                    rgba(255, 255, 255, .18) var(--p) 100%
                );
            }

            .speed-range::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 10px;
                height: 10px;
                margin-top: -3.5px;
                border: 0;
                border-radius: 50%;
                background: #eaf2ff;
                box-shadow: 0 0 0 3px rgba(122, 184, 255, .16);
            }

            .speed-range::-moz-range-track {
                height: 3px;
                border-radius: 99px;
                background: rgba(255, 255, 255, .18);
            }

            .speed-range::-moz-range-progress {
                height: 3px;
                border-radius: 99px;
                background: #7ab8ff;
            }

            .speed-range::-moz-range-thumb {
                width: 10px;
                height: 10px;
                border: 0;
                border-radius: 50%;
                background: #eaf2ff;
            }

            .speed-range:focus-visible {
                outline: 1px solid rgba(122, 184, 255, .8);
                outline-offset: 4px;
                border-radius: 99px;
            }

            .speed-value {
                min-width: 30px;
                color: #e8eef8;
                font-size: 11px;
                font-variant-numeric: tabular-nums;
                text-align: right;
            }

            .icon-btn {
                display: grid;
                place-items: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border: 0;
                border-radius: 8px;
                background: transparent;
                color: #cbd4e1;
                cursor: pointer;
                transition: background .15s, color .15s;
            }

            .icon-btn:hover {
                background: rgba(255, 255, 255, .08);
                color: #fff;
            }

            .icon-btn:focus-visible {
                outline: 2px solid #7ab8ff;
                outline-offset: 1px;
            }

            .icon-btn svg {
                display: block;
                width: 14px;
                height: 14px;
            }

            .toast {
                position: absolute;
                top: calc(24px + env(safe-area-inset-top, 0px));
                left: 50%;
                padding: 10px 14px;
                border: 1px solid rgba(255, 255, 255, .12);
                border-radius: 10px;
                background: rgba(16, 19, 25, .88);
                box-shadow: 0 10px 34px rgba(0, 0, 0, .3);
                color: #e9eef6;
                font: 500 12px/1.2 -apple-system, BlinkMacSystemFont,
                    "SF Pro Text", "Segoe UI", sans-serif;
                white-space: nowrap;
                pointer-events: none;
                opacity: 0;
                transform: translate(-50%, -6px);
                transition: opacity .25s, transform .25s;
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
            }

            .toast.show {
                opacity: 1;
                transform: translate(-50%, 0);
            }

            @media (max-width: 640px) {
                .bar {
                    gap: 9px;
                    height: 42px;
                    padding: 0 7px 0 12px;
                    bottom: calc(14px + env(safe-area-inset-bottom, 0px));
                }

                .status-text,
                .layers {
                    display: none;
                }

                .speed-range {
                    width: 56px;
                }
            }

            @media (max-width: 420px) {
                .bar {
                    gap: 7px;
                    padding: 0 6px 0 10px;
                }

                .status {
                    display: none;
                }

                .speed-range {
                    width: 48px;
                }

                .speed-value {
                    min-width: 27px;
                }
            }
        </style>

        <canvas class="canvas"></canvas>

        <div class="bar" data-state="paused" role="group"
            aria-label="Page repaint controls">
            <span class="status">
                <i class="pulse"></i>
                <span class="status-text">Paused</span>
            </span>
            <span class="sep"></span>
            <div class="agents" title="Agents currently drawing">
                <span class="agent-dots"><i></i><i></i><i></i></span>
                <span class="agent-label">
                    <b class="agent-num">0</b>
                    <span class="agent-unit"> agents</span>
                </span>
            </div>
            <span class="layers">
                <b class="layer-done">0</b>
                <span> / </span>
                <span class="layer-total">0</span>
                <span> layers</span>
            </span>
            <span class="sep"></span>
            <div class="speed" title="Playback speed - drawing and scroll">
                <svg class="speed-icon" viewBox="0 0 16 16"
                    aria-hidden="true" fill="none" stroke="currentColor"
                    stroke-width="1.3" stroke-linecap="round">
                    <path d="M2.6 12a5.6 5.6 0 1 1 10.8 0"/>
                    <path d="M8 12l2.7-3"/>
                    <circle cx="8" cy="12" r=".9" fill="currentColor"
                        stroke="none"/>
                </svg>
                <input class="speed-range" type="range"
                    min="${MIN_SPEED}" max="${MAX_SPEED}" step=".1"
                    value="1" aria-label="Playback speed">
                <span class="speed-value">1.0×</span>
            </div>
            <button class="icon-btn play-btn" type="button"
                title="Pause" aria-label="Pause"></button>
            <button class="icon-btn full-btn" type="button"
                title="Fullscreen" aria-label="Fullscreen"></button>
        </div>

        <div class="toast" role="status"></div>
    `

    document.body.appendChild(host)

    const canvas = shadow.querySelector('.canvas')
    const ctx = canvas.getContext('2d')
    const bar = shadow.querySelector('.bar')
    const statusText = shadow.querySelector('.status-text')
    const agentNum = shadow.querySelector('.agent-num')
    const agentUnit = shadow.querySelector('.agent-unit')
    const layerDoneEl = shadow.querySelector('.layer-done')
    const layerTotalEl = shadow.querySelector('.layer-total')
    const speedRange = shadow.querySelector('.speed-range')
    const speedValue = shadow.querySelector('.speed-value')
    const playBtn = shadow.querySelector('.play-btn')
    const fullBtn = shadow.querySelector('.full-btn')
    const toast = shadow.querySelector('.toast')

    // ==============================
    // 状态
    // ==============================

    let cssWidth = 0
    let cssHeight = 0
    let dpr = 1

    let agents = []
    let revealed = []
    let chrome = []
    let chromeNodes = new WeakSet()
    let visible = new Set()
    let rectCache = new WeakMap()
    let recent = new WeakMap()
    let rejected = new WeakMap()
    let counted = new WeakSet()
    let paintedEls = new WeakSet()

    let totalLayers = 0
    let layerDone = 0
    let shownAgentCount = -1
    let hudDirty = true

    let veilColor = '#ffffff'
    let veilAlpha = 0
    let outro = false
    let outroAt = 0

    let playing = false
    let started = false
    let playbackSpeed = 1
    let destroyed = false
    let rafId = 0
    let lastFrame = 0
    let time = 0
    let lastHud = 0

    let scrollSpeed = 0
    let scrollCarry = 0
    let manualUntil = 0
    let bottomSince = 0
    let nextAcquire = 0

    let toastTimer = 0
    let enteredFullscreen = false

    // ==============================
    // 画布
    // ==============================

    function resizeCanvas() {
        cssWidth = window.innerWidth
        cssHeight = window.innerHeight
        dpr = Math.min(window.devicePixelRatio || 1, 2)

        canvas.width = Math.max(1, Math.round(cssWidth * dpr))
        canvas.height = Math.max(1, Math.round(cssHeight * dpr))
        canvas.style.width = cssWidth + 'px'
        canvas.style.height = cssHeight + 'px'

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        if (
            !playing &&
            time > 0 &&
            bar.dataset.state !== 'done'
        ) {
            render(time)
        }
    }

    function readPageBackground() {
        const elements = [document.body, document.documentElement]

        for (const el of elements) {
            if (!el) continue

            const color = getComputedStyle(el).backgroundColor

            if (
                color &&
                color !== 'transparent' &&
                color !== 'rgba(0, 0, 0, 0)'
            ) {
                return color
            }
        }

        const theme = document.querySelector(
            'meta[name="theme-color"]'
        )

        return theme && theme.content ? theme.content : '#ffffff'
    }

    function findChrome() {
        const found = new Set()
        const nodes = document.body.querySelectorAll('*')
        let scanned = 0

        for (const el of nodes) {
            if (++scanned > 6000) break
            if (el === host) continue
            if (SKIP_TAGS.has(el.tagName)) continue

            const rect = el.getBoundingClientRect()

            if (
                rect.width < 60 ||
                rect.height < 12 ||
                rect.bottom < 0 ||
                rect.top > window.innerHeight
            ) {
                continue
            }

            const style = getComputedStyle(el)

            if (
                style.position === 'fixed' ||
                style.position === 'sticky'
            ) {
                found.add(el)
            }
        }

        chrome = [...found]

        for (const el of chrome) {
            chromeNodes.add(el)

            for (const node of el.querySelectorAll('*')) {
                chromeNodes.add(node)
            }
        }
    }

    function drawRoundedRect(x, y, w, h, radius) {
        ctx.beginPath()
        ctx.moveTo(x + radius, y)
        ctx.arcTo(x + w, y, x + w, y + h, radius)
        ctx.arcTo(x + w, y + h, x, y + h, radius)
        ctx.arcTo(x, y + h, x, y, radius)
        ctx.arcTo(x, y, x + w, y, radius)
        ctx.closePath()
    }

    // ==============================
    // 页面扫描
    // ==============================

    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const el = entry.target

            if (!entry.isIntersecting) {
                visible.delete(el)
                continue
            }

            visible.add(el)

            const rect = entry.boundingClientRect

            rectCache.set(el, {
                x: rect.left + window.scrollX,
                y: rect.top + window.scrollY,
                w: rect.width,
                h: rect.height
            })

            if (!counted.has(el) && !chromeNodes.has(el)) {
                counted.add(el)

                if (
                    rect.width >= 16 &&
                    rect.height >= 8 &&
                    rect.width <= window.innerWidth * .95 &&
                    rect.height <= window.innerHeight * 1.1
                ) {
                    totalLayers++
                    hudDirty = true
                }
            }
        }
    }, {
        rootMargin: '15% 0px 20% 0px',
        threshold: 0
    })

    let observedCount = 0

    function shouldObserve(el) {
        if (!(el instanceof Element)) return false
        if (el === host) return false
        if (SKIP_TAGS.has(el.tagName)) return false

        if (
            el.namespaceURI === 'http://www.w3.org/2000/svg' &&
            el.ownerSVGElement
        ) {
            return false
        }

        return true
    }

    function observeTree(root) {
        if (observedCount >= MAX_OBSERVED) return
        if (!(root instanceof Element)) return

        if (shouldObserve(root)) {
            observer.observe(root)
            observedCount++
        }

        if (observedCount >= MAX_OBSERVED) return

        const nodes = root.querySelectorAll('*')

        for (const el of nodes) {
            if (observedCount >= MAX_OBSERVED) break
            if (!shouldObserve(el)) continue

            observer.observe(el)
            observedCount++
        }
    }

    const mutations = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue
                observeTree(node)
            }
        }
    })

    for (const child of document.body.children) {
        observeTree(child)
    }

    mutations.observe(document.body, {
        childList: true,
        subtree: true
    })

    // ==============================
    // 目标筛选
    // ==============================

    function hasOwnText(el) {
        for (const node of el.childNodes) {
            if (
                node.nodeType === 3 &&
                node.nodeValue &&
                node.nodeValue.trim()
            ) {
                return true
            }
        }

        return false
    }

    function isInteresting(el, style) {
        const tag = el.tagName

        if (MEDIA_TAGS.has(tag)) return true
        if (LAYOUT_TAGS.has(tag)) return true
        if (hasOwnText(el)) return true
        if (!BOX_TAGS.has(tag)) return false

        return (
            style.backgroundImage !== 'none' ||
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
            style.boxShadow !== 'none' ||
            parseFloat(style.borderTopWidth) > 0 ||
            parseFloat(style.borderRadius) > 2
        )
    }

    function hasBlockedAncestor(el) {
        let node = el.parentElement
        let depth = 0

        while (node && node !== document.body && depth++ < 8) {
            if (paintedEls.has(node)) {
                return true
            }

            if (LAYOUT_TAGS.has(node.tagName)) {
                const cached = rectCache.get(node)

                if (
                    cached &&
                    cached.w >= 18 &&
                    cached.h >= 10 &&
                    cached.w <= window.innerWidth * .94 &&
                    cached.h <= window.innerHeight * .62 &&
                    cached.w * cached.h <=
                        window.innerWidth * window.innerHeight * .55
                ) {
                    return true
                }
            }

            node = node.parentElement
        }

        return false
    }

    function measure(el) {
        if (chromeNodes.has(el)) return null
        if (hasBlockedAncestor(el)) return null

        const rect = el.getBoundingClientRect()

        if (
            rect.width < 18 ||
            rect.height < 10 ||
            rect.width > window.innerWidth * .94 ||
            rect.height > window.innerHeight * .62 ||
            rect.width * rect.height > window.innerWidth *
                window.innerHeight * .55
        ) {
            return null
        }

        if (
            rect.bottom < 8 ||
            rect.top > window.innerHeight - 8 ||
            rect.right < 8 ||
            rect.left > window.innerWidth - 8
        ) {
            return null
        }

        const style = getComputedStyle(el)

        if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.visibility === 'collapse' ||
            parseFloat(style.opacity) < .05
        ) {
            return null
        }

        if (style.position === 'fixed' || style.position === 'sticky') {
            return null
        }

        if (!isInteresting(el, style)) return null

        const speed = DRAW_SPEED * rand(.8, 1.2)
        const perimeter = 2 * (rect.width + rect.height)

        return {
            el,
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            w: rect.width,
            h: rect.height,
            perimeter,
            duration: clamp(perimeter / speed * 1000, 420, 3600)
        }
    }

    function pickTarget(now) {
        const scrollX = window.scrollX
        const scrollY = window.scrollY
        const top = scrollY + window.innerHeight * .04
        const bottom = scrollY + window.innerHeight * .92

        for (let attempt = 0; attempt < 3; attempt++) {
            let chosen = null
            let chosenScore = -Infinity
            let scanned = 0

            for (const el of visible) {
                if (++scanned > 500) break
                if (chromeNodes.has(el)) continue
                if (recent.get(el) > now - RETARGET_COOLDOWN) continue
                if (rejected.get(el) > now - REJECT_COOLDOWN) continue

                const cached = rectCache.get(el)

                if (!cached) continue
                if (cached.w < 18 || cached.h < 10) continue
                if (cached.w > window.innerWidth * .94) continue
                if (cached.h > window.innerHeight * .62) continue
                if (cached.y + cached.h < top) continue
                if (cached.y > bottom) continue
                if (cached.x + cached.w < scrollX) continue
                if (cached.x > scrollX + window.innerWidth) continue

                const score = Math.random() +
                    (1 - (cached.y - scrollY) / window.innerHeight) * .55

                if (score > chosenScore) {
                    chosenScore = score
                    chosen = el
                }
            }

            if (!chosen) return null

            const target = measure(chosen)

            if (target) {
                recent.set(chosen, now)
                return target
            }

            rejected.set(chosen, now)
        }

        return null
    }

    // ==============================
    // Agent
    // ==============================

    function createAgent(index) {
        const palette = PALETTE[index % PALETTE.length]

        return {
            index,
            name: NAMES[index] || ('A' + (index + 1)),
            color: palette[0],
            rgb: palette[1],

            x: window.scrollX + rand(.12, .88) * window.innerWidth,
            y: window.scrollY + rand(.16, .84) * window.innerHeight,

            alpha: 0,
            state: 'idle',
            target: null,
            progress: 0,
            phaseAt: 0,
            travelDur: 0,
            travelX: 0,
            travelY: 0,
            duration: 0,
            labelWidth: 0,

            trail: []
        }
    }

    function countActiveAgents() {
        let count = 0

        for (const agent of agents) {
            if (agent.target) count++
        }

        return count
    }

    function getIdleAgent() {
        for (const agent of agents) {
            if (!agent.target) return agent
        }

        if (agents.length >= MAX_AGENTS) return null

        const agent = createAgent(agents.length)

        agents.push(agent)

        return agent
    }

    function updateAgentLabel(count) {
        agentNum.textContent = count
        agentUnit.textContent = count === 1 ? ' agent' : ' agents'
    }

    function refreshAgentCount() {
        const active = countActiveAgents()

        if (active === shownAgentCount) return

        shownAgentCount = active
        updateAgentLabel(active)
    }

    function assignTarget(agent, target, now) {
        agent.target = target
        agent.state = 'travel'
        agent.phaseAt = now
        agent.progress = 0
        agent.travelX = agent.x
        agent.travelY = agent.y
        agent.trail.length = 0

        const distance = Math.hypot(target.x - agent.x, target.y - agent.y)

        agent.travelDur = clamp(distance / 2.4, 150, 720)
        agent.duration = target.duration
    }

    function completeTarget(agent, now) {
        const target = agent.target

        paintedEls.add(target.el)

        for (const other of agents) {
            if (!other.target) continue
            if (other.target.el === target.el) continue
            if (!target.el.contains(other.target.el)) continue

            recent.set(other.target.el, now)

            other.target = null
            other.state = 'idle'
            other.progress = 0
            other.trail.length = 0
        }

        revealed.push({
            x: target.x,
            y: target.y,
            w: target.w,
            h: target.h,
            at: now
        })

        layerDone++
        hudDirty = true

        recent.set(target.el, now)

        agent.target = null
        agent.state = 'idle'
        agent.progress = 0
        agent.trail.length = 0

        refreshAgentCount()
    }

    function autoAssign(now) {
        if (now < nextAcquire) return

        nextAcquire = now + 90

        let active = countActiveAgents()
        let attempts = 0

        while (attempts < 6 && active < MAX_AGENTS) {
            const agent = getIdleAgent()

            if (!agent) break

            const target = pickTarget(now)

            if (!target) break

            assignTarget(agent, target, now)
            active++
            attempts++
        }

        refreshAgentCount()
    }

    function pointOnPerimeter(target, progress) {
        const perimeter = target.perimeter
        let distance = clamp(progress, 0, 1) * perimeter

        if (distance <= target.w) {
            return { x: target.x + distance, y: target.y }
        }

        distance -= target.w

        if (distance <= target.h) {
            return { x: target.x + target.w, y: target.y + distance }
        }

        distance -= target.h

        if (distance <= target.w) {
            return {
                x: target.x + target.w - distance,
                y: target.y + target.h
            }
        }

        distance -= target.w

        return {
            x: target.x,
            y: target.y + target.h - distance
        }
    }

    function advanceAgent(agent, dt, now) {
        if (!agent.target) return

        if (agent.state === 'travel') {
            const p = clamp((now - agent.phaseAt) / agent.travelDur, 0, 1)
            const eased = easeInOutCubic(p)

            agent.x = agent.travelX +
                (agent.target.x - agent.travelX) * eased
            agent.y = agent.travelY +
                (agent.target.y - agent.travelY) * eased

            if (p >= 1) {
                agent.state = 'trace'
                agent.phaseAt = now
                agent.trail.length = 0
            }

            return
        }

        const p = clamp((now - agent.phaseAt) / agent.duration, 0, 1)
        const point = pointOnPerimeter(agent.target, p)
        const follow = 1 - Math.exp(-dt * 26)

        agent.progress = p
        agent.x += (point.x - agent.x) * follow
        agent.y += (point.y - agent.y) * follow

        if (p >= 1) {
            agent.x = point.x
            agent.y = point.y
            completeTarget(agent, now)
        }
    }

    function pushTrail(agent) {
        const trail = agent.trail
        const last = trail[trail.length - 1]

        if (
            !last ||
            Math.abs(agent.x - last.x) + Math.abs(agent.y - last.y) > 1.5
        ) {
            trail.push({ x: agent.x, y: agent.y })

            if (trail.length > 8) {
                trail.shift()
            }
        }
    }

    // ==============================
    // 自动滚动
    // ==============================

    function updateScroll(now, dt) {
        if (now < manualUntil) {
            scrollSpeed = 0
            scrollCarry = 0
            return
        }

        const doc = document.scrollingElement || document.documentElement
        const remain = doc.scrollHeight - window.innerHeight - window.scrollY

        if (remain <= 1) {
            if (!bottomSince) bottomSince = now
            scrollSpeed = 0
            scrollCarry = 0
            return
        }

        bottomSince = 0

        const active = countActiveAgents()
        const desired = active > 0
            ? BASE_SCROLL_SPEED
            : IDLE_SCROLL_SPEED

        scrollSpeed += (desired - scrollSpeed) *
            (1 - Math.exp(-dt * 2.2))

        scrollCarry += scrollSpeed * dt

        if (scrollCarry < .6) return

        const distance = Math.min(scrollCarry, remain)

        scrollCarry = 0

        window.scrollBy({
            top: distance,
            left: 0,
            behavior: 'instant'
        })
    }

    // ==============================
    // 绘制
    // ==============================

    function traceOutline(x, y, w, h, progress) {
        const segments = [
            [x, y, x + w, y],
            [x + w, y, x + w, y + h],
            [x + w, y + h, x, y + h],
            [x, y + h, x, y]
        ]

        let remain = 2 * (w + h) * clamp(progress, 0, 1)

        ctx.beginPath()
        ctx.moveTo(x, y)

        for (const segment of segments) {
            const [x1, y1, x2, y2] = segment
            const length = Math.abs(x2 - x1) + Math.abs(y2 - y1)

            if (remain >= length) {
                ctx.lineTo(x2, y2)
                remain -= length
                continue
            }

            const t = length ? remain / length : 0

            ctx.lineTo(
                x1 + (x2 - x1) * t,
                y1 + (y2 - y1) * t
            )

            break
        }

        ctx.stroke()
    }

    function drawHandle(x, y) {
        ctx.fillStyle = 'rgba(241, 247, 255, 1)'
        ctx.strokeStyle = 'rgba(91, 151, 255, 1)'
        ctx.lineWidth = 1
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
        ctx.strokeRect(x - 2.5, y - 2.5, 5, 5)
    }

    function drawSelection(box, progress, agent) {
        const x = box.x - window.scrollX
        const y = box.y - window.scrollY
        const w = box.w
        const h = box.h

        if (x > cssWidth + 8 || y > cssHeight + 8) return
        if (x + w < -8 || y + h < -8) return

        ctx.save()

        ctx.shadowColor = 'rgba(64, 132, 255, .35)'
        ctx.shadowBlur = 6
        ctx.lineWidth = 1.25
        ctx.strokeStyle = 'rgba(133, 187, 255, .92)'

        traceOutline(x, y, w, h, progress)

        ctx.shadowBlur = 0

        const perimeter = 2 * (w + h)
        const traveled = clamp(progress, 0, 1) * perimeter
        const cornerDistance = [0, w, w + h, 2 * w + h]
        const corners = [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h]
        ]

        for (let i = 0; i < corners.length; i++) {
            if (traveled < cornerDistance[i] + .5) continue

            drawHandle(corners[i][0], corners[i][1])
        }

        const point = pointOnPerimeter({
            x,
            y,
            w,
            h,
            perimeter
        }, progress)

        if (agent) {
            ctx.fillStyle = agent.color
            ctx.strokeStyle = 'rgba(255, 255, 255, .85)'
            ctx.lineWidth = .8
            ctx.beginPath()
            ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }

        if (w >= 44 && h >= 18) {
            const label = Math.round(w) + ' × ' + Math.round(h)
            const labelX = clamp(x, 2, Math.max(2, cssWidth - 72))
            const labelY = y > 14 ? y - 5 : y + h + 11

            ctx.font = '500 9px ui-monospace, SFMono-Regular, ' +
                'Menlo, Consolas, monospace'
            ctx.textBaseline = 'alphabetic'
            ctx.fillStyle = 'rgba(178, 211, 255, .82)'
            ctx.fillText(label, labelX, labelY)
        }

        ctx.restore()
    }

    function drawTrail(agent) {
        const trail = agent.trail

        if (agent.state !== 'trace' || trail.length < 2) return

        ctx.save()
        ctx.lineWidth = 1.3
        ctx.lineCap = 'round'

        for (let i = 1; i < trail.length; i++) {
            const t = i / trail.length
            const alpha = t * .28

            ctx.strokeStyle = 'rgba(' + agent.rgb + ', ' + alpha + ')'
            ctx.beginPath()
            ctx.moveTo(
                trail[i - 1].x - window.scrollX,
                trail[i - 1].y - window.scrollY
            )
            ctx.lineTo(
                trail[i].x - window.scrollX,
                trail[i].y - window.scrollY
            )
            ctx.stroke()
        }

        ctx.restore()
    }

    function drawCursor(agent) {
        if (agent.alpha <= .01) return

        const x = agent.x - window.scrollX
        const y = agent.y - window.scrollY

        if (x < -40 || y < -40) return
        if (x > cssWidth + 40 || y > cssHeight + 40) return

        const active = !!agent.target

        ctx.save()
        ctx.globalAlpha = agent.alpha

        if (active) {
            const label = agent.name
            const labelHeight = 15
            const labelPadding = 5

            ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, ' +
                '"SF Pro Text", "Segoe UI", sans-serif'
            ctx.textBaseline = 'middle'

            if (!agent.labelWidth) {
                agent.labelWidth = ctx.measureText(label).width +
                    labelPadding * 2
            }

            const labelWidth = agent.labelWidth
            const labelX = x + 12
            const labelY = y + 13

            ctx.fillStyle = agent.color
            drawRoundedRect(labelX, labelY, labelWidth, labelHeight, 4)
            ctx.fill()

            ctx.fillStyle = 'rgba(9, 16, 28, .92)'
            ctx.fillText(
                label,
                labelX + labelPadding,
                labelY + labelHeight / 2 + .5
            )
        }

        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + 16)
        ctx.lineTo(x + 3.6, y + 12.4)
        ctx.lineTo(x + 6.3, y + 18.3)
        ctx.lineTo(x + 8.6, y + 17.3)
        ctx.lineTo(x + 5.9, y + 11.5)
        ctx.lineTo(x + 11, y + 11.5)
        ctx.closePath()

        ctx.fillStyle = '#f5f9ff'
        ctx.strokeStyle = 'rgba(5, 10, 18, .62)'
        ctx.lineWidth = 1
        ctx.shadowColor = 'rgba(0, 0, 0, .3)'
        ctx.shadowBlur = 4
        ctx.shadowOffsetY = 1
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.shadowOffsetY = 0
        ctx.stroke()

        ctx.restore()
    }

    function drawVeil(now) {
        ctx.save()

        ctx.globalAlpha = veilAlpha
        ctx.fillStyle = veilColor
        ctx.fillRect(0, 0, cssWidth, cssHeight)
        ctx.globalAlpha = 1

        ctx.globalCompositeOperation = 'destination-out'

        const scrollX = window.scrollX
        const scrollY = window.scrollY

        for (const hole of revealed) {
            const x = hole.x - scrollX
            const y = hole.y - scrollY

            if (x > cssWidth || y > cssHeight) continue
            if (x + hole.w < 0 || y + hole.h < 0) continue

            const age = now - hole.at

            if (age < REVEAL_TIME) {
                const p = clamp(age / REVEAL_TIME, 0, 1)
                ctx.globalAlpha = 1 - Math.pow(1 - p, 3)
            } else {
                ctx.globalAlpha = 1
            }

            ctx.fillRect(x, y, hole.w, hole.h)
        }

        ctx.globalAlpha = 1

        for (const el of chrome) {
            if (!el.isConnected) continue

            const rect = el.getBoundingClientRect()

            if (rect.width < 1 || rect.height < 1) continue

            ctx.fillRect(rect.left, rect.top, rect.width, rect.height)
        }

        ctx.restore()
    }

    function render(now) {
        ctx.clearRect(0, 0, cssWidth, cssHeight)

        if (veilAlpha > .001) {
            drawVeil(now)
        }

        for (const agent of agents) {
            if (!agent.target || agent.progress <= 0) continue
            drawSelection(agent.target, agent.progress, agent)
        }

        for (const agent of agents) {
            drawTrail(agent)
        }

        for (const agent of agents) {
            drawCursor(agent)
        }
    }

    // ==============================
    // HUD 与播放状态
    // ==============================

    function updateHud(now) {
        if (now - lastHud < 160) return

        lastHud = now

        const active = countActiveAgents()

        if (active !== shownAgentCount) {
            shownAgentCount = active
            updateAgentLabel(active)
        }

        if (!hudDirty) return

        hudDirty = false

        layerDoneEl.textContent = layerFormatter.format(layerDone)
        layerTotalEl.textContent =
            layerFormatter.format(Math.max(totalLayers, layerDone))
    }

    function setSpeed(value) {
        playbackSpeed = clamp(Number(value) || 1, MIN_SPEED, MAX_SPEED)

        speedValue.textContent = playbackSpeed.toFixed(1) + '×'
        speedRange.value = playbackSpeed
        speedRange.style.setProperty(
            '--p',
            ((playbackSpeed - MIN_SPEED) /
                (MAX_SPEED - MIN_SPEED) * 100) + '%'
        )
    }

    function setBarState(state) {
        bar.dataset.state = state

        statusText.textContent = state === 'playing'
            ? 'Playing'
            : state === 'paused' ? 'Paused' : 'Done'

        const playingNow = state === 'playing'

        playBtn.innerHTML = playingNow ? ICONS.pause : ICONS.play
        playBtn.title = playingNow ? 'Pause' : 'Play'
        playBtn.setAttribute(
            'aria-label',
            playingNow ? 'Pause visualization' : 'Play visualization'
        )
    }

    function startOutro() {
        outro = true
        outroAt = time
        setBarState('done')
    }

    function frame(now) {
        if (destroyed || !playing) return

        const dt = (lastFrame
            ? Math.min(.05, (now - lastFrame) / 1000)
            : 0) * playbackSpeed

        lastFrame = now
        time += dt * 1000

        if (outro) {
            const p = clamp((time - outroAt) / 900, 0, 1)

            veilAlpha = 1 - easeInOutCubic(p)

            render(time)
            updateHud(time)

            if (p >= 1) {
                playing = false
                rafId = 0
                ctx.clearRect(0, 0, cssWidth, cssHeight)
                return
            }

            rafId = requestAnimationFrame(frame)
            return
        }

        autoAssign(time)
        updateScroll(time, dt)

        for (const agent of agents) {
            if (agent.target) {
                advanceAgent(agent, dt, time)
            }

            const targetAlpha = agent.target ? 1 : 0

            agent.alpha += (targetAlpha - agent.alpha) *
                (1 - Math.exp(-dt * 9))

            if (agent.state === 'trace') {
                pushTrail(agent)
            }
        }

        render(time)
        updateHud(time)

        if (
            bottomSince &&
            time - bottomSince > 1800 &&
            agents.every(agent => !agent.target)
        ) {
            startOutro()
        }

        rafId = requestAnimationFrame(frame)
    }

    function resume() {
        if (destroyed) return

        if (bar.dataset.state === 'done') {
            restart()
            return
        }

        if (playing) return

        if (!started) {
            startSession()
            return
        }

        playing = true
        lastFrame = 0
        setBarState('playing')
        rafId = requestAnimationFrame(frame)
    }

    function startSession() {
        started = true

        for (const agent of agents) {
            agent.target = null
            agent.state = 'idle'
            agent.progress = 0
            agent.alpha = 0
            agent.trail.length = 0
        }

        revealed.length = 0
        recent = new WeakMap()
        rejected = new WeakMap()
        paintedEls = new WeakSet()
        layerDone = 0
        hudDirty = true
        shownAgentCount = 0
        updateAgentLabel(0)

        scrollSpeed = 0
        scrollCarry = 0
        manualUntil = 0
        bottomSince = 0
        nextAcquire = 0
        outro = false
        outroAt = 0
        time = 0
        veilAlpha = 1

        lastHud = 0
        render(0)

        playing = true
        lastFrame = 0
        setBarState('playing')
        rafId = requestAnimationFrame(frame)
    }

    function pause() {
        if (!playing) return

        playing = false
        cancelAnimationFrame(rafId)
        rafId = 0

        setBarState('paused')
    }

    function togglePlayback() {
        if (playing && bar.dataset.state !== 'done') {
            pause()
        } else {
            resume()
        }
    }

    function restart() {
        started = true
        playing = false
        cancelAnimationFrame(rafId)
        rafId = 0

        for (const agent of agents) {
            agent.target = null
            agent.state = 'idle'
            agent.progress = 0
            agent.alpha = 0
            agent.trail.length = 0
        }

        window.scrollTo({ top: 0, left: 0, behavior: 'instant' })

        for (const agent of agents) {
            agent.x = window.scrollX + rand(.12, .88) * window.innerWidth
            agent.y = window.scrollY + rand(.16, .84) * window.innerHeight
        }

        revealed.length = 0
        recent = new WeakMap()
        rejected = new WeakMap()
        paintedEls = new WeakSet()
        layerDone = 0
        hudDirty = true
        shownAgentCount = 0
        updateAgentLabel(0)

        scrollSpeed = 0
        scrollCarry = 0
        manualUntil = 0
        bottomSince = 0
        nextAcquire = 0

        veilAlpha = 1
        outro = false
        outroAt = 0

        render(time)

        playing = true
        lastFrame = 0
        setBarState('playing')

        rafId = requestAnimationFrame(frame)
    }

    // ==============================
    // 全屏
    // ==============================

    function showToast(text) {
        toast.textContent = text
        toast.classList.add('show')

        clearTimeout(toastTimer)

        toastTimer = setTimeout(() => {
            toast.classList.remove('show')
        }, 2600)
    }

    function updateFullscreenButton() {
        const active = !!document.fullscreenElement

        fullBtn.innerHTML = active ? ICONS.collapse : ICONS.expand
        fullBtn.title = active ? 'Exit fullscreen' : 'Fullscreen'
        fullBtn.setAttribute(
            'aria-label',
            active ? 'Exit fullscreen' : 'Enter fullscreen'
        )
    }

    async function toggleFullscreen() {
        try {
            if (document.fullscreenElement) {
                enteredFullscreen = false
                await document.exitFullscreen()
                return
            }

            await document.body.requestFullscreen()
            enteredFullscreen = true
        } catch (error) {
            console.warn('[Repaint] 全屏失败:', error)
            showToast('Fullscreen is not available')
        }
    }

    function handleFullscreenChange() {
        updateFullscreenButton()

        if (document.fullscreenElement) {
            showToast('Press Esc to exit fullscreen')
        } else {
            enteredFullscreen = false
            clearTimeout(toastTimer)
            toast.classList.remove('show')
        }

        requestAnimationFrame(resizeCanvas)
    }

    // ==============================
    // 事件
    // ==============================

    function markManual() {
        manualUntil = time + 2400
        scrollSpeed = 0
        scrollCarry = 0
    }

    function handleWheel() {
        markManual()
    }

    function handleTouchMove() {
        markManual()
    }

    function handleKeydown(event) {
        const keys = [
            'PageDown', 'PageUp', 'Home', 'End',
            'ArrowDown', 'ArrowUp', ' '
        ]

        if (keys.includes(event.key)) {
            markManual()
        }
    }

    function handleResize() {
        resizeCanvas()
    }

    function handleScroll() {
        if (
            !playing &&
            !destroyed &&
            time > 0 &&
            bar.dataset.state !== 'done'
        ) {
            render(time)
        }
    }

    playBtn.addEventListener('click', togglePlayback)
    fullBtn.addEventListener('click', toggleFullscreen)
    speedRange.addEventListener('input', () => {
        setSpeed(speedRange.value)
    })

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('wheel', handleWheel, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('keydown', handleKeydown)
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    for (const type of [
        'pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu',
        'input', 'keydown'
    ]) {
        bar.addEventListener(type, event => {
            event.stopPropagation()
        })
    }

    // ==============================
    // 初始化
    // ==============================

    veilColor = readPageBackground()
    findChrome()
    resizeCanvas()
    setSpeed(1)
    updateFullscreenButton()
    updateHud(0)
    updateAgentLabel(0)
    setBarState('paused')

    playing = false
    started = false

    // ==============================
    // 对外 API
    // ==============================

    function destroy() {
        if (destroyed) return

        destroyed = true
        playing = false

        cancelAnimationFrame(rafId)
        clearTimeout(toastTimer)

        observer.disconnect()
        mutations.disconnect()

        window.removeEventListener('resize', handleResize)
        window.removeEventListener('scroll', handleScroll)
        window.removeEventListener('wheel', handleWheel)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('keydown', handleKeydown)
        document.removeEventListener(
            'fullscreenchange',
            handleFullscreenChange
        )

        if (enteredFullscreen && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
        }

        host.remove()

        delete window.PageRepaintVisualizer
    }

    window.PageRepaintVisualizer = {
        play: resume,
        pause,
        toggle: togglePlayback,
        setSpeed,
        destroy,

        get playing() {
            return playing
        },

        get speed() {
            return playbackSpeed
        },

        get agentCount() {
            return countActiveAgents()
        },

        get drawnLayers() {
            return layerDone
        },

        get totalLayers() {
            return totalLayers
        }
    }

    console.log('[Repaint] 已安装（默认暂停）')
    console.log('播放/暂停：PageRepaintVisualizer.toggle()')
    console.log('绘制/滚动速度：PageRepaintVisualizer.setSpeed(2)')
    console.log('Agent 数量会根据当前工作量自动分配')
    console.log('卸载：PageRepaintVisualizer.destroy()')
})()
