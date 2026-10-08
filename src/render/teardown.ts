import type { Application } from 'pixi.js';

/**
 * Tear down a Pixi app without "[BindGroup] ... destroyed while still bound" warnings. Pixi's filter
 * system keeps the last filter input (a pooled, screen-sized render texture) bound in its global bind
 * group; destroying the renderer frees that texture first and logs the warning. Drop the binding,
 * then destroy. Textures stay alive: generated art lives in Pixi's Assets cache and is reused by the
 * next screen (callers destroy their own canvas-painted textures).
 */
export function destroyPixiApp(app: Application) {
  app.ticker?.stop();
  (app.renderer?.filter as unknown as { _globalFilterBindGroup?: { destroy(): void } } | undefined)?._globalFilterBindGroup?.destroy();
  app.destroy(true, { children: true, texture: false });
}
