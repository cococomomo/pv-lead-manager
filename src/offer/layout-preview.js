'use strict';

/**
 * Zeichnet einen Belegungsplan (Dachflächen + Module + Neigungspfeile)
 * direkt in ein PDFKit-Dokument – Fallback, wenn kein Snapshot-PNG existiert.
 */

function deg2rad(d) {
  return (Number(d) * Math.PI) / 180;
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

function rotatePoint(p, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function moduleCorners(m, proj) {
  const c = proj.toXY(m.lat, m.lng);
  const angle = deg2rad(m.azimuth || 0);
  const hw = (Number(m.widthM) || 1) / 2;
  const hh = (Number(m.heightM) || 1) / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const r = rotatePoint(p, angle);
    return { x: c.x + r.x, y: c.y + r.y };
  });
}

function collectPoints(plan) {
  const pts = [];
  const roofs = Array.isArray(plan.roofs) ? plan.roofs : [];
  roofs.forEach((r) => {
    (r.ring || []).forEach((p) => pts.push(p));
  });
  if ((!roofs.length || !pts.length) && Array.isArray(plan.roof)) {
    plan.roof.forEach((p) => pts.push(p));
  }
  (plan.obstacles || []).forEach((ring) => {
    (ring || []).forEach((p) => pts.push(p));
  });
  (plan.modules || []).forEach((m) => {
    if (m && m.lat != null) pts.push({ lat: m.lat, lng: m.lng });
  });
  return pts;
}

function roofEaveDir(ring, proj) {
  if (!ring || ring.length < 2) return { x: 0, y: -1 };
  const p0 = proj.toXY(ring[0].lat, ring[0].lng);
  const p1 = proj.toXY(ring[1].lat, ring[1].lng);
  const edx = p1.x - p0.x;
  const edy = p1.y - p0.y;
  const elen = Math.hypot(edx, edy) || 1;
  const ex = edx / elen;
  const ey = edy / elen;
  // Normale; Orientierung grob über Polygonzentrum
  let nx = -ey;
  let ny = ex;
  let cx = 0;
  let cy = 0;
  const xy = ring.map((p) => proj.toXY(p.lat, p.lng));
  xy.forEach((p) => { cx += p.x; cy += p.y; });
  cx /= xy.length;
  cy /= xy.length;
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const toCenterX = cx - mid.x;
  const toCenterY = cy - mid.y;
  if (nx * toCenterX + ny * toCenterY < 0) {
    nx = -nx;
    ny = -ny;
  }
  // zur Traufe = vom Inneren zur Kante
  return { x: -nx, y: -ny };
}

function arrowLenFromTilt(tiltDeg, refM) {
  const t = Math.max(0, Math.min(75, Number(tiltDeg) || 0));
  const ref = Math.max(0.2, Number(refM) || 0.5);
  return ref * (0.22 + 0.78 * Math.min(1, t / 60));
}

/**
 * @returns {{ drawn: boolean, height: number }}
 */
function drawLayoutPreview(doc, plan, box) {
  const x0 = box.x;
  const y0 = box.y;
  const w = box.width;
  const h = box.height;
  const planObj = plan && typeof plan === 'object' ? plan : null;
  if (!planObj) return { drawn: false, height: 0 };

  const pts = collectPoints(planObj);
  if (pts.length < 2) return { drawn: false, height: 0 };

  let lat0 = 0;
  let lng0 = 0;
  pts.forEach((p) => { lat0 += p.lat; lng0 += p.lng; });
  lat0 /= pts.length;
  lng0 /= pts.length;
  const proj = makeProjector(lat0, lng0);

  const roofs = Array.isArray(planObj.roofs) && planObj.roofs.length
    ? planObj.roofs
    : (planObj.roof ? [{ ring: planObj.roof, tilt: (planObj.meta && planObj.meta.tilt) || 30 }] : []);
  const obstacles = planObj.obstacles || [];
  const modules = planObj.modules || [];

  const allXY = [];
  roofs.forEach((r) => (r.ring || []).forEach((p) => allXY.push(proj.toXY(p.lat, p.lng))));
  obstacles.forEach((ring) => (ring || []).forEach((p) => allXY.push(proj.toXY(p.lat, p.lng))));
  modules.forEach((m) => {
    moduleCorners(m, proj).forEach((c) => allXY.push(c));
  });
  if (!allXY.length) return { drawn: false, height: 0 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  allXY.forEach((p) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  const pad = Math.max(1.2, (maxX - minX) * 0.08, (maxY - minY) * 0.08);
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min(w / spanX, h / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const ox = x0 + (w - drawW) / 2;
  const oy = y0 + (h - drawH) / 2;

  function toPage(p) {
    // Y in Metern nach Norden positiv → PDF Y nach unten
    return {
      x: ox + (p.x - minX) * scale,
      y: oy + (maxY - p.y) * scale,
    };
  }

  function pathRing(ring) {
    if (!ring || ring.length < 2) return;
    const first = toPage(proj.toXY(ring[0].lat, ring[0].lng));
    doc.moveTo(first.x, first.y);
    for (let i = 1; i < ring.length; i += 1) {
      const p = toPage(proj.toXY(ring[i].lat, ring[i].lng));
      doc.lineTo(p.x, p.y);
    }
    doc.closePath();
  }

  // Hintergrund (Orthofoto-Ersatz)
  doc.save();
  doc.roundedRect(x0, y0, w, h, 6).fill('#d8dce2');
  doc.roundedRect(x0, y0, w, h, 6).clip();

  // dezentes Raster
  doc.strokeColor('#c5cad1').lineWidth(0.4);
  for (let gx = 0; gx < w; gx += 18) {
    doc.moveTo(x0 + gx, y0).lineTo(x0 + gx, y0 + h).stroke();
  }
  for (let gy = 0; gy < h; gy += 18) {
    doc.moveTo(x0, y0 + gy).lineTo(x0 + w, y0 + gy).stroke();
  }

  // Dachflächen
  roofs.forEach((roof) => {
    const ring = roof.ring || [];
    if (ring.length < 3) return;
    pathRing(ring);
    doc.fillColor('#3b82f6').fillOpacity(0.28).fill();
    pathRing(ring);
    doc.strokeColor('#1d4ed8').lineWidth(1.6).strokeOpacity(1).stroke();
  });

  // Sperrzonen
  obstacles.forEach((ring) => {
    if (!ring || ring.length < 3) return;
    pathRing(ring);
    doc.fillColor('#ef4444').fillOpacity(0.35).fill();
    pathRing(ring);
    doc.strokeColor('#b91c1c').lineWidth(1.2).strokeOpacity(1).stroke();
  });

  // Module
  modules.forEach((m) => {
    const corners = moduleCorners(m, proj).map(toPage);
    if (corners.length < 3) return;
    doc.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) doc.lineTo(corners[i].x, corners[i].y);
    doc.closePath();
    doc.fillColor('#60a5fa').fillOpacity(0.85).fill();
    doc.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) doc.lineTo(corners[i].x, corners[i].y);
    doc.closePath();
    doc.strokeColor('#1e40af').lineWidth(0.7).strokeOpacity(1).stroke();

    // Neigungspfeil
    const tilt = m.tilt != null ? Number(m.tilt) : ((planObj.meta && planObj.meta.tilt) || 30);
    const ref = Math.min(Number(m.widthM) || 1, Number(m.heightM) || 1);
    const lenM = arrowLenFromTilt(tilt, ref * 0.7);
    let ux = 0;
    let uy = -1;
    for (const roof of roofs) {
      const ring = roof.ring || [];
      if (ring.length < 3) continue;
      const dir = roofEaveDir(ring, proj);
      ux = dir.x;
      uy = dir.y;
      break;
    }
    if (!roofs.length) {
      const a = deg2rad(m.azimuth || 0);
      ux = -Math.sin(a);
      uy = Math.cos(a);
    }
    const c = proj.toXY(m.lat, m.lng);
    const base = toPage({ x: c.x - ux * lenM * 0.5, y: c.y - uy * lenM * 0.5 });
    const tip = toPage({ x: c.x + ux * lenM * 0.5, y: c.y + uy * lenM * 0.5 });
    doc.strokeColor('#e879a9').lineWidth(1.4).strokeOpacity(0.95);
    doc.moveTo(base.x, base.y).lineTo(tip.x, tip.y).stroke();
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const al = Math.hypot(dx, dy) || 1;
    const hx = (-dy / al) * 3.2;
    const hy = (dx / al) * 3.2;
    const bx = tip.x - (dx / al) * 5.5;
    const by = tip.y - (dy / al) * 5.5;
    doc.moveTo(tip.x, tip.y).lineTo(bx + hx, by + hy).lineTo(bx - hx, by - hy).closePath();
    doc.fillColor('#e879a9').fillOpacity(0.95).fill();
  });

  doc.restore();

  // Rahmen
  doc.roundedRect(x0, y0, w, h, 6).strokeColor('#c5cad1').lineWidth(0.8).stroke();

  const n = modules.length;
  doc.font('Helvetica').fontSize(8).fillColor('#8a8a8a')
    .text(`Belegungsplan · ${n} Modul${n === 1 ? '' : 'e'}`, x0, y0 + h + 4, { width: w, align: 'left' });

  return { drawn: true, height: h + 16 };
}

module.exports = {
  drawLayoutPreview,
  collectPoints,
};
