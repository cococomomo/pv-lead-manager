'use strict';

/**
 * Ost-West-Flachdach: Querformat, Neigung 10°, lange Seite entlang der Reihe.
 * Die zwei Module eines Paares treffen sich an der langen Kante (2 cm),
 * danach 20 cm bis zum nächsten Paar. Entlang der kurzen Kante überall 2 cm.
 * Gegenüberliegende Blickrichtung, beide 10°.
 * Dieselbe Teilung wie public/layout-editor.js (autoLayoutModules eastWest).
 */

const PAIR_INNER_M = 0.02;
const PAIR_PITCH_M = 0.20;
const ROW_GAP_M = 0.02;
const TILT_DEG = 10;

function deg2rad(d) {
  return (Number(d) * Math.PI) / 180;
}

function norm360(d) {
  const x = Number(d) % 360;
  return x < 0 ? x + 360 : x;
}

function makeProjector(lat0, lng0) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(deg2rad(lat0));
  return {
    toXY(lat, lng) {
      return { x: (lng - lng0) * mPerDegLng, y: (lat - lat0) * mPerDegLat };
    },
    toLatLng(x, y) {
      return { lat: lat0 + y / mPerDegLat, lng: lng0 + x / mPerDegLng };
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

function firstEdgeOrientation(ring) {
  const a = ring[0];
  const b = ring[1];
  const proj = makeProjector(a.lat, a.lng);
  const p0 = proj.toXY(a.lat, a.lng);
  const p1 = proj.toXY(b.lat, b.lng);
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const edgeAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  let bearingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  bearingDeg = (bearingDeg + 360) % 360;
  return { edgeAngleDeg, bearingDeg };
}

/**
 * @param {Array<{lat:number,lng:number}>} roofLatLngs
 * @param {{ widthM?: number, heightM?: number, setbackM?: number }} [opts]
 * catalog width/height are the physical short/long sides (DAS 1,134 × 1,800).
 */
function placeEastWestModules(roofLatLngs, opts) {
  const o = opts || {};
  const catW = o.widthM != null ? Number(o.widthM) : 1.134;
  const catH = o.heightM != null ? Number(o.heightM) : 1.8;
  const setback = o.setbackM != null ? Number(o.setbackM) : 0.3;
  const landscape = true;
  const tilt = TILT_DEG;
  const tiltCross = 0;
  const alongEave = landscape ? catH : catW;
  const alongSlope = landscape ? catW : catH;
  const w = alongEave * Math.cos(deg2rad(tiltCross));
  const h = alongSlope * Math.cos(deg2rad(tilt));
  if (!roofLatLngs || roofLatLngs.length < 3) return [];

  let lat0 = 0;
  let lng0 = 0;
  roofLatLngs.forEach((p) => { lat0 += p.lat; lng0 += p.lng; });
  lat0 /= roofLatLngs.length;
  lng0 /= roofLatLngs.length;
  const proj = makeProjector(lat0, lng0);
  const orient = firstEdgeOrientation(roofLatLngs);
  const edgeAngleDeg = orient.edgeAngleDeg;
  const edgeAngle = deg2rad(edgeAngleDeg);
  const roof = roofLatLngs.map((p) => proj.toXY(p.lat, p.lng));
  const origin = roof[0];
  const cosA = Math.cos(-edgeAngle);
  const sinA = Math.sin(-edgeAngle);
  const cosB = Math.cos(edgeAngle);
  const sinB = Math.sin(edgeAngle);
  const toEdge = (p) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return { x: dx * cosA - dy * sinA, y: dx * sinA + dy * cosA };
  };
  const fromEdge = (p) => ({
    x: origin.x + p.x * cosB - p.y * sinB,
    y: origin.y + p.x * sinB + p.y * cosB,
  });
  const roofE = roof.map(toEdge);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  roofE.forEach((p) => {
    minU = Math.min(minU, p.x); maxU = Math.max(maxU, p.x);
    minV = Math.min(minV, p.y); maxV = Math.max(maxV, p.y);
  });
  minU += setback; maxU -= setback; minV += setback; maxV -= setback;
  if (maxU <= minU || maxV <= minV) return [];

  const facePlus = norm360(edgeAngleDeg + 90);
  const faceMinus = norm360(edgeAngleDeg - 90);
  // u = lange Kante. Dort nur 2 cm (kurze Kanten liegen aneinander).
  // v = über die lange Kante: Paar mit 2 cm, dann 20 cm bis zum nächsten Paar.
  const stepU = w + ROW_GAP_M;
  const pairStepV = h + PAIR_INNER_M + h + PAIR_PITCH_M;
  const modules = [];

  function tryPlace(u, v, slot) {
    const cornersE = [
      { x: u - w / 2, y: v - h / 2 },
      { x: u + w / 2, y: v - h / 2 },
      { x: u + w / 2, y: v + h / 2 },
      { x: u - w / 2, y: v + h / 2 },
    ];
    if (!cornersE.every((c) => pointInPoly(c, roofE)) || !pointInPoly({ x: u, y: v }, roofE)) return;
    const xy = fromEdge({ x: u, y: v });
    const ll = proj.toLatLng(xy.x, xy.y);
    modules.push({
      lat: ll.lat,
      lng: ll.lng,
      physWidthM: alongEave,
      physHeightM: alongSlope,
      widthM: w,
      heightM: h,
      azimuth: edgeAngleDeg,
      bearingDeg: orient.bearingDeg,
      facingAzimuth: slot % 2 === 0 ? facePlus : faceMinus,
      tilt,
      tiltCross,
      landscape: true,
      tiltLock: true,
      eastWest: true,
      u,
      v,
    });
  }

  for (let u = minU + w / 2; u <= maxU - w / 2 + 1e-6; u += stepU) {
    let pair = 0;
    for (;;) {
      const v0 = minV + h / 2 + pair * pairStepV;
      if (v0 > maxV - h / 2 + 1e-6) break;
      tryPlace(u, v0, 0);
      const v1 = v0 + h + PAIR_INNER_M;
      if (v1 <= maxV - h / 2 + 1e-6) tryPlace(u, v1, 1);
      pair += 1;
      if (pair > 500) break;
    }
  }
  return modules;
}

module.exports = {
  PAIR_INNER_M,
  PAIR_PITCH_M,
  ROW_GAP_M,
  TILT_DEG,
  placeEastWestModules,
  norm360,
};
