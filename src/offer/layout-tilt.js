/**
 * Neigung / Ertrags-Hilfen für Belegungspläne (Multi-Dach, Multi-Tilt).
 * Rein datenorientiert – kein DOM. Wird vom Layout-Editor gespiegelt
 * (LayoutEditor.resolveModuleTiltForYield / summarizeLayoutTilts).
 */

function deg2rad(d) {
  return (d * Math.PI) / 180;
}

function makeProjector(lat0, lng0) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(deg2rad(lat0));
  return {
    toXY(lat, lng) {
      return { x: (lng - lng0) * mPerDegLng, y: (lat - lat0) * mPerDegLat };
    },
  };
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y))
      && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Effektive Modul-Neigung: Modulwert → Dachfläche am Zentrum → plan.meta.
 */
function resolveModuleTiltForYield(module, roofs, planMeta) {
  const meta = planMeta || {};
  const fallback = meta.tilt != null && Number.isFinite(Number(meta.tilt)) ? Number(meta.tilt) : 30;
  if (!module) return { tilt: fallback, tiltCross: Number(meta.tiltCross) || 0, source: 'meta' };
  if (module.tilt != null && Number.isFinite(Number(module.tilt))) {
    return {
      tilt: Number(module.tilt),
      tiltCross: module.tiltCross != null ? Number(module.tiltCross) : (Number(meta.tiltCross) || 0),
      source: 'module',
    };
  }
  const list = Array.isArray(roofs) ? roofs : [];
  if (list.length && module.lat != null && module.lng != null) {
    const valid = list.filter((r) => r && r.ring && r.ring.length >= 3);
    if (valid.length) {
      let lat0 = 0;
      let lng0 = 0;
      valid.forEach((r) => {
        lat0 += r.ring.reduce((a, p) => a + p.lat, 0) / r.ring.length;
        lng0 += r.ring.reduce((a, p) => a + p.lng, 0) / r.ring.length;
      });
      lat0 /= valid.length;
      lng0 /= valid.length;
      const proj = makeProjector(lat0, lng0);
      const c = proj.toXY(module.lat, module.lng);
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r || !r.ring || r.ring.length < 3) continue;
        const pts = r.ring.map((p) => proj.toXY(p.lat, p.lng));
        if (pointInPoly(c, pts)) {
          const t = r.tilt != null && Number.isFinite(Number(r.tilt)) ? Number(r.tilt) : fallback;
          return {
            tilt: t,
            tiltCross: Number(meta.tiltCross) || 0,
            source: 'roof',
            roofIndex: i,
          };
        }
      }
    }
  }
  return {
    tilt: fallback,
    tiltCross: Number(meta.tiltCross) || 0,
    source: 'meta',
  };
}

/** Aggregiert Module nach Neigung (Multi-Dach-Ertragsrechnung / Audit). */
function summarizeLayoutTilts(plan) {
  const p = plan || {};
  const meta = p.meta || {};
  const roofs = Array.isArray(p.roofs) && p.roofs.length
    ? p.roofs
    : (p.roof && p.roof.length >= 3
      ? [{ ring: p.roof, tilt: meta.tilt != null ? meta.tilt : 30 }]
      : []);
  const modules = Array.isArray(p.modules) ? p.modules : [];
  const byTilt = new Map();
  const rows = modules.map((m, index) => {
    const resolved = resolveModuleTiltForYield(m, roofs, meta);
    const key = resolved.tilt.toFixed(2);
    const prev = byTilt.get(key) || { tilt: resolved.tilt, count: 0, sources: {} };
    prev.count += 1;
    prev.sources[resolved.source] = (prev.sources[resolved.source] || 0) + 1;
    byTilt.set(key, prev);
    return { index, tilt: resolved.tilt, tiltCross: resolved.tiltCross, source: resolved.source };
  });
  return {
    moduleCount: modules.length,
    roofCount: roofs.length,
    distinctTilts: Array.from(byTilt.values()).sort((a, b) => a.tilt - b.tilt),
    modules: rows,
  };
}

/**
 * Projizierte Modul-Grundfläche (wie im Editor) – für Größen-Integritätstests.
 */
function projectedModuleFootprint(widthM, heightM, tiltUpslopeDeg, tiltCrossDeg, landscape) {
  const alongEave = landscape ? heightM : widthM;
  const alongSlope = landscape ? widthM : heightM;
  const cosY = Math.cos(deg2rad(Number(tiltUpslopeDeg) || 0));
  const cosX = Math.cos(deg2rad(Number(tiltCrossDeg) || 0));
  return {
    alongEave,
    alongSlope,
    widthM: alongEave * cosX,
    heightM: alongSlope * cosY,
  };
}

function syncModuleProjectedSize(m, opts) {
  if (!m) return m;
  const o = opts || {};
  let tilt;
  if (o.tilt != null && Number.isFinite(Number(o.tilt))) tilt = Number(o.tilt);
  else if (m.tilt != null && Number.isFinite(Number(m.tilt))) tilt = Number(m.tilt);
  else if (o.fallbackTilt != null && Number.isFinite(Number(o.fallbackTilt))) tilt = Number(o.fallbackTilt);
  else tilt = 0;

  let tiltCross;
  if (o.tiltCross != null && Number.isFinite(Number(o.tiltCross))) tiltCross = Number(o.tiltCross);
  else if (m.tiltCross != null && Number.isFinite(Number(m.tiltCross))) tiltCross = Number(m.tiltCross);
  else if (o.fallbackTiltCross != null && Number.isFinite(Number(o.fallbackTiltCross))) {
    tiltCross = Number(o.fallbackTiltCross);
  } else tiltCross = 0;

  const physW = Number(m.physWidthM != null ? m.physWidthM : m.widthM) || 1.134;
  const physH = Number(m.physHeightM != null ? m.physHeightM : m.heightM) || 1.8;
  m.physWidthM = physW;
  m.physHeightM = physH;
  m.tilt = tilt;
  m.tiltCross = tiltCross;
  m.widthM = physW * Math.cos(deg2rad(tiltCross));
  m.heightM = physH * Math.cos(deg2rad(tilt));
  return m;
}

module.exports = {
  resolveModuleTiltForYield,
  summarizeLayoutTilts,
  projectedModuleFootprint,
  syncModuleProjectedSize,
};
