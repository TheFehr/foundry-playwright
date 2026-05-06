import { Page } from "@playwright/test";

/**
 * Utilities for interacting with the Foundry VTT WebGL Canvas.
 */
export class FoundryCanvas {
  constructor(private page: Page) {}

  /**
   * Converts grid coordinates (row, col) to viewport pixels.
   * @param x The grid X coordinate (column).
   * @param y The grid Y coordinate (row).
   */
  async gridToPixels(x: number, y: number): Promise<{ x: number; y: number }> {
    return this.page.evaluate(
      ({ x, y }) => {
        // @ts-ignore
        const canvas = window.canvas;
        if (!canvas || !canvas.ready) throw new Error("Canvas is not ready.");

        // Calculate pixels using Foundry's coordinate system
        // Note: This accounts for padding and scale
        const pixels = canvas.grid.getTopLeft(x, y);
        const center = canvas.grid.getCenter(pixels[0], pixels[1]);

        // Convert canvas coordinates to global (viewport) pixels
        const global = canvas.stage.worldTransform.apply({ x: center[0], y: center[1] });

        // Account for the canvas element's position on the page
        const rect = document.getElementById("canvas")?.getBoundingClientRect();
        if (!rect) throw new Error("Canvas element not found.");

        return {
          x: global.x + rect.left,
          y: global.y + rect.top,
        };
      },
      { x, y },
    );
  }

  /**
   * Clicks on a specific token by its ID.
   * @param tokenId The ID of the token.
   */
  async clickToken(tokenId: string) {
    const coords = await this.getTokenCanvasPosition(tokenId);
    await this.page.mouse.click(coords.x, coords.y);
  }

  /**
   * Double-clicks on a specific token by its ID (usually opens sheet).
   * @param tokenId The ID of the token.
   */
  async doubleClickToken(tokenId: string) {
    const coords = await this.getTokenCanvasPosition(tokenId);
    await this.page.mouse.click(coords.x, coords.y, { clickCount: 2 });
  }

  /**
   * Drags a token from its current position to a target grid coordinate.
   * @param tokenId The ID of the token to drag.
   * @param targetX The target grid X coordinate.
   * @param targetY The target grid Y coordinate.
   */
  async dragToken(tokenId: string, targetX: number, targetY: number) {
    const start = await this.getTokenCanvasPosition(tokenId);
    const end = await this.gridToPixels(targetX, targetY);

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps: 10 });
    await this.page.mouse.up();
  }

  /**
   * Right-clicks on the canvas at a specific grid coordinate.
   */
  async rightClickGrid(x: number, y: number) {
    const coords = await this.gridToPixels(x, y);
    await this.page.mouse.click(coords.x, coords.y, { button: "right" });
  }

  /**
   * Targets a token (simulates the 'T' key).
   * @param tokenId The ID of the token to target.
   */
  async targetToken(tokenId: string) {
    const coords = await this.getTokenCanvasPosition(tokenId);
    await this.page.mouse.move(coords.x, coords.y);
    await this.page.keyboard.press("t");
  }

  /**
   * Internal helper to get the viewport pixels for a token's center.
   */
  private async getTokenCanvasPosition(tokenId: string): Promise<{ x: number; y: number }> {
    return this.page.evaluate((id) => {
      // @ts-ignore
      const token = window.canvas.tokens.get(id);
      if (!token) throw new Error(`Token ${id} not found on canvas.`);

      // Get center in canvas coordinates
      const center = token.center;

      // Convert to global pixels
      // @ts-ignore
      const global = window.canvas.stage.worldTransform.apply(center);

      const rect = document.getElementById("canvas")?.getBoundingClientRect();
      if (!rect) throw new Error("Canvas element not found.");

      return {
        x: global.x + rect.left,
        y: global.y + rect.top,
      };
    }, tokenId);
  }
}
