import { DefaultUIAdapter } from "./base.js";

/**
 * UI adapter for the standard Dungeons & Dragons Fifth Edition sheets.
 */
export class DnD5eUIAdapter extends DefaultUIAdapter {
  id = "dnd5e";

  override getActorSheetSelector(): string {
    return "foundry-app, .window-app.dnd5e.sheet.actor, [id^='dnd5e-actor-'], [id^='actor-character-']";
  }
}
