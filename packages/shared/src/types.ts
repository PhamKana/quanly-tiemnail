export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  totalVisits: number;
  totalSpent: number;
  notes: string;
  createdAt: string;
  walletBalance?: number; // Số dư ví tích trữ/tiền cọc của khách hàng
  walletVersion?: number; // Version để tránh race-condition
}

export interface Staff {
  id: string;
  name: string;
  phone: string;
  role: string;
  commissionRate: number; // e.g. 0.6 (60%)
  baseSalary: number; // Lương cứng hàng ngày / cố định
  hourlyRate?: number; // Lương theo giờ (đối với Support, e.g. 30000 VNĐ/giờ)
  status: 'active' | 'inactive';
  username?: string;
  password?: string;
}

export interface TimeLog {
  id: string;
  staffId: string;
  checkIn: string; // ISO string
  checkOut?: string; // ISO string
  totalHours?: number; // e.g. 4.5
  totalEarnings?: number; // e.g. 135000
  paid?: boolean;
  paidAt?: string;
}

export interface NailService {
  id: string;
  name: string;
  category: 'basic-nail' | 'fake-nail' | 'design' | 'accessories';
}

export interface ExtraService {
  name: string;
  price: number;
}

export interface DenormalizedService {
  id: string;
  name: string;
  price: number;
  category?: 'basic-nail' | 'fake-nail' | 'design' | 'accessories';
}

export interface Appointment {
  id: string;
  groupId?: string; // Các đơn được tạo trong cùng một lần đặt lịch nhóm
  source?: 'booking' | 'walk_in';
  customerId: string;
  customerName: string;
  customerPhone: string;
  staffId: string;
  staffName: string;
  serviceIds: string[];
  services?: DenormalizedService[]; // Denormalized Embedded services details (NoSQL Best Practice)
  extraServices?: ExtraService[];
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  status: 'pending' | 'awaiting_payment' | 'completed' | 'cancelled' | 'deleted';
  pendingStatusApproval?: 'completed' | 'cancelled';
  notes: string;
  totalPrice: number;
  // totalPrice is the gross bill and remains the base for staff commission.
  subtotal?: number;
  discountCode?: string;
  discountPercent?: number;
  discountAmount?: number;
  totalAfterDiscount?: number;
  smsStatus?: 'not_sent' | 'sending' | 'sent' | 'delivered';
  paymentMethod?: 'cash' | 'transfer' | 'wallet';
  depositUsed?: number;
  amountDue?: number;
  paymentCollectedAmount?: number;
  paymentAllocatedAmount?: number;
  paymentStatus?: string;
  totalAmount?: number;
  useDeposit?: boolean;
  depositAmount?: number;
  depositPaid?: boolean;
  assignedDepositAmount?: number; // số tiền CỐ ĐỊNH sẽ bị trừ khỏi ví lúc checkout đơn này
  cancellationDepositAction?: 'refunded' | 'not_refunded';
  depositRefundedAmount?: number;
  depositRefundedAt?: string;
  paymentCode?: string;
  paymentTransactionId?: string;
  billEnteredBy?: string;
  billEnteredByName?: string;

  commissionRate?: number;
  commissionAmount?: number;
  payrollSettled?: boolean;
  payrollSettledAt?: string;
   receiptImage?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface SMSLog {
  id: string;
  appointmentId: string;
  customerName: string;
  phone: string;
  message: string;
  status: 'pending' | 'sending' | 'sent' | 'delivered';
  sentAt: string;
  type: 'appointment_created' | 'reminder_24h' | 'thank_you';
}

export interface DailyReport {
  date: string;
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  revenue: number;
  tips: number;
  discounts: number;
}

export interface StaffBonus {
  id: string;
  staffId: string;
  month: string; // e.g. "2026-06" or "all"
  amount: number;
  reason: string;
  createdAt: string;
  paid?: boolean;
  paidAt?: string;
  payrollSettlementId?: string;
}

export interface PayrollSettlement {
  id: string;
  staffId: string;
  staffName: string;
  month: string; // e.g., "2026-07"
  settledAt: string; // ISO string
  commissionPaid: number;
  baseSalaryPaid: number;
  bonusPaid: number;
  totalPaid: number;
  appointmentIds: string[];
  bonusIds: string[];
  timeLogIds: string[];
}

export interface SystemSettings {
  id?: string;
  bankId?: string; // e.g. MB, VCB
  bankAccountNumber?: string;
  bankAccountName?: string;
}

export interface PromotionCode {
  id: string;
  code: string;
  discountPercent: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  password?: string;
}

