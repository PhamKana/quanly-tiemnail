import { Customer } from '@shared/types';

const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

/**
 * Returns a conservative, comparison-safe phone key.
 * Invalid, placeholder, and text-only values return null and must never match.
 */
export function normalizeCustomerPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  let digits = value.trim().replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null;
  if (/^(\d)\1+$/.test(digits)) return null;

  return digits;
}

export function findCustomersByPhone(customers: Customer[], phone: unknown): Customer[] {
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) return [];

  return customers.filter(customer => normalizeCustomerPhone(customer.phone) === normalizedPhone);
}

/**
 * Returns a comparison-safe customer name.
 * Names are only used to warn about possible duplicates, never to link wallets.
 */
export function normalizeCustomerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalizedName = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi-VN');

  return normalizedName || null;
}

export function findCustomersByExactName(customers: Customer[], name: unknown): Customer[] {
  const normalizedName = normalizeCustomerName(name);
  if (!normalizedName) return [];

  return customers.filter(customer => normalizeCustomerName(customer.name) === normalizedName);
}

export function findCustomerById(customers: Customer[], customerId: unknown): Customer | undefined {
  if (typeof customerId !== 'string' || !customerId.trim()) return undefined;
  return customers.find(customer => customer.id === customerId);
}
