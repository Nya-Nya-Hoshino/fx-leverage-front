// API Key 本地加密存储：AES-256-GCM，密钥文件保存在 data/.secret.key（仅本机）。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { SecretBox } from './store';
export { keyHint } from './store';

export class KeyStore implements SecretBox {
  private key: Buffer;

  constructor(keyPath: string) {
    if (existsSync(keyPath)) {
      this.key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
    } else {
      this.key = randomBytes(32);
      writeFileSync(keyPath, this.key.toString('base64'), { mode: 0o600 });
    }
  }

  encrypt(plain: string): string {
    if (!plain) return '';
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }

  decrypt(enc: string): string {
    if (!enc) return '';
    try {
      const b = Buffer.from(enc, 'base64');
      const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return '';
    }
  }

  static hint(plain: string): string {
    if (!plain) return '';
    return plain.length <= 8 ? '****' : `${plain.slice(0, 3)}****${plain.slice(-4)}`;
  }
}
