'use strict';

/**
 * Ertrags- / Haushalts- / Wirtschaftlichkeitskennzahlen (Useini-Vorlage).
 * Overrides via body.economics / ertrag willkommen.
 */

const { formatEUR, formatNum } = require('./catalog');

const DEFAULTS = {
  householdKwhYear: 4500,
  gridPriceCt: 33,
  priceInflation: 0.03,
  feedInEur: 0.06,
  degradationPerYear: 0.005,
  analysisYears: 20,
};

/** Monatliche Anteile (AT typisch, Summe ≈ 1). */
const MONTHLY_SHARE = [
  0.035, 0.05, 0.075, 0.095, 0.115, 0.12,
  0.125, 0.115, 0.095, 0.07, 0.055, 0.05,
];
const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function computeEconomics(offer, overrides = {}) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  const cfg = (offer && offer.config) || {};
  const preis = (offer && offer.preis) || {};

  const kwp = num(cfg.kwpCalculated, num(cfg.kwp, 0)) || 0;
  const speicherKwh = num(cfg.speicher, 0) || 0;
  const hasStorage = speicherKwh > 0;
  const balance = o.balance && typeof o.balance === 'object' ? o.balance : null;
  const yieldAvailable = !!(balance && balance.available);

  const householdInput = num(o.householdKwhYear, num(o.jahresverbrauch, null));
  const household = yieldAvailable
    ? num(balance.household, householdInput != null ? householdInput : DEFAULTS.householdKwhYear)
    : (householdInput != null ? householdInput : DEFAULTS.householdKwhYear);
  const annualYield = yieldAvailable ? num(balance.annualYield, 0) : 0;
  const directToHome = yieldAvailable ? num(balance.direct, 0) : 0;
  const toStorage = yieldAvailable ? num(balance.charge, 0) : 0;
  const fromStorage = yieldAvailable ? num(balance.discharge, 0) : 0;
  const feedInKwh = yieldAvailable ? num(balance.feedIn, 0) : 0;
  const gridRemain = yieldAvailable ? num(balance.grid, 0) : 0;
  const selfConsumedBalanced = directToHome + fromStorage;
  const autarkyActual = yieldAvailable ? num(balance.autarky, household > 0 ? selfConsumedBalanced / household : 0) : null;
  const selfRateActual = yieldAvailable ? num(balance.selfConsumption, annualYield > 0 ? selfConsumedBalanced / annualYield : 0) : null;
  const yieldNote = (balance && balance.note) || (yieldAvailable
    ? ''
    : 'Die stündliche Ertragsberechnung (PVGIS-SARAH3) war nicht verfügbar und es liegt kein gespeicherter Datensatz für diese Gegend vor. Es wird kein pauschaler Jahresertrag angesetzt.');

  const gridPriceCt = num(o.gridPriceCt, num(o.strompreisCt, DEFAULTS.gridPriceCt));
  const gridPrice = num(o.gridPriceEur, gridPriceCt / 100);
  const inflation = pct(o.priceInflation) != null ? pct(o.priceInflation) : DEFAULTS.priceInflation;
  const feedIn = num(o.feedInEur, DEFAULTS.feedInEur);
  const years = Math.max(1, Math.round(num(o.analysisYears, DEFAULTS.analysisYears)));
  const degradation = num(o.degradationPerYear, DEFAULTS.degradationPerYear);

  const savingsYear1 = yieldAvailable ? (selfConsumedBalanced * gridPrice + feedInKwh * feedIn) : 0;
  const investment = num(o.investmentBrutto, num(preis.brutto, 0)) || 0;

  let cumulative = -investment;
  let paybackYears = null;
  let paybackYearLabel = null;
  const startYear = new Date().getFullYear();
  const yearly = [];
  for (let y = 1; y <= years; y += 1) {
    const degFactor = Math.pow(1 - degradation, y - 1);
    const priceFactor = Math.pow(1 + inflation, y - 1);
    const save = savingsYear1 * degFactor * priceFactor;
    cumulative += save;
    yearly.push({ year: y, calendarYear: startYear + y - 1, savings: save, cumulative });
    if (paybackYears == null && cumulative >= 0) {
      paybackYears = y;
      paybackYearLabel = startYear + y - 1;
    }
  }

  const monthly = (yieldAvailable && Array.isArray(balance.monthly) && balance.monthly.length === 12)
    ? balance.monthly.map((row, i) => ({
      month: row.month || MONTH_LABELS[i],
      kwh: Math.round(Number(row.kwh) || 0),
    }))
    : MONTH_LABELS.map((month) => ({ month, kwh: 0 }));

  const totalSavings = yearly.reduce((s, r) => s + r.savings, 0);

  const flowText = !yieldAvailable
    ? yieldNote
    : (hasStorage
      ? `Von Ihrer Photovoltaikanlage fließen ${formatNum(directToHome)} kWh direkt in Ihren Haushalt und ${formatNum(toStorage)} kWh in den Speicher. Der verbleibende Strom, also ${formatNum(feedInKwh)} kWh, wird in das Netz eingespeist. Aus Ihrem Speicher fließen ${formatNum(fromStorage)} kWh weiter in Ihren Haushalt. Insgesamt beziehen Sie ${formatNum(gridRemain)} kWh Ihres Haushaltsverbrauchs aus dem Netz.`
      : `Von Ihrer Photovoltaikanlage fließen ${formatNum(directToHome)} kWh direkt in Ihren Haushalt. Der verbleibende Strom, also ${formatNum(feedInKwh)} kWh, wird in das Netz eingespeist. Insgesamt beziehen Sie ${formatNum(gridRemain)} kWh Ihres Haushaltsverbrauchs aus dem Netz.`);

  return {
    kwp,
    speicherKwh,
    hasStorage,
    annualYield,
    household,
    selfRate: selfRateActual,
    autarky: autarkyActual,
    yieldAvailable,
    yieldNote,
    selfConsumed: selfConsumedBalanced,
    feedInKwh,
    gridRemain,
    directToHome,
    toStorage,
    fromStorage,
    gridPrice,
    gridPriceCt,
    inflation,
    feedIn,
    savingsYear1,
    investment,
    years,
    paybackYears,
    paybackYearLabel,
    totalSavings,
    yearly,
    monthly,
    flowText,
    source: (balance && balance.source) || 'unavailable',
    labels: {
      annualYield: yieldAvailable ? `${formatNum(Math.round(annualYield))} kWh` : '—',
      household: `${formatNum(Math.round(household))} kWh`,
      gridPriceCt: `${formatNum(gridPriceCt.toFixed ? Number(gridPriceCt).toFixed(2) : gridPriceCt)} ct/kWh`,
      inflation: `${formatNum((inflation * 100).toFixed(2))} % pro Jahr`,
      autarky: yieldAvailable ? `${formatNum(Math.round(autarkyActual * 100))} %` : '—',
      selfRate: yieldAvailable ? `${formatNum(Math.round(selfRateActual * 100))} %` : '—',
      totalSavings: `${formatNum(Math.round(totalSavings))} €`,
      payback: paybackYears != null ? `${paybackYears} Jahre` : '—',
      investment: formatEUR(investment),
      kwp: `${formatNum(Math.round(kwp * 100) / 100)} kWp`,
      speicher: hasStorage ? `${formatNum(speicherKwh)} kWh` : '—',
      peak: `${formatNum(Math.round(kwp * 100) / 100)} kW Peak`,
    },
  };
}

module.exports = {
  DEFAULTS,
  MONTHLY_SHARE,
  MONTH_LABELS,
  computeEconomics,
};
