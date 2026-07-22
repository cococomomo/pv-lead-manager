/**
 * NOORTEC Belegungsplan-Editor (Leaflet, Design-light V1).
 * Abhängigkeiten: Leaflet + Leaflet.draw (CDN in offer.html).
 */
(function (global) {
  'use strict';

  const DEFAULT_MODULE = { widthM: 1.134, heightM: 1.800, wp: 455 };

  const ROOF_STYLE = {
    color: '#1d4ed8',
    weight: 2,
    fillColor: '#3b82f6',
    fillOpacity: 0.22,
  };
  const ROOF_STYLE_SEL = {
    color: '#1e3a8a',
    weight: 3,
    fillColor: '#2563eb',
    fillOpacity: 0.38,
  };
  const OBSTACLE_STYLE = {
    color: '#b91c1c',
    weight: 2,
    fillColor: '#ef4444',
    fillOpacity: 0.4,
  };
  const OBSTACLE_STYLE_SEL = {
    color: '#7f1d1d',
    weight: 3,
    fillColor: '#dc2626',
    fillOpacity: 0.5,
  };

  function deg2rad(d) { return (d * Math.PI) / 180; }

  /** Grobe lokale Meter-Projektion um Zentrum. */
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
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y))
        && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function orient2d(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function pointOnSegment(a, b, p, eps) {
    const e = eps == null ? 1e-9 : eps;
    return Math.min(a.x, b.x) - e <= p.x && p.x <= Math.max(a.x, b.x) + e
      && Math.min(a.y, b.y) - e <= p.y && p.y <= Math.max(a.y, b.y) + e;
  }

  function segmentsIntersect(a, b, c, d) {
    const o1 = orient2d(a, b, c);
    const o2 = orient2d(a, b, d);
    const o3 = orient2d(c, d, a);
    const o4 = orient2d(c, d, b);
    if (Math.abs(o1) < 1e-12 && pointOnSegment(a, b, c)) return true;
    if (Math.abs(o2) < 1e-12 && pointOnSegment(a, b, d)) return true;
    if (Math.abs(o3) < 1e-12 && pointOnSegment(c, d, a)) return true;
    if (Math.abs(o4) < 1e-12 && pointOnSegment(c, d, b)) return true;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }

  /** Modulrechteck trifft Lasso-Polygon (Zentrum, Ecken, Kanten oder Containment). */
  function rectHitsPoly(center, corners, poly) {
    if (pointInPoly(center, poly)) return true;
    for (let i = 0; i < corners.length; i++) {
      if (pointInPoly(corners[i], poly)) return true;
    }
    for (let i = 0; i < poly.length; i++) {
      if (pointInPoly(poly[i], corners)) return true;
    }
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      for (let j = 0; j < poly.length; j++) {
        const c = poly[j];
        const d = poly[(j + 1) % poly.length];
        if (segmentsIntersect(a, b, c, d)) return true;
      }
    }
    return false;
  }

  function rotatePoint(p, angleRad) {
    const c = Math.cos(angleRad), s = Math.sin(angleRad);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }

  function rectCorners(cx, cy, w, h, angleRad) {
    const hw = w / 2, hh = h / 2;
    return [
      { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
    ].map((p) => {
      const r = rotatePoint(p, angleRad);
      return { x: cx + r.x, y: cy + r.y };
    });
  }

  /**
   * Erste Polygonkante (= Dachaußenkante beim Zeichnen) → Modul-Ausrichtung.
   * edgeAngleDeg: Winkel für rotatePoint (von +Ost, math. CCW)
   * bearingDeg: Azimut von Nord im Uhrzeigersinn (UI)
   */
  function firstEdgeOrientation(ring) {
    if (!ring || ring.length < 2) {
      return { edgeAngleDeg: 0, bearingDeg: 90 };
    }
    const a = ring[0];
    const b = ring[1];
    const proj = makeProjector(a.lat, a.lng);
    const p0 = proj.toXY(a.lat, a.lng);
    const p1 = proj.toXY(b.lat, b.lng);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
      return { edgeAngleDeg: 0, bearingDeg: 90 };
    }
    const edgeAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    let bearingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
    bearingDeg = (bearingDeg + 360) % 360;
    return { edgeAngleDeg, bearingDeg };
  }

  /**
   * Orthofoto-/Grundriss-Projektion der Modul-Grundfläche auf geneigtem Dach.
   * alongEave = parallel zur 1. Kante; alongSlope = senkrecht dazu (Richtung First).
   * Querformat: lange Seite parallel zur Traufe.
   */
  function projectedModuleFootprint(widthM, heightM, tiltUpslopeDeg, tiltCrossDeg, landscape) {
    const alongEave = landscape ? heightM : widthM;
    const alongSlope = landscape ? widthM : heightM;
    const cosY = Math.cos(deg2rad(Number(tiltUpslopeDeg) || 0));
    const cosX = Math.cos(deg2rad(Number(tiltCrossDeg) || 0));
    return {
      alongEave,
      alongSlope,
      widthM: alongEave * cosX,   // Kartenmaß parallel Traufe
      heightM: alongSlope * cosY, // Kartenmaß Richtung First
    };
  }

  /**
   * Stellt physische Maße entlang Traufe/First sicher (Katalog oder Legacy-Fallback).
   * physWidthM = entlang Traufe, physHeightM = hangaufwärts (First).
   */
  function ensureModulePhysDims(m, catalogDims, landscape) {
    if (!m) return m;
    const land = landscape != null ? !!landscape : !!m.landscape;
    const catW = catalogDims && catalogDims.widthM != null ? Number(catalogDims.widthM) : null;
    const catH = catalogDims && catalogDims.heightM != null ? Number(catalogDims.heightM) : null;
    const landscapeChanged = landscape != null && !!m.landscape !== land;

    if (m.physWidthM != null && m.physHeightM != null && Number.isFinite(Number(m.physWidthM))
      && Number.isFinite(Number(m.physHeightM)) && !landscapeChanged) {
      m.landscape = land;
      return m;
    }

    if (catW != null && catH != null && Number.isFinite(catW) && Number.isFinite(catH)) {
      const foot = projectedModuleFootprint(catW, catH, 0, 0, land);
      m.physWidthM = foot.alongEave;
      m.physHeightM = foot.alongSlope;
      m.landscape = land;
      return m;
    }

    // Legacy ohne phys*: aktuelle width/height als physisch entlang Achsen annehmen
    m.physWidthM = Number(m.physWidthM != null ? m.physWidthM : m.widthM) || DEFAULT_MODULE.widthM;
    m.physHeightM = Number(m.physHeightM != null ? m.physHeightM : m.heightM) || DEFAULT_MODULE.heightM;
    m.landscape = land;
    return m;
  }

  /**
   * Leitet widthM/heightM (Kartenmaß) aus physischen Maßen × cos(Neigung/Quer) ab.
   * opts: { tilt, tiltCross, landscape, catalogDims }
   */
  function syncModuleProjectedSize(m, opts) {
    if (!m) return m;
    const o = opts || {};
    const tilt = o.tilt != null ? Number(o.tilt) : (Number(m.tilt) || 0);
    const tiltCross = o.tiltCross != null ? Number(o.tiltCross) : (Number(m.tiltCross) || 0);
    ensureModulePhysDims(m, o.catalogDims, o.landscape != null ? o.landscape : m.landscape);
    m.tilt = tilt;
    m.tiltCross = tiltCross;
    const cosY = Math.cos(deg2rad(tilt));
    const cosX = Math.cos(deg2rad(tiltCross));
    m.widthM = Number(m.physWidthM) * cosX;
    m.heightM = Number(m.physHeightM) * cosY;
    return m;
  }

  /**
   * Auto-Layout: Raster parallel zur ersten Kante (Dachaußenkante).
   * Modulmaße auf der Karte = physische Maße × cos(Neigung).
   */
  function autoLayoutModules(roofLatLngs, obstaclesLatLngs, opts) {
    const o = opts || {};
    const widthM = o.widthM || DEFAULT_MODULE.widthM;
    const heightM = o.heightM || DEFAULT_MODULE.heightM;
    const gap = o.gapM != null ? o.gapM : 0.02;
    const setback = o.setbackM != null ? o.setbackM : 0.3;
    const landscape = !!o.landscape;
    const tilt = o.tilt != null ? Number(o.tilt) : 0;
    const tiltCross = o.tiltCross != null ? Number(o.tiltCross) : 0;
    const foot = projectedModuleFootprint(widthM, heightM, tilt, tiltCross, landscape);
    const w = foot.widthM;
    const h = foot.heightM;

    if (!roofLatLngs || roofLatLngs.length < 3) return [];

    let lat0 = 0, lng0 = 0;
    roofLatLngs.forEach((p) => { lat0 += p.lat; lng0 += p.lng; });
    lat0 /= roofLatLngs.length;
    lng0 /= roofLatLngs.length;
    const proj = makeProjector(lat0, lng0);

    const orient = firstEdgeOrientation(roofLatLngs);
    const edgeAngleDeg = o.edgeAngleDeg != null ? Number(o.edgeAngleDeg) : orient.edgeAngleDeg;
    const edgeAngle = deg2rad(edgeAngleDeg);
    const bearingDeg = o.azimuth != null ? Number(o.azimuth) : orient.bearingDeg;

    const roof = roofLatLngs.map((p) => proj.toXY(p.lat, p.lng));
    const obstacles = (obstaclesLatLngs || []).map((poly) => poly.map((p) => proj.toXY(p.lat, p.lng)));

    const origin = roof[0];
    const cosA = Math.cos(-edgeAngle);
    const sinA = Math.sin(-edgeAngle);
    const cosB = Math.cos(edgeAngle);
    const sinB = Math.sin(edgeAngle);

    function toEdge(p) {
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      return { x: dx * cosA - dy * sinA, y: dx * sinA + dy * cosA };
    }
    function fromEdge(p) {
      return {
        x: origin.x + p.x * cosB - p.y * sinB,
        y: origin.y + p.x * sinB + p.y * cosB,
      };
    }

    const roofE = roof.map(toEdge);
    const obstaclesE = obstacles.map((poly) => poly.map(toEdge));

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    roofE.forEach((p) => {
      minU = Math.min(minU, p.x); maxU = Math.max(maxU, p.x);
      minV = Math.min(minV, p.y); maxV = Math.max(maxV, p.y);
    });
    minU += setback; maxU -= setback; minV += setback; maxV -= setback;
    if (maxU <= minU || maxV <= minV) return [];

    const modules = [];
    const stepU = w + gap;
    const stepV = h + gap;
    for (let v = minV + h / 2; v <= maxV - h / 2 + 1e-6; v += stepV) {
      for (let u = minU + w / 2; u <= maxU - w / 2 + 1e-6; u += stepU) {
        const cornersE = [
          { x: u - w / 2, y: v - h / 2 },
          { x: u + w / 2, y: v - h / 2 },
          { x: u + w / 2, y: v + h / 2 },
          { x: u - w / 2, y: v + h / 2 },
        ];
        const okRoof = cornersE.every((c) => pointInPoly(c, roofE)) && pointInPoly({ x: u, y: v }, roofE);
        if (!okRoof) continue;
        let hitObs = false;
        for (const obs of obstaclesE) {
          if (cornersE.some((c) => pointInPoly(c, obs)) || pointInPoly({ x: u, y: v }, obs)) {
            hitObs = true;
            break;
          }
        }
        if (hitObs) continue;
        const xy = fromEdge({ x: u, y: v });
        const ll = proj.toLatLng(xy.x, xy.y);
        const mod = {
          lat: ll.lat,
          lng: ll.lng,
          physWidthM: foot.alongEave,
          physHeightM: foot.alongSlope,
          azimuth: edgeAngleDeg,
          bearingDeg,
          tilt,
          tiltCross,
          landscape,
        };
        syncModuleProjectedSize(mod);
        modules.push(mod);
      }
    }
    return modules;
  }

  const POLYGON_DRAW_HINT =
    'Polygon zeichnen: Erste Linie = Dachaußenkante – daran orientieren sich die Module';

  /** Magnetisches Einrasten: etwas großzügiger als Modulspalt (~2 cm). */
  const SNAP_DIST_M = 0.45;
  const SNAP_ANGLE_DEG = 8;
  const SNAP_CORNER_M = 0.4;
  const SNAP_EDGE_OVERLAP_PAD_M = 0.35;

  function createLayoutEditor(options) {
    const opts = options || {};
    const modal = document.getElementById('layout-modal');
    const mapEl = document.getElementById('layout-map');
    if (!modal || !mapEl || !global.L) {
      throw new Error('Layout-Editor: Modal/Leaflet fehlt');
    }

    let map = null;
    let drawControl = null;
    let polyLayer = null;
    let moduleLayer = null;
    let houseNumberLayer = null;
    let houseNumberTimer = null;
    let houseNumberSeq = 0;
    let baseLayers = {};
    let activeBaseLayer = null;
    let currentProvider = 'basemap_at';
    let modules = [];
    let selectedPoly = null;
    let selectedModuleIdxs = []; // multi-select
    let moduleDrag = null; // { idx, startLat, startLng, originals: [{i,lat,lng}] }
    let planMeta = {
      tilt: 30,
      tiltCross: 0,
      azimuth: 180,
      setbackM: 0.3,
      gapM: 0.02,
      landscape: false,
      moduleType: 'das',
    };
    let layoutId = null;
    let providers = opts.providers || [];
    let moduleDims = opts.moduleDimensions || { das: DEFAULT_MODULE, aiko: { ...DEFAULT_MODULE, wp: 490, heightM: 1.762 } };
    let onSaved = opts.onSaved || (() => {});
    let editorStep = 'building'; // 'building' | 'modules'
    let snapEnabled = true;
    let undoStack = [];
    let redoStack = [];
    let suppressUndo = false;
    let pitchArrowLayer = null;
    let modulePitchArrowLayer = null;
    let activeSelectTool = null; // null | 'rect' | 'lasso'
    let selectRectState = null; // { start, rectLayer }
    let selectLassoState = null; // { points: LatLng[], previewLayer, drawing: bool }
    let suppressModuleClick = false; // shift-mousedown already toggled
    let selectionHandledOnDown = false; // mousedown already set selection (avoid click collapsing multi-select)
    let moduleDragMoved = false;
    let rotateHandleLayer = null;
    let rotateDrag = null; // { centroid, startAngleDeg, originals, pushedUndo }
    const PITCH_ARROW_COLOR = '#e879a9';
    const MAX_UNDO = 50;

    function normalizeAzimuth(deg) {
      let a = Number(deg) || 0;
      a = ((a % 360) + 360) % 360;
      return a;
    }

    function selectionCentroidLatLng() {
      let lat = 0;
      let lng = 0;
      let n = 0;
      selectedModuleIdxs.forEach((i) => {
        const m = modules[i];
        if (!m) return;
        lat += Number(m.lat) || 0;
        lng += Number(m.lng) || 0;
        n += 1;
      });
      if (!n) return null;
      return { lat: lat / n, lng: lng / n };
    }

    /** Winkel East=0, CCW (wie Modul-azimuth) vom Centroid zum Punkt. */
    function angleDegFromCentroid(latlng, centroid) {
      if (!latlng || !centroid) return 0;
      const proj = makeProjector(centroid.lat, centroid.lng);
      const xy = proj.toXY(latlng.lat, latlng.lng);
      return (Math.atan2(xy.y, xy.x) * 180) / Math.PI;
    }

    function dims() {
      const d = moduleDims[planMeta.moduleType] || moduleDims.das || DEFAULT_MODULE;
      return { widthM: d.widthM || DEFAULT_MODULE.widthM, heightM: d.heightM || DEFAULT_MODULE.heightM, wp: d.wp || 455 };
    }

    function formatModuleSizeLabel() {
      const d = dims();
      const tilt = Number(planMeta.tilt) || 0;
      const tiltCross = Number(planMeta.tiltCross) || 0;
      const proj = projectedModuleFootprint(d.widthM, d.heightM, tilt, tiltCross, planMeta.landscape);
      const fmt = (n) => String(Number(n).toFixed(3)).replace('.', ',');
      const phys = `${fmt(d.widthM)} × ${fmt(d.heightM)} m`;
      if (tilt < 0.5 && tiltCross < 0.5) {
        return `${phys} · ${d.wp} Wp`;
      }
      return `${phys} → ${fmt(proj.widthM)} × ${fmt(proj.heightM)} m proj. · ${d.wp} Wp`;
    }

    function updateModuleSizeLabel() {
      const el = document.getElementById('layout-module-size');
      if (!el) return;
      el.textContent = formatModuleSizeLabel();
      const d = dims();
      const tilt = Number(planMeta.tilt) || 0;
      const tiltCross = Number(planMeta.tiltCross) || 0;
      const proj = projectedModuleFootprint(d.widthM, d.heightM, tilt, tiltCross, planMeta.landscape);
      const fmt = (n) => String(Number(n).toFixed(3)).replace('.', ',');
      el.title = `DAS/Aiko Katalog: ${fmt(d.widthM)} × ${fmt(d.heightM)} m physisch`
        + (tilt || tiltCross
          ? ` → Orthofoto-Projektion ${fmt(proj.widthM)} × ${fmt(proj.heightM)} m (Neigung ${tilt}° / Quer ${tiltCross}°)`
          : '');
    }

    function styleFor(kind, selected) {
      if (kind === 'obstacle') return selected ? OBSTACLE_STYLE_SEL : OBSTACLE_STYLE;
      return selected ? ROOF_STYLE_SEL : ROOF_STYLE;
    }

    function ringFromLayer(layer) {
      const latlngs = layer.getLatLngs();
      const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
      return ring.map((p) => ({ lat: p.lat, lng: p.lng }));
    }

    function refreshPolyStyles() {
      if (!polyLayer) return;
      polyLayer.eachLayer((layer) => {
        layer.setStyle(styleFor(layer._pvlKind || 'roof', layer === selectedPoly));
      });
    }

    function isModuleSelected(idx) {
      return selectedModuleIdxs.indexOf(idx) !== -1;
    }

    function setSelectedModules(idxs, opts) {
      const skipRender = opts && opts.skipRender;
      const uniq = [];
      (idxs || []).forEach((i) => {
        const n = Number(i);
        if (!Number.isFinite(n) || n < 0 || n >= modules.length) return;
        if (uniq.indexOf(n) === -1) uniq.push(n);
      });
      selectedModuleIdxs = uniq;
      if (uniq.length) selectedPoly = null;
      refreshPolyStyles();
      if (!skipRender) renderModules();
      else refreshModuleStylesOnly();
      updateSelectionChrome();
    }

    function selectPoly(layer) {
      selectedPoly = layer || null;
      selectedModuleIdxs = [];
      refreshPolyStyles();
      renderModules();
      if (layer && layer._pvlKind === 'roof') {
        syncRoofMetaFromGeometry(layer);
        const meta = layer._pvlMeta || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('layout-tilt', meta.tilt != null ? meta.tilt : 30);
        set('layout-azimuth', meta.bearingDeg != null ? Math.round(meta.bearingDeg) : (meta.azimuth != null ? meta.azimuth : 180));
      }
    }

    function selectModule(idx, opts) {
      const o = opts || {};
      const skipRender = !!o.skipRender;
      if (o.toggle) {
        const next = selectedModuleIdxs.slice();
        const at = next.indexOf(idx);
        if (at === -1) next.push(idx);
        else next.splice(at, 1);
        setSelectedModules(next, { skipRender });
        return;
      }
      setSelectedModules([idx], { skipRender });
    }

    function refreshModuleStylesOnly() {
      if (!moduleLayer) return;
      moduleLayer.eachLayer((layer) => {
        const idx = layer._pvlModuleIdx;
        const selected = isModuleSelected(idx);
        layer.setStyle({
          color: selected ? '#1e3a8a' : '#1e40af',
          weight: selected ? 3 : 1,
          fillColor: selected ? '#3b82f6' : '#60a5fa',
          fillOpacity: selected ? 0.78 : 0.55,
        });
      });
    }

    function clearSelection() {
      selectedModuleIdxs = [];
      selectedPoly = null;
      if (selectRectState || (selectLassoState && selectLassoState.drawing)) {
        cancelSelectTool(true); // Zeichnung abbrechen, Tool behalten
      }
      refreshPolyStyles();
      renderModules();
      updateSelectionChrome();
    }

    function updateUndoRedoUi() {
      const u = document.getElementById('layout-btn-undo');
      const r = document.getElementById('layout-btn-redo');
      if (u) u.disabled = !undoStack.length;
      if (r) r.disabled = !redoStack.length;
    }

    function pushUndo() {
      if (suppressUndo) return;
      undoStack.push(JSON.stringify(serializePlan()));
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack = [];
      updateUndoRedoUi();
    }

    function undo() {
      if (!undoStack.length) return;
      suppressUndo = true;
      redoStack.push(JSON.stringify(serializePlan()));
      const prev = JSON.parse(undoStack.pop());
      loadPlan(prev);
      suppressUndo = false;
      updateUndoRedoUi();
    }

    function redo() {
      if (!redoStack.length) return;
      suppressUndo = true;
      undoStack.push(JSON.stringify(serializePlan()));
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      const next = JSON.parse(redoStack.pop());
      loadPlan(next);
      suppressUndo = false;
      updateUndoRedoUi();
    }

    function updateSnapUi() {
      const btn = document.getElementById('layout-btn-snap');
      if (!btn) return;
      btn.classList.toggle('snap-on', snapEnabled);
      btn.classList.toggle('snap-off', !snapEnabled);
      btn.textContent = snapEnabled ? 'Snap (alt)' : 'Snap aus';
      btn.title = 'Snap (Alt)' + (snapEnabled ? ' – aktiv' : ' – aus');
    }

    function setSnapEnabled(on) {
      snapEnabled = !!on;
      updateSnapUi();
    }

    function setEditorStep(step) {
      editorStep = step === 'modules' ? 'modules' : 'building';
      const toolbar = document.getElementById('layout-toolbar');
      if (toolbar) toolbar.setAttribute('data-editor-step', editorStep);
      document.querySelectorAll('.layout-step').forEach((btn) => {
        const active = btn.getAttribute('data-step') === editorStep;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('.layout-toolbar [data-step]').forEach((el) => {
        const s = el.getAttribute('data-step');
        if (s === 'always') {
          el.hidden = false;
          return;
        }
        el.hidden = s !== editorStep;
      });
      if (editorStep === 'building') {
        cancelSelectTool(false);
        if (moduleDrag) endModuleDrag(true);
      } else {
        // leave draw mode idle when switching to modules
        if (map && map._pvlActiveDrawer && map._pvlActiveDrawer.disable) {
          try { map._pvlActiveDrawer.disable(); } catch (_) { /* ignore */ }
          map._pvlActiveDrawer = null;
        }
      }
      applyStepMapInteractivity();
      updateSelectToolUi();
      updateSelectionChrome();
      updateTiltLabels();
    }

    function applyStepMapInteractivity() {
      if (!map) return;
      const building = editorStep === 'building';
      if (drawControl) {
        try {
          const container = drawControl.getContainer && drawControl.getContainer();
          if (container) container.style.display = building ? '' : 'none';
        } catch (_) { /* ignore */ }
      }
      if (moduleLayer) {
        moduleLayer.eachLayer((layer) => {
          if (building) {
            if (layer._path) layer._path.style.pointerEvents = 'none';
            layer.options.interactive = false;
          } else {
            if (layer._path) layer._path.style.pointerEvents = '';
            layer.options.interactive = true;
          }
        });
      }
      // Select-Tool Pass-through nach Re-Render wiederherstellen
      applySelectToolLayerPassThrough();
    }

    function updateSelectToolUi() {
      const rect = document.getElementById('layout-btn-select-rect');
      const lasso = document.getElementById('layout-btn-select-lasso');
      if (rect) rect.classList.toggle('tool-active', activeSelectTool === 'rect');
      if (lasso) lasso.classList.toggle('tool-active', activeSelectTool === 'lasso');
      if (map && map.getContainer) {
        map.getContainer().style.cursor = activeSelectTool ? 'crosshair' : '';
      }
      applySelectToolLayerPassThrough();
    }

    /** Während Rechteck/Lasso: Klicks durch Module/Polygone auf die Karte durchreichen. */
    function applySelectToolLayerPassThrough() {
      const selecting = !!activeSelectTool && editorStep === 'modules';
      if (moduleLayer) {
        moduleLayer.eachLayer((layer) => {
          if (layer._path) layer._path.style.pointerEvents = selecting ? 'none' : '';
          layer.options.interactive = !selecting && editorStep === 'modules';
        });
      }
      if (polyLayer) {
        polyLayer.eachLayer((layer) => {
          if (layer._path) layer._path.style.pointerEvents = selecting ? 'none' : '';
          layer.options.interactive = !selecting;
        });
      }
    }

    function cancelSelectTool(keepActiveFlag) {
      if (selectRectState) {
        if (selectRectState.rectLayer && map) map.removeLayer(selectRectState.rectLayer);
        selectRectState = null;
        if (map && map.dragging) map.dragging.enable();
      }
      if (selectLassoState) {
        if (selectLassoState.previewLayer && map) map.removeLayer(selectLassoState.previewLayer);
        selectLassoState = null;
        if (map && map.dragging) map.dragging.enable();
      }
      if (!keepActiveFlag) {
        activeSelectTool = null;
        if (map && map.doubleClickZoom) map.doubleClickZoom.enable();
        updateSelectToolUi();
      } else {
        applySelectToolLayerPassThrough();
      }
    }

    function setSelectTool(tool) {
      if (editorStep !== 'modules') return;
      if (activeSelectTool === tool) {
        cancelSelectTool(false);
        return;
      }
      cancelSelectTool(false);
      activeSelectTool = tool;
      if (map && map.doubleClickZoom) map.doubleClickZoom.disable();
      updateSelectToolUi();
    }

    function updateLassoPreview() {
      if (!selectLassoState || !map) return;
      if (selectLassoState.previewLayer) {
        map.removeLayer(selectLassoState.previewLayer);
        selectLassoState.previewLayer = null;
      }
      const pts = selectLassoState.points;
      if (pts.length < 1) return;
      if (pts.length === 1) {
        selectLassoState.previewLayer = L.circleMarker(pts[0], {
          radius: 4, color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 0.8, weight: 2,
          interactive: false,
        }).addTo(map);
        return;
      }
      const latlngs = pts.map((p) => [p.lat, p.lng]);
      // Während des Zeichnens offene Polyline – erst beim Loslassen schließen
      if (selectLassoState.drawing) {
        selectLassoState.previewLayer = L.polyline(latlngs, {
          color: '#2563eb', weight: 2, dashArray: '6 4',
          interactive: false,
        }).addTo(map);
        return;
      }
      if (pts.length >= 3) latlngs.push([pts[0].lat, pts[0].lng]);
      selectLassoState.previewLayer = L.polygon(latlngs, {
        color: '#2563eb', weight: 2, dashArray: '6 4',
        fillColor: '#3b82f6', fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    }

    function finishLassoSelect() {
      if (!selectLassoState) return;
      const pts = selectLassoState.points || [];
      const additive = !!(selectLassoState.shiftKey);
      if (selectLassoState.previewLayer && map) {
        map.removeLayer(selectLassoState.previewLayer);
        selectLassoState.previewLayer = null;
      }
      selectLassoState = null;
      if (map && map.dragging) map.dragging.enable();
      if (pts.length < 3) {
        applySelectToolLayerPassThrough();
        return;
      }
      const hits = modulesInsideLatLngPoly(pts);
      if (additive) {
        const merged = selectedModuleIdxs.slice();
        hits.forEach((i) => { if (merged.indexOf(i) === -1) merged.push(i); });
        setSelectedModules(merged);
      } else {
        setSelectedModules(hits);
      }
      // Tool bleibt aktiv für weitere Auswahl
      applySelectToolLayerPassThrough();
      updateSelectionChrome();
    }

    function onMapSelectMouseDown(e) {
      if (editorStep !== 'modules' || !activeSelectTool || !e.latlng) return;
      if (e.originalEvent && e.originalEvent.button !== 0) return;
      // Nicht starten, wenn Klick von UI-Button kommt
      if (e.originalEvent && e.originalEvent.target) {
        const t = e.originalEvent.target;
        if (t.closest && t.closest('.layout-toolbar, .layout-modal-head, .layout-modal-foot, button, input, select, label')) {
          return;
        }
      }
      L.DomEvent.preventDefault(e);
      if (map && map.dragging) map.dragging.disable();
      const shiftKey = !!(e.originalEvent && e.originalEvent.shiftKey);

      if (activeSelectTool === 'rect') {
        selectRectState = {
          start: e.latlng,
          shiftKey,
          rectLayer: L.rectangle([e.latlng, e.latlng], {
            color: '#2563eb', weight: 1, dashArray: '4 3',
            fillColor: '#3b82f6', fillOpacity: 0.15,
            interactive: false,
          }).addTo(map),
        };
        return;
      }

      if (activeSelectTool === 'lasso') {
        selectLassoState = {
          points: [e.latlng],
          previewLayer: null,
          drawing: true,
          shiftKey,
        };
        updateLassoPreview();
      }
    }

    function onMapSelectMouseMove(e) {
      if (!e.latlng) return;
      if (selectRectState && selectRectState.rectLayer) {
        selectRectState.rectLayer.setBounds(L.latLngBounds(selectRectState.start, e.latlng));
        return;
      }
      if (selectLassoState && selectLassoState.drawing && map) {
        const pts = selectLassoState.points;
        const last = pts[pts.length - 1];
        const pLast = map.latLngToContainerPoint(last);
        const pNow = map.latLngToContainerPoint(e.latlng);
        if (pLast.distanceTo(pNow) >= 2) {
          pts.push(e.latlng);
          updateLassoPreview();
        }
      }
    }

    function onMapSelectMouseUp(e) {
      if (selectRectState) {
        const start = selectRectState.start;
        const shiftKey = selectRectState.shiftKey;
        const end = (e && e.latlng) || start;
        const bounds = L.latLngBounds(start, end);
        if (selectRectState.rectLayer && map) map.removeLayer(selectRectState.rectLayer);
        selectRectState = null;
        if (map && map.dragging) map.dragging.enable();
        // Zu kleine Züge ignorieren (reiner Klick)
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const nearlyPoint = Math.abs(sw.lat - ne.lat) < 1e-7 && Math.abs(sw.lng - ne.lng) < 1e-7;
        if (!nearlyPoint) {
          const hits = modulesInsideBounds(bounds);
          if (shiftKey) {
            const merged = selectedModuleIdxs.slice();
            hits.forEach((i) => { if (merged.indexOf(i) === -1) merged.push(i); });
            setSelectedModules(merged);
          } else {
            setSelectedModules(hits);
          }
          updateSelectionChrome();
        }
        applySelectToolLayerPassThrough();
        return;
      }
      if (selectLassoState && selectLassoState.drawing) {
        selectLassoState.drawing = false;
        if (map && map.dragging) map.dragging.enable();
        finishLassoSelect();
      }
    }

    function onMapSelectClick() { /* freehand lasso – no click points */ }
    function onMapSelectDblClick() { /* freehand lasso – finish on mouseup */ }

    /** Kopfzeile / Reiter bei Modulauswahl anpassen. */
    function updateSelectionChrome() {
      const stepMod = document.getElementById('layout-step-modules');
      if (stepMod) {
        if (editorStep === 'modules' && selectedModuleIdxs.length) {
          stepMod.textContent = selectedModuleIdxs.length === 1
            ? '1 Modul ausgewählt'
            : `${selectedModuleIdxs.length} Module ausgewählt`;
        } else {
          stepMod.textContent = 'Module planen';
        }
      }
      updateModuleSizeLabel();
      updateRotateHandle();
    }

    /** Pfeillänge in Metern: flach = kurz, steil = lang. */
    function arrowLenFromTilt(tiltDeg, refM) {
      const t = Math.max(0, Math.min(75, Number(tiltDeg) || 0));
      const ref = Math.max(0.25, Number(refM) || 0.6);
      // 0° → ~22 % der Referenz, 45° → ~78 %, ≥60° → ~100 %
      const factor = 0.22 + 0.78 * Math.min(1, t / 60);
      return ref * factor;
    }

    /**
     * Einheitlicher Traufen-Richtungsvektor für eine Dachfläche
     * (vom First / Inneren zur ersten Kante).
     */
    function getRoofEavePitch(layer) {
      if (!layer || layer._pvlKind !== 'roof') return null;
      const ring = ringFromLayer(layer);
      if (ring.length < 3) return null;
      const lat0 = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
      const lng0 = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
      const proj = makeProjector(lat0, lng0);
      const pts = ring.map((p) => proj.toXY(p.lat, p.lng));
      const p0 = pts[0];
      const p1 = pts[1];
      const edx = p1.x - p0.x;
      const edy = p1.y - p0.y;
      const elen = Math.hypot(edx, edy) || 1;
      const ex = edx / elen;
      const ey = edy / elen;
      let nx = -ey;
      let ny = ex;
      const midEdge = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const testIn = { x: midEdge.x + nx * 0.4, y: midEdge.y + ny * 0.4 };
      if (!pointInPoly(testIn, pts)) {
        nx = -nx;
        ny = -ny;
      }
      const toEaveX = -nx;
      const toEaveY = -ny;
      const meta = layer._pvlMeta || {};
      return {
        proj,
        pts,
        p0,
        ex,
        ey,
        nx,
        ny,
        toEaveX,
        toEaveY,
        tilt: meta.tilt != null ? Number(meta.tilt) : (planMeta.tilt || 0),
        ring,
      };
    }

    function drawPitchArrowGraphic(targetLayer, proj, baseXY, tipXY, color) {
      const dx = tipXY.x - baseXY.x;
      const dy = tipXY.y - baseXY.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const headLen = Math.min(len * 0.42, Math.max(0.08, len * 0.38));
      const headW = headLen * 0.55;
      const tipLL = proj.toLatLng(tipXY.x, tipXY.y);
      const baseLL = proj.toLatLng(baseXY.x, baseXY.y);
      const left = proj.toLatLng(
        tipXY.x - ux * headLen - uy * headW,
        tipXY.y - uy * headLen + ux * headW
      );
      const right = proj.toLatLng(
        tipXY.x - ux * headLen + uy * headW,
        tipXY.y - uy * headLen - ux * headW
      );
      L.polyline([[baseLL.lat, baseLL.lng], [tipLL.lat, tipLL.lng]], {
        color,
        weight: 2.2,
        opacity: 0.95,
        interactive: false,
        className: 'layout-pitch-arrow',
      }).addTo(targetLayer);
      L.polygon([
        [tipLL.lat, tipLL.lng],
        [left.lat, left.lng],
        [right.lat, right.lng],
      ], {
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.92,
        interactive: false,
        className: 'layout-pitch-arrow',
      }).addTo(targetLayer);
    }

    /** Pfeile senkrecht zur 1. Kante, Richtung Traufe; Länge ~ Dachneigung. */
    function refreshPitchArrows() {
      if (!pitchArrowLayer || !polyLayer) return;
      pitchArrowLayer.clearLayers();
      polyLayer.eachLayer((layer) => {
        const info = getRoofEavePitch(layer);
        if (!info) return;
        const {
          proj, pts, p0, ex, ey, nx, ny, toEaveX, toEaveY, tilt,
        } = info;

        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        pts.forEach((p) => {
          const u = (p.x - p0.x) * ex + (p.y - p0.y) * ey;
          const v = (p.x - p0.x) * nx + (p.y - p0.y) * ny;
          minU = Math.min(minU, u); maxU = Math.max(maxU, u);
          minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        });
        const centerU = (minU + maxU) / 2;
        const centerV = (minV + maxV) / 2;
        const spanU = Math.max(0.8, (maxU - minU) * 0.55);
        const nArrows = Math.max(3, Math.min(7, Math.round(spanU / 1.8)));
        const roofSpan = Math.max(0.6, maxV - minV);
        const arrowLen = arrowLenFromTilt(tilt, Math.min(1.35, roofSpan * 0.28));
        for (let i = 0; i < nArrows; i++) {
          const t = nArrows === 1 ? 0.5 : i / (nArrows - 1);
          const u = centerU - spanU / 2 + t * spanU;
          const mid = {
            x: p0.x + ex * u + nx * centerV,
            y: p0.y + ey * u + ny * centerV,
          };
          const tipXY = {
            x: mid.x + toEaveX * arrowLen * 0.5,
            y: mid.y + toEaveY * arrowLen * 0.5,
          };
          const baseXY = {
            x: mid.x - toEaveX * arrowLen * 0.5,
            y: mid.y - toEaveY * arrowLen * 0.5,
          };
          drawPitchArrowGraphic(pitchArrowLayer, proj, baseXY, tipXY, PITCH_ARROW_COLOR);
        }
      });
      refreshModulePitchArrows();
    }

    /** Neigungspfeile auf jedem Modul (Richtung Traufe, Länge ~ Neigung). */
    function refreshModulePitchArrows() {
      if (!modulePitchArrowLayer) return;
      modulePitchArrowLayer.clearLayers();
      if (!modules.length) return;

      const roofInfos = [];
      if (polyLayer) {
        polyLayer.eachLayer((layer) => {
          const info = getRoofEavePitch(layer);
          if (info) roofInfos.push(info);
        });
      }

      modules.forEach((m) => {
        if (!m) return;
        const tilt = m.tilt != null ? Number(m.tilt) : (planMeta.tilt || 0);
        const ref = Math.min(Number(m.widthM) || 1, Number(m.heightM) || 1);
        const arrowLen = arrowLenFromTilt(tilt, ref * 0.72);
        if (arrowLen < 0.05) return;

        const proj = makeProjector(m.lat, m.lng);
        const center = proj.toXY(m.lat, m.lng);

        let ux = 0;
        let uy = -1;
        let found = false;
        for (const info of roofInfos) {
          const cLocal = info.proj.toXY(m.lat, m.lng);
          if (pointInPoly(cLocal, info.pts)) {
            // Traufenrichtung ins Modul-Lokalkoordinatensystem übernehmen
            const tipWorld = info.proj.toLatLng(
              cLocal.x + info.toEaveX,
              cLocal.y + info.toEaveY
            );
            const tipLocal = proj.toXY(tipWorld.lat, tipWorld.lng);
            ux = tipLocal.x - center.x;
            uy = tipLocal.y - center.y;
            const n = Math.hypot(ux, uy) || 1;
            ux /= n;
            uy /= n;
            found = true;
            break;
          }
        }
        if (!found) {
          // Fallback: senkrecht zur Modul-Längsachse (Azimut = Traufe)
          const a = deg2rad(Number(m.azimuth) || 0);
          ux = -Math.sin(a);
          uy = Math.cos(a);
        }

        const tipXY = { x: center.x + ux * arrowLen * 0.5, y: center.y + uy * arrowLen * 0.5 };
        const baseXY = { x: center.x - ux * arrowLen * 0.5, y: center.y - uy * arrowLen * 0.5 };
        drawPitchArrowGraphic(modulePitchArrowLayer, proj, baseXY, tipXY, PITCH_ARROW_COLOR);
      });
    }

    /** Neigung behalten, Ausrichtung immer aus erster Kante (Dachaußenkante). */
    function syncRoofMetaFromGeometry(layer) {
      if (!layer || layer._pvlKind !== 'roof') return;
      const ring = ringFromLayer(layer);
      const orient = firstEdgeOrientation(ring);
      layer._pvlMeta = layer._pvlMeta || {};
      layer._pvlMeta.edgeAngleDeg = orient.edgeAngleDeg;
      layer._pvlMeta.bearingDeg = orient.bearingDeg;
      // azimuth = Kantenwinkel für Modul-Rotation (intern)
      layer._pvlMeta.azimuth = orient.edgeAngleDeg;
      if (layer._pvlMeta.tilt == null) layer._pvlMeta.tilt = planMeta.tilt;
    }

    /** Schreibt Formular-Neigung auf Dachflächen: nur Selektion, oder alle wenn nichts gewählt. */
    function applyFormTiltToRoofs(mode) {
      readMetaFromForm();
      if (!polyLayer) return;
      const onlySelected = mode === 'selected';
      polyLayer.eachLayer((layer) => {
        if (layer._pvlKind !== 'roof') return;
        if (onlySelected && layer !== selectedPoly) return;
        layer._pvlMeta = layer._pvlMeta || {};
        layer._pvlMeta.tilt = planMeta.tilt;
        syncRoofMetaFromGeometry(layer);
      });
    }

    /**
     * Module auf einer Dachfläche: Neigung + projizierte Maße syncen (Zentrum bleibt).
     */
    function syncModulesOnRoofLayer(layer, opts) {
      if (!layer || layer._pvlKind !== 'roof') return;
      const info = getRoofEavePitch(layer);
      if (!info) return;
      const tilt = opts && opts.tilt != null
        ? Number(opts.tilt)
        : (layer._pvlMeta && layer._pvlMeta.tilt != null ? Number(layer._pvlMeta.tilt) : planMeta.tilt);
      const tiltCross = opts && opts.tiltCross != null
        ? Number(opts.tiltCross)
        : (planMeta.tiltCross != null ? Number(planMeta.tiltCross) : 0);
      const catalogDims = dims();
      modules.forEach((m) => {
        if (!m) return;
        const c = info.proj.toXY(m.lat, m.lng);
        if (!pointInPoly(c, info.pts)) return;
        // Quer/Hoch pro Modul behalten (nicht planMeta überschreiben)
        syncModuleProjectedSize(m, {
          tilt,
          tiltCross,
          landscape: m.landscape,
          catalogDims,
        });
      });
    }

    function applyFormMetaToSelectedRoof() {
      if (!selectedPoly || selectedPoly._pvlKind !== 'roof') return;
      readMetaFromForm();
      selectedPoly._pvlMeta = selectedPoly._pvlMeta || {};
      selectedPoly._pvlMeta.tilt = planMeta.tilt;
      // Azimut-Feld = Bearing der Außenkante (Anzeige); Rotation bleibt aus Geometrie
      syncRoofMetaFromGeometry(selectedPoly);
      syncModulesOnRoofLayer(selectedPoly, {
        tilt: planMeta.tilt,
        tiltCross: planMeta.tiltCross,
      });
      renderModules();
      refreshPitchArrows();
      updateModuleSizeLabel();
    }

    function attachPolyHandlers(layer) {
      layer.on('click', (e) => {
        if (e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        selectPoly(layer);
      });
    }

    function addPolygonLayer(kind, latLngs, meta) {
      const layer = L.polygon(latLngs, styleFor(kind, false));
      layer._pvlKind = kind;
      if (kind === 'roof') {
        const ring = latLngs.map((ll) => {
          if (Array.isArray(ll)) return { lat: ll[0], lng: ll[1] };
          return { lat: ll.lat, lng: ll.lng };
        });
        const orient = firstEdgeOrientation(ring);
        layer._pvlMeta = {
          tilt: meta && meta.tilt != null ? Number(meta.tilt) : planMeta.tilt,
          edgeAngleDeg: meta && meta.edgeAngleDeg != null ? Number(meta.edgeAngleDeg) : orient.edgeAngleDeg,
          bearingDeg: meta && meta.bearingDeg != null ? Number(meta.bearingDeg) : orient.bearingDeg,
          azimuth: meta && meta.edgeAngleDeg != null ? Number(meta.edgeAngleDeg) : orient.edgeAngleDeg,
        };
      } else {
        layer._pvlMeta = {};
      }
      attachPolyHandlers(layer);
      polyLayer.addLayer(layer);
      return layer;
    }

    function enabledProviders() {
      return (providers || []).filter((p) => p && p.enabled && p.url);
    }

    function populateBasemapSelect() {
      const sel = document.getElementById('layout-basemap');
      if (!sel) return;
      const list = enabledProviders();
      const prev = currentProvider || (list[0] && list[0].id);
      sel.innerHTML = list.map((p) => (
        `<option value="${p.id}">${p.label}</option>`
      )).join('');
      if (prev && list.some((p) => p.id === prev)) sel.value = prev;
      else if (list[0]) sel.value = list[0].id;
    }

    function switchBasemap(providerId) {
      if (!map) return;
      const list = enabledProviders();
      const p = list.find((x) => x.id === providerId) || list[0];
      if (!p) return;
      const next = baseLayers[p.id];
      if (!next) return;
      if (activeBaseLayer && map.hasLayer(activeBaseLayer)) {
        map.removeLayer(activeBaseLayer);
      }
      next.addTo(map);
      if (typeof next.bringToBack === 'function') next.bringToBack();
      activeBaseLayer = next;
      currentProvider = p.id;
      const sel = document.getElementById('layout-basemap');
      if (sel && sel.value !== p.id) sel.value = p.id;
    }

    function currentDrawMode() {
      return (document.getElementById('layout-draw-mode') || {}).value || 'roof';
    }

    function currentDrawShapeOptions() {
      return currentDrawMode() === 'obstacle' ? OBSTACLE_STYLE : ROOF_STYLE;
    }

    function applyDrawModeUi() {
      const mode = currentDrawMode();
      const isObs = mode === 'obstacle';
      document.querySelectorAll('.layout-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      });
      const hint = isObs
        ? 'Sperrzone zeichnen: rote Fläche – Module werden beim Auto-Layout ausgespart'
        : POLYGON_DRAW_HINT;
      if (L.drawLocal && L.drawLocal.draw) {
        L.drawLocal.draw.toolbar.buttons.polygon = hint;
        if (L.drawLocal.draw.handlers && L.drawLocal.draw.handlers.polygon) {
          L.drawLocal.draw.handlers.polygon.tooltip = L.drawLocal.draw.handlers.polygon.tooltip || {};
          if (isObs) {
            L.drawLocal.draw.handlers.polygon.tooltip.start = 'Sperrzone: Klick für Startpunkt (rot)';
            L.drawLocal.draw.handlers.polygon.tooltip.cont = 'Sperrzone weiterzeichnen';
            L.drawLocal.draw.handlers.polygon.tooltip.end = 'Ersten Punkt anklicken zum Schließen';
          } else {
            L.drawLocal.draw.handlers.polygon.tooltip.start =
              'Erste Linie = Dachaußenkante – Klick für Startpunkt';
            L.drawLocal.draw.handlers.polygon.tooltip.cont =
              'Weiter – Module folgen der ersten Kante';
            L.drawLocal.draw.handlers.polygon.tooltip.end =
              'Ersten Punkt anklicken zum Schließen';
          }
        }
      }
      const btn = modal.querySelector('.leaflet-draw-draw-polygon');
      if (btn) {
        btn.title = hint;
        btn.setAttribute('aria-label', hint);
      }
    }

    function syncDrawOptions() {
      applyDrawModeUi();
      if (!drawControl || typeof drawControl.setDrawingOptions !== 'function') return;
      drawControl.setDrawingOptions({
        polygon: {
          allowIntersection: true,
          showArea: false,
          shapeOptions: currentDrawShapeOptions(),
        },
      });
    }

    function setDrawMode(mode) {
      const hidden = document.getElementById('layout-draw-mode');
      if (hidden) hidden.value = mode === 'obstacle' ? 'obstacle' : 'roof';
      syncDrawOptions();
    }

    function startPolygonDraw() {
      if (!map || !L.Draw || !L.Draw.Polygon) return;
      syncDrawOptions();
      // laufendes Zeichnen abbrechen falls aktiv
      if (map._pvlActiveDrawer && map._pvlActiveDrawer.disable) {
        try { map._pvlActiveDrawer.disable(); } catch (_) { /* ignore */ }
      }
      const drawer = new L.Draw.Polygon(map, {
        allowIntersection: true,
        showArea: false,
        shapeOptions: currentDrawShapeOptions(),
      });
      map._pvlActiveDrawer = drawer;
      drawer.enable();
    }

    function ensureMap() {
      if (map) {
        populateBasemapSelect();
        setTimeout(() => map.invalidateSize(), 50);
        return;
      }
      map = L.map(mapEl, { zoomControl: true, maxZoom: 23, minZoom: 14 }).setView([48.2082, 16.3738], 19);

      baseLayers = {};
      enabledProviders().forEach((p) => {
        const nativeMax = p.maxZoom || 19;
        baseLayers[p.id] = L.tileLayer(p.url, {
          maxZoom: 23,
          maxNativeZoom: nativeMax,
          attribution: p.attribution || '',
          crossOrigin: true,
        });
      });

      populateBasemapSelect();
      const startId = currentProvider && baseLayers[currentProvider]
        ? currentProvider
        : (enabledProviders()[0] && enabledProviders()[0].id);
      if (startId) switchBasemap(startId);

      polyLayer = new L.FeatureGroup().addTo(map);
      pitchArrowLayer = new L.LayerGroup().addTo(map);
      moduleLayer = new L.FeatureGroup().addTo(map);
      modulePitchArrowLayer = new L.LayerGroup().addTo(map);
      houseNumberLayer = new L.LayerGroup().addTo(map);

      if (L.Control && L.Control.Draw) {
        applyDrawModeUi();
        drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              allowIntersection: true,
              showArea: false,
              shapeOptions: ROOF_STYLE,
            },
            polyline: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false,
          },
          edit: { featureGroup: polyLayer, remove: true },
        });
        map.addControl(drawControl);
        setTimeout(() => {
          applyDrawModeUi();
          syncDrawOptions();
        }, 0);
        map.on(L.Draw.Event.CREATED, (e) => {
          pushUndo();
          const isObstacle = currentDrawMode() === 'obstacle';
          const kind = isObstacle ? 'obstacle' : 'roof';
          readMetaFromForm();
          const layer = e.layer;
          layer.setStyle(styleFor(kind, false));
          layer._pvlKind = kind;
          if (kind === 'roof') {
            const orient = firstEdgeOrientation(ringFromLayer(layer));
            layer._pvlMeta = {
              tilt: planMeta.tilt,
              edgeAngleDeg: orient.edgeAngleDeg,
              bearingDeg: orient.bearingDeg,
              azimuth: orient.edgeAngleDeg,
            };
            const azEl = document.getElementById('layout-azimuth');
            if (azEl) azEl.value = String(Math.round(orient.bearingDeg));
          } else {
            layer._pvlMeta = {};
          }
          attachPolyHandlers(layer);
          polyLayer.addLayer(layer);
          selectPoly(layer);
          refreshPitchArrows();
          updateCountUi();
          map._pvlActiveDrawer = null;
        });
        map.on('draw:editstart', () => {
          pushUndo();
        });
        map.on('draw:deletestart', () => {
          pushUndo();
        });
        map.on(L.Draw.Event.DELETED, () => {
          if (selectedPoly && polyLayer && !polyLayer.hasLayer(selectedPoly)) {
            selectedPoly = null;
          }
          refreshPolyStyles();
          refreshPitchArrows();
          updateCountUi();
        });
        map.on(L.Draw.Event.EDITED, (e) => {
          const layers = e.layers;
          if (layers && typeof layers.eachLayer === 'function') {
            layers.eachLayer((layer) => {
              if (layer._pvlKind === 'roof') syncRoofMetaFromGeometry(layer);
            });
          }
          if (selectedPoly && selectedPoly._pvlKind === 'roof') {
            selectPoly(selectedPoly);
          }
          refreshPitchArrows();
        });
        map.on('draw:drawstop', () => {
          map._pvlActiveDrawer = null;
        });
      }

      map.on('moveend', scheduleHouseNumbers);
      map.on('zoomend', scheduleHouseNumbers);
      map.on('mousemove', onModuleDragMove);
      map.on('mousedown', onMapSelectMouseDown);
      map.on('mousemove', onMapSelectMouseMove);
      map.on('mouseup', onMapSelectMouseUp);
      map.on('click', onMapSelectClick);
      map.on('dblclick', onMapSelectDblClick);
      setTimeout(scheduleHouseNumbers, 200);
    }

    function scheduleHouseNumbers() {
      clearTimeout(houseNumberTimer);
      houseNumberTimer = setTimeout(loadHouseNumbers, 350);
    }

    async function loadHouseNumbers() {
      if (!map || !houseNumberLayer) return;
      const zoom = map.getZoom();
      if (zoom < 18) {
        houseNumberLayer.clearLayers();
        return;
      }
      const b = map.getBounds();
      const seq = ++houseNumberSeq;
      const qs = new URLSearchParams({
        south: String(b.getSouth()),
        west: String(b.getWest()),
        north: String(b.getNorth()),
        east: String(b.getEast()),
      });
      try {
        const res = await fetch('/api/geo/housenumbers?' + qs.toString(), { credentials: 'same-origin' });
        if (!res.ok) return;
        const j = await res.json();
        if (seq !== houseNumberSeq) return;
        const list = j.results || [];
        houseNumberLayer.clearLayers();
        list.forEach((h) => {
          const title = [h.street, h.number].filter(Boolean).join(' ');
          const icon = L.divIcon({
            className: 'layout-hn-marker',
            html: `<span class="layout-hn" title="${title.replace(/"/g, '&quot;')}">${String(h.number).replace(/</g, '')}</span>`,
            iconSize: [28, 18],
            iconAnchor: [14, 9],
          });
          L.marker([h.lat, h.lng], { icon, interactive: false, keyboard: false }).addTo(houseNumberLayer);
        });
      } catch (_) {
        /* ignore transient Overpass errors */
      }
    }

    function getRoofPolygons() {
      if (!polyLayer) return [];
      return polyLayer.getLayers()
        .filter((layer) => layer._pvlKind === 'roof')
        .map((layer) => {
          syncRoofMetaFromGeometry(layer);
          const meta = layer._pvlMeta || {};
          return {
            ring: ringFromLayer(layer),
            tilt: meta.tilt != null ? Number(meta.tilt) : 30,
            azimuth: meta.bearingDeg != null ? Number(meta.bearingDeg) : 180,
            bearingDeg: meta.bearingDeg != null ? Number(meta.bearingDeg) : 180,
            edgeAngleDeg: meta.edgeAngleDeg != null ? Number(meta.edgeAngleDeg) : 0,
          };
        })
        .filter((r) => r.ring && r.ring.length >= 3);
    }

    function getObstacleLatLngs() {
      if (!polyLayer) return [];
      return polyLayer.getLayers()
        .filter((layer) => layer._pvlKind === 'obstacle')
        .map((layer) => ringFromLayer(layer))
        .filter((ring) => ring.length >= 3);
    }

    function moduleRectLatLngs(m) {
      syncModuleProjectedSize(m, { catalogDims: dims() });
      const proj = makeProjector(m.lat, m.lng);
      const angle = deg2rad(m.azimuth || 0);
      const corners = rectCorners(0, 0, m.widthM, m.heightM, angle);
      return corners.map((c) => {
        const ll = proj.toLatLng(c.x, c.y);
        return [ll.lat, ll.lng];
      });
    }

    function moduleCornersXY(m, proj) {
      syncModuleProjectedSize(m, { catalogDims: dims() });
      const p = proj || makeProjector(m.lat, m.lng);
      const center = p.toXY(m.lat, m.lng);
      const angle = deg2rad(m.azimuth || 0);
      return rectCorners(center.x, center.y, m.widthM, m.heightM, angle);
    }

    function normalizeAngleDiff(deg) {
      let d = deg % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      return d;
    }

    function edgeAngleDegXY(a, b) {
      return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    }

    function signedDistPointToLine(p, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return ((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    }

    function collectSnapTargetEdgesXY(proj, excludeModuleIdxs) {
      const exclude = {};
      if (Array.isArray(excludeModuleIdxs)) {
        excludeModuleIdxs.forEach((i) => { exclude[i] = true; });
      } else if (excludeModuleIdxs != null) {
        exclude[excludeModuleIdxs] = true;
      }
      const edges = [];
      if (polyLayer) {
        polyLayer.eachLayer((layer) => {
          const ring = ringFromLayer(layer);
          if (ring.length < 2) return;
          const pts = ring.map((p) => proj.toXY(p.lat, p.lng));
          for (let i = 0; i < pts.length; i++) {
            edges.push({ a: pts[i], b: pts[(i + 1) % pts.length], kind: 'roof' });
          }
        });
      }
      modules.forEach((m, i) => {
        if (exclude[i] || !m) return;
        const corners = moduleCornersXY(m, proj);
        for (let ei = 0; ei < 4; ei++) {
          edges.push({
            a: corners[ei],
            b: corners[(ei + 1) % 4],
            kind: 'module',
            corners,
          });
        }
      });
      return edges;
    }

    function edgeUnitAxes(a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        tx: dx / len,
        ty: dy / len,
        nx: dy / len,
        ny: -dx / len,
        len,
      };
    }

    function projectOnAxis(p, origin, tx, ty) {
      return (p.x - origin.x) * tx + (p.y - origin.y) * ty;
    }

    function edgeProjectionsOverlap(me, te, tx, ty, padM) {
      const o = te.a;
      const a0 = projectOnAxis(me.a, o, tx, ty);
      const a1 = projectOnAxis(me.b, o, tx, ty);
      const b0 = projectOnAxis(te.a, o, tx, ty);
      const b1 = projectOnAxis(te.b, o, tx, ty);
      const amin = Math.min(a0, a1);
      const amax = Math.max(a0, a1);
      const bmin = Math.min(b0, b1);
      const bmax = Math.max(b0, b1);
      const pad = padM == null ? SNAP_EDGE_OVERLAP_PAD_M : padM;
      return amin <= bmax + pad && bmin <= amax + pad;
    }

    function bestLateralCornerShift(meCorners, teCorners, origin, tx, ty) {
      let best = null;
      meCorners.forEach((mc) => {
        teCorners.forEach((tc) => {
          const d = projectOnAxis(tc, origin, tx, ty) - projectOnAxis(mc, origin, tx, ty);
          const ad = Math.abs(d);
          if (ad <= SNAP_CORNER_M && (best == null || ad < best.ad)) {
            best = { ad, d };
          }
        });
      });
      return best ? best.d : 0;
    }

    /** Kanten-/Ecken-Snap an Dach- und Modul-Kanten (magnetisch, inkl. Modulspalt). */
    function applyEdgeSnap(m, excludeModuleIdxs, snapOpts) {
      if (!snapEnabled || !m) return m;
      const gapRaw = Number(planMeta.gapM);
      const gapM = Number.isFinite(gapRaw) ? Math.max(0, gapRaw) : 0.02;
      let cur = { ...m };
      // Zwei Durchläufe: erst eine Achse, dann die orthogonale
      for (let pass = 0; pass < 2; pass++) {
        cur = snapModuleOnce(cur, excludeModuleIdxs, gapM, snapOpts);
      }
      return cur;
    }

    function snapModuleOnce(m, excludeModuleIdxs, gapM, snapOpts) {
      const proj = makeProjector(m.lat, m.lng);
      const targets = collectSnapTargetEdgesXY(proj, excludeModuleIdxs);
      if (!targets.length) return m;

      let azimuth = Number(m.azimuth) || 0;
      const skipAngle = !!(snapOpts && snapOpts.skipAngle);
      let angleSnapped = false;
      if (!skipAngle) {
        let bestAng = null;
        targets.forEach((te) => {
          const tAng = edgeAngleDegXY(te.a, te.b);
          [0, 90, -90, 180, -180].forEach((off) => {
            const diff = Math.abs(normalizeAngleDiff(azimuth - (tAng + off)));
            if (diff <= SNAP_ANGLE_DEG && (bestAng == null || diff < bestAng.diff)) {
              bestAng = { diff, value: tAng + off };
            }
          });
        });
        if (bestAng) {
          azimuth = bestAng.value;
          angleSnapped = true;
        }
      }

      const center = proj.toXY(m.lat, m.lng);
      const corners = rectCorners(center.x, center.y, m.widthM, m.heightM, deg2rad(azimuth));
      const modEdges = [];
      for (let i = 0; i < 4; i++) {
        modEdges.push({ a: corners[i], b: corners[(i + 1) % 4] });
      }

      let best = null; // { score, shiftX, shiftY }

      const consider = (score, shiftX, shiftY) => {
        if (!Number.isFinite(score) || score > SNAP_DIST_M + 1e-9) return;
        if (!best || score < best.score - 1e-9
          || (Math.abs(score - best.score) < 1e-9
            && (Math.abs(shiftX) + Math.abs(shiftY)) < (Math.abs(best.shiftX) + Math.abs(best.shiftY)))) {
          best = { score, shiftX, shiftY };
        }
      };

      modEdges.forEach((me) => {
        const mAng = edgeAngleDegXY(me.a, me.b);
        const mid = { x: (me.a.x + me.b.x) / 2, y: (me.a.y + me.b.y) / 2 };
        const meCorners = [me.a, me.b];
        targets.forEach((te) => {
          const tAng = edgeAngleDegXY(te.a, te.b);
          const adiff = Math.abs(normalizeAngleDiff(mAng - tAng));
          const parallel = adiff <= SNAP_ANGLE_DEG || Math.abs(adiff - 180) <= SNAP_ANGLE_DEG;
          if (!parallel) return;
          const { tx, ty, nx, ny } = edgeUnitAxes(te.a, te.b);
          if (!edgeProjectionsOverlap(me, te, tx, ty, SNAP_EDGE_OVERLAP_PAD_M)) return;

          const dist = signedDistPointToLine(mid, te.a, te.b);
          const wants = te.kind === 'module' ? [gapM, -gapM] : [0];
          const teCorners = te.corners || [te.a, te.b];
          wants.forEach((want) => {
            const err = dist - want;
            const ad = Math.abs(err);
            if (ad > SNAP_DIST_M) return;
            const lat = bestLateralCornerShift(meCorners, teCorners, te.a, tx, ty);
            const shiftX = -err * nx + lat * tx;
            const shiftY = -err * ny + lat * ty;
            // Leichte Preferenz für Modul-zu-Modul und Ecken-Ausrichtung
            const score = ad
              + (te.kind === 'module' ? 0 : 0.02)
              + (lat ? 0 : 0.015);
            consider(score, shiftX, shiftY);
          });
        });
      });

      // Ecken-Snap an andere Modul-Ecken (Raster-Ausrichtung)
      targets.forEach((te) => {
        if (te.kind !== 'module' || !te.corners) return;
        corners.forEach((mc) => {
          te.corners.forEach((tc) => {
            const dx = tc.x - mc.x;
            const dy = tc.y - mc.y;
            const d = Math.hypot(dx, dy);
            if (d > SNAP_CORNER_M) return;
            consider(d + 0.005, dx, dy);
          });
        });
      });

      if (!best && !angleSnapped) return m;
      const shiftX = best ? best.shiftX : 0;
      const shiftY = best ? best.shiftY : 0;
      const snapped = proj.toLatLng(center.x + shiftX, center.y + shiftY);
      return {
        ...m,
        lat: snapped.lat,
        lng: snapped.lng,
        azimuth,
      };
    }

    function offsetModuleClone(m, distM) {
      const proj = makeProjector(m.lat, m.lng);
      const ang = deg2rad((m.azimuth || 0) + 90);
      const ll = proj.toLatLng(Math.cos(ang) * distM, Math.sin(ang) * distM);
      const clone = {
        ...m,
        lat: ll.lat,
        lng: ll.lng,
      };
      syncModuleProjectedSize(clone, { catalogDims: dims() });
      return clone;
    }

    function offsetRingMeters(ring, dxM, dyM) {
      if (!ring.length) return ring;
      const proj = makeProjector(ring[0].lat, ring[0].lng);
      return ring.map((p) => {
        const xy = proj.toXY(p.lat, p.lng);
        const ll = proj.toLatLng(xy.x + dxM, xy.y + dyM);
        return { lat: ll.lat, lng: ll.lng };
      });
    }

    function renderModules() {
      if (!moduleLayer) return;
      moduleLayer.clearLayers();
      const interactive = editorStep === 'modules';
      modules.forEach((m, idx) => {
        const selected = isModuleSelected(idx);
        const poly = L.polygon(moduleRectLatLngs(m), {
          color: selected ? '#1e3a8a' : '#1e40af',
          weight: selected ? 3 : 1,
          fillColor: selected ? '#3b82f6' : '#60a5fa',
          fillOpacity: selected ? 0.78 : 0.55,
          className: 'layout-module-poly',
          interactive,
        });
        poly._pvlModuleIdx = idx;
        if (interactive) {
          poly.on('click', (e) => {
            if (e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
            if (activeSelectTool) return;
            if (suppressModuleClick) {
              suppressModuleClick = false;
              selectionHandledOnDown = false;
              return;
            }
            if (moduleDragMoved) {
              moduleDragMoved = false;
              selectionHandledOnDown = false;
              return;
            }
            // Mousedown hat Auswahl bereits gesetzt – Click darf Mehrfachauswahl nicht auf 1 Modul reduzieren
            if (selectionHandledOnDown) {
              selectionHandledOnDown = false;
              return;
            }
            const shift = e.originalEvent && e.originalEvent.shiftKey;
            selectModule(idx, { toggle: !!shift });
          });
          poly.on('mousedown', (e) => {
            if (activeSelectTool) return;
            if (e && e.originalEvent && e.originalEvent.button !== 0) return;
            L.DomEvent.stopPropagation(e);
            if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent);
            const shift = e.originalEvent && e.originalEvent.shiftKey;
            moduleDragMoved = false;
            if (shift) {
              selectModule(idx, { toggle: true, skipRender: true });
              suppressModuleClick = true;
              selectionHandledOnDown = true;
              return;
            }
            suppressModuleClick = false;
            selectionHandledOnDown = true;
            if (!isModuleSelected(idx)) {
              selectModule(idx, { skipRender: true });
            } else {
              refreshModuleStylesOnly();
              updateSelectionChrome();
            }
            const ll = e.latlng;
            const idxs = selectedModuleIdxs.length ? selectedModuleIdxs.slice() : [idx];
            moduleDrag = {
              idx,
              startLat: ll.lat,
              startLng: ll.lng,
              originals: idxs.map((i) => ({
                i,
                lat: modules[i].lat,
                lng: modules[i].lng,
                azimuth: Number(modules[i].azimuth) || 0,
              })),
              pushedUndo: false,
            };
            if (map && map.dragging) map.dragging.disable();
          });
          poly.on('wheel', (e) => {
            if (!isModuleSelected(idx)) return;
            if (e.originalEvent) {
              L.DomEvent.preventDefault(e.originalEvent);
              L.DomEvent.stopPropagation(e.originalEvent);
            }
            const step = e.originalEvent && e.originalEvent.shiftKey ? 15 : 3;
            const dir = (e.originalEvent && e.originalEvent.deltaY > 0) ? step : -step;
            rotateSelectedModules(dir);
          });
        }
        moduleLayer.addLayer(poly);
      });
      applyStepMapInteractivity();
      updateCountUi();
      refreshModulePitchArrows();
      updateRotateHandle();
    }

    function endModuleDrag(skipSnap) {
      if (!moduleDrag) return;
      const drag = moduleDrag;
      moduleDrag = null;
      if (map && map.dragging) map.dragging.enable();
      if (skipSnap || !drag.originals || !drag.originals.length) return;
      const primaryIdx = drag.idx;
      if (!modules[primaryIdx]) {
        renderModules();
        return;
      }
      const before = {
        lat: modules[primaryIdx].lat,
        lng: modules[primaryIdx].lng,
        azimuth: modules[primaryIdx].azimuth,
      };
      const exclude = drag.originals.map((o) => o.i);
      // Beim Verschieben Winkel nicht magnetisch überschreiben (freie 360°-Drehung bleibt)
      const snapped = applyEdgeSnap(modules[primaryIdx], exclude, { skipAngle: true });
      const dLat = snapped.lat - before.lat;
      const dLng = snapped.lng - before.lng;
      drag.originals.forEach(({ i }) => {
        if (!modules[i]) return;
        if (i === primaryIdx) {
          modules[i] = { ...snapped, azimuth: before.azimuth };
        } else {
          modules[i].lat += dLat;
          modules[i].lng += dLng;
        }
      });
      renderModules();
    }

    function onModuleDragMove(e) {
      if (!moduleDrag || !e.latlng || !moduleDrag.originals) return;
      if (!moduleDrag.pushedUndo) {
        pushUndo();
        moduleDrag.pushedUndo = true;
      }
      const dLat = e.latlng.lat - moduleDrag.startLat;
      const dLng = e.latlng.lng - moduleDrag.startLng;
      if (Math.abs(dLat) > 1e-8 || Math.abs(dLng) > 1e-8) moduleDragMoved = true;
      const primaryIdx = moduleDrag.idx;

      moduleDrag.originals.forEach(({ i, lat, lng, azimuth }) => {
        if (!modules[i]) return;
        modules[i].lat = lat + dLat;
        modules[i].lng = lng + dLng;
        modules[i].azimuth = azimuth;
      });

      // Snap am primären Modul (nur Position), Delta auf Gruppe
      if (modules[primaryIdx] && snapEnabled) {
        const before = { lat: modules[primaryIdx].lat, lng: modules[primaryIdx].lng, azimuth: modules[primaryIdx].azimuth };
        const exclude = moduleDrag.originals.map((o) => o.i);
        const snapped = applyEdgeSnap(modules[primaryIdx], exclude, { skipAngle: true });
        const sLat = snapped.lat - before.lat;
        const sLng = snapped.lng - before.lng;
        moduleDrag.originals.forEach(({ i, azimuth }) => {
          if (!modules[i]) return;
          if (i === primaryIdx) {
            modules[i] = { ...snapped, azimuth };
          } else {
            modules[i].lat += sLat;
            modules[i].lng += sLng;
            modules[i].azimuth = azimuth;
          }
        });
      }

      if (!moduleLayer) return;
      const layers = moduleLayer.getLayers();
      moduleDrag.originals.forEach(({ i }) => {
        const layer = layers.find((l) => l._pvlModuleIdx === i);
        if (layer && modules[i]) layer.setLatLngs(moduleRectLatLngs(modules[i]));
      });
      refreshModulePitchArrows();
    }

    /**
     * Freie Drehung (kein Winkel-Snap): Gruppe starr um Selection-Centroid,
     * Einzelmodul nur azimuth um die eigene Mitte.
     */
    function rotateSelectedModules(deltaDeg, rotateOpts) {
      if (!selectedModuleIdxs.length) return;
      const o = rotateOpts || {};
      if (!o.skipUndo) pushUndo();
      const delta = Number(deltaDeg) || 0;
      if (!delta) return;
      const centroid = o.centroid || selectionCentroidLatLng();
      if (!centroid) return;
      const proj = makeProjector(centroid.lat, centroid.lng);
      const rad = deg2rad(delta);
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      selectedModuleIdxs.forEach((idx) => {
        const m = modules[idx];
        if (!m) return;
        const xy = proj.toXY(m.lat, m.lng);
        const rx = xy.x * cosA - xy.y * sinA;
        const ry = xy.x * sinA + xy.y * cosA;
        const ll = proj.toLatLng(rx, ry);
        m.lat = ll.lat;
        m.lng = ll.lng;
        m.azimuth = normalizeAzimuth((Number(m.azimuth) || 0) + delta);
      });
      if (!o.skipRender) renderModules();
      else {
        if (!moduleLayer) return;
        const layers = moduleLayer.getLayers();
        selectedModuleIdxs.forEach((i) => {
          const layer = layers.find((l) => l._pvlModuleIdx === i);
          if (layer && modules[i]) layer.setLatLngs(moduleRectLatLngs(modules[i]));
        });
        refreshModulePitchArrows();
        updateRotateHandle();
      }
    }

    function clearRotateHandle() {
      if (rotateHandleLayer) rotateHandleLayer.clearLayers();
    }

    function updateRotateHandle() {
      if (!map) return;
      if (!rotateHandleLayer) {
        rotateHandleLayer = L.layerGroup().addTo(map);
      }
      rotateHandleLayer.clearLayers();
      if (editorStep !== 'modules' || !selectedModuleIdxs.length || rotateDrag) return;
      const c = selectionCentroidLatLng();
      if (!c) return;
      const proj = makeProjector(c.lat, c.lng);
      // Henkel ~1,5 m „oben“ (lokal +Y); bei Auswahl zusätzlich entlang Mittel-Azimut
      let avgAz = 0;
      let n = 0;
      selectedModuleIdxs.forEach((i) => {
        if (!modules[i]) return;
        avgAz += Number(modules[i].azimuth) || 0;
        n += 1;
      });
      const az = n ? avgAz / n : 90;
      const handleDist = 1.55;
      const tip = proj.toLatLng(
        Math.cos(deg2rad(az + 90)) * handleDist,
        Math.sin(deg2rad(az + 90)) * handleDist,
      );
      const line = L.polyline([[c.lat, c.lng], [tip.lat, tip.lng]], {
        color: '#1e3a8a',
        weight: 2,
        dashArray: '4 3',
        interactive: false,
        className: 'layout-rotate-stem',
      });
      const marker = L.circleMarker([tip.lat, tip.lng], {
        radius: 9,
        color: '#1e3a8a',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
        className: 'layout-rotate-handle',
        interactive: true,
      });
      marker.bindTooltip('Drehen (ziehen)', { direction: 'top', opacity: 0.85 });
      marker.on('mousedown', (e) => {
        if (e && e.originalEvent && e.originalEvent.button !== 0) return;
        L.DomEvent.stopPropagation(e);
        if (e.originalEvent) L.DomEvent.preventDefault(e.originalEvent);
        const centroid = selectionCentroidLatLng();
        if (!centroid) return;
        const ll = e.latlng || tip;
        rotateDrag = {
          centroid,
          startAngleDeg: angleDegFromCentroid(ll, centroid),
          originals: selectedModuleIdxs.filter((i) => modules[i]).map((i) => ({
            i,
            lat: modules[i].lat,
            lng: modules[i].lng,
            azimuth: Number(modules[i].azimuth) || 0,
          })),
          pushedUndo: false,
        };
        if (map && map.dragging) map.dragging.disable();
      });
      rotateHandleLayer.addLayer(line);
      rotateHandleLayer.addLayer(marker);
    }

    function onRotateDragMove(e) {
      if (!rotateDrag || !e.latlng) return;
      if (!rotateDrag.pushedUndo) {
        pushUndo();
        rotateDrag.pushedUndo = true;
      }
      const ang = angleDegFromCentroid(e.latlng, rotateDrag.centroid);
      let delta = ang - rotateDrag.startAngleDeg;
      delta = ((delta + 540) % 360) - 180;
      const proj = makeProjector(rotateDrag.centroid.lat, rotateDrag.centroid.lng);
      const rad = deg2rad(delta);
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      rotateDrag.originals.forEach(({ i, lat, lng, azimuth }) => {
        if (!modules[i]) return;
        const xy = proj.toXY(lat, lng);
        const rx = xy.x * cosA - xy.y * sinA;
        const ry = xy.x * sinA + xy.y * cosA;
        const ll = proj.toLatLng(rx, ry);
        modules[i].lat = ll.lat;
        modules[i].lng = ll.lng;
        modules[i].azimuth = normalizeAzimuth(azimuth + delta);
      });
      if (!moduleLayer) return;
      const layers = moduleLayer.getLayers();
      rotateDrag.originals.forEach(({ i }) => {
        const layer = layers.find((l) => l._pvlModuleIdx === i);
        if (layer && modules[i]) layer.setLatLngs(moduleRectLatLngs(modules[i]));
      });
      refreshModulePitchArrows();
      // Henkel der Maus nachführen
      if (rotateHandleLayer) {
        rotateHandleLayer.clearLayers();
        const c = rotateDrag.centroid;
        const tip = e.latlng;
        rotateHandleLayer.addLayer(L.polyline([[c.lat, c.lng], [tip.lat, tip.lng]], {
          color: '#1e3a8a', weight: 2, dashArray: '4 3', interactive: false,
        }));
        rotateHandleLayer.addLayer(L.circleMarker([tip.lat, tip.lng], {
          radius: 9, color: '#1e3a8a', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false,
        }));
      }
    }

    function endRotateDrag() {
      if (!rotateDrag) return;
      rotateDrag = null;
      if (map && map.dragging) map.dragging.enable();
      renderModules();
    }

    function duplicateSelection() {
      if (selectedModuleIdxs.length) {
        pushUndo();
        const clones = selectedModuleIdxs
          .filter((i) => modules[i])
          .map((i) => offsetModuleClone(modules[i], 0.35));
        const start = modules.length;
        modules.push(...clones);
        setSelectedModules(clones.map((_, k) => start + k));
        return;
      }
      if (selectedPoly && polyLayer && polyLayer.hasLayer(selectedPoly)) {
        pushUndo();
        const kind = selectedPoly._pvlKind || 'roof';
        const ring = ringFromLayer(selectedPoly);
        const meta = selectedPoly._pvlMeta ? { ...selectedPoly._pvlMeta } : {};
        const shifted = offsetRingMeters(ring, 0.5, 0.5);
        const layer = addPolygonLayer(kind, shifted.map((p) => [p.lat, p.lng]), meta);
        selectPoly(layer);
        refreshPitchArrows();
      }
    }

    function deleteSelection() {
      if (selectedModuleIdxs.length) {
        pushUndo();
        const remove = {};
        selectedModuleIdxs.forEach((i) => { remove[i] = true; });
        modules = modules.filter((_, i) => !remove[i]);
        selectedModuleIdxs = [];
        renderModules();
        return;
      }
      if (selectedPoly && polyLayer) {
        pushUndo();
        polyLayer.removeLayer(selectedPoly);
        selectedPoly = null;
        refreshPolyStyles();
        refreshPitchArrows();
        updateCountUi();
      }
    }

    function updateCountUi() {
      const el = document.getElementById('layout-module-count');
      if (el) el.textContent = String(modules.length);
      const countEl = document.getElementById('layout-stat-count');
      if (countEl) countEl.textContent = modules.length + ' #';
      const kwpEl = document.getElementById('layout-stat-kwp');
      if (kwpEl) {
        const wp = dims().wp || 455;
        const kwp = (modules.length * wp) / 1000;
        kwpEl.textContent = kwp.toFixed(2).replace('.', ',') + ' kWp';
      }
    }

    function modulesInsideLatLngPoly(ringLatLng) {
      if (!ringLatLng || ringLatLng.length < 3) return [];
      const lat0 = ringLatLng.reduce((s, p) => s + p.lat, 0) / ringLatLng.length;
      const lng0 = ringLatLng.reduce((s, p) => s + p.lng, 0) / ringLatLng.length;
      const proj = makeProjector(lat0, lng0);
      const poly = ringLatLng.map((p) => proj.toXY(p.lat, p.lng));
      const hits = [];
      modules.forEach((m, i) => {
        if (!m) return;
        const center = proj.toXY(m.lat, m.lng);
        const corners = moduleCornersXY(m, proj);
        if (rectHitsPoly(center, corners, poly)) hits.push(i);
      });
      return hits;
    }

    function modulesInsideBounds(bounds) {
      if (!bounds) return [];
      const hits = [];
      modules.forEach((m, i) => {
        if (!m) return;
        if (bounds.contains([m.lat, m.lng])) {
          hits.push(i);
          return;
        }
        const corners = moduleRectLatLngs(m);
        for (let c = 0; c < corners.length; c++) {
          if (bounds.contains(corners[c])) {
            hits.push(i);
            return;
          }
        }
      });
      return hits;
    }

    function readMetaFromForm() {
      planMeta.tilt = Number(document.getElementById('layout-tilt').value) || 30;
      const tiltCrossEl = document.getElementById('layout-tilt-cross');
      planMeta.tiltCross = tiltCrossEl ? (Number(tiltCrossEl.value) || 0) : (planMeta.tiltCross || 0);
      planMeta.azimuth = Number(document.getElementById('layout-azimuth').value) || 180;
      planMeta.setbackM = Number(document.getElementById('layout-setback').value) || 0.3;
      planMeta.gapM = Number(document.getElementById('layout-gap').value) || 0.02;
      planMeta.landscape = !!(document.getElementById('layout-landscape') || {}).checked;
      planMeta.moduleType = (document.getElementById('layout-module-type') || {}).value || 'das';
    }

    function writeMetaToForm() {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('layout-tilt', planMeta.tilt);
      set('layout-tilt-cross', planMeta.tiltCross != null ? planMeta.tiltCross : 0);
      set('layout-azimuth', planMeta.azimuth);
      set('layout-setback', planMeta.setbackM);
      set('layout-gap', planMeta.gapM);
      const ls = document.getElementById('layout-landscape');
      if (ls) ls.checked = !!planMeta.landscape;
      const mt = document.getElementById('layout-module-type');
      if (mt) mt.value = planMeta.moduleType || 'das';
      updateTiltLabels();
      updateModuleSizeLabel();
    }

    function updateTiltLabels() {
      const tiltLab = document.getElementById('layout-tilt-label');
      const crossLab = document.getElementById('layout-tilt-cross-label');
      const landscape = !!(document.getElementById('layout-landscape') || {}).checked
        || !!planMeta.landscape;
      // Quer: lange Seite // Traufe → Neigung verkürzt die kurze Seite (First)
      if (tiltLab) {
        tiltLab.innerHTML = landscape
          ? 'Neigung ° <span class="hint" style="font-weight:400">(kurze Seite / First)</span>'
          : 'Neigung ° <span class="hint" style="font-weight:400">(lange Seite / First)</span>';
      }
      if (crossLab) {
        crossLab.innerHTML = landscape
          ? 'Querneg. ° <span class="hint" style="font-weight:400">(lange Seite)</span>'
          : 'Querneg. ° <span class="hint" style="font-weight:400">(kurze Seite)</span>';
      }
    }

    function runAutoLayout() {
      readMetaFromForm();
      // Formular-Neigung: auf Selektion, sonst auf alle Dächer (sonst bleibt oft Default 30°)
      if (selectedPoly && selectedPoly._pvlKind === 'roof') {
        applyFormMetaToSelectedRoof();
      } else {
        applyFormTiltToRoofs('all');
      }
      const roofs = getRoofPolygons();
      if (!roofs.length) {
        alert('Bitte zuerst mindestens eine Dachfläche zeichnen.');
        return;
      }
      pushUndo();
      const d = dims();
      const obstacles = getObstacleLatLngs();
      const all = [];
      roofs.forEach((roof) => {
        const tilt = roof.tilt != null ? Number(roof.tilt) : planMeta.tilt;
        const tiltCross = planMeta.tiltCross != null ? Number(planMeta.tiltCross) : 0;
        const placed = autoLayoutModules(roof.ring, obstacles, {
          widthM: d.widthM,
          heightM: d.heightM,
          gapM: planMeta.gapM,
          setbackM: planMeta.setbackM,
          edgeAngleDeg: roof.edgeAngleDeg,
          azimuth: roof.bearingDeg,
          landscape: planMeta.landscape,
          tilt,
          tiltCross,
        });
        all.push(...placed);
      });
      modules = all;
      selectedModuleIdxs = [];
      renderModules();
      updateSelectionChrome();
    }

    function addManualModule() {
      readMetaFromForm();
      applyFormMetaToSelectedRoof();
      const center = map.getCenter();
      const d = dims();
      let tilt = Number(planMeta.tilt) || 0;
      let tiltCross = Number(planMeta.tiltCross) || 0;
      let edgeAngleDeg = 0;
      let bearingDeg = planMeta.azimuth;
      if (selectedPoly && selectedPoly._pvlKind === 'roof') {
        syncRoofMetaFromGeometry(selectedPoly);
        edgeAngleDeg = selectedPoly._pvlMeta.edgeAngleDeg || 0;
        bearingDeg = selectedPoly._pvlMeta.bearingDeg != null
          ? selectedPoly._pvlMeta.bearingDeg
          : bearingDeg;
        if (selectedPoly._pvlMeta.tilt != null) tilt = Number(selectedPoly._pvlMeta.tilt);
      } else {
        const roofs = getRoofPolygons();
        if (roofs.length) {
          edgeAngleDeg = roofs[0].edgeAngleDeg;
          bearingDeg = roofs[0].bearingDeg;
          if (roofs[0].tilt != null) tilt = Number(roofs[0].tilt);
        }
      }
      const foot = projectedModuleFootprint(d.widthM, d.heightM, 0, 0, planMeta.landscape);
      pushUndo();
      const mod = {
        lat: center.lat,
        lng: center.lng,
        physWidthM: foot.alongEave,
        physHeightM: foot.alongSlope,
        azimuth: edgeAngleDeg,
        bearingDeg,
        tilt,
        tiltCross,
        landscape: planMeta.landscape,
      };
      syncModuleProjectedSize(mod, { catalogDims: d });
      modules.push(mod);
      setSelectedModules([modules.length - 1]);
    }

    function clearModules() {
      if (!modules.length) return;
      pushUndo();
      modules = [];
      selectedModuleIdxs = [];
      renderModules();
    }

    function clearRoof() {
      const hasPolys = polyLayer && polyLayer.getLayers().length;
      if (!hasPolys && !modules.length) return;
      if (!suppressUndo) pushUndo();
      if (polyLayer) polyLayer.clearLayers();
      selectedPoly = null;
      selectedModuleIdxs = [];
      modules = [];
      refreshPitchArrows();
      renderModules();
    }

    function serializePlan() {
      readMetaFromForm();
      applyFormMetaToSelectedRoof();
      const roofs = getRoofPolygons();
      return {
        version: 2,
        meta: { ...planMeta },
        roofs,
        roof: roofs.length ? roofs[0].ring : null,
        obstacles: getObstacleLatLngs(),
        modules: modules.slice(),
        center: map ? { lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom() } : null,
      };
    }

    function loadPlan(plan) {
      const prevSuppress = suppressUndo;
      suppressUndo = true;
      if (polyLayer) polyLayer.clearLayers();
      selectedPoly = null;
      selectedModuleIdxs = [];
      modules = [];
      if (!plan) {
        refreshPitchArrows();
        renderModules();
        suppressUndo = prevSuppress;
        return;
      }
      if (plan.meta) planMeta = { ...planMeta, ...plan.meta };
      writeMetaToForm();

      const roofs = Array.isArray(plan.roofs) && plan.roofs.length
        ? plan.roofs
        : (plan.roof && plan.roof.length >= 3
          ? [{
            ring: plan.roof,
            tilt: (plan.meta && plan.meta.tilt) || plan.tilt || 30,
            azimuth: (plan.meta && plan.meta.azimuth) || plan.azimuth || 180,
          }]
          : []);

      const bounds = [];
      roofs.forEach((r) => {
        if (!r || !r.ring || r.ring.length < 3) return;
        const layer = addPolygonLayer('roof', r.ring.map((p) => [p.lat, p.lng]), {
          tilt: r.tilt,
          azimuth: r.azimuth,
          edgeAngleDeg: r.edgeAngleDeg,
          bearingDeg: r.bearingDeg,
        });
        bounds.push(layer.getBounds());
      });

      (plan.obstacles || []).forEach((ring) => {
        if (!ring || ring.length < 3) return;
        const layer = addPolygonLayer('obstacle', ring.map((p) => [p.lat, p.lng]));
        bounds.push(layer.getBounds());
      });

      if (bounds.length) {
        let union = bounds[0];
        for (let i = 1; i < bounds.length; i++) union = union.extend(bounds[i]);
        map.fitBounds(union, { padding: [24, 24], maxZoom: 21 });
      } else if (plan.center) {
        map.setView([plan.center.lat, plan.center.lng], plan.center.zoom || 19);
      }

      modules = Array.isArray(plan.modules) ? plan.modules.slice() : [];
      const d = dims();
      modules.forEach((m) => {
        if (!m) return;
        syncModuleProjectedSize(m, {
          catalogDims: d,
          landscape: m.landscape != null ? m.landscape : planMeta.landscape,
          tilt: m.tilt != null ? m.tilt : planMeta.tilt,
          tiltCross: m.tiltCross != null ? m.tiltCross : planMeta.tiltCross,
        });
      });
      renderModules();
      refreshPolyStyles();
      refreshPitchArrows();
      suppressUndo = prevSuppress;
    }

    let suggestTimer = null;
    let suggestResults = [];
    let suggestIndex = -1;
    let suggestSeq = 0;
    let suppressSuggest = false;

    function suggestEl() {
      return document.getElementById('layout-address-suggest');
    }

    function addressInput() {
      return document.getElementById('layout-address');
    }

    function hideSuggestions() {
      const box = suggestEl();
      const inp = addressInput();
      if (box) {
        box.classList.remove('show');
        box.hidden = true;
        box.innerHTML = '';
      }
      if (inp) inp.setAttribute('aria-expanded', 'false');
      suggestResults = [];
      suggestIndex = -1;
    }

    function applySuggestionHighlight() {
      const box = suggestEl();
      if (!box) return;
      Array.from(box.querySelectorAll('button[data-idx]')).forEach((btn) => {
        const i = Number(btn.getAttribute('data-idx'));
        btn.classList.toggle('active', i === suggestIndex);
      });
    }

    function showSuggestions(results, { emptyMsg } = {}) {
      const box = suggestEl();
      const inp = addressInput();
      if (!box) return;
      suggestResults = results || [];
      suggestIndex = suggestResults.length ? 0 : -1;
      box.innerHTML = '';
      if (!suggestResults.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = emptyMsg || 'Keine Adressen gefunden';
        box.appendChild(empty);
      } else {
        suggestResults.forEach((hit, idx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('role', 'option');
          btn.setAttribute('data-idx', String(idx));
          btn.textContent = hit.label;
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectSuggestion(idx);
          });
          box.appendChild(btn);
        });
      }
      box.hidden = false;
      box.classList.add('show');
      if (inp) inp.setAttribute('aria-expanded', 'true');
      applySuggestionHighlight();
    }

    function selectSuggestion(idx) {
      const hit = suggestResults[idx];
      if (!hit || !map) return;
      suppressSuggest = true;
      const addr = addressInput();
      if (addr) addr.value = hit.label;
      map.setView([hit.lat, hit.lng], 21);
      hideSuggestions();
      scheduleHouseNumbers();
      setTimeout(() => { suppressSuggest = false; }, 80);
    }

    async function searchAddress(q) {
      const res = await fetch(
        '/api/geo/search?q=' + encodeURIComponent(q) + '&limit=8',
        { credentials: 'same-origin' }
      );
      if (!res.ok) throw new Error('Adresssuche fehlgeschlagen');
      const j = await res.json();
      return j.results || [];
    }

    function scheduleSuggest(q) {
      clearTimeout(suggestTimer);
      const query = String(q || '').trim();
      if (query.length < 3) {
        hideSuggestions();
        return;
      }
      const seq = ++suggestSeq;
      suggestTimer = setTimeout(async () => {
        try {
          const results = await searchAddress(query);
          if (seq !== suggestSeq) return;
          showSuggestions(results);
        } catch (_) {
          if (seq !== suggestSeq) return;
          showSuggestions([], { emptyMsg: 'Suche fehlgeschlagen' });
        }
      }, 280);
    }

    async function goToAddress(q, { pickFirst = true, showList = false, silent = false } = {}) {
      const results = await searchAddress(q);
      if (!results.length) {
        if (showList) showSuggestions([], { emptyMsg: 'Keine Adresse gefunden' });
        else if (!silent) alert('Keine Adresse gefunden.');
        return null;
      }
      if (showList || (!pickFirst && results.length > 1)) {
        showSuggestions(results);
        return null;
      }
      const hit = results[0];
      map.setView([hit.lat, hit.lng], 21);
      const addr = addressInput();
      if (addr) {
        suppressSuggest = true;
        addr.value = hit.label;
        setTimeout(() => { suppressSuggest = false; }, 80);
      }
      hideSuggestions();
      scheduleHouseNumbers();
      return hit;
    }

    function prepareMapForCapture() {
      // Saubere Ansicht: keine Mehrfachauswahl-Hervorhebung; weiter rauszoomen → Haus sichtbar
      selectedModuleIdxs = [];
      selectedPoly = null;
      refreshPolyStyles();
      renderModules();
      const ctrl = map && map.getContainer && map.getContainer().querySelector('.leaflet-control-container');
      if (ctrl) ctrl.style.visibility = 'hidden';
      const prevCenter = map.getCenter();
      const prevZoom = map.getZoom();
      try {
        const layers = [];
        if (polyLayer) polyLayer.eachLayer((l) => { if (l.getBounds) layers.push(l.getBounds()); });
        if (moduleLayer) moduleLayer.eachLayer((l) => { if (l.getBounds) layers.push(l.getBounds()); });
        if (layers.length) {
          let union = layers[0];
          for (let i = 1; i < layers.length; i++) union = union.extend(layers[i]);
          map.fitBounds(union, { padding: [72, 72], maxZoom: 19, animate: false });
        }
      } catch (_) { /* ignore */ }
      return () => {
        try {
          map.setView(prevCenter, prevZoom, { animate: false });
        } catch (_) { /* ignore */ }
        if (ctrl) ctrl.style.visibility = '';
      };
    }

    /** Zuverlässiger Capture: Tiles manuell + Overlay-Vektor. */
    function captureLeafletComposite() {
      if (!map) return null;
      const size = map.getSize();
      if (!size || size.x < 10 || size.y < 10) return null;
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(size.x * scale);
      canvas.height = Math.round(size.y * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#cfd3d8';
      ctx.fillRect(0, 0, size.x, size.y);

      let tilesDrawn = 0;
      try {
        const mapRect = map.getContainer().getBoundingClientRect();
        const imgs = map.getContainer().querySelectorAll('.leaflet-tile-pane img.leaflet-tile');
        imgs.forEach((img) => {
          if (!img.complete || !(img.naturalWidth > 0)) return;
          const r = img.getBoundingClientRect();
          const dx = r.left - mapRect.left;
          const dy = r.top - mapRect.top;
          if (r.width < 1 || r.height < 1) return;
          try {
            ctx.drawImage(img, dx, dy, r.width, r.height);
            tilesDrawn += 1;
          } catch (_) {
            // tainted tile – skip
          }
        });
      } catch (_) { /* ignore */ }

      // Vektor-Overlay aus Plan-Daten (Dächer, Module, Pfeile)
      drawPlanOntoCanvas(ctx, size.x, size.y);

      if (tilesDrawn < 1 && modules.length === 0 && !(polyLayer && polyLayer.getLayers().length)) {
        return null;
      }
      try {
        return canvas.toDataURL('image/png');
      } catch (_) {
        return null;
      }
    }

    function drawPlanOntoCanvas(ctx, viewW, viewH) {
      if (!map || !ctx) return;
      const plan = {
        roofs: getRoofPolygons(),
        obstacles: getObstacleLatLngs(),
        modules: modules.slice(),
      };
      const roofs = plan.roofs || [];
      const obstacles = plan.obstacles || [];
      const mods = plan.modules || [];
      if (!roofs.length && !mods.length) return;

      function latLngToCanvas(lat, lng) {
        const p = map.latLngToContainerPoint([lat, lng]);
        return { x: p.x, y: p.y };
      }

      function metersToPx(lat, lng) {
        const pA = map.latLngToContainerPoint([lat, lng]);
        const pB = map.latLngToContainerPoint([lat + (1 / 111320), lng]);
        return Math.max(8, Math.hypot(pB.x - pA.x, pB.y - pA.y));
      }

      function fillRing(ring, fill, stroke, lineW) {
        if (!ring || ring.length < 3) return;
        ctx.beginPath();
        ring.forEach((pt, i) => {
          const c = latLngToCanvas(pt.lat, pt.lng);
          if (i === 0) ctx.moveTo(c.x, c.y);
          else ctx.lineTo(c.x, c.y);
        });
        ctx.closePath();
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = lineW || 2;
          ctx.stroke();
        }
      }

      roofs.forEach((r) => fillRing(r.ring, 'rgba(59,130,246,0.28)', '#1d4ed8', 2.5));
      obstacles.forEach((ring) => fillRing(ring, 'rgba(239,68,68,0.4)', '#b91c1c', 2));

      mods.forEach((m) => {
        const corners = moduleRectLatLngs(m);
        ctx.beginPath();
        corners.forEach((ll, i) => {
          const c = latLngToCanvas(ll[0], ll[1]);
          if (i === 0) ctx.moveTo(c.x, c.y);
          else ctx.lineTo(c.x, c.y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(96,165,250,0.75)';
        ctx.fill();
        ctx.strokeStyle = '#1e40af';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        const tilt = m.tilt != null ? Number(m.tilt) : (planMeta.tilt || 0);
        const ref = Math.min(m.widthM || 1, m.heightM || 1);
        const lenM = arrowLenFromTilt(tilt, ref * 0.7);
        const center = map.latLngToContainerPoint([m.lat, m.lng]);
        let ux = 0;
        let uy = 1;
        let found = false;
        for (let ri = 0; ri < roofs.length; ri++) {
          const ring = roofs[ri].ring;
          if (!ring || ring.length < 2) continue;
          const a = map.latLngToContainerPoint([ring[0].lat, ring[0].lng]);
          const b = map.latLngToContainerPoint([ring[1].lat, ring[1].lng]);
          const edx = b.x - a.x;
          const edy = b.y - a.y;
          const elen = Math.hypot(edx, edy) || 1;
          let nx = -edy / elen;
          let ny = edx / elen;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          // Normale vom Modulzentrum zur Kante (= Traufe)
          if ((center.x - mid.x) * nx + (center.y - mid.y) * ny > 0) {
            nx = -nx;
            ny = -ny;
          }
          ux = nx;
          uy = ny;
          found = true;
          break;
        }
        if (!found) {
          const ang = deg2rad(m.azimuth || 0);
          ux = -Math.sin(ang);
          uy = Math.cos(ang);
        }
        const pxLen = lenM * metersToPx(m.lat, m.lng);
        const tipX = center.x + ux * pxLen * 0.5;
        const tipY = center.y + uy * pxLen * 0.5;
        const baseX = center.x - ux * pxLen * 0.5;
        const baseY = center.y - uy * pxLen * 0.5;
        ctx.strokeStyle = '#e879a9';
        ctx.fillStyle = '#e879a9';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        const dx = tipX - baseX;
        const dy = tipY - baseY;
        const al = Math.hypot(dx, dy) || 1;
        const hx = (-dy / al) * 4;
        const hy = (dx / al) * 4;
        const bx = tipX - (dx / al) * 7;
        const by = tipY - (dy / al) * 7;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(bx + hx, by + hy);
        ctx.lineTo(bx - hx, by - hy);
        ctx.closePath();
        ctx.fill();
      });

      void viewW;
      void viewH;
    }

    function captureSnapshot() {
      return new Promise((resolve, reject) => {
        if (!map) return reject(new Error('Karte nicht bereit'));
        const restore = prepareMapForCapture();
        const finish = (dataUrl) => {
          try { restore(); } catch (_) { /* ignore */ }
          if (!dataUrl) reject(new Error('Snapshot leer'));
          else resolve(dataUrl);
        };

        // kurz warten, damit Deselect/Render durch sind
        setTimeout(() => {
          // 1) Eigenes Composite (Tiles + Vektor) – unabhängig von html2canvas-Taint
          try {
            const composite = captureLeafletComposite();
            if (composite && composite.length > 64) {
              finish(composite);
              return;
            }
          } catch (e) {
            console.warn('Composite-Snapshot:', e);
          }

          // 2) html2canvas (CORS-Tiles)
          if (global.html2canvas) {
            global.html2canvas(map.getContainer(), {
              useCORS: true,
              allowTaint: false,
              logging: false,
              backgroundColor: '#cfd3d8',
              scale: 2,
              ignoreElements: (el) => !!(el && el.classList && (
                el.classList.contains('leaflet-control-container')
                || el.classList.contains('layout-hn')
              )),
            }).then((canvas) => {
              try {
                finish(canvas.toDataURL('image/png'));
              } catch (err) {
                // 3) Reiner Vektor-Fallback
                try {
                  const size = map.getSize();
                  const c = document.createElement('canvas');
                  c.width = size.x * 2;
                  c.height = size.y * 2;
                  const ctx = c.getContext('2d');
                  ctx.scale(2, 2);
                  ctx.fillStyle = '#cfd3d8';
                  ctx.fillRect(0, 0, size.x, size.y);
                  drawPlanOntoCanvas(ctx, size.x, size.y);
                  finish(c.toDataURL('image/png'));
                } catch (e2) {
                  finish(null);
                }
              }
            }).catch(() => {
              try {
                const size = map.getSize();
                const c = document.createElement('canvas');
                c.width = size.x * 2;
                c.height = size.y * 2;
                const ctx = c.getContext('2d');
                ctx.scale(2, 2);
                ctx.fillStyle = '#cfd3d8';
                ctx.fillRect(0, 0, size.x, size.y);
                drawPlanOntoCanvas(ctx, size.x, size.y);
                finish(c.toDataURL('image/png'));
              } catch (_) {
                finish(null);
              }
            });
            return;
          }

          // ohne html2canvas: Vektor
          try {
            const size = map.getSize();
            const c = document.createElement('canvas');
            c.width = size.x * 2;
            c.height = size.y * 2;
            const ctx = c.getContext('2d');
            ctx.scale(2, 2);
            ctx.fillStyle = '#cfd3d8';
            ctx.fillRect(0, 0, size.x, size.y);
            drawPlanOntoCanvas(ctx, size.x, size.y);
            finish(c.toDataURL('image/png'));
          } catch (e) {
            finish(null);
          }
        }, 60);
      });
    }

    async function save(ctx) {
      readMetaFromForm();
      applyFormMetaToSelectedRoof();
      const plan = serializePlan();
      const d = dims();
      const payload = {
        leadId: ctx.leadId || null,
        customerEmail: ctx.customerEmail || '',
        title: ctx.title || 'Belegungsplan',
        addressText: (document.getElementById('layout-address') || {}).value || '',
        lat: map.getCenter().lat,
        lng: map.getCenter().lng,
        basemapProvider: currentProvider,
        plan,
        moduleCount: modules.length,
        moduleWp: d.wp,
        moduleType: planMeta.moduleType || 'das',
      };

      let layout;
      if (layoutId) {
        const res = await fetch('/api/layouts/' + layoutId, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Speichern fehlgeschlagen');
        layout = j.layout;
      } else {
        const res = await fetch('/api/layouts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Speichern fehlgeschlagen');
        layout = j.layout;
        layoutId = layout.id;
      }

      try {
        const image = await captureSnapshot();
        const rs = await fetch('/api/layouts/' + layoutId + '/snapshot', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image }),
        });
        const sj = await rs.json().catch(() => ({}));
        if (!rs.ok) {
          console.warn('Snapshot-Upload:', sj.error || rs.status);
        } else if (sj.layout) {
          layout = sj.layout;
        }
      } catch (e) {
        console.warn('Snapshot:', e);
      }

      onSaved(layout);
      return layout;
    }

    function open(ctx) {
      ctx = ctx || {};
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      ensureMap();
      populateModuleTypeSelect();
      if (ctx.moduleType) setModuleType(ctx.moduleType);
      writeMetaToForm();
      layoutId = ctx.layoutId || null;
      undoStack = [];
      redoStack = [];
      updateUndoRedoUi();
      updateSnapUi();
      setEditorStep('building');

      const addr = [ctx.street, [ctx.zip, ctx.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const addrEl = document.getElementById('layout-address');
      if (addrEl && addr) addrEl.value = addr;

      setTimeout(async () => {
        map.invalidateSize();
        if (ctx.layout && ctx.layout.plan) {
          loadPlan(ctx.layout.plan);
          if (ctx.layout.basemapProvider) {
            currentProvider = ctx.layout.basemapProvider;
            switchBasemap(currentProvider);
          }
          // Gespeicherter Modultyp aus Plan/Layout hat Vorrang vor Formular-Default
          const savedMt = (ctx.layout.plan.meta && ctx.layout.plan.meta.moduleType)
            || ctx.layout.moduleType
            || ctx.moduleType;
          if (savedMt) setModuleType(savedMt);
          writeMetaToForm();
        } else if (addr) {
          try {
            let hit = await goToAddress(addr, { silent: true });
            if (!hit) hit = await goToAddress(addr + ', Österreich', { silent: true });
            if (!hit) showSuggestions([], { emptyMsg: 'Adresse nicht gefunden – bitte suchen' });
          } catch (_) { /* ignore */ }
        }
        refreshPitchArrows();
        updateCountUi();
      }, 80);

      open._ctx = ctx;
    }

    function close() {
      hideSuggestions();
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
    }

    if (!modal.dataset.wired) {
      modal.dataset.wired = '1';
      const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
      };
      const addrEl = addressInput();
      if (addrEl) {
        addrEl.addEventListener('input', () => {
          if (suppressSuggest) return;
          scheduleSuggest(addrEl.value);
        });
        addrEl.addEventListener('focus', () => {
          if (suppressSuggest) return;
          if (String(addrEl.value || '').trim().length >= 3) scheduleSuggest(addrEl.value);
        });
        addrEl.addEventListener('keydown', (e) => {
          const box = suggestEl();
          const listOpen = box && box.classList.contains('show');
          if (e.key === 'Escape') {
            hideSuggestions();
            return;
          }
          if (!listOpen) {
            if (e.key === 'Enter') {
              e.preventDefault();
              goToAddress(addrEl.value, { showList: true, pickFirst: false }).catch((err) => {
                alert(err.message || String(err));
              });
            }
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!suggestResults.length) return;
            suggestIndex = (suggestIndex + 1) % suggestResults.length;
            applySuggestionHighlight();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!suggestResults.length) return;
            suggestIndex = (suggestIndex - 1 + suggestResults.length) % suggestResults.length;
            applySuggestionHighlight();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestIndex >= 0) selectSuggestion(suggestIndex);
          }
        });
      }
      document.addEventListener('click', (e) => {
        const wrap = modal.querySelector('.layout-addr-wrap');
        if (!wrap || wrap.contains(e.target)) return;
        hideSuggestions();
      });
      bind('layout-btn-close', close);
      const basemapSel = document.getElementById('layout-basemap');
      if (basemapSel) {
        basemapSel.addEventListener('change', () => {
          switchBasemap(basemapSel.value);
        });
      }
      const drawMode = document.getElementById('layout-draw-mode');
      if (drawMode) {
        drawMode.addEventListener('change', syncDrawOptions);
      }
      document.querySelectorAll('.layout-mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (editorStep !== 'building') setEditorStep('building');
          const mode = btn.getAttribute('data-mode') || 'roof';
          setDrawMode(mode);
          startPolygonDraw();
        });
      });
      document.querySelectorAll('.layout-step').forEach((btn) => {
        btn.addEventListener('click', () => {
          setEditorStep(btn.getAttribute('data-step') || 'building');
        });
      });
      ['layout-tilt', 'layout-tilt-cross'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', () => {
            applyFormMetaToSelectedRoof();
            updateModuleSizeLabel();
          });
          el.addEventListener('input', () => {
            readMetaFromForm();
            updateModuleSizeLabel();
            applyFormMetaToSelectedRoof();
          });
        }
      });
      const mtEl = document.getElementById('layout-module-type');
      if (mtEl) {
        mtEl.addEventListener('change', () => {
          readMetaFromForm();
          updateModuleSizeLabel();
          updateCountUi();
        });
      }
      const lsEl = document.getElementById('layout-landscape');
      if (lsEl) {
        lsEl.addEventListener('change', () => {
          readMetaFromForm();
          updateTiltLabels();
          updateModuleSizeLabel();
          const d = dims();
          const targetIdxs = selectedModuleIdxs.length
            ? selectedModuleIdxs.slice()
            : [];
          if (targetIdxs.length) {
            pushUndo();
            targetIdxs.forEach((idx) => {
              const m = modules[idx];
              if (!m) return;
              syncModuleProjectedSize(m, {
                catalogDims: d,
                landscape: planMeta.landscape,
                tilt: m.tilt,
                tiltCross: m.tiltCross != null ? m.tiltCross : planMeta.tiltCross,
              });
            });
            renderModules();
          } else {
            // Nur Vorgabe für neue Module / Auto-Layout
            updateRotateHandle();
          }
        });
      }
      document.addEventListener('mousemove', (ev) => {
        if (!rotateDrag || !map) return;
        let latlng = null;
        try { latlng = map.mouseEventToLatLng(ev); } catch (_) { /* ignore */ }
        if (latlng) onRotateDragMove({ latlng });
      });
      document.addEventListener('mouseup', (ev) => {
        if (rotateDrag) endRotateDrag();
        if (moduleDrag) endModuleDrag();
        if (!selectRectState && !(selectLassoState && selectLassoState.drawing)) return;
        let latlng = null;
        if (map && ev) {
          try { latlng = map.mouseEventToLatLng(ev); } catch (_) { /* ignore */ }
        }
        onMapSelectMouseUp({ latlng });
      });
      document.addEventListener('mousemove', (ev) => {
        if (!selectRectState && !(selectLassoState && selectLassoState.drawing)) return;
        if (!map || !ev) return;
        let latlng = null;
        try { latlng = map.mouseEventToLatLng(ev); } catch (_) { return; }
        if (latlng) onMapSelectMouseMove({ latlng });
      });
      document.addEventListener('keydown', (e) => {
        if (!modal.classList.contains('show')) return;
        const tag = (e.target && e.target.tagName) || '';
        const inField = /^(INPUT|TEXTAREA|SELECT)$/i.test(tag);
        if ((e.ctrlKey || e.metaKey) && !inField) {
          const k = e.key.toLowerCase();
          if (k === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
            return;
          }
          if (k === 'y' || (k === 'z' && e.shiftKey)) {
            e.preventDefault();
            redo();
            return;
          }
        }
        if (inField) return;
        if (e.key === 'Enter' && activeSelectTool === 'lasso') {
          e.preventDefault();
          finishLassoSelect();
          return;
        }
        if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          duplicateSelection();
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selectedModuleIdxs.length || selectedPoly) {
            e.preventDefault();
            deleteSelection();
          }
          return;
        }
        if (e.key === 'Escape') {
          if (activeSelectTool) {
            cancelSelectTool(false);
            return;
          }
          clearSelection();
          return;
        }
        if (!selectedModuleIdxs.length || editorStep !== 'modules') return;
        const step = e.shiftKey ? 15 : 5;
        if (e.key === 'q' || e.key === 'Q' || e.key === 'ArrowLeft') {
          e.preventDefault();
          rotateSelectedModules(-step);
        } else if (e.key === 'e' || e.key === 'E' || e.key === 'ArrowRight') {
          e.preventDefault();
          rotateSelectedModules(step);
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          rotateSelectedModules(90);
        }
      });
      bind('layout-btn-search', async () => {
        const q = (addressInput() || {}).value;
        try {
          await goToAddress(q, { showList: true, pickFirst: false });
        } catch (e) {
          alert(e.message);
        }
      });
      bind('layout-btn-auto', () => {
        if (editorStep !== 'modules') setEditorStep('modules');
        runAutoLayout();
      });
      bind('layout-btn-add-mod', () => {
        if (editorStep !== 'modules') setEditorStep('modules');
        addManualModule();
      });
      bind('layout-btn-select-rect', () => setSelectTool('rect'));
      bind('layout-btn-select-lasso', () => setSelectTool('lasso'));
      bind('layout-btn-dup', duplicateSelection);
      bind('layout-btn-undo', undo);
      bind('layout-btn-redo', redo);
      bind('layout-btn-snap', () => setSnapEnabled(!snapEnabled));
      bind('layout-btn-clear-mod', clearModules);
      bind('layout-btn-del-poly', () => {
        if (!selectedModuleIdxs.length && !selectedPoly) {
          alert('Bitte zuerst ein Modul oder Polygon anklicken.');
          return;
        }
        deleteSelection();
      });
      bind('layout-btn-clear-roof', clearRoof);
      bind('layout-btn-save', async () => {
        const btn = document.getElementById('layout-btn-save');
        if (btn) { btn.disabled = true; btn.textContent = 'Speichern…'; }
        try {
          await save(open._ctx || {});
          close();
        } catch (e) {
          alert(e.message || String(e));
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = 'Speichern & übernehmen'; }
        }
      });
      bind('layout-btn-apply-count', () => {
        readMetaFromForm();
        if (typeof opts.onApplyModuleCount === 'function') {
          opts.onApplyModuleCount(modules.length, {
            moduleType: planMeta.moduleType || 'das',
            moduleWp: dims().wp,
          });
        }
      });
    }

    function setModuleType(type) {
      const key = String(type || 'das');
      planMeta.moduleType = moduleDims[key] ? key : (Object.keys(moduleDims)[0] || 'das');
      const mt = document.getElementById('layout-module-type');
      if (mt) {
        if (mt.options.length && !Array.from(mt.options).some((o) => o.value === planMeta.moduleType)) {
          // leave options as-is if catalog-driven select not yet filled
        }
        if (Array.from(mt.options || []).some((o) => o.value === planMeta.moduleType)) {
          mt.value = planMeta.moduleType;
        }
      }
      updateModuleSizeLabel();
    }

    function populateModuleTypeSelect() {
      const mt = document.getElementById('layout-module-type');
      if (!mt || !moduleDims) return;
      const keys = Object.keys(moduleDims);
      if (!keys.length) return;
      const cur = planMeta.moduleType || mt.value || 'das';
      mt.innerHTML = keys.map((k) => {
        const d = moduleDims[k] || {};
        const label = d.label || k;
        return `<option value="${k}">${label}</option>`;
      }).join('');
      mt.value = keys.includes(cur) ? cur : keys[0];
      planMeta.moduleType = mt.value;
      updateModuleSizeLabel();
    }

    return {
      open,
      close,
      save,
      getModuleCount: () => modules.length,
      getModuleType: () => planMeta.moduleType || 'das',
      setModuleType,
      setProviders(p) {
        providers = p || [];
        populateBasemapSelect();
        if (map) {
          enabledProviders().forEach((pr) => {
            if (baseLayers[pr.id]) return;
            baseLayers[pr.id] = L.tileLayer(pr.url, {
              maxZoom: 23,
              maxNativeZoom: pr.maxZoom || 19,
              attribution: pr.attribution || '',
            });
          });
          if (currentProvider) switchBasemap(currentProvider);
        }
      },
      setModuleDimensions(d) {
        moduleDims = d || moduleDims;
        populateModuleTypeSelect();
        updateModuleSizeLabel();
      },
    };
  }

  global.LayoutEditor = {
    create: createLayoutEditor,
    autoLayoutModules,
    projectedModuleFootprint,
    syncModuleProjectedSize,
    ensureModulePhysDims,
  };
})(window);
