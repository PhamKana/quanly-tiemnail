import React, { useState } from 'react';
import { Staff, Appointment, NailService, StaffBonus, TimeLog } from '@shared/types';
import { calculatePayroll, isStaffSupport, getRecentMonthsList } from './salary';
import { 
  UserPlus, Wallet, Calculator, Percent, Sparkles, TrendingUp, DollarSign, 
  Calendar, Gift, Award, Plus, Trash2, CheckCircle2, Clock, CheckSquare,
  Edit2, Check, X
} from 'lucide-react';

interface StaffPayrollProps {
  staffList: Staff[];
  appointments: Appointment[];
  services: NailService[];
  onAddStaff: (newStaff: Omit<Staff, 'id'>) => void;
  staffBonuses?: StaffBonus[];
  onAddStaffBonus?: (newBonus: Omit<StaffBonus, 'id' | 'createdAt'>) => void;
  onDeleteStaffBonus?: (id: string) => void;
  timeLogs?: TimeLog[];
  onSettleStaffPayroll?: (staffId: string, month: string) => void;
  onUpdateTimeLog?: (id: string, updated: Partial<TimeLog>) => void;
  onDeleteTimeLog?: (id: string) => void;
}

const getCurrentMonth = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`; // VD: '2026-07'
};

export default function StaffPayroll({ 
  staffList, 
  appointments, 
  services, 
  onAddStaff,
  staffBonuses = [],
  onAddStaffBonus,
  onDeleteStaffBonus,
  timeLogs = [],
  onSettleStaffPayroll,
  onUpdateTimeLog,
  onDeleteTimeLog
}: StaffPayrollProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('Thợ Nail Chính (Nail Artist)');
  const [commissionRate, setCommissionRate] = useState(60); // percent
  const [baseSalary, setBaseSalary] = useState(150000);

  const [selectedStaffId, setSelectedStaffId] = useState<string>(staffList[0]?.id || '');
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());

  // States for editing & correcting support staff time logs
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editCheckIn, setEditCheckIn] = useState<string>('');
  const [editCheckOut, setEditCheckOut] = useState<string>('');
  const [editHours, setEditHours] = useState<string>('');
  const [editEarnings, setEditEarnings] = useState<string>('');

  const toDatetimeLocal = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch (err) {
      return '';
    }
  };

  const startEditingLog = (log: TimeLog) => {
    setEditingLogId(log.id);
    setEditCheckIn(toDatetimeLocal(log.checkIn));
    setEditCheckOut(log.checkOut ? toDatetimeLocal(log.checkOut) : '');
    setEditHours(log.totalHours !== undefined ? String(log.totalHours) : '');
    setEditEarnings(log.totalEarnings !== undefined ? String(log.totalEarnings) : '');
  };

  const cancelEditingLog = () => {
    setEditingLogId(null);
    setEditCheckIn('');
    setEditCheckOut('');
    setEditHours('');
    setEditEarnings('');
  };

  const handleRecalculateHours = () => {
    if (!editCheckIn) return;
    const checkInTime = new Date(editCheckIn);
    const checkOutTime = editCheckOut ? new Date(editCheckOut) : null;
    if (checkOutTime && !isNaN(checkInTime.getTime()) && !isNaN(checkOutTime.getTime())) {
      const diffMs = checkOutTime.getTime() - checkInTime.getTime();
      const rawHours = diffMs / (1000 * 60 * 60);
      const totalHours = Math.round(rawHours * 10) / 10 || 0.1;
      setEditHours(String(totalHours));
      
      const hourlyRate = currentStaff?.hourlyRate || 30000;
      setEditEarnings(String(Math.round(totalHours * hourlyRate)));
    }
  };

  const [bonusAmountStr, setBonusAmountStr] = useState('');
  const [bonusReason, setBonusReason] = useState('');
  const [bonusTargetMonth, setBonusTargetMonth] = useState(getCurrentMonth());

  const monthOptions = [
    { value: 'all', label: 'Tất cả các tháng' },
    ...getRecentMonthsList()
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    onAddStaff({
      name,
      phone,
      role,
      commissionRate: commissionRate / 100,
      baseSalary,
      status: 'active'
    });

    setName('');
    setPhone('');
    setRole('Thợ Nail Chính (Nail Artist)');
    setCommissionRate(60);
    setBaseSalary(150000);
    setShowAddForm(false);
  };

  const handleAddBonusSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId) return;
    const amount = parseFloat(bonusAmountStr.replace(/[^0-9]/g, ''));
    if (isNaN(amount) || amount <= 0 || !bonusReason.trim()) return;

    const targetMonth = selectedMonth === 'all' ? bonusTargetMonth : selectedMonth;

    if (onAddStaffBonus) {
      onAddStaffBonus({
        staffId: selectedStaffId,
        month: targetMonth,
        amount,
        reason: bonusReason.trim()
      });
    }

    setBonusAmountStr('');
    setBonusReason('');
  };

  // Helper to calculate total earned for a staff
  const getStaffStats = (staffId: string) => {
    const staffObj = staffList.find(s => s.id === staffId);
    if (!staffObj) {
      return {
        completedCount: 0,
        totalCommission: 0,
        outstandingCommission: 0,
        settledCommission: 0,
        totalBonus: 0,
        baseSalary: 0,
        totalSupportHoursSum: 0,
        totalSupportEarnings: 0,
        outstandingEarnings: 0,
        paidEarnings: 0,
        finalPayout: 0,
        totalEarningsForPeriod: 0,
        isSupport: false,
        items: [],
        bonuses: [],
        logs: [],
        totalHoursSum: 0
      };
    }

    const stats = calculatePayroll(staffObj, appointments, services, staffBonuses, timeLogs, selectedMonth);
    return {
      ...stats,
      totalHoursSum: stats.totalSupportHoursSum
    };
  };

  const currentStaff = staffList.find(s => s.id === selectedStaffId);
  const stats = getStaffStats(selectedStaffId);

  // Filter completed appointments count for the entire shop under selectedMonth
  const totCompletedCount = appointments.filter(a => {
    const isCompleted = a.status === 'completed';
    const matchesMonth = selectedMonth === 'all' || a.date.startsWith(selectedMonth);
    return isCompleted && matchesMonth;
  }).length;

  return (
    <div id="staff-payroll-section" className="space-y-6">
      {/* Dynamic Month Selection Card */}
      <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="font-serif text-lg font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" /> Tra cứu bảng lương theo tháng
          </h3>
          <p className="text-sm text-muted-foreground">Xem lương cứng, chi tiết hoa hồng KTV thực nhận theo từng chu kỳ tương ứng</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Chu kỳ tháng:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-background border border-border text-foreground rounded-md px-4 py-2.5 text-sm font-semibold focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
          >
            {monthOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Overview Cards & Stat Line */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-muted text-foreground rounded-md">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground font-medium">Tổng lương cần trả</p>
            <p className="text-xl font-serif font-bold text-foreground">
              {staffList.reduce((acc, s) => acc + getStaffStats(s.id).finalPayout, 0).toLocaleString()} VNĐ
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-muted text-accent rounded-md">
            <Percent className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground font-medium font-sans">Tháng đang tra cứu</p>
            <p className="text-lg font-serif font-bold text-foreground">
              {selectedMonth === 'all' ? 'Tất cả mọi tháng' : `Tháng ${selectedMonth.split('-')[1]}/${selectedMonth.split('-')[0]}`}
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-700 rounded-md">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground font-medium font-sans">Tổng ca đã hoàn thành</p>
            <p className="text-xl font-serif font-bold text-emerald-700">
              {totCompletedCount} ca phục vụ
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Staff Directory / Selector */}
        <div className="lg:col-span-5 bg-white p-6 rounded-lg border border-border shadow-sm space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-serif text-2xl font-normal text-foreground">Chọn nhân viên</h3>
              <p className="text-sm text-muted-foreground">Chọn một nhân viên để xem công và lương trong kỳ.</p>
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="hidden p-1 px-3 bg-muted hover:bg-accent text-foreground rounded-full font-medium text-sm flex items-center gap-1.5 transition-all text-pointer cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" /> Thêm thợ
            </button>
          </div>

          {showAddForm && (
            <form onSubmit={handleSubmit} className="hidden bg-card hover:bg-muted p-4 rounded-md border border-border space-y-4">
              <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider">Thông tin nhân viên mới</h4>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Họ và tên..."
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                />
                <input
                  type="tel"
                  placeholder="Số điện thoại..."
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                >
                  <option value="Thợ Nail Chính (Nail Artist)">Thợ Nail Chính (Nail Artist)</option>
                  <option value="Kỹ thuật viên Gel & Chăm sóc">Kỹ thuật viên Gel & Chăm sóc</option>
                  <option value="Chuyên viên Đắp bột & Phục hồi">Chuyên viên Đắp bột & Phục hồi</option>
                  <option value="Thợ Phụ Học Việc">Thợ Phụ Học Việc</option>
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">Hoa hồng (%)</label>
                    <input
                      type="number"
                      required
                      min="10"
                      max="100"
                      value={commissionRate}
                      onChange={(e) => setCommissionRate(Number(e.target.value))}
                      className="w-full bg-white border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">Lương nhật cứng (đ)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={baseSalary}
                      onChange={(e) => setBaseSalary(Number(e.target.value))}
                      className="w-full bg-white border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent text-white py-2 rounded-lg text-sm font-semibold cursor-pointer min-h-[44px] touch-manipulation"
                >
                  Lưu thợ nail
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-2 bg-muted hover:bg-muted text-foreground rounded-lg text-sm cursor-pointer"
                >
                  Hủy
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            {staffList.map(staff => {
              const staffStats = getStaffStats(staff.id);
              const isActive = staff.id === selectedStaffId;
              return (
                <button
                  key={staff.id}
                  onClick={() => setSelectedStaffId(staff.id)}
                  className={`w-full text-left p-4 rounded-md flex justify-between items-center transition-all ${
                    isActive
                      ? 'bg-muted border border-border shadow-sm'
                      : 'bg-card hover:bg-muted/50 hover:bg-card hover:bg-muted border border-border'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-sm text-foreground">{staff.name}</p>
                    <p className="text-sm text-muted-foreground">{staff.role}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-foreground">
                      {staffStats.finalPayout.toLocaleString()} đ
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {isStaffSupport(staff)
                        ? `${staffStats.totalHoursSum || 0} giờ làm`
                        : `${staffStats.completedCount} ca đã làm`
                      }
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detailed Commission & Compute Sheet */}
        <div className="lg:col-span-7 bg-white p-6 rounded-lg border border-border shadow-sm space-y-6">
          {currentStaff ? (
            <>
              {/* 1. Header showing details */}
              <div className="flex justify-between items-start border-b border-border pb-5">
                <div>
                  <h3 className="font-serif text-2xl font-normal text-foreground">
                    Bảng kê chi tiết: {currentStaff.name} {stats.isSupport ? '(Support Hourly)' : '(Technician)'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {stats.isSupport 
                      ? 'Lương theo giờ được chốt dựa trên tổng số ca chấm công check-in' 
                      : 'Mức chi trả dựa trên hiệu suất và các ca hoàn thành thực tế'}
                  </p>
                </div>
                {stats.isSupport ? (
                  <span className="p-2 px-3 bg-muted text-accent rounded-full font-mono text-[10px] font-bold">
                    Lương Giờ: {(currentStaff.hourlyRate || 30000).toLocaleString()}đ/giờ
                  </span>
                ) : (
                  <span className="p-2 px-3 bg-muted text-accent rounded-full font-mono text-[10px] font-bold">
                    Hoa Hồng: {(currentStaff.commissionRate * 100)}%
                  </span>
                )}
              </div>

              {/* 2. Summary Stats KPIs Card */}
              {stats.isSupport ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-muted p-4 rounded-md border border-muted">
                  <div className="text-center">
                    <span className="block text-[10px] text-accent font-medium">Tích lũy giờ làm</span>
                    <strong className="text-foreground font-mono text-sm md:text-sm flex items-center justify-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-accent" /> {stats.totalHoursSum || 0} giờ
                    </strong>
                  </div>
                  <div className="text-center border-l md:border-x border-border">
                    <span className="block text-[10px] text-emerald-600 font-medium font-sans">Đã trả (lịch sử)</span>
                    <strong className="text-emerald-700 font-mono text-sm md:text-sm">{(stats.paidEarnings || 0).toLocaleString()} đ</strong>
                  </div>
                  <div className="text-center border-t md:border-none border-border pt-2 md:pt-0">
                    <span className="block text-[10px] text-accent font-medium font-sans">Chưa chốt (ca mới)</span>
                    <strong className="text-accent font-mono text-sm md:text-sm">{(stats.outstandingEarnings || 0).toLocaleString()} đ</strong>
                  </div>
                  <div className="text-center border-t md:border-l border-border pt-2 md:pt-0 lg:border-l lg:border-border pl-1">
                    <span className="block text-[10px] text-foreground font-bold">Cần thanh toán</span>
                    <strong className="text-accent font-mono text-sm md:text-sm font-extrabold">{stats.finalPayout.toLocaleString()} đ</strong>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-card hover:bg-muted p-4 rounded-md border border-border">
                  <div className="text-center">
                    <span className="block text-[10px] text-muted-foreground">Lương cơ bản</span>
                    <strong className="text-foreground font-mono text-sm md:text-sm">{currentStaff.baseSalary.toLocaleString()} đ</strong>
                  </div>
                  <div className="text-center border-l md:border-x border-border">
                    <span className="block text-[10px] text-muted-foreground">Tiền Hoa hồng</span>
                    <strong className="text-accent font-mono text-sm md:text-sm">{stats.totalCommission.toLocaleString()} đ</strong>
                  </div>
                  <div className="text-center border-t md:border-none border-border pt-2 md:pt-0">
                    <span className="block text-[10px] text-muted-foreground">Thưởng thêm</span>
                    <strong className="text-accent font-mono text-sm md:text-sm">{(stats.totalBonus || 0).toLocaleString()} đ</strong>
                  </div>
                  <div className="text-center border-t md:border-l border-border pt-2 md:pt-0 lg:border-l lg:border-border pl-1">
                    <span className="block text-[10px] text-muted-foreground font-bold">Thực lĩnh tổng</span>
                    <strong className="text-foreground font-mono text-sm md:text-sm font-extrabold">{stats.finalPayout.toLocaleString()} đ</strong>
                  </div>
                </div>
              )}

              {/* 3. Confirm Salary Payment action banner */}
              {stats.finalPayout > 0 && onSettleStaffPayroll && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h5 className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-600" /> Có số dư lương chưa thanh toán
                    </h5>
                    <p className="text-[11px] text-emerald-700 mt-1">
                      Xác nhận thanh toán toàn bộ chi phí lương cứng, hoa hồng/giờ chấm công và các khoản thưởng chu kỳ này.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Bạn có chắc chắn muốn chốt lương và đánh dấu ĐÃ TRẢ số tiền ${stats.finalPayout.toLocaleString()} VNĐ cho ${currentStaff.name}?`)) {
                        onSettleStaffPayroll(currentStaff.id, selectedMonth);
                      }
                    }}
                    className="w-full sm:w-auto p-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-bold flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all cursor-pointer whitespace-nowrap"
                  >
                    <CheckSquare className="w-4 h-4" /> Thanh toán {stats.finalPayout.toLocaleString()} đ
                  </button>
                </div>
              )}

              {/* 4. Transactions or Time Logs lists */}
              {stats.isSupport ? (
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-foreground" /> Bảng phân tích ca làm chấm công (Time Cards)
                  </h4>
                  {(!stats.logs || stats.logs.length === 0) ? (
                    <div className="py-12 text-center text-muted-foreground text-sm italic bg-muted border border-border rounded-md">
                      Chưa có ca làm check-in nào được ghi nhận trong chu kỳ này.
                    </div>
                  ) : (
                    <div className="border border-border rounded-md overflow-hidden text-sm">
                      <table className="w-full text-left">
                        <thead className="bg-card hover:bg-muted text-muted-foreground font-semibold border-b border-border">
                          <tr>
                            <th className="p-3">Ngày làm việc</th>
                            <th className="p-3">Giờ Check-in / Out</th>
                            <th className="p-3 text-right">Tổng số giờ</th>
                            <th className="p-3 text-right">Lương tương ứng</th>
                            <th className="p-3 text-center">Trạng thái</th>
                            <th className="p-3 text-center">Admin điều chỉnh</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border divide-dotted">
                          {stats.logs.map((log) => {
                            if (editingLogId === log.id) {
                              return (
                                <tr key={log.id} className="bg-muted/40">
                                  <td className="p-2.5">
                                    <div className="space-y-1">
                                      <span className="block text-[9px] text-foreground font-bold uppercase">Check-in:</span>
                                      <input 
                                        type="datetime-local" 
                                        value={editCheckIn} 
                                        onChange={(e) => setEditCheckIn(e.target.value)} 
                                        className="p-1 px-1.5 border border-border rounded font-mono text-[10px] w-full bg-white max-w-[150px]" 
                                      />
                                    </div>
                                  </td>
                                  <td className="p-2.5">
                                    <div className="space-y-1">
                                      <span className="block text-[9px] text-foreground font-bold uppercase">Check-out:</span>
                                      <input 
                                        type="datetime-local" 
                                        value={editCheckOut} 
                                        onChange={(e) => setEditCheckOut(e.target.value)} 
                                        className="p-1 px-1.5 border border-border rounded font-mono text-[10px] w-full bg-white max-w-[150px]" 
                                      />
                                    </div>
                                  </td>
                                  <td className="p-2.5 text-right">
                                    <div className="space-y-1 inline-block text-right">
                                      <span className="block text-[9px] text-foreground font-bold uppercase">Số giờ:</span>
                                      <input 
                                        type="number" 
                                        step="0.1"
                                        value={editHours} 
                                        onChange={(e) => {
                                          setEditHours(e.target.value);
                                          const h = parseFloat(e.target.value) || 0;
                                          const rate = currentStaff?.hourlyRate || 30000;
                                          setEditEarnings(String(Math.round(h * rate)));
                                        }} 
                                        className="p-1 text-right border border-border rounded font-mono text-sm w-16 bg-white" 
                                      />
                                      <button 
                                        type="button" 
                                        onClick={handleRecalculateHours}
                                        className="block text-[9px] text-emerald-700 hover:underline font-bold mt-1 cursor-pointer min-h-[44px] touch-manipulation"
                                      >
                                        Tự tính giờ
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-2.5 text-right">
                                    <div className="space-y-1 inline-block text-right">
                                      <span className="block text-[9px] text-foreground font-bold uppercase">Thành tiền:</span>
                                      <input 
                                        type="number" 
                                        value={editEarnings} 
                                        onChange={(e) => setEditEarnings(e.target.value)} 
                                        className="p-1 text-right border border-border rounded font-mono text-sm w-24 bg-white" 
                                      />
                                    </div>
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <span className="inline-block p-1 bg-muted text-amber-850 rounded text-[9px] font-semibold border border-muted">
                                      Hiệu chỉnh
                                    </span>
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button 
                                        type="button" 
                                        onClick={() => {
                                          if (onUpdateTimeLog) {
                                            const updatedHour = parseFloat(editHours) || 0;
                                            const updatedEarn = parseFloat(editEarnings) || 0;
                                            const finalCheckIn = editCheckIn ? new Date(editCheckIn).toISOString() : log.checkIn;
                                            const finalCheckOut = editCheckOut ? new Date(editCheckOut).toISOString() : undefined;
                                            
                                            onUpdateTimeLog(log.id, {
                                              checkIn: finalCheckIn,
                                              checkOut: finalCheckOut,
                                              totalHours: updatedHour,
                                              totalEarnings: updatedEarn
                                            });
                                          }
                                          setEditingLogId(null);
                                        }}
                                        className="p-1 px-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                                      >
                                        <Check className="w-3 h-3" /> Lưu
                                      </button>
                                      <button 
                                        type="button" 
                                        onClick={cancelEditingLog}
                                        className="p-1 px-1.5 bg-muted hover:bg-muted text-foreground rounded text-[10px] font-bold flex items-center gap-0.5 cursor-pointer min-h-[44px] touch-manipulation"
                                      >
                                        <X className="w-3 h-3" /> Hủy
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            const dateStr = new Date(log.checkIn).toLocaleDateString('vi-VN', {
                              weekday: 'short',
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit'
                            });
                            const inTime = new Date(log.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                            const outTime = log.checkOut 
                              ? new Date(log.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) 
                              : '--:--';
                            
                            return (
                              <tr key={log.id} className="hover:bg-muted/10">
                                <td className="p-3 font-medium text-foreground">{dateStr}</td>
                                <td className="p-3 text-muted-foreground font-mono">
                                  {inTime} → {outTime}
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-foreground">
                                  {log.totalHours !== undefined ? `${log.totalHours} giờ` : 'Đang trực...'}
                                </td>
                                <td className="p-3 text-right font-mono text-foreground font-semibold">
                                  {log.totalEarnings !== undefined ? `${log.totalEarnings.toLocaleString()} đ` : '0 đ'}
                                </td>
                                <td className="p-3 text-center">
                                  {log.paid ? (
                                    <span className="inline-flex items-center gap-0.5 p-0.5 px-2 bg-emerald-50 text-emerald-700 rounded-full text-[9px] font-semibold border border-emerald-100">
                                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" /> Đã chốt
                                    </span>
                                  ) : log.checkOut ? (
                                    <span className="inline-flex items-center gap-0.5 p-0.5 px-2 bg-muted text-amber-750 rounded-full text-[9px] font-semibold border border-muted">
                                      Chưa thanh toán
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-0.5 p-0.5 px-2 bg-muted text-blue-750 rounded-full text-[9px] font-semibold animate-pulse border border-muted">
                                      Đang làm việc
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-center">
                                   <div className="flex items-center justify-center gap-1">
                                     {!log.paid && !(log as any).settled ? (
                                       <>
                                         <button 
                                           type="button"
                                           onClick={() => startEditingLog(log)}
                                           className="p-1 px-1.5 bg-muted hover:bg-muted text-accent rounded border border-muted text-[10px] font-semibold flex items-center gap-0.5 cursor-pointer shadow-sm transition-all"
                                         >
                                           <Edit2 className="w-3 h-3" /> Chỉnh sửa
                                         </button>
                                         <button 
                                           type="button"
                                           onClick={() => {
                                             if (window.confirm("Bạn có chắc chắn muốn XÓA ca chấm công này không? Thao tác này sẽ xóa vĩnh viễn log này của support.")) {
                                               if (onDeleteTimeLog) onDeleteTimeLog(log.id);
                                             }
                                           }}
                                           className="p-1 px-1.5 bg-muted hover:bg-muted text-accent rounded border border-muted text-[10px] font-semibold flex items-center gap-0.5 cursor-pointer shadow-sm transition-all"
                                         >
                                           <Trash2 className="w-3" /> Xóa
                                         </button>
                                       </>
                                     ) : (
                                       <span className="text-[10px] text-muted-foreground italic font-medium">🔒 Đã khóa</span>
                                     )}
                                   </div>
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
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calculator className="w-4 h-4 text-muted-foreground" /> Danh sách dịch vụ thực hiện
                  </h4>

                  {stats.items.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground text-sm italic bg-card hover:bg-muted/50 rounded-md border border-border">
                      Chưa có ca làm việc nào được HOÀN THÀNH trong chu kỳ này cho nhân viên này.
                    </div>
                  ) : (
                    <div className="border border-border rounded-md overflow-hidden text-sm">
                      <table className="w-full text-left">
                        <thead className="bg-card hover:bg-muted text-muted-foreground font-semibold border-b border-border">
                          <tr>
                            <th className="p-3">Khách hàng / Ngày</th>
                            <th className="p-3">Dịch vụ</th>
                            <th className="p-3 text-right">Phục thu</th>
                            <th className="p-3 text-right text-accent">Hoa hồng</th>
                            <th className="p-3 text-center">Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border divide-dotted">
                          {stats.items.map((item, index) => (
                            <tr key={index} className="hover:bg-muted/20">
                              <td className="p-3">
                                <span className="font-medium text-foreground block">{item.customer}</span>
                                <span className="text-[10px] text-muted-foreground">{item.date}</span>
                              </td>
                              <td className="p-3 text-muted-foreground font-medium">{item.serviceName}</td>
                              <td className="p-3 text-right font-mono text-muted-foreground">{item.price.toLocaleString()} đ</td>
                              <td className="p-3 text-right font-mono">
                                 <span className="font-semibold text-accent block">{item.commission.toLocaleString()} đ</span>
                                 <span className="text-[9px] text-muted-foreground block">({(((item as any).commissionRate || 0) * 100)}%)</span>
                               </td>
                              <td className="p-3 text-center">
                                {item.settled ? (
                                  <span className="inline-flex items-center gap-0.5 p-0.5 px-2 bg-emerald-50 text-emerald-700 rounded-full text-[9px] font-semibold border border-emerald-100">
                                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" /> Đã chốt
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 p-0.5 px-2 bg-muted text-accent rounded-full text-[9px] font-semibold border border-muted">
                                    Chưa chốt
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Section: Thưởng thêm & Trợ cấp */}
              <div className="pt-4 border-t border-border space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-accent" /> Thưởng thêm & Trợ cấp ({selectedMonth === 'all' ? 'Từng tháng' : `Tháng ${selectedMonth.split('-')[1]}/${selectedMonth.split('-')[0]}`})
                  </h4>
                </div>

                {/* List of existing bonuses */}
                {stats.bonuses.length === 0 ? (
                  <div className="p-4 bg-card hover:bg-muted/50 rounded-md border border-border text-center text-muted-foreground text-sm italic">
                    Chưa có khoản thưởng thêm hoặc trợ cấp nào được thiết lập trong chu kỳ này.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {stats.bonuses.map((bonus) => (
                      <div key={bonus.id} className="flex justify-between items-center p-3 bg-muted/20 border border-rose-105 rounded-md">
                        <div>
                          <div className="font-semibold text-foreground text-sm flex items-center gap-1">
                            <Award className="w-3.5 h-3.5 text-accent" /> {bonus.reason}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">Chu kỳ: {bonus.month}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-accent text-sm">+{bonus.amount.toLocaleString()} đ</span>
                          {onDeleteStaffBonus && !bonus.paid && !(bonus as any).settled && (
                            <button
                              type="button"
                              onClick={() => onDeleteStaffBonus(bonus.id)}
                              className="text-muted-foreground hover:text-accent p-1 rounded-sm hover:bg-muted transition-colors cursor-pointer"
                              title="Xóa khoản thưởng"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {(bonus.paid || (bonus as any).settled) && (
                            <span className="text-[10px] text-muted-foreground italic font-medium pr-1">🔒 Đã khóa</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Form to add a new bonus */}
                <form onSubmit={handleAddBonusSubmit} className="bg-muted p-4 rounded-md border border-muted shadow-sm space-y-3">
                  <span className="text-[11px] font-bold text-accent block">Thêm khoản thưởng / Trợ cấp mới</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">Lý do thưởng/phụ cấp</label>
                      <input
                        type="text"
                        placeholder="Ví dụ: Thưởng hiệu suất, hỗ trợ ăn uống..."
                        required
                        value={bonusReason}
                        onChange={(e) => setBonusReason(e.target.value)}
                        className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-muted"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">Số tiền thưởng (VNĐ)</label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Ví dụ: 200,000"
                          required
                          value={bonusAmountStr}
                          onChange={(e) => {
                            // Format with commas as user types
                            const val = e.target.value.replace(/[^0-9]/g, '');
                            if (val) {
                              setBonusAmountStr(Number(val).toLocaleString('vi-VN'));
                            } else {
                              setBonusAmountStr('');
                            }
                          }}
                          className="w-full bg-white border border-border rounded-lg pl-3 pr-8 py-2 text-sm text-foreground font-mono font-semibold focus:outline-hidden focus:ring-1 focus:ring-muted"
                        />
                        <span className="absolute right-3 top-2.5 text-[10px] text-muted-foreground font-bold">đ</span>
                      </div>
                    </div>
                  </div>

                  {selectedMonth === 'all' && (
                    <div className="bg-muted/50 p-2 border border-muted rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <span className="text-[10px] text-accent font-medium leading-normal">
                        Bạn đang xem tất cả các tháng. Vui lòng chọn chu kỳ tháng áp dụng khoản thưởng này:
                      </span>
                      <select
                        value={bonusTargetMonth}
                        onChange={(e) => setBonusTargetMonth(e.target.value)}
                        className="bg-white border border-border text-foreground rounded-md px-2.5 py-1 text-[10px] font-semibold focus:outline-hidden focus:ring-1"
                      >
                        {monthOptions.filter(o => o.value !== 'all').map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!bonusReason.trim() || !bonusAmountStr}
                      className="bg-accent text-accent-foreground hover:bg-accent text-accent-foreground disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-sm hover:shadow-sm transition-all text-pointer cursor-pointer min-h-[44px] touch-manipulation"
                    >
                      <Plus className="w-3.5 h-3.5" /> Ghi nhận thưởng thêm
                    </button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground italic text-sm">
              Vui lòng chọn nhân viên làm móng để tra cứu bảng lương hoa hồng.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
