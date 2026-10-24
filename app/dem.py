"""Digital Elevation Model handling: SRTM HGT reader + synthetic terrain for demos."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

import numpy as np
from scipy.interpolate import RegularGridInterpolator

from .geo import EARTH_RADIUS_M, Point, intermediate_points


class SyntheticTerrain:
    """
    Simple procedural terrain for demos when real HGT tiles are unavailable.
    Combines several Gaussian hills and a gentle ridge.
    """

    def __init__(self, seed: int = 42):
        rng = np.random.default_rng(seed)
        # Hills: (lat0, lon0, height_m, sigma_deg)
        self.hills = [
            (55.75, 37.60, 180.0, 0.08),   # around Moscow-like area
            (55.80, 37.70, 120.0, 0.06),
            (55.70, 37.55, 90.0, 0.10),
            (55.78, 37.45, 150.0, 0.07),
        ]
        # Add a few random ones
        for _ in range(5):
            lat = 55.6 + rng.random() * 0.4
            lon = 37.3 + rng.random() * 0.6
            h = 40 + rng.random() * 120
            s = 0.04 + rng.random() * 0.08
            self.hills.append((lat, lon, h, s))

    def elevation(self, lat: float, lon: float) -> float:
        z = 50.0  # base elevation
        for lat0, lon0, h, sigma in self.hills:
            d2 = ((lat - lat0) / sigma) ** 2 + ((lon - lon0) / sigma) ** 2
            z += h * np.exp(-0.5 * d2)
        return float(z)

    def elevations(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        return np.array([self.elevation(la, lo) for la, lo in zip(lats, lons)])


class HGTReader:
    """
    Reader for SRTM .hgt files (1" or 3").
    Expects files named NxxEyyy.hgt or SxxWyyy.hgt in a directory.
    """

    def __init__(self, hgt_dir: Path | str):
        self.hgt_dir = Path(hgt_dir)
        self._cache: dict[str, np.ndarray] = {}

    def _tile_name(self, lat: float, lon: float) -> str:
        lat_i = int(np.floor(lat))
        lon_i = int(np.floor(lon))
        ns = "N" if lat_i >= 0 else "S"
        ew = "E" if lon_i >= 0 else "W"
        return f"{ns}{abs(lat_i):02d}{ew}{abs(lon_i):03d}.hgt"

    def _load_tile(self, name: str) -> np.ndarray:
        if name in self._cache:
            return self._cache[name]
        path = self.hgt_dir / name
        if not path.exists():
            raise FileNotFoundError(f"HGT tile not found: {path}")
        raw = np.fromfile(path, dtype=">i2")
        # Detect resolution
        if raw.size == 1201 * 1201:
            size = 1201
        elif raw.size == 3601 * 3601:
            size = 3601
        else:
            raise ValueError(f"Unexpected HGT size {raw.size} for {name}")
        data = raw.reshape((size, size)).astype(np.float64)
        data[data == -32768] = np.nan
        self._cache[name] = data
        return data

    def elevation(self, lat: float, lon: float) -> float:
        name = self._tile_name(lat, lon)
        data = self._load_tile(name)
        size = data.shape[0]
        lat_i = int(np.floor(lat))
        lon_i = int(np.floor(lon))
        # Row 0 = north edge of tile
        row = (1.0 - (lat - lat_i)) * (size - 1)
        col = (lon - lon_i) * (size - 1)
        r0, c0 = int(row), int(col)
        r1 = min(r0 + 1, size - 1)
        c1 = min(c0 + 1, size - 1)
        dr, dc = row - r0, col - c0
        z = (
            data[r0, c0] * (1 - dr) * (1 - dc)
            + data[r1, c0] * dr * (1 - dc)
            + data[r0, c1] * (1 - dr) * dc
            + data[r1, c1] * dr * dc
        )
        if np.isnan(z):
            return 0.0
        return float(z)

    def elevations(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        return np.array([self.elevation(la, lo) for la, lo in zip(lats, lons)])


class DEM:
    """Unified DEM interface: tries HGT, falls back to synthetic."""

    def __init__(
        self,
        hgt_dir: Optional[Path | str] = None,
        use_synthetic: bool = True,
        synthetic_seed: int = 42,
    ):
        self.hgt: Optional[HGTReader] = None
        if hgt_dir is not None:
            p = Path(hgt_dir)
            if p.exists():
                self.hgt = HGTReader(p)
        self.synthetic = SyntheticTerrain(seed=synthetic_seed) if use_synthetic else None
        if self.hgt is None and self.synthetic is None:
            raise RuntimeError("No DEM source available")

    def elevation(self, lat: float, lon: float) -> float:
        if self.hgt is not None:
            try:
                return self.hgt.elevation(lat, lon)
            except FileNotFoundError:
                pass
        if self.synthetic is not None:
            return self.synthetic.elevation(lat, lon)
        return 0.0

    def elevations(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        if self.hgt is not None:
            try:
                return self.hgt.elevations(lats, lons)
            except FileNotFoundError:
                pass
        if self.synthetic is not None:
            return self.synthetic.elevations(lats, lons)
        return np.zeros_like(lats, dtype=float)


def build_profile(
    p1: Point,
    p2: Point,
    dem: DEM,
    step_m: float = 100.0,
    k_factor: float = 4.0 / 3.0,
) -> dict:
    """
    Build terrain profile between two points with Earth curvature correction.

    Returns dict with keys:
        distances_m, lats, lons,
        terrain_m,          # raw terrain elevation
        effective_m,        # terrain corrected for curvature (for ray tracing)
        tx_height_m, rx_height_m  (absolute = terrain + antenna)
    """
    distances, lats, lons = intermediate_points(p1, p2, step_m=step_m)
    terrain = dem.elevations(lats, lons)

    D = distances[-1]
    # Effective Earth radius
    Re_eff = EARTH_RADIUS_M * k_factor
    # Curvature drop relative to the chord (approx)
    curvature = distances * (D - distances) / (2.0 * Re_eff)
    effective = terrain - curvature

    tx_abs = terrain[0] + p1.height_m
    rx_abs = terrain[-1] + p2.height_m

    return {
        "distances_m": distances,
        "lats": lats,
        "lons": lons,
        "terrain_m": terrain,
        "effective_m": effective,
        "tx_height_m": tx_abs,
        "rx_height_m": rx_abs,
        "k_factor": k_factor,
        "total_distance_m": D,
    }


def fresnel_radius(d1: float, d2: float, wavelength_m: float, n: int = 1) -> float:
    """Radius of the n-th Fresnel zone at a point between Tx and Rx."""
    if d1 <= 0 or d2 <= 0:
        return 0.0
    return np.sqrt(n * wavelength_m * d1 * d2 / (d1 + d2))
