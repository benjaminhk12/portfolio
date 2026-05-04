'use strict';

// ─── Financial calculations ───────────────────────────────────────────────────
function compoundValue(principal, annualRate, compound, fromDate, toDate, type, payment, termYears, paymentFreq) {
  const MS_YEAR = 365.25 * 24 * 3600 * 1000;
  const years = (toDate - fromDate) / MS_YEAR;
  if (years < 0) return principal;
  if (years === 0) return principal;

  if (type === 'investment') {
    // Base compound growth on principal
    let base;
    if (compound === 'continuous') {
      base = principal * Math.exp(annualRate * years);
    } else {
      const n = compound === 'monthly' ? 12 : compound === 'quarterly' ? 4 : 1;
      base = principal * Math.pow(1 + annualRate / n, n * years);
    }
    // Future value of regular contributions (ordinary annuity)
    if (payment && paymentFreq) {
      const r = annualRate / paymentFreq;
      const nPeriods = years * paymentFreq;
      base += r === 0
        ? payment * nPeriods
        : payment * (Math.pow(1 + r, nPeriods) - 1) / r;
    }
    return base;
  }

  // Loan – amortising with payment frequency
  const freq = paymentFreq || 12;
  const r = annualRate / freq;
  const nPeriods = years * freq;
  const N = (termYears || 30) * freq;
  if (r === 0) {
    const pmt = payment != null ? payment : principal / N;
    return Math.max(0, principal - pmt * nPeriods);
  }
  const pmt = payment != null ? payment : (principal * r * Math.pow(1+r, N)) / (Math.pow(1+r, N) - 1);
  const balance = principal * Math.pow(1+r, nPeriods) - pmt * (Math.pow(1+r, nPeriods) - 1) / r;
  return Math.max(0, balance);
}

// Returns the payment that should be considered "in force" at account creation.
// For loans with no explicit payment, this resolves to the auto-amortising payment
// based on original principal, original rate, and full term. This locks the value
// in so that "keep same repayment" on a later rate-change actually keeps it.
function getInitialPayment(acc) {
  if (acc.payment != null) return acc.payment;
  if (acc.type !== 'loan') return null;
  const freq = acc.paymentFreq || 12;
  const r = (acc.rate / 100) / freq;
  const N = (acc.term || 30) * freq;
  if (r === 0) return acc.principal / N;
  return (acc.principal * r * Math.pow(1 + r, N)) / (Math.pow(1 + r, N) - 1);
}

// Resolve the new payment amount after a rate-change event
function resolvePaymentAfterRateChange(kp, P, newR, pf, acc) {
  if (kp.paymentMode === 'set' && kp.newPayment != null) return kp.newPayment;
  if (kp.paymentMode === 'keep') return null; // signal: keep current
  // 'auto' (default): recalculate for remaining term
  const origEnd = new Date(acc.startDate + 'T00:00:00');
  origEnd.setFullYear(origEnd.getFullYear() + (acc.term || 30));
  const MS_YEAR = 365.25 * 24 * 3600 * 1000;
  const remainYears = Math.max(1/12, (origEnd - new Date(kp.date + 'T00:00:00')) / MS_YEAR);
  const freq = pf || 12, rr = newR / freq, N = Math.max(1, remainYears * freq);
  return rr === 0 ? P / N : (P * rr * Math.pow(1+rr, N)) / (Math.pow(1+rr, N) - 1);
}

function calcValue(acc, dateStr, withKeypoints) {
  const accStart = new Date(acc.startDate + 'T00:00:00');
  const target   = new Date(dateStr + 'T00:00:00');
  if (target < accStart) return null;

  const pf = acc.paymentFreq || null;

  if (!withKeypoints) {
    return compoundValue(acc.principal, acc.rate/100, acc.compound, accStart, target, acc.type, acc.payment, acc.term, pf);
  }

  const kps = [...acc.keypoints]
    .filter(k => k.date >= acc.startDate && k.date <= dateStr && k.type !== 'note')
    .sort((a, b) => a.date.localeCompare(b.date));

  let P = acc.principal, r = acc.rate/100, cpd = acc.compound, segStart = accStart;
  let currentPayment = getInitialPayment(acc); // tracks payment through rate changes

  for (const kp of kps) {
    const kpDate = new Date(kp.date + 'T00:00:00');
    if (kpDate <= segStart) continue;
    const valAtKp = compoundValue(P, r, cpd, segStart, kpDate, acc.type, currentPayment, acc.term, pf);
    if (kp.type === 'rate_change') {
      const newR = kp.value / 100;
      const resolved = resolvePaymentAfterRateChange(kp, valAtKp, newR, pf, acc);
      if (resolved !== null) currentPayment = resolved;
      // 'keep': currentPayment unchanged
      P = valAtKp; r = newR; segStart = kpDate;
    } else if (kp.type === 'extra_payment') {
      P = Math.max(0, valAtKp - kp.value); segStart = kpDate;
    } else if (kp.type === 'lump_sum') {
      P = valAtKp + kp.value; segStart = kpDate;
    } else if (kp.type === 'payment_change') {
      currentPayment = kp.value; P = valAtKp; segStart = kpDate;
    }
  }

  return compoundValue(P, r, cpd, segStart, target, acc.type, currentPayment, acc.term, pf);
}

// Returns the {P, r, segStart, currentPayment} state active just before sortedKps[idx]
function getPreEventState(acc, sortedKps, idx) {
  let P = acc.principal, r = acc.rate/100, segStart = new Date(acc.startDate + 'T00:00:00');
  let currentPayment = getInitialPayment(acc);
  const pf = acc.paymentFreq || null;
  for (let i = 0; i < idx; i++) {
    const kp = sortedKps[i];
    if (kp.type === 'note') continue;
    const kpDate = new Date(kp.date + 'T00:00:00');
    if (kpDate <= segStart) continue;
    const val = compoundValue(P, r, acc.compound, segStart, kpDate, acc.type, currentPayment, acc.term, pf);
    if (kp.type === 'rate_change') {
      const newR = kp.value / 100;
      const resolved = resolvePaymentAfterRateChange(kp, val, newR, pf, acc);
      if (resolved !== null) currentPayment = resolved;
      P = val; r = newR; segStart = kpDate;
    } else if (kp.type === 'extra_payment') { P = Math.max(0, val - kp.value); segStart = kpDate; }
    else if (kp.type === 'lump_sum')        { P = val + kp.value; segStart = kpDate; }
    else if (kp.type === 'payment_change')  { currentPayment = kp.value; P = val; segStart = kpDate; }
  }
  return { P, r, segStart, currentPayment };
}

// Returns the effective current payment for a position as of today
function getEffectivePayment(acc) {
  const today = new Date().toISOString().slice(0,10);
  const kps = [...acc.keypoints].filter(k => k.date <= today && k.type !== 'note').sort((a,b) => a.date.localeCompare(b.date));
  let P = acc.principal, r = acc.rate/100, segStart = new Date(acc.startDate+'T00:00:00');
  let currentPayment = getInitialPayment(acc);
  const pf = acc.paymentFreq || null;
  for (const kp of kps) {
    const kpDate = new Date(kp.date+'T00:00:00');
    if (kpDate <= segStart) continue;
    const val = compoundValue(P, r, acc.compound, segStart, kpDate, acc.type, currentPayment, acc.term, pf);
    if (kp.type === 'rate_change') {
      const newR = kp.value/100;
      const resolved = resolvePaymentAfterRateChange(kp, val, newR, pf, acc);
      if (resolved !== null) currentPayment = resolved;
      P = val; r = newR; segStart = kpDate;
    } else if (kp.type === 'extra_payment') { P = Math.max(0, val - kp.value); segStart = kpDate; }
    else if (kp.type === 'lump_sum')        { P = val + kp.value; segStart = kpDate; }
    else if (kp.type === 'payment_change')  { currentPayment = kp.value; P = val; segStart = kpDate; }
  }
  return currentPayment;
}
