# Roadmap: Features & Helper Functions

## V1.0.0 (Current Project Needs)
The goal for V1.0.0 is to extract and formalize the logic currently used in `thefehrs-learning-manager`.

### 1. Document Management (via `page.evaluate`)
- `createActor(data)`: Create a character or NPC.
- `createItem(actorId, data)`: Create an item on an actor.
- `updateDocument(uuid, changes)`: Generic update for any document.
- `getDocuments(collection, query)`: Fetch documents for verification.

### 2. UI & Setup Helpers
- `switchTab(page, tabName)`: Navigate the setup/config tabs.
- `disableTour()`: Suppress the core welcome tour.
- `handleReload()`: Detect and confirm the "Reload Application" dialog.
- `waitForReady()`: Wait for `game.ready` and the loading screen to vanish.

### 3. Orchestration
- `foundrySetup(config)`: The full "Auth -> World -> Module" bootstrapper.
- `foundryTeardown()`: World deletion and cleanup.
- `foundry-test` CLI: Basic Docker wrapper for version-specific runs.

### 4. Console Monitoring
- `failOnCriticalErrors()`: Automatically fail tests on deprecations, null pointers, or migration errors.

---

## Long-Term Vision (Future Expansion)

### 1. Advanced State Injection
- `createCompendium(data)`: Programmatic creation of packs.
- `importFromCompendium(pack, name, actorId)`: Simulate a user dragging from a pack.
- `setTokenPosition(tokenId, x, y)`: Direct canvas state updates.
- `modifySettings(moduleId, key, value)`: Instant module configuration.

### 2. Canvas Interaction Suite (The "WebGL" Helpers)
- `clickToken(tokenId)`: Click on a specific token by ID.
- `dragToken(tokenId, destinationGrid)`: Simulate a mouse drag across the canvas.
- `measureDistance(start, end)`: Simulate the Ruler tool.
- `targeting(tokenId, targetId)`: Simulate the 'T' key targeting logic.

### 3. System-Specific Adapters
- **DnD5e Adapter:** `grantGP()`, `longRest()`, `applyDamage()`.
- **PF2e Adapter:** `applyConditions()`, `advanceClock()`.
- **System Sniffer:** Auto-detection of the system to load the right adapter.

### 4. Multi-User/Socket Testing
- `broadcastEvent(name, data)`: Emit socket events to test multi-client reactivity.
- `waitForSocketEvent(name)`: Await a specific network message before proceeding.

### 5. Visual Regression Support
- `canvasScreenshot(options)`: Targeted screenshots of the WebGL layer that ignore UI overlays for consistent diffing.

---

## Prioritization Strategy
1. **Extraction First:** If it exists in the current project, it goes into V1.0.0.
2. **"Just-in-Time" Expansion:** New features (like Canvas helpers) will be drafted when the first module needs them for a specific test case.
3. **Community-Driven:** Once published, open issues for requested system adapters (PF2e, etc.).
