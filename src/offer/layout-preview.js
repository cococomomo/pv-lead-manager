'use strict';

/**
 * Zeichnet einen Belegungsplan (Dachumriss + Module)
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

  // Hintergrund (Orthofoto-ähnlich: weiches Grün/Beige, kein hartes Raster)
  doc.save();
  doc.roundedRect(x0, y0, w, h, 6).fill('#c9d4c0');
  doc.roundedRect(x0, y0, w, h, 6).clip();
  // leichte Geländevariation
  doc.fillColor('#b7c6a8').fillOpacity(0.45);
  doc.circle(x0 + w * 0.22, y0 + h * 0.3, Math.min(w, h) * 0.28).fill();
  doc.fillColor('#d6cbb6').fillOpacity(0.35);
  doc.circle(x0 + w * 0.72, y0 + h * 0.62, Math.min(w, h) * 0.34).fill();
  doc.fillOpacity(1);

  // Dachumriss dünn hellblau, ohne Fläche
  roofs.forEach((roof) => {
    const ring = roof.ring || [];
    if (ring.length < 3) return;
    pathRing(ring);
    doc.strokeColor('#7eb6e8').lineWidth(0.4).strokeOpacity(0.95).stroke();
  });

  // Sperrzonen
  obstacles.forEach((ring) => {
    if (!ring || ring.length < 3) return;
    pathRing(ring);
    doc.fillColor('#fca5a5').fillOpacity(0.22).fill();
    pathRing(ring);
    doc.strokeColor('#b91c1c').lineWidth(0.55).strokeOpacity(0.85).stroke();
  });

  // Module schwarz; 2px helle Fuge erst nach allen Flächen, sonst verschwindet die gemeinsame Kante.
  const modulePolys = [];
  modules.forEach((m) => {
    const corners = moduleCorners(m, proj).map(toPage);
    if (corners.length >= 3) modulePolys.push(corners);
  });
  modulePolys.forEach((corners) => {
    doc.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) doc.lineTo(corners[i].x, corners[i].y);
    doc.closePath();
    doc.fillColor('#000000').fillOpacity(1).fill();
  });
  modulePolys.forEach((corners) => {
    doc.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) doc.lineTo(corners[i].x, corners[i].y);
    doc.closePath();
    doc.strokeColor('#f3f3f3').lineWidth(2).strokeOpacity(1).stroke();
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
