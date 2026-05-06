import { execSync } from 'child_process';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';

/**
 * Local Verification Script
 * 
 * Orchestrates a Docker-based Foundry instance and runs the verification suite.
 */

const args = process.argv.slice(2);
const isDocker = args.includes('--docker');

// Improved version parsing
let versionArg = process.env.FOUNDRY_VERSION || '13';
const versionIdx = args.indexOf('--version');
if (versionIdx !== -1 && args[versionIdx + 1]) {
    versionArg = args[versionIdx + 1];
}

let systemArg = process.env.FOUNDRY_SYSTEM_ID || 'dnd5e';
const systemIdx = args.indexOf('--system');
if (systemIdx !== -1 && args[systemIdx + 1]) {
    systemArg = args[systemIdx + 1];
}

async function run() {
  console.log('--- Starting Local Verification ---');
  
  const foundryUrl = process.env.FOUNDRY_URL || 'http://localhost:30000';
  let orchestrator = null;

  try {
    // 1. Build the library first (so we can use the orchestrator)
    console.log('Building library...');
    execSync('npm run build', { stdio: 'inherit' });

    if (isDocker) {
      const { DockerFoundryOrchestrator } = await import('../dist/docker.js');
      
      const tmpDataDir = path.join(process.cwd(), `.foundry_data_tmp_${Date.now()}`);
      
      orchestrator = new DockerFoundryOrchestrator({
        version: versionArg,
        adminKey: process.env.FOUNDRY_ADMIN_KEY || 'password',
        dataDir: tmpDataDir,
      });

      // Inject all local modules from e2e/ into the container
      const e2ePath = path.join(process.cwd(), 'e2e');
      const items = fs.readdirSync(e2ePath);
      for (const item of items) {
        const itemPath = path.join(e2ePath, item);
        if (fs.statSync(itemPath).isDirectory() && fs.existsSync(path.join(itemPath, 'module.json'))) {
          console.log(`Injecting local module: ${item}`);
          const modulesDir = path.join(tmpDataDir, 'Data', 'modules', item);
          fs.mkdirSync(modulesDir, { recursive: true });
          fs.cpSync(itemPath, modulesDir, { recursive: true });
        }
      }

      const url = await orchestrator.start();
      console.log(`Foundry is up at ${url}`);
    }

    console.log(`Verifying against: ${foundryUrl}`);

    // 2. Run E2E tests
    console.log('Running E2E verification suite...');
    const env = { 
      ...process.env, 
      FOUNDRY_URL: foundryUrl,
      FOUNDRY_VERSION: versionArg,
      FOUNDRY_SYSTEM_ID: systemArg,
      FOUNDRY_UI_ADAPTER: process.env.FOUNDRY_UI_ADAPTER || systemArg
    };
    
    // Pass through common Playwright flags
    const playwrightArgs = args.filter(a => a.startsWith('--ui') || a.startsWith('--headed') || a.startsWith('--debug'));

    // We target only our specific verification suites
    const testFiles = [
      'e2e/verify.spec.ts',
      'e2e/user-management.spec.ts',
    ].join(' ');

    execSync(`npx playwright test ${testFiles} --workers=1 ${playwrightArgs.join(' ')}`, { 
      stdio: 'inherit',
      env
    });

    console.log('--- Verification Successful ---');

    // 3. Generate Report
    const reportPath = path.join(process.cwd(), 'verification-report.md');
    const reportContent = `# Verification Report: ${versionArg}
- **Date:** ${new Date().toISOString()}
- **System:** ${systemArg}
- **Status:** PASS
- **Docker:** ${isDocker ? 'Yes' : 'No'}
`;
    fs.writeFileSync(reportPath, reportContent);
    console.log(`Report generated: ${reportPath}`);

    // 4. Interactive Registry Update (Simulated for non-interactive envs, but logic is here)
    if (args.includes('--update-registry')) {
        console.log(`Updating verified-versions.json for ${versionArg}...`);
        const registryPath = path.join(process.cwd(), 'verified-versions.json');
        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        
        // Remove from pending
        registry.pending = registry.pending.filter(v => v.version !== versionArg);
        
        // Add to verified if not exists
        if (!registry.verified.find(v => v.version === versionArg)) {
            registry.verified.push({
                version: versionArg,
                timestamp: new Date().toISOString(),
                status: 'stable',
                notes: `Verified locally with ${systemArg}.`
            });
        }
        
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
        console.log('Registry updated successfully.');
    }

  } catch (error) {
    console.error('--- Verification Failed ---');
    console.error(error.message);
    process.exit(1);
  } finally {
    if (orchestrator && !args.includes('--keep-container')) {
      orchestrator.stopAndRemove();
    }
  }
}

run();
