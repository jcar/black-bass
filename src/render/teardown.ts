import type { Application } from 'pixi.js';

/**
 * Tear down a Pixi app without "[BindGroup] ... destroyed while still bound" warnings. Pixi's filter
 * system keeps the last filter input (a pooled, screen-sized render texture) bound in its global bind
 * group; destroying the renderer frees that texture first and logs the warning. Drop the binding,
 * then destroy. Textures stay alive: generated art lives in Pixi's Assets cache and is reused by the
 * next screen (callers destroy their own canvas-painted textures).
 */
const torn = new WeakSet<Application>();

export function destroyPixiApp(app: Application) {
  // Idempotent: Pixi nulls the renderer on destroy, so a second teardown (a screen unmounting while its
  // async init settles) used to throw "Cannot read properties of null (reading 'destroy')".
  if (!app.renderer || torn.has(app)) return;
  torn.add(app);
  app.ticker?.stop();
  (app.renderer?.filter as unknown as { _globalFilterBindGroup?: { destroy(): void } } | undefined)?._globalFilterBindGroup?.destroy();
  app.destroy(true, { children: true, texture: false });
}
