import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  CHUNK_SIZE,
  ExplosionEvent,
  GameSimulation,
  Tank,
  WEAPONS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '@tankwars/shared';

interface TankVisual {
  group: THREE.Group;
  turret: THREE.Group;
  barrel: THREE.Mesh;
  shield: THREE.Mesh;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

interface Cloud {
  group: THREE.Group;
  speedFactor: number;
  bobOffset: number;
  baseY: number;
}

const TERRAIN_DEPTH = 90;
const MAX_PARTICLES = 600;

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    focusPos: { value: 0.46 },
    focusWidth: { value: 0.22 },
    blurAmount: { value: 0.0038 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float focusPos;
    uniform float focusWidth;
    uniform float blurAmount;
    varying vec2 vUv;

    void main() {
      float dist = abs(vUv.y - focusPos);
      float blur = smoothstep(focusWidth, focusWidth + 0.35, dist) * blurAmount;

      if (blur < 0.0002) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec4 sum = vec4(0.0);
      sum += texture2D(tDiffuse, vUv + vec2(-blur, -blur)) * 0.09;
      sum += texture2D(tDiffuse, vUv + vec2(0.0,   -blur)) * 0.12;
      sum += texture2D(tDiffuse, vUv + vec2( blur, -blur)) * 0.09;
      sum += texture2D(tDiffuse, vUv + vec2(-blur,  0.0 )) * 0.12;
      sum += texture2D(tDiffuse, vUv)                      * 0.16;
      sum += texture2D(tDiffuse, vUv + vec2( blur,  0.0 )) * 0.12;
      sum += texture2D(tDiffuse, vUv + vec2(-blur,  blur)) * 0.09;
      sum += texture2D(tDiffuse, vUv + vec2(0.0,    blur)) * 0.12;
      sum += texture2D(tDiffuse, vUv + vec2( blur,  blur)) * 0.09;

      gl_FragColor = sum;
    }
  `,
};

export class DioramaRenderer {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private chunkMeshes = new Map<number, THREE.Mesh>();
  private terrainMat: THREE.MeshStandardMaterial;

  private tankVisuals = new Map<string, TankVisual>();
  private projMeshes = new Map<string, THREE.Mesh>();
  private projGeo = new THREE.SphereGeometry(4.5, 10, 10);

  private clouds: Cloud[] = [];
  private elapsed = 0;

  private particleMesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private dummy = new THREE.Object3D();

  private shakeIntensity = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8ec5fc');
    this.scene.fog = new THREE.Fog('#c2e0ff', 780, 1850);

    this.camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 10, 3000);
    this.resetCamera();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.75,
      0.45,
      0.92
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new ShaderPass(TiltShiftShader));
    this.composer.addPass(new OutputPass());

    this.setupLights();
    this.setupDioramaBase();
    this.setupClouds();

    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.05,
      flatShading: true,
    });

    const pGeo = new THREE.DodecahedronGeometry(1, 0);
    const pMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.particleMesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0, y: -999, z: 0,
        vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, scale: 1,
        color: new THREE.Color('#ffaa00'),
      });
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.resize();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight('#fff5e6', '#3d5a80', 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(WORLD_WIDTH * 0.65, 720, 420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -600;
    sun.shadow.camera.right = 600;
    sun.shadow.camera.top = 450;
    sun.shadow.camera.bottom = -200;
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 1600;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
  }

  private setupDioramaBase(): void {
    const baseGeo = new THREE.BoxGeometry(WORLD_WIDTH + 36, 36, TERRAIN_DEPTH + 36);
    const baseMat = new THREE.MeshStandardMaterial({ color: '#4a3525', roughness: 0.75 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(WORLD_WIDTH / 2, -16, 0);
    base.receiveShadow = true;
    this.scene.add(base);
  }

  private setupClouds(): void {
    const cloudMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.92,
      metalness: 0.0,
      flatShading: true,
    });
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);

    for (let i = 0; i < 7; i++) {
      const group = new THREE.Group();
      const puffCount = 3 + (i % 3);

      for (let p = 0; p < puffCount; p++) {
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        const radius = 16 + Math.random() * 14;
        puff.scale.set(radius * 1.35, radius * 0.85, radius);
        puff.position.set(
          (p - (puffCount - 1) / 2) * 22,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        );
        group.add(puff);
      }

      const baseY = 390 + Math.random() * 150;
      group.position.set(
        (i / 7) * (WORLD_WIDTH + 240) - 120,
        baseY,
        -110 - Math.random() * 140
      );

      this.scene.add(group);
      this.clouds.push({
        group,
        speedFactor: 0.55 + Math.random() * 0.65,
        bobOffset: Math.random() * Math.PI * 2,
        baseY,
      });
    }
  }

  private updateClouds(wind: number, dt: number): void {
    this.elapsed += dt;
    const baseDrift = wind === 0 ? 6 : wind * 0.85;

    for (const c of this.clouds) {
      c.group.position.x += baseDrift * c.speedFactor * dt;
      c.group.position.y = c.baseY + Math.sin(this.elapsed * 0.9 + c.bobOffset) * 4.5;

      if (c.group.position.x > WORLD_WIDTH + 180) c.group.position.x = -180;
      if (c.group.position.x < -180) c.group.position.x = WORLD_WIDTH + 180;
    }
  }

  private resetCamera(): void {
    this.camera.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT * 0.48, 860);
    this.camera.lookAt(WORLD_WIDTH / 2, WORLD_HEIGHT * 0.32, 0);
  }

  public resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 2);

    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);

    this.camera.aspect = w / h;
    const aspectBoost = Math.max(1, 1.35 / this.camera.aspect);
    this.camera.position.z = 820 * aspectBoost;
    this.camera.updateProjectionMatrix();
  }

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
    const startX = chunkIdx * CHUNK_SIZE;
    const endX = Math.min(sim.terrain.width - 1, startX + CHUNK_SIZE);
    const halfD = TERRAIN_DEPTH / 2;

    const positions: number[] = [];
    const colors: number[] = [];

    const grass = new THREE.Color('#5da130');
    const dirt = new THREE.Color('#8c5e3c');
    const rock = new THREE.Color('#57524e');

    const pushTri = (
      ax: number, ay: number, az: number, ca: THREE.Color,
      bx: number, by: number, bz: number, cb: THREE.Color,
      cx: number, cy: number, cz: number, cc: THREE.Color
    ) => {
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    };

    const step = 2;
    for (let x = startX; x < endX; x += step) {
      const nx = Math.min(endX, x + step);
      const h1 = sim.terrain.getHeight(x);
      const h2 = sim.terrain.getHeight(nx);

      pushTri(x, 0, halfD, rock, nx, 0, halfD, rock, nx, h2, halfD, dirt);
      pushTri(x, 0, halfD, rock, nx, h2, halfD, dirt, x, h1, halfD, dirt);

      pushTri(x, h1, halfD, grass, nx, h2, halfD, grass, nx, h2, -halfD, grass);
      pushTri(x, h1, halfD, grass, nx, h2, -halfD, grass, x, h1, -halfD, grass);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private syncTanks(tanks: Tank[]): void {
    for (const tank of tanks) {
      let vis = this.tankVisuals.get(tank.id);
      if (!vis) {
        vis = this.createTankVisual(tank.color);
        this.scene.add(vis.group);
        this.tankVisuals.set(tank.id, vis);
      }

      vis.group.visible = tank.alive;
      if (!tank.alive) continue;

      vis.group.position.set(tank.x, tank.y, 0);
      vis.barrel.rotation.z = (tank.angle * Math.PI) / 180;
      vis.shield.visible = tank.shield > 0;
    }
  }

  private createTankVisual(colorHex: string): TankVisual {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.25 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.8 });

    const tracks = new THREE.Mesh(new THREE.BoxGeometry(24, 6, 16), darkMat);
    tracks.position.y = 3;
    tracks.castShadow = true;
    group.add(tracks);

    const hull = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 13), bodyMat);
    hull.position.y = 8;
    hull.castShadow = true;
    group.add(hull);

    const turret = new THREE.Group();
    turret.position.y = 12;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 5, 10), bodyMat);
    dome.castShadow = true;
    turret.add(dome);

    const barrelGeo = new THREE.CylinderGeometry(1.4, 1.8, 16, 8);
    barrelGeo.rotateZ(-Math.PI / 2);
    barrelGeo.translate(8, 0, 0);
    const barrel = new THREE.Mesh(barrelGeo, darkMat);
    barrel.castShadow = true;
    turret.add(barrel);
    group.add(turret);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(18, 16, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.3, 1.4, 1.8),
        transparent: true,
        opacity: 0.32,
        toneMapped: false,
      })
    );
    shield.position.y = 8;
    shield.visible = false;
    group.add(shield);

    return { group, turret, barrel, shield };
  }

  public spawnExplosion(ev: ExplosionEvent): void {
    this.shakeIntensity = Math.min(18, this.shakeIntensity + ev.radius * 0.22);
    const count = Math.min(85, Math.floor(ev.radius * 1.5));

    let spawned = 0;
    for (const p of this.particles) {
      if (p.active) continue;
      p.active = true;
      p.x = ev.x;
      p.y = ev.y + 4;
      p.z = (Math.random() - 0.5) * 24;

      const angle = Math.random() * Math.PI * 2;
      const speed = (0.3 + Math.random() * 0.9) * ev.radius * 3.8;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed + 65;
      p.vz = (Math.random() - 0.5) * speed * 0.6;

      p.maxLife = 0.45 + Math.random() * 0.55;
      p.life = p.maxLife;
      p.scale = ev.isDirt ? 3 + Math.random() * 4 : 4 + Math.random() * 7;

      if (ev.isDirt) {
        p.color.set('#8c5e3c');
      } else {
        const roll = Math.random();
        if (roll < 0.35) {
          p.color.setRGB(3.2, 2.8, 1.2);
        } else if (roll < 0.75) {
          p.color.setRGB(2.8, 1.1, 0.15);
        } else {
          p.color.set('#3d3d42');
        }
      }

      if (++spawned >= count) break;
    }
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      p.vy -= 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const ratio = p.life / p.maxLife;
      const s = p.scale * ratio;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.set(s, s, s);
      this.dummy.rotation.set(p.life * 4, p.life * 3, 0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      this.particleMesh.setColorAt(i, p.color);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  public render(sim: GameSimulation, dt: number): void {
    this.syncTerrain(sim);
    this.syncTanks(sim.tanks);
    this.updateClouds(sim.wind, dt);

    const activeIds = new Set(sim.projectiles.map((p) => p.id));
    for (const [id, mesh] of this.projMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.projMeshes.delete(id);
      }
    }
    for (const proj of sim.projectiles) {
      let mesh = this.projMeshes.get(proj.id);
      if (!mesh) {
        const glowColor = new THREE.Color(WEAPONS[proj.weaponId].color).multiplyScalar(2.4);
        const mat = new THREE.MeshBasicMaterial({ color: glowColor, toneMapped: false });
        mesh = new THREE.Mesh(this.projGeo, mat);
        this.scene.add(mesh);
        this.projMeshes.set(proj.id, mesh);
      }
      mesh.position.set(proj.x, proj.y, 0);
    }

    this.resetCamera();
    if (this.shakeIntensity > 0.2) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.05, dt);
    }

    this.updateParticles(dt);
    this.composer.render();
  }
}
