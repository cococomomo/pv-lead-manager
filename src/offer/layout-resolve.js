'use strict';

/**
 * Resolves Belegungsplan(s) for offer PDF export.
 * Each Anlagenvariante may carry its own layoutPlanId — never reuse another
 * variant's plan via a shared lead-level fallback when a variant is explicit.
 */

const fs = require('fs');

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Prefer layoutPlanId from the active config / body, then the matching variant.
 * Returns { layoutPlanId, explicit: boolean }.
 * explicit=true means the client stated a plan (including null = no plan).
 */
function resolveActiveLayoutPlanId(body) {
  const b = body && typeof body === 'object' ? body : {};
  const cfg = b.config && typeof b.config === 'object' ? b.config : {};
  const variants = Array.isArray(b.variants) ? b.variants : [];

  if (Object.prototype.hasOwnProperty.call(cfg, 'layoutPlanId')) {
    return { layoutPlanId: numOrNull(cfg.layoutPlanId), explicit: true };
  }
  if (Object.prototype.hasOwnProperty.call(b, 'layoutPlanId') && b.layoutPlanId != null && b.layoutPlanId !== '') {
    return { layoutPlanId: numOrNull(b.layoutPlanId), explicit: true };
  }
  if (Object.prototype.hasOwnProperty.call(b, 'layoutPlanId') && (b.layoutPlanId === null || b.layoutPlanId === '')) {
    return { layoutPlanId: null, explicit: true };
  }

  // Match variant that equals active config (same layoutPlanId field if present)
  const cfgBrand = cfg.brand;
  const cfgMods = Number(cfg.moduleCount);
  let matched = null;
  for (const v of variants) {
    if (!v || typeof v !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(v, 'layoutPlanId') && numOrNull(v.layoutPlanId) === numOrNull(b.layoutPlanId) && b.layoutPlanId != null) {
      matched = v;
      break;
    }
  }
  if (!matched && variants.length === 1 && Object.prototype.hasOwnProperty.call(variants[0], 'layoutPlanId')) {
    matched = variants[0];
  }
  // Heuristic: variant with same brand + moduleCount as config
  if (!matched && cfgBrand && Number.isFinite(cfgMods)) {
    matched = variants.find((v) => v && v.brand === cfgBrand && Number(v.moduleCount) === cfgMods
      && Object.prototype.hasOwnProperty.call(v, 'layoutPlanId')) || null;
  }

  if (matched && Object.prototype.hasOwnProperty.call(matched, 'layoutPlanId')) {
    return { layoutPlanId: numOrNull(matched.layoutPlanId), explicit: true };
  }

  // Legacy: top-level layoutPlanId only
  if (b.layoutPlanId != null && b.layoutPlanId !== '') {
    return { layoutPlanId: numOrNull(b.layoutPlanId), explicit: true };
  }

  return { layoutPlanId: null, explicit: false };
}

/**
 * List every variant's layoutPlanId (for multi-variant PDF pages).
 * @returns {Array<{ index: number, label: string, layoutPlanId: number|null }>}
 */
function listVariantLayoutRefs(body) {
  const b = body && typeof body === 'object' ? body : {};
  const variants = Array.isArray(b.variants) ? b.variants : [];
  if (!variants.length) {
    const active = resolveActiveLayoutPlanId(b);
    return [{
      index: 0,
      label: 'Variante 1',
      layoutPlanId: active.layoutPlanId,
    }];
  }
  return variants.map((v, i) => ({
    index: i,
    label: (v && v.label) ? String(v.label) : `Variante ${i + 1}`,
    layoutPlanId: v && Object.prototype.hasOwnProperty.call(v, 'layoutPlanId')
      ? numOrNull(v.layoutPlanId)
      : null,
  }));
}

/**
 * Load plan JSON + optional snapshot path for one layout id.
 * Does not render ortho — caller may refresh snapshot.
 */
function loadLayoutAssets(persist, layoutPlanId) {
  const id = numOrNull(layoutPlanId);
  if (!id || !persist) {
    return { layoutPlanId: null, layoutPlan: null, layoutSnapshotAbs: null, layoutRow: null };
  }
  const layoutRow = persist.getLayout(id);
  const layoutPlan = layoutRow && layoutRow.plan ? layoutRow.plan : null;
  let layoutSnapshotAbs = persist.getLayoutSnapshotAbsPath(id);
  if (layoutSnapshotAbs && !fs.existsSync(layoutSnapshotAbs)) layoutSnapshotAbs = null;
  return { layoutPlanId: id, layoutPlan, layoutSnapshotAbs, layoutRow };
}

/**
 * Resolve the single Belegungsplan for the offer being exported (active variant).
 * Legacy lead-fallback only when no variant/config laid claim to a plan id.
 */
function resolveExportLayout(body, persist) {
  const b = body && typeof body === 'object' ? body : {};
  const { layoutPlanId: resolved, explicit } = resolveActiveLayoutPlanId(b);

  let layoutPlanId = resolved;
  if (!explicit && !layoutPlanId && b.leadId != null && persist) {
    try {
      const list = persist.listLayoutsForLead(Number(b.leadId));
      if (list && list[0]) layoutPlanId = Number(list[0].id);
    } catch (_) { /* ignore */ }
  }

  const assets = loadLayoutAssets(persist, layoutPlanId);
  return {
    ...assets,
    explicit,
    variantLayouts: listVariantLayoutRefs(b),
  };
}

module.exports = {
  resolveActiveLayoutPlanId,
  listVariantLayoutRefs,
  loadLayoutAssets,
  resolveExportLayout,
};
