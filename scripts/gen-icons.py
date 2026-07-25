"""
MGT Bookings — PWA icon generator (v17.5.0).

Emits the icon family from ONE source of truth so the tile can never drift
between sizes. Two craft decisions worth stating:

 1. TYPE IS CONVERTED TO PATHS. The old icon.svg used
    font-family="-apple-system, Helvetica, Arial", which resolves to a
    different face on every non-Apple platform — the Android home screen and
    the Chrome tab were rendering a different wordmark than iOS. Outlines
    render identically everywhere and need no font on the device.

 2. THE GRADIENT IS INTERPOLATED IN OKLCH, not sRGB. A straight sRGB ramp
    between the app's amber (#EAB308) and seated-green (#22C55E) passes
    through olive mud, and amber->blue passes through grey. OKLCH keeps the
    hue arc clean and — the real reason — lets the four hues sit on a
    controlled LIGHTNESS ramp, so white type has even contrast across the
    whole tile instead of blowing out over the amber corner. Sampled to flat
    sRGB stops on the way out, so no renderer needs OKLCH support.
"""
import math
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

SRC = "/System/Library/Fonts/SFNS.ttf"
WGHT, OPSZ = 860, 96  # SF Pro Display Heavy — the app's own --font-app family

# ── OKLab / OKLCH ────────────────────────────────────────────────────────────
def _srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _lin_to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hex_to_oklch(h):
    h = h.lstrip("#")
    r, g, b = (_srgb_to_lin(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360


def oklch_to_rgb(L, C, H):
    """Returns (r,g,b) floats, possibly out of [0,1]."""
    a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )


def oklch_to_hex(L, C, H):
    """Gamut-map by walking chroma down until the colour fits sRGB."""
    c = C
    for _ in range(64):
        rgb = oklch_to_rgb(L, c, H)
        if all(-0.0005 <= v <= 1.0005 for v in rgb):
            break
        c *= 0.97
    rgb = oklch_to_rgb(L, c, H)
    out = []
    for v in rgb:
        v = _lin_to_srgb(min(1.0, max(0.0, v)))
        out.append(max(0, min(255, round(v * 255))))
    return "#%02x%02x%02x" % tuple(out)


# ── The sweep ────────────────────────────────────────────────────────────────
# Hues come from the app's real tokens (index.html): confirmed amber + pending
# yellow, seated green, the shared accent / outdoor-table blue, and the
# indoor-table violet.
#
# Two things drive the node POSITIONS, and both are the difference between a
# designed tile and a candy rainbow:
#
#  * Area, not parameter. On a square a 45-degree ramp puts only 2t^2 of the
#    AREA below t, so an evenly-spaced 4-stop ramp spends its first quarter on
#    a tiny corner triangle. The warm end is deliberately compressed and the
#    cool end given room.
#  * The amber is a LIGHT SOURCE, not a quarter of the spectrum. Yellow cannot
#    be darkened without turning olive, so instead of flattening it into the
#    ramp it holds a bright top-left corner and falls away to a deep violet.
#    That also parks the wordmark on the dark two-thirds, where white reads.
#
# (t, L, C, hue-source) — L/C are authored, only the HUE comes from the token.
NODES = [
    (0.00, 0.745, 0.160, "#D97706"),  # confirmed amber — gold, not lemon
    (0.09, 0.775, 0.172, "#EAB308"),  # pending yellow — the highlight
    (0.30, 0.635, 0.200, "#22C55E"),  # seated green
    (0.47, 0.530, 0.203, "#0EA5A5"),  # teal step: keeps green from banding
    (0.64, 0.450, 0.210, "#007AFF"),  # accent / outdoor tables
    (0.85, 0.395, 0.195, "#AF52DE"),  # indoor tables
    (1.00, 0.335, 0.160, "#AF52DE"),  # deep corner
]


def sweep_stops(n=40):
    ns = [(t, L, C, hex_to_oklch(h)[2]) for t, L, C, h in NODES]
    out = []
    for i in range(n):
        t = i / (n - 1)
        p = 0
        while p < len(ns) - 2 and t > ns[p + 1][0]:
            p += 1
        t0, l0, c0, h0 = ns[p]
        t1, l1, c1, h1 = ns[p + 1]
        u = 0 if t1 == t0 else max(0.0, min(1.0, (t - t0) / (t1 - t0)))
        out.append(
            (t, oklch_to_hex(l0 + (l1 - l0) * u, c0 + (c1 - c0) * u, h0 + (h1 - h0) * u))
        )
    return out


# ── Type ─────────────────────────────────────────────────────────────────────
_font = None


def font():
    global _font
    if _font is None:
        f = TTFont(SRC, fontNumber=0)
        instancer.instantiateVariableFont(
            f, {"wght": WGHT, "opsz": OPSZ, "wdth": 100, "GRAD": 400}, inplace=True
        )
        _font = f
    return _font


def line_paths(word, size, tracking, x_ink_left, baseline):
    """Lay `word` out at `size` px with `tracking` px between glyphs, so that the
    INK (not the advance box) starts at x_ink_left. Ink alignment is what makes
    the two lines look flush — matching advance widths would leave the side
    bearings visibly uneven at logo scale."""
    f, gs = font(), font().getGlyphSet()
    upem = f["head"].unitsPerEm
    s = size / upem
    cmap = f.getBestCmap()

    placed, cursor, ink_l, ink_r = [], 0.0, None, None
    for ch in word:
        gn = cmap[ord(ch)]
        bp = BoundsPen(gs)
        gs[gn].draw(bp)
        if bp.bounds:
            l, r = cursor + bp.bounds[0] * s, cursor + bp.bounds[2] * s
            ink_l = l if ink_l is None else min(ink_l, l)
            ink_r = r if ink_r is None else max(ink_r, r)
        placed.append((gn, cursor))
        cursor += f["hmtx"][gn][0] * s + tracking

    shift = x_ink_left - ink_l
    d = []
    for gn, x in placed:
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}")
        # y flips: font units are y-up, SVG is y-down.
        gs[gn].draw(TransformPen(pen, Transform(s, 0, 0, -s, x + shift, baseline)))
        seg = pen.getCommands()
        if seg:
            d.append(seg)
    return " ".join(d), (ink_r - ink_l)


def natural_ink(word, size):
    return line_paths(word, size, 0.0, 0.0, 0.0)[1]


# ── Composition ──────────────────────────────────────────────────────────────
SIZE = 512
INK_W = 336.0        # wordmark width — 65.6% of the tile, 88px clear each side
SUB_RATIO = 0.44     # "Bookings" font size as a fraction of "MGT"
GAP = 30.0           # MGT baseline -> "Bookings" cap top
TYPE_FILL = "#fcfbff"  # white tinted a hair toward the violet end of the sweep

# Small-size cut (favicon). Same lockup, re-proportioned the way a type foundry
# cuts an optical size: the sub-line goes as LARGE and as TIGHT as the
# equal-width constraint allows, so it survives 16-32px instead of silting up.
# 0.4934 is the hard ceiling — above it "Bookings" is naturally wider than
# "MGT" and the tracking needed to match would go negative.
SUB_RATIO_SMALL = 0.49
GAP_SMALL = 20.0


def lockup(scale=1.0, cx=SIZE / 2, cy=SIZE / 2, sub_ratio=SUB_RATIO, gap_px=GAP):
    """Both lines, ink-flush to the same width, optically centred as a block."""
    F = (INK_W / natural_ink("MGT", 1000.0) * 1000.0) * scale
    f_sub = F * sub_ratio
    w = INK_W * scale

    # Solve the tracking that makes "Bookings" ink exactly as wide as "MGT".
    nat = natural_ink("Bookings", f_sub)
    track = (w - nat) / (len("Bookings") - 1)

    upem_cap = 0.705   # cap height in em (M / B)
    desc = 0.182       # 'g' descender depth in em
    cap_M, cap_B, desc_g = upem_cap * F, upem_cap * f_sub, desc * f_sub
    gap = gap_px * scale

    # Centre the full ink box, then lift by 40% of the descender: letting the
    # single 'g' tail pull the whole lockup down reads as mis-centred.
    block = cap_M + gap + cap_B + desc_g
    top = cy - block / 2 - desc_g * 0.4
    y1 = top + cap_M
    y2 = y1 + gap + cap_B

    x = cx - w / 2
    d1, _ = line_paths("MGT", F, 0.0, x, y1)
    d2, w2 = line_paths("Bookings", f_sub, track, x, y2)
    assert abs(w2 - w) < 0.01, f"lockup width mismatch: {w2} vs {w}"
    return d1, d2, {"F": F, "f": f_sub, "track": track, "track_em": track / f_sub}


def defs(idp=""):
    stops = "".join(
        f'<stop offset="{t*100:.4g}%" stop-color="{c}"/>' for t, c in sweep_stops()
    )
    return (
        f'<linearGradient id="{idp}g" x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient>'
        # Light from above — the one depth cue Apple's own icons rely on. Kept
        # to 9% so it reads as sheen, not as a glass overlay.
        f'<linearGradient id="{idp}s" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="#ffffff" stop-opacity="0.09"/>'
        f'<stop offset="46%" stop-color="#ffffff" stop-opacity="0.02"/>'
        f'<stop offset="100%" stop-color="#000000" stop-opacity="0.07"/>'
        f"</linearGradient>"
    )


def tile(rx, scale=1.0, sub=True, cy=SIZE / 2, sub_ratio=SUB_RATIO, gap_px=GAP,
         sub_opacity=0.93):
    d1, d2, m = lockup(scale=scale, cy=cy, sub_ratio=sub_ratio, gap_px=gap_px)
    r = f' rx="{rx}"' if rx else ""
    body = (
        f'<rect width="{SIZE}" height="{SIZE}"{r} fill="url(#g)"/>'
        f'<rect width="{SIZE}" height="{SIZE}"{r} fill="url(#s)"/>'
        f'<path d="{d1}" fill="{TYPE_FILL}"/>'
    )
    if sub:
        body += f'<path d="{d2}" fill="{TYPE_FILL}" fill-opacity="{sub_opacity}"/>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}"><defs>{defs()}</defs>{body}</svg>'
    ), m


def png(svg_markup, path, size):
    """Rasterise through Chromium: it is the same engine that will render the
    SVG on the device, so the PNG fallbacks cannot disagree with icon.svg."""
    from playwright.sync_api import sync_playwright

    markup = svg_markup.replace(
        f'width="{SIZE}" height="{SIZE}"', f'width="{size}" height="{size}"', 1
    )
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        pg.set_content(f'<body style="margin:0;background:transparent">{markup}</body>')
        pg.wait_for_timeout(120)
        pg.screenshot(path=str(path), omit_background=True)
        b.close()

    # Lossless re-encode (~-11%). Palette quantisation was measured too — 12x
    # smaller, but it banded the gradient into visible diagonal stripes, so
    # truecolor stays. Done HERE rather than as a separate pass so one run of
    # this script reproduces the shipped bytes exactly.
    from PIL import Image

    Image.open(path).save(path, optimize=True, compress_level=9)


if __name__ == "__main__":
    import sys, pathlib

    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)

    rounded, m = tile(112)
    fullbleed, _ = tile(0)                    # iOS masks it itself; transparent
    maskable, _ = tile(0, scale=0.80)         # Android safe zone = centre 80%
    # Favicon keeps the full lockup (dropping "Bookings" made the tab icon a
    # different mark from the home-screen one). It uses the SMALL CUT and fills
    # more of the tile, so the sub-line survives the tab strip: on a retina tab
    # it is drawn at 32 device px, where this reads clearly.
    favicon, _ = tile(112, scale=1.28, sub_ratio=SUB_RATIO_SMALL,
                      gap_px=GAP_SMALL, sub_opacity=1.0)

    (out / "icon.svg").write_text(rounded + "\n")
    (out / "favicon.svg").write_text(favicon + "\n")
    png(rounded, out / "icon-192.png", 192)
    png(rounded, out / "icon-512.png", 512)
    png(fullbleed, out / "apple-touch-icon.png", 180)
    png(maskable, out / "icon-maskable-512.png", 512)

    print(f"MGT {m['F']:.1f}px · Bookings {m['f']:.1f}px ({SUB_RATIO:.0%}) · "
          f"tracking {m['track']:.2f}px = {m['track_em']*1000:.0f}/1000em")
    print("sweep:", " ".join(c for _, c in sweep_stops(9)))
