"""
Интерактивный прототип калькулятора радиодальности и радиотени.
Запуск:  streamlit run app/streamlit_app.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running from project root
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import streamlit as st
import matplotlib.pyplot as plt

from app.geo import Point, dms_to_decimal, distance_azimuth, sk42_to_wgs84
from app.dem import DEM, build_profile
from app.antenna import AntennaType, Polarization
from app.link_budget import RadioEquipment, compute_link, circular_coverage
from app.visualization import plot_profile_matplotlib, plot_coverage_polar_matplotlib
from app.models import free_space_loss_db, path_loss_db

st.set_page_config(
    page_title="Радиокалькулятор (прототип)",
    page_icon="📡",
    layout="wide",
)

st.title("📡 Калькулятор радиодальности и радиотени")
st.caption("Прототип на базе свободного пространства + дифракция (P.526-style) · СК-42 / WGS84 · SRTM / синтетический рельеф")

# ── Sidebar parameters ──────────────────────────────────────────────
with st.sidebar:
    st.header("Параметры")

    coord_system = st.radio("Система координат", ["WGS84", "СК-42 (Пулково-1942)"], index=0)

    st.subheader("Передатчик (Tx)")
    col1, col2 = st.columns(2)
    with col1:
        tx_lat = st.number_input("Широта Tx", value=55.7558, format="%.6f")
        tx_h = st.number_input("Высота подвеса Tx, м", value=30.0, min_value=0.0)
        tx_power = st.number_input("Мощность, дБм", value=30.0)
        tx_gain = st.number_input("Усиление Tx, дБи", value=8.0)
    with col2:
        tx_lon = st.number_input("Долгота Tx", value=37.6173, format="%.6f")
        tx_feeder = st.number_input("Потери фидера Tx, дБ", value=1.0, min_value=0.0)
        tx_bw = st.number_input("Ширина луча Tx (−3 дБ), °", value=60.0, min_value=1.0)
        tx_pol = st.selectbox("Поляризация Tx", ["V", "H", "LHCP", "RHCP"], index=0)

    st.subheader("Приёмник (Rx)")
    col3, col4 = st.columns(2)
    with col3:
        rx_lat = st.number_input("Широта Rx", value=55.8500, format="%.6f")
        rx_h = st.number_input("Высота подвеса Rx, м", value=10.0, min_value=0.0)
        rx_sens = st.number_input("Чувствительность, дБм", value=-105.0)
        rx_gain = st.number_input("Усиление Rx, дБи", value=2.0)
    with col4:
        rx_lon = st.number_input("Долгота Rx", value=37.7000, format="%.6f")
        rx_feeder = st.number_input("Потери фидера Rx, дБ", value=0.5, min_value=0.0)
        rx_pol = st.selectbox("Поляризация Rx", ["V", "H", "LHCP", "RHCP"], index=0)

    st.subheader("Частота и модель")
    freq = st.number_input("Частота, МГц", value=433.92, min_value=30.0, max_value=50000.0)
    k_factor = st.slider("k-фактор рефракции", 1.0, 2.0, 1.333, 0.01)
    step_m = st.slider("Шаг профиля, м", 50, 500, 100, 50)

    st.subheader("Покрытие (круговая диаграмма)")
    do_coverage = st.checkbox("Рассчитать круговую диаграмму", value=False)
    max_range = st.slider("Макс. дальность, км", 5, 100, 30)
    az_step = st.selectbox("Шаг азимута, °", [5, 10, 15, 30], index=1)

# ── Coordinate conversion ───────────────────────────────────────────
if coord_system.startswith("СК-42"):
    tx_lon_w, tx_lat_w = sk42_to_wgs84(tx_lon, tx_lat)
    rx_lon_w, rx_lat_w = sk42_to_wgs84(rx_lon, rx_lat)
    st.info(f"СК-42 → WGS84  |  Tx: {tx_lat_w:.6f}, {tx_lon_w:.6f}  ·  Rx: {rx_lat_w:.6f}, {rx_lon_w:.6f}")
else:
    tx_lat_w, tx_lon_w = tx_lat, tx_lon
    rx_lat_w, rx_lon_w = rx_lat, rx_lon

tx_pt = Point(tx_lat_w, tx_lon_w, tx_h)
rx_pt = Point(rx_lat_w, rx_lon_w, rx_h)

tx_eq = RadioEquipment(
    power_dbm=tx_power,
    gain_dbi=tx_gain,
    feeder_loss_db=tx_feeder,
    height_m=tx_h,
    polarization=Polarization(tx_pol),
    bw_az_3db=tx_bw,
    antenna_type=AntennaType.SECTOR if tx_bw < 360 else AntennaType.ISOTROPIC,
)
rx_eq = RadioEquipment(
    sensitivity_dbm=rx_sens,
    gain_dbi=rx_gain,
    feeder_loss_db=rx_feeder,
    height_m=rx_h,
    polarization=Polarization(rx_pol),
)

# DEM (synthetic by default)
dem = DEM(hgt_dir=Path(__file__).resolve().parents[1] / "data" / "hgt", use_synthetic=True)

# ── Point-to-point calculation ──────────────────────────────────────
st.header("1. Расчёт точки-точка")

dist_m, az12, az21 = distance_azimuth(tx_pt, rx_pt)
result = compute_link(tx_pt, rx_pt, tx_eq, rx_eq, freq, dem, step_m=step_m, k_factor=k_factor)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Расстояние", f"{result.distance_m/1000:.2f} км")
c2.metric("Потери пути", f"{result.path_loss_db:.1f} дБ")
c3.metric("Pr", f"{result.pr_dbm:.1f} дБм")
c4.metric(
    "Запас / тень",
    f"{result.margin_db:+.1f} дБ",
    delta="Покрытие OK" if result.is_covered else "РАДИОТЕНЬ",
    delta_color="normal" if result.is_covered else "inverse",
)

# Profile
profile = build_profile(
    Point(tx_pt.lat, tx_pt.lon, tx_h),
    Point(rx_pt.lat, rx_pt.lon, rx_h),
    dem, step_m=step_m, k_factor=k_factor,
)
fig_prof = plot_profile_matplotlib(profile, freq_mhz=freq, title=f"Профиль трассы · {freq:.2f} МГц")
st.pyplot(fig_prof)
plt.close(fig_prof)

# ── Circular coverage ───────────────────────────────────────────────
if do_coverage:
    st.header("2. Круговая диаграмма покрытия")
    with st.spinner("Расчёт покрытия… (может занять 10–60 с)"):
        cov = circular_coverage(
            tx_pt, tx_eq, rx_eq, freq, dem,
            max_range_km=max_range,
            az_step_deg=float(az_step),
            range_step_m=max(200.0, step_m),
            k_factor=k_factor,
        )
    fig_cov = plot_coverage_polar_matplotlib(cov, sensitivity_dbm=rx_sens)
    st.pyplot(fig_cov)
    plt.close(fig_cov)

    covered_pct = 100.0 * np.mean(cov["covered"])
    st.metric("Доля покрытых точек сетки", f"{covered_pct:.1f} %")

st.markdown("---")
st.markdown(
    """
**Ограничения прототипа**
- Модель: свободное пространство + одиночная дифракция (knife-edge, P.526-style). Полный ITU-R P.2001 не реализован.
- Рельеф: синтетический (гауссовы холмы) при отсутствии локальных HGT-тайлов.
- Для реальных расчётов положите файлы `NxxEyyy.hgt` в `data/hgt/`.
- Поляризация и ДН учитываются упрощённо.
"""
)
