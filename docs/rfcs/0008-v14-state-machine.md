# RFC 0008: Foundry VTT UI State Machine

## Status

Proposed

## Context

Foundry VTT navigation across versions (V13 vs V14) has evolved from simple URL routing to a complex client-server state machine. V14 Build 360, in particular, enforces strict rules about state dependencies (e.g., Worlds tab disabled without a System) and transition guards (e.g., Join -> Setup redirection).

To avoid brittle tests and infinite navigation loops, we must definitively map these states and their transition requirements.

---

## 1. Global URL States

Foundry operates in five primary URL-driven states. Navigation between them is gated by server-side logic.

| State       | URL        | Description    | Gatekeeper / Dependency                                    |
| :---------- | :--------- | :------------- | :--------------------------------------------------------- |
| **LICENSE** | `/license` | EULA Signing   | Appears if `license.json` is missing or unsigned.          |
| **AUTH**    | `/auth`    | Admin Login    | Required to reach `/setup`. Appears if session is expired. |
| **SETUP**   | `/setup`   | Management Hub | Only accessible with an active Admin session.              |
| **JOIN**    | `/join`    | World Login    | Appears when a World is active but no user is logged in.   |
| **GAME**    | `/game`    | Active VTT     | The world is loaded and the user is authenticated.         |

### The "World Active" Lock

If a World is launched, Foundry is "locked" into the World context. Attempting to navigate to `/setup` will result in a redirect to `/join` or `/auth`. To return to `/setup`, a **Shutdown** command must be issued (via UI button or `game.shutDown()`).

---

## 2. Setup Screen Internal States (ApplicationV2)

The Setup screen in V14 is a single-page application (`ApplicationV2`).

### Tabs / Parts

| Part        | Identifier | Dependency                          |
| :---------- | :--------- | :---------------------------------- |
| **Worlds**  | `worlds`   | **Requires >= 1 System installed.** |
| **Systems** | `systems`  | None.                               |
| **Modules** | `modules`  | None.                               |
| **Config**  | `config`   | None.                               |
| **Update**  | `update`   | None.                               |

**V14 Constraint:** If no system is installed, the "Worlds" tab is `disabled` in the DOM. The `V14SetupAdapter` must verify system installation before attempting to switch to the Worlds tab.

---

## 3. Transition Logic

### Transition: `Any -> Setup` (The Return Path)

This is the most frequent source of failure.

1.  **Check current URL.**
2.  If `/game` or `/join`, click "Return to Setup" or "Shutdown".
3.  If a "Confirm Admin Password" form appears (V14 specific), fill it and submit.
4.  If redirected to `/auth`, perform Admin login.
5.  Wait for `foundry-app#setup` (V14) or `body.setup` (V13).

### Transition: `Setup -> World`

1.  Ensure "Systems" tab has the required system.
2.  Switch to "Worlds" tab (must be enabled).
3.  Click "Launch World".
4.  Wait for URL change to `/join` or `/game`.

---

## 4. Version Markers & Synchronization

To avoid using the wrong adapter, we must wait for definitive version markers.

| Marker               | V13                     | V14                              |
| :------------------- | :---------------------- | :------------------------------- |
| **Global Object**    | `game` (Setup and Game) | `foundry` (Setup), `game` (Game) |
| **Root Element**     | `body.setup`            | `foundry-app#setup`              |
| **API**              | `Application`           | `ApplicationV2`                  |
| **Script Extension** | `.js`                   | `.mjs`                           |

---

## 5. Proposed Fix Strategy

1.  **Strict Ordered Setup:** In `foundrySetup`, always perform System installation _before_ any world-related action (including deletion).
2.  **Explicit Shutdown:** `returnToSetup` must explicitly handle the password-gated shutdown form in V14.
3.  **Constructed Synchronization:** Test fixtures must wait for the `fake-module` to report "Ready" on `window` before proceeding, ensuring all V14 classes are loaded.
4.  **Evaluate Clicks:** Use `element.click()` via `page.evaluate` for all setup-level buttons to bypass invisible tour/usage-data backdrops.
5.  **Disabled Tab Detection:** `switchTab` must wait for the `disabled` class to be removed from a tab before clicking.
