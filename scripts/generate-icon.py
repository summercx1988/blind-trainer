"""
盲训 App 图标 v2 — 简洁专业版

设计理念：
- macOS squircle + 深蓝渐变（fintech 风格）
- 中心：3 根递增阳线（红）+ 斜线遮蔽（代表"盲"训）
- 金色品牌色点缀
- 各尺寸清晰可辨
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os, math

SIZE = 1024


def make_squircle_mask(size, radius_ratio=0.22):
    """生成 macOS squircle 形状的 mask"""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return mask


def draw_gradient_circle(draw, size, cx, cy, radius, color_inner, color_outer):
    """画径向渐变"""
    for r in range(int(radius), 0, -2):
        t = r / radius
        cr = int(color_outer[0] * t + color_inner[0] * (1 - t))
        cg = int(color_outer[1] * t + color_inner[1] * (1 - t))
        cb = int(color_outer[2] * t + color_inner[2] * (1 - t))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(cr, cg, cb))


def create_icon():
    # 底层：深蓝渐变背景
    bg = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)

    # 径向渐变：中心偏亮的深蓝 → 外圈深墨蓝
    center_x, center_y = SIZE * 0.4, SIZE * 0.35
    for r in range(SIZE, 0, -3):
        t = r / SIZE
        cr = int(20 + (1 - t) * 25)
        cg = int(30 + (1 - t) * 35)
        cb = int(50 + (1 - t) * 55)
        bg_draw.ellipse([center_x - r, center_y - r, center_x + r, center_y + r],
                        fill=(cr, cg, cb, 255))

    squircle_mask = make_squircle_mask(SIZE, 0.22)
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    img.paste(bg, (0, 0), squircle_mask)
    draw = ImageDraw.Draw(img)

    cx = SIZE // 2

    # === 3 根递增 K 线蜡烛（A股红）===
    candle_data = [
        # (center_x_offset, body_top, body_bottom, wick_top, wick_bottom, width)
        (-170, 560, 700, 520, 740, 80),
        (0,    430, 590, 390, 630, 80),
        (170,  300, 480, 260, 520, 80),
    ]

    red = (231, 76, 60)
    red_dark = (192, 57, 43)

    for ox, bt, bb, wt, wb, cw in candle_data:
        x = cx + ox - cw // 2
        wick_x = cx + ox

        # 影线
        draw.line([(wick_x, wt), (wick_x, wb)], fill=red, width=12)

        # 实体（圆角矩形 + 上浅下深）
        for i in range(bb - bt):
            t = i / (bb - bt)
            cr = int(red[0] * (1 - t * 0.3))
            cg = int(red[1] * (1 - t * 0.3))
            cb2 = int(red[2] * (1 - t * 0.3))
            draw.line([(x, bt + i), (x + cw, bt + i)], fill=(cr, cg, cb2))
        draw.rounded_rectangle([x, bt, x + cw, bb], radius=10, outline=red_dark, width=2)

    # === "盲"训遮蔽带：金色半透明斜线穿过 K 线区域 ===
    overlay = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)

    # 主斜线（左下到右上方向，穿过 K 线中部）
    line_y = 420
    od.line([(120, line_y + 60), (SIZE - 120, line_y - 60)],
            fill=(233, 178, 55, 220), width=24)

    # 斜线两端的小圆点
    od.ellipse([108, line_y + 48, 140, line_y + 80], fill=(233, 178, 55, 255))
    od.ellipse([SIZE - 140, line_y - 72, SIZE - 108, line_y - 40], fill=(233, 178, 55, 255))

    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    # === 底部品牌标识：3 个小点 ===
    dot_colors = [(52, 152, 219), (233, 178, 55), (231, 76, 60)]
    for i, color in enumerate(dot_colors):
        dx = cx - 70 + i * 70
        draw.ellipse([dx - 14, 810, dx + 14, 838], fill=color + (230,))

    # === 外边框（金色细线）===
    border_overlay = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border_overlay)
    bd.rounded_rectangle([6, 6, SIZE - 7, SIZE - 7], radius=int(SIZE * 0.22) - 6,
                         outline=(233, 178, 55, 80), width=3)
    img = Image.alpha_composite(img, border_overlay)

    # 应用 squircle mask
    result = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    result.paste(img, (0, 0), squircle_mask)

    return result


def generate_icns(icon_1024, out_dir):
    """用 iconutil 生成 .icns"""
    iconset_dir = os.path.join(out_dir, 'icon.iconset')
    os.makedirs(iconset_dir, exist_ok=True)

    sizes = [16, 32, 64, 128, 256, 512, 1024]
    for sz in sizes:
        resized = icon_1024.resize((sz, sz), Image.LANCZOS)
        resized.save(os.path.join(iconset_dir, f'icon_{sz}x{sz}.png'), 'PNG')
        if sz <= 512:
            retina_sz = sz * 2
            retina = icon_1024.resize((retina_sz, retina_sz), Image.LANCZOS)
            retina.save(os.path.join(iconset_dir, f'icon_{sz}x{sz}@2x.png'), 'PNG')

    icns_path = os.path.join(out_dir, 'icon.icns')
    os.system(f'iconutil -c icns "{iconset_dir}" -o "{icns_path}"')
    if os.path.exists(icns_path):
        print(f'.icns generated: {icns_path}')
    else:
        print('WARNING: iconutil failed, .icns not created')
    return icns_path


if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'build')
    os.makedirs(out_dir, exist_ok=True)

    icon = create_icon()

    # 主图标 PNG
    icon_path = os.path.join(out_dir, 'icon.png')
    icon.save(icon_path, 'PNG')
    print(f'Icon saved: {icon_path} ({icon.size[0]}x{icon.size[1]})')

    # 各尺寸
    for sz in [512, 256, 128, 64, 32, 16]:
        small = icon.resize((sz, sz), Image.LANCZOS)
        small.save(os.path.join(out_dir, f'icon-{sz}.png'), 'PNG')

    # 生成 .icns
    generate_icns(icon, out_dir)
    print('Done.')
