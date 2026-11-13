#!/usr/bin/env python3
"""
Build the Material Symbols Rounded subset font the app ships.

    npm run icons:subset
    (needs Python 3 with fontTools + brotli:  pip install fonttools brotli)

The full font in node_modules/material-symbols is 4.5 MB: 3,776 icons with four
variation axes. The app uses a few hundred icons and only part of the axes:

  FILL  0 and 1        kept (Icon `fill` prop)
  wght  400 and 700    kept as the range 400..700 (Icon `weight` prop)
  GRAD  always 0       pinned
  opsz  always 24      pinned

so this keeps just those, which makes the font about 40x smaller.

Steps: list every icon ligature in the full font (scripts/icons/all-icon-names.json,
read by the scanner), ask scripts/icons/scan.mjs which ones the app uses, drop
every other ligature from GSUB, subset to the used icon glyphs plus the letters
their names are typed with, pin the axes, write
src/styles/fonts/material-symbols-rounded-subset.woff2 and the matching name list
src/styles/fonts/material-symbols-rounded.icons.json (checked by the unit tests).
"""
import json
import os
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SOURCE = os.path.join(ROOT, 'node_modules', 'material-symbols', 'material-symbols-rounded.woff2')
ALL_NAMES = os.path.join(ROOT, 'scripts', 'icons', 'all-icon-names.json')
OUT_FONT = os.path.join(ROOT, 'src', 'styles', 'fonts', 'material-symbols-rounded-subset.woff2')
OUT_NAMES = os.path.join(ROOT, 'src', 'styles', 'fonts', 'material-symbols-rounded.icons.json')

AXES = {'GRAD': 0, 'opsz': 24, 'wght': (400, 700)}  # FILL stays variable (0..1)


def ligature_subtables(font):
    for lookup in font['GSUB'].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if lookup.LookupType == 7:
                st = st.ExtSubTable
            if hasattr(st, 'ligatures'):
                yield st


def icon_map(font):
    """{icon name: ligature glyph name} for every icon in the font."""
    rev = {g: chr(cp) for cp, g in font.getBestCmap().items()}
    names = {}
    for st in ligature_subtables(font):
        for first, ligs in st.ligatures.items():
            for lig in ligs:
                chars = [rev.get(first)] + [rev.get(c) for c in lig.Component]
                if None not in chars:
                    names[''.join(chars)] = lig.LigGlyph
    return names


def main():
    if not os.path.exists(SOURCE):
        sys.exit(f'{SOURCE} not found: run npm ci first')
    font = TTFont(SOURCE)
    icons = icon_map(font)
    with open(ALL_NAMES, 'w') as f:
        json.dump(sorted(icons), f, indent=0)
        f.write('\n')

    used = json.loads(subprocess.check_output(['node', os.path.join(ROOT, 'scripts', 'icons', 'scan.mjs')], cwd=ROOT))
    keep_glyphs = {icons[n] for n in used}

    # Drop the ligatures of every icon we do not ship, so the subsetter's
    # closure cannot pull them back in through the letters we keep.
    for st in ligature_subtables(font):
        for first in list(st.ligatures):
            kept = [l for l in st.ligatures[first] if l.LigGlyph in keep_glyphs]
            if kept:
                st.ligatures[first] = kept
            else:
                del st.ligatures[first]

    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.hinting = False
    opts.flavor = None
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=sorted(keep_glyphs), text=''.join(sorted(set(''.join(used)))))
    sub.subset(font)

    font = instancer.instantiateVariableFont(font, AXES)
    font.flavor = 'woff2'
    os.makedirs(os.path.dirname(OUT_FONT), exist_ok=True)
    font.save(OUT_FONT)
    with open(OUT_NAMES, 'w') as f:
        json.dump(used, f, indent=0)
        f.write('\n')

    print(f'{len(used)} icons -> {os.path.relpath(OUT_FONT, ROOT)} '
          f'({os.path.getsize(OUT_FONT) / 1024:.0f} KB, source {os.path.getsize(SOURCE) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
