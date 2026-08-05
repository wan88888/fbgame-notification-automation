import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录：apps/api/src -> 上三级。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
