"""
MGT Bookings — PWA icon generator (v17.4.2).

Emits the icon family from ONE source of truth so the tile can never drift
between sizes. Run it, never hand-edit the files it writes:

    python3 scripts/gen-icons.py public

v17.4.2 replaced the generated wordmark tile with the "booking blocks on
frosted glass" mark (design review `Logo Approaches`, option 2a). Three things
follow from that, and they are the whole reason this file got shorter:

 1. THERE IS NO TYPE ANY MORE. The mark is three rounded bars — a slice of the
    app's own timeline — so the fontTools / SF Pro / outline-conversion machinery
    the v17.4.0 wordmark needed is gone. The old script converted "MGT Bookings"
    to paths because an SVG `<text>` with font-family renders a different face on
    every non-Apple platform; that hazard cannot recur here, since the family now
    contains no glyphs at all. Keep it that way: if type ever returns to the
    icon, it must be outlined (recover the conversion from git history at
    v17.4.1).

 2. IT RUNS ON LINUX. The old version needed macOS (/System/Library/Fonts) and
    so could not be executed on CI or in a container — which is how a design and
    its "single source of truth" drift apart. This one needs only Playwright +
    Pillow, both pip-installable anywhere, so the shipped bytes are reproducible
    off a Mac. Still NOT part of `npm run build` — it is a design tool.

 3. THE GRADIENT IS A FLAT 3-STOP TILE, not the v17.4.0 OKLCH sweep. The frosted
    surface is the same one the app's own glass panels use, so it is authored
    directly in sRGB to match them; there is no wide-hue arc left to interpolate
    and nothing for OKLCH to fix.

Geometry is authored on the design's 64-unit construction grid and scaled up, so
the numbers here read the same as the design doc's construction notes.
"""

SIZE = 512
GRID = 64                      # the design's construction grid
K = SIZE / GRID                # 8 — grid units -> icon units

# ── The mark ─────────────────────────────────────────────────────────────────
# Three booking blocks lifted off the timeline, in the fixed status palette:
# accent blue, confirmed amber, seated green. Bar height 11 with radius 5.5 = a
# full pill, matching the timeline blocks. The ragged 8 / 15 / 8 left offsets are
# load-bearing: an asymmetric silhouette is what stops the mark reading as a
# hamburger menu at 16px. Widths taper 33 / 41 / 25 so the middle bar (the
# seating running through the day) is the longest.
#                x     y     w    h   fill
BARS = [
    (8.0,  13.0, 33.0, 11.0, "#007aff"),  # accent blue    — the booking
    (15.0, 26.5, 41.0, 11.0, "#d97706"),  # confirmed amber — seating in progress
    (8.0,  40.0, 25.0, 11.0, "#22a050"),  # seated green
]

# ── The tile ─────────────────────────────────────────────────────────────────
# The frosted-glass surface the whole interface is built from: white falling
# through a lilac midpoint to a cool blue corner. The mark sits on the same
# material as the app, which is the point of the design.
TILE_STOPS = [
    ("0",    "#ffffff", "0.98"),
    ("0.48", "#e2e0ef", None),
    ("1",    "#dce8f0", None),
]
RX = 116                       # rounded-tile corner radius at 512
HAIRLINE = "#ffffff"           # inner 1px highlight, the glass edge
HAIRLINE_OPACITY = "0.6"

# Android's maskable safe zone is the centre 80%; the launcher crops everything
# outside it to whatever shape the OS wants (circle, squircle, teardrop). Scaled
# 0.80 about the centre, the bars' furthest corner sits ~196px from centre — just
# inside the 204.8px safe radius — so no bar end is ever clipped.
MASKABLE_SCALE = 0.80


def _grad():
    stops = ""
    for offset, color, opacity in TILE_STOPS:
        op = f' stop-opacity="{opacity}"' if opacity else ""
        stops += (
            f'\n      <stop offset="{offset}" stop-color="{color}"{op}></stop>'
        )
    return (
        '\n    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">'
        f"{stops}"
        "\n    </linearGradient>"
    )


def _bars(scale=1.0):
    """The three blocks, optionally scaled about the tile centre (maskable)."""
    c = SIZE / 2
    out = ""
    for x, y, w, h, fill in BARS:
        X, Y, W, H = x * K, y * K, w * K, h * K
        if scale != 1.0:
            X, Y = c + (X - c) * scale, c + (Y - c) * scale
            W, H = W * scale, H * scale
        num = lambda v: f"{v:g}"
        out += (
            f'\n  <rect x="{num(X)}" y="{num(Y)}" width="{num(W)}" '
            f'height="{num(H)}" rx="{num(H / 2)}" fill="{fill}"></rect>'
        )
    return out


def tile(rx=RX, scale=1.0, opaque=False):
    """One icon variant.

    rx=0 + opaque=True is the full-bleed cut: iOS rounds the apple-touch tile
    itself, and any transparency in its corners renders BLACK on the home
    screen — so that variant gets a solid base under the 98%-opaque gradient
    rather than relying on the compositor.
    """
    base = (
        f'\n  <rect width="{SIZE}" height="{SIZE}" fill="#ffffff"></rect>'
        if opaque
        else ""
    )
    r = f' rx="{rx}"' if rx else ""
    hairline = (
        f'\n  <rect x="0.5" y="0.5" width="{SIZE - 1}" height="{SIZE - 1}" '
        f'rx="{rx - 0.5:g}" fill="none" stroke="{HAIRLINE}" '
        f'stroke-opacity="{HAIRLINE_OPACITY}"></rect>'
        if rx
        else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" '
        f'height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
        f"\n  <defs>{_grad()}\n  </defs>"
        f"{base}"
        f'\n  <rect width="{SIZE}" height="{SIZE}"{r} fill="url(#tile)"></rect>'
        f"{hairline}"
        f"{_bars(scale)}"
        "\n</svg>"
    )


def png(svg_markup, path, size, transparent=True):
    """Rasterise through Chromium: it is the same engine that will render the
    SVG on the device, so the PNG fallbacks cannot disagree with icon.svg.

    Set MGT_CHROMIUM to an existing Chromium binary to reuse a system install
    (a container usually has one already, and its build rarely matches the one
    the pip-installed Playwright wants to download). Unset = Playwright's own.
    """
    import os
    from playwright.sync_api import sync_playwright

    markup = svg_markup.replace(
        f'width="{SIZE}" height="{SIZE}"', f'width="{size}" height="{size}"', 1
    )
    exe = os.environ.get("MGT_CHROMIUM")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
        pg = b.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        bg = "transparent" if transparent else "#ffffff"
        pg.set_content(f'<body style="margin:0;background:{bg}">{markup}</body>')
        pg.wait_for_timeout(120)
        pg.screenshot(path=str(path), omit_background=transparent)
        b.close()

    # Lossless re-encode. Palette quantisation was measured on the v17.4.0
    # gradient and banded it; this tile is flatter, but truecolor stays so the
    # frosted ramp cannot stripe on a big launcher tile.
    from PIL import Image

    Image.open(path).save(path, optimize=True, compress_level=9)


if __name__ == "__main__":
    import sys, pathlib

    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    out.mkdir(parents=True, exist_ok=True)

    rounded = tile()
    # iOS masks the apple-touch tile itself; Android crops the maskable one.
    # Both therefore ship square, full-bleed and fully opaque.
    fullbleed = tile(rx=0, opaque=True)
    maskable = tile(rx=0, scale=MASKABLE_SCALE, opaque=True)

    # The favicon is the SAME cut as the app icon. The mark is three bars with
    # no fine detail, so unlike the v17.4.0 wordmark it needs no small-size
    # variant — it stays legible down to the 16px tab strip, and one file means
    # the tab and the home screen can never show different marks.
    (out / "icon.svg").write_text(rounded)
    (out / "favicon.svg").write_text(rounded)
    png(rounded, out / "icon-192.png", 192)
    png(rounded, out / "icon-512.png", 512)
    png(fullbleed, out / "apple-touch-icon.png", 180, transparent=False)
    png(maskable, out / "icon-maskable-512.png", 512, transparent=False)

    print(f"tile {SIZE}px rx{RX} · bars {[b[4] for b in BARS]} · "
          f"maskable {MASKABLE_SCALE:.0%}")
    print("wrote: icon.svg favicon.svg icon-192.png icon-512.png "
          "apple-touch-icon.png icon-maskable-512.png")
