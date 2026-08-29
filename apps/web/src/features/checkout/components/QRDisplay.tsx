import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getDb } from '@/shared/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Appointment, SystemSettings } from '@shared/types';
import { CheckCircle2, QrCode, AlertCircle, Loader2 } from 'lucide-react';

interface QRDisplayProps {
  appointment: Appointment;
  amountDue: number;
  paymentCode: string;
  systemSettings?: SystemSettings;
  onPaymentSuccess?: () => void;
}

export function QRDisplay({ appointment, amountDue, paymentCode, systemSettings, onPaymentSuccess }: QRDisplayProps) {
  const [isPaid, setIsPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>('pending');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const transferContent = paymentCode;

  useEffect(() => {
    const db = getDb();
    if (!db) {
      setError("Không thể kết nối cơ sở dữ liệu. Vui lòng kiểm tra lại cấu hình Firebase.");
      return;
    }

    if (!paymentCode) {
      setError("Mã thanh toán không hợp lệ.");
      return;
    }

    console.log(`[QRDisplay] Bắt đầu lắng nghe trạng thái thanh toán cho mã: ${paymentCode}`);
    
    const unsub = onSnapshot(
      doc(db, 'payment_sessions', paymentCode),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setSessionStatus(String(data.status || 'pending'));
          setExpiresAt(typeof data.expiresAt === 'string' ? data.expiresAt : null);
          if (data.status === 'completed') {
            setIsPaid(true);
            if (onPaymentSuccess) {
              // Delay để thợ/khách kịp nhìn thấy hiệu ứng "Thanh toán thành công"
              setTimeout(() => {
                onPaymentSuccess();
              }, 2000);
            }
          }
          if (data.status === 'cancelled') setError('Phiên QR đã bị hủy. Không chuyển tiền bằng mã này.');
          if (data.status === 'expired') setError('Mã QR đã hết hạn. Bill đã được mở lại và cọc checkout đã được hoàn.');
          if (data.status === 'requires_reconciliation') {
            setError('Hệ thống đã nhận giao dịch sau khi QR hết hạn hoặc bị hủy. Vui lòng liên hệ quản lý để đối soát trước khi thao tác tiếp.');
          }
        }
      },
      (err) => {
        console.error("Lỗi khi lắng nghe trạng thái thanh toán:", err);
        setError("Không thể tự động cập nhật trạng thái thanh toán.");
      }
    );

    return () => unsub();
  }, [paymentCode, onPaymentSuccess]);

  useEffect(() => {
    if (!expiresAt || sessionStatus !== 'pending') {
      setRemainingSeconds(null);
      return;
    }
    const updateRemaining = () => {
      const expiryTime = Date.parse(expiresAt);
      setRemainingSeconds(Number.isFinite(expiryTime) ? Math.max(0, Math.ceil((expiryTime - Date.now()) / 1000)) : null);
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, sessionStatus]);

  const locallyExpired = sessionStatus === 'pending' && remainingSeconds === 0;
  if (sessionStatus === 'cancelled' || sessionStatus === 'expired' || sessionStatus === 'requires_reconciliation' || locallyExpired) {
    const needsReconciliation = sessionStatus === 'requires_reconciliation';
    return (
      <div className={`rounded-xl border p-5 text-sm ${needsReconciliation ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" />
          <div>
            <p className="font-extrabold">{needsReconciliation ? 'Giao dịch cần đối soát' : locallyExpired ? 'Mã QR vừa hết hạn' : 'Phiên QR không còn hiệu lực'}</p>
            <p className="mt-1 leading-relaxed">{error || 'Hệ thống đang mở lại bill và hoàn phần cọc đã giữ. Không tiếp tục chuyển tiền bằng mã này.'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!systemSettings?.bankId || !systemSettings?.bankAccountNumber) {
    return (
      <div className="p-4 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-2">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <div>
          <p className="font-bold mb-1">Chưa cấu hình ngân hàng nhận tiền</p>
          <p className="text-xs leading-relaxed text-amber-600">
            Vui lòng vào mục "Hệ thống" &gt; "Cài đặt chung" để điền đầy đủ thông tin Ngân hàng (Mã Ngân hàng, Số tài khoản, Tên chủ tài khoản) trước khi hiển thị mã chuyển khoản QR.
          </p>
        </div>
      </div>
    );
  }

  // Generate VietQR URL
  const vietQrUrl = `https://img.vietqr.io/image/${systemSettings.bankId}-${systemSettings.bankAccountNumber}-compact2.png?amount=${amountDue}&addInfo=${transferContent}&accountName=${encodeURIComponent(systemSettings.bankAccountName || '')}`;

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {!isPaid ? (
          <motion.div
            key="paying"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="p-5 border border-accent/25 rounded-xl bg-accent/5 flex flex-col items-center justify-center text-center relative overflow-hidden"
          >
            {/* Ambient subtle light pulse in background */}
            <div className="absolute inset-0 bg-radial-gradient from-accent/5 via-transparent to-transparent opacity-60 pointer-events-none" />

            <div className="relative mb-3 flex items-center justify-center">
              {/* Outer pulsing ring */}
              <span className="absolute inline-flex h-56 w-56 rounded-full bg-accent/10 animate-ping opacity-30" />
              
              <div className="relative p-2 bg-white rounded-xl shadow-md border border-gray-100">
                <img
                  src={vietQrUrl}
                  alt="VietQR"
                  className="w-48 h-48 rounded-lg select-none"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            <div className="mt-2 space-y-1 z-10">
              <span className="text-xs font-bold text-accent uppercase tracking-wider block">
                Mã Thanh Toán QR
              </span>
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight">
                {amountDue.toLocaleString()}đ
              </p>
            </div>

            <div className="mt-4 p-3 bg-white/80 backdrop-blur-xs rounded-lg border border-gray-200/50 w-full text-left space-y-1.5 z-10">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Ngân hàng:</span>
                <span className="font-bold text-gray-800">{systemSettings.bankId}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Số tài khoản:</span>
                <span className="font-bold text-gray-800">{systemSettings.bankAccountNumber}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Chủ tài khoản:</span>
                <span className="font-bold text-gray-800 uppercase">{systemSettings.bankAccountName || 'N/A'}</span>
              </div>
              <div className="border-t border-dashed border-gray-200 my-1 pt-1.5 flex justify-between text-xs">
                <span className="text-gray-500">Nội dung CK bắt buộc:</span>
                <span className="font-extrabold text-accent bg-accent/10 px-1.5 py-0.5 rounded-sm select-all">
                  {transferContent}
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-accent font-semibold z-10">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                Đang chờ chuyển khoản tự động qua SePay...
                {remainingSeconds !== null && ` Còn ${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`}
              </span>
            </div>

            {error && (
              <p className="mt-2.5 text-[11px] text-red-500 bg-red-50 px-2 py-1 rounded border border-red-100 font-medium">
                ⚠️ {error}
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 15 }}
            className="p-8 border border-emerald-200 rounded-xl bg-emerald-50/50 flex flex-col items-center justify-center text-center relative"
          >
            <div className="relative mb-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.2, 1] }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              >
                <CheckCircle2 className="w-16 h-16 text-emerald-600 fill-emerald-100" />
              </motion.div>
              {/* Confetti-like small visual points around the check */}
              <span className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-bounce" />
              <span className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="absolute top-4 -right-3 w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping" />
            </div>

            <h4 className="text-lg font-bold text-emerald-800 mb-1">
              Thanh Toán Thành Công!
            </h4>
            <p className="text-sm text-emerald-600/95 font-medium max-w-[280px]">
              Đã ghi nhận số tiền <span className="font-bold">{amountDue.toLocaleString()}đ</span> chuyển khoản cho đơn hàng.
            </p>

            <p className="text-xs text-emerald-500/80 mt-4 italic">
              Đang hoàn tất hóa đơn...
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
