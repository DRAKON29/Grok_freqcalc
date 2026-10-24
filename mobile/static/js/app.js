/* Radio Calculator – mobile frontend */

(function () {
  "use strict";

  // ── Tabs ──────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ── Range labels ──────────────────────────────────────────────────
  const bindRange = (id, labelId) => {
    const el = document.getElementById(id);
    const lab = document.getElementById(labelId);
    const sync = () => { lab.textContent = el.value; };
    el.addEventListener("input", sync);
    sync();
  };
  bindRange("max_range_km", "max_range_val");
  bindRange("k_factor", "k_factor_val");
  bindRange("step_m", "step_m_val");

  // ── Collect form data ─────────────────────────────────────────────
  function num(id) {
    return parseFloat(document.getElementById(id).value);
  }
  function str(id) {
    return document.getElementById(id).value;
  }

  function collectParams() {
    return {
      tx_lat: num("tx_lat"),
      tx_lon: num("tx_lon"),
      rx_lat: num("rx_lat"),
      rx_lon: num("rx_lon"),
      coord_system: str("coord_system"),
      freq_mhz: num("freq_mhz"),
      tx_power_dbm: num("tx_power_dbm"),
      tx_gain_dbi: num("tx_gain_dbi"),
      tx_height_m: num("tx_height_m"),
      tx_feeder_db: num("tx_feeder_db"),
      tx_bw_deg: num("tx_bw_deg"),
      tx_pol: str("tx_pol"),
      rx_sensitivity_dbm: num("rx_sensitivity_dbm"),
      rx_gain_dbi: num("rx_gain_dbi"),
      rx_height_m: num("rx_height_m"),
      rx_feeder_db: num("rx_feeder_db"),
      rx_pol: str("rx_pol"),
      k_factor: num("k_factor"),
      step_m: num("step_m"),
    };
  }

  // ── UI helpers ────────────────────────────────────────────────────
  const loading = document.getElementById("loading");
  function showLoading(on) {
    loading.classList.toggle("hidden", !on);
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Ошибка сервера");
    return data;
  }

  // ── Link calculation ──────────────────────────────────────────────
  document.getElementById("btn-link").addEventListener("click", async () => {
    const btn = document.getElementById("btn-link");
    btn.disabled = true;
    showLoading(true);
    try {
      const data = await postJSON("/api/link", collectParams());
      document.getElementById("m-dist").textContent = data.distance_km.toFixed(2);
      document.getElementById("m-loss").textContent = data.path_loss_db.toFixed(1);
      document.getElementById("m-pr").textContent = data.pr_dbm.toFixed(1);
      document.getElementById("m-margin").textContent =
        (data.margin_db >= 0 ? "+" : "") + data.margin_db.toFixed(1);

      const card = document.getElementById("m-margin-card");
      const status = document.getElementById("m-status");
      card.classList.remove("ok", "bad");
      if (data.is_covered) {
        card.classList.add("ok");
        status.textContent = "покрытие OK";
      } else {
        card.classList.add("bad");
        status.textContent = "РАДИОТЕНЬ";
      }

      document.getElementById("profile-img").src =
        "data:image/png;base64," + data.profile_image;
      document.getElementById("link-result").classList.remove("hidden");
    } catch (e) {
      alert("Ошибка: " + e.message);
    } finally {
      btn.disabled = false;
      showLoading(false);
    }
  });

  // ── Coverage ──────────────────────────────────────────────────────
  document.getElementById("btn-coverage").addEventListener("click", async () => {
    const btn = document.getElementById("btn-coverage");
    btn.disabled = true;
    showLoading(true);
    try {
      const body = collectParams();
      body.max_range_km = num("max_range_km");
      body.az_step_deg = num("az_step_deg");
      const data = await postJSON("/api/coverage", body);
      document.getElementById("m-covered").textContent = data.covered_pct.toFixed(1);
      document.getElementById("coverage-img").src =
        "data:image/png;base64," + data.coverage_image;
      document.getElementById("coverage-result").classList.remove("hidden");
    } catch (e) {
      alert("Ошибка: " + e.message);
    } finally {
      btn.disabled = false;
      showLoading(false);
    }
  });

  // ── PWA install prompt ────────────────────────────────────────────
  let deferredPrompt = null;
  const installBtn = document.getElementById("btn-install");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove("hidden");
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  });
})();
