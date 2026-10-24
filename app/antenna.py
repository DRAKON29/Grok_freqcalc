"""Antenna pattern and polarization helpers."""

from __future__ import annotations

from enum import Enum
from typing import Optional

import numpy as np


class Polarization(str, Enum):
    HORIZONTAL = "H"
    VERTICAL = "V"
    LHCP = "LHCP"
    RHCP = "RHCP"


class AntennaType(str, Enum):
    ISOTROPIC = "isotropic"
    SECTOR = "sector"
    PARABOLIC = "parabolic"
    CUSTOM = "custom"


def gaussian_pattern(offset_deg: float, beamwidth_3db: float) -> float:
    """
    Approximate relative gain (linear) using Gaussian pattern.
    At ±beamwidth_3db/2 the gain is 0.5 (−3 dB).
    """
    if beamwidth_3db <= 0:
        return 1.0
    # half-power at bw/2 → sigma such that exp(-0.5*(bw/2/sigma)^2) = 0.5
    # → (bw/2/sigma)^2 = 2*ln(2) ≈ 1.386 → sigma = bw / (2*sqrt(1.386)) ≈ bw/2.355
    sigma = beamwidth_3db / 2.3548
    return float(np.exp(-0.5 * (offset_deg / sigma) ** 2))


def antenna_gain_dbi(
    g_max_dbi: float,
    az_offset_deg: float = 0.0,
    el_offset_deg: float = 0.0,
    bw_az_3db: float = 360.0,
    bw_el_3db: float = 360.0,
    antenna_type: AntennaType = AntennaType.ISOTROPIC,
) -> float:
    """
    Directional gain in dBi for given offsets from boresight.
    """
    if antenna_type == AntennaType.ISOTROPIC:
        return g_max_dbi

    g_az = gaussian_pattern(az_offset_deg, bw_az_3db)
    g_el = gaussian_pattern(el_offset_deg, bw_el_3db)
    return g_max_dbi + 10.0 * np.log10(max(g_az * g_el, 1e-12))


def polarization_mismatch_db(tx_pol: Polarization, rx_pol: Polarization) -> float:
    """
    Polarization mismatch loss in dB (positive = loss).
    Simplified model:
      - same linear → 0 dB
      - orthogonal linear → 20 dB (practical floor)
      - linear ↔ circular → 3 dB
      - opposite circular → 20 dB
      - same circular → 0 dB
    """
    if tx_pol == rx_pol:
        return 0.0
    linear = {Polarization.HORIZONTAL, Polarization.VERTICAL}
    circular = {Polarization.LHCP, Polarization.RHCP}

    if tx_pol in linear and rx_pol in linear:
        return 20.0  # orthogonal
    if tx_pol in circular and rx_pol in circular:
        return 20.0  # opposite sense
    # linear ↔ circular
    return 3.0
