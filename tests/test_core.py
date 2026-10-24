"""Minimal smoke tests for the prototype."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from app.geo import Point, sk42_to_wgs84, distance_azimuth, dms_to_decimal
from app.dem import DEM, build_profile, fresnel_radius
from app.models import free_space_loss_db, knife_edge_loss_db, path_loss_db
from app.link_budget import RadioEquipment, compute_link
from app.antenna import Polarization, AntennaType


def test_sk42_conversion():
    # Approximate known point near Moscow
    lon_w, lat_w = sk42_to_wgs84(37.6173, 55.7558)
    assert 37.5 < lon_w < 37.8
    assert 55.6 < lat_w < 55.9


def test_dms():
    assert abs(dms_to_decimal(55, 45, 20.88) - 55.7558) < 0.001


def test_fspl():
    # Classic check: 1 km @ 100 MHz ≈ 72.4 dB
    L = free_space_loss_db(1000, 100)
    assert 72 < L < 73


def test_knife_edge():
    assert knife_edge_loss_db(-1.0) == 0.0
    assert knife_edge_loss_db(0.0) > 5
    assert knife_edge_loss_db(2.0) > 15


def test_link():
    dem = DEM(use_synthetic=True)
    tx = Point(55.75, 37.60, 30)
    rx = Point(55.80, 37.65, 10)
    tx_eq = RadioEquipment(power_dbm=30, gain_dbi=5, height_m=30)
    rx_eq = RadioEquipment(sensitivity_dbm=-100, gain_dbi=0, height_m=10)
    res = compute_link(tx, rx, tx_eq, rx_eq, 433.0, dem)
    assert res.distance_m > 0
    assert res.path_loss_db > 50
    assert isinstance(res.is_covered, (bool, np.bool_))


def test_profile():
    dem = DEM(use_synthetic=True)
    p1 = Point(55.75, 37.60, 20)
    p2 = Point(55.80, 37.70, 5)
    prof = build_profile(p1, p2, dem, step_m=200)
    assert len(prof["distances_m"]) > 5
    assert prof["total_distance_m"] > 1000


if __name__ == "__main__":
    test_sk42_conversion()
    test_dms()
    test_fspl()
    test_knife_edge()
    test_link()
    test_profile()
    print("All smoke tests passed.")
