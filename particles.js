// particles.js — OGL-based particle background (vanilla ESM)
// Inspired by ReactBits Particles. Renders a lightweight animated points field.

import { Renderer, Camera, Geometry, Program, Mesh } from 'https://cdn.jsdelivr.net/npm/ogl@0.0.105/dist/ogl.mjs';

const defaultColors = ['#ffffff', '#ffffff'];

function hexToRgb(hex) {
  hex = String(hex || '').replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const int = parseInt(hex || 'ffffff', 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  return [r, g, b];
}

const vertex = `
  attribute vec3 position;
  attribute vec4 random;
  attribute vec3 color;
  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uSpread;
  uniform float uBaseSize;
  uniform float uSizeRandomness;
  varying vec4 vRandom;
  varying vec3 vColor;
  void main() {
    vRandom = random;
    vColor = color;
    vec3 pos = position * uSpread;
    pos.z *= 10.0;
    vec4 mPos = modelMatrix * vec4(pos, 1.0);
    float t = uTime;
    mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
    mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
    mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);
    vec4 mvPos = viewMatrix * mPos;
    if (uSizeRandomness == 0.0) {
      gl_PointSize = uBaseSize;
    } else {
      gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
    }
    gl_Position = projectionMatrix * mvPos;
  }
`;

const fragment = `
  precision highp float;
  uniform float uTime;
  uniform float uAlphaParticles;
  varying vec4 vRandom;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord.xy;
    float d = length(uv - vec2(0.5));
    if(uAlphaParticles < 0.5) {
      if(d > 0.5) { discard; }
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), 1.0);
    } else {
      float circle = smoothstep(0.5, 0.4, d) * 0.8;
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
    }
  }
`;

export function initParticles(container, opts = {}) {
  try {
    const moveParticlesOnHover = !!opts.moveParticlesOnHover;
    const particleHoverFactor = opts.particleHoverFactor ?? 1;
    const alphaParticles = !!opts.alphaParticles;
    const particleSpread = opts.particleSpread ?? 10;
    const speed = opts.speed ?? 0.1;
    const particleBaseSize = opts.particleBaseSize ?? 100;
    const sizeRandomness = opts.sizeRandomness ?? 1;
    const cameraDistance = opts.cameraDistance ?? 20;
    const disableRotation = !!opts.disableRotation;

    // Reduce intensity on small screens
    const isSmall = window.matchMedia('(max-width: 768px)').matches;
    const count = Math.max(10, Math.min(2000, opts.particleCount ?? 200));
    const particleCount = isSmall ? Math.max(40, Math.floor(count * 0.4)) : count;
    const palette = (opts.particleColors && opts.particleColors.length > 0 ? opts.particleColors : defaultColors).map(hexToRgb);

    const renderer = new Renderer({ depth: false, alpha: true, antialias: false, premultipliedAlpha: true });
    const gl = renderer.gl;
    container.appendChild(gl.canvas);
    gl.canvas.style.position = 'absolute';
    gl.canvas.style.inset = '0';
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.pointerEvents = 'none';
    gl.clearColor(0, 0, 0, 0);

    const camera = new Camera(gl, { fov: 15 });
    camera.position.set(0, 0, cameraDistance);

    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, window.devicePixelRatio);
      camera.perspective({ aspect: gl.canvas.width / gl.canvas.height });
    };
    window.addEventListener('resize', resize, false);
    resize();

    const positions = new Float32Array(particleCount * 3);
    const randoms = new Float32Array(particleCount * 4);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      let x, y, z, len;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        len = x * x + y * y + z * z;
      } while (len > 1 || len === 0);
      const r = Math.cbrt(Math.random());
      positions.set([x * r, y * r, z * r], i * 3);
      randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      const col = palette[Math.floor(Math.random() * palette.length)];
      colors.set(col, i * 3);
    }

    const geometry = new Geometry(gl, {
      position: { size: 3, data: positions },
      random: { size: 4, data: randoms },
      color: { size: 3, data: colors },
    });

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: particleSpread },
        uBaseSize: { value: particleBaseSize },
        uSizeRandomness: { value: sizeRandomness },
        uAlphaParticles: { value: alphaParticles ? 1 : 0 },
      },
      transparent: true,
      depthTest: false,
    });

    const particles = new Mesh(gl, { mode: gl.POINTS, geometry, program });

    let animationFrameId;
    let lastTime = performance.now();
    let elapsed = 0;
    const mouse = { x: 0, y: 0 };

    const onMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouse.x = x; mouse.y = y;
    };
    if (moveParticlesOnHover) container.addEventListener('mousemove', onMove);

    const update = (t) => {
      animationFrameId = requestAnimationFrame(update);
      const delta = t - lastTime; lastTime = t; elapsed += delta * speed;
      program.uniforms.uTime.value = elapsed * 0.001;
      if (moveParticlesOnHover) {
        particles.position.x = -mouse.x * (opts.particleHoverFactor ?? 1);
        particles.position.y = -mouse.y * (opts.particleHoverFactor ?? 1);
      } else {
        particles.position.x = particles.position.y = 0;
      }
      if (!disableRotation) {
        particles.rotation.x = Math.sin(elapsed * 0.0002) * 0.1;
        particles.rotation.y = Math.cos(elapsed * 0.0005) * 0.15;
        particles.rotation.z += 0.01 * speed;
      }
      renderer.render({ scene: particles, camera });
    };
    animationFrameId = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('resize', resize);
      if (moveParticlesOnHover) container.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(animationFrameId);
      try { container.removeChild(gl.canvas); } catch {}
    };
  } catch (e) {
    console.warn('Particles init failed', e);
    return () => {};
  }
}
