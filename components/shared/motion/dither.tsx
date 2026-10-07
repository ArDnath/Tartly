'use client';

/* eslint-disable react-hooks/immutability -- Vendored react-three-fiber
   component. It drives three.js imperatively: the uniforms are one stable
   object mutated inside `useFrame` each frame, which the compiler immutability
   rule can't model. */

/* React Bits "Dither" (JavaScript + CSS variant), ported to TypeScript to match
   this repo. The effect is a WebGL wave field rendered through a retro dither
   pass: `@react-three/fiber` draws the animated noise in a shader, then
   `postprocessing` quantises it into a small palette with an 8×8 Bayer matrix.

   The original ships as plain JS; the only changes here are type annotations,
   a `className` passthrough and the local CSS import convention. */

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type Ref,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, wrapEffect } from '@react-three/postprocessing';
import { Effect } from 'postprocessing';
import * as THREE from 'three';

import { cn } from '@/lib/utils';

import './dither.css';

/** A normalized RGB triple, 0–1 per channel. */
export type DitherRgb = [number, number, number];

const waveVertexShader = `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const waveFragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec3 backgroundColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p + fbm(p2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float f = pattern(uv);
  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= 0.5 * effect;
  }
  vec3 col = mix(backgroundColor, waveColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

const ditherFragmentShader = `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0,19.0/64.0, 47.0/64.0, 31.0/64.0,
  8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0,59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0,24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0,27.0/64.0, 39.0/64.0, 23.0/64.0,
  2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0,49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0,18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0,17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0,58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0,57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0,26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0,25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * resolution / pixelSize);
  int x = int(mod(scaledCoord.x, 8.0));
  int y = int(mod(scaledCoord.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float step = 1.0 / (colorNum - 1.0);
  color += threshold * step;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float bias = mix(0.2, 0.0, smoothstep(0.45, 0.8, luminance));
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
}

void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
  vec2 normalizedPixelSize = pixelSize / resolution;
  vec2 uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize);
  vec4 color = texture2D(inputBuffer, uvPixel);
  color.rgb = dither(uv, color.rgb);
  outputColor = color;
}
`;

/**
 * Post-processing pass that quantises the wave field into `colorNum` steps
 * using an 8×8 Bayer ordered-dither matrix.
 */
class RetroEffectImpl extends Effect {
  constructor() {
    super('RetroEffect', ditherFragmentShader, {
      uniforms: new Map<string, THREE.Uniform>([
        ['colorNum', new THREE.Uniform(4.0)],
        ['pixelSize', new THREE.Uniform(2.0)],
      ]),
    });
  }

  get colorNum(): number {
    return this.uniforms.get('colorNum')?.value as number;
  }

  set colorNum(value: number) {
    const uniform = this.uniforms.get('colorNum');
    if (uniform) uniform.value = value;
  }

  get pixelSize(): number {
    return this.uniforms.get('pixelSize')?.value as number;
  }

  set pixelSize(value: number) {
    const uniform = this.uniforms.get('pixelSize');
    if (uniform) uniform.value = value;
  }
}

// `wrapEffect` can't infer the constructor's (absent) args, so widen it to the
// two props this effect actually exposes to React.
const WrappedRetro = wrapEffect(RetroEffectImpl) as unknown as ComponentType<{
  colorNum: number;
  pixelSize: number;
  ref?: Ref<RetroEffectImpl>;
}>;

const RetroEffect = forwardRef<RetroEffectImpl, { colorNum: number; pixelSize: number }>(
  ({ colorNum, pixelSize }, ref) => (
    <WrappedRetro ref={ref} colorNum={colorNum} pixelSize={pixelSize} />
  ),
);
RetroEffect.displayName = 'RetroEffect';

interface DitheredWavesProps {
  waveSpeed: number;
  waveFrequency: number;
  waveAmplitude: number;
  waveColor: DitherRgb;
  backgroundColor: DitherRgb;
  colorNum: number;
  pixelSize: number;
  disableAnimation: boolean;
  enableMouseInteraction: boolean;
  mouseRadius: number;
}

function DitheredWaves({
  waveSpeed,
  waveFrequency,
  waveAmplitude,
  waveColor,
  backgroundColor,
  colorNum,
  pixelSize,
  disableAnimation,
  enableMouseInteraction,
  mouseRadius,
}: DitheredWavesProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const mouseRef = useRef(new THREE.Vector2());
  const { viewport, size, gl } = useThree();

  // Lazy `useState` gives a stable, mutable uniforms object that can be read
  // during render (a ref would trip the React Compiler rules). `useFrame`
  // reconciles every prop below each frame, so first-render values are enough.
  const [waveUniforms] = useState(() => ({
    time: new THREE.Uniform(0),
    resolution: new THREE.Uniform(new THREE.Vector2(0, 0)),
    waveSpeed: new THREE.Uniform(waveSpeed),
    waveFrequency: new THREE.Uniform(waveFrequency),
    waveAmplitude: new THREE.Uniform(waveAmplitude),
    waveColor: new THREE.Uniform(new THREE.Color(...waveColor)),
    backgroundColor: new THREE.Uniform(new THREE.Color(...backgroundColor)),
    mousePos: new THREE.Uniform(new THREE.Vector2(0, 0)),
    enableMouseInteraction: new THREE.Uniform(enableMouseInteraction ? 1 : 0),
    mouseRadius: new THREE.Uniform(mouseRadius),
  }));

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.floor(size.width * dpr);
    const h = Math.floor(size.height * dpr);
    const res = waveUniforms.resolution.value;
    if (res.x !== w || res.y !== h) {
      res.set(w, h);
    }
  }, [size, gl, waveUniforms]);

  // R3F v9 copies a `ShaderMaterial`'s uniforms into a stable per-material map
  // instead of using the object passed in (see `applyProps` in
  // @react-three/fiber). That detaches `waveUniforms` from the shader, so the
  // per-frame `time` mutations in `useFrame` never reach the GPU and the wave
  // sits frozen. Point the material back at our object so it animates.
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms = waveUniforms;
  }, [waveUniforms]);

  const prevColor = useRef<DitherRgb>([...waveColor] as DitherRgb);
  const prevBackgroundColor = useRef<DitherRgb>([...backgroundColor] as DitherRgb);

  useFrame(({ clock }) => {
    const u = waveUniforms;

    if (!disableAnimation) {
      u.time.value = clock.getElapsedTime();
    }

    if (u.waveSpeed.value !== waveSpeed) u.waveSpeed.value = waveSpeed;
    if (u.waveFrequency.value !== waveFrequency) u.waveFrequency.value = waveFrequency;
    if (u.waveAmplitude.value !== waveAmplitude) u.waveAmplitude.value = waveAmplitude;

    if (!prevColor.current.every((v, i) => v === waveColor[i])) {
      u.waveColor.value.set(...waveColor);
      prevColor.current = [...waveColor] as DitherRgb;
    }

    if (!prevBackgroundColor.current.every((v, i) => v === backgroundColor[i])) {
      u.backgroundColor.value.set(...backgroundColor);
      prevBackgroundColor.current = [...backgroundColor] as DitherRgb;
    }

    u.enableMouseInteraction.value = enableMouseInteraction ? 1 : 0;
    u.mouseRadius.value = mouseRadius;

    if (enableMouseInteraction) {
      u.mousePos.value.copy(mouseRef.current);
    }
  });

  const handlePointerMove = (event: { clientX: number; clientY: number }) => {
    if (!enableMouseInteraction) return;
    const rect = gl.domElement.getBoundingClientRect();
    const dpr = gl.getPixelRatio();
    mouseRef.current.set(
      (event.clientX - rect.left) * dpr,
      (event.clientY - rect.top) * dpr,
    );
  };

  return (
    <>
      <mesh ref={mesh} scale={[viewport.width, viewport.height, 1]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={waveVertexShader}
          fragmentShader={waveFragmentShader}
          uniforms={waveUniforms}
        />
      </mesh>

      <EffectComposer>
        <RetroEffect colorNum={colorNum} pixelSize={pixelSize} />
      </EffectComposer>

      {/* Invisible hit plane that only exists to capture pointer movement for
          the mouse-interaction uniform. */}
      <mesh
        onPointerMove={handlePointerMove}
        position={[0, 0, 0.01]}
        scale={[viewport.width, viewport.height, 1]}
        visible={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </>
  );
}

export interface DitherProps {
  /** Speed of the wave animation. */
  waveSpeed?: number;
  /** Frequency of the wave pattern. */
  waveFrequency?: number;
  /** Amplitude of the wave pattern. */
  waveAmplitude?: number;
  /** Color of the wave, defined as an RGB array (0–1 per channel). */
  waveColor?: DitherRgb;
  /** Base canvas color behind the dithered waves. */
  backgroundColor?: DitherRgb;
  /** Number of colors to use in the dithering effect. */
  colorNum?: number;
  /** Size of the pixels for the dithering effect. */
  pixelSize?: number;
  /** Disable the wave animation when true. */
  disableAnimation?: boolean;
  /** Enables mouse interaction to influence the wave effect. */
  enableMouseInteraction?: boolean;
  /** Radius for the mouse interaction effect. */
  mouseRadius?: number;
  /** Additional classes on the canvas container. */
  className?: string;
}

/**
 * React Bits "Dither" background: an animated halftone-style wave field
 * quantised through an ordered-dither post pass. Fills its parent, so wrap it
 * in a sized, relatively-positioned box (usually `absolute inset-0`).
 */
export function Dither({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.5, 0.5, 0.5],
  backgroundColor = [0, 0, 0],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 1,
  className,
}: DitherProps) {
  return (
    <Canvas
      className={cn('dither-container', className)}
      camera={{ position: [0, 0, 6] }}
      dpr={1}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <DitheredWaves
        waveSpeed={waveSpeed}
        waveFrequency={waveFrequency}
        waveAmplitude={waveAmplitude}
        waveColor={waveColor}
        backgroundColor={backgroundColor}
        colorNum={colorNum}
        pixelSize={pixelSize}
        disableAnimation={disableAnimation}
        enableMouseInteraction={enableMouseInteraction}
        mouseRadius={mouseRadius}
      />
    </Canvas>
  );
}

export default Dither;
