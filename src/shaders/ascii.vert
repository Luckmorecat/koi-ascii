// The oversized triangle of fullscreen.vert, also handing the ASCII pass its
// device-pixel position as a varying. Reading gl_FragCoord, even as an int,
// has radeonsi start every fragment wave with the pixel position set up, which
// cost this pass a fifth of its time on RDNA; the varying needs only the
// barycentrics every fragment shader gets anyway.
uniform vec2 uDev; // drawing buffer, device px (the viewport)
out vec2 vPx;      // window position, device px: x + 0.5 at a pixel's centre

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  vPx = p * uDev;
}
