import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CHUNK_SIZE,
  ExplosionEvent,
  GameSimulation,
  GRAVITY,
  POWER_TO_SPEED,
  Tank,
  WEAPONS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '@tankwars/shared';

export interface RenderOptions {
  myId: string;
  aim: { angle: number; power: number } | null;
  cinematic: boolean;
}

interface TankVisual {
  group: THREE.Group;
  gun: THREE.Group;
  barrel: THREE.Group;
  shield: THREE.Mesh;
  tilt: number;
  recoil: number;
  smokeT: number;
  bodyMat: THREE.MeshStandardMaterial;
}

interface Fx {
  sprite: THREE.Sprite;
  active: boolean;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  a0: number;
  drag: number;
  rise: number;
  c0: THREE.Color;
  c1: THREE.Color;
}

interface Debris {
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  s: number;
  rx: number; ry: number;
  color: THREE.Color;
}

interface Cloud {
  group: THREE.Group;
  speedFactor: number;
  bobOffset: number;
  baseY: number;
}

const TERRAIN_DEPTH = 90;
const MAX_DEBRIS = 260;
const FIRE_POOL = 180;
const SMOKE_POOL = 320;
const MOTES = 140;

/* ------------------------------------------------------------------ */
/* Shader                                                              */
/* ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 sunDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 horizon = vec3(1.00, 0.70, 0.46);
    vec3 low     = vec3(0.98, 0.55, 0.40);
    vec3 mid     = vec3(0.34, 0.50, 0.86);
    vec3 zenith  = vec3(0.06, 0.12, 0.38);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.32, h));
    col = mix(col, zenith, smoothstep(0.25, 0.85, h));
    col = mix(col, low * 0.55, 1.0 - smoothstep(-0.25, 0.0, h));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += vec3(1.0, 0.62, 0.30) * pow(s, 5.0) * 0.45;
    col += vec3(1.0, 0.80, 0.55) * pow(s, 60.0) * 0.9;
    col += vec3(1.0, 0.92, 0.75) * pow(s, 1800.0) * 5.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    focusPos: { value: 0.5 },
    focusWidth: { value: 0.24 },
    blurAmount: { value: 0.0032 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float focusPos;
    uniform float focusWidth;
    uniform float blurAmount;
    varying vec2 vUv;
    void main() {
      float dist = abs(vUv.y - focusPos);
      float blur = smoothstep(focusWidth, focusWidth + 0.38, dist) * blurAmount;
      if (blur < 0.0002) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 sum = vec4(0.0);
      sum += texture2D(tDiffuse, vUv + vec2(-blur, -blur)) * 0.09;
      sum += texture2D(tDiffuse, vUv + vec2(0.0, -blur)) * 0.12;
      sum += texture2D(tDiffuse, vUv + vec2(blur, -blur)) * 0.09;
      sum += texture2D(tDiffuse, vUv + vec2(-blur, 0.0)) * 0.12;
      sum += texture2D(tDiffuse, vUv) * 0.16;
      sum += texture2D(tDiffuse, vUv + vec2(blur, 0.0)) * 0.12;
      sum += texture2D(tDiffuse, vUv + vec2(-blur, blur)) * 0.09;
      sum += texture2D(tDiffuse, vUv + vec2(0.0, blur)) * 0.12;
      sum += texture2D(tDiffuse, vUv + vec2(blur, blur)) * 0.09;
      gl_FragColor = sum;
    }
  `,
};

/** Color-Grading, Vignette, leichte chromatische Aberration und Filmkorn. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    flash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float flash;
    varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.018;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // Split-Toning: Schatten kühl, Lichter warm
      col = mix(col, col * vec3(0.90, 0.98, 1.12), (1.0 - smoothstep(0.0, 0.5, l)) * 0.55);
      col = mix(col, col * vec3(1.10, 1.01, 0.88), smoothstep(0.3, 1.2, l) * 0.5);
      col = mix(vec3(l), col, 1.12);
      col *= 1.0 - smoothstep(0.18, 0.62, r2) * 0.62;
      col += flash * vec3(1.0, 0.55, 0.2) * (0.25 - r2) * 0.6;
      col += (rnd(vUv * 900.0) - 0.5) * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* ------------------------------------------------------------------ */

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function radialTexture(inner = 0, soft = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, inner * 64, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35 * soft, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 34, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DioramaRenderer {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private gradePass: ShaderPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sun!: THREE.DirectionalLight;

  private chunkMeshes = new Map<number, THREE.Mesh>();
  private terrainMat: THREE.MeshStandardMaterial;

  private tankVisuals = new Map<string, TankVisual>();
  private projMeshes = new Map<string, { mesh: THREE.Group; trail: number }>();

  private clouds: Cloud[] = [];
  private elapsed = 0;

  private fire: Fx[] = [];
  private smoke: Fx[] = [];
  private rings: Fx[] = [];
  private debris: Debris[] = [];
  private debrisMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private flashLight: THREE.PointLight;
  private flashLevel = 0;
  private screenFlash = 0;

  private motes: THREE.Points;
  private aimDots: THREE.Points;

  private shakeIntensity = 0;
  private camX = WORLD_WIDTH / 2;
  private camZoom = 0;
  private kickQueue: string[] = [];
  private baseZ = 820;
  private tmp = new THREE.Vector3();

  private glowTex = radialTexture();
  private ringTex = ringTexture();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#e0a982', 950, 2500);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.38;

    this.camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 10, 9000);

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.5, 0.95);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new ShaderPass(TiltShiftShader));
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.setupSky();
    this.setupLights();
    this.setupStage();
    this.setupMountains();
    this.setupClouds();

    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0,
    });

    // Sprite-Pools
    const mk = (additive: boolean): Fx => {
      const mat = new THREE.SpriteMaterial({
        map: this.glowTex,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      return {
        sprite, active: false, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size0: 1, size1: 1, a0: 1, drag: 0, rise: 0,
        c0: new THREE.Color(), c1: new THREE.Color(),
      };
    };
    for (let i = 0; i < FIRE_POOL; i++) this.fire.push(mk(true));
    for (let i = 0; i < SMOKE_POOL; i++) this.smoke.push(mk(false));
    for (let i = 0; i < 16; i++) {
      const fx = mk(true);
      (fx.sprite.material as THREE.SpriteMaterial).map = this.ringTex;
      this.rings.push(fx);
    }

    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
      MAX_DEBRIS
    );
    this.debrisMesh.castShadow = true;
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.frustumCulled = false;
    this.scene.add(this.debrisMesh);
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.debris.push({ active: false, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, s: 1, rx: 0, ry: 0, color: new THREE.Color() });
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
      this.debrisMesh.setColorAt(i, new THREE.Color('#6b4a30'));
    }

    this.flashLight = new THREE.PointLight('#ff9a4a', 0, 520, 1.6);
    this.scene.add(this.flashLight);

    // Staub / Pollen, die vom Wind getrieben werden
    const mp = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      mp[i * 3] = Math.random() * WORLD_WIDTH;
      mp[i * 3 + 1] = 40 + Math.random() * 360;
      mp[i * 3 + 2] = -60 + Math.random() * 160;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(
      mg,
      new THREE.PointsMaterial({
        size: 2.6, map: this.glowTex, color: '#ffe2b8', transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      })
    );
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);

    // Flugbahn-Vorschau
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
    ag.setAttribute('color', new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
    this.aimDots = new THREE.Points(
      ag,
      new THREE.PointsMaterial({
        size: 5, map: this.glowTex, vertexColors: true, transparent: true, depthTest: false,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true,
      })
    );
    this.aimDots.frustumCulled = false;
    this.aimDots.renderOrder = 10;
    this.scene.add(this.aimDots);

    this.resize();
  }

  /* ----------------------------- Szene ----------------------------- */

  private setupSky(): void {
    const sunDir = new THREE.Vector3(0.62, 0.22, -0.75).normalize();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3400, 32, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { sunDir: { value: sunDir } },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    sky.position.set(WORLD_WIDTH / 2, 0, 0);
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.skySunDir = sunDir;
  }
  private skySunDir = new THREE.Vector3();

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight('#ffd9b5', '#34406b', 0.75));

    const sun = new THREE.DirectionalLight('#ffd2a0', 2.5);
    sun.position.set(WORLD_WIDTH / 2 + 520, 460, 380);
    sun.target.position.set(WORLD_WIDTH / 2, 120, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -720;
    sun.shadow.camera.right = 720;
    sun.shadow.camera.top = 420;
    sun.shadow.camera.bottom = -320;
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 1600;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    const rim = new THREE.DirectionalLight('#7fa8ff', 0.9);
    rim.position.set(-500, 260, -300);
    rim.target.position.set(WORLD_WIDTH / 2, 120, 0);
    this.scene.add(rim, rim.target);
  }

  private setupStage(): void {
    const w = WORLD_WIDTH + 40;
    const d = TERRAIN_DEPTH + 30;
    const plinthMat = new THREE.MeshStandardMaterial({ color: '#171c28', roughness: 0.42, metalness: 0.55 });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w, 46, d), plinthMat);
    plinth.position.set(WORLD_WIDTH / 2, -23.5, 0);
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    this.scene.add(plinth);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff6a1a', emissiveIntensity: 0.35, roughness: 0.4 })
    );
    trim.position.set(WORLD_WIDTH / 2, -12, d / 2 + 0.2);
    this.scene.add(trim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshStandardMaterial({ color: '#0d111a', roughness: 0.3, metalness: 0.7 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(WORLD_WIDTH / 2, -47, -400);
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private setupMountains(): void {
    const layers = [
      { z: -380, base: 40, amp: 190, color: '#7d6a86', seed: 1.3 },
      { z: -620, base: 90, amp: 240, color: '#6a5d7c', seed: 4.1 },
      { z: -900, base: 150, amp: 260, color: '#585074', seed: 7.7 },
      { z: -1300, base: 200, amp: 300, color: '#4a4668', seed: 2.9 },
    ];
    for (const L of layers) {
      const pts: THREE.Vector2[] = [new THREE.Vector2(-2200, -60)];
      for (let x = -2200; x <= 3200; x += 40) {
        const n =
          Math.sin(x * 0.0041 + L.seed) * 0.5 +
          Math.sin(x * 0.0113 + L.seed * 2.1) * 0.28 +
          Math.sin(x * 0.027 + L.seed * 0.7) * 0.12 +
          Math.abs(Math.sin(x * 0.0072 + L.seed * 3.3)) * 0.35;
        pts.push(new THREE.Vector2(x, L.base + (n + 0.4) * L.amp * 0.6));
      }
      pts.push(new THREE.Vector2(3200, -60));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), new THREE.MeshBasicMaterial({ color: L.color, fog: true }));
      mesh.position.z = L.z;
      this.scene.add(mesh);
    }
  }

  private setupClouds(): void {
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffe9d6', roughness: 1, emissive: '#ff9f6a', emissiveIntensity: 0.25, flatShading: true });
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);

    for (let i = 0; i < 9; i++) {
      const group = new THREE.Group();
      const puffCount = 4 + (i % 3);
      for (let p = 0; p < puffCount; p++) {
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        const radius = 16 + Math.random() * 16;
        puff.scale.set(radius * 1.5, radius * 0.8, radius);
        puff.position.set((p - (puffCount - 1) / 2) * 24, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 12);
        group.add(puff);
      }
      const baseY = 400 + Math.random() * 170;
      group.position.set((i / 9) * (WORLD_WIDTH + 400) - 200, baseY, -150 - Math.random() * 260);
      this.scene.add(group);
      this.clouds.push({ group, speedFactor: 0.5 + Math.random() * 0.7, bobOffset: Math.random() * Math.PI * 2, baseY });
    }
  }

  /* ----------------------------- Update ---------------------------- */

  private updateAtmosphere(wind: number, dt: number): void {
    this.elapsed += dt;
    const drift = (wind === 0 ? 5 : wind * 0.9) * dt;
    for (const c of this.clouds) {
      c.group.position.x += drift * c.speedFactor;
      c.group.position.y = c.baseY + Math.sin(this.elapsed * 0.8 + c.bobOffset) * 4;
      if (c.group.position.x > WORLD_WIDTH + 260) c.group.position.x = -260;
      if (c.group.position.x < -260) c.group.position.x = WORLD_WIDTH + 260;
    }
    const arr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      let x = arr.getX(i) + (wind * 2.6 + Math.sin(this.elapsed + i) * 6) * dt;
      const y = arr.getY(i) + Math.cos(this.elapsed * 0.7 + i * 1.3) * 5 * dt;
      if (x > WORLD_WIDTH + 40) x = -40;
      if (x < -40) x = WORLD_WIDTH + 40;
      arr.setXYZ(i, x, y, arr.getZ(i));
    }
    arr.needsUpdate = true;
  }

  public resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.camera.aspect = w / h;
    this.baseZ = 1000 * Math.max(1, 1.45 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  public project(x: number, y: number): { x: number; y: number } {
    this.tmp.set(x, y, 0).project(this.camera);
    return { x: ((this.tmp.x + 1) / 2) * window.innerWidth, y: ((1 - this.tmp.y) / 2) * window.innerHeight };
  }

  public kick(tankId: string): void {
    this.kickQueue.push(tankId);
  }

  /* ----------------------------- Terrain --------------------------- */

  private syncTerrain(sim: GameSimulation): void {
    if (sim.terrain.dirtyChunks.size === 0) return;
    for (const chunkIdx of sim.terrain.dirtyChunks) {
      const oldMesh = this.chunkMeshes.get(chunkIdx);
      if (oldMesh) {
        this.scene.remove(oldMesh);
        oldMesh.geometry.dispose();
      }
      const mesh = this.buildChunkMesh(sim, chunkIdx);
      this.scene.add(mesh);
      this.chunkMeshes.set(chunkIdx, mesh);
    }
    sim.terrain.dirtyChunks.clear();
  }

  private buildChunkMesh(sim: GameSimulation, chunkIdx: number): THREE.Mesh {
    const t = sim.terrain;
    const startX = chunkIdx * CHUNK_SIZE;
    const endX = Math.min(t.width - 1, startX + CHUNK_SIZE);
    const hd = TERRAIN_DEPTH / 2;

    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];

    const lip0 = new THREE.Color('#86cf48');
    const lip1 = new THREE.Color('#4a8a27');
    const dirtA = new THREE.Color('#b07a47');
    const dirtB = new THREE.Color('#82583a');
    const dirtC = new THREE.Color('#5a4333');
    const rock = new THREE.Color('#34323a');
    const top = new THREE.Color('#6fb53a');
    const c = new THREE.Color();

    const vert = (x: number, y: number, z: number, n: [number, number, number], color: THREE.Color, j: number, shade = 1) => {
      pos.push(x, y, z);
      nor.push(n[0], n[1], n[2]);
      col.push(color.r * j * shade, color.g * j * shade, color.b * j * shade);
    };
    const quad = (
      a: [number, number, number], b: [number, number, number], cc: [number, number, number], d: [number, number, number],
      n: [number, number, number], ca: THREE.Color, cb: THREE.Color, cd: THREE.Color, cdd: THREE.Color, j: number, sa = 1, sb = 1, sc = 1, sd = 1
    ) => {
      // a,b,cc,d gegen den Uhrzeigersinn
      vert(...a, n, ca, j, sa); vert(...b, n, cb, j, sb); vert(...cc, n, cd, j, sc);
      vert(...a, n, ca, j, sa); vert(...cc, n, cd, j, sc); vert(...d, n, cdd, j, sd);
    };

    const step = 2;
    for (let x = startX; x < endX; x += step) {
      const nx = Math.min(endX, x + step);
      const h1 = t.getHeight(x);
      const h2 = t.getHeight(nx);
      const j = 0.9 + hash(x * 0.5) * 0.2;
      const slope = (a: number) => {
        const dh = (t.getHeight(a + 2) - t.getHeight(a - 2)) / 4;
        const l = Math.hypot(dh, 1);
        return [-dh / l, 1 / l, 0] as [number, number, number];
      };
      const nA = slope(x);
      const nB = slope(nx);

      // Oberfläche (Normalen pro Vertex für weiches Licht)
      const steep = Math.min(1, Math.abs(h2 - h1) / 3);
      c.copy(top).lerp(dirtA, steep * 0.6);
      vert(x, h1, hd, nA, c, j); vert(nx, h2, hd, nB, c, j); vert(nx, h2, -hd, nB, c, j, 0.82);
      vert(x, h1, hd, nA, c, j); vert(nx, h2, -hd, nB, c, j, 0.82); vert(x, h1, -hd, nA, c, j, 0.82);

      // Schnittfläche vorne: Grasnarbe + Gesteinsschichten (Bänder in Welt-Y, daher durchgehend)
      const nF: [number, number, number] = [0, 0, 1];
      const lipH = 7;
      const band = 14;
      const hTop = Math.max(h1, h2);
      const strata = (y: number): THREE.Color => {
        const d = Math.max(0, hTop - y);
        c.copy(dirtA).lerp(dirtB, Math.min(1, d / 45)).lerp(dirtC, Math.max(0, Math.min(1, (d - 45) / 90))).lerp(rock, Math.max(0, Math.min(1, (d - 130) / 140)));
        const m = 0.78 + hash(Math.floor(y / band) * 3.7) * 0.4;
        c.multiplyScalar(m);
        return c;
      };
      const sub = (ya1: number, ya2: number, yb1: number, yb2: number, ca: THREE.Color, cb: THREE.Color) => {
        // Streifen zwischen oberer (ya1/ya2) und unterer (yb1/yb2) Kante für Spalte x..nx
        if (ya1 - yb1 < 0.01 && ya2 - yb2 < 0.01) return;
        quad([x, yb1, hd], [nx, yb2, hd], [nx, ya2, hd], [x, ya1, hd], nF, cb, cb, ca, ca, j);
      };
      // Grasnarbe
      sub(h1, h2, Math.max(0, h1 - lipH), Math.max(0, h2 - lipH), lip0, lip1);
      // Schichten: von der Narbe abwärts bis y = 0
      const topA = Math.max(0, h1 - lipH);
      const topB = Math.max(0, h2 - lipH);
      const yHi = Math.max(topA, topB);
      let yb = Math.floor(yHi / band) * band;
      let prevA = topA;
      let prevB = topB;
      const startCol = new THREE.Color();
      // oberstes (angeschnittenes) Band
      startCol.copy(strata(yHi));
      while (true) {
        const nextA = Math.max(0, Math.min(prevA, yb));
        const nextB = Math.max(0, Math.min(prevB, yb));
        const cTop = strata(yb + band * 0.5).clone();
        const cBot = strata(Math.max(0, yb - band * 0.5)).clone().multiplyScalar(0.94);
        sub(prevA, prevB, nextA, nextB, cTop, cBot);
        prevA = nextA;
        prevB = nextB;
        if (yb <= 0) break;
        yb -= band;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /* ----------------------------- Panzer ---------------------------- */

  private extrude(profile: Array<[number, number]>, depth: number, bevel = 0.7): THREE.BufferGeometry {
    const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
    });
    g.translate(0, 0, -(depth - bevel * 2) / 2);
    return g;
  }

  private createTankVisual(colorHex: string): TankVisual {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.42, metalness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#232830', roughness: 0.55, metalness: 0.6 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#4a525f', roughness: 0.5, metalness: 0.6 });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#c9ced8', roughness: 0.35, metalness: 0.8 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // Ketten + Laufrollen
    for (const side of [-1, 1]) {
      const z = side * 7.3;
      const t = add(new THREE.BoxGeometry(23, 6.4, 4.2), darkMat);
      t.position.set(0, 3.4, z);
      for (const e of [-1, 1]) {
        const cap = add(new THREE.CylinderGeometry(3.2, 3.2, 4.2, 16), darkMat);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(e * 11.5, 3.2, z);
      }
      for (let i = -2; i <= 2; i++) {
        const w = add(new THREE.CylinderGeometry(2.2, 2.2, 4.7, 14), wheelMat);
        w.rotation.x = Math.PI / 2;
        w.position.set(i * 4.4, 2.9, z);
        const hub = add(new THREE.CylinderGeometry(0.9, 0.9, 5, 8), trimMat);
        hub.rotation.x = Math.PI / 2;
        hub.position.set(i * 4.4, 2.9, z);
      }
      const fender = add(new THREE.BoxGeometry(25, 0.9, 4.6), bodyMat);
      fender.position.set(0, 6.9, z);
    }

    // Wanne
    const hull = add(
      this.extrude([[-11, 0], [11.5, 0], [12.5, 2.4], [9.5, 5.6], [-9.5, 6.2], [-12.5, 3]], 12.5, 0.8),
      bodyMat
    );
    hull.position.y = 4.4;
    const plate = add(new THREE.BoxGeometry(8, 0.6, 9), darkMat);
    plate.position.set(-5, 10.7, 0);

    // Turm + Kanone
    const turret = new THREE.Group();
    turret.position.set(-0.5, 10.3, 0);
    group.add(turret);
    add(this.extrude([[-6.5, 0], [6.8, 0], [7.4, 2.4], [4.8, 5.4], [-4.6, 5.4], [-7.2, 2.6]], 11, 0.7), bodyMat, turret);
    const hatch = add(new THREE.CylinderGeometry(1.9, 2.1, 1.1, 10), darkMat, turret);
    hatch.position.set(-2.4, 6, 0);
    const ant = add(new THREE.CylinderGeometry(0.12, 0.12, 12, 4), darkMat, turret);
    ant.position.set(-5.5, 10.5, -3.5);

    const gun = new THREE.Group();
    gun.position.set(0, 2.9, 0);
    turret.add(gun);
    const mantlet = add(new THREE.CylinderGeometry(3.3, 3.3, 7, 14), bodyMat, gun);
    mantlet.rotation.x = Math.PI / 2;
    mantlet.position.x = 4.8;
    const barrel = new THREE.Group();
    gun.add(barrel);
    const tube = add(new THREE.CylinderGeometry(1.35, 1.65, 18, 12), darkMat, barrel);
    tube.rotation.z = -Math.PI / 2;
    tube.position.x = 13;
    const brake = add(new THREE.CylinderGeometry(2.1, 2.1, 3.4, 12), trimMat, barrel);
    brake.rotation.z = -Math.PI / 2;
    brake.position.x = 22.3;

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(21, 24, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.25, 1.1, 1.7), transparent: true, opacity: 0.22, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      })
    );
    shield.position.y = 9;
    shield.visible = false;
    group.add(shield);

    group.scale.setScalar(1.12);
    return { group, gun, barrel, shield, tilt: 0, recoil: 0, smokeT: 0, bodyMat };
  }

  private syncTanks(sim: GameSimulation, dt: number): void {
    const ids = new Set(sim.tanks.map((t) => t.id));
    for (const [id, vis] of this.tankVisuals) {
      if (!ids.has(id)) {
        this.scene.remove(vis.group);
        this.tankVisuals.delete(id);
      }
    }
    for (const tank of sim.tanks) {
      let vis = this.tankVisuals.get(tank.id);
      if (!vis) {
        vis = this.createTankVisual(tank.color);
        this.scene.add(vis.group);
        this.tankVisuals.set(tank.id, vis);
      }
      if (vis.bodyMat.color.getHexString() !== new THREE.Color(tank.color).getHexString()) vis.bodyMat.color.set(tank.color);

      vis.group.visible = tank.alive;
      if (!tank.alive) continue;

      const t = sim.terrain;
      const slope = Math.atan2(t.getHeight(tank.x + 9) - t.getHeight(tank.x - 9), 18);
      vis.tilt += (slope - vis.tilt) * Math.min(1, dt * 8);
      vis.group.position.set(tank.x, tank.y, 0);
      vis.group.rotation.z = vis.tilt;
      vis.gun.rotation.z = (tank.angle * Math.PI) / 180 - vis.tilt;
      vis.recoil = Math.max(0, vis.recoil - dt * 4);
      vis.barrel.position.x = -vis.recoil * 4.5;

      vis.shield.visible = tank.shield > 0;
      if (vis.shield.visible) {
        (vis.shield.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(this.elapsed * 4) * 0.05 + (tank.shield / 100) * 0.1;
      }

      if (tank.hp < 40) {
        vis.smokeT -= dt;
        if (vis.smokeT <= 0) {
          vis.smokeT = tank.hp < 20 ? 0.05 : 0.11;
          this.emitSmoke(tank.x - 3, tank.y + 17, 0, (Math.random() - 0.5) * 10, 28 + Math.random() * 14, (Math.random() - 0.5) * 6, 1.1, 7, 18, '#2c2c30', 0.7);
          if (tank.hp < 20) this.emitFire(tank.x - 3, tank.y + 15, 0, (Math.random() - 0.5) * 6, 18, 0, 0.35, 8, 3, '#ff9a3a', '#ff3a10', 0.9);
        }
      }
    }

    for (const id of this.kickQueue) {
      const tank = sim.tanks.find((x) => x.id === id);
      const vis = this.tankVisuals.get(id);
      if (!tank || !vis) continue;
      vis.recoil = 1;
      const a = (tank.angle * Math.PI) / 180;
      const tx = tank.x + Math.cos(a) * 29;
      const ty = tank.y + 15 + Math.sin(a) * 29;
      this.emitFire(tx, ty, 0, Math.cos(a) * 60, Math.sin(a) * 60, 0, 0.14, 8, 22, '#fff2c0', '#ff9a3a', 1);
      for (let i = 0; i < 5; i++) {
        this.emitSmoke(tx, ty, 0, Math.cos(a) * (30 + Math.random() * 50) + (Math.random() - 0.5) * 25, Math.sin(a) * (30 + Math.random() * 50) + 8, (Math.random() - 0.5) * 20, 0.8 + Math.random() * 0.5, 4, 14, '#bdb6ad', 0.5);
      }
      this.flashLevel = Math.max(this.flashLevel, 0.7);
      this.flashLight.position.set(tx, ty, 30);
    }
    this.kickQueue.length = 0;
  }

  /* ----------------------------- Geschosse ------------------------- */

  private createProjectile(weaponId: keyof typeof WEAPONS): THREE.Group {
    const def = WEAPONS[weaponId];
    const g = new THREE.Group();
    const glow = new THREE.Color(def.color).multiplyScalar(2.2);
    const scale = weaponId === 'NUKE' ? 1.9 : weaponId === 'MISSILE' ? 1.35 : weaponId === 'DIRT_BALL' ? 1.2 : 1;
    const bodyMat = new THREE.MeshStandardMaterial({ color: weaponId === 'DIRT_BALL' ? '#8b6a45' : '#cfd4dc', roughness: 0.35, metalness: 0.85 });
    if (weaponId === 'DIRT_BALL') {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(4.5, 1), bodyMat));
    } else {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 9, 10), bodyMat);
      body.rotation.z = -Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(1.7, 4.5, 10), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.4, metalness: 0.4 }));
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = 6.7;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 5.4), bodyMat);
      fin.position.x = -3.8;
      const fin2 = fin.clone();
      fin2.rotation.x = Math.PI / 2;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6, 8), new THREE.MeshBasicMaterial({ color: glow, toneMapped: false }));
      flame.rotation.z = Math.PI / 2;
      flame.position.x = -7.5;
      g.add(body, nose, fin, fin2, flame);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    g.scale.setScalar(scale);
    return g;
  }

  private syncProjectiles(sim: GameSimulation, dt: number): void {
    const active = new Set(sim.projectiles.map((p) => p.id));
    for (const [id, v] of this.projMeshes) {
      if (!active.has(id)) {
        this.scene.remove(v.mesh);
        this.projMeshes.delete(id);
      }
    }
    for (const p of sim.projectiles) {
      let v = this.projMeshes.get(p.id);
      if (!v) {
        v = { mesh: this.createProjectile(p.weaponId), trail: 0 };
        this.scene.add(v.mesh);
        this.projMeshes.set(p.id, v);
      }
      v.mesh.position.set(p.x, p.y, 0);
      v.mesh.rotation.z = Math.atan2(p.vy, p.vx);
      v.trail -= dt;
      if (v.trail <= 0) {
        v.trail = 0.016;
        const dirx = p.vx / (Math.hypot(p.vx, p.vy) || 1);
        const diry = p.vy / (Math.hypot(p.vx, p.vy) || 1);
        const bx = p.x - dirx * 9;
        const by = p.y - diry * 9;
        const col = new THREE.Color(WEAPONS[p.weaponId].color).getStyle();
        this.emitFire(bx, by, (Math.random() - 0.5) * 4, 0, 0, 0, 0.22, 7, 2, '#fff0b8', col, 0.9);
        this.emitSmoke(bx, by, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 10, 6, 0, 0.9 + Math.random() * 0.4, 3.5, 11, '#b9b2aa', 0.4);
      }
    }
  }

  /* ----------------------------- Partikel -------------------------- */

  private emit(pool: Fx[], x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c0: string, c1: string | null, a0: number, drag: number, rise: number): void {
    for (const p of pool) {
      if (p.active) continue;
      p.active = true;
      p.sprite.visible = true;
      p.sprite.position.set(x, y, z);
      p.vx = vx; p.vy = vy; p.vz = vz;
      p.life = p.maxLife = life;
      p.size0 = s0; p.size1 = s1; p.a0 = a0; p.drag = drag; p.rise = rise;
      p.c0.set(c0);
      p.c1.set(c1 ?? c0);
      p.sprite.material.rotation = Math.random() * 6.28;
      return;
    }
  }

  private emitFire(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c0: string, c1: string, a0: number): void {
    this.emit(this.fire, x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0, 1.5, 0);
  }

  private emitSmoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: string, a0: number): void {
    this.emit(this.smoke, x, y, z, vx, vy, vz, life, s0, s1, color, null, a0, 0.9, 6);
  }

  public spawnExplosion(ev: ExplosionEvent): void {
    const R = ev.radius;
    const big = R > 70;
    this.shakeIntensity = Math.min(26, this.shakeIntensity + R * (big ? 0.38 : 0.24));
    this.flashLevel = Math.max(this.flashLevel, Math.min(3.2, R / 28));
    this.screenFlash = Math.max(this.screenFlash, big ? 1 : R / 90);
    this.flashLight.position.set(ev.x, ev.y + 10, 40);
    this.flashLight.color.set(ev.isDirt ? '#c9a070' : '#ff9a4a');

    // Schockwelle
    this.emit(this.rings, ev.x, ev.y, 8, 0, 0, 0, big ? 0.9 : 0.5, R * 0.6, R * (big ? 5 : 3.2), ev.isDirt ? '#d8b88a' : '#ffd9a0', null, 0.8, 0, 0);

    if (!ev.isDirt) {
      this.emitFire(ev.x, ev.y, 10, 0, 0, 0, 0.22, R * 2.6, R * 3.4, '#ffffff', '#ffd27a', 1);
      const n = Math.min(46, Math.floor(R * 0.7) + 8);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.2 + Math.random() * 0.9) * R * 2.8;
        this.emitFire(
          ev.x + Math.cos(a) * R * 0.2, ev.y + Math.sin(a) * R * 0.2, (Math.random() - 0.5) * 30,
          Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 40, (Math.random() - 0.5) * sp * 0.4,
          0.45 + Math.random() * 0.6, R * (0.5 + Math.random() * 0.5), R * 0.15, '#ffe9a0', Math.random() < 0.5 ? '#ff4a14' : '#c8260c', 0.95
        );
      }
    }
    const sn = Math.min(40, Math.floor(R * 0.55) + 6);
    for (let i = 0; i < sn; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.1 + Math.random() * 0.6) * R * 1.8;
      this.emitSmoke(
        ev.x + Math.cos(a) * R * 0.3, ev.y + Math.sin(a) * R * 0.3, (Math.random() - 0.5) * 30,
        Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp * 0.6 + 25, (Math.random() - 0.5) * 20,
        1.4 + Math.random() * (big ? 3.4 : 1.8), R * 0.5, R * (big ? 1.7 : 1.2),
        ev.isDirt ? '#8a6a48' : Math.random() < 0.5 ? '#3a3a3f' : '#55524f', ev.isDirt ? 0.8 : 0.72
      );
    }
    if (big) {
      for (let i = 0; i < 18; i++) {
        this.emitFire(ev.x + (Math.random() - 0.5) * 20, ev.y + i * 6, 0, (Math.random() - 0.5) * 20, 80 + Math.random() * 80, 0, 1.2 + Math.random() * 0.8, R * 0.55, R * 1.1, '#ffd27a', '#ff4a14', 0.85);
      }
    }

    const dn = Math.min(48, Math.floor(R * 0.9));
    let k = 0;
    for (const d of this.debris) {
      if (d.active) continue;
      d.active = true;
      d.x = ev.x; d.y = ev.y; d.z = (Math.random() - 0.5) * 30;
      const a = Math.random() * Math.PI;
      const sp = (0.4 + Math.random() * 0.8) * R * 4.2;
      d.vx = Math.cos(a) * sp * (Math.random() < 0.5 ? 1 : -1);
      d.vy = Math.sin(a) * sp + 60;
      d.vz = (Math.random() - 0.5) * sp * 0.6;
      d.life = 0.9 + Math.random() * 0.9;
      d.s = (ev.isDirt ? 1.6 : 1.2) + Math.random() * 2.6;
      d.rx = Math.random() * 10; d.ry = Math.random() * 10;
      d.color.set(Math.random() < 0.55 ? '#7a5233' : Math.random() < 0.5 ? '#4a8a27' : '#3a3836');
      this.debrisMesh.setColorAt(this.debris.indexOf(d), d.color);
      if (++k >= dn) break;
    }
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    const upd = (pool: Fx[], additive: boolean) => {
      for (const p of pool) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          p.sprite.visible = false;
          continue;
        }
        const t = 1 - p.life / p.maxLife;
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp; p.vy = p.vy * damp + p.rise * dt; p.vz *= damp;
        const s = p.sprite;
        s.position.x += p.vx * dt; s.position.y += p.vy * dt; s.position.z += p.vz * dt;
        const size = p.size0 + (p.size1 - p.size0) * Math.min(1, t * (additive ? 1.2 : 0.8));
        s.scale.set(size, size, 1);
        const m = s.material as THREE.SpriteMaterial;
        m.color.copy(p.c0).lerp(p.c1, Math.min(1, t * 1.6));
        if (additive) {
          m.color.multiplyScalar(1.5 * (1 - t));
          m.opacity = p.a0;
        } else {
          m.opacity = p.a0 * (1 - t) * Math.min(1, t * 10);
        }
      }
    };
    upd(this.fire, true);
    upd(this.smoke, false);
    upd(this.rings, true);

    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      d.vy -= 420 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const s = d.s * Math.min(1, d.life * 3);
      this.dummy.position.set(d.x, d.y, d.z);
      this.dummy.rotation.set(d.life * d.rx, d.life * d.ry, 0);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;

    this.flashLevel = Math.max(0, this.flashLevel - dt * 4.5);
    this.flashLight.intensity = this.flashLevel * 9000;
    this.screenFlash = Math.max(0, this.screenFlash - dt * 3);
  }

  /* ----------------------------- Zielhilfe ------------------------- */

  private updateAim(sim: GameSimulation, opts: RenderOptions): void {
    const me = sim.tanks.find((t) => t.id === opts.myId);
    if (!opts.aim || !me || !me.alive) {
      this.aimDots.visible = false;
      return;
    }
    this.aimDots.visible = true;
    const g = this.aimDots.geometry;
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const ca = g.getAttribute('color') as THREE.BufferAttribute;
    const rad = (opts.aim.angle * Math.PI) / 180;
    const speed = opts.aim.power * POWER_TO_SPEED;
    let x = me.x + Math.cos(rad) * 16;
    let y = me.y + 10 + Math.sin(rad) * 16;
    let vx = Math.cos(rad) * speed;
    let vy = Math.sin(rad) * speed;
    const N = pa.count;
    const stepT = 0.065;
    const march = (this.elapsed * 6) % 1;
    for (let i = 0; i < N; i++) {
      // laufende Punkte: kleine Verschiebung entlang der Bahn
      const sub = i === 0 ? march * stepT : stepT;
      vx += sim.wind * sub;
      vy -= GRAVITY * sub;
      x += vx * sub;
      y += vy * sub;
      pa.setXYZ(i, x, y, 2);
      const fade = Math.max(0, 1 - i / N);
      ca.setXYZ(i, 1.4 * fade + 0.1, 0.95 * fade + 0.05, 0.45 * fade);
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
  }

  /* ----------------------------- Render ---------------------------- */

  public render(sim: GameSimulation, dt: number, opts: RenderOptions): void {
    this.syncTerrain(sim);
    this.syncTanks(sim, dt);
    this.syncProjectiles(sim, dt);
    this.updateAtmosphere(sim.wind, dt);
    this.updateAim(sim, opts);
    this.updateParticles(dt);

    // Kamera
    const cx = WORLD_WIDTH / 2;
    let targetX = cx;
    let targetZoom = 0;
    if (opts.cinematic) {
      targetX = cx + Math.sin(this.elapsed * 0.11) * 170;
      targetZoom = 0.14 + Math.sin(this.elapsed * 0.07) * 0.04;
    } else if (sim.projectiles.length > 0) {
      const avg = sim.projectiles.reduce((s, p) => s + p.x, 0) / sim.projectiles.length;
      targetX = cx + Math.max(-130, Math.min(130, (avg - cx) * 0.3));
      targetZoom = 0.07;
    }
    const k = Math.min(1, dt * 2.2);
    this.camX += (targetX - this.camX) * k;
    this.camZoom += (targetZoom - this.camZoom) * k;

    const z = this.baseZ * (1 - this.camZoom);
    const bob = Math.sin(this.elapsed * 0.35) * 1.6;
    this.camera.position.set(this.camX, WORLD_HEIGHT * 0.5 + bob - this.camZoom * 40, z);
    this.camera.lookAt(this.camX * 0.92 + cx * 0.08, WORLD_HEIGHT * 0.3 - this.camZoom * 30, 0);
    if (this.shakeIntensity > 0.2) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.04, dt);
    }

    (this.gradePass.uniforms.time as { value: number }).value = (this.elapsed * 7) % 100;
    (this.gradePass.uniforms.flash as { value: number }).value = this.screenFlash;
    this.composer.render();
  }
}
