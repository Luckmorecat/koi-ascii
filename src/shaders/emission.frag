// Emission pass: one fragment per character cell, after the scene and the
// fireflies. Stores each cell's emission() (emission.glsl) in a float target,
// so the glow pass fetches it once per tap instead of working it out from two
// scene fetches each time. Float32 keeps every bit, so the halo is unchanged.

out vec4 oEmit;

void main() {
  oEmit = emission(ivec2(gl_FragCoord.xy));
}
