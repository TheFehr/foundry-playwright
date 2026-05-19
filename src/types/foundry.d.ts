/**
 * Basic Foundry VTT Type Definitions for Playwright E2E Testing.
 * These are minimal types to avoid 'as any' and '@ts-ignore'.
 */

declare global {
  interface FoundryDocument {
    id: string;
    name: string;
    uuid: string;
    update(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    delete(options?: Record<string, unknown>): Promise<unknown>;
    toJSON(): Record<string, unknown>;
    toObject(): Record<string, unknown>;
    _source: Record<string, unknown>;
    getFlag(scope: string, key: string): unknown;
    sheet: {
      render(force: boolean, options?: Record<string, unknown>): unknown;
    };
  }

  interface Actor extends FoundryDocument {
    type: string;
    system: Record<string, unknown>;
    items: Collection<Item>;
    createEmbeddedDocuments(
      embeddedName: string,
      data: Record<string, unknown>[],
      context?: Record<string, unknown>,
    ): Promise<FoundryDocument[]>;
  }

  interface Item extends FoundryDocument {
    type: string;
    system: Record<string, unknown>;
  }

  interface User extends FoundryDocument {
    role: number;
    character: Actor | null;
    isGM: boolean;
  }

  interface Collection<T> extends Map<string, T> {
    get(id: string): T | undefined;
    getName(name: string): T | undefined;
    documentClass: {
      create(data: Record<string, unknown>, context?: Record<string, unknown>): Promise<T>;
    };
    map<U>(callback: (value: T, index: number, array: T[]) => U): U[];
    filter(callback: (value: T, index: number, array: T[]) => boolean): T[];
    find(callback: (value: T, index: number, array: T[]) => boolean): T | undefined;
  }

  interface Macro extends FoundryDocument {
    execute(...args: unknown[]): unknown;
  }

  interface Game {
    ready: boolean;
    version: string;
    release?: {
      generation: number;
      version: string;
    };
    system: { id: string; version: string; [key: string]: unknown };
    users: Collection<User>;
    actors: Collection<Actor>;
    items: Collection<Item>;
    scenes: Collection<FoundryDocument>;
    macros: Collection<Macro>;
    packs: Map<string, unknown>;
    modules: Map<string, { active: boolean; version?: string; [key: string]: unknown }>;
    settings: {
      get(module: string, key: string): unknown;
      set(module: string, key: string, value: unknown): Promise<unknown>;
      register(module: string, key: string, data: Record<string, unknown>): void;
    };
    socket: {
      emit(event: string, data: unknown): void;
      on(event: string, callback: (...args: unknown[]) => void): void;
    };
    user: User;
    collections: {
      get(name: string): Collection<FoundryDocument>;
    } & Record<string, Collection<FoundryDocument>>;
    canvas: {
      ready: boolean;
      grid: {
        getTopLeft(x: number, y: number): number[];
        getCenter(x: number, y: number): number[];
      };
      stage: {
        worldTransform: {
          apply(point: { x: number; y: number }): { x: number; y: number };
        };
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  interface Window {
    game: Game;
    CONFIG: {
      [key: string]: {
        documentClass: {
          create(
            data: Record<string, unknown>,
            context?: Record<string, unknown>,
          ): Promise<FoundryDocument>;
        };
        [key: string]: unknown;
      };
    };
    Hooks: {
      call(hook: string, ...args: unknown[]): unknown;
      on(hook: string, callback: (...args: unknown[]) => void): number;
      off(hook: string, id: number): void;
    };
    fromUuidSync(uuid: string): FoundryDocument | null;
    foundry: {
      utils: {
        deepClone<T>(obj: T): T;
        vttVersion?: string;
      };
      documents: {
        collections: {
          CompendiumCollection: {
            createCompendium(config: Record<string, unknown>): Promise<unknown>;
          };
        };
      };
      applications: {
        api: {
          ApplicationV2: unknown;
        };
      };
    };
    FP_VERIFY: {
      logs: Record<string, unknown[]>;
      state: Record<string, unknown>;
      counter: number;
      log(key: string, data: unknown): void;
    };
    FP_VERIFY_RESET(): void;
    _hookLogs: Record<string, unknown[][]>;
    _socketLogs: Record<string, number>;
    [key: string]: unknown; // Index signature to allow dynamic access to document classes like Actor, Item, etc.
  }

  const game: Game;
  const Hooks: Window["Hooks"];
  function fromUuidSync(uuid: string): FoundryDocument | null;
  const Actor: unknown;
  const Item: unknown;
  const Scene: unknown;
  const User: unknown;
}

export {}; // Make this a module to allow declare global
