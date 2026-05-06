# Technical Plan: Multi-Version Support (V13 & V14)

## The "What"

A strategy to ensure the testing library remains compatible across multiple major versions of FoundryVTT (specifically targeting V13 and V14). This involves abstracting UI and API differences behind version-aware adapters.

## The "Why"

FoundryVTT major versions often introduce breaking changes to both the internal API and the DOM structure:

1. **API Shifts:** V14 introduces the Scene Regions API, which fundamentally changes how area effects and triggers are handled compared to V13's Measured Templates.
2. **UI Changes:** Selectors for the setup screen, context menus, and sidebar tabs frequently shift between versions.
3. **Internal Data Structures:** Document schemas and flag structures can evolve, requiring different injection scripts.

## The "How"

### 1. Environment-Driven Configuration

The library will prioritize explicit configuration to avoid "magic" detection failures.

- **`FOUNDRY_VERSION` Variable:** Consumers must specify the target version in their environment (e.g., `FOUNDRY_VERSION=14`).
- **Fail-Fast Validation:** The `foundrySetup` orchestrator will verify the provided version against the supported list (13, 14) and throw a descriptive error immediately if it's missing or unsupported.

### 2. The Version Adapter Pattern

Interactions will be abstracted into version-specific implementation classes.

#### A. Interface Definition

```typescript
interface VersionAdapter {
  // UI Selectors
  readonly selectors: Record<string, string>;

  // High-level Actions
  createAreaEffect(data: any): Promise<void>;
  handleWorldConfirmation(page: Page): Promise<void>;
}
```

#### B. Implementation Classes

- **`V13Adapter`**: Implements logic using Measured Templates and V13-specific DOM selectors.
- **`V14Adapter`**: Implements logic using the Scene Regions API and V14-specific selectors.

#### C. Dynamic Fixture Yielding

The `foundry` fixture will act as a factory, yielding the correct adapter based on the environment:

```typescript
const adapter = process.env.FOUNDRY_VERSION === "14" ? new V14Adapter(page) : new V13Adapter(page);
yield adapter;
```

### 3. Runtime Version Detection (Safety Fallback)

While the environment variable is primary, the library will perform a "sanity check" once the browser is connected.

- **`game.version` Sniffing:** Inside `page.evaluate`, the library will query `game.version` (or `game.release.generation` in newer versions).
- **Warning System:** If the detected runtime version disagrees with the `FOUNDRY_VERSION` environment variable, the library will issue a loud warning or optionally switch adapters dynamically if configured to do so.

### 4. Version-Aware Data Injection

When using `page.evaluate` to inject data (e.g., creating tokens with elevation), the scripts will be wrapped in conditional logic:

```javascript
await page.evaluate((version) => {
  if (version >= 14) {
    // Use multi-level scene API
  } else {
    // Use V13-compatible elevation logic
  }
}, detectedVersion);
```
