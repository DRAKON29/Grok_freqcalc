#!/usr/bin/env python3
"""CLI demo of the radio calculator prototype."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.geo import Point, distance_azimuth, sk42_to_wgs84
from app.dem import DEM, build_profile
from app.antenna import Polarization, AntennaType
from app.link_budget import RadioEquipment, compute_link, circular_coverage
from app.visualization import plot_profile_matplotlib, plot_coverage_polar_matplotlib
from app.models import free_space_loss_db

import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description="Radio range & shadow calculator (prototype)")
    parser.add_argument("--tx-lat", type=float, default=55.7558, help="Tx latitude (WGS84)")
    parser.add_argument("--tx-lon", type=float, default=37.6173, help="Tx longitude (WGS84)")
    parser.add_argument("--rx-lat", type=float, default=55.8500)
    parser.add_argument("--rx-lon", type=float, default=37.7000)
    parser.add_argument("--freq", type=float, default=433.92, help="Frequency MHz")
    parser.add_argument("--tx-power", type=float, default=30.0, help="Tx power dBm")
    parser.add_argument("--tx-h", type=float, default=30.0, help="Tx antenna height m")
    parser.add_argument("--rx-h", type=float, default=10.0, help="Rx antenna height m")
    parser.add_argument("--sens", type=float, default=-105.0, help="Rx sensitivity dBm")
    parser.add_argument("--coverage", action="store_true", help="Also compute circular coverage")
    parser.add_argument("--max-range", type=float, default=30.0, help="Coverage max range km")
    parser.add_argument("--out", type=str, default="output", help="Output directory for plots")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    dem = DEM(hgt_dir=Path("data/hgt"), use_synthetic=True)

    tx = Point(args.tx_lat, args.tx_lon, args.tx_h)
    rx = Point(args.rx_lat, args.rx_lon, args.rx_h)

    tx_eq = RadioEquipment(
        power_dbm=args.tx_power,
        gain_dbi=8.0,
        feeder_loss_db=1.0,
        height_m=args.tx_h,
        polarization=Polarization.VERTICAL,
        bw_az_3db=60.0,
        antenna_type=AntennaType.SECTOR,
    )
    rx_eq = RadioEquipment(
        sensitivity_dbm=args.sens,
        gain_dbi=2.0,
        feeder_loss_db=0.5,
        height_m=args.rx_h,
        polarization=Polarization.VERTICAL,
    )

    dist, az, _ = distance_azimuth(tx, rx)
    print(f"Трасса: {dist/1000:.2f} км, азимут {az:.1f}°")
    print(f"Частота: {args.freq} МГц")

    result = compute_link(tx, rx, tx_eq, rx_eq, args.freq, dem)
    print(f"Потери пути : {result.path_loss_db:.1f} дБ")
    print(f"Pr          : {result.pr_dbm:.1f} дБм")
    print(f"Запас       : {result.margin_db:+.1f} дБ  →  {'ПОКРЫТИЕ' if result.is_covered else 'РАДИОТЕНЬ'}")

    # Profile plot
    profile = build_profile(
        Point(tx.lat, tx.lon, args.tx_h),
        Point(rx.lat, rx.lon, args.rx_h),
        dem,
    )
    fig = plot_profile_matplotlib(profile, freq_mhz=args.freq)
    fig.savefig(out_dir / "profile.png", dpi=120)
    plt.close(fig)
    print(f"Профиль сохранён: {out_dir / 'profile.png'}")

    if args.coverage:
        print("Расчёт круговой диаграммы…")
        cov = circular_coverage(
            tx, tx_eq, rx_eq, args.freq, dem,
            max_range_km=args.max_range,
            az_step_deg=10.0,
            range_step_m=300.0,
        )
        fig2 = plot_coverage_polar_matplotlib(cov)
        fig2.savefig(out_dir / "coverage.png", dpi=120)
        plt.close(fig2)
        print(f"Диаграмма сохранена: {out_dir / 'coverage.png'}")
        print(f"Доля покрытых точек: {100*cov['covered'].mean():.1f}%")

    print("Готово.")


if __name__ == "__main__":
    main()
