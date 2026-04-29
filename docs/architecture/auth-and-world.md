# Technical Plan: Authentication & World Selection

## The "What"
A robust, automated orchestration layer that handles the "pre-game" lifecycle of a FoundryVTT instance. This includes navigating the setup screen, handling administrative authentication, accepting EULAs, managing (creating/deleting) test worlds, and launching into a specific world as a designated user.

## The "Why"
The FoundryVTT setup and login process is a significant source of flakiness in E2E tests:
1. **Dynamic State:** The setup screen state changes based on whether a world is active, if an update is available, or if it's a fresh installation (EULA).
2. **Slow Transitions:** Transitioning from the setup screen to a launched world involves server-side restarts and heavy client-side asset loading.
3. **World Locking:** Foundry prevents multiple instances from writing to the same world data simultaneously.
4. **Credential Management:** Handling multiple roles (GM vs. Player) and administrative passwords requires a standardized approach to avoid hardcoding secrets.

## The "How"

### 1. EULA & Administrative Auth
The library will expose a `FoundryAuthenticator` class. Upon navigating to `/setup`, it will:
- **Scan for EULA:** Check for the presence of the EULA modal and automatically click "Accept" if detected.
- **Admin Login:** If a password field is present on the setup screen, it will use the `FOUNDRY_ADMIN_PASSWORD` from the environment.

### 2. World Management Logic
- **`deleteWorldIfExists(worldId)`:**
    - Navigate to the "Game Worlds" tab.
    - Identify the world by `data-package-id`.
    - If active (indicated by a "Stop" button), stop the world and wait for the "Launch" button to reappear.
    - Open the context menu and select "Delete World".
    - Handle the confirmation dialog by reading the random security code from the UI and filling the confirmation textbox.
- **`createWorld(config)`:**
    - Click "Create World".
    - Fill the form (Title, Name, System, Background Image).
    - Support system-specific defaults (e.g., defaulting to `dnd5e`).

### 3. Launch & Join Orchestration
- **`launchWorld(worldId)`:** Click the launch button and wait for the `/join` or `/game` URL transition.
- **`joinGame(user, password)`:**
    - On the `/join` screen, select the user from the dropdown.
    - Fill the password if required.
    - Wait for the `#loading` overlay to disappear and `game.ready === true`.

### 4. Playwright Integration
This logic will be encapsulated in a `foundrySetup` global hook:
```typescript
export async function foundrySetup(page: Page, config: FoundryConfig) {
    const auth = new FoundryAuthenticator(page, config);
    await auth.ensureSetup();
    await auth.ensureWorld(config.worldId);
    await auth.launch(config.worldId);
    await auth.join(config.user, config.password);
}
```
