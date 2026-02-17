// ==UserScript==
// @id             iitc-plugin-get-coordinates
// @name           IITC Plugin: 获取坐标 (Get Coordinates)
// @category       Info
// @version        1.0.0
// @description    点击地图获取指定位置的经纬度坐标，支持多种格式复制、Portal 坐标获取、搜索定位。
// @author         Kedaxia
// @namespace      https://github.com/kedaxia
// @match          https://intel.ingress.com/*
// @match          https://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==

/* globals L, map, $, dialog */

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function () { };

    window.plugin.getCoordinates = function () { };
    const self = window.plugin.getCoordinates;

    // ── State ──────────────────────────────────────────────────
    self.STORAGE_KEY = 'plugin-get-coordinates-history';
    self.isPickMode = false;
    self.pickMarker = null;
    self.historyMarkers = [];
    self.layerGroup = null;
    self.history = [];
    self.MAX_HISTORY = 50;

    // ── Coordinate Formats ────────────────────────────────────
    self.formatCoords = function (lat, lng, format) {
        switch (format) {
            case 'decimal':
                return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            case 'decimal-reverse':
                return `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
            case 'dms': {
                const toDMS = (deg, pos, neg) => {
                    const d = Math.abs(deg);
                    const dd = Math.floor(d);
                    const mm = Math.floor((d - dd) * 60);
                    const ss = ((d - dd) * 3600 - mm * 60).toFixed(2);
                    return `${dd}°${mm}'${ss}"${deg >= 0 ? pos : neg}`;
                };
                return `${toDMS(lat, 'N', 'S')} ${toDMS(lng, 'E', 'W')}`;
            }
            case 'dmm': {
                const toDMM = (deg, pos, neg) => {
                    const d = Math.abs(deg);
                    const dd = Math.floor(d);
                    const mm = ((d - dd) * 60).toFixed(4);
                    return `${dd}°${mm}'${deg >= 0 ? pos : neg}`;
                };
                return `${toDMM(lat, 'N', 'S')} ${toDMM(lng, 'E', 'W')}`;
            }
            case 'intel-link':
                return `https://intel.ingress.com/intel?ll=${lat.toFixed(6)},${lng.toFixed(6)}&z=17`;
            case 'google-maps':
                return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
            default:
                return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
    };

    // ── Clipboard ─────────────────────────────────────────────
    self.copyToClipboard = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                self.showToast('✅ 已复制: ' + text);
            }).catch(function () {
                self.fallbackCopy(text);
            });
        } else {
            self.fallbackCopy(text);
        }
    };

    self.fallbackCopy = function (text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            self.showToast('✅ 已复制: ' + text);
        } catch (e) {
            self.showToast('❌ 复制失败');
        }
        document.body.removeChild(ta);
    };

    // ── Toast ─────────────────────────────────────────────────
    self.showToast = function (msg) {
        let toast = document.getElementById('gc-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'gc-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(self._toastTimer);
        self._toastTimer = setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(10px)';
        }, 2500);
    };

    // ── Pick Mode ─────────────────────────────────────────────
    self.enterPickMode = function () {
        self.isPickMode = true;
        map.getContainer().style.cursor = 'crosshair';
        map.on('click', self.onMapClick);
        self.showToast('🎯 点击地图选取坐标 (ESC 退出)');
        // Update button state
        const btn = document.getElementById('gc-pick-btn');
        if (btn) {
            btn.textContent = '🎯 选取中... (ESC退出)';
            btn.classList.add('gc-btn-active');
        }
    };

    self.exitPickMode = function () {
        self.isPickMode = false;
        map.getContainer().style.cursor = '';
        map.off('click', self.onMapClick);
        const btn = document.getElementById('gc-pick-btn');
        if (btn) {
            btn.textContent = '🎯 点击地图选取坐标';
            btn.classList.remove('gc-btn-active');
        }
    };

    self.onMapClick = function (e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        self.showCoordinateResult(lat, lng, '地图选取');
        self.addToHistory(lat, lng, '地图选取');
        self.placeMarker(lat, lng);
        self.exitPickMode();
    };

    // ── Marker ────────────────────────────────────────────────
    self.placeMarker = function (lat, lng) {
        if (self.pickMarker) {
            self.layerGroup.removeLayer(self.pickMarker);
        }
        self.pickMarker = L.marker(L.latLng(lat, lng), {
            icon: L.divIcon({
                className: 'gc-marker-icon',
                html: '<div class="gc-marker-pin">📍</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 30],
            }),
        });

        const popupHtml = `
      <div class="gc-marker-popup">
        <div class="gc-mp-title">📍 选取坐标</div>
        <div class="gc-mp-coord">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
        <div class="gc-mp-actions">
          <button class="gc-btn gc-btn-sm" onclick="window.plugin.getCoordinates.copyToClipboard('${lat.toFixed(6)}, ${lng.toFixed(6)}')">📋 复制</button>
          <button class="gc-btn gc-btn-sm" onclick="window.open('https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}','_blank')">🗺️ Google</button>
        </div>
      </div>
    `;
        self.pickMarker.bindPopup(popupHtml, { className: 'gc-popup-wrap', maxWidth: 280 });
        self.layerGroup.addLayer(self.pickMarker);
        self.pickMarker.openPopup();
    };

    // ── History ───────────────────────────────────────────────
    self.addToHistory = function (lat, lng, source) {
        self.history.unshift({
            lat, lng, source,
            time: new Date().toLocaleString('zh-CN', { hour12: false }),
        });
        if (self.history.length > self.MAX_HISTORY) {
            self.history = self.history.slice(0, self.MAX_HISTORY);
        }
        self.saveHistory();
        self.updateHistoryUI();
    };

    self.saveHistory = function () {
        try {
            localStorage.setItem(self.STORAGE_KEY, JSON.stringify(self.history));
        } catch (e) { console.warn('[GetCoords] Save failed', e); }
    };

    self.loadHistory = function () {
        try {
            const s = localStorage.getItem(self.STORAGE_KEY);
            if (s) { self.history = JSON.parse(s); return true; }
        } catch (e) { console.warn('[GetCoords] Load failed', e); }
        return false;
    };

    // ── Result Display ────────────────────────────────────────
    self.showCoordinateResult = function (lat, lng, source) {
        const resultEl = document.getElementById('gc-result');
        if (!resultEl) return;

        resultEl.innerHTML = `
      <div class="gc-result-card">
        <div class="gc-result-hdr">📍 ${self.esc(source || '坐标')}</div>
        <div class="gc-result-main">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
        <div class="gc-result-formats">
          <div class="gc-fmt-row" title="点击复制">
            <span class="gc-fmt-label">十进制</span>
            <span class="gc-fmt-val" data-copy="${lat.toFixed(6)}, ${lng.toFixed(6)}">${lat.toFixed(6)}, ${lng.toFixed(6)}</span>
          </div>
          <div class="gc-fmt-row" title="点击复制">
            <span class="gc-fmt-label">DMS</span>
            <span class="gc-fmt-val" data-copy="${self.formatCoords(lat, lng, 'dms')}">${self.formatCoords(lat, lng, 'dms')}</span>
          </div>
          <div class="gc-fmt-row" title="点击复制">
            <span class="gc-fmt-label">DMM</span>
            <span class="gc-fmt-val" data-copy="${self.formatCoords(lat, lng, 'dmm')}">${self.formatCoords(lat, lng, 'dmm')}</span>
          </div>
          <div class="gc-fmt-row" title="点击复制">
            <span class="gc-fmt-label">Intel</span>
            <span class="gc-fmt-val gc-fmt-link" data-copy="${self.formatCoords(lat, lng, 'intel-link')}">🔗 Intel 链接</span>
          </div>
          <div class="gc-fmt-row" title="点击复制">
            <span class="gc-fmt-label">Google</span>
            <span class="gc-fmt-val gc-fmt-link" data-copy="${self.formatCoords(lat, lng, 'google-maps')}">🔗 Google Maps</span>
          </div>
        </div>
      </div>
    `;

        // Bind copy on click for each format row
        resultEl.querySelectorAll('.gc-fmt-val[data-copy]').forEach(function (el) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function () {
                self.copyToClipboard(this.dataset.copy);
            });
        });
    };

    // ── Map Center Coordinates ────────────────────────────────
    self.getMapCenter = function () {
        const center = map.getCenter();
        self.showCoordinateResult(center.lat, center.lng, '地图中心');
        self.addToHistory(center.lat, center.lng, '地图中心');
        self.placeMarker(center.lat, center.lng);
    };

    // ── Current Cursor Position Display ───────────────────────
    self.updateCursorCoords = function (e) {
        const el = document.getElementById('gc-cursor-coords');
        if (el) {
            el.textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
        }
    };

    // ── Portal Click ──────────────────────────────────────────
    self.getPortalCoords = function () {
        const selected = window.selectedPortal;
        if (!selected) {
            self.showToast('⚠️ 请先在地图上选择一个 Portal');
            return;
        }
        const p = window.portals[selected];
        if (!p) {
            self.showToast('⚠️ 未找到 Portal 数据');
            return;
        }
        const ll = p.getLatLng();
        const title = p.options.data.title || 'Unknown Portal';
        self.showCoordinateResult(ll.lat, ll.lng, 'Portal: ' + title);
        self.addToHistory(ll.lat, ll.lng, title);
    };

    // ── Coordinate Input Search ───────────────────────────────
    self.searchCoordinate = function () {
        const input = document.getElementById('gc-search-input');
        if (!input || !input.value.trim()) {
            self.showToast('⚠️ 请输入坐标');
            return;
        }
        const val = input.value.trim();
        const result = self.parseCoordInput(val);
        if (!result) {
            self.showToast('⚠️ 无法解析坐标格式');
            return;
        }
        map.setView(L.latLng(result.lat, result.lng), 17);
        self.showCoordinateResult(result.lat, result.lng, '搜索定位');
        self.addToHistory(result.lat, result.lng, '搜索定位');
        self.placeMarker(result.lat, result.lng);
    };

    self.parseCoordInput = function (text) {
        // Try: decimal "lat, lng" or "lat lng"
        let m = text.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

        // Try: DMS format  25°02'04.8"N 121°33'54.0"E
        m = text.match(/(\d+)[°]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([NSEW])\s*[,\s]\s*(\d+)[°]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([NSEW])/i);
        if (m) {
            let lat = parseInt(m[1]) + parseInt(m[2]) / 60 + parseFloat(m[3]) / 3600;
            let lng = parseInt(m[5]) + parseInt(m[6]) / 60 + parseFloat(m[7]) / 3600;
            if (m[4].toUpperCase() === 'S') lat = -lat;
            if (m[8].toUpperCase() === 'W') lng = -lng;
            return { lat, lng };
        }

        // Try: intel link
        m = text.match(/ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

        // Try: google maps link
        m = text.match(/[?&@](-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

        return null;
    };

    // ── History UI ────────────────────────────────────────────
    self.updateHistoryUI = function () {
        const el = document.getElementById('gc-history-list');
        if (!el) return;
        if (!self.history.length) {
            el.innerHTML = '<div class="gc-empty">暂无记录</div>';
            return;
        }
        let html = '';
        self.history.slice(0, 20).forEach(function (h, i) {
            html += `
        <div class="gc-hist-item" data-idx="${i}">
          <div class="gc-hist-main">
            <span class="gc-hist-source">${self.esc(h.source)}</span>
            <span class="gc-hist-coord">${h.lat.toFixed(6)}, ${h.lng.toFixed(6)}</span>
          </div>
          <div class="gc-hist-meta">
            <span class="gc-hist-time">${h.time}</span>
            <span class="gc-hist-actions">
              <button class="gc-btn gc-btn-xs" data-action="copy" data-lat="${h.lat}" data-lng="${h.lng}" title="复制">📋</button>
              <button class="gc-btn gc-btn-xs" data-action="goto" data-lat="${h.lat}" data-lng="${h.lng}" title="定位">🎯</button>
            </span>
          </div>
        </div>
      `;
        });
        el.innerHTML = html;

        // Bind events
        el.querySelectorAll('[data-action="copy"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                self.copyToClipboard(this.dataset.lat + ', ' + this.dataset.lng);
            });
        });
        el.querySelectorAll('[data-action="goto"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const lat = parseFloat(this.dataset.lat);
                const lng = parseFloat(this.dataset.lng);
                map.setView(L.latLng(lat, lng), 17);
                self.placeMarker(lat, lng);
            });
        });
    };

    self.esc = function (s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    };

    // ── Dialog ────────────────────────────────────────────────
    self.openDialog = function () {
        const html = `
      <div id="gc-panel">
        <div class="gc-sec">
          <div class="gc-sec-title">🎯 坐标选取</div>
          <div class="gc-action-group">
            <button id="gc-pick-btn" class="gc-btn gc-btn-primary gc-btn-wide">🎯 点击地图选取坐标</button>
            <div class="gc-btn-row">
              <button id="gc-center-btn" class="gc-btn">📌 获取地图中心坐标</button>
              <button id="gc-portal-btn" class="gc-btn">🔷 获取选中 Portal 坐标</button>
            </div>
          </div>
        </div>

        <div class="gc-sec">
          <div class="gc-sec-title">🔍 坐标搜索 / 跳转</div>
          <div class="gc-search-row">
            <input type="text" id="gc-search-input" class="gc-input" placeholder="输入坐标... (如: 25.033, 121.565 或 DMS 或 链接)">
            <button id="gc-search-btn" class="gc-btn gc-btn-primary">🔍</button>
          </div>
        </div>

        <div class="gc-sec">
          <div class="gc-sec-title">📍 当前坐标</div>
          <div id="gc-result" class="gc-result">
            <div class="gc-empty">点击地图或选择操作获取坐标</div>
          </div>
          <div class="gc-cursor-bar">
            <span class="gc-cursor-label">🖱️ 光标</span>
            <span id="gc-cursor-coords" class="gc-cursor-val">--, --</span>
          </div>
        </div>

        <div class="gc-sec">
          <div class="gc-sec-title">📜 历史记录</div>
          <div id="gc-history-list" class="gc-history-list">
            <div class="gc-empty">暂无记录</div>
          </div>
          <div class="gc-action-row">
            <button id="gc-clear-history" class="gc-btn gc-btn-danger gc-btn-sm">🗑️ 清除历史</button>
          </div>
        </div>
      </div>
    `;

        dialog({ html, title: '📍 获取坐标', width: 380, dialogClass: 'gc-dialog' });

        // Bind events
        setTimeout(function () {
            // Pick mode
            const pickBtn = document.getElementById('gc-pick-btn');
            if (pickBtn) pickBtn.addEventListener('click', function () {
                if (self.isPickMode) self.exitPickMode();
                else self.enterPickMode();
            });

            // Map center
            const centerBtn = document.getElementById('gc-center-btn');
            if (centerBtn) centerBtn.addEventListener('click', self.getMapCenter);

            // Portal coords
            const portalBtn = document.getElementById('gc-portal-btn');
            if (portalBtn) portalBtn.addEventListener('click', self.getPortalCoords);

            // Search
            const searchBtn = document.getElementById('gc-search-btn');
            if (searchBtn) searchBtn.addEventListener('click', self.searchCoordinate);
            const searchInput = document.getElementById('gc-search-input');
            if (searchInput) searchInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') self.searchCoordinate();
            });

            // Clear history
            const clearBtn = document.getElementById('gc-clear-history');
            if (clearBtn) clearBtn.addEventListener('click', function () {
                if (!confirm('确定清除所有历史记录？')) return;
                self.history = [];
                self.saveHistory();
                self.updateHistoryUI();
            });

            // Cursor tracking
            map.on('mousemove', self.updateCursorCoords);

            // Update history UI
            self.updateHistoryUI();
        }, 100);
    };

    // ── CSS ────────────────────────────────────────────────────
    self.injectStyles = function () {
        const css = `
/* ── Dialog chrome ─────────────────────────────────── */
.gc-dialog .ui-dialog-titlebar{background:linear-gradient(135deg,#0f2027,#203a43,#2c5364)!important;border-bottom:1px solid #ffffff15!important}
.gc-dialog .ui-dialog-title{color:#fff!important;font-weight:600!important;letter-spacing:.5px}
.gc-dialog .ui-dialog-content{background:#0a1628!important;padding:0!important;scrollbar-width:thin;scrollbar-color:#2a3f5a #0a1628}

/* ── Panel layout ──────────────────────────────────── */
#gc-panel{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#c0d0e0;font-size:12px}
.gc-sec{padding:10px 14px;border-bottom:1px solid #ffffff08}
.gc-sec:last-child{border-bottom:none}
.gc-sec-title{font-size:12px;font-weight:600;color:#5bbcf2;margin-bottom:8px;letter-spacing:.3px}

/* ── Buttons ───────────────────────────────────────── */
.gc-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;background:linear-gradient(135deg,#1a2a3e,#1e3a52);border:1px solid #ffffff15;border-radius:6px;color:#8ecae6;font-size:11px;cursor:pointer;transition:all .2s}
.gc-btn:hover{border-color:#5bbcf280;box-shadow:0 0 10px #5bbcf220;color:#fff}
.gc-btn-primary{background:linear-gradient(135deg,#1e3a52,#0a4c7a)!important;border-color:#5bbcf240!important;color:#b8e2f8!important}
.gc-btn-primary:hover{border-color:#5bbcf2!important;box-shadow:0 0 12px #5bbcf230!important}
.gc-btn-danger{border-color:#f8717140!important;color:#fca5a5!important}
.gc-btn-danger:hover{border-color:#f87171!important;box-shadow:0 0 10px #f8717130!important}
.gc-btn-active{background:linear-gradient(135deg,#0a4c7a,#0967a0)!important;border-color:#5bbcf2!important;animation:gc-pulse 1.5s infinite}
.gc-btn-wide{width:100%;justify-content:center;padding:8px 12px;font-size:12px}
.gc-btn-sm{padding:3px 8px;font-size:10px}
.gc-btn-xs{padding:2px 5px;font-size:10px;border:none;background:transparent;cursor:pointer}
.gc-btn-xs:hover{transform:scale(1.2)}
.gc-btn-row{display:flex;gap:6px;margin-top:6px}
.gc-action-group{display:flex;flex-direction:column;gap:4px}
.gc-action-row{margin-top:6px}

@keyframes gc-pulse{0%,100%{box-shadow:0 0 8px #5bbcf230}50%{box-shadow:0 0 16px #5bbcf260}}

/* ── Search ────────────────────────────────────────── */
.gc-search-row{display:flex;gap:6px;align-items:center}
.gc-input{flex:1;padding:6px 10px;background:#0c1e33;border:1px solid #ffffff15;border-radius:6px;color:#d0e0f0;font-size:11px;font-family:inherit}
.gc-input:focus{outline:none;border-color:#5bbcf250;box-shadow:0 0 8px #5bbcf215}
.gc-input::placeholder{color:#3a5070}

/* ── Result card ──────────────────────────────────── */
.gc-result-card{background:#0c1e33;border:1px solid #5bbcf220;border-radius:8px;padding:10px;margin-bottom:6px}
.gc-result-hdr{font-size:11px;color:#5bbcf2;margin-bottom:4px;font-weight:500}
.gc-result-main{font-size:16px;font-weight:700;color:#fff;letter-spacing:.3px;margin-bottom:8px;font-family:'SF Mono',Consolas,Monaco,monospace}
.gc-result-formats{display:flex;flex-direction:column;gap:2px}
.gc-fmt-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;transition:background .15s}
.gc-fmt-row:hover{background:#ffffff08}
.gc-fmt-label{font-size:10px;color:#5a7a94;min-width:40px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.gc-fmt-val{font-size:11px;color:#aac4dd;font-family:'SF Mono',Consolas,Monaco,monospace;flex:1;word-break:break-all}
.gc-fmt-val:hover{color:#fff}
.gc-fmt-link{color:#5bbcf2!important;cursor:pointer}
.gc-fmt-link:hover{text-decoration:underline}

/* ── Cursor bar ───────────────────────────────────── */
.gc-cursor-bar{display:flex;align-items:center;gap:6px;padding:5px 8px;background:#0c1e33;border-radius:6px;border:1px solid #ffffff08;margin-top:6px}
.gc-cursor-label{font-size:10px;color:#5a7a94}
.gc-cursor-val{font-size:11px;font-family:'SF Mono',Consolas,Monaco,monospace;color:#8ecae6;letter-spacing:.3px}

/* ── History ───────────────────────────────────────── */
.gc-history-list{max-height:200px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#2a3f5a transparent}
.gc-hist-item{padding:6px 8px;border-bottom:1px solid #ffffff06;transition:background .15s}
.gc-hist-item:hover{background:#ffffff06}
.gc-hist-main{display:flex;align-items:baseline;gap:6px;margin-bottom:2px}
.gc-hist-source{font-size:10px;color:#5bbcf2;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gc-hist-coord{font-size:11px;font-family:'SF Mono',Consolas,Monaco,monospace;color:#aac4dd}
.gc-hist-meta{display:flex;align-items:center;justify-content:space-between}
.gc-hist-time{font-size:9px;color:#3a5070}
.gc-hist-actions{display:flex;gap:2px}

.gc-empty{text-align:center;color:#3a5070;padding:12px;font-style:italic;font-size:11px}

/* ── Map Marker ───────────────────────────────────── */
.gc-marker-icon{background:none!important;border:none!important}
.gc-marker-pin{font-size:24px;text-shadow:0 2px 4px rgba(0,0,0,.5);animation:gc-drop .3s ease-out}
@keyframes gc-drop{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}

/* ── Map Popup ─────────────────────────────────────── */
.gc-popup-wrap .leaflet-popup-content-wrapper{background:linear-gradient(135deg,#1a2a3e,#0d1a2a)!important;border:1px solid #5bbcf240!important;border-radius:10px!important;box-shadow:0 4px 24px rgba(91,188,242,.15)!important}
.gc-popup-wrap .leaflet-popup-tip{background:#1a2a3e!important;border:1px solid #5bbcf240!important}
.gc-popup-wrap .leaflet-popup-close-button{color:#5bbcf2!important;font-size:16px!important}
.gc-marker-popup{font-family:'Segoe UI',system-ui,sans-serif;color:#c0d0e0;min-width:160px}
.gc-mp-title{font-size:12px;font-weight:600;color:#5bbcf2;margin-bottom:4px}
.gc-mp-coord{font-size:14px;font-weight:700;color:#fff;font-family:'SF Mono',Consolas,Monaco,monospace;margin-bottom:8px}
.gc-mp-actions{display:flex;gap:6px}

/* ── Toast ─────────────────────────────────────────── */
#gc-toast{position:fixed;bottom:60px;left:50%;transform:translateX(-50%) translateY(10px);z-index:10000;padding:8px 18px;background:linear-gradient(135deg,#1e3a52,#0a4c7a);border:1px solid #5bbcf240;border-radius:8px;color:#e0f0ff;font-size:12px;font-family:'Segoe UI',system-ui,sans-serif;box-shadow:0 4px 20px rgba(91,188,242,.2);opacity:0;transition:all .3s ease;pointer-events:none;white-space:nowrap}


`;
        const s = document.createElement('style');
        s.id = 'gc-styles';
        s.textContent = css;
        document.head.appendChild(s);
    };

    // ── Boot ───────────────────────────────────────────────────
    self.addToolboxLink = function () {
        // Use jQuery (always available in IITC) — standard plugin pattern
        if (typeof $ !== 'undefined' && $('#toolbox').length) {
            $('<a>')
                .text('获取坐标')
                .click(function (e) { e.preventDefault(); self.openDialog(); })
                .appendTo($('#toolbox'));
            console.log('[GetCoords] 已添加到 toolbox');
            return true;
        }
        // Fallback: vanilla DOM
        const tb = document.getElementById('toolbox');
        if (tb) {
            const a = document.createElement('a');
            a.textContent = '获取坐标';
            a.addEventListener('click', function (e) { e.preventDefault(); self.openDialog(); });
            tb.appendChild(a);
            console.log('[GetCoords] 已添加到 toolbox (vanilla)');
            return true;
        }
        return false;
    };

    self.setup = function () {
        self.injectStyles();

        self.layerGroup = new L.LayerGroup();
        window.addLayerGroup('📍 坐标标记', self.layerGroup, true);

        // Try adding toolbox link immediately; if failed, retry with polling
        if (!self.addToolboxLink()) {
            var retries = 0;
            var timer = setInterval(function () {
                if (self.addToolboxLink() || ++retries > 20) {
                    clearInterval(timer);
                    if (retries > 20) console.warn('[GetCoords] toolbox 未找到，请用 Alt+C 打开');
                }
            }, 500);
        }

        // Keyboard shortcut: Alt+C
        document.addEventListener('keydown', function (e) {
            if (e.altKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                self.openDialog();
            }
            // ESC to exit pick mode
            if (e.key === 'Escape' && self.isPickMode) {
                self.exitPickMode();
            }
        });

        // Load history
        self.loadHistory();

        console.log('[GetCoords] v1.0 loaded');
    };

    // ── Standard IITC bootstrap ────────────────────────────────
    var setup = self.setup;
    setup.info = plugin_info;
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded && typeof setup === 'function') setup();
}

// ── Inject wrapper ──────────────────────────────────────────
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
    info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
}
script.appendChild(document.createTextNode('(' + wrapper + ')(' + JSON.stringify(info) + ');'));
(document.body || document.head || document.documentElement).appendChild(script);
