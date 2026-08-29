import React, { useState } from 'react';
import { Staff, Appointment, NailService, StaffBonus, TimeLog } from '@shared/types';
import { calculatePayroll, getRecentMonthsList } from './salary';
import { Calendar, Wallet, Landmark, Percent, Award, CreditCard, ChevronRight, Clock, CheckCircle2, Play, Square, AlertCircle } from 'lucide-react';

interface MyIncomeViewProps {
  currentStaffId: string;
  staffList: Staff[];
  appointments: Appointment[];
  services: NailService[];
  staffBonuses: StaffBonus[];
  timeLogs?: TimeLog[];
  onCheckIn?: (staffId: string) => void;
  onCheckOut?: (staffId: string) => void;
}

const getCurrentMonth = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`; // VD: '2026-07'
};

export default function MyIncomeView({
  currentStaffId,
  staffList,
  appointments,
  services,
  staffBonuses,
  timeLogs = [],
  onCheckIn,
  onCheckOut
}: MyIncomeViewProps) {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());

  const currentStaff = staffList.find(s => s.id === currentStaffId);

  if (!currentStaff) {
    return (
      <div className="py-20 text-center text-muted-foreground italic bg-white rounded-lg border border-muted font-sans">
        🚫 Không tìm thấy thông tin tài khoản thợ của bạn trong hệ thống.
      </div>
    );
  }

  const monthOptions = [
    { value: 'all', label: 'Tất cả mọi tháng' },
    ...getRecentMonthsList()
  ];

  const stats = calculatePayroll(currentStaff, appointments, services, staffBonuses, timeLogs, selectedMonth);
  const {
    isSupport,
    totalSupportHoursSum,
    totalSupportEarnings,
    totalCommission,
    totalBonus,
    baseSalary,
    totalEarningsForPeriod: finalPayout,
    items,
    bonuses: activeBonuses,
    logs: supportLogs
  } = stats;

  const supportHourlyRate = currentStaff.hourlyRate || 30000;
  const activeLog = timeLogs.find(log => log.staffId === currentStaffId && !log.checkOut);

  return (
    <div className="space-y-6 font-sans">
      {/* Month Selection & Staff Header */}
      <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="font-serif text-lg font-bold text-foreground flex items-center gap-2">
            <Landmark className="w-5 h-5 text-accent" /> Ví & Thu Nhập Của Tôi
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Chào {isSupport ? 'nhân viên hỗ trợ' : 'thợ'}{' '}
            <strong className="text-foreground text-sm font-sans">{currentStaff.name}</strong> •{' '}
            {isSupport ? (
              <>
                Lương theo ca: <strong className="text-accent">{(currentStaff.hourlyRate || 30000).toLocaleString()}đ/giờ</strong>
              </>
            ) : (
              <>
                Tỷ lệ hoa hồng móng: <strong className="text-accent">{currentStaff.commissionRate * 100}%</strong>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-foreground">Chọn chu kỳ tháng:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-background border border-border text-foreground rounded-md px-4 py-2.5 text-sm font-bold focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
          >
            {monthOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Interactive Timekeeping Unit for Support */}
      {isSupport && (
        <div className="bg-gradient-to-r from-[#faf3f0] to-[#f5e6e1] border border-border p-5 rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4 animate-fadeIn">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-lg ${activeLog ? 'bg-muted text-accent animate-pulse' : 'bg-muted text-muted-foreground'}`}>
              <Clock className="w-8 h-8" />
            </div>
            <div>
              <h4 className="font-serif text-base font-bold text-foreground">
                {activeLog ? '● Bạn Đang Trong Ca Làm Việc' : '○ Bạn Đang Ngoài Ca Làm Việc'}
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                {activeLog 
                  ? `Bắt đầu lúc: ${new Date(activeLog.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - ${new Date(activeLog.checkIn).toLocaleDateString('vi-VN')}`
                  : 'Sử dụng nút bấm sau đây để ghi nhận giờ làm và tính lương thực tế.'}
              </p>
            </div>
          </div>
          
          <div>
            {activeLog ? (
              <button
                onClick={() => onCheckOut?.(currentStaffId)}
                className="bg-foreground text-background hover:bg-foreground text-background text-white font-sans font-bold text-sm py-3 px-6 rounded-lg flex items-center gap-2 border border-transparent shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-white animate-spin-slow" /> Check-out (Hoàn thành ca)
              </button>
            ) : (
              <button
                onClick={() => onCheckIn?.(currentStaffId)}
                className="bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white font-sans font-bold text-sm py-3 px-6 rounded-lg flex items-center gap-2 border border-transparent shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" /> Check-in (Bắt đầu làm)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info Warning */}
      <p className="text-[11px] text-accent font-medium bg-muted p-3.5 rounded-lg border border-muted flex items-center gap-2 leading-relaxed">
        🛡️ <span><strong>Lưu ý bảo mật:</strong> Dữ liệu thu nhập là View-Only (Chỉ đọc) để bảo toàn tuyệt đối bảng tính đối soát, được tự động trích xuất trực tiếp từ lịch sử làm việc/phục vụ thực tế và bảng chấm công.</span>
      </p>

      {/* KPI Overview Grid */}
      {isSupport ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Hourly rate pay scale */}
          <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-sky-50 text-sky-700 rounded-md">
              <CreditCard className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Lương theo giờ</p>
              <p className="text-base font-serif font-extrabold text-foreground mt-0.5">
                {supportHourlyRate.toLocaleString()} đ/g
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">Đơn giá định mức</p>
            </div>
          </div>

          {/* Timekeeping Hours */}
          <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-muted text-accent rounded-md">
              <Clock className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Thời gian làm việc</p>
              <p className="text-base font-serif font-extrabold text-accent mt-0.5">
                {totalSupportHoursSum} giờ
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{supportLogs.length} ca hoàn thành</p>
            </div>
          </div>

          {/* Total bonus */}
          <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-muted text-accent rounded-md">
              <Award className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Phụ cấp & Thưởng</p>
              <p className="text-base font-serif font-extrabold text-accent mt-0.5">
                +{totalBonus.toLocaleString()} đ
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{activeBonuses.length} khoản thưởng</p>
            </div>
          </div>

          {/* Grand wallet total */}
          <div className="bg-gradient-to-br from-[#fbf5f2] to-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-accent text-accent-foreground text-white rounded-md">
              <Wallet className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">THỰC NHẬN CHU KỲ</p>
              <p className="text-lg font-serif font-extrabold text-foreground mt-0.5">
                {finalPayout.toLocaleString()} VNĐ
              </p>
              <p className="text-[9px] text-emerald-700 font-bold mt-0.5">✓ Chấm công chuẩn xác</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Base daily salary */}
          <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-sky-50 text-sky-700 rounded-md">
              <CreditCard className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Lương cố định</p>
              <p className="text-base font-serif font-extrabold text-foreground mt-0.5">
                {baseSalary.toLocaleString()} đ
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">Định mức chu kỳ</p>
            </div>
          </div>

          {/* Total commission */}
          <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-muted text-accent rounded-md">
              <Percent className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Hoa hồng móng</p>
              <p className="text-base font-serif font-extrabold text-accent mt-0.5">
                {totalCommission.toLocaleString()} đ
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{stats.completedCount} đơn hoàn thành</p>
            </div>
          </div>

          {/* Total bonus */}
          <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-muted text-accent rounded-md">
              <Award className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Phụ cấp & Thưởng</p>
              <p className="text-base font-serif font-extrabold text-accent mt-0.5">
                +{totalBonus.toLocaleString()} đ
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{activeBonuses.length} khoản thưởng</p>
            </div>
          </div>

          {/* Grand wallet total */}
          <div className="bg-gradient-to-br from-[#fbf5f2] to-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
            <div className="p-3.5 bg-accent text-accent-foreground text-white rounded-md">
              <Wallet className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">THỰC NHẬN CHU KỲ</p>
              <p className="text-lg font-serif font-extrabold text-foreground mt-0.5">
                {finalPayout.toLocaleString()} VNĐ
              </p>
              <p className="text-[9px] text-emerald-700 font-bold mt-0.5">✓ Đã chốt số liệu</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Detailed Work Log History or Commission Jobs History */}
        {isSupport ? (
          <div className="lg:col-span-8 bg-white p-5 rounded-lg border border-border shadow-sm space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <div>
                <h3 className="font-serif text-sm font-extrabold text-foreground">Chi tiết bảng chấm công theo ca</h3>
                <p className="text-[10px] text-muted-foreground">Nhật ký chấm công ra vào tích hợp theo thời gian thực tế</p>
              </div>
              <span className="text-[10px] bg-card hover:bg-muted text-muted-foreground px-2 py-1 rounded-md border border-border font-mono">
                Hiển thị: {supportLogs.length} ca làm việc
              </span>
            </div>

            {supportLogs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm italic">
                Chưa có ca chấm công hay nhật ký giờ làm việc nào được ghi nhận trong chu kỳ này.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-[10px] font-bold text-muted-foreground uppercase font-mono bg-card hover:bg-muted/50">
                      <th className="p-3">Ngày làm việc</th>
                      <th className="p-3">Bắt đầu / Kết thúc</th>
                      <th className="p-3 text-center">Tổng giờ</th>
                      <th className="p-3 text-center">Lương/giờ</th>
                      <th className="p-3 text-right text-accent">Thành tiền</th>
                      <th className="p-3 text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-sm text-foreground">
                    {supportLogs.map((log) => {
                      const checkInDate = new Date(log.checkIn);
                      const dateFormatted = checkInDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
                      const checkInTime = checkInDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                      const checkOutTime = log.checkOut 
                        ? new Date(log.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) 
                        : 'Đang làm việc...';
                      const isWorking = !log.checkOut;

                      return (
                        <tr key={log.id} className="hover:bg-card hover:bg-muted/30 transition-all">
                          <td className="p-3">
                            <p className="font-bold text-foreground">{dateFormatted}</p>
                          </td>
                          <td className="p-3 text-muted-foreground font-medium">
                            <span>{checkInTime}</span>
                            <span className="text-muted-foreground mx-1.5 font-sans">→</span>
                            <span className={log.checkOut ? 'text-muted-foreground' : 'text-accent font-bold animate-pulse'}>
                              {checkOutTime}
                            </span>
                          </td>
                          <td className="p-3 text-center font-mono font-bold text-foreground">
                            {log.checkOut ? `${log.totalHours} giờ` : '—'}
                          </td>
                          <td className="p-3 text-center font-mono text-muted-foreground">
                            {supportHourlyRate.toLocaleString()} đ
                          </td>
                          <td className="p-3 text-right font-mono font-extrabold text-accent">
                            {log.checkOut && log.totalEarnings ? `${log.totalEarnings.toLocaleString()} đ` : (
                              <span className="text-[10px] text-amber-750 bg-muted px-2 py-0.5 rounded-sm border border-muted animate-pulse font-sans font-semibold">
                                Đang làm việc...
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {log.paid ? (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-sm border border-emerald-100">
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" /> Đã trả lương
                              </span>
                            ) : isWorking ? (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-muted text-accent font-bold px-2 py-0.5 rounded-sm border border-muted animate-pulse">
                                Chưa chốt
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-muted text-accent font-bold px-2 py-0.5 rounded-sm border border-muted">
                                Chờ thanh toán
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="lg:col-span-8 bg-white p-5 rounded-lg border border-border shadow-sm space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <div>
                <h3 className="font-serif text-sm font-extrabold text-foreground">Chi tiết các ca phục vụ móng</h3>
                <p className="text-[10px] text-muted-foreground">Hoa hồng tính trực tiếp dựa trên số tiền thực tế khách thanh toán</p>
              </div>
              <span className="text-[10px] bg-card hover:bg-muted text-muted-foreground px-2 py-1 rounded-md border border-border font-mono">
                Hiển thị: {stats.completedCount} ca
              </span>
            </div>

            {items.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm italic">
                Chưa có ca phục vụ nail hoàn thành nào được ghi nhận trong chu kỳ này.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-[10px] font-bold text-muted-foreground uppercase font-mono bg-card hover:bg-muted/50">
                      <th className="p-3">Khách hàng / Ngày</th>
                      <th className="p-3">Danh sách dịch vụ móng</th>
                      <th className="p-3 text-right">Thực thu</th>
                      <th className="p-3 text-right text-accent">Hoa hồng móng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-card hover:bg-muted/30 transition-all">
                        <td className="p-3">
                          <p className="font-bold text-foreground">{item.customer}</p>
                          <span className="text-[10px] text-muted-foreground font-mono block mt-0.5">{item.date}</span>
                        </td>
                        <td className="p-3 font-medium text-muted-foreground max-w-xs truncate" title={item.serviceName}>
                          {item.serviceName}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-foreground">
                          {item.price.toLocaleString()} đ
                        </td>
                        <td className="p-3 text-right font-mono">
                          <span className="font-extrabold text-accent block">{item.commission.toLocaleString()} đ</span>
                          <span className="text-[9px] text-muted-foreground font-mono font-medium block">({(((item as any).commissionRate || 0) * 100)}%)</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Right Side: Extras & Reward Items list */}
        <div className="lg:col-span-4 bg-white p-5 rounded-lg border border-border shadow-sm space-y-4">
          <div className="pb-2 border-b border-border">
            <h3 className="font-serif text-sm font-extrabold text-foreground">Tiền thưởng & Phụ cấp thêm</h3>
            <p className="text-[10px] text-muted-foreground">Các khoản thưởng nóng hoặc hỗ trợ đặc cách từ Ban quản lý</p>
          </div>

          {activeBonuses.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm italic">
              Không có khoản thưởng thêm nào được ghi nhận trong chu kỳ này.
            </div>
          ) : (
            <div className="space-y-2.5">
              {activeBonuses.map((bonus) => (
                <div key={bonus.id} className="p-3 bg-muted/20 border border-muted rounded-lg space-y-1.5 hover:shadow-sm transition-all">
                  <div className="flex justify-between items-start">
                    <span className="font-bold text-foreground text-sm flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-accent shrink-0" /> {bonus.reason}
                    </span>
                    <span className="font-mono font-extrabold text-accent text-sm shrink-0">
                      +{bonus.amount.toLocaleString()} đ
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                    <span>Chu kỳ: {bonus.month}</span>
                    <span className="bg-muted px-1.5 py-0.3 rounded-sm text-accent font-bold uppercase text-[8px]">
                      Thưởng nóng
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
