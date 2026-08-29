import fs from 'fs';
import path from 'path';

function findRepositoryRoot(startDirectory: string): string {
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 6; depth += 1) {
    const packageFile = path.join(current, 'package.json');
    if (fs.existsSync(packageFile)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
        if (Array.isArray(manifest.workspaces)) return current;
      } catch {
        // Continue walking upward when a nested manifest is malformed.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Không tìm thấy thư mục gốc nail-manager');
}

export const repositoryRoot = findRepositoryRoot(process.cwd());
export const webRoot = path.join(repositoryRoot, 'apps', 'web');
export const webViteConfigPath = path.join(webRoot, 'vite.config.ts');
export const webDistRoot = path.join(repositoryRoot, 'dist', 'web');
export const backupsRoot = path.join(repositoryRoot, 'backups');
export const firebaseAppletConfigPath = path.join(repositoryRoot, 'infra', 'firebase', 'firebase-applet-config.json');
export const rootEnvPath = path.join(repositoryRoot, '.env');

