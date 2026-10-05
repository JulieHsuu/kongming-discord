"""Pull the Traditional Chinese (TC) faces out of the Noto Sans CJK collections,
so the video renderer draws Taiwan-style glyphs. Run once (the Dockerfile does it)."""
import os, sys
from fontTools.ttLib import TTCollection
SRC = os.environ.get('NOTO_DIR', '/usr/share/fonts/opentype/noto')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'fonts')
os.makedirs(OUT, exist_ok=True)
for weight in ['Regular', 'Medium', 'Bold', 'Black']:
    path = os.path.join(SRC, f'NotoSansCJK-{weight}.ttc')
    if not os.path.exists(path):
        print('missing', path); continue
    for f in TTCollection(path).fonts:
        fam = f['name'].getDebugName(1) or ''
        if 'CJK TC' in fam:
            dst = os.path.join(OUT, f'KMSansTC-{weight}.otf')
            f.save(dst); print('wrote', dst); break
