"""Link budget and coverage calculation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

from .antenna import AntennaType, Polarization, antenna_gain_dbi, polarization_mismatch_db
from .dem import DEM, build_profile
from .geo import Point, point_at_distance
from .models import path_loss_along_profile, path_loss_db


@dataclass
class RadioEquipment:
    """Transmitter or receiver parameters."""
    power_dbm: float = 30.0          # Tx only; for Rx this is ignored
    sensitivity_dbm: float = -100.0  # Rx only
    gain_dbi: float = 0.0
    feeder_loss_db: float = 0.0
    height_m: float = 10.0
    polarization: Polarization = Polarization.VERTICAL
    bw_az_3db: float = 360.0
    bw_el_3db: float = 360.0
    antenna_type: AntennaType = AntennaType.ISOTROPIC
    # Antenna boresight (azimuth of main lobe, degrees from North)
    boresight_az_deg: float = 0.0


@dataclass
class LinkResult:
    distance_m: float
    path_loss_db: float
    pr_dbm: float
    margin_db: float
    is_covered: bool
    diffraction_loss_db: float = 0.0
    free_space_loss_db: float = 0.0


def compute_link(
    tx: Point,
    rx: Point,
    tx_eq: RadioEquipment,
    rx_eq: RadioEquipment,
    freq_mhz: float,
    dem: DEM,
    step_m: float = 100.0,
    k_factor: float = 4.0 / 3.0,
) -> LinkResult:
    """Point-to-point link budget."""
    tx_pt = Point(tx.lat, tx.lon, tx_eq.height_m)
    rx_pt = Point(rx.lat, rx.lon, rx_eq.height_m)

    profile = build_profile(tx_pt, rx_pt, dem, step_m=step_m, k_factor=k_factor)
    L = path_loss_db(
        profile["distances_m"],
        profile["effective_m"],
        profile["tx_height_m"],
        profile["rx_height_m"],
        freq_mhz,
    )

    # Antenna gains toward each other (simplified: assume elevation offset ≈ 0)
    from .geo import distance_azimuth
    _, az_tx_to_rx, az_rx_to_tx = distance_azimuth(tx_pt, rx_pt)

    gt = antenna_gain_dbi(
        tx_eq.gain_dbi,
        az_offset_deg=az_tx_to_rx - tx_eq.boresight_az_deg,
        bw_az_3db=tx_eq.bw_az_3db,
        bw_el_3db=tx_eq.bw_el_3db,
        antenna_type=tx_eq.antenna_type,
    )
    gr = antenna_gain_dbi(
        rx_eq.gain_dbi,
        az_offset_deg=az_rx_to_tx - rx_eq.boresight_az_deg,
        bw_az_3db=rx_eq.bw_az_3db,
        bw_el_3db=rx_eq.bw_el_3db,
        antenna_type=rx_eq.antenna_type,
    )

    pol_loss = polarization_mismatch_db(tx_eq.polarization, rx_eq.polarization)

    pr = (
        tx_eq.power_dbm
        + gt
        + gr
        - L
        - tx_eq.feeder_loss_db
        - rx_eq.feeder_loss_db
        - pol_loss
    )
    margin = pr - rx_eq.sensitivity_dbm

    return LinkResult(
        distance_m=profile["total_distance_m"],
        path_loss_db=L,
        pr_dbm=pr,
        margin_db=margin,
        is_covered=margin >= 0,
    )


def circular_coverage(
    tx: Point,
    tx_eq: RadioEquipment,
    rx_eq: RadioEquipment,
    freq_mhz: float,
    dem: DEM,
    max_range_km: float = 50.0,
    az_step_deg: float = 5.0,
    range_step_m: float = 200.0,
    k_factor: float = 4.0 / 3.0,
) -> dict:
    """
    Compute received power on a polar grid around the transmitter.
    Returns dict suitable for polar plotting:
        azimuths_deg, ranges_m, pr_dbm (2D array), covered (2D bool)
    """
    azimuths = np.arange(0.0, 360.0, az_step_deg)
    max_r = max_range_km * 1000.0
    n_r = max(2, int(max_r / range_step_m) + 1)
    ranges = np.linspace(range_step_m, max_r, n_r)  # skip 0

    pr_grid = np.full((len(azimuths), n_r), np.nan)
    covered = np.zeros((len(azimuths), n_r), dtype=bool)

    tx_pt = Point(tx.lat, tx.lon, tx_eq.height_m)

    for i, az in enumerate(azimuths):
        # End point of the ray
        end = point_at_distance(tx_pt, az, max_r)
        end.height_m = rx_eq.height_m

        profile = build_profile(tx_pt, end, dem, step_m=range_step_m, k_factor=k_factor)
        losses = path_loss_along_profile(
            profile["distances_m"],
            profile["effective_m"],
            profile["tx_height_m"],
            freq_mhz,
            rx_antenna_height_above_terrain=rx_eq.height_m,
        )

        # Antenna gain of Tx in this azimuth
        gt = antenna_gain_dbi(
            tx_eq.gain_dbi,
            az_offset_deg=az - tx_eq.boresight_az_deg,
            bw_az_3db=tx_eq.bw_az_3db,
            bw_el_3db=tx_eq.bw_el_3db,
            antenna_type=tx_eq.antenna_type,
        )
        gr = rx_eq.gain_dbi  # assume omni Rx for coverage map
        pol_loss = polarization_mismatch_db(tx_eq.polarization, rx_eq.polarization)

        # Interpolate loss onto the requested ranges
        for j, r in enumerate(ranges):
            # find nearest profile point
            idx = np.searchsorted(profile["distances_m"], r)
            idx = min(idx, len(losses) - 1)
            L = losses[idx]
            pr = (
                tx_eq.power_dbm
                + gt
                + gr
                - L
                - tx_eq.feeder_loss_db
                - rx_eq.feeder_loss_db
                - pol_loss
            )
            pr_grid[i, j] = pr
            covered[i, j] = pr >= rx_eq.sensitivity_dbm

    return {
        "azimuths_deg": azimuths,
        "ranges_m": ranges,
        "pr_dbm": pr_grid,
        "covered": covered,
        "max_range_km": max_range_km,
    }
