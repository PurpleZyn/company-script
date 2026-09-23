// ==UserScript==
// @name         Torn Company Command Center
// @namespace    https://github.com/PurpleZyn/company-script
// @version      0.1.0
// @description  Director dashboard for Torn companies: finances, employees, training rotation, eDVD dues, stock, and history.
// @author       PurpleZyn
// @match        https://www.torn.com/*
// @connect      api.torn.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/PurpleZyn/company-script/main/company-command-center.user.js
// @downloadURL  https://raw.githubusercontent.com/PurpleZyn/company-script/main/company-command-center.user.js
// ==/UserScript==

(function () {
    'use strict';

    const APP = {
        name: 'Company Command Center',
        version: '0.1.0',
        storagePrefix: 'tccc_',
        apiBase: 'https://api.torn.com/v2',
        comment: 'company-command-center'
    };

    const state = {
        open: false,
        activeTab: 'overview',
        loading: false,
        error: '',
        profile: null,
        employees: [],
        stock: [],
        trainingNews: [],
        snapshots: {},
        dues: {},
        settings: {
            apiKey: '',
            edvdQty: 1,
            dueDay: 1,
            excludeDirector: true,
            extraDailyCost: 0
        }
    };

    const money = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    });

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function num(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function tctDay(timestamp) {
        const d = timestamp ? new Date(timestamp * 1000) : new Date();
        return d.toISOString().slice(0, 10);
    }

    function currentMonth() {
        return new Date().toISOString().slice(0, 7);
    }

    function formatDate(timestamp) {
        if (!timestamp) return 'Never / unknown';
        return new Date(timestamp * 1000).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function formatAge(timestamp) {
        if (!timestamp) return 'No recent train';
        const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
        const days = Math.floor(seconds / 86400);
        if (days > 0) return days + 'd ago';
        const hours = Math.floor(seconds / 3600);
        if (hours > 0) return hours + 'h ago';
        return Math.floor(seconds / 60) + 'm ago';
    }

    function getNativeStore() {
        return {
            get: function (key, fallback) {
                try {
                    if (typeof GM_getValue === 'function') return GM_getValue(APP.storagePrefix + key, fallback);
                } catch (e) {}
                try {
                    const raw = localStorage.getItem(APP.storagePrefix + key);
                    return raw == null ? fallback : JSON.parse(raw);
                } catch (e) {
                    return fallback;
                }
            },
            set: function (key, value) {
                try {
                    if (typeof GM_setValue === 'function') {
                        GM_setValue(APP.storagePrefix + key, value);
                        return;
                    }
                } catch (e) {}
                localStorage.setItem(APP.storagePrefix + key, JSON.stringify(value));
            }
        };
    }

    const store = getNativeStore();

    function loadLocalState() {
        const savedSettings = store.get('settings', {});
        state.settings = Object.assign({}, state.settings, savedSettings || {});
        state.snapshots = store.get('snapshots', {}) || {};
        state.dues = store.get('dues', {}) || {};
    }

    function saveSettings() {
        store.set('settings', state.settings);
    }

    function saveSnapshots() {
        store.set('snapshots', state.snapshots);
    }

    function saveDues() {
        store.set('dues', state.dues);
    }

    function apiGet(path, params) {
        params = params || {};
        if (!state.settings.apiKey) return Promise.reject(new Error('Add your Torn API key in Settings first.'));

        const query = new URLSearchParams();
        Object.keys(params).forEach(function (key) {
            if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
                query.set(key, params[key]);
            }
        });
        query.set('key', state.settings.apiKey.trim());
        query.set('comment', APP.comment);

        const url = APP.apiBase + path + '?' + query.toString();

        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise(function (resolve, reject) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 20000,
                    onload: function (response) {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data && data.error) {
                                reject(new Error(data.error.error || 'Torn API error'));
                                return;
                            }
                            resolve(data);
                        } catch (e) {
                            reject(new Error('Could not parse Torn API response.'));
                        }
                    },
                    onerror: function () { reject(new Error('Could not reach the Torn API.')); },
                    ontimeout: function () { reject(new Error('Torn API request timed out.')); }
                });
            });
        }

        return fetch(url, { credentials: 'omit' })
            .then(function (response) {
                if (!response.ok) throw new Error('Torn API HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                if (data && data.error) throw new Error(data.error.error || 'Torn API error');
                return data;
            });
    }

    function calculateTrainingMap() {
        const map = {};
        state.employees.forEach(function (employee) {
            map[String(employee.id)] = { last: 0, count: 0 };
        });

        state.trainingNews.forEach(function (entry) {
            const holder = document.createElement('div');
            holder.innerHTML = entry.text || '';
            const plain = (holder.textContent || '').toLowerCase();

            state.employees.forEach(function (employee) {
                const name = String(employee.name || '').toLowerCase();
                if (!name || plain.indexOf(name) === -1) return;
                const record = map[String(employee.id)];
                record.count += 1;
                record.last = Math.max(record.last, num(entry.timestamp));
            });
        });

        return map;
    }

    function financeSummary() {
        const revenue = num(state.profile && state.profile.income && state.profile.income.daily);
        const wages = state.employees.reduce(function (total, employee) {
            return total + num(employee.wage);
        }, 0);
        const advertising = num(state.profile && state.profile.advertisement_budget);
        const cogs = state.stock.reduce(function (total, item) {
            return total + (num(item.sold_amount) * num(item.cost));
        }, 0);
        const extra = num(state.settings.extraDailyCost);
        const expenses = wages + advertising + cogs + extra;
        return {
            revenue: revenue,
            wages: wages,
            advertising: advertising,
            cogs: cogs,
            extra: extra,
            expenses: expenses,
            net: revenue - expenses
        };
    }

    function saveTodaySnapshot() {
        if (!state.profile) return;
        const f = financeSummary();
        const key = tctDay();
        state.snapshots[key] = {
            capturedAt: Math.floor(Date.now() / 1000),
            revenue: f.revenue,
            wages: f.wages,
            advertising: f.advertising,
            cogs: f.cogs,
            extra: f.extra,
            expenses: f.expenses,
            net: f.net,
            funds: num(state.profile.funds),
            rating: num(state.profile.rating)
        };

        const keys = Object.keys(state.snapshots).sort();
        while (keys.length > 180) {
            delete state.snapshots[keys.shift()];
        }
        saveSnapshots();
    }

    async function refreshData() {
        if (!state.settings.apiKey) {
            state.error = 'Add your Torn API key in Settings to connect the dashboard.';
            render();
            return;
        }

        state.loading = true;
        state.error = '';
        render();

        try {
            const results = await Promise.all([
                apiGet('/company/profile'),
                apiGet('/company/employees'),
                apiGet('/company/stock'),
                apiGet('/company/news', { cat: 'training', limit: 100, sort: 'DESC' })
            ]);

            state.profile = results[0].profile || null;
            state.employees = Array.isArray(results[1].employees) ? results[1].employees : [];
            state.stock = Array.isArray(results[2].stock) ? results[2].stock : [];
            state.trainingNews = Array.isArray(results[3].news) ? results[3].news : [];
            saveTodaySnapshot();
        } catch (e) {
            state.error = e && e.message ? e.message : String(e);
        } finally {
            state.loading = false;
            render();
        }
    }

    function monthLedger(month) {
        if (!state.dues[month]) state.dues[month] = {};
        return state.dues[month];
    }

    function isDirector(employee) {
        if (!state.profile || !state.profile.director) return false;
        return String(employee.id) === String(state.profile.director.id);
    }

    function duesEmployees() {
        return state.employees.filter(function (employee) {
            return !(state.settings.excludeDirector && isDirector(employee));
        });
    }

    function toggleDue(employeeId) {
        const month = currentMonth();
        const ledger = monthLedger(month);
        const key = String(employeeId);
        if (ledger[key] && ledger[key].paid) {
            ledger[key] = { paid: false, paidAt: null, method: '' };
        } else {
            ledger[key] = {
                paid: true,
                paidAt: Math.floor(Date.now() / 1000),
                method: state.settings.edvdQty + ' eDVD'
            };
        }
        saveDues();
        render();
    }

    function cards(items) {
        return '<div class="tccc-cards">' + items.map(function (item) {
            return '<div class="tccc-card ' + (item.className || '') + '">' +
                '<div class="tccc-card-label">' + esc(item.label) + '</div>' +
                '<div class="tccc-card-value">' + esc(item.value) + '</div>' +
                (item.sub ? '<div class="tccc-card-sub">' + esc(item.sub) + '</div>' : '') +
                '</div>';
        }).join('') + '</div>';
    }

    function overviewHtml() {
        if (!state.profile) return emptyConnectHtml();

        const f = financeSummary();
        const training = calculateTrainingMap();
        const rotation = state.employees
            .filter(function (e) { return !isDirector(e); })
            .slice()
            .sort(function (a, b) {
                return num(training[String(a.id)] && training[String(a.id)].last) -
                    num(training[String(b.id)] && training[String(b.id)].last);
            });

        const next = rotation[0];
        const ledger = monthLedger(currentMonth());
        const dueList = duesEmployees();
        const unpaid = dueList.filter(function (e) {
            return !(ledger[String(e.id)] && ledger[String(e.id)].paid);
        });

        const warningEmployees = state.employees.filter(function (e) {
            const eff = e.effectiveness || {};
            return num(eff.addiction) < 0 || num(eff.inactivity) < 0;
        });

        let html = cards([
            {
                label: 'Estimated Net Today',
                value: money.format(f.net),
                sub: 'Revenue minus tracked operating costs',
                className: f.net >= 0 ? 'good' : 'bad'
            },
            {
                label: 'Daily Revenue',
                value: money.format(f.revenue),
                sub: 'Torn-reported company income'
            },
            {
                label: 'Tracked Expenses',
                value: money.format(f.expenses),
                sub: 'Wages + ads + estimated COGS + manual costs'
            },
            {
                label: 'Company Funds',
                value: money.format(num(state.profile.funds)),
                sub: num(state.profile.rating) + '★ ' + ((state.profile.type && state.profile.type.name) || 'Company')
            }
        ]);

        html += '<div class="tccc-grid2">';
        html += '<section class="tccc-panel"><h3>What needs attention</h3>';
        html += '<div class="tccc-attention">';
        html += '<button data-tabgo="training"><strong>' + (next ? esc(next.name) : 'Nobody') + '</strong><span>Next in training rotation</span></button>';
        html += '<button data-tabgo="dues"><strong>' + unpaid.length + '</strong><span>Unpaid for ' + esc(currentMonth()) + '</span></button>';
        html += '<button data-tabgo="employees"><strong>' + warningEmployees.length + '</strong><span>Employee effectiveness warnings</span></button>';
        html += '<button data-tabgo="stock"><strong>' + state.stock.filter(function (i) { return num(i.sold_amount) > 0 && num(i.in_stock) / num(i.sold_amount) < 2; }).length + '</strong><span>Possible low-stock items</span></button>';
        html += '</div></section>';

        html += '<section class="tccc-panel"><h3>Company health</h3><div class="tccc-health">';
        html += healthRow('Efficiency', state.profile.efficiency);
        html += healthRow('Environment', state.profile.environment);
        html += healthRow('Popularity', state.profile.popularity);
        html += healthRow('Available trains', state.profile.trains, true);
        html += '</div></section></div>';

        html += '<div class="tccc-note">Profit is currently an operating estimate: Torn revenue − wages − advertising − estimated stock cost of goods sold − your manual daily costs. We will tighten this further as transaction-level tracking is added.</div>';
        return html;
    }

    function healthRow(label, value, raw) {
        const n = num(value);
        const width = raw ? Math.min(100, n * 10) : Math.min(100, Math.max(0, n));
        return '<div class="tccc-health-row"><div><span>' + esc(label) + '</span><b>' + esc(n) + (raw ? '' : '%') + '</b></div>' +
            '<div class="tccc-meter"><span style="width:' + width + '%"></span></div></div>';
    }

    function financesHtml() {
        if (!state.profile) return emptyConnectHtml();
        const f = financeSummary();
        const history = Object.keys(state.snapshots).sort().reverse().slice(0, 14);

        let html = cards([
            { label: 'Revenue', value: money.format(f.revenue) },
            { label: 'Employee Wages', value: money.format(f.wages) },
            { label: 'Advertising', value: money.format(f.advertising) },
            { label: 'Est. Stock Cost', value: money.format(f.cogs) },
            { label: 'Manual Daily Costs', value: money.format(f.extra) },
            { label: 'Estimated Net', value: money.format(f.net), className: f.net >= 0 ? 'good' : 'bad' }
        ]);

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Recent snapshots</h3><span>Saved locally whenever the script refreshes</span></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>TCT Day</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Funds</th></tr></thead><tbody>';
        if (!history.length) {
            html += '<tr><td colspan="5">No history yet.</td></tr>';
        } else {
            history.forEach(function (day) {
                const s = state.snapshots[day];
                html += '<tr><td>' + esc(day) + '</td><td>' + esc(money.format(num(s.revenue))) + '</td><td>' +
                    esc(money.format(num(s.expenses))) + '</td><td class="' + (num(s.net) >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' +
                    esc(money.format(num(s.net))) + '</td><td>' + esc(money.format(num(s.funds))) + '</td></tr>';
            });
        }
        html += '</tbody></table></div></section>';
        html += '<div class="tccc-note">The history is stored on this device. A later backend option can capture exact daily history even on days you never open Torn.</div>';
        return html;
    }

    function employeesHtml() {
        if (!state.profile) return emptyConnectHtml();

        const rows = state.employees.slice().sort(function (a, b) {
            return num(b.effectiveness && b.effectiveness.total) - num(a.effectiveness && a.effectiveness.total);
        });

        let html = '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Employees</h3><span>' + rows.length + ' currently hired</span></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>Employee</th><th>Position</th><th>Effectiveness</th><th>Addiction</th><th>Inactivity</th><th>Wage</th><th>Days</th></tr></thead><tbody>';

        rows.forEach(function (e) {
            const eff = e.effectiveness || {};
            html += '<tr><td><a href="/profiles.php?XID=' + encodeURIComponent(e.id) + '" target="_blank">' + esc(e.name) + '</a></td>' +
                '<td>' + esc((e.position && e.position.name) || '') + '</td>' +
                '<td><strong>' + esc(num(eff.total)) + '</strong></td>' +
                '<td class="' + (num(eff.addiction) < 0 ? 'tccc-negative' : '') + '">' + esc(num(eff.addiction)) + '</td>' +
                '<td class="' + (num(eff.inactivity) < 0 ? 'tccc-negative' : '') + '">' + esc(num(eff.inactivity)) + '</td>' +
                '<td>' + esc(money.format(num(e.wage))) + '</td><td>' + esc(num(e.days_in_company)) + '</td></tr>';
        });

        html += '</tbody></table></div></section>';
        html += '<div class="tccc-note">Detailed wages, working stats and effectiveness require the director to use a Limited, Custom, or Full access key.</div>';
        return html;
    }

    function trainingHtml() {
        if (!state.profile) return emptyConnectHtml();

        const map = calculateTrainingMap();
        const rows = state.employees
            .filter(function (e) { return !isDirector(e); })
            .map(function (e) {
                return { employee: e, training: map[String(e.id)] || { last: 0, count: 0 } };
            })
            .sort(function (a, b) { return num(a.training.last) - num(b.training.last); });

        let html = '';
        if (rows[0]) {
            html += '<div class="tccc-next"><div><span>Next in rotation</span><strong>' + esc(rows[0].employee.name) + '</strong></div>' +
                '<div>' + esc(formatAge(rows[0].training.last)) + '</div></div>';
        }

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Training rotation</h3><span>Built from the latest 100 company training-news entries</span></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>#</th><th>Employee</th><th>Last detected train</th><th>Age</th><th>Recent trains</th></tr></thead><tbody>';

        rows.forEach(function (row, index) {
            html += '<tr' + (index === 0 ? ' class="tccc-nextrow"' : '') + '><td>' + (index + 1) + '</td><td>' +
                esc(row.employee.name) + '</td><td>' + esc(formatDate(row.training.last)) + '</td><td>' +
                esc(formatAge(row.training.last)) + '</td><td>' + esc(row.training.count) + '</td></tr>';
        });

        html += '</tbody></table></div></section>';
        html += '<div class="tccc-note">Employees with no match in the recent training-news window rise to the top. We can add cycle locks, skips and custom priorities next.</div>';
        return html;
    }

    function duesHtml() {
        if (!state.profile) return emptyConnectHtml();

        const month = currentMonth();
        const ledger = monthLedger(month);
        const employees = duesEmployees();
        const paidCount = employees.filter(function (e) {
            return ledger[String(e.id)] && ledger[String(e.id)].paid;
        }).length;

        let html = cards([
            { label: 'Month', value: month },
            { label: 'Paid', value: paidCount + ' / ' + employees.length, className: paidCount === employees.length ? 'good' : '' },
            { label: 'Monthly Requirement', value: state.settings.edvdQty + ' eDVD' },
            { label: 'Due Day', value: 'Day ' + state.settings.dueDay }
        ]);

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>eDVD dues</h3><span>Click a status to toggle paid/unpaid</span></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>Employee</th><th>Status</th><th>Paid at</th><th>Method</th></tr></thead><tbody>';

        employees.forEach(function (e) {
            const record = ledger[String(e.id)] || {};
            html += '<tr><td>' + esc(e.name) + '</td><td><button class="tccc-duebtn ' + (record.paid ? 'paid' : 'unpaid') +
                '" data-due="' + esc(e.id) + '">' + (record.paid ? 'PAID' : 'UNPAID') + '</button></td><td>' +
                esc(record.paidAt ? formatDate(record.paidAt) : '—') + '</td><td>' + esc(record.method || '—') + '</td></tr>';
        });

        html += '</tbody></table></div></section>';
        html += '<div class="tccc-note">This ledger works now and is saved locally. Automatic detection from your item/trade logs is planned once we validate the exact eDVD receipt log patterns against live data.</div>';
        return html;
    }

    function stockHtml() {
        if (!state.profile) return emptyConnectHtml();

        let html = '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Stock</h3><span>Current stock and sales pace</span></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>Item</th><th>In stock</th><th>On order</th><th>Sold</th><th>Sales value</th><th>Est. COGS</th><th>Cover</th></tr></thead><tbody>';

        state.stock.forEach(function (item) {
            const sold = num(item.sold_amount);
            const cover = sold > 0 ? (num(item.in_stock) + num(item.on_order)) / sold : Infinity;
            html += '<tr><td>' + esc(item.name) + '</td><td>' + esc(num(item.in_stock)) + '</td><td>' +
                esc(num(item.on_order)) + '</td><td>' + esc(sold) + '</td><td>' + esc(money.format(num(item.sold_worth))) +
                '</td><td>' + esc(money.format(sold * num(item.cost))) + '</td><td class="' +
                (cover < 2 ? 'tccc-negative' : '') + '">' + (Number.isFinite(cover) ? esc(cover.toFixed(1) + ' days') : 'No sales') + '</td></tr>';
        });

        html += '</tbody></table></div></section>';
        html += '<div class="tccc-note">Stock cover uses current sold amount as the pace denominator, so treat it as a quick warning signal rather than a forecast until we have several days of stored sales history.</div>';
        return html;
    }

    function settingsHtml() {
        return '<section class="tccc-panel tccc-settings">' +
            '<h3>Connection & company rules</h3>' +
            '<label>Torn API key <input id="tccc-api-key" type="password" value="' + esc(state.settings.apiKey) + '" placeholder="Limited or Custom key recommended"></label>' +
            '<div class="tccc-settings-grid">' +
            '<label>eDVDs per employee / month <input id="tccc-edvd-qty" type="number" min="0" step="1" value="' + esc(state.settings.edvdQty) + '"></label>' +
            '<label>Monthly due day <input id="tccc-due-day" type="number" min="1" max="28" step="1" value="' + esc(state.settings.dueDay) + '"></label>' +
            '<label>Other daily company cost <input id="tccc-extra-cost" type="number" min="0" step="1000" value="' + esc(state.settings.extraDailyCost) + '"></label>' +
            '<label class="tccc-check"><input id="tccc-exclude-director" type="checkbox" ' + (state.settings.excludeDirector ? 'checked' : '') + '> Exclude director from monthly eDVD dues</label>' +
            '</div>' +
            '<div class="tccc-setting-actions"><button id="tccc-save-settings" class="primary">Save & Refresh</button><button id="tccc-export">Export local data</button><button id="tccc-import">Import local data</button></div>' +
            '<input id="tccc-import-file" type="file" accept=".json,application/json" style="display:none">' +
            '<div class="tccc-note">Your API key is stored by the userscript manager when available and is sent only to api.torn.com. Do not put your API key in GitHub.</div>' +
            '</section>';
    }

    function emptyConnectHtml() {
        return '<div class="tccc-empty"><h3>Company data is not connected yet</h3><p>Open Settings, add a Limited or suitably-scoped Custom Torn API key, save it, and the dashboard will populate automatically.</p><button data-tabgo="settings" class="primary">Open Settings</button></div>';
    }

    function tabHtml() {
        if (state.activeTab === 'overview') return overviewHtml();
        if (state.activeTab === 'finances') return financesHtml();
        if (state.activeTab === 'employees') return employeesHtml();
        if (state.activeTab === 'training') return trainingHtml();
        if (state.activeTab === 'dues') return duesHtml();
        if (state.activeTab === 'stock') return stockHtml();
        if (state.activeTab === 'settings') return settingsHtml();
        return overviewHtml();
    }

    function shellHtml() {
        const companyName = state.profile ? state.profile.name : APP.name;
        const tabs = [
            ['overview', 'Overview'],
            ['finances', 'Finances'],
            ['employees', 'Employees'],
            ['training', 'Training'],
            ['dues', 'eDVD Dues'],
            ['stock', 'Stock'],
            ['settings', 'Settings']
        ];

        return '<div class="tccc-modal">' +
            '<header><div><div class="tccc-eyebrow">TORN COMPANY COMMAND CENTER</div><h2>' + esc(companyName) + '</h2></div>' +
            '<div class="tccc-head-actions"><button id="tccc-refresh" title="Refresh">↻</button><button id="tccc-close" title="Close">×</button></div></header>' +
            '<nav>' + tabs.map(function (tab) {
                return '<button data-tab="' + tab[0] + '" class="' + (state.activeTab === tab[0] ? 'active' : '') + '">' + tab[1] + '</button>';
            }).join('') + '</nav>' +
            (state.error ? '<div class="tccc-error">' + esc(state.error) + '</div>' : '') +
            (state.loading ? '<div class="tccc-loading">Refreshing Torn company data…</div>' : '') +
            '<main>' + tabHtml() + '</main>' +
            '<footer><span>v' + esc(APP.version) + '</span><span>Local-first company management</span></footer>' +
            '</div>';
    }

    function render() {
        const overlay = document.getElementById('tccc-overlay');
        if (!overlay) return;

        overlay.classList.toggle('open', state.open);
        if (!state.open) return;
        overlay.innerHTML = shellHtml();
        bindUi();
    }

    function bindUi() {
        const close = document.getElementById('tccc-close');
        if (close) close.addEventListener('click', function () { state.open = false; render(); });

        const refresh = document.getElementById('tccc-refresh');
        if (refresh) refresh.addEventListener('click', refreshData);

        document.querySelectorAll('[data-tab]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.activeTab = button.getAttribute('data-tab');
                render();
            });
        });

        document.querySelectorAll('[data-tabgo]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.activeTab = button.getAttribute('data-tabgo');
                render();
            });
        });

        document.querySelectorAll('[data-due]').forEach(function (button) {
            button.addEventListener('click', function () {
                toggleDue(button.getAttribute('data-due'));
            });
        });

        const save = document.getElementById('tccc-save-settings');
        if (save) save.addEventListener('click', function () {
            state.settings.apiKey = (document.getElementById('tccc-api-key').value || '').trim();
            state.settings.edvdQty = Math.max(0, num(document.getElementById('tccc-edvd-qty').value));
            state.settings.dueDay = Math.min(28, Math.max(1, num(document.getElementById('tccc-due-day').value) || 1));
            state.settings.extraDailyCost = Math.max(0, num(document.getElementById('tccc-extra-cost').value));
            state.settings.excludeDirector = !!document.getElementById('tccc-exclude-director').checked;
            saveSettings();
            refreshData();
        });

        const exportBtn = document.getElementById('tccc-export');
        if (exportBtn) exportBtn.addEventListener('click', exportData);

        const importBtn = document.getElementById('tccc-import');
        const importFile = document.getElementById('tccc-import-file');
        if (importBtn && importFile) importBtn.addEventListener('click', function () { importFile.click(); });
        if (importFile) importFile.addEventListener('change', importData);
    }

    function exportData() {
        const payload = {
            app: APP.name,
            version: APP.version,
            exportedAt: new Date().toISOString(),
            settings: Object.assign({}, state.settings, { apiKey: '' }),
            snapshots: state.snapshots,
            dues: state.dues
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'torn-company-command-center-backup-' + tctDay() + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 500);
    }

    function importData(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const payload = JSON.parse(reader.result);
                if (payload.snapshots) state.snapshots = payload.snapshots;
                if (payload.dues) state.dues = payload.dues;
                if (payload.settings) {
                    const currentKey = state.settings.apiKey;
                    state.settings = Object.assign({}, state.settings, payload.settings, { apiKey: currentKey });
                }
                saveSnapshots();
                saveDues();
                saveSettings();
                state.error = '';
                render();
            } catch (e) {
                state.error = 'That backup file could not be imported.';
                render();
            }
        };
        reader.readAsText(file);
    }

    function injectCss() {
        if (document.getElementById('tccc-style')) return;
        const style = document.createElement('style');
        style.id = 'tccc-style';
        style.textContent = [
            '#tccc-launch{position:fixed;right:18px;bottom:82px;z-index:999999;background:linear-gradient(135deg,#5c36a8,#8b5cf6);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:11px 15px;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer;font-size:12px;letter-spacing:.3px}',
            '#tccc-overlay{display:none;position:fixed;inset:0;z-index:1000000;background:rgba(10,8,16,.72);backdrop-filter:blur(5px);padding:24px;overflow:auto}',
            '#tccc-overlay.open{display:block}',
            '.tccc-modal{max-width:1120px;margin:24px auto;background:#18151f;color:#ece9f5;border:1px solid #393244;border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.55);overflow:hidden;font-family:Arial,sans-serif}',
            '.tccc-modal header{display:flex;justify-content:space-between;align-items:center;padding:22px 24px;background:linear-gradient(135deg,#211a2c,#15121b);border-bottom:1px solid #352d40}',
            '.tccc-modal h2,.tccc-modal h3{margin:0}.tccc-modal h2{font-size:24px}.tccc-modal h3{font-size:16px}',
            '.tccc-eyebrow{font-size:10px;font-weight:900;letter-spacing:1.8px;color:#aa8cff;margin-bottom:5px}',
            '.tccc-head-actions{display:flex;gap:8px}.tccc-head-actions button{width:38px;height:38px;border-radius:10px;border:1px solid #40364d;background:#26202f;color:#fff;font-size:20px;cursor:pointer}',
            '.tccc-modal nav{display:flex;gap:4px;padding:8px 12px;background:#121016;border-bottom:1px solid #312a39;overflow-x:auto}',
            '.tccc-modal nav button{white-space:nowrap;border:0;background:transparent;color:#a9a2b4;padding:10px 12px;border-radius:8px;font-weight:700;cursor:pointer}',
            '.tccc-modal nav button.active{background:#6d48be;color:#fff}',
            '.tccc-modal main{padding:18px;min-height:430px}',
            '.tccc-modal footer{padding:10px 18px;border-top:1px solid #312a39;display:flex;justify-content:space-between;color:#7f7789;font-size:11px}',
            '.tccc-error{margin:14px 18px 0;padding:11px 13px;background:#3a1820;border:1px solid #6c2b38;border-radius:9px;color:#ffb6c0;font-weight:700}',
            '.tccc-loading{height:3px;background:linear-gradient(90deg,#6d48be,#b496ff,#6d48be);background-size:200% 100%;animation:tccc-load 1.2s linear infinite}@keyframes tccc-load{to{background-position:-200% 0}}',
            '.tccc-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}',
            '.tccc-card{background:#211d28;border:1px solid #393140;border-radius:12px;padding:15px;min-height:84px}.tccc-card.good{border-color:#315e46}.tccc-card.bad{border-color:#743541}',
            '.tccc-card-label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#97909f;font-weight:800}.tccc-card-value{font-size:21px;font-weight:900;margin-top:7px}.tccc-card-sub{font-size:11px;color:#8a8491;margin-top:5px}',
            '.tccc-grid2{display:grid;grid-template-columns:1.25fr 1fr;gap:14px}.tccc-panel{background:#211d28;border:1px solid #393140;border-radius:12px;padding:15px;margin-bottom:14px}.tccc-panel-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:10px}.tccc-panel-head span{font-size:11px;color:#8f879a}',
            '.tccc-attention{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.tccc-attention button{display:flex;flex-direction:column;text-align:left;background:#17141c;border:1px solid #36303c;border-radius:10px;padding:12px;color:#ded9e7;cursor:pointer}.tccc-attention strong{font-size:18px;color:#b99cff}.tccc-attention span{font-size:11px;margin-top:4px;color:#9992a1}',
            '.tccc-health{margin-top:12px}.tccc-health-row{margin-bottom:11px}.tccc-health-row>div:first-child{display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px}.tccc-meter{height:7px;background:#151219;border-radius:99px;overflow:hidden}.tccc-meter span{display:block;height:100%;background:linear-gradient(90deg,#704bc0,#b394ff)}',
            '.tccc-note{font-size:11px;line-height:1.5;color:#948d9c;padding:10px 12px;border-left:3px solid #6549a4;background:#19151e;border-radius:6px}',
            '.tccc-tablewrap{overflow:auto}.tccc-modal table{width:100%;border-collapse:collapse;font-size:12px}.tccc-modal th{text-align:left;color:#9b94a4;font-size:10px;text-transform:uppercase;letter-spacing:.7px;padding:9px;border-bottom:1px solid #403746}.tccc-modal td{padding:10px 9px;border-bottom:1px solid #302936;white-space:nowrap}.tccc-modal td a{color:#b99cff;text-decoration:none}.tccc-positive{color:#79d69f!important;font-weight:800}.tccc-negative{color:#ff8290!important;font-weight:800}.tccc-nextrow{background:#2a2039}',
            '.tccc-next{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#39265e,#251d35);border:1px solid #694e9a;border-radius:12px;padding:16px 18px;margin-bottom:14px}.tccc-next span{display:block;font-size:10px;text-transform:uppercase;color:#aa96c7;font-weight:800}.tccc-next strong{display:block;font-size:23px;margin-top:3px}',
            '.tccc-duebtn{border:0;border-radius:999px;padding:6px 10px;font-size:10px;font-weight:900;cursor:pointer}.tccc-duebtn.paid{background:#204b34;color:#8ee3ae}.tccc-duebtn.unpaid{background:#55252e;color:#ff98a4}',
            '.tccc-settings label{display:flex;flex-direction:column;gap:6px;color:#aaa2b1;font-size:11px;font-weight:700;margin-top:13px}.tccc-settings input[type=password],.tccc-settings input[type=number]{background:#151219;border:1px solid #403748;color:#fff;border-radius:8px;padding:10px}.tccc-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.tccc-settings .tccc-check{flex-direction:row;align-items:center}.tccc-setting-actions{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 14px}.tccc-setting-actions button,.tccc-empty button{border:1px solid #493b5c;background:#292231;color:#ddd4e9;padding:9px 12px;border-radius:8px;font-weight:800;cursor:pointer}.tccc-setting-actions button.primary,.tccc-empty button.primary{background:#6d48be;border-color:#7c5bc2;color:#fff}',
            '.tccc-empty{text-align:center;padding:70px 20px}.tccc-empty p{color:#9991a1;max-width:560px;margin:12px auto 18px;line-height:1.5}',
            '@media(max-width:800px){#tccc-overlay{padding:6px}.tccc-modal{margin:6px auto}.tccc-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.tccc-grid2{grid-template-columns:1fr}.tccc-settings-grid{grid-template-columns:1fr}.tccc-modal main{padding:10px}}',
            '@media(max-width:480px){#tccc-launch{right:10px;bottom:72px}.tccc-cards{grid-template-columns:1fr}.tccc-attention{grid-template-columns:1fr}.tccc-modal header{padding:16px}.tccc-modal h2{font-size:19px}}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function mount() {
        if (document.getElementById('tccc-launch')) return;
        injectCss();

        const launch = document.createElement('button');
        launch.id = 'tccc-launch';
        launch.textContent = 'COMPANY CC';
        launch.title = APP.name;
        launch.addEventListener('click', function () {
            state.open = true;
            render();
            if (state.settings.apiKey && !state.profile && !state.loading) refreshData();
        });

        const overlay = document.createElement('div');
        overlay.id = 'tccc-overlay';
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) {
                state.open = false;
                render();
            }
        });

        document.body.appendChild(launch);
        document.body.appendChild(overlay);
    }

    loadLocalState();
    mount();

    // Torn is a SPA in several areas. Re-mount if page navigation replaces body content.
    const observer = new MutationObserver(function () {
        if (!document.getElementById('tccc-launch') || !document.getElementById('tccc-overlay')) mount();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
