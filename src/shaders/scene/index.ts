// The scene pass's fragment shader, in chunks by domain (docs/scene-features.md).
// GLSL has no #include, so the renderer compiles sceneSrc: the chunks joined in
// this order, which is declare-before-use. Each chunk's header names the chunks
// it depends on; a new one goes after all of them. Every chunk also sees
// uniforms.glsl and what the renderer puts before it: the generated defines
// (G_*, V_*, J_*, T_*, MAX_FISH; src/renderer.ts) and common.glsl.
import type { SourceStart } from '../../gl/program';
import uniforms from './uniforms.glsl?raw';
import light from './light.glsl?raw';
import cell from './cell.glsl?raw';
import ripples from './ripples.glsl?raw';
import water from './water.glsl?raw';
import sky from './sky.glsl?raw';
import fish from './fish.glsl?raw';
import markings from './markings.glsl?raw';
import trails from './trails.glsl?raw';
import compose from './compose.glsl?raw';
import glyphs from './glyphs.glsl?raw';
import avoid from './avoid.glsl?raw';
import main from './main.frag?raw';

/** Each chunk's file name and source, in compile order. */
export const sceneChunks: readonly (readonly [name: string, src: string])[] = [
  ['uniforms.glsl', uniforms],
  ['light.glsl', light],
  ['cell.glsl', cell],
  ['ripples.glsl', ripples],
  ['water.glsl', water],
  ['sky.glsl', sky],
  ['fish.glsl', fish],
  ['markings.glsl', markings],
  ['trails.glsl', trails],
  ['compose.glsl', compose],
  ['glyphs.glsl', glyphs],
  ['avoid.glsl', avoid],
  ['main.frag', main],
];

export const sceneSrc = sceneChunks.map(([, src]) => src).join('\n');

/** The line each chunk starts on in sceneSrc, 1-based, so compile errors can name `sky.glsl:42`. */
let line = 1;
export const sceneLines: readonly SourceStart[] = sceneChunks.map(([name, src]) => {
  const start = { name, line };
  line += src.split('\n').length;
  return start;
});
