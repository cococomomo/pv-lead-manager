'use strict';

/**
 * Ertrags- / Haushalts- / Wirtschaftlichkeitskennzahlen (Useini-Vorlage).
 * Overrides via body.economics / ertrag willkommen.
 */

const { formatEUR, formatNum } = require('./catalog');

const DEFAULTS = {
  specificYieldKwhPerKwp: 1050,
  householdKwhYear: 4200,
  gridPriceCt: 33,
  priceInflation: 0.03,
  selfConsumptionNoStorage: 0.30,
  selfConsumptionWithStorage: 0.59,
  autarkyNoStorage: 0.35,
  autarkyWithStorage: 0.69,
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

  const specificYield = num(o.specificYieldKwhPerKwp, DEFAULTS.specificYieldKwhPerKwp);
  const annualYield = num(o.annualYieldKwh, Math.round(kwp * specificYield));
  const household = num(o.householdKwhYear, num(o.jahresverbrauch, DEFAULTS.householdKwhYear));
  const selfRate = pct(o.selfConsumptionRate) != null
    ? pct(o.selfConsumptionRate)
    : (hasStorage ? DEFAULTS.selfConsumptionWithStorage : DEFAULTS.selfConsumptionNoStorage);
  const autarky = pct(o.autarkyRate) != null
    ? pct(o.autarkyRate)
    : (hasStorage ? DEFAULTS.autarkyWithStorage : DEFAULTS.autarkyNoStorage);

  const gridPriceCt = num(o.gridPriceCt, num(o.strompreisCt, DEFAULTS.gridPriceCt));
  const gridPrice = num(o.gridPriceEur, gridPriceCt / 100);
  const inflation = pct(o.priceInflation) != null ? pct(o.priceInflation) : DEFAULTS.priceInflation;
  const feedIn = num(o.feedInEur, DEFAULTS.feedInEur);
  const years = Math.max(1, Math.round(num(o.analysisYears, DEFAULTS.analysisYears)));
  const degradation = num(o.degradationPerYear, DEFAULTS.degradationPerYear);

  // Energy-balance (kWh/a) for Sankey — respect both Autarkie- and Eigenverbrauchsziele.
  // selfConsumed ≤ min(Haushalt·Autarkie, Ertrag·Eigenverbrauch, Haushalt, Ertrag)
  const selfConsumed = Math.round(Math.min(
    household * autarky,
    annualYield * selfRate,
    household,
    annualYield,
  ));
  let toStorage = 0;
  let fromStorage = 0;
  let directToHome = selfConsumed;
  if (hasStorage && selfConsumed > 0) {
    // ~half of self-consumed solar arrives via battery (round-trip ~90 %).
    fromStorage = Math.round(selfConsumed * 0.45);
    toStorage = Math.round(fromStorage / 0.9);
    directToHome = Math.max(0, selfConsumed - fromStorage);
  }
  // PV = Direktverbrauch + Speicherladung + Einspeisung
  const feedInKwh = Math.max(0, Math.round(annualYield - directToHome - toStorage));
  // Household = Direkt + aus Speicher + Netzbezug
  const gridRemain = Math.max(0, Math.round(household - directToHome - fromStorage));
  const selfConsumedBalanced = directToHome + fromStorage;
  // Display rates from the closed balance (matches diagram + copy)
  const autarkyActual = household > 0 ? selfConsumedBalanced / household : autarky;
  const selfRateActual = annualYield > 0 ? selfConsumedBalanced / annualYield : selfRate;

  const savingsYear1 = selfConsumedBalanced * gridPrice + feedInKwh * feedIn;
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

  const monthly = MONTHLY_SHARE.map((share, i) => ({
    month: MONTH_LABELS[i],
    kwh: Math.round(annualYield * share),
  }));

  const totalSavings = yearly.reduce((s, r) => s + r.savings, 0);

  const flowText = hasStorage
    ? `Von Ihrer Photovoltaikanlage fließen ${formatNum(directToHome)} kWh direkt in Ihren Haushalt und ${formatNum(toStorage)} kWh in den Speicher. Der verbleibende Strom, also ${formatNum(feedInKwh)} kWh, wird in das Netz eingespeist. Aus Ihrem Speicher fließen ${formatNum(fromStorage)} kWh weiter in Ihren Haushalt. Insgesamt beziehen Sie ${formatNum(gridRemain)} kWh Ihres Haushaltsverbrauchs aus dem Netz.`
    : `Von Ihrer Photovoltaikanlage fließen ${formatNum(directToHome)} kWh direkt in Ihren Haushalt. Der verbleibende Strom, also ${formatNum(feedInKwh)} kWh, wird in das Netz eingespeist. Insgesamt beziehen Sie ${formatNum(gridRemain)} kWh Ihres Haushaltsverbrauchs aus dem Netz.`;

  return {
    kwp,
    speicherKwh,
    hasStorage,
    specificYield,
    annualYield,
    household,
    selfRate: selfRateActual,
    autarky: autarkyActual,
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
    source: o.source || (o.annualYieldKwh != null ? 'override' : 'estimate'),
    labels: {
      annualYield: `${formatNum(Math.round(annualYield))} kWh`,
      household: `${formatNum(Math.round(household))} kWh`,
      gridPriceCt: `${formatNum(gridPriceCt.toFixed ? Number(gridPriceCt).toFixed(2) : gridPriceCt)} ct/kWh`,
      inflation: `${formatNum((inflation * 100).toFixed(2))} % pro Jahr`,
      autarky: `${formatNum(Math.round(autarkyActual * 100))} %`,
      selfRate: `${formatNum(Math.round(selfRateActual * 100))} %`,
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
