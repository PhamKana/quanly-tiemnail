export type CheckoutRole = 'admin' | 'staff' | 'support';
export type CheckoutPaymentMethod = 'cash' | 'transfer' | 'wallet';

export interface CheckoutAppointmentState {
  id?: string;
  status?: string;
  paymentTransactionId?: string;
}

export function shouldCompleteCheckoutImmediately(
  role: CheckoutRole,
  paymentMethod: CheckoutPaymentMethod,
  amountDue: number
): boolean {
  return amountDue === 0 || (role === 'admin' && paymentMethod !== 'transfer');
}

export function assertStandaloneCheckoutAvailable(appointment: CheckoutAppointmentState): void {
  if (appointment.paymentTransactionId) {
    throw new Error('Đơn đang thuộc một giao dịch thanh toán nhóm và không thể checkout riêng');
  }
  if (!['pending', 'confirmed', 'in_progress'].includes(String(appointment.status || ''))) {
    throw new Error(`Đơn hàng không thể checkout: status hiện tại là '${appointment.status || 'unknown'}'`);
  }
}

export function assertPendingGroupAppointmentsConsistent(
  appointments: CheckoutAppointmentState[],
  paymentTransactionId: string
): void {
  if (appointments.length < 2) {
    throw new Error('Giao dịch nhóm không còn đủ đơn để hoàn tất');
  }
  appointments.forEach(appointment => {
    if (
      appointment.paymentTransactionId !== paymentTransactionId ||
      appointment.status !== 'awaiting_payment'
    ) {
      throw new Error(`Đơn ${appointment.id || 'không rõ'} đã thay đổi trong khi chờ duyệt; giao dịch nhóm chưa được hoàn tất`);
    }
  });
}

export function isPaymentSessionExpired(expiresAt: unknown, now = Date.now()): boolean {
  if (typeof expiresAt !== 'string' || !expiresAt) return false;
  const expiryTime = Date.parse(expiresAt);
  return Number.isFinite(expiryTime) && expiryTime <= now;
}

export function getGroupPaymentTransactionToUnwind(appointment: CheckoutAppointmentState): string | null {
  return appointment.status === 'awaiting_payment' && appointment.paymentTransactionId
    ? appointment.paymentTransactionId
    : null;
}

export function assertGroupPaymentTotalsConsistent(
  allocations: Array<{ appointmentId?: string; collectedAmount?: number }>,
  sessionAmountDue: unknown,
  paymentTotalAmount: unknown
): void {
  const ids = allocations.map(item => item.appointmentId || '');
  const allocatedTotal = allocations.reduce((sum, item) => sum + Number(item.collectedAmount ?? Number.NaN), 0);
  const expectedTotal = Number(paymentTotalAmount);
  if (
    allocations.length < 2 ||
    ids.some(id => !id) ||
    new Set(ids).size !== ids.length ||
    !Number.isFinite(expectedTotal) ||
    Number(sessionAmountDue) !== expectedTotal ||
    allocatedTotal !== expectedTotal
  ) {
    throw new Error('Dữ liệu phân bổ hoặc tổng tiền của QR nhóm không còn nhất quán');
  }
}
