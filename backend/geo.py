"""Offline distance filter for Dhaka. No geocoding API, no key, no quota.

A lookup table of the areas that actually appear in Bangladeshi job postings is
enough here: postings say "Gulshan 1, Dhaka", not a street address.
"""
from __future__ import annotations

import math
import re

from .normalize import slug

HOME = (23.7639, 90.3931)  # Tejgaon, Dhaka

AREAS: dict[str, tuple[float, float]] = {
    "tejgaon": (23.7639, 90.3931), "tejgaon industrial area": (23.7660, 90.3990),
    "nakhalpara": (23.7700, 90.3930), "farmgate": (23.7580, 90.3897),
    "karwan bazar": (23.7509, 90.3934), "kawran bazar": (23.7509, 90.3934),
    "panthapath": (23.7515, 90.3840), "banglamotor": (23.7448, 90.3942),
    "shahbagh": (23.7389, 90.3956), "segunbagicha": (23.7350, 90.4030),
    "kakrail": (23.7385, 90.4050), "paltan": (23.7350, 90.4120),
    "bijoynagar": (23.7361, 90.4085), "motijheel": (23.7330, 90.4172),
    "dilkusha": (23.7290, 90.4170), "shantinagar": (23.7400, 90.4126),
    "malibagh": (23.7481, 90.4160), "moghbazar": (23.7480, 90.4060),
    "mouchak": (23.7460, 90.4110), "rampura": (23.7614, 90.4204),
    "banasree": (23.7620, 90.4290), "khilgaon": (23.7500, 90.4260),
    "hatirjheel": (23.7560, 90.4060), "niketan": (23.7772, 90.4106),
    "mohakhali": (23.7784, 90.4033), "mohakhali dohs": (23.7830, 90.3980),
    "banani": (23.7936, 90.4043), "banani dohs": (23.7960, 90.3990),
    "gulshan": (23.7925, 90.4078), "gulshan 1": (23.7806, 90.4152),
    "gulshan 2": (23.7936, 90.4147), "baridhara": (23.8043, 90.4207),
    "baridhara dohs": (23.8080, 90.4180), "badda": (23.7806, 90.4256),
    "aftabnagar": (23.7690, 90.4330), "bashundhara": (23.8199, 90.4275),
    "bashundhara r a": (23.8199, 90.4275), "kuril": (23.8235, 90.4200),
    "nikunja": (23.8288, 90.4150), "khilkhet": (23.8290, 90.4230),
    "uttara": (23.8759, 90.3795), "airport": (23.8433, 90.3978),
    "cantonment": (23.8050, 90.3900), "kafrul": (23.7930, 90.3830),
    "agargaon": (23.7780, 90.3770), "sher e bangla nagar": (23.7690, 90.3800),
    "mirpur": (23.8060, 90.3684), "mirpur dohs": (23.8290, 90.3706),
    "pallabi": (23.8240, 90.3650), "kazipara": (23.7940, 90.3720),
    "shewrapara": (23.7890, 90.3720), "kallyanpur": (23.7787, 90.3600),
    "shyamoli": (23.7740, 90.3652), "adabar": (23.7714, 90.3576),
    "mohammadpur": (23.7592, 90.3585), "lalmatia": (23.7549, 90.3676),
    "dhanmondi": (23.7461, 90.3742), "jigatola": (23.7400, 90.3740),
    "elephant road": (23.7386, 90.3856), "new market": (23.7331, 90.3841),
    "azimpur": (23.7290, 90.3860), "lalbagh": (23.7190, 90.3880),
    "old dhaka": (23.7100, 90.4070), "wari": (23.7180, 90.4180),
    "sadarghat": (23.7060, 90.4100), "jatrabari": (23.7100, 90.4350),
    "demra": (23.7180, 90.4700), "keraniganj": (23.7000, 90.3800),
    # Outside the radius but worth naming so the note reads sensibly
    "savar": (23.8583, 90.2667), "ashulia": (23.9100, 90.3200),
    "gazipur": (23.9999, 90.4203), "tongi": (23.8930, 90.4030),
    "narayanganj": (23.6238, 90.5000), "chattogram": (22.3569, 91.7832),
    "chittagong": (22.3569, 91.7832), "sylhet": (24.8949, 91.8687),
    "rajshahi": (24.3745, 88.6042), "khulna": (22.8456, 89.5403),
}

REMOTE = re.compile(r"\b(remote|work from home|wfh|anywhere|hybrid)\b", re.I)

_BANGLADESH = re.compile(
    r"\b(bangladesh|dhaka|chattogram|chittagong|sylhet|khulna|rajshahi|gazipur|narayanganj|"
    r"cox'?s bazar|mymensingh|rangpur|barisal|barishal|comilla|cumilla|bogura|bogra)\b", re.I)
# Countries a Dhaka-based applicant cannot simply take a job in. Whole words only, so "oman"
# does not fire inside "Romania". Kept to names that are unambiguous in a location field.
_ABROAD = re.compile(
    r"\b(united kingdom|uk|england|scotland|wales|united states|usa|us|canada|australia|new zealand|"
    r"germany|france|netherlands|belgium|spain|portugal|italy|ireland|sweden|norway|denmark|finland|"
    r"switzerland|austria|poland|romania|turkey|singapore|malaysia|indonesia|thailand|vietnam|"
    r"philippines|japan|china|hong kong|south korea|india|pakistan|nepal|sri lanka|maldives|uae|"
    r"united arab emirates|dubai|abu dhabi|saudi arabia|qatar|kuwait|oman|bahrain|egypt|nigeria|"
    r"kenya|south africa|brazil|mexico)\b", re.I)


def foreign_country(location_text: str | None) -> str | None:
    """The country a posting is based in when it is clearly not Bangladesh, else None."""
    text = location_text or ""
    if _BANGLADESH.search(text):
        return None
    match = _ABROAD.search(text)
    return match.group(0).upper() if match and len(match.group(0)) <= 3 else (match.group(0).title() if match else None)


# Longest names first so "gulshan 1" wins over "gulshan".
_ORDERED = sorted(AREAS, key=len, reverse=True)


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(h)), 1)


def resolve(location_text: str | None, description: str = "") -> tuple[str, float | None, bool]:
    """Return (area name, km from home, is_remote).

    km is None when the area cannot be identified, which is treated as
    'unknown' rather than 'too far' so a good job is never silently dropped.
    """
    blob = f"{location_text or ''} {description[:600]}"
    remote = bool(REMOTE.search(blob))
    hay = f" {slug(location_text or '')} "
    for name in _ORDERED:
        if f" {name} " in hay:
            return name.title(), haversine_km(HOME, AREAS[name]), remote
    # Fall back to scanning the opening of the description
    hay2 = " " + slug(description[:600]) + " "
    for name in _ORDERED:
        if f" {name} " in hay2:
            return name.title(), haversine_km(HOME, AREAS[name]), remote
    if remote:
        return "Remote", 0.0, True
    if "dhaka" in hay:
        return "Dhaka (area not stated)", None, False
    return "", None, remote
