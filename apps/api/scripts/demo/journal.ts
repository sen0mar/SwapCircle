import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const stateSchema = z.object({
  version: z.literal(1),
  startedAt: z.string(),
  steps: z.record(
    z.string(),
    z.object({
      hash: z.string(),
      operationKey: z.uuid(),
      complete: z.boolean(),
      beforeIds: z.array(z.uuid()).optional(),
      result: z.unknown().optional(),
    }),
  ),
});
export type DemoState = z.infer<typeof stateSchema>;

export async function writePrivate(path: URL, value: unknown) {
  await mkdir(new URL('.', path), { recursive: true, mode: 0o700 });
  const temp = new URL(`${path.href}.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temp, path);
}

export async function openJournal(path: URL) {
  let state: DemoState;
  try {
    state = stateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(
        'Invalid demo journal; preserve it and inspect locally.',
        { cause: error },
      );
    state = { version: 1, startedAt: new Date().toISOString(), steps: {} };
    await writePrivate(path, state);
  }

  return {
    state,
    checkpoint: () => writePrivate(path, state),
    async step<T>(
      key: string,
      input: unknown,
      schema: z.ZodType<T>,
      work: (operationKey: string) => Promise<T>,
    ): Promise<T> {
      const hash = createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');
      let record = state.steps[key];
      if (record && record.hash !== hash)
        throw new Error(
          `Demo manifest changed at ${key}; refusing to overwrite existing data.`,
        );
      if (record?.complete) return schema.parse(record.result);

      record ??= { hash, operationKey: randomUUID(), complete: false };
      state.steps[key] = record;
      await writePrivate(path, state);
      const result = schema.parse(await work(record.operationKey));
      record.result = result;
      record.complete = true;
      await writePrivate(path, state);
      return result;
    },
  };
}
