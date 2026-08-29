import React, { useState } from 'react';
import { Appointment, NailService } from '@shared/types';
import { BarChart, TrendingUp, CalendarDays, Receipt, Scissors, Sparkles, Calendar } from 'lucide-react';
import { getRecentMonthsList } from '@/features/payroll/salary';

interface ReportDashboardProps {
  appointments: Appointment[];
  services: NailService[];
}

const getCurrentMonth = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`; // VD: '2026-07'
};

const toNonNegativeMoney = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

// Deposit is a payment source, not a discount: a bill paid 100% by deposit
// must still be counted as 100% service revenue.
const calculateRevenueBreakdown = (appointments: Appointment[]) => appointments.reduce(
  (totals, appointment) => {
    const depositUsed = toNonNegativeMoney(appointment.depositUsed);
    const recordedTotal = toNonNegativeMoney(appointment.totalPrice);
    const collectedFallback = toNonNegativeMoney(
      appointment.paymentCollectedAmount ?? appointment.amountDue
    );
    const invoiceTotal = recordedTotal || depositUsed + collectedFallback;
    const walletPart = Math.min(depositUsed, invoiceTotal);
    const nonWalletPart = Math.max(0, invoiceTotal - walletPart);

    totals.wallet += walletPart;
    if (appointment.paymentMethod === 'cash') {
      totals.cash += nonWalletPart;
    } else if (appointment.paymentMethod === 'transfer') {
      totals.transfer += nonWalletPart;
    } else if (appointment.paymentMethod === 'wallet') {
      totals.wallet += nonWalletPart;
    } else {
      totals.other += nonWalletPart;
    }
    totals.total += invoiceTotal;
    return totals;
  },
  { cash: 0, transfer: 0, wallet: 0, other: 0, total: 0 }
);

export default function ReportDashboard({ appointments, services }: ReportDashboardProps) {
  const [viewMode, setViewMode] = useState<'month' | 'day'>('day');
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const now = new Date();
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); // YYYY-MM-DD
  });
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [visibleReceiptCount, setVisibleReceiptCount] = useState(20);

  const monthOptions = [
    { value: 'all', label: 'Tất cả các tháng' },
    ...getRecentMonthsList()
  ];

  const formatCurrency = (val: number) => `${val.toLocaleString('vi-VN')} đ`;

  // Filter appointments based on selected month or day cycle
  const filteredAppts = appointments.filter(a => {
    if (viewMode === 'month') {
      if (selectedMonth === 'all') return true;
      return a.date.startsWith(selectedMonth);
    }
    if (viewMode === 'day') {
      return a.date === selectedDate;
    }
    return true;
  });

  const completedAppts = filteredAppts.filter(a => a.status === 'completed' || a.paymentStatus === 'paid');
  const pendingAppts = filteredAppts.filter(a => a.status === 'pending');
  const cancelledAppts = filteredAppts.filter(a => a.status === 'cancelled');

  const revenue = calculateRevenueBreakdown(completedAppts);
  const cashTotal = revenue.cash;
  const transferTotal = revenue.transfer;
  const walletTotal = revenue.wallet;
  const totalRevenue = revenue.total;
  const averageTicket = completedAppts.length > 0 ? Math.round(totalRevenue / completedAppts.length) : 0;

  // Count categories of services offered during this cycle
  const categoryCount = {
    'basic-nail': 0,
    'fake-nail': 0,
    design: 0,
    accessories: 0
  };

  completedAppts.forEach(appt => {
    if (appt.services && appt.services.length > 0) {
      appt.services.forEach(ds => {
        if (ds.category && ds.category in categoryCount) {
          categoryCount[ds.category as keyof typeof categoryCount]++;
        }
      });
    } else {
      appt.serviceIds.forEach(srvId => {
        const srv = services.find(s => s.id === srvId);
        if (srv && srv.category in categoryCount) {
          categoryCount[srv.category as keyof typeof categoryCount]++;
        }
      });
    }
  });

  const categoriesTranslation = {
    'basic-nail': 'Nail Cơ Bản',
    'fake-nail': 'Móng Giả',
    design: 'Design',
    accessories: 'Đính Phụ Kiện'
  };

  const totalServicesDone = Object.values(categoryCount).reduce((sum, val) => sum + val, 0);
  const displayedReceipts = completedAppts.slice(0, visibleReceiptCount);

  return (
    <div id="report-dashboard-section" className="space-y-6">
      {/* Month Picker Selection Panel */}
      <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="font-serif text-lg font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" /> Tra cứu chu kỳ báo cáo doanh thu
          </h3>
          <p className="text-sm text-muted-foreground">Xem doanh số, cơ cấu dịch vụ và nhật ký thanh toán thực tế của tiệm theo từng ngày hoặc tháng</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Toggle View Mode Buttons */}
          <div className="flex bg-muted p-1 rounded-lg border border-border shrink-0">
            <button
              type="button"
              onClick={() => { setViewMode('month'); setVisibleReceiptCount(20); }}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all uppercase tracking-wider cursor-pointer ${
                viewMode === 'month'
                  ? 'bg-accent text-white shadow-sm font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Theo tháng
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('day'); setVisibleReceiptCount(20); }}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all uppercase tracking-wider cursor-pointer ${
                viewMode === 'day'
                  ? 'bg-accent text-white shadow-sm font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Theo ngày
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground shrink-0">Chọn thời gian:</span>
            {viewMode === 'month' ? (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-background border border-border text-foreground rounded-md px-4 py-2 text-sm font-semibold focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
              >
                {monthOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-background border border-border text-foreground rounded-md px-4 py-1.5 text-sm font-semibold focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
              />
            )}
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-lg border border-border shadow-sm">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1">
            Doanh Thu Thực Thu ({viewMode === 'day' ? selectedDate : (selectedMonth === 'all' ? 'Tất cả' : `Tháng ${selectedMonth.split('-')[1]}`)})
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-serif text-2xl font-bold text-foreground">{totalRevenue.toLocaleString()}</span>
            <span className="text-sm font-semibold text-muted-foreground font-sans">VNĐ</span>
          </div>
          <p className="text-[10px] text-emerald-650 font-medium mt-1.5 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" /> Ghi nhận từ các ca đã thanh toán hoàn thành
          </p>
        </div>

        <div className="bg-white p-5 rounded-lg border border-border shadow-sm">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1">Giá Trị Biên Lai Bình Quân</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-serif text-2xl font-bold text-accent">{averageTicket.toLocaleString()}</span>
            <span className="text-sm font-semibold text-muted-foreground">VNĐ</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">Chi tiêu trung bình của 1 khách hàng</p>
        </div>

        <div className="bg-white p-5 rounded-lg border border-border shadow-sm">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1">Tổng Lượt Phục Vụ Xong</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-serif text-2xl font-bold text-foreground">{completedAppts.length}</span>
            <span className="text-sm text-muted-foreground">lượt làm móng</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">Khách hàng đã nhận móng và thanh toán</p>
        </div>

        <div className="bg-white p-5 rounded-lg border border-border shadow-sm">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1">Ca Đang Chờ Phục Vụ</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-serif text-2xl font-bold text-accent">{pendingAppts.length}</span>
            <span className="text-sm text-amber-650/80">ca đặt lịch</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">Lịch đặt trước trong chu kỳ đã chọn</p>
        </div>
      </div>

      {/* 2-column cash/flow breakdown */}
      <div className="bg-white p-5 rounded-lg border border-border shadow-sm space-y-4">
        <h4 className="text-xs uppercase font-bold tracking-wider text-muted-foreground border-b border-border pb-2 flex items-center gap-1.5">
          📊 Phân tích dòng tiền chi tiết ({viewMode === 'day' ? selectedDate : (selectedMonth === 'all' ? 'Tất cả' : `Tháng ${selectedMonth.split('-')[1]}`)})
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card p-4 rounded-md border border-border hover:bg-muted/30 transition-all">
            <span className="block text-[11px] font-bold text-foreground flex items-center gap-1 mb-1">
              💵 Tiền mặt
            </span>
            <div className="font-serif text-lg font-bold text-foreground">
              {formatCurrency(cashTotal)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {completedAppts.filter(a => a.paymentMethod === 'cash').length} đơn
            </p>
          </div>

          <div className="bg-card p-4 rounded-md border border-border hover:bg-muted/30 transition-all">
            <span className="block text-[11px] font-bold text-foreground flex items-center gap-1 mb-1">
              📱 Chuyển khoản
            </span>
            <div className="font-serif text-lg font-bold text-foreground">
              {formatCurrency(transferTotal)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {completedAppts.filter(a => a.paymentMethod === 'transfer').length} đơn
            </p>
          </div>

          <div className="bg-card p-4 rounded-md border border-border hover:bg-muted/30 transition-all">
            <span className="block text-[11px] font-bold text-foreground flex items-center gap-1 mb-1">
              👛 Ví cọc đã dùng
            </span>
            <div className="font-serif text-lg font-bold text-foreground">
              {formatCurrency(walletTotal)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {completedAppts.filter(a => (Number(a.depositUsed) || 0) > 0 || a.paymentMethod === 'wallet').length} đơn
            </p>
          </div>

        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Bento: Category popularity bars */}
        <div className="lg:col-span-5 bg-white p-6 rounded-lg border border-border shadow-sm space-y-5">
          <div>
            <h3 className="font-serif text-lg font-black text-foreground">Dịch vụ yêu thích chu kỳ này</h3>
            <p className="text-sm text-muted-foreground">Tỉ trọng cơ cấu các dịch vụ nail được khách chọn làm nhiều nhất</p>
          </div>

          {totalServicesDone === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground italic">
              Không có dữ liệu dịch vụ hoàn thành trong chu kỳ này.
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(categoryCount).map(([cat, count]) => {
                const percentage = totalServicesDone > 0 ? Math.round((count / totalServicesDone) * 100) : 0;
                return (
                  <div key={cat} className="space-y-1.5 text-sm">
                    <div className="flex justify-between items-center text-foreground font-medium font-sans">
                      <span>{categoriesTranslation[cat as keyof typeof categoriesTranslation]}</span>
                      <span className="font-mono text-foreground font-bold">{count} ca ({percentage}%)</span>
                    </div>
                    {/* Simulated visual progress bar */}
                    <div className="w-full bg-background h-2.5 rounded-full overflow-hidden border border-border/30">
                      <div
                        className="bg-accent text-accent-foreground h-full rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="hidden">
            <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Mẹo kinh doanh: <strong className="text-foreground">Dịch vụ Sơn Gel & Đắp móng Acrylic</strong> luôn có tỷ suất lợi nhuận cao nhất. Hãy thiết lập combo tặng kèm Ủ Keratin phục hồi để tăng doanh số bán lẻ tốt hơn!
            </p>
          </div>
        </div>

        {/* Right Bento: Direct visual table of receipts */}
        <div className="lg:col-span-7 bg-white p-6 rounded-lg border border-border shadow-sm space-y-4">
          <div>
            <h3 className="font-serif text-lg font-black text-foreground">Nhật ký thanh toán</h3>
            <p className="text-sm text-muted-foreground">Chỉ hiển thị các đơn đã hoàn thành và đã ghi nhận doanh thu.</p>
          </div>

          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {completedAppts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground italic">
                Không tìm thấy dữ liệu hóa đơn nào trong khoảng thời gian đã chọn.
              </div>
            ) : (
              displayedReceipts.map((appt) => {
                const isComp = appt.status === 'completed';
                const isCanc = appt.status === 'cancelled';
                return (
                  <div key={appt.id} className="p-3.5 rounded-md border border-border bg-background/30 flex justify-between items-center hover:bg-background/70 transition-all text-sm">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-foreground font-bold">{appt.customerName}</strong>
                        <span className="text-[10px] text-muted-foreground font-mono">({appt.date} • {appt.time})</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">KTV phụ trách: {appt.staffName}</p>
                    </div>

                    <div className="text-right">
                      <p className={`font-mono font-extrabold ${isCanc ? 'text-foreground line-through' : 'text-foreground'}`}>
                        {appt.totalPrice.toLocaleString()} đ
                      </p>
                      <span className={`inline-block text-[9px] font-bold rounded px-1.5 py-0.5 mt-1 ${
                        isComp ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : isCanc ? 'bg-muted text-muted-foreground' : 'bg-muted text-accent border border-muted'
                      }`}>
                        {isComp ? 'Đã thu tiền' : isCanc ? 'Đã hủy ca' : 'Đang hẹn trước'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {completedAppts.length > visibleReceiptCount && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setVisibleReceiptCount((count) => count + 20)}
                className="rounded-md border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Xem thêm ({completedAppts.length - visibleReceiptCount} biên lai)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
