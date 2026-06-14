"""
生成盲训 App 图标 (1024x1024 PNG)

设计理念：
- 深色圆角方形背景（#1a2332），契合盲训 App 专业交易风格
- K 线蜡烛图元素（红涨绿跌，A股惯例）
- 眼罩/遮蔽元素（代表"盲"训——信息遮蔽）
- 金色描边强调盘感训练的专业性
"""
from PIL import Image, ImageDraw, ImageFilter
import os

SIZE = 1024

def create_icon():
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 圆角方形背景 - macOS Big Sur 风格
    radius = 225
    bg_color = (26, 35, 50)  # #1a2332
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=bg_color)

    # 内层渐变背景（模拟）
    for i in range(120):
        alpha = int(25 * (1 - i / 120))
        overlay = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.rounded_rectangle([30 + i, 30 + i, SIZE - 31 - i, SIZE - 31 - i], radius=radius - 60, fill=(52, 73, 94, alpha))
        img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    cx = SIZE // 2

    # === K 线蜡烛图（3 根，代表走势）===
    candle_w = 90
    candle_gap = 50
    candle_start_x = cx - candle_w - candle_gap
    candle_y_base = 620

    candles = [
        # (x_offset, body_top, body_bottom, wick_top, wick_bottom, color)
        (0, 470, 590, 440, 620, (231, 76, 60)),    # 红色大阳线
        (candle_w + candle_gap, 380, 520, 340, 550, (231, 76, 60)),  # 红色中阳线
        (2 * (candle_w + candle_gap), 300, 470, 270, 500, (231, 76, 60)),  # 红色大阳线
    ]

    for ox, body_top, body_bot, wick_top, wick_bot, color in candles:
        x = candle_start_x + ox
        # 影线（细线）
        wick_x = x + candle_w // 2
        draw.line([(wick_x, wick_top), (wick_x, wick_bot)], fill=color, width=10)
        # 实体
        draw.rounded_rectangle([x, body_top, x + candle_w, body_bot], radius=12, fill=color)

    # === 眼罩/遮蔽元素（代表"盲"训）===
    # 一条斜向的遮蔽带，从左上到右下穿过
    mask_y = 200
    mask_h = 100

    # 遮蔽带主体（半透明黑色斜带）
    band = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    # 画一个倾斜的矩形带
    bd.polygon([
        (80, mask_y),
        (SIZE - 80, mask_y - 30),
        (SIZE - 80, mask_y + mask_h - 30),
        (80, mask_y + mask_h),
    ], fill=(0, 0, 0, 180))
    band = band.filter(ImageFilter.GaussianBlur(radius=3))
    img = Image.alpha_composite(img, band)

    # 遮蔽带上的金色文字 "BLIND"
    draw = ImageDraw.Draw(img)
    # 用简单的矩形模拟文字笔画的不可行，改用符号化设计
    # 在遮蔽带中央画一个眼睛被遮挡的图标
    eye_cx = cx
    eye_cy = mask_y + mask_h // 2 - 10

    # 眼睛轮廓（椭圆）
    draw.ellipse([eye_cx - 80, eye_cy - 30, eye_cx + 80, eye_cy + 30],
                 outline=(212, 175, 55), width=6)

    # 眼睛中间的斜线（表示遮蔽/划掉）
    draw.line([(eye_cx - 100, eye_cy - 45), (eye_cx + 100, eye_cy + 45)],
              fill=(212, 175, 55), width=8)

    # === 金色描边边框 ===
    border = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    bd2 = ImageDraw.Draw(border)
    bd2.rounded_rectangle([8, 8, SIZE - 9, SIZE - 9], radius=radius - 8,
                          outline=(212, 175, 55, 200), width=4)
    img = Image.alpha_composite(img, border)

    # === 底部文字区域装饰线 ===
    draw = ImageDraw.Draw(img)
    draw.line([(120, 720), (SIZE - 120, 720)], fill=(212, 175, 55, 120), width=2)

    # 底部三个小点代表"训练等级"
    for i, color in enumerate([(52, 152, 219), (212, 175, 55), (231, 76, 60)]):
        dot_x = cx - 60 + i * 60
        draw.ellipse([dot_x - 16, 760, dot_x + 16, 792], fill=color + (220,))

    return img


if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'build')
    os.makedirs(out_dir, exist_ok=True)

    icon = create_icon()
    out_path = os.path.join(out_dir, 'icon.png')
    icon.save(out_path, 'PNG')
    print(f'Icon saved to {out_path} ({icon.size[0]}x{icon.size[1]})')

    # 生成小尺寸预览
    for sz in [512, 256, 128, 64, 32, 16]:
        small = icon.resize((sz, sz), Image.LANCZOS)
        small.save(os.path.join(out_dir, f'icon-{sz}.png'), 'PNG')
    print('All sizes generated.')
