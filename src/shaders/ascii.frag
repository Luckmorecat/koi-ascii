// ASCII pass: each output pixel finds its character cell and copies the
// cell's glyph (picked by the scene pass) texel-for-texel from the atlas.

uniform sampler2D uScene0;
uniform sampler2D uScene1;
uniform sampler2D uAtlas;
uniform ivec2 uCellPx;
uniform ivec2 uOrigin; // grid top-left, device px from the canvas top-left
uniform ivec2 uGrid;   // cols, rows
uniform int uCanvasH;
uniform vec3 uBg;
uniform int uRaw;

out vec4 fragColor;

void main() {
  ivec2 q = ivec2(int(gl_FragCoord.x), uCanvasH - 1 - int(gl_FragCoord.y)) - uOrigin;
  if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, uGrid * uCellPx))) {
    fragColor = vec4(uBg, 1.0);
    return;
  }
  ivec2 cell = q / uCellPx;
  ivec2 local = q - cell * uCellPx;
  vec4 s0 = texelFetch(uScene0, cell, 0);
  if (uRaw == 1) {
    fragColor = vec4(mix(uBg, s0.rgb, s0.a), 1.0);
    return;
  }
  int glyph = int(texelFetch(uScene1, cell, 0).r * 255.0 + 0.5);
  float ink = texelFetch(uAtlas, ivec2(glyph * uCellPx.x + local.x, local.y), 0).r;
  fragColor = vec4(mix(uBg, s0.rgb, ink), 1.0);
}
