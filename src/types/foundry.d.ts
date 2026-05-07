/**
 * Basic Foundry VTT Type Definitions for Playwright E2E Testing.
 * These are minimal types to avoid 'as any' and '@ts-ignore'.
 */

declare global {
  interface FoundryDocument {
    id: string;
    name: string;
    uuid: string;
    update(data: any, options?: any): Promise<any>;
    delete(options?: any): Promise<any>;
    toJSON(): any;
    getFlag(scope: string, key: string): any;
    sheet: {
      render(force: boolean, options?: any): any;
    };
  }

  interface Actor extends FoundryDocument {
    type: string;
    system: any;
    items: Collection<Item>;
  }

  interface Item extends FoundryDocument {
    type: string;
    system: any;
  }

  interface User extends FoundryDocument {
    role: number;
    character: Actor | null;
  }

  interface Collection<T> extends Map<string, T> {
    get(id: string): T | undefined;
    getName(name: string): T | undefined;
    documentClass: any;
    map<U>(callback: (value: T, index: number, array: T[]) => U): U[];
    filter(callback: (value: T, index: number, array: T[]) => boolean): T[];
    find(callback: (value: T, index: number, array: T[]) => boolean): T | undefined;
  }

  interface Game {
    ready: boolean;
    version: string;
    release?: {
      generation: number;
      version: string;
    };
    users: Collection<User>;
    actors: Collection<Actor>;
    items: Collection<Item>;
    scenes: Collection<FoundryDocument>;
    packs: Map<string, any>;
    modules: Map<string, { active: boolean; [key: string]: any }>;
    settings: {
      get(module: string, key: string): any;
      set(module: string, key: string, value: any): Promise<any>;
    };
    socket: {
      emit(event: string, data: any): void;
      on(event: string, callback: (...args: any[]) => void): void;
    };
    user: User;
    collections: Record<string, Collection<any>>;
    [key: string]: any;
  }

  interface Window {
    game: Game;
    Hooks: {
      call(hook: string, ...args: any[]): any;
      on(hook: string, callback: (...args: any[]) => void): number;
      off(hook: string, id: number): void;
    };
    fromUuidSync(uuid: string): FoundryDocument | null;
    foundry: {
      utils: {
        deepClone<T>(obj: T): T;
      };
      documents: {
        collections: {
          CompendiumCollection: {
            createCompendium(config: any): Promise<any>;
          };
        };
      };
      applications: {
        api: {
          ApplicationV2: any;
        };
      };
    };
    FP_VERIFY: {
      logs: Record<string, any[]>;
      state: Record<string, any>;
      counter: number;
    };
    FP_VERIFY_RESET(): void;
    _hookLogs: Record<string, number>;
    _socketLogs: Record<string, number>;
    [key: string]: any; // Index signature to allow dynamic access to document classes like Actor, Item, etc.
  }

  const game: Game;
  const Hooks: Window["Hooks"];
  function fromUuidSync(uuid: string): FoundryDocument | null;
  const Actor: any;
  const Item: any;
  const Scene: any;
  const User: any;
}

export {}; // Make this a module to allow declare global
