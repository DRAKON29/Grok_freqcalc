"""Propagation models – free-space, simple knife-edge diffraction (ITU-R P.526 style).

Full ITU-R P.2001 is complex; this prototype implements a practical core:
  L = L_fs + L_diff + L_gas (approx)
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def free_space_loss_db(distance_m: float, freq_mhz: float) -> float:
    """Free-space path loss in dB."""
    if distance_m <= 0:
        return 0.0
    d_km = distance_m / 1000.0
    return 20.0 * np.log10(d_km) + 20.0 * np.log10(freq_mhz) + 32.44


def wavelength_m(freq_mhz: float) -> float:
    return 299.792458 / freq_mhz  # c ≈ 3e8 m/s → 300/f_MHz


def knife_edge_loss_db(v: float) -> float:
    """
    Diffraction loss for a single knife-edge obstacle (ITU-R P.526 approximation).
    v – Fresnel-Kirchhoff diffraction parameter.
    """
    if v < -0.78:
        return 0.0
    return 6.9 + 20.0 * np.log10(np.sqrt((v - 0.1) ** 2 + 1) + v - 0.1)


def compute_v(
    h: float,
    d1: float,
    d2: float,
    wavelength: float,
) -> float:
    """
    Diffraction parameter v.
    h – clearance (negative when obstacle protrudes into the line-of-sight).
    """
    if d1 <= 0 or d2 <= 0 or wavelength <= 0:
        return -10.0
    return h * np.sqrt(2.0 / wavelength * (1.0 / d1 + 1.0 / d2))


def find_main_obstacle(
    distances: np.ndarray,
    effective_h: np.ndarray,
    tx_h: float,
    rx_h: float,
) -> Optional[dict]:
    """
    Find the dominant obstacle (maximum obstruction relative to LOS).
    Returns dict with index, h_clearance, d1, d2 or None if clear LOS.
    """
    D = distances[-1]
    if D <= 0:
        return None

    # LOS height at each point (linear in effective profile coordinates)
    los = tx_h + (rx_h - tx_h) * (distances / D)

    # Clearance: positive = obstacle above LOS
    clearance = effective_h - los
    # Ignore ends (Tx/Rx themselves)
    if len(clearance) < 3:
        return None
    mid = clearance[1:-1]
    if mid.size == 0:
        return None
    idx = int(np.argmax(mid)) + 1
    h_obs = clearance[idx]
    if h_obs <= 0:
        return None  # clear
    return {
        "index": idx,
        "h_clearance": float(h_obs),
        "d1": float(distances[idx]),
        "d2": float(D - distances[idx]),
        "terrain_h": float(effective_h[idx]),
    }


def diffraction_loss_single(
    distances: np.ndarray,
    effective_h: np.ndarray,
    tx_h: float,
    rx_h: float,
    freq_mhz: float,
) -> float:
    """Single-knife-edge diffraction loss (dB)."""
    obs = find_main_obstacle(distances, effective_h, tx_h, rx_h)
    if obs is None:
        return 0.0
    wl = wavelength_m(freq_mhz)
    v = compute_v(obs["h_clearance"], obs["d1"], obs["d2"], wl)
    return knife_edge_loss_db(v)


def gas_attenuation_approx(distance_m: float, freq_mhz: float) -> float:
    """
    Very rough gaseous attenuation (O2 + H2O) for standard atmosphere.
    Valid mainly for illustration; real values from ITU-R P.676.
    """
    d_km = distance_m / 1000.0
    # Rough specific attenuation γ (dB/km)
    if freq_mhz < 1000:
        gamma = 0.005  # almost negligible at VHF/UHF
    elif freq_mhz < 10000:
        gamma = 0.01 + 0.0005 * (freq_mhz / 1000)
    else:
        gamma = 0.05
    return gamma * d_km


def path_loss_db(
    distances: np.ndarray,
    effective_h: np.ndarray,
    tx_h: float,
    rx_h: float,
    freq_mhz: float,
    include_diffraction: bool = True,
    include_gas: bool = True,
) -> float:
    """
    Total path loss (dB) for a given profile.
    Core of the prototype model (approximation of P.2001 LOS/diffraction part).
    """
    D = distances[-1]
    Lfs = free_space_loss_db(D, freq_mhz)
    Ld = 0.0
    if include_diffraction:
        Ld = diffraction_loss_single(distances, effective_h, tx_h, rx_h, freq_mhz)
    Lg = gas_attenuation_approx(D, freq_mhz) if include_gas else 0.0
    return Lfs + Ld + Lg


def path_loss_along_profile(
    distances: np.ndarray,
    effective_h: np.ndarray,
    tx_h: float,
    freq_mhz: float,
    rx_antenna_height_above_terrain: float = 1.5,
) -> np.ndarray:
    """
    Path loss from Tx to every point along the profile
    (useful for coverage / circular diagram).
    Assumes Rx antenna height is constant above local terrain.
    """
    n = len(distances)
    losses = np.zeros(n)
    for i in range(1, n):
        # Local Rx absolute height
        rx_h = effective_h[i] + rx_antenna_height_above_terrain
        # Sub-profile
        d_sub = distances[: i + 1]
        h_sub = effective_h[: i + 1]
        losses[i] = path_loss_db(d_sub, h_sub, tx_h, rx_h, freq_mhz)
    losses[0] = 0.0
    return losses
