"""
Web Annotator Chrome Extension - Icon Generator

Usage:
    python3 scripts/generate_icons.py

Generates 16x16, 48x48, 128x128 PNG icons in the icons/ directory.
Yellow rounded-square background with grey border, dark speech bubble with white text lines.
"""
import struct, zlib, math, os


def create_png(width, height, pixels):
    """Create a minimal PNG file from RGBA pixel data."""
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx:idx+4])
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def rounded_rect_dist(x, y, x0, y0, x1, y1, r):
    """Signed distance to rounded rectangle edge (negative = inside)."""
    corners = [(x0+r, y0+r), (x1-r, y0+r), (x0+r, y1-r), (x1-r, y1-r)]
    for i, (cx, cy) in enumerate(corners):
        in_corner = False
        if i == 0 and x < cx and y < cy: in_corner = True
        elif i == 1 and x > cx and y < cy: in_corner = True
        elif i == 2 and x < cx and y > cy: in_corner = True
        elif i == 3 and x > cx and y > cy: in_corner = True
        if in_corner:
            return math.sqrt((x - cx)**2 + (y - cy)**2) - r
    dx = max(x0 - x, x - x1, 0)
    dy = max(y0 - y, y - y1, 0)
    if dx > 0 or dy > 0:
        return math.sqrt(dx*dx + dy*dy)
    return -min(x - x0, x1 - x, y - y0, y1 - y)


def gen_icon(size, path):
    pixels = [0] * (size * size * 4)
    S = size

    # --- Background: rounded square with grey border (anti-aliased) ---
    # At 16px, use no margin to avoid cramped appearance
    margin = 0 if S <= 16 else S * 0.06
    bg_corner_r = S * 0.20
    border_w = max(1, S * 0.04)
    bg_x0, bg_y0 = margin, margin
    bg_x1, bg_y1 = S - 1 - margin, S - 1 - margin

    # Colors
    C_YELLOW = (255, 210, 50)
    C_BORDER = (100, 100, 100)
    C_DARK = (60, 60, 60)
    C_WHITE = (255, 255, 255)

    # --- Bubble parameters (normalized coordinates, from original approved design) ---
    center = S / 2.0
    bubble_scale = S * 0.34  # coordinate space scale
    # At 16px, reduce vertical offset to center the bubble body (no tail)
    bubble_y_offset = 0.10 if S <= 16 else 0.18

    for y in range(S):
        for x in range(S):
            idx = (y * S + x) * 4
            r, g, b, a = 0, 0, 0, 0

            # Anti-aliased rounded square background
            dist = rounded_rect_dist(x, y, bg_x0, bg_y0, bg_x1, bg_y1, bg_corner_r)
            if dist < -border_w:
                r, g, b, a = *C_YELLOW, 255
            elif dist < -border_w + 1.0:
                t = dist + border_w
                r = int(C_YELLOW[0]*(1-t) + C_BORDER[0]*t)
                g = int(C_YELLOW[1]*(1-t) + C_BORDER[1]*t)
                b = int(C_YELLOW[2]*(1-t) + C_BORDER[2]*t)
                a = 255
            elif dist < 0:
                r, g, b, a = *C_BORDER, 255
            elif dist < 1.0:
                r, g, b = C_BORDER
                a = int(255 * (1.0 - dist))

            # Only draw bubble if we're inside the background
            if a > 0:
                # Normalized coordinates for speech bubble
                bx = (x - center) / bubble_scale
                by = (y - center) / bubble_scale + bubble_y_offset

                # Bubble body (rounded rect in normalized space)
                bubble_w, bubble_h = 0.85, 0.65
                in_bubble = abs(bx) < bubble_w and abs(by - 0.05) < bubble_h

                # Round the corners of the bubble
                cr = 0.25
                ddx = abs(bx) - bubble_w + cr
                ddy = abs(by - 0.05) - bubble_h + cr
                if ddx > 0 and ddy > 0:
                    if math.sqrt(ddx*ddx + ddy*ddy) > cr:
                        in_bubble = False

                # Tail (triangle going down-right from bubble, skip at 16px)
                in_tail = False
                if S > 16:
                    in_tail = (bx > 0.1 and bx < 0.5 and
                              by > bubble_h + 0.05 and by < bubble_h + 0.45 and
                              bx - 0.1 > (by - bubble_h - 0.05) * 0.3)

                # White text lines inside bubble
                in_line1 = abs(bx) < 0.5 and abs(by + 0.15) < 0.06 and in_bubble
                in_line2 = abs(bx) < 0.35 and abs(by - 0.15) < 0.06 and in_bubble

                if in_bubble or in_tail:
                    r, g, b = C_DARK
                if in_line1 or in_line2:
                    r, g, b = C_WHITE

            pixels[idx:idx+4] = [r, g, b, a]

    data = create_png(S, S, pixels)
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Created {path} ({S}x{S}, {len(data)} bytes)')


if __name__ == '__main__':
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
    os.makedirs(base, exist_ok=True)
    for s in [16, 48, 128]:
        gen_icon(s, os.path.join(base, f'icon{s}.png'))
