#!/usr/bin/env bash
# Regenerate the social-share card (Open Graph / Twitter) at public/og-image.png.
# Needs: ImageMagick (magick), librsvg (rsvg-convert). Run from the repo root:
#   ./scripts/make-og-image.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC_SHOT="doc/screenshot-3.png"
ICON="public/icon.svg"
OUT="public/og-image.png"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- 1. Phone screenshot: resize, round the corners, drop a soft shadow --------
PH_H=560
magick "$SRC_SHOT" -resize "x${PH_H}" "$WORK/shot.png"
PW=$(magick identify -format '%w' "$WORK/shot.png")
PH=$(magick identify -format '%h' "$WORK/shot.png")
magick "$WORK/shot.png" \
  \( +clone -alpha transparent -background none \
     -fill white -draw "roundrectangle 0,0 $((PW-1)),$((PH-1)),26,26" \) \
  -compose DstIn -composite "$WORK/rounded.png"
# thin light rim + soft shadow
magick "$WORK/rounded.png" \
  \( +clone -background black -shadow 60x22+0+14 \) +swap \
  -background none -layers merge +repage "$WORK/phone.png"
PHW=$(magick identify -format '%w' "$WORK/phone.png")
PHH=$(magick identify -format '%h' "$WORK/phone.png")

# --- 2. Background + text (SVG -> PNG) -----------------------------------------
ICON_B64="$(base64 < "$ICON" | tr -d '\n')"
# Right-align the phone with an 84px right margin, vertically centred.
PHONE_X=$(( 1200 - PHW - 68 ))
PHONE_Y=$(( (630 - PHH) / 2 ))

cat > "$WORK/bg.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#3f6488"/>
      <stop offset="1" stop-color="#1d3247"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#sheen)"/>

  <!-- app icon -->
  <image x="72" y="70" width="92" height="92" rx="20"
         xlink:href="data:image/svg+xml;base64,${ICON_B64}"/>

  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
    <!-- eyebrow -->
    <text x="180" y="128" font-size="27" font-weight="700"
          letter-spacing="2" fill="#ffffff">Paulstretch</text>
    <text x="180" y="156" font-size="19" font-weight="500"
          letter-spacing="3" fill="#9fc0dd">FOR&#160;WEB</text>

    <!-- headline -->
    <text x="72" y="300" font-size="82" font-weight="700" fill="#ffffff">Extreme audio</text>
    <text x="72" y="392" font-size="82" font-weight="700" fill="#ffffff">time-stretching.</text>

    <!-- subhead -->
    <text x="74" y="452" font-size="29" font-weight="400" fill="#c6d8e8">The classic Paulstretch, running</text>
    <text x="74" y="490" font-size="29" font-weight="400" fill="#c6d8e8">entirely in your browser.</text>

    <!-- pills -->
    <g>
      <rect x="72" y="528" width="336" height="52" rx="26" fill="#ffffff"/>
      <text x="104" y="562" font-size="24" font-weight="600" fill="#1d3247">&#43;&#160;&#160;Add to Home Screen</text>
      <rect x="424" y="528" width="188" height="52" rx="26" fill="#ffffff" fill-opacity="0.14"/>
      <text x="452" y="562" font-size="24" font-weight="500" fill="#dbe8f2">No install</text>
    </g>
  </g>
</svg>
SVG

rsvg-convert "$WORK/bg.svg" -o "$WORK/bg.png"

# --- 3. Composite phone over the background ------------------------------------
magick "$WORK/bg.png" "$WORK/phone.png" \
  -geometry "+${PHONE_X}+${PHONE_Y}" -composite \
  -strip "$OUT"

echo "Wrote $OUT ($(magick identify -format '%wx%h' "$OUT"))"
