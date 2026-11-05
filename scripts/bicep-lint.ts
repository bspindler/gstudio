// Cross-platform `az bicep build` check (no shell redirects, so it runs in PowerShell, cmd and Git Bash).
import { execFileSync } from 'node:child_process';

try {
  // On Windows `az` is az.cmd, which needs a shell to resolve.
  execFileSync('az', ['bicep', 'build', '--file', 'infra/main.bicep', '--stdout'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });
  console.log('infra/main.bicep: ok');
} catch (err) {
  console.error(`infra/main.bicep: bicep build failed (${err instanceof Error ? err.message : String(err)})`);
  process.exit(1);
}
