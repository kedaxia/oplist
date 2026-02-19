// ==UserScript==
// @name         Wayfarer Exporter (with JSON Export)
// @version      0.12
// @description  Export nominations data from Wayfarer. Supports JSON file download for IITC import.
// @namespace    https://github.com/kedaxia
// @downloadURL  https://github.com/kedaxia/oplist/raw/refs/heads/main/wayfarer-exporter.user.js
// @updateURL    https://github.com/kedaxia/oplist/raw/refs/heads/main/wayfarer-exporter.user.js
// @match        https://opr.ingress.com/*
// ==/UserScript==

/* eslint-env es6 */
/* eslint no-var: "error" */

function init() {
    let tryNumber = 15

    const pendingUpdates = []
    let sendingUpdates = 0
    const maxSendingUpdates = 8
    let totalUpdates = 0
    let sentUpdates = 0

    let updateLog
    let logger
    let msgLog

        ; (function (open) {
            XMLHttpRequest.prototype.open = function (method, url) {
                if (url === '/api/v1/vault/manage') {
                    if (method === 'GET') {
                        this.addEventListener('load', parseNominations, false)
                    }
                }
                open.apply(this, arguments)
            }
        })(XMLHttpRequest.prototype.open)

    addConfigurationButton()

    let sentNominations
    function parseNominations(e) {
        try {
            const response = this.response
            const json = JSON.parse(response)
            const nominations = json && json.result && json.result.submissions
            if (!nominations) {
                logMessage('Failed to parse nominations from Wayfarer')
                return
            }
            sentNominations = nominations.filter(
                (nomination) => nomination.type === 'NOMINATION'
            )
            // Save raw nominations for JSON export
            localStorage['wayfarerexporter-raw-nominations'] = JSON.stringify(sentNominations)
            logMessage(`Loaded ${sentNominations.length} nominations.`)
            analyzeCandidates(sentNominations)
        } catch (e) {
            console.log(e)
        }
    }

    let currentCandidates
    function analyzeCandidates(result) {
        if (!sentNominations) {
            setTimeout(analyzeCandidates, 200)
            return
        }

        getAllCandidates().then(function (candidates) {
            if (!candidates) {
                return
            }

            currentCandidates = candidates
            logMessage(`Analyzing ${sentNominations.length} nominations.`)
            let modifiedCandidates = false
            sentNominations.forEach((nomination) => {
                if (checkNomination(nomination)) {
                    modifiedCandidates = true
                }
            })
            if (modifiedCandidates) {
                localStorage['wayfarerexporter-candidates'] =
                    JSON.stringify(currentCandidates)
            } else {
                logMessage('No modifications detected on the nominations.')
                logMessage('Closing in 5 secs.')
                setTimeout(removeLogger, 5 * 1000)
            }
        })
    }

    function checkNomination(nomination) {
        const id = nomination.id
        const existingCandidate = currentCandidates[id]

        if (existingCandidate) {
            if (nomination.status === 'ACCEPTED') {
                logMessage(`Approved candidate ${nomination.title}`)
                deleteCandidate(nomination)
                delete currentCandidates[id]
                return true
            }
            if (nomination.status === 'REJECTED') {
                rejectCandidate(nomination, existingCandidate)
                updateLocalCandidate(id, nomination)
                return true
            }
            if (nomination.status === 'DUPLICATE') {
                rejectCandidate(nomination, existingCandidate)
                delete currentCandidates[id]
                return true
            }
            if (nomination.status === 'WITHDRAWN') {
                rejectCandidate(nomination, existingCandidate)
                delete currentCandidates[id]
                return true
            }
            if (nomination.status === 'APPEALED') {
                updateLocalCandidate(id, nomination)
                appealCandidate(nomination, existingCandidate)
                return true
            }
            if (
                statusConvertor(nomination.status) !== existingCandidate.status
            ) {
                updateLocalCandidate(id, nomination)
                updateCandidate(nomination, 'status')
                return true
            }
            if (
                nomination.title !== existingCandidate.title ||
                nomination.description !== existingCandidate.description
            ) {
                currentCandidates[id].title = nomination.title
                currentCandidates[id].description = nomination.description
                updateCandidate(nomination, 'title or description')
                return true
            }
            return false
        }

        if (
            nomination.status === 'NOMINATED' ||
            nomination.status === 'VOTING' ||
            nomination.status === 'HELD' ||
            nomination.status === 'APPEALED' ||
            nomination.status === 'NIANTIC_REVIEW'
        ) {
            const cell17 = S2.S2Cell.FromLatLng(nomination, 17)
            const cell17id = cell17.toString()
            Object.keys(currentCandidates).forEach((idx) => {
                const candidate = currentCandidates[idx]
                if (
                    candidate.status === 'potential' &&
                    candidate.cell17id === cell17id &&
                    ((candidate.title === nomination.title &&
                        getDistance(candidate, nomination) < 10) ||
                        getDistance(candidate, nomination) < 3)
                ) {
                    logMessage(`Found manual candidate for ${candidate.title}`)
                    deleteCandidate({ id: idx })
                }
            })
            addCandidate(nomination)
            currentCandidates[nomination.id] = {
                cell17id: S2.S2Cell.FromLatLng(nomination, 17).toString(),
                title: nomination.title,
                description: nomination.description,
                lat: nomination.lat,
                lng: nomination.lng,
                status: statusConvertor(nomination.status)
            }
            return true
        }
        return false
    }

    function getDistance(p1, p2) {
        const rad = function (x) {
            return (x * Math.PI) / 180
        }
        const R = 6378137
        const dLat = rad(p2.lat - p1.lat)
        const dLong = rad(p2.lng - p1.lng)
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(p1.lat)) *
            Math.cos(rad(p2.lat)) *
            Math.sin(dLong / 2) *
            Math.sin(dLong / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

    function statusConvertor(status) {
        if (status === 'HELD') return 'held'
        if (status === 'NOMINATED') return 'submitted'
        if (status === 'VOTING') return 'voting'
        if (status === 'REJECTED' || status === 'DUPLICATE' || status === 'WITHDRAWN') return 'rejected'
        if (status === 'APPEALED') return 'appealed'
        if (status === 'NIANTIC_REVIEW') return 'NIANTIC_REVIEW'
        return status
    }

    function updateLocalCandidate(id, nomination) {
        currentCandidates[id].status = statusConvertor(nomination.status)
        currentCandidates[id].title = nomination.title
        currentCandidates[id].description = nomination.description
    }

    function addCandidate(nomination) {
        logMessage(`New candidate ${nomination.title}`)
        console.log('Tracking new nomination', nomination)
        updateStatus(nomination, statusConvertor(nomination.status))
    }

    function updateCandidate(nomination, change) {
        logMessage(`Updated candidate ${nomination.title} - changed ${change}`)
        console.log('Updated existing nomination', nomination)
        updateStatus(nomination, statusConvertor(nomination.status))
    }

    function deleteCandidate(nomination) {
        console.log('Deleting nomination', nomination)
        updateStatus(nomination, 'delete')
    }

    function rejectCandidate(nomination, existingCandidate) {
        if (existingCandidate.status === 'rejected') return
        logMessage(`Rejected nomination ${nomination.title}`)
        console.log('Rejected nomination', nomination)
        updateStatus(nomination, 'rejected')
    }

    function appealCandidate(nomination, existingCandidate) {
        if (existingCandidate.status === 'appealed') return
        logMessage(`Appealed nomination ${nomination.title}`)
        console.log('Appealed nomination', nomination)
        updateStatus(nomination, statusConvertor(nomination.status))
    }

    function updateStatus(nomination, newStatus) {
        const formData = new FormData()
        formData.retries = 3
        formData.append('status', newStatus)
        formData.append('id', nomination.id)
        formData.append('lat', nomination.lat)
        formData.append('lng', nomination.lng)
        formData.append('title', nomination.title)
        formData.append('description', nomination.description)
        formData.append('submitteddate', nomination.day)
        formData.append('candidateimageurl', nomination.imageUrl)
        getName()
            .then((name) => {
                formData.append('nickname', name)
            })
            .catch((error) => {
                console.log('Catched load name error', error)
                formData.append('nickname', 'wayfarer')
            })
            .finally(() => {
                pendingUpdates.push(formData)
                totalUpdates++
                sendUpdate()
            })
    }

    let name
    let nameLoadingTriggered = false
    function getName() {
        return new Promise(function (resolve, reject) {
            if (!nameLoadingTriggered) {
                nameLoadingTriggered = true
                const url = 'https://wayfarer.nianticlabs.com/api/v1/vault/properties'
                fetch(url)
                    .then((response) => {
                        response.json().then((json) => {
                            name = json.result.socialProfile.name
                            logMessage(`Loaded name ${name}`)
                            resolve(name)
                        })
                    })
                    .catch((error) => {
                        console.log('Catched fetch error', error)
                        logMessage('Loading name failed. Using wayfarer')
                        name = 'wayfarer'
                        resolve(name)
                    })
            } else {
                const loop = () =>
                    name !== undefined ? resolve(name) : setTimeout(loop, 2000)
                loop()
            }
        })
    }

    function sendUpdate() {
        updateProgressLog()
        if (sendingUpdates >= maxSendingUpdates) return
        if (pendingUpdates.length === 0) return

        sentUpdates++
        sendingUpdates++
        updateProgressLog()

        const formData = pendingUpdates.shift()
        const options = { method: 'POST', body: formData }

        fetch(getUrl(), options)
            .then((data) => { })
            .catch((error) => {
                console.log('Catched fetch error', error)
                logMessage(error)
                formData.retries--
                if (formData.retries > 0) {
                    pendingUpdates.push(formData)
                }
            })
            .finally(() => {
                sendingUpdates--
                sendUpdate()
            })
    }

    function updateProgressLog() {
        const count = pendingUpdates.length
        if (count === 0) {
            updateLog.textContent = 'All updates sent.'
        } else {
            updateLog.textContent = `Sending ${sentUpdates}/${totalUpdates} updates to the spreadsheet.`
        }
    }

    function getUrl() {
        return localStorage['wayfarerexporter-url']
    }

    // ── JSON Export for IITC ──────────────────────────────
    const STATUS_MAP = {
        submitted: { label: '已提交', icon: '🟡', color: '#f1c40f' },
        voting: { label: '投票中', icon: '🔵', color: '#3498db' },
        held: { label: '搁置', icon: '🟠', color: '#e67e22' },
        appealed: { label: '已申诉', icon: '🟣', color: '#9b59b6' },
        rejected: { label: '被拒绝', icon: '🔴', color: '#e74c3c' },
        NIANTIC_REVIEW: { label: 'N审核', icon: '🔷', color: '#1abc9c' },
        potential: { label: '候选', icon: '⚪', color: '#95a5a6' },
    }

    function getAllNominations() {
        // Try raw nominations first (full data from API)
        let rawStr = localStorage['wayfarerexporter-raw-nominations']
        let nominations = null

        if (rawStr) {
            try {
                const rawNoms = JSON.parse(rawStr)
                nominations = rawNoms.map((nom) => ({
                    id: nom.id,
                    title: nom.title || '',
                    description: nom.description || '',
                    lat: nom.lat,
                    lng: nom.lng,
                    status: statusConvertor(nom.status),
                    imageUrl: nom.imageUrl || '',
                    day: nom.day || '',
                }))
            } catch (e) {
                console.warn('Failed to parse raw nominations', e)
            }
        }

        // Fallback: use cached candidates
        if (!nominations || nominations.length === 0) {
            const candidateStr = localStorage['wayfarerexporter-candidates']
            if (candidateStr) {
                try {
                    const candidates = JSON.parse(candidateStr)
                    nominations = Object.keys(candidates).map((id) => {
                        const c = candidates[id]
                        return {
                            id: id,
                            title: c.title || '',
                            description: c.description || '',
                            lat: c.lat,
                            lng: c.lng,
                            status: c.status || 'submitted',
                        }
                    })
                } catch (e) {
                    console.warn('Failed to parse candidates', e)
                }
            }
        }

        return nominations || []
    }

    function showExportDialog() {
        const nominations = getAllNominations()
        if (nominations.length === 0) {
            alert('没有可导出的提名数据。请先打开"管理提名"页面加载数据。')
            return
        }

        // Count per status
        const statusCounts = {}
        Object.keys(STATUS_MAP).forEach((k) => { statusCounts[k] = 0 })
        nominations.forEach((n) => {
            if (statusCounts[n.status] !== undefined) statusCounts[n.status]++
            else statusCounts[n.status] = (statusCounts[n.status] || 0) + 1
        })

        // Build dialog
        const overlay = document.createElement('div')
        overlay.className = 'wfe-overlay'

        const dialog = document.createElement('div')
        dialog.className = 'wfe-dialog'

        let checkboxesHtml = ''
        Object.keys(STATUS_MAP).forEach((key) => {
            const si = STATUS_MAP[key]
            const count = statusCounts[key] || 0
            if (count === 0) return // skip statuses with 0 nominations
            checkboxesHtml += `
                <label class="wfe-filter-item">
                    <input type="checkbox" data-status="${key}" checked>
                    <span class="wfe-filter-dot" style="background:${si.color}"></span>
                    ${si.icon} ${si.label}
                    <span class="wfe-filter-count">(${count})</span>
                </label>`
        })

        dialog.innerHTML = `
            <div class="wfe-dialog-title">📥 导出提名 JSON</div>
            <div class="wfe-dialog-subtitle">选择要导出的状态类型：</div>
            <div class="wfe-filter-row">
                <label class="wfe-filter-item wfe-select-all">
                    <input type="checkbox" id="wfe-select-all" checked>
                    <strong>全选</strong>
                </label>
            </div>
            <div class="wfe-filter-list">${checkboxesHtml}</div>
            <div class="wfe-dialog-info">
                已选中 <strong id="wfe-selected-count">${nominations.length}</strong> / ${nominations.length} 个提名
            </div>
            <div class="wfe-dialog-actions">
                <button class="wfe-btn wfe-btn-cancel" id="wfe-cancel">取消</button>
                <button class="wfe-btn wfe-btn-export" id="wfe-do-export">📥 导出</button>
            </div>`

        overlay.appendChild(dialog)
        document.body.appendChild(overlay)

        // Event: select all
        const selectAllCb = dialog.querySelector('#wfe-select-all')
        const statusCbs = dialog.querySelectorAll('[data-status]')
        const countEl = dialog.querySelector('#wfe-selected-count')

        function updateCount() {
            const checkedStatuses = new Set()
            statusCbs.forEach((cb) => { if (cb.checked) checkedStatuses.add(cb.dataset.status) })
            const total = nominations.filter((n) => checkedStatuses.has(n.status)).length
            countEl.textContent = total
        }

        selectAllCb.addEventListener('change', () => {
            statusCbs.forEach((cb) => { cb.checked = selectAllCb.checked })
            updateCount()
        })

        statusCbs.forEach((cb) => {
            cb.addEventListener('change', () => {
                const allChecked = Array.from(statusCbs).every((c) => c.checked)
                selectAllCb.checked = allChecked
                updateCount()
            })
        })

        // Event: cancel
        dialog.querySelector('#wfe-cancel').addEventListener('click', () => {
            document.body.removeChild(overlay)
        })
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) document.body.removeChild(overlay)
        })

        // Event: export
        dialog.querySelector('#wfe-do-export').addEventListener('click', () => {
            const checkedStatuses = new Set()
            statusCbs.forEach((cb) => { if (cb.checked) checkedStatuses.add(cb.dataset.status) })
            const filtered = nominations.filter((n) => checkedStatuses.has(n.status))

            if (filtered.length === 0) {
                alert('未选择任何状态类型，无法导出。')
                return
            }

            const jsonStr = JSON.stringify(filtered, null, 2)
            const blob = new Blob([jsonStr], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'wayfarer-nominations-' + new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '') + '.json'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            logMessage(`导出 ${filtered.length} 个提名为 JSON 文件`)
            document.body.removeChild(overlay)
        })
    }

    function addConfigurationButton() {
        const ref = document.querySelector('.sidebar-link[href$="nominations"]')

        if (!ref) {
            if (tryNumber === 0) {
                document
                    .querySelector('body')
                    .insertAdjacentHTML(
                        'afterBegin',
                        '<div class="alert alert-danger"><strong><span class="glyphicon glyphicon-remove"></span> Wayfarer Exporter initialization failed, refresh page</strong></div>'
                    )
                return
            }
            setTimeout(addConfigurationButton, 1000)
            tryNumber--
            return
        }

        addCss()

        // Exporter link (original)
        const link = document.createElement('a')
        link.className = 'mat-tooltip-trigger sidebar-link sidebar-wayfarerexporter'
        link.title = 'Configure Exporter'
        link.innerHTML = '<svg viewBox="0 0 24 24" class="sidebar-link__icon"><path d="M12,1L8,5H11V14H13V5H16M18,23H6C4.89,23 4,22.1 4,21V9A2,2 0 0,1 6,7H9V9H6V21H18V9H15V7H18A2,2 0 0,1 20,9V21A2,2 0 0,1 18,23Z" /></svg><span> Exporter</span>'
        ref.parentNode.insertBefore(link, ref.nextSibling)

        link.addEventListener('click', function (e) {
            e.preventDefault()
            const currentUrl = getUrl()
            const url = window.prompt('Script Url for Wayfarer Planner', currentUrl)
            if (!url) return
            loadPlannerData(url).then(analyzeCandidates)
        })

        // JSON Export link (NEW)
        const exportLink = document.createElement('a')
        exportLink.className = 'mat-tooltip-trigger sidebar-link sidebar-wayfarerexporter'
        exportLink.title = '导出提名为 JSON (用于 IITC 导入)'
        exportLink.innerHTML = '<svg viewBox="0 0 24 24" class="sidebar-link__icon"><path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" /></svg><span> 📥 导出JSON</span>'
        link.parentNode.insertBefore(exportLink, link.nextSibling)

        exportLink.addEventListener('click', function (e) {
            e.preventDefault()
            showExportDialog()
        })
    }

    function addCss() {
        const css = `
            .sidebar-wayfarerexporter svg {
                width: 24px;
                height: 24px;
                filter: none;
                fill: currentColor;
            }

            .wayfarer-exporter_log {
                background: #fff;
                box-shadow: 0 2px 5px 0 rgba(0, 0, 0, .16), 0 2px 10px 0 rgba(0, 0, 0, .12);
                display: flex;
                flex-direction: column;
                max-height: 100%;
                padding: 5px;
                position: absolute;
                top: 0;
                z-index: 2;
            }
            .wayfarer-exporter_log h3 {
                margin-right: 1em;
                margin-top: 0;
            }
            .wayfarer-exporter_closelog {
                cursor: pointer;
                position: absolute;
                right: 0;
            }
            .wayfarer-exporter_log-wrapper {
                overflow: auto;
            }

            /* ── Export Dialog ──────────────────────────── */
            .wfe-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.55);
                z-index: 10000;
                display: flex; align-items: center; justify-content: center;
            }
            .wfe-dialog {
                background: #1a2a3a;
                border: 1px solid #5bbcf240;
                border-radius: 12px;
                padding: 20px;
                min-width: 300px;
                max-width: 380px;
                color: #c0d0e0;
                font-family: 'Segoe UI', system-ui, sans-serif;
                box-shadow: 0 8px 32px rgba(0,0,0,.5);
            }
            .wfe-dialog-title {
                font-size: 16px;
                font-weight: 700;
                color: #e0f0ff;
                margin-bottom: 4px;
            }
            .wfe-dialog-subtitle {
                font-size: 12px;
                color: #8a9ab0;
                margin-bottom: 12px;
            }
            .wfe-filter-row {
                margin-bottom: 6px;
                padding-bottom: 6px;
                border-bottom: 1px solid #ffffff10;
            }
            .wfe-filter-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-bottom: 12px;
                max-height: 260px;
                overflow-y: auto;
            }
            .wfe-filter-item {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                cursor: pointer;
                padding: 4px 6px;
                border-radius: 6px;
                transition: background 0.15s;
            }
            .wfe-filter-item:hover {
                background: #ffffff08;
            }
            .wfe-filter-item input {
                margin: 0;
                width: 14px;
                height: 14px;
                cursor: pointer;
            }
            .wfe-filter-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            .wfe-filter-count {
                color: #8a9ab0;
                font-size: 11px;
                margin-left: auto;
            }
            .wfe-dialog-info {
                font-size: 12px;
                color: #8a9ab0;
                margin-bottom: 14px;
                text-align: center;
            }
            .wfe-dialog-info strong { color: #5bbcf2; }
            .wfe-dialog-actions {
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }
            .wfe-btn {
                padding: 8px 18px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                border: 1px solid transparent;
                transition: all 0.2s;
            }
            .wfe-btn-cancel {
                background: transparent;
                color: #8a9ab0;
                border-color: #ffffff15;
            }
            .wfe-btn-cancel:hover { color: #c0d0e0; border-color: #ffffff30; }
            .wfe-btn-export {
                background: linear-gradient(135deg, #1e6a9a, #0a7cba);
                color: #e0f0ff;
                border-color: #5bbcf240;
            }
            .wfe-btn-export:hover {
                box-shadow: 0 0 12px #5bbcf230;
                color: #fff;
            }
            `
        const style = document.createElement('style')
        style.type = 'text/css'
        style.innerHTML = css
        document.querySelector('head').appendChild(style)
    }

    function getAllCandidates() {
        const promesa = new Promise(function (resolve, reject) {
            const storedData = localStorage['wayfarerexporter-candidates']
            const lastUpdate = localStorage['wayfarerexporter-lastupdate'] || 0
            const now = new Date().getTime()
            if (!storedData || now - lastUpdate > 12 * 60 * 60 * 1000) {
                resolve(loadPlannerData())
                return
            }
            resolve(JSON.parse(storedData))
        })
        return promesa
    }

    function loadPlannerData(newUrl) {
        let url = newUrl || getUrl()
        if (!url) {
            url = window.prompt('Script Url for Wayfarer Planner')
            if (!url) return null
        }
        if (!url.startsWith('https://script.google.com/macros/')) {
            alert('The url of the script seems to be wrong, please paste the URL provided after "creating the webapp"')
            return null
        }
        if (url.includes('echo') || !url.endsWith('exec')) {
            alert('You must use the short URL provided by "creating the webapp", not the long one after executing the script.')
            return null
        }
        if (url.includes(' ')) {
            alert("Warning, the URL contains at least one space. Check that you've copied it properly.")
            return null
        }
        const fetchOptions = { method: 'GET' }

        return fetch(url, fetchOptions)
            .then(function (response) {
                return response.text()
            })
            .then(function (data) {
                return JSON.parse(data)
            })
            .then(function (allData) {
                const submitted = allData.filter(
                    (c) =>
                        c.status === 'submitted' ||
                        c.status === 'voting' ||
                        c.status === 'NIANTIC_REVIEW' ||
                        c.status === 'potential' ||
                        c.status === 'held' ||
                        c.status === 'rejected' ||
                        c.status === 'appealed'
                )

                const candidates = {}
                submitted.forEach((c) => {
                    candidates[c.id] = {
                        cell17id: S2.S2Cell.FromLatLng(c, 17).toString(),
                        title: c.title,
                        description: c.description,
                        lat: c.lat,
                        lng: c.lng,
                        status: c.status
                    }
                })
                localStorage['wayfarerexporter-url'] = url
                localStorage['wayfarerexporter-lastupdate'] = new Date().getTime()
                localStorage['wayfarerexporter-candidates'] = JSON.stringify(candidates)
                const tracked = Object.keys(candidates).length
                logMessage(`Loaded a total of ${allData.length} candidates from the spreadsheet.`)
                logMessage(`Currently tracking: ${tracked}.`)

                return candidates
            })
            .catch(function (e) {
                console.log(e)
                alert(
                    "Wayfarer Planner. Failed to retrieve data from the scriptURL.\r\nVerify that you're using the right URL and that you don't use any extension that blocks access to google."
                )
                return null
            })
    }

    function removeLogger() {
        logger.parentNode.removeChild(logger)
        logger = null
    }

    function logMessage(txt) {
        if (!logger) {
            logger = document.createElement('div')
            logger.className = 'wayfarer-exporter_log'
            document.body.appendChild(logger)
            const img = document.createElement('img')
            img.src = '/img/sidebar/clear-24px.svg'
            img.className = 'wayfarer-exporter_closelog'
            img.height = 24
            img.width = 24
            img.addEventListener('click', removeLogger)
            logger.appendChild(img)
            const title = document.createElement('h3')
            title.textContent = 'Wayfarer exporter'
            logger.appendChild(title)

            updateLog = document.createElement('div')
            updateLog.className = 'wayfarer-exporter_log-counter'
            logger.appendChild(updateLog)

            msgLog = document.createElement('div')
            msgLog.className = 'wayfarer-exporter_log-wrapper'
            logger.appendChild(msgLog)
        }
        const div = document.createElement('div')
        div.textContent = txt
        msgLog.appendChild(div)
    }

    /**
     S2 extracted from Regions Plugin
     https:static.iitc.me/build/release/plugins/regions.user.js
    */
    const S2 = {}
    const d2r = Math.PI / 180.0

    function LatLngToXYZ(latLng) {
        const phi = latLng.lat * d2r
        const theta = latLng.lng * d2r
        const cosphi = Math.cos(phi)
        return [
            Math.cos(theta) * cosphi,
            Math.sin(theta) * cosphi,
            Math.sin(phi)
        ]
    }

    function largestAbsComponent(xyz) {
        const temp = [Math.abs(xyz[0]), Math.abs(xyz[1]), Math.abs(xyz[2])]
        if (temp[0] > temp[1]) {
            if (temp[0] > temp[2]) return 0
            return 2
        }
        if (temp[1] > temp[2]) return 1
        return 2
    }

    function faceXYZToUV(face, xyz) {
        let u, v
        switch (face) {
            case 0: u = xyz[1] / xyz[0]; v = xyz[2] / xyz[0]; break
            case 1: u = -xyz[0] / xyz[1]; v = xyz[2] / xyz[1]; break
            case 2: u = -xyz[0] / xyz[2]; v = -xyz[1] / xyz[2]; break
            case 3: u = xyz[2] / xyz[0]; v = xyz[1] / xyz[0]; break
            case 4: u = xyz[2] / xyz[1]; v = -xyz[0] / xyz[1]; break
            case 5: u = -xyz[1] / xyz[2]; v = -xyz[0] / xyz[2]; break
            default: throw { error: 'Invalid face' }
        }
        return [u, v]
    }

    function XYZToFaceUV(xyz) {
        let face = largestAbsComponent(xyz)
        if (xyz[face] < 0) face += 3
        const uv = faceXYZToUV(face, xyz)
        return [face, uv]
    }

    function UVToST(uv) {
        const singleUVtoST = function (uv) {
            if (uv >= 0) return 0.5 * Math.sqrt(1 + 3 * uv)
            return 1 - 0.5 * Math.sqrt(1 - 3 * uv)
        }
        return [singleUVtoST(uv[0]), singleUVtoST(uv[1])]
    }

    function STToIJ(st, order) {
        const maxSize = 1 << order
        const singleSTtoIJ = function (st) {
            const ij = Math.floor(st * maxSize)
            return Math.max(0, Math.min(maxSize - 1, ij))
        }
        return [singleSTtoIJ(st[0]), singleSTtoIJ(st[1])]
    }

    S2.S2Cell = function () { }

    S2.S2Cell.FromLatLng = function (latLng, level) {
        const xyz = LatLngToXYZ(latLng)
        const faceuv = XYZToFaceUV(xyz)
        const st = UVToST(faceuv[1])
        const ij = STToIJ(st, level)
        return S2.S2Cell.FromFaceIJ(faceuv[0], ij, level)
    }

    S2.S2Cell.FromFaceIJ = function (face, ij, level) {
        const cell = new S2.S2Cell()
        cell.face = face
        cell.ij = ij
        cell.level = level
        return cell
    }

    S2.S2Cell.prototype.toString = function () {
        return (
            'F' + this.face + 'ij[' + this.ij[0] + ',' + this.ij[1] + ']@' + this.level
        )
    }
}

init()
