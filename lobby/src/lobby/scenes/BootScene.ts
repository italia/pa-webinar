// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import * as Phaser from 'phaser';

/**
 * Minimal boot scene. The world is fully procedural (no external assets to
 * preload in the placeholder build), so this just hands off to WorldScene.
 * When AssetConfig provides a real tilemap/spritesheet, their `load.*` calls go
 * here.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('World');
  }
}
