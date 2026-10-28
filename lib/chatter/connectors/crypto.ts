import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(value: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('connector_encryption_key_invalid');
  return Buffer.from(value, 'hex');
}
export function encryptCredentials(value: Record<string, string>, secret: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
}
export function decryptCredentials(value: string, secret: string, context: string): Record<string, string> {
  const [iv, tag, content] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(content), cipher.final()]).toString('utf8'));
}
