import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const magic = Buffer.from('SWAPCIRCLE-BACKUP-1\n');
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;

export async function externalPath(value: string | undefined) {
  if (!value || !isAbsolute(value))
    throw new Error('Absolute external path required.');
  const checkout = await realpath(root);
  const lexical = resolve(value);
  const path = join(await realpath(dirname(lexical)), basename(lexical));
  const check = (target: string) => {
    if (!relative(checkout, target).startsWith('../'))
      throw new Error('Backup/key paths must be outside the checkout.');
  };
  check(path);
  try {
    check(await realpath(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return path;
}

export async function loadKey(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size !== 32)
    throw new Error('Key must be a private regular 32-byte file.');
  return readFile(path);
}

export function encrypt(body: Buffer, key: Buffer) {
  if (body.length > MAX_BACKUP_BYTES)
    throw new Error('Backup size bound exceeded.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
}

export function decrypt(body: Buffer, key: Buffer) {
  if (
    body.length > MAX_BACKUP_BYTES + 128 ||
    !body.subarray(0, magic.length).equals(magic)
  )
    throw new Error('Invalid backup.');
  const offset = magic.length;
  const cipher = createDecipheriv(
    'aes-256-gcm',
    key,
    body.subarray(offset, offset + 12),
  );
  cipher.setAAD(magic);
  cipher.setAuthTag(body.subarray(offset + 12, offset + 28));
  return Buffer.concat([
    cipher.update(body.subarray(offset + 28)),
    cipher.final(),
  ]);
}

export async function saveEncrypted(path: string, body: Buffer, key: Buffer) {
  // Exclusive creation: never silently overwrite an existing recovery point.
  await writeFile(path, encrypt(body, key), { flag: 'wx', mode: 0o600 });
}

export async function readEncrypted(path: string, key: Buffer) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.size > MAX_BACKUP_BYTES + 128 ||
    (info.mode & 0o077) !== 0
  )
    throw new Error('Invalid backup file permissions or size.');
  return decrypt(await readFile(path), key);
}
