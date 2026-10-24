"""
Mobile API backend for Radio Calculator.
Run:  uvicorn mobile.api:app --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path
from typing import Optional

# Project root on path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.geo import Point, distance_azimuth, sk42_to_wgs84
from app.dem import DEM, build_profile
from app.antenna import Polarization, AntennaType
from app.link_budget import RadioEquipment, compute_link, circular_coverage
from app.visualization import plot_profile_matplotlib, plot_coverage_polar_matplotlib
from app.models import free_space_loss_db

STATIC = Path(__file__).parent / "static"
TEMPLATES = Path(__file__).parent / "templates"

app = FastAPI(
    title="Радиокалькулятор",
    description="Мобильный калькулятор радиодальности и радиотени",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared DEM (synthetic by default)
_dem = DEM(hgt_dir=ROOT / "data" / "hgt", use_synthetic=True)


# ── Request / Response models ───────────────────────────────────────

class LinkRequest(BaseModel):
    tx_lat: float = Field(55.7558, description="Широта Tx")
    tx_lon: float = Field(37.6173, description="Долгота Tx")
    rx_lat: float = Field(55.8500)
    rx_lon: float = Field(37.7000)
    coord_system: str = Field("WGS84", description="WGS84 или SK42")
    freq_mhz: float = Field(433.92, ge=30, le=50000)
    tx_power_dbm: float = 30.0
    tx_gain_dbi: float = 8.0
    tx_height_m: float = 30.0
    tx_feeder_db: float = 1.0
    tx_bw_deg: float = 60.0
    tx_pol: str = "V"
    rx_sensitivity_dbm: float = -105.0
    rx_gain_dbi: float = 2.0
    rx_height_m: float = 10.0
    rx_feeder_db: float = 0.5
    rx_pol: str = "V"
    k_factor: float = Field(1.333, ge=1.0, le=2.0)
    step_m: float = Field(100.0, ge=50, le=500)


class CoverageRequest(LinkRequest):
    max_range_km: float = Field(30.0, ge=1, le=200)
    az_step_deg: float = Field(10.0, ge=5, le=30)


def _points(req: LinkRequest):
    if req.coord_system.upper().startswith("SK"):
        tx_lon, tx_lat = sk42_to_wgs84(req.tx_lon, req.tx_lat)
        rx_lon, rx_lat = sk42_to_wgs84(req.rx_lon, req.rx_lat)
    else:
        tx_lat, tx_lon = req.tx_lat, req.tx_lon
        rx_lat, rx_lon = req.rx_lat, req.rx_lon
    tx = Point(tx_lat, tx_lon, req.tx_height_m)
    rx = Point(rx_lat, rx_lon, req.rx_height_m)
    return tx, rx


def _equipment(req: LinkRequest):
    tx_eq = RadioEquipment(
        power_dbm=req.tx_power_dbm,
        gain_dbi=req.tx_gain_dbi,
        feeder_loss_db=req.tx_feeder_db,
        height_m=req.tx_height_m,
        polarization=Polarization(req.tx_pol),
        bw_az_3db=req.tx_bw_deg,
        antenna_type=AntennaType.SECTOR if req.tx_bw_deg < 360 else AntennaType.ISOTROPIC,
    )
    rx_eq = RadioEquipment(
        sensitivity_dbm=req.rx_sensitivity_dbm,
        gain_dbi=req.rx_gain_dbi,
        feeder_loss_db=req.rx_feeder_db,
        height_m=req.rx_height_m,
        polarization=Polarization(req.rx_pol),
    )
    return tx_eq, rx_eq


def _fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


# ── API endpoints ───────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def index():
    html = (TEMPLATES / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.get("/manifest.json")
def manifest():
    return FileResponse(STATIC / "manifest.json", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript")


@app.post("/api/link")
def api_link(req: LinkRequest):
    try:
        tx, rx = _points(req)
        tx_eq, rx_eq = _equipment(req)
        dist, az, _ = distance_azimuth(tx, rx)
        result = compute_link(
            tx, rx, tx_eq, rx_eq, req.freq_mhz, _dem,
            step_m=req.step_m, k_factor=req.k_factor,
        )
        profile = build_profile(
            Point(tx.lat, tx.lon, req.tx_height_m),
            Point(rx.lat, rx.lon, req.rx_height_m),
            _dem, step_m=req.step_m, k_factor=req.k_factor,
        )
        fig = plot_profile_matplotlib(
            profile, freq_mhz=req.freq_mhz,
            title=f"Профиль · {req.freq_mhz:.1f} МГц",
        )
        img_b64 = _fig_to_b64(fig)

        return {
            "ok": True,
            "distance_km": round(result.distance_m / 1000, 3),
            "azimuth_deg": round(az, 1),
            "path_loss_db": round(result.path_loss_db, 1),
            "pr_dbm": round(result.pr_dbm, 1),
            "margin_db": round(result.margin_db, 1),
            "is_covered": bool(result.is_covered),
            "fspl_db": round(free_space_loss_db(result.distance_m, req.freq_mhz), 1),
            "profile_image": img_b64,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/coverage")
def api_coverage(req: CoverageRequest):
    try:
        tx, rx = _points(req)
        tx_eq, rx_eq = _equipment(req)
        cov = circular_coverage(
            tx, tx_eq, rx_eq, req.freq_mhz, _dem,
            max_range_km=req.max_range_km,
            az_step_deg=req.az_step_deg,
            range_step_m=max(200.0, req.step_m),
            k_factor=req.k_factor,
        )
        fig = plot_coverage_polar_matplotlib(cov)
        img_b64 = _fig_to_b64(fig)
        covered_pct = float(100.0 * np.mean(cov["covered"]))
        return {
            "ok": True,
            "covered_pct": round(covered_pct, 1),
            "max_range_km": req.max_range_km,
            "coverage_image": img_b64,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


# Static files (CSS, JS, icons)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
