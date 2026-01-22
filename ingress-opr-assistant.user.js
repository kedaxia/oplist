// ==UserScript==
// @name         Ingress OPR Assistant / 审Portal助手
// @namespace    http://tampermonkey.net/
// @version      1.5.1
// @description  一键通过审核，可自定义按钮位置 (优化版)
// @author       You
// @match        https://wayfarer.nianticlabs.com/new/review
// @match        https://opr.ingress.com/new/review
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nianticlabs.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================
    // 配置和常量 (合并为单一对象减少内存)
    // ============================================
    const CONFIG = {
        storageKeys: { position: 'opr_assistant_position', scale: 'opr_assistant_scale' },
        defaultPosition: { x: 20, y: 100 },
        defaultScale: 1.0,
        scaleMin: 0.5,
        scaleMax: 2.0,
        scaleStep: 0.1,
        toastDuration: 2500,
        submitDelay: 500,
        scrollDistance: 300, // 滚动距离(像素)
        // 预编译的选择器
        cardBases: [
            "#appropriate-card", "#safe-card", "#exercise-card",
            "#explore-card", "#socialize-card", "#permanent-location-card",
            "#accurate-and-high-quality-card"
        ],
        approveSelector: "> div > div.action-buttons-row > button:nth-child(1)"
    };

    // 调试模式 - 生产环境设为 false
    const DEBUG = false;
    const log = DEBUG ? console.log.bind(console) : () => { };

    // ============================================
    // 存储工具 (简化)
    // ============================================
    const Storage = {
        get(key, defaultValue) {
            try {
                const value = GM_getValue(key);
                return value !== undefined ? JSON.parse(value) : defaultValue;
            } catch { return defaultValue; }
        },
        set(key, value) {
            GM_setValue(key, JSON.stringify(value));
        }
    };

    // ============================================
    // 添加样式 (压缩)
    // ============================================
    GM_addStyle(`
#opr-assistant-panel{position:fixed;z-index:99999;background:linear-gradient(135deg,#1a1a2e,#16213e);border:1px solid #0f3460;border-radius:12px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,.4);font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;min-width:180px;color:#e4e4e4;user-select:none;transform-origin:top left}
#opr-assistant-panel.collapsed{min-width:auto;padding:8px}
#opr-assistant-panel.collapsed .panel-content{display:none}
.opr-header{display:flex;align-items:center;justify-content:space-between;cursor:move;padding-bottom:12px;border-bottom:1px solid #0f3460;margin-bottom:12px}
#opr-assistant-panel.collapsed .opr-header{padding-bottom:0;border-bottom:none;margin-bottom:0}
.opr-title{font-size:14px;font-weight:600;color:#00d9ff;display:flex;align-items:center;gap:8px}
.opr-collapse-btn,.opr-zoom-btn{background:none;border:none;color:#888;cursor:pointer;padding:8px;transition:color .2s}
.opr-collapse-btn:hover,.opr-zoom-btn:hover{color:#00d9ff}
.opr-btn{width:100%;padding:12px 16px;margin:6px 0;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all .3s ease;display:flex;align-items:center;justify-content:center;gap:8px}
.opr-btn-approve{background:linear-gradient(135deg,#00b894,#00cec9);color:#fff}
.opr-btn-approve:hover{background:linear-gradient(135deg,#00cec9,#00b894);transform:translateY(-2px);box-shadow:0 4px 15px rgba(0,184,148,.4)}
.opr-btn-skip{background:linear-gradient(135deg,#636e72,#b2bec3);color:#fff}
.opr-btn-skip:hover{background:linear-gradient(135deg,#b2bec3,#636e72);transform:translateY(-2px);box-shadow:0 4px 15px rgba(99,110,114,.4)}
.opr-btn-photo{background:linear-gradient(135deg,#fdcb6e,#f39c12);color:#fff}
.opr-btn-photo:hover{background:linear-gradient(135deg,#f39c12,#fdcb6e);transform:translateY(-2px);box-shadow:0 4px 15px rgba(243,156,18,.4)}
.opr-toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;z-index:100000;animation:toastIn .3s ease}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    `);

    // ============================================
    // 缓存的 DOM 引用
    // ============================================
    let panelRef = null;
    let toastTimeout = null;

    // ============================================
    // 审核操作 - 核心功能 (优化)
    // ============================================
    function clickApproveButtons() {
        let clickedCount = 0;
        const { cardBases, approveSelector } = CONFIG;

        // 使用 for 循环代替 forEach (更快)
        for (let i = 0; i < cardBases.length; i++) {
            const button = document.querySelector(cardBases[i] + approveSelector);
            if (button) {
                button.click();
                clickedCount++;
                log('已点击:', cardBases[i]);
            }
        }

        // 优化 toggle 按钮选择 - 使用 CSS 选择器代替 filter
        const toggleButtons = document.querySelectorAll('button[id^="mat-button-toggle-"]');
        for (let i = 0; i < toggleButtons.length; i += 2) {
            toggleButtons[i].click();
            clickedCount++;
            log('已点击toggle:', toggleButtons[i].id);
        }

        return clickedCount;
    }

    function findButtonByText(selector, texts) {
        const buttons = document.querySelectorAll(selector);
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (texts.some(t => text === t || text.includes(t))) {
                return btn;
            }
        }
        return null;
    }

    function clickSkipButton() {
        const btn = findButtonByText('button.wf-button, button[wf-button]', ['略過', 'Skip']);
        if (btn) {
            btn.click();
            log('已点击略过按钮');
            return true;
        }
        log('未找到略过按钮');
        return false;
    }

    function clickSubmitButton() {
        const buttons = document.querySelectorAll('button.wf-button, button[wf-button]');
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if ((text === '送出' || text === 'Submit' || text.includes('送出') || text.includes('Submit')) &&
                (btn.classList.contains('wf-button--primary') || btn.classList.contains('wf-split-button__main'))) {
                btn.click();
                log('已点击送出按钮');
                return true;
            }
        }
        log('未找到送出按钮');
        return false;
    }

    function clickPhotoApprove() {
        // 先尝试文字匹配
        const photoCards = document.querySelectorAll('.photo-card__overlay');
        for (const card of photoCards) {
            const text = card.textContent || '';
            if (text.includes('所有照片均符合標準') || text.includes('All photos meet') || text.includes('所有照片')) {
                card.click();
                log('已点击照片通过选项');
                return true;
            }
        }

        // 备选：查找 check 图标
        const checkIcon = document.querySelector('.photo-card__overlay mat-icon');
        if (checkIcon?.textContent.trim() === 'check') {
            const overlay = checkIcon.closest('.photo-card__overlay');
            if (overlay) {
                overlay.click();
                log('已点击照片check图标');
                return true;
            }
        }

        log('未找到照片通过选项');
        return false;
    }

    // ============================================
    // 操作处理器 (统一延迟提交逻辑)
    // ============================================
    function delayedSubmit(successMsg) {
        setTimeout(() => {
            if (clickSubmitButton()) {
                showToast('✓ 已自动送出');
            }
        }, CONFIG.submitDelay);
    }

    function handleApprove() {
        const count = clickApproveButtons();
        if (count > 0) {
            showToast(`✓ 已勾选 ${count} 项，正在送出...`);
            delayedSubmit();
        } else {
            showToast('⚠️ 未找到可点击的按钮');
        }
    }

    function handleSkip() {
        showToast(clickSkipButton() ? '→ 已略过' : '⚠️ 未找到略过按钮');
    }

    function handlePhotoApprove() {
        if (clickPhotoApprove()) {
            showToast('📷 照片已通过，正在送出...');
            delayedSubmit();
        } else {
            showToast('⚠️ 未找到照片通过选项');
        }
    }

    function handleScrollUp() {
        scrollPage(-CONFIG.scrollDistance);
    }

    function handleScrollDown() {
        scrollPage(CONFIG.scrollDistance);
    }

    function scrollPage(distance) {
        // 尝试多种滚动目标
        const scrollTargets = [
            document.querySelector('.wf-page-content'),
            document.querySelector('mat-sidenav-content'),
            document.querySelector('.review-page'),
            document.documentElement,
            document.body
        ];

        for (const target of scrollTargets) {
            if (target && target.scrollHeight > target.clientHeight) {
                target.scrollBy({ top: distance, behavior: 'smooth' });
                log('滚动目标:', target.className || target.tagName);
                return;
            }
        }

        // 回退到 window
        window.scrollBy({ top: distance, behavior: 'smooth' });
        log('滚动: window');
    }

    // ============================================
    // UI 辅助函数 (优化)
    // ============================================
    function showToast(message) {
        // 清除现有 toast 和定时器
        if (toastTimeout) {
            clearTimeout(toastTimeout);
            toastTimeout = null;
        }

        let toast = document.querySelector('.opr-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'opr-toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;

        toastTimeout = setTimeout(() => {
            toast.remove();
            toastTimeout = null;
        }, CONFIG.toastDuration);
    }

    // ============================================
    // 主面板 (优化)
    // ============================================
    function createPanel() {
        if (panelRef) return; // 使用缓存引用检查

        const savedPosition = Storage.get(CONFIG.storageKeys.position, CONFIG.defaultPosition);
        const savedScale = Storage.get(CONFIG.storageKeys.scale, CONFIG.defaultScale);

        const panel = document.createElement('div');
        panel.id = 'opr-assistant-panel';
        panel.style.cssText = `left:${savedPosition.x}px;top:${savedPosition.y}px;transform:scale(${savedScale})`;
        panel.dataset.scale = savedScale;

        panel.innerHTML = `
            <div class="opr-header">
                <div class="opr-title"><span>🎮</span><span>OPR 助手</span></div>
                <div class="opr-controls">
                    <button class="opr-zoom-btn" data-action="zoom-out" title="缩小">-</button>
                    <button class="opr-zoom-btn" data-action="zoom-in" title="放大">+</button>
                    <button class="opr-collapse-btn" title="折叠/展开">▼</button>
                </div>
            </div>
            <div class="panel-content">
                <button class="opr-btn opr-btn-approve" data-action="approve"><span>✓</span> 一键通过</button>
                <button class="opr-btn opr-btn-photo" data-action="photo"><span>📷</span> 照片通过</button>
                <button class="opr-btn opr-btn-skip" data-action="skip"><span>→</span> 略过</button>
            </div>
        `;

        document.body.appendChild(panel);
        panelRef = panel;

        setupPanelEvents(panel);
    }

    // ============================================
    // 事件处理 (使用事件委托优化)
    // ============================================
    function setupPanelEvents(panel) {
        const header = panel.querySelector('.opr-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        // 动作处理映射
        const actions = {
            'approve': handleApprove,
            'photo': handlePhotoApprove,
            'skip': handleSkip,
            'zoom-in': () => updateScale(0.1),
            'zoom-out': () => updateScale(-0.1)
        };

        function updateScale(delta) {
            const current = parseFloat(panel.dataset.scale || 1);
            const newScale = Math.min(Math.max(current + delta, CONFIG.scaleMin), CONFIG.scaleMax);
            panel.style.transform = `scale(${newScale})`;
            panel.dataset.scale = newScale;
            Storage.set(CONFIG.storageKeys.scale, newScale);
        }

        // 使用事件委托处理所有按钮点击
        panel.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action && actions[action]) {
                e.stopPropagation();
                actions[action]();
            }

            // 折叠按钮
            if (e.target.classList.contains('opr-collapse-btn')) {
                panel.classList.toggle('collapsed');
                e.target.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
            }
        });

        // 拖拽处理
        function handleStart(clientX, clientY) {
            isDragging = true;
            startX = clientX;
            startY = clientY;
            initialX = panel.offsetLeft;
            initialY = panel.offsetTop;
        }

        function handleMove(clientX, clientY) {
            if (!isDragging) return;
            const scale = parseFloat(panel.dataset.scale || 1);
            const maxX = window.innerWidth - panel.offsetWidth * scale;
            const maxY = window.innerHeight - panel.offsetHeight * scale;

            panel.style.left = Math.max(0, Math.min(maxX, initialX + clientX - startX)) + 'px';
            panel.style.top = Math.max(0, Math.min(maxY, initialY + clientY - startY)) + 'px';
        }

        function handleEnd() {
            if (isDragging) {
                isDragging = false;
                Storage.set(CONFIG.storageKeys.position, { x: panel.offsetLeft, y: panel.offsetTop });
            }
        }

        // 鼠标事件
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            handleStart(e.clientX, e.clientY);
            document.body.style.userSelect = 'none';
        });

        // 使用单一文档级事件监听器
        document.addEventListener('mousemove', (e) => isDragging && handleMove(e.clientX, e.clientY));
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                handleEnd();
                document.body.style.userSelect = '';
            }
        });

        // 触摸事件
        header.addEventListener('touchstart', (e) => {
            if (e.target.closest('button')) return;
            handleStart(e.touches[0].clientX, e.touches[0].clientY);
            e.preventDefault();
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (isDragging) {
                handleMove(e.touches[0].clientX, e.touches[0].clientY);
                e.preventDefault();
            }
        }, { passive: false });

        document.addEventListener('touchend', handleEnd);
    }

    // ============================================
    // 键盘快捷键 (优化 - 只注册一次)
    // ============================================
    function setupKeyboardShortcuts() {
        const shortcuts = {
            'a': handleApprove, 's': handlePhotoApprove, 'd': handleSkip,
            '1': handleApprove, '2': handlePhotoApprove, '3': handleSkip,
            '8': handleScrollUp, '5': handleScrollDown
        };

        document.addEventListener('keydown', (e) => {
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            const key = e.key?.toLowerCase();

            // Alt + 键 (A/S/D)
            if (e.altKey && shortcuts[key]) {
                e.preventDefault();
                e.stopImmediatePropagation();
                shortcuts[key]();
                log('快捷键触发: Alt+' + key.toUpperCase());
                return;
            }

            // 无修饰键操作
            if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                // 数字键 (1/2/3)
                if (['1', '2', '3'].includes(key)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    shortcuts[key]();
                    log('快捷键触发:', key);
                    return;
                }
                // 数字键 8/5 上下滚动
                if (key === '8' || key === '5') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    shortcuts[key]();
                    log('滚动:', key);
                }
            }
        }, true);

        log('🎮 OPR Assistant 快捷键已注册 (Alt+A/S/D, 1/2/3, 8/5)');
    }

    // ============================================
    // 初始化 (简化)
    // ============================================
    function init() {
        if (panelRef) return; // 防止重复初始化
        createPanel();
        setupKeyboardShortcuts();
        log('🎮 OPR Assistant 已加载');
    }

    // 单一入口点 - document-idle 已确保 DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

})();
