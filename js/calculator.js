/**
 * calculator.js — Core mortgage math and amortization schedule computation.
 * Pure calculation logic with zero DOM or global side-effects.
 */

(function () {
  'use strict';

  /**
   * Standard monthly principal and interest payment.
   * M = P * [r(1+r)^n] / [(1+r)^n - 1]
   */
  function calculateMonthlyPI(principal, annualRatePct, termYears) {
    if (principal <= 0) return 0;
    if (annualRatePct <= 0) {
      const totalMonths = Math.max(1, termYears * 12);
      return principal / totalMonths;
    }
    const r = (annualRatePct / 100) / 12;
    const n = Math.max(1, termYears * 12);
    const factor = Math.pow(1 + r, n);
    return principal * (r * factor) / (factor - 1);
  }

  /**
   * Format helper: YYYY-MM date addition.
   */
  function addMonthsToDate(yearMonthStr, monthsToAdd) {
    let year = 2026;
    let month = 10;
    if (typeof yearMonthStr === 'string' && yearMonthStr.includes('-')) {
      const parts = yearMonthStr.split('-');
      year = parseInt(parts[0], 10) || 2026;
      month = parseInt(parts[1], 10) || 10;
    }
    const totalMonthIndex = (year * 12 + (month - 1)) + monthsToAdd;
    const targetYear = Math.floor(totalMonthIndex / 12);
    const targetMonth = (totalMonthIndex % 12) + 1;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      iso: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
      label: `${monthNames[targetMonth - 1]} ${targetYear}`,
      year: targetYear,
      month: targetMonth
    };
  }

  /**
   * Core Amortization Calculation.
   */
  function calculateAmortizationSchedule(options) {
    const homePrice = Math.max(0, Number(options.homePrice) || 0);
    const downPayment = Math.max(0, Math.min(homePrice, Number(options.downPayment) || 0));
    const termYears = Math.max(1, Math.min(50, Number(options.loanTermYears) || 30));
    const interestRate = Math.max(0, Number(options.interestRate) || 0);
    const startDate = options.loanStartDate || '2026-10';
    const extraMonthlyPrincipal = Math.max(0, Number(options.extraMonthlyPrincipal) || 0);

    // Property Tax (default: 1% of home price annually, represented as monthly)
    let monthlyTax = (homePrice * 0.01) / 12;
    if (options.monthlyPropertyTax !== null && options.monthlyPropertyTax !== undefined) {
      monthlyTax = Math.max(0, Number(options.monthlyPropertyTax));
    } else if (options.annualPropertyTax !== null && options.annualPropertyTax !== undefined) {
      monthlyTax = Math.max(0, Number(options.annualPropertyTax)) / 12;
    }

    // Homeowner's Insurance (default: 0.65% of home price annually, represented as monthly)
    let monthlyInsurance = (homePrice * 0.0065) / 12;
    if (options.monthlyInsurance !== null && options.monthlyInsurance !== undefined) {
      monthlyInsurance = Math.max(0, Number(options.monthlyInsurance));
    } else if (options.annualInsurance !== null && options.annualInsurance !== undefined) {
      monthlyInsurance = Math.max(0, Number(options.annualInsurance)) / 12;
    }

    // HOA monthly dues
    const monthlyHoa = Math.max(0, Number(options.monthlyHoa) || 0);

    // PMI Rate (annual % of original loan amount, default 0.85%)
    const pmiRate = Math.max(0, Number(options.pmiRate) || 0.85);

    const originalPrincipal = homePrice - downPayment;
    const scheduledMonthlyPI = calculateMonthlyPI(originalPrincipal, interestRate, termYears);
    const scheduledTotalMonths = termYears * 12;
    const monthlyRate = (interestRate / 100) / 12;

    // PMI applies only if LTV > 80% initially
    const pmiThresholdBalance = homePrice * 0.80;
    const initialLtv = homePrice > 0 ? (originalPrincipal / homePrice) * 100 : 0;
    const initialHasPmi = originalPrincipal > pmiThresholdBalance;
    const standardMonthlyPmi = initialHasPmi ? (originalPrincipal * (pmiRate / 100)) / 12 : 0;

    // Pass 1: Simulate the full month-by-month schedule to determine total interest over the life of the loan.
    // Also supports extra principal payments which can pay off the loan ahead of scheduledTotalMonths.
    let balance = originalPrincipal;
    let tempCumInterest = 0;
    let tempMonthsCount = 0;
    const simPayments = [];

    while (balance > 0.001 && tempMonthsCount < scheduledTotalMonths * 2) {
      tempMonthsCount++;
      const interestPayment = monthlyRate > 0 ? balance * monthlyRate : 0;
      let scheduledPrincipalPayment = scheduledMonthlyPI - interestPayment;
      if (scheduledPrincipalPayment < 0) scheduledPrincipalPayment = 0;

      let totalPrincipalPayment = scheduledPrincipalPayment + extraMonthlyPrincipal;
      if (totalPrincipalPayment > balance) {
        totalPrincipalPayment = balance;
      }

      balance -= totalPrincipalPayment;
      tempCumInterest += interestPayment;

      simPayments.push({
        interestPayment,
        principalPayment: totalPrincipalPayment,
        endBalance: Math.max(0, balance)
      });

      if (balance <= 0.001) break;
    }

    const totalEffectivePayments = simPayments.length;
    const totalInterestOverLife = tempCumInterest;

    // Baseline without extra payments for comparison
    let baselineTotalInterest = 0;
    if (extraMonthlyPrincipal > 0) {
      let baseBal = originalPrincipal;
      for (let m = 1; m <= scheduledTotalMonths; m++) {
        const intP = monthlyRate > 0 ? baseBal * monthlyRate : 0;
        let princP = scheduledMonthlyPI - intP;
        if (princP > baseBal) princP = baseBal;
        baseBal -= princP;
        baselineTotalInterest += intP;
        if (baseBal <= 0.001) break;
      }
    } else {
      baselineTotalInterest = totalInterestOverLife;
    }

    // Pass 2: Build detailed schedule with exact monthly granularity
    const monthlyRows = [];
    const annualRowsMap = new Map();
    let currentBalance = originalPrincipal;
    let runningCumInterest = 0;
    let runningCumPrincipal = 0;
    let pmiRemovalMonthIndex = null;
    let pmiRemovalDateStr = null;

    for (let i = 1; i <= totalEffectivePayments; i++) {
      const dateInfo = addMonthsToDate(startDate, i); // First payment is 1 month after start date
      const sim = simPayments[i - 1];

      const interestPayment = sim.interestPayment;
      const principalPayment = sim.principalPayment;
      currentBalance = sim.endBalance;

      runningCumInterest += interestPayment;
      runningCumPrincipal += principalPayment;

      const interestRemaining = Math.max(0, totalInterestOverLife - runningCumInterest);
      const principalRemaining = Math.max(0, currentBalance);
      const totalBalanceRemaining = principalRemaining + interestRemaining;

      const remainingMonths = totalEffectivePayments - i;
      let balanceInterestRate = 0;
      if (remainingMonths > 0 && principalRemaining > 0.01) {
        // Annualized simple interest rate over remaining duration
        balanceInterestRate = (interestRemaining / (principalRemaining * (remainingMonths / 12))) * 100;
      } else {
        balanceInterestRate = 0;
      }

      // Check PMI status for this month
      const pmiActive = initialHasPmi && (principalRemaining > pmiThresholdBalance);
      const currentMonthPmi = pmiActive ? standardMonthlyPmi : 0;
      if (initialHasPmi && !pmiActive && pmiRemovalMonthIndex === null) {
        pmiRemovalMonthIndex = i;
        pmiRemovalDateStr = dateInfo.label;
      }

      const totalMonthlyCost = scheduledMonthlyPI + extraMonthlyPrincipal + monthlyTax + monthlyInsurance + monthlyHoa + currentMonthPmi;

      const monthRow = {
        paymentNumber: i,
        dateIso: dateInfo.iso,
        dateLabel: dateInfo.label,
        yearNumber: Math.ceil(i / 12),
        calendarYear: dateInfo.year,
        calendarMonth: dateInfo.month,
        interestPaid: interestPayment,
        principalPaid: principalPayment,
        extraPrincipal: extraMonthlyPrincipal,
        scheduledPI: scheduledMonthlyPI,
        totalMonthlyPayment: totalMonthlyCost,
        cumulativeInterestPaid: runningCumInterest,
        cumulativePrincipalPaid: runningCumPrincipal,
        principalRemaining,
        interestRemaining,
        totalBalanceRemaining,
        balanceInterestRate,
        pmiActive,
        pmiAmount: currentMonthPmi,
        remainingMonths
      };

      monthlyRows.push(monthRow);

      // Group into Annual Rows
      const yearIdx = Math.ceil(i / 12);
      if (!annualRowsMap.has(yearIdx)) {
        annualRowsMap.set(yearIdx, {
          yearNumber: yearIdx,
          calendarYear: dateInfo.year,
          months: [],
          yearInterest: 0,
          yearPrincipal: 0,
          yearTotalPaid: 0,
          // End of year cumulative values will be updated
          cumulativeInterestPaid: 0,
          cumulativePrincipalPaid: 0,
          principalRemaining: 0,
          interestRemaining: 0,
          totalBalanceRemaining: 0,
          balanceInterestRate: 0,
          pmiActiveAny: false
        });
      }

      const yearGroup = annualRowsMap.get(yearIdx);
      yearGroup.months.push(monthRow);
      yearGroup.yearInterest += interestPayment;
      yearGroup.yearPrincipal += principalPayment;
      yearGroup.yearTotalPaid += totalMonthlyCost;
      yearGroup.cumulativeInterestPaid = runningCumInterest;
      yearGroup.cumulativePrincipalPaid = runningCumPrincipal;
      yearGroup.principalRemaining = principalRemaining;
      yearGroup.interestRemaining = interestRemaining;
      yearGroup.totalBalanceRemaining = totalBalanceRemaining;
      yearGroup.balanceInterestRate = balanceInterestRate;
      if (pmiActive) yearGroup.pmiActiveAny = true;
    }

    const annualRows = Array.from(annualRowsMap.values());

    // Summary calculations
    const monthlyPitiWithHoa = scheduledMonthlyPI + monthlyTax + monthlyInsurance + monthlyHoa + standardMonthlyPmi;
    const monthlyPitiExclPmi = scheduledMonthlyPI + monthlyTax + monthlyInsurance + monthlyHoa;
    const totalLoanCost = originalPrincipal + totalInterestOverLife;
    const totalPitiHoaOverLife = totalLoanCost +
      (monthlyTax * totalEffectivePayments) +
      (monthlyInsurance * totalEffectivePayments) +
      (monthlyHoa * totalEffectivePayments) +
      (standardMonthlyPmi * (pmiRemovalMonthIndex ? pmiRemovalMonthIndex - 1 : (initialHasPmi ? totalEffectivePayments : 0)));

    // Extra payment savings
    const monthsSaved = Math.max(0, scheduledTotalMonths - totalEffectivePayments);
    const yearsSaved = (monthsSaved / 12);
    const interestSavedDollars = Math.max(0, baselineTotalInterest - totalInterestOverLife);

    return {
      inputs: {
        homePrice,
        downPayment,
        termYears,
        interestRate,
        startDate,
        extraMonthlyPrincipal,
        monthlyPropertyTax: monthlyTax,
        monthlyInsurance: monthlyInsurance,
        annualPropertyTax: monthlyTax * 12,
        annualInsurance: monthlyInsurance * 12,
        monthlyHoa,
        pmiRate
      },
      summary: {
        originalPrincipal,
        downPaymentPct: homePrice > 0 ? (downPayment / homePrice) * 100 : 0,
        ltv: initialLtv,
        scheduledMonthlyPI,
        monthlyTax,
        monthlyInsurance,
        monthlyHoa,
        standardMonthlyPmi,
        initialHasPmi,
        monthlyPitiWithHoa,
        monthlyPitiExclPmi,
        totalInterestPaid: totalInterestOverLife,
        totalLoanCost,
        totalPitiHoaOverLife,
        totalEffectivePayments,
        scheduledTotalMonths,
        pmiRemovalMonthIndex,
        pmiRemovalDateStr: pmiRemovalDateStr || (initialHasPmi ? 'Never' : 'N/A (LTV <= 80%)'),
        monthsSaved,
        yearsSaved,
        interestSavedDollars
      },
      monthlyRows,
      annualRows
    };
  }

  /**
   * Helper to re-run scenario with partial parameter overrides.
   */
  function computeScenario(baseState, overrides) {
    const merged = Object.assign({}, baseState, overrides);
    return calculateAmortizationSchedule(merged);
  }

  // Export to window
  window.MortgageCalculator = {
    calculateMonthlyPI,
    calculateAmortizationSchedule,
    computeScenario,
    addMonthsToDate
  };
})();
