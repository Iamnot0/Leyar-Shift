"""Reference evapotranspiration by the FAO-56 Penman-Monteith method (Allen et al. 1998, equation 6)."""

from __future__ import annotations

import numpy as np

SOLAR_CONSTANT = 0.0820
STEFAN_BOLTZMANN = 4.903e-9
ALBEDO = 0.23


def saturation_vapour_pressure(temperature_c: np.ndarray) -> np.ndarray:
    return 0.6108 * np.exp(17.27 * temperature_c / (temperature_c + 237.3))


def extraterrestrial_radiation(latitude_deg: float, day_of_year: np.ndarray) -> np.ndarray:
    phi = np.radians(latitude_deg)
    relative_distance = 1 + 0.033 * np.cos(2 * np.pi * day_of_year / 365)
    declination = 0.409 * np.sin(2 * np.pi * day_of_year / 365 - 1.39)
    # Clipping covers polar day and night, where the sun never sets or never rises.
    sunset_angle = np.arccos(np.clip(-np.tan(phi) * np.tan(declination), -1.0, 1.0))
    return (24 * 60 / np.pi) * SOLAR_CONSTANT * relative_distance * (
        sunset_angle * np.sin(phi) * np.sin(declination) + np.cos(phi) * np.cos(declination) * np.sin(sunset_angle))


def reference_et(tmax: np.ndarray, tmin: np.ndarray, tdew: np.ndarray, wind_2m: np.ndarray, solar: np.ndarray,
                 day_of_year: np.ndarray, latitude_deg: float, elevation_m: float) -> np.ndarray:
    """Daily grass reference evapotranspiration, mm/day. Inputs in degrees C, m/s and MJ/m2/day."""
    mean = (tmax + tmin) / 2
    pressure = 101.3 * ((293 - 0.0065 * elevation_m) / 293) ** 5.26
    psychrometric = 0.000665 * pressure
    slope = 4098 * saturation_vapour_pressure(mean) / (mean + 237.3) ** 2
    saturation = (saturation_vapour_pressure(tmax) + saturation_vapour_pressure(tmin)) / 2
    actual = np.minimum(saturation_vapour_pressure(tdew), saturation)

    clear_sky = (0.75 + 2e-5 * elevation_m) * extraterrestrial_radiation(latitude_deg, day_of_year)
    cloud_ratio = np.clip(np.divide(solar, clear_sky, out=np.ones_like(solar), where=clear_sky > 0), 0.25, 1.0)
    net_shortwave = (1 - ALBEDO) * solar
    net_longwave = STEFAN_BOLTZMANN * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * np.sqrt(actual)) * (1.35 * cloud_ratio - 0.35)
    net_radiation = net_shortwave - net_longwave

    numerator = 0.408 * slope * net_radiation + psychrometric * 900 / (mean + 273) * wind_2m * (saturation - actual)
    return np.maximum(numerator / (slope + psychrometric * (1 + 0.34 * wind_2m)), 0.0)
