#!/usr/bin/env python3
"""Generate crisp, supersampled PNG icons for LuminaAI Chrome Extension.
Pure stdlib (no Pillow required), 4x supersampled anti-aliasing.
Produces exact 16x16, 32x32, 48x48, and 128x128 RGBA PNG files.
"""

import math
import os
import struct
import zlib

SIZES = [16, 32, 48, 128]
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "icons")


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else (hi if v > hi else v)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(edge0, edge1, x):
    t = clamp((x - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def sd_rounded_rect(px, py, bx, by, r):
    qx = abs(px) - bx + r
    qy = abs(py) - by + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def sd_four_point_star(px, py, size, sharpness=0.28):
    """Signed distance approximation for a glowing 4-point AI sparkle star."""
    ax = abs(px) / size
    ay = abs(py) / size
    # Superellipse with p < 1 creates a sleek 4-point diamond sparkle
    val = (ax ** sharpness + ay ** sharpness) ** (1.0 / sharpness)
    return (val - 1.0) * size * 0.45


def sample_pixel(nx, ny):
    """Evaluate RGBA (0..1) at normalized coords nx, ny in [-1, 1]."""
    # Outer rounded squircle container
    d_box = sd_rounded_rect(nx, ny, 0.90, 0.90, 0.42)
    alpha_box = 1.0 - smoothstep(-0.025, 0.025, d_box)
    if alpha_box <= 0.001:
        return (0.0, 0.0, 0.0, 0.0)

    # Rich dark obsidian-to-indigo gradient background
    grad_t = clamp((nx + ny + 1.8) / 3.6)
    bg_r = lerp(0.055, 0.105, grad_t)
    bg_g = lerp(0.075, 0.145, grad_t)
    bg_b = lerp(0.140, 0.285, grad_t)

    # Soft radial cyan/violet ambient glow in upper-left & lower-right
    glow1 = math.exp(-((nx + 0.35) ** 2 + (ny + 0.35) ** 2) * 2.4)
    glow2 = math.exp(-((nx - 0.40) ** 2 + (ny - 0.35) ** 2) * 2.6)
    r = bg_r + glow1 * 0.09 + glow2 * 0.24
    g = bg_g + glow1 * 0.34 + glow2 * 0.14
    b = bg_b + glow1 * 0.52 + glow2 * 0.54

    # Subtle glossy border highlight
    border_band = math.exp(-((d_box + 0.045) ** 2) / 0.0012)
    r += border_band * 0.22
    g += border_band * 0.36
    b += border_band * 0.48

    # Camera lens / aperture ring (center slightly lower-left)
    cx, cy = -0.05, 0.06
    dist_c = math.hypot(nx - cx, ny - cy)

    # Outer lens ring
    ring_outer = 1.0 - smoothstep(0.02, 0.055, abs(dist_c - 0.46))
    # Ring gradient from cyan (#38BDF8) to violet (#818CF8)
    angle_t = clamp((nx - ny + 1.0) * 0.5)
    ring_r = lerp(0.22, 0.55, angle_t)
    ring_g = lerp(0.76, 0.52, angle_t)
    ring_b = lerp(0.98, 0.99, angle_t)

    r = lerp(r, ring_r, ring_outer * 0.92)
    g = lerp(g, ring_g, ring_outer * 0.92)
    b = lerp(b, ring_b, ring_outer * 0.92)

    # Inner optical glass core glow
    inner_core = 1.0 - smoothstep(0.0, 0.36, dist_c)
    r += inner_core * 0.08
    g += inner_core * 0.22
    b += inner_core * 0.36

    # Central crisp lens highlight dot + center sparkle
    d_star_main = sd_four_point_star(nx - cx, ny - cy, 0.31, sharpness=0.48)
    star_main = 1.0 - smoothstep(-0.02, 0.025, d_star_main)
    star_main_glow = math.exp(-(dist_c ** 2) / 0.05) * 0.45
    r = lerp(r + star_main_glow * 0.4, 0.96, star_main)
    g = lerp(g + star_main_glow * 0.85, 0.99, star_main)
    b = lerp(b + star_main_glow * 1.0, 1.0, star_main)

    # Secondary upper-right AI sparkle star (representing upscaling / enhancement)
    sx, sy = 0.44, -0.42
    d_star_small = sd_four_point_star(nx - sx, ny - sy, 0.24, sharpness=0.45)
    star_small = 1.0 - smoothstep(-0.02, 0.025, d_star_small)
    dist_s = math.hypot(nx - sx, ny - sy)
    star_small_glow = math.exp(-(dist_s ** 2) / 0.03) * 0.55

    r = lerp(r + star_small_glow * 0.35, 0.80, star_small)
    g = lerp(g + star_small_glow * 0.90, 0.98, star_small)
    b = lerp(b + star_small_glow * 1.0, 1.0, star_small)

    return (clamp(r), clamp(g), clamp(b), alpha_box)


def write_png(filepath, width, height, rgba_bytes):
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack("!I", len(data)) + chunk + struct.pack("!I", zlib.crc32(chunk) & 0xFFFFFFFF)

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # Filter type 0 (None)
        start = y * stride
        raw.extend(rgba_bytes[start : start + stride])

    compressed = zlib.compress(bytes(raw), level=9)
    png = b"\x89PNG\r\n\x1a\n" + make_chunk(b"IHDR", ihdr) + make_chunk(b"IDAT", compressed) + make_chunk(b"IEND", b"")
    with open(filepath, "wb") as f:
        f.write(png)


def render_icon(size):
    ss = 4 if size <= 48 else 2
    buf = bytearray(size * size * 4)
    inv_ss2 = 1.0 / (ss * ss)
    for y in range(size):
        for x in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(ss):
                ny = ((y + (sy + 0.5) / ss) / size) * 2.0 - 1.0
                for sx in range(ss):
                    nx = ((x + (sx + 0.5) / ss) / size) * 2.0 - 1.0
                    r, g, b, a = sample_pixel(nx, ny)
                    ar += r * a
                    ag += g * a
                    ab += b * a
                    aa += a
            aa *= inv_ss2
            if aa > 1e-6:
                r = clamp((ar * inv_ss2) / aa)
                g = clamp((ag * inv_ss2) / aa)
                b = clamp((ab * inv_ss2) / aa)
            else:
                r = g = b = 0.0
            idx = (y * size + x) * 4
            buf[idx] = int(round(r * 255))
            buf[idx + 1] = int(round(g * 255))
            buf[idx + 2] = int(round(b * 255))
            buf[idx + 3] = int(round(aa * 255))
    return buf


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        rgba = render_icon(size)
        out_path = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(out_path, size, size, rgba)
        print(f"Generated {out_path} ({size}x{size})")


if __name__ == "__main__":
    main()
