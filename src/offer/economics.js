'use strict';

/**
 * Ertrags- / Haushaltsenergie- / Wirtschaftlichkeitskennzahlen für Angebots-PDF.
 * Akzeptiert optionale Override-Felder (z. B. von Ertragsrechnung-Sibling);
 * sonst konservative AT-Schätzwerte aus Anlagenkonfiguration.
 */

const { formatEUR, formatNum } = require('./catalog');

const DEFAULTS = {
  specificYieldKwhPerKwp: 1050, // Wien / Ostösterreich, leicht konservativ
  householdKwhYear: 4200,
  gridPriceEur: 0.32,
  feedInEur: 0.06,
  selfConsumptionNoStorage: 0.30,
  selfConsumptionWithStorage: 0.65,
  degradationPerYear: 0.005,
  analysisYears: 25,
};

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

/**
 * @param {object} offer  Ergebnis von computeOffer()
 * @param {object} [overrides]  body.economics / body.ertrag / texts.economics
 */
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
  const gridPrice = num(o.gridPriceEur, DEFAULTS.gridPriceEur);
  const feedIn = num(o.feedInEur, DEFAULTS.feedInEur);
  const years = Math.max(1, Math.round(num(o.analysisYears, DEFAULTS.analysisYears)));
  const degradation = num(o.degradationPerYear, DEFAULTS.degradationPerYear);

  const selfConsumed = Math.min(annualYield * selfRate, household);
  const feedInKwh = Math.max(0, annualYield - selfConsumed);
  const gridRemain = Math.max(0, household - selfConsumed);
  const autarky = household > 0 ? Math.min(1, selfConsumed / household) : 0;

  const savingsYear1 = selfConsumed * gridPrice + feedInKwh * feedIn;
  const costWithout = household * gridPrice;
  const costWith = gridRemain * gridPrice - feedInKwh * feedIn;
  const investment = num(o.investmentBrutto, num(preis.brutto, 0)) || 0;

  let cumulative = 0;
  let paybackYears = null;
  const yearly = [];
  for (let y = 1; y <= years; y += 1) {
    const factor = Math.pow(1 - degradation, y - 1);
    const save = savingsYear1 * factor;
    cumulative += save;
    yearly.push({ year: y, savings: save, cumulative });
    if (paybackYears == null && investment > 0 && cumulative >= investment) {
      paybackYears = y;
    }
  }

  const totalSavings = cumulative;
  const netGain = totalSavings - investment;

  return {
    kwp,
    speicherKwh,
    hasStorage,
    specificYield,
    annualYield,
    household,
    selfRate,
    selfConsumed: Math.round(selfConsumed),
    feedInKwh: Math.round(feedInKwh),
    gridRemain: Math.round(gridRemain),
    autarky,
    gridPrice,
    feedIn,
    savingsYear1,
    costWithout,
    costWith,
    investment,
    years,
    paybackYears,
    totalSavings,
    netGain,
    yearly,
    source: o.source || (o.annualYieldKwh != null ? 'override' : 'estimate'),
    labels: {
      annualYield: `${formatNum(Math.round(annualYield))} kWh / Jahr`,
      specificYield: `${formatNum(specificYield)} kWh / kWp`,
      household: `${formatNum(Math.round(household))} kWh / Jahr`,
      selfConsumed: `${formatNum(Math.round(selfConsumed))} kWh`,
      feedInKwh: `${formatNum(Math.round(feedInKwh))} kWh`,
      gridRemain: `${formatNum(Math.round(gridRemain))} kWh`,
      autarky: `${formatNum(Math.round(autarky * 100))} %`,
      selfRate: `${formatNum(Math.round(selfRate * 100))} %`,
      savingsYear1: formatEUR(savingsYear1),
      costWithout: formatEUR(costWithout),
      costWith: formatEUR(Math.max(0, costWith)),
      investment: formatEUR(investment),
      totalSavings: formatEUR(totalSavings),
      netGain: formatEUR(netGain),
      payback: paybackYears != null ? `ca. ${paybackYears} Jahre` : 'außerhalb Betrachtungszeitraum',
      gridPrice: `${formatNum(gridPrice)} € / kWh`,
      feedIn: `${formatNum(feedIn)} € / kWh`,
    },
  };
}

module.exports = {
  DEFAULTS,
  computeEconomics,
};
