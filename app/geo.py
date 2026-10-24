"""Coordinate transformations and geodesic calculations.
SK-42 (Pulkovo 1942, EPSG:4284) ↔ WGS84 (EPSG:4326).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import numpy as np
from pyproj import Geod, Transformer

# SK-42 (Pulkovo 1942) → WGS84
_TRANSFORMER = Transformer.from_crs("EPSG:4284", "EPSG:4326", always_xy=True)
_TRANSFORMER_INV = Transformer.from_crs("EPSG:4326", "EPSG:4284", always_xy=True)
_GEOD = Geod(ellps="WGS84")

EARTH_RADIUS_M = 6_371_000.0  # mean Earth radius


@dataclass
class Point:
    """Geographic point. Coordinates stored as WGS84 decimal degrees."""
    lat: float  # degrees
    lon: float  # degrees
    height_m: float = 0.0  # antenna height above ground / terrain

    def __post_init__(self):
        if not (-90 <= self.lat <= 90):
            raise ValueError(f"Latitude out of range: {self.lat}")
        if not (-180 <= self.lon <= 180):
            raise ValueError(f"Longitude out of range: {self.lon}")


def sk42_to_wgs84(lon_sk42: float, lat_sk42: float) -> Tuple[float, float]:
    """Convert SK-42 (lon, lat) decimal degrees → WGS84 (lon, lat)."""
    lon_wgs, lat_wgs = _TRANSFORMER.transform(lon_sk42, lat_sk42)
    return lon_wgs, lat_wgs


def wgs84_to_sk42(lon_wgs: float, lat_wgs: float) -> Tuple[float, float]:
    """Convert WGS84 → SK-42."""
    lon_sk, lat_sk = _TRANSFORMER_INV.transform(lon_wgs, lat_wgs)
    return lon_sk, lat_sk


def dms_to_decimal(degrees: float, minutes: float = 0.0, seconds: float = 0.0) -> float:
    """Convert degrees-minutes-seconds to decimal degrees."""
    sign = 1 if degrees >= 0 else -1
    return sign * (abs(degrees) + minutes / 60.0 + seconds / 3600.0)


def decimal_to_dms(decimal: float) -> Tuple[int, int, float]:
    """Convert decimal degrees to (degrees, minutes, seconds)."""
    sign = 1 if decimal >= 0 else -1
    abs_dec = abs(decimal)
    d = int(abs_dec)
    m_float = (abs_dec - d) * 60
    m = int(m_float)
    s = (m_float - m) * 60
    return sign * d, m, s


def distance_azimuth(p1: Point, p2: Point) -> Tuple[float, float, float]:
    """
    Great-circle distance and forward/back azimuths between two points.
    Returns (distance_m, az_forward_deg, az_back_deg).
    """
    az12, az21, dist = _GEOD.inv(p1.lon, p1.lat, p2.lon, p2.lat)
    return dist, az12, az21


def point_at_distance(origin: Point, azimuth_deg: float, distance_m: float) -> Point:
    """Return a new Point at given distance and azimuth from origin."""
    lon, lat, _ = _GEOD.fwd(origin.lon, origin.lat, azimuth_deg, distance_m)
    return Point(lat=lat, lon=lon)


def intermediate_points(
    p1: Point,
    p2: Point,
    step_m: float = 100.0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Generate intermediate points along the great-circle path.
    Returns (distances_m, lats, lons) arrays.
    """
    dist, az12, _ = distance_azimuth(p1, p2)
    n = max(2, int(np.ceil(dist / step_m)) + 1)
    distances = np.linspace(0.0, dist, n)
    lats = np.empty(n)
    lons = np.empty(n)
    for i, d in enumerate(distances):
        lon, lat, _ = _GEOD.fwd(p1.lon, p1.lat, az12, d)
        lats[i] = lat
        lons[i] = lon
    return distances, lats, lons
