import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  ChevronLeft,
  QrCode,
  ReceiptText,
  Scissors,
  User,
  Wallet,
  X
} from 'lucide-react';
import { Appointment, Customer, NailService, PromotionCode, Staff, SystemSettings } from '@shared/types';
import { QRDisplay } from './QRDisplay';
import { AuthenticatedUserSession, getAuthHeaders } from '@/shared/lib/auth';

const isPromotionAvailable = (code: PromotionCode): boolean => code.active;

const calculatePromotionDiscount = (subtotal: number, promotion?: PromotionCode): number =>
  promotion ? Math.round(Math.max(0, subtotal) * promotion.discountPercent / 100) : 0;

export type CheckoutScopeRequest = 'auto' | 'group' | 'single';

export interface CheckoutSelection {
  scope: 'group' | 'single';
  appointmentIds: string[];
}

interface GroupPaymentRow {
  billAmount: number;
  discountAmount?: number;
  totalAfterDiscount?: number;
  depositUsed: number;
}

const isAppointmentAwaitingPayment = (appointment: Appointment): boolean =>
  appointment.status === 'awaiting_payment' ||
  appointment.pendingStatusApproval === 'completed';

const isAvailableForNewCheckout = (appointment: Appointment): boolean =>
  appointment.status !== 'completed' &&
  appointment.status !== 'cancelled' &&
  appointment.status !== 'deleted' &&
  !isAppointmentAwaitingPayment(appointment);

export function resolveCheckoutSelection(
  appointments: Appointment[],
  selectedAppointment: Appointment,
  requestedScope: CheckoutScopeRequest = 'auto'
): CheckoutSelection {
  const payableGroup = selectedAppointment.groupId
    ? appointments.filter(appointment =>
        appointment.groupId === selectedAppointment.groupId &&
        isAvailableForNewCheckout(appointment)
      )
    : [];
  const shouldOpenGroup = requestedScope !== 'single' && payableGroup.length > 1;

  return {
    scope: shouldOpenGroup ? 'group' : 'single',
    appointmentIds: shouldOpenGroup
      ? payableGroup.map(appointment => appointment.id)
      : [selectedAppointment.id]
  };
}

export function resolvePinnedGroupAppointments(
  appointments: Appointment[],
  appointmentIds: string[]
): Appointment[] {
  const appointmentsById = new Map(appointments.map(appointment => [appointment.id, appointment]));
  return appointmentIds
    .map(id => appointmentsById.get(id))
    .filter((appointment): appointment is Appointment => Boolean(appointment));
}

export function calculateGroupPaymentTotals(rows: GroupPaymentRow[]) {
  const totalPrice = rows.reduce((sum, row) => sum + row.billAmount, 0);
  const discountAmount = rows.reduce((sum, row) => sum + (row.discountAmount || 0), 0);
  const totalAfterDiscount = rows.reduce((sum, row) => sum + (row.totalAfterDiscount ?? row.billAmount), 0);
  const depositUsed = rows.reduce((sum, row) => sum + row.depositUsed, 0);

  return {
    totalPrice,
    discountAmount,
    totalAfterDiscount,
    depositUsed,
    amountDue: Math.max(0, totalAfterDiscount - depositUsed)
  };
}

interface GroupCheckoutModalProps {
  appointments: Appointment[];
  customers: Customer[];
  services: NailService[];
  staff: Staff[];
  currentUser?: AuthenticatedUserSession | null;
  systemSettings?: SystemSettings;
  onPaymentSubmitted: () => void;
  onClose: () => void;
}

interface BillDraft {
  totalPrice: number | '';
  staffId: string;
  useDeposit: boolean;
  promotionCode: string;
}

type CheckoutStep = 'details' | 'payment' | 'qr';
type PaymentMethod = 'cash' | 'transfer';

const formatMoney = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;

export function GroupCheckoutModal({
  appointments,
  customers,
  services,
  staff,
  currentUser,
  systemSettings,
  onPaymentSubmitted,
  onClose
}: GroupCheckoutModalProps) {
  const [drafts, setDrafts] = useState<Record<string, BillDraft>>(() =>
    Object.fromEntries(appointments.map(appt => [
      appt.id,
      {
        totalPrice: Number(appt.totalPrice) > 0 ? Number(appt.totalPrice) : '',
        staffId: appt.staffId || '',
        useDeposit: appt.useDeposit ?? true,
        promotionCode: appt.discountCode || ''
      }
    ]))
  );
  const [step, setStep] = useState<CheckoutStep>('details');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [paymentCode, setPaymentCode] = useState<string | null>(null);
  const [serverAmountDue, setServerAmountDue] = useState<number | null>(null);
  const [promotionCodes, setPromotionCodes] = useState<PromotionCode[]>([]);
  const availablePromotionCodes = useMemo(() => promotionCodes.filter(isPromotionAvailable), [promotionCodes]);

  useEffect(() => {
    fetch('/api/promotion-codes', { headers: getAuthHeaders(currentUser) })
      .then(response => response.ok ? response.json() : { codes: [] })
      .then(data => setPromotionCodes(Array.isArray(data.codes) ? data.codes : []))
      .catch(() => setPromotionCodes([]));
  }, [currentUser]);

  const activeStaff = useMemo(() => staff.filter(member =>
    member.status === 'active' && !member.role.toLowerCase().includes('support')
  ), [staff]);

  const customer = useMemo(() => {
    const first = appointments[0];
    return customers.find(item => item.id === first?.customerId);
  }, [appointments, customers]);

  const getServiceNames = (appt: Appointment) => {
    const embeddedNames = (appt.services || []).map(service => service.name).filter(Boolean);
    const selectedNames = (appt.serviceIds || [])
      .map(serviceId => services.find(service => service.id === serviceId)?.name)
      .filter((name): name is string => Boolean(name));
    const extraNames = (appt.extraServices || []).map(service => service.name).filter(Boolean);
    const names = embeddedNames.length > 0 ? embeddedNames : selectedNames;
    return [...names, ...extraNames].join(', ') || 'Dịch vụ chưa đặt tên';
  };

  const summary = useMemo(() => {
    const remainingWallet = new Map(customers.map(item => [item.id, Number(item.walletBalance) || 0]));
    const rows = appointments.map(appt => {
      const draft = drafts[appt.id];
      const price = draft?.totalPrice === '' ? 0 : Math.max(0, Number(draft?.totalPrice) || 0);
      const promotion = availablePromotionCodes.find(item => item.code === draft?.promotionCode);
      const discountAmount = calculatePromotionDiscount(price, promotion);
      const totalAfterDiscount = Math.max(0, price - discountAmount);
      let rowDeposit = 0;

      if (draft?.useDeposit && appt.customerId && remainingWallet.has(appt.customerId)) {
        const available = remainingWallet.get(appt.customerId) || 0;
        const hasAssignedDeposit = appt.assignedDepositAmount !== undefined && appt.assignedDepositAmount !== null;
        const requested = hasAssignedDeposit
          ? Number(appt.assignedDepositAmount) || 0
          : Math.min(available, totalAfterDiscount);
        rowDeposit = Math.min(available, totalAfterDiscount, requested);
        remainingWallet.set(appt.customerId, available - rowDeposit);
      }

      return {
        appointmentId: appt.id,
        serviceName: getServiceNames(appt),
        staffName: activeStaff.find(member => member.id === draft?.staffId)?.name || 'Chưa chọn thợ',
        billAmount: price,
        discountAmount,
        totalAfterDiscount,
        depositUsed: rowDeposit,
        amountDue: totalAfterDiscount - rowDeposit
      };
    });

    return { rows, ...calculateGroupPaymentTotals(rows) };
  }, [activeStaff, appointments, availablePromotionCodes, customers, drafts, services]);

  const rowError = (appt: Appointment) => {
    const draft = drafts[appt.id];
    return {
      staff: !draft?.staffId ? 'Cần chọn thợ' : '',
      price: draft?.totalPrice === '' || !Number.isFinite(Number(draft.totalPrice)) || Number(draft.totalPrice) < 0
        ? 'Cần chốt giá'
        : '',
      deposit: draft?.totalPrice !== '' && draft?.useDeposit &&
        (Number(appt.assignedDepositAmount) || 0) > (summary.rows.find(row => row.appointmentId === appt.id)?.totalAfterDiscount || 0)
        ? 'Tiền cọc lớn hơn giá chốt'
        : ''
    };
  };

  const validationError = appointments.some(appt => {
    const errors = rowError(appt);
    return Boolean(errors.staff || errors.price || errors.deposit);
  });

  const goToPayment = () => {
    setShowValidation(true);
    setSubmitError('');
    if (validationError) return;
    setStep('payment');
  };

  const submitCheckout = async () => {
    if (!paymentMethod && summary.amountDue > 0) return;
    if (validationError) {
      setStep('details');
      setShowValidation(true);
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    try {
      const method = summary.amountDue === 0 ? 'wallet' : paymentMethod;
      const response = await fetch('/api/group-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(currentUser) },
        body: JSON.stringify({
          paymentMethod: method,
          allocations: appointments.map(appt => ({
            appointmentId: appt.id,
            totalPrice: Number(drafts[appt.id].totalPrice),
            staffId: drafts[appt.id].staffId,
            useDeposit: drafts[appt.id].useDeposit,
            promotionCode: drafts[appt.id].promotionCode || undefined
          }))
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Không thể tạo phiên thanh toán');

      if (paymentMethod === 'transfer' && data.paymentCode && data.finalAmountDue > 0) {
        setPaymentCode(data.paymentCode);
        setServerAmountDue(data.finalAmountDue);
        setStep('qr');
      } else {
        onPaymentSubmitted();
      }
    } catch (error: any) {
      setSubmitError(error.message || 'Không thể kết nối máy chủ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelQr = async () => {
    if (!paymentCode) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/checkout-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(currentUser) },
        body: JSON.stringify({ appointmentId: appointments[0].id, paymentCode })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Không thể hủy mã QR');
      setPaymentCode(null);
      setServerAmountDue(null);
      setStep('payment');
    } catch (error: any) {
      setSubmitError(error.message || 'Không thể hủy mã QR.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeDisabled = isSubmitting || step === 'qr';
  const displayCustomerName = appointments[0]?.customerName || customer?.name || 'Khách hàng';
  const displayCustomerPhone = appointments[0]?.customerPhone || customer?.phone || '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-card px-5 py-4">
          <div>
            <h2 className="font-serif text-xl font-bold text-foreground">
              {step === 'details' ? 'Chọn thợ & chốt giá' : step === 'payment' ? 'Xác nhận thanh toán' : 'Chờ xác nhận SePay'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Thanh toán toàn bộ lịch nhóm</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Đóng"
            className="rounded-full border border-border bg-white p-2 text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-border bg-background px-5 py-4">
          <div className="mx-auto grid max-w-2xl grid-cols-3">
            {[
              { key: 'booking', label: 'Lịch dịch vụ', done: true },
              { key: 'details', label: 'Thợ & giá', done: step !== 'details' },
              { key: 'payment', label: 'Thanh toán', done: false }
            ].map((item, index) => {
              const active = item.key === 'details' ? step === 'details' : item.key === 'payment' ? step !== 'details' : false;
              return (
                <div key={item.key} className={`relative flex flex-col items-center gap-1.5 text-center text-[11px] font-bold ${active ? 'text-accent' : 'text-muted-foreground'}`}>
                  <span className={`grid h-7 w-7 place-items-center rounded-full border ${item.done || active ? 'border-accent bg-accent text-white' : 'border-border bg-white'}`}>
                    {item.done ? <Check className="h-4 w-4" /> : index + 1}
                  </span>
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="overflow-hidden rounded-xl border-2 border-accent/60 bg-white">
            <div className="flex flex-col gap-3 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-accent shadow-sm"><User className="h-5 w-5" /></span>
                <div>
                  <p className="font-serif font-bold text-foreground">{displayCustomerName}</p>
                  <p className="text-xs text-muted-foreground">{displayCustomerPhone || 'Chưa có số điện thoại'} · {appointments.length} dịch vụ trong nhóm</p>
                </div>
              </div>
              <span className="self-start rounded-full bg-white px-3 py-1 text-xs font-bold text-accent sm:self-auto">Một khách hàng</span>
            </div>

            {step === 'details' && (
              <div>
                <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(150px,1fr)_minmax(140px,.8fr)] gap-3 border-b border-border px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:grid">
                  <span>Dịch vụ</span><span>Thợ thực hiện</span><span>Giá chốt</span>
                </div>
                {appointments.map((appt, index) => {
                  const draft = drafts[appt.id];
                  const errors = rowError(appt);
                  const rowSummary = summary.rows.find(row => row.appointmentId === appt.id);
                  return (
                    <div key={appt.id} className="grid gap-3 border-b border-border p-4 last:border-b-0 sm:grid-cols-[minmax(0,1.25fr)_minmax(150px,1fr)_minmax(140px,.8fr)]">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-accent"><Scissors className="h-4 w-4" /></span>
                        <div className="min-w-0">
                          <p className="font-bold text-foreground">{getServiceNames(appt)}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{appt.time} · {appt.date} · Lịch {index + 1}</p>
                          {rowSummary && rowSummary.depositUsed > 0 && (
                            <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-sky-700"><Wallet className="h-3 w-3" /> Trừ cọc {formatMoney(rowSummary.depositUsed)}</p>
                          )}
                        </div>
                      </div>

                      <label className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:hidden">Thợ thực hiện</span>
                        <select
                          value={draft.staffId}
                          onChange={event => setDrafts(current => ({ ...current, [appt.id]: { ...current[appt.id], staffId: event.target.value } }))}
                          className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-foreground outline-none focus:border-accent ${showValidation && errors.staff ? 'border-rose-400' : 'border-border'}`}
                        >
                          <option value="">Chọn thợ</option>
                          {activeStaff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                        </select>
                        <span className="block min-h-4 text-[11px] font-semibold text-rose-600">{showValidation ? errors.staff : ''}</span>
                      </label>

                      <label className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:hidden">Giá chốt</span>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            step="1000"
                            inputMode="numeric"
                            placeholder="Nhập giá"
                            value={draft.totalPrice}
                            onChange={event => setDrafts(current => ({
                              ...current,
                              [appt.id]: {
                                ...current[appt.id],
                                totalPrice: event.target.value === '' ? '' : Number(event.target.value)
                              }
                            }))}
                            className={`w-full rounded-lg border bg-white px-3 py-2.5 pr-8 text-sm font-bold text-foreground outline-none focus:border-accent ${showValidation && (errors.price || errors.deposit) ? 'border-rose-400' : 'border-border'}`}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">đ</span>
                        </div>
                        <span className="block min-h-4 text-[11px] font-semibold text-rose-600">{showValidation ? errors.price || errors.deposit : ''}</span>
                      </label>

                      <label className="space-y-1 sm:col-start-2 sm:col-end-4">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Mã giảm giá cho bill này</span>
                        <select
                          value={draft.promotionCode}
                          onChange={event => setDrafts(current => ({ ...current, [appt.id]: { ...current[appt.id], promotionCode: event.target.value } }))}
                          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-accent"
                        >
                          <option value="">Không áp dụng mã</option>
                          {availablePromotionCodes.map(item => <option key={item.id} value={item.code}>{item.code} · Giảm {item.discountPercent}%</option>)}
                        </select>
                        {rowSummary && rowSummary.discountAmount > 0 && <span className="block text-[11px] font-semibold text-emerald-700">Giảm {formatMoney(rowSummary.discountAmount)} · Hoa hồng tính trên giá gốc {formatMoney(rowSummary.billAmount)}</span>}
                      </label>

                      {(Number(appt.assignedDepositAmount) || 0) > 0 && (
                        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted-foreground sm:col-start-2 sm:col-end-4">
                          <input
                            type="checkbox"
                            checked={draft.useDeposit}
                            onChange={event => setDrafts(current => ({ ...current, [appt.id]: { ...current[appt.id], useDeposit: event.target.checked } }))}
                            className="h-4 w-4 rounded border-border"
                          />
                          Khấu trừ {formatMoney(Number(appt.assignedDepositAmount))} tiền cọc cho dịch vụ này
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {step === 'payment' && (
              <div>
                <div className="divide-y divide-border">
                  {summary.rows.map(row => (
                    <div key={row.appointmentId} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5">
                      <p className="font-bold text-foreground">{row.serviceName}</p>
                      <p className="text-xs text-muted-foreground">Thợ {row.staffName}</p>
                      <div className="text-left sm:text-right">
                        <p className="font-mono text-sm font-bold text-foreground">{formatMoney(row.billAmount)}</p>
                        {row.discountAmount > 0 && <p className="text-[10px] font-semibold text-emerald-700">Mã giảm -{formatMoney(row.discountAmount)}</p>}
                        {row.depositUsed > 0 && <p className="text-[10px] font-semibold text-sky-700">Cọc -{formatMoney(row.depositUsed)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {summary.amountDue > 0 && (
                  <div className="border-t border-border p-4">
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Phương thức thanh toán</p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        aria-pressed={paymentMethod === 'cash'}
                        onClick={() => setPaymentMethod('cash')}
                        className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-bold transition ${paymentMethod === 'cash' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-white text-foreground'}`}
                      >
                        <Banknote className="h-5 w-5" /> Tiền mặt
                      </button>
                      <button
                        type="button"
                        aria-pressed={paymentMethod === 'transfer'}
                        onClick={() => setPaymentMethod('transfer')}
                        className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-bold transition ${paymentMethod === 'transfer' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-white text-foreground'}`}
                      >
                        <QrCode className="h-5 w-5" /> SePay QR
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 'qr' && paymentCode && (
              <div className="p-4 sm:p-5">
                <QRDisplay
                  appointment={appointments[0]}
                  amountDue={serverAmountDue ?? summary.amountDue}
                  paymentCode={paymentCode}
                  systemSettings={systemSettings}
                  onPaymentSuccess={onPaymentSubmitted}
                />
              </div>
            )}

            {step !== 'qr' && (
              <div className="flex flex-col gap-2 border-t border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{step === 'details' ? 'Tổng giá đã chốt' : 'Tổng cần thu'}</p>
                  <p className="font-mono text-xl font-extrabold text-accent">{formatMoney(step === 'details' ? summary.totalPrice : summary.amountDue)}</p>
                  {summary.discountAmount > 0 && <p className="text-[11px] font-semibold text-emerald-700">Tổng giảm giá {formatMoney(summary.discountAmount)}</p>}
                  {summary.depositUsed > 0 && <p className="text-[11px] font-semibold text-sky-700">Đã trừ tổng cọc {formatMoney(summary.depositUsed)}</p>}
                </div>
                {step === 'details' && <p className="text-xs font-semibold text-muted-foreground">{validationError ? 'Chưa hoàn tất thợ hoặc giá' : 'Sẵn sàng sang thanh toán'}</p>}
              </div>
            )}
          </div>

          {submitError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{submitError}</p>}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border bg-white p-4 sm:flex-row sm:justify-end">
          {step === 'details' && (
            <>
              <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-lg border border-border px-5 py-3 font-bold text-muted-foreground">Đóng</button>
              <button type="button" onClick={goToPayment} disabled={isSubmitting} className="flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 font-bold text-white disabled:opacity-50">
                Xác nhận & tiếp tục <ReceiptText className="h-5 w-5" />
              </button>
            </>
          )}
          {step === 'payment' && (
            <>
              <button type="button" onClick={() => setStep('details')} disabled={isSubmitting} className="flex items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 font-bold text-muted-foreground"><ChevronLeft className="h-4 w-4" /> Sửa thợ & giá</button>
              <button
                type="button"
                onClick={submitCheckout}
                disabled={isSubmitting || (summary.amountDue > 0 && !paymentMethod)}
                className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {paymentMethod === 'transfer' ? <QrCode className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                {isSubmitting ? 'Đang xử lý...' : summary.amountDue === 0 ? 'Hoàn tất bằng tiền cọc' : `Thanh toán ${formatMoney(summary.amountDue)}`}
              </button>
            </>
          )}
          {step === 'qr' && (
            <button type="button" onClick={cancelQr} disabled={isSubmitting} className="w-full rounded-lg border border-rose-200 px-5 py-3 font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              {isSubmitting ? 'Đang hủy...' : 'Hủy phiên chuyển khoản'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

