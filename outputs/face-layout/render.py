import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
DATA = json.loads((OUT / 'layout.json').read_text(encoding='utf-8'))
FONT = 'C:/Windows/Fonts/malgun.ttf'
BG = '#18181b'
INK = '#e4e4e7'

def text(d, xy, value, size=16, fill=INK):
    d.text(xy, value, font=ImageFont.truetype(FONT, size), fill=fill)

def center(d, box, value, size=16, fill=INK):
    font = ImageFont.truetype(FONT, size)
    bounds = d.textbbox((0, 0), value, font=font)
    x, y, w, h = box
    d.text((x + (w - bounds[2]) / 2, y + (h - bounds[3]) / 2), value, font=font, fill=fill)

def face(w, h, number):
    # 얼굴 그림은 예시다. 칸의 크기와 가운데 자르기는 실제 계산값을 사용한다.
    canvas = Image.new('RGB', (640, 360), ['#454e55', '#505148', '#4b4351', '#42524e'][number % 4])
    d = ImageDraw.Draw(canvas)
    d.rectangle((0, 270, 640, 360), fill='#303033')
    d.rounded_rectangle((440, 22, 596, 211), 4, fill='#6b7276')
    d.line((518, 22, 518, 211), fill='#8b9193', width=4)
    d.line((440, 117, 596, 117), fill='#8b9193', width=4)
    d.ellipse((235, 31, 405, 219), fill='#242424')
    d.rounded_rectangle((253, 58, 387, 218), 53, fill='#bfa18b')
    d.rectangle((302, 183, 339, 244), fill='#bfa18b')
    d.ellipse((163, 212, 477, 475), fill=['#343e55', '#48503c', '#563c3c'][number % 3])
    d.ellipse((285, 118, 291, 124), fill='#36302d')
    d.ellipse((350, 118, 356, 124), fill='#36302d')
    d.arc((298, 137, 342, 169), 5, 170, fill='#806758', width=2)
    scale = max(w / 640, h / 360)
    canvas = canvas.resize((math.ceil(640 * scale), math.ceil(360 * scale)), Image.Resampling.LANCZOS)
    left, top = (canvas.width - w) // 2, (canvas.height - h) // 2
    canvas = canvas.crop((left, top, left + w, top + h))
    d = ImageDraw.Draw(canvas)
    title = '나' if number == 1 else '방장' if number == 2 else f'참여자 {number - 1}'
    d.rounded_rectangle((4, h - 24, min(w - 4, 110), h - 4), 3, fill='#171717')
    text(d, (10, h - 23), title, 11)
    if number == 2:
        d.rounded_rectangle((1, 1, w - 2, h - 2), 7, outline='#22c55e', width=2)
    mask = Image.new('L', (w, h))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), 8, fill=255)
    return canvas, mask

def scene(v):
    w, h = v['w'], v['h']
    mobile = v['key'] == 'mobile'
    im = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(im)
    text(d, (12 if mobile else 18, 12 if mobile else 18), 'DO', 18 if mobile else 26)
    text(d, (40 if mobile else 60, 12 if mobile else 18), 'LIVE', 18 if mobile else 26, '#ef4444')
    text(d, (110 if mobile else 18, 15 if mobile else 56), f"참여 {v['n']}명", 12)
    for j, label in enumerate(['TTS', '카메라', '마이크']):
        cx = w - (3 - j) * (42 if mobile else 70)
        d.ellipse((cx, 8 if mobile else 25, cx + 30, 38 if mobile else 55), fill='#343437', outline='#74715e')
        center(d, (cx, 8 if mobile else 25, 30, 30), label[:1], 13)
        if not mobile:
            center(d, (cx - 8, 64, 46, 17), label, 11, '#a39f98')
    x, y, gw, gh = v['x'], v['y'], v['gw'], v['gh']
    tw, th = v['tw'], v['th']
    slots = len(v['faces']) + bool(v['more'])
    cols = min(slots, math.floor((gw + 8) / (tw + 8)))
    rows = math.ceil(slots / cols)
    top = y + (gh - rows * th - (rows - 1) * 8) / 2
    for i in range(slots):
        row, col = divmod(i, cols)
        row_count = min(cols, slots - row * cols)
        left = x + (gw - row_count * tw - (row_count - 1) * 8) / 2
        px, py = round(left + col * (tw + 8)), round(top + row * (th + 8))
        if i < len(v['faces']):
            tile, mask = face(tw, th, v['faces'][i])
            im.paste(tile, (px, py), mask)
        else:
            d.rounded_rectangle((px, py, px + tw, py + th), 8, fill='#27272a')
            center(d, (px, py, tw, th), f"+{v['more']}명", 14)
    chat_x, chat_y = (0, round(y + gh + 8)) if mobile else (w - 518, y)
    chat_w, chat_h = (w, h - chat_y) if mobile else (500, h - y - 18)
    if not mobile:
        d.rounded_rectangle((chat_x, chat_y, chat_x + chat_w, chat_y + chat_h), 12, fill='#1e1e21')
    text(d, (chat_x + 16, chat_y + 18), '참여자', 12, '#a1a1aa')
    d.rounded_rectangle((chat_x + 16, chat_y + 42, chat_x + chat_w - 45, chat_y + 89), 12, fill='#27272a')
    text(d, (chat_x + 28, chat_y + 56), '얼굴이 함께 보이는 화면 예시예요.', 13)
    d.rounded_rectangle((chat_x + 12, h - 72, chat_x + chat_w - 70, h - 24), 24, fill='#27272a')
    text(d, (chat_x + 36, h - 58), '메시지 입력', 14, '#71717a')
    d.ellipse((chat_x + chat_w - 60, h - 72, chat_x + chat_w - 12, h - 24), fill='#3a3940')
    center(d, (chat_x + chat_w - 60, h - 72, 48, 48), '보내기', 11)
    im.save(OUT / f"{v['key']}-{v['n']:02}.png")
    return im

for key, scale, columns in [('pc', .4, 2), ('mobile', 1, 4)]:
    items = [v for v in DATA if v['key'] == key]
    sw, sh = round(items[0]['w'] * scale), round(items[0]['h'] * scale)
    cellw, cellh = sw + 32, sh + 88
    sheet = Image.new('RGB', (columns * cellw + 32, math.ceil(len(items) / columns) * cellh + 125), '#101014')
    d = ImageDraw.Draw(sheet)
    title = 'PC 얼굴 배치 예상도' if key == 'pc' else '휴대폰 얼굴 배치 예상도'
    text(d, (28, 18), title, 28)
    text(d, (28, 62), f"화면 안쪽 {items[0]['w']}×{items[0]['h']} · 화면공유 없음 · 얼굴 칸은 실제 계산식 적용", 16, '#b4b4bd')
    for i, v in enumerate(items):
        px, py = 24 + (i % columns) * cellw, 110 + (i // columns) * cellh
        text(d, (px, py), f"카메라 {v['n']}명", 22)
        meta = f"얼굴 {len(v['faces'])}개" + (f" + 더보기 {v['more']}명" if v['more'] else '') + f" · 한 칸 {v['tw']}×{v['th']}"
        text(d, (px, py + 31), meta, 14, '#b4b4bd')
        image = scene(v).resize((sw, sh), Image.Resampling.LANCZOS)
        sheet.paste(image, (px, py + 58))
    sheet.save(OUT / f'{key}-gallery.png')
print('PC·휴대폰 예상도와 인원별 원본 그림 저장 완료')
