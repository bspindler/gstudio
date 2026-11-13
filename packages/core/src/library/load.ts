import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const GameMetaSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().min(1),
  genre: z.string().min(1),
  targetSegment: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  ageRating: z.string().nullable(),
  childDirected: z.boolean().optional(),
}).strict();

export type GameMeta = z.infer<typeof GameMetaSchema>;

/** Reads `games/<slug>/game.yaml` for every game folder. The folder name must equal the slug. */
export async function loadGameLibrary(dir: string): Promise<GameMeta[]> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
  const games = await Promise.all(entries.map(async (e) => {
    const r = GameMetaSchema.safeParse(parse(await readFile(join(dir, e.name, 'game.yaml'), 'utf8')));
    if (!r.success) {
      const i = r.error.issues[0]!;
      const keys = i.code === 'unrecognized_keys' ? ` ${i.keys.join(', ')}` : '';
      throw new Error(`${e.name}/game.yaml: ${i.path.join('.') || '(root)'}: ${i.message}${keys}`);
    }
    if (r.data.slug !== e.name) throw new Error(`${e.name}/game.yaml: slug "${r.data.slug}" must match folder`);
    return r.data;
  }));
  return games.sort((a, b) => a.slug.localeCompare(b.slug));
}
