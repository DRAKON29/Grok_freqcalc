/**
 * Client-side radio propagation engine (simplified).
 * FSPL + single knife-edge diffraction + synthetic terrain.
 */
(function (global) {
  "use strict";

  const R_EARTH = 6371000; // m
  const DEG = Math.PI / 180;

  // ── Geodesy (haversine + simple destination) ─────────────────────
  function haversine(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * DEG, φ2 = lat2 * DEG;
    const Δφ = (lat2 - lat1) * DEG;
    const Δλ = (lon2 - lon1) * DEG;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * DEG, φ2 = lat2 * DEG;
    const Δλ = (lon2 - lon1) * DEG;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) / DEG) + 360) % 360;
  }

  function destination(lat, lon, azDeg, distM) {
    const δ = distM / R_EARTH;
    const θ = azDeg * DEG;
    const φ1 = lat * DEG, λ1 = lon * DEG;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
    return { lat: φ2 / DEG, lon: ((λ2 / DEG + 540) % 360) - 180 };
  }

  // ── Synthetic terrain (same idea as Python prototype) ────────────
  const HILLS = [
    [55.75, 37.60, 180, 0.08],
    [55.80, 37.70, 120, 0.06],
    [55.70, 37.55, 90, 0.10],
    [55.78, 37.45, 150, 0.07],
    [55.72, 37.68, 100, 0.05],
    [55.82, 37.55, 70, 0.09],
    [55.68, 37.62, 110, 0.07],
  ];

  function elevation(lat, lon) {
    let z = 50;
    for (const [lat0, lon0, h, sigma] of HILLS) {
      const d2 = ((lat - lat0) / sigma) ** 2 + ((lon - lon0) / sigma) ** 2;
      z += h * Math.exp(-0.5 * d2);
    }
    return z;
  }

  // ── Profile ──────────────────────────────────────────────────────
  function buildProfile(lat1, lon1, h1, lat2, lon2, h2, stepM, kFactor) {
    const dist = haversine(lat1, lon1, lat2, lon2);
    const az = bearing(lat1, lon1, lat2, lon2);
    const n = Math.max(2, Math.ceil(dist / stepM) + 1);
    const distances = [];
    const terrain = [];
    const lats = [], lons = [];
    for (let i = 0; i < n; i++) {
      const d = (dist * i) / (n - 1);
      const p = destination(lat1, lon1, az, d);
      distances.push(d);
      lats.push(p.lat);
      lons.push(p.lon);
      terrain.push(elevation(p.lat, p.lon));
    }
    const Re = R_EARTH * kFactor;
    const effective = distances.map((d, i) =>
      terrain[i] - (d * (dist - d)) / (2 * Re)
    );
    const txH = terrain[0] + h1;
    const rxH = terrain[n - 1] + h2;
    return { distances, terrain, effective, txH, rxH, dist, az, lats, lons };
  }

  // ── Propagation ──────────────────────────────────────────────────
  function freeSpaceLoss(distM, freqMHz) {
    if (distM <= 0) return 0;
    const dKm = distM / 1000;
    return 20 * Math.log10(dKm) + 20 * Math.log10(freqMHz) + 32.44;
  }

  function wavelength(freqMHz) {
    return 299.792458 / freqMHz;
  }

  function knifeEdgeLoss(v) {
    if (v < -0.78) return 0;
    return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
  }

  function diffractionLoss(distances, effective, txH, rxH, freqMHz, method) {
    method = method || "deygout";
    const D = distances[distances.length - 1];
    if (D <= 0 || distances.length < 3) return 0;
    const obstacles = [];
    for (let i = 1; i < distances.length - 1; i++) {
      const los = txH + (rxH - txH) * (distances[i] / D);
      const clear = effective[i] - los;
      if (clear >= 0.5) {
        obstacles.push({ h: clear, d1: distances[i], d2: D - distances[i] });
      }
    }
    if (!obstacles.length) return 0;
    obstacles.sort((a, b) => b.h - a.h);
    const maxEdges = method === "single" ? 1 : 3;
    const top = obstacles.slice(0, maxEdges);
    const wl = wavelength(freqMHz);
    let total = 0;
    for (const o of top) {
      const v = o.h * Math.sqrt((2 / wl) * (1 / o.d1 + 1 / o.d2));
      total += knifeEdgeLoss(v);
    }
    if (top.length > 1) total *= 0.85; // Deygout empirical correction
    return total;
  }

  function frequencySweep(prof, fStart, fStop, fStep, method) {
    method = method || "deygout";
    if (fStep <= 0) fStep = Math.max((fStop - fStart) / 20, 0.1);
    const out = [];
    for (let f = fStart; f <= fStop + fStep * 0.01; f += fStep) {
      const L = pathLoss(prof.distances, prof.effective, prof.txH, prof.rxH, f, method);
      out.push({ freq_mhz: +f.toFixed(4), path_loss_db: +L.toFixed(2) });
    }
    return out;
  }

  function pathLoss(distances, effective, txH, rxH, freqMHz, method) {
    const D = distances[distances.length - 1];
    return freeSpaceLoss(D, freqMHz) + diffractionLoss(distances, effective, txH, rxH, freqMHz, method);
  }

  function antennaGain(gMax, azOff, bw3db) {
    if (bw3db >= 360) return gMax;
    const sigma = bw3db / 2.3548;
    const g = Math.exp(-0.5 * (azOff / sigma) ** 2);
    return gMax + 10 * Math.log10(Math.max(g, 1e-12));
  }

  function fresnelRadius(d1, d2, wl) {
    if (d1 <= 0 || d2 <= 0) return 0;
    return Math.sqrt(wl * d1 * d2 / (d1 + d2));
  }

  // ── High-level link ──────────────────────────────────────────────
  function computeLink(p) {
    const prof = buildProfile(
      p.txLat, p.txLon, p.txH,
      p.rxLat, p.rxLon, p.rxH,
      p.stepM || 100, p.kFactor || 4 / 3
    );
    const L = pathLoss(prof.distances, prof.effective, prof.txH, prof.rxH, p.freqMHz, p.method);
    const azOff = 0; // assume boresight toward Rx for simplicity on point-to-point
    const gt = antennaGain(p.txGain, azOff, p.txBw);
    const gr = p.rxGain;
    const pr = p.txPower + gt + gr - L - p.txFeeder - p.rxFeeder;
    const margin = pr - p.rxSens;
    return {
      distanceKm: prof.dist / 1000,
      azimuth: prof.az,
      pathLossDb: L,
      prDbm: pr,
      marginDb: margin,
      isCovered: margin >= 0,
      profile: prof,
      freqMHz: p.freqMHz,
    };
  }

  // ── Coverage grid ────────────────────────────────────────────────
  function computeCoverage(p) {
    const maxR = (p.maxRangeKm || 25) * 1000;
    const azStep = p.azStep || 15;
    const rangeStep = 300;
    const azimuths = [];
    for (let az = 0; az < 360; az += azStep) azimuths.push(az);
    const nR = Math.max(2, Math.ceil(maxR / rangeStep));
    const ranges = [];
    for (let i = 1; i <= nR; i++) ranges.push((maxR * i) / nR);

    const prGrid = [];
    let covered = 0, total = 0;

    for (const az of azimuths) {
      const end = destination(p.txLat, p.txLon, az, maxR);
      const prof = buildProfile(
        p.txLat, p.txLon, p.txH,
        end.lat, end.lon, p.rxH,
        rangeStep, p.kFactor || 4 / 3
      );
      const gt = antennaGain(p.txGain, az - (p.boresight || 0), p.txBw);
      const row = [];
      for (const r of ranges) {
        // find nearest profile index
        let idx = 0;
        for (let i = 0; i < prof.distances.length; i++) {
          if (prof.distances[i] >= r) { idx = i; break; }
          idx = i;
        }
        const dSub = prof.distances.slice(0, idx + 1);
        const eSub = prof.effective.slice(0, idx + 1);
        const rxH = eSub[eSub.length - 1] + p.rxH;
        const L = pathLoss(dSub, eSub, prof.txH, rxH, p.freqMHz, p.method);
        const pr = p.txPower + gt + p.rxGain - L - p.txFeeder - p.rxFeeder;
        row.push(pr);
        total++;
        if (pr >= p.rxSens) covered++;
      }
      prGrid.push(row);
    }
    return {
      azimuths,
      ranges,
      prGrid,
      coveredPct: total ? (100 * covered) / total : 0,
      maxRangeKm: p.maxRangeKm || 25,
      rxSens: p.rxSens,
    };
  }

  // ── Drawing ──────────────────────────────────────────────────────
  function drawProfile(canvas, result) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const pad = { l: 48, r: 16, t: 20, b: 36 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const prof = result.profile;
    const d = prof.distances.map((x) => x / 1000);
    const terr = prof.terrain;
    const D = prof.dist;
    const los = prof.distances.map(
      (di) => prof.txH + (prof.rxH - prof.txH) * (di / D)
    );
    const wl = wavelength(result.freqMHz);
    const fresnel = prof.distances.map((di) =>
      fresnelRadius(di, D - di, wl)
    );

    const yMin = 0;
    const yMax = Math.max(...terr, ...los.map((l, i) => l + fresnel[i]), prof.txH, prof.rxH) * 1.08;
    const xMax = d[d.length - 1] || 1;

    const X = (v) => pad.l + (v / xMax) * plotW;
    const Y = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // terrain fill
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    for (let i = 0; i < d.length; i++) ctx.lineTo(X(d[i]), Y(terr[i]));
    ctx.lineTo(X(xMax), Y(0));
    ctx.closePath();
    ctx.fillStyle = "rgba(34,139,34,0.35)";
    ctx.fill();
    ctx.strokeStyle = "#228b22";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < d.length; i++) {
      i === 0 ? ctx.moveTo(X(d[i]), Y(terr[i])) : ctx.lineTo(X(d[i]), Y(terr[i]));
    }
    ctx.stroke();

    // LOS
    ctx.strokeStyle = "#dc2626";
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(prof.txH));
    ctx.lineTo(X(xMax), Y(prof.rxH));
    ctx.stroke();
    ctx.setLineDash([]);

    // Fresnel
    ctx.strokeStyle = "rgba(37,99,235,0.6)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let i = 0; i < d.length; i++) {
      const y = los[i] + fresnel[i];
      i === 0 ? ctx.moveTo(X(d[i]), Y(y)) : ctx.lineTo(X(d[i]), Y(y));
    }
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < d.length; i++) {
      const y = los[i] - fresnel[i];
      i === 0 ? ctx.moveTo(X(d[i]), Y(y)) : ctx.lineTo(X(d[i]), Y(y));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Tx / Rx markers
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.moveTo(X(0), Y(prof.txH) - 8);
    ctx.lineTo(X(0) - 6, Y(prof.txH) + 4);
    ctx.lineTo(X(0) + 6, Y(prof.txH) + 4);
    ctx.fill();
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.moveTo(X(xMax), Y(prof.rxH) + 8);
    ctx.lineTo(X(xMax) - 6, Y(prof.rxH) - 4);
    ctx.lineTo(X(xMax) + 6, Y(prof.rxH) - 4);
    ctx.fill();

    // axes labels
    ctx.fillStyle = "#334155";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Расстояние, км", pad.l + plotW / 2, H - 6);
    ctx.save();
    ctx.translate(12, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Высота, м", 0, 0);
    ctx.restore();
    ctx.textAlign = "right";
    ctx.fillText(yMax.toFixed(0), pad.l - 4, pad.t + 4);
    ctx.fillText("0", pad.l - 4, pad.t + plotH);
    ctx.textAlign = "center";
    ctx.fillText("0", X(0), H - 18);
    ctx.fillText(xMax.toFixed(1), X(xMax), H - 18);
  }

  function drawCoverage(canvas, cov) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 30;

    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, W, H);

    const maxR = cov.ranges[cov.ranges.length - 1];
    const prMin = -200, prMax = -40;

    function color(pr) {
      const t = Math.max(0, Math.min(1, (pr - prMin) / (prMax - prMin)));
      // red -> yellow -> green
      if (t < 0.5) {
        const u = t * 2;
        return `rgb(${220}, ${Math.round(40 + u * 180)}, ${40})`;
      }
      const u = (t - 0.5) * 2;
      return `rgb(${Math.round(220 - u * 180)}, ${220}, ${40})`;
    }

    const azStep = cov.azimuths.length > 1
      ? (cov.azimuths[1] - cov.azimuths[0]) * DEG
      : 15 * DEG;

    for (let i = 0; i < cov.azimuths.length; i++) {
      const az = cov.azimuths[i] * DEG;
      // 0° at North, clockwise → canvas: 0 at East CCW, so adjust
      const theta0 = -Math.PI / 2 + az - azStep / 2;
      const theta1 = -Math.PI / 2 + az + azStep / 2;
      for (let j = 0; j < cov.ranges.length; j++) {
        const r0 = j === 0 ? 0 : (cov.ranges[j - 1] / maxR) * R;
        const r1 = (cov.ranges[j] / maxR) * R;
        ctx.beginPath();
        ctx.arc(cx, cy, r1, theta0, theta1);
        ctx.arc(cx, cy, r0, theta1, theta0, true);
        ctx.closePath();
        ctx.fillStyle = color(cov.prGrid[i][j]);
        ctx.fill();
      }
    }

    // grid rings
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    for (let k = 1; k <= 4; k++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * k) / 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      const km = ((cov.maxRangeKm * k) / 4).toFixed(0);
      ctx.fillText(km + " км", cx + 4, cy - (R * k) / 4);
    }
    // cross
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // labels N E S W
    ctx.fillStyle = "#e8eef9";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", cx, cy - R - 8);
    ctx.fillText("S", cx, cy + R + 14);
    ctx.textAlign = "left";
    ctx.fillText("E", cx + R + 6, cy + 4);
    ctx.textAlign = "right";
    ctx.fillText("W", cx - R - 6, cy + 4);
  }

  global.RadioCalc = {
    computeLink,
    computeCoverage,
    drawProfile,
    drawCoverage,
    frequencySweep,
    buildProfile,
    pathLoss,
    freeSpaceLoss,
    haversine,
    elevation,
  };
})(typeof window !== "undefined" ? window : globalThis);
