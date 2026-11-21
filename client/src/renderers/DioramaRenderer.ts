import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
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
  body: THREE.Group;
  yaw: number;
  baseColor: THREE.Color;
  dead: boolean;
  wreckTilt: number;
  sprite: THREE.Object3D;
  spriteMat: THREE.MeshStandardMaterial;
  variant: number;
  meshed: boolean;
  colorHex: string;
  texReady: boolean;
  flip: number;
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

const TERRAIN_DEPTH = 210;
const TUFTS = 4200;
const ROCKS = 60;
const TREES = 30;
const RAIN = 900;
const MISTS = 14;
const TANK_SCALE = 1;
const MS = 72;
const YAW = 0.5;
const PIVOT_X = 0.54 * MS * Math.cos(YAW);
const PIVOT_Y = 0.413 * MS;
const BARREL_LEN = 0.42 * MS;
const MAX_DEBRIS = 260;
const FIRE_POOL = 420;
const SMOKE_POOL = 760;
const BLASTS = 14;
const RUBBLE = 220;
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
  uniform float time;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, -0.05);
    vec3 horizon = vec3(0.50, 0.54, 0.58);
    vec3 mid     = vec3(0.24, 0.28, 0.34);
    vec3 zenith  = vec3(0.07, 0.09, 0.13);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.35, h));
    col = mix(col, zenith, smoothstep(0.3, 0.95, h));
    float sd = max(dot(d, normalize(sunDir)), 0.0);
    vec2 p = d.xz / (h + 0.22) * 0.9 + vec2(time * 0.012, 0.0);
    float c = fbm(p);
    float cloud = smoothstep(0.38, 0.78, c);
    float lit = pow(sd, 3.0);
    vec3 cloudDark = vec3(0.11, 0.125, 0.15);
    vec3 cloudLit  = vec3(1.0, 0.66, 0.38);
    vec3 cc = mix(cloudDark, cloudLit, lit * (1.0 - cloud * 0.35));
    cc += vec3(1.0, 0.8, 0.55) * smoothstep(0.55, 0.38, c) * lit * 0.9 * cloud;
    col = mix(col, cc, cloud * 0.92);
    col += vec3(1.0, 0.62, 0.30) * pow(sd, 9.0) * 0.55 * (1.0 - cloud * 0.55);
    col += vec3(1.0, 0.85, 0.6) * pow(sd, 500.0) * 6.0 * (1.0 - cloud * 0.9);
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

  private chunkMeshes = new Map<number, THREE.Group>();
  private ext = new Map<number, THREE.Group>();
  private faceMat!: THREE.MeshStandardMaterial;
  private topMat!: THREE.MeshStandardMaterial;
  private tufts!: THREE.InstancedMesh;
  private rocks!: THREE.InstancedMesh;
  private trees!: THREE.InstancedMesh;
  private foliageSeed: Array<{ x: number; z: number; s: number; r: number }> = [];
  private rockSeed: Array<{ x: number; z: number; s: number; r: number }> = [];
  private treeSeed: Array<{ x: number; z: number; s: number }> = [];
  private swayUniform = { value: 0 };
  private rain!: THREE.LineSegments;
  private mists: THREE.Sprite[] = [];
  private skyMat!: THREE.ShaderMaterial;
  private texLoader = new THREE.TextureLoader();
  private fireTex!: THREE.Texture;
  private smokeTex!: THREE.CanvasTexture;
  private blasts: Array<{ sprite: THREE.Sprite; active: boolean; life: number; maxLife: number; size: number; spin: number }> = [];
  private burners: Array<{ x: number; z: number; t: number; dur: number; acc: number; kind: 'smoke' | 'flame'; size: number }> = [];
  private scorch = new Float32Array(WORLD_WIDTH + 1);
  private scorchDirty = new Set<number>();
  private rubble: Array<{ x: number; z: number; s: number; r: number }> = [];
  private rubbleMesh!: THREE.InstancedMesh;
  private lastTerrain: unknown = null;
  private lastRound = -1;
  private terrainRef: GameSimulation['terrain'] | null = null;
  private windDrift = 0;

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
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#6b7783', 800, 2800);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;

    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 10, 9000);

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.6, 0.96);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new ShaderPass(TiltShiftShader));
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.setupSky();
    this.setupLights();
    this.setupStage();
    this.setupFoliage();
    this.setupWeather();

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
    this.smokeTex = this.makeSmokeTexture();
    this.fireTex = this.loadTex('fireball.jpg');
    this.fireTex.wrapS = this.fireTex.wrapT = THREE.ClampToEdgeWrapping;
    for (let i = 0; i < FIRE_POOL; i++) this.fire.push(mk(true));
    for (let i = 0; i < SMOKE_POOL; i++) {
      const f = mk(false);
      (f.sprite.material as THREE.SpriteMaterial).map = this.smokeTex;
      this.smoke.push(f);
    }
    for (let i = 0; i < BLASTS; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      sp.visible = false;
      this.scene.add(sp);
      this.blasts.push({ sprite: sp, active: false, life: 0, maxLife: 1, size: 1, spin: 0 });
    }
    const rockTex2 = this.loadTex('dirt.jpg');
    this.rubbleMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map: rockTex2, bumpMap: rockTex2, bumpScale: 2, color: '#6d655d', roughness: 0.95, flatShading: true }),
      RUBBLE
    );
    this.rubbleMesh.count = 0;
    this.rubbleMesh.castShadow = true;
    this.rubbleMesh.receiveShadow = true;
    this.rubbleMesh.frustumCulled = false;
    this.scene.add(this.rubbleMesh);
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


  private makeSmokeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.pow(Math.random(), 0.7) * 38;
      const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
      const r = 14 + Math.random() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const al = 0.1 + Math.random() * 0.16;
      gr.addColorStop(0, `rgba(255,255,255,${al})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    const edge = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = edge;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private resetBattlefield(): void {
    this.scorch.fill(0);
    this.rubble.length = 0;
    this.rubbleMesh.count = 0;
    this.burners.length = 0;
  }

  private loadTex(path: string, rx = 1, ry = 1, srgb = true): THREE.Texture {
    const t = this.texLoader.load(import.meta.env.BASE_URL + 'tex/' + path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private setupSky(): void {
    const sunDir = new THREE.Vector3(0.74, 0.2, -0.64).normalize();
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { sunDir: { value: sunDir }, time: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3400, 32, 24), this.skyMat);
    sky.position.set(WORLD_WIDTH / 2, 0, 0);
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.skySunDir = sunDir;
  }
  private skySunDir = new THREE.Vector3();

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight('#b7c6da', '#3a4634', 1.5));

    const sun = new THREE.DirectionalLight('#ffe0b8', 3.6);
    sun.position.set(WORLD_WIDTH / 2 + 620, 620, 520);
    sun.target.position.set(WORLD_WIDTH / 2, 120, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -780;
    sun.shadow.camera.right = 780;
    sun.shadow.camera.top = 520;
    sun.shadow.camera.bottom = -380;
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 2000;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.8;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // warmes Gegenlicht von rechts hinten (Kontur auf Panzern)
    const rim = new THREE.DirectionalLight('#ffb36b', 2.2);
    rim.position.set(WORLD_WIDTH / 2 + 700, 260, -520);
    rim.target.position.set(WORLD_WIDTH / 2, 120, 0);
    this.scene.add(rim, rim.target);
    const fill = new THREE.DirectionalLight('#7e97b8', 0.7);
    fill.position.set(-600, 300, 400);
    fill.target.position.set(WORLD_WIDTH / 2, 120, 0);
    this.scene.add(fill, fill.target);
  }

  private setupStage(): void {
    // Materialien mit Foto-Texturen aus dem Konzeptbild
    const dirt = this.loadTex('dirt.jpg');
    const grass = this.loadTex('grass.jpg');
    this.faceMat = new THREE.MeshStandardMaterial({ map: dirt, bumpMap: dirt, bumpScale: 3.2, vertexColors: true, roughness: 0.96, metalness: 0 });
    this.topMat = new THREE.MeshStandardMaterial({ map: grass, bumpMap: grass, bumpScale: 2.4, vertexColors: true, roughness: 0.95, metalness: 0 });

    // Painted Backdrop: Berge, Wald und Nebel aus dem Konzeptbild
    const bd = this.loadTex('backdrop.webp');
    bd.wrapS = bd.wrapT = THREE.ClampToEdgeWrapping;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2300, 2300 * (580 / 1600)),
      new THREE.MeshBasicMaterial({ map: bd, transparent: true, depthWrite: false, fog: false, color: '#dfe5ee' })
    );
    plate.position.set(WORLD_WIDTH / 2, 40 + (2300 * (580 / 1600)) / 2, -760);
    plate.renderOrder = -5;
    this.scene.add(plate);
  }

  private setupFoliage(): void {
    const hd = TERRAIN_DEPTH / 2;
    // Grasbüschel (4 gekreuzte Halme, per Vertex-Farbe von dunkel nach hell)
    const pos: number[] = [];
    const col: number[] = [];
    const base = new THREE.Color('#0a120a');
    const mid = new THREE.Color('#223a18');
    const tip = new THREE.Color('#6d7c35');
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI + 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts: Array<[number, number, THREE.Color]> = [
        [-0.9, 0, base], [0.9, 0, base], [-0.6, 0.55, mid], [0.6, 0.55, mid], [0.12 * (b - 1.5), 1.05, tip],
      ];
      const v = (i: number) => {
        const [x, y, c] = pts[i];
        pos.push(x * ca, y, x * sa);
        col.push(c.r, c.g, c.b);
      };
      [0, 1, 2, 1, 3, 2, 2, 3, 4].forEach(v);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    bg.computeVertexNormals();
    const bm = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    const uni = this.swayUniform;
    bm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uni;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
         transformed.x += sin(uTime * 2.2 + ph) * 0.22 * position.y * position.y;
         transformed.z += cos(uTime * 1.7 + ph) * 0.12 * position.y * position.y;`
      );
    };
    this.tufts = new THREE.InstancedMesh(bg, bm, TUFTS);
    this.tufts.frustumCulled = false;
    this.tufts.receiveShadow = true;
    this.scene.add(this.tufts);
    for (let i = 0; i < TUFTS; i++) {
      // vorne dichter als hinten
      const f = Math.pow(Math.random(), 0.7);
      this.foliageSeed.push({ x: Math.random() * WORLD_WIDTH, z: -hd + 5 + f * (TERRAIN_DEPTH - 12), s: 4 + Math.random() * 6, r: Math.random() * 6.28 });
    }

    // Felsbrocken
    const rockTex = this.loadTex('dirt.jpg', 1, 1);
    this.rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map: rockTex, bumpMap: rockTex, bumpScale: 2, color: '#b9b2a8', roughness: 0.92, flatShading: true }),
      ROCKS
    );
    this.rocks.castShadow = true;
    this.rocks.receiveShadow = true;
    this.rocks.frustumCulled = false;
    this.scene.add(this.rocks);
    for (let i = 0; i < ROCKS; i++) {
      this.rockSeed.push({ x: Math.random() * WORLD_WIDTH, z: -hd + 8 + Math.random() * (TERRAIN_DEPTH - 20), s: 2.5 + Math.pow(Math.random(), 2) * 9, r: Math.random() * 6.28 });
    }

    // Tannen im Hintergrund
    const treeGeo = this.buildTreeGeometry();
    this.trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), TREES);
    this.trees.castShadow = true;
    this.trees.frustumCulled = false;
    this.scene.add(this.trees);
    for (let i = 0; i < TREES; i++) {
      this.treeSeed.push({ x: Math.random() * WORLD_WIDTH, z: -hd + 6 + Math.random() * (hd * 0.8), s: 11 + Math.random() * 14 });
    }
  }

  private buildTreeGeometry(): THREE.BufferGeometry {
    const geos: THREE.BufferGeometry[] = [];
    const paint = (g: THREE.BufferGeometry, c: THREE.Color, lo = 0.6) => {
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      const pa = g.getAttribute('position');
      for (let i = 0; i < n; i++) {
        const k = lo + (1 - lo) * Math.min(1, Math.max(0, (pa.getY(i) + 2) / 6));
        arr.set([c.r * k, c.g * k, c.b * k], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    const trunk = new THREE.CylinderGeometry(0.28, 0.4, 1.6, 6);
    trunk.translate(0, 0.8, 0);
    geos.push(paint(trunk, new THREE.Color('#3a2a1e'), 1));
    for (let i = 0; i < 4; i++) {
      const cone = new THREE.ConeGeometry(2.4 - i * 0.45, 3.2, 7);
      cone.translate(0, 2.2 + i * 1.6, 0);
      geos.push(paint(cone, new THREE.Color('#14281d'), 0.5));
    }
    // zusammenführen (nicht-indiziert)
    const P: number[] = [];
    const C: number[] = [];
    geos.forEach((g) => {
      const ng = g.toNonIndexed();
      P.push(...Array.from(ng.getAttribute('position').array as Float32Array));
      C.push(...Array.from(ng.getAttribute('color').array as Float32Array));
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    out.computeVertexNormals();
    return out;
  }

  private syncFoliage(sim: GameSimulation): void {
    const t = sim.terrain;
    const m = this.dummy;
    this.foliageSeed.forEach((f, i) => {
      const h = t.getHeight(f.x);
      m.position.set(f.x, h - 0.5, f.z);
      m.rotation.set(0, f.r, 0);
      const burnt = this.scorch[Math.max(0, Math.min(WORLD_WIDTH, Math.floor(f.x)))] > 0.4;
      m.scale.set(f.s * 0.55, f.s * (h < 14 || burnt ? 0.01 : 1), f.s * 0.55);
      m.updateMatrix();
      this.tufts.setMatrixAt(i, m.matrix);
    });
    this.tufts.instanceMatrix.needsUpdate = true;
    this.rockSeed.forEach((r, i) => {
      const h = t.getHeight(r.x);
      m.position.set(r.x, h + r.s * 0.2, r.z);
      m.rotation.set(r.r, r.r * 1.7, r.r * 0.3);
      m.scale.set(r.s, r.s * 0.65, r.s * 0.85);
      m.updateMatrix();
      this.rocks.setMatrixAt(i, m.matrix);
    });
    this.rocks.instanceMatrix.needsUpdate = true;
    this.rubble.forEach((r, i) => {
      const h = t.getHeight(r.x);
      m.position.set(r.x, h + r.s * 0.15, r.z);
      m.rotation.set(r.r, r.r * 2.1, r.r * 0.6);
      m.scale.set(r.s, r.s * 0.7, r.s * 0.9);
      m.updateMatrix();
      this.rubbleMesh.setMatrixAt(i, m.matrix);
    });
    this.rubbleMesh.count = this.rubble.length;
    this.rubbleMesh.instanceMatrix.needsUpdate = true;
    this.treeSeed.forEach((tr, i) => {
      const h = t.getHeight(tr.x);
      m.position.set(tr.x, h - 1, tr.z);
      m.rotation.set(0, tr.x, 0);
      const tb = this.scorch[Math.max(0, Math.min(WORLD_WIDTH, Math.floor(tr.x)))] > 0.35 ? 0.01 : 0.5;
      m.scale.set(tr.s * tb, tr.s * tb, tr.s * tb);
      m.updateMatrix();
      this.trees.setMatrixAt(i, m.matrix);
    });
    this.trees.instanceMatrix.needsUpdate = true;
  }

  private setupWeather(): void {
    // Regen
    const p = new Float32Array(RAIN * 6);
    for (let i = 0; i < RAIN; i++) {
      const x = -150 + Math.random() * 1300, y = Math.random() * 650, z = -200 + Math.random() * 420;
      p.set([x, y, z, x, y + 16, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#cfd9e6', transparent: true, opacity: 0.28, fog: false, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);

    // Nebelbänke im Tal
    for (let i = 0; i < MISTS; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#a9b6c2', transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
      sp.position.set(Math.random() * WORLD_WIDTH, 60 + Math.random() * 190, -130 - Math.random() * 120);
      const s = 330 + Math.random() * 320;
      sp.scale.set(s * 1.8, s * 0.55, 1);
      this.scene.add(sp);
      this.mists.push(sp);
    }
  }

  /* ----------------------------- Update ---------------------------- */

  private updateAtmosphere(wind: number, dt: number): void {
    this.elapsed += dt;
    this.swayUniform.value = this.elapsed;
    this.skyMat.uniforms.time.value = this.elapsed;
    const arr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const slant = wind * 1.8 + 40;
    for (let i = 0; i < RAIN; i++) {
      let x = arr.getX(i * 2) + slant * dt;
      let y = arr.getY(i * 2) - 620 * dt;
      if (y < -30) { y += 700; x = -150 + Math.random() * 1300; }
      if (x > 1150) x -= 1300;
      arr.setXYZ(i * 2, x, y, arr.getZ(i * 2));
      arr.setXYZ(i * 2 + 1, x + slant * 0.026, y + 16, arr.getZ(i * 2 + 1));
    }
    arr.needsUpdate = true;
    for (const m of this.mists) {
      m.position.x += (wind * 0.4 + 8) * dt;
      if (m.position.x > WORLD_WIDTH + 400) m.position.x = -400;
    }
    const mp = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      let x = mp.getX(i) + (wind * 2.6 + Math.sin(this.elapsed + i) * 6) * dt;
      const y = mp.getY(i) + Math.cos(this.elapsed * 0.7 + i * 1.3) * 5 * dt;
      if (x > WORLD_WIDTH + 40) x = -40;
      if (x < -40) x = WORLD_WIDTH + 40;
      mp.setXYZ(i, x, y, mp.getZ(i));
    }
    mp.needsUpdate = true;
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
    this.baseZ = 1060 * Math.max(1, 1.45 / this.camera.aspect);
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
    for (const c of this.scorchDirty) sim.terrain.dirtyChunks.add(c);
    this.scorchDirty.clear();
    if (sim.terrain.dirtyChunks.size === 0) return;
    for (const chunkIdx of sim.terrain.dirtyChunks) {
      const old = this.chunkMeshes.get(chunkIdx);
      if (old) {
        this.scene.remove(old);
        old.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
      }
      const g = this.buildChunkMesh(sim, chunkIdx);
      this.scene.add(g);
      this.chunkMeshes.set(chunkIdx, g);
    }
    sim.terrain.dirtyChunks.clear();
    this.syncFoliage(sim);
    for (const side of [-1, 1] as const) {
      const old = this.ext.get(side);
      if (old) {
        this.scene.remove(old);
        old.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
      }
      const g = this.buildExtension(sim, side);
      this.scene.add(g);
      this.ext.set(side, g);
    }
  }

  private buildChunkMesh(sim: GameSimulation, chunkIdx: number): THREE.Group {
    const t = sim.terrain;
    const startX = chunkIdx * CHUNK_SIZE;
    const endX = Math.min(t.width - 1, startX + CHUNK_SIZE);
    return this.buildSpan((x) => t.getHeight(x), startX, endX);
  }

  /** Spiegelt das Gelände über die Ränder hinaus und lässt es zu Talwänden ansteigen. */
  private buildExtension(sim: GameSimulation, side: -1 | 1): THREE.Group {
    const t = sim.terrain;
    const W = t.width - 1;
    const hf = (x: number) => {
      const d = side < 0 ? -x : x - W;
      const mx = side < 0 ? Math.min(W, d) : Math.max(0, W - d);
      return t.getHeight(mx) + Math.pow(Math.max(0, d - 10) / 55, 1.5) * 38;
    };
    return side < 0 ? this.buildSpan(hf, -360, 0) : this.buildSpan(hf, W, W + 360);
  }

  private buildSpan(hf: (x: number) => number, startX: number, endX: number): THREE.Group {
    const hd = TERRAIN_DEPTH / 2;
    const LIP = 14;

    const mk = () => ({ pos: [] as number[], nor: [] as number[], col: [] as number[], uv: [] as number[] });
    const top = mk();
    const face = mk();
    let burn = 1;
    const vert = (g: ReturnType<typeof mk>, x: number, y: number, z: number, n: [number, number, number], u: number, v: number, shade: number) => {
      shade *= burn;
      g.pos.push(x, y, z);
      g.nor.push(n[0], n[1], n[2]);
      g.uv.push(u, v);
      g.col.push(shade, shade, shade);
    };

    const step = 2;
    for (let x = startX; x < endX; x += step) {
      const nx = Math.min(endX, x + step);
      const h1 = hf(x);
      const h2 = hf(nx);
      const j = 0.88 + hash(x * 0.5) * 0.24;
      const sci = Math.max(0, Math.min(WORLD_WIDTH, Math.floor(x)));
      burn = 1 - 0.74 * Math.min(1, this.scorch[sci] ?? 0);
      const slope = (a: number) => {
        const dh = (hf(a + 2) - hf(a - 2)) / 4;
        const l = Math.hypot(dh, 1);
        return [-dh / l, 1 / l, 0] as [number, number, number];
      };
      const nA = slope(x);
      const nB = slope(nx);
      const S = 260; // Texturmaßstab

      // Oberfläche: breites Tal (z = -hd … +hd), nach hinten leicht abgedunkelt (Dunst)
      const zs = [-hd, -hd * 0.35, hd];
      const sh = [0.55, 0.9, 1.0];
      for (let k = 0; k < 2; k++) {
        const za = zs[k], zb = zs[k + 1];
        const sa = sh[k] * j, sb = sh[k + 1] * j;
        vert(top, x, h1, zb, nA, x / S, zb / S, sb);
        vert(top, nx, h2, zb, nB, nx / S, zb / S, sb);
        vert(top, nx, h2, za, nB, nx / S, za / S, sa);
        vert(top, x, h1, zb, nA, x / S, zb / S, sb);
        vert(top, nx, h2, za, nB, nx / S, za / S, sa);
        vert(top, x, h1, za, nA, x / S, za / S, sa);
      }

      // Grasnarbe an der Vorderkante (Teil des Gras-Meshes)
      const nF: [number, number, number] = [0, 0, 1];
      const l1 = h1 - LIP, l2 = h2 - LIP;
      vert(top, x, l1, hd, nF, x / S, 0.0, 0.5 * j);
      vert(top, nx, l2, hd, nF, nx / S, 0.0, 0.5 * j);
      vert(top, nx, h2, hd, nF, nx / S, 0.1, 0.95 * j);
      vert(top, x, l1, hd, nF, x / S, 0.0, 0.5 * j);
      vert(top, nx, h2, hd, nF, nx / S, 0.1, 0.95 * j);
      vert(top, x, h1, hd, nF, x / S, 0.1, 0.95 * j);

      // Erd-/Felsschnitt vorne, nach unten ins Dunkel
      const lv1 = [l1, l1 * 0.5, 0, -420];
      const lv2 = [l2, l2 * 0.5, 0, -420];
      const sd = [0.95, 0.8, 0.55, 0.08];
      const D = 320;
      for (let r = 0; r < 3; r++) {
        const sa = sd[r] * j, sb = sd[r + 1] * j;
        vert(face, x, lv1[r + 1], hd, nF, x / D, lv1[r + 1] / D, sb);
        vert(face, nx, lv2[r + 1], hd, nF, nx / D, lv2[r + 1] / D, sb);
        vert(face, nx, lv2[r], hd, nF, nx / D, lv2[r] / D, sa);
        vert(face, x, lv1[r + 1], hd, nF, x / D, lv1[r + 1] / D, sb);
        vert(face, nx, lv2[r], hd, nF, nx / D, lv2[r] / D, sa);
        vert(face, x, lv1[r], hd, nF, x / D, lv1[r] / D, sa);
      }
    }

    const group = new THREE.Group();
    const build = (g: ReturnType<typeof mk>, mat: THREE.Material) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    build(top, this.topMat);
    build(face, this.faceMat);
    return group;
  }

  /* ----------------------------- Panzer ---------------------------- */

  private tankImgRequested = false;
  private models: Array<{ body: THREE.BufferGeometry; barrel: THREE.BufferGeometry; img: HTMLImageElement | null } | null> = [null, null];
  private tankTex = new Map<string, THREE.CanvasTexture>();
  private shadowTex: THREE.CanvasTexture | null = null;

  /** Panzer-OBJ laden und das Rohr als eigenes Teil abtrennen (dreht um die Mantelwurzel). */
  private loadTankModels(): void {
    const base = import.meta.env.BASE_URL + 'models/';
    ['tankA', 'tankB'].forEach((name, idx) => {
      new OBJLoader().load(base + name + '.obj', (obj) => {
        let mesh: THREE.Mesh | null = null;
        obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && !mesh) mesh = o as THREE.Mesh; });
        if (!mesh) return;
        const g = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry;
        const pos = g.getAttribute('position'), uv = g.getAttribute('uv'), nor = g.getAttribute('normal');
        const bp: number[] = [], bu: number[] = [], bn: number[] = [];
        const rp: number[] = [], ru: number[] = [], rn: number[] = [];
        const isB = (i: number) => pos.getX(i) < -0.56 && Math.abs(pos.getZ(i)) < 0.065 && pos.getY(i) > -0.03;
        for (let i = 0; i < pos.count; i += 3) {
          const barrel = isB(i) && isB(i + 1) && isB(i + 2);
          const P = barrel ? rp : bp, U = barrel ? ru : bu, N = barrel ? rn : bn;
          for (let k = 0; k < 3; k++) {
            P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
            U.push(uv.getX(i + k), uv.getY(i + k));
            N.push(nor ? nor.getX(i + k) : 0, nor ? nor.getY(i + k) : 1, nor ? nor.getZ(i + k) : 0);
          }
        }
        const mk = (P: number[], U: number[], N: number[]) => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
          return geo;
        };
        const body = mk(bp, bu, bn);
        body.translate(0, 0.388, 0);
        const barrel = mk(rp, ru, rn);
        barrel.translate(0.54, -0.025, 0); // Drehpunkt = Mantelwurzel
        barrel.rotateY(Math.PI); // Rohr zeigt nach +x
        const img = new Image();
        img.onload = () => { this.models[idx]!.img = img; };
        img.src = base + name + '.jpg';
        this.models[idx] = { body, barrel, img: null };
      });
    });
  }

  /** Lack pro Team umfärben (rote Flächen -> Teamfarbe). */
  private teamTexture(colorHex: string, variant: number): THREE.CanvasTexture | null {
    const m = this.models[variant];
    if (!m || !m.img) return null;
    const key = colorHex + variant;
    const cached = this.tankTex.get(key);
    if (cached) return cached;
    const img = m.img;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    if (colorHex.toLowerCase() !== '#ff4d4d') {
      const data = g.getImageData(0, 0, c.width, c.height);
      const d = data.data;
      const hsl = { h: 0, s: 0, l: 0 };
      new THREE.Color(colorHex).getHSL(hsl);
      const desat = hsl.s < 0.2;
      const q = new THREE.Color();
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (sat < 0.3 || r < gg * 1.25 || r < b * 1.2) continue;
        q.setHSL(hsl.h, desat ? 0.05 : Math.min(1, hsl.s * 0.7), Math.min(0.8, mx * (desat ? 0.95 : 0.6)));
        const k = Math.min(1, (sat - 0.3) * 4);
        d[i] = (d[i] * (1 - k) + q.r * 255 * k) | 0;
        d[i + 1] = (d[i + 1] * (1 - k) + q.g * 255 * k) | 0;
        d[i + 2] = (d[i + 2] * (1 - k) + q.b * 255 * k) | 0;
      }
      g.putImageData(data, 0, 0);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    this.tankTex.set(key, t);
    return t;
  }

  private ensureTankTex(vis: TankVisual): void {
    if (vis.meshed) return;
    const m = this.models[vis.variant];
    const tex = this.teamTexture(vis.colorHex, vis.variant);
    if (!m || !tex) return;
    vis.spriteMat.map = tex;
    vis.spriteMat.needsUpdate = true;
    vis.bodyMat.map = tex;
    vis.bodyMat.needsUpdate = true;
    const hull = new THREE.Mesh(m.body, vis.spriteMat);
    hull.scale.setScalar(MS);
    hull.castShadow = true;
    hull.receiveShadow = true;
    vis.body.add(hull);
    const br = new THREE.Mesh(m.barrel, vis.bodyMat);
    br.scale.setScalar(MS);
    br.castShadow = true;
    vis.barrel.add(br);
    vis.meshed = true;
    vis.texReady = true;
  }

  private createTankVisual(colorHex: string, id = ''): TankVisual {
    if (!this.tankImgRequested) {
      this.tankImgRequested = true;
      this.loadTankModels();
    }
    let h = 0;
    for (let i = 0; i < id.length; i++) h += id.charCodeAt(i);
    const variant = h % 2;
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const mkMat = () => new THREE.MeshStandardMaterial({ color: '#d9d9d9', roughness: 0.6, metalness: 0.25, envMapIntensity: 0.8 });
    const spriteMat = mkMat();
    const barrelMat = mkMat();

    if (!this.shadowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,0.7)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      this.shadowTex = new THREE.CanvasTexture(c);
    }
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, fog: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.8, 0);
    group.add(shadow);

    const gun = new THREE.Group();
    group.add(gun);
    const barrel = new THREE.Group();
    gun.add(barrel);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.25, 1.1, 1.7), transparent: true, opacity: 0.22, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      })
    );
    shield.position.y = 20;
    shield.visible = false;
    group.add(shield);

    group.scale.setScalar(TANK_SCALE);
    return { group, gun, barrel, shield, tilt: 0, recoil: 0, smokeT: 0, bodyMat: barrelMat, body, yaw: 0, baseColor: barrelMat.color.clone(), dead: false, wreckTilt: 0, sprite: body, spriteMat, colorHex, texReady: false, flip: 1, variant, meshed: false };
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
        vis = this.createTankVisual(tank.color, tank.id);
        this.scene.add(vis.group);
        this.tankVisuals.set(tank.id, vis);
      }
      

      const t = sim.terrain;
      this.ensureTankTex(vis);
      if (!tank.alive) {
        // brennendes Wrack bleibt liegen
        if (!vis.dead) {
          vis.dead = true;
          vis.wreckTilt = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.3);
          vis.bodyMat.color.set('#2a2623');
          vis.spriteMat.color.set('#2a2623');
          vis.shield.visible = false;
          this.burners.push({ x: tank.x, z: 0, t: 0, dur: 30, acc: 0, kind: 'flame', size: 9 }, { x: tank.x, z: 0, t: 0, dur: 30, acc: 0, kind: 'smoke', size: 12 });
        }
        vis.group.visible = true;
        const gy = t.getHeight(tank.x);
        const sl = Math.atan2(t.getHeight(tank.x + 9) - t.getHeight(tank.x - 9), 18);
        vis.group.position.set(tank.x, gy - 1.5, 0);
        vis.group.rotation.z += (sl + vis.wreckTilt - vis.group.rotation.z) * Math.min(1, dt * 3);
        vis.gun.rotation.z += ((tank.angle > 90 ? 0.35 : 2.8) - vis.gun.rotation.z) * Math.min(1, dt * 1.5);
        continue;
      }
      if (vis.dead) {
        vis.dead = false;
        vis.bodyMat.color.copy(vis.baseColor);
        vis.spriteMat.color.set('#d9d9d9');
      }
      vis.group.visible = true;
      const slope = Math.atan2(t.getHeight(tank.x + 9) - t.getHeight(tank.x - 9), 18);
      vis.tilt += (slope - vis.tilt) * Math.min(1, dt * 8);
      vis.group.position.set(tank.x, tank.y, 0);
      vis.group.rotation.z = vis.tilt;
      vis.gun.rotation.z = (tank.angle * Math.PI) / 180 - vis.tilt;
      vis.flip = tank.angle <= 90 ? 1 : -1;
      const aY = vis.flip > 0 ? Math.PI - YAW : YAW;
      vis.yaw += (aY - vis.yaw) * Math.min(1, dt * 7);
      vis.body.rotation.y = vis.yaw;
      vis.gun.position.set(-0.54 * MS * Math.cos(vis.yaw), PIVOT_Y, 0.54 * MS * Math.sin(vis.yaw));
      vis.recoil = Math.max(0, vis.recoil - dt * 4);
      vis.barrel.position.x = -vis.recoil * 4;

      vis.shield.visible = tank.shield > 0;
      if (vis.shield.visible) {
        (vis.shield.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(this.elapsed * 4) * 0.05 + (tank.shield / 100) * 0.1;
      }

      if (tank.hp < 40) {
        vis.smokeT -= dt;
        if (vis.smokeT <= 0) {
          vis.smokeT = tank.hp < 20 ? 0.05 : 0.11;
          this.emitSmoke(tank.x - 4, tank.y + 28, 0, (Math.random() - 0.5) * 10, 28 + Math.random() * 14, (Math.random() - 0.5) * 6, 1.1, 7, 18, '#2c2c30', 0.7);
          if (tank.hp < 20) this.emitFire(tank.x - 4, tank.y + 25, 0, (Math.random() - 0.5) * 6, 18, 0, 0.35, 8, 3, '#ff9a3a', '#ff3a10', 0.9);
        }
      }
    }

    for (const id of this.kickQueue) {
      const tank = sim.tanks.find((x) => x.id === id);
      const vis = this.tankVisuals.get(id);
      if (!tank || !vis) continue;
      vis.recoil = 1;
      const a = (tank.angle * Math.PI) / 180;
      const tx = tank.x + (tank.angle <= 90 ? PIVOT_X : -PIVOT_X) + Math.cos(a) * BARREL_LEN;
      const ty = tank.y + PIVOT_Y + Math.sin(a) * BARREL_LEN;
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

  private emitSpark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    this.emit(this.fire, x, y, z, vx, vy, vz, life, size, size * 0.3, '#fff0b0', '#ff4a12', 1, 0.25, -560);
  }

  public spawnExplosion(ev: ExplosionEvent): void {
    const R = ev.radius;
    const big = R > 70;
    const dirt = ev.isDirt;
    this.shakeIntensity = Math.min(34, this.shakeIntensity + R * (big ? 0.5 : 0.3));
    this.flashLevel = Math.max(this.flashLevel, Math.min(4, R / 22));
    this.screenFlash = Math.max(this.screenFlash, big ? 1 : R / 80);
    this.flashLight.position.set(ev.x, ev.y + 14, 60);
    this.flashLight.color.set(dirt ? '#c9a070' : '#ff8a3a');

    // Brandspuren, Geröll, Dauerfeuer
    if (!dirt) {
      const lo = Math.max(0, Math.floor(ev.x - R * 1.5));
      const hi = Math.min(WORLD_WIDTH, Math.ceil(ev.x + R * 1.5));
      for (let x = lo; x <= hi; x++) {
        const f = 1 - Math.abs(x - ev.x) / (R * 1.5);
        this.scorch[x] = Math.min(1, this.scorch[x] + f * (big ? 1.1 : 0.75));
        this.scorchDirty.add(Math.floor(x / CHUNK_SIZE));
      }
      const nr = Math.floor(R * 0.55) + 4;
      for (let i = 0; i < nr; i++) {
        this.rubble.push({ x: ev.x + (Math.random() - 0.5) * R * 2.4, z: (Math.random() - 0.5) * 120, s: 1.8 + Math.pow(Math.random(), 2.2) * (R * 0.16 + 3), r: Math.random() * 6.28 });
      }
      while (this.rubble.length > RUBBLE) this.rubble.shift();
      const nb = big ? 7 : Math.min(5, 1 + Math.floor(R / 22));
      for (let i = 0; i < nb; i++) {
        this.burners.push({ x: ev.x + (Math.random() - 0.5) * R * 1.6, z: (Math.random() - 0.5) * 60, t: 0, dur: 5 + Math.random() * (big ? 14 : 8), acc: 0, kind: 'flame', size: 5 + R * 0.12 });
      }
      this.burners.push({ x: ev.x, z: 0, t: 0, dur: big ? 14 : 4 + R / 14, acc: 0, kind: 'smoke', size: R * 0.5 });
      if (this.burners.length > 60) this.burners.splice(0, this.burners.length - 60);
    }

    // Druckwelle
    this.emit(this.rings, ev.x, ev.y, 8, 0, 0, 0, big ? 1 : 0.55, R * 0.6, R * (big ? 5.5 : 3.4), dirt ? '#d8b88a' : '#ffd9a0', null, 0.8, 0, 0);

    if (!dirt) {
      // Fotorealistischer Feuerball (aus dem Konzeptbild) + Hitzeschleier
      const nBlast = big ? 3 : 1 + (R > 36 ? 1 : 0);
      for (let i = 0; i < nBlast; i++) {
        const b = this.blasts.find((q) => !q.active);
        if (!b) break;
        b.active = true;
        b.sprite.visible = true;
        b.sprite.position.set(ev.x + (i ? (Math.random() - 0.5) * R : 0), ev.y + 6 + (i ? Math.random() * R * 0.5 : 0), 22 + i * 5);
        b.life = b.maxLife = 0.75 + Math.random() * 0.35 + (big ? 0.5 : 0);
        b.size = R * (i ? 3.0 : 4.2) * (big ? 1.2 : 1);
        b.spin = (Math.random() - 0.5) * 0.9;
        b.sprite.material.rotation = Math.random() * 6.28;
      }
      this.emitFire(ev.x, ev.y + 4, 14, 0, 0, 0, 0.3, R * 3.0, R * 4.2, '#ffd9a0', '#ff9a40', 0.55);
      const n = Math.min(60, Math.floor(R * 0.9) + 10);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (0.2 + Math.random() * 0.9) * R * 2.6;
        this.emitFire(
          ev.x + Math.cos(a) * R * 0.2, ev.y + Math.sin(a) * R * 0.2, (Math.random() - 0.5) * 40,
          Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 50, (Math.random() - 0.5) * sp * 0.4,
          0.5 + Math.random() * 0.8, R * (0.45 + Math.random() * 0.5), R * 0.12, '#ffe9a0', Math.random() < 0.5 ? '#ff4a14' : '#b8200a', 0.9
        );
      }
      // Funkenregen
      const ns = Math.min(110, Math.floor(R * 1.6) + 20);
      for (let i = 0; i < ns; i++) {
        const a = Math.random() * Math.PI;
        const sp = (0.3 + Math.random() * 1.1) * R * 4.6;
        this.emitSpark(ev.x, ev.y + 4, (Math.random() - 0.5) * 30, Math.cos(a) * sp * (Math.random() < 0.5 ? 1 : -1), Math.sin(a) * sp + 80, (Math.random() - 0.5) * sp * 0.4, 0.6 + Math.random() * 1.2, 1.4 + Math.random() * 2.2);
      }
    }

    // dunkler Rauch (schwere, langsam aufsteigende Wolken)
    const sn = Math.min(70, Math.floor(R * 0.9) + 8);
    for (let i = 0; i < sn; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.1 + Math.random() * 0.6) * R * 1.6;
      this.emitSmoke(
        ev.x + Math.cos(a) * R * 0.3, ev.y + Math.sin(a) * R * 0.3, (Math.random() - 0.5) * 50,
        Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp * 0.7 + 30, (Math.random() - 0.5) * 24,
        2.2 + Math.random() * (big ? 6 : 3.6), R * 0.7, R * (big ? 2.6 : 1.9),
        dirt ? '#7a6248' : Math.random() < 0.6 ? '#232326' : '#45423f', dirt ? 0.8 : 0.85
      );
    }

    // Trümmer: große Felsbrocken und Erdklumpen, anfangs glühend
    const dn = Math.min(90, Math.floor(R * 1.3));
    let k = 0;
    for (let i = 0; i < MAX_DEBRIS && k < dn; i++) {
      const d = this.debris[i];
      if (d.active) continue;
      d.active = true;
      d.x = ev.x; d.y = ev.y; d.z = (Math.random() - 0.5) * 40;
      const a = Math.random() * Math.PI;
      const sp = (0.35 + Math.random() * 0.9) * R * 4.6;
      d.vx = Math.cos(a) * sp * (Math.random() < 0.5 ? 1 : -1);
      d.vy = Math.sin(a) * sp + 90;
      d.vz = (Math.random() - 0.5) * sp * 0.7;
      d.life = 1.2 + Math.random() * 1.4;
      d.s = (dirt ? 1.8 : 1.4) + Math.pow(Math.random(), 2) * (R * 0.18 + 2);
      d.rx = Math.random() * 12; d.ry = Math.random() * 12;
      d.color.set(Math.random() < 0.5 ? '#6e5338' : Math.random() < 0.5 ? '#4a4a4a' : '#7b6a55');
      this.debrisMesh.setColorAt(i, d.color);
      k++;
    }
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    for (const b of this.blasts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.sprite.visible = false; continue; }
      const t = 1 - b.life / b.maxLife;
      const sz = b.size * (0.35 + 0.75 * Math.sqrt(t));
      b.sprite.scale.set(sz, sz * 0.86, 1);
      b.sprite.material.rotation += b.spin * dt;
      b.sprite.material.opacity = Math.min(1, (1 - t) * 1.6) * Math.min(1, t * 14);
    }
    const th = this.terrainRef;
    for (let i = this.burners.length - 1; i >= 0; i--) {
      const br = this.burners[i];
      br.t += dt;
      if (br.t > br.dur) { this.burners.splice(i, 1); continue; }
      const fade = 1 - br.t / br.dur;
      const gy = th ? th.getHeight(br.x) : 0;
      br.acc += dt * (br.kind === 'flame' ? 16 : 7) * (0.35 + fade);
      while (br.acc >= 1) {
        br.acc -= 1;
        if (br.kind === 'flame') {
          this.emitFire(br.x + (Math.random() - 0.5) * 10, gy + 2, br.z + (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8 + this.windDrift, 26 + Math.random() * 30, 0, 0.4 + Math.random() * 0.4, br.size * (0.8 + Math.random() * 0.8) * (0.5 + fade * 0.5), br.size * 0.2, '#ffcf60', '#ff3a0c', 0.85);
        } else {
          this.emitSmoke(br.x + (Math.random() - 0.5) * 12, gy + 8, br.z + (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8 + this.windDrift, 34 + Math.random() * 20, 0, 2.6 + Math.random() * 2.2, br.size * 0.7, br.size * 2.6, '#2a2a2d', 0.55 * (0.4 + fade * 0.6));
        }
      }
    }
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
          m.color.multiplyScalar(1.25 * (1 - t));
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
      // glühend -> erkaltet
      if (d.life > 0.7) { /* frisch */ }
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
    if (this.lastTerrain !== sim.terrain || this.lastRound !== sim.round) {
      this.lastTerrain = sim.terrain;
      this.lastRound = sim.round;
      this.resetBattlefield();
      sim.terrain.markAllDirty();
    }
    this.terrainRef = sim.terrain;
    this.windDrift = sim.wind * 0.5;
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
    const bob = Math.sin(this.elapsed * 0.35) * 1.8;
    const sway = Math.sin(this.elapsed * 0.21) * 14;
    this.camera.position.set(this.camX + sway - 95, 440 + bob - this.camZoom * 40, z);
    this.camera.lookAt(this.camX * 0.92 + cx * 0.08 - 60, 175 - this.camZoom * 30, 0);
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
