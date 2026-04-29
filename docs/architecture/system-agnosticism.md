# Technical Plan: System Agnosticism & Configuration

## The "What"
An architectural approach that ensures the library's utilities work seamlessly across different game systems (`dnd5e`, `pf2e`, `alien`, etc.) without requiring hardcoded logic for system-specific data structures.

## The "Why"
FoundryVTT is a platform, but the "data shape" of documents varies wildly between systems:
- **Currency:** `system.currency.gp` (DnD5e) vs `system.currency.cp` (some others) vs a completely different structure in system-agnostic modules.
- **Attributes:** HP might be in `system.attributes.hp.value` or `system.health.value`.
- **Logic:** Some systems have complex automation that triggers on document updates, which might interfere with simple data injection.

A truly reusable library must provide a way to "map" these differences so the developer can write generic-feeling tests.

## The "How"

### 1. The `FoundryTestConfig` Schema
Users will initialize the library with a configuration object that defines system-specific mappings.

```typescript
export interface FoundryTestConfig {
  system: string; // e.g. "dnd5e"
  mappings: {
    hp: string; // e.g. "system.attributes.hp.value"
    currency: string; // e.g. "system.currency"
  };
  // ... other config
}
```

### 2. Adapter Pattern
The library will include built-in adapters for major systems. If no mapping is provided, it will attempt to detect the active system and use the appropriate adapter.

```typescript
class DnD5eAdapter extends BaseSystemAdapter {
  getHPPath() { return "system.attributes.hp.value"; }
  async addCurrency(actor, amount) {
    // Specific logic for DnD5e currency objects
  }
}
```

### 3. Dynamic Path Resolution
Instead of hardcoded paths, utility functions will use the config/adapter to resolve paths at runtime.

```typescript
// Library code
async setHP(actorId, value) {
  const hpPath = this.adapter.getHPPath();
  await this.updateDocument(actorId, { [hpPath]: value });
}
```

### 4. Modular Initialization
The library will be designed to be "opt-in" for system-specific features. A developer testing a system-agnostic module can ignore the currency/attribute helpers and focus solely on the core `foundry` and `canvas` utilities.

### 5. Validation & Defaults
To minimize configuration overhead:
- **Sensible Defaults:** Default to `dnd5e` if no system is specified (given its popularity).
- **Auto-Discovery:** In `page.evaluate`, the library can check `game.system.id` and warn if the configuration doesn't match the active world.
