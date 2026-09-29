/**
 * app.js — Main application logic, UI bindings, state management,
 * breakdown donut chart, insights rendering, and amortization table interactions.
 */

(function () {
  'use strict';

  // Application State
  const AppState = {
    homePrice: 400000,
    downPayment: 80000,
    downPaymentPct: 20,
    downPaymentMode: 'dollar', // 'dollar' or 'percent'
    loanTermYears: 30,
    interestRate: 7.03, // Will be initialized to the latest rate from RateDataService
    interestRateDirty: false,
    loanStartDate: '2026-10',
    extraMonthlyPrincipal: 0,
    propertyZipCode: '',
    propertyTaxRatePct: null, // null = default 1.00% or derived from zip code lookup
    monthlyPropertyTax: null, // null = default (homePrice × 0.01) / 12
    propertyTaxDirty: false,
    monthlyInsurance: null, // null = default (homePrice × 0.0065) / 12
    insuranceDirty: false,
    monthlyHoa: 0,
    annualGrossIncome: null,
    pmiRate: 0.85,
    historicalRateWindow: '10Y',
    amortizationExpandedYears: new Set()
  };

  let breakdownDonutChart = null;
  let debounceTimer = null;
  let currentCalculationResult = null;

  // Formatting helpers
  const fmtCurrency = (n) => {
    if (isNaN(n) || n === null || n === undefined) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  };

  const fmtCurrencyDec = (n) => {
    if (isNaN(n) || n === null || n === undefined) return '$0.00';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtPct = (n) => {
    if (isNaN(n) || n === null || n === undefined) return '0.00%';
    return Number(n).toFixed(2) + '%';
  };

  function showToast(msg) {
    const existing = document.querySelector('.toast-notice');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notice';
    toast.innerHTML = `<span>⚡</span> <span>${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.4s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  // Load state from localStorage
  function loadStoredState() {
    try {
      const stored = localStorage.getItem('mortgage_calc_state');
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(AppState, parsed);
        if (Array.isArray(parsed.amortizationExpandedYears)) {
          AppState.amortizationExpandedYears = new Set(parsed.amortizationExpandedYears);
        } else {
          AppState.amortizationExpandedYears = new Set();
        }
      }
    } catch (e) {
      console.warn('Could not load stored state', e);
    }
  }

  function saveState() {
    try {
      const toStore = Object.assign({}, AppState, {
        amortizationExpandedYears: Array.from(AppState.amortizationExpandedYears)
      });
      localStorage.setItem('mortgage_calc_state', JSON.stringify(toStore));
    } catch (e) {}
  }

  // DOM Elements
  const els = {};

  function cacheDOMElements() {
    els.homePrice = document.getElementById('inputHomePrice');
    els.downPayment = document.getElementById('inputDownPayment');
    els.downPaymentPct = document.getElementById('inputDownPaymentPct');
    els.btnModeDollar = document.getElementById('btnModeDollar');
    els.btnModePct = document.getElementById('btnModePct');
    els.downPaymentDollarWrapper = document.getElementById('downPaymentDollarWrapper');
    els.downPaymentPctWrapper = document.getElementById('downPaymentPctWrapper');
    
    els.loanTerm = document.getElementById('selectLoanTerm');
    els.interestRate = document.getElementById('inputInterestRate');
    els.loanStartDate = document.getElementById('inputStartDate');
    els.extraPrincipal = document.getElementById('inputExtraPrincipal');
    els.btnUseFreddieRate = document.getElementById('btnUseFreddieRate');

    els.zipCode = document.getElementById('inputZipCode');
    els.zipTaxRateBadge = document.getElementById('zipTaxRateBadge');
    els.zipStatusText = document.getElementById('zipStatusText');
    els.propertyTax = document.getElementById('inputPropertyTax');
    els.btnResetTax = document.getElementById('btnResetTax');
    els.homeInsurance = document.getElementById('inputInsurance');
    els.btnResetInsurance = document.getElementById('btnResetInsurance');
    els.monthlyHoa = document.getElementById('inputHoa');
    els.pmiGroup = document.getElementById('pmiInputGroup');
    els.pmiRate = document.getElementById('inputPmiRate');
    els.annualIncome = document.getElementById('inputAnnualIncome');
    els.btnResetForm = document.getElementById('btnResetForm');

    // Summary elements
    els.heroPitiAmount = document.getElementById('heroPitiAmount');
    els.heroPitiLabel = document.getElementById('heroPitiLabel');
    els.heroPitiSubtext = document.getElementById('heroPitiSubtext');
    els.summaryPI = document.getElementById('summaryPI');
    els.summaryTax = document.getElementById('summaryTax');
    els.summaryInsurance = document.getElementById('summaryInsurance');
    els.summaryHoa = document.getElementById('summaryHoa');
    els.summaryPmi = document.getElementById('summaryPmi');
    els.summaryPmiRow = document.getElementById('summaryPmiRow');
    els.summaryTotalLoan = document.getElementById('summaryTotalLoan');
    els.summaryTotalInterest = document.getElementById('summaryTotalInterest');
    els.summaryTotalCost = document.getElementById('summaryTotalCost');
    els.summaryTotalPitiHoa = document.getElementById('summaryTotalPitiHoa');
    els.summaryLtv = document.getElementById('summaryLtv');
    els.summaryPmiRemoval = document.getElementById('summaryPmiRemoval');
    els.summaryPayoffAccelRow = document.getElementById('summaryPayoffAccelRow');
    els.summaryPayoffAccel = document.getElementById('summaryPayoffAccel');

    // Rate Widget
    els.widgetCurrentRate = document.getElementById('widgetCurrentRate');
    els.widgetRateDelta = document.getElementById('widgetRateDelta');
    els.widgetRateDate = document.getElementById('widgetRateDate');
    els.btnWidgetApplyRate = document.getElementById('btnWidgetApplyRate');

    // Insights Grid
    els.insightsGrid = document.getElementById('insightsGrid');
    els.cardDownPayment = document.getElementById('cardInsightDownPayment');
    els.cardHistoricalRate = document.getElementById('cardInsightHistoricalRate');
    els.cardLoanTerm = document.getElementById('cardInsightLoanTerm');
    els.cardRateSensitivity = document.getElementById('cardInsightRateSensitivity');
    els.cardIncomeRatio = document.getElementById('cardInsightIncomeRatio');

    // Amortization Table
    els.amortTableBody = document.getElementById('amortTableBody');
    els.btnExpandAll = document.getElementById('btnExpandAll');
    els.btnCollapseAll = document.getElementById('btnCollapseAll');
    els.btnExportCsv = document.getElementById('btnExportCsv');
  }

  // Property Tax Rates by ZIP Code Cache & Lookup
  let zipTaxRates = null;
  let zipTaxRatesPromise = null;

  function fetchZipTaxRates() {
    if (zipTaxRates) return Promise.resolve(zipTaxRates);
    if (zipTaxRatesPromise) return zipTaxRatesPromise;

    zipTaxRatesPromise = fetch('js/propertyTaxesByZipCode.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        zipTaxRates = data;
        return data;
      })
      .catch(err => {
        console.warn('Property tax lookup by ZIP unavailable:', err);
        return null;
      });

    return zipTaxRatesPromise;
  }

  function performZipTaxLookup(zipInput, isUserTyping) {
    const digits = String(zipInput || '').trim().replace(/\D/g, '').slice(0, 5);
    AppState.propertyZipCode = digits;

    if (digits.length === 0) {
      AppState.propertyTaxRatePct = null;
      if (els.zipTaxRateBadge) els.zipTaxRateBadge.style.display = 'none';
      if (els.zipStatusText) els.zipStatusText.textContent = '';
      if (!AppState.propertyTaxDirty) {
        AppState.monthlyPropertyTax = (AppState.homePrice * 0.01) / 12;
        els.propertyTax.value = Math.round(AppState.monthlyPropertyTax).toLocaleString('en-US');
      }
      recalculateAndRender();
      saveState();
      return;
    }

    if (digits.length < 5) {
      if (els.zipTaxRateBadge) els.zipTaxRateBadge.style.display = 'none';
      if (els.zipStatusText) {
        els.zipStatusText.textContent = isUserTyping ? '' : 'Enter 5-digit ZIP';
        els.zipStatusText.style.color = 'var(--text-muted)';
      }
      return;
    }

    if (els.zipStatusText) {
      els.zipStatusText.textContent = 'Looking up property tax rate...';
      els.zipStatusText.style.color = 'var(--text-muted)';
    }

    fetchZipTaxRates().then(rates => {
      if (AppState.propertyZipCode !== digits) return;

      if (!rates) {
        if (els.zipStatusText) {
          els.zipStatusText.textContent = 'Property tax rates file unavailable';
          els.zipStatusText.style.color = 'var(--rose)';
        }
        return;
      }

      const ratePct = rates[digits];
      if (ratePct !== undefined && ratePct !== null) {
        AppState.propertyTaxRatePct = ratePct;
        AppState.propertyTaxDirty = false;
        AppState.monthlyPropertyTax = (AppState.homePrice * (ratePct / 100)) / 12;
        els.propertyTax.value = Math.round(AppState.monthlyPropertyTax).toLocaleString('en-US');
        els.btnResetTax.style.display = 'none';

        if (els.zipTaxRateBadge) {
          els.zipTaxRateBadge.textContent = `${ratePct.toFixed(2)}% rate`;
          els.zipTaxRateBadge.style.display = 'inline-flex';
        }
        if (els.zipStatusText) {
          els.zipStatusText.textContent = `Applied Census ACS rate (${ratePct.toFixed(3)}%)`;
          els.zipStatusText.style.color = 'var(--teal)';
        }
        recalculateAndRender();
        saveState();
      } else {
        AppState.propertyTaxRatePct = null;
        if (els.zipTaxRateBadge) els.zipTaxRateBadge.style.display = 'none';
        if (els.zipStatusText) {
          els.zipStatusText.textContent = `ZIP ${digits} not found — using standard 1.00% rate`;
          els.zipStatusText.style.color = 'var(--text-muted)';
        }
        if (!AppState.propertyTaxDirty) {
          AppState.monthlyPropertyTax = (AppState.homePrice * 0.01) / 12;
          els.propertyTax.value = Math.round(AppState.monthlyPropertyTax).toLocaleString('en-US');
          recalculateAndRender();
          saveState();
        }
      }
    });
  }

  // Sync inputs to AppState
  function syncInputsFromState() {
    els.homePrice.value = AppState.homePrice ? Math.round(AppState.homePrice).toLocaleString('en-US') : '';
    
    if (AppState.downPaymentMode === 'dollar') {
      els.downPayment.value = AppState.downPayment ? Math.round(AppState.downPayment).toLocaleString('en-US') : '0';
      els.downPaymentDollarWrapper.style.display = 'flex';
      els.downPaymentPctWrapper.style.display = 'none';
      els.btnModeDollar.classList.add('active');
      els.btnModePct.classList.remove('active');
    } else {
      els.downPaymentPct.value = Number(AppState.downPaymentPct).toFixed(1);
      els.downPaymentDollarWrapper.style.display = 'none';
      els.downPaymentPctWrapper.style.display = 'flex';
      els.btnModePct.classList.add('active');
      els.btnModeDollar.classList.remove('active');
    }

    els.loanTerm.value = AppState.loanTermYears;
    els.interestRate.value = Number(AppState.interestRate).toFixed(2);
    els.loanStartDate.value = AppState.loanStartDate;
    els.extraPrincipal.value = AppState.extraMonthlyPrincipal ? Math.round(AppState.extraMonthlyPrincipal).toLocaleString('en-US') : '';

    if (els.zipCode) els.zipCode.value = AppState.propertyZipCode || '';
    if (AppState.propertyTaxRatePct !== null && AppState.propertyTaxRatePct !== undefined && AppState.propertyZipCode) {
      if (els.zipTaxRateBadge) {
        els.zipTaxRateBadge.textContent = `${AppState.propertyTaxRatePct.toFixed(2)}% rate`;
        els.zipTaxRateBadge.style.display = 'inline-flex';
      }
      if (els.zipStatusText) {
        els.zipStatusText.textContent = `Applied Census ACS rate (${AppState.propertyTaxRatePct.toFixed(3)}%)`;
        els.zipStatusText.style.color = 'var(--teal)';
      }
    } else {
      if (els.zipTaxRateBadge) els.zipTaxRateBadge.style.display = 'none';
      if (els.zipStatusText) els.zipStatusText.textContent = '';
    }

    const currentTaxRate = (AppState.propertyTaxRatePct !== null && AppState.propertyTaxRatePct !== undefined)
      ? (AppState.propertyTaxRatePct / 100)
      : 0.01;
    const effectiveTax = AppState.monthlyPropertyTax !== null ? AppState.monthlyPropertyTax : (AppState.homePrice * currentTaxRate) / 12;
    els.propertyTax.value = Math.round(effectiveTax).toLocaleString('en-US');
    els.btnResetTax.style.display = AppState.propertyTaxDirty ? 'inline' : 'none';

    const effectiveIns = AppState.monthlyInsurance !== null ? AppState.monthlyInsurance : (AppState.homePrice * 0.0065) / 12;
    els.homeInsurance.value = Math.round(effectiveIns).toLocaleString('en-US');
    els.btnResetInsurance.style.display = AppState.insuranceDirty ? 'inline' : 'none';

    els.monthlyHoa.value = AppState.monthlyHoa ? Math.round(AppState.monthlyHoa).toLocaleString('en-US') : '';
    els.pmiRate.value = Number(AppState.pmiRate).toFixed(2);
    els.annualIncome.value = AppState.annualGrossIncome ? Math.round(AppState.annualGrossIncome).toLocaleString('en-US') : '';
  }

  // Parse raw text input to number
  function parseCleanNumber(val) {
    if (!val) return 0;
    const clean = String(val).replace(/[^0-9.]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }

  // Handle Form Inputs
  function setupInputHandlers() {
    function scheduleRecalc() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        recalculateAndRender();
        saveState();
      }, 250);
    }

    // Home Price
    els.homePrice.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.homePrice = val;

      // Update down payment depending on active mode
      if (AppState.downPaymentMode === 'dollar') {
        AppState.downPaymentPct = val > 0 ? (AppState.downPayment / val) * 100 : 0;
      } else {
        AppState.downPayment = (val * AppState.downPaymentPct) / 100;
        els.downPayment.value = Math.round(AppState.downPayment).toLocaleString('en-US');
      }

      // Auto update monthly property tax if not dirty
      if (!AppState.propertyTaxDirty) {
        const taxRate = (AppState.propertyTaxRatePct !== null && AppState.propertyTaxRatePct !== undefined)
          ? (AppState.propertyTaxRatePct / 100)
          : 0.01;
        AppState.monthlyPropertyTax = (val * taxRate) / 12;
        els.propertyTax.value = Math.round(AppState.monthlyPropertyTax).toLocaleString('en-US');
      }

      // Auto update monthly insurance if not dirty
      if (!AppState.insuranceDirty) {
        AppState.monthlyInsurance = (val * 0.0065) / 12;
        els.homeInsurance.value = Math.round(AppState.monthlyInsurance).toLocaleString('en-US');
      }

      scheduleRecalc();
    });

    els.homePrice.addEventListener('blur', (e) => {
      e.target.value = AppState.homePrice ? Math.round(AppState.homePrice).toLocaleString('en-US') : '';
    });

    // Down Payment Dollar
    els.downPayment.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.downPayment = val;
      AppState.downPaymentPct = AppState.homePrice > 0 ? (val / AppState.homePrice) * 100 : 0;
      els.downPaymentPct.value = AppState.downPaymentPct.toFixed(1);
      scheduleRecalc();
    });

    els.downPayment.addEventListener('blur', (e) => {
      e.target.value = AppState.downPayment ? Math.round(AppState.downPayment).toLocaleString('en-US') : '0';
    });

    // Down Payment Percent
    els.downPaymentPct.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.downPaymentPct = Math.min(100, Math.max(0, val));
      AppState.downPayment = (AppState.homePrice * AppState.downPaymentPct) / 100;
      els.downPayment.value = Math.round(AppState.downPayment).toLocaleString('en-US');
      scheduleRecalc();
    });

    // Mode Toggle
    els.btnModeDollar.addEventListener('click', () => {
      AppState.downPaymentMode = 'dollar';
      els.btnModeDollar.classList.add('active');
      els.btnModePct.classList.remove('active');
      els.downPaymentDollarWrapper.style.display = 'flex';
      els.downPaymentPctWrapper.style.display = 'none';
      els.downPayment.value = Math.round(AppState.downPayment).toLocaleString('en-US');
      saveState();
    });

    els.btnModePct.addEventListener('click', () => {
      AppState.downPaymentMode = 'percent';
      els.btnModePct.classList.add('active');
      els.btnModeDollar.classList.remove('active');
      els.downPaymentDollarWrapper.style.display = 'none';
      els.downPaymentPctWrapper.style.display = 'flex';
      els.downPaymentPct.value = AppState.downPaymentPct.toFixed(1);
      saveState();
    });

    // Loan Term
    els.loanTerm.addEventListener('change', (e) => {
      AppState.loanTermYears = parseInt(e.target.value, 10) || 30;
      scheduleRecalc();
    });

    // Interest Rate
    els.interestRate.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.interestRate = val;
      AppState.interestRateDirty = true;
      if (window.RateChart) window.RateChart.setUserRate(val);
      scheduleRecalc();
    });

    // Start Date
    els.loanStartDate.addEventListener('change', (e) => {
      AppState.loanStartDate = e.target.value || '2026-10';
      scheduleRecalc();
    });

    // Extra Principal
    els.extraPrincipal.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.extraMonthlyPrincipal = val;
      scheduleRecalc();
    });

    els.extraPrincipal.addEventListener('blur', (e) => {
      e.target.value = AppState.extraMonthlyPrincipal ? Math.round(AppState.extraMonthlyPrincipal).toLocaleString('en-US') : '';
    });

    // Property ZIP Code
    if (els.zipCode) {
      els.zipCode.addEventListener('input', (e) => {
        const clean = e.target.value.replace(/\D/g, '').slice(0, 5);
        e.target.value = clean;
        performZipTaxLookup(clean, true);
      });

      els.zipCode.addEventListener('blur', (e) => {
        const clean = e.target.value.replace(/\D/g, '').slice(0, 5);
        e.target.value = clean;
        performZipTaxLookup(clean, false);
      });
    }

    // Monthly Property Tax
    els.propertyTax.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.monthlyPropertyTax = val;
      AppState.propertyTaxDirty = true;
      els.btnResetTax.style.display = 'inline';
      scheduleRecalc();
    });

    els.propertyTax.addEventListener('blur', (e) => {
      e.target.value = AppState.monthlyPropertyTax !== null ? Math.round(AppState.monthlyPropertyTax).toLocaleString('en-US') : '';
    });

    els.btnResetTax.addEventListener('click', (e) => {
      e.preventDefault();
      AppState.propertyTaxDirty = false;
      const taxRate = (AppState.propertyTaxRatePct !== null && AppState.propertyTaxRatePct !== undefined)
        ? (AppState.propertyTaxRatePct / 100)
        : 0.01;
      AppState.monthlyPropertyTax = (AppState.homePrice * taxRate) / 12;
      els.propertyTax.value = Math.round(AppState.monthlyPropertyTax).toLocaleString('en-US');
      els.btnResetTax.style.display = 'none';
      scheduleRecalc();
    });

    // Monthly Homeowner's Insurance
    els.homeInsurance.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.monthlyInsurance = val;
      AppState.insuranceDirty = true;
      els.btnResetInsurance.style.display = 'inline';
      scheduleRecalc();
    });

    els.homeInsurance.addEventListener('blur', (e) => {
      e.target.value = AppState.monthlyInsurance !== null ? Math.round(AppState.monthlyInsurance).toLocaleString('en-US') : '';
    });

    els.btnResetInsurance.addEventListener('click', (e) => {
      e.preventDefault();
      AppState.insuranceDirty = false;
      AppState.monthlyInsurance = (AppState.homePrice * 0.0065) / 12;
      els.homeInsurance.value = Math.round(AppState.monthlyInsurance).toLocaleString('en-US');
      els.btnResetInsurance.style.display = 'none';
      scheduleRecalc();
    });

    // Monthly HOA
    els.monthlyHoa.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.monthlyHoa = val;
      scheduleRecalc();
    });

    els.monthlyHoa.addEventListener('blur', (e) => {
      e.target.value = AppState.monthlyHoa ? Math.round(AppState.monthlyHoa).toLocaleString('en-US') : '';
    });

    // PMI Rate
    els.pmiRate.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.pmiRate = val;
      scheduleRecalc();
    });

    // Gross Household Income
    els.annualIncome.addEventListener('input', (e) => {
      const val = parseCleanNumber(e.target.value);
      AppState.annualGrossIncome = val > 0 ? val : null;
      scheduleRecalc();
    });

    els.annualIncome.addEventListener('blur', (e) => {
      e.target.value = AppState.annualGrossIncome ? Math.round(AppState.annualGrossIncome).toLocaleString('en-US') : '';
    });

    // Use Freddie Mac rate buttons
    function applyLatestFreddieRate() {
      if (!window.RateDataService) return;
      const latest = window.RateDataService.getLatestRate();
      if (latest && latest.rate30yr) {
        AppState.interestRate = latest.rate30yr;
        els.interestRate.value = Number(latest.rate30yr).toFixed(2);
        if (window.RateChart) window.RateChart.setUserRate(latest.rate30yr);
        scheduleRecalc();
        showToast(`Applied current Freddie Mac rate: ${latest.rate30yr.toFixed(2)}%`);
      }
    }

    if (els.btnUseFreddieRate) els.btnUseFreddieRate.addEventListener('click', applyLatestFreddieRate);
    if (els.btnWidgetApplyRate) els.btnWidgetApplyRate.addEventListener('click', applyLatestFreddieRate);

    // Reset Form button
    els.btnResetForm.addEventListener('click', () => {
      localStorage.removeItem('mortgage_calc_state');
      const latestRate = (window.RateDataService && window.RateDataService.getLatestRate().rate30yr) ? window.RateDataService.getLatestRate().rate30yr : 7.03;
      AppState.homePrice = 400000;
      AppState.downPayment = 80000;
      AppState.downPaymentPct = 20;
      AppState.downPaymentMode = 'dollar';
      AppState.loanTermYears = 30;
      AppState.interestRate = latestRate;
      AppState.interestRateDirty = false;
      AppState.loanStartDate = '2026-10';
      AppState.extraMonthlyPrincipal = 0;
      AppState.propertyZipCode = '';
      AppState.propertyTaxRatePct = null;
      if (els.zipCode) els.zipCode.value = '';
      if (els.zipTaxRateBadge) els.zipTaxRateBadge.style.display = 'none';
      if (els.zipStatusText) els.zipStatusText.textContent = '';
      AppState.monthlyPropertyTax = null;
      AppState.propertyTaxDirty = false;
      AppState.monthlyInsurance = null;
      AppState.insuranceDirty = false;
      AppState.monthlyHoa = 0;
      AppState.annualGrossIncome = null;
      AppState.pmiRate = 0.85;
      AppState.amortizationExpandedYears.clear();

      syncInputsFromState();
      if (window.RateChart) window.RateChart.setUserRate(latestRate);
      scheduleRecalc();
      showToast('All parameters reset to default');
    });

    // Expand / Collapse Table buttons
    els.btnExpandAll.addEventListener('click', () => {
      if (currentCalculationResult && currentCalculationResult.annualRows) {
        currentCalculationResult.annualRows.forEach(row => {
          AppState.amortizationExpandedYears.add(row.yearNumber);
        });
        renderAmortizationTable();
      }
    });

    els.btnCollapseAll.addEventListener('click', () => {
      AppState.amortizationExpandedYears.clear();
      renderAmortizationTable();
    });

    // CSV Export button
    els.btnExportCsv.addEventListener('click', exportAmortizationCsv);

    // Historical Chart Window Buttons
    const windowBtns = document.querySelectorAll('.window-btn');
    windowBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        windowBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const win = e.target.getAttribute('data-window');
        AppState.historicalRateWindow = win;
        if (window.RateChart) window.RateChart.setWindow(win);
        saveState();
      });
    });
  }

  // Recalculate everything and render UI
  function recalculateAndRender() {
    if (!window.MortgageCalculator) return;

    // Validate inputs
    let hasError = false;
    if (AppState.homePrice <= 0) {
      els.homePrice.classList.add('input-error');
      hasError = true;
    } else {
      els.homePrice.classList.remove('input-error');
    }

    if (AppState.downPayment >= AppState.homePrice) {
      els.downPayment.classList.add('input-error');
      hasError = true;
    } else {
      els.downPayment.classList.remove('input-error');
    }

    if (hasError) return;

    // Toggle PMI visibility in input section
    const ltv = AppState.homePrice > 0 ? ((AppState.homePrice - AppState.downPayment) / AppState.homePrice) * 100 : 0;
    if (ltv > 80) {
      els.pmiGroup.style.display = 'flex';
    } else {
      els.pmiGroup.style.display = 'none';
    }

    // Run core amortization computation
    currentCalculationResult = window.MortgageCalculator.calculateAmortizationSchedule(AppState);

    // Update Summary Panel
    renderSummaryPanel(currentCalculationResult);

    // Update Payment Breakdown Donut Chart
    renderBreakdownDonut(currentCalculationResult);

    // Update Insights Panel
    renderInsights(currentCalculationResult);

    // Update Amortization Table
    renderAmortizationTable();
  }

  // Summary Panel Rendering
  function renderSummaryPanel(result) {
    const s = result.summary;

    // Hero Total Amount
    const hasHoa = AppState.monthlyHoa > 0;
    els.heroPitiLabel.textContent = hasHoa ? 'Monthly Payment + HOA' : 'Monthly Payment';
    els.heroPitiAmount.innerHTML = `${fmtCurrency(s.monthlyPitiWithHoa)}<span class="hero-period">/mo</span>`;
    
    if (s.initialHasPmi) {
      els.heroPitiSubtext.textContent = `Includes ${fmtCurrency(s.standardMonthlyPmi)} PMI until balance reaches 80% LTV (${s.pmiRemovalDateStr})`;
    } else {
      els.heroPitiSubtext.textContent = 'Principal, interest, property taxes & insurance included';
    }

    // Key Highlights (safely guard items that were streamlined)
    els.summaryPI.textContent = fmtCurrencyDec(s.scheduledMonthlyPI);
    if (els.summaryTax) els.summaryTax.textContent = fmtCurrencyDec(s.monthlyTax);
    if (els.summaryInsurance) els.summaryInsurance.textContent = fmtCurrencyDec(s.monthlyInsurance);
    els.summaryHoa.textContent = fmtCurrencyDec(s.monthlyHoa);

    if (s.initialHasPmi) {
      els.summaryPmiRow.style.display = 'flex';
      els.summaryPmi.textContent = fmtCurrencyDec(s.standardMonthlyPmi);
    } else {
      els.summaryPmiRow.style.display = 'none';
    }

    if (els.summaryTotalLoan) els.summaryTotalLoan.textContent = fmtCurrency(s.originalPrincipal);
    els.summaryTotalInterest.textContent = fmtCurrency(s.totalInterestPaid);
    els.summaryTotalCost.textContent = fmtCurrency(s.totalLoanCost);
    if (els.summaryTotalPitiHoa) els.summaryTotalPitiHoa.textContent = fmtCurrency(s.totalPitiHoaOverLife);
    els.summaryLtv.textContent = fmtPct(s.ltv);
    els.summaryPmiRemoval.textContent = s.pmiRemovalDateStr;

    // Payoff acceleration highlights
    if (AppState.extraMonthlyPrincipal > 0 && s.monthsSaved > 0) {
      els.summaryPayoffAccelRow.style.display = 'flex';
      const yrPart = Math.floor(s.yearsSaved);
      const moPart = s.monthsSaved % 12;
      let timeText = '';
      if (yrPart > 0) timeText += `${yrPart} yr `;
      if (moPart > 0) timeText += `${moPart} mo `;
      timeText += 'sooner';

      els.summaryPayoffAccel.innerHTML = `<span class="badge-savings">${timeText}</span> (${fmtCurrency(s.interestSavedDollars)} saved)`;
    } else {
      els.summaryPayoffAccelRow.style.display = 'none';
    }
  }

  // Payment Breakdown Donut Chart
  function renderBreakdownDonut(result) {
    const s = result.summary;
    const canvas = document.getElementById('breakdownDonutCanvas');
    if (!canvas || !window.Chart) return;

    const dataValues = [
      s.scheduledMonthlyPI,
      s.monthlyTax,
      s.monthlyInsurance,
      AppState.monthlyHoa,
      s.standardMonthlyPmi
    ];

    const labels = ['Principal & Interest', 'Property Taxes', "Homeowner's Ins.", 'HOA Dues', 'PMI'];
    const colors = ['#00c6ff', '#8b5cf6', '#38bdf8', '#f59e0b', '#f43f5e'];

    // Update legend values
    document.getElementById('legendValPI').textContent = fmtCurrency(s.scheduledMonthlyPI);
    document.getElementById('legendValTax').textContent = fmtCurrency(s.monthlyTax);
    document.getElementById('legendValIns').textContent = fmtCurrency(s.monthlyInsurance);
    
    const hoaLegendItem = document.getElementById('legendItemHoa');
    if (AppState.monthlyHoa > 0) {
      hoaLegendItem.style.display = 'flex';
      document.getElementById('legendValHoa').textContent = fmtCurrency(AppState.monthlyHoa);
    } else {
      hoaLegendItem.style.display = 'none';
    }

    const pmiLegendItem = document.getElementById('legendItemPmi');
    if (s.initialHasPmi) {
      pmiLegendItem.style.display = 'flex';
      document.getElementById('legendValPmi').textContent = fmtCurrency(s.standardMonthlyPmi);
    } else {
      pmiLegendItem.style.display = 'none';
    }

    if (!breakdownDonutChart) {
      const ctx = canvas.getContext('2d');
      breakdownDonutChart = new window.Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: dataValues,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (item) => ` ${item.label}: ${fmtCurrencyDec(item.raw)}`
              }
            }
          }
        }
      });
    } else {
      breakdownDonutChart.data.datasets[0].data = dataValues;
      breakdownDonutChart.update();
    }
  }

  // Insights Panel Rendering
  function renderInsights(result) {
    const baseSummary = result.summary;

    // Insight 1: 1.5x Larger Down Payment
    const currentDown = AppState.downPayment;
    const maxAllowedDown = Math.max(0, AppState.homePrice - 1000);
    const hypDown = Math.min(maxAllowedDown, currentDown * 1.5);
    const downPaymentRatio = AppState.homePrice > 0 ? (currentDown / AppState.homePrice) : 0;

    if (downPaymentRatio >= 0.67 || hypDown <= currentDown) {
      els.cardDownPayment.style.display = 'none';
    } else {
      els.cardDownPayment.style.display = 'flex';
      const hyp1 = window.MortgageCalculator.computeScenario(AppState, { downPayment: hypDown });
      const deltaPiti = hyp1.summary.monthlyPitiWithHoa - baseSummary.monthlyPitiWithHoa;
      const deltaPitiPct = baseSummary.monthlyPitiWithHoa > 0 ? (deltaPiti / baseSummary.monthlyPitiWithHoa) * 100 : 0;
      const deltaInterest = hyp1.summary.totalInterestPaid - baseSummary.totalInterestPaid;
      const deltaInterestPct = baseSummary.totalInterestPaid > 0 ? (deltaInterest / baseSummary.totalInterestPaid) * 100 : 0;

      document.getElementById('ins1Monthly').innerHTML = `${fmtCurrency(hyp1.summary.monthlyPitiWithHoa)} <span class="delta-tag delta-save">${deltaPitiPct.toFixed(1)}%</span>`;
      document.getElementById('ins1Interest').innerHTML = `${fmtCurrency(hyp1.summary.totalInterestPaid)} <span class="delta-tag delta-save">${deltaInterestPct.toFixed(1)}%</span>`;

      const newLtv = hyp1.summary.ltv.toFixed(0);
      const oldLtv = baseSummary.ltv.toFixed(0);
      let note = `Down payment increases to ${fmtCurrency(hypDown)}. LTV drops from ${oldLtv}% → ${newLtv}%.`;
      if (baseSummary.initialHasPmi && !hyp1.summary.initialHasPmi) {
        note += ' <strong>PMI eliminated immediately!</strong>';
      }
      document.getElementById('ins1Note').innerHTML = note;
    }

    // Insight 2: Rate 5 Years Ago
    let fiveYearRateItem = null;
    if (window.RateDataService) {
      fiveYearRateItem = window.RateDataService.getRateFiveYearsAgo(AppState.loanStartDate);
    }

    if (fiveYearRateItem && fiveYearRateItem.rate30yr) {
      els.cardHistoricalRate.style.display = 'flex';
      const rate5Yr = fiveYearRateItem.rate30yr;
      const hyp2 = window.MortgageCalculator.computeScenario(AppState, { interestRate: rate5Yr });
      const deltaPiti = hyp2.summary.monthlyPitiWithHoa - baseSummary.monthlyPitiWithHoa;
      const deltaPitiPct = baseSummary.monthlyPitiWithHoa > 0 ? (deltaPiti / baseSummary.monthlyPitiWithHoa) * 100 : 0;
      const deltaInterest = hyp2.summary.totalInterestPaid - baseSummary.totalInterestPaid;
      const deltaInterestPct = baseSummary.totalInterestPaid > 0 ? (deltaInterest / baseSummary.totalInterestPaid) * 100 : 0;

      const deltaClassPiti = deltaPiti <= 0 ? 'delta-save' : 'delta-cost';
      const deltaClassInt = deltaInterest <= 0 ? 'delta-save' : 'delta-cost';
      const signPiti = deltaPiti > 0 ? '+' : '';
      const signInt = deltaInterest > 0 ? '+' : '';

      document.getElementById('ins2TitleRate').textContent = `(${rate5Yr.toFixed(2)}% on ${fiveYearRateItem.date})`;
      document.getElementById('ins2Monthly').innerHTML = `${fmtCurrency(hyp2.summary.monthlyPitiWithHoa)} <span class="delta-tag ${deltaClassPiti}">${signPiti}${deltaPitiPct.toFixed(1)}%</span>`;
      document.getElementById('ins2Interest').innerHTML = `${fmtCurrency(hyp2.summary.totalInterestPaid)} <span class="delta-tag ${deltaClassInt}">${signInt}${deltaInterestPct.toFixed(1)}%</span>`;

      const diffRate = (AppState.interestRate - rate5Yr).toFixed(2);
      if (deltaPiti <= 0) {
        document.getElementById('ins2Note').textContent = `5 years ago, rates were ${Math.abs(diffRate)}% lower. You would pay ${fmtCurrency(Math.abs(deltaPiti))}/mo less.`;
      } else {
        document.getElementById('ins2Note').textContent = `Current rate is ${Math.abs(diffRate)}% lower than 5 years ago, saving you ${fmtCurrency(Math.abs(deltaPiti))}/mo today!`;
      }
    } else {
      els.cardHistoricalRate.style.display = 'none';
    }

    // Insight 3: Shorter Loan Term
    let shorterTerm = null;
    if (AppState.loanTermYears === 30) shorterTerm = 20;
    else if (AppState.loanTermYears === 25) shorterTerm = 15;
    else if (AppState.loanTermYears === 20) shorterTerm = 15;
    else if (AppState.loanTermYears === 15) shorterTerm = 10;

    if (shorterTerm) {
      els.cardLoanTerm.style.display = 'flex';
      const hyp3 = window.MortgageCalculator.computeScenario(AppState, { loanTermYears: shorterTerm });
      const deltaPI = hyp3.summary.scheduledMonthlyPI - baseSummary.scheduledMonthlyPI;
      const deltaPIPct = baseSummary.scheduledMonthlyPI > 0 ? (deltaPI / baseSummary.scheduledMonthlyPI) * 100 : 0;
      const deltaInterest = hyp3.summary.totalInterestPaid - baseSummary.totalInterestPaid;
      const deltaInterestPct = baseSummary.totalInterestPaid > 0 ? (deltaInterest / baseSummary.totalInterestPaid) * 100 : 0;

      document.getElementById('ins3TermLabel').textContent = `${shorterTerm}-Year Term`;
      document.getElementById('ins3Monthly').innerHTML = `${fmtCurrency(hyp3.summary.scheduledMonthlyPI)} <span class="delta-tag delta-tradeoff">+${deltaPIPct.toFixed(1)}%</span>`;
      document.getElementById('ins3Interest').innerHTML = `${fmtCurrency(hyp3.summary.totalInterestPaid)} <span class="delta-tag delta-save">${deltaInterestPct.toFixed(1)}%</span>`;

      const yrsSooner = AppState.loanTermYears - shorterTerm;
      document.getElementById('ins3Note').textContent = `Higher monthly payment (+${fmtCurrency(deltaPI)}/mo), but saves ${fmtCurrency(Math.abs(deltaInterest))} in total interest and you own your home ${yrsSooner} years sooner.`;
    } else {
      els.cardLoanTerm.style.display = 'none';
    }

    // Insight 4: Rate Sensitivity (±1%)
    const rateMinus1 = Math.max(0.01, AppState.interestRate - 1.00);
    const ratePlus1 = Math.min(30.00, AppState.interestRate + 1.00);
    const hyp4Minus = window.MortgageCalculator.computeScenario(AppState, { interestRate: rateMinus1 });
    const hyp4Plus = window.MortgageCalculator.computeScenario(AppState, { interestRate: ratePlus1 });

    const deltaMinusPiti = hyp4Minus.summary.monthlyPitiWithHoa - baseSummary.monthlyPitiWithHoa;
    const deltaPlusPiti = hyp4Plus.summary.monthlyPitiWithHoa - baseSummary.monthlyPitiWithHoa;
    const deltaMinusInt = hyp4Minus.summary.totalInterestPaid - baseSummary.totalInterestPaid;
    const deltaPlusInt = hyp4Plus.summary.totalInterestPaid - baseSummary.totalInterestPaid;

    document.getElementById('ins4MinusRate').textContent = `${rateMinus1.toFixed(2)}%`;
    document.getElementById('ins4MinusVal').innerHTML = `${fmtCurrency(deltaMinusPiti)}/mo <span class="delta-tag delta-save">(${fmtCurrency(deltaMinusInt)} interest)</span>`;

    document.getElementById('ins4PlusRate').textContent = `${ratePlus1.toFixed(2)}%`;
    document.getElementById('ins4PlusVal').innerHTML = `+${fmtCurrency(deltaPlusPiti)}/mo <span class="delta-tag delta-cost">(+${fmtCurrency(deltaPlusInt)} interest)</span>`;

    // Insight 5: Housing Cost Ratio (Front-End DTI)
    if (AppState.annualGrossIncome && AppState.annualGrossIncome > 0) {
      els.cardIncomeRatio.style.display = 'flex';
      els.insightsGrid.classList.add('has-income-card');

      const monthlyGross = AppState.annualGrossIncome / 12;
      const ratio = (baseSummary.monthlyPitiWithHoa / monthlyGross) * 100;
      document.getElementById('ins5Ratio').textContent = `${ratio.toFixed(1)}% of gross income`;
      document.getElementById('ins5Details').textContent = `${fmtCurrency(baseSummary.monthlyPitiWithHoa)}/mo PITI+HOA out of ${fmtCurrency(monthlyGross)}/mo gross income`;

      const pin = document.getElementById('ins5BenchmarkPin');
      if (ratio <= 28) {
        pin.innerHTML = '<span style="color: var(--emerald)">● Within standard front-end guideline (≤ 28%)</span>';
      } else if (ratio <= 36) {
        pin.innerHTML = '<span style="color: var(--amber)">● Above recommended guideline (28% – 36%)</span>';
      } else {
        pin.innerHTML = '<span style="color: var(--rose)">● Exceeds typical lender affordability thresholds (> 36%)</span>';
      }
    } else {
      els.cardIncomeRatio.style.display = 'none';
      els.insightsGrid.classList.remove('has-income-card');
    }
  }

  // Amortization Schedule Table Rendering
  function renderAmortizationTable() {
    if (!currentCalculationResult || !currentCalculationResult.annualRows) return;

    const annualRows = currentCalculationResult.annualRows;
    const tbody = els.amortTableBody;
    tbody.innerHTML = '';

    annualRows.forEach(yr => {
      const isExpanded = AppState.amortizationExpandedYears.has(yr.yearNumber);

      // Annual summary row
      const trYear = document.createElement('tr');
      trYear.className = 'row-year' + (isExpanded ? ' is-expanded' : '');
      trYear.setAttribute('data-year', yr.yearNumber);

      // Determine rate badge color
      let rateBadgeClass = 'rate-mid';
      if (yr.balanceInterestRate > 5.5) rateBadgeClass = 'rate-high';
      else if (yr.balanceInterestRate < 3.5) rateBadgeClass = 'rate-low';

      trYear.innerHTML = `
        <td>
          <span class="year-expand-icon">▶</span>
          <span>Year ${yr.yearNumber} (${yr.calendarYear})</span>
          ${yr.pmiActiveAny ? '<span class="badge-pmi">PMI</span>' : ''}
        </td>
        <td class="col-interest">${fmtCurrency(yr.cumulativeInterestPaid)}</td>
        <td>${fmtCurrency(yr.interestRemaining)}</td>
        <td class="col-principal">${fmtCurrency(yr.cumulativePrincipalPaid)}</td>
        <td>${fmtCurrency(yr.principalRemaining)}</td>
        <td><strong>${fmtCurrency(yr.totalBalanceRemaining)}</strong></td>
        <td><span class="badge-rate ${rateBadgeClass}">${fmtPct(yr.balanceInterestRate)}</span></td>
      `;

      trYear.addEventListener('click', () => {
        if (AppState.amortizationExpandedYears.has(yr.yearNumber)) {
          AppState.amortizationExpandedYears.delete(yr.yearNumber);
        } else {
          AppState.amortizationExpandedYears.add(yr.yearNumber);
        }
        renderAmortizationTable();
      });

      tbody.appendChild(trYear);

      // Monthly rows if expanded
      if (isExpanded) {
        yr.months.forEach(m => {
          const trMonth = document.createElement('tr');
          trMonth.className = 'row-month';

          let mRateBadgeClass = 'rate-mid';
          if (m.balanceInterestRate > 5.5) mRateBadgeClass = 'rate-high';
          else if (m.balanceInterestRate < 3.5) mRateBadgeClass = 'rate-low';

          trMonth.innerHTML = `
            <td>
              <span>${m.dateLabel}</span>
              ${m.pmiActive ? '<span class="badge-pmi">PMI</span>' : ''}
            </td>
            <td class="col-interest">${fmtCurrency(m.cumulativeInterestPaid)}</td>
            <td>${fmtCurrency(m.interestRemaining)}</td>
            <td class="col-principal">${fmtCurrency(m.cumulativePrincipalPaid)}</td>
            <td>${fmtCurrency(m.principalRemaining)}</td>
            <td><strong>${fmtCurrency(m.totalBalanceRemaining)}</strong></td>
            <td><span class="badge-rate ${mRateBadgeClass}">${fmtPct(m.balanceInterestRate)}</span></td>
          `;
          tbody.appendChild(trMonth);
        });
      }
    });
  }

  // Export to CSV
  function exportAmortizationCsv() {
    if (!currentCalculationResult || !currentCalculationResult.monthlyRows) return;

    const rows = currentCalculationResult.monthlyRows;
    const headers = [
      'Payment #',
      'Date',
      'Scheduled P&I',
      'Extra Principal',
      'Interest Paid',
      'Principal Paid',
      'Cumulative Interest Paid',
      'Interest Remaining',
      'Cumulative Principal Paid',
      'Principal Remaining',
      'Total Balance Remaining',
      'Balance Interest Rate (%)',
      'Total Monthly PITI+HOA'
    ];

    const csvLines = [headers.join(',')];

    rows.forEach(m => {
      const line = [
        m.paymentNumber,
        `"${m.dateLabel}"`,
        m.scheduledPI.toFixed(2),
        m.extraPrincipal.toFixed(2),
        m.interestPaid.toFixed(2),
        m.principalPaid.toFixed(2),
        m.cumulativeInterestPaid.toFixed(2),
        m.interestRemaining.toFixed(2),
        m.cumulativePrincipalPaid.toFixed(2),
        m.principalRemaining.toFixed(2),
        m.totalBalanceRemaining.toFixed(2),
        m.balanceInterestRate.toFixed(2),
        m.totalMonthlyPayment.toFixed(2)
      ];
      csvLines.push(line.join(','));
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvLines.join('\n'));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', csvContent);
    downloadAnchor.setAttribute('download', `mortgage_amortization_schedule_${AppState.loanTermYears}yr.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Amortization schedule exported to CSV!');
  }

  // Rate widget update
  function updateRateWidget() {
    if (!window.RateDataService) return;
    const latest = window.RateDataService.getLatestRate();
    if (!latest) return;

    els.widgetCurrentRate.textContent = `${latest.rate30yr.toFixed(2)}%`;
    els.widgetRateDate.textContent = `Survey week of ${latest.date}`;

    if (latest.deltaVsLastWeek !== 0) {
      const isUp = latest.deltaVsLastWeek > 0;
      const arrow = isUp ? '▲' : '▼';
      const sign = isUp ? '+' : '';
      els.widgetRateDelta.className = 'rate-delta ' + (isUp ? 'delta-up' : 'delta-down');
      els.widgetRateDelta.innerHTML = `${arrow} ${sign}${latest.deltaVsLastWeek.toFixed(2)}% vs last week`;
    } else {
      els.widgetRateDelta.className = 'rate-delta';
      els.widgetRateDelta.textContent = 'Unchanged vs last week';
    }
  }

  // Initialize
  function init() {
    cacheDOMElements();
    loadStoredState();

    // 1. Use the latest mortgage rate by default rather than hard-coding a value
    if (window.RateDataService) {
      const latest = window.RateDataService.getLatestRate();
      if (latest && latest.rate30yr) {
        if (!AppState.interestRateDirty) {
          AppState.interestRate = latest.rate30yr;
        }
      }
    }

    syncInputsFromState();
    setupInputHandlers();

    // Init Chart
    if (window.RateChart) {
      window.RateChart.init('rateChartCanvas', (rate, dateStr) => {
        AppState.interestRate = rate;
        AppState.interestRateDirty = true;
        els.interestRate.value = rate.toFixed(2);
        window.RateChart.setUserRate(rate);
        recalculateAndRender();
        saveState();
        showToast(`Applied historical rate: ${rate.toFixed(2)}% (${dateStr})`);
      });
      window.RateChart.setUserRate(AppState.interestRate);
      window.RateChart.setWindow(AppState.historicalRateWindow);
    }

    // Rate update listener
    if (window.RateDataService) {
      window.RateDataService.onRateUpdate(() => {
        const latest = window.RateDataService.getLatestRate();
        if (latest && latest.rate30yr && !AppState.interestRateDirty) {
          AppState.interestRate = latest.rate30yr;
          els.interestRate.value = Number(latest.rate30yr).toFixed(2);
          if (window.RateChart) window.RateChart.setUserRate(latest.rate30yr);
        }
        updateRateWidget();
        if (window.RateChart) window.RateChart.render();
        recalculateAndRender();
      });
      updateRateWidget();
    }

    // Preload ZIP code tax rates in background
    fetchZipTaxRates();
    if (AppState.propertyZipCode && AppState.propertyZipCode.length === 5) {
      performZipTaxLookup(AppState.propertyZipCode, false);
    }

    // Initial calculation
    recalculateAndRender();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
