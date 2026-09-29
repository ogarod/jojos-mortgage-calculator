/**
 * rateData.js — Freddie Mac PMMS historical rate access & parsing.
 * Loads baseline rates via pre-bundled window.PMMS_INITIAL_RATES
 * and online live sync via SheetJS + Freddie Mac XLSX / CORS proxy.
 */

(function () {
  'use strict';

  let ratesData = [];
  const listeners = [];

  function parseDateStr(str) {
    if (!str) return null;
    const parts = str.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date(str);
  }

  function initData() {
    // 1. Try sessionStorage cache first
    try {
      const cached = sessionStorage.getItem('pmms_rate_data');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          ratesData = parsed;
          return;
        }
      }
    } catch (e) {
      // sessionStorage might fail in restricted iframe or private mode
    }

    // 2. Use pre-bundled baseline snapshot if available
    if (window.PMMS_INITIAL_RATES && Array.isArray(window.PMMS_INITIAL_RATES)) {
      ratesData = window.PMMS_INITIAL_RATES.slice();
    }
  }

  function notifyListeners() {
    listeners.forEach(fn => {
      try { fn(ratesData); } catch (e) { console.error('Rate listener error', e); }
    });
  }

  function onRateUpdate(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function getLatestRate() {
    if (!ratesData || ratesData.length === 0) {
      return { date: null, rate30yr: 7.00, rate15yr: null, deltaVsLastWeek: 0 };
    }
    const latest = ratesData[ratesData.length - 1];
    const prev = ratesData.length > 1 ? ratesData[ratesData.length - 2] : null;
    const delta = prev ? (latest.rate30yr - prev.rate30yr) : 0;
    return {
      date: latest.date,
      rate30yr: latest.rate30yr,
      rate15yr: latest.rate15yr,
      deltaVsLastWeek: delta
    };
  }

  function getRateFiveYearsAgo(referenceDateStr) {
    if (!ratesData || ratesData.length === 0) return null;

    let refDate = new Date();
    if (referenceDateStr) {
      const p = parseDateStr(referenceDateStr);
      if (p && !isNaN(p.getTime())) refDate = p;
    }

    // Target 5 years prior
    const targetDate = new Date(refDate.getFullYear() - 5, refDate.getMonth(), refDate.getDate());
    const targetTime = targetDate.getTime();

    let closest = null;
    let minDiff = Infinity;

    for (let i = 0; i < ratesData.length; i++) {
      const item = ratesData[i];
      const d = parseDateStr(item.date);
      if (!d || isNaN(d.getTime())) continue;
      const diff = Math.abs(d.getTime() - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = item;
      }
    }

    return closest;
  }

  function getRatesForWindow(windowStr) {
    if (!ratesData || ratesData.length === 0) return [];
    if (windowStr === 'ALL') return ratesData.slice();

    const latest = ratesData[ratesData.length - 1];
    const latestDate = parseDateStr(latest.date);
    if (!latestDate) return ratesData.slice();

    let yearsBack = 10;
    if (windowStr === '1Y') yearsBack = 1;
    else if (windowStr === '5Y') yearsBack = 5;
    else if (windowStr === '10Y') yearsBack = 10;
    else if (windowStr === '20Y') yearsBack = 20;
    else if (windowStr === '50Y') yearsBack = 50;

    const cutoffDate = new Date(latestDate.getFullYear() - yearsBack, latestDate.getMonth(), latestDate.getDate());
    const cutoffTime = cutoffDate.getTime();

    return ratesData.filter(item => {
      const d = parseDateStr(item.date);
      return d && d.getTime() >= cutoffTime;
    });
  }

  /**
   * Online sync stub (live browser fetch disabled to prevent CORS policy blocks;
   * rates are maintained via generate_pmms_rates.py into js/pmms_rates.js)
   */
  async function syncLatestOnline() {
    return false;
  }

  // Initialize immediately
  initData();

  // Background live sync disabled to prevent browser CORS policy blocks.
  // PMMS data is loaded via js/pmms_rates.js and updated via generate_pmms_rates.py.

  window.RateDataService = {
    init: initData,
    getLatestRate,
    getRateFiveYearsAgo,
    getRatesForWindow,
    onRateUpdate,
    syncLatestOnline
  };
})();
