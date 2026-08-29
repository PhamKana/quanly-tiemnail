import { calculatePayroll } from '../src/features/payroll/salary';
import { Staff, Appointment, NailService, StaffBonus, TimeLog } from '../../../packages/shared/src/types';

// Helper to create mock objects easily
const createMockStaff = (id: string, role: string, baseSalary: number, commissionRate = 0.6): Staff => ({
  id,
  name: `Staff ${id}`,
  phone: '0123456789',
  role,
  commissionRate,
  baseSalary,
  status: 'active'
});

const createMockAppointment = (id: string, staffId: string, totalPrice: number, date: string, status: 'completed' | 'pending' | 'cancelled' = 'completed'): Appointment => ({
  id,
  customerId: 'cust_123',
  customerName: 'Customer A',
  customerPhone: '0987654321',
  staffId,
  staffName: `Staff ${staffId}`,
  serviceIds: ['srv_1'],
  date,
  time: '10:00',
  status,
  notes: '',
  totalPrice
});

function runTests() {
  console.log('=== BẮT ĐẦU CHẠY UNIT TEST LOGIC TÍNH LƯƠNG ===\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, message: string) => {
    if (condition) {
      console.log(`✅ PASSED: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAILED: ${message}`);
      failed++;
    }
  };

  try {
    // TEST 1: Technician - Tính lương cứng dựa trên số ngày làm việc thực tế
    console.log('--- Test 1: Lương cứng của Thợ chính (Technician) theo ngày đi làm thực tế ---');
    const technician = createMockStaff('tech_1', 'Technician', 200000); // Lương cứng 200.000đ/ngày
    
    // Đơn 1: Ngày 2026-07-01 (Hoàn thành)
    // Đơn 2: Ngày 2026-07-01 (Hoàn thành - cùng ngày -> đếm là 1 ngày làm việc)
    // Đơn 3: Ngày 2026-07-02 (Hoàn thành)
    // Đơn 4: Ngày 2026-07-03 (Chưa hoàn thành -> không tính)
    const appointments: Appointment[] = [
      createMockAppointment('appt_1', 'tech_1', 300000, '2026-07-01', 'completed'),
      createMockAppointment('appt_2', 'tech_1', 150000, '2026-07-01', 'completed'),
      createMockAppointment('appt_3', 'tech_1', 200000, '2026-07-02', 'completed'),
      createMockAppointment('appt_4', 'tech_1', 500000, '2026-07-03', 'pending')
    ];

    const timeLogs: TimeLog[] = [
      { id: 'log_1', staffId: 'tech_1', checkIn: '2026-07-02T08:00:00.000Z', checkOut: '2026-07-02T12:00:00.000Z', totalHours: 4 }
    ];

    const stats = calculatePayroll(technician, appointments, [], [], timeLogs, '2026-07');

    // Giải thích kỳ vọng:
    // Số ngày hoạt động thực tế (unique worked dates) là Set('2026-07-01', '2026-07-02') -> 2 ngày.
    // Lương cứng = 2 ngày * 200.000đ = 400.000đ.
    // Hoa hồng = (300.000 + 150.000 + 200.000) * 60% = 650.000đ * 0.6 = 390.000đ.
    // Tổng thu nhập = 400.000đ (lương cứng) + 390.000đ (hoa hồng) = 790.000đ.
    assert(stats.baseSalary === 400000, `Lương cứng thực tế là ${stats.baseSalary.toLocaleString()}đ (Kỳ vọng: 400.000đ)`);
    assert(stats.totalCommission === 390000, `Hoa hồng thực tế là ${stats.totalCommission.toLocaleString()}đ (Kỳ vọng: 390.000đ)`);
    assert(stats.totalEarningsForPeriod === 790000, `Tổng thu nhập là ${stats.totalEarningsForPeriod.toLocaleString()}đ (Kỳ vọng: 790.000đ)`);

    // TEST 2: Hỗ trợ (Support) - Tính lương giờ và kiểm tra vai trò Thợ phụ
    console.log('\n--- Test 2: Tính lương và phụ cấp Thợ phụ (Support Staff) ---');
    const support = createMockStaff('supp_1', 'thợ phụ', 0); // Hỗ trợ không có lương cứng ngày cố định
    const supportTimeLogs: TimeLog[] = [
      // Ca 1: 5 giờ, thu nhập 150.000đ
      { id: 'slog_1', staffId: 'supp_1', checkIn: '2026-07-05T08:00:00.000Z', checkOut: '2026-07-05T13:00:00.000Z', totalHours: 5, totalEarnings: 150000, paid: false },
      // Ca 2: 3 giờ, thu nhập 90.000đ
      { id: 'slog_2', staffId: 'supp_1', checkIn: '2026-07-06T14:00:00.000Z', checkOut: '2026-07-06T17:00:00.000Z', totalHours: 3, totalEarnings: 90000, paid: true }
    ];

    const supportStats = calculatePayroll(support, [], [], [], supportTimeLogs, '2026-07');

    // Giải thích kỳ vọng:
    // Tổng số giờ làm việc: 5 + 3 = 8 giờ.
    // Tổng thu nhập hỗ trợ: 150.000đ + 90.000đ = 240.000đ.
    // Số tiền chưa thanh toán (outstanding): 150.000đ (ca 1 chưa paid).
    // Số tiền đã thanh toán (paid): 90.000đ (ca 2 đã paid).
    assert(supportStats.totalSupportHoursSum === 8, `Tổng số giờ hỗ trợ là ${supportStats.totalSupportHoursSum}h (Kỳ vọng: 8h)`);
    assert(supportStats.totalSupportEarnings === 240000, `Tổng thu nhập giờ là ${supportStats.totalSupportEarnings.toLocaleString()}đ (Kỳ vọng: 240.000đ)`);
    assert(supportStats.outstandingEarnings === 150000, `Số tiền chưa thanh toán là ${supportStats.outstandingEarnings.toLocaleString()}đ (Kỳ vọng: 150.000đ)`);
    assert(supportStats.paidEarnings === 90000, `Số tiền đã thanh toán là ${supportStats.paidEarnings.toLocaleString()}đ (Kỳ vọng: 90.000đ)`);

    // TEST 3: Thưởng (Bonus) cho nhân viên
    console.log('\n--- Test 3: Cộng tiền thưởng (Bonus) vào chu kỳ ---');
    const bonuses: StaffBonus[] = [
      { id: 'b_1', staffId: 'tech_1', month: '2026-07', amount: 50000, reason: 'Chuyên cần', createdAt: '2026-07-10T00:00:00.000Z' },
      { id: 'b_2', staffId: 'tech_1', month: '2026-08', amount: 100000, reason: 'Hiệu suất cao', createdAt: '2026-08-10T00:00:00.000Z' } // Không nằm trong tháng 7
    ];

    const techStatsWithBonus = calculatePayroll(technician, appointments, [], bonuses, timeLogs, '2026-07');

    // Giải thích kỳ vọng:
    // Thưởng tháng 7 là 50.000đ.
    // Tổng thu nhập chu kỳ = 790.000đ + 50.000đ = 840.000đ.
    assert(techStatsWithBonus.totalBonus === 50000, `Tiền thưởng tháng 7 là ${techStatsWithBonus.totalBonus.toLocaleString()}đ (Kỳ vọng: 50.000đ)`);
    assert(techStatsWithBonus.totalEarningsForPeriod === 840000, `Tổng thu nhập có thưởng là ${techStatsWithBonus.totalEarningsForPeriod.toLocaleString()}đ (Kỳ vọng: 840.000đ)`);

  } catch (err: any) {
    console.error('LỖI KHI CHẠY TEST:', err);
    failed++;
  }

  console.log('\n=== KẾT QUẢ UNIT TEST ===');
  console.log(`Đã vượt qua: ${passed}/${passed + failed}`);
  if (failed === 0) {
    console.log('🎉 TẤT CẢ UNIT TEST ĐÃ CHẠY THÀNH CÔNG RỰC RỠ!');
    process.exit(0);
  } else {
    console.error('🚨 CÓ UNIT TEST BỊ THẤT BẠI!');
    process.exit(1);
  }
}

runTests();
