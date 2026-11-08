import type { MetaEnvironment } from './config';

export type TokenIdentity = {
  connectionId: string;
  tokenId: string;
  tokenType: 'USER' | 'PAGE' | 'SYSTEM_USER';
  assetId: string;
};
export type EncryptedMetaToken = {
  ciphertext: string;
  nonce: string;
  keyVersion: string;
  algorithm: 'AES-GCM';
};
const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function encryptionKey(env: MetaEnvironment) {
  if (
    !env.META_TOKEN_ENCRYPTION_KEY ||
    !/^[A-Za-z0-9+/]{43}=$/.test(env.META_TOKEN_ENCRYPTION_KEY) ||
    !env.META_TOKEN_ENCRYPTION_KEY_VERSION ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(env.META_TOKEN_ENCRYPTION_KEY_VERSION)
  ) {
    throw new Error('META_ENCRYPTION_NOT_CONFIGURED');
  }
  return crypto.subtle.importKey(
    'raw',
    bytes(env.META_TOKEN_ENCRYPTION_KEY),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}

function additionalData(identity: TokenIdentity, version: string) {
  return encoder.encode(
    JSON.stringify([
      'corevity:meta:token:v1',
      version,
      identity.connectionId,
      identity.tokenId,
      identity.tokenType,
      identity.assetId,
    ]),
  );
}

export async function encryptMetaToken(
  env: MetaEnvironment,
  identity: TokenIdentity,
  token: string,
): Promise<EncryptedMetaToken> {
  if (!token.trim() || encoder.encode(token).length > 16_384)
    throw new Error('META_TOKEN_INVALID');
  const key = await encryptionKey(env);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const keyVersion = env.META_TOKEN_ENCRYPTION_KEY_VERSION!;
  const result = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: additionalData(identity, keyVersion),
      tagLength: 128,
    },
    key,
    encoder.encode(token),
  );
  return {
    ciphertext: base64(new Uint8Array(result)),
    nonce: base64(nonce),
    keyVersion,
    algorithm: 'AES-GCM',
  };
}

export async function decryptMetaToken(
  env: MetaEnvironment,
  identity: TokenIdentity,
  encrypted: EncryptedMetaToken,
) {
  if (encrypted.keyVersion !== env.META_TOKEN_ENCRYPTION_KEY_VERSION)
    throw new Error('META_ENCRYPTION_KEY_VERSION_MISMATCH');
  const key = await encryptionKey(env);
  try {
    if (
      encrypted.algorithm !== 'AES-GCM' ||
      encrypted.ciphertext.length > 22_000 ||
      encrypted.nonce.length !== 16 ||
      bytes(encrypted.nonce).length !== 12
    )
      throw new Error();
    const result = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes(encrypted.nonce),
        additionalData: additionalData(identity, encrypted.keyVersion),
        tagLength: 128,
      },
      key,
      bytes(encrypted.ciphertext),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(result);
  } catch {
    // Never attach the original provider value, key, ciphertext or token to errors.
    throw new Error('META_TOKEN_DECRYPTION_FAILED');
  }
}
