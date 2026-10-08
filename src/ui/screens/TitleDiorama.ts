// Title-screen backdrop: a painted lake plate with living water (pixi-filters Reflection used
// as a wave distortion below the shoreline), soft godrays and a slow camera drift. Only exists
// while the title is mounted; the game creates its own Pixi app later.
import { Application, Assets, Container, Sprite, type Texture } from 'pixi.js';
import { GodrayFilter } from 'pixi-filters/godray';
import { ReflectionFilter } from 'pixi-filters/reflection';
import { destroyPixiApp } from '../../render/teardown';

/** Where the water starts in the plate art (fraction of image height). */
const SHORELINE = 0.42;

export class TitleDiorama {
  private app = new Application();
  private alive = true;
  private inited = false;
  private world: Container | null = null;

  async start(host: HTMLElement, plateUrl: string | null, still: boolean) {
    await this.app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.inited = true;
    if (!this.alive) return this.teardown();
    host.appendChild(this.app.canvas);
    if (!plateUrl) return;
    const tex = await Assets.load<Texture>(plateUrl).catch(() => null);
    if (!this.alive || !tex) return;

    const world = new Container();
    this.world = world;
    const plate = new Sprite(tex);
    plate.anchor.set(0.5);
    world.addChild(plate);
    this.app.stage.addChild(world);

    // Filter passes at 1x even on 2x/3x screens: the painted art is soft enough not to show it,
    // and it halves (or better) the fill cost on phones. Lower than 1x visibly pixelates.
    const fres = 1;
    const water = new ReflectionFilter({ mirror: false, boundary: SHORELINE, amplitude: [0, 3.2], waveLength: [26, 90], alpha: [1, 1] });
    const rays = new GodrayFilter({ angle: 28, gain: 0.42, lacunarity: 2.6, parallel: true, alpha: 0.35 });
    water.resolution = fres;
    rays.resolution = fres;
    world.filters = [water, rays];

    let t = 0;
    const layout = () => {
      const { width: w, height: h } = this.app.screen;
      const cover = Math.max(w / tex.width, h / tex.height) * 1.08;
      const drift = still ? 0 : Math.sin(t * 0.02) * 0.02;
      plate.scale.set(cover * (1 + drift));
      plate.position.set(w / 2 + Math.sin(t * 0.013) * w * 0.01, h / 2);
      // Keep the wave boundary on the art's shoreline whatever the crop.
      water.boundary = Math.min(0.95, Math.max(0.05, (plate.y - plate.height / 2 + plate.height * SHORELINE) / h));
    };
    layout();
    this.app.renderer.on('resize', layout);
    if (still) return;
    this.app.ticker.add((tk) => {
      t += tk.deltaMS / 1000;
      water.time = t * 0.6;
      rays.time = t * 0.08;
      layout();
    });
  }

  destroy() {
    this.alive = false;
    if (this.inited) this.teardown();
  }

  private teardown() {
    if (this.world) {
      for (const f of this.world.filters ?? []) f.destroy();
      this.world.filters = null;
    }
    // Keeps textures: the plate is shared with the in-game cast view via Pixi's Assets cache.
    destroyPixiApp(this.app);
  }
}
