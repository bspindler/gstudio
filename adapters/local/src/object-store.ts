import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { ObjectStore } from '@studio/core';

const checkKey = (key: string) => {
  if (key.startsWith('/') || key.includes('\\') || key.split('/').some((p) => p === '..')) {
    throw new Error(`invalid key: ${key}`);
  }
  return key;
};

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  );
  return nested.flat();
}

/** ObjectStore over a local directory (`.data/objects` in dev). */
export function createFsObjectStore(root: string): ObjectStore {
  const path = (key: string) => join(root, ...checkKey(key).split('/'));
  return {
    async put(key, body) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      return readFile(path(key), 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
    },
    async list(prefix) {
      checkKey(prefix);
      const keys = (await walk(root)).map((f) => relative(root, f).split(sep).join('/'));
      return keys.filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
