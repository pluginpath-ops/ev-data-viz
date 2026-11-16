/**
 * The main checkout's folder, even when a script runs from a worktree.
 * LocalDev/ and .env are git-ignored, so only the main checkout has them.
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');

export function mainCheckout() {
    try {
        const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return dirname(common);
    } catch {
        return HERE;
    }
}

/** LocalDev/green-ncap in the main checkout: where the Green NCAP scripts keep their data. */
export const GREEN_NCAP_DIR = join(mainCheckout(), 'LocalDev', 'green-ncap');
