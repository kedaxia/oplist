// ==UserScript==
// @name         Ingress OPR Assistant / 审Portal助手
// @namespace    http://tampermonkey.net/
// @version      1.4.1
// @description  一键通过审核，可自定义按钮位置
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
    // 配置和存储
    // ============================================
    const CONFIG = {
        storageKeys: {
            position: 'opr_assistant_position',
            scale: 'opr_assistant_scale'
        },
        defaultPosition: { x: 20, y: 100 },
        defaultScale: 1.0
    };

    // 评分卡片的基础选择器
    const CARD_BASES = [
        "#appropriate-card",
        "#safe-card",
        "#exercise-card",
        "#explore-card",
        "#socialize-card",
        "#permanent-location-card",
        "#accurate-and-high-quality-card"
    ];

    // 通用选择器部分 - 选择第一个按钮（通过）
    const APPROVE_SELECTOR = "> div > div.action-buttons-row > button:nth-child(1)";

    // ============================================
    // 工具函数
    // ============================================
    function getStorage(key, defaultValue) {
        try {
            const value = GM_getValue(key);
            return value !== undefined ? JSON.parse(value) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }

    function setStorage(key, value) {
        GM_setValue(key, JSON.stringify(value));
    }

    // ============================================
    // 添加样式
    // ============================================
    GM_addStyle(`
        #opr-assistant-panel {
            position: fixed;
            z-index: 99999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #0f3460;
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            min-width: 180px;
            color: #e4e4e4;
            user-select: none;
            transform-origin: top left;
        }

        #opr-assistant-panel.collapsed {
            min-width: auto;
            padding: 8px;
        }

        #opr-assistant-panel.collapsed .panel-content {
            display: none;
        }

        .opr-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: move;
            padding-bottom: 12px;
            border-bottom: 1px solid #0f3460;
            margin-bottom: 12px;
        }

        #opr-assistant-panel.collapsed .opr-header {
            padding-bottom: 0;
            border-bottom: none;
            margin-bottom: 0;
        }

        .opr-title {
            font-size: 14px;
            font-weight: 600;
            color: #00d9ff;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .opr-collapse-btn {
            background: none;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 16px;
            padding: 4px 8px;
            transition: color 0.2s;
        }

        .opr-zoom-btn {
            background: none;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 14px;
            padding: 8px; /* 增大点击区域 */
            margin-right: 4px;
            transition: color 0.2s;
        }

        .opr-zoom-btn:hover { color: #00d9ff; }

        .opr-collapse-btn:hover {
            color: #00d9ff;
        }

        .opr-btn {
            width: 100%;
            padding: 12px 16px;
            margin: 6px 0;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .opr-btn-approve {
            background: linear-gradient(135deg, #00b894 0%, #00cec9 100%);
            color: white;
        }

        .opr-btn-approve:hover {
            background: linear-gradient(135deg, #00cec9 0%, #00b894 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0, 184, 148, 0.4);
        }

        .opr-btn-skip {
            background: linear-gradient(135deg, #636e72 0%, #b2bec3 100%);
            color: white;
        }

        .opr-btn-skip:hover {
            background: linear-gradient(135deg, #b2bec3 0%, #636e72 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(99, 110, 114, 0.4);
        }

        .opr-btn-submit {
            background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
            color: white;
        }

        .opr-btn-submit:hover {
            background: linear-gradient(135deg, #a29bfe 0%, #6c5ce7 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(108, 92, 231, 0.4);
        }

        .opr-btn-photo {
            background: linear-gradient(135deg, #fdcb6e 0%, #f39c12 100%);
            color: white;
        }

        .opr-btn-photo:hover {
            background: linear-gradient(135deg, #f39c12 0%, #fdcb6e 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(243, 156, 18, 0.4);
        }

        .opr-toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 100000;
            animation: toastIn 0.3s ease;
        }

        @keyframes toastIn {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
    `);

    // ============================================
    // 审核操作 - 核心功能
    // ============================================
    function clickApproveButtons() {
        let clickedCount = 0;

        // 点击所有卡片的第一个按钮（通过）
        CARD_BASES.forEach(function (base) {
            const selector = base + APPROVE_SELECTOR;
            const button = document.querySelector(selector);
            if (button) {
                button.click();
                clickedCount++;
                console.log("已点击: " + selector);
            } else {
                console.log("未找到按钮: " + selector);
            }
        });

        // 点击所有 toggle 按钮（偶数索引的）
        const toggleButtons = Array.from(document.querySelectorAll('button[id^="mat-button-toggle-"]'))
            .filter((button, index) => index % 2 === 0);

        toggleButtons.forEach(function (btn) {
            btn.click();
            clickedCount++;
            console.log("已点击toggle: " + btn.id);
        });

        return clickedCount;
    }

    function clickSkipButton() {
        // 遍历查找包含"略過"或"Skip"文字的按钮
        const allButtons = document.querySelectorAll('button.wf-button, button[wf-button]');
        for (const btn of allButtons) {
            const text = btn.textContent.trim();
            if (text === '略過' || text === 'Skip' || text.includes('略過') || text.includes('Skip')) {
                btn.click();
                console.log('已点击略过按钮: ' + text);
                return true;
            }
        }

        console.log('未找到略过按钮');
        return false;
    }

    function handleApprove() {
        const count = clickApproveButtons();
        if (count > 0) {
            showToast(`✓ 已勾选 ${count} 项，正在送出...`);
            // 延迟送出，等待页面响应
            setTimeout(() => {
                const submitted = clickSubmitButton();
                if (submitted) {
                    showToast('✓ 已自动送出');
                }
            }, 500);
        } else {
            showToast('⚠️ 未找到可点击的按钮');
        }
    }

    function handleSkip() {
        const success = clickSkipButton();
        if (success) {
            showToast('→ 已略过');
        } else {
            showToast('⚠️ 未找到略过按钮');
        }
    }

    function clickPhotoApprove() {
        // 查找"所有照片均符合標準"的元素并点击
        const photoCards = document.querySelectorAll('.photo-card__overlay');
        for (const card of photoCards) {
            const text = card.textContent || '';
            if (text.includes('所有照片均符合標準') || text.includes('All photos meet') || text.includes('所有照片')) {
                card.click();
                console.log('已点击照片通过选项');
                return true;
            }
        }

        // 备选：查找包含check图标的卡片
        const checkIcons = document.querySelectorAll('.photo-card__overlay mat-icon');
        for (const icon of checkIcons) {
            if (icon.textContent.trim() === 'check') {
                const overlay = icon.closest('.photo-card__overlay');
                if (overlay) {
                    overlay.click();
                    console.log('已点击照片check图标');
                    return true;
                }
            }
        }

        console.log('未找到照片通过选项');
        return false;
    }

    function handlePhotoApprove() {
        const success = clickPhotoApprove();
        if (success) {
            showToast('📷 照片已通过，正在送出...');
            // 延迟送出
            setTimeout(() => {
                const submitted = clickSubmitButton();
                if (submitted) {
                    showToast('✓ 已自动送出');
                }
            }, 500);
        } else {
            showToast('⚠️ 未找到照片通过选项');
        }
    }

    function clickSubmitButton() {
        // 查找送出按钮
        const allButtons = document.querySelectorAll('button.wf-button, button[wf-button]');
        for (const btn of allButtons) {
            const text = btn.textContent.trim();
            // 检查是否是主要的送出按钮
            if ((text === '送出' || text === 'Submit' || text.includes('送出') || text.includes('Submit')) &&
                (btn.classList.contains('wf-button--primary') || btn.classList.contains('wf-split-button__main'))) {
                btn.click();
                console.log('已点击送出按钮: ' + text);
                return true;
            }
        }
        console.log('未找到送出按钮');
        return false;
    }

    function handleSubmit() {
        const success = clickSubmitButton();
        if (success) {
            showToast('✓ 已送出');
        } else {
            showToast('⚠️ 未找到送出按钮');
        }
    }

    // ============================================
    // 主面板
    // ============================================
    function createPanel() {
        // 避免重复创建
        if (document.getElementById('opr-assistant-panel')) return;

        const savedPosition = getStorage(CONFIG.storageKeys.position, CONFIG.defaultPosition);

        const panel = document.createElement('div');
        panel.id = 'opr-assistant-panel';
        panel.style.left = savedPosition.x + 'px';
        panel.style.top = savedPosition.y + 'px';

        panel.innerHTML = `
            <div class="opr-header">
                <div class="opr-title">
                    <span>🎮</span>
                    <span>OPR 助手</span>
                </div>
                <div class="opr-controls">
                    <button class="opr-zoom-btn" id="btn-zoom-out" title="缩小">-</button>
                    <button class="opr-zoom-btn" id="btn-zoom-in" title="放大">+</button>
                    <button class="opr-collapse-btn" title="折叠/展开">▼</button>
                </div>
            </div>
            <div class="panel-content">
                <button class="opr-btn opr-btn-approve" id="opr-approve-btn">
                    <span>✓</span> 一键通过
                </button>
                <button class="opr-btn opr-btn-photo" id="opr-photo-btn">
                    <span>📷</span> 照片通过
                </button>
                <button class="opr-btn opr-btn-skip" id="opr-skip-btn">
                    <span>→</span> 略过
                </button>
            </div>
        `;

        document.body.appendChild(panel);
        setupDrag(panel);

        // 初始化缩放
        const savedScale = getStorage(CONFIG.storageKeys.scale, CONFIG.defaultScale);
        updatePanelScale(panel, savedScale);

        setupButtonEvents(panel);
    }

    function updatePanelScale(panel, scale) {
        // 限制范围 0.5 - 2.0
        const newScale = Math.min(Math.max(scale, 0.5), 2.0);
        panel.style.transform = `scale(${newScale})`;
        panel.dataset.scale = newScale;
        setStorage(CONFIG.storageKeys.scale, newScale);
    }

    // ============================================
    // 拖拽功能
    // ============================================
    function setupDrag(panel) {
        const header = panel.querySelector('.opr-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        function handleStart(clientX, clientY) {
            isDragging = true;
            startX = clientX;
            startY = clientY;
            initialX = panel.offsetLeft;
            initialY = panel.offsetTop;
        }

        function handleMove(clientX, clientY) {
            if (!isDragging) return;
            const dx = clientX - startX;
            const dy = clientY - startY;
            // 确保面板不会移出可视区域 too much (Optional constraint but good for mobile)
            // 计算边界时考虑缩放
            const scale = parseFloat(panel.dataset.scale || 1);
            const scaledWidth = panel.offsetWidth * scale;
            const scaledHeight = panel.offsetHeight * scale;

            const newX = Math.max(0, Math.min(window.innerWidth - scaledWidth, initialX + dx));
            const newY = Math.max(0, Math.min(window.innerHeight - scaledHeight, initialY + dy));

            panel.style.left = newX + 'px';
            panel.style.top = newY + 'px';
        }

        function handleEnd() {
            if (isDragging) {
                isDragging = false;
                setStorage(CONFIG.storageKeys.position, { x: panel.offsetLeft, y: panel.offsetTop });
            }
        }

        // Mouse events
        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('opr-collapse-btn')) return;
            handleStart(e.clientX, e.clientY);
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) handleMove(e.clientX, e.clientY);
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                handleEnd();
                document.body.style.userSelect = '';
            }
        });

        // Touch events
        header.addEventListener('touchstart', (e) => {
            if (e.target.classList.contains('opr-collapse-btn') ||
                e.target.classList.contains('opr-zoom-btn')) return;
            const touch = e.touches[0];
            handleStart(touch.clientX, touch.clientY);
            e.preventDefault(); // 防止滚动
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (isDragging) {
                const touch = e.touches[0];
                handleMove(touch.clientX, touch.clientY);
                e.preventDefault(); // 防止滚动
            }
        }, { passive: false });

        document.addEventListener('touchend', handleEnd);

        // 折叠功能
        const collapseBtn = panel.querySelector('.opr-collapse-btn');
        collapseBtn.addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            collapseBtn.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
        });

        // 阻止按钮触发拖拽
        const zoomBtns = panel.querySelectorAll('.opr-zoom-btn');
        zoomBtns.forEach(btn => {
            btn.addEventListener('touchstart', (e) => e.stopPropagation());
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
        });
        collapseBtn.addEventListener('touchstart', (e) => e.stopPropagation());
        collapseBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    // ============================================
    // UI 辅助函数
    // ============================================
    function showToast(message) {
        const existing = document.querySelector('.opr-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'opr-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 2500);
    }

    function setupButtonEvents(panel) {
        panel.querySelector('#opr-approve-btn').addEventListener('click', handleApprove);
        panel.querySelector('#opr-photo-btn').addEventListener('click', handlePhotoApprove);
        panel.querySelector('#opr-skip-btn').addEventListener('click', handleSkip);

        // 缩放控制
        panel.querySelector('#btn-zoom-in').addEventListener('click', () => {
            const current = parseFloat(panel.dataset.scale || 1);
            updatePanelScale(panel, current + 0.1);
        });

        panel.querySelector('#btn-zoom-out').addEventListener('click', () => {
            const current = parseFloat(panel.dataset.scale || 1);
            updatePanelScale(panel, current - 0.1);
        });
    }

    // ============================================
    // 键盘快捷键
    // ============================================
    function setupKeyboardShortcuts() {
        // 使用 window 级别监听
        function handleKeyDown(e) {
            // 跳过输入框和可编辑元素
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            const keyCode = e.keyCode || e.which;
            const key = e.key ? e.key.toLowerCase() : '';

            // Alt + 键 方案
            if (e.altKey) {
                if (key === 'a' || keyCode === 65) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handleApprove();
                    console.log('快捷键触发: Alt+A');
                    return false;
                } else if (key === 's' || keyCode === 83) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handlePhotoApprove();
                    console.log('快捷键触发: Alt+S');
                    return false;
                } else if (key === 'd' || keyCode === 68) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handleSkip();
                    console.log('快捷键触发: Alt+D');
                    return false;
                }
            }

            // 备选方案：数字键 (1=通过, 2=略过)
            if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                if (key === '1' || keyCode === 49) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handleApprove();
                    console.log('快捷键触发: 1 一键通过');
                    return false;
                } else if (key === '2' || keyCode === 50) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handlePhotoApprove();
                    console.log('快捷键触发: 2 照片通过');
                    return false;
                } else if (key === '3' || keyCode === 51) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handleSkip();
                    console.log('快捷键触发: 3 略过');
                    return false;
                }
            }
        }

        // 在 window 和 document 上都注册，增加成功率
        window.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keydown', handleKeyDown, true);

        console.log('🎮 OPR Assistant 快捷键已注册 (Alt+A/S/D 或 1/2/3)');
    }

    // ============================================
    // 初始化
    // ============================================
    function init() {
        createPanel();
        setupKeyboardShortcuts();
        console.log('🎮 OPR Assistant 已加载');
    }

    // 启动 - 使用多种方式确保加载
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('DOMContentLoaded', init, false);
        window.addEventListener('load', function () {
            setTimeout(init, 1000);
        }, false);
    }

})();
