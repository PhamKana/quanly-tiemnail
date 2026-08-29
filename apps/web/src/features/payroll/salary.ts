import { Staff, Appointment, NailService, StaffBonus, TimeLog } from '@shared/types';

// hasDiscount: true chỉ khi đơn THỰC SỰ có áp mã giảm giá (discountCode/discountAmount > 0).
// Nếu không có mã, thợ luôn nhận đủ 100% theo commissionRate, không bị trừ thêm.
const calculateStaffCommission = (billAmount: number, commissionRate: number, hasDiscount: boolean = false): number => {
  const deductionRate = !hasDiscount
    ? 0
    : Math.abs(commissionRate - 0.45) < 0.000001
    ? 0.05
    : Math.abs(commissionRate - 0.5) < 0.000001
    ? 0.1
    : 0;
  return Math.max(0, billAmount) * commissionRate - Math.max(0, billAmount) * deductionRate;
};

export interface PayrollStats {
  completedCount: number;
  totalCommission: number;
  outstandingCommission: number;
  settledCommission: number;
  totalBonus: number;
  outstandingBonus: number;
  settledBonus: number;
  baseSalary: number;
  outstandingBaseSalary: number;
  settledBaseSalary: number;
  totalSupportHoursSum: number;
  totalSupportEarnings: number;
  outstandingEarnings: number;
  paidEarnings: number;
  finalPayout: number;           // Current cycle outstanding liability (Admin view payroll outstanding)
  totalEarningsForPeriod: number; // Total accumulated earnings for the period (Staff own wallet view)
  isSupport: boolean;
  items: {
    serviceName: string;
    price: number;
    commission: number;
    commissionRate?: number;
    date: string;
    customer: string;
    settled: boolean;
  }[];
  bonuses: StaffBonus[];
  logs: TimeLog[];
}

export interface MonthOption {
  value: string;
  label: string;
}

export function getRecentMonthsList(): MonthOption[] {
  const options: MonthOption[] = [];
  const d = new Date();
  
  for (let i = 0; i < 6; i++) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthStr = month < 10 ? `0${month}` : `${month}`;
    const value = `${year}-${monthStr}`;
    const label = i === 0 
      ? `Tháng ${monthStr} / ${year} (Hiện tại)` 
      : `Tháng ${monthStr} / ${year}`;
    
    options.push({ value, label });
    
    // Move to previous month
    d.setMonth(d.getMonth() - 1);
  }
  
  return options;
}

export function isStaffSupport(staff: Staff | undefined | null): boolean {
  if (!staff || !staff.role) return false;
  const roleLower = staff.role.toLowerCase();
  return roleLower === 'support' || roleLower === 'thợ phụ' || roleLower === 'tro giup';
}

/**
 * Unified calculation function for both technician and support staff payroll.
 * Eliminates duplicate calculations in MyIncomeView and StaffPayroll.
 */
export function calculatePayroll(
  staff: Staff,
  appointments: Appointment[],
  services: NailService[],
  staffBonuses: StaffBonus[],
  timeLogs: TimeLog[],
  selectedMonth: string
): PayrollStats {
  const isSupport = isStaffSupport(staff);

  // Filter staff bonuses for matching month
  const activeBonuses = staffBonuses.filter(b => {
    const isStaff = b.staffId === staff.id;
    const matchesMonth = selectedMonth === 'all' || b.month === selectedMonth;
    return isStaff && matchesMonth;
  });
  const totalBonus = activeBonuses.reduce((sum, b) => sum + b.amount, 0);
  const outstandingBonus = activeBonuses.filter(b => !b.paid).reduce((sum, b) => sum + b.amount, 0);
  const settledBonus = totalBonus - outstandingBonus;

  if (isSupport) {
    const logs = timeLogs.filter(log => {
      const isOwner = log.staffId === staff.id;
      const matchesMonth = selectedMonth === 'all' || log.checkIn.startsWith(selectedMonth);
      return isOwner && matchesMonth;
    });

    const totalHours = logs.reduce((sum, log) => sum + (log.totalHours || 0), 0);
    const totalSupportHoursSum = Math.round(totalHours * 10) / 10;

    const totalSupportEarnings = logs.reduce((sum, log) => sum + (log.totalEarnings || 0), 0);
    const outstandingEarnings = logs.filter(log => !log.paid && log.checkOut).reduce((sum, log) => sum + (log.totalEarnings || 0), 0);
    const paidEarnings = logs.filter(log => log.paid).reduce((sum, log) => sum + (log.totalEarnings || 0), 0);

    return {
      completedCount: logs.filter(l => l.checkOut).length,
      totalCommission: 0,
      outstandingCommission: 0,
      settledCommission: 0,
      totalBonus,
      outstandingBonus,
      settledBonus,
      baseSalary: 0,
      outstandingBaseSalary: 0,
      settledBaseSalary: 0,
      totalSupportHoursSum,
      totalSupportEarnings,
      outstandingEarnings,
      paidEarnings,
      finalPayout: outstandingEarnings + outstandingBonus,
      totalEarningsForPeriod: totalSupportEarnings + totalBonus,
      isSupport: true,
      items: [],
      bonuses: activeBonuses,
      logs
    };
  } else {
    // Technician
    const completedAppts = appointments.filter(a => {
      const isStaff = a.staffId === staff.id;
      const isCompleted = a.status === 'completed';
      const matchesMonth = selectedMonth === 'all' || a.date.startsWith(selectedMonth);
      return isStaff && isCompleted && matchesMonth;
    });

    let totalCommission = 0;
    let outstandingCommission = 0;
    let settledCommission = 0;
    const items: { serviceName: string; price: number; commission: number; commissionRate?: number; date: string; customer: string; settled: boolean }[] = [];

    completedAppts.forEach(appt => {
      const finalCollected = appt.totalPrice;
      // Ưu tiên rate và commissionAmount đã snapshot vào đơn; fallback về rate/tính toán động hiện tại cho đơn cũ chưa có field
      const apptHasDiscount = !!(appt.discountCode || (appt.discountAmount && appt.discountAmount > 0));
      const comm = appt.commissionAmount !== undefined
        ? appt.commissionAmount
        : calculateStaffCommission(finalCollected, appt.commissionRate ?? staff.commissionRate, apptHasDiscount);
      totalCommission += comm;
      if (appt.payrollSettled) {
        settledCommission += comm;
      } else {
        outstandingCommission += comm;
      }

      const servNamesList = appt.serviceIds
        .map(srvId => services.find(s => s.id === srvId)?.name)
        .filter(Boolean);
      if (appt.extraServices && appt.extraServices.length > 0) {
        appt.extraServices.forEach(es => {
          servNamesList.push(`Phát sinh: ${es.name}`);
        });
      }
      const serviceNameJoined = servNamesList.join(', ') || 'Dịch vụ móng';

      items.push({
        serviceName: serviceNameJoined,
        price: finalCollected,
        commission: comm,
        commissionRate: appt.commissionRate ?? staff.commissionRate,
        date: appt.date,
        customer: appt.customerName,
        settled: !!appt.payrollSettled
      });
    });

    // Lương cứng (baseSalary) được tính bằng số ngày thực tế đi làm (có lịch hẹn hoàn thành hoặc check-in ca) nhân với lương nhật cứng của nhân viên (Requirement 8)
    const workedDates = new Set<string>();
    completedAppts.forEach(appt => {
      if (appt.date) workedDates.add(appt.date);
    });
    timeLogs.forEach(log => {
      if (log.staffId === staff.id) {
        const matchesMonth = selectedMonth === 'all' || log.checkIn.startsWith(selectedMonth);
        if (matchesMonth) {
          workedDates.add(log.checkIn.split('T')[0]);
        }
      }
    });

    // Find outstanding worked dates
    const outstandingWorkedDates = new Set<string>();
    completedAppts.forEach(appt => {
      if (!appt.payrollSettled && appt.date) {
        outstandingWorkedDates.add(appt.date);
      }
    });
    timeLogs.forEach(log => {
      if (log.staffId === staff.id && !log.paid && log.checkOut) {
        const matchesMonth = selectedMonth === 'all' || log.checkIn.startsWith(selectedMonth);
        if (matchesMonth) {
          outstandingWorkedDates.add(log.checkIn.split('T')[0]);
        }
      }
    });

    const baseSalary = workedDates.size * staff.baseSalary;
    const outstandingBaseSalary = outstandingWorkedDates.size * staff.baseSalary;
    const settledBaseSalary = baseSalary - outstandingBaseSalary;

    const finalPayout = outstandingCommission + outstandingBaseSalary + outstandingBonus;
    const totalEarningsForPeriod = totalCommission + baseSalary + totalBonus;

    return {
      completedCount: completedAppts.length,
      totalCommission,
      outstandingCommission,
      settledCommission,
      totalBonus,
      outstandingBonus,
      settledBonus,
      baseSalary,
      outstandingBaseSalary,
      settledBaseSalary,
      totalSupportHoursSum: 0,
      totalSupportEarnings: 0,
      outstandingEarnings: 0,
      paidEarnings: 0,
      finalPayout,
      totalEarningsForPeriod,
      isSupport: false,
      items,
      bonuses: activeBonuses,
      logs: []
    };
  }
}
