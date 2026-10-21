// Cell, what one character cell shows (material, colour, density, glyph
// direction), and cell-space helpers: directions, coverage, boxes.
//
// Uniforms (uniforms.glsl): uCell.
// Depends on: nothing.

struct Cell {
  vec3 col;
  float dens;
  int mat;
  vec2 dir; // cell space: outward normal for edges, line direction otherwise
  float aux;
  float style;
};

// Directions are converted to cell space so glyph slopes match on screen.
vec2 lineDir(vec2 d) {
  vec2 c = d / uCell;
  float l = length(c);
  return l > 1e-6 ? c / l : vec2(1.0, 0.0);
}

vec2 cellNormal(vec2 n) {
  vec2 c = n * uCell;
  float l = length(c);
  return l > 1e-6 ? c / l : vec2(1.0, 0.0);
}

// Fraction of the cell covered, estimated from the distance along the normal.
float coverage(float d, vec2 n) {
  float span = abs(n.x) * uCell.x + abs(n.y) * uCell.y;
  return clamp(0.5 - d / span, 0.0, 1.0);
}

float sq(float x) { return x * x; }

bool inBox(vec2 p, vec4 box, float pad) {
  return all(greaterThanEqual(p, box.xy - pad)) && all(lessThanEqual(p, box.zw + pad));
}
