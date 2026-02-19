// ==UserScript==
// @id             iitc-wayfarer-suite
// @name           IITC Plugin: Wayfarer Suite
// @category       Layer
// @version        1.0.0
// @description    统一的 Wayfarer 工具套件：坐标选取、书签管理、提名可视化（含20m/80m半径、S2 Cell、拖拽标记、图片预览、Google Sheets 同步）。
// @author         Kedaxia
// @namespace      https://github.com/kedaxia
// @match          https://intel.ingress.com/*
// @match          https://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==

/* globals L, map, $, dialog */

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function () { };
    window.plugin.wayfarerSuite = function () { };
    const self = window.plugin.wayfarerSuite;

    // ══════════════════════════════════════════════════════════
    //  STATE
    // ══════════════════════════════════════════════════════════

    self.BOOKMARKS_KEY = 'wayfarer-suite-bookmarks';
    self.SETTINGS_KEY = 'wayfarer-suite-settings';
    self.WAYFARER_KEY = 'wayfarer-suite-wayfarer';

    self.isPickMode = false;
    self.pickMarker = null;
    self.isPlacingMarkers = false;

    self.layerGroup = null;
    self.bookmarkLayerGroup = null;
    self.bookmarkMapMarkers = {};
    self.bookmarkMapCircles = {};
    self.bookmarks = [];
    self._lastPickedLat = null;
    self._lastPickedLng = null;
    self._lastPickedSource = '';

    // Wayfarer state
    self.wayfarerNominations = [];
    self.wayfarerLayers = {};       // status -> { layer, initialized }
    self.wayfarerMapMarkers = {};   // id -> { marker, layer }
    self.wayfarerMapCircles = {};   // id -> { submit, interact }
    self.wayfarerMapTitles = {};    // id -> L.marker (title label)
    self.wayfarerPlottedCells = {}; // cellId -> { candidateIds, polygon }

    self.STATUS_COLORS = {
        potential: { color: '#95a5a6', label: '候选', icon: '⚪' },
        submitted: { color: '#f1c40f', label: '已提交', icon: '🟡' },
        held: { color: '#e67e22', label: '搁置', icon: '🟠' },
        voting: { color: '#3498db', label: '投票中', icon: '🔵' },
        NIANTIC_REVIEW: { color: '#1abc9c', label: 'N审核', icon: '🔷' },
        appealed: { color: '#9b59b6', label: '已申诉', icon: '🟣' },
        rejected: { color: '#e67e22', label: '被拒绝', icon: '🟠' },
    };

    self.MARKER_COLORS = [
        { name: '红色', value: '#e74c3c' },
        { name: '蓝色', value: '#3498db' },
        { name: '绿色', value: '#2ecc71' },
        { name: '橙色', value: '#e67e22' },
        { name: '紫色', value: '#9b59b6' },
        { name: '青色', value: '#1abc9c' },
        { name: '粉色', value: '#e84393' },
        { name: '黄色', value: '#f1c40f' },
    ];

    const defaultSettings = {
        showMarkers: true,
        showCircles: true,
        showLabels: true,
        showWayfarer: true,
        showTitles: true,
        showSubmitRadius: true,
        showInteractRadius: false,
        showVotingProximity: false,
        enableDragging: false,
        enableImagePreview: true,
        scriptURL: '',
        statusFilters: {
            potential: true,
            submitted: true,
            held: true,
            voting: true,
            NIANTIC_REVIEW: true,
            appealed: true,
            rejected: true,
        },
        // Radius visual settings
        submitRadiusColor: '#000000',
        submitRadiusOpacity: 1.0,
        submitRadiusFillColor: '#808080',
        submitRadiusFillOpacity: 0.4,
        interactRadiusColor: '#808080',
        interactRadiusOpacity: 1.0,
        interactRadiusFillColor: '#000000',
        interactRadiusFillOpacity: 0.0,
        votingProximityColor: '#000000',
        votingProximityOpacity: 0.5,
        votingProximityFillColor: '#FFA500',
        votingProximityFillOpacity: 0.3,
    };

    self.settings = JSON.parse(JSON.stringify(defaultSettings));

    // ══════════════════════════════════════════════════════════
    //  SETTINGS PERSISTENCE
    // ══════════════════════════════════════════════════════════

    self.saveSettings = function () {
        try { localStorage.setItem(self.SETTINGS_KEY, JSON.stringify(self.settings)); }
        catch (e) { console.warn('[WFS] Settings save failed', e); }
    };

    self.loadSettings = function () {
        try {
            var s = localStorage.getItem(self.SETTINGS_KEY);
            if (s) self.settings = Object.assign({}, JSON.parse(JSON.stringify(defaultSettings)), JSON.parse(s));
        } catch (e) { console.warn('[WFS] Settings load failed', e); }
    };

    // ══════════════════════════════════════════════════════════
    //  DATA MIGRATION (from old plugins)
    // ══════════════════════════════════════════════════════════

    self.migrateOldData = function () {
        // Migrate bookmarks from iitc-get-coordinates
        if (!localStorage.getItem(self.BOOKMARKS_KEY)) {
            var old = localStorage.getItem('plugin-get-coordinates-bookmarks');
            if (old) {
                localStorage.setItem(self.BOOKMARKS_KEY, old);
                console.log('[WFS] Migrated bookmarks from iitc-get-coordinates');
            }
        }
        // Migrate wayfarer data from iitc-get-coordinates
        if (!localStorage.getItem(self.WAYFARER_KEY)) {
            var oldWf = localStorage.getItem('plugin-get-coordinates-wayfarer');
            if (oldWf) {
                localStorage.setItem(self.WAYFARER_KEY, oldWf);
                console.log('[WFS] Migrated wayfarer data from iitc-get-coordinates');
            }
        }
        // Migrate settings
        if (!localStorage.getItem(self.SETTINGS_KEY)) {
            var oldSettings = localStorage.getItem('plugin-get-coordinates-settings');
            if (oldSettings) {
                try {
                    var parsed = JSON.parse(oldSettings);
                    var merged = Object.assign({}, JSON.parse(JSON.stringify(defaultSettings)), parsed);
                    localStorage.setItem(self.SETTINGS_KEY, JSON.stringify(merged));
                    console.log('[WFS] Migrated settings from iitc-get-coordinates');
                } catch (e) { }
            }
        }
    };

    // ══════════════════════════════════════════════════════════
    //  UTILITIES
    // ══════════════════════════════════════════════════════════

    self.esc = function (s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    };

    self.copyToClipboard = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                self.showToast('✅ 已复制: ' + text);
            }).catch(function () { self.fallbackCopy(text); });
        } else { self.fallbackCopy(text); }
    };

    self.fallbackCopy = function (text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); self.showToast('✅ 已复制: ' + text); }
        catch (e) { self.showToast('❌ 复制失败'); }
        document.body.removeChild(ta);
    };

    self.showToast = function (msg) {
        var toast = document.getElementById('wfs-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'wfs-toast';
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

    // ══════════════════════════════════════════════════════════
    //  COORDINATE FORMATS
    // ══════════════════════════════════════════════════════════

    self.formatCoords = function (lat, lng, format) {
        switch (format) {
            case 'decimal': return lat.toFixed(6) + ', ' + lng.toFixed(6);
            case 'decimal-reverse': return lng.toFixed(6) + ', ' + lat.toFixed(6);
            case 'dms': {
                var toDMS = function (deg, pos, neg) {
                    var d = Math.abs(deg), dd = Math.floor(d), mm = Math.floor((d - dd) * 60);
                    var ss = ((d - dd) * 3600 - mm * 60).toFixed(2);
                    return dd + '°' + mm + "'" + ss + '"' + (deg >= 0 ? pos : neg);
                };
                return toDMS(lat, 'N', 'S') + ' ' + toDMS(lng, 'E', 'W');
            }
            case 'dmm': {
                var toDMM = function (deg, pos, neg) {
                    var d = Math.abs(deg), dd = Math.floor(d), mm = ((d - dd) * 60).toFixed(4);
                    return dd + '°' + mm + "'" + (deg >= 0 ? pos : neg);
                };
                return toDMM(lat, 'N', 'S') + ' ' + toDMM(lng, 'E', 'W');
            }
            case 'intel-link': return 'https://intel.ingress.com/intel?ll=' + lat.toFixed(6) + ',' + lng.toFixed(6) + '&z=17';
            case 'google-maps': return 'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6);
            default: return lat.toFixed(6) + ', ' + lng.toFixed(6);
        }
    };

    self.parseCoordInput = function (text) {
        var m = text.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
        m = text.match(/(\d+)[°]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([NSEW])\s*[,\s]\s*(\d+)[°]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([NSEW])/i);
        if (m) {
            var lat = parseInt(m[1]) + parseInt(m[2]) / 60 + parseFloat(m[3]) / 3600;
            var lng = parseInt(m[5]) + parseInt(m[6]) / 60 + parseFloat(m[7]) / 3600;
            if (m[4].toUpperCase() === 'S') lat = -lat;
            if (m[8].toUpperCase() === 'W') lng = -lng;
            return { lat: lat, lng: lng };
        }
        m = text.match(/ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
        m = text.match(/[?&@](-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
        return null;
    };

    // ══════════════════════════════════════════════════════════
    //  PICK MODE & MARKER
    // ══════════════════════════════════════════════════════════

    self.enterPickMode = function () {
        self.isPickMode = true;
        map.getContainer().style.cursor = 'crosshair';
        map.on('click', self.onMapClick);
        self.showToast('🎯 点击地图选取坐标 (ESC 退出)');
        var btn = document.getElementById('wfs-pick-btn');
        if (btn) { btn.textContent = '🎯 选取中... (ESC退出)'; btn.classList.add('wfs-btn-active'); }
    };

    self.exitPickMode = function () {
        self.isPickMode = false;
        map.getContainer().style.cursor = '';
        map.off('click', self.onMapClick);
        var btn = document.getElementById('wfs-pick-btn');
        if (btn) { btn.textContent = '🎯 点击地图选取坐标'; btn.classList.remove('wfs-btn-active'); }
    };

    self.onMapClick = function (e) {
        self._lastPickedLat = e.latlng.lat;
        self._lastPickedLng = e.latlng.lng;
        self._lastPickedSource = '地图选取';
        self.showCoordinateResult(e.latlng.lat, e.latlng.lng, '地图选取');
        self.placePickMarker(e.latlng.lat, e.latlng.lng);
        self.exitPickMode();
    };

    self.placePickMarker = function (lat, lng) {
        if (self.pickMarker) self.layerGroup.removeLayer(self.pickMarker);
        self.pickMarker = L.marker(L.latLng(lat, lng), {
            icon: L.divIcon({ className: 'wfs-marker-icon', html: '<div class="wfs-marker-pin">📍</div>', iconSize: [30, 30], iconAnchor: [15, 30] }),
        });
        var popupHtml = '<div class="wfs-marker-popup">' +
            '<div class="wfs-mp-title">📍 选取坐标</div>' +
            '<div class="wfs-mp-coord">' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '</div>' +
            '<div class="wfs-mp-actions">' +
            '<button class="wfs-btn wfs-btn-sm" onclick="window.plugin.wayfarerSuite.copyToClipboard(\'' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '\')">📋 复制</button>' +
            '<button class="wfs-btn wfs-btn-sm" onclick="window.open(\'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) + '\',\'_blank\')">🗺️ Google</button>' +
            '</div></div>';
        self.pickMarker.bindPopup(popupHtml, { className: 'wfs-popup-wrap', maxWidth: 280 });
        self.layerGroup.addLayer(self.pickMarker);
        self.pickMarker.openPopup();
    };

    self.getMapCenter = function () {
        var c = map.getCenter();
        self._lastPickedLat = c.lat;
        self._lastPickedLng = c.lng;
        self._lastPickedSource = '地图中心';
        self.showCoordinateResult(c.lat, c.lng, '地图中心');
        self.placePickMarker(c.lat, c.lng);
    };

    self.getPortalCoords = function () {
        var selected = window.selectedPortal;
        if (!selected) { self.showToast('⚠️ 请先在地图上选择一个 Portal'); return; }
        var p = window.portals[selected];
        if (!p) { self.showToast('⚠️ 未找到 Portal 数据'); return; }
        var ll = p.getLatLng();
        var title = (p.options.data && p.options.data.title) || 'Unknown Portal';
        self.showCoordinateResult(ll.lat, ll.lng, 'Portal: ' + title);
    };

    self.searchCoordinate = function () {
        var input = document.getElementById('wfs-search-input');
        if (!input || !input.value.trim()) { self.showToast('⚠️ 请输入坐标'); return; }
        var result = self.parseCoordInput(input.value.trim());
        if (!result) { self.showToast('⚠️ 无法解析坐标格式'); return; }
        map.setView(L.latLng(result.lat, result.lng), 17);
        self.showCoordinateResult(result.lat, result.lng, '搜索定位');
        self.placePickMarker(result.lat, result.lng);
    };

    self.updateCursorCoords = function (e) {
        var el = document.getElementById('wfs-cursor-coords');
        if (el) el.textContent = e.latlng.lat.toFixed(6) + ', ' + e.latlng.lng.toFixed(6);
    };

    self.showCoordinateResult = function (lat, lng, source) {
        self._lastPickedLat = lat;
        self._lastPickedLng = lng;
        self._lastPickedSource = source || '';
        var el = document.getElementById('wfs-result');
        if (!el) return;
        el.innerHTML =
            '<div class="wfs-result-card">' +
            '<div class="wfs-result-hdr">📍 ' + self.esc(source || '坐标') + '</div>' +
            '<div class="wfs-result-main">' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '</div>' +
            '<div class="wfs-result-formats">' +
            '<div class="wfs-fmt-row" title="点击复制"><span class="wfs-fmt-label">十进制</span><span class="wfs-fmt-val" data-copy="' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '">' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '</span></div>' +
            '<div class="wfs-fmt-row" title="点击复制"><span class="wfs-fmt-label">DMS</span><span class="wfs-fmt-val" data-copy="' + self.formatCoords(lat, lng, 'dms') + '">' + self.formatCoords(lat, lng, 'dms') + '</span></div>' +
            '<div class="wfs-fmt-row" title="点击复制"><span class="wfs-fmt-label">DMM</span><span class="wfs-fmt-val" data-copy="' + self.formatCoords(lat, lng, 'dmm') + '">' + self.formatCoords(lat, lng, 'dmm') + '</span></div>' +
            '<div class="wfs-fmt-row" title="点击复制"><span class="wfs-fmt-label">Intel</span><span class="wfs-fmt-val wfs-fmt-link" data-copy="' + self.formatCoords(lat, lng, 'intel-link') + '">🔗 Intel 链接</span></div>' +
            '<div class="wfs-fmt-row" title="点击复制"><span class="wfs-fmt-label">Google</span><span class="wfs-fmt-val wfs-fmt-link" data-copy="' + self.formatCoords(lat, lng, 'google-maps') + '">🔗 Google Maps</span></div>' +
            '</div>' +
            '<div class="wfs-result-actions"><button id="wfs-save-bookmark-btn" class="wfs-btn wfs-btn-bookmark">📌 添加标记</button></div>' +
            '</div>';
        el.querySelectorAll('.wfs-fmt-val[data-copy]').forEach(function (v) {
            v.style.cursor = 'pointer';
            v.addEventListener('click', function () { self.copyToClipboard(this.dataset.copy); });
        });
        var bmBtn = document.getElementById('wfs-save-bookmark-btn');
        if (bmBtn) bmBtn.addEventListener('click', function () {
            self.promptAddBookmark(lat, lng, source === '地图选取' ? '' : source);
        });
    };

    // ══════════════════════════════════════════════════════════
    //  BOOKMARKS
    // ══════════════════════════════════════════════════════════

    self.saveBookmarks = function () {
        try { localStorage.setItem(self.BOOKMARKS_KEY, JSON.stringify(self.bookmarks)); }
        catch (e) { console.warn('[WFS] Bookmark save failed', e); }
    };

    self.loadBookmarks = function () {
        try {
            var s = localStorage.getItem(self.BOOKMARKS_KEY);
            if (s) { self.bookmarks = JSON.parse(s); return true; }
        } catch (e) { console.warn('[WFS] Bookmark load failed', e); }
        return false;
    };

    self.addBookmark = function (lat, lng, name, color) {
        var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        var bm = { id: id, lat: lat, lng: lng, name: name || '标记 #' + (self.bookmarks.length + 1), color: color || '#e74c3c', time: new Date().toLocaleString('zh-CN', { hour12: false }) };
        self.bookmarks.unshift(bm);
        self.saveBookmarks();
        self.renderBookmarkOnMap(bm);
        self.updateBookmarksUI();
        self.showToast('📌 已添加标记: ' + bm.name);
        return bm;
    };

    self.removeBookmark = function (id) {
        self.bookmarks = self.bookmarks.filter(function (b) { return b.id !== id; });
        self.saveBookmarks();
        if (self.bookmarkMapMarkers[id]) { self.bookmarkLayerGroup.removeLayer(self.bookmarkMapMarkers[id]); delete self.bookmarkMapMarkers[id]; }
        if (self.bookmarkMapCircles[id]) { self.bookmarkLayerGroup.removeLayer(self.bookmarkMapCircles[id]); delete self.bookmarkMapCircles[id]; }
        self.updateBookmarksUI();
    };

    self.exportBookmarks = function () {
        if (!self.bookmarks.length) { self.showToast('⚠️ 没有可导出的标记'); return; }
        var blob = new Blob([JSON.stringify(self.bookmarks, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'wayfarer-suite-bookmarks-' + new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '') + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        self.showToast('📤 已导出 ' + self.bookmarks.length + ' 个标记');
    };

    self.importBookmarks = function (file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var imported = JSON.parse(e.target.result);
                if (!Array.isArray(imported)) throw new Error('Invalid format');
                var count = 0;
                imported.forEach(function (bm) {
                    if (bm.lat && bm.lng && bm.name) {
                        if (self.bookmarks.find(function (b) { return b.id === bm.id; })) {
                            bm.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                        }
                        self.bookmarks.push(bm);
                        count++;
                    }
                });
                self.saveBookmarks(); self.renderAllBookmarks(); self.updateBookmarksUI();
                self.showToast('📥 已导入 ' + count + ' 个标记');
            } catch (err) { self.showToast('⚠️ 导入失败: 文件格式错误'); }
        };
        reader.readAsText(file);
    };

    self.importBookmarksFromUrl = function (url) {
        if (!url) { self.showToast('⚠️ 请输入URL'); return; }
        self.showToast('⏳ 正在从URL导入...');
        fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (imported) {
                if (!Array.isArray(imported)) throw new Error('Invalid format');
                var count = 0;
                imported.forEach(function (bm) {
                    if (bm.lat && bm.lng && bm.name) {
                        if (self.bookmarks.find(function (b) { return b.id === bm.id; })) bm.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                        self.bookmarks.push(bm); count++;
                    }
                });
                self.saveBookmarks(); self.renderAllBookmarks(); self.updateBookmarksUI();
                self.showToast('📥 已从URL导入 ' + count + ' 个标记');
            }).catch(function (err) { self.showToast('⚠️ URL导入失败: ' + err.message); });
    };

    self.renderBookmarkOnMap = function (bm) {
        if (self.bookmarkMapMarkers[bm.id]) self.bookmarkLayerGroup.removeLayer(self.bookmarkMapMarkers[bm.id]);
        var marker = L.marker(L.latLng(bm.lat, bm.lng), {
            icon: L.divIcon({ className: 'wfs-bm-icon', html: '<div class="wfs-bm-dot-marker" style="background:' + bm.color + '"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }),
        });
        marker.bindTooltip(self.esc(bm.name), { permanent: self.settings.showLabels, direction: 'right', offset: [8, 0], className: 'wfs-bm-tooltip' });
        var popupHtml = '<div class="wfs-marker-popup">' +
            '<div class="wfs-mp-title" style="color:' + bm.color + '">📌 ' + self.esc(bm.name) + '</div>' +
            '<div class="wfs-mp-coord">' + bm.lat.toFixed(6) + ', ' + bm.lng.toFixed(6) + '</div>' +
            '<div class="wfs-mp-actions">' +
            '<button class="wfs-btn wfs-btn-sm" onclick="window.plugin.wayfarerSuite.copyToClipboard(\'' + bm.lat.toFixed(6) + ', ' + bm.lng.toFixed(6) + '\')">📋 复制</button>' +
            '<button class="wfs-btn wfs-btn-sm" onclick="window.plugin.wayfarerSuite.editBookmark(\'' + bm.id + '\')">✏️ 编辑</button>' +
            '<button class="wfs-btn wfs-btn-sm wfs-btn-danger" onclick="window.plugin.wayfarerSuite.removeBookmark(\'' + bm.id + '\')">🗑️ 删除</button>' +
            '</div></div>';
        marker.bindPopup(popupHtml, { className: 'wfs-popup-wrap', maxWidth: 280 });
        if (self.settings.showMarkers) self.bookmarkLayerGroup.addLayer(marker);
        self.bookmarkMapMarkers[bm.id] = marker;

        if (self.bookmarkMapCircles[bm.id]) self.bookmarkLayerGroup.removeLayer(self.bookmarkMapCircles[bm.id]);
        var circle = L.circle(L.latLng(bm.lat, bm.lng), { radius: 20, color: '#000', weight: 1, opacity: 0.9, fillColor: bm.color, fillOpacity: 0.35, interactive: false });
        if (self.settings.showCircles) self.bookmarkLayerGroup.addLayer(circle);
        self.bookmarkMapCircles[bm.id] = circle;
    };

    self.renderAllBookmarks = function () {
        self.bookmarkLayerGroup.clearLayers();
        self.bookmarkMapMarkers = {};
        self.bookmarkMapCircles = {};
        self.bookmarks.forEach(function (bm) { self.renderBookmarkOnMap(bm); });
    };

    self.editBookmark = function (id) {
        var bm = self.bookmarks.find(function (b) { return b.id === id; });
        if (!bm) { self.showToast('⚠️ 未找到标记'); return; }
        var colorOpts = '';
        self.MARKER_COLORS.forEach(function (c) {
            colorOpts += '<label class="wfs-color-opt"><input type="radio" name="wfs-bm-color" value="' + c.value + '"' + (c.value === bm.color ? ' checked' : '') + '><span class="wfs-color-dot" style="background:' + c.value + '" title="' + c.name + '"></span></label>';
        });
        var html = '<div class="wfs-bm-form">' +
            '<div class="wfs-bm-form-row"><label>名称</label><input type="text" id="wfs-bm-name" class="wfs-input" value="' + self.esc(bm.name) + '"></div>' +
            '<div class="wfs-bm-form-row"><label>坐标</label><input type="text" id="wfs-bm-coord" class="wfs-input" value="' + bm.lat.toFixed(6) + ', ' + bm.lng.toFixed(6) + '"></div>' +
            '<div class="wfs-bm-form-row"><label>颜色</label><div class="wfs-color-picker">' + colorOpts + '</div></div>' +
            '<div class="wfs-bm-form-actions"><button id="wfs-bm-save" class="wfs-btn wfs-btn-primary">✅ 保存</button>' +
            '<button id="wfs-bm-del" class="wfs-btn wfs-btn-danger" style="margin-left:8px">🗑️ 删除</button></div></div>';
        dialog({ html: html, title: '✏️ 编辑标记', width: 320, dialogClass: 'wfs-dialog' });
        setTimeout(function () {
            var saveBtn = document.getElementById('wfs-bm-save');
            if (saveBtn) saveBtn.addEventListener('click', function () {
                var name = (document.getElementById('wfs-bm-name').value.trim()) || '标记';
                var parsed = self.parseCoordInput(document.getElementById('wfs-bm-coord').value.trim());
                if (!parsed) { self.showToast('⚠️ 坐标格式错误'); return; }
                var colorEl = document.querySelector('input[name=wfs-bm-color]:checked');
                bm.name = name; bm.lat = parsed.lat; bm.lng = parsed.lng; bm.color = colorEl ? colorEl.value : bm.color;
                self.saveBookmarks(); self.renderAllBookmarks(); self.updateBookmarksUI();
                self.showToast('✅ 标记已更新: ' + name);
            });
            var delBtn = document.getElementById('wfs-bm-del');
            if (delBtn) delBtn.addEventListener('click', function () { if (confirm('确定删除？')) self.removeBookmark(id); });
        }, 50);
    };

    self.promptAddBookmark = function (lat, lng, defaultName) {
        var colorOpts = '';
        self.MARKER_COLORS.forEach(function (c, i) {
            colorOpts += '<label class="wfs-color-opt"><input type="radio" name="wfs-bm-color" value="' + c.value + '"' + (i === 0 ? ' checked' : '') + '><span class="wfs-color-dot" style="background:' + c.value + '"></span></label>';
        });
        var html = '<div class="wfs-bm-form">' +
            '<div class="wfs-bm-form-row"><label>名称</label><input type="text" id="wfs-bm-name" class="wfs-input" value="' + self.esc(defaultName || '') + '" placeholder="标记名称..."></div>' +
            '<div class="wfs-bm-form-row"><label>坐标</label><input type="text" id="wfs-bm-coord" class="wfs-input" value="' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '"></div>' +
            '<div class="wfs-bm-form-row"><label>颜色</label><div class="wfs-color-picker">' + colorOpts + '</div></div>' +
            '<div class="wfs-bm-form-actions"><button id="wfs-bm-save" class="wfs-btn wfs-btn-primary">📌 保存标记</button></div></div>';
        dialog({ html: html, title: '📌 添加标记', width: 320, dialogClass: 'wfs-dialog' });
        setTimeout(function () {
            var saveBtn = document.getElementById('wfs-bm-save');
            if (saveBtn) saveBtn.addEventListener('click', function () {
                var name = (document.getElementById('wfs-bm-name').value.trim()) || '标记';
                var parsed = self.parseCoordInput(document.getElementById('wfs-bm-coord').value.trim());
                if (!parsed) { self.showToast('⚠️ 坐标格式错误'); return; }
                var colorEl = document.querySelector('input[name=wfs-bm-color]:checked');
                self.addBookmark(parsed.lat, parsed.lng, name, colorEl ? colorEl.value : '#e74c3c');
            });
            var ni = document.getElementById('wfs-bm-name');
            if (ni) ni.focus();
        }, 50);
    };

    // ══════════════════════════════════════════════════════════
    //  WAYFARER NOMINATIONS - DATA
    // ══════════════════════════════════════════════════════════

    self.saveWayfarerNominations = function () {
        try { localStorage.setItem(self.WAYFARER_KEY, JSON.stringify(self.wayfarerNominations)); }
        catch (e) { console.warn('[WFS] Wayfarer save failed', e); }
    };

    self.loadWayfarerNominations = function () {
        try {
            var s = localStorage.getItem(self.WAYFARER_KEY);
            if (s) { self.wayfarerNominations = JSON.parse(s); return true; }
        } catch (e) { console.warn('[WFS] Wayfarer load failed', e); }
        return false;
    };

    // Map uppercase Wayfarer API statuses to our lowercase keys
    self._normalizeStatus = function (status) {
        if (!status) return 'submitted';
        var map = {
            'NOMINATED': 'submitted', 'VOTING': 'voting', 'HELD': 'held',
            'ACCEPTED': 'submitted', 'REJECTED': 'rejected', 'DUPLICATE': 'rejected',
            'APPEALED': 'appealed', 'NIANTIC_REVIEW': 'NIANTIC_REVIEW',
            'WITHDRAWN': 'rejected', 'UPGRADE': 'voting',
        };
        return map[status] || map[status.toUpperCase()] || status.toLowerCase() || 'submitted';
    };

    self._convertWayfarerData = function (raw) {
        var result = [];
        if (Array.isArray(raw)) {
            raw.forEach(function (item) {
                if (item.lat && item.lng) {
                    result.push({
                        id: item.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
                        title: item.title || '未知提名', description: item.description || '',
                        lat: parseFloat(item.lat), lng: parseFloat(item.lng),
                        status: self._normalizeStatus(item.status),
                        imageUrl: item.imageUrl || item.candidateimageurl || '',
                        day: item.day || item.submitteddate || '',
                    });
                }
            });
        } else if (raw && typeof raw === 'object') {
            Object.keys(raw).forEach(function (id) {
                var item = raw[id];
                if (item.lat && item.lng) {
                    result.push({
                        id: id, title: item.title || '未知提名', description: item.description || '',
                        lat: parseFloat(item.lat), lng: parseFloat(item.lng),
                        status: self._normalizeStatus(item.status),
                        imageUrl: item.imageUrl || item.candidateimageurl || '',
                        day: item.day || item.submitteddate || '',
                    });
                }
            });
        }
        return result;
    };

    self.importWayfarerFromFile = function (file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var items = self._convertWayfarerData(JSON.parse(e.target.result));
                if (!items.length) throw new Error('No valid nominations');
                var count = 0;
                items.forEach(function (nom) {
                    if (!self.wayfarerNominations.find(function (n) { return n.id === nom.id; })) {
                        self.wayfarerNominations.push(nom); count++;
                    }
                });
                self.saveWayfarerNominations(); self.renderAllWayfarer(); self.updateWayfarerUI();
                self.showToast('📡 已导入 ' + count + ' 个提名');
            } catch (err) { self.showToast('⚠️ 导入失败: ' + err.message); }
        };
        reader.readAsText(file);
    };

    self.importWayfarerFromUrl = function (url) {
        if (!url) { self.showToast('⚠️ 请输入URL'); return; }
        self.showToast('⏳ 正在从URL导入提名...');
        fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (raw) {
                var items = self._convertWayfarerData(raw);
                if (!items.length) throw new Error('No valid nominations');
                var count = 0;
                items.forEach(function (nom) {
                    if (!self.wayfarerNominations.find(function (n) { return n.id === nom.id; })) {
                        self.wayfarerNominations.push(nom); count++;
                    }
                });
                self.saveWayfarerNominations(); self.renderAllWayfarer(); self.updateWayfarerUI();
                self.showToast('📡 已从URL导入 ' + count + ' 个提名');
            }).catch(function (err) { self.showToast('⚠️ URL导入失败: ' + err.message); });
    };

    self.importFromGoogleSheets = function () {
        var url = self.settings.scriptURL;
        if (!url) { self.showToast('⚠️ 请先配置 Google Sheets URL'); self.openSettingsDialog(); return; }
        self.showToast('⏳ 正在从 Google Sheets 同步...');
        $.ajax({
            url: url, type: 'GET', dataType: 'text',
            success: function (data) {
                try {
                    var items = self._convertWayfarerData(JSON.parse(data));
                    self.wayfarerNominations = items;
                    self.saveWayfarerNominations(); self.renderAllWayfarer(); self.updateWayfarerUI();
                    self.showToast('📡 已同步 ' + items.length + ' 个提名');
                } catch (e) { self.showToast('⚠️ 数据解析失败'); }
            },
            error: function () { self.showToast('⚠️ Google Sheets 同步失败'); }
        });
    };

    self.exportWayfarer = function () {
        if (!self.wayfarerNominations.length) { self.showToast('⚠️ 没有可导出的提名'); return; }
        var blob = new Blob([JSON.stringify(self.wayfarerNominations, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url;
        a.download = 'wayfarer-nominations-' + new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '') + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        self.showToast('📤 已导出 ' + self.wayfarerNominations.length + ' 个提名');
    };

    self.clearWayfarer = function () {
        self.wayfarerNominations = [];
        self.saveWayfarerNominations();
        Object.keys(self.wayfarerLayers).forEach(function (k) { if (self.wayfarerLayers[k].layer) self.wayfarerLayers[k].layer.clearLayers(); });
        Object.values(self.wayfarerPlottedCells).forEach(function (d) { map.removeLayer(d.polygon); });
        self.wayfarerMapMarkers = {}; self.wayfarerMapCircles = {}; self.wayfarerMapTitles = {};
        self.wayfarerPlottedCells = {};
        self.updateWayfarerUI();
        self.showToast('🗑️ 已清空所有提名');
    };

    self.removeWayfarerNom = function (id) {
        self.wayfarerNominations = self.wayfarerNominations.filter(function (n) { return n.id !== id; });
        self.saveWayfarerNominations();
        self._removeWayfarerMarker(id);
        self.updateWayfarerUI();
    };

    self.updateWayfarerStatus = function (id, newStatus) {
        var nom = self.wayfarerNominations.find(function (n) { return n.id === id; });
        if (!nom) return;
        nom.status = newStatus;
        self.saveWayfarerNominations();
        self._removeWayfarerMarker(id);
        self.renderWayfarerOnMap(nom);
        self.updateWayfarerUI();
        var si = self.STATUS_COLORS[newStatus] || self.STATUS_COLORS.submitted;
        self.showToast(si.icon + ' 状态已更新: ' + si.label);
    };

    self.sendWayfarerToBookmark = function (id) {
        var nom = self.wayfarerNominations.find(function (n) { return n.id === id; });
        if (!nom) return;
        var si = self.STATUS_COLORS[nom.status] || self.STATUS_COLORS.submitted;
        self.addBookmark(nom.lat, nom.lng, nom.title, si.color);
    };

    // ══════════════════════════════════════════════════════════
    //  WAYFARER NOMINATIONS - MAP RENDERING
    // ══════════════════════════════════════════════════════════

    self._removeWayfarerMarker = function (id) {
        var md = self.wayfarerMapMarkers[id];
        if (md) { md.layer.removeLayer(md.marker); delete self.wayfarerMapMarkers[id]; }
        var cd = self.wayfarerMapCircles[id];
        if (cd) {
            if (cd.submit) map.removeLayer(cd.submit);
            if (cd.interact) map.removeLayer(cd.interact);
            delete self.wayfarerMapCircles[id];
        }
        if (self.wayfarerMapTitles[id]) { map.removeLayer(self.wayfarerMapTitles[id]); delete self.wayfarerMapTitles[id]; }
    };

    self._getOrCreateStatusLayer = function (status) {
        if (self.wayfarerLayers[status]) return self.wayfarerLayers[status].layer;
        var si = self.STATUS_COLORS[status] || self.STATUS_COLORS.submitted;
        var layer = new L.LayerGroup();
        window.addLayerGroup(si.icon + ' ' + si.label, layer, self.settings.statusFilters[status] !== false);
        self.wayfarerLayers[status] = { layer: layer };
        return layer;
    };

    self.renderWayfarerOnMap = function (nom) {
        if (!self.settings.showWayfarer) return;
        if (self.settings.statusFilters[nom.status] === false) return;
        var si = self.STATUS_COLORS[nom.status] || self.STATUS_COLORS.submitted;
        var layer = self._getOrCreateStatusLayer(nom.status);

        // Marker with status-specific SVG icon
        var svgHtml = '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="10" fill="' + si.color + '" stroke="#000" stroke-width="1.5" opacity="0.9"/><text x="12" y="16" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold">' + si.icon + '</text></svg>';
        var marker = L.marker(L.latLng(nom.lat, nom.lng), {
            icon: L.divIcon({ className: 'wfs-wf-icon', html: '<div class="wfs-wf-pin">' + svgHtml + '</div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
            draggable: self.settings.enableDragging,
        });

        // Drag end handler
        if (self.settings.enableDragging) {
            marker.on('dragend', function (e) {
                var newPos = e.target.getLatLng();
                nom.lat = newPos.lat; nom.lng = newPos.lng;
                self.saveWayfarerNominations();
                // Update radius circles
                var cd = self.wayfarerMapCircles[nom.id];
                if (cd) {
                    if (cd.submit) cd.submit.setLatLng(newPos);
                    if (cd.interact) cd.interact.setLatLng(newPos);
                }
                self.showToast('📍 坐标已更新: ' + nom.title);
            });
        }

        // Build popup HTML
        var statusOptions = Object.keys(self.STATUS_COLORS).map(function (k) {
            var s = self.STATUS_COLORS[k];
            return '<option value="' + k + '"' + (k === nom.status ? ' selected' : '') + '>' + s.icon + ' ' + s.label + '</option>';
        }).join('');

        var popupHtml = '<div class="wfs-wf-popup">' +
            '<div class="wfs-wf-popup-row"><span class="wfs-wf-popup-label">状态</span>' +
            '<select class="wfs-wf-select" onchange="window.plugin.wayfarerSuite.updateWayfarerStatus(\'' + nom.id + '\',this.value)">' + statusOptions + '</select></div>' +
            '<div class="wfs-wf-popup-text"><strong>' + self.esc(nom.title) + '</strong></div>';

        if (nom.description) popupHtml += '<div class="wfs-wf-popup-text wfs-wf-popup-desc">' + self.esc(nom.description) + '</div>';

        if (nom.day) popupHtml += '<div class="wfs-wf-popup-row"><span class="wfs-wf-popup-date">📅 ' + nom.day + '</span></div>';

        if (self.settings.enableImagePreview && nom.imageUrl) {
            popupHtml += '<div class="wfs-wf-popup-img-wrap"><img class="wfs-wf-popup-img" src="' + nom.imageUrl + '" loading="lazy" onerror="this.style.display=\'none\'"></div>';
        }

        popupHtml += '<button class="wfs-wf-send-btn" onclick="window.plugin.wayfarerSuite.sendWayfarerToBookmark(\'' + nom.id + '\')">📌 发送到书签</button>' +
            '<div class="wfs-wf-popup-bottom">' +
            '<a class="wfs-wf-bottom-link" href="https://www.google.com/maps?layer=c&cbll=' + nom.lat + ',' + nom.lng + '" target="_blank">🛣️ 街景</a>' +
            '<a class="wfs-wf-bottom-link" onclick="window.plugin.wayfarerSuite.copyToClipboard(\'' + nom.lat.toFixed(6) + ', ' + nom.lng.toFixed(6) + '\')">📋 复制坐标</a>' +
            '<a class="wfs-wf-bottom-link wfs-wf-bottom-del" onclick="window.plugin.wayfarerSuite.removeWayfarerNom(\'' + nom.id + '\')">🗑️ 删除</a>' +
            '</div></div>';

        marker.bindPopup(popupHtml, { className: 'wfs-popup-wrap wfs-wf-popup-wrap', maxWidth: 260, minWidth: 200 });
        layer.addLayer(marker);
        self.wayfarerMapMarkers[nom.id] = { marker: marker, layer: layer };

        // 20m submit radius
        if (self.settings.showSubmitRadius) {
            var submitCircle = L.circle(L.latLng(nom.lat, nom.lng), {
                radius: 20, color: self.settings.submitRadiusColor, weight: 1,
                opacity: self.settings.submitRadiusOpacity,
                fillColor: self.settings.submitRadiusFillColor,
                fillOpacity: self.settings.submitRadiusFillOpacity, interactive: false
            });
            submitCircle.addTo(map);
            if (!self.wayfarerMapCircles[nom.id]) self.wayfarerMapCircles[nom.id] = {};
            self.wayfarerMapCircles[nom.id].submit = submitCircle;
        }

        // 80m interact radius
        if (self.settings.showInteractRadius) {
            var interactCircle = L.circle(L.latLng(nom.lat, nom.lng), {
                radius: 80, color: self.settings.interactRadiusColor, weight: 1,
                opacity: self.settings.interactRadiusOpacity,
                fillColor: self.settings.interactRadiusFillColor,
                fillOpacity: self.settings.interactRadiusFillOpacity, interactive: false
            });
            interactCircle.addTo(map);
            if (!self.wayfarerMapCircles[nom.id]) self.wayfarerMapCircles[nom.id] = {};
            self.wayfarerMapCircles[nom.id].interact = interactCircle;
        }

        // S2 Cell 17 voting proximity for voting/NIANTIC_REVIEW nominations
        if (self.settings.showVotingProximity && (nom.status === 'voting' || nom.status === 'NIANTIC_REVIEW')) {
            self._plotS2Cell(nom);
        }
    };

    self.renderAllWayfarer = function () {
        // Clear all wayfarer layers
        Object.keys(self.wayfarerLayers).forEach(function (k) { if (self.wayfarerLayers[k].layer) self.wayfarerLayers[k].layer.clearLayers(); });
        Object.values(self.wayfarerMapCircles).forEach(function (cd) {
            if (cd.submit) map.removeLayer(cd.submit);
            if (cd.interact) map.removeLayer(cd.interact);
        });
        Object.values(self.wayfarerPlottedCells).forEach(function (d) { map.removeLayer(d.polygon); });
        self.wayfarerMapMarkers = {}; self.wayfarerMapCircles = {};
        self.wayfarerMapTitles = {}; self.wayfarerPlottedCells = {};

        if (!self.settings.showWayfarer) return;
        self.wayfarerNominations.forEach(function (nom) { self.renderWayfarerOnMap(nom); });
    };

    // ══════════════════════════════════════════════════════════
    //  S2 GEOMETRY (for Level 17 Cell display)
    // ══════════════════════════════════════════════════════════

    var S2 = {};
    S2.DEG_TO_RAD = Math.PI / 180;
    S2.RAD_TO_DEG = 180 / Math.PI;

    S2.LatLngToXYZ = function (lat, lng) {
        var d2r = S2.DEG_TO_RAD;
        var phi = lat * d2r, theta = lng * d2r;
        var cosphi = Math.cos(phi);
        return [Math.cos(theta) * cosphi, Math.sin(theta) * cosphi, Math.sin(phi)];
    };

    S2.XYZToLatLng = function (xyz) {
        var d2r = S2.RAD_TO_DEG;
        var lat = Math.atan2(xyz[2], Math.sqrt(xyz[0] * xyz[0] + xyz[1] * xyz[1]));
        var lng = Math.atan2(xyz[1], xyz[0]);
        return [lat * d2r, lng * d2r];
    };

    S2.largestAbsComponent = function (xyz) {
        var t = [Math.abs(xyz[0]), Math.abs(xyz[1]), Math.abs(xyz[2])];
        if (t[0] > t[1]) return t[0] > t[2] ? 0 : 2;
        return t[1] > t[2] ? 1 : 2;
    };

    S2.faceXYZToUV = function (face, xyz) {
        var u, v;
        switch (face) {
            case 0: u = xyz[1] / xyz[0]; v = xyz[2] / xyz[0]; break;
            case 1: u = -xyz[0] / xyz[1]; v = xyz[2] / xyz[1]; break;
            case 2: u = -xyz[0] / xyz[2]; v = -xyz[1] / xyz[2]; break;
            case 3: u = xyz[2] / xyz[0]; v = xyz[1] / xyz[0]; break;
            case 4: u = xyz[2] / xyz[1]; v = -xyz[0] / xyz[1]; break;
            case 5: u = -xyz[1] / xyz[2]; v = -xyz[0] / xyz[2]; break;
            default: throw new Error('Invalid face');
        }
        return [u, v];
    };

    S2.XYZToFaceUV = function (xyz) {
        var face = S2.largestAbsComponent(xyz);
        if (xyz[face] < 0) face += 3;
        var uv = S2.faceXYZToUV(face, xyz);
        return [face, uv];
    };

    S2.STToUV = function (s) { return s >= 0.5 ? (1 / 3.0) * (4 * s * s - 1) : (1 / 3.0) * (1 - 4 * (1 - s) * (1 - s)); };
    S2.UVToST = function (u) { return u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u); };
    S2.STToIJ = function (s, level) { return Math.max(0, Math.min(Math.pow(2, level) - 1, Math.floor(s * Math.pow(2, level)))); };

    S2.FaceUVToXYZ = function (face, u, v) {
        switch (face) {
            case 0: return [1, u, v];
            case 1: return [-u, 1, v];
            case 2: return [-u, -v, 1];
            case 3: return [-1, -v, -u];
            case 4: return [v, -1, -u];
            case 5: return [v, u, -1];
        }
    };

    S2.IJToST = function (i, level, offsets) {
        var isizeI = Math.pow(2, level);
        return [(i + offsets[0]) / isizeI, (i + offsets[1]) / isizeI];
    };

    S2.Cell = function (face, ij, level) { this.face = face; this.ij = ij; this.level = level; };

    S2.Cell.FromLatLng = function (lat, lng, level) {
        var xyz = S2.LatLngToXYZ(lat, lng);
        var faceuv = S2.XYZToFaceUV(xyz);
        var st = [S2.UVToST(faceuv[1][0]), S2.UVToST(faceuv[1][1])];
        var ij = [S2.STToIJ(st[0], level), S2.STToIJ(st[1], level)];
        return new S2.Cell(faceuv[0], ij, level);
    };

    S2.Cell.prototype.getCornerLatLngs = function () {
        var corners = [];
        var offsets = [[0, 0], [0, 1], [1, 1], [1, 0]];
        for (var i = 0; i < 4; i++) {
            var st = S2.IJToST(this.ij, this.level, offsets[i]);
            var uv = [S2.STToUV(st[0]), S2.STToUV(st[1])];
            var xyz = S2.FaceUVToXYZ(this.face, uv[0], uv[1]);
            var ll = S2.XYZToLatLng(xyz);
            corners.push(L.latLng(ll[0], ll[1]));
        }
        return corners;
    };

    S2.Cell.prototype.toString = function () { return this.face + '/' + this.ij[0] + '/' + this.ij[1]; };

    S2.Cell.prototype.getSurrounding = function () {
        var cells = [];
        var di = [-1, 0, 1, -1, 1, -1, 0, 1];
        var dj = [-1, -1, -1, 0, 0, 1, 1, 1];
        for (var k = 0; k < 8; k++) {
            cells.push(new S2.Cell(this.face, [this.ij[0] + di[k], this.ij[1] + dj[k]], this.level));
        }
        return cells;
    };

    self._plotS2Cell = function (nom) {
        var cell = S2.Cell.FromLatLng(nom.lat, nom.lng, 17);
        var cellId = cell.toString();
        if (self.wayfarerPlottedCells[cellId]) return;
        var corners = cell.getCornerLatLngs();
        var polygon = L.polygon(corners, {
            color: self.settings.votingProximityColor,
            weight: 1, opacity: self.settings.votingProximityOpacity,
            fillColor: self.settings.votingProximityFillColor,
            fillOpacity: self.settings.votingProximityFillOpacity,
            interactive: false
        });
        polygon.addTo(map);
        self.wayfarerPlottedCells[cellId] = { candidateIds: [nom.id], polygon: polygon };
    };

    // ══════════════════════════════════════════════════════════
    //  UI - WAYFARER LIST
    // ══════════════════════════════════════════════════════════

    self.updateWayfarerUI = function () {
        var el = document.getElementById('wfs-wayfarer-list');
        if (!el) return;
        var countEl = document.getElementById('wfs-wf-count');
        if (countEl) countEl.textContent = self.wayfarerNominations.length;
        if (!self.wayfarerNominations.length) { el.innerHTML = '<div class="wfs-empty">暂无提名数据</div>'; return; }
        var html = '';
        self.wayfarerNominations.forEach(function (nom) {
            var si = self.STATUS_COLORS[nom.status] || self.STATUS_COLORS.submitted;
            html += '<div class="wfs-wf-item">' +
                '<div class="wfs-bm-item-main">' +
                '<span class="wfs-wf-status-dot" style="background:' + si.color + '"></span>' +
                '<span class="wfs-bm-item-name">' + self.esc(nom.title) + '</span>' +
                '<span class="wfs-wf-status-tag" style="color:' + si.color + '">' + si.label + '</span>' +
                '</div>' +
                '<div class="wfs-bm-item-actions">' +
                '<button class="wfs-btn wfs-btn-xs" onclick="map.setView(L.latLng(' + nom.lat + ',' + nom.lng + '),17)" title="定位">🎯</button>' +
                '<button class="wfs-btn wfs-btn-xs" onclick="window.plugin.wayfarerSuite.copyToClipboard(\'' + nom.lat.toFixed(6) + ', ' + nom.lng.toFixed(6) + '\')" title="复制">📋</button>' +
                '</div></div>';
        });
        el.innerHTML = html;
    };

    // ══════════════════════════════════════════════════════════
    //  UI - BOOKMARKS LIST
    // ══════════════════════════════════════════════════════════

    self.updateBookmarksUI = function () {
        var el = document.getElementById('wfs-bookmarks-list');
        if (!el) return;
        var countEl = document.getElementById('wfs-bm-count');
        if (countEl) countEl.textContent = self.bookmarks.length;
        if (!self.bookmarks.length) { el.innerHTML = '<div class="wfs-empty">暂无标记</div>'; return; }
        var html = '';
        self.bookmarks.forEach(function (bm) {
            html += '<div class="wfs-bm-item">' +
                '<div class="wfs-bm-item-main">' +
                '<span class="wfs-bm-color-dot" style="background:' + bm.color + '"></span>' +
                '<span class="wfs-bm-item-name">' + self.esc(bm.name) + '</span>' +
                '<span class="wfs-bm-item-coord">' + bm.lat.toFixed(6) + ', ' + bm.lng.toFixed(6) + '</span>' +
                '</div>' +
                '<div class="wfs-bm-item-actions">' +
                '<button class="wfs-btn wfs-btn-xs" data-bm-action="goto" data-lat="' + bm.lat + '" data-lng="' + bm.lng + '" title="定位">🎯</button>' +
                '<button class="wfs-btn wfs-btn-xs" data-bm-action="copy" data-lat="' + bm.lat + '" data-lng="' + bm.lng + '" title="复制">📋</button>' +
                '<button class="wfs-btn wfs-btn-xs" data-bm-action="edit" data-bm-id="' + bm.id + '" title="编辑">✏️</button>' +
                '<button class="wfs-btn wfs-btn-xs" data-bm-action="del" data-bm-id="' + bm.id + '" title="删除">🗑️</button>' +
                '</div></div>';
        });
        el.innerHTML = html;
        el.querySelectorAll('[data-bm-action="goto"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); map.setView(L.latLng(parseFloat(this.dataset.lat), parseFloat(this.dataset.lng)), 17); }); });
        el.querySelectorAll('[data-bm-action="copy"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self.copyToClipboard(this.dataset.lat + ', ' + this.dataset.lng); }); });
        el.querySelectorAll('[data-bm-action="edit"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self.editBookmark(this.dataset.bmId); }); });
        el.querySelectorAll('[data-bm-action="del"]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); self.removeBookmark(this.dataset.bmId); }); });
    };

    // ══════════════════════════════════════════════════════════
    //  UI - SETTINGS DIALOG
    // ══════════════════════════════════════════════════════════

    self.openSettingsDialog = function () {
        var s = self.settings;
        var html = '<div class="wfs-bm-form" style="max-height:400px;overflow-y:auto">' +
            '<div class="wfs-bm-form-row"><strong>📡 Wayfarer 显示</strong></div>' +
            '<div class="wfs-bm-form-row"><label><input type="checkbox" id="wfs-s-submit-r" ' + (s.showSubmitRadius ? 'checked' : '') + '> 20m 提交半径</label></div>' +
            '<div class="wfs-bm-form-row"><label><input type="checkbox" id="wfs-s-interact-r" ' + (s.showInteractRadius ? 'checked' : '') + '> 80m 互动半径</label></div>' +
            '<div class="wfs-bm-form-row"><label><input type="checkbox" id="wfs-s-voting" ' + (s.showVotingProximity ? 'checked' : '') + '> S2 Cell 17 投票邻近</label></div>' +
            '<div class="wfs-bm-form-row"><label><input type="checkbox" id="wfs-s-drag" ' + (s.enableDragging ? 'checked' : '') + '> 允许拖拽标记</label></div>' +
            '<div class="wfs-bm-form-row"><label><input type="checkbox" id="wfs-s-img" ' + (s.enableImagePreview ? 'checked' : '') + '> 弹窗图片预览</label></div>' +
            '<div class="wfs-bm-form-row" style="margin-top:8px"><strong>☁️ Google Sheets</strong></div>' +
            '<div class="wfs-bm-form-row"><label>Script URL</label><input type="text" id="wfs-s-url" class="wfs-input" style="flex:1" value="' + self.esc(s.scriptURL) + '" placeholder="Google Apps Script URL..."></div>' +
            '<div class="wfs-bm-form-actions" style="margin-top:12px">' +
            '<button id="wfs-s-save" class="wfs-btn wfs-btn-primary">✅ 保存设置</button></div></div>';
        dialog({ html: html, title: '⚙️ Wayfarer Suite 设置', width: 360, dialogClass: 'wfs-dialog' });
        setTimeout(function () {
            var saveBtn = document.getElementById('wfs-s-save');
            if (saveBtn) saveBtn.addEventListener('click', function () {
                s.showSubmitRadius = document.getElementById('wfs-s-submit-r').checked;
                s.showInteractRadius = document.getElementById('wfs-s-interact-r').checked;
                s.showVotingProximity = document.getElementById('wfs-s-voting').checked;
                s.enableDragging = document.getElementById('wfs-s-drag').checked;
                s.enableImagePreview = document.getElementById('wfs-s-img').checked;
                s.scriptURL = document.getElementById('wfs-s-url').value.trim();
                self.saveSettings();
                self.renderAllWayfarer();
                self.showToast('✅ 设置已保存');
            });
        }, 50);
    };

    // ══════════════════════════════════════════════════════════
    //  MAIN DIALOG
    // ══════════════════════════════════════════════════════════

    self.openDialog = function () {
        var filterHtml = Object.keys(self.STATUS_COLORS).map(function (key) {
            var si = self.STATUS_COLORS[key];
            var checked = self.settings.statusFilters[key] !== false ? 'checked' : '';
            return '<label class="wfs-wf-filter-opt" title="' + si.label + '"><input type="checkbox" data-wf-filter="' + key + '" ' + checked + '><span class="wfs-wf-filter-dot" style="background:' + si.color + '"></span>' + si.label + '</label>';
        }).join('');

        var html = '<div id="wfs-panel">' +
            '<div class="wfs-sec">' +
            '<div class="wfs-sec-title">🎯 坐标选取</div>' +
            '<div class="wfs-action-group">' +
            '<button id="wfs-pick-btn" class="wfs-btn wfs-btn-primary wfs-btn-wide">🎯 点击地图选取坐标</button>' +
            '<div class="wfs-btn-row">' +
            '<button id="wfs-center-btn" class="wfs-btn">📌 地图中心</button>' +
            '<button id="wfs-portal-btn" class="wfs-btn">🔷 选中 Portal</button>' +
            '</div></div></div>' +

            '<div class="wfs-sec">' +
            '<div class="wfs-sec-title">🔍 坐标搜索</div>' +
            '<div class="wfs-search-row">' +
            '<input type="text" id="wfs-search-input" class="wfs-input" placeholder="输入坐标 (如: 25.033, 121.565)">' +
            '<button id="wfs-search-btn" class="wfs-btn wfs-btn-primary">🔍</button>' +
            '</div></div>' +

            '<div class="wfs-sec">' +
            '<div class="wfs-sec-title">📍 当前坐标</div>' +
            '<div id="wfs-result" class="wfs-result"><div class="wfs-empty">点击地图或选择操作获取坐标</div></div>' +
            '<div class="wfs-cursor-bar"><span class="wfs-cursor-label">🖱️ 光标</span><span id="wfs-cursor-coords" class="wfs-cursor-val">--, --</span></div>' +
            '</div>' +

            '<div class="wfs-sec">' +
            '<div class="wfs-sec-title">' +
            '📌 已保存标记 <span id="wfs-bm-count" class="wfs-count-badge">' + self.bookmarks.length + '</span>' +
            '<div style="float:right;display:flex;gap:8px">' +
            '<label class="wfs-bm-opt"><input type="checkbox" id="wfs-bm-show-markers" ' + (self.settings.showMarkers ? 'checked' : '') + '> 标记</label>' +
            '<label class="wfs-bm-opt"><input type="checkbox" id="wfs-bm-show-circles" ' + (self.settings.showCircles ? 'checked' : '') + '> 20m</label>' +
            '<label class="wfs-bm-opt"><input type="checkbox" id="wfs-bm-show-labels" ' + (self.settings.showLabels ? 'checked' : '') + '> 标题</label>' +
            '</div></div>' +
            '<div id="wfs-bookmarks-list" class="wfs-bookmarks-list"><div class="wfs-empty">暂无标记</div></div>' +
            '<div class="wfs-action-row">' +
            '<button id="wfs-add-bm-manual" class="wfs-btn wfs-btn-sm">📌 手动添加</button>' +
            '<button id="wfs-export-bm" class="wfs-btn wfs-btn-sm">📤 导出</button>' +
            '<button id="wfs-import-bm-btn" class="wfs-btn wfs-btn-sm">📥 导入</button>' +
            '<input type="file" id="wfs-import-bm-input" accept=".json" style="display:none">' +
            '<button id="wfs-import-url-btn" class="wfs-btn wfs-btn-sm">🔗 URL</button>' +
            '</div>' +
            '<div id="wfs-url-import-row" class="wfs-url-import-row" style="display:none">' +
            '<input type="text" id="wfs-import-url-input" class="wfs-input" placeholder="JSON URL...">' +
            '<button id="wfs-import-url-go" class="wfs-btn wfs-btn-sm wfs-btn-primary">📥</button>' +
            '</div></div>' +

            '<div class="wfs-sec">' +
            '<div class="wfs-sec-title">' +
            '📡 Wayfarer 提名 <span id="wfs-wf-count" class="wfs-count-badge">' + self.wayfarerNominations.length + '</span>' +
            '<div style="float:right;display:flex;gap:8px">' +
            '<label class="wfs-bm-opt"><input type="checkbox" id="wfs-wf-show" ' + (self.settings.showWayfarer ? 'checked' : '') + '> 显示</label>' +
            '</div></div>' +
            '<div class="wfs-wf-filters" id="wfs-wf-filters">' + filterHtml + '</div>' +
            '<div id="wfs-wayfarer-list" class="wfs-bookmarks-list"><div class="wfs-empty">暂无提名数据</div></div>' +
            '<div class="wfs-action-row">' +
            '<button id="wfs-wf-import-file-btn" class="wfs-btn wfs-btn-sm">📥 文件</button>' +
            '<input type="file" id="wfs-wf-import-file-input" accept=".json" style="display:none">' +
            '<button id="wfs-wf-import-url-btn" class="wfs-btn wfs-btn-sm">🔗 URL</button>' +
            '<button id="wfs-wf-sync-btn" class="wfs-btn wfs-btn-sm">☁️ 同步</button>' +
            '<button id="wfs-wf-export-btn" class="wfs-btn wfs-btn-sm">📤 导出</button>' +
            '<button id="wfs-wf-clear-btn" class="wfs-btn wfs-btn-sm wfs-btn-danger">🗑️</button>' +
            '</div>' +
            '<div id="wfs-wf-url-import-row" class="wfs-url-import-row" style="display:none">' +
            '<input type="text" id="wfs-wf-url-input" class="wfs-input" placeholder="提名数据URL...">' +
            '<button id="wfs-wf-url-go" class="wfs-btn wfs-btn-sm wfs-btn-primary">📡</button>' +
            '</div></div>' +

            '<div class="wfs-sec" style="text-align:center">' +
            '<button id="wfs-settings-btn" class="wfs-btn wfs-btn-sm">⚙️ 设置</button>' +
            '</div></div>';

        dialog({ html: html, title: '🛰️ Wayfarer Suite', width: 380, dialogClass: 'wfs-dialog' });

        setTimeout(function () {
            // Coordinate tools
            var pickBtn = document.getElementById('wfs-pick-btn');
            if (pickBtn) pickBtn.addEventListener('click', function () { if (self.isPickMode) self.exitPickMode(); else self.enterPickMode(); });
            var centerBtn = document.getElementById('wfs-center-btn');
            if (centerBtn) centerBtn.addEventListener('click', self.getMapCenter);
            var portalBtn = document.getElementById('wfs-portal-btn');
            if (portalBtn) portalBtn.addEventListener('click', self.getPortalCoords);
            var searchBtn = document.getElementById('wfs-search-btn');
            if (searchBtn) searchBtn.addEventListener('click', self.searchCoordinate);
            var searchInput = document.getElementById('wfs-search-input');
            if (searchInput) searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') self.searchCoordinate(); });
            map.on('mousemove', self.updateCursorCoords);

            // Bookmarks
            var addBm = document.getElementById('wfs-add-bm-manual');
            if (addBm) addBm.addEventListener('click', function () {
                if (self._lastPickedLat !== null) self.promptAddBookmark(self._lastPickedLat, self._lastPickedLng, self._lastPickedSource === '地图选取' ? '' : self._lastPickedSource);
                else { var c = map.getCenter(); self.promptAddBookmark(c.lat, c.lng, ''); }
            });
            var exportBm = document.getElementById('wfs-export-bm');
            if (exportBm) exportBm.addEventListener('click', function () { self.exportBookmarks(); });
            var importBtn = document.getElementById('wfs-import-bm-btn');
            var importInput = document.getElementById('wfs-import-bm-input');
            if (importBtn && importInput) { importBtn.addEventListener('click', function () { importInput.click(); }); importInput.addEventListener('change', function () { if (this.files.length) { self.importBookmarks(this.files[0]); this.value = ''; } }); }
            var urlBtn = document.getElementById('wfs-import-url-btn');
            var urlRow = document.getElementById('wfs-url-import-row');
            if (urlBtn && urlRow) urlBtn.addEventListener('click', function () { urlRow.style.display = urlRow.style.display === 'none' ? 'flex' : 'none'; });
            var urlGo = document.getElementById('wfs-import-url-go');
            var urlInput = document.getElementById('wfs-import-url-input');
            if (urlGo && urlInput) { urlGo.addEventListener('click', function () { self.importBookmarksFromUrl(urlInput.value.trim()); }); urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') self.importBookmarksFromUrl(this.value.trim()); }); }

            // Bookmark toggles
            var markersT = document.getElementById('wfs-bm-show-markers');
            if (markersT) markersT.addEventListener('change', function () { self.settings.showMarkers = this.checked; self.saveSettings(); Object.values(self.bookmarkMapMarkers).forEach(function (m) { if (self.settings.showMarkers) self.bookmarkLayerGroup.addLayer(m); else self.bookmarkLayerGroup.removeLayer(m); }); });
            var circlesT = document.getElementById('wfs-bm-show-circles');
            if (circlesT) circlesT.addEventListener('change', function () { self.settings.showCircles = this.checked; self.saveSettings(); Object.values(self.bookmarkMapCircles).forEach(function (c) { if (self.settings.showCircles) self.bookmarkLayerGroup.addLayer(c); else self.bookmarkLayerGroup.removeLayer(c); }); });
            var labelsT = document.getElementById('wfs-bm-show-labels');
            if (labelsT) labelsT.addEventListener('change', function () { self.settings.showLabels = this.checked; self.saveSettings(); self.bookmarks.forEach(function (bm) { var m = self.bookmarkMapMarkers[bm.id]; if (m) { m.unbindTooltip(); m.bindTooltip(self.esc(bm.name), { permanent: self.settings.showLabels, direction: 'right', offset: [8, 0], className: 'wfs-bm-tooltip' }); } }); });

            // Wayfarer
            var wfImport = document.getElementById('wfs-wf-import-file-btn');
            var wfInput = document.getElementById('wfs-wf-import-file-input');
            if (wfImport && wfInput) { wfImport.addEventListener('click', function () { wfInput.click(); }); wfInput.addEventListener('change', function () { if (this.files.length) { self.importWayfarerFromFile(this.files[0]); this.value = ''; } }); }
            var wfUrlBtn = document.getElementById('wfs-wf-import-url-btn');
            var wfUrlRow = document.getElementById('wfs-wf-url-import-row');
            if (wfUrlBtn && wfUrlRow) wfUrlBtn.addEventListener('click', function () { wfUrlRow.style.display = wfUrlRow.style.display === 'none' ? 'flex' : 'none'; });
            var wfUrlGo = document.getElementById('wfs-wf-url-go');
            var wfUrlInput = document.getElementById('wfs-wf-url-input');
            if (wfUrlGo && wfUrlInput) { wfUrlGo.addEventListener('click', function () { self.importWayfarerFromUrl(wfUrlInput.value.trim()); }); wfUrlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') self.importWayfarerFromUrl(this.value.trim()); }); }
            var wfSync = document.getElementById('wfs-wf-sync-btn');
            if (wfSync) wfSync.addEventListener('click', function () { self.importFromGoogleSheets(); });
            var wfExport = document.getElementById('wfs-wf-export-btn');
            if (wfExport) wfExport.addEventListener('click', function () { self.exportWayfarer(); });
            var wfClear = document.getElementById('wfs-wf-clear-btn');
            if (wfClear) wfClear.addEventListener('click', function () { if (confirm('确定清空所有提名数据？')) self.clearWayfarer(); });
            var wfShow = document.getElementById('wfs-wf-show');
            if (wfShow) wfShow.addEventListener('change', function () { self.settings.showWayfarer = this.checked; self.saveSettings(); if (self.settings.showWayfarer) self.renderAllWayfarer(); else { Object.keys(self.wayfarerLayers).forEach(function (k) { self.wayfarerLayers[k].layer.clearLayers(); }); Object.values(self.wayfarerMapCircles).forEach(function (cd) { if (cd.submit) map.removeLayer(cd.submit); if (cd.interact) map.removeLayer(cd.interact); }); Object.values(self.wayfarerPlottedCells).forEach(function (d) { map.removeLayer(d.polygon); }); self.wayfarerMapMarkers = {}; self.wayfarerMapCircles = {}; self.wayfarerPlottedCells = {}; } });
            var wfFilters = document.getElementById('wfs-wf-filters');
            if (wfFilters) wfFilters.querySelectorAll('[data-wf-filter]').forEach(function (cb) { cb.addEventListener('change', function () { self.settings.statusFilters[this.dataset.wfFilter] = this.checked; self.saveSettings(); self.renderAllWayfarer(); }); });

            // Settings
            var settingsBtn = document.getElementById('wfs-settings-btn');
            if (settingsBtn) settingsBtn.addEventListener('click', function () { self.openSettingsDialog(); });

            self.updateBookmarksUI();
            self.updateWayfarerUI();
        }, 100);
    };

    // ══════════════════════════════════════════════════════════
    //  CSS
    // ══════════════════════════════════════════════════════════

    self.injectStyles = function () {
        var css = '' +
            '.wfs-dialog .ui-dialog-titlebar{background:linear-gradient(135deg,#0f2027,#203a43,#2c5364)!important;border-bottom:1px solid #ffffff15!important}' +
            '.wfs-dialog .ui-dialog-title{color:#fff!important;font-weight:600!important;letter-spacing:.5px}' +
            '.wfs-dialog .ui-dialog-content{background:#0a1628!important;padding:0!important;scrollbar-width:thin;scrollbar-color:#2a3f5a #0a1628}' +
            '#wfs-panel{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#c0d0e0;font-size:12px}' +
            '.wfs-sec{padding:10px 14px;border-bottom:1px solid #ffffff08}.wfs-sec:last-child{border-bottom:none}' +
            '.wfs-sec-title{font-size:12px;font-weight:600;color:#5bbcf2;margin-bottom:8px;letter-spacing:.3px}' +
            '.wfs-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;background:linear-gradient(135deg,#1a2a3e,#1e3a52);border:1px solid #ffffff15;border-radius:6px;color:#8ecae6;font-size:11px;cursor:pointer;transition:all .2s}' +
            '.wfs-btn:hover{border-color:#5bbcf280;box-shadow:0 0 10px #5bbcf220;color:#fff}' +
            '.wfs-btn-primary{background:linear-gradient(135deg,#1e3a52,#0a4c7a)!important;border-color:#5bbcf240!important;color:#b8e2f8!important}' +
            '.wfs-btn-primary:hover{border-color:#5bbcf2!important;box-shadow:0 0 12px #5bbcf230!important}' +
            '.wfs-btn-danger{border-color:#f8717140!important;color:#fca5a5!important}' +
            '.wfs-btn-danger:hover{border-color:#f87171!important;box-shadow:0 0 10px #f8717130!important}' +
            '.wfs-btn-active{background:linear-gradient(135deg,#0a4c7a,#0967a0)!important;border-color:#5bbcf2!important;animation:wfs-pulse 1.5s infinite}' +
            '.wfs-btn-wide{width:100%;justify-content:center;padding:8px 12px;font-size:12px}' +
            '.wfs-btn-sm{padding:3px 8px;font-size:10px}' +
            '.wfs-btn-xs{padding:2px 5px;font-size:10px;border:none;background:transparent;cursor:pointer}.wfs-btn-xs:hover{transform:scale(1.2)}' +
            '.wfs-btn-row{display:flex;gap:6px;margin-top:6px}.wfs-action-group{display:flex;flex-direction:column;gap:4px}.wfs-action-row{margin-top:6px}' +
            '@keyframes wfs-pulse{0%,100%{box-shadow:0 0 8px #5bbcf230}50%{box-shadow:0 0 16px #5bbcf260}}' +
            '.wfs-search-row{display:flex;gap:6px;align-items:center}' +
            '.wfs-input{flex:1;padding:6px 10px;background:#0c1e33;border:1px solid #ffffff15;border-radius:6px;color:#d0e0f0;font-size:11px;font-family:inherit}' +
            '.wfs-input:focus{outline:none;border-color:#5bbcf250;box-shadow:0 0 8px #5bbcf215}.wfs-input::placeholder{color:#3a5070}' +
            '.wfs-result-card{background:#0c1e33;border:1px solid #5bbcf220;border-radius:8px;padding:10px;margin-bottom:6px}' +
            '.wfs-result-hdr{font-size:11px;color:#5bbcf2;margin-bottom:4px;font-weight:500}' +
            '.wfs-result-main{font-size:16px;font-weight:700;color:#fff;letter-spacing:.3px;margin-bottom:8px;font-family:"SF Mono",Consolas,Monaco,monospace}' +
            '.wfs-result-formats{display:flex;flex-direction:column;gap:2px}' +
            '.wfs-fmt-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;transition:background .15s}.wfs-fmt-row:hover{background:#ffffff08}' +
            '.wfs-fmt-label{font-size:10px;color:#5a7a94;min-width:40px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}' +
            '.wfs-fmt-val{font-size:11px;color:#aac4dd;font-family:"SF Mono",Consolas,Monaco,monospace;flex:1;word-break:break-all}.wfs-fmt-val:hover{color:#fff}' +
            '.wfs-fmt-link{color:#5bbcf2!important;cursor:pointer}.wfs-fmt-link:hover{text-decoration:underline}' +
            '.wfs-cursor-bar{display:flex;align-items:center;gap:6px;padding:5px 8px;background:#0c1e33;border-radius:6px;border:1px solid #ffffff08;margin-top:6px}' +
            '.wfs-cursor-label{font-size:10px;color:#5a7a94}.wfs-cursor-val{font-size:11px;font-family:"SF Mono",Consolas,Monaco,monospace;color:#8ecae6;letter-spacing:.3px}' +
            '.wfs-empty{text-align:center;color:#3a5070;padding:12px;font-style:italic;font-size:11px}' +
            '.wfs-result-actions{margin-top:8px;padding-top:6px;border-top:1px solid #ffffff08}' +
            '.wfs-btn-bookmark{background:linear-gradient(135deg,#2d1b4e,#4c1d95)!important;border-color:#a78bfa40!important;color:#c4b5fd!important;width:100%;justify-content:center}' +
            '.wfs-btn-bookmark:hover{border-color:#a78bfa!important;box-shadow:0 0 10px #a78bfa30!important}' +
            '.wfs-bookmarks-list{max-height:200px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#2a3f5a transparent}' +
            '.wfs-bm-item,.wfs-wf-item{display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #ffffff06;transition:background .15s}' +
            '.wfs-bm-item:hover,.wfs-wf-item:hover{background:#ffffff06}' +
            '.wfs-bm-item-main{display:flex;align-items:center;gap:6px;flex:1;min-width:0}' +
            '.wfs-bm-color-dot,.wfs-wf-status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}' +
            '.wfs-bm-item-name{font-size:11px;color:#c0d0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px}' +
            '.wfs-bm-item-coord{font-size:10px;font-family:"SF Mono",Consolas,Monaco,monospace;color:#5a7a94}' +
            '.wfs-bm-item-actions{display:flex;gap:2px;flex-shrink:0}' +
            '.wfs-count-badge{font-size:10px;color:#5bbcf2;background:#5bbcf215;padding:0 5px;border-radius:8px;margin-left:4px}' +
            '.wfs-url-import-row{display:flex;gap:6px;align-items:center;margin-top:6px}' +
            '.wfs-bm-opt{font-size:10px;font-weight:400;color:#888;cursor:pointer;display:flex;align-items:center;gap:3px}.wfs-bm-opt input{margin:0;vertical-align:middle}' +
            '.wfs-wf-status-tag{font-size:9px;font-weight:600;letter-spacing:.3px}' +
            '.wfs-bm-form{padding:14px;font-family:"Segoe UI",system-ui,sans-serif;color:#c0d0e0;font-size:12px}' +
            '.wfs-bm-form-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}' +
            '.wfs-bm-form-row label{min-width:36px;font-size:11px;color:#5a7a94;font-weight:600}' +
            '.wfs-color-picker{display:flex;gap:6px;flex-wrap:wrap}' +
            '.wfs-color-opt{cursor:pointer;display:flex;align-items:center}.wfs-color-opt input{display:none}' +
            '.wfs-color-dot{width:18px;height:18px;border-radius:50%;border:2px solid transparent;transition:all .15s;cursor:pointer}' +
            '.wfs-color-opt input:checked+.wfs-color-dot{border-color:#fff;transform:scale(1.2);box-shadow:0 0 8px rgba(255,255,255,.3)}' +
            '.wfs-color-opt:hover .wfs-color-dot{transform:scale(1.15)}.wfs-bm-form-actions{margin-top:12px}' +
            '.wfs-bm-icon{background:none!important;border:none!important}' +
            '.wfs-bm-dot-marker{width:12px;height:12px;border-radius:50%;border:1px solid #000;box-shadow:0 0 2px rgba(0,0,0,0.5)}' +
            '.wfs-bm-tooltip{background:rgba(0,0,0,0.7)!important;border:none!important;border-radius:4px!important;color:#fff!important;font-size:10px!important;padding:2px 5px!important;box-shadow:none!important}' +
            '.wfs-bm-tooltip::before{display:none!important}' +
            '.wfs-marker-icon{background:none!important;border:none!important}' +
            '.wfs-marker-pin{font-size:24px;text-shadow:0 2px 4px rgba(0,0,0,.5);animation:wfs-drop .3s ease-out}' +
            '@keyframes wfs-drop{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}' +
            '.wfs-popup-wrap .leaflet-popup-content-wrapper{background:linear-gradient(135deg,#1a2a3e,#0d1a2a)!important;border:1px solid #5bbcf240!important;border-radius:10px!important;box-shadow:0 4px 24px rgba(91,188,242,.15)!important}' +
            '.wfs-popup-wrap .leaflet-popup-tip{background:#1a2a3e!important;border:1px solid #5bbcf240!important}' +
            '.wfs-popup-wrap .leaflet-popup-close-button{color:#5bbcf2!important;font-size:16px!important}' +
            '.wfs-marker-popup{font-family:"Segoe UI",system-ui,sans-serif;color:#c0d0e0;min-width:160px}' +
            '.wfs-mp-title{font-size:12px;font-weight:600;color:#5bbcf2;margin-bottom:4px}' +
            '.wfs-mp-coord{font-size:14px;font-weight:700;color:#fff;font-family:"SF Mono",Consolas,Monaco,monospace;margin-bottom:8px}' +
            '.wfs-mp-actions{display:flex;gap:6px}' +
            '#wfs-toast{position:fixed;bottom:60px;left:50%;transform:translateX(-50%) translateY(10px);z-index:10000;padding:8px 18px;background:linear-gradient(135deg,#1e3a52,#0a4c7a);border:1px solid #5bbcf240;border-radius:8px;color:#e0f0ff;font-size:12px;font-family:"Segoe UI",system-ui,sans-serif;box-shadow:0 4px 20px rgba(91,188,242,.2);opacity:0;transition:all .3s ease;pointer-events:none;white-space:nowrap}' +
            '.wfs-wf-icon{background:none!important;border:none!important}' +
            '.wfs-wf-pin{line-height:0;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45))}' +
            '.wfs-wf-filters{display:flex;flex-wrap:wrap;gap:4px 8px;padding:4px 0 6px;border-bottom:1px solid #ffffff08}' +
            '.wfs-wf-filter-opt{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#8a9ab0;cursor:pointer;transition:color .15s}' +
            '.wfs-wf-filter-opt:hover{color:#c0d0e0}.wfs-wf-filter-opt input{margin:0;width:12px;height:12px;cursor:pointer}' +
            '.wfs-wf-filter-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}' +
            '.wfs-wf-popup-wrap .leaflet-popup-content{margin:0!important;padding:0!important}' +
            '.wfs-wf-popup{font-family:"Segoe UI",system-ui,sans-serif;color:#c0d0e0;font-size:12px;min-width:190px}' +
            '.wfs-wf-popup-row{padding:6px 12px 2px;display:flex;align-items:center;gap:8px}' +
            '.wfs-wf-popup-label{font-size:11px;font-weight:700;color:#8ecae6;letter-spacing:.3px}' +
            '.wfs-wf-select{flex:1;padding:4px 6px;background:#0c1e33;border:1px solid #5bbcf240;border-radius:4px;color:#e0f0ff;font-size:11px;cursor:pointer;outline:none}' +
            '.wfs-wf-select:focus{border-color:#5bbcf2}.wfs-wf-select option{background:#0c1e33;color:#e0f0ff}' +
            '.wfs-wf-popup-text{padding:1px 12px 4px;font-size:12px;color:#d0e0f0;word-break:break-all}' +
            '.wfs-wf-popup-desc{font-size:11px;color:#8a9ab0}.wfs-wf-popup-date{font-size:11px;color:#8a9ab0;margin-left:auto}' +
            '.wfs-wf-popup-img-wrap{padding:4px 12px 6px;text-align:center}' +
            '.wfs-wf-popup-img{max-width:100%;max-height:160px;border-radius:6px;border:1px solid #ffffff15;object-fit:cover}' +
            '.wfs-wf-send-btn{display:block;width:calc(100% - 24px);margin:4px 12px 6px;padding:7px 0;background:linear-gradient(135deg,#1e3a52,#0a4c7a);border:1px solid #5bbcf240;border-radius:6px;color:#b8e2f8;font-size:12px;font-weight:600;cursor:pointer;text-align:center;letter-spacing:.5px;transition:all .2s}' +
            '.wfs-wf-send-btn:hover{border-color:#5bbcf2;box-shadow:0 0 12px #5bbcf230;color:#fff}' +
            '.wfs-wf-popup-bottom{display:flex;justify-content:space-between;padding:6px 12px;border-top:1px solid #ffffff10}' +
            '.wfs-wf-bottom-link{font-size:11px;color:#5bbcf2;text-decoration:none;cursor:pointer;transition:color .15s}' +
            '.wfs-wf-bottom-link:hover{color:#fff;text-decoration:underline}' +
            '.wfs-wf-bottom-del{color:#fca5a5}.wfs-wf-bottom-del:hover{color:#f87171}';

        var s = document.createElement('style');
        s.id = 'wfs-styles';
        s.textContent = css;
        document.head.appendChild(s);
    };

    // ══════════════════════════════════════════════════════════
    //  BOOT
    // ══════════════════════════════════════════════════════════

    self.addToolboxLink = function () {
        if (typeof $ !== 'undefined' && $('#toolbox').length) {
            $('<a>').text('Wayfarer Suite').click(function (e) { e.preventDefault(); self.openDialog(); }).appendTo($('#toolbox'));
            console.log('[WFS] 已添加到 toolbox');
            return true;
        }
        var tb = document.getElementById('toolbox');
        if (tb) {
            var a = document.createElement('a');
            a.textContent = 'Wayfarer Suite';
            a.addEventListener('click', function (e) { e.preventDefault(); self.openDialog(); });
            tb.appendChild(a);
            return true;
        }
        return false;
    };

    self.setup = function () {
        self.injectStyles();
        self.migrateOldData();

        self.layerGroup = new L.LayerGroup();
        window.addLayerGroup('📍 坐标选取', self.layerGroup, true);
        self.bookmarkLayerGroup = new L.LayerGroup();
        window.addLayerGroup('📌 保存标记', self.bookmarkLayerGroup, true);

        if (!self.addToolboxLink()) {
            var retries = 0;
            var timer = setInterval(function () {
                if (self.addToolboxLink() || ++retries > 20) {
                    clearInterval(timer);
                    if (retries > 20) console.warn('[WFS] toolbox 未找到，请用 Alt+C 打开');
                }
            }, 500);
        }

        document.addEventListener('keydown', function (e) {
            if (e.altKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); self.openDialog(); }
            if (e.key === 'Escape' && self.isPickMode) self.exitPickMode();
        });

        self.loadSettings();
        self.loadBookmarks();
        self.loadWayfarerNominations();
        if (self.bookmarks.length > 0) setTimeout(function () { self.renderAllBookmarks(); }, 2000);
        if (self.wayfarerNominations.length > 0) setTimeout(function () { self.renderAllWayfarer(); }, 2500);

        console.log('[WFS] Wayfarer Suite v1.0.0 loaded');
    };

    var setup = self.setup;
    setup.info = plugin_info;
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded && typeof setup === 'function') setup();

}

// Inject
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
    info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
}
script.appendChild(document.createTextNode('(' + wrapper + ')(' + JSON.stringify(info) + ');'));
(document.body || document.head || document.documentElement).appendChild(script);
