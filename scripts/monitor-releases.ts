import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * Release Monitoring Script
 *
 * Fetches latest versions of Foundry VTT and supported systems,
 * and updates verified-versions.json with pending entries.
 */

interface RegistryEntry {
  fvtt: string;
  system: string;
  systemVersion: string;
  modules?: { id: string; version: string }[];
  status: "stable" | "pending" | "incompatible";
  timestamp: string;
  notes: string;
}

async function fetchFoundryVersion(): Promise<string> {
  console.log("[monitor] Fetching latest Foundry VTT version...");
  const html = execSync("curl -s https://foundryvtt.com/releases/", { encoding: "utf8" });

  // Find the first occurrence of a stable release link
  // Structure: <a href="/releases/13.351" ...>Release 13.351</a> ... <span class="release-tag stable">Stable</span>
  const stableMatch = html.match(
    /<a href="\/releases\/([\d.]+)"[^>]*>Release [\d.]+<\/a>[\s\S]{0,500}?<span class="release-tag stable">Stable<\/span>/,
  );
  if (stableMatch) {
    return stableMatch[1];
  }

  const fallbackMatch = html.match(/Version ([\d.]+)/);
  if (!fallbackMatch) throw new Error("Failed to parse Foundry version from releases page.");
  return fallbackMatch[1];
}

async function fetchSystemLatest(systemId: string): Promise<string> {
  console.log(`[monitor] Fetching latest release for ${systemId} via Forge Bazaar...`);
  const json = execSync(`curl -s https://forge-vtt.com/api/bazaar/package/${systemId}`, {
    encoding: "utf8",
  });
  const data = JSON.parse(json);
  if (!data.success || !data.package?.latest) {
    throw new Error(`Failed to fetch latest release for ${systemId} from Forge Bazaar`);
  }
  return data.package.latest;
}

async function run() {
  try {
    const registryPath = path.join(process.cwd(), "verified-versions.json");
    let registry: RegistryEntry[] = JSON.parse(fs.readFileSync(registryPath, "utf8"));

    const foundryLatest = await fetchFoundryVersion();
    const dnd5eLatest = await fetchSystemLatest("dnd5e");
    const pf2eLatest = await fetchSystemLatest("pf2e");

    console.log(
      `[monitor] Latest Versions -> FVTT: ${foundryLatest}, dnd5e: ${dnd5eLatest}, pf2e: ${pf2eLatest}`,
    );

    const systems = [
      { id: "dnd5e", latest: dnd5eLatest },
      { id: "pf2e", latest: pf2eLatest },
    ];

    let updated = false;

    // 1. Check for new System versions for existing stable FVTT versions
    const stableFvttVersions = [
      ...new Set(registry.filter((e) => e.status === "stable").map((e) => e.fvtt)),
    ];

    for (const fvtt of stableFvttVersions) {
      for (const system of systems) {
        const exists = registry.some(
          (e) => e.fvtt === fvtt && e.system === system.id && e.systemVersion === system.latest,
        );

        if (!exists) {
          console.log(
            `[monitor] New system update detected: ${system.id} v${system.latest} for FVTT ${fvtt}`,
          );
          const verifyCmd = `npm run verify:local -- --docker --version ${fvtt} --system ${system.id} --update-registry --git-commit`;
          registry.push({
            fvtt,
            system: system.id,
            systemVersion: system.latest,
            status: "pending",
            timestamp: new Date().toISOString(),
            notes: `Automated detection: newer system version available. Run verification: \`${verifyCmd}\``,
          });
          updated = true;
        }
      }
    }

    // 2. Check if latest Foundry generation is represented
    const majorFoundry = foundryLatest.split(".")[0];
    const hasGeneration = registry.some((e) => e.fvtt.startsWith(majorFoundry));

    if (!hasGeneration) {
      console.log(`[monitor] New Foundry generation detected: ${foundryLatest}`);
      for (const system of systems) {
        const verifyCmd = `npm run verify:local -- --docker --version ${foundryLatest} --system ${system.id} --update-registry --git-commit`;
        registry.push({
          fvtt: foundryLatest,
          system: system.id,
          systemVersion: system.latest,
          status: "pending",
          timestamp: new Date().toISOString(),
          notes: `Automated detection: new Foundry generation. Run verification: \`${verifyCmd}\``,
        });
      }
      updated = true;
    }

    if (updated) {
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      console.log("[monitor] Registry updated with pending entries.");
    } else {
      console.log("[monitor] No new releases detected.");
    }
  } catch (error: unknown) {
    console.error("[monitor] Error:", (error as Error).message);
    process.exit(1);
  }
}

run();
