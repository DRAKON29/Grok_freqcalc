/* Static mobile UI – all calculations in-browser */
(function () {
  "use strict";

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
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

  document.getElementById("btn-link").addEventListener("click", () => {
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
        // crisp on retina
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.round((rect.width || 320) * dpr);
        canvas.height = Math.round(200 * dpr);
        canvas.style.width = (rect.width || 320) + "px";
        canvas.style.height = "200px";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        // temporarily override width logic — drawProfile uses canvas.width
        // so pass logical size via a wrapper
        const logical = document.createElement("canvas");
        logical.width = rect.width || 320;
        logical.height = 200;
        RadioCalc.drawProfile(logical, result);
        ctx.drawImage(logical, 0, 0);

        document.getElementById("link-result").classList.remove("hidden");
      } catch (e) {
        alert("Ошибка: " + e.message);
      } finally {
        showLoading(false);
      }
    }, 30);
  });

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
      } catch (e) {
        alert("Ошибка: " + e.message);
      } finally {
        showLoading(false);
      }
    }, 30);
  });
})();
