// Picks the glyph that draws a Cell, from its material, density and direction.
//
// Uniforms: none.
// Depends on: common.glsl, cell.glsl.

const int BODY_N = 6;
const int BODY_RAMP[BODY_N] = int[BODY_N](G_EQUALS, G_PLUS, G_STAR, G_HASH, G_PERCENT, G_AT);

float bayer4(ivec2 c) {
  const int B[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(B[(c.x & 3) + (c.y & 3) * 4]) + 0.5) / 16.0;
}

// Sign-free line direction (y down) → horizontal, '\', vertical or '/'.
int lineGlyph(vec2 d, int horizontal, int vertical) {
  float a = atan(d.y, d.x);
  if (a < 0.0) a += PI;
  int s = int(floor(a / (PI * 0.25) + 0.5)) % 4;
  if (s == 0) return horizontal;
  if (s == 1) return G_BSLASH;
  if (s == 2) return vertical;
  return G_SLASH;
}

// Outward normal (y down) of a silhouette → outline glyph. `cov` says whether
// the boundary sits in the upper or lower half of the cell.
int edgeGlyph(vec2 n, float cov) {
  int o = int(floor((atan(n.y, n.x) + TAU) / (PI * 0.25) + 0.5)) % 8;
  if (o == 0) return G_RPAREN;
  if (o == 4) return G_LPAREN;
  if (o == 1 || o == 5) return G_SLASH;
  if (o == 3 || o == 7) return G_BSLASH;
  if (o == 2) return cov > 0.5 ? G_UNDERSCORE : G_MINUS; // bottom edge
  return cov > 0.5 ? G_MINUS : G_UNDERSCORE;             // top edge
}

int pickGlyph(Cell c, ivec2 cell) {
  float dens = clamp(c.dens, 0.0, 1.0);
  float aux = clamp(c.aux, 0.0, 1.0);
  int style = int(c.style + 0.5);
  if (c.mat == M_WATER) {
    if (dens < 0.12) return G_SPACE;
    if (dens < 0.6) return aux < 0.4 ? G_DOT : aux < 0.65 ? G_COMMA : aux < 0.85 ? G_BACKTICK : G_QUOTE;
    return G_COLON;
  }
  if (c.mat == M_RIPPLE) {
    if (dens < 0.45) return G_DOT;
    return lineGlyph(c.dir, aux > 0.5 ? G_TILDE : G_MINUS, G_PIPE);
  }
  if (c.mat == M_TRAIL) {
    if (style == V_SHOWA) return dens > 0.55 ? G_O : G_DOT;
    if (style == V_OGON) return dens > 0.65 ? G_STAR : dens > 0.35 ? G_QUOTE : G_DOT;
    if (dens < 0.3) return G_DOT;
    if (dens < 0.55) return G_MINUS;
    return lineGlyph(c.dir, G_TILDE, G_COLON);
  }
  if (c.mat == M_FIN) {
    if (dens < 0.3) return G_DOT;
    if (dens < 0.45) return G_QUOTE;
    return lineGlyph(c.dir, style == V_OGON ? G_TILDE : G_MINUS, G_PIPE);
  }
  if (c.mat == M_EDGE) return edgeGlyph(c.dir, dens);
  if (c.mat == M_BODY) {
    if (aux > 0.75) return G_STAR;
    float x = smoothstep(0.3, 0.95, dens) * float(BODY_N - 1) + (bayer4(cell) - 0.5) * 0.5;
    return BODY_RAMP[clamp(int(floor(x + 0.5)), 0, BODY_N - 1)];
  }
  if (c.mat == M_EYE) return G_O;
  if (c.mat == M_STAR) {
    // Mostly small points; '*' only for the brightest, mostly at a scintillation.
    if (dens > 0.95) return G_STAR;
    if (dens > 0.65) return G_PLUS;
    if (dens > 0.4) return aux < 0.5 ? G_QUOTE : G_BACKTICK;
    return G_DOT;
  }
  if (c.mat == M_MOON) {
    if (style == 2) return lineGlyph(c.dir, G_EQUALS, G_PIPE);
    if (style == 1) return edgeGlyph(c.dir, dens);
    return dens < 0.33 ? G_DOT : dens < 0.56 ? G_COLON : dens < 0.67 ? G_O : G_BIG_O;
  }
  if (c.mat == M_SUN) return dens > 0.8 ? G_STAR : dens > 0.6 ? G_PLUS : G_DOT;
  if (c.mat == M_GLINT) {
    // High light: star bursts. Low light: dashes along its direction.
    if (aux > 0.55) return dens > 0.6 ? lineGlyph(c.dir, dens > 0.85 ? G_EQUALS : G_MINUS, G_PIPE) : G_DOT;
    return dens > 0.75 ? G_STAR : G_PLUS;
  }
  return G_SPACE;
}
