import React, { useState, useEffect, useRef } from 'react';
import { Appointment, Customer, PromotionCode, SystemSettings } from '@shared/types';
import { X, CheckCircle, Wallet, QrCode } from 'lucide-react'; // Replace some lucide icons if needed, e.g. QrCode
import { QrCode as QrCodeIcon, Banknote } from 'lucide-react';
import { QRDisplay } from './QRDisplay';
import { getDb, triggerSyncSignal } from '@/shared/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

const isPromotionAvailable = (code: PromotionCode): boolean => code.active;

const calculatePromotionDiscount = (subtotal: number, promotion?: PromotionCode): number =>
  promotion ? Math.round(Math.max(0, subtotal) * promotion.discountPercent / 100) : 0;

interface CheckoutPayload {
  appointmentId: string;
  paymentMethod: 'transfer' | 'cash' | 'wallet';
  depositUsed: number;
  amountDue: number;
  totalPrice: number;
  useDeposit: boolean;
  promotionCode?: string;
}

interface CheckoutModalProps {
  appointment: Appointment;
  customer?: Customer;
  systemSettings?: SystemSettings;
  authToken?: string;
  onConfirm: (payload: CheckoutPayload) => Promise<void>;
  onClose: () => void;
  onInvalidateHistoricalCache?: () => void;
}

export function CheckoutModal({ appointment, customer, systemSettings, authToken, onConfirm, onClose, onInvalidateHistoricalCache }: CheckoutModalProps) {
  const walletBalance = customer?.walletBalance || 0;

  const hasAssignedDeposit = appointment.assignedDepositAmount !== undefined && appointment.assignedDepositAmount !== null;
  const assignedDepositAmount = hasAssignedDeposit ? Number(appointment.assignedDepositAmount) : 0;
  const isAssignedDepositValid = Number.isFinite(assignedDepositAmount) && assignedDepositAmount >= 0;
  const isBalanceSufficient = !hasAssignedDeposit || (isAssignedDepositValid && walletBalance >= assignedDepositAmount);

  // Pre-fill từ lịch hẹn, mặc định là true (khấu trừ)
  const [useDeposit, setUseDeposit] = useState<boolean>(() => {
    if (hasAssignedDeposit) {
      return isBalanceSufficient ? (appointment.useDeposit ?? true) : false;
    }
    return walletBalance > 0 ? (appointment.useDeposit ?? true) : false;
  });

  const [paymentCode, setPaymentCode] = useState<string | null>(() => {
    if (appointment.status === 'awaiting_payment' && appointment.paymentCode && appointment.paymentMethod === 'transfer') {
      return appointment.paymentCode;
    }
    return null;
  });

  const [paymentMethod, setPaymentMethod] = useState<'transfer' | 'cash' | 'wallet' | null>(() => {
    if (appointment.status === 'awaiting_payment' && appointment.paymentMethod) {
      return appointment.paymentMethod as any;
    }
    return null;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelQrConfirm, setShowCancelQrConfirm] = useState(false);
  const [cancelQrError, setCancelQrError] = useState('');
  const [totalPriceOverride, setTotalPriceOverride] = useState<number>(appointment.totalPrice || 0);
  const [promotionCodes, setPromotionCodes] = useState<PromotionCode[]>([]);
  const [promotionCode, setPromotionCode] = useState(appointment.discountCode || '');
  const availablePromotionCodes = promotionCodes.filter(isPromotionAvailable);
  const selectedPromotion = availablePromotionCodes.find(item => item.code === promotionCode);
  const discountPreview = calculatePromotionDiscount(totalPriceOverride, selectedPromotion);
  const totalAfterDiscount = Math.max(0, totalPriceOverride - discountPreview);
  const isAssignedDepositOverTotal = hasAssignedDeposit && isAssignedDepositValid && assignedDepositAmount > totalAfterDiscount;

  const isLocked = paymentCode !== null;

  // Calculate deposit used and amount due
  const depositUsed = useDeposit
    ? (hasAssignedDeposit ? assignedDepositAmount : Math.min(walletBalance, totalAfterDiscount))
    : 0;

  const amountDue = Math.max(0, totalAfterDiscount - depositUsed);
  const checkoutValidationError = !isAssignedDepositValid
    ? "Số tiền cọc được gán không hợp lệ."
    : isAssignedDepositOverTotal
      ? `Số tiền cọc được gán (${assignedDepositAmount.toLocaleString()}đ) không được lớn hơn giá sau giảm (${totalAfterDiscount.toLocaleString()}đ).`
      : null;

  useEffect(() => {
    fetch('/api/promotion-codes', { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} })
      .then(response => response.ok ? response.json() : { codes: [] })
      .then(data => setPromotionCodes(Array.isArray(data.codes) ? data.codes : []))
      .catch(() => setPromotionCodes([]));
  }, [authToken]);

  const validateCheckout = () => {
    if (checkoutValidationError) {
      alert(checkoutValidationError);
      return false;
    }
    return true;
  };

  const handleCreateQR = async () => {
    if (!validateCheckout()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          appointmentId: appointment.id,
          paymentMethod: 'transfer',
          totalPrice: totalPriceOverride,
          useDeposit: useDeposit,
          promotionCode: promotionCode || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        setPaymentCode(data.paymentCode);
        console.log(`[CheckoutModal] Đã tạo thành công payment session với code: ${data.paymentCode}`);
      } else {
        alert("Lỗi tạo mã QR: " + data.error);
      }
    } catch (err) {
      console.error("Lỗi kết nối khi gọi API checkout:", err);
      alert("Không thể kết nối tới máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelQR = async () => {
    if (!paymentCode) return;

    setIsSubmitting(true);
    setCancelQrError('');
    try {
      const res = await fetch('/api/checkout-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({
          appointmentId: appointment.id,
          paymentCode: paymentCode
        })
      });
      const data = await res.json();
      if (data.success) {
        setPaymentCode(null);
        setShowCancelQrConfirm(false);
        console.log(`[CheckoutModal] Đã hủy thành công phiên thanh toán.`);
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;
        if (appointment.date && appointment.date < todayStr) {
          onInvalidateHistoricalCache?.();
        }
      } else {
        setCancelQrError(data.error || 'Không thể hủy phiên chuyển khoản.');
      }
    } catch (err) {
      console.error("Lỗi kết nối khi hủy QR:", err);
      setCancelQrError('Không thể kết nối tới máy chủ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (!validateCheckout()) return;

    let finalMethod = paymentMethod;
    if (amountDue === 0 && useDeposit) {
      finalMethod = 'wallet';
    }

    if (!finalMethod) {
      alert("Vui lòng chọn phương thức thanh toán cho phần còn lại.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        appointmentId: appointment.id,
        paymentMethod: finalMethod,
        depositUsed,
        amountDue,
        totalPrice: totalPriceOverride,
        useDeposit,
        promotionCode: promotionCode || undefined,
      });
    } catch (err) {
      console.error(err);
      alert("Có lỗi xảy ra khi xác nhận!");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-xl font-bold text-gray-900">
            {paymentCode ? 'Chờ xác nhận chuyển khoản' : 'Xác nhận & chốt bill'}
          </h2>
          <button onClick={onClose} className="p-2 bg-white rounded-full text-gray-500 hover:text-gray-900 shadow-sm transition-colors" disabled={isSubmitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-6">
          {/* TỔNG HÓA ĐƠN */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Chi tiết dịch vụ</h3>
            <div className="space-y-2 bg-gray-50 p-4 rounded-lg border border-gray-100">
              {appointment.services?.map((srv, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm">
                  <span className="text-gray-700">{srv.name}</span>
                  <span className="font-medium text-gray-900">{(srv.price || 0).toLocaleString()}đ</span>
                </div>
              ))}
              {appointment.extraServices?.map((srv, idx) => (
                <div key={`extra-${idx}`} className="flex justify-between items-center text-sm">
                  <span className="text-gray-700">+ {srv.name}</span>
                  <span className="font-medium text-gray-900">{(srv.price || 0).toLocaleString()}đ</span>
                </div>
              ))}
              
              <div className="pt-3 mt-3 border-t border-gray-200 flex flex-col gap-2">
                <label className="text-xs font-bold text-gray-500 uppercase">Thợ chốt giá cuối (VND)</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={totalPriceOverride || ''}
                    disabled={isSubmitting || isLocked}
                    onChange={(e) => setTotalPriceOverride(Number(e.target.value) || 0)}
                    className="w-full bg-white border border-gray-300 focus:border-accent focus:ring-1 focus:ring-accent rounded-lg p-2.5 px-3.5 text-base font-bold text-gray-900 focus:outline-hidden disabled:bg-gray-100 disabled:text-gray-500"
                  />
                  {checkoutValidationError && (
                    <p className="mt-2 text-xs font-bold text-red-600">
                      ⚠️ {checkoutValidationError}
                    </p>
                  )}
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">
                    đ
                  </span>
                </div>
                {!isLocked && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {[100000, 150000, 200000, 300000, 500000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTotalPriceOverride(val)}
                        className="px-2 py-1 bg-white border border-gray-200 rounded text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        {val.toLocaleString()}đ
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Mã giảm giá</h3>
            <select
              value={promotionCode}
              disabled={isSubmitting || isLocked}
              onChange={event => setPromotionCode(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm font-bold text-gray-900 disabled:bg-gray-100"
            >
              <option value="">Không áp dụng mã</option>
              {availablePromotionCodes.map(item => <option key={item.id} value={item.code}>{item.code} · Giảm {item.discountPercent}%</option>)}
            </select>
            {selectedPromotion && <p className="mt-2 text-xs font-semibold text-emerald-700">Giảm {discountPreview.toLocaleString()}đ. Hoa hồng thợ vẫn tính trên {totalPriceOverride.toLocaleString()}đ.</p>}
          </div>

          {/* VÍ CỌC */}
          {(walletBalance > 0 || (appointment.assignedDepositAmount !== undefined && appointment.assignedDepositAmount > 0)) && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Ví cọc của khách</h3>
              <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-blue-600" />
                    <span className="font-semibold text-blue-900 text-sm">Tiền cọc đã đặt:</span>
                  </div>
                  <span className="font-bold text-blue-750 font-mono">{walletBalance.toLocaleString()}đ</span>
                </div>
                
                <div className="space-y-2">
                  {hasAssignedDeposit ? (
                    <>
                      <div className="flex justify-between items-center bg-white p-2.5 rounded-md border border-blue-100 text-xs">
                        <span className="text-gray-600 font-bold">Số tiền cọc gán cho đơn này:</span>
                        <span className="font-extrabold text-blue-800 font-mono">{assignedDepositAmount.toLocaleString()}đ</span>
                      </div>
                      <label className={`flex items-center gap-3 p-3 bg-white rounded-md border border-blue-100 transition-colors ${(!isBalanceSufficient || isLocked) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          checked={useDeposit === true}
                          onChange={(e) => {
                            if (isBalanceSufficient && !isLocked) {
                              setUseDeposit(e.target.checked);
                            }
                          }}
                          disabled={isSubmitting || !isBalanceSufficient || isLocked}
                        />
                        <div className="flex-1">
                          <span className="block font-bold text-gray-950 text-xs">Khấu trừ cọc</span>
                          <span className="block text-[10px] text-muted-foreground mt-0.5">Khấu trừ đúng số tiền cọc đã gán cho đơn này</span>
                        </div>
                      </label>
                      {!isBalanceSufficient && (
                        <div className="p-2.5 bg-red-50 border border-red-100 text-red-700 text-xs rounded font-bold">
                          ⚠️ Số dư ví không đủ ({walletBalance.toLocaleString()}đ {"<"} {assignedDepositAmount.toLocaleString()}đ), không thể khấu trừ.
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <label className={`flex items-center gap-3 p-3 bg-white rounded-md border border-blue-100 transition-colors ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input 
                          type="radio" 
                          name="useDeposit"
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          checked={useDeposit === true}
                          onChange={() => !isLocked && setUseDeposit(true)}
                          disabled={isSubmitting || isLocked}
                        />
                        <div className="flex-1">
                          <span className="block font-bold text-gray-950 text-xs">Khấu trừ vào bill</span>
                          <span className="block text-[10px] text-muted-foreground mt-0.5">Mặc định trừ tiền cọc đã trả trước vào hóa đơn lần này</span>
                        </div>
                      </label>

                      <label className={`flex items-center gap-3 p-3 bg-white rounded-md border border-blue-100 transition-colors ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input 
                          type="radio" 
                          name="useDeposit"
                          className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          checked={useDeposit === false}
                          onChange={() => !isLocked && setUseDeposit(false)}
                          disabled={isSubmitting || isLocked}
                        />
                        <div className="flex-1">
                          <span className="block font-bold text-gray-950 text-xs">Giữ cọc cho lần sau (Ngoại lệ)</span>
                          <span className="block text-[10px] text-muted-foreground mt-0.5">Chỉ khi khách yêu cầu giữ lại để cọc cho lần sau</span>
                        </div>
                      </label>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SỐ TIỀN CÒN LẠI & CHỌN PHƯƠNG THỨC */}
          <div className="pt-2 border-t border-gray-100 space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 space-y-2">
              <div className="flex justify-between items-center text-sm text-gray-600">
                <span>Tổng bill:</span>
                <span className="font-bold text-gray-900 font-mono">{totalPriceOverride.toLocaleString()}đ</span>
              </div>
              {discountPreview > 0 && (
                <div className="flex justify-between items-center text-sm text-emerald-700 font-semibold animate-fade-in">
                  <span>Giảm giá {promotionCode}:</span>
                  <span className="font-mono">-{discountPreview.toLocaleString()}đ</span>
                </div>
              )}
              
              {useDeposit && depositUsed > 0 && (
                <div className="flex justify-between items-center text-sm text-blue-700 font-semibold animate-fade-in">
                  <span>Khấu trừ cọc:</span>
                  <span className="font-mono">-{depositUsed.toLocaleString()}đ</span>
                </div>
              )}
              
              <div className="pt-2 border-t border-gray-200 flex justify-between items-center text-sm font-bold text-gray-900">
                <span>Còn lại cần thu:</span>
                <span className="text-xl font-extrabold text-red-600 font-mono">{amountDue.toLocaleString()}đ</span>
              </div>
            </div>

            {amountDue > 0 ? (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Chọn phương thức thu</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => !isLocked && setPaymentMethod('transfer')}
                    disabled={isSubmitting || isLocked}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all ${
                      paymentMethod === 'transfer' 
                        ? 'border-accent bg-accent/5 text-accent animate-pulse' 
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    } ${isLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    <QrCodeIcon className="w-6 h-6 mb-1.5" />
                    <span className="font-bold text-xs">Chuyển khoản QR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => !isLocked && setPaymentMethod('cash')}
                    disabled={isSubmitting || isLocked}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all ${
                      paymentMethod === 'cash' 
                        ? 'border-accent bg-accent/5 text-accent' 
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    } ${isLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    <Banknote className="w-6 h-6 mb-1.5" />
                    <span className="font-bold text-xs">Tiền mặt</span>
                  </button>
                </div>
                {paymentMethod === 'transfer' && paymentCode && (
                  <div className="mt-4">
                    <QRDisplay
                      appointment={appointment}
                      amountDue={amountDue}
                      paymentCode={paymentCode}
                      systemSettings={systemSettings}
                      onPaymentSuccess={handleConfirm}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-emerald-50 text-emerald-700 p-4 rounded-lg flex items-center justify-center gap-2 border border-emerald-100">
                <CheckCircle className="w-5 h-5 animate-bounce" />
                <span className="font-semibold text-sm">Đã thanh toán đủ bằng ví cọc</span>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 flex flex-col gap-2">
          {paymentMethod === 'transfer' ? (
            !paymentCode ? (
              <button
                onClick={handleCreateQR}
                disabled={isSubmitting || !!checkoutValidationError}
                className="w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 transition-all shadow-md bg-accent hover:bg-accent/90 text-white active:scale-[0.98] disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <span className="inline-block w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>Tạo mã QR</>
                )}
              </button>
            ) : (
              showCancelQrConfirm ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-extrabold text-red-900">Hủy phiên chuyển khoản?</p>
                  <p className="mt-1 text-xs leading-relaxed text-red-800">
                    Mã QR hiện tại sẽ mất hiệu lực, bill được mở lại và tiền cọc đã khấu trừ sẽ được hoàn về ví.
                  </p>
                  {cancelQrError && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-white p-2 text-xs font-semibold text-red-700">
                      {cancelQrError}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCancelQrConfirm(false);
                        setCancelQrError('');
                      }}
                      disabled={isSubmitting}
                      className="min-h-[46px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                    >
                      Quay lại
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelQR}
                      disabled={isSubmitting}
                      className="flex min-h-[46px] items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        <>
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Đang hủy...
                        </>
                      ) : (
                        'Xác nhận hủy'
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCancelQrError('');
                    setShowCancelQrConfirm(true);
                  }}
                  disabled={isSubmitting}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-extrabold text-red-700 transition-all hover:bg-red-50 active:scale-[0.98]"
                >
                  Hủy phiên chuyển khoản
                </button>
              )
            )
          ) : (
            <button
              onClick={handleConfirm}
              disabled={isSubmitting || !!checkoutValidationError || (amountDue > 0 && !paymentMethod)}
              className={`w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 transition-all shadow-md ${
                isSubmitting || !!checkoutValidationError || (amountDue > 0 && !paymentMethod)
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-accent hover:bg-accent/90 text-white active:scale-[0.98]'
              }`}
            >
              {isSubmitting ? (
                <span className="inline-block w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>Xác nhận hoàn thành</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
