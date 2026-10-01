/**
 * Karten-Pins, die auf demselben Punkt liegen (typisch PLZ-Mittelpunkt).
 * Weit herausgezoomt: ein Pin mit Anzahl. Nah genug: kleiner Kreis, damit jeder Lead sichtbar ist.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PVLMapPins = api;
})(typeof window !== 'undefined' ? window : globalThis, function pvlMapPinsFactory() {
  const EARTH_MPP_EQUATOR = 156543.03392;
  const SPREAD_PX = 26;
  const MAX_SPREAD_METERS = 220;

  function metersPerPixel(lat, zoom) {
    const z = Number(zoom);
    const la = Number(lat);
    if (!Number.isFinite(z) || !Number.isFinite(la)) return Infinity;
    return (Math.cos((la * Math.PI) / 180) * EARTH_MPP_EQUATOR) / (2 ** z);
  }

  function shouldSpreadStack(lat, zoom) {
    return metersPerPixel(lat, zoom) * SPREAD_PX <= MAX_SPREAD_METERS;
  }

  function spreadZoomFor(lat) {
    const la = Number.isFinite(Number(lat)) ? Number(lat) : 48;
    const mppTarget = MAX_SPREAD_METERS / SPREAD_PX;
    const z = Math.log2((Math.cos((la * Math.PI) / 180) * EARTH_MPP_EQUATOR) / mppTarget);
    if (!Number.isFinite(z)) return 15;
    return Math.min(18, Math.max(13, Math.ceil(z)));
  }

  function coordKey(lat, lng) {
    const la = Number(lat);
    const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return '';
    return `${la.toFixed(5)},${lo.toFixed(5)}`;
  }

  /**
   * @param {{ key: string, lat: number, lng: number, z?: number }[]} entries
   * @param {{ zoom?: number }} [opts]
   */
  function layoutMapMarkers(entries, opts) {
    const zoom = opts && Number.isFinite(Number(opts.zoom)) ? Number(opts.zoom) : 9;
    const groups = new Map();
    const order = [];
    for (const e of entries || []) {
      const lat = Number(e.lat);
      const lng = Number(e.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = e.key == null ? '' : String(e.key);
      const z = Number.isFinite(Number(e.z)) ? Number(e.z) : 0;
      const k = coordKey(lat, lng);
      if (!k) continue;
      if (!groups.has(k)) {
        groups.set(k, []);
        order.push(k);
      }
      groups.get(k).push({ key, lat, lng, z });
    }
    const markers = [];
    let hasCoincident = false;
    for (const k of order) {
      const group = groups.get(k);
      group.sort((a, b) => (b.z - a.z) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      if (group.length === 1) {
        const one = group[0];
        markers.push({
          key: one.key,
          lat: one.lat,
          lng: one.lng,
          z: one.z,
          count: 1,
          clustered: false,
          memberKeys: [one.key],
        });
        continue;
      }
      hasCoincident = true;
      const lat0 = group[0].lat;
      const lng0 = group[0].lng;
      if (!shouldSpreadStack(lat0, zoom)) {
        const top = group[0];
        markers.push({
          key: top.key,
          lat: lat0,
          lng: lng0,
          z: top.z,
          count: group.length,
          clustered: true,
          memberKeys: group.map((g) => g.key),
        });
        continue;
      }
      const mpp = metersPerPixel(lat0, zoom);
      const mPerDegLat = 111320;
      const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180) || 111320;
      const n = group.length;
      for (let i = 0; i < n; i += 1) {
        const ring = Math.floor(i / 8);
        const inRing = i % 8;
        const countRing = Math.min(8, n - ring * 8);
        const angle = (-Math.PI / 2) + ((2 * Math.PI * inRing) / countRing);
        const radiusM = SPREAD_PX * mpp * (ring + 1);
        markers.push({
          key: group[i].key,
          lat: lat0 + (Math.sin(angle) * radiusM) / mPerDegLat,
          lng: lng0 + (Math.cos(angle) * radiusM) / mPerDegLng,
          z: group[i].z,
          count: 1,
          clustered: false,
          memberKeys: [group[i].key],
        });
      }
    }
    return { markers, hasCoincident };
  }

  return {
    layoutMapMarkers,
    shouldSpreadStack,
    spreadZoomFor,
    coordKey,
    metersPerPixel,
  };
});
