/**
 * Leaflet map helpers for Radio Calculator
 */
(function (global) {
  "use strict";

  const LAYERS = {
    osm: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    },
    topo: {
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attr: 'Map data: &copy; OSM, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
    },
    sat: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attr: "Tiles &copy; Esri",
      maxZoom: 19,
    },
  };

  function icon(color, label) {
    return L.divIcon({
      className: "",
      html: `<div style="
        background:${color};color:#fff;border-radius:50%;
        width:28px;height:28px;display:flex;align-items:center;
        justify-content:center;font-size:11px;font-weight:700;
        border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
      ">${label}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  }

  function createMap(divId, center, zoom) {
    const map = L.map(divId, {
      zoomControl: true,
      attributionControl: true,
    }).setView(center, zoom || 11);

    const layer = L.tileLayer(LAYERS.osm.url, {
      attribution: LAYERS.osm.attr,
      maxZoom: LAYERS.osm.maxZoom,
    }).addTo(map);

    map._baseLayer = layer;
    map._baseKey = "osm";
    return map;
  }

  function setBasemap(map, key) {
    const cfg = LAYERS[key] || LAYERS.osm;
    if (map._baseLayer) map.removeLayer(map._baseLayer);
    map._baseLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attr,
      maxZoom: cfg.maxZoom,
    }).addTo(map);
    map._baseKey = key;
  }

  function makeMarker(map, lat, lon, color, label, draggable) {
    const m = L.marker([lat, lon], {
      icon: icon(color, label),
      draggable: !!draggable,
    }).addTo(map);
    m.bindPopup(`<b>${label}</b><br>${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    return m;
  }

  /** Draw Tx, Rx and great-circle polyline on a map */
  function showLink(map, txLat, txLon, rxLat, rxLon, isCovered) {
    clearGroup(map, "_linkGroup");
    const g = L.layerGroup().addTo(map);
    map._linkGroup = g;

    const tx = makeMarker(map, txLat, txLon, "#dc2626", "Tx", false);
    const rx = makeMarker(map, rxLat, rxLon, "#2563eb", "Rx", false);
    g.addLayer(tx);
    g.addLayer(rx);

    // Intermediate points for a nicer arc approximation on map
    const line = L.polyline(
      [[txLat, txLon], [rxLat, rxLon]],
      {
        color: isCovered ? "#22c55e" : "#ef4444",
        weight: 3,
        opacity: 0.85,
        dashArray: isCovered ? null : "8 6",
      }
    );
    g.addLayer(line);

    const bounds = L.latLngBounds([[txLat, txLon], [rxLat, rxLon]]);
    map.fitBounds(bounds.pad(0.25));
    // Leaflet needs invalidateSize after tab becomes visible
    setTimeout(() => map.invalidateSize(), 100);
  }

  /**
   * Draw coverage as colored sector polygons on the map.
   * cov: { azimuths, ranges, prGrid, rxSens, maxRangeKm }
   */
  function showCoverage(map, txLat, txLon, cov) {
    clearGroup(map, "_covGroup");
    const g = L.layerGroup().addTo(map);
    map._covGroup = g;

    const tx = makeMarker(map, txLat, txLon, "#dc2626", "Tx", false);
    g.addLayer(tx);

    const azStep = cov.azimuths.length > 1
      ? cov.azimuths[1] - cov.azimuths[0]
      : 15;
    const maxR = cov.ranges[cov.ranges.length - 1];

    function prColor(pr) {
      // match canvas palette roughly
      const t = Math.max(0, Math.min(1, (pr + 200) / 160));
      if (t < 0.5) {
        const u = t * 2;
        return `rgb(220, ${Math.round(40 + u * 180)}, 40)`;
      }
      const u = (t - 0.5) * 2;
      return `rgb(${Math.round(220 - u * 180)}, 220, 40)`;
    }

    // Draw only outer ring cells for performance, plus covered outline
    for (let i = 0; i < cov.azimuths.length; i++) {
      const az = cov.azimuths[i];
      for (let j = 0; j < cov.ranges.length; j++) {
        const pr = cov.prGrid[i][j];
        // skip very weak cells to reduce clutter
        if (pr < cov.rxSens - 20) continue;

        const r0 = j === 0 ? 0 : cov.ranges[j - 1];
        const r1 = cov.ranges[j];
        const a0 = az - azStep / 2;
        const a1 = az + azStep / 2;

        const pts = sectorLatLngs(txLat, txLon, r0, r1, a0, a1);
        const poly = L.polygon(pts, {
          color: prColor(pr),
          weight: 0.5,
          fillColor: prColor(pr),
          fillOpacity: pr >= cov.rxSens ? 0.35 : 0.12,
          interactive: false,
        });
        g.addLayer(poly);
      }
    }

    // Range circle
    L.circle([txLat, txLon], {
      radius: maxR,
      color: "#94a3b8",
      weight: 1,
      dashArray: "4 4",
      fill: false,
    }).addTo(g);

    const pad = maxR / 111000; // deg approx
    map.fitBounds([
      [txLat - pad, txLon - pad],
      [txLat + pad, txLon + pad],
    ]);
    setTimeout(() => map.invalidateSize(), 100);
  }

  function sectorLatLngs(lat, lon, r0, r1, az0, az1) {
    const pts = [];
    const steps = 6;
    // outer arc
    for (let s = 0; s <= steps; s++) {
      const az = az0 + ((az1 - az0) * s) / steps;
      const p = RadioCalc._dest
        ? RadioCalc._dest(lat, lon, az, r1)
        : dest(lat, lon, az, r1);
      pts.push([p.lat, p.lon]);
    }
    // inner arc reverse
    for (let s = steps; s >= 0; s--) {
      const az = az0 + ((az1 - az0) * s) / steps;
      const p = dest(lat, lon, az, r0);
      pts.push([p.lat, p.lon]);
    }
    return pts;
  }

  function dest(lat, lon, azDeg, distM) {
    const R = 6371000;
    const δ = distM / R;
    const θ = (azDeg * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lon * Math.PI) / 180;
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
      );
    return {
      lat: (φ2 * 180) / Math.PI,
      lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
    };
  }

  function clearGroup(map, key) {
    if (map[key]) {
      map.removeLayer(map[key]);
      map[key] = null;
    }
  }

  global.MapHelper = {
    createMap,
    setBasemap,
    makeMarker,
    showLink,
    showCoverage,
    icon,
  };
})(typeof window !== "undefined" ? window : globalThis);
