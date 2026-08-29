import crypto from 'crypto';
import dotenv from 'dotenv';
import { rootEnvPath } from './paths';

dotenv.config({ path: rootEnvPath });

const isProduction = process.env.NODE_ENV === 'production';

function readOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readSecret(name: string, minimumLength = 24): string | undefined {
  const value = readOptional(name);
  if (value && value.length < minimumLength) {
    throw new Error(`${name} phải có ít nhất ${minimumLength} ký tự`);
  }
  return value;
}

const configuredAuthSecret = readSecret('AUTH_SESSION_SECRET', 32);

export const runtimeConfig = {
  port: Number(process.env.PORT) || 3000,
  isProduction,
  authSessionSecret: configuredAuthSecret || crypto.randomBytes(32).toString('hex'),
  authSessionTtlSeconds: Math.max(300, Number(process.env.AUTH_SESSION_TTL_SECONDS) || 43_200),
  admin: {
    username: readOptional('ADMIN_USERNAME')?.toLowerCase(),
    password: readSecret('ADMIN_PASSWORD', 8),
    name: readOptional('ADMIN_NAME') || 'Quản trị viên'
  },
  sepayApiKey: readSecret('SEPAY_API_KEY', 16),
  webPush: {
    subject: readOptional('VAPID_SUBJECT') || 'mailto:admin@example.com',
    publicKey: readOptional('VAPID_PUBLIC_KEY'),
    privateKey: readSecret('VAPID_PRIVATE_KEY', 32)
  }
};

if (!configuredAuthSecret) {
  const message = '[config] Thiếu AUTH_SESSION_SECRET; phiên đăng nhập sẽ mất hiệu lực khi server khởi động lại.';
  if (isProduction) throw new Error(`${message} Biến này là bắt buộc trong production.`);
  console.warn(message);
}

export function hasConfiguredAdmin(): boolean {
  return Boolean(runtimeConfig.admin.username && runtimeConfig.admin.password);
}

export function hasConfiguredWebPush(): boolean {
  return Boolean(runtimeConfig.webPush.publicKey && runtimeConfig.webPush.privateKey);
}
