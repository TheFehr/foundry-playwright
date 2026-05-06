# Technical Plan: Canvas Interaction Utilities

## The "What"

A suite of utilities for interacting with FoundryVTT's WebGL-based game canvas. This includes mapping in-game grid coordinates to browser viewport pixels, targeting specific tokens or tiles, and simulating mouse interactions like dragging and measurement.

## The "Why"

The FoundryVTT canvas is a "black box" to traditional E2E testing tools like Playwright.

- **Opaque DOM:** The canvas is a single `<canvas>` element. You cannot "inspect" a token or a wall via standard CSS selectors.
- **Coordination Complexity:** In-game coordinates (e.g., "Grid Square B5") do not map directly to screen pixels because they depend on the current zoom level, pan position, and resolution.
- **WebGL Events:** Interactions like dragging a token require precise sequence of `mousedown`, `mousemove`, and `mouseup` events with specific coordinate offsets that Foundry's internal engine expects.

## The "How"

### 1. Coordinate Mapping (The Bridge)

The library will provide a bridge between Foundry's internal coordinate system and Playwright's mouse API.

- **`getCanvasPixels(gridX, gridY)`:** Uses `canvas.grid.getPixelsFromGridPosition(x, y)` inside the browser to get the center point of a grid square in "canvas space", then applies the current `canvas.stage.scale` and `canvas.stage.position` to determine the exact viewport coordinates.

### 2. Targeting Utilities

Instead of clicking on pixels, tests will target objects:

- **`clickToken(tokenId)`:** Resolves the token's current position on the canvas and performs a click.
- **`dragToken(tokenId, destinationGrid)`:**
  1. Move mouse to token center.
  2. `mouse.down()`.
  3. Calculate path to destination.
  4. `mouse.move()` to destination (potentially with intermediate steps to satisfy Foundry's movement logic).
  5. `mouse.up()`.

### 3. Measuring & Targeting

- **`measureDistance(startGrid, endGrid)`:** Simulates the "Ruler" tool interaction to verify distance calculations.
- **`clickGrid(x, y)`:** For targeting empty space (e.g., placing a template or moving a character).

### 4. Implementation Details

The utilities will be part of the `foundry` fixture:

```typescript
// Example usage in a test
test("move token to trap", async ({ foundry }) => {
  await foundry.canvas.dragToken("my-token-id", { x: 10, y: 15 });
  // Verify state after movement
});
```

To handle zoom and panning, the `foundry` fixture will automatically ensure the target area is in the viewport before interacting:

```javascript
// Internal logic
async ensureVisible(canvasX, canvasY) {
  await this.page.evaluate(({x, y}) => {
    canvas.pan({x, y});
  }, {x: canvasX, y: canvasY});
}
```
