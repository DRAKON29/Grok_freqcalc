"""Plotting helpers for profile and polar coverage."""

from __future__ import annotations

from typing import Optional

import numpy as np

try:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    HAS_PLOTLY = True
except ImportError:
    HAS_PLOTLY = False

import matplotlib.pyplot as plt
from matplotlib.figure import Figure


def plot_profile_matplotlib(
    profile: dict,
    freq_mhz: float = 433.0,
    title: str = "Terrain profile",
) -> Figure:
    """Classic terrain profile with LOS and first Fresnel zone."""
    from .models import wavelength_m
    from .dem import fresnel_radius

    d = profile["distances_m"] / 1000.0  # km
    terrain = profile["terrain_m"]
    effective = profile["effective_m"]
    tx_h = profile["tx_height_m"]
    rx_h = profile["rx_height_m"]
    D = profile["total_distance_m"]

    los = tx_h + (rx_h - tx_h) * (profile["distances_m"] / D)

    wl = wavelength_m(freq_mhz)
    fresnel = np.array([
        fresnel_radius(di, D - di, wl) for di in profile["distances_m"]
    ])

    fig, ax = plt.subplots(figsize=(12, 5))
    ax.fill_between(d, terrain, alpha=0.4, color="forestgreen", label="Рельеф")
    ax.plot(d, terrain, color="darkgreen", lw=1)
    ax.plot(d, los, "r--", lw=1.5, label="Линия визирования")
    ax.plot(d, los + fresnel, "b:", lw=1, alpha=0.7, label="1-я зона Френеля")
    ax.plot(d, los - fresnel, "b:", lw=1, alpha=0.7)

    ax.plot(0, tx_h, "r^", markersize=12, label="Tx")
    ax.plot(d[-1], rx_h, "bv", markersize=12, label="Rx")

    ax.set_xlabel("Расстояние, км")
    ax.set_ylabel("Высота, м")
    ax.set_title(title)
    ax.legend(loc="best")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    return fig


def plot_coverage_polar_matplotlib(
    coverage: dict,
    sensitivity_dbm: float = -100.0,
    title: str = "Зона покрытия",
) -> Figure:
    """Polar plot of received power / coverage."""
    az = np.deg2rad(coverage["azimuths_deg"])
    r = coverage["ranges_m"] / 1000.0  # km
    pr = coverage["pr_dbm"]

    # Mesh for pcolormesh
    AZ, R = np.meshgrid(az, r, indexing="ij")

    fig = plt.figure(figsize=(8, 8))
    ax = fig.add_subplot(111, projection="polar")
    # 0° at North, clockwise
    ax.set_theta_zero_location("N")
    ax.set_theta_direction(-1)

    pcm = ax.pcolormesh(AZ, R, pr, cmap="RdYlGn", shading="auto")
    cbar = fig.colorbar(pcm, ax=ax, shrink=0.7, label="Pr, дБм")
    ax.set_title(title, pad=20)
    fig.tight_layout()
    return fig


def plot_profile_plotly(profile: dict, freq_mhz: float = 433.0, title: str = "Профиль рельефа"):
    if not HAS_PLOTLY:
        raise RuntimeError("plotly not installed")
    from .models import wavelength_m
    from .dem import fresnel_radius

    d = profile["distances_m"] / 1000.0
    terrain = profile["terrain_m"]
    tx_h = profile["tx_height_m"]
    rx_h = profile["rx_height_m"]
    D = profile["total_distance_m"]
    los = tx_h + (rx_h - tx_h) * (profile["distances_m"] / D)
    wl = wavelength_m(freq_mhz)
    fresnel = np.array([fresnel_radius(di, D - di, wl) for di in profile["distances_m"]])

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=d, y=terrain, fill="tozeroy", name="Рельеф",
        line=dict(color="green"), fillcolor="rgba(34,139,34,0.4)"
    ))
    fig.add_trace(go.Scatter(x=d, y=los, name="LOS", line=dict(color="red", dash="dash")))
    fig.add_trace(go.Scatter(
        x=d, y=los + fresnel, name="Френель +",
        line=dict(color="blue", dash="dot", width=1)
    ))
    fig.add_trace(go.Scatter(
        x=d, y=los - fresnel, name="Френель −",
        line=dict(color="blue", dash="dot", width=1)
    ))
    fig.add_trace(go.Scatter(
        x=[0], y=[tx_h], mode="markers", name="Tx",
        marker=dict(symbol="triangle-up", size=14, color="red")
    ))
    fig.add_trace(go.Scatter(
        x=[d[-1]], y=[rx_h], mode="markers", name="Rx",
        marker=dict(symbol="triangle-down", size=14, color="blue")
    ))
    fig.update_layout(
        title=title,
        xaxis_title="Расстояние, км",
        yaxis_title="Высота, м",
        template="plotly_white",
        height=450,
    )
    return fig


def plot_coverage_polar_plotly(coverage: dict, title: str = "Зона покрытия"):
    if not HAS_PLOTLY:
        raise RuntimeError("plotly not installed")

    az = coverage["azimuths_deg"]
    r = coverage["ranges_m"] / 1000.0
    pr = coverage["pr_dbm"]

    fig = go.Figure()
    fig.add_trace(go.Barpolar(
        r=np.full(len(az), r[-1]),
        theta=az,
        marker_color=pr[:, -1],  # outer ring colour as proxy
        marker_colorscale="RdYlGn",
        name="Pr @ max range",
    ))
    # Better: scatter polar heatmap style
    # Flatten for scatterpolar
    AZ, R = np.meshgrid(az, r, indexing="ij")
    fig = go.Figure(data=go.Scatterpolar(
        r=R.ravel(),
        theta=AZ.ravel(),
        mode="markers",
        marker=dict(
            size=6,
            color=pr.ravel(),
            colorscale="RdYlGn",
            colorbar=dict(title="Pr, дБм"),
            opacity=0.8,
        ),
    ))
    fig.update_layout(
        title=title,
        polar=dict(
            angularaxis=dict(direction="clockwise", rotation=90),
            radialaxis=dict(title="км"),
        ),
        height=600,
        template="plotly_white",
    )
    return fig
