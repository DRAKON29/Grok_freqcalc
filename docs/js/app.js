/* Static UI + Leaflet maps */
(function () {
  "use strict";

  // ── Tabs ──────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      setTimeout(() => {
        if (btn.dataset.tab === "map" && maps.main) maps.main.invalidateSize();
        if (btn.dataset.tab === "link" && maps.link) maps.link.invalidateSize();
        if (btn.dataset.tab === "coverage" && maps.coverage) maps.coverage.invalidateSize();
      }, 50);
    });
  });

  function bindRange(id, labelId) {
    const el = document.getElementById(id);
    const lab = document.getElementById(labelId);
    const sync = () => { lab.textContent = el.value; };
    el.addEventListener("input", sync);
    sync();
  }
  bindRange("max_range_km", "max_range_val");
  bindRange("k_factor", "k_factor_val");

  function num(id) { return parseFloat(document.getElementById(id).value); }
  function setNum(id, v) { document.getElementById(id).value = Number(v).toFixed(5); }

  function params() {
    return {
      txLat: num("tx_lat"),
      txLon: num("tx_lon"),
      rxLat: num("rx_lat"),
      rxLon: num("rx_lon"),
      txH: num("tx_height_m"),
      rxH: num("rx_height_m"),
      freqMHz: num("freq_mhz"),
      txPower: num("tx_power_dbm"),
      txGain: num("tx_gain_dbi"),
      txBw: num("tx_bw_deg"),
      txFeeder: num("tx_feeder_db"),
      rxSens: num("rx_sensitivity_dbm"),
      rxGain: num("rx_gain_dbi"),
      rxFeeder: num("rx_feeder_db"),
      kFactor: num("k_factor"),
      stepM: 100,
    };
  }

  const loading = document.getElementById("loading");
  function showLoading(on) { loading.classList.toggle("hidden", !on); }

  // ── Maps ──────────────────────────────────────────────────────────
  const maps = { main: null, link: null, coverage: null };
  let placeMode = "tx";
  let mainTxMarker = null;
  let mainRxMarker = null;

  function initMainMap() {
    if (maps.main) return;
    const p = params();
    maps.main = MapHelper.createMap("map-main", [p.txLat, p.txLon], 11);
    mainTxMarker = MapHelper.makeMarker(maps.main, p.txLat, p.txLon, "#dc2626", "Tx", true);
    mainRxMarker = MapHelper.makeMarker(maps.main, p.rxLat, p.rxLon, "#2563eb", "Rx", true);

    mainTxMarker.on("dragend", () => {
      const ll = mainTxMarker.getLatLng();
      setNum("tx_lat", ll.lat);
      setNum("tx_lon", ll.lng);
      updateReadouts();
      mainTxMarker.setPopupContent("<b>Tx</b><br>" + ll.lat.toFixed(5) + ", " + ll.lng.toFixed(5));
    });
    mainRxMarker.on("dragend", () => {
      const ll = mainRxMarker.getLatLng();
      setNum("rx_lat", ll.lat);
      setNum("rx_lon", ll.lng);
      updateReadouts();
      mainRxMarker.setPopupContent("<b>Rx</b><br>" + ll.lat.toFixed(5) + ", " + ll.lng.toFixed(5));
    });

    maps.main.on("click", (e) => {
      if (placeMode === "tx") {
        mainTxMarker.setLatLng(e.latlng);
        setNum("tx_lat", e.latlng.lat);
        setNum("tx_lon", e.latlng.lng);
      } else {
        mainRxMarker.setLatLng(e.latlng);
        setNum("rx_lat", e.latlng.lat);
        setNum("rx_lon", e.latlng.lng);
      }
      updateReadouts();
    });

    maps.main._pathLine = L.polyline(
      [[p.txLat, p.txLon], [p.rxLat, p.rxLon]],
      { color: "#3b82f6", weight: 2, opacity: 0.7 }
    ).addTo(maps.main);

    updateReadouts();
  }

  function updateReadouts() {
    document.getElementById("read-tx").textContent =
      num("tx_lat").toFixed(5) + ", " + num("tx_lon").toFixed(5);
    document.getElementById("read-rx").textContent =
      num("rx_lat").toFixed(5) + ", " + num("rx_lon").toFixed(5);
    if (maps.main && maps.main._pathLine) {
      maps.main._pathLine.setLatLngs([
        [num("tx_lat"), num("tx_lon")],
        [num("rx_lat"), num("rx_lon")],
      ]);
    }
  }

  ["tx_lat", "tx_lon", "rx_lat", "rx_lon"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      if (!mainTxMarker) return;
      mainTxMarker.setLatLng([num("tx_lat"), num("tx_lon")]);
      mainRxMarker.setLatLng([num("rx_lat"), num("rx_lon")]);
      updateReadouts();
    });
  });

  document.querySelectorAll(".btn-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      placeMode = btn.dataset.place;
    });
  });

  document.getElementById("map_basemap").addEventListener("change", (e) => {
    const key = e.target.value;
    [maps.main, maps.link, maps.coverage].forEach((m) => {
      if (m) MapHelper.setBasemap(m, key);
    });
  });

  document.querySelector('.tab[data-tab="map"]').addEventListener("click", () => {
    setTimeout(initMainMap, 60);
  });

  // ── Link calculation ──────────────────────────────────────────────
  function runLink() {
    showLoading(true);
    setTimeout(() => {
      try {
        const result = RadioCalc.computeLink(params());
        document.getElementById("m-dist").textContent = result.distanceKm.toFixed(2);
        document.getElementById("m-loss").textContent = result.pathLossDb.toFixed(1);
        document.getElementById("m-pr").textContent = result.prDbm.toFixed(1);
        document.getElementById("m-margin").textContent =
          (result.marginDb >= 0 ? "+" : "") + result.marginDb.toFixed(1);

        const card = document.getElementById("m-margin-card");
        const status = document.getElementById("m-status");
        card.classList.remove("ok", "bad");
        if (result.isCovered) {
          card.classList.add("ok");
          status.textContent = "покрытие OK";
        } else {
          card.classList.add("bad");
          status.textContent = "РАДИОТЕНЬ";
        }

        const canvas = document.getElementById("profile-canvas");
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width || 320;
        const h = 200;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        const logical = document.createElement("canvas");
        logical.width = w;
        logical.height = h;
        RadioCalc.drawProfile(logical, result);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(logical, 0, 0);

        document.getElementById("link-result").classList.remove("hidden");
        setTimeout(() => {
          if (!maps.link) {
            maps.link = MapHelper.createMap(
              "map-link",
              [result.profile.lats[0], result.profile.lons[0]],
              11
            );
            const bm = document.getElementById("map_basemap").value;
            if (bm !== "osm") MapHelper.setBasemap(maps.link, bm);
          }
          MapHelper.showLink(
            maps.link,
            num("tx_lat"), num("tx_lon"),
            num("rx_lat"), num("rx_lon"),
            result.isCovered
          );
        }, 50);
      } catch (e) {
        alert("Ошибка: " + e.message);
      } finally {
        showLoading(false);
      }
    }, 30);
  }

  document.getElementById("btn-link").addEventListener("click", runLink);
  document.getElementById("btn-link-from-map").addEventListener("click", () => {
    document.querySelector('.tab[data-tab="link"]').click();
    runLink();
  });

  // ── Coverage ──────────────────────────────────────────────────────
  document.getElementById("btn-coverage").addEventListener("click", () => {
    showLoading(true);
    setTimeout(() => {
      try {
        const p = params();
        p.maxRangeKm = num("max_range_km");
        p.azStep = num("az_step_deg");
        const cov = RadioCalc.computeCoverage(p);
        document.getElementById("m-covered").textContent = cov.coveredPct.toFixed(1);

        const canvas = document.getElementById("coverage-canvas");
        const dpr = window.devicePixelRatio || 1;
        const size = Math.min(window.innerWidth - 48, 360);
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        canvas.style.width = size + "px";
        canvas.style.height = size + "px";
        const logical = document.createElement("canvas");
        logical.width = size;
        logical.height = size;
        RadioCalc.drawCoverage(logical, cov);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(logical, 0, 0);

        document.getElementById("coverage-result").classList.remove("hidden");
        setTimeout(() => {
          if (!maps.coverage) {
            maps.coverage = MapHelper.createMap("map-coverage", [p.txLat, p.txLon], 10);
            const bm = document.getElementById("map_basemap").value;
            if (bm !== "osm") MapHelper.setBasemap(maps.coverage, bm);
          }
          MapHelper.showCoverage(maps.coverage, p.txLat, p.txLon, cov);
        }, 50);
      } catch (e) {
        alert("Ошибка: " + e.message);
      } finally {
        showLoading(false);
      }
    }, 30);
  });
})();
