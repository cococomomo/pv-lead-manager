/**
 * Dachzeile aus dem Belegungsplan: Ost-West bei flacher Neigung oder Ost-West-Paaren.
 * Browser (global LayoutRoofLabel) und Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LayoutRoofLabel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isFreiflaeche(label) {
    const s = String(label || '').trim().toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
    return /freiflaeche|freiland|ground\s*mount|open\s*field/.test(s);
  }

  function pushTilt(list, value) {
    if (value == null || value === '') return;
    const n = Number(value);
    if (Number.isFinite(n)) list.push(n);
  }

  /** Kleinste gesetzte Neigung (Formular, Dächer, Module). */
  function layoutTiltDeg(input) {
    const tilts = [];
    const src = input || {};
    pushTilt(tilts, src.tilt);
    if (src.meta) pushTilt(tilts, src.meta.tilt);
    (Array.isArray(src.roofs) ? src.roofs : []).forEach((r) => {
      if (r) pushTilt(tilts, r.tilt);
    });
    (Array.isArray(src.modules) ? src.modules : []).forEach((m) => {
      if (m) pushTilt(tilts, m.tilt);
    });
    if (!tilts.length) return null;
    return Math.min.apply(null, tilts);
  }

  function layoutIsEastWest(input) {
    const src = input || {};
    if (src.eastWest === true) return true;
    const meta = src.meta || {};
    if (meta.autoOrient === 'eastwest') return true;
    const modules = Array.isArray(src.modules) ? src.modules : [];
    return modules.some((m) => m && m.eastWest);
  }

  /**
   * @param {string} baseLabel aktuelle Dachzeile (Ziegel, Flachdach, Freifläche, …)
   * @param {{ tilt?: number, eastWest?: boolean, modules?: object[], roofs?: object[], meta?: object }} input
   * @returns {string}
   */
  function roofLabelForLayout(baseLabel, input) {
    const base = String(baseLabel || '').trim();
    const tilt = layoutTiltDeg(input);
    const eastWest = layoutIsEastWest(input);
    const flatOrPairs = eastWest || (tilt != null && tilt < 3);
    if (!flatOrPairs) return base || 'Ziegel';
    if (isFreiflaeche(base)) return 'Freifläche Ost-West';
    return 'Flachdach Ost-West';
  }

  return {
    roofLabelForLayout,
    layoutTiltDeg,
    layoutIsEastWest,
  };
});
