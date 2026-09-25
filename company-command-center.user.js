// ==UserScript==
// @name         Torn Company Command Center
// @namespace    https://github.com/PurpleZyn/company-script
// @version      1.0.1
// @description  Complete local-first director dashboard for Torn companies: finances, staff, training, dues, stock, recruiting, optimization, alerts, and analytics.
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
        version: '1.0.1',
        storagePrefix: 'tccc_',
        apiBase: 'https://api.torn.com/v2',
        comment: 'company-command-center'
    };

    const COMPANY_ROLE_REQUIREMENTS = {
        'Adult Novelties': {
            'Sales Assistant': { manual_labor: 2000, intelligence: 0, endurance: 4000 },
            'Sexpert': { manual_labor: 0, intelligence: 10000, endurance: 5000 },
            'Store Manager': { manual_labor: 0, intelligence: 4000, endurance: 8000 },
            'Marketing Manager': { manual_labor: 0, intelligence: 8000, endurance: 4000 },
            'Receptionist': { manual_labor: 0, intelligence: 3000, endurance: 6000 },
            'Human Resources': { manual_labor: 0, intelligence: 12000, endurance: 6000 },
            'Cleaner': { manual_labor: 2000, intelligence: 0, endurance: 1000 }
        }
    };

    const state = {
        open: false,
        activeTab: 'overview',
        loading: false,
        error: '',
        lastRefreshAt: 0,
        lastRefreshReason: '',
        launcherPosition: null,
        alertBaseline: {
            initialized: false,
            trainingKey: '',
            paidIds: [],
            applicationIds: [],
            lowStockKeys: [],
            optimizerSignature: ''
        },
        profile: null,
        employees: [],
        stock: [],
        applications: [],
        trainingNews: [],
        fundNews: [],
        snapshots: {},
        employeeHistory: {},
        stockHistory: {},
        staffingTargets: {},
        employeeFilter: 'all',
        expandedEmployeeId: '',
        dues: {},
        duesResetAt: {},
        duesScan: {
            status: 'idle',
            error: '',
            logs: [],
            matches: [],
            checkedAt: 0
        },
        trainingRotation: {
            initialized: false,
            order: [],
            lastSeen: {},
            history: [],
            updatedAt: 0
        },
        settings: {
            apiKey: '',
            duesApiKey: '',
            duesKeywords: 'CHAP,DUES',
            edvdQty: 1,
            dueDay: 1,
            excludeDirector: true,
            extraDailyCost: 0,
            stockTargetDays: 7,
            stockWarningDays: 3,
            stockCapacity: 500000,
            autoRefreshEnabled: true,
            autoRefreshMinutes: 30,
            launcherCompanyOnly: false,
            alertsEnabled: true,
            alertTraining: true,
            alertDues: true,
            alertApplications: true,
            alertStock: true,
            alertOptimizer: true
        }
    };

    let autoRefreshTimer = null;
    let autoRuntimeDay = tctDay();
    let preMidnightCapturedDay = '';
    let lastLocationHref = location.href;
    let suppressLauncherClick = false;

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

    function monthStartTimestamp(month) {
        const parts = String(month || currentMonth()).split('-');
        const year = num(parts[0]);
        const monthIndex = Math.max(0, num(parts[1]) - 1);
        return Math.floor(Date.UTC(year, monthIndex, 1, 0, 0, 0) / 1000);
    }

    function duesKeywords() {
        return String(state.settings.duesKeywords || 'CHAP,DUES')
            .split(',')
            .map(function (keyword) { return keyword.trim(); })
            .filter(Boolean);
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^$()|[\]\\{}]/g, function (match) {
            return '\\' + match;
        });
    }

    function messageMatchesDuesKeyword(message) {
        const text = String(message || '');
        return duesKeywords().some(function (keyword) {
            const pattern = new RegExp('(?:^|\\b)' + escapeRegExp(keyword) + '(?:\\b|$)', 'i');
            return pattern.test(text);
        });
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
        state.employeeHistory = store.get('employeeHistory', {}) || {};
        state.stockHistory = store.get('stockHistory', {}) || {};
        state.staffingTargets = store.get('staffingTargets', {}) || {};
        state.launcherPosition = store.get('launcherPosition', null);
        state.alertBaseline = Object.assign({}, state.alertBaseline, store.get('alertBaseline', {}) || {});
        if (!Array.isArray(state.alertBaseline.paidIds)) state.alertBaseline.paidIds = [];
        if (!Array.isArray(state.alertBaseline.applicationIds)) state.alertBaseline.applicationIds = [];
        if (!Array.isArray(state.alertBaseline.lowStockKeys)) state.alertBaseline.lowStockKeys = [];
        state.dues = store.get('dues', {}) || {};
        state.duesResetAt = store.get('duesResetAt', {}) || {};
        state.trainingRotation = Object.assign({}, state.trainingRotation, store.get('trainingRotation', {}) || {});
        if (!Array.isArray(state.trainingRotation.order)) state.trainingRotation.order = [];
        if (!state.trainingRotation.lastSeen || typeof state.trainingRotation.lastSeen !== 'object') state.trainingRotation.lastSeen = {};
        if (!Array.isArray(state.trainingRotation.history)) state.trainingRotation.history = [];
    }

    function saveSettings() {
        store.set('settings', state.settings);
    }

    function saveSnapshots() {
        store.set('snapshots', state.snapshots);
    }

    function saveDues() {
        store.set('dues', state.dues);
        store.set('duesResetAt', state.duesResetAt);
    }

    function saveEmployeeHistory() {
        store.set('employeeHistory', state.employeeHistory);
    }

    function saveStockHistory() {
        store.set('stockHistory', state.stockHistory);
    }

    function saveStaffingTargets() {
        store.set('staffingTargets', state.staffingTargets);
    }

    function saveLauncherPosition() {
        store.set('launcherPosition', state.launcherPosition);
    }

    function saveAlertBaseline() {
        store.set('alertBaseline', state.alertBaseline);
    }

    function saveTrainingRotation() {
        state.trainingRotation.updatedAt = Math.floor(Date.now() / 1000);
        store.set('trainingRotation', state.trainingRotation);
    }

    function apiGet(path, params, keyOverride) {
        params = params || {};
        const apiKey = String(keyOverride || state.settings.apiKey || '').trim();
        if (!apiKey) return Promise.reject(new Error('Add your Torn API key in Settings first.'));

        const query = new URLSearchParams();
        Object.keys(params).forEach(function (key) {
            if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
                query.set(key, params[key]);
            }
        });
        query.set('key', apiKey);
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

    function trainingEntryEmployeeIds(entry) {
        const ids = [];
        const raw = String((entry && entry.text) || '');
        const employeeIds = new Set(state.employees.map(function (employee) { return String(employee.id); }));

        const xidRegex = /XID=(\d+)/gi;
        let match;
        while ((match = xidRegex.exec(raw)) !== null) {
            if (employeeIds.has(String(match[1])) && ids.indexOf(String(match[1])) === -1) {
                ids.push(String(match[1]));
            }
        }

        if (ids.length) return ids;

        const holder = document.createElement('div');
        holder.innerHTML = raw;
        const plain = (' ' + (holder.textContent || '') + ' ').toLowerCase();

        state.employees.forEach(function (employee) {
            const name = String(employee.name || '').trim().toLowerCase();
            if (!name) return;
            if (plain.indexOf(name) !== -1 && ids.indexOf(String(employee.id)) === -1) {
                ids.push(String(employee.id));
            }
        });

        return ids;
    }

    function calculateTrainingMap() {
        const map = {};
        state.employees.forEach(function (employee) {
            map[String(employee.id)] = { last: 0, count: 0 };
        });

        state.trainingNews.forEach(function (entry) {
            const ids = trainingEntryEmployeeIds(entry);
            ids.forEach(function (id) {
                if (!map[id]) return;
                map[id].count += 1;
                map[id].last = Math.max(map[id].last, num(entry.timestamp));
            });
        });

        return map;
    }

    function activeTrainingEmployees() {
        return state.employees.filter(function (employee) {
            return !isDirector(employee);
        });
    }

    function trainingEmployeeById(id) {
        return activeTrainingEmployees().find(function (employee) {
            return String(employee.id) === String(id);
        }) || null;
    }

    function normalizeRotationOrder() {
        const active = activeTrainingEmployees();
        const activeIds = active.map(function (employee) { return String(employee.id); });
        const activeSet = new Set(activeIds);
        const seen = new Set();

        state.trainingRotation.order = (state.trainingRotation.order || []).filter(function (id) {
            const key = String(id);
            if (!activeSet.has(key) || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).map(String);

        activeIds.forEach(function (id) {
            if (!seen.has(id)) {
                state.trainingRotation.order.push(id);
                seen.add(id);
            }
        });

        Object.keys(state.trainingRotation.lastSeen || {}).forEach(function (id) {
            if (!activeSet.has(String(id))) delete state.trainingRotation.lastSeen[id];
        });
    }

    function seedTrainingRotation() {
        const map = calculateTrainingMap();
        const employees = activeTrainingEmployees().slice().sort(function (a, b) {
            const aLast = num(map[String(a.id)] && map[String(a.id)].last);
            const bLast = num(map[String(b.id)] && map[String(b.id)].last);
            if (aLast !== bLast) return aLast - bLast;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

        state.trainingRotation.order = employees.map(function (employee) { return String(employee.id); });
        state.trainingRotation.lastSeen = {};

        employees.forEach(function (employee) {
            state.trainingRotation.lastSeen[String(employee.id)] =
                num(map[String(employee.id)] && map[String(employee.id)].last);
        });

        state.trainingRotation.initialized = true;
        saveTrainingRotation();
    }

    function syncTrainingRotation() {
        if (!state.employees.length) return;

        const map = calculateTrainingMap();

        if (!state.trainingRotation.initialized || !state.trainingRotation.order.length) {
            seedTrainingRotation();
            return;
        }

        normalizeRotationOrder();

        const detected = [];
        activeTrainingEmployees().forEach(function (employee) {
            const id = String(employee.id);
            const latest = num(map[id] && map[id].last);
            const hadBaseline = Object.prototype.hasOwnProperty.call(state.trainingRotation.lastSeen, id);
            const previous = num(state.trainingRotation.lastSeen[id]);

            if (hadBaseline && latest > previous) {
                detected.push({ id: id, timestamp: latest });
            }

            if (!hadBaseline || latest > previous) state.trainingRotation.lastSeen[id] = latest;
        });

        detected.sort(function (a, b) {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return state.trainingRotation.order.indexOf(a.id) - state.trainingRotation.order.indexOf(b.id);
        });

        detected.forEach(function (event) {
            const index = state.trainingRotation.order.indexOf(event.id);
            if (index >= 0) state.trainingRotation.order.splice(index, 1);
            state.trainingRotation.order.push(event.id);

            const employee = trainingEmployeeById(event.id);
            state.trainingRotation.history.unshift({
                id: event.id,
                name: employee ? employee.name : event.id,
                timestamp: event.timestamp,
                detectedAt: Math.floor(Date.now() / 1000),
                type: 'auto'
            });
        });

        state.trainingRotation.history = state.trainingRotation.history.slice(0, 50);
        saveTrainingRotation();
    }

    function trainingQueue() {
        normalizeRotationOrder();
        return state.trainingRotation.order.map(function (id) {
            return trainingEmployeeById(id);
        }).filter(Boolean);
    }

    function moveTrainingEmployee(id, direction) {
        const key = String(id);
        normalizeRotationOrder();
        const order = state.trainingRotation.order;
        const index = order.indexOf(key);
        if (index < 0) return;

        let target = index;
        if (direction === 'up') target = Math.max(0, index - 1);
        if (direction === 'down') target = Math.min(order.length - 1, index + 1);
        if (target === index) return;

        order.splice(index, 1);
        order.splice(target, 0, key);
        saveTrainingRotation();
        render();
    }

    function setTrainingNext(id) {
        const key = String(id);
        normalizeRotationOrder();
        const index = state.trainingRotation.order.indexOf(key);
        if (index < 0) return;
        state.trainingRotation.order.splice(index, 1);
        state.trainingRotation.order.unshift(key);
        saveTrainingRotation();
        render();
    }

    function skipTrainingEmployee(id) {
        const key = String(id);
        normalizeRotationOrder();
        const index = state.trainingRotation.order.indexOf(key);
        if (index < 0) return;
        state.trainingRotation.order.splice(index, 1);
        state.trainingRotation.order.push(key);

        const employee = trainingEmployeeById(key);
        state.trainingRotation.history.unshift({
            id: key,
            name: employee ? employee.name : key,
            timestamp: Math.floor(Date.now() / 1000),
            detectedAt: Math.floor(Date.now() / 1000),
            type: 'skip'
        });
        state.trainingRotation.history = state.trainingRotation.history.slice(0, 50);
        saveTrainingRotation();
        render();
    }

    function resetTrainingRotation() {
        seedTrainingRotation();
        state.trainingRotation.history.unshift({
            id: '',
            name: 'Rotation reset from training history',
            timestamp: Math.floor(Date.now() / 1000),
            detectedAt: Math.floor(Date.now() / 1000),
            type: 'reset'
        });
        state.trainingRotation.history = state.trainingRotation.history.slice(0, 50);
        saveTrainingRotation();
        render();
    }

    function financeSummary() {
        const revenue = num(state.profile && state.profile.income && state.profile.income.daily);
        const weeklyRevenue = num(state.profile && state.profile.income && state.profile.income.weekly);
        const wages = state.employees.reduce(function (total, employee) {
            return total + num(employee.wage);
        }, 0);
        const advertising = num(state.profile && state.profile.advertisement_budget);
        const cogs = state.stock.reduce(function (total, item) {
            return total + (num(item.sold_amount) * num(item.cost));
        }, 0);
        const stockSales = state.stock.reduce(function (total, item) {
            return total + num(item.sold_worth);
        }, 0);
        const extra = num(state.settings.extraDailyCost);
        const grossProfit = revenue - cogs;
        const overhead = wages + advertising + extra;
        const operatingProfit = grossProfit - overhead;
        const expenses = cogs + overhead;
        const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        const operatingMargin = revenue > 0 ? (operatingProfit / revenue) * 100 : 0;
        const contributionRate = revenue > 0 ? grossProfit / revenue : 0;
        const breakEvenRevenue = contributionRate > 0 ? overhead / contributionRate : 0;

        return {
            revenue: revenue,
            weeklyRevenue: weeklyRevenue,
            stockSales: stockSales,
            wages: wages,
            advertising: advertising,
            cogs: cogs,
            extra: extra,
            grossProfit: grossProfit,
            overhead: overhead,
            expenses: expenses,
            operatingProfit: operatingProfit,
            net: operatingProfit,
            grossMargin: grossMargin,
            operatingMargin: operatingMargin,
            breakEvenRevenue: breakEvenRevenue
        };
    }

    function stockItemKey(item) {
        if (item && item.id !== undefined && item.id !== null) return 'id:' + String(item.id);
        return 'name:' + String((item && item.name) || '').toLowerCase();
    }

    function saveStockSnapshot() {
        if (!state.stock.length) return;

        const day = tctDay();
        const now = Math.floor(Date.now() / 1000);
        const items = {};

        state.stock.forEach(function (item) {
            const key = stockItemKey(item);
            items[key] = {
                id: item.id !== undefined ? item.id : null,
                name: item.name || '',
                inStock: num(item.in_stock),
                onOrder: num(item.on_order),
                sold: num(item.sold_amount),
                soldWorth: num(item.sold_worth),
                cost: num(item.cost),
                sellingPrice: num(item.price !== undefined ? item.price : item.selling_price)
            };
        });

        state.stockHistory[day] = {
            capturedAt: now,
            items: items
        };

        const days = Object.keys(state.stockHistory).sort();
        while (days.length > 90) {
            delete state.stockHistory[days.shift()];
        }
        saveStockHistory();
    }

    function stockSalesSamples(item, maxDays) {
        const key = stockItemKey(item);
        const today = tctDay();
        const days = Object.keys(state.stockHistory).sort().reverse();
        const completed = [];
        const current = [];

        days.forEach(function (day) {
            const snapshot = state.stockHistory[day];
            const record = snapshot && snapshot.items ? snapshot.items[key] : null;
            if (!record) return;
            if (day === today) current.push(num(record.sold));
            else completed.push(num(record.sold));
        });

        const limit = Math.max(1, num(maxDays) || 7);
        if (completed.length) return completed.slice(0, limit);
        if (current.length) return current.slice(0, 1);
        return [];
    }

    function stockForecast(item) {
        const samples = stockSalesSamples(item, 7);
        const avgDaily = samples.length ?
            samples.reduce(function (total, sold) { return total + sold; }, 0) / samples.length :
            num(item.sold_amount);

        const inStock = num(item.in_stock);
        const onOrder = num(item.on_order);
        const totalAvailable = inStock + onOrder;
        const onHandDays = avgDaily > 0 ? inStock / avgDaily : Infinity;
        const totalDays = avgDaily > 0 ? totalAvailable / avgDaily : Infinity;
        const targetDays = Math.max(1, num(state.settings.stockTargetDays) || 7);
        const warningDays = Math.max(0, num(state.settings.stockWarningDays) || 3);
        const idealSuggested = avgDaily > 0 ? Math.max(0, Math.ceil((avgDaily * targetDays) - totalAvailable)) : 0;
        const runoutAt = Number.isFinite(totalDays) ?
            Math.floor(Date.now() / 1000) + Math.round(totalDays * 86400) : 0;

        let status = 'healthy';
        if (avgDaily <= 0) status = 'no-sales';
        else if (totalDays < warningDays) status = 'low';
        else if (totalDays < targetDays) status = 'watch';

        return {
            avgDaily: avgDaily,
            samples: samples.length,
            inStock: inStock,
            onOrder: onOrder,
            totalAvailable: totalAvailable,
            onHandDays: onHandDays,
            totalDays: totalDays,
            targetDays: targetDays,
            warningDays: warningDays,
            idealSuggested: idealSuggested,
            suggested: idealSuggested,
            runoutAt: runoutAt,
            status: status
        };
    }

    function stockCapacityPlan() {
        const capacity = Math.max(1, Math.floor(num(state.settings.stockCapacity) || 500000));
        const targetDays = Math.max(1, num(state.settings.stockTargetDays) || 7);
        const warningDays = Math.max(0, num(state.settings.stockWarningDays) || 3);

        const rows = state.stock.map(function (item) {
            return {
                key: stockItemKey(item),
                item: item,
                forecast: stockForecast(item),
                suggested: 0,
                afterPlanDays: Infinity,
                status: 'healthy'
            };
        });

        const inStockUnits = rows.reduce(function (total, row) {
            return total + num(row.item.in_stock);
        }, 0);
        const onOrderUnits = rows.reduce(function (total, row) {
            return total + num(row.item.on_order);
        }, 0);
        const committedUnits = inStockUnits + onOrderUnits;
        const freeCapacity = Math.max(0, capacity - committedUnits);
        const overCapacity = Math.max(0, committedUnits - capacity);
        const idealNeeded = rows.reduce(function (total, row) {
            return total + num(row.forecast.idealSuggested);
        }, 0);

        const activeRows = rows.filter(function (row) {
            return row.forecast.avgDaily > 0;
        });

        function unitsNeededForCoverage(days) {
            return activeRows.reduce(function (total, row) {
                return total + Math.max(0, (row.forecast.avgDaily * days) - row.forecast.totalAvailable);
            }, 0);
        }

        let effectiveTargetDays = targetDays;

        if (activeRows.length && freeCapacity < idealNeeded) {
            let low = 0;
            let high = targetDays;

            for (let i = 0; i < 50; i += 1) {
                const mid = (low + high) / 2;
                if (unitsNeededForCoverage(mid) <= freeCapacity) low = mid;
                else high = mid;
            }
            effectiveTargetDays = low;
        }

        if (freeCapacity > 0 && activeRows.length) {
            if (freeCapacity >= idealNeeded) {
                rows.forEach(function (row) {
                    row.suggested = row.forecast.idealSuggested;
                });
            } else {
                rows.forEach(function (row) {
                    if (row.forecast.avgDaily <= 0) return;
                    row.suggested = Math.max(0, Math.floor(
                        (row.forecast.avgDaily * effectiveTargetDays) - row.forecast.totalAvailable
                    ));
                });

                let used = rows.reduce(function (total, row) { return total + row.suggested; }, 0);
                let remaining = Math.max(0, freeCapacity - used);

                const candidates = rows.filter(function (row) {
                    return row.forecast.avgDaily > 0 && row.suggested < row.forecast.idealSuggested;
                }).sort(function (a, b) {
                    const aDays = (a.forecast.totalAvailable + a.suggested) / a.forecast.avgDaily;
                    const bDays = (b.forecast.totalAvailable + b.suggested) / b.forecast.avgDaily;
                    return aDays - bDays;
                });

                let cursor = 0;
                while (remaining > 0 && candidates.length) {
                    const row = candidates[cursor % candidates.length];
                    if (row.suggested < row.forecast.idealSuggested) {
                        row.suggested += 1;
                        remaining -= 1;
                    }
                    cursor += 1;
                    if (cursor > candidates.length * 3 && candidates.every(function (entry) {
                        return entry.suggested >= entry.forecast.idealSuggested;
                    })) break;
                }
            }
        }

        rows.forEach(function (row) {
            const avgDaily = row.forecast.avgDaily;
            const afterUnits = row.forecast.totalAvailable + row.suggested;
            row.afterPlanDays = avgDaily > 0 ? afterUnits / avgDaily : Infinity;

            if (avgDaily <= 0) row.status = 'no-sales';
            else if (row.forecast.totalDays < warningDays) row.status = 'low';
            else if (row.forecast.totalDays < effectiveTargetDays) row.status = 'watch';
            else row.status = 'healthy';
        });

        const suggestedTotal = rows.reduce(function (total, row) {
            return total + row.suggested;
        }, 0);

        return {
            capacity: capacity,
            inStockUnits: inStockUnits,
            onOrderUnits: onOrderUnits,
            committedUnits: committedUnits,
            freeCapacity: freeCapacity,
            overCapacity: overCapacity,
            targetDays: targetDays,
            effectiveTargetDays: effectiveTargetDays,
            idealNeeded: idealNeeded,
            suggestedTotal: suggestedTotal,
            rows: rows
        };
    }

    function formatForecastDate(timestamp) {
        if (!timestamp) return '—';
        return new Date(timestamp * 1000).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
        });
    }

    function saveEmployeeSnapshot() {
        if (!state.employees.length) return;

        const day = tctDay();
        const now = Math.floor(Date.now() / 1000);
        const employees = {};

        state.employees.forEach(function (employee) {
            const eff = employee.effectiveness || {};
            employees[String(employee.id)] = {
                id: employee.id,
                name: employee.name || '',
                position: (employee.position && employee.position.name) || '',
                wage: num(employee.wage),
                daysInCompany: num(employee.days_in_company),
                effectiveness: Object.assign({}, eff)
            };
        });

        state.employeeHistory[day] = {
            capturedAt: now,
            employees: employees
        };

        const days = Object.keys(state.employeeHistory).sort();
        while (days.length > 90) {
            delete state.employeeHistory[days.shift()];
        }
        saveEmployeeHistory();
    }

    function previousEmployeeSnapshotDay() {
        const today = tctDay();
        const days = Object.keys(state.employeeHistory).filter(function (day) {
            return day < today;
        }).sort();
        return days.length ? days[days.length - 1] : '';
    }

    function employeeTrend(employeeId) {
        const today = state.employeeHistory[tctDay()];
        const previousDay = previousEmployeeSnapshotDay();
        const previous = previousDay ? state.employeeHistory[previousDay] : null;
        const currentEntry = today && today.employees ? today.employees[String(employeeId)] : null;
        const previousEntry = previous && previous.employees ? previous.employees[String(employeeId)] : null;

        if (!currentEntry || !previousEntry) return null;

        const currentEff = currentEntry.effectiveness || {};
        const previousEff = previousEntry.effectiveness || {};
        return {
            previousDay: previousDay,
            total: num(currentEff.total) - num(previousEff.total),
            addiction: num(currentEff.addiction) - num(previousEff.addiction),
            inactivity: num(currentEff.inactivity) - num(previousEff.inactivity)
        };
    }

    function humanizeEffectivenessKey(key) {
        return String(key || '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
    }

    function employeeStatus(employee) {
        const eff = employee.effectiveness || {};
        const addiction = num(eff.addiction);
        const inactivity = num(eff.inactivity);

        if (addiction < 0 && inactivity < 0) return { key: 'multiple', label: 'Multiple Issues', className: 'bad' };
        if (addiction < 0) return { key: 'addiction', label: 'Addiction', className: 'bad' };
        if (inactivity < 0) return { key: 'inactivity', label: 'Inactivity', className: 'bad' };
        return { key: 'clear', label: 'Clear', className: 'good' };
    }

    function parseFundEvent(entry) {
        const text = newsPlainText(entry && entry.text);
        if (!text) return null;

        let match = text.match(/^(.+?) has made a deposit of \$([\d,]+) to the company funds$/i);
        if (match) {
            return {
                timestamp: num(entry.timestamp),
                actor: match[1].trim(),
                type: 'deposit',
                amount: num(match[2].replace(/,/g, '')),
                text: text
            };
        }

        match = text.match(/^(.+?) has withdrawn \$([\d,]+) from the company funds$/i);
        if (match) {
            return {
                timestamp: num(entry.timestamp),
                actor: match[1].trim(),
                type: 'withdrawal',
                amount: num(match[2].replace(/,/g, '')),
                text: text
            };
        }

        return {
            timestamp: num(entry.timestamp),
            actor: '',
            type: 'other',
            amount: 0,
            text: text
        };
    }

    function fundTransfersBetween(fromTimestamp, toTimestamp) {
        const result = {
            deposits: 0,
            withdrawals: 0,
            depositCount: 0,
            withdrawalCount: 0,
            unclassified: 0
        };

        state.fundNews.forEach(function (entry) {
            const parsed = parseFundEvent(entry);
            if (!parsed) return;
            if (fromTimestamp && parsed.timestamp < fromTimestamp) return;
            if (toTimestamp && parsed.timestamp > toTimestamp) return;

            if (parsed.type === 'deposit') {
                result.deposits += parsed.amount;
                result.depositCount += 1;
            } else if (parsed.type === 'withdrawal') {
                result.withdrawals += parsed.amount;
                result.withdrawalCount += 1;
            } else {
                result.unclassified += 1;
            }
        });

        return result;
    }

    function saveTodaySnapshot() {
        if (!state.profile) return;
        const f = financeSummary();
        const key = tctDay();
        const now = Math.floor(Date.now() / 1000);
        const currentFunds = num(state.profile.funds);
        const previous = state.snapshots[key] || {};
        const openingCapturedAt = previous.openingCapturedAt || previous.capturedAt || now;
        const openingFunds = previous.openingFunds !== undefined ? num(previous.openingFunds) :
            (previous.funds !== undefined ? num(previous.funds) : currentFunds);
        const transfers = fundTransfersBetween(openingCapturedAt, now);
        const rawFundsChange = currentFunds - openingFunds;
        const adjustedCashChange = rawFundsChange - transfers.deposits + transfers.withdrawals;

        state.snapshots[key] = {
            openingCapturedAt: openingCapturedAt,
            openingFunds: openingFunds,
            capturedAt: now,
            revenue: f.revenue,
            weeklyRevenue: f.weeklyRevenue,
            wages: f.wages,
            advertising: f.advertising,
            cogs: f.cogs,
            grossProfit: f.grossProfit,
            overhead: f.overhead,
            extra: f.extra,
            expenses: f.expenses,
            operatingProfit: f.operatingProfit,
            net: f.operatingProfit,
            funds: currentFunds,
            rawFundsChange: rawFundsChange,
            externalDeposits: transfers.deposits,
            externalWithdrawals: transfers.withdrawals,
            adjustedCashChange: adjustedCashChange,
            rating: num(state.profile.rating),
            efficiency: num(state.profile.efficiency),
            environment: num(state.profile.environment),
            popularity: num(state.profile.popularity),
            trains: num(state.profile.trains),
            employeeCount: state.employees.length,
            applicationCount: state.applications.length
        };

        const keys = Object.keys(state.snapshots).sort();
        while (keys.length > 180) {
            delete state.snapshots[keys.shift()];
        }
        saveSnapshots();
    }

    function isCompanyArea() {
        const value = (location.pathname + location.search + location.hash).toLowerCase();
        if (value.indexOf('companies.php') !== -1 || value.indexOf('company.php') !== -1) return true;
        if (value.indexOf('joblist.php') !== -1 &&
            (value.indexOf('corp') !== -1 || value.indexOf('company') !== -1 || value.indexOf('employee') !== -1)) return true;
        return false;
    }

    function freshnessInfo() {
        if (state.loading) return { label: 'Refreshing…', className: 'loading' };
        if (!state.lastRefreshAt) return { label: 'Not refreshed yet', className: 'stale' };

        const ageMs = Date.now() - (state.lastRefreshAt * 1000);
        const freshFor = Math.max(10 * 60 * 1000, autoRefreshIntervalMs() * 1.5);
        return {
            label: (ageMs <= freshFor ? 'Fresh · ' : 'Stale · ') + refreshAgeLabel(),
            className: ageMs <= freshFor ? 'fresh' : 'stale'
        };
    }

    function attentionSummary() {
        if (!state.profile) return { count: 0, items: [] };

        const items = [];
        const finance = financeSummary();
        if (finance.operatingProfit < 0) items.push('Finances');

        const queue = trainingQueue();
        if (queue.length && num(state.profile.trains) > 0) items.push('Training');

        const ledger = monthLedger(currentMonth());
        const duesList = duesEmployees();
        const todayDay = new Date().getUTCDate();
        const unpaid = duesList.filter(function (employee) {
            return !(ledger[String(employee.id)] && ledger[String(employee.id)].paid);
        });
        if (todayDay >= num(state.settings.dueDay) && unpaid.length) items.push('eDVD dues');

        const employeeWarnings = state.employees.some(function (employee) {
            const eff = employee.effectiveness || {};
            return num(eff.addiction) < 0 || num(eff.inactivity) < 0;
        });
        if (employeeWarnings) items.push('Employees');

        const stockPlan = stockCapacityPlan();
        const riskyStock = stockPlan.rows.some(function (row) {
            return row.status === 'low' || row.status === 'watch';
        });
        if (riskyStock || stockPlan.overCapacity > 0) items.push('Stock');

        if (state.applications.length) items.push('Recruiting');

        const staffing = staffingPlanSummary();
        if (staffing.short || staffing.over) items.push('Staffing');

        const optimizer = currentOptimizerSummary();
        if (optimizer && optimizer.changes) items.push('Role optimizer');

        return { count: items.length, items: items };
    }

    function applicationAlertId(application) {
        const player = application && application.player ? application.player : {};
        return String(application && application.id !== undefined ? application.id :
            ((player.id || player.name || 'unknown') + '|' + num(application && application.expires_at)));
    }

    function optimizerSignature(summary) {
        if (!summary || !summary.changes) return '';
        const requirements = companyRoleRequirements();
        if (!requirements) return '';
        const roles = Object.keys(state.staffingTargets || {}).filter(function (role) {
            return requirements[role] && num(state.staffingTargets[role]) > 0;
        });
        const multiplier = calibratedWorkStatMultiplier();
        const optimized = optimizeEmployeeAssignments(roles, state.staffingTargets, multiplier);
        if (!optimized.valid) return '';
        return state.employees.map(function (employee) {
            const assignment = optimized.byEmployee[String(employee.id)];
            const currentRole = (employee.position && employee.position.name) || '';
            return assignment && assignment.role !== currentRole ?
                String(employee.id) + ':' + currentRole + '>' + assignment.role : '';
        }).filter(Boolean).sort().join('|');
    }

    function currentAlertSnapshot() {
        const ledger = monthLedger(currentMonth());
        const paidIds = duesEmployees().filter(function (employee) {
            return !!(ledger[String(employee.id)] && ledger[String(employee.id)].paid);
        }).map(function (employee) { return String(employee.id); }).sort();

        const applications = state.applications.map(applicationAlertId).sort();
        const stockPlan = stockCapacityPlan();
        const lowStock = stockPlan.rows.filter(function (row) {
            return row.status === 'low';
        }).map(function (row) { return row.key; }).sort();

        const latestAuto = state.trainingRotation.history.find(function (event) {
            return event.type === 'auto';
        });
        const trainingKey = latestAuto ? String(latestAuto.id) + '|' + String(latestAuto.timestamp) : '';

        const optimizer = currentOptimizerSummary();

        return {
            trainingKey: trainingKey,
            paidIds: paidIds,
            applicationIds: applications,
            lowStockKeys: lowStock,
            optimizerSignature: optimizerSignature(optimizer),
            optimizer: optimizer,
            latestAuto: latestAuto
        };
    }

    function showToast(title, message, tab, kind) {
        if (!state.settings.alertsEnabled) return;
        const container = document.getElementById('tccc-toasts');
        if (!container) return;

        const toast = document.createElement('button');
        toast.type = 'button';
        toast.className = 'tccc-toast ' + (kind || 'info');
        toast.innerHTML = '<strong>' + esc(title) + '</strong><span>' + esc(message) + '</span>';
        toast.addEventListener('click', function () {
            if (tab) state.activeTab = tab;
            state.open = true;
            render();
            toast.remove();
        });

        container.appendChild(toast);
        setTimeout(function () {
            if (toast && toast.parentNode) toast.remove();
        }, 9000);
    }

    function processRefreshAlerts() {
        const current = currentAlertSnapshot();
        const baseline = state.alertBaseline || {};

        if (!baseline.initialized) {
            state.alertBaseline = {
                initialized: true,
                trainingKey: current.trainingKey,
                paidIds: current.paidIds,
                applicationIds: current.applicationIds,
                lowStockKeys: current.lowStockKeys,
                optimizerSignature: current.optimizerSignature
            };
            saveAlertBaseline();
            return;
        }

        if (state.settings.alertTraining && current.trainingKey && current.trainingKey !== baseline.trainingKey && current.latestAuto) {
            const next = trainingQueue()[0];
            showToast(
                'Training queue advanced',
                current.latestAuto.name + ' was trained and moved to the back.' + (next ? ' Next: ' + next.name + '.' : ''),
                'training',
                'info'
            );
        }

        if (state.settings.alertDues) {
            const oldPaid = new Set(baseline.paidIds || []);
            current.paidIds.forEach(function (id) {
                if (oldPaid.has(id)) return;
                const employee = duesEmployees().find(function (entry) { return String(entry.id) === String(id); });
                if (employee) showToast('eDVD dues paid', employee.name + ' is now marked paid for ' + currentMonth() + '.', 'dues', 'success');
            });
        }

        if (state.settings.alertApplications) {
            const oldApps = new Set(baseline.applicationIds || []);
            current.applicationIds.forEach(function (id) {
                if (oldApps.has(id)) return;
                const application = state.applications.find(function (entry) { return applicationAlertId(entry) === id; });
                const name = application && application.player ? (application.player.name || application.player.id) : 'A player';
                showToast('New company application', name + ' submitted an application.', 'recruiting', 'info');
            });
        }

        if (state.settings.alertStock) {
            const oldLow = new Set(baseline.lowStockKeys || []);
            const newlyLow = current.lowStockKeys.filter(function (key) { return !oldLow.has(key); });
            if (newlyLow.length) {
                showToast(
                    'Low-stock warning',
                    newlyLow.length + ' item' + (newlyLow.length === 1 ? '' : 's') + ' newly dropped below the low-stock threshold.',
                    'stock',
                    'warning'
                );
            }
        }

        if (state.settings.alertOptimizer && current.optimizerSignature &&
            current.optimizerSignature !== baseline.optimizerSignature && current.optimizer && current.optimizer.changes) {
            showToast(
                'Role optimizer changed',
                current.optimizer.changes + ' position change' + (current.optimizer.changes === 1 ? '' : 's') + ' currently recommended.',
                'recruiting',
                'warning'
            );
        }

        state.alertBaseline = {
            initialized: true,
            trainingKey: current.trainingKey,
            paidIds: current.paidIds,
            applicationIds: current.applicationIds,
            lowStockKeys: current.lowStockKeys,
            optimizerSignature: current.optimizerSignature
        };
        saveAlertBaseline();
    }

    function applyLauncherPosition(launcher) {
        if (!launcher || !state.launcherPosition) return;
        const maxLeft = Math.max(6, window.innerWidth - launcher.offsetWidth - 6);
        const maxTop = Math.max(6, window.innerHeight - launcher.offsetHeight - 6);
        const left = Math.max(6, Math.min(maxLeft, num(state.launcherPosition.left)));
        const top = Math.max(6, Math.min(maxTop, num(state.launcherPosition.top)));
        launcher.style.left = left + 'px';
        launcher.style.top = top + 'px';
        launcher.style.right = 'auto';
        launcher.style.bottom = 'auto';
        state.launcherPosition = { left: left, top: top };
    }

    function updateLauncher() {
        const launcher = document.getElementById('tccc-launch');
        if (!launcher) return;

        const hiddenForPage = state.settings.launcherCompanyOnly && !isCompanyArea();
        launcher.style.display = hiddenForPage ? 'none' : 'flex';
        if (hiddenForPage) return;

        const attention = attentionSummary();
        const badge = attention.count ? '<span class="tccc-launch-badge">' + esc(attention.count) + '</span>' : '';
        launcher.innerHTML = '<span>COMPANY CC</span>' + badge;

        const freshness = freshnessInfo();
        launcher.title = APP.name + ' · ' + freshness.label +
            (attention.count ? ' · ' + attention.count + ' attention categor' + (attention.count === 1 ? 'y' : 'ies') : '');
        applyLauncherPosition(launcher);
    }

    function resetLauncherPosition() {
        state.launcherPosition = null;
        saveLauncherPosition();
        const launcher = document.getElementById('tccc-launch');
        if (launcher) {
            launcher.style.left = '';
            launcher.style.top = '';
            launcher.style.right = '18px';
            launcher.style.bottom = '82px';
        }
        updateLauncher();
    }

    function autoRefreshIntervalMs() {
        const minutes = Math.max(15, Math.min(120, num(state.settings.autoRefreshMinutes) || 30));
        return minutes * 60 * 1000;
    }

    function refreshAgeLabel() {
        if (!state.lastRefreshAt) return 'not yet';
        const seconds = Math.max(0, Math.floor(Date.now() / 1000) - state.lastRefreshAt);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        return Math.floor(hours / 24) + 'd ago';
    }

    function autoRefreshStatusText() {
        if (!state.settings.autoRefreshEnabled) return 'Auto-refresh OFF';
        return 'Auto-refresh ON · ' + Math.max(15, Math.min(120, num(state.settings.autoRefreshMinutes) || 30)) +
            'm · last ' + refreshAgeLabel();
    }

    function shouldRefreshAfterReturn() {
        if (!state.lastRefreshAt) return true;
        const returnThreshold = Math.min(autoRefreshIntervalMs(), 10 * 60 * 1000);
        return (Date.now() - (state.lastRefreshAt * 1000)) >= returnThreshold;
    }

    function autoRefreshTick() {
        if (!state.settings.autoRefreshEnabled || !state.settings.apiKey || state.loading) return;

        const currentDay = tctDay();
        const now = new Date();

        if (currentDay !== autoRuntimeDay) {
            autoRuntimeDay = currentDay;
            preMidnightCapturedDay = '';
            refreshData('new-tct-day');
            return;
        }

        // When Torn is open near TCT reset, capture a near-end-of-day snapshot once.
        if (now.getUTCHours() === 23 && now.getUTCMinutes() >= 55 && preMidnightCapturedDay !== currentDay) {
            preMidnightCapturedDay = currentDay;
            refreshData('end-of-day-snapshot');
            return;
        }

        if (!state.lastRefreshAt || (Date.now() - (state.lastRefreshAt * 1000)) >= autoRefreshIntervalMs()) {
            refreshData('auto-interval');
        }
    }

    function refreshOnReturn() {
        if (document.visibilityState && document.visibilityState !== 'visible') return;
        if (!state.settings.autoRefreshEnabled || !state.settings.apiKey || state.loading) return;

        const currentDay = tctDay();
        if (currentDay !== autoRuntimeDay) {
            autoRuntimeDay = currentDay;
            preMidnightCapturedDay = '';
            refreshData('return-new-day');
            return;
        }

        if (shouldRefreshAfterReturn()) refreshData('return-to-torn');
    }

    function startAutoRefresh(runImmediately) {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);
        autoRuntimeDay = tctDay();

        // A one-minute heartbeat handles interval due checks and TCT day rollover.
        autoRefreshTimer = setInterval(autoRefreshTick, 60 * 1000);

        document.removeEventListener('visibilitychange', refreshOnReturn);
        document.addEventListener('visibilitychange', refreshOnReturn);
        window.removeEventListener('focus', refreshOnReturn);
        window.addEventListener('focus', refreshOnReturn);

        if (runImmediately && state.settings.autoRefreshEnabled && state.settings.apiKey && !state.loading) {
            refreshData('startup');
        }
    }

    async function refreshData(reason) {
        if (state.loading) return;
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
                apiGet('/company/applications'),
                apiGet('/company/news', { cat: 'training', limit: 100, sort: 'DESC' }),
                apiGet('/company/news', { cat: 'funds', limit: 100, sort: 'DESC' })
            ]);

            state.profile = results[0].profile || null;
            state.employees = Array.isArray(results[1].employees) ? results[1].employees : [];
            state.stock = Array.isArray(results[2].stock) ? results[2].stock : [];
            state.applications = Array.isArray(results[3].applications) ? results[3].applications : [];
            state.trainingNews = Array.isArray(results[4].news) ? results[4].news : [];
            state.fundNews = Array.isArray(results[5].news) ? results[5].news : [];
            syncTrainingRotation();
            await scanDuesLogs();
            saveEmployeeSnapshot();
            saveStockSnapshot();
            saveTodaySnapshot();
            state.lastRefreshAt = Math.floor(Date.now() / 1000);
            state.lastRefreshReason = typeof reason === 'string' ? reason : 'manual';
            autoRuntimeDay = tctDay();
            processRefreshAlerts();
        } catch (e) {
            state.error = e && e.message ? e.message : String(e);
        } finally {
            state.loading = false;
            render();
        }
    }

    function itemQuantityFromLog(items, itemId) {
        if (!items) return 0;
        const wanted = String(itemId);

        if (Array.isArray(items)) {
            return items.reduce(function (total, item) {
                if (!item || typeof item !== 'object') return total;
                const id = item.id !== undefined ? item.id : (item.item_id !== undefined ? item.item_id : item.item);
                if (String(id) !== wanted) return total;
                return total + num(item.quantity !== undefined ? item.quantity :
                    (item.qty !== undefined ? item.qty : (item.amount !== undefined ? item.amount : 0)));
            }, 0);
        }

        if (typeof items === 'object') {
            if (Object.prototype.hasOwnProperty.call(items, wanted)) {
                const direct = items[wanted];
                if (Array.isArray(direct)) return num(direct[0]);
                if (direct && typeof direct === 'object') {
                    return num(direct.quantity !== undefined ? direct.quantity :
                        (direct.qty !== undefined ? direct.qty : (direct.amount !== undefined ? direct.amount : 0)));
                }
                return num(direct);
            }

            return Object.keys(items).reduce(function (total, key) {
                const item = items[key];
                if (!item || typeof item !== 'object' || Array.isArray(item)) return total;
                const id = item.id !== undefined ? item.id : (item.item_id !== undefined ? item.item_id : item.item);
                if (String(id) !== wanted) return total;
                return total + num(item.quantity !== undefined ? item.quantity :
                    (item.qty !== undefined ? item.qty : (item.amount !== undefined ? item.amount : 0)));
            }, 0);
        }

        return 0;
    }

    async function resetCurrentDuesMonth() {
        const month = currentMonth();
        const confirmed = window.confirm(
            'Reset all eDVD dues for ' + month + '?\n\n' +
            'This clears every paid/unpaid override for the month and ignores all qualifying eDVD sends received before this moment. New qualifying sends after the reset will count normally.'
        );
        if (!confirmed) return;

        state.dues[month] = {};
        state.duesResetAt[month] = Math.floor(Date.now() / 1000);
        saveDues();

        state.duesScan.matches = [];
        state.alertBaseline.paidIds = [];
        saveAlertBaseline();
        if (state.duesScan.status === 'ready') {
            applyAutomaticDuesMatches(state.duesScan.logs || []);
        }
        render();
    }

    function clearDueOverride(employeeId) {
        const ledger = monthLedger(currentMonth());
        const key = String(employeeId);
        const record = ledger[key] || {};
        delete record.manualOverride;
        ledger[key] = record;
        saveDues();
        applyAutomaticDuesMatches(state.duesScan.logs || []);
        render();
    }

    function applyAutomaticDuesMatches(logs) {
        const month = currentMonth();
        const ledger = monthLedger(month);
        const employeeIds = new Set(duesEmployees().map(function (employee) { return String(employee.id); }));
        const aggregates = {};

        const resetAt = num(state.duesResetAt[month]);

        (logs || []).forEach(function (entry) {
            if (resetAt && num(entry && entry.timestamp) < resetAt) return;

            const details = entry && entry.details ? entry.details : {};
            if (num(details.id) !== 4103 && String(details.title || '').toLowerCase() !== 'item receive') return;

            const data = entry.data || {};
            const senderId = String(data.sender !== undefined ? data.sender :
                (data.sender_id !== undefined ? data.sender_id : ''));
            if (!employeeIds.has(senderId)) return;

            const quantity = itemQuantityFromLog(data.items, 366);
            if (quantity <= 0) return;

            const message = data.message || '';
            if (!messageMatchesDuesKeyword(message)) return;

            if (!aggregates[senderId]) {
                aggregates[senderId] = {
                    quantity: 0,
                    latest: 0,
                    messages: [],
                    logIds: []
                };
            }

            aggregates[senderId].quantity += quantity;
            aggregates[senderId].latest = Math.max(aggregates[senderId].latest, num(entry.timestamp));
            aggregates[senderId].messages.push(String(message || ''));
            aggregates[senderId].logIds.push(String(entry.id || ''));
        });

        const required = Math.max(1, num(state.settings.edvdQty) || 1);
        state.duesScan.matches = [];

        duesEmployees().forEach(function (employee) {
            const key = String(employee.id);
            const aggregate = aggregates[key] || { quantity: 0, latest: 0, messages: [], logIds: [] };
            const existing = ledger[key] || {};
            existing.receivedQty = aggregate.quantity;
            existing.detectedLogs = aggregate.logIds;
            existing.detectedMessages = aggregate.messages;

            if (existing.manualOverride === 'paid') {
                existing.paid = true;
            } else if (existing.manualOverride === 'unpaid') {
                existing.paid = false;
            } else if (aggregate.quantity >= required) {
                existing.paid = true;
                existing.paidAt = aggregate.latest || existing.paidAt || Math.floor(Date.now() / 1000);
                existing.method = 'AUTO · ' + aggregate.quantity + ' eDVD · ' + duesKeywords().join('/');
                existing.auto = true;
            } else if (existing.auto) {
                existing.paid = false;
                existing.paidAt = null;
                existing.method = '';
                existing.auto = false;
            }

            if (aggregate.quantity > 0) {
                state.duesScan.matches.push({
                    employeeId: key,
                    employeeName: employee.name,
                    quantity: aggregate.quantity,
                    paid: aggregate.quantity >= required,
                    timestamp: aggregate.latest
                });
            }

            ledger[key] = existing;
        });

        saveDues();
    }

    async function scanDuesLogs() {
        state.duesScan.status = 'checking';
        state.duesScan.error = '';

        const scanKey = String(state.settings.duesApiKey || state.settings.apiKey || '').trim();
        if (!scanKey) {
            state.duesScan.status = 'locked';
            state.duesScan.error = 'No API key is available for the dues scanner.';
            return;
        }

        try {
            const data = await apiGet('/user/log', {
                log: 4103,
                from: monthStartTimestamp(currentMonth()),
                limit: 100
            }, scanKey);

            state.duesScan.logs = Array.isArray(data.log) ? data.log : [];
            state.duesScan.checkedAt = Math.floor(Date.now() / 1000);
            state.duesScan.status = 'ready';
            state.duesScan.error = '';
            applyAutomaticDuesMatches(state.duesScan.logs);
        } catch (error) {
            state.duesScan.logs = [];
            state.duesScan.matches = [];
            state.duesScan.checkedAt = Math.floor(Date.now() / 1000);
            state.duesScan.status = 'locked';
            state.duesScan.error = error && error.message ? error.message : String(error);
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
        const existing = ledger[key] || {};

        if (existing.paid) {
            ledger[key] = Object.assign({}, existing, {
                paid: false,
                paidAt: null,
                method: 'Manual override: unpaid',
                manualOverride: 'unpaid',
                auto: false
            });
        } else {
            ledger[key] = Object.assign({}, existing, {
                paid: true,
                paidAt: Math.floor(Date.now() / 1000),
                method: 'Manual payment',
                manualOverride: 'paid',
                auto: false
            });
        }

        saveDues();
        render();
    }

    function recordedSnapshotDays(limit) {
        const days = Object.keys(state.snapshots).sort().reverse();
        return typeof limit === 'number' ? days.slice(0, limit) : days;
    }

    function completedSnapshotDays(limit) {
        const today = tctDay();
        const days = Object.keys(state.snapshots)
            .filter(function (day) { return day < today; })
            .sort()
            .reverse();
        return typeof limit === 'number' ? days.slice(0, limit) : days;
    }

    function average(values) {
        if (!values.length) return 0;
        return values.reduce(function (sum, value) { return sum + num(value); }, 0) / values.length;
    }

    function sum(values) {
        return values.reduce(function (total, value) { return total + num(value); }, 0);
    }

    function snapshotOperatingProfit(snapshot) {
        if (!snapshot) return 0;
        return snapshot.operatingProfit !== undefined ? num(snapshot.operatingProfit) : num(snapshot.net);
    }

    function snapshotOperatingMargin(snapshot) {
        if (!snapshot) return 0;
        const revenue = num(snapshot.revenue);
        return revenue > 0 ? (snapshotOperatingProfit(snapshot) / revenue) * 100 : 0;
    }

    function averageEmployeeEffectivenessForDay(day) {
        const snapshot = state.employeeHistory[day];
        if (!snapshot || !snapshot.employees) return null;
        const employees = Object.keys(snapshot.employees).map(function (id) {
            return snapshot.employees[id];
        });
        if (!employees.length) return null;
        return average(employees.map(function (employee) {
            return num(employee.effectiveness && employee.effectiveness.total);
        }));
    }

    function staffingPlanSummary() {
        ensureStaffingTargets();
        const counts = currentPositionCounts();
        const positions = Array.from(new Set(
            Object.keys(counts).concat(Object.keys(state.staffingTargets || {}))
        ));
        return positions.reduce(function (summary, position) {
            const current = num(counts[position]);
            const target = num(state.staffingTargets[position]);
            if (current < target) summary.short += target - current;
            if (current > target) summary.over += current - target;
            return summary;
        }, { short: 0, over: 0 });
    }

    function currentOptimizerSummary() {
        const requirements = companyRoleRequirements();
        if (!requirements) return null;

        ensureStaffingTargets();
        const roles = Object.keys(state.staffingTargets || {}).filter(function (role) {
            return requirements[role] && num(state.staffingTargets[role]) > 0;
        });
        if (!roles.length) return null;

        const multiplier = calibratedWorkStatMultiplier();
        const optimized = optimizeEmployeeAssignments(roles, state.staffingTargets, multiplier);
        if (!optimized.valid) return null;

        const changes = state.employees.filter(function (employee) {
            const assignment = optimized.byEmployee[String(employee.id)];
            return assignment && assignment.role !== ((employee.position && employee.position.name) || '');
        }).length;

        return {
            changes: changes,
            currentScore: currentAssignmentScore(multiplier),
            optimizedScore: optimized.totalScore,
            manager: optimized.manager || null
        };
    }

    function analyticsWindow(days, completedOnly) {
        const sourceDays = completedOnly ? completedSnapshotDays(days) : recordedSnapshotDays(days);
        return sourceDays.map(function (day) {
            return { day: day, snapshot: state.snapshots[day] };
        });
    }

    function analyticsSummary(days, completedOnly) {
        const rows = analyticsWindow(days, completedOnly);
        const snapshots = rows.map(function (row) { return row.snapshot; });
        const revenues = snapshots.map(function (snapshot) { return num(snapshot.revenue); });
        const profits = snapshots.map(snapshotOperatingProfit);
        const ads = snapshots.map(function (snapshot) { return num(snapshot.advertising); });
        const margins = snapshots.map(snapshotOperatingMargin);
        const adjustedCash = snapshots.map(function (snapshot) {
            return snapshot.adjustedCashChange !== undefined ? num(snapshot.adjustedCashChange) : 0;
        });

        return {
            days: rows.length,
            avgRevenue: average(revenues),
            totalRevenue: sum(revenues),
            avgProfit: average(profits),
            totalProfit: sum(profits),
            avgMargin: average(margins),
            totalAds: sum(ads),
            avgAds: average(ads),
            revenuePerAdDollar: sum(ads) > 0 ? sum(revenues) / sum(ads) : 0,
            adBurden: sum(revenues) > 0 ? (sum(ads) / sum(revenues)) * 100 : 0,
            adjustedCash: sum(adjustedCash)
        };
    }

    function ratingHistorySummary() {
        const days = Object.keys(state.snapshots).sort();
        const entries = [];
        let previousRating = null;

        days.forEach(function (day) {
            const rating = num(state.snapshots[day] && state.snapshots[day].rating);
            if (previousRating === null || rating !== previousRating) {
                entries.push({ day: day, rating: rating });
                previousRating = rating;
            }
        });

        return entries;
    }

    function analyticsHtml() {
        if (!state.profile) return emptyConnectHtml();

        const allDays = recordedSnapshotDays();
        const completedDays = completedSnapshotDays();
        const seven = analyticsSummary(7, true);
        const thirty = analyticsSummary(30, true);
        const live = financeSummary();
        const currentRating = num(state.profile.rating);
        const ratingHistory = ratingHistorySummary();
        const oldestRating = allDays.length ? num(state.snapshots[allDays[allDays.length - 1]].rating) : currentRating;
        const ratingDelta = currentRating - oldestRating;
        const hasCompleted = completedDays.length > 0;

        let html = cards([
            {
                label: 'Today · Live Sales',
                value: money.format(live.revenue),
                sub: 'In-progress TCT day'
            },
            {
                label: 'Today · Live Op. Profit',
                value: money.format(live.operatingProfit),
                sub: live.operatingMargin.toFixed(1) + '% provisional margin',
                className: live.operatingProfit >= 0 ? 'good' : 'bad'
            },
            {
                label: 'Completed History',
                value: completedDays.length + ' day' + (completedDays.length === 1 ? '' : 's'),
                sub: allDays.length + ' total day snapshot' + (allDays.length === 1 ? '' : 's') + ' including today'
            },
            {
                label: '7d Completed Avg Sales',
                value: hasCompleted ? money.format(seven.avgRevenue) : '—',
                sub: hasCompleted ? seven.days + ' completed day' + (seven.days === 1 ? '' : 's') : 'Starts after the first completed TCT day'
            },
            {
                label: '7d Completed Avg Profit',
                value: hasCompleted ? money.format(seven.avgProfit) : '—',
                sub: hasCompleted ? seven.avgMargin.toFixed(1) + '% average margin' : 'Today is excluded while still in progress',
                className: hasCompleted ? (seven.avgProfit >= 0 ? 'good' : 'bad') : ''
            },
            {
                label: 'Revenue / Ad Dollar',
                value: hasCompleted && seven.revenuePerAdDollar ? seven.revenuePerAdDollar.toFixed(2) + '×' : '—',
                sub: hasCompleted ? seven.adBurden.toFixed(1) + '% ad burden across completed days' : 'Waiting for completed-day data'
            },
            {
                label: 'Current Stars',
                value: currentRating + '★',
                sub: (ratingDelta >= 0 ? '+' : '') + ratingDelta + ' across recorded history'
            },
            {
                label: '30d Completed Profit',
                value: thirty.days ? money.format(thirty.totalProfit) : '—',
                sub: thirty.days ? thirty.days + ' completed day' + (thirty.days === 1 ? '' : 's') : 'No completed days yet',
                className: thirty.days ? (thirty.totalProfit >= 0 ? 'good' : 'bad') : ''
            }
        ]);

        html += '<div class="tccc-grid2">';
        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Today · live performance</h3><span>Current TCT day — provisional until reset</span></div></div><div class="tccc-analytics-grid">';
        html += '<div><span>Sales so far</span><strong>' + esc(money.format(live.revenue)) + '</strong></div>';
        html += '<div><span>Operating profit so far</span><strong class="' + (live.operatingProfit >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(money.format(live.operatingProfit)) + '</strong></div>';
        html += '<div><span>Current operating margin</span><strong class="' + (live.operatingMargin >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(live.operatingMargin.toFixed(1) + '%') + '</strong></div>';
        html += '<div><span>Advertising budget</span><strong>' + esc(money.format(live.advertising)) + '</strong></div>';
        html += '<div><span>Revenue per ad dollar so far</span><strong>' + (live.advertising > 0 ? esc((live.revenue / live.advertising).toFixed(2) + '×') : '—') + '</strong></div>';
        html += '<div><span>Break-even sales</span><strong>' + esc(money.format(live.breakEvenRevenue)) + '</strong></div>';
        html += '</div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>7-day completed performance</h3><span>Current TCT day is excluded</span></div></div>';
        if (!hasCompleted) {
            html += '<div class="tccc-recruit-empty"><strong>Waiting for the first completed day</strong><span>Tomorrow, today\'s final stored snapshot becomes the first completed-day data point for rolling analytics.</span></div>';
        } else {
            html += '<div class="tccc-analytics-grid">';
            html += '<div><span>Total sales</span><strong>' + esc(money.format(seven.totalRevenue)) + '</strong></div>';
            html += '<div><span>Total operating profit</span><strong class="' + (seven.totalProfit >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(money.format(seven.totalProfit)) + '</strong></div>';
            html += '<div><span>Average operating margin</span><strong class="' + (seven.avgMargin >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(seven.avgMargin.toFixed(1) + '%') + '</strong></div>';
            html += '<div><span>Advertising spend</span><strong>' + esc(money.format(seven.totalAds)) + '</strong></div>';
            html += '<div><span>Revenue per ad dollar</span><strong>' + (seven.revenuePerAdDollar ? esc(seven.revenuePerAdDollar.toFixed(2) + '×') : '—') + '</strong></div>';
            html += '<div><span>Adjusted cash movement</span><strong class="' + (seven.adjustedCash >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc((seven.adjustedCash >= 0 ? '+' : '') + money.format(seven.adjustedCash)) + '</strong></div>';
            html += '</div>';
        }
        html += '</section></div>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Company health now</h3><span>Current Torn company metrics</span></div></div><div class="tccc-health">';
        html += healthRow('Efficiency', state.profile.efficiency);
        html += healthRow('Environment', state.profile.environment);
        html += healthRow('Popularity', state.profile.popularity);
        html += healthRow('Available trains', state.profile.trains, true);
        html += '</div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Daily performance history</h3><span>Today is marked LIVE; prior dates are completed historical snapshots</span></div></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>TCT Day</th><th>State</th><th>Sales</th><th>Operating Profit</th><th>Margin</th><th>Advertising</th><th>Ad Burden</th><th>Adjusted Cash Δ</th><th>Stars</th><th>Avg Employee Eff.</th><th>Eff.</th><th>Env.</th><th>Pop.</th></tr></thead><tbody>';

        if (!allDays.length) {
            html += '<tr><td colspan="13">No analytics history yet.</td></tr>';
        } else {
            allDays.slice(0, 30).forEach(function (day) {
                const snapshot = state.snapshots[day] || {};
                const revenue = num(snapshot.revenue);
                const profit = snapshotOperatingProfit(snapshot);
                const margin = snapshotOperatingMargin(snapshot);
                const ad = num(snapshot.advertising);
                const adBurden = revenue > 0 ? (ad / revenue) * 100 : 0;
                const adjusted = snapshot.adjustedCashChange !== undefined ? num(snapshot.adjustedCashChange) : 0;
                const employeeAverage = averageEmployeeEffectivenessForDay(day);
                const isLive = day === tctDay();

                html += '<tr' + (isLive ? ' class="tccc-live-row"' : '') + '><td>' + esc(day) + '</td><td><span class="tccc-day-state ' + (isLive ? 'live' : 'complete') + '">' + (isLive ? 'LIVE' : 'COMPLETE') + '</span></td><td>' + esc(money.format(revenue)) + '</td><td class="' +
                    (profit >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(money.format(profit)) + '</td><td class="' +
                    (margin >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(margin.toFixed(1) + '%') + '</td><td>' +
                    esc(money.format(ad)) + '</td><td>' + esc(adBurden.toFixed(1) + '%') + '</td><td class="' +
                    (adjusted >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc((adjusted >= 0 ? '+' : '') + money.format(adjusted)) + '</td><td>' +
                    esc(num(snapshot.rating)) + '★</td><td>' + (employeeAverage === null ? '—' : esc(employeeAverage.toFixed(1))) + '</td><td>' +
                    (snapshot.efficiency === undefined ? '—' : esc(num(snapshot.efficiency) + '%')) + '</td><td>' +
                    (snapshot.environment === undefined ? '—' : esc(num(snapshot.environment) + '%')) + '</td><td>' +
                    (snapshot.popularity === undefined ? '—' : esc(num(snapshot.popularity) + '%')) + '</td></tr>';
            });
        }

        html += '</tbody></table></div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Star history</h3><span>Records rating changes observed by the script</span></div></div><div class="tccc-star-history">';
        if (!ratingHistory.length) {
            html += '<div class="tccc-training-log-empty">No star history recorded yet.</div>';
        } else {
            ratingHistory.slice().reverse().forEach(function (entry, index) {
                html += '<div><span>' + esc(entry.day) + '</span><strong>' + esc(entry.rating) + '★</strong>' +
                    (index === 0 ? '<small>current/latest recorded</small>' : '') + '</div>';
            });
        }
        html += '</div></section>';

        html += '<div class="tccc-note"><strong>Historical analytics now exclude today.</strong> Live numbers remain visible separately, but 7-day and 30-day rolling metrics only use dates before the current TCT day. Because the script is local-first, a completed day still reflects the last snapshot you captured on that date; refreshing near the end of TCT gives the most complete historical record.</div>';
        return html;
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
        const rotation = trainingQueue();
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

        const stockPlan = stockCapacityPlan();
        const lowStockCount = stockPlan.rows.filter(function (row) { return row.status === 'low'; }).length;
        const watchStockCount = stockPlan.rows.filter(function (row) { return row.status === 'watch'; }).length;
        const staffing = staffingPlanSummary();
        const optimizer = currentOptimizerSummary();
        const historyDepth = recordedSnapshotDays().length;
        const completedHistoryDepth = completedSnapshotDays().length;

        let html = cards([
            {
                label: 'Est. Operating Profit',
                value: money.format(f.operatingProfit),
                sub: f.operatingMargin.toFixed(1) + '% operating margin',
                className: f.operatingProfit >= 0 ? 'good' : 'bad'
            },
            {
                label: 'Gross Sales',
                value: money.format(f.revenue),
                sub: 'Torn-reported daily company income'
            },
            {
                label: 'Company Funds',
                value: money.format(num(state.profile.funds)),
                sub: 'Current company vault'
            },
            {
                label: 'Company Rating',
                value: num(state.profile.rating) + '★',
                sub: completedHistoryDepth + ' completed · ' + historyDepth + ' total captured day' + (historyDepth === 1 ? '' : 's')
            }
        ]);

        html += '<section class="tccc-panel tccc-director-brief"><div class="tccc-panel-head"><div><h3>Director brief</h3><span>What deserves your attention right now</span></div><button data-tabgo="analytics" class="tccc-small-action">Open analytics</button></div><div class="tccc-brief-grid">';

        html += '<button data-tabgo="finances" class="' + (f.operatingProfit < 0 ? 'danger' : 'ok') + '"><span>FINANCES</span><strong>' +
            esc(money.format(f.operatingProfit)) + '</strong><small>' + (f.operatingProfit < 0 ? 'Estimated operating loss today' : 'Estimated operating profit today') + '</small></button>';

        html += '<button data-tabgo="training" class="info"><span>TRAINING</span><strong>' +
            (next ? esc(next.name) : 'None') + '</strong><small>' + esc(num(state.profile.trains)) + ' train' + (num(state.profile.trains) === 1 ? '' : 's') + ' available</small></button>';

        html += '<button data-tabgo="dues" class="' + (unpaid.length ? 'warn' : 'ok') + '"><span>eDVD DUES</span><strong>' +
            esc(unpaid.length) + ' unpaid</strong><small>' + esc(dueList.length - unpaid.length) + ' of ' + esc(dueList.length) + ' marked paid</small></button>';

        html += '<button data-tabgo="employees" class="' + (warningEmployees.length ? 'warn' : 'ok') + '"><span>EMPLOYEES</span><strong>' +
            esc(warningEmployees.length) + ' issue' + (warningEmployees.length === 1 ? '' : 's') + '</strong><small>Addiction / inactivity penalties</small></button>';

        html += '<button data-tabgo="stock" class="' + (lowStockCount ? 'danger' : (watchStockCount ? 'warn' : 'ok')) + '"><span>STOCK</span><strong>' +
            esc(lowStockCount) + ' low · ' + esc(watchStockCount) + ' watch</strong><small>' +
            esc(stockPlan.committedUnits.toLocaleString()) + ' / ' + esc(stockPlan.capacity.toLocaleString()) + ' capacity committed</small></button>';

        html += '<button data-tabgo="recruiting" class="' + (state.applications.length ? 'info' : 'ok') + '"><span>RECRUITING</span><strong>' +
            esc(state.applications.length) + ' application' + (state.applications.length === 1 ? '' : 's') + '</strong><small>' +
            (state.profile.applications_allowed ? 'Applications are open' : 'Applications are closed') + '</small></button>';

        html += '<button data-tabgo="recruiting" class="' + (staffing.short || staffing.over ? 'warn' : 'ok') + '"><span>STAFFING PLAN</span><strong>' +
            esc(staffing.short) + ' short · ' + esc(staffing.over) + ' over</strong><small>Compared with your saved targets</small></button>';

        html += '<button data-tabgo="recruiting" class="' + (optimizer && optimizer.changes ? 'warn' : 'ok') + '"><span>ROLE OPTIMIZER</span><strong>' +
            esc(optimizer ? optimizer.changes : 0) + ' change' + ((optimizer ? optimizer.changes : 0) === 1 ? '' : 's') + '</strong><small>' +
            (optimizer && optimizer.manager ? 'Manager: ' + esc(optimizer.manager.name) : 'Current lineup evaluated') + '</small></button>';

        html += '</div></section>';

        html += '<div class="tccc-grid2">';
        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Company health</h3><span>Live Torn metrics</span></div><div class="tccc-health">';
        html += healthRow('Efficiency', state.profile.efficiency);
        html += healthRow('Environment', state.profile.environment);
        html += healthRow('Popularity', state.profile.popularity);
        html += healthRow('Available trains', state.profile.trains, true);
        html += '</div></section>';

        const seven = analyticsSummary(7, true);
        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Completed-day trend</h3><span>Current TCT day excluded</span></div><div class="tccc-overview-trend">';
        if (!seven.days) {
            html += '<div class="tccc-trend-waiting"><span>Rolling analytics</span><strong>Starts tomorrow</strong></div>';
            html += '<div><span>Completed history</span><strong>0 days</strong></div>';
        } else {
            html += '<div><span>Avg sales</span><strong>' + esc(money.format(seven.avgRevenue)) + '</strong></div>';
            html += '<div><span>Avg operating profit</span><strong class="' + (seven.avgProfit >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(money.format(seven.avgProfit)) + '</strong></div>';
            html += '<div><span>Avg operating margin</span><strong class="' + (seven.avgMargin >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(seven.avgMargin.toFixed(1) + '%') + '</strong></div>';
            html += '<div><span>Completed history</span><strong>' + esc(seven.days) + ' day' + (seven.days === 1 ? '' : 's') + '</strong></div>';
        }
        html += '</div></section></div>';

        html += '<div class="tccc-note">The Director Brief combines the systems already built into the script. It is meant to surface attention items, not replace the detailed tabs. Financial figures remain estimates based on Torn-reported sales, item costs, advertising, wages, and your configured manual costs.</div>';
        return html;
    }

    function healthRow(label, value, raw) {
        const n = num(value);
        const width = raw ? Math.min(100, n * 10) : Math.min(100, Math.max(0, n));
        return '<div class="tccc-health-row"><div><span>' + esc(label) + '</span><b>' + esc(n) + (raw ? '' : '%') + '</b></div>' +
            '<div class="tccc-meter"><span style="width:' + width + '%"></span></div></div>';
    }

    function newsPlainText(html) {
        const holder = document.createElement('div');
        holder.innerHTML = html || '';
        return (holder.textContent || holder.innerText || '').replace(/\s+/g, ' ').trim();
    }

    function financesHtml() {
        if (!state.profile) return emptyConnectHtml();

        const f = financeSummary();
        const history = Object.keys(state.snapshots).sort().reverse().slice(0, 14);
        const today = state.snapshots[tctDay()] || {};
        const fundsChange = today.rawFundsChange !== undefined ? num(today.rawFundsChange) :
            (num(today.funds) - num(today.openingFunds));
        const externalDeposits = num(today.externalDeposits);
        const externalWithdrawals = num(today.externalWithdrawals);
        const externalTransferNet = externalDeposits - externalWithdrawals;
        const adjustedCashChange = today.adjustedCashChange !== undefined ? num(today.adjustedCashChange) :
            (fundsChange - externalDeposits + externalWithdrawals);
        const stockMatchesRevenue = Math.abs(f.stockSales - f.revenue) <= 1;

        let html = cards([
            {
                label: 'Gross Sales',
                value: money.format(f.revenue),
                sub: stockMatchesRevenue ? 'Matches item sales reported by Torn' : 'Torn daily company income'
            },
            {
                label: 'Est. COGS',
                value: money.format(f.cogs),
                sub: 'Units sold × stock cost'
            },
            {
                label: 'Gross Profit',
                value: money.format(f.grossProfit),
                sub: f.grossMargin.toFixed(1) + '% gross margin',
                className: f.grossProfit >= 0 ? 'good' : 'bad'
            },
            {
                label: 'Advertising',
                value: money.format(f.advertising),
                sub: 'Current daily advertising budget'
            },
            {
                label: 'Wages + Other',
                value: money.format(f.wages + f.extra),
                sub: money.format(f.wages) + ' wages + ' + money.format(f.extra) + ' manual'
            },
            {
                label: 'Operating Profit',
                value: money.format(f.operatingProfit),
                sub: f.operatingMargin.toFixed(1) + '% operating margin',
                className: f.operatingProfit >= 0 ? 'good' : 'bad'
            },
            {
                label: 'Break-even Sales',
                value: money.format(f.breakEvenRevenue),
                sub: 'At today\'s product-margin mix'
            },
            {
                label: 'Raw Funds Change',
                value: (fundsChange >= 0 ? '+' : '') + money.format(fundsChange),
                sub: 'Vault movement since first capture today',
                className: fundsChange >= 0 ? 'good' : 'bad'
            },
            {
                label: 'External Transfers',
                value: (externalTransferNet >= 0 ? '+' : '') + money.format(externalTransferNet),
                sub: money.format(externalDeposits) + ' in / ' + money.format(externalWithdrawals) + ' out'
            },
            {
                label: 'Adjusted Cash Change',
                value: (adjustedCashChange >= 0 ? '+' : '') + money.format(adjustedCashChange),
                sub: 'Vault movement with deposits/withdrawals removed',
                className: adjustedCashChange >= 0 ? 'good' : 'bad'
            }
        ]);

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Today\'s profit bridge</h3><span>Operating performance — not the same thing as bank/vault cash movement</span></div>';
        html += '<div class="tccc-tablewrap"><table class="tccc-finance-bridge"><tbody>';
        html += '<tr><td><strong>Gross sales</strong></td><td class="tccc-positive">' + esc(money.format(f.revenue)) + '</td><td>Revenue generated from today\'s item sales</td></tr>';
        html += '<tr><td>Less: estimated cost of goods sold</td><td class="tccc-negative">−' + esc(money.format(f.cogs)) + '</td><td>Cost basis of the units actually sold today</td></tr>';
        html += '<tr class="tccc-finance-subtotal"><td><strong>Gross profit</strong></td><td class="' + (f.grossProfit >= 0 ? 'tccc-positive' : 'tccc-negative') + '"><strong>' + esc(money.format(f.grossProfit)) + '</strong></td><td>' + esc(f.grossMargin.toFixed(1)) + '% gross margin</td></tr>';
        html += '<tr><td>Less: advertising</td><td class="tccc-negative">−' + esc(money.format(f.advertising)) + '</td><td>Current daily ad budget</td></tr>';
        html += '<tr><td>Less: employee wages</td><td class="' + (f.wages > 0 ? 'tccc-negative' : '') + '">' + (f.wages > 0 ? '−' : '') + esc(money.format(f.wages)) + '</td><td>Sum of employee daily wages</td></tr>';
        html += '<tr><td>Less: manual daily costs</td><td class="' + (f.extra > 0 ? 'tccc-negative' : '') + '">' + (f.extra > 0 ? '−' : '') + esc(money.format(f.extra)) + '</td><td>Any additional cost you entered in Settings</td></tr>';
        html += '<tr class="tccc-finance-total"><td><strong>Estimated operating profit</strong></td><td class="' + (f.operatingProfit >= 0 ? 'tccc-positive' : 'tccc-negative') + '"><strong>' + esc(money.format(f.operatingProfit)) + '</strong></td><td>' + esc(f.operatingMargin.toFixed(1)) + '% operating margin</td></tr>';
        html += '</tbody></table></div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Cash reconciliation</h3><span>Separates outside player transfers from company-generated cash movement</span></div>';
        html += '<div class="tccc-cash-equation">';
        html += '<div><span>Raw funds change</span><strong class="' + (fundsChange >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc((fundsChange >= 0 ? '+' : '') + money.format(fundsChange)) + '</strong></div>';
        html += '<b>−</b><div><span>Deposits</span><strong>' + esc(money.format(externalDeposits)) + '</strong></div>';
        html += '<b>+</b><div><span>Withdrawals</span><strong>' + esc(money.format(externalWithdrawals)) + '</strong></div>';
        html += '<b>=</b><div class="result"><span>Adjusted cash change</span><strong class="' + (adjustedCashChange >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc((adjustedCashChange >= 0 ? '+' : '') + money.format(adjustedCashChange)) + '</strong></div>';
        html += '</div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Recent daily snapshots</h3><span>Latest value for each TCT day; opening funds preserved separately</span></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>TCT Day</th><th>Sales</th><th>COGS</th><th>Ads + Wages</th><th>Operating Profit</th><th>Funds</th><th>Raw Δ</th><th>External Transfers</th><th>Adjusted Cash Δ</th></tr></thead><tbody>';
        if (!history.length) {
            html += '<tr><td colspan="9">No history yet.</td></tr>';
        } else {
            history.forEach(function (day) {
                const s = state.snapshots[day];
                const op = s.operatingProfit !== undefined ? num(s.operatingProfit) : num(s.net);
                const dayCogs = num(s.cogs);
                const overhead = num(s.advertising) + num(s.wages);
                const opening = s.openingFunds !== undefined ? num(s.openingFunds) : num(s.funds);
                const delta = s.rawFundsChange !== undefined ? num(s.rawFundsChange) : (num(s.funds) - opening);
                const deposits = num(s.externalDeposits);
                const withdrawals = num(s.externalWithdrawals);
                const transferNet = deposits - withdrawals;
                const adjusted = s.adjustedCashChange !== undefined ? num(s.adjustedCashChange) :
                    (delta - deposits + withdrawals);

                html += '<tr><td>' + esc(day) + '</td><td>' + esc(money.format(num(s.revenue))) + '</td><td>' +
                    esc(money.format(dayCogs)) + '</td><td>' + esc(money.format(overhead)) + '</td><td class="' +
                    (op >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' + esc(money.format(op)) + '</td><td>' +
                    esc(money.format(num(s.funds))) + '</td><td class="' + (delta >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' +
                    esc((delta >= 0 ? '+' : '') + money.format(delta)) + '</td><td>' +
                    esc((transferNet >= 0 ? '+' : '') + money.format(transferNet)) + '</td><td class="' +
                    (adjusted >= 0 ? 'tccc-positive' : 'tccc-negative') + '">' +
                    esc((adjusted >= 0 ? '+' : '') + money.format(adjusted)) + '</td></tr>';
            });
        }
        html += '</tbody></table></div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Recent company fund activity</h3><span>Deposits and withdrawals are removed from adjusted cash performance</span></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>When</th><th>Type</th><th>Fund event</th></tr></thead><tbody>';
        if (!state.fundNews.length) {
            html += '<tr><td colspan="3">No recent fund-news entries were returned.</td></tr>';
        } else {
            state.fundNews.slice(0, 15).forEach(function (entry) {
                const parsed = parseFundEvent(entry);
                let eventClass = '';
                let badge = 'OTHER';

                if (parsed && parsed.type === 'deposit') {
                    eventClass = 'tccc-positive';
                    badge = 'DEPOSIT';
                } else if (parsed && parsed.type === 'withdrawal') {
                    eventClass = 'tccc-negative';
                    badge = 'WITHDRAWAL';
                }

                html += '<tr><td>' + esc(formatDate(entry.timestamp)) + '</td><td><span class="tccc-fund-badge ' +
                    esc(parsed ? parsed.type : 'other') + '">' + esc(badge) + '</span></td><td class="tccc-news-text ' +
                    eventClass + '">' + esc(parsed ? parsed.text : newsPlainText(entry.text)) + '</td></tr>';
            });
        }
        html += '</tbody></table></div></section>';

        html += '<div class="tccc-note"><strong>How to read this:</strong> Operating profit is the sales-side estimate. Raw funds change is what happened to the company vault. Adjusted cash change removes player deposits and withdrawals detected in Torn\'s funds news, so those outside transfers are not mistaken for company performance. Stock-order timing can still make operating profit and adjusted cash change differ, which is exactly what we will measure as the history builds.</div>';
        return html;
    }

    function employeesHtml() {
        if (!state.profile) return emptyConnectHtml();

        const allEmployees = state.employees.slice();
        const averageEffectiveness = allEmployees.length ?
            allEmployees.reduce(function (total, employee) {
                return total + num(employee.effectiveness && employee.effectiveness.total);
            }, 0) / allEmployees.length : 0;

        const addictionCount = allEmployees.filter(function (employee) {
            return num(employee.effectiveness && employee.effectiveness.addiction) < 0;
        }).length;
        const inactivityCount = allEmployees.filter(function (employee) {
            return num(employee.effectiveness && employee.effectiveness.inactivity) < 0;
        }).length;
        const clearCount = allEmployees.filter(function (employee) {
            const status = employeeStatus(employee);
            return status.key === 'clear';
        }).length;

        let rows = allEmployees.slice().sort(function (a, b) {
            const aIssue = employeeStatus(a).key === 'clear' ? 1 : 0;
            const bIssue = employeeStatus(b).key === 'clear' ? 1 : 0;
            if (aIssue !== bIssue) return aIssue - bIssue;
            return num(b.effectiveness && b.effectiveness.total) - num(a.effectiveness && a.effectiveness.total);
        });

        if (state.employeeFilter === 'issues') {
            rows = rows.filter(function (employee) { return employeeStatus(employee).key !== 'clear'; });
        } else if (state.employeeFilter === 'addiction') {
            rows = rows.filter(function (employee) {
                return num(employee.effectiveness && employee.effectiveness.addiction) < 0;
            });
        } else if (state.employeeFilter === 'inactivity') {
            rows = rows.filter(function (employee) {
                return num(employee.effectiveness && employee.effectiveness.inactivity) < 0;
            });
        }

        let html = cards([
            { label: 'Employees', value: allEmployees.length },
            { label: 'Average Effectiveness', value: averageEffectiveness.toFixed(1) },
            { label: 'No Active Penalties', value: clearCount + ' / ' + allEmployees.length, className: clearCount === allEmployees.length ? 'good' : '' },
            { label: 'Addiction Penalties', value: addictionCount, className: addictionCount ? 'bad' : 'good' },
            { label: 'Inactivity Penalties', value: inactivityCount, className: inactivityCount ? 'bad' : 'good' }
        ]);

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Employee management</h3><span>Issues are shown first; expand any employee for the full effectiveness breakdown</span></div></div>';
        html += '<div class="tccc-filterbar">';
        [
            ['all', 'All'],
            ['issues', 'Issues'],
            ['addiction', 'Addiction'],
            ['inactivity', 'Inactivity']
        ].forEach(function (filter) {
            html += '<button data-employee-filter="' + filter[0] + '" class="' + (state.employeeFilter === filter[0] ? 'active' : '') + '">' + filter[1] + '</button>';
        });
        html += '</div>';

        html += '<div class="tccc-tablewrap"><table><thead><tr><th>Employee</th><th>Position</th><th>Status</th><th>Effectiveness</th><th>Δ</th><th>Addiction</th><th>Inactivity</th><th>Wage</th><th>Days</th><th></th></tr></thead><tbody>';

        if (!rows.length) {
            html += '<tr><td colspan="10">No employees match this filter.</td></tr>';
        } else {
            rows.forEach(function (e) {
                const eff = e.effectiveness || {};
                const status = employeeStatus(e);
                const trend = employeeTrend(e.id);
                const delta = trend ? trend.total : null;
                const expanded = String(state.expandedEmployeeId) === String(e.id);

                html += '<tr><td><a href="/profiles.php?XID=' + encodeURIComponent(e.id) + '" target="_blank">' + esc(e.name) + '</a></td>' +
                    '<td>' + esc((e.position && e.position.name) || '') + '</td>' +
                    '<td><span class="tccc-employee-status ' + esc(status.className) + '">' + esc(status.label) + '</span></td>' +
                    '<td><strong>' + esc(num(eff.total)) + '</strong></td>' +
                    '<td class="' + (delta === null || delta === 0 ? '' : (delta > 0 ? 'tccc-positive' : 'tccc-negative')) + '">' +
                    (delta === null ? '—' : esc((delta > 0 ? '+' : '') + delta)) + '</td>' +
                    '<td class="' + (num(eff.addiction) < 0 ? 'tccc-negative' : '') + '">' + esc(num(eff.addiction)) + '</td>' +
                    '<td class="' + (num(eff.inactivity) < 0 ? 'tccc-negative' : '') + '">' + esc(num(eff.inactivity)) + '</td>' +
                    '<td>' + esc(money.format(num(e.wage))) + '</td><td>' + esc(num(e.days_in_company)) + '</td>' +
                    '<td><button class="tccc-expand-employee" data-employee-expand="' + esc(e.id) + '">' + (expanded ? 'HIDE' : 'DETAILS') + '</button></td></tr>';

                if (expanded) {
                    const detailKeys = Object.keys(eff).filter(function (key) { return key !== 'total'; });
                    html += '<tr class="tccc-employee-detail-row"><td colspan="10"><div class="tccc-employee-detail">';
                    html += '<div class="tccc-employee-detail-head"><div><strong>' + esc(e.name) + '</strong><span>' + esc((e.position && e.position.name) || '') + ' · ' + esc(num(e.days_in_company)) + ' days in company</span></div>';
                    if (trend) {
                        html += '<div class="tccc-trend-note">Compared with ' + esc(trend.previousDay) + ': effectiveness ' +
                            '<b class="' + (trend.total > 0 ? 'tccc-positive' : (trend.total < 0 ? 'tccc-negative' : '')) + '">' +
                            esc((trend.total > 0 ? '+' : '') + trend.total) + '</b>, addiction ' +
                            '<b class="' + (trend.addiction > 0 ? 'tccc-positive' : (trend.addiction < 0 ? 'tccc-negative' : '')) + '">' +
                            esc((trend.addiction > 0 ? '+' : '') + trend.addiction) + '</b>, inactivity ' +
                            '<b class="' + (trend.inactivity > 0 ? 'tccc-positive' : (trend.inactivity < 0 ? 'tccc-negative' : '')) + '">' +
                            esc((trend.inactivity > 0 ? '+' : '') + trend.inactivity) + '</b></div>';
                    } else {
                        html += '<div class="tccc-trend-note">Trend history starts after the script has snapshots from more than one TCT day.</div>';
                    }
                    html += '</div><div class="tccc-effectiveness-grid">';
                    detailKeys.forEach(function (key) {
                        const value = num(eff[key]);
                        html += '<div><span>' + esc(humanizeEffectivenessKey(key)) + '</span><strong class="' + (value < 0 ? 'tccc-negative' : (value > 0 ? 'tccc-positive' : '')) + '">' + esc(value) + '</strong></div>';
                    });
                    html += '<div><span>Total Effectiveness</span><strong>' + esc(num(eff.total)) + '</strong></div>';
                    html += '</div></div></td></tr>';
                }
            });
        }

        html += '</tbody></table></div></section>';
        html += '<div class="tccc-note"><strong>History starts now:</strong> the script saves one rolling employee snapshot per TCT day for up to 90 days. The Δ column compares total effectiveness with the most recent earlier day. Expanding an employee shows every effectiveness component Torn returned, so we do not have to hard-code only addiction and inactivity.</div>';
        return html;
    }

    function trainingHtml() {
        if (!state.profile) return emptyConnectHtml();

        const map = calculateTrainingMap();
        const queue = trainingQueue();
        const next = queue[0] || null;
        const lastAuto = state.trainingRotation.history.find(function (event) { return event.type === 'auto'; });

        let html = '';

        if (next) {
            const record = map[String(next.id)] || { last: 0, count: 0 };
            html += '<div class="tccc-next tccc-training-next"><div><span>Next in rotation</span><strong>' +
                esc(next.name) + '</strong><small>Last detected train: ' + esc(formatDate(record.last)) +
                ' · ' + esc(formatAge(record.last)) + '</small></div><div class="tccc-next-meta"><span>Queue position</span><strong>#1</strong></div></div>';
        }

        html += '<div class="tccc-training-summary">';
        html += '<div><span>Employees in queue</span><strong>' + esc(queue.length) + '</strong></div>';
        html += '<div><span>Available trains</span><strong>' + esc(num(state.profile.trains)) + '</strong></div>';
        html += '<div><span>Last auto-advance</span><strong>' + esc(lastAuto ? formatAge(lastAuto.timestamp) : 'None yet') + '</strong></div>';
        html += '<div><span>Rotation mode</span><strong>Persistent queue</strong></div>';
        html += '</div>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head tccc-training-head"><div><h3>Training queue</h3><span>When Torn detects a new train, that employee automatically moves to the back</span></div><button id="tccc-reset-training" class="tccc-small-action">Reset from history</button></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>#</th><th>Employee</th><th>Last detected train</th><th>Age</th><th>Recent trains</th><th>Queue controls</th></tr></thead><tbody>';

        queue.forEach(function (employee, index) {
            const record = map[String(employee.id)] || { last: 0, count: 0 };
            html += '<tr class="' + (index === 0 ? 'tccc-nextrow' : '') + '"><td><strong>' + (index + 1) + '</strong></td><td><strong>' +
                esc(employee.name) + '</strong></td><td>' + esc(formatDate(record.last)) + '</td><td>' +
                esc(formatAge(record.last)) + '</td><td>' + esc(record.count) + '</td><td><div class="tccc-queue-actions">' +
                '<button data-train-action="next" data-train-id="' + esc(employee.id) + '" title="Make next">NEXT</button>' +
                '<button data-train-action="up" data-train-id="' + esc(employee.id) + '" title="Move up" ' + (index === 0 ? 'disabled' : '') + '>↑</button>' +
                '<button data-train-action="down" data-train-id="' + esc(employee.id) + '" title="Move down" ' + (index === queue.length - 1 ? 'disabled' : '') + '>↓</button>' +
                '<button data-train-action="skip" data-train-id="' + esc(employee.id) + '" title="Skip this turn and send to back">SKIP</button>' +
                '</div></td></tr>';
        });

        html += '</tbody></table></div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Rotation activity</h3><span>Automatic advances and manual skips</span></div>';
        html += '<div class="tccc-training-log">';
        if (!state.trainingRotation.history.length) {
            html += '<div class="tccc-training-log-empty">No rotation activity recorded yet. The queue was seeded from the current Torn training history.</div>';
        } else {
            state.trainingRotation.history.slice(0, 10).forEach(function (event) {
                const badge = event.type === 'auto' ? 'AUTO TRAIN' : event.type === 'skip' ? 'SKIP' : 'RESET';
                const detail = event.type === 'auto' ? 'Detected a Torn train and moved to the back of the queue' :
                    event.type === 'skip' ? 'Manually skipped and moved to the back of the queue' :
                    'Queue rebuilt from latest training history';
                html += '<div class="tccc-training-log-row"><span class="tccc-rotation-badge ' + esc(event.type) + '">' +
                    esc(badge) + '</span><div><strong>' + esc(event.name || 'Rotation') + '</strong><span>' +
                    esc(detail) + '</span></div><time>' + esc(formatDate(event.timestamp)) + '</time></div>';
            });
        }
        html += '</div></section>';

        html += '<div class="tccc-note"><strong>How this works:</strong> On the first run, the queue is seeded oldest-trained first. After that it is persistent. When Torn reports a new train for an employee, the script moves that employee to the back automatically. NEXT, ↑, ↓, and SKIP let you override the order without changing Torn itself. “Reset from history” rebuilds the queue from the current training timestamps if the order ever gets out of sync.</div>';
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
        const autoMatched = employees.filter(function (e) {
            return num(ledger[String(e.id)] && ledger[String(e.id)].receivedQty) > 0;
        }).length;

        let scanLabel = 'Checking…';
        let scanClass = '';
        if (state.duesScan.status === 'ready') {
            scanLabel = 'ACTIVE';
            scanClass = 'good';
        } else if (state.duesScan.status === 'locked') {
            scanLabel = 'NEEDS LOG KEY';
            scanClass = 'bad';
        } else if (state.duesScan.status === 'idle') {
            scanLabel = 'NOT CHECKED';
        }

        let html = cards([
            { label: 'Month', value: month },
            { label: 'Paid', value: paidCount + ' / ' + employees.length, className: paidCount === employees.length ? 'good' : '' },
            { label: 'Monthly Requirement', value: state.settings.edvdQty + ' eDVD' },
            { label: 'Auto Scanner', value: scanLabel, sub: autoMatched + ' employee payment' + (autoMatched === 1 ? '' : 's') + ' detected', className: scanClass }
        ]);

        if (state.duesScan.status === 'ready') {
            html += '<div class="tccc-dues-status ready"><strong>Automatic dues scanning is active.</strong><span>Direct Item Receive logs for Erotic DVD #366 are counted only when the sender is a current employee and the message contains one of these keywords: <b>' +
                esc(duesKeywords().join(', ')) + '</b>.</span></div>';
        } else if (state.duesScan.status === 'locked') {
            html += '<div class="tccc-dues-status locked"><strong>Automatic scanning needs additional API permission.</strong><span>Your normal company dashboard can keep using its current key. For dues, add an optional Custom API key in Settings with access to <b>User → Log</b>, restricted to the <b>Item receive (4103)</b> log type. Current scanner response: ' +
                esc(state.duesScan.error || 'log access unavailable') + '</span></div>';
        }

        const resetAt = num(state.duesResetAt[month]);

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>eDVD dues</h3><span>Automatic matches + manual overrides' +
            (resetAt ? ' · reset baseline ' + esc(formatDate(resetAt)) : '') +
            '</span></div><div class="tccc-dues-actions"><button id="tccc-scan-dues" class="tccc-small-action">Scan now</button><button id="tccc-reset-dues" class="tccc-small-action danger">Reset month</button></div></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>Employee</th><th>Status</th><th>Detected</th><th>Paid at</th><th>Method</th><th>Control</th></tr></thead><tbody>';

        employees.forEach(function (e) {
            const record = ledger[String(e.id)] || {};
            const detected = num(record.receivedQty);
            const hasOverride = !!record.manualOverride;
            html += '<tr><td><strong>' + esc(e.name) + '</strong></td><td><button class="tccc-duebtn ' + (record.paid ? 'paid' : 'unpaid') +
                '" data-due="' + esc(e.id) + '">' + (record.paid ? 'PAID' : 'UNPAID') + '</button></td><td class="' +
                (detected >= num(state.settings.edvdQty) && detected > 0 ? 'tccc-positive' : '') + '">' +
                esc(detected + ' / ' + state.settings.edvdQty + ' eDVD') + '</td><td>' +
                esc(record.paidAt ? formatDate(record.paidAt) : '—') + '</td><td>' + esc(record.method || '—') + '</td><td>' +
                (hasOverride ? '<button class="tccc-auto-reset" data-due-auto="' + esc(e.id) + '">RETURN TO AUTO</button>' : '<span class="tccc-auto-label">' + (record.auto ? 'AUTO' : '—') + '</span>') +
                '</td></tr>';
        });

        html += '</tbody></table></div></section>';
        html += '<div class="tccc-note"><strong>Payment rule:</strong> The scanner currently watches direct item sends received during the current TCT month. A payment only counts if it came from a current employee, contains Erotic DVD #366, and its send-message contains one of your configured dues keywords. Multiple qualifying sends from the same employee are added together. Clicking PAID/UNPAID creates a manual override; “Return to auto” hands that employee back to the scanner. <strong>Reset month</strong> clears this month\'s ledger and establishes a new cutoff, so qualifying sends received before the reset will not repopulate the chart.</div>';
        return html;
    }

    function workStatsTotal(stats) {
        stats = stats || {};
        return num(stats.manual_labor) + num(stats.intelligence) + num(stats.endurance);
    }

    function applicationTimeLeft(timestamp) {
        const seconds = num(timestamp) - Math.floor(Date.now() / 1000);
        if (seconds <= 0) return 'Expired';
        const days = Math.floor(seconds / 86400);
        if (days >= 1) return days + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
        const hours = Math.floor(seconds / 3600);
        if (hours >= 1) return hours + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
        return Math.max(1, Math.floor(seconds / 60)) + 'm';
    }

    function currentPositionCounts() {
        const counts = {};
        state.employees.forEach(function (employee) {
            const name = (employee.position && employee.position.name) || 'Unknown';
            counts[name] = (counts[name] || 0) + 1;
        });
        return counts;
    }

    function ensureStaffingTargets() {
        const counts = currentPositionCounts();
        const positions = Array.from(new Set(Object.keys(counts).concat(knownCompanyRoles())));
        let changed = false;

        positions.forEach(function (position) {
            if (state.staffingTargets[position] === undefined) {
                state.staffingTargets[position] = num(counts[position]);
                changed = true;
            }
        });

        if (changed) saveStaffingTargets();
    }

    function saveRecruitingPlan() {
        document.querySelectorAll('[data-staffing-target]').forEach(function (input) {
            const position = input.getAttribute('data-staffing-target');
            if (!position) return;
            state.staffingTargets[position] = Math.max(0, Math.floor(num(input.value)));
        });
        saveStaffingTargets();
        render();
    }

    function companyRoleRequirements() {
        const typeName = state.profile && state.profile.type ? state.profile.type.name : '';
        return COMPANY_ROLE_REQUIREMENTS[typeName] || null;
    }

    function knownCompanyRoles() {
        const requirements = companyRoleRequirements();
        return requirements ? Object.keys(requirements) : [];
    }

    function effectivenessStatPart(stat, required, multiplier) {
        required = num(required);
        if (required <= 0) return 0;

        const adjusted = Math.max(0, num(stat) * num(multiplier || 1));
        const ratio = adjusted / required;
        const base = Math.min(45, ratio * 45);
        const bonus = ratio > 0 ? Math.max(0, 5 * (Math.log(ratio) / Math.log(2))) : 0;
        return Math.floor(base + bonus);
    }

    function projectedWorkingStatsScore(employeeOrStats, role, multiplier) {
        const requirements = companyRoleRequirements();
        if (!requirements || !requirements[role]) return 0;

        const stats = employeeOrStats && employeeOrStats.stats ? employeeOrStats.stats : (employeeOrStats || {});
        const req = requirements[role];
        return effectivenessStatPart(stats.manual_labor, req.manual_labor, multiplier) +
            effectivenessStatPart(stats.intelligence, req.intelligence, multiplier) +
            effectivenessStatPart(stats.endurance, req.endurance, multiplier);
    }

    function employeeStaticEffectiveness(employee) {
        const effectiveness = (employee && employee.effectiveness) || {};
        return Object.keys(effectiveness).reduce(function (total, key) {
            if (key === 'total' || key === 'working_stats' || key === 'management') return total;
            return total + num(effectiveness[key]);
        }, 0);
    }

    function projectedBaseEffectiveness(employee, role, multiplier) {
        return projectedWorkingStatsScore(employee, role, multiplier) + employeeStaticEffectiveness(employee);
    }

    function managerRoleName(roles) {
        if (roles.indexOf('Store Manager') !== -1) return 'Store Manager';
        return '';
    }

    function calibratedWorkStatMultiplier() {
        const requirements = companyRoleRequirements();
        if (!requirements) return 1;

        const samples = state.employees.filter(function (employee) {
            const role = employee.position && employee.position.name;
            const observed = employee.effectiveness && employee.effectiveness.working_stats;
            return role && requirements[role] && observed !== undefined && employee.stats;
        });

        if (!samples.length) return 1.2;

        let bestMultiplier = 1.2;
        let bestError = Infinity;

        for (let step = 100; step <= 130; step += 1) {
            const multiplier = step / 100;
            let error = 0;

            samples.forEach(function (employee) {
                const role = employee.position.name;
                const predicted = projectedWorkingStatsScore(employee, role, multiplier);
                const observed = num(employee.effectiveness.working_stats);
                error += Math.abs(predicted - observed);
            });

            if (error < bestError) {
                bestError = error;
                bestMultiplier = multiplier;
            }
        }

        return bestMultiplier;
    }

    function individualBestRole(employee, roles, multiplier) {
        let bestRole = '';
        let bestScore = -Infinity;

        roles.forEach(function (role) {
            const score = projectedWorkingStatsScore(employee, role, multiplier);
            if (score > bestScore) {
                bestScore = score;
                bestRole = role;
            }
        });

        return { role: bestRole, score: bestScore };
    }

    function optimizeEmployeeAssignments(roles, targets, multiplier) {
        const employees = state.employees.slice();
        const counts = roles.map(function (role) { return Math.max(0, Math.floor(num(targets[role]))); });
        const targetTotal = counts.reduce(function (sum, count) { return sum + count; }, 0);

        if (targetTotal !== employees.length) {
            return {
                valid: false,
                reason: 'Your staffing targets total ' + targetTotal + ', but you currently have ' + employees.length + ' employees.'
            };
        }

        const managerRole = managerRoleName(roles);
        const managerIndex = managerRole ? roles.indexOf(managerRole) : -1;
        const managerSlots = managerIndex >= 0 ? counts[managerIndex] : 0;

        function solveForEmployees(employeeList, remainingCounts) {
            const memo = new Map();

            function solve(index, remaining) {
                if (index >= employeeList.length) {
                    return remaining.every(function (count) { return count === 0; }) ?
                        { score: 0, assignments: [] } : null;
                }

                const key = index + '|' + remaining.join(',');
                if (memo.has(key)) return memo.get(key);

                let best = null;

                for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
                    if (remaining[roleIndex] <= 0) continue;

                    const nextRemaining = remaining.slice();
                    nextRemaining[roleIndex] -= 1;
                    const tail = solve(index + 1, nextRemaining);
                    if (!tail) continue;

                    const role = roles[roleIndex];
                    const score = projectedWorkingStatsScore(employeeList[index], role, multiplier);
                    const candidate = {
                        score: score + tail.score,
                        assignments: [{
                            employeeId: String(employeeList[index].id),
                            role: role,
                            score: score
                        }].concat(tail.assignments)
                    };

                    if (!best || candidate.score > best.score) best = candidate;
                }

                memo.set(key, best);
                return best;
            }

            return solve(0, remainingCounts);
        }

        let result = null;
        let selectedManager = null;

        // Manager positions are special: Torn states that the effectiveness of the
        // employee in the special position determines the magnitude of its effect.
        // With exactly one Manager slot, select the highest projected base-EE manager,
        // then optimize every remaining slot by working-stat effectiveness.
        if (managerRole && managerSlots === 1) {
            employees.forEach(function (candidateManager) {
                const remainingEmployees = employees.filter(function (employee) {
                    return String(employee.id) !== String(candidateManager.id);
                });
                const remainingCounts = counts.slice();
                remainingCounts[managerIndex] -= 1;

                const tail = solveForEmployees(remainingEmployees, remainingCounts);
                if (!tail) return;

                const managerWorkScore = projectedWorkingStatsScore(candidateManager, managerRole, multiplier);
                const managerBaseEffectiveness = projectedBaseEffectiveness(candidateManager, managerRole, multiplier);

                const candidate = {
                    score: managerWorkScore + tail.score,
                    assignments: [{
                        employeeId: String(candidateManager.id),
                        role: managerRole,
                        score: managerWorkScore,
                        projectedBaseEffectiveness: managerBaseEffectiveness
                    }].concat(tail.assignments),
                    manager: {
                        employeeId: String(candidateManager.id),
                        name: candidateManager.name || String(candidateManager.id),
                        role: managerRole,
                        workScore: managerWorkScore,
                        baseEffectiveness: managerBaseEffectiveness
                    }
                };

                if (!result ||
                    managerBaseEffectiveness > result.manager.baseEffectiveness ||
                    (managerBaseEffectiveness === result.manager.baseEffectiveness && candidate.score > result.score)) {
                    result = candidate;
                    selectedManager = candidate.manager;
                }
            });
        } else {
            result = solveForEmployees(employees, counts);
        }

        if (!result) {
            return { valid: false, reason: 'No valid assignment could be produced from the current staffing targets.' };
        }

        const byEmployee = {};
        result.assignments.forEach(function (assignment) {
            byEmployee[assignment.employeeId] = assignment;
        });

        return {
            valid: true,
            totalScore: result.score,
            byEmployee: byEmployee,
            managerAware: !!selectedManager,
            manager: selectedManager
        };
    }

    function currentAssignmentScore(multiplier) {
        return state.employees.reduce(function (total, employee) {
            const role = employee.position && employee.position.name;
            return total + projectedWorkingStatsScore(employee, role, multiplier);
        }, 0);
    }

    function roleOptimizerHtml(targetPositions) {
        const requirements = companyRoleRequirements();
        if (!requirements) {
            return '<section class="tccc-panel"><div class="tccc-note"><strong>Role optimizer:</strong> position requirements are not configured yet for this company type.</div></section>';
        }

        const roles = targetPositions.filter(function (role) {
            return requirements[role] && num(state.staffingTargets[role]) > 0;
        });
        const multiplier = calibratedWorkStatMultiplier();
        const optimized = optimizeEmployeeAssignments(roles, state.staffingTargets, multiplier);
        const currentScore = currentAssignmentScore(multiplier);

        let html = '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Role optimizer</h3><span>Manager-aware lineup optimization while preserving your saved staffing counts</span></div></div>';

        if (!optimized.valid) {
            html += '<div class="tccc-dues-status locked"><strong>Optimizer paused</strong><span>' + esc(optimized.reason) + ' Adjust the staffing plan so its total matches your employee count.</span></div></section>';
            return html;
        }

        const gain = optimized.totalScore - currentScore;
        const changes = state.employees.filter(function (employee) {
            const optimizedRole = optimized.byEmployee[String(employee.id)];
            const currentRole = employee.position && employee.position.name;
            return optimizedRole && optimizedRole.role !== currentRole;
        }).length;

        html += '<div class="tccc-optimizer-summary">';
        html += '<div><span>Current projected score</span><strong>' + esc(currentScore) + '</strong></div>';
        html += '<div><span>Optimized projected score</span><strong class="' + (gain > 0 ? 'tccc-positive' : '') + '">' + esc(optimized.totalScore) + '</strong></div>';
        html += '<div><span>Projected gain</span><strong class="' + (gain > 0 ? 'tccc-positive' : '') + '">' + esc((gain > 0 ? '+' : '') + gain) + '</strong></div>';
        html += '<div><span>Position changes</span><strong>' + esc(changes) + '</strong></div>';
        html += '<div><span>Stat multiplier calibration</span><strong>×' + esc(multiplier.toFixed(2)) + '</strong></div>';
        html += '</div>';

        if (optimized.managerAware && optimized.manager) {
            html += '<div class="tccc-manager-callout"><div><span>Recommended Manager</span><strong>' +
                esc(optimized.manager.name) + '</strong></div><div><span>Projected Manager EE before management bonus</span><strong>' +
                esc(optimized.manager.baseEffectiveness) + '</strong></div><div><span>Manager work-stat score</span><strong>' +
                esc(optimized.manager.workScore) + '</strong></div></div>';
        }

        html += '<div class="tccc-tablewrap"><table><thead><tr><th>Employee</th><th>Current Role</th><th>Current Stat Score</th><th>Optimized Role</th><th>Optimized Score</th><th>Δ</th><th>Raw Stat Best</th></tr></thead><tbody>';

        state.employees
            .slice()
            .sort(function (a, b) {
                const aAssignment = optimized.byEmployee[String(a.id)];
                const bAssignment = optimized.byEmployee[String(b.id)];
                const aChanged = aAssignment && aAssignment.role !== (a.position && a.position.name) ? 0 : 1;
                const bChanged = bAssignment && bAssignment.role !== (b.position && b.position.name) ? 0 : 1;
                if (aChanged !== bChanged) return aChanged - bChanged;
                return String(a.name || '').localeCompare(String(b.name || ''));
            })
            .forEach(function (employee) {
                const id = String(employee.id);
                const currentRole = (employee.position && employee.position.name) || '';
                const current = projectedWorkingStatsScore(employee, currentRole, multiplier);
                const assignment = optimized.byEmployee[id];
                const optimizedRole = assignment ? assignment.role : currentRole;
                const optimizedScore = assignment ? assignment.score : current;
                const delta = optimizedScore - current;
                const best = individualBestRole(employee, roles, multiplier);
                const changed = optimizedRole !== currentRole;

                html += '<tr class="' + (changed ? 'tccc-optimizer-change-row' : '') + '"><td><a href="/profiles.php?XID=' +
                    encodeURIComponent(employee.id) + '" target="_blank">' + esc(employee.name) + '</a></td>' +
                    '<td>' + esc(currentRole) + '</td>' +
                    '<td>' + esc(current) + '</td>' +
                    '<td><strong class="' + (changed ? 'tccc-warning' : 'tccc-positive') + '">' + esc(optimizedRole) + '</strong></td>' +
                    '<td>' + esc(optimizedScore) + '</td>' +
                    '<td class="' + (delta > 0 ? 'tccc-positive' : (delta < 0 ? 'tccc-negative' : '')) + '">' +
                    esc((delta > 0 ? '+' : '') + delta) + '</td>' +
                    '<td>' + esc(best.role) + ' <small class="tccc-role-score">(' + esc(best.score) + ')</small></td></tr>';
            });

        html += '</tbody></table></div>';
        html += '<div class="tccc-note"><strong>What the optimizer is doing:</strong> raw role fit still uses Torn\'s working-stat effectiveness formula, calibrated against the live Working Stats values returned for your company. The Store Manager slot is treated differently because it is a special Manager position: the script projects each candidate\'s Manager effectiveness using their work-stat score plus their current non-management modifiers (settled-in, merits, director education, addiction, inactivity, etc.), selects the strongest projected Manager, and then optimizes the remaining slots by work stats. The displayed “Projected Gain” remains the working-stat portion only, so it does not pretend we know Torn\'s hidden exact Manager bonus formula.</div>';
        html += '</section>';
        return html;
    }

    function recruitingHtml() {
        if (!state.profile) return emptyConnectHtml();

        const applications = state.applications.slice().sort(function (a, b) {
            const aExp = num(a.expires_at);
            const bExp = num(b.expires_at);
            if (aExp !== bExp) return aExp - bExp;
            return workStatsTotal(b.player && b.player.stats) - workStatsTotal(a.player && a.player.stats);
        });

        const employeeInfo = state.profile.employees || {};
        const hired = num(employeeInfo.hired || state.employees.length);
        const capacity = num(employeeInfo.capacity || state.employees.length);
        const openSeats = Math.max(0, capacity - hired);
        const now = Math.floor(Date.now() / 1000);
        const expiringSoon = applications.filter(function (application) {
            const remaining = num(application.expires_at) - now;
            return remaining > 0 && remaining <= 86400;
        }).length;

        ensureStaffingTargets();
        const positionCounts = currentPositionCounts();
        const targetPositions = Array.from(new Set(
            Object.keys(positionCounts)
                .concat(Object.keys(state.staffingTargets || {}))
                .concat(knownCompanyRoles())
        )).sort();

        targetPositions.forEach(function (position) {
            if (state.staffingTargets[position] === undefined) {
                state.staffingTargets[position] = num(positionCounts[position]);
            }
        });
        const activePlanPositions = targetPositions.filter(function (position) {
            return num(positionCounts[position]) > 0 || num(state.staffingTargets[position]) > 0;
        });

        const targetSummary = activePlanPositions.reduce(function (summary, position) {
            const current = num(positionCounts[position]);
            const target = num(state.staffingTargets[position]);
            const delta = current - target;
            if (delta < 0) summary.short += Math.abs(delta);
            if (delta > 0) summary.over += delta;
            if (delta === 0) summary.onTarget += 1;
            return summary;
        }, { short: 0, over: 0, onTarget: 0 });

        let html = cards([
            {
                label: 'Staffing',
                value: hired + ' / ' + capacity,
                sub: openSeats + ' open seat' + (openSeats === 1 ? '' : 's'),
                className: openSeats > 0 ? 'bad' : 'good'
            },
            {
                label: 'Applications',
                value: applications.length,
                sub: 'Current company applications'
            },
            {
                label: 'Expiring < 24h',
                value: expiringSoon,
                sub: 'Applications needing attention',
                className: expiringSoon ? 'bad' : 'good'
            },
            {
                label: 'Applications',
                value: state.profile.applications_allowed ? 'OPEN' : 'CLOSED',
                sub: 'Current Torn company setting',
                className: state.profile.applications_allowed ? 'good' : ''
            },
            {
                label: 'Staffing Plan',
                value: targetSummary.short ? targetSummary.short + ' short' : 'ON TARGET',
                sub: targetSummary.over + ' position' + (targetSummary.over === 1 ? '' : 's') + ' over target',
                className: targetSummary.short || targetSummary.over ? 'bad' : 'good'
            }
        ]);

        html += '<div class="tccc-grid2">';
        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Current staffing mix</h3><span>Compared with your saved target plan</span></div><div class="tccc-position-mix">';
        activePlanPositions.forEach(function (position) {
            const current = num(positionCounts[position]);
            const target = num(state.staffingTargets[position]);
            const delta = current - target;
            const statusClass = delta < 0 ? 'short' : (delta > 0 ? 'over' : 'target');
            const statusText = delta < 0 ? (Math.abs(delta) + ' short') : (delta > 0 ? (delta + ' over') : 'on target');
            html += '<div class="tccc-position-plan ' + statusClass + '"><span>' + esc(position) + '</span><strong>' +
                esc(current + ' / ' + target) + '</strong><small>' + esc(statusText) + '</small></div>';
        });
        if (!targetPositions.length) {
            html += '<div class="tccc-training-log-empty">No employee positions returned.</div>';
        }
        html += '</div></section>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><h3>Recruiting status</h3><span>Live company capacity and application state</span></div>';
        html += '<div class="tccc-recruit-status">';
        html += '<div><span>Hired</span><strong>' + esc(hired) + '</strong></div>';
        html += '<div><span>Capacity</span><strong>' + esc(capacity) + '</strong></div>';
        html += '<div><span>Open seats</span><strong class="' + (openSeats ? 'tccc-warning' : 'tccc-positive') + '">' + esc(openSeats) + '</strong></div>';
        html += '<div><span>Applications</span><strong class="' + (state.profile.applications_allowed ? 'tccc-positive' : '') + '">' + (state.profile.applications_allowed ? 'Open' : 'Closed') + '</strong></div>';
        html += '</div></section></div>';

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Staffing plan</h3><span>Set the ideal headcount for each position</span></div><button id="tccc-save-staffing-plan" class="tccc-small-action">Save plan</button></div>';
        html += '<div class="tccc-staffing-editor">';
        targetPositions.forEach(function (position) {
            html += '<label><span>' + esc(position) + '</span><input type="number" min="0" step="1" data-staffing-target="' +
                esc(position) + '" value="' + esc(num(state.staffingTargets[position])) + '"></label>';
        });
        html += '</div><div class="tccc-staffing-plan-summary">';
        html += '<span class="' + (targetSummary.short ? 'tccc-negative' : 'tccc-positive') + '">' + esc(targetSummary.short) + ' short</span>';
        html += '<span class="' + (targetSummary.over ? 'tccc-warning' : 'tccc-positive') + '">' + esc(targetSummary.over) + ' over</span>';
        html += '<span>' + esc(targetSummary.onTarget) + ' position' + (targetSummary.onTarget === 1 ? '' : 's') + ' on target</span>';
        html += '</div></section>';

        html += roleOptimizerHtml(targetPositions);

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Applicants</h3><span>Sorted by expiration first so nothing quietly disappears</span></div></div>';

        if (!applications.length) {
            html += '<div class="tccc-recruit-empty"><strong>No active applications</strong><span>When someone applies, their level, work stats, message, status, and expiration will appear here automatically.</span></div>';
        } else {
            html += '<div class="tccc-tablewrap"><table><thead><tr><th>Applicant</th><th>Level</th><th>Manual Labor</th><th>Intelligence</th><th>Endurance</th><th>Total Stats</th><th>Best Planned Role</th><th>Projected Score</th><th>Status</th><th>Expires</th><th>Message</th></tr></thead><tbody>';

            applications.forEach(function (application) {
                const player = application.player || {};
                const stats = player.stats || {};
                const total = workStatsTotal(stats);
                const remaining = num(application.expires_at) - now;
                const urgent = remaining > 0 && remaining <= 86400;
                const expired = remaining <= 0;
                const plannedRoles = targetPositions.filter(function (role) {
                    return companyRoleRequirements() && companyRoleRequirements()[role] && num(state.staffingTargets[role]) > 0;
                });
                const applicantMultiplier = calibratedWorkStatMultiplier();
                const bestFit = individualBestRole({ stats: stats }, plannedRoles, applicantMultiplier);

                html += '<tr><td><a href="/profiles.php?XID=' + encodeURIComponent(player.id) + '" target="_blank">' + esc(player.name || player.id || 'Unknown') + '</a></td>' +
                    '<td>' + esc(num(player.level)) + '</td>' +
                    '<td>' + esc(num(stats.manual_labor).toLocaleString()) + '</td>' +
                    '<td>' + esc(num(stats.intelligence).toLocaleString()) + '</td>' +
                    '<td>' + esc(num(stats.endurance).toLocaleString()) + '</td>' +
                    '<td><strong>' + esc(total.toLocaleString()) + '</strong></td>' +
                    '<td><strong class="tccc-role-fit">' + esc(bestFit.role || '—') + '</strong></td>' +
                    '<td>' + (bestFit.role ? esc(bestFit.score) : '—') + '</td>' +
                    '<td>' + esc(application.status || '—') + '</td>' +
                    '<td class="' + (expired || urgent ? 'tccc-negative' : '') + '">' + esc(applicationTimeLeft(application.expires_at)) + '</td>' +
                    '<td class="tccc-application-message">' + esc(application.message || '—') + '</td></tr>';
            });

            html += '</tbody></table></div>';
        }

        html += '</section>';
        html += '<div class="tccc-note"><strong>Recruiting data:</strong> Torn provides each current application\'s player level, manual labor, intelligence, endurance, application message, status, and expiration. Your staffing plan is separate from Torn and stays local to this script. “Short” and “over” simply compare current headcount with the targets you set; they do not automatically fire, hire, or move anyone.</div>';
        return html;
    }

    function stockHtml() {
        if (!state.profile) return emptyConnectHtml();

        const plan = stockCapacityPlan();
        const forecasts = plan.rows.slice();

        const lowCount = forecasts.filter(function (row) { return row.status === 'low'; }).length;
        const watchCount = forecasts.filter(function (row) { return row.status === 'watch'; }).length;
        const historyDays = Object.keys(state.stockHistory).length;
        const capacityPct = plan.capacity > 0 ? (plan.committedUnits / plan.capacity) * 100 : 0;
        const constrained = plan.effectiveTargetDays + 0.01 < plan.targetDays;

        forecasts.sort(function (a, b) {
            const aDays = Number.isFinite(a.forecast.totalDays) ? a.forecast.totalDays : 999999;
            const bDays = Number.isFinite(b.forecast.totalDays) ? b.forecast.totalDays : 999999;
            return aDays - bDays;
        });

        let html = cards([
            {
                label: 'Low Stock',
                value: lowCount,
                sub: 'Below ' + state.settings.stockWarningDays + ' days projected cover',
                className: lowCount ? 'bad' : 'good'
            },
            {
                label: 'Watch List',
                value: watchCount,
                sub: constrained ? 'Below capacity-adjusted plan target' : 'Below ' + state.settings.stockTargetDays + '-day target'
            },
            {
                label: 'Storage Committed',
                value: plan.committedUnits.toLocaleString() + ' / ' + plan.capacity.toLocaleString(),
                sub: capacityPct.toFixed(1) + '% · current stock + existing orders',
                className: plan.overCapacity > 0 ? 'bad' : ''
            },
            {
                label: 'Free Capacity',
                value: plan.freeCapacity.toLocaleString() + ' units',
                sub: plan.overCapacity > 0 ? plan.overCapacity.toLocaleString() + ' units already over capacity' : 'Remaining room after existing orders',
                className: plan.overCapacity > 0 ? 'bad' : ''
            },
            {
                label: 'Capacity-Safe Reorder',
                value: plan.suggestedTotal.toLocaleString() + ' units',
                sub: 'Combined recommendations stay within storage limit'
            },
            {
                label: 'Balanced Plan Cover',
                value: plan.effectiveTargetDays.toFixed(1) + ' days',
                sub: constrained ? plan.targetDays + '-day ideal cannot fit in current capacity' : 'Full configured target is achievable'
            },
            {
                label: 'History',
                value: historyDays + ' day' + (historyDays === 1 ? '' : 's'),
                sub: 'Forecast improves as daily snapshots accumulate'
            }
        ]);

        if (constrained) {
            html += '<div class="tccc-dues-status locked"><strong>Warehouse capacity is the limiting factor.</strong><span>Your configured ' +
                esc(plan.targetDays) + '-day ideal would require approximately ' + esc(plan.idealNeeded.toLocaleString()) +
                ' additional units, but only ' + esc(plan.freeCapacity.toLocaleString()) +
                ' units of capacity remain after current stock and existing orders. The reorder plan below therefore balances available space across the products with active sales instead of pretending every item can reach ' +
                esc(plan.targetDays) + ' days.</span></div>';
        } else if (plan.overCapacity > 0) {
            html += '<div class="tccc-dues-status locked"><strong>Committed stock is already above the configured capacity.</strong><span>Current stock plus existing orders exceeds the warehouse limit by ' +
                esc(plan.overCapacity.toLocaleString()) + ' units, so the script will not suggest additional purchases until capacity opens up.</span></div>';
        }

        html += '<section class="tccc-panel"><div class="tccc-panel-head"><div><h3>Capacity-aware stock plan</h3><span>Sorted by lowest projected coverage first · combined reorder ≤ available warehouse space</span></div></div>';
        html += '<div class="tccc-tablewrap"><table><thead><tr><th>Item</th><th>Status</th><th>In Stock</th><th>On Order</th><th>Today Sold</th><th>Avg / Day</th><th>On-Hand Cover</th><th>Total Cover</th><th>After Plan</th><th>Projected Runout</th><th>Suggested Reorder</th></tr></thead><tbody>';

        forecasts.forEach(function (row) {
            const item = row.item;
            const forecast = row.forecast;
            const statusLabel = row.status === 'low' ? 'LOW' :
                row.status === 'watch' ? 'WATCH' :
                row.status === 'no-sales' ? 'NO SALES' : 'HEALTHY';
            const statusClass = row.status === 'low' ? 'bad' :
                row.status === 'watch' ? 'watch' :
                row.status === 'healthy' ? 'good' : 'neutral';

            html += '<tr><td><strong>' + esc(item.name) + '</strong></td>' +
                '<td><span class="tccc-stock-status ' + statusClass + '">' + esc(statusLabel) + '</span></td>' +
                '<td>' + esc(num(item.in_stock).toLocaleString()) + '</td>' +
                '<td>' + esc(num(item.on_order).toLocaleString()) + '</td>' +
                '<td>' + esc(num(item.sold_amount).toLocaleString()) + '</td>' +
                '<td>' + esc(forecast.avgDaily.toFixed(1)) + '<small class="tccc-stock-sample"> (' + esc(forecast.samples) + 'd)</small></td>' +
                '<td class="' + (Number.isFinite(forecast.onHandDays) && forecast.onHandDays < forecast.warningDays ? 'tccc-negative' : '') + '">' +
                (Number.isFinite(forecast.onHandDays) ? esc(forecast.onHandDays.toFixed(1) + ' days') : '—') + '</td>' +
                '<td class="' + (row.status === 'low' ? 'tccc-negative' : '') + '">' +
                (Number.isFinite(forecast.totalDays) ? esc(forecast.totalDays.toFixed(1) + ' days') : '—') + '</td>' +
                '<td class="' + (row.suggested > 0 ? 'tccc-positive' : '') + '">' +
                (Number.isFinite(row.afterPlanDays) ? esc(row.afterPlanDays.toFixed(1) + ' days') : '—') + '</td>' +
                '<td>' + esc(formatForecastDate(forecast.runoutAt)) + '</td>' +
                '<td class="' + (row.suggested > 0 ? 'tccc-warning' : '') + '">' +
                (row.suggested > 0 ? esc(row.suggested.toLocaleString()) : '—') + '</td></tr>';
        });

        html += '</tbody></table></div></section>';

        html += '<div class="tccc-note"><strong>Capacity-aware forecast:</strong> the configured ' +
            esc(plan.targetDays) + '-day value is now an ideal, not a promise. The planner first reserves space for everything currently in stock and already on order, then distributes only the remaining warehouse capacity across actively selling products. When the full target cannot fit, it calculates the highest balanced coverage achievable within your ' +
            esc(plan.capacity.toLocaleString()) + '-unit limit. Suggested reorders across the entire table are therefore designed to total no more than the remaining capacity. These remain planning estimates, not automatic purchase instructions.</div>';
        return html;
    }

    function settingsHtml() {
        return '<section class="tccc-panel tccc-settings">' +
            '<h3>Connection & company rules</h3>' +
            '<label>Primary Torn API key <input id="tccc-api-key" type="password" value="' + esc(state.settings.apiKey) + '" placeholder="Limited or suitably scoped Custom key"></label>' +
            '<div class="tccc-settings-grid">' +
            '<label>eDVDs per employee / month <input id="tccc-edvd-qty" type="number" min="0" step="1" value="' + esc(state.settings.edvdQty) + '"></label>' +
            '<label>Monthly due day <input id="tccc-due-day" type="number" min="1" max="28" step="1" value="' + esc(state.settings.dueDay) + '"></label>' +
            '<label>Dues message keywords <input id="tccc-dues-keywords" type="text" value="' + esc(state.settings.duesKeywords) + '" placeholder="CHAP,DUES"></label>' +
            '<label>Other daily company cost <input id="tccc-extra-cost" type="number" min="0" step="1000" value="' + esc(state.settings.extraDailyCost) + '"></label>' +
            '<label>Stock target days <input id="tccc-stock-target-days" type="number" min="1" max="60" step="1" value="' + esc(state.settings.stockTargetDays) + '"></label>' +
            '<label>Low-stock warning days <input id="tccc-stock-warning-days" type="number" min="0" max="60" step="1" value="' + esc(state.settings.stockWarningDays) + '"></label>' +
            '<label>Maximum stock capacity <input id="tccc-stock-capacity" type="number" min="1" step="1000" value="' + esc(state.settings.stockCapacity) + '"></label>' +
            '<label class="tccc-check"><input id="tccc-exclude-director" type="checkbox" ' + (state.settings.excludeDirector ? 'checked' : '') + '> Exclude director from monthly eDVD dues</label>' +
            '</div>' +
            '<div class="tccc-settings-divider"></div>' +
            '<h3>Launcher & alerts</h3>' +
            '<div class="tccc-settings-grid">' +
            '<label class="tccc-check"><input id="tccc-launch-company-only" type="checkbox" ' + (state.settings.launcherCompanyOnly ? 'checked' : '') + '> Show COMPANY CC only in Torn\'s company area</label>' +
            '<label class="tccc-check"><input id="tccc-alerts-enabled" type="checkbox" ' + (state.settings.alertsEnabled ? 'checked' : '') + '> Enable in-app company alerts</label>' +
            '<label class="tccc-check"><input id="tccc-alert-training" type="checkbox" ' + (state.settings.alertTraining ? 'checked' : '') + '> Alert when the training queue advances</label>' +
            '<label class="tccc-check"><input id="tccc-alert-dues" type="checkbox" ' + (state.settings.alertDues ? 'checked' : '') + '> Alert when eDVD dues are detected</label>' +
            '<label class="tccc-check"><input id="tccc-alert-applications" type="checkbox" ' + (state.settings.alertApplications ? 'checked' : '') + '> Alert on new company applications</label>' +
            '<label class="tccc-check"><input id="tccc-alert-stock" type="checkbox" ' + (state.settings.alertStock ? 'checked' : '') + '> Alert when stock becomes LOW</label>' +
            '<label class="tccc-check"><input id="tccc-alert-optimizer" type="checkbox" ' + (state.settings.alertOptimizer ? 'checked' : '') + '> Alert when optimizer recommendations change</label>' +
            '</div>' +
            '<div class="tccc-setting-actions compact"><button id="tccc-reset-launcher">Reset launcher position</button></div>' +
            '<div class="tccc-note"><strong>Launcher:</strong> drag the COMPANY CC button anywhere on screen and the position is remembered on this device. Company-area-only mode hides the launcher elsewhere in Torn; automatic refresh still continues while Torn is open.</div>' +
            '<div class="tccc-settings-divider"></div>' +
            '<h3>Automatic refresh & history</h3>' +
            '<div class="tccc-settings-grid">' +
            '<label class="tccc-check"><input id="tccc-auto-refresh-enabled" type="checkbox" ' + (state.settings.autoRefreshEnabled ? 'checked' : '') + '> Automatically refresh while Torn is open</label>' +
            '<label>Refresh interval (minutes) <input id="tccc-auto-refresh-minutes" type="number" min="15" max="120" step="5" value="' + esc(state.settings.autoRefreshMinutes) + '"></label>' +
            '</div>' +
            '<div class="tccc-note"><strong>Automatic history capture:</strong> while Torn is open, the script refreshes on your chosen interval, refreshes when you return after it has been idle for about 10 minutes, takes one near-end-of-day snapshot around 23:55 TCT, and refreshes again when a new TCT day is detected. If Torn/the browser is closed, the userscript cannot run until you open Torn again.</div>' +
            '<div class="tccc-settings-divider"></div>' +
            '<h3>Automatic eDVD scanner</h3>' +
            '<label>Optional dues log API key <input id="tccc-dues-api-key" type="password" value="' + esc(state.settings.duesApiKey) + '" placeholder="Custom key: User → Log → Item receive (4103)"></label>' +
            '<div class="tccc-note"><strong>Recommended security setup:</strong> Keep your normal company key as-is. Create a separate Custom Torn key for this field that grants only User → Log access restricted to Item receive (4103). If this field is blank, the scanner will try your primary key.</div>' +
            '<div class="tccc-setting-actions"><button id="tccc-save-settings" class="primary">Save & Refresh</button><button id="tccc-export">Export local data</button><button id="tccc-import">Import local data</button></div>' +
            '<input id="tccc-import-file" type="file" accept=".json,application/json" style="display:none">' +
            '<div class="tccc-note">API keys are stored by the userscript manager when available and are sent only to api.torn.com. API keys are never included in exported backups or committed to GitHub.</div>' +
            '</section>';
    }

    function emptyConnectHtml() {
        return '<div class="tccc-empty"><h3>Company data is not connected yet</h3><p>Open Settings, add a Limited or suitably-scoped Custom Torn API key, save it, and the dashboard will populate automatically.</p><button data-tabgo="settings" class="primary">Open Settings</button></div>';
    }

    function tabHtml() {
        if (state.activeTab === 'overview') return overviewHtml();
        if (state.activeTab === 'analytics') return analyticsHtml();
        if (state.activeTab === 'finances') return financesHtml();
        if (state.activeTab === 'employees') return employeesHtml();
        if (state.activeTab === 'training') return trainingHtml();
        if (state.activeTab === 'dues') return duesHtml();
        if (state.activeTab === 'stock') return stockHtml();
        if (state.activeTab === 'recruiting') return recruitingHtml();
        if (state.activeTab === 'settings') return settingsHtml();
        return overviewHtml();
    }

    function shellHtml() {
        const companyName = state.profile ? state.profile.name : APP.name;
        const tabs = [
            ['overview', 'Overview'],
            ['analytics', 'Analytics'],
            ['finances', 'Finances'],
            ['employees', 'Employees'],
            ['training', 'Training'],
            ['dues', 'eDVD Dues'],
            ['stock', 'Stock'],
            ['recruiting', 'Recruiting'],
            ['settings', 'Settings']
        ];

        return '<div class="tccc-modal">' +
            '<header><div class="tccc-titleblock"><div class="tccc-eyebrow">TORN COMPANY COMMAND CENTER</div><h2>' + esc(companyName) + '</h2></div>' +
            '<div class="tccc-header-right"><div class="tccc-freshness ' + esc(freshnessInfo().className) + '"><i></i><span>' + esc(freshnessInfo().label) + '</span></div>' +
            '<div class="tccc-head-actions"><button id="tccc-refresh" title="Refresh">↻</button><button id="tccc-close" title="Close">×</button></div></div></header>' +
            '<nav>' + tabs.map(function (tab) {
                return '<button data-tab="' + tab[0] + '" class="' + (state.activeTab === tab[0] ? 'active' : '') + '">' + tab[1] + '</button>';
            }).join('') + '</nav>' +
            (state.error ? '<div class="tccc-error">' + esc(state.error) + '</div>' : '') +
            (state.loading ? '<div class="tccc-loading">Refreshing Torn company data…</div>' : '') +
            '<main>' + tabHtml() + '</main>' +
            '<footer><span>v' + esc(APP.version) + '</span><span>' + esc(autoRefreshStatusText()) + '</span><span>Local-first company management</span></footer>' +
            '</div>';
    }

    function render() {
        const overlay = document.getElementById('tccc-overlay');
        if (!overlay) return;

        overlay.classList.toggle('open', state.open);
        updateLauncher();
        if (!state.open) return;
        overlay.innerHTML = shellHtml();
        bindUi();
    }

    function bindUi() {
        const close = document.getElementById('tccc-close');
        if (close) close.addEventListener('click', function () { state.open = false; render(); });

        const refresh = document.getElementById('tccc-refresh');
        if (refresh) refresh.addEventListener('click', function () { refreshData('manual'); });

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

        document.querySelectorAll('[data-due-auto]').forEach(function (button) {
            button.addEventListener('click', function () {
                clearDueOverride(button.getAttribute('data-due-auto'));
            });
        });

        const scanDues = document.getElementById('tccc-scan-dues');
        if (scanDues) scanDues.addEventListener('click', async function () {
            state.duesScan.status = 'checking';
            render();
            await scanDuesLogs();
            render();
        });

        const resetDues = document.getElementById('tccc-reset-dues');
        if (resetDues) resetDues.addEventListener('click', resetCurrentDuesMonth);

        document.querySelectorAll('[data-train-action]').forEach(function (button) {
            button.addEventListener('click', function () {
                const action = button.getAttribute('data-train-action');
                const id = button.getAttribute('data-train-id');
                if (action === 'next') setTrainingNext(id);
                if (action === 'up') moveTrainingEmployee(id, 'up');
                if (action === 'down') moveTrainingEmployee(id, 'down');
                if (action === 'skip') skipTrainingEmployee(id);
            });
        });

        document.querySelectorAll('[data-employee-filter]').forEach(function (button) {
            button.addEventListener('click', function () {
                state.employeeFilter = button.getAttribute('data-employee-filter') || 'all';
                render();
            });
        });

        document.querySelectorAll('[data-employee-expand]').forEach(function (button) {
            button.addEventListener('click', function () {
                const id = button.getAttribute('data-employee-expand');
                state.expandedEmployeeId = String(state.expandedEmployeeId) === String(id) ? '' : String(id);
                render();
            });
        });

        const saveStaffingPlan = document.getElementById('tccc-save-staffing-plan');
        if (saveStaffingPlan) saveStaffingPlan.addEventListener('click', saveRecruitingPlan);

        const resetTraining = document.getElementById('tccc-reset-training');
        if (resetTraining) resetTraining.addEventListener('click', resetTrainingRotation);

        const save = document.getElementById('tccc-save-settings');
        if (save) save.addEventListener('click', function () {
            state.settings.apiKey = (document.getElementById('tccc-api-key').value || '').trim();
            state.settings.duesApiKey = (document.getElementById('tccc-dues-api-key').value || '').trim();
            state.settings.duesKeywords = (document.getElementById('tccc-dues-keywords').value || 'CHAP,DUES').trim();
            state.settings.edvdQty = Math.max(0, num(document.getElementById('tccc-edvd-qty').value));
            state.settings.dueDay = Math.min(28, Math.max(1, num(document.getElementById('tccc-due-day').value) || 1));
            state.settings.extraDailyCost = Math.max(0, num(document.getElementById('tccc-extra-cost').value));
            state.settings.stockTargetDays = Math.max(1, num(document.getElementById('tccc-stock-target-days').value) || 7);
            state.settings.stockWarningDays = Math.max(0, num(document.getElementById('tccc-stock-warning-days').value));
            state.settings.stockCapacity = Math.max(1, Math.floor(num(document.getElementById('tccc-stock-capacity').value) || 500000));
            state.settings.launcherCompanyOnly = !!document.getElementById('tccc-launch-company-only').checked;
            state.settings.alertsEnabled = !!document.getElementById('tccc-alerts-enabled').checked;
            state.settings.alertTraining = !!document.getElementById('tccc-alert-training').checked;
            state.settings.alertDues = !!document.getElementById('tccc-alert-dues').checked;
            state.settings.alertApplications = !!document.getElementById('tccc-alert-applications').checked;
            state.settings.alertStock = !!document.getElementById('tccc-alert-stock').checked;
            state.settings.alertOptimizer = !!document.getElementById('tccc-alert-optimizer').checked;
            state.settings.autoRefreshEnabled = !!document.getElementById('tccc-auto-refresh-enabled').checked;
            state.settings.autoRefreshMinutes = Math.max(15, Math.min(120, num(document.getElementById('tccc-auto-refresh-minutes').value) || 30));
            state.settings.excludeDirector = !!document.getElementById('tccc-exclude-director').checked;
            saveSettings();
            updateLauncher();
            startAutoRefresh(false);
            refreshData('settings-save');
        });

        const resetLauncher = document.getElementById('tccc-reset-launcher');
        if (resetLauncher) resetLauncher.addEventListener('click', resetLauncherPosition);

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
            settings: Object.assign({}, state.settings, { apiKey: '', duesApiKey: '' }),
            snapshots: state.snapshots,
            employeeHistory: state.employeeHistory,
            stockHistory: state.stockHistory,
            staffingTargets: state.staffingTargets,
            alertBaseline: state.alertBaseline,
            dues: state.dues,
            duesResetAt: state.duesResetAt,
            trainingRotation: state.trainingRotation
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
                if (payload.employeeHistory) state.employeeHistory = payload.employeeHistory;
                if (payload.stockHistory) state.stockHistory = payload.stockHistory;
                if (payload.staffingTargets) state.staffingTargets = payload.staffingTargets;
                if (payload.alertBaseline) state.alertBaseline = Object.assign({}, state.alertBaseline, payload.alertBaseline);
                if (payload.dues) state.dues = payload.dues;
                if (payload.duesResetAt) state.duesResetAt = payload.duesResetAt;
                if (payload.trainingRotation) state.trainingRotation = Object.assign({}, state.trainingRotation, payload.trainingRotation);
                if (payload.settings) {
                    const currentKey = state.settings.apiKey;
                    const currentDuesKey = state.settings.duesApiKey;
                    state.settings = Object.assign({}, state.settings, payload.settings, {
                        apiKey: currentKey,
                        duesApiKey: currentDuesKey
                    });
                }
                saveSnapshots();
                saveEmployeeHistory();
                saveStockHistory();
                saveStaffingTargets();
                saveAlertBaseline();
                saveDues();
                saveTrainingRotation();
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
            '#tccc-launch{position:fixed;right:18px;bottom:82px;z-index:999999;display:flex;align-items:center;gap:7px;background:linear-gradient(135deg,#5c36a8,#8b5cf6);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:11px 15px;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:grab;font-size:12px;letter-spacing:.3px;touch-action:none;user-select:none}.tccc-launch-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ff7f8f;color:#24131a!important;font-size:10px!important;font-weight:900!important}#tccc-launch.tccc-dragging{cursor:grabbing;box-shadow:0 14px 36px rgba(0,0,0,.5)}',
            '#tccc-overlay{display:none;position:fixed;inset:0;z-index:1000000;background:rgba(10,8,16,.72);backdrop-filter:blur(5px);padding:24px;overflow:auto}',
            '#tccc-overlay.open{display:block}',
            '.tccc-modal,.tccc-modal *{box-sizing:border-box}',
            '.tccc-modal{max-width:1120px;margin:24px auto;background:#18151f;color:#f1edf6;border:1px solid #453a51;border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.55);overflow:hidden;font-family:Arial,sans-serif;font-size:13px;line-height:1.35}',
            '.tccc-modal header{display:flex;justify-content:space-between;align-items:center;gap:20px;min-height:92px;padding:18px 24px;background:linear-gradient(135deg,#211a2c,#15121b);border-bottom:1px solid #3e3449}',
            '.tccc-titleblock{display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:0;padding:2px 0}',
            '.tccc-modal h2,.tccc-modal h3{margin:0!important;color:#f4f0f8!important;font-family:Arial,sans-serif!important;font-weight:800!important;letter-spacing:0!important;text-transform:none!important;text-shadow:none!important}',
            '.tccc-modal h2{display:block!important;font-size:24px!important;line-height:1.12!important}.tccc-modal h3{font-size:17px!important;line-height:1.25!important}',
            '.tccc-eyebrow{display:block!important;position:static!important;font-size:10px!important;line-height:1.2!important;font-weight:900!important;letter-spacing:1.9px!important;color:#b99cff!important;margin:0!important;padding:0!important;text-transform:uppercase!important}',
            '.tccc-header-right{display:flex;align-items:center;gap:10px}.tccc-freshness{display:flex;align-items:center;gap:6px;border:1px solid #44394d;background:#1b1721;border-radius:999px;padding:6px 9px;color:#aaa2b3!important;font-size:10px}.tccc-freshness i{width:7px;height:7px;border-radius:50%;background:#9b8da5}.tccc-freshness.fresh i{background:#79d69f}.tccc-freshness.stale i{background:#f5c781}.tccc-freshness.loading i{background:#b394ff;animation:tccc-pulse 1s ease-in-out infinite}@keyframes tccc-pulse{50%{opacity:.35}}.tccc-head-actions{display:flex;gap:8px;flex:0 0 auto}.tccc-head-actions button{width:38px;height:38px;border-radius:10px;border:1px solid #4a3d57;background:#292231;color:#fff!important;font-size:20px;line-height:1;cursor:pointer}',
            '.tccc-modal nav{display:flex;gap:6px;padding:9px 14px;background:#121016;border-bottom:1px solid #382f41;overflow-x:auto}',
            '.tccc-modal nav button{white-space:nowrap;border:0;background:transparent;color:#bbb3c4!important;padding:10px 12px;border-radius:8px;font-size:13px!important;line-height:1.1!important;font-weight:700!important;cursor:pointer}',
            '.tccc-modal nav button:hover{background:#211b29;color:#f3eff8!important}.tccc-modal nav button.active{background:#7449c8;color:#fff!important}',
            '.tccc-modal main{padding:20px;min-height:430px;color:#eee9f4}',
            '.tccc-modal footer{padding:10px 18px;border-top:1px solid #382f41;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:#9c94a6!important;font-size:11px;line-height:1.3}',
            '.tccc-error{margin:14px 18px 0;padding:11px 13px;background:#3a1820;border:1px solid #6c2b38;border-radius:9px;color:#ffb6c0;font-weight:700}',
            '.tccc-loading{height:3px;background:linear-gradient(90deg,#6d48be,#b496ff,#6d48be);background-size:200% 100%;animation:tccc-load 1.2s linear infinite}@keyframes tccc-load{to{background-position:-200% 0}}',
            '.tccc-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}',
            '.tccc-card{background:#231e2a;border:1px solid #44394d;border-radius:12px;padding:16px;min-height:92px}.tccc-card.good{border-color:#376849}.tccc-card.bad{border-color:#7e3948}',
            '.tccc-card-label{font-size:11px;line-height:1.2;text-transform:uppercase;letter-spacing:.8px;color:#b3abbc!important;font-weight:800}.tccc-card-value{font-size:22px;line-height:1.15;font-weight:900;color:#f5f1f8!important;margin-top:8px}.tccc-card-sub{font-size:11px;line-height:1.4;color:#aaa2b2!important;margin-top:6px}',
            '.tccc-grid2{display:grid;grid-template-columns:1.25fr 1fr;gap:14px}.tccc-panel{background:#231e2a;border:1px solid #44394d;border-radius:12px;padding:16px;margin-bottom:14px;color:#eee9f4}.tccc-panel-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px}.tccc-panel-head span{font-size:11px;line-height:1.35;color:#aaa2b3!important}',
            '.tccc-brief-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.tccc-brief-grid button{display:flex;flex-direction:column;align-items:flex-start;text-align:left;min-height:105px;background:#19151e;border:1px solid #413747;border-radius:10px;padding:12px;cursor:pointer}.tccc-brief-grid button span{font-size:9px!important;letter-spacing:.65px;font-weight:900!important;color:#aaa2b3!important}.tccc-brief-grid button strong{font-size:16px!important;line-height:1.2;color:#f3edf7!important;margin-top:7px}.tccc-brief-grid button small{font-size:10px!important;line-height:1.35;color:#aaa2b3!important;margin-top:5px}.tccc-brief-grid button.ok{border-color:#315e46}.tccc-brief-grid button.warn{border-color:#725629}.tccc-brief-grid button.danger{border-color:#7e3948}.tccc-brief-grid button.info{border-color:#5d4780}.tccc-brief-grid button:hover{background:#211a29}.tccc-overview-trend,.tccc-analytics-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tccc-overview-trend>div,.tccc-analytics-grid>div{background:#19151e;border:1px solid #3e3447;border-radius:8px;padding:10px 11px}.tccc-overview-trend span,.tccc-analytics-grid span{display:block;color:#aaa2b3!important;font-size:9px;text-transform:uppercase;letter-spacing:.45px;font-weight:800}.tccc-overview-trend strong,.tccc-analytics-grid strong{display:block;color:#f2edf6!important;font-size:14px;margin-top:5px}.tccc-star-history{display:flex;gap:8px;flex-wrap:wrap}.tccc-star-history>div{display:flex;flex-direction:column;min-width:130px;background:#19151e;border:1px solid #413747;border-radius:8px;padding:10px}.tccc-star-history span{font-size:9px;color:#aaa2b3!important}.tccc-star-history strong{font-size:18px;color:#c6a9ff!important;margin-top:3px}.tccc-star-history small{font-size:8px;color:#8f8798!important;margin-top:3px}.tccc-day-state{display:inline-block;border-radius:999px;padding:4px 7px;font-size:8px!important;font-weight:900!important;letter-spacing:.5px}.tccc-day-state.live{background:#59421f;color:#f5c781!important}.tccc-day-state.complete{background:#204b34;color:#8ee3ae!important}.tccc-live-row td{background:rgba(245,199,129,.03)!important}.tccc-trend-waiting{grid-column:span 1}',
            '.tccc-attention{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.tccc-attention button{display:flex;flex-direction:column;text-align:left;background:#18141d;border:1px solid #413747;border-radius:10px;padding:13px;color:#e7e1ed!important;cursor:pointer}.tccc-attention button:hover{border-color:#674f82;background:#1d1724}.tccc-attention strong{font-size:18px;line-height:1.15;color:#c2a4ff!important}.tccc-attention span{font-size:11px;line-height:1.35;margin-top:5px;color:#b0a8b8!important}',
            '.tccc-health{margin-top:12px}.tccc-health-row{margin-bottom:12px}.tccc-health-row>div:first-child{display:flex;justify-content:space-between;font-size:12px;line-height:1.3;color:#e8e2ed!important;margin-bottom:6px}.tccc-health-row b{color:#fff!important}.tccc-meter{height:8px;background:#151219;border-radius:99px;overflow:hidden}.tccc-meter span{display:block;height:100%;background:linear-gradient(90deg,#704bc0,#b394ff)}',
            '.tccc-note{font-size:11px;line-height:1.55;color:#b2aaba!important;padding:11px 13px;border-left:3px solid #7654bd;background:#19151e;border-radius:6px}.tccc-note strong{color:#e8dfff!important}.tccc-setting-actions.compact{margin:10px 0 12px}#tccc-toasts{position:fixed;right:18px;top:18px;z-index:1000002;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 36px));pointer-events:none}.tccc-toast{pointer-events:auto;display:flex;flex-direction:column;align-items:flex-start;text-align:left;background:#211b29;border:1px solid #5b4a68;border-left:4px solid #8b5cf6;border-radius:10px;padding:11px 13px;color:#eee8f4!important;box-shadow:0 12px 36px rgba(0,0,0,.4);cursor:pointer}.tccc-toast.success{border-left-color:#79d69f}.tccc-toast.warning{border-left-color:#f5c781}.tccc-toast strong{font-size:12px!important;color:#f4eff8!important}.tccc-toast span{font-size:10px!important;line-height:1.4;color:#b8afc0!important;margin-top:3px}',
            '.tccc-finance-bridge td:nth-child(2){text-align:right!important;font-variant-numeric:tabular-nums}.tccc-finance-bridge td:nth-child(3){color:#aca3b5!important;white-space:normal!important}.tccc-finance-subtotal td{border-top:1px solid #59496a!important}.tccc-finance-total td{border-top:2px solid #7654bd!important;background:rgba(118,84,189,.08)!important}.tccc-news-text{white-space:normal!important;min-width:420px}.tccc-fund-badge{display:inline-block;border-radius:999px;padding:4px 8px;font-size:9px!important;font-weight:900!important;letter-spacing:.5px}.tccc-fund-badge.deposit{background:#1f4b34;color:#8fe0ae!important}.tccc-fund-badge.withdrawal{background:#582630;color:#ff9aa7!important}.tccc-fund-badge.other{background:#3a3341;color:#c4bbc9!important}.tccc-cash-equation{display:grid;grid-template-columns:minmax(150px,1fr) auto minmax(130px,1fr) auto minmax(130px,1fr) auto minmax(170px,1.2fr);gap:10px;align-items:stretch}.tccc-cash-equation>div{display:flex;flex-direction:column;justify-content:center;gap:5px;background:#19151e;border:1px solid #403649;border-radius:9px;padding:12px}.tccc-cash-equation>div.result{border-color:#7654bd;background:rgba(118,84,189,.08)}.tccc-cash-equation>div span{font-size:10px;color:#aaa2b3!important;text-transform:uppercase;font-weight:800;letter-spacing:.5px}.tccc-cash-equation>div strong{font-size:16px;color:#f4f0f8!important}.tccc-cash-equation>b{display:flex;align-items:center;color:#a58fbe!important;font-size:19px}',
            '.tccc-tablewrap{overflow:auto!important;max-height:none!important;height:auto!important;border-radius:8px}.tccc-modal table{width:100%!important;border-collapse:separate!important;border-spacing:0!important;font-size:13px!important;line-height:1.35!important;color:#eee9f4!important;background:transparent!important}.tccc-modal thead,.tccc-modal tbody,.tccc-modal tr{background:transparent!important}.tccc-modal th{text-align:left!important;color:#bbb3c4!important;background:#1b1720!important;font-size:10px!important;line-height:1.2!important;text-transform:uppercase!important;letter-spacing:.7px!important;font-weight:800!important;padding:10px 11px!important;border:0!important;border-bottom:1px solid #4a3e53!important;white-space:nowrap}.tccc-modal td{color:#e6e0eb!important;background:transparent!important;font-size:13px!important;line-height:1.35!important;padding:10px 11px!important;border:0!important;border-bottom:1px solid #372f3e!important;white-space:nowrap}.tccc-modal tbody tr:nth-child(even) td{background:rgba(255,255,255,.018)!important}.tccc-modal tbody tr:hover td{background:rgba(139,92,246,.08)!important}.tccc-modal td a{color:#c3a5ff!important;text-decoration:none!important;font-weight:700}.tccc-modal td a:hover{text-decoration:underline!important}.tccc-modal .tccc-positive,.tccc-modal td.tccc-positive{color:#79d69f!important;font-weight:800!important}.tccc-modal .tccc-negative,.tccc-modal td.tccc-negative{color:#ff7688!important;font-weight:800!important}.tccc-nextrow td{background:#302342!important}',
            '.tccc-next{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#3d2865,#251d35);border:1px solid #7a5aaa;border-radius:12px;padding:17px 18px;margin-bottom:14px;color:#f3eef7}.tccc-next span{display:block;font-size:10px;line-height:1.2;text-transform:uppercase;color:#c1ace0!important;font-weight:800}.tccc-next strong{display:block;font-size:23px;line-height:1.15;color:#fff!important;margin-top:4px}.tccc-training-next small{display:block;margin-top:7px;color:#c0b4cc!important;font-size:11px}.tccc-next-meta{text-align:right}.tccc-next-meta strong{font-size:20px!important}.tccc-training-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.tccc-training-summary>div{background:#211b29;border:1px solid #43384d;border-radius:10px;padding:12px 13px}.tccc-training-summary span{display:block;color:#aaa1b2!important;font-size:9px;text-transform:uppercase;letter-spacing:.65px;font-weight:800}.tccc-training-summary strong{display:block;color:#f2edf6!important;font-size:15px;margin-top:5px}.tccc-training-head{align-items:flex-start}.tccc-training-head>div span{display:block;margin-top:4px}.tccc-small-action{border:1px solid #564568;background:#2b2334;color:#e8dff0!important;border-radius:8px;padding:8px 10px;font-size:10px!important;font-weight:800!important;cursor:pointer;white-space:nowrap}.tccc-small-action:hover{border-color:#7c5fb0;background:#33273f}.tccc-queue-actions{display:flex;gap:5px;align-items:center}.tccc-queue-actions button{border:1px solid #4b4054;background:#241e2b;color:#d9d1df!important;border-radius:6px;min-width:30px;height:28px;padding:0 7px;font-size:9px!important;font-weight:900!important;cursor:pointer}.tccc-queue-actions button:hover:not(:disabled){background:#3b2a50;border-color:#7654bd;color:#fff!important}.tccc-queue-actions button:disabled{opacity:.28;cursor:not-allowed}.tccc-queue-actions button[data-train-action="next"]{color:#c6a9ff!important}.tccc-queue-actions button[data-train-action="skip"]{color:#f2bf7b!important}.tccc-training-log{display:flex;flex-direction:column;gap:7px}.tccc-training-log-row{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 10px;border:1px solid #39313f;border-radius:8px;background:#1a161f}.tccc-training-log-row>div{min-width:0}.tccc-training-log-row strong{display:block;color:#eee8f4!important;font-size:12px}.tccc-training-log-row>div span{display:block;color:#aaa2b2!important;font-size:10px;margin-top:2px}.tccc-training-log-row time{color:#918999!important;font-size:10px;white-space:nowrap}.tccc-rotation-badge{display:inline-block;text-align:center;border-radius:999px;padding:4px 7px;font-size:8px!important;font-weight:900!important;letter-spacing:.5px}.tccc-rotation-badge.auto{background:#1f4b34;color:#8fe0ae!important}.tccc-rotation-badge.skip{background:#5a4021;color:#f5c781!important}.tccc-rotation-badge.reset{background:#3b304a;color:#cbb6e7!important}.tccc-training-log-empty{color:#aaa2b2!important;font-size:11px;padding:8px 2px}',
            '.tccc-position-mix{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tccc-position-mix>div,.tccc-recruit-status>div{display:flex;justify-content:space-between;align-items:center;background:#19151e;border:1px solid #3e3447;border-radius:8px;padding:10px 11px}.tccc-position-mix span,.tccc-recruit-status span{color:#aaa2b3!important;font-size:10px;font-weight:700}.tccc-position-plan{position:relative;padding-right:72px!important}.tccc-position-plan small{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:8px!important;font-weight:900!important;text-transform:uppercase}.tccc-position-plan.target small{color:#8ee3ae!important}.tccc-position-plan.short small{color:#ff98a4!important}.tccc-position-plan.over small{color:#f5c781!important}.tccc-staffing-editor{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tccc-staffing-editor label{display:flex;flex-direction:column;gap:6px;background:#19151e;border:1px solid #3e3447;border-radius:9px;padding:10px}.tccc-staffing-editor label span{color:#b7aec0!important;font-size:10px;font-weight:800}.tccc-staffing-editor input{background:#121016!important;border:1px solid #4a3f53!important;color:#fff!important;border-radius:7px;padding:8px 9px;font-size:13px!important}.tccc-staffing-plan-summary{display:flex;gap:14px;flex-wrap:wrap;margin-top:11px;color:#aaa2b2!important;font-size:10px;font-weight:800}.tccc-optimizer-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:0 0 13px}.tccc-optimizer-summary>div{background:#19151e;border:1px solid #3e3447;border-radius:8px;padding:10px}.tccc-optimizer-summary span{display:block;color:#aaa2b3!important;font-size:9px;text-transform:uppercase;letter-spacing:.45px;font-weight:800}.tccc-optimizer-summary strong{display:block;color:#f2edf6!important;font-size:15px;margin-top:4px}.tccc-optimizer-change-row td{background:rgba(245,199,129,.035)!important}.tccc-role-score{color:#8f8798!important;font-size:9px!important}.tccc-role-fit{color:#c4a4ff!important}.tccc-manager-callout{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px;margin:0 0 13px;padding:10px;border:1px solid #6b4f92;background:rgba(118,84,189,.08);border-radius:10px}.tccc-manager-callout>div{background:#19151e;border:1px solid #41364c;border-radius:8px;padding:9px 10px}.tccc-manager-callout span{display:block;color:#aaa2b3!important;font-size:9px;text-transform:uppercase;font-weight:800;letter-spacing:.4px}.tccc-manager-callout strong{display:block;color:#f2edf6!important;font-size:14px;margin-top:4px}.tccc-position-mix strong,.tccc-recruit-status strong{color:#f3edf7!important;font-size:14px}.tccc-recruit-status{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tccc-recruit-empty{display:flex;flex-direction:column;gap:5px;text-align:center;padding:36px 16px;background:#1a161f;border:1px dashed #493d53;border-radius:10px}.tccc-recruit-empty strong{color:#f1ecf5!important;font-size:14px}.tccc-recruit-empty span{color:#aaa1b2!important;font-size:11px}.tccc-application-message{white-space:normal!important;min-width:220px;max-width:420px}',
            '.tccc-stock-status{display:inline-block;border-radius:999px;padding:5px 8px;font-size:9px!important;font-weight:900!important}.tccc-stock-status.good{background:#204b34;color:#8ee3ae!important}.tccc-stock-status.watch{background:#59421f;color:#f5c781!important}.tccc-stock-status.bad{background:#55252e;color:#ff98a4!important}.tccc-stock-status.neutral{background:#3a3341;color:#c4bbc9!important}.tccc-stock-sample{color:#8f8798!important;font-size:9px!important}.tccc-modal .tccc-warning,.tccc-modal td.tccc-warning{color:#f5c781!important;font-weight:800!important}',
            '.tccc-filterbar{display:flex;gap:7px;flex-wrap:wrap;margin:4px 0 12px}.tccc-filterbar button{border:1px solid #4c4056;background:#1c1722;color:#bfb6c7!important;border-radius:999px;padding:7px 10px;font-size:9px!important;font-weight:900!important;cursor:pointer}.tccc-filterbar button.active{background:#7449c8;border-color:#865ee0;color:#fff!important}.tccc-employee-status{display:inline-block;border-radius:999px;padding:5px 8px;font-size:9px!important;font-weight:900!important}.tccc-employee-status.good{background:#204b34;color:#8ee3ae!important}.tccc-employee-status.bad{background:#55252e;color:#ff98a4!important}.tccc-expand-employee{border:1px solid #564568;background:#2b2334;color:#d9c8ef!important;border-radius:6px;padding:5px 8px;font-size:8px!important;font-weight:900!important;cursor:pointer}.tccc-expand-employee:hover{border-color:#7b5ca5;background:#372a45}.tccc-employee-detail-row td{padding:0!important;background:#19151e!important}.tccc-employee-detail{padding:14px 16px 16px;border-left:3px solid #7654bd}.tccc-employee-detail-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px}.tccc-employee-detail-head strong{display:block;color:#f2edf6!important;font-size:14px}.tccc-employee-detail-head span{display:block;color:#a69dad!important;font-size:10px;margin-top:3px}.tccc-trend-note{color:#b4aabd!important;font-size:10px;line-height:1.45;text-align:right}.tccc-effectiveness-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.tccc-effectiveness-grid>div{background:#211b29;border:1px solid #3e3447;border-radius:8px;padding:9px 10px}.tccc-effectiveness-grid span{display:block;color:#a69dad!important;font-size:9px;text-transform:uppercase;letter-spacing:.5px;font-weight:800}.tccc-effectiveness-grid strong{display:block;color:#f1ebf5!important;font-size:14px;margin-top:4px}',
            '.tccc-duebtn{border:0;border-radius:999px;padding:6px 10px;font-size:10px;font-weight:900;cursor:pointer}.tccc-duebtn.paid{background:#204b34;color:#8ee3ae}.tccc-duebtn.unpaid{background:#55252e;color:#ff98a4}.tccc-dues-status{display:flex;gap:8px;flex-direction:column;border:1px solid #44394d;border-radius:10px;padding:12px 14px;margin-bottom:14px}.tccc-dues-status strong{font-size:12px!important}.tccc-dues-status span{font-size:11px!important;line-height:1.5;color:#b9b0c1!important}.tccc-dues-status.ready{background:#17251d;border-color:#315e46}.tccc-dues-status.ready strong{color:#8fe0ae!important}.tccc-dues-status.locked{background:#2a2023;border-color:#70404a}.tccc-dues-status.locked strong{color:#ff9aa7!important}.tccc-auto-reset{border:1px solid #604d70;background:#2b2334;color:#d9c8ef!important;border-radius:6px;padding:5px 7px;font-size:8px!important;font-weight:900!important;cursor:pointer}.tccc-auto-label{font-size:9px;color:#83d6a5!important;font-weight:900}.tccc-dues-actions{display:flex;gap:7px;align-items:center}.tccc-small-action.danger{border-color:#6f3a46!important;background:#3a2027!important;color:#ff9aa7!important}.tccc-small-action.danger:hover{border-color:#9a4e5e!important;background:#4b252f!important}.tccc-settings-divider{height:1px;background:#44394d;margin:20px 0}',
            '.tccc-settings label{display:flex;flex-direction:column;gap:7px;color:#c1b8ca!important;font-size:11px;font-weight:700;margin-top:14px}.tccc-settings input[type=password],.tccc-settings input[type=number],.tccc-settings input[type=text]{background:#151219!important;border:1px solid #4a3f53!important;color:#fff!important;border-radius:8px;padding:10px 11px;font-size:13px!important;line-height:1.25!important}.tccc-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.tccc-settings .tccc-check{flex-direction:row;align-items:center;color:#c8c0d0!important}.tccc-setting-actions{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 14px}.tccc-setting-actions button,.tccc-empty button{border:1px solid #564568;background:#2b2334;color:#e7dfef!important;padding:10px 13px;border-radius:8px;font-size:12px!important;font-weight:800!important;cursor:pointer}.tccc-setting-actions button.primary,.tccc-empty button.primary{background:#7449c8;border-color:#865ee0;color:#fff!important}',
            '.tccc-empty{text-align:center;padding:70px 20px;color:#eee8f4}.tccc-empty p{color:#b3aabb!important;max-width:560px;margin:12px auto 18px;line-height:1.55}',
            '@media(max-width:800px){#tccc-overlay{padding:6px}.tccc-modal{margin:6px auto}.tccc-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.tccc-grid2{grid-template-columns:1fr}.tccc-settings-grid{grid-template-columns:1fr}.tccc-cash-equation{grid-template-columns:1fr}.tccc-cash-equation>b{display:none}.tccc-training-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.tccc-training-log-row{grid-template-columns:80px minmax(0,1fr)}.tccc-training-log-row time{grid-column:2}.tccc-effectiveness-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tccc-employee-detail-head{flex-direction:column}.tccc-trend-note{text-align:left}.tccc-position-mix,.tccc-recruit-status{grid-template-columns:1fr}.tccc-staffing-editor{grid-template-columns:1fr}.tccc-optimizer-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.tccc-manager-callout{grid-template-columns:1fr}.tccc-brief-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tccc-modal main{padding:10px}}',
            '@media(max-width:480px){#tccc-launch{right:10px;bottom:72px}.tccc-cards{grid-template-columns:1fr}.tccc-attention{grid-template-columns:1fr}.tccc-brief-grid{grid-template-columns:1fr}.tccc-overview-trend,.tccc-analytics-grid{grid-template-columns:1fr}.tccc-modal header{min-height:82px;padding:14px 16px}.tccc-titleblock{gap:5px}.tccc-freshness{display:none}.tccc-modal h2{font-size:20px!important}.tccc-modal main{padding:10px}.tccc-modal td{font-size:12px!important}.tccc-modal th{font-size:9px!important}}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function bindLauncherDrag(launch) {
        let drag = null;

        launch.addEventListener('pointerdown', function (event) {
            if (event.button !== undefined && event.button !== 0) return;
            const rect = launch.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                startX: event.clientX,
                startY: event.clientY,
                moved: false
            };
            if (launch.setPointerCapture && event.pointerId !== undefined) {
                try { launch.setPointerCapture(event.pointerId); } catch (e) {}
            }
        });

        launch.addEventListener('pointermove', function (event) {
            if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;

            if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
                drag.moved = true;
                launch.classList.add('tccc-dragging');
            }
            if (!drag.moved) return;

            const maxLeft = Math.max(6, window.innerWidth - launch.offsetWidth - 6);
            const maxTop = Math.max(6, window.innerHeight - launch.offsetHeight - 6);
            const left = Math.max(6, Math.min(maxLeft, event.clientX - drag.offsetX));
            const top = Math.max(6, Math.min(maxTop, event.clientY - drag.offsetY));

            launch.style.left = left + 'px';
            launch.style.top = top + 'px';
            launch.style.right = 'auto';
            launch.style.bottom = 'auto';
        });

        function finishDrag(event) {
            if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
            if (drag.moved) {
                const rect = launch.getBoundingClientRect();
                state.launcherPosition = { left: Math.round(rect.left), top: Math.round(rect.top) };
                saveLauncherPosition();
                suppressLauncherClick = true;
                setTimeout(function () { suppressLauncherClick = false; }, 0);
            }
            launch.classList.remove('tccc-dragging');
            drag = null;
        }

        launch.addEventListener('pointerup', finishDrag);
        launch.addEventListener('pointercancel', finishDrag);
    }

    function mount() {
        injectCss();

        let launch = document.getElementById('tccc-launch');
        if (!launch) {
            launch = document.createElement('button');
            launch.id = 'tccc-launch';
            launch.type = 'button';
            launch.title = APP.name;
            bindLauncherDrag(launch);
            launch.addEventListener('click', function () {
                if (suppressLauncherClick) return;
                state.open = true;
                render();
                if (state.settings.apiKey && !state.profile && !state.loading) refreshData('open-dashboard');
            });
            document.body.appendChild(launch);
        }

        let overlay = document.getElementById('tccc-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'tccc-overlay';
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) {
                    state.open = false;
                    render();
                }
            });
            document.body.appendChild(overlay);
        }

        let toasts = document.getElementById('tccc-toasts');
        if (!toasts) {
            toasts = document.createElement('div');
            toasts.id = 'tccc-toasts';
            document.body.appendChild(toasts);
        }

        updateLauncher();
    }

    loadLocalState();
    mount();
    startAutoRefresh(true);

    // Torn is a SPA in several areas. Re-mount if page navigation replaces body content.
    const observer = new MutationObserver(function () {
        if (!document.getElementById('tccc-launch') || !document.getElementById('tccc-overlay') || !document.getElementById('tccc-toasts')) {
            mount();
        }
        if (location.href !== lastLocationHref) {
            lastLocationHref = location.href;
            updateLauncher();
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', updateLauncher);
})();
