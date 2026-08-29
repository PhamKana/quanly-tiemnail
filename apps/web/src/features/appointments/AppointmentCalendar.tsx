import React, { useState, useEffect, useRef } from 'react';
import { Appointment, Customer, Staff, NailService, SystemSettings } from '@shared/types';
import { 
  Calendar, Plus, Minus, Clock, Scissors, MessageSquare, CheckCircle, XCircle, 
  Search, User, Sparkles, Filter, ChevronRight, Edit, ShieldAlert,
  ChevronLeft, Check, Smartphone, Mail, Wallet, Trash, X, Phone, RotateCcw,
  Banknote, QrCode, ReceiptText, Undo2, Loader2
} from 'lucide-react';
import { CheckoutModal } from '@/features/checkout/components/CheckoutModal';
import {
  GroupCheckoutModal,
  resolveCheckoutSelection,
  resolvePinnedGroupAppointments
} from '@/features/checkout/components/GroupCheckoutModal';
import { QRDisplay } from '@/features/checkout/components/QRDisplay';
import { isStaffSupport } from '@/features/payroll/salary';
import { findCustomerById, findCustomersByExactName, findCustomersByPhone } from '@/shared/utils/customerIdentity';
import { AuthenticatedUserSession, getAuthHeaders } from '@/shared/lib/auth';

const createTempCustomerId = () =>
  `new_cust_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

interface AppointmentCalendarProps {
  appointments: Appointment[];
  customers: Customer[];
  staff: Staff[];
  services: NailService[];
  systemSettings?: SystemSettings;
  onAddAppointment: (appt: Omit<Appointment, 'id'>) => Promise<Appointment>;
  onUpdateStatus: (id: string, status: 'completed' | 'cancelled') => void;
  currentUser?: AuthenticatedUserSession | null;
  onClaimAppointment?: (appointmentId: string, staffId: string, staffName: string) => void;
  onAddExtraService?: (appointmentId: string, name: string, price: number) => void;
  onRemoveExtraService?: (appointmentId: string, index: number) => void;
  onUpdateAppointment?: (id: string, updatedFields: Partial<Appointment>) => void;
  onUpdateCustomer?: (id: string, updatedFields: Partial<Omit<Customer, 'id' | 'totalVisits' | 'totalSpent' | 'createdAt'>>) => void;
  onInvalidateHistoricalCache?: () => void;
}

export default function AppointmentCalendar({
  appointments,
  customers,
  staff,
  services,
  systemSettings,
  onAddAppointment,
  onUpdateStatus,
  currentUser,
  onClaimAppointment,
  onAddExtraService,
  onRemoveExtraService,
  onUpdateAppointment,
  onUpdateCustomer,
  onInvalidateHistoricalCache
}: AppointmentCalendarProps) {
  const paymentRequestHeaders = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(currentUser)
  };
  // Helper to format Date target according to the real-time of that day
  const getTodayString = (): string => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const getFutureDateString = (daysAhead: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const getCurrentTimeString = (): string => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const [filterDate, setFilterDate] = useState<'all' | 'custom-range'>('custom-range');
  const [rangeStart, setRangeStart] = useState(getTodayString());
  const [rangeEnd, setRangeEnd] = useState(getFutureDateString(7));
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [walkInTotal, setWalkInTotal] = useState<number>(200000);
  const [walkInPaymentMethod, setWalkInPaymentMethod] = useState<'cash' | 'transfer'>('cash');
  const [walkInQr, setWalkInQr] = useState<{ appointment: Appointment; paymentCode: string; amountDue: number } | null>(null);
  const [isCreatingWalkIn, setIsCreatingWalkIn] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    appointmentId: string;
    type: 'completed' | 'cancelled';
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  // Local 2-step confirmation states to avoid accidental clicks
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [confirmCancelRequestId, setConfirmCancelRequestId] = useState<string | null>(null);
  const [quickCompleteId, setQuickCompleteId] = useState<string | null>(null);
  const [quickCancelId, setQuickCancelId] = useState<string | null>(null);
  const [withdrawRequestAppt, setWithdrawRequestAppt] = useState<Appointment | null>(null);
  const [isWithdrawingRequest, setIsWithdrawingRequest] = useState(false);
  const [withdrawRequestError, setWithdrawRequestError] = useState('');
  const [billFeedback, setBillFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Weekly Grid and Checkout states
  const [currentViewType, setCurrentViewType] = useState<'cards' | 'weekly-grid' | 'mobile-grid'>('mobile-grid');
  const [selectedMobileDate, setSelectedMobileDate] = useState<string>(getTodayString());
  const [checkoutScope, setCheckoutScope] = useState<'group' | 'single'>('group');
  const [checkoutGroupAppointmentIds, setCheckoutGroupAppointmentIds] = useState<string[]>([]);

  const isAwaitingPayment = (appt: Appointment): boolean =>
    appt.status === 'awaiting_payment' || appt.pendingStatusApproval === 'completed';

  const isTransferPending = (appt: Appointment): boolean =>
    isAwaitingPayment(appt) && appt.paymentMethod === 'transfer';

  const isPaymentReconciliationRequired = (appt: Appointment): boolean =>
    appt.paymentStatus === 'requires_reconciliation';

  const getPaymentTransactionAppointments = (appt: Appointment): Appointment[] =>
    appt.paymentTransactionId
      ? appointments.filter(item => item.paymentTransactionId === appt.paymentTransactionId)
      : [appt];

  const getPaymentTransactionTotals = (appt: Appointment) => {
    const items = getPaymentTransactionAppointments(appt);
    return {
      items,
      billTotal: items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0),
      depositTotal: items.reduce((sum, item) => sum + (Number(item.depositUsed) || 0), 0),
      cashTotal: items.reduce((sum, item) => sum + Number(
        item.paymentAllocatedAmount ?? item.amountDue ?? item.paymentCollectedAmount ?? item.totalPrice ?? 0
      ), 0)
    };
  };

  const getAwaitingPaymentLabel = (appt: Appointment): string =>
    isPaymentReconciliationRequired(appt)
      ? 'Giao dịch QR cần quản lý đối soát'
      : isTransferPending(appt)
      ? 'Đang chờ hệ thống xác nhận chuyển khoản'
      : 'Chờ quản lý xác nhận đã thu tiền';

  const getWithdrawRequestLabel = (appt: Appointment): string =>
    currentUser?.role === 'admin'
      ? 'Yêu cầu chỉnh sửa'
      : isTransferPending(appt)
      ? 'Hủy phiên chuyển khoản'
      : 'Rút yêu cầu duyệt';

  const getApptServicesString = (appt: Appointment): string => {
    const serviceNames: string[] = [];
    if (appt.services && appt.services.length > 0) {
      appt.services.forEach(s => {
        serviceNames.push(s.name);
      });
    } else {
      (appt.serviceIds || []).forEach(sId => {
        const srv = services.find(s => s.id === sId);
        if (srv) {
          serviceNames.push(srv.name);
        }
      });
    }
    if (appt.extraServices && appt.extraServices.length > 0) {
      appt.extraServices.forEach(es => {
        serviceNames.push(`+${es.name}`);
      });
    }
    return serviceNames.length > 0 ? serviceNames.join(", ") : "Chưa đăng ký dịch vụ";
  };

  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [checkoutAppt, setCheckoutAppt] = useState<Appointment | null>(null);
  const [expandedApptId, setExpandedApptId] = useState<string | null>(null);
  const [uploadedReceipt, setUploadedReceipt] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [zoomedReceiptUrl, setZoomedReceiptUrl] = useState<string | null>(null);
  const [useWalletPayment, setUseWalletPayment] = useState(false);
  const [keepDepositInWallet, setKeepDepositInWallet] = useState(false);
  const [useWalletForDepositPrepayment, setUseWalletForDepositPrepayment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openCheckoutForAppointment = (
    appt: Appointment,
    requestedScope: 'auto' | 'group' | 'single' = 'auto'
  ) => {
    const selection = resolveCheckoutSelection(appointments, appt, requestedScope);

    setCheckoutScope(selection.scope);
    setCheckoutGroupAppointmentIds(selection.scope === 'group' ? selection.appointmentIds : []);
    setCheckoutAppt(appt);
  };

  const compressImageBase64 = (base64Str: string, maxWidth = 1600, maxHeight = 1600, quality = 0.9): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        } else {
          resolve(base64Str);
        }
      };
      img.onerror = () => {
        resolve(base64Str);
      };
    });
  };

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        compressImageBase64(base64String).then(compressed => {
          setUploadedReceipt(compressed);
        });
      };
      reader.readAsDataURL(file);
    }
  };

  // Masking helpers for Worker customer privacy
  const maskCustomerName = (name: string): string => {
    if (!name) return "";
    const trimmed = name.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      const p = parts[0];
      return p.length <= 1 ? p : p[0] + "*".repeat(p.length - 1) + " (🔒 Đã ẩn)";
    }
    return parts.map((part) => {
      if (part.length <= 1) return part;
      return part[0] + "*".repeat(part.length - 1);
    }).join(" ") + " (🔒 Đã ẩn)";
  };

  const maskCustomerPhone = (phone: string): string => {
    if (!phone) return "";
    const clean = phone.replace(/\s+/g, '');
    if (clean.length <= 6) return "*".repeat(clean.length);
    return clean.slice(0, 3) + "****" + clean.slice(-3);
  };

  const TIME_SLOTS = [
    "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30",
    "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"
  ];

  const getTimeSlot = (time: string): string => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return `${String(hour).padStart(2, '0')}:${minute < 30 ? '00' : '30'}`;
};

const getCurrentWeekDays = (): { dateString: string; label: string; dayIndex: number }[] => {
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday ...
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    
    const monday = new Date();
    monday.setDate(today.getDate() + diffToMonday + (weekOffset * 7));
    
    const days = [];
    const dayNames = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    for (let i = 0; i < 7; i++) {
       const nextDay = new Date(monday);
       nextDay.setDate(monday.getDate() + i);
       const yyyy = nextDay.getFullYear();
       const mm = String(nextDay.getMonth() + 1).padStart(2, '0');
       const dd = String(nextDay.getDate()).padStart(2, '0');
       days.push({
         dateString: `${yyyy}-${mm}-${dd}`,
         label: `${dayNames[i]} (${dd}/${mm})`,
         dayIndex: i
       });
    }
    return days;
  };

  const getApptsForCell = (dateString: string, slotString: string) => {
    const slotHour = parseInt(slotString.split(":")[0], 10);
    const slotMin = parseInt(slotString.split(":")[1] || "0", 10);
    return appointments.filter(appt => {
      if (appt.date !== dateString) return false;
      
      // Keep every active job visible, including bills that are waiting for payment confirmation.
      const isActiveAppointment = appt.status === 'pending' || isAwaitingPayment(appt);
      if (!isActiveAppointment) return false;
      
      const apptHour = parseInt(appt.time.split(":")[0], 10);
      const apptMin = parseInt(appt.time.split(":")[1] || "0", 10);
      
      if (apptHour !== slotHour) return false;
      if (slotMin === 0) {
        return apptMin < 30;
      } else {
        return apptMin >= 30;
      }
    });
  };

  useEffect(() => {
    if (currentUser?.role === 'staff') {
      setRangeStart(getTodayString());
      setRangeEnd(getTodayString());
      setCurrentViewType('mobile-grid');
    } else {
      setRangeStart(getTodayString());
      setRangeEnd(getFutureDateString(7));
      setCurrentViewType('mobile-grid');
    }
  }, [currentUser?.role, currentUser?.staffId]);

  useEffect(() => {
    if (!billFeedback) return;
    const timeoutId = window.setTimeout(() => setBillFeedback(null), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [billFeedback]);

  // Extra services local states
  const [addingExtraApptId, setAddingExtraApptId] = useState<string | null>(null);
  const [extraSrvName, setExtraSrvName] = useState('');
  const [extraSrvPrice, setExtraSrvPrice] = useState('');

  const handleAddNewExtra = (apptId: string) => {
    if (!extraSrvName.trim() || !extraSrvPrice.trim()) return;
    onAddExtraService?.(apptId, extraSrvName.trim(), Number(extraSrvPrice));
    setAddingExtraApptId(null);
    setExtraSrvName('');
    setExtraSrvPrice('');
  };

  // Helper to determine the unit of a service
  const getServiceUnit = (srv: NailService | undefined): string => {
    if (!srv) return 'bộ';
    const nameLower = srv.name.toLowerCase();
    if (nameLower.includes('ngóng') || nameLower.includes('ngôn') || nameLower.includes('ngón') || nameLower.includes('ngon') || srv.category === 'design') {
      if (nameLower.includes('(bộ)') || nameLower.includes(' bộ')) {
        return 'bộ';
      }
      return 'ngón';
    }
    if (nameLower.includes('viên') || nameLower.includes('vien') || nameLower.includes('charm') || nameLower.includes('đá') || srv.category === 'accessories') {
      return 'viên';
    }
    return 'bộ';
  };

  // Helper to check if a service is calculated per finger/item (We now support quantity tracking for all selected services)
  const isPerItemService = (srv: NailService | undefined): boolean => {
    return true;
  };

  // Editing states (for Admin editing any appointment - phát sinh ngoài ý muốn)
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [editStaffId, setEditStaffId] = useState('');
  const [editServices, setEditServices] = useState<string[]>([]); // holds unique selected service ids
  const [editQuantities, setEditQuantities] = useState<Record<string, number>>({});
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPrice, setEditPrice] = useState(0);
  const [editStatus, setEditStatus] = useState<'pending' | 'completed' | 'cancelled'>('pending');
  const [editUseDeposit, setEditUseDeposit] = useState<boolean>(true);

  const handleStartEdit = (appt: Appointment) => {
    setEditingAppt(appt);
    setEditStaffId(appt.staffId || '');
    
    const uniqueIds: string[] = [];
    const qMap: Record<string, number> = {};
    (appt.serviceIds || []).forEach(id => {
      if (!uniqueIds.includes(id)) {
        uniqueIds.push(id);
      }
      qMap[id] = (qMap[id] || 0) + 1;
    });

    setEditServices(uniqueIds);
    setEditQuantities(qMap);
    setEditDate(appt.date);
    setEditTime(appt.time);
    setEditNotes(appt.notes || '');
    setEditPrice(appt.totalPrice);
    setEditStatus(appt.status);
    setEditUseDeposit(appt.useDeposit ?? true);
  };

  const toggleEditService = (srvId: string) => {
    let updated: string[];
    if (editServices.includes(srvId)) {
      updated = editServices.filter(id => id !== srvId);
    } else {
      updated = [...editServices, srvId];
      if (!editQuantities[srvId]) {
        setEditQuantities(prev => ({ ...prev, [srvId]: 1 }));
      }
    }
    setEditServices(updated);

    // Recalculate automatic sum of primary selected items, plus any existing extras
    const serviceSum = 0;
    const extraSum = (editingAppt?.extraServices || []).reduce((sum, es) => sum + es.price, 0);
    setEditPrice(serviceSum + extraSum);
  };

  const updateEditQuantity = (srvId: string, qty: number) => {
    const val = Math.max(1, qty);
    const updatedQuantities = { ...editQuantities, [srvId]: val };
    setEditQuantities(updatedQuantities);

    // Recalculate automatic sum
    const serviceSum = 0;
    const extraSum = (editingAppt?.extraServices || []).reduce((sum, es) => sum + es.price, 0);
    setEditPrice(serviceSum + extraSum);
  };

  const handleRecalculateEditPrice = () => {
    const serviceSum = 0;
    const extraSum = (editingAppt?.extraServices || []).reduce((sum, es) => sum + es.price, 0);
    setEditPrice(serviceSum + extraSum);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAppt) return;

    let staffName = 'Chưa phân công thợ';
    if (editStaffId) {
      const matched = staff.find(s => s.id === editStaffId);
      if (matched) staffName = matched.name;
    }

    const flatEditServices: string[] = [];
    editServices.forEach(srvId => {
      const srv = services.find(s => s.id === srvId);
      const qty = isPerItemService(srv) ? (editQuantities[srvId] ?? 1) : 1;
      for (let i = 0; i < qty; i++) {
        flatEditServices.push(srvId);
      }
    });

    const finalEditStatus = currentUser?.role === 'admin'
      ? editStatus 
      : (editStaffId && editStatus === 'cancelled' ? 'pending' : editStatus);

    onUpdateAppointment?.(editingAppt.id, {
      staffId: editStaffId,
      staffName,
      serviceIds: flatEditServices,
      date: editDate,
      time: editTime,
      notes: editNotes,
      totalPrice: editPrice,
      status: finalEditStatus,
      useDeposit: editUseDeposit
    });

    setEditingAppt(null);
  };

  // Form states for booking
  const [selectedCustId, setSelectedCustId] = useState('');
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const matchingCustomersByPhone = findCustomersByPhone(customers, newCustPhone);
  const matchingCustomersByName = findCustomersByExactName(customers, newCustName);
  const [bookingUseDeposit, setBookingUseDeposit] = useState<boolean>(true);
  const [showDuplicateNameWarning, setShowDuplicateNameWarning] = useState(false);
  
  // Live smart additions
  const [activeStep, setActiveStep] = useState<number>(1);
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<number>(50000);
  const [custType, setCustType] = useState<'existing' | 'new'>('existing');

  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]); // Unique ids
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>({});
  const [apptDate, setApptDate] = useState(getTodayString());
  const [apptTime, setApptTime] = useState(getCurrentTimeString());
  const [notes, setNotes] = useState('');
  const [assignedDepositAmount, setAssignedDepositAmount] = useState<number>(50000);
  const [numAppointments, setNumAppointments] = useState<number>(1);
  const [previewAppointments, setPreviewAppointments] = useState<any[]>([]);

  // Responsive state for duplication feature
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [showDuplicateSheet, setShowDuplicateSheet] = useState<boolean>(false);
  const [duplicateCount, setDuplicateCount] = useState<number>(1);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleDuplicate = (count: number) => {
    setNumAppointments(count);
    setShowDuplicateSheet(false);
  };

  const addPreviewService = (appointmentIndex: number, serviceId: string) => {
    if (!serviceId) return;
    setPreviewAppointments(prev => prev.map((appt, index) => {
      if (index !== appointmentIndex || appt.serviceIds.includes(serviceId)) return appt;
      return { ...appt, serviceIds: [...appt.serviceIds, serviceId] };
    }));
  };

  const removePreviewService = (appointmentIndex: number, serviceId: string) => {
    setPreviewAppointments(prev => prev.map((appt, index) =>
      index === appointmentIndex
        ? { ...appt, serviceIds: appt.serviceIds.filter((id: string) => id !== serviceId) }
        : appt
    ));
  };

  const updatePreviewStaff = (appointmentIndex: number, staffId: string) => {
    const technician = staff.find(member => member.id === staffId);
    setPreviewAppointments(prev => prev.map((appt, index) =>
      index === appointmentIndex
        ? {
            ...appt,
            staffId,
            staffName: technician?.name ?? 'Chưa phân công thợ'
          }
        : appt
    ));
  };

  const copyPreviewServicesFromFirst = (appointmentIndex: number) => {
    setPreviewAppointments(prev => {
      const firstServiceIds = prev[0]?.serviceIds ?? [];
      return prev.map((appt, index) =>
        index === appointmentIndex ? { ...appt, serviceIds: [...firstServiceIds] } : appt
      );
    });
  };

  const handleCancelAppointment = async (
    appt: Appointment,
    refundDepositOrCallback: boolean | (() => void),
    callbackMaybe?: () => void
  ) => {
    const refundDeposit = typeof refundDepositOrCallback === 'boolean' ? refundDepositOrCallback : false;
    const callbackOnSuccess = typeof refundDepositOrCallback === 'function'
      ? refundDepositOrCallback
      : (callbackMaybe || (() => undefined));

    try {
      const res = await fetch('/api/cancel-appointment', {
        method: 'POST',
        headers: paymentRequestHeaders,
        body: JSON.stringify({ appointmentId: appt.id, refundDeposit })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Hủy lịch hẹn thất bại');
      }
      const todayStr = getTodayString();
      if (appt.date && appt.date < todayStr) {
        onInvalidateHistoricalCache?.();
      }
      callbackOnSuccess();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Không thể hủy lịch hẹn');
    }
  };

  const handleAdminApprovePayment = async (appt: Appointment) => {
    try {
      const res = await fetch('/api/admin-approve', {
        method: 'POST',
        headers: paymentRequestHeaders,
        body: JSON.stringify({ appointmentId: appt.id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể duyệt thanh toán');
      }
      const todayStr = getTodayString();
      if (appt.date && appt.date < todayStr) {
        onInvalidateHistoricalCache?.();
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Không thể duyệt thanh toán');
    } finally {
      setConfirmApproveId(null);
    }
  };

  const openWithdrawRequest = (appt: Appointment) => {
    setWithdrawRequestError('');
    setWithdrawRequestAppt(appt);
  };

  const closeWithdrawRequest = () => {
    if (isWithdrawingRequest) return;
    setWithdrawRequestError('');
    setWithdrawRequestAppt(null);
  };

  const confirmWithdrawRequest = async () => {
    if (!withdrawRequestAppt || isWithdrawingRequest) return;

    setIsWithdrawingRequest(true);
    setWithdrawRequestError('');
    try {
      const res = await fetch('/api/checkout-cancel-request', {
        method: 'POST',
        headers: paymentRequestHeaders,
        body: JSON.stringify({ appointmentId: withdrawRequestAppt.id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể rút yêu cầu duyệt');
      }

      const todayStr = getTodayString();
      if (withdrawRequestAppt.date && withdrawRequestAppt.date < todayStr) {
        onInvalidateHistoricalCache?.();
      }

      setExpandedApptId(null);
      setSelectedStaffAppt(null);
      setWithdrawRequestAppt(null);
      setBillFeedback({
        type: 'success',
        message: isTransferPending(withdrawRequestAppt)
          ? 'Đã hủy phiên chuyển khoản. Bill đã mở lại để chỉnh sửa.'
          : 'Đã rút yêu cầu duyệt. Bill đã mở lại để chỉnh sửa.'
      });
    } catch (err: any) {
      console.error(err);
      const message = err.message || 'Không thể rút yêu cầu duyệt';
      setWithdrawRequestError(message);
      setBillFeedback({ type: 'error', message });
    } finally {
      setIsWithdrawingRequest(false);
    }
  };

  const getInitialPreviewAppointments = (n: number, customTempCustId?: string) => {
    let customerName = '';
    let customerPhone = '';
    let customerId = selectedCustId;

    const actualTempId = customTempCustId || createTempCustomerId();

    if (custType === 'new' || selectedCustId === 'new') {
      customerName = newCustName.trim();
      customerPhone = newCustPhone.trim();
      customerId = actualTempId;
    } else {
      const existing = customers.find(c => c.id === selectedCustId);
      if (existing) {
        customerName = existing.name;
        customerPhone = existing.phone;
      }
    }

    let staffId = selectedStaffId;
    let staffName = 'Chưa phân công thợ';
    if (selectedStaffId) {
      const technician = staff.find(s => s.id === selectedStaffId);
      if (technician) {
        staffName = technician.name;
      }
    }

    const flatServiceIds: string[] = [];
    selectedServices.forEach(srvId => {
      const srv = services.find(s => s.id === srvId);
      const qty = isPerItemService(srv) ? (serviceQuantities[srvId] ?? 1) : 1;
      for (let i = 0; i < qty; i++) {
        flatServiceIds.push(srvId);
      }
    });

    const finalNotes = [
      notes,
      customerEmail ? `[Email: ${customerEmail}]` : '',
      depositAmount > 0 ? `[Đã cọc: ${depositAmount.toLocaleString()} VNĐ]` : ''
    ].filter(Boolean).join(' ');

    const list = [];
    for (let i = 0; i < n; i++) {
      list.push({
        id: `preview_${i}`,
        customerId,
        customerName,
        customerPhone,
        staffId,
        staffName,
        serviceIds: [...flatServiceIds],
        date: apptDate,
        time: apptTime,
        notes: finalNotes,
        totalPrice: calculatedTotal,
        useDeposit: (custType === 'existing' && selectedCustId) ? bookingUseDeposit : true,
        depositAmount: depositAmount,
        depositPaid: !useWalletForDepositPrepayment,
        assignedDepositAmount: assignedDepositAmount
      });
    }
    return list;
  };

  useEffect(() => {
    if (activeStep === 3 && numAppointments > 1) {
      setPreviewAppointments(prev => {
        if (prev.length === numAppointments) return prev;
        const initial = getInitialPreviewAppointments(numAppointments);
        const result = initial.map((item, idx) => {
          if (prev[idx]) {
            return {
              ...prev[idx],
              depositAmount: item.depositAmount,
              depositPaid: item.depositPaid,
              assignedDepositAmount: item.assignedDepositAmount,
              notes: item.notes,
            };
          }
          return item;
        });
        return result;
      });
    }
  }, [numAppointments, activeStep, selectedCustId, newCustName, newCustPhone, custType, selectedStaffId, selectedServices, serviceQuantities, apptDate, apptTime, notes, customerEmail, depositAmount, bookingUseDeposit, useWalletForDepositPrepayment, assignedDepositAmount]);

  // Staff inline notes states
  const [editingNoteApptId, setEditingNoteApptId] = useState<string | null>(null);
  const [tempNoteText, setTempNoteText] = useState("");
  const [selectedStaffApptId, setSelectedStaffApptId] = useState<string | null>(null);
  const selectedStaffAppt = appointments.find(a => a.id === selectedStaffApptId) || null;
  const setSelectedStaffAppt = (appt: Appointment | null) => {
    setSelectedStaffApptId(appt ? appt.id : null);
  };

  useEffect(() => {
    if (
      selectedStaffAppt &&
      ['completed', 'cancelled', 'deleted'].includes(selectedStaffAppt.status)
    ) {
      setSelectedStaffApptId(null);
      setEditingNoteApptId(null);
    }
  }, [selectedStaffAppt?.id, selectedStaffAppt?.status]);

  // Service selection list filtering
  const [bookingServiceCategory, setBookingServiceCategory] = useState<'all' | 'basic-nail' | 'fake-nail' | 'design' | 'accessories'>('all');
  const [bookingServiceSearch, setBookingServiceSearch] = useState('');

  // Admin edit service selection list filtering
  const [editServiceCategory, setEditServiceCategory] = useState<'all' | 'basic-nail' | 'fake-nail' | 'design' | 'accessories'>('all');
  const [editServiceSearch, setEditServiceSearch] = useState('');

  // Search filter appointments sorted by completion status then date/time
  const filteredAppts = appointments
    .filter(appt =>
      appt &&
      typeof appt.date === 'string' && appt.date.length > 0 &&
      typeof appt.time === 'string' && appt.time.length > 0 &&
      typeof appt.customerName === 'string' &&
      typeof appt.staffName === 'string'
    )
    .filter(appt => {
      // Date filter range checking
      if (filterDate !== 'all') {
        if (appt.date < rangeStart || appt.date > rangeEnd) {
          return false;
        }
      }

      // Search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          (appt.customerName ?? '').toLowerCase().includes(q) ||
          (appt.customerPhone ?? '').includes(q) ||
          (appt.staffName ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    }).sort((a, b) => {
      const hasPendingApprovalA = isAwaitingPayment(a);
      const hasPendingApprovalB = isAwaitingPayment(b);
      if (hasPendingApprovalA !== hasPendingApprovalB) {
        return hasPendingApprovalA ? -1 : 1;
      }

      const getStatusScore = (appt: Appointment) => {
        if (isAwaitingPayment(appt)) return 0;
        if (appt.status === 'pending') return 0;
        if (appt.status === 'completed') return 1;
        return 2; // cancelled
      };
      const scoreA = getStatusScore(a);
      const scoreB = getStatusScore(b);
      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      // If scores are equal, sort ascending by Date and Time (earliaer first)
      const dateTimeA = `${a.date ?? ''}T${a.time ?? ''}`;
      const dateTimeB = `${b.date ?? ''}T${b.time ?? ''}`;
      return dateTimeA.localeCompare(dateTimeB);
    });

  const displayedCardAppts = currentUser?.role === 'staff'
    ? filteredAppts.filter(
        appt => appt.status !== 'completed' && appt.status !== 'cancelled' && appt.status !== 'deleted'
      )
    : filteredAppts;
  const groupedCardMap = new Map<string, Appointment[]>();
  displayedCardAppts.forEach(appt => {
    if (!appt.groupId) return;
    const group = groupedCardMap.get(appt.groupId) || [];
    group.push(appt);
    groupedCardMap.set(appt.groupId, group);
  });
  const groupedCardEntries = [...groupedCardMap.entries()].filter(([, group]) => group.length > 1);
  const groupedCardAppointmentIds = new Set(groupedCardEntries.flatMap(([, group]) => group.map(appt => appt.id)));
  const standaloneCardAppts = displayedCardAppts.filter(appt => !groupedCardAppointmentIds.has(appt.id));
  // Calculate booking cost dynamically
  const closeWalkInModal = () => {
    if (isCreatingWalkIn) return;
    setShowWalkInModal(false);
    setWalkInQr(null);
    setWalkInTotal(200000);
    setWalkInPaymentMethod('cash');
  };

  const handleCreateAndCheckoutWalkIn = async () => {
    if (isCreatingWalkIn || currentUser?.role !== 'staff' || !currentUser.staffId) return;
    const total = Number(walkInTotal);
    if (!Number.isFinite(total) || total <= 0) {
      alert('Vui lòng nhập số tiền hợp lệ.');
      return;
    }

    setIsCreatingWalkIn(true);
    try {
      const newAppt = await onAddAppointment({
        customerId: `walkin_${Date.now()}`,
        customerName: 'Khách vãng lai',
        customerPhone: '',
        staffId: currentUser.staffId,
        staffName: currentUser.name,
        serviceIds: [],
        date: getTodayString(),
        time: getTimeSlot(getCurrentTimeString()),
        status: 'pending',
        notes: '',
        totalPrice: total,
        useDeposit: false,
        depositAmount: 0,
        depositPaid: false,
        assignedDepositAmount: 0,
        source: 'walk_in'
      });

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: paymentRequestHeaders,
        body: JSON.stringify({
          appointmentId: newAppt.id,
          paymentMethod: walkInPaymentMethod,
          totalPrice: total,
          useDeposit: false,
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Không thể khởi tạo thanh toán.');

      const paymentFields = {
        status: 'awaiting_payment' as const,
        pendingStatusApproval: 'completed' as const,
        paymentMethod: walkInPaymentMethod,
        amountDue: result.finalAmountDue,
        depositUsed: 0,
        useDeposit: false,
        paymentCode: result.paymentCode
      };
      onUpdateAppointment?.(newAppt.id, paymentFields);

      if (walkInPaymentMethod === 'transfer' && result.paymentCode) {
        setWalkInQr({ appointment: { ...newAppt, ...paymentFields }, paymentCode: result.paymentCode, amountDue: result.finalAmountDue });
        return;
      }

      closeWalkInModal();
      alert('Đã tạo đơn tiền mặt và gửi yêu cầu duyệt bill.');
    } catch (error: any) {
      alert(error?.message || 'Không thể tạo đơn nhanh. Vui lòng thử lại.');
    } finally {
      setIsCreatingWalkIn(false);
    }
  };

  const calculatedTotal = 0;

  const toggleService = (srvId: string) => {
    if (selectedServices.includes(srvId)) {
      setSelectedServices(selectedServices.filter(id => id !== srvId));
    } else {
      setSelectedServices([...selectedServices, srvId]);
      if (!serviceQuantities[srvId]) {
        setServiceQuantities(prev => ({ ...prev, [srvId]: 1 }));
      }
    }
  };

  const updateServiceQuantity = (srvId: string, qty: number) => {
    const val = Math.max(1, qty);
    setServiceQuantities(prev => ({ ...prev, [srvId]: val }));
  };

  const goToStep3 = () => {
    setActiveStep(3);
    const tempId = createTempCustomerId();
    setPreviewAppointments(getInitialPreviewAppointments(numAppointments, tempId));
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Đã bỏ yêu câu bắt buộc có dịch vụ ngay từ lúc tạo đơn (Yêu cầu 3).
    // Thợ sẽ linh hoạt chốt con số thực tế cần thu sau khi làm xong cho khách.

    let customerName = '';
    let customerPhone = '';
    let customerId = selectedCustId;

    const isNewCust = custType === 'new' || selectedCustId === 'new';
    const submissionTempCustId = isNewCust ? createTempCustomerId() : '';

    if (isNewCust) {
      if (!newCustName.trim()) {
        alert("Vui lòng nhập tên cho khách hàng mới!");
        return;
      }
      customerName = newCustName.trim();
      customerPhone = newCustPhone.trim();
      // customerId is created dynamically in parent, we set empty here to signal creation
      customerId = submissionTempCustId;
    } else {
      const existing = customers.find(c => c.id === selectedCustId);
      if (existing) {
        customerName = existing.name;
        customerPhone = existing.phone;
      } else {
        alert("Vui lòng chọn khách hàng!");
        return;
      }
    }

    let staffId = '';
    let staffName = 'Chưa phân công thợ';

    if (selectedStaffId) {
      const technician = staff.find(s => s.id === selectedStaffId);
      if (technician) {
        staffId = technician.id;
        staffName = technician.name;
      }
    }

    const flatServiceIds: string[] = [];
    selectedServices.forEach(srvId => {
      const srv = services.find(s => s.id === srvId);
      const qty = isPerItemService(srv) ? (serviceQuantities[srvId] ?? 1) : 1;
      for (let i = 0; i < qty; i++) {
        flatServiceIds.push(srvId);
      }
    });

    const finalNotes = [
      notes,
      customerEmail ? `[Email: ${customerEmail}]` : '',
      depositAmount > 0 ? `[Đã cọc: ${depositAmount.toLocaleString()} VNĐ]` : ''
    ].filter(Boolean).join(' ');

    if (numAppointments > 1) {
      const groupId = `G${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const invalidAppt = previewAppointments.find(appt => appt.totalPrice > 0 && appt.assignedDepositAmount > appt.totalPrice);
      if (invalidAppt) {
        alert(`Lỗi: Có đơn hàng có số tiền cọc khấu trừ (${invalidAppt.assignedDepositAmount.toLocaleString()}đ) vượt quá giá chốt dự kiến (${invalidAppt.totalPrice.toLocaleString()}đ)!`);
        return;
      }

      // Create N independent appointments from custom preview fields
      for (const appt of previewAppointments) {
        await onAddAppointment({
          groupId,
          customerId: isNewCust ? submissionTempCustId : appt.customerId,
          customerName: appt.customerName,
          customerPhone: appt.customerPhone,
          staffId: appt.staffId,
          staffName: appt.staffName,
          serviceIds: appt.serviceIds,
          date: appt.date,
          time: appt.time,
          status: 'pending',
          notes: appt.notes,
          totalPrice: appt.totalPrice,
          useDeposit: appt.useDeposit,
          depositAmount: appt.depositAmount,
          depositPaid: !useWalletForDepositPrepayment,
          assignedDepositAmount: appt.assignedDepositAmount
        });
      }
    } else {
      if (calculatedTotal > 0 && assignedDepositAmount > calculatedTotal) {
        alert(`Lỗi: Số tiền cọc khấu trừ (${assignedDepositAmount.toLocaleString()}đ) không được vượt quá giá đơn hàng (${calculatedTotal.toLocaleString()}đ)!`);
        return;
      }

      onAddAppointment({
        customerId,
        customerName,
        customerPhone,
        staffId,
        staffName,
        serviceIds: flatServiceIds,
        date: apptDate,
        time: apptTime,
        status: 'pending',
        notes: finalNotes,
        totalPrice: calculatedTotal,
        useDeposit: (custType === 'existing' && selectedCustId) ? bookingUseDeposit : true,
        depositAmount: depositAmount,
        depositPaid: !useWalletForDepositPrepayment,
        assignedDepositAmount: assignedDepositAmount
      });
    }

    // Reset fields
    setSelectedCustId('');
    setNewCustName('');
    setNewCustPhone('');
    setSelectedServices([]);
    setServiceQuantities({});
    setNotes('');
    setApptDate(getTodayString());
    setApptTime(getCurrentTimeString());
    setCustomerSearchQuery('');
    setCustomerEmail('');
    setDepositAmount(50000);
    setAssignedDepositAmount(50000);
    setNumAppointments(1);
    setDuplicateCount(1);
    setPreviewAppointments([]);
    setBookingUseDeposit(true);
    setUseWalletForDepositPrepayment(false);
    setActiveStep(1);
    setShowModal(false);
  };

  const renderGroupedAppointmentActions = (appt: Appointment, compact = false) => {
    const isCompleted = appt.status === 'completed';
    const isCancelled = appt.status === 'cancelled' || appt.status === 'deleted';
    // Match standalone bills: terminal group bills are read-only and expose no
    // detail/edit actions from the active-work views.
    if (isCompleted || isCancelled) return null;
    const isPendingPayment = isAwaitingPayment(appt);
    const hasCancelRequest = appt.pendingStatusApproval === 'cancelled';
    const isActive = !isCompleted && !isCancelled;
    const isAssignedToCurrentStaff = currentUser?.role === 'staff' && appt.staffId === currentUser.staffId;
    const transactionAppointments = getPaymentTransactionAppointments(appt);
    const isPaymentActionLeader = !appt.paymentTransactionId || transactionAppointments[0]?.id === appt.id;
    const buttonClass = compact
      ? 'min-h-8 rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition-all'
      : 'min-h-9 rounded-lg border px-3 py-2 text-xs font-bold transition-all';

    const resetActionConfirmations = () => {
      setQuickCompleteId(null);
      setQuickCancelId(null);
      setConfirmApproveId(null);
      setConfirmCancelRequestId(null);
    };

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSelectedStaffAppt(appt)}
          className={`${buttonClass} border-border bg-white text-foreground hover:bg-muted`}
        >
          Chi tiết
        </button>

        {(currentUser?.role === 'admin' || currentUser?.role === 'support') && (
          <button
            type="button"
            onClick={() => handleStartEdit(appt)}
            className={`${buttonClass} flex items-center gap-1 border-border bg-white text-foreground hover:border-accent hover:text-accent`}
          >
            <Edit className="h-3.5 w-3.5" /> Sửa
          </button>
        )}

        {currentUser?.role === 'admin' && isActive && hasCancelRequest && (
          <button
            type="button"
            onClick={() => {
              resetActionConfirmations();
              setConfirmCancelRequestId(appt.id);
            }}
            className={`${buttonClass} flex items-center gap-1 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}
          >
            <XCircle className="h-3.5 w-3.5" /> Duyệt hủy
          </button>
        )}

        {currentUser?.role === 'admin' && isActive && isPendingPayment && !isTransferPending(appt) && isPaymentActionLeader && (
          <button
            type="button"
            onClick={() => {
              resetActionConfirmations();
              setConfirmApproveId(appt.id);
            }}
            className={`${buttonClass} flex items-center gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
          >
            <CheckCircle className="h-3.5 w-3.5" /> {transactionAppointments.length > 1 ? 'Duyệt cả nhóm' : 'Duyệt hoàn thành'}
          </button>
        )}

        {currentUser?.role === 'admin' && isActive && isPendingPayment && !isPaymentReconciliationRequired(appt) && isPaymentActionLeader && (
          <button
            type="button"
            onClick={() => openWithdrawRequest(appt)}
            className={`${buttonClass} flex items-center gap-1 border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
          >
            <Undo2 className="h-3.5 w-3.5" /> {transactionAppointments.length > 1 ? 'Mở lại cả nhóm' : 'Yêu cầu sửa'}
          </button>
        )}

        {currentUser?.role === 'admin' && isActive && !isPendingPayment && !hasCancelRequest && (
          <>
            <button
              type="button"
              onClick={() => {
                resetActionConfirmations();
                setQuickCompleteId(appt.id);
              }}
              className={`${buttonClass} flex items-center gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
            >
              <CheckCircle className="h-3.5 w-3.5" /> Hoàn thành
            </button>
            <button
              type="button"
              onClick={() => {
                resetActionConfirmations();
                setQuickCancelId(appt.id);
              }}
              className={`${buttonClass} flex items-center gap-1 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}
            >
              <XCircle className="h-3.5 w-3.5" /> Hủy đơn
            </button>
          </>
        )}

        {isAssignedToCurrentStaff && isActive && (
          isPendingPayment ? (
            <button
              type="button"
              onClick={() => openWithdrawRequest(appt)}
              className={`${buttonClass} flex items-center gap-1 border-rose-200 bg-white text-rose-700 hover:bg-rose-50`}
            >
              <Undo2 className="h-3.5 w-3.5" /> {getWithdrawRequestLabel(appt)}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                openCheckoutForAppointment(appt);
              }}
              className={`${buttonClass} flex items-center gap-1 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}
            >
              <ReceiptText className="h-3.5 w-3.5" /> Chốt bill
            </button>
          )
        )}

        {currentUser?.role === 'staff' && !appt.staffId && appt.status === 'pending' && (
          <button
            type="button"
            onClick={() => {
              if (currentUser.staffId) {
                onClaimAppointment?.(appt.id, currentUser.staffId, currentUser.name);
              }
            }}
            className={`${buttonClass} border-accent bg-accent text-white hover:bg-accent-secondary`}
          >
            Nhận đơn
          </button>
        )}
      </div>
    );
  };

  return (
    <div id="appointment-calendar-section" className="space-y-4">
      {/* Controls Area */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 bg-white p-3.5 rounded-lg border border-border shadow-sm transition-all duration-300">
        {/* Date Filter Inline Calendar Picker (Hidden for staff, but shown for admin and support to check slot availability) */}
        {(currentUser?.role === 'admin' || currentUser?.role === 'support') && currentViewType !== 'mobile-grid' && (
          <div className="flex flex-wrap items-center gap-3">

            {/* Date Picker Input */}
            <div className="flex items-center gap-2 bg-muted p-1.5 rounded-lg border border-border/60 text-sm flex-wrap">
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider pl-1.5 py-0.5 font-mono">Khoảng ngày:</span>
              
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground font-semibold">Từ</span>
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => {
                    if (e.target.value) {
                      setRangeStart(e.target.value);
                      setFilterDate('custom-range');
                    }
                  }}
                  className={`px-2.5 py-1 text-xs border rounded-md font-bold cursor-pointer outline-hidden transition-all ${
                    filterDate === 'custom-range'
                      ? 'border-accent bg-white text-foreground shadow-xs'
                      : 'border-transparent bg-transparent text-foreground hover:bg-white/40'
                  }`}
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground font-semibold">Đến</span>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => {
                    if (e.target.value) {
                      setRangeEnd(e.target.value);
                      setFilterDate('custom-range');
                    }
                  }}
                  className={`px-2.5 py-1 text-xs border rounded-md font-bold cursor-pointer outline-hidden transition-all ${
                    filterDate === 'custom-range'
                      ? 'border-accent bg-white text-foreground shadow-xs'
                      : 'border-transparent bg-transparent text-foreground hover:bg-white/40'
                  }`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Search Row */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 md:max-w-2xl justify-end">
          {/* View Type Switcher - Admin and Support */}
          {(currentUser?.role === 'admin' || currentUser?.role === 'support') && (
            <div className="flex bg-muted p-1 rounded-lg border border-border relative z-10 overflow-x-auto max-w-full gap-1">
              <button
                type="button"
                onClick={() => setCurrentViewType('mobile-grid')}
                className={`p-1.5 px-3.5 rounded-md text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                  currentViewType === 'mobile-grid'
                    ? 'bg-accent text-white shadow-sm font-extrabold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/40'
                }`}
              >
                📱 Lịch trong ngày
              </button>
              <button
                type="button"
                onClick={() => setCurrentViewType('weekly-grid')}
                className={`p-1.5 px-3.5 rounded-md text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                  currentViewType === 'weekly-grid'
                    ? 'bg-accent text-white shadow-sm font-extrabold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/40'
                }`}
              >
                📅 Lịch trong tuần
              </button>
              <button
                type="button"
                onClick={() => setCurrentViewType('cards')}
                className={`p-1.5 px-3.5 rounded-md text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                  currentViewType === 'cards'
                    ? 'bg-accent text-white shadow-sm font-extrabold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/40'
                }`}
              >
                📋 Chi tiết đơn hàng
              </button>
            </div>
          )}

          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm lịch: tên khách, số ĐT, thợ nail..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-card hover:bg-muted/50 border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-accent/20 focus:border-accent focus:bg-white transition-all duration-200 text-foreground"
            />
          </div>

          {(currentUser?.role === 'admin' || currentUser?.role === 'support') && (
            <button
              onClick={() => setShowModal(true)}
              className="py-2 px-4 bg-accent text-white hover:bg-accent-secondary rounded-md text-sm font-extrabold flex items-center gap-1.5 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md active:scale-95 shrink-0 hover:brightness-105"
            >
              <Plus className="w-4 h-4 text-white stroke-[2.5]" /> Đặt lịch móng
            </button>
          )}

          {currentUser?.role === 'staff' && currentUser.staffId && (
            <button
              type="button"
              onClick={() => setShowWalkInModal(true)}
              className="py-2 px-4 bg-emerald-600 text-white hover:bg-emerald-700 rounded-md text-sm font-extrabold flex items-center gap-1.5 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md active:scale-95 shrink-0"
            >
              <Plus className="w-4 h-4 text-white stroke-[2.5]" /> Đơn vãng lai
            </button>
          )}
        </div>
      </div>

      {/* Appointment Grid Dashboard */}
      {currentViewType === 'mobile-grid' ? (
        <div className="space-y-3 font-sans">
          {/* Compact Single-Row Week Navigation & sliding date selector */}
          <div className="bg-muted border border-border p-1.5 rounded-lg shadow-sm">
            <div className="flex items-center gap-1.5 justify-between">
              {/* Previous Week */}
              <button
                type="button"
                onClick={() => setWeekOffset(prev => prev - 1)}
                className="p-2 sm:p-2.5 bg-white border border-border text-foreground rounded-lg hover:bg-accent hover:text-white hover:border-accent transition-all active:scale-95 shrink-0 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shadow-xs"
                title="Tuần trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Day horizontal picker */}
              <div className="flex-1 grid grid-cols-7 gap-1 bg-white p-1 rounded-md border border-border select-none">
                {getCurrentWeekDays().map(day => {
                  const isSelected = selectedMobileDate === day.dateString;
                  const isTodayStr = day.dateString === getTodayString();
                  
                  // Extract weekday abbreviated (T2, T3, etc) and date (12/06 -> 12)
                  const dayNameMap: Record<string, string> = {
                    "Thứ Hai": "T2",
                    "Thứ Ba": "T3",
                    "Thứ Tư": "T4",
                    "Thứ Năm": "T5",
                    "Thứ Sáu": "T6",
                    "Thứ Bảy": "T7",
                    "Chủ Nhật": "CN"
                  };
                  const rawDayName = day.label.split(" ")[0];
                  const shortDayName = dayNameMap[rawDayName] || rawDayName;
                  
                  // Clean standard format of day number (e.g. 12 instead of 12/06)
                  let dateNumStr = day.label.split("(")[1]?.replace(")", "") || "";
                  if (dateNumStr.includes("/")) {
                    dateNumStr = dateNumStr.split("/")[0];
                  }
                  
                  return (
                    <button
                      key={day.dateString}
                      type="button"
                      onClick={() => setSelectedMobileDate(day.dateString)}
                      className={`flex flex-col items-center justify-center py-1.5 rounded-md transition-all cursor-pointer min-h-[44px] ${
                        isSelected
                          ? 'bg-accent text-white shadow-sm font-bold scale-[1.03]'
                          : isTodayStr
                          ? 'bg-white text-accent border border-accent font-extrabold shadow-xs'
                          : 'text-foreground hover:bg-muted font-medium'
                      }`}
                    >
                      <span className="text-[10px] font-bold opacity-90 uppercase tracking-wide leading-none mb-1">{shortDayName}</span>
                      <span className="text-[14px] font-extrabold tracking-tight leading-none">{dateNumStr}</span>
                      {isTodayStr && !isSelected && (
                        <span className="w-1.5 h-1.5 bg-accent rounded-full mt-1.5" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Next Week */}
              <button
                type="button"
                onClick={() => setWeekOffset(prev => prev + 1)}
                className="p-2 sm:p-2.5 bg-white border border-border text-foreground rounded-lg hover:bg-accent hover:text-white hover:border-accent transition-all active:scale-95 shrink-0 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shadow-xs"
                title="Tuần sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Compact Recognizable "Quay về hôm nay" Icon */}
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className="p-2 sm:p-2.5 bg-white border border-border text-accent rounded-lg hover:bg-accent hover:text-white hover:border-accent transition-all active:scale-95 shrink-0 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shadow-xs"
                title="Quay về ngày hôm nay"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Time Grid Matrix Vertical Column container */}
          <div className="bg-white rounded-lg border border-stone-300 overflow-hidden shadow-sm divide-y-2 divide-stone-300 max-h-[75vh] overflow-y-auto">
            {TIME_SLOTS.map(slot => {
              // Get filtered assignments for mobile cell - HIDE comp/cancelled
              let cellAppts = appointments.filter(appt => {
                if (appt.date !== selectedMobileDate) return false;
                if (appt.status === 'cancelled') return false;
                if (appt.status === 'completed' && currentUser?.role !== 'admin' && currentUser?.role !== 'support') return false;
                
                return getTimeSlot(appt.time) === slot;
              });

              if (searchQuery) {
                const q = searchQuery.toLowerCase();
                cellAppts = cellAppts.filter(appt => 
                  appt.customerName.toLowerCase().includes(q) ||
                  appt.customerPhone.includes(q) ||
                  appt.staffName.toLowerCase().includes(q)
                );
              }

              const cellGroupMap = new Map<string, Appointment[]>();
              cellAppts.forEach(appt => {
                if (!appt.groupId) return;
                const group = cellGroupMap.get(appt.groupId) || [];
                group.push(appt);
                cellGroupMap.set(appt.groupId, group);
              });
              const cellGroupEntries = [...cellGroupMap.entries()].filter(([, group]) => group.length > 1);
              const groupedCellIds = new Set(cellGroupEntries.flatMap(([, group]) => group.map(appt => appt.id)));
              const standaloneCellAppts = cellAppts.filter(appt => !groupedCellIds.has(appt.id));

              return (
                <div key={slot} className="flex min-h-[72px] items-stretch bg-white odd:bg-stone-50/45 hover:bg-muted/20 transition-colors">
                  {/* Column hour Left - fixed hours sticky on left */}
                  <div className="w-16 shrink-0 bg-stone-100 border-r-2 border-stone-300 flex flex-col justify-center items-center text-muted-foreground font-mono font-bold select-none text-sm sticky left-0 z-10 px-1.5 py-2">
                    <span className="text-foreground text-sm tracking-tight">{slot}</span>
                    <span className="text-[8px] text-accent uppercase tracking-widest mt-0.5 font-bold font-sans">Giờ</span>
                  </div>

                  {/* Column Content Right - booking card */}
                  <div className="flex-1 p-2 bg-transparent flex flex-col justify-center gap-2 overflow-x-auto min-w-0">
                    {cellAppts.length > 0 ? (
                      <>
                        {cellGroupEntries.map(([groupId, groupAppointments]) => {
                          const firstAppointment = groupAppointments[0];
                          const payableAppointments = groupAppointments.filter(appt =>
                            appt.status !== 'completed' &&
                            appt.status !== 'cancelled' &&
                            appt.status !== 'deleted' &&
                            !isAwaitingPayment(appt)
                          );
                          const groupTotal = groupAppointments.reduce((sum, appt) => sum + (Number(appt.totalPrice) || 0), 0);
                          const groupHasDraftPrice = groupAppointments.some(appt => !(Number(appt.totalPrice) > 0));
                          const groupAllCompleted = groupAppointments.every(appt => appt.status === 'completed');
                          const groupAllCancelled = groupAppointments.every(appt => appt.status === 'cancelled' || appt.status === 'deleted');
                          const groupInformationLocked = currentUser?.role === 'staff' && (groupAllCompleted || groupAllCancelled);
                          const groupCustomerName = groupInformationLocked
                            ? maskCustomerName(firstAppointment.customerName)
                            : firstAppointment.customerName;
                          const groupHasPendingPayment = groupAppointments.some(appt => isAwaitingPayment(appt));
                          const groupStateClass = groupAllCompleted
                            ? 'border-emerald-300 bg-emerald-50/50'
                            : groupAllCancelled
                            ? 'border-border bg-muted/40 opacity-70'
                            : groupHasPendingPayment
                            ? 'border-sky-300 bg-sky-50/40'
                            : 'border-accent/60 bg-white';
                          const groupHeaderClass = groupAllCompleted
                            ? 'bg-emerald-100/80'
                            : groupHasPendingPayment
                            ? 'bg-sky-100/70'
                            : groupAllCancelled
                            ? 'bg-muted'
                            : 'bg-accent/10';

                          return (
                            <section key={groupId} className={`overflow-hidden rounded-xl border-2 shadow-sm transition-colors ${groupStateClass}`}>
                              <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition-colors ${groupHeaderClass}`}>
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-accent"><User className="h-4 w-4" /></span>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-extrabold text-foreground">{groupCustomerName}</p>
                                    <p className="text-[10px] font-semibold text-muted-foreground">Lịch nhóm · {groupAppointments.length} dịch vụ</p>
                                  </div>
                                </div>
                                <span className="font-mono text-xs font-extrabold text-accent">{groupHasDraftPrice ? 'Chưa chốt đủ giá' : `${groupTotal.toLocaleString()}đ`}</span>
                              </div>
                              <div className="divide-y divide-border px-2">
                                {groupAppointments.map((appt, index) => {
                                  const isCompleted = appt.status === 'completed';
                                  const isCancelled = appt.status === 'cancelled' || appt.status === 'deleted';
                                  const isPendingPayment = isAwaitingPayment(appt);
                                  const isPayable = !isCompleted && !isCancelled && !isPendingPayment;
                                  const rowStateClass = isCompleted
                                    ? 'bg-emerald-50/80'
                                    : isCancelled
                                    ? 'bg-muted/50 opacity-70'
                                    : isPendingPayment
                                    ? 'bg-sky-50/70'
                                    : 'bg-transparent';
                                  return (
                                    <div key={appt.id} className={`flex flex-col gap-2 rounded-md px-1 py-2 transition-colors sm:flex-row sm:items-center sm:justify-between ${rowStateClass}`}>
                                      <div className="flex min-w-0 items-start gap-2">
                                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted font-mono text-[10px] font-bold text-accent">{index + 1}</span>
                                        <div className="min-w-0">
                                          <p className="text-xs font-bold text-foreground">{getApptServicesString(appt)}</p>
                                          <p className="mt-0.5 text-[10px] text-muted-foreground">{appt.staffId ? `Thợ ${appt.staffName}` : 'Chưa chọn thợ'} · {Number(appt.totalPrice) > 0 ? `${Number(appt.totalPrice).toLocaleString()}đ` : 'Chưa chốt giá'}</p>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                                        <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${
                                          isCompleted
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : isCancelled
                                            ? 'bg-muted text-muted-foreground'
                                            : isPendingPayment
                                            ? 'bg-sky-100 text-sky-700'
                                            : 'bg-amber-100 text-amber-800'
                                        }`}>
                                          {isCompleted ? 'Đã thanh toán' : isCancelled ? 'Đã hủy' : isPendingPayment ? 'Chờ thanh toán' : 'Chưa thanh toán'}
                                        </span>
                                        {renderGroupedAppointmentActions(appt, true)}
                                        {isPayable && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              openCheckoutForAppointment(appt, 'single');
                                            }}
                                            className="min-h-8 rounded-md border border-border bg-white px-2.5 py-1.5 text-[10px] font-bold text-foreground hover:border-accent hover:text-accent"
                                          >
                                            Thanh toán riêng
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {payableAppointments.length > 0 && (
                                <div className="border-t border-border bg-background p-2.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      openCheckoutForAppointment(payableAppointments[0], 'group');
                                    }}
                                    className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-extrabold text-white"
                                  >
                                    <ReceiptText className="h-4 w-4" /> {payableAppointments.length > 1 ? 'Thanh toán toàn bộ' : 'Thanh toán phần còn lại'}
                                  </button>
                                </div>
                              )}
                            </section>
                          );
                        })}

                      {standaloneCellAppts.map(appt => {
                        const isCompleted = appt.status === 'completed';
                        const isCancelled = appt.status === 'cancelled';
                        const isPendingApproval = isAwaitingPayment(appt);
                        const isCompletionApproval = isPendingApproval && appt.paymentMethod !== 'transfer';
                        
                        const showMask = currentUser?.role === 'staff' && 
                          (isCompleted || isCancelled);
                        const displayCustName = showMask ? maskCustomerName(appt.customerName) : appt.customerName;
                        const displayPhone = showMask ? maskCustomerPhone(appt.customerPhone) : appt.customerPhone;
                        
                        return (
                          <div
                            key={appt.id}
                            onClick={() => {
                              if (isCompleted) return;
                              if (currentUser?.role === 'admin' || currentUser?.role === 'support') {
                                handleStartEdit(appt);
                              } else {
                                setSelectedStaffAppt(appt);
                              }
                            }}
                            className={`p-2.5 rounded-md border transition-all relative overflow-hidden flex flex-col justify-between shadow-xs max-w-full ${
                              isCompleted
                                ? 'bg-emerald-50/70 border-emerald-150 text-emerald-950 font-medium cursor-default select-none'
                                : isCancelled
                                ? 'bg-card border-border text-muted-foreground line-through opacity-70 cursor-default'
                                : isPendingApproval
                                ? 'bg-amber-50/60 border-amber-200 text-foreground font-medium hover:scale-[1.01] active:scale-95 cursor-pointer'
                                : 'bg-muted border-muted/80 text-foreground font-semibold hover:scale-[1.01] active:scale-95 cursor-pointer'
                            }`}
                            title={isCompleted ? 'Đơn đã hoàn thành — chỉ xem' : 'Xem chi tiết'}
                          >
                            <div className={`absolute top-0 left-0 right-0 h-1 ${isCompleted ? 'bg-emerald-500' : 'bg-accent text-accent-foreground/35'}`} />
                            
                            <div>
                              {/* Name and Phone on ONE ROW, bold and larger */}
                              <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-muted/50">
                                <h4 className="font-extrabold text-[14.5px] text-foreground leading-tight truncate">
                                  {displayCustName}
                                </h4>
                                {isCompleted ? (
                                  <span className="text-[14px] font-extrabold text-emerald-700 inline-flex items-center gap-0.5 font-mono leading-none shrink-0">
                                    <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0 fill-current" />
                                    <span>{displayPhone}</span>
                                  </span>
                                ) : (
                                  <a
                                    href={`tel:${appt.customerPhone}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                    }}
                                    className="text-[14px] font-extrabold text-accent hover:underline inline-flex items-center gap-0.5 font-mono leading-none shrink-0"
                                  >
                                    <Phone className="w-3.5 h-3.5 text-accent shrink-0 fill-current" />
                                    <span>{displayPhone}</span>
                                  </a>
                                )}
                              </div>
 
                              {/* Service: below, regular text, dark gray, size 13px */}
                              <div className="text-[12px] text-muted-foreground font-normal leading-snug mt-1 pl-0.5">
                                <span className="font-semibold text-foreground">Dịch vụ:</span> {getApptServicesString(appt)}
                              </div>

                              {/* Notes/Ghi chú: inline display beautifully */}
                              {appt.notes && appt.notes.trim() !== "" && (
                                <div className="text-[11px] text-accent bg-muted/65 border border-muted/45 rounded-md px-2 py-0.5 mt-1 leading-snug italic">
                                  <span className="break-words font-medium">{appt.notes}</span>
                                </div>
                              )}
                            </div>
 
                            {/* Footer details: staff name, price */}
                            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-1.5 mt-1 px-0.5">
                              <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                                <span className={`px-2 py-0.5 rounded-lg text-[9.5px] font-bold truncate max-w-[150px] border ${
                                  !appt.staffId || appt.staffName === 'Chưa phân công thợ' || appt.staffName === 'Chưa gán'
                                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                                    : 'bg-muted border-border text-accent'
                                }`}>
                                  Thợ: {appt.staffName || 'Chưa phân công thợ'}
                                </span>

                                {!isCompleted && !isCancelled && currentUser?.role === 'admin' && quickCancelId !== appt.id && (
                                  isCompletionApproval ? (
                                    confirmApproveId === appt.id ? (
                                      <div className="flex items-center gap-1.5 p-1 px-2 bg-emerald-50 border border-emerald-200 rounded-lg shrink-0">
                                        <span className="text-[9.5px] text-emerald-800 font-bold">Duyệt thu tiền?</span>
                                        <button
                                          type="button"
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            await handleAdminApprovePayment(appt);
                                          }}
                                          className="px-2 py-0.5 bg-emerald-600 text-white rounded-md text-[9.5px] font-extrabold cursor-pointer transition-all active:scale-95"
                                        >
                                          ✓ Duyệt
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmApproveId(null);
                                          }}
                                          className="px-2 py-0.5 bg-white border border-border text-muted-foreground rounded-md text-[9.5px] font-bold hover:bg-muted cursor-pointer transition-all active:scale-95"
                                        >
                                          Không
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setConfirmApproveId(appt.id);
                                          setQuickCompleteId(null);
                                          setQuickCancelId(null);
                                          setConfirmCancelRequestId(null);
                                        }}
                                        className="flex min-h-[34px] items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-2.5 py-1.5 text-[11px] font-extrabold text-white transition-all hover:bg-emerald-700 active:scale-95 shrink-0"
                                      >
                                        <CheckCircle className="w-3.5 h-3.5 stroke-[2.5]" /> Duyệt & hoàn tất
                                      </button>
                                    )
                                  ) : !isPendingApproval ? (
                                    quickCompleteId === appt.id ? (
                                      <div className="flex items-center gap-1.5 p-1 px-2 bg-emerald-50 border border-emerald-200 rounded-lg shrink-0">
                                        <span className="text-[9.5px] text-emerald-800 font-bold">Hoàn thành?</span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openCheckoutForAppointment(appt);
                                            setQuickCompleteId(null);
                                          }}
                                          className="px-2 py-0.5 bg-emerald-600 text-white rounded-md text-[9.5px] font-extrabold cursor-pointer transition-all active:scale-95"
                                        >
                                          ✓ Có
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setQuickCompleteId(null);
                                          }}
                                          className="px-2 py-0.5 bg-white border border-border text-muted-foreground rounded-md text-[9.5px] font-bold hover:bg-muted cursor-pointer transition-all active:scale-95"
                                        >
                                          Không
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setQuickCompleteId(appt.id);
                                          setQuickCancelId(null);
                                          setConfirmApproveId(null);
                                          setConfirmCancelRequestId(null);
                                        }}
                                        className="flex min-h-[34px] items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-extrabold text-emerald-700 transition-all hover:bg-emerald-100 active:scale-95 shrink-0"
                                      >
                                        <CheckCircle className="w-3.5 h-3.5 stroke-[2.5]" /> Hoàn thành
                                      </button>
                                    )
                                  ) : null
                                )}

                                {!isCompleted && !isCancelled && currentUser?.role === 'admin' && (
                                  quickCancelId === appt.id ? (
                                    <div className="flex items-center gap-1.5 p-1 px-2 bg-rose-50 border border-rose-250 rounded-lg shrink-0">
                                      <span className="text-[9.5px] text-rose-800 font-bold">Hủy đơn?</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCancelAppointment(appt, () => {
                                            setQuickCancelId(null);
                                          });
                                        }}
                                        className="px-2 py-0.5 bg-rose-600 text-white rounded-md text-[9.5px] font-extrabold cursor-pointer transition-all active:scale-95"
                                      >
                                        ✓ Có
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setQuickCancelId(null);
                                        }}
                                        className="px-2 py-0.5 bg-white border border-border text-muted-foreground rounded-md text-[9.5px] font-bold hover:bg-muted cursor-pointer transition-all active:scale-95"
                                      >
                                        Không
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setQuickCancelId(appt.id);
                                        setQuickCompleteId(null);
                                        setConfirmApproveId(null);
                                        setConfirmCancelRequestId(null);
                                      }}
                                      className="flex min-h-[34px] items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-extrabold text-rose-700 transition-all hover:bg-rose-100 active:scale-95 shrink-0"
                                    >
                                      <XCircle className="w-3.5 h-3.5 text-rose-600 stroke-[2.5]" /> Hủy đơn
                                    </button>
                                  )
                                )}
                              </div>
                              
                              <div className="flex w-full flex-wrap items-center justify-end gap-1.5">
                                {isCompleted && (
                                  <span className="px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-100 text-emerald-700 text-[9.5px] font-extrabold">
                                    Hoàn thành
                                  </span>
                                )}
                                {isPendingApproval && (
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${
                                    isTransferPending(appt)
                                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                                      : 'border-amber-200 bg-amber-50 text-amber-800'
                                  }`}>
                                    {isTransferPending(appt)
                                      ? <QrCode className="h-3 w-3" />
                                      : <Banknote className="h-3 w-3" />}
                                    {isTransferPending(appt) ? 'Chờ chuyển khoản' : 'Chờ duyệt tiền mặt'}
                                  </span>
                                )}
                                <span className="font-mono text-[12px] font-extrabold text-foreground">
                                  {appt.totalPrice > 0 ? `${appt.totalPrice.toLocaleString()}đ` : 'Chưa chốt giá'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      </>
                    ) : (
                      /* Excel-like empty grid slot trigger button option */
                      <button
                        type="button"
                        onClick={() => {
                          if (currentUser?.role === 'admin' || currentUser?.role === 'support') {
                            setApptDate(selectedMobileDate);
                            setApptTime(slot);
                            setShowModal(true);
                          }
                        }}
                        className="w-full h-full min-h-[38px] rounded-md border border-dashed border-border/70 bg-card hover:bg-muted/25 flex items-center justify-center gap-1 px-3 text-[10px] text-muted-foreground hover:text-accent hover:border-border-hover transition-all cursor-pointer select-none py-1 group"
                      >
                        <Plus className="w-3.5 h-3.5 text-foreground group-hover:text-accent group-hover:scale-110 transition-transform" />
                        <span className="font-medium whitespace-nowrap">Trống</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : displayedCardAppts.length === 0 ? (
        <div className="py-20 bg-white rounded-lg border border-border text-center text-muted-foreground italic text-sm">
          Chưa có lịch hẹn nào tương ứng với bộ lọc tìm kiếm.
        </div>
      ) : currentViewType === 'weekly-grid' ? (
        <div className="space-y-4">
          {/* Week Navigation Toolbar */}
          <div className="bg-muted border border-border p-3 rounded-lg flex flex-wrap gap-3 items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground bg-muted px-3 py-1.5 rounded-md border border-border select-none">
                🗓️ Lịch Giữ Chỗ Linh Hoạt
              </span>
            </div>
            
            <div className="flex items-center gap-1.5 bg-white p-1 rounded-md border border-border">
              <button
                type="button"
                onClick={() => setWeekOffset(prev => prev - 1)}
                className="p-1.5 px-3 bg-white hover:bg-muted/40 text-accent rounded-lg text-sm font-bold transition-all cursor-pointer flex items-center gap-1 active:scale-95 text-nowrap select-none"
              >
                ◀ Tuần trước
              </button>
              
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className={`p-1.5 px-3 rounded-lg text-sm font-bold transition-all cursor-pointer active:scale-95 select-none ${
                  weekOffset === 0 
                    ? 'bg-accent text-accent-foreground text-white shadow-sm' 
                    : 'bg-white text-muted-foreground hover:bg-card hover:bg-muted'
                }`}
              >
                Tuần này
              </button>
              
              <button
                type="button"
                onClick={() => setWeekOffset(prev => prev + 1)}
                className="p-1.5 px-3 bg-white hover:bg-muted/40 text-accent rounded-lg text-sm font-bold transition-all cursor-pointer flex items-center gap-1 active:scale-95 text-nowrap select-none"
              >
                Tuần sau ▶
              </button>
            </div>

            {/* Display formatted date range of current viewed week */}
            {(() => {
              const weekDays = getCurrentWeekDays();
              if (weekDays.length === 0) return null;
              const firstDay = weekDays[0].label.split(" ")[1]?.replace(/[()]/g, "") || "";
              const lastDay = weekDays[6].label.split(" ")[1]?.replace(/[()]/g, "") || "";
              return (
                <div className="text-[11px] font-bold text-accent bg-muted border border-border px-4 py-1.5 rounded-md font-mono select-none">
                  Tuần từ: <strong className="text-foreground">{firstDay}</strong> đến <strong className="text-foreground">{lastDay}</strong>
                </div>
              );
            })()}
          </div>

          <div className="bg-white rounded-lg border border-stone-300 overflow-auto shadow-sm">
          {/* Grid Container */}
          <div className="min-w-[1250px] border-collapse font-sans">
            {/* Grid Header days */}
            <div className="grid grid-cols-8 bg-background border-b-2 border-stone-300">
              {/* Corner */}
              <div className="p-2.5 border-r-2 border-stone-300 text-center font-bold text-sm text-muted-foreground bg-stone-100 flex flex-col items-center justify-center font-mono select-none">
                <span className="text-[10px]">THỨ / GIỜ</span>
                <span className="text-[9px] text-accent mt-0.5">🗓️ Lọc tuần</span>
              </div>
              {getCurrentWeekDays().map(day => {
                const isTodayStr = day.dateString === getTodayString();
                return (
                  <div 
                    key={day.dateString} 
                    className={`p-2.5 border-r border-stone-300 text-center last:border-r-0 select-none ${
                      isTodayStr ? 'bg-muted/40' : ''
                    }`}
                  >
                    <p className={`font-serif font-bold text-sm ${isTodayStr ? 'text-accent scale-105' : 'text-foreground'}`}>
                      {day.label.split(" ")[0]} {isTodayStr ? '⭐️' : ''}
                    </p>
                    <p className="text-[9px] font-semibold text-muted-foreground font-mono mt-0.5">{day.label.split(" ")[1]}</p>
                  </div>
                );
              })}
            </div>

            {/* Grid Body rows */}
            {TIME_SLOTS.map(slot => (
              <div key={slot} className="grid grid-cols-8 border-b-2 border-stone-300 last:border-b-0 odd:bg-stone-50/45 hover:bg-muted/25 transition-colors">
                {/* Time Indicator column */}
                <div className="p-2 border-r-2 border-stone-300 bg-stone-100 flex items-center justify-center font-extrabold text-sm text-foreground font-mono select-none">
                  {slot}
                </div>

                {/* Day data cells */}
                {getCurrentWeekDays().map(day => {
                  const cellAppts = getApptsForCell(day.dateString, slot);
                  const isTodayStr = day.dateString === getTodayString();
                  return (
                    <div
                      key={`${day.dateString}-${slot}`}
                      onDragOver={(e) => {
                        if (currentUser?.role === 'admin' || currentUser?.role === 'support') e.preventDefault();
                      }}
                      onDrop={(e) => {
                        if (currentUser?.role === 'admin' || currentUser?.role === 'support') {
                          e.preventDefault();
                          const apptId = e.dataTransfer.getData("text/plain");
                          if (apptId) {
                            const targetAppt = appointments.find(a => a.id === apptId);
                            if (targetAppt) {
                              onUpdateAppointment?.(apptId, { date: day.dateString, time: slot });
                            }
                          }
                        }
                      }}
                      className={`p-1.5 border-r border-stone-300 last:border-r-0 min-h-[112px] flex flex-col gap-1.5 transition-all ${
                        isTodayStr ? 'bg-muted' : ''
                      } ${currentUser?.role === 'admin' || currentUser?.role === 'support' ? 'hover:bg-amber-55/35 cursor-cell' : ''}`}
                    >
                      {cellAppts.map(appt => {
                        const isCompleted = appt.status === 'completed';
                        const isCancelled = appt.status === 'cancelled';
                        const isPendingApproval = isAwaitingPayment(appt);
                        
                        // Active bills remain fully identifiable until they leave the worker's work list.
                        const showMask = currentUser?.role === 'staff' && (isCompleted || isCancelled);
                        const displayCustName = showMask ? maskCustomerName(appt.customerName) : appt.customerName;
                        const displayPhone = showMask ? maskCustomerPhone(appt.customerPhone) : appt.customerPhone;
                        
                        return (
                          <div
                            key={appt.id}
                            draggable={currentUser?.role === 'admin' || currentUser?.role === 'support'}
                            onDragStart={(e) => {
                              if (currentUser?.role === 'admin' || currentUser?.role === 'support') {
                                e.dataTransfer.setData("text/plain", appt.id);
                              }
                            }}
                            onClick={() => {
                              if (currentUser?.role === 'admin' || currentUser?.role === 'support') {
                                handleStartEdit(appt);
                              } else {
                                setSelectedStaffAppt(appt);
                              }
                            }}
                            className={`p-2 rounded-md text-[10.5px] border shadow-4xs cursor-pointer select-none transition-all group hover:scale-[1.01] active:scale-95 relative overflow-hidden ${
                              isCompleted
                                ? 'bg-emerald-50/85 border-emerald-150 text-emerald-950 font-medium'
                                : isCancelled
                                ? 'bg-card hover:bg-muted border-border text-muted-foreground line-through opacity-70'
                                : isPendingApproval
                                ? 'bg-amber-50/60 border-amber-200 text-foreground font-medium'
                                : 'bg-muted/60 border-muted text-foreground font-semibold'
                            }`}
                            title={currentUser?.role === 'admin' || currentUser?.role === 'support' ? "Nhấp chuột để chỉnh sửa hoặc Kéo-thả để dời thời gian" : "Nhấp để truy cập chi tiết"}
                          >
                            <div className="absolute top-0 left-0 right-0 h-1 bg-accent text-accent-foreground/40" />
                            <div className="font-serif font-black tracking-tight mb-1 break-words text-foreground leading-tight">
                              {displayCustName}
                            </div>
                            
                            {/* Phone number display */}
                            <div className="text-[9.5px] text-muted-foreground font-mono flex items-center gap-1 mb-1.5 bg-muted/60 px-1.5 py-0.5 rounded-sm w-fit border border-border/40">
                              <Smartphone className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                              <span>{displayPhone}</span>
                            </div>

                            {/* Selected Services list (Dịch vụ) */}
                            <div className="flex flex-wrap gap-1 mt-1 mb-1.5">
                              {(appt.serviceIds || []).map((sId, idx) => {
                                const srv = services.find(s => s.id === sId);
                                return srv ? (
                                  <span key={idx} className="px-1.5 py-0.5 bg-muted/90 text-[8.5px] text-foreground font-medium rounded-xs border border-border inline-block max-w-full break-words" title={srv.name}>
                                    {srv.name}
                                  </span>
                                ) : null;
                              })}
                              {appt.extraServices && appt.extraServices.map((es, idx) => (
                                <span key={idx} className="px-1.5 py-0.5 bg-muted text-[8.5px] text-amber-850 font-medium rounded-xs border border-muted inline-block max-w-full break-words" title={es.name}>
                                  +{es.name}
                                </span>
                              ))}
                            </div>

                            {/* Servicing notes (Ghi chú) */}
                            {appt.notes && (
                              <div className="text-[9px] text-muted-foreground bg-card hover:bg-muted/70 p-1.5 rounded-sm border border-border/50 leading-relaxed italic font-sans break-words mt-1 mb-1.5" title={appt.notes}>
                                📝 {appt.notes}
                              </div>
                            )}
                            
                            <div className="flex items-center justify-between gap-1 mt-1 border-t border-border/50 pt-1">
                              <span className="px-1.5 py-0.2 bg-white/85 border border-border rounded-sm text-[8px] text-muted-foreground font-bold truncate max-w-[50px]">
                                {appt.staffName || 'Chưa gán'}
                              </span>
                              <span className="font-mono text-[9.5px] font-black text-accent shrink-0">
                                {appt.totalPrice.toLocaleString()}đ
                              </span>
                            </div>

                            {isPendingApproval && (
                              <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent rounded-full border border-white" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        </div>
      ) : (currentUser?.role === 'staff') ? (
        /* Compact Accordion Card View for Staff/Workers (Requirement 5 & 6) */
        <div className="space-y-3 font-sans">
          <p className="text-sm text-accent font-bold bg-muted p-3 rounded-lg border border-muted flex items-center gap-1.5 leading-relaxed">
            💡 <span>Giao diện làm việc cho Thợ đã được thu gọn tối đa. Bấm vào khách bấm "Xem chi tiết" để hoàn thành, viết ghi chú dịch vụ hoặc báo phát sinh.</span>
          </p>

          <div className="flex flex-col gap-2.5">
            {displayedCardAppts.map((appt) => {
              const soccerApproved = appt.status === 'completed';
              const isCancelled = appt.status === 'cancelled';
              const isPendingApproval = isAwaitingPayment(appt);
              const isExpanded = expandedApptId === appt.id;

              // Keep customer details visible while the bill is still active or waiting for confirmation.
              const showMask = soccerApproved || isCancelled;
              const displayCustName = showMask ? maskCustomerName(appt.customerName) : appt.customerName;
              const displayCustPhone = showMask ? maskCustomerPhone(appt.customerPhone) : appt.customerPhone;

              return (
                <div
                  key={appt.id}
                  className={`bg-white rounded-lg border transition-all relative overflow-hidden ${
                    soccerApproved
                      ? 'border-emerald-100 bg-emerald-50/10'
                      : isCancelled
                      ? 'border-border opacity-60'
                      : isPendingApproval
                      ? isTransferPending(appt)
                        ? 'border-sky-200 bg-sky-50/30'
                        : 'border-amber-200 bg-amber-50/30'
                      : 'border-border'
                  }`}
                >
                  <div
                    onClick={() => setExpandedApptId(isExpanded ? null : appt.id)}
                    className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-card hover:bg-muted/10"
                  >
                    <div className="flex-1 min-w-0">
                      {/* Customer info & Time and status rows */}
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-serif font-extrabold text-foreground text-sm truncate">
                          {displayCustName}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${
                          soccerApproved
                            ? 'bg-emerald-50 text-emerald-700'
                            : isCancelled
                            ? 'bg-muted text-muted-foreground'
                            : isPendingApproval
                            ? isTransferPending(appt)
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-amber-100 text-amber-900'
                            : 'bg-muted text-accent'
                        }`}>
                          {soccerApproved ? (
                            'Hoàn thành'
                          ) : isCancelled ? (
                            'Đã hủy'
                          ) : isPendingApproval ? (
                            <>
                              {isTransferPending(appt)
                                ? <QrCode className="h-3.5 w-3.5" />
                                : <Banknote className="h-3.5 w-3.5" />}
                              {isTransferPending(appt) ? 'Chờ chuyển khoản' : 'Chờ duyệt tiền mặt'}
                            </>
                          ) : (
                            'Sắp phục vụ'
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono flex-wrap">
                        <span>🕒 {appt.time} • {appt.date}</span>
                        <span>•</span>
                        <span>{appt.serviceIds?.length || 0} dịch vụ</span>
                        <span>•</span>
                        {appt.customerPhone ? (
                          <a
                            href={`tel:${appt.customerPhone}`}
                            onClick={(event) => event.stopPropagation()}
                            className="font-bold text-accent hover:underline"
                          >
                            {displayCustPhone}
                          </a>
                        ) : (
                          <span>Chưa có SĐT</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 flex items-center gap-3 select-none">
                      <div>
                        <p className="text-[10px] text-muted-foreground font-bold">Tổng tiền thu</p>
                        <p className="font-mono text-sm font-extrabold text-accent">
                          {appt.totalPrice > 0 ? `${appt.totalPrice.toLocaleString()}đ` : 'Chưa chốt giá'}
                        </p>
                      </div>
                      <span className="text-muted-foreground font-mono text-[10px] bg-muted p-1 px-1.5 rounded-lg border border-border">
                        {isExpanded ? 'Đóng ▲' : 'Xem ▼'}
                      </span>
                    </div>
                  </div>

                  {/* Accordion Body Details */}
                  {isExpanded && (
                    <div className="p-4 bg-card hover:bg-muted/50 border-t border-border space-y-3.5 text-sm">
                      {/* Services details breakdown */}
                      <div className="space-y-1">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Chi tiết dịch vụ chính:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries((appt.serviceIds || []).reduce((acc, sId) => {
                            acc[sId] = (acc[sId] || 0) + 1;
                            return acc;
                          }, {} as Record<string, number>)).map(([srvId, qty]) => {
                            const srv = services.find(s => s.id === srvId);
                            return srv ? (
                              <span key={srvId} className="px-2.5 py-0.5 bg-white border border-border text-foreground text-[10px] font-medium rounded-lg">
                                {srv.name} {qty > 1 ? `(x${qty})` : ''}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </div>

                      {/* Phone breakdown */}
                      <div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Số điện thoại liên hệ:</p>
                        <p className="font-mono text-foreground font-semibold">{displayCustPhone || 'Không có SĐT'}</p>
                      </div>

                      {/* Customer Wallet status inside appointment view */}
                      {(() => {
                        const apptCustomer = findCustomerById(customers, appt.customerId);
                        if (!apptCustomer) return null;
                        return (
                          <div className="bg-muted/45 p-3 rounded-md border border-muted/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                            <div className="space-y-0.5">
                              <span className="text-[9px] text-accent uppercase font-bold tracking-wider flex items-center gap-1">
                                <Wallet className="w-3.5 h-3.5" /> Số dư ví của khách (Tiền cọc)
                              </span>
                              <p className="text-[10.5px] font-medium text-foreground">
                                Khách có <strong className="font-mono text-accent">{(apptCustomer.walletBalance ?? 0).toLocaleString()}đ</strong> tích trữ hiện tại.
                              </p>
                            </div>
                            
                            {/* Deposit adjuster */}
                            {(currentUser?.role === 'admin' || currentUser?.role === 'support') && (
                              <div className="flex gap-1 items-center w-full sm:w-auto">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const amtStr = window.prompt(`Cộng tiền cọc/ví cho khách ${apptCustomer.name} (VNĐ):`, "50000");
                                    if (amtStr === null) return;
                                    const amt = Math.floor(Number(amtStr));
                                    if (isNaN(amt) || amt <= 0) {
                                      alert("Vui lòng nhập số tiền hợp lệ và lớn hơn 0");
                                      return;
                                    }
                                    
                                    const oldBalance = Math.max(0, Number(apptCustomer.walletBalance) || 0);
                                    const newBalance = oldBalance + amt;

                                    const dateText = new Date().toLocaleDateString('vi-VN');
                                    const transactionRecord = `\n[${dateText}] Cộng từ Lịch hẹn (ID: ${appt.id.slice(0, 5)}): +${amt.toLocaleString()}đ`;
                                    const updatedNotes = (apptCustomer.notes || '') + transactionRecord;

                                    onUpdateCustomer?.(apptCustomer.id, {
                                      walletBalance: newBalance,
                                      notes: updatedNotes
                                    });
                                    alert(`Đã cộng thành công ${amt.toLocaleString()}đ vào ví của ${apptCustomer.name}`);
                                  }}
                                  className="px-2 py-1 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white font-bold rounded-lg text-[9.5px] cursor-pointer flex items-center gap-0.5"
                                >
                                  <Plus className="w-3 h-3" /> Nạp cọc
                                </button>
                                
                                <button
                                  type="button"
                                  onClick={() => {
                                    const amtStr = window.prompt(`Khấu trừ tiền cọc/ví của khách ${apptCustomer.name} (VNĐ):`, "50000");
                                    if (amtStr === null) return;
                                    const requestedAmount = Math.floor(Number(amtStr));
                                    if (isNaN(requestedAmount) || requestedAmount <= 0) {
                                      alert("Vui lòng nhập số tiền hợp lệ và lớn hơn 0");
                                      return;
                                    }
                                    
                                    const oldBalance = Math.max(0, Number(apptCustomer.walletBalance) || 0);
                                    const actualDeduction = Math.min(requestedAmount, oldBalance);
                                    if (actualDeduction <= 0) {
                                      alert("Số dư ví bằng 0, không thể khấu trừ!");
                                      return;
                                    }
                                    const newBalance = oldBalance - actualDeduction;

                                    const dateText = new Date().toLocaleDateString('vi-VN');
                                    const transactionRecord = `\n[${dateText}] Trừ từ Lịch hẹn (ID: ${appt.id.slice(0, 5)}): -${actualDeduction.toLocaleString()}đ`;
                                    const updatedNotes = (apptCustomer.notes || '') + transactionRecord;

                                    onUpdateCustomer?.(apptCustomer.id, {
                                      walletBalance: newBalance,
                                      notes: updatedNotes
                                    });
                                    alert(`Đã trừ thành công ${actualDeduction.toLocaleString()}đ từ ví của ${apptCustomer.name}`);
                                  }}
                                  className="px-2 py-1 bg-muted hover:bg-muted text-white font-bold rounded-lg text-[9.5px] cursor-pointer flex items-center gap-0.5"
                                >
                                  <Minus className="w-3 h-3" /> Trừ cọc
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Workers custom notes editing block */}
                      <div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Ghi chú phục vụ móng:</p>
                        {appt.staffId === currentUser?.staffId ? (
                          editingNoteApptId === appt.id ? (
                            <div className="space-y-1.5 mt-1">
                              <textarea
                                value={tempNoteText}
                                onChange={(e) => setTempNoteText(e.target.value)}
                                placeholder="Ghi chú sở thích, lưu ý móng của khách..."
                                rows={2}
                                className="w-full bg-white border border-border rounded-lg p-2 text-sm focus:outline-hidden"
                              />
                              <div className="flex gap-1.5 justify-end">
                                <button
                                  type="button"
                                  onClick={() => setEditingNoteApptId(null)}
                                  className="px-2 py-0.5 bg-muted border rounded-md text-[10px]"
                                >
                                  Hủy
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onUpdateAppointment?.(appt.id, { notes: tempNoteText });
                                    setEditingNoteApptId(null);
                                  }}
                                  className="px-2.5 py-0.5 bg-accent text-accent-foreground text-white rounded-md text-[10px] font-bold"
                                >
                                  Lưu
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center bg-white p-2 px-3 rounded-md border border-border">
                              <span className="italic text-muted-foreground">"{appt.notes || "Chưa có ghi chú phục vụ nào"}"</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingNoteApptId(appt.id);
                                  setTempNoteText(appt.notes || "");
                                }}
                                className="text-accent font-bold underline text-[10px] hover:text-accent ml-1.5 cursor-pointer"
                              >
                                Sửa ghi chú
                              </button>
                            </div>
                          )
                        ) : (
                          <p className="italic text-muted-foreground bg-white p-2 rounded-md border border-border">"{appt.notes || "Không có ghi chú"}"</p>
                        )}
                      </div>

                      {/* Extra services breakdown (Worker can view, Admin configures) */}
                      <div className="bg-white p-2.5 rounded-md border border-border space-y-1">
                        <p className="text-[9px] font-bold text-accent uppercase tracking-wider">Chi phí phát sinh thêm:</p>
                        {appt.extraServices && appt.extraServices.length > 0 ? (
                          <div className="space-y-1 pl-1">
                            {appt.extraServices.map((es, idx) => (
                              <div key={idx} className="flex justify-between items-center text-[10.5px]">
                                <span className="text-foreground font-sans">⚡ {es.name}</span>
                                <span className="font-mono font-bold text-foreground">{es.price.toLocaleString()}đ</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground italic pl-1">Không phát sinh thêm trong lịch làm</p>
                        )}
                      </div>

                      {/* Receipt Photo inside Accordion if exists */}
                      {appt.receiptImage && (
                        <div className="bg-white p-2.5 rounded-md border border-border space-y-1.5">
                          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">📸 Ảnh Hóa Đơn / Giao dịch thành công (Nhấp để phóng to):</p>
                          <div className="relative inline-block max-w-[150px] border border-border rounded-lg overflow-hidden bg-card hover:bg-muted cursor-pointer hover:ring-2 hover:ring-rose-300 transition-all">
                            <img 
                              src={appt.receiptImage} 
                              alt="Hóa đơn" 
                              className="max-h-32 object-contain hover:scale-105 transition-all cursor-zoom-in"
                              onClick={() => setZoomedReceiptUrl(appt.receiptImage || null)}
                            />
                          </div>
                        </div>
                      )}

                      {/* Active Actions inside compact details footer */}
                      <div className="pt-2 border-t border-border flex items-center justify-end">
                        {appt.staffId === currentUser?.staffId ? (
                          !soccerApproved && !isCancelled ? (
                            isPendingApproval ? (
                              <div className={`w-full rounded-xl border p-3.5 ${
                                isTransferPending(appt)
                                  ? 'border-sky-200 bg-sky-50'
                                  : 'border-amber-200 bg-amber-50'
                              }`}>
                                <div className="flex items-start gap-3">
                                  <div className={`mt-0.5 rounded-lg p-2 ${
                                    isTransferPending(appt)
                                      ? 'bg-sky-100 text-sky-700'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {isTransferPending(appt)
                                      ? <QrCode className="h-5 w-5" />
                                      : <Banknote className="h-5 w-5" />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-extrabold text-foreground">
                                      {getAwaitingPaymentLabel(appt)}
                                    </p>
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                      {isTransferPending(appt)
                                        ? 'Hệ thống sẽ tự hoàn tất bill khi nhận đúng giao dịch.'
                                        : 'Thông tin khách vẫn hiển thị để bạn tiện đối chiếu và liên hệ.'}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openWithdrawRequest(appt)}
                                  className="mt-3 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2.5 text-sm font-extrabold text-rose-700 shadow-sm transition-all hover:bg-rose-50 active:scale-[0.98]"
                                >
                                  <Undo2 className="h-4 w-4" />
                                  {getWithdrawRequestLabel(appt)}
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    openCheckoutForAppointment(appt);
                                  }}
                                  className="p-1.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-sm shadow-sm cursor-pointer flex items-center gap-1.5 active:scale-95 transition-all"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" /> Xác nhận & Chốt bill
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="text-muted-foreground italic font-medium">[ Đơn hàng đã kết thúc ]</span>
                          )
                        ) : (
                          !appt.staffId && appt.status === 'pending' && (
                            <button
                              onClick={() => {
                                if (currentUser?.staffId) {
                                  onClaimAppointment?.(appt.id, currentUser.staffId, currentUser.name);
                                }
                              }}
                              className="p-1.5 px-4 bg-accent text-accent-foreground hover:bg-accent-secondary text-white rounded-md text-sm font-bold transition-all shadow-sm cursor-pointer"
                            >
                              💅 Nhận Đơn Lịch Móng Này
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {groupedCardEntries.length > 0 && (
            <div className="mb-4 space-y-4">
              {groupedCardEntries.map(([groupId, groupAppointments]) => {
                const firstAppointment = groupAppointments[0];
                const payableAppointments = groupAppointments.filter(appt =>
                  appt.status !== 'completed' &&
                  appt.status !== 'cancelled' &&
                  appt.status !== 'deleted' &&
                  !isAwaitingPayment(appt)
                );
                const totalPrice = groupAppointments.reduce((sum, appt) => sum + (Number(appt.totalPrice) || 0), 0);
                const hasUnpricedService = groupAppointments.some(appt => !(Number(appt.totalPrice) > 0));
                const groupAllCompleted = groupAppointments.every(appt => appt.status === 'completed');
                const groupAllCancelled = groupAppointments.every(appt => appt.status === 'cancelled' || appt.status === 'deleted');
                const groupInformationLocked = currentUser?.role === 'staff' && (groupAllCompleted || groupAllCancelled);
                const groupCustomerName = groupInformationLocked
                  ? maskCustomerName(firstAppointment.customerName)
                  : firstAppointment.customerName;
                const groupCustomerPhone = groupInformationLocked
                  ? maskCustomerPhone(firstAppointment.customerPhone)
                  : firstAppointment.customerPhone;

                return (
                  <section key={groupId} className="overflow-hidden rounded-2xl border-2 border-accent/60 bg-white shadow-sm">
                    <header className="flex flex-col gap-3 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-accent shadow-sm">
                          <User className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-serif text-lg font-bold text-foreground">{groupCustomerName}</h3>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent">
                              Lịch nhóm
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {groupCustomerPhone || 'Chưa có số điện thoại'} · {groupAppointments.length} dịch vụ · Mã {groupId}
                          </p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Tổng toàn bộ lịch</p>
                        <p className="font-mono text-lg font-extrabold text-accent">
                          {hasUnpricedService ? 'Chưa chốt đủ giá' : `${totalPrice.toLocaleString()}đ`}
                        </p>
                      </div>
                    </header>

                    <div className="space-y-2 p-3">
                      {groupAppointments.map((appt, index) => {
                        const isCompleted = appt.status === 'completed';
                        const isCancelled = appt.status === 'cancelled' || appt.status === 'deleted';
                        const isPendingPayment = isAwaitingPayment(appt);
                        const isPayable = !isCompleted && !isCancelled && !isPendingPayment;
                        const serviceLabel = getApptServicesString(appt);
                        const statusLabel = isCompleted
                          ? 'Đã thanh toán'
                          : isCancelled
                          ? 'Đã hủy'
                          : isPendingPayment
                          ? isTransferPending(appt) ? 'Chờ SePay' : 'Chờ duyệt tiền mặt'
                          : 'Chưa thanh toán';

                        return (
                          <div key={appt.id} className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${isCompleted ? 'border-emerald-100 bg-emerald-50/40' : isCancelled ? 'border-border bg-muted/40 opacity-65' : isPendingPayment ? 'border-sky-200 bg-sky-50/40' : 'border-border bg-background'}`}>
                            <div className="flex min-w-0 items-start gap-3">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white font-mono text-xs font-bold text-accent shadow-sm">{index + 1}</span>
                              <div className="min-w-0">
                                <p className="font-bold text-foreground">{serviceLabel}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {appt.time} · {appt.date}</span>
                                  <span>{appt.staffId ? `Thợ ${appt.staffName}` : 'Chưa chọn thợ'}</span>
                                  <span className="font-semibold">{Number(appt.totalPrice) > 0 ? `${Number(appt.totalPrice).toLocaleString()}đ` : 'Chưa chốt giá'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isCompleted ? 'bg-emerald-100 text-emerald-700' : isCancelled ? 'bg-muted text-muted-foreground' : isPendingPayment ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800'}`}>
                                {statusLabel}
                              </span>
                              {renderGroupedAppointmentActions(appt)}
                              {isPayable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    openCheckoutForAppointment(appt, 'single');
                                  }}
                                  className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-foreground transition hover:border-accent hover:text-accent"
                                >
                                  Thanh toán riêng
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <footer className="flex flex-col gap-3 border-t border-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        {payableAppointments.length > 0
                          ? `${payableAppointments.length} dịch vụ chưa thanh toán sẽ được gom vào một phiên thanh toán.`
                          : 'Các dịch vụ trong lịch này đã được xử lý.'}
                      </p>
                      {payableAppointments.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            openCheckoutForAppointment(payableAppointments[0], 'group');
                          }}
                          className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-bold text-white transition hover:bg-accent-secondary"
                        >
                          <ReceiptText className="h-4 w-4" />
                          {payableAppointments.length > 1 ? 'Thanh toán toàn bộ' : 'Thanh toán phần còn lại'}
                        </button>
                      )}
                    </footer>
                  </section>
                );
              })}
            </div>
          )}

          {/* Regular standalone appointment cards */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {standaloneCardAppts.map((appt) => {
            const isCompleted = appt.status === 'completed';
            const isCancelled = appt.status === 'cancelled';
            const isPendingApproval = isAwaitingPayment(appt);
            return (
              <div
                key={appt.id}
                className={`flex flex-col justify-between bg-white rounded-lg border p-4 shadow-xs transition-all relative overflow-hidden ${
                  isCompleted
                    ? 'border-emerald-100 bg-emerald-50/10'
                    : isCancelled
                    ? 'border-border opacity-60'
                    : 'border-muted bg-muted/30'
                }`}
              >
                {/* Visual Accent Top Bar */}
                <div className={`absolute top-0 left-0 right-0 h-1.5 ${
                  isCompleted ? 'bg-emerald-400' : isCancelled ? 'bg-muted' : 'bg-accent text-accent-foreground'
                }`} />

                <div>
                  {/* Card Header */}
                  <div className="flex justify-between items-start mb-3">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-card hover:bg-muted text-foreground rounded-full font-mono text-[10px] font-bold">
                      <Clock className="w-3.5 h-3.5 text-accent" /> {appt.time} • {appt.date}
                    </span>
                    <span className={`text-[9px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-sm ${
                      isCompleted ? 'bg-emerald-50 text-emerald-700' : isCancelled ? 'bg-muted text-muted-foreground' : 'bg-muted text-accent'
                    }`}>
                      {appt.status === 'completed' ? 'Hoàn thành' : appt.status === 'cancelled' ? 'Đã hủy' : 'Hẹn sắp tới'}
                    </span>
                  </div>

                  {/* Customer Block */}
                  <div className="mb-3">
                    <h4 className="font-serif font-bold text-foreground group-hover:text-accent-secondary transition-colors">{appt.customerName}</h4>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{appt.customerPhone}</p>
                  </div>

                  {/* Services Block */}
                  <div className="py-2 border-y border-border mb-3 space-y-1">
                    <span className="block text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Dịch vụ đã chọn</span>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries((appt.serviceIds || []).reduce((acc, sId) => {
                        acc[sId] = (acc[sId] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)).map(([srvId, qty]) => {
                        const srv = services.find(s => s.id === srvId);
                        return srv ? (
                          <span key={srvId} className="px-2 py-0.5 bg-muted/80 border border-muted text-accent text-[10px] font-medium rounded-lg">
                            {srv.name} {qty > 1 ? `(x${qty})` : ''}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>

                  {/* Extra Services in Progress Block */}
                  <div className="py-2 border-b border-border mb-3 space-y-1.5 bg-background/45 p-2 rounded-md border border-border">
                    <div className="flex justify-between items-center">
                      <span className="block text-[9px] text-accent uppercase tracking-wider font-bold">Dịch vụ phát sinh thêm</span>
                      {!isCompleted && !isCancelled && (currentUser?.role === 'admin' || currentUser?.role === 'support') && (
                        <button
                          onClick={() => {
                            setAddingExtraApptId(appt.id === addingExtraApptId ? null : appt.id);
                            setExtraSrvName('');
                            setExtraSrvPrice('');
                          }}
                          className="text-[9px] font-bold text-accent hover:text-accent flex items-center gap-0.5 cursor-pointer bg-white px-1.5 py-0.5 rounded border border-border transition-all font-sans"
                        >
                          {addingExtraApptId === appt.id ? 'Hủy' : '+ Phát sinh'}
                        </button>
                      )}
                    </div>

                    {appt.extraServices && appt.extraServices.length > 0 ? (
                      <div className="space-y-1">
                        {appt.extraServices.map((es, idx) => (
                          <div key={idx} className="flex justify-between items-center bg-card hover:bg-muted/70 p-1 px-2 rounded-md text-[10px] text-foreground">
                            <span className="font-semibold text-foreground font-sans">✨ {es.name}</span>
                            <div className="flex items-center gap-1.5 font-bold font-mono text-foreground">
                              <span>{es.price.toLocaleString()}đ</span>
                              {!isCompleted && !isCancelled && (currentUser?.role === 'admin' || currentUser?.role === 'support') && (
                                <button
                                  type="button"
                                  onClick={() => onRemoveExtraService?.(appt.id, idx)}
                                  className="text-[10px] text-accent hover:text-accent-secondary font-bold px-1 cursor-pointer"
                                  title="Xóa phát sinh"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic pl-1">Chưa phát sinh dịch vụ khác</p>
                    )}

                    {/* Inline Form to add extra service */}
                    {addingExtraApptId === appt.id && (
                      <div className="bg-white p-2.5 rounded-lg border border-dashed border-border space-y-1.5 mt-2 transition-all">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase">Thêm dịch vụ phát sinh mới</p>
                        <input
                          type="text"
                          placeholder="Ví dụ: Đắp charm đá xịn, chà gót... làm thêm"
                          value={extraSrvName}
                          onChange={(e) => setExtraSrvName(e.target.value)}
                          className="w-full bg-background border border-border rounded-md p-1 px-1.5 text-[10px] text-foreground focus:bg-white"
                        />
                        <div className="flex gap-1">
                          <input
                             type="number"
                             min="0"
                             placeholder="Giá tiền (đ)..."
                             value={extraSrvPrice}
                             onChange={(e) => setExtraSrvPrice(e.target.value)}
                             className="w-1/2 bg-background border border-border rounded-md p-1 px-1.5 text-[10px] font-mono text-foreground focus:bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddNewExtra(appt.id)}
                            className="w-1/2 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white text-[9px] font-bold rounded-md py-1 transition-all cursor-pointer font-sans"
                          >
                            Đồng ý
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Staff Info */}
                  <div className="mb-3 space-y-1.5">
                    <p className="text-sm text-muted-foreground font-medium flex items-center gap-1.5">
                      <Scissors className="w-3.5 h-3.5 text-muted-foreground" /> Thợ phụ trách:{' '}
                      {appt.staffId ? (
                        <span className="font-bold text-foreground">{appt.staffName}</span>
                      ) : (
                        <span className="text-accent bg-muted px-2 py-0.5 rounded-lg border border-muted font-bold text-[10px]">Chưa phân công thợ</span>
                      )}
                    </p>

                    {/* Claim Button */}
                    {!appt.staffId && currentUser?.role === 'staff' && appt.status === 'pending' && (
                      <button
                        onClick={() => {
                          if (currentUser?.staffId) {
                            onClaimAppointment?.(appt.id, currentUser.staffId, currentUser.name);
                          }
                        }}
                        className="w-full mt-2 py-2 bg-accent text-accent-foreground hover:bg-accent-secondary text-white text-sm font-bold rounded-md transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        💅 Nhận đơn này (Nhận hoa hồng)
                      </button>
                    )}
                  </div>

                  {/* Notes rendering block */}
                  {appt.notes && (
                    <div className="mt-3 mb-4">
                      <p className="text-[11px] text-foreground bg-card hover:bg-muted p-2.5 rounded-md italic flex items-start gap-1 px-3 border border-border shadow-sm">
                        <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" /> <span className="break-words">"{appt.notes}"</span>
                      </p>
                    </div>
                  )}

                  {/* Admin status approval request review banner */}
                  {currentUser?.role === 'admin' && appt.pendingStatusApproval && (
                    appt.pendingStatusApproval === 'cancelled' ? (
                      <div className="mt-2.5 p-3 bg-muted/90 rounded-lg border border-red-250 shadow-sm mb-4 space-y-2">
                        <div className="flex items-center gap-1.5 text-sm text-accent font-bold">
                          <ShieldAlert className="w-4 h-4 text-accent shrink-0" />
                          <span>Yêu cầu Hủy lịch hẹn:</span>
                        </div>
                        <p className="text-[11.5px] text-foreground leading-normal font-sans">
                          Thợ <strong className="text-foreground font-semibold">{appt.staffId && staff.find(s => s.id === appt.staffId)?.name || appt.staffName || 'Chưa rõ'}</strong> báo hủy lịch hẹn của khách <strong className="text-foreground">{appt.customerName}</strong>.
                        </p>
                        
                        <div className="flex flex-col gap-1.5 pt-1">
                          {confirmCancelRequestId === appt.id ? (
                            <div className="flex flex-col gap-1.5 p-2 bg-rose-50 border border-rose-250 rounded-md">
                              <span className="text-[10.5px] text-rose-800 font-bold">Xác nhận duyệt hủy đơn của thợ?</span>
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleCancelAppointment(appt, () => {
                                      onUpdateAppointment?.(appt.id, { pendingStatusApproval: "" as any });
                                      setConfirmCancelRequestId(null);
                                    });
                                  }}
                                  className="flex-1 py-1 px-2.5 bg-rose-600 text-white rounded-md text-[11px] font-bold hover:bg-rose-700 transition-all cursor-pointer flex items-center justify-center gap-1"
                                >
                                  ✓ Chắc chắn duyệt hủy đơn
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmCancelRequestId(null)}
                                  className="py-1 px-2 bg-white text-muted-foreground border border-border rounded-md text-[11px] font-medium hover:bg-muted transition-all cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmCancelRequestId(appt.id);
                                  setConfirmApproveId(null);
                                  setQuickCompleteId(null);
                                  setQuickCancelId(null);
                                }}
                                className="flex-1 py-1.5 px-3 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-md text-[11px] font-bold shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1"
                              >
                                <XCircle className="w-3.5 h-3.5" /> Đồng ý duyệt (Hủy lịch ❌)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onUpdateAppointment?.(appt.id, { pendingStatusApproval: "" as any });
                                }}
                                className="py-1.5 px-2 bg-muted hover:bg-muted text-muted-foreground rounded-md text-[11px] font-bold transition-all cursor-pointer border border-border shadow-4xs"
                              >
                                Từ chối
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={`mt-2.5 mb-4 space-y-3.5 rounded-xl border p-4 shadow-sm ${
                        isTransferPending(appt)
                          ? 'border-sky-200 bg-sky-50'
                          : 'border-amber-200 bg-amber-50'
                      }`}>
                        <div className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                          {isTransferPending(appt)
                            ? <QrCode className="h-5 w-5 shrink-0 text-sky-700" />
                            : <Banknote className="h-5 w-5 shrink-0 text-amber-800" />}
                          <span>{getAwaitingPaymentLabel(appt)}</span>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed font-sans">
                          Thợ <strong className="text-foreground font-semibold">{appt.staffId && staff.find(s => s.id === appt.staffId)?.name || appt.staffName || 'Chưa rõ'}</strong> báo hoàn thành đơn của <strong className="text-foreground">{appt.customerName}</strong>.
                          <br />
                          Phương thức: <span className="ml-1 rounded-md bg-white px-2 py-0.5 text-xs font-bold text-foreground">{appt.paymentMethod === 'transfer' ? 'Chuyển khoản QR' : 'Tiền mặt'}</span>
                          <br />
                          Số tiền cần thu qua {appt.paymentMethod === 'transfer' ? 'Chuyển khoản' : 'Tiền mặt'}: <strong className="font-mono text-emerald-700">{(appt.paymentCollectedAmount !== undefined && appt.paymentCollectedAmount !== null ? appt.paymentCollectedAmount : (appt.amountDue !== undefined ? appt.amountDue : appt.totalPrice)).toLocaleString()}đ</strong>
                          {appt.depositUsed ? (
                            <>
                              <br />
                              Số tiền cọc đã khấu trừ: <strong className="font-mono text-indigo-700">{(appt.depositUsed || 0).toLocaleString()}đ</strong>
                            </>
                          ) : null}
                        </p>
                        
                         {appt.receiptImage && (
                          <div className="space-y-1 pt-2 border-t border-border">
                            <span className="block text-[9.5px] text-accent font-extrabold uppercase tracking-wider">📸 Ảnh hóa đơn đã tải lên (Nhấp để phóng to):</span>
                            <div className="relative inline-block max-w-[200px] border border-border rounded-md overflow-hidden shadow-4xs bg-white cursor-zoom-in hover:ring-2 hover:ring-[var(--accent)] transition-all">
                              <img src={appt.receiptImage} alt="Hóa đơn" className="max-h-56 object-contain hover:scale-105 transition-all" onClick={() => setZoomedReceiptUrl(appt.receiptImage || null)} />
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-2 pt-1">
                          {isPaymentReconciliationRequired(appt) ? (
                            <div className="rounded-lg border-2 border-rose-300 bg-rose-50 p-3 text-sm font-bold leading-relaxed text-rose-900">
                              SePay đã ghi nhận tiền sau khi mã QR hết hạn hoặc bị hủy. Không duyệt, hủy hay tạo thanh toán mới trước khi quản lý đối soát giao dịch này.
                            </div>
                          ) : isTransferPending(appt) ? (
                            <div className="rounded-lg border border-sky-200 bg-white/80 p-3 text-sm leading-relaxed text-sky-900">
                              SePay sẽ tự xác nhận khi nhận đúng giao dịch. Admin không cần bấm duyệt thủ công.
                            </div>
                          ) : confirmApproveId === appt.id ? (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                              <p className="text-sm font-bold text-emerald-900">
                                Xác nhận cửa hàng đã thu đủ tiền mặt?
                              </p>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <button
                                  type="button"
                                  onClick={() => setConfirmApproveId(null)}
                                  className="min-h-[46px] rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-bold text-foreground transition-all hover:bg-muted"
                                >
                                  Quay lại
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdminApprovePayment(appt)}
                                  className="flex min-h-[46px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.98]"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                  Duyệt và hoàn tất
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmApproveId(appt.id);
                                  setConfirmCancelRequestId(null);
                                  setQuickCompleteId(null);
                                  setQuickCancelId(null);
                                }}
                                className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.98]"
                              >
                                <CheckCircle className="h-4 w-4" />
                                Duyệt và hoàn tất
                              </button>
                              <button
                                type="button"
                                onClick={() => openWithdrawRequest(appt)}
                                className="min-h-[48px] rounded-lg border border-border bg-white px-4 py-3 text-sm font-bold text-foreground transition-all hover:bg-muted"
                              >
                                Yêu cầu chỉnh sửa
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>

                {/* Footer and interactive buttons */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center pt-3 border-t border-border">
                    <div>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Tổng hóa đơn</span>
                      <p className="font-mono text-sm font-bold text-accent">{appt.totalPrice.toLocaleString()} đ</p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {(currentUser?.role === 'admin' || currentUser?.role === 'support') && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(appt)}
                          title="Chỉnh sửa đơn"
                          className="p-1.5 bg-card hover:bg-muted hover:bg-muted text-foreground rounded-lg transition-all cursor-pointer border border-border flex items-center gap-1"
                        >
                          <Edit className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] font-bold">Chỉnh sửa</span>
                        </button>
                      )}

                      {!isCompleted && !isCancelled && !isPendingApproval && currentUser?.role === 'admin' && (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setQuickCompleteId(appt.id);
                              setQuickCancelId(null);
                              setConfirmApproveId(null);
                              setConfirmCancelRequestId(null);
                            }}
                            title="Xác nhận hoàn thành trực tiếp"
                            className="p-1 px-2.5 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-700 rounded-lg transition-all cursor-pointer border border-emerald-250 flex items-center gap-1"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold">Xong</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setQuickCancelId(appt.id);
                              setQuickCompleteId(null);
                              setConfirmApproveId(null);
                              setConfirmCancelRequestId(null);
                            }}
                            title="Hủy lịch hẹn"
                            className="p-1 px-2.5 bg-muted hover:bg-muted text-accent rounded-lg transition-all cursor-pointer border border-rose-250 flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold">Hủy đơn</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline quick confirmation box under the footer */}
                  {!isCompleted && !isCancelled && !isPendingApproval && currentUser?.role === 'admin' && (
                    <>
                      {quickCompleteId === appt.id && (
                        <div className="p-2.5 bg-emerald-50 border border-emerald-250 rounded-lg space-y-2 mt-2">
                          <p className="text-[11.5px] text-emerald-800 font-bold flex items-center gap-1">
                            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Bạn chắc chắn muốn hoàn thành trực tiếp cho đơn hàng này?</span>
                          </p>
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                openCheckoutForAppointment(appt);
                                setQuickCompleteId(null);
                              }}
                              className="py-1 px-3 bg-emerald-600 text-white rounded-md text-[11px] font-bold hover:bg-emerald-700 transition-all cursor-pointer shadow-xs"
                            >
                              ✓ Chắc chắn xong
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuickCompleteId(null)}
                              className="py-1 px-3 bg-white text-muted-foreground border border-border rounded-md text-[11px] font-medium hover:bg-muted transition-all cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      )}

                      {quickCancelId === appt.id && (
                        <div className="p-2.5 bg-rose-50 border border-rose-250 rounded-lg space-y-2 mt-2">
                          <p className="text-[11.5px] text-rose-800 font-bold flex items-center gap-1">
                            <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>Bạn chắc chắn muốn hủy đơn hàng này?</span>
                          </p>
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                handleCancelAppointment(appt, () => {
                                  setQuickCancelId(null);
                                });
                              }}
                              className="py-1 px-3 bg-rose-600 text-white rounded-md text-[11px] font-bold hover:bg-rose-700 transition-all cursor-pointer shadow-xs"
                            >
                              ✓ Chắc chắn hủy đơn
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuickCancelId(null)}
                              className="py-1 px-3 bg-white text-muted-foreground border border-border rounded-md text-[11px] font-medium hover:bg-muted transition-all cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}

      {/* Checkout Modal for Staff / Workers (Requirement 3) */}
      {checkoutAppt && (
        (() => {
          // Keep the original group mounted for the whole QR session. The server
          // changes every member to awaiting_payment as soon as it creates the QR;
          // filtering by status here would otherwise replace this modal with the
          // single-bill CheckoutModal before SePay confirms the transfer.
          const groupAppointments = checkoutScope === 'group'
            ? resolvePinnedGroupAppointments(appointments, checkoutGroupAppointmentIds)
            : [];

          return groupAppointments.length > 1 ? (
            <GroupCheckoutModal
              appointments={groupAppointments}
              customers={customers}
              services={services}
              staff={staff}
              currentUser={currentUser}
              systemSettings={systemSettings}
              onPaymentSubmitted={() => {
                const todayStr = getTodayString();
                if (groupAppointments.some(appt => appt.date && appt.date < todayStr)) {
                  onInvalidateHistoricalCache?.();
                }
                setCheckoutGroupAppointmentIds([]);
                setCheckoutScope('group');
                setCheckoutAppt(null);
              }}
              onClose={() => {
                setCheckoutGroupAppointmentIds([]);
                setCheckoutScope('group');
                setCheckoutAppt(null);
              }}
            />
          ) : (
            <CheckoutModal
              appointment={checkoutAppt}
              customer={findCustomerById(customers, checkoutAppt.customerId)}
              systemSettings={systemSettings}
              authToken={currentUser?.token}
              onInvalidateHistoricalCache={onInvalidateHistoricalCache}
              onConfirm={async (payload) => {
                try {
                  const body = payload;
                  const res = await fetch('/api/checkout', {
                    method: 'POST',
                    headers: paymentRequestHeaders,
                    body: JSON.stringify(body)
                  });
                  const data = await res.json();
                  if (res.ok) {
                    const todayStr = getTodayString();
                    if (checkoutAppt.date && checkoutAppt.date < todayStr) {
                      onInvalidateHistoricalCache?.();
                    }
                    setCheckoutGroupAppointmentIds([]);
                    setCheckoutScope('group');
                    setCheckoutAppt(null);
                  } else {
                    alert("Lỗi: " + data.error);
                  }
                } catch(e) {
                  alert("Lỗi mạng!");
                }
              }}
              onClose={() => {
                setCheckoutGroupAppointmentIds([]);
                setCheckoutScope('group');
                setCheckoutAppt(null);
              }}
            />
          );
        })()
      )}

      {showWalkInModal && currentUser?.role === 'staff' && (
        <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">1 bước · khách vãng lai</p>
                <h3 className="font-serif text-xl font-bold text-foreground">Tạo đơn & thanh toán</h3>
                <p className="text-xs text-muted-foreground mt-1">Thợ thực hiện: <strong>{currentUser.name}</strong></p>
              </div>
              <button type="button" disabled={isCreatingWalkIn} onClick={closeWalkInModal} className="p-2 rounded-full bg-muted text-muted-foreground hover:bg-border disabled:opacity-50" aria-label="Đóng tạo đơn vãng lai"><X className="w-4 h-4" /></button>
            </div>
            {walkInQr ? (
              <div className="space-y-3 text-center">
                <p className="text-sm font-bold text-foreground">Khách quét QR để thanh toán</p>
                <QRDisplay appointment={walkInQr.appointment} amountDue={walkInQr.amountDue} paymentCode={walkInQr.paymentCode} systemSettings={systemSettings} onPaymentSuccess={closeWalkInModal} />
              </div>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-foreground">Tổng tiền</span>
                  <input type="number" min="0" inputMode="numeric" value={walkInTotal || ''} onChange={(e) => setWalkInTotal(Number(e.target.value))} className="w-full rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-xl font-extrabold text-emerald-800 outline-none focus:border-emerald-500" />
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[100000, 150000, 200000, 300000, 500000].map(amount => (
                    <button key={amount} type="button" onClick={() => setWalkInTotal(amount)} className={`rounded-lg border px-1 py-2 text-[11px] font-bold ${walkInTotal === amount ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border bg-white text-muted-foreground hover:bg-muted'}`}>{amount / 1000}k</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setWalkInPaymentMethod('cash')} className={`rounded-xl border-2 px-3 py-3 text-sm font-bold ${walkInPaymentMethod === 'cash' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-border bg-white text-muted-foreground'}`}>Tiền mặt</button>
                  <button type="button" onClick={() => setWalkInPaymentMethod('transfer')} className={`rounded-xl border-2 px-3 py-3 text-sm font-bold ${walkInPaymentMethod === 'transfer' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-border bg-white text-muted-foreground'}`}>Chuyển khoản QR</button>
                </div>
                <button type="button" onClick={handleCreateAndCheckoutWalkIn} disabled={isCreatingWalkIn || walkInTotal <= 0} className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-extrabold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {isCreatingWalkIn ? 'Đang tạo đơn...' : walkInPaymentMethod === 'transfer' ? 'Tạo đơn & hiện QR' : 'Tạo đơn & thanh toán'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Booking Form Dialog Modal overlay */}
      {showModal && (
        <div className="fixed inset-0 bg-muted/65 backdrop-blur-md flex items-center justify-center z-[9999] p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-lg border border-muted max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 md:p-8 space-y-6">
            <div className="flex justify-between items-start border-b border-border pb-4">
              <div>
                <span className="px-2.5 py-1 bg-muted text-accent text-[10px] font-bold rounded-md uppercase tracking-wider block w-fit mb-1.5 font-mono">Bảng đặt lịch dịch vụ móng</span>
                <h3 className="font-serif text-2xl font-bold text-foreground tracking-tight" style={{ fontFamily: 'Playfair Display, Nunito, serif' }}>
                  Đăng ký Đặt lịch Móng
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Hệ thống đặt lịch 3 bước thông minh & tối ưu hóa chi phí điều hành</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Reset fields and close
                  setSelectedCustId('');
                  setNewCustName('');
                  setNewCustPhone('');
                  setSelectedServices([]);
                  setServiceQuantities({});
                  setNotes('');
                  setCustomerSearchQuery('');
                  setCustomerEmail('');
                  setDepositAmount(0);
                  setActiveStep(1);
                  setCustType('existing');
                  setShowModal(false);
                }}
                className="p-1.5 px-3 bg-muted hover:bg-muted text-muted-foreground rounded-full cursor-pointer text-xs font-semibold"
              >
                Đóng ×
              </button>
            </div>

            {/* Smart Step Indicator Bar */}
            <div className="flex items-center justify-between max-w-md mx-auto mb-6 py-2">
              {[
                { step: 1, label: 'Khách Hàng', desc: 'SĐT & Liên hệ' },
                { step: 2, label: 'Dịch Vụ & Giờ', desc: 'Chọn thợ & giờ' },
                { step: 3, label: 'Xác Nhận Đơn', desc: 'Cọc & hoàn tất' }
              ].map((item, index) => (
                <React.Fragment key={item.step}>
                  <div className="flex flex-col items-center flex-1 relative">
                    <button
                      type="button"
                      onClick={() => {
                        // Validate transitioning
                        if (item.step < activeStep) {
                          setActiveStep(item.step);
                        } else if (item.step === 2 && activeStep === 1) {
                          const hasCustomer = (custType === 'existing' && selectedCustId) || (custType === 'new' && newCustName.trim());
                          if (!hasCustomer) {
                            alert("Vui lòng hoàn thành thông tin khách hàng ở bước 1!");
                          } else if (custType === 'new' && matchingCustomersByName.length > 0) {
                            setShowDuplicateNameWarning(true);
                          } else {
                            setActiveStep(2);
                          }
                        } else if (item.step === 3 && activeStep === 2) {
                          goToStep3();
                        }
                      }}
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all shadow-sm ${
                        activeStep === item.step
                          ? 'bg-accent text-white ring-4 ring-muted font-extrabold scale-105'
                          : activeStep > item.step
                          ? 'bg-emerald-500 text-white'
                          : 'bg-muted text-muted-foreground opacity-75'
                      }`}
                    >
                      {activeStep > item.step ? <Check className="w-4 h-4 text-white" /> : item.step}
                    </button>
                    <span className={`text-[10px] mt-2 font-bold uppercase tracking-wider text-center ${
                      activeStep === item.step ? 'text-accent' : 'text-muted-foreground'
                    }`}>
                      {item.label}
                    </span>
                    <span className="text-[9px] text-muted-foreground font-sans hidden sm:block text-center mt-0.5 animate-fade-in">
                      {item.desc}
                    </span>
                  </div>
                  {index < 2 && (
                    <div className="h-0.5 flex-1 mx-2 bg-muted relative -top-4">
                      <div 
                        style={{ width: activeStep > item.step ? '100%' : '0%' }}
                        className="h-full bg-emerald-500 transition-all duration-300"
                      />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); }} className="space-y-6">
              
              {/* STEP 1: CUSTOMER REGISTER / SEARCH */}
              {activeStep === 1 && (
                <div className="space-y-5 animate-fade-in">
                   <div className="flex bg-muted p-1 rounded-md">
                     <button
                       type="button"
                       onClick={() => {
                         setCustType('existing');
                         setSelectedCustId('');
                       }}
                       className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                         custType === 'existing'
                           ? 'bg-accent text-white shadow-md'
                           : 'text-foreground hover:bg-white/50 hover:text-foreground'
                       }`}
                     >
                       🔍 Tìm khách hàng cũ
                     </button>
                     <button
                       type="button"
                       onClick={() => {
                         setCustType('new');
                         setSelectedCustId('new');
                       }}
                       className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                         custType === 'new'
                           ? 'bg-accent text-white shadow-md'
                           : 'text-foreground hover:bg-white/50 hover:text-foreground'
                       }`}
                     >
                       ➕ Tạo khách hàng mới
                     </button>
                   </div>

                  {custType === 'existing' && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-bold text-foreground uppercase tracking-wider mb-2">Tìm kiếm Gợi ý thông minh (Theo Tên/SĐT)</label>
                        <div className="relative">
                          <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-muted-foreground" />
                          <input
                            type="text"
                            placeholder="Nhập tên hoặc số điện thoại khách hàng..."
                            value={customerSearchQuery}
                            onChange={(e) => {
                              setCustomerSearchQuery(e.target.value);
                              setSelectedCustId('');
                            }}
                            className="w-full bg-card hover:bg-muted border border-border rounded-md pl-10 pr-4 py-3 text-sm text-foreground focus:bg-white placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-muted transition-all font-sans"
                          />
                        </div>
                      </div>

                      {/* Matching suggestions box */}
                      {customerSearchQuery.trim().length > 0 && (
                        <div className="border border-border rounded-md max-h-[180px] overflow-y-auto bg-white shadow-xl divide-y divide-stone-50 z-50 animate-fade-in">
                          {customers
                            .filter(c => 
                              c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                              c.phone.includes(customerSearchQuery)
                            )
                            .map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCustId(c.id);
                                  setCustomerSearchQuery('');
                                }}
                                className="w-full text-left px-4 py-2.5 hover:bg-card hover:bg-muted text-sm text-foreground transition-colors flex justify-between items-center"
                              >
                                <span className="font-semibold text-foreground flex items-center gap-2">
                                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                                  {c.name}
                                </span>
                                <span className="font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-sm">
                                  {c.phone}
                                </span>
                              </button>
                            ))}
                          {customers.filter(c => 
                            c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                            c.phone.includes(customerSearchQuery)
                          ).length === 0 && (
                            <div className="p-4 text-muted-foreground text-sm text-center italic">
                              Không tìm thấy khách hàng trùng khớp.
                            </div>
                          )}
                        </div>
                      )}

                      {/* Display Selected Customer Info */}
                      {selectedCustId && selectedCustId !== 'new' && (
                        (() => {
                          const c = customers.find(item => item.id === selectedCustId);
                          if (!c) return null;
                          return (
                            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-between animate-fade-in shadow-sm">
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-emerald-500 text-white rounded-md">
                                  <CheckCircle className="w-5 h-5" />
                                </div>
                                <div>
                                  <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider block w-fit mb-0.5">Khách hàng cũ</span>
                                  <h4 className="font-bold text-foreground text-sm">{c.name}</h4>
                                  <p className="text-sm text-foreground font-mono mt-0.5">{c.phone || 'Không có SĐT'} {c.email ? `• ${c.email}` : ''}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCustId('');
                                  setCustomerSearchQuery('');
                                }}
                                className="p-1 px-2.5 bg-white text-muted-foreground hover:text-accent border border-border hover:border-muted rounded-lg text-[10px] h-fit transition-colors font-bold"
                              >
                                Thay đổi
                              </button>
                            </div>
                          );
                        })()
                      )}

                      {!selectedCustId && (
                        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          Gõ tên hoặc số điện thoại để chọn khách; nếu chưa có, chọn “Tạo khách hàng mới”.
                        </p>
                      )}
                    </div>
                  )}

                  {custType === 'new' && (
                    <div className="p-5 bg-muted/40 border border-muted rounded-lg space-y-4 animate-fade-in">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-accent" />
                        <span className="block text-sm text-amber-950 font-extrabold uppercase tracking-wider">Thông Tin Khách Hàng Mới</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1.5">Tên Khách Hàng <span className="text-rose-500 font-bold">*</span></label>
                          <div className="relative">
                            <User className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                            <input
                              type="text"
                              placeholder="Nguyễn Văn A..."
                              required
                              value={newCustName}
                              onChange={(e) => setNewCustName(e.target.value)}
                              className="w-full bg-white border border-border rounded-md pl-9 pr-3 py-2.5 text-sm text-foreground"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1.5">Số Điện Thoại (Không bắt buộc)</label>
                          <div className="relative">
                            <Smartphone className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                            <input
                              type="tel"
                              placeholder="0987345678... hoặc để trống"
                              value={newCustPhone}
                              onChange={(e) => setNewCustPhone(e.target.value)}
                              className="w-full bg-white border border-border rounded-md pl-9 pr-3 py-2.5 text-sm text-foreground font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      {matchingCustomersByPhone.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                          <p className="text-xs font-bold text-amber-900">
                            Số điện thoại này đã có trong danh bạ. Chỉ kết nối khi bạn xác nhận đúng khách:
                          </p>
                          {matchingCustomersByPhone.map(customer => (
                            <button
                              key={customer.id}
                              type="button"
                              onClick={() => {
                                setSelectedCustId(customer.id);
                                setCustType('existing');
                                setNewCustName('');
                                setNewCustPhone('');
                              }}
                              className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-left hover:bg-amber-100 transition-colors"
                            >
                              <span className="block text-sm font-bold text-foreground">{customer.name}</span>
                              <span className="block text-xs text-muted-foreground font-mono">
                                {customer.phone || 'Không có SĐT'} · Ví: {(customer.walletBalance || 0).toLocaleString()}đ
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1.5">Địa chỉ Email (Không bắt buộc)</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                          <input
                            type="email"
                            placeholder="khachhang@gmail.com..."
                            value={customerEmail}
                            onChange={(e) => setCustomerEmail(e.target.value)}
                            className="w-full bg-white border border-border rounded-md pl-9 pr-3 py-2.5 text-sm text-foreground"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="pt-4 border-t border-border flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const hasCustomer = (custType === 'existing' && selectedCustId) || (custType === 'new' && newCustName.trim());
                        if (!hasCustomer) {
                          alert("Vui lòng nhập đầy đủ thông tin hoặc chọn khách hàng ở bước 1!");
                        } else if (custType === 'new' && matchingCustomersByName.length > 0) {
                          setShowDuplicateNameWarning(true);
                        } else {
                          setActiveStep(2);
                        }
                      }}
                      className="px-5 py-2.5 bg-accent hover:bg-accent text-accent-foreground text-white rounded-md text-sm font-bold flex items-center gap-1 cursor-pointer transition-all shadow-md hover:shadow-lg"
                    >
                      Tiếp tục: Chọn dịch vụ & giờ <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: SERVICES & TIMING / TECH */}
              {activeStep === 2 && (
                <div className="space-y-5 animate-fade-in">
                  
                  {/* Select Services with Search-As-You-Type */}
                  <div className="space-y-3 p-4 bg-card hover:bg-muted rounded-lg border border-border/80 shadow-sm">
                    <div className="flex flex-col gap-2.5">
                      <div className="flex justify-between items-center flex-wrap gap-2">
                        <label className="block text-sm font-bold text-foreground uppercase tracking-wider">Chọn Dịch Vụ Nail</label>
                        {selectedServices.length > 0 && (
                          <span className="text-[10px] bg-accent text-white font-bold px-2.5 py-1 rounded-full shadow-sm">
                            Đã thêm {selectedServices.length} dịch vụ
                          </span>
                        )}
                      </div>

                      {/* Selected Badges with Delete Quick Actions */}
                      {selectedServices.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 p-2 bg-white rounded-md border border-border animate-fade-in shadow-sm">
                          {selectedServices.map(srvId => {
                            const srv = services.find(s => s.id === srvId);
                            if (!srv) return null;
                            const qty = serviceQuantities[srvId] || 1;
                            return (
                              <span
                                key={srvId}
                                className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent text-white rounded-full text-[11.5px] font-semibold shadow-xs transition-all"
                              >
                                💅 {srv.name} {qty > 1 ? `(x${qty})` : ''}
                                <button
                                  type="button"
                                  onClick={() => toggleService(srvId)}
                                  className="p-0.5 bg-white/20 hover:bg-white/45 text-white rounded-full transition-colors font-bold cursor-pointer inline-flex items-center justify-center w-4 h-4 text-[10px]"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground italic">Chưa chọn dịch vụ nào. Hãy tìm kiếm và tích chọn dưới đây.</p>
                      )}
                      
                      {/* Search Bar + Tabs */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                          <input
                            type="text"
                            placeholder="Gõ tìm kiếm dịch vụ ở đây..."
                            value={bookingServiceSearch}
                            onChange={(e) => setBookingServiceSearch(e.target.value)}
                            className="w-full bg-white border border-border rounded-md pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-muted font-sans shadow-sm"
                          />
                        </div>
                        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none shrink-0">
                          {[
                            { id: 'all', label: 'Tất cả' },
                            { id: 'basic-nail', label: 'Cơ bản' },
                            { id: 'fake-nail', label: 'Móng giả' },
                            { id: 'design', label: 'Vẽ/Design' },
                            { id: 'accessories', label: 'Charm/Đá' }
                          ].map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setBookingServiceCategory(tab.id as any)}
                              className={`px-2.5 py-1.5 rounded-md text-[11.5px] font-bold whitespace-nowrap transition-all cursor-pointer border ${
                                bookingServiceCategory === tab.id
                                  ? 'bg-accent border-accent text-white shadow-sm'
                                  : 'bg-white border-border text-foreground hover:bg-card hover:bg-muted'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Services Search Results Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[160px] overflow-y-auto p-1 scrollbar-thin">
                      {services
                        .filter(srv => {
                          if (bookingServiceCategory !== 'all' && srv.category !== bookingServiceCategory) return false;
                          if (bookingServiceSearch) {
                            return srv.name.toLowerCase().includes(bookingServiceSearch.toLowerCase());
                          }
                          return true;
                        })
                        .map(srv => {
                          const isChecked = selectedServices.includes(srv.id);
                          return (
                            <div
                              key={srv.id}
                              onClick={() => toggleService(srv.id)}
                              className={`p-2.5 rounded-md border cursor-pointer flex flex-col justify-between transition-all ${
                                isChecked
                                  ? 'bg-muted/75 border-accent shadow-sm'
                                  : 'bg-white hover:bg-background/40 border-border'
                              }`}
                            >
                              <div className="flex justify-between items-start w-full">
                                <div className="space-y-0.5">
                                  <p className="font-semibold text-sm text-foreground leading-snug">{srv.name}</p>
                                </div>
                                <div className="text-right flex flex-col items-end shrink-0 pl-2">
                                  <div className={`h-4 w-4 rounded-full border flex items-center justify-center transition-all ${
                                    isChecked ? 'border-accent bg-accent text-white font-bold text-[9px]' : 'border-border bg-white'
                                  }`}>
                                    {isChecked ? '✓' : ''}
                                  </div>
                                </div>
                              </div>

                              {isChecked && isPerItemService(srv) && (
                                <div 
                                  onClick={(e) => e.stopPropagation()} 
                                  className="mt-2 pt-2 border-t border-muted/40 flex justify-between items-center w-full animate-fade-in"
                                >
                                  <span className="text-[10px] text-foreground font-medium font-sans">Số lượng ({getServiceUnit(srv)}):</span>
                                  <div className="flex items-center gap-1 bg-white border border-border rounded-lg p-0.5 shadow-sm">
                                    <button
                                      type="button"
                                      onClick={() => updateServiceQuantity(srv.id, (serviceQuantities[srv.id] || 1) - 1)}
                                      className="w-5 h-5 flex items-center justify-center text-sm font-black text-accent hover:bg-muted rounded select-none cursor-pointer"
                                    >
                                      -
                                    </button>
                                    <span className="w-8 text-center text-sm font-bold text-foreground font-mono">
                                      {serviceQuantities[srv.id] || 1}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => updateServiceQuantity(srv.id, (serviceQuantities[srv.id] || 1) + 1)}
                                      className="w-5 h-5 flex items-center justify-center text-sm font-black text-accent hover:bg-muted rounded select-none cursor-pointer"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Technician Select */}
                  <div>
                    <label className="block text-sm font-bold text-foreground uppercase tracking-wider mb-2">Chọn thợ nail phụ trách</label>
                    <select
                      value={selectedStaffId}
                      onChange={(e) => setSelectedStaffId(e.target.value)}
                      className="w-full bg-card hover:bg-muted border border-border rounded-md px-3.5 py-2.5 text-sm text-foreground focus:bg-white font-medium"
                    >
                      <option value="">-- Chưa phân công thợ (Thợ tự nhận đơn sau) --</option>
                      {staff.filter(s => !isStaffSupport(s)).map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                      ))}
                    </select>
                  </div>

                  {/* Smart Time Picker & Quick Date buttons */}
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="block text-sm font-bold text-foreground uppercase tracking-wider">Chọn ngày làm việc</label>
                        {/* Quick Date buttons */}
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setApptDate(getTodayString())}
                            className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              apptDate === getTodayString()
                                ? 'bg-accent text-white'
                                : 'bg-muted text-foreground hover:bg-muted'
                            }`}
                          >
                            Hôm nay
                          </button>
                          <button
                            type="button"
                            onClick={() => setApptDate(getFutureDateString(1))}
                            className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              apptDate === getFutureDateString(1)
                                ? 'bg-accent text-white'
                                : 'bg-muted text-foreground hover:bg-muted'
                            }`}
                          >
                            Ngày mai
                          </button>
                        </div>
                      </div>
                      <input
                        type="date"
                        required
                        value={apptDate}
                        onChange={(e) => setApptDate(e.target.value)}
                        className="w-full bg-card hover:bg-muted border border-border rounded-md px-3.5 py-2.5 text-sm text-foreground focus:bg-white"
                      />
                    </div>
                  </div>

                  {/* TIME SLOTS GRID */}
                  <div className="space-y-2">
                    <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Chọn khung giờ làm việc ({apptDate === getTodayString() ? 'Hôm nay' : apptDate})</span>
                    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-7 gap-1.5">
                      {TIME_SLOTS.map(slot => {
                        const isSelected = apptTime === slot;
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setApptTime(slot)}
                            className={`py-2 text-[11.5px] rounded-md border flex items-center justify-center text-center transition-all cursor-pointer font-bold ${
                              isSelected
                                ? 'bg-accent border-accent text-white shadow-sm scale-105'
                                : 'bg-card hover:bg-muted/60 border-border text-foreground hover:bg-muted hover:border-border'
                            }`}
                          >
                            <span className="font-mono">{slot}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-4 border-t border-border flex justify-between">
                    <button
                      type="button"
                      onClick={() => setActiveStep(1)}
                      className="px-5 py-2.5 bg-muted hover:bg-muted text-foreground rounded-md text-sm font-bold flex items-center gap-1 cursor-pointer transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" /> Quay lại
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        goToStep3();
                      }}
                      className="px-5 py-2.5 bg-accent hover:bg-accent text-accent-foreground text-white rounded-md text-sm font-bold flex items-center gap-1 cursor-pointer transition-all shadow-md hover:shadow-lg"
                    >
                      Xác nhận chi phí & đặt cọc <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: FINANCIAL PREVIEW & CONFIRMATION */}
              {activeStep === 3 && (
                <div className="space-y-6 animate-fade-in">
                  
                  {/* Visual Cost Calculator Screen (Styled with application core brand gold theme to look seamless and harmonious) */}
                  <div className="p-5 bg-muted text-foreground font-semibold rounded-lg space-y-4 border border-border shadow-sm animate-fade-in">
                    <div className="flex justify-between items-center border-b border-border pb-2">
                      <span className="text-sm uppercase tracking-widest text-accent font-extrabold" style={{ fontFamily: 'Nunito, sans-serif' }}>Tóm tắt hóa đơn điều hành</span>
                      <span className="text-[10px] bg-accent text-accent-foreground text-white font-mono px-2 py-0.5 rounded-md font-semibold animate-pulse">
                        Tiến trình cuối cùng!
                      </span>
                    </div>

                    <div className="divide-y divide-border space-y-2">
                      <div className="space-y-1.5 pb-2">
                        {selectedServices.length === 0 ? (
                          <div className="text-sm text-muted-foreground italic">
                            Chưa chọn dịch vụ móng nào (Kỹ thuật viên có thể bổ sung sau khi chốt bill)
                          </div>
                        ) : (
                          selectedServices.map(srvId => {
                            const srv = services.find(s => s.id === srvId);
                            if (!srv) return null;
                            const qty = serviceQuantities[srvId] || 1;
                            return (
                              <div key={srvId} className="flex justify-between items-center text-sm text-foreground font-semibold animate-fade-in">
                                <span className="font-medium text-foreground">💅 {srv.name} {qty > 1 && <span className="text-muted-foreground font-mono text-[10px]">(x{qty})</span>}</span>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="pt-2 flex justify-between items-center text-sm">
                        <span className="text-muted-foreground font-medium">Người thực hiện</span>
                        <span className="text-foreground font-semibold font-bold">
                          👤 {selectedStaffId ? (staff.find(s => s.id === selectedStaffId)?.name) : 'Chưa phân công thợ (Thợ tự đảm nhận)'}
                        </span>
                      </div>

                      <div className="pt-2 flex justify-between items-center text-sm">
                        <span className="text-muted-foreground font-medium">Lịch làm việc:</span>
                        <span className="font-mono text-foreground font-semibold font-bold">
                          📅 {apptDate} lúc {apptTime}
                        </span>
                      </div>

                      <div className="pt-3 flex justify-between items-end border-t border-border">
                        <div>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block">Tổng Chi Phí Dự Kiến</span>
                          <p className="font-mono text-xl font-black text-accent">{calculatedTotal.toLocaleString()} VNĐ</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* PREPAYMENT DEPOSIT OPTION INPUTS */}
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 space-y-3.5">
                    <div className="flex items-center gap-1.5">
                      <Wallet className="w-4 h-4 text-emerald-600" />
                      <label className="block text-sm font-bold text-emerald-900 uppercase tracking-wider">Số tiền khách đã đặt cọc trước (Nếu có)</label>
                    </div>

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type="number"
                          placeholder="Nhập số tiền đã đặt cọc..."
                          value={depositAmount || ''}
                          onChange={(e) => {
                            const val = Math.max(0, parseInt(e.target.value) || 0);
                            setDepositAmount(val);
                            setAssignedDepositAmount(val);
                          }}
                          className="w-full bg-white border border-border rounded-md px-4 py-2.5 text-sm font-bold text-foreground placeholder:text-muted-foreground focus:outline-hidden"
                        />
                        <span className="absolute right-3.5 top-3 text-[10px] font-bold text-muted-foreground font-mono">VNĐ</span>
                      </div>
                    </div>

                    {/* Pre-payment deposit quick button options */}
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        { label: 'Không đặt cọc (0đ)', val: 0 },
                        { label: '50.000đ', val: 50000 },
                        { label: '100.000đ', val: 100000 },
                        { label: '200.000đ', val: 200000 },
                        { label: 'Cọc 50%', val: Math.round(calculatedTotal * 0.5) }
                      ].map((preset, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            setDepositAmount(preset.val);
                            setAssignedDepositAmount(preset.val);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer border ${
                            depositAmount === preset.val
                              ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                              : 'bg-white text-foreground hover:bg-card hover:bg-muted border-border'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    {/* Assigned Deposit Input (Phần A) */}
                    <div className="pt-3 border-t border-emerald-200 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                        <label className="block text-xs font-bold text-emerald-800 uppercase tracking-wider font-mono">Số tiền cọc sẽ khấu trừ lúc checkout</label>
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          placeholder="Nhập số tiền cọc sẽ khấu trừ cho đơn này..."
                          value={assignedDepositAmount || ''}
                          onChange={(e) => setAssignedDepositAmount(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full bg-white border border-border rounded-md px-4 py-2.5 text-sm font-bold text-foreground placeholder:text-muted-foreground focus:outline-hidden"
                        />
                        <span className="absolute right-3.5 top-3 text-[10px] font-bold text-muted-foreground font-mono">VNĐ</span>
                      </div>
                      <p className="text-[10px] text-emerald-700 italic leading-normal font-medium">
                        Số tiền cố định chốt ở đây sẽ được khấu trừ khỏi hóa đơn lúc thanh toán móng.
                      </p>
                    </div>

                    {/* Wallet-based deposit option */}
                    {custType === 'existing' && selectedCustId && (() => {
                      const selectedCustomerObj = customers.find(c => c.id === selectedCustId);
                      const walletBalance = selectedCustomerObj?.walletBalance ?? 0;
                      return (
                        <div className="space-y-2.5 animate-fade-in">
                          {/* Wallet Balance Display Card */}
                          <div className="p-3 bg-white/70 rounded-md border border-emerald-150 text-foreground flex items-center justify-between text-sm">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                              💰 Số dư ví tích lũy của khách:
                            </span>
                            <span className="font-mono font-extrabold text-emerald-850 bg-emerald-100/40 px-2.5 py-1 rounded-lg border border-emerald-200">
                              {walletBalance.toLocaleString()}đ
                            </span>
                          </div>

                          {depositAmount > 0 && (
                            <div className="p-3 bg-muted/70 rounded-md border border-muted text-foreground space-y-2.5 animate-fade-in">
                              <span className="text-[10px] font-bold text-accent uppercase tracking-wide block">
                                💳 Phương thức đặt cọc ({depositAmount.toLocaleString()}đ):
                              </span>
                              
                              <div className="grid grid-cols-2 gap-2 text-[11px]">
                                {/* Option 1: Deduct from customer's wallet */}
                                <button
                                  type="button"
                                  onClick={() => setUseWalletForDepositPrepayment(true)}
                                  className={`p-2.5 rounded-md border font-bold flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer ${
                                    useWalletForDepositPrepayment
                                      ? 'bg-muted border-accent text-amber-950 shadow-sm scale-[1.02]'
                                      : 'bg-white border-border text-muted-foreground hover:bg-card hover:bg-muted'
                                  }`}
                                >
                                  <span className="text-sm">💳 Khấu trừ từ ví</span>
                                  <span className="text-[9px] font-medium opacity-80">(Ví còn: {walletBalance.toLocaleString()}đ)</span>
                                </button>

                                {/* Option 2: Paid directly (manually) */}
                                <button
                                  type="button"
                                  onClick={() => setUseWalletForDepositPrepayment(false)}
                                  className={`p-2.5 rounded-md border font-bold flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer ${
                                    !useWalletForDepositPrepayment
                                      ? 'bg-emerald-100/80 border-emerald-400 text-emerald-950 shadow-sm scale-[1.02]'
                                      : 'bg-white border-border text-muted-foreground hover:bg-card hover:bg-muted'
                                  }`}
                                >
                                  <span className="text-sm">💵 Đã thanh toán cọc</span>
                                  <span className="text-[9px] font-medium opacity-80">(Khách tự trả mặt / CK)</span>
                                </button>
                              </div>

                              <div className="p-2 bg-white/60 rounded-lg text-[9.5px] text-foreground leading-normal border border-border">
                                {useWalletForDepositPrepayment ? (
                                  walletBalance >= depositAmount ? (
                                    <span>Hệ thống sẽ <strong>khấu trừ {depositAmount.toLocaleString()}đ</strong> từ ví tích lũy của khách ngay sau khi tạo lịch hẹn thành công. Hoàn toàn tự động!</span>
                                  ) : (
                                    <span>Ví của khách chỉ còn {walletBalance.toLocaleString()}đ, hệ thống sẽ <strong>khấu trừ toàn bộ {walletBalance.toLocaleString()}đ</strong> từ ví, phần còn lại {(depositAmount - walletBalance).toLocaleString()}đ khách cần tự thanh toán bổ sung.</span>
                                  )
                                ) : (
                                  <span>Ghi nhận khách <strong>đã thanh toán cọc trực tiếp</strong> {depositAmount.toLocaleString()}đ (bằng tiền mặt hoặc chuyển khoản ngân hàng). Không ảnh hưởng đến số dư ví.</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Giữ cọc / Khấu trừ cọc option for Admin Booking Form */}
                    {custType === 'existing' && selectedCustId && (() => {
                      const selectedCustomerObj = customers.find(c => c.id === selectedCustId);
                      const walletBalance = selectedCustomerObj?.walletBalance ?? 0;
                      if (walletBalance <= 0) return null;
                      return (
                        <div className="p-4 bg-accent/5 rounded-md border border-accent/15 space-y-3 mt-2.5 animate-fade-in">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-accent flex items-center gap-1">
                              💰 Tiền cọc đã đặt tích lũy:
                            </span>
                            <span className="font-mono font-bold text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
                              {walletBalance.toLocaleString()}đ
                            </span>
                          </div>
                          
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold text-accent uppercase tracking-wide block">
                              Phương án khấu trừ cọc:
                            </span>
                            <div className="grid grid-cols-1 gap-1.5">
                              <label className="flex items-center gap-2.5 p-3 bg-white rounded-md border border-border cursor-pointer hover:bg-muted/50 transition-colors">
                                <input
                                  type="radio"
                                  name="bookingUseDeposit"
                                  checked={bookingUseDeposit === true}
                                  onChange={() => setBookingUseDeposit(true)}
                                  className="w-3.5 h-3.5 text-accent border-neutral-300 focus:ring-accent"
                                />
                                <div className="flex-1">
                                  <span className="block text-xs font-bold text-foreground">Khấu trừ tự động khi thanh toán</span>
                                  <span className="block text-[10px] text-muted-foreground mt-0.5 font-medium">Hệ thống tự động trừ tiền cọc từ hóa đơn cuối (Khuyên dùng)</span>
                                </div>
                              </label>

                              <label className="flex items-center gap-2.5 p-3 bg-white rounded-md border border-border cursor-pointer hover:bg-muted/50 transition-colors">
                                <input
                                  type="radio"
                                  name="bookingUseDeposit"
                                  checked={bookingUseDeposit === false}
                                  onChange={() => setBookingUseDeposit(false)}
                                  className="w-3.5 h-3.5 text-accent border-neutral-300 focus:ring-accent"
                                />
                                <div className="flex-1">
                                  <span className="block text-xs font-bold text-foreground">Giữ nguyên cọc cho lần sau</span>
                                  <span className="block text-[10px] text-muted-foreground mt-0.5 font-medium">Chỉ giữ cọc khi khách muốn duy trì tư cách cọc lâu dài</span>
                                </div>
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Split Progress Finance Chart */}
                    {calculatedTotal > 0 && (
                      <div className="bg-white/70 p-3 rounded-md border border-emerald-150 space-y-2 animate-fade-in mt-2">
                        <div className="flex justify-between text-[10px] font-bold">
                          <span className="text-emerald-700">Đã cọc: {depositAmount.toLocaleString()}đ ({(Math.min(100, calculatedTotal > 0 ? (depositAmount / calculatedTotal) * 100 : 0)).toFixed(0)}%)</span>
                          <span className="text-accent">Còn lại dự kiến: {(Math.max(0, calculatedTotal - depositAmount)).toLocaleString()}đ</span>
                        </div>
                        <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden flex">
                          <div 
                            style={{ width: `${Math.min(100, (depositAmount / calculatedTotal) * 100)}%` }} 
                            className="h-full bg-emerald-500 transition-all duration-300"
                          />
                          <div 
                            style={{ width: `${Math.max(0, 100 - (depositAmount / calculatedTotal) * 100)}%` }} 
                            className="h-full bg-accent transition-all duration-300"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Số lượng đơn N (Phần B) */}
                  {isMobile ? (
                    // Mobile (màn hình < 768px): Button to trigger Bottom Sheet
                    <div className="p-4 bg-rose-50 rounded-md border border-rose-100 space-y-3">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-rose-900 uppercase tracking-wider">Đặt nhiều lịch</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDuplicateCount(numAppointments);
                          setShowDuplicateSheet(true);
                        }}
                        className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md"
                      >
                        <Plus className="w-3.5 h-3.5" /> Đặt lịch nhóm: {numAppointments} đơn
                      </button>
                      <p className="text-[10px] text-rose-800/80 leading-normal font-medium text-center">
                        Tạo nhiều đơn cùng khách; có thể chỉnh dịch vụ và thợ riêng ở bước xác nhận.
                      </p>
                    </div>
                  ) : (
                    // Desktop/Tablet (màn hình >= 768px): Inline Stepper
                    <div className="p-4 bg-rose-50 rounded-md border border-rose-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-rose-900 uppercase tracking-wider">Đặt nhiều lịch (cùng khách, dịch vụ và thợ có thể khác nhau)</span>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-rose-950">Số lượng đơn:</span>
                          <div className="flex items-center bg-white border border-border rounded-md overflow-hidden shadow-sm">
                            <button
                              type="button"
                              className="w-8 h-8 bg-muted hover:bg-muted/80 text-foreground font-extrabold text-xs flex items-center justify-center border-r border-border cursor-pointer transition-colors"
                              onClick={() => setNumAppointments(Math.max(1, numAppointments - 1))}
                            >
                              −
                            </button>
                            <span className="text-sm font-bold text-foreground w-8 text-center select-none font-mono">
                              {numAppointments}
                            </span>
                            <button
                              type="button"
                              className="w-8 h-8 bg-muted hover:bg-muted/80 text-foreground font-extrabold text-xs flex items-center justify-center border-l border-border cursor-pointer transition-colors"
                              onClick={() => setNumAppointments(Math.min(10, numAppointments + 1))}
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleBookingSubmit}
                          disabled={numAppointments > 1 && previewAppointments.some(appt => appt.totalPrice > 0 && appt.assignedDepositAmount > appt.totalPrice)}
                          className="px-4 py-2.5 bg-[#B8860B] hover:bg-[#a0740a] disabled:opacity-50 text-white rounded-md text-xs font-bold cursor-pointer transition-all shadow-md flex items-center gap-1"
                        >
                          Tạo {numAppointments} đơn ngay →
                        </button>
                      </div>
                    </div>
                  )}

                  {numAppointments > 1 && previewAppointments.length > 0 && (
                    <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
                      <div>
                        <h4 className="text-sm font-bold text-amber-950">Thiết lập riêng từng đơn</h4>
                        <p className="text-[11px] text-amber-800/80">
                          Các đơn dùng chung khách hàng và ví cọc, nhưng dịch vụ và thợ được lưu độc lập.
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {previewAppointments.slice(0, numAppointments).map((appt, index) => {
                          const uniqueServiceIds = Array.from(new Set(appt.serviceIds as string[]));
                          return (
                            <div key={appt.id ?? index} className="bg-white rounded-md border border-amber-200 p-3 space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-black text-amber-950">Đơn {index + 1}</span>
                                {index > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => copyPreviewServicesFromFirst(index)}
                                    className="text-[10px] font-bold text-accent hover:underline"
                                  >
                                    Sao chép dịch vụ đơn 1
                                  </button>
                                )}
                              </div>

                              <label className="block space-y-1">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                  Thợ phụ trách
                                </span>
                                <select
                                  value={appt.staffId ?? ''}
                                  onChange={(e) => updatePreviewStaff(index, e.target.value)}
                                  className="w-full bg-white border border-border rounded-md px-3 py-2 text-sm"
                                >
                                  <option value="">Chưa phân công thợ</option>
                                  {staff.map(member => (
                                    <option key={member.id} value={member.id}>{member.name}</option>
                                  ))}
                                </select>
                              </label>

                              <div className="space-y-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                  Dịch vụ riêng
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {uniqueServiceIds.length === 0 ? (
                                    <span className="text-[11px] italic text-muted-foreground">Chưa chọn dịch vụ</span>
                                  ) : (
                                    uniqueServiceIds.map(serviceId => {
                                      const service = services.find(item => item.id === serviceId);
                                      const quantity = appt.serviceIds.filter((id: string) => id === serviceId).length;
                                      return (
                                        <span key={serviceId} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold">
                                          {service?.name ?? serviceId}{quantity > 1 ? ' ×' + quantity : ''}
                                          <button
                                            type="button"
                                            onClick={() => removePreviewService(index, serviceId)}
                                            className="text-muted-foreground hover:text-red-600"
                                            aria-label={'Bỏ ' + (service?.name ?? 'dịch vụ') + ' khỏi đơn ' + (index + 1)}
                                          >
                                            ×
                                          </button>
                                        </span>
                                      );
                                    })
                                  )}
                                </div>
                                <select
                                  value=""
                                  onChange={(e) => addPreviewService(index, e.target.value)}
                                  className="w-full bg-white border border-border rounded-md px-3 py-2 text-sm"
                                >
                                  <option value="">+ Thêm dịch vụ...</option>
                                  {services
                                    .filter(service => !appt.serviceIds.includes(service.id))
                                    .map(service => (
                                      <option key={service.id} value={service.id}>{service.name}</option>
                                    ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Component BottomSheet for Mobile */}
                  {showDuplicateSheet && (
                    <div 
                      className="fixed inset-0 z-[11000] bg-black/45 backdrop-blur-xs flex items-end justify-center animate-fade-in"
                      onClick={() => setShowDuplicateSheet(false)}
                    >
                      <div
                        className="w-full max-w-md bg-white rounded-t-xl p-6 pb-8 shadow-2xl animate-slide-up"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Drag Handle */}
                        <div className="w-10 h-1 bg-neutral-300 rounded mx-auto mb-4" />
                        
                        <h3 className="text-base font-bold text-neutral-800 text-center mb-0.5 font-sans">
                          Tạo nhiều lịch cho cùng khách
                        </h3>
                        <p className="text-[11px] text-neutral-500 text-center mb-4">
                          Thiết lập số lượng lịch hẹn móng trong nhóm
                        </p>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-muted p-4 rounded-md border border-border">
                            <span className="text-xs font-semibold text-neutral-700 font-sans">Số lượng đơn:</span>
                            
                            {/* Stepper */}
                            <div className="flex items-center bg-white border border-border rounded-md overflow-hidden shadow-sm">
                              <button
                                type="button"
                                className="w-10 h-10 bg-muted hover:bg-muted/80 text-foreground font-extrabold text-sm flex items-center justify-center border-r border-border cursor-pointer transition-colors"
                                onClick={() => setDuplicateCount(Math.max(1, duplicateCount - 1))}
                              >
                                −
                              </button>
                              <span className="text-sm font-bold text-foreground w-10 text-center select-none font-mono">
                                {duplicateCount}
                              </span>
                              <button
                                type="button"
                                className="w-10 h-10 bg-muted hover:bg-muted/80 text-foreground font-extrabold text-sm flex items-center justify-center border-l border-border cursor-pointer transition-colors"
                                onClick={() => setDuplicateCount(Math.min(10, duplicateCount + 1))}
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="w-full py-3 bg-accent hover:bg-accent text-accent-foreground text-white rounded-md font-bold text-sm transition-all shadow-md cursor-pointer flex items-center justify-center"
                            onClick={() => handleDuplicate(duplicateCount)}
                          >
                            Tạo {duplicateCount} đơn ngay →
                          </button>

                          <button
                            type="button"
                            className="w-full py-2.5 bg-muted hover:bg-muted text-foreground rounded-md font-bold text-xs transition-all cursor-pointer flex items-center justify-center"
                            onClick={() => setShowDuplicateSheet(false)}
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Booking Note Box */}
                  <div className="space-y-1">
                    <label className="block text-sm font-bold text-foreground uppercase tracking-wider mb-2">Ghi chú cuộc hẹn / Phong cách & Ghi nhớ khác</label>
                    <textarea
                      placeholder="Ghi chú thêm sở thích móng của khách (ví dụ: tháo móng xịn mịn, gắn charm đá lấp lánh, tone hồng đào nhạt...)"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full bg-card hover:bg-muted border border-border rounded-md p-3 text-sm text-foreground focus:bg-white transition-all placeholder:text-muted-foreground min-h-[60px]"
                    />
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-4 border-t border-border flex justify-between">
                    <button
                      type="button"
                      onClick={() => setActiveStep(2)}
                      className="px-5 py-2.5 bg-muted hover:bg-muted text-foreground rounded-md text-sm font-bold flex items-center gap-1 cursor-pointer transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" /> Quay lại
                    </button>
                    <button
                      type="submit"
                      onClick={handleBookingSubmit}
                      disabled={numAppointments > 1 && previewAppointments.some(appt => appt.totalPrice > 0 && appt.assignedDepositAmount > appt.totalPrice)}
                      className="px-5 py-2.5 bg-[#B8860B] hover:bg-[#a0740a] text-white rounded-md text-sm font-bold flex items-center gap-1 cursor-pointer transition-all shadow-md hover:shadow-lg disabled:opacity-50"
                    >
                      Xác nhận lưu đơn lịch móng ✓
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Staff Quick Action Modal Overlay for Non-Admins */}
      {selectedStaffAppt && (
        <div className="fixed inset-0 bg-muted/65 backdrop-blur-xs flex items-center justify-center z-[10000] p-4">
          <div className="bg-white rounded-lg border border-muted max-w-md w-full overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-5 border-b border-muted flex justify-between items-start bg-muted/10">
              <div>
                <span className="px-2 py-0.5 bg-muted text-accent text-[10px] font-bold rounded-md uppercase tracking-wider">Thao tác của nhân viên</span>
                <h3 className="font-serif text-lg font-bold text-foreground mt-1">Thông tin & Trạng thái đơn</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffAppt(null)}
                className="p-1 px-2.5 bg-muted hover:bg-muted text-muted-foreground rounded-full cursor-pointer text-sm font-semibold"
              >
                Đóng ×
              </button>
            </div>

            {/* Content inside expandable area */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-sm">
              {/* Customer Details info strip */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 p-3.5 bg-muted border border-muted/60 rounded-lg">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Khách hàng</p>
                  <h4 className="font-extrabold text-[15px] text-foreground leading-tight">
                    {selectedStaffAppt.customerName}
                  </h4>
                </div>
                <a
                  href={`tel:${selectedStaffAppt.customerPhone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[13px] font-black text-accent hover:underline inline-flex items-center gap-1 font-mono bg-white border border-border p-1.5 px-2.5 rounded-lg shadow-sm"
                >
                  <Phone className="w-3.5 h-3.5 text-accent shrink-0 fill-current" />
                  <span>{selectedStaffAppt.customerPhone}</span>
                </a>
              </div>

              {/* Date, Time and Services breakdown */}
              <div className="space-y-3 p-3.5 bg-card hover:bg-muted rounded-lg border border-border text-sm">
                <div className="flex justify-between items-center text-foreground">
                  <span className="font-semibold text-muted-foreground">Khung giờ:</span>
                  <span className="font-mono font-bold bg-muted border border-border text-accent px-2 py-0.5 rounded-lg text-[11px]">{selectedStaffAppt.time} • {selectedStaffAppt.date}</span>
                </div>
                
                <div className="flex justify-between items-center text-foreground border-t border-dashed border-border pt-2.5">
                  <span className="font-semibold text-muted-foreground">Tạm tính:</span>
                  <span className="font-mono font-black text-foreground text-sm">{selectedStaffAppt.totalPrice.toLocaleString()}đ</span>
                </div>

                <div className="border-t border-dashed border-border pt-2.5">
                  <span className="font-bold text-muted-foreground block mb-1">Dịch vụ chính:</span>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries((selectedStaffAppt.serviceIds || []).reduce((acc, sId) => {
                      acc[sId] = (acc[sId] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)).map(([srvId, qty]) => {
                      const srv = services.find(s => s.id === srvId);
                      const count = qty as number;
                      return srv ? (
                        <span key={srvId} className="px-2.5 py-1 bg-white border border-border text-foreground text-[10px] font-bold rounded-lg shadow-sm">
                          {srv.name} {count > 1 ? `(x${count})` : ''}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>

                {/* Extra services */}
                {selectedStaffAppt.extraServices && selectedStaffAppt.extraServices.length > 0 && (
                  <div className="border-t border-dashed border-border pt-2.5 space-y-1">
                    <span className="font-bold text-accent block">Dịch vụ phát sinh ngoài:</span>
                    {selectedStaffAppt.extraServices.map((es, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[11px] bg-white p-1.5 px-2.5 border border-border rounded-lg">
                        <span className="text-foreground font-medium">⚡ {es.name}</span>
                        <span className="font-mono font-extrabold text-accent">{es.price.toLocaleString()}đ</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Deposit Prepayment Configuration Section */}
              <div className="p-3.5 bg-sky-50 border border-sky-100 rounded-lg space-y-2.5 text-sm">
                <span className="font-extrabold text-sky-800 flex items-center gap-1.5 text-[12px]">
                  🛡️ Cấu hình sử dụng cọc (Ví)
                </span>
                <div className="space-y-1 text-sky-900 text-[12.5px]">
                  <div className="flex justify-between items-center">
                    <span>Yêu cầu sử dụng cọc:</span>
                    <strong className="px-2 py-0.5 rounded-md bg-white border border-sky-200 text-sky-800 uppercase text-[10px] font-black">
                      {selectedStaffAppt.useDeposit !== false ? 'Có (Sử dụng)' : 'Không (Không dùng)'}
                    </strong>
                  </div>
                  {selectedStaffAppt.useDeposit !== false && (
                    <div className="flex justify-between items-center border-t border-sky-100/60 pt-1.5 mt-1.5">
                      <span>Dự kiến trừ ví khi hoàn thành:</span>
                      <strong className="font-mono text-[13.5px] text-sky-800">
                        {(() => {
                          const apptCustomer = findCustomerById(customers, selectedStaffAppt.customerId);
                          const balance = apptCustomer ? (apptCustomer.walletBalance || 0) : 0;
                          const expected = selectedStaffAppt.assignedDepositAmount !== undefined && selectedStaffAppt.assignedDepositAmount !== null
                            ? selectedStaffAppt.assignedDepositAmount
                            : Math.min(balance, selectedStaffAppt.totalPrice);
                          return expected.toLocaleString();
                        })()}đ
                      </strong>
                    </div>
                  )}
                  {selectedStaffAppt.useDeposit !== false && (
                    <div className="flex justify-between items-center text-[11px] text-sky-600">
                      <span>Số dư ví khách hiện tại:</span>
                      <span className="font-mono font-bold">
                        {(() => {
                          const apptCustomer = findCustomerById(customers, selectedStaffAppt.customerId);
                          return (apptCustomer ? (apptCustomer.walletBalance || 0) : 0).toLocaleString();
                        })()}đ
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Note Section (NON TRUNCATED, FULLY DISPLAYED) */}
              <div className="p-3.5 bg-muted/40 border border-muted/50 rounded-lg space-y-2 text-sm">
                <span className="font-extrabold text-accent flex items-center gap-1.5 text-[12px]">📝 Ghi chú chi tiết đơn lịch móng</span>
                
                {editingNoteApptId === selectedStaffAppt.id ? (
                  <div className="space-y-2 mt-1 bg-white p-2 rounded-md border border-border">
                    <textarea
                      value={tempNoteText}
                      onChange={(e) => setTempNoteText(e.target.value)}
                      placeholder="Nhập ghi chú móng của khách hàng..."
                      rows={3}
                      className="w-full bg-card hover:bg-muted border border-border rounded-lg p-2 text-sm focus:outline-hidden focus:bg-white focus:border-accent"
                    />
                    <div className="flex gap-1.5 justify-end">
                      <button
                        type="button"
                        onClick={() => setEditingNoteApptId(null)}
                        className="px-2.5 py-1 bg-muted border border-border rounded-lg text-[10px] cursor-pointer"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateAppointment?.(selectedStaffAppt.id, { notes: tempNoteText });
                          selectedStaffAppt.notes = tempNoteText;
                          setEditingNoteApptId(null);
                        }}
                        className="px-3 py-1 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-lg text-[10px] font-bold cursor-pointer"
                      >
                        Lưu ghi chú
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="italic text-foreground bg-white border border-border/60 p-3 rounded-md break-words whitespace-pre-wrap leading-relaxed font-semibold">
                      {selectedStaffAppt.notes || "Không có phản hồi ghi chú dịch vụ nào thêm từ khách."}
                    </p>
                    
                    {/* Allow assigned staff to edit the note */}
                    {selectedStaffAppt.staffId === currentUser?.staffId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNoteApptId(selectedStaffAppt.id);
                          setTempNoteText(selectedStaffAppt.notes || "");
                        }}
                        className="text-accent font-black underline text-[11px] hover:text-accent cursor-pointer block pl-0.5"
                      >
                        ✏️ Thay đổi ghi chú phục vụ móng
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Actions Panel */}
            <div className="p-5 border-t border-muted bg-card hover:bg-muted/50 space-y-3">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Các thao tác trên đơn:</span>
              
              {selectedStaffAppt.staffId === currentUser?.staffId ? (
                selectedStaffAppt.status !== 'completed' && selectedStaffAppt.status !== 'cancelled' ? (
                  isAwaitingPayment(selectedStaffAppt) ? (
                    <div className={`rounded-xl border p-4 ${
                      isTransferPending(selectedStaffAppt)
                        ? 'border-sky-200 bg-sky-50'
                        : 'border-amber-200 bg-amber-50'
                    }`}>
                      <div className="flex items-start gap-3 text-left">
                        <div className={`rounded-lg p-2 ${
                          isTransferPending(selectedStaffAppt)
                            ? 'bg-sky-100 text-sky-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {isTransferPending(selectedStaffAppt)
                            ? <QrCode className="h-5 w-5" />
                            : <Banknote className="h-5 w-5" />}
                        </div>
                        <div>
                          <p className="text-sm font-extrabold text-foreground">
                            {getAwaitingPaymentLabel(selectedStaffAppt)}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {isTransferPending(selectedStaffAppt)
                              ? 'Hệ thống sẽ tự hoàn tất bill khi nhận đúng giao dịch.'
                              : 'Bạn vẫn có thể xem thông tin khách hoặc rút yêu cầu để sửa bill.'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openWithdrawRequest(selectedStaffAppt)}
                        className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-3 text-sm font-extrabold text-rose-700 shadow-sm transition-all hover:bg-rose-50 active:scale-[0.98]"
                      >
                        <Undo2 className="h-4 w-4" />
                        {getWithdrawRequestLabel(selectedStaffAppt)}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          openCheckoutForAppointment(selectedStaffAppt);
                          setSelectedStaffAppt(null);
                        }}
                        className="w-full p-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-bold shadow-sm cursor-pointer hover:scale-[1.01] active:scale-95 transition-all text-center"
                      >
                        🧾 Xác nhận & Chốt Bill
                      </button>
                    </div>
                  )
                ) : (
                  <p className="text-muted-foreground italic font-medium text-center py-2 bg-muted border border-border rounded-md text-sm">[ Đơn hẹn móng này đã kết thúc ]</p>
                )
              ) : (
                /* Unclaimed or claimed by another worker */
                !selectedStaffAppt.staffId && selectedStaffAppt.status === 'pending' && currentUser?.role === 'staff' ? (
                  <button
                    type="button"
                    onClick={() => {
                        if (currentUser?.staffId) {
                          onClaimAppointment?.(selectedStaffAppt.id, currentUser.staffId, currentUser.name);
                        }
                    }}
                    className="w-full p-3 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-md text-sm font-black uppercase tracking-wider text-center shadow-md active:scale-95 transition-all cursor-pointer"
                  >
                    💅 Nhận lịch móng này ngay
                  </button>
                ) : (
                  <div className="p-3 bg-muted border border-border rounded-md text-muted-foreground text-[11px] italic text-center font-bold">
                    Lịch này đã được gán cho thợ khác: <strong className="text-accent not-italic">{selectedStaffAppt.staffName || 'Chưa gán'}</strong>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit Appointment Modal Overlay */}
      {editingAppt && (
        <div className="fixed inset-0 bg-muted/65 backdrop-blur-xs flex items-center justify-center z-[9999] p-4 overflow-y-auto">
          <div className="bg-white rounded-lg border border-muted max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 md:p-8 space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <span className="px-2 py-0.5 bg-muted text-accent text-[10px] font-bold rounded-md uppercase tracking-wider">Mục dành cho quản trị viên</span>
                <h3 className="font-serif text-2xl font-bold text-foreground mt-1">Chỉnh sửa đơn hàng phát sinh</h3>
                <p className="text-sm text-muted-foreground">Cho phép thay đổi bất kỳ thông tin nào khi có phát sinh ngoài ý muốn</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingAppt(null)}
                className="p-1 bg-muted hover:bg-muted text-muted-foreground rounded-full cursor-pointer text-sm font-semibold px-2.5"
              >
                Đóng ×
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-6">
              {/* Customer Readonly Info Box */}
              <div className="p-4 bg-card hover:bg-muted border border-border rounded-lg flex justify-between items-center flex-wrap gap-3">
                <div>
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Khách hàng đặt</span>
                  <h4 className="font-serif font-bold text-foreground text-base">{editingAppt.customerName}</h4>
                  <p className="font-mono text-sm text-muted-foreground">{editingAppt.customerPhone}</p>
                </div>
                <div className="text-right">
                  <span className="text-[9px] text-accent uppercase tracking-wider font-bold block mb-1">Mã cuộc hẹn</span>
                  <span className="bg-background border border-border text-accent font-mono text-sm font-bold px-2 py-1 rounded-lg">
                    {editingAppt.id}
                  </span>
                </div>
              </div>

              {/* Staff and Status and Timing block */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-foreground uppercase tracking-wider mb-1.5">Trạng thái đơn</label>
                  <select
                    value={editStatus}
                    disabled={currentUser?.role !== 'admin'}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="w-full bg-card hover:bg-muted border border-border rounded-md px-3.5 py-2.5 text-sm text-foreground font-bold focus:bg-white disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    <option value="pending">Hẹn sắp tới (Pending)</option>
                    <option value="completed">Đã hoàn thành & thanh toán (Completed)</option>
                    <option value="cancelled" disabled={!!editStaffId && currentUser?.role !== 'admin'}>
                      Đã hủy lịch hẹn (Cancelled) {(editStaffId && currentUser?.role !== 'admin') ? '⚠️ [Đã có thợ nhận]' : ''}
                    </option>
                  </select>
                  {editStaffId && currentUser?.role !== 'admin' && (
                    <p className="text-[10px] text-accent font-bold mt-1.5 leading-normal">
                      ⚠️ Đơn đã được giao/nhận bởi thợ, không được hủy trạng thái cho đến khi hoàn thành.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-foreground uppercase tracking-wider mb-1.5">Thợ phụ trách</label>
                  <select
                    value={editStaffId}
                    onChange={(e) => setEditStaffId(e.target.value)}
                    className="w-full bg-card hover:bg-muted border border-border rounded-md px-3.5 py-2.5 text-sm text-foreground focus:bg-white"
                  >
                    <option value="">-- Chưa phân công --</option>
                    {staff.filter(s => !isStaffSupport(s)).map(s => (
                       <option key={s.id} value={s.id}>{s.name} - {s.role}</option>
                     ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-foreground uppercase tracking-wider mb-1.5">Ngày làm</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full bg-card hover:bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-foreground uppercase tracking-wider mb-1.5">Mốc giờ</label>
                  <input
                    type="time"
                    required
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="w-full bg-card hover:bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:bg-white"
                  />
                </div>
              </div>

              {/* Multiselect checkboxes for services with category filter and search bar */}
              <div className="space-y-3 p-4 bg-card hover:bg-muted/40 rounded-lg border border-border/60 shadow-sm">
                <div className="flex flex-col gap-2.5">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <label className="block text-sm font-semibold text-foreground uppercase tracking-wider">Chỉnh sửa dịch vụ đã làm</label>
                    {editServices.length > 0 && (
                      <span className="text-[10px] bg-foreground text-background text-white font-bold px-2 py-0.5 rounded-full shadow-sm">
                        Đã chọn {editServices.length} dịch vụ
                      </span>
                    )}
                  </div>
                  
                  {/* Category Filter and Search bar for Admin Edit */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Tìm kiếm dịch vụ..."
                        value={editServiceSearch}
                        onChange={(e) => setEditServiceSearch(e.target.value)}
                        className="w-full bg-white border border-border rounded-md pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-muted transition-all font-sans shadow-sm"
                      />
                    </div>
                    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none shrink-0">
                      {[
                        { id: 'all', label: 'Tất cả' },
                        { id: 'basic-nail', label: 'Cơ bản' },
                        { id: 'fake-nail', label: 'Móng giả' },
                        { id: 'design', label: 'Vẽ/Design' },
                        { id: 'accessories', label: 'Charm/Đá' }
                      ].map(tab => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setEditServiceCategory(tab.id as any)}
                          className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer border ${
                            editServiceCategory === tab.id
                              ? 'bg-foreground text-background hover:bg-foreground text-background border-border text-white shadow-sm font-bold'
                              : 'bg-white hover:bg-card hover:bg-muted border-border text-muted-foreground'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[180px] overflow-y-auto p-1 scrollbar-thin">
                  {services
                    .filter(srv => {
                      if (editServiceCategory !== 'all' && srv.category !== editServiceCategory) return false;
                      if (editServiceSearch) {
                        const q = editServiceSearch.toLowerCase();
                        return srv.name.toLowerCase().includes(q);
                      }
                      return true;
                    })
                    .map(srv => {
                      const isChecked = editServices.includes(srv.id);
                      return (
                        <div
                          key={srv.id}
                          onClick={() => toggleEditService(srv.id)}
                          className={`p-2.5 rounded-md border cursor-pointer flex flex-col justify-between transition-all ${
                            isChecked
                              ? 'bg-muted/60 border-accent shadow-sm'
                              : 'bg-white hover:bg-background/50 border-border'
                          }`}
                        >
                          <div className="flex justify-between items-start w-full">
                            <div className="space-y-0.5">
                              <p className="font-semibold text-sm text-foreground leading-snug">{srv.name}</p>
                            </div>
                            <div className="text-right flex flex-col items-end shrink-0 pl-2">
                              <div className={`mt-1.5 h-4 w-4 rounded-full border flex items-center justify-center transition-all ${
                                isChecked ? 'border-border bg-foreground text-background text-white shadow-sm' : 'border-border bg-white'
                              }`}>
                                {isChecked && <span className="text-[9px] font-black">✓</span>}
                              </div>
                            </div>
                          </div>

                          {isChecked && isPerItemService(srv) && (
                            <div 
                              onClick={(e) => e.stopPropagation()} 
                              className="mt-2 pt-2 border-t border-rose-250/30 flex justify-between items-center w-full animate-fade-in"
                            >
                              <span className="text-[10px] text-muted-foreground font-medium font-sans">Số lượng ({getServiceUnit(srv)}):</span>
                              <div className="flex items-center gap-1 bg-white border border-border rounded-lg p-0.5 shadow-sm">
                                <button
                                  type="button"
                                  onClick={() => updateEditQuantity(srv.id, (editQuantities[srv.id] || 1) - 1)}
                                  className="w-5 h-5 flex items-center justify-center text-sm font-black text-accent hover:bg-muted rounded select-none cursor-pointer"
                                >
                                  -
                                </button>
                                <span className="w-8 text-center text-sm font-bold text-foreground font-mono">
                                  {editQuantities[srv.id] || 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateEditQuantity(srv.id, (editQuantities[srv.id] || 1) + 1)}
                                  className="w-5 h-5 flex items-center justify-center text-sm font-black text-accent hover:bg-muted rounded select-none cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                  {services.filter(srv => {
                    if (editServiceCategory !== 'all' && srv.category !== editServiceCategory) return false;
                    if (editServiceSearch) {
                      return srv.name.toLowerCase().includes(editServiceSearch.toLowerCase());
                    }
                    return true;
                  }).length === 0 && (
                    <div className="col-span-full py-8 text-center text-muted-foreground text-sm italic">
                      Không tìm thấy dịch vụ nào phù hợp với bộ lọc!
                    </div>
                  )}
                </div>
              </div>

              {/* Price adjustment (for expected or unexpected issues) */}
              <div className="p-4 bg-background border border-border rounded-lg">
                <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                  <label className="block text-sm font-extrabold text-accent uppercase tracking-wider">
                    Tổng chi phí thanh toán (Có thể Chỉnh Sửa Tự Do)
                  </label>
                  <button
                    type="button"
                    onClick={handleRecalculateEditPrice}
                    className="text-[10px] font-bold text-accent hover:text-accent bg-white border border-border px-2 py-1 rounded-lg transition-all cursor-pointer shadow-sm min-h-[44px] touch-manipulation"
                    title="Tính lại tổng tiền dựa trên các dịch vụ cơ bản và phát sinh hiện tại"
                  >
                    ♻️ Tính lại tự động
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    required
                    min="0"
                    value={editPrice}
                    onChange={(e) => setEditPrice(Number(e.target.value))}
                    className="w-full bg-white border border-border rounded-md px-4 py-3 font-mono text-accent text-lg font-bold focus:outline-hidden focus:ring-1 focus:ring-rose-400"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-muted-foreground text-sm">VND</span>
                </div>
                <p className="text-[10.5px] text-muted-foreground mt-1.5 italic">
                  * Ghi chú: Admin được quyền sửa số tiền này tùy thuộc vào các chiết khấu thực tế, tháo móng cũ hay tip cho thợ.
                </p>
              </div>

              {/* Giữ cọc / Khấu trừ cọc option for Admin Edit Appointment Form */}
              {(() => {
                const editCustomerObj = findCustomerById(customers, editingAppt.customerId);
                const walletBalance = editCustomerObj?.walletBalance ?? 0;
                if (walletBalance <= 0) return null;
                return (
                  <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-150 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-blue-900 flex items-center gap-1.5">
                        💰 Tiền cọc đã đặt:
                      </span>
                      <span className="font-mono font-extrabold text-blue-700 bg-blue-100/50 px-2.5 py-1 rounded-lg border border-blue-200">
                        {walletBalance.toLocaleString()}đ
                      </span>
                    </div>
                    
                    <div className="space-y-2">
                      <span className="text-[11px] font-bold text-blue-800 uppercase tracking-wide block">
                        Xử lý cọc lần này:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex items-center gap-2.5 p-2.5 bg-white rounded-md border border-blue-100 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="radio"
                            name="editUseDeposit"
                            checked={editUseDeposit === true}
                            onChange={() => setEditUseDeposit(true)}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <span className="block text-sm font-semibold text-gray-900">Khấu trừ vào bill</span>
                            <span className="block text-[10px] text-muted-foreground mt-0.5">Khấu trừ khi thanh toán</span>
                          </div>
                        </label>

                        <label className="flex items-center gap-2.5 p-2.5 bg-white rounded-md border border-blue-100 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="radio"
                            name="editUseDeposit"
                            checked={editUseDeposit === false}
                            onChange={() => setEditUseDeposit(false)}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <span className="block text-sm font-semibold text-gray-900">Giữ cọc cho lần sau (ngoại lệ)</span>
                            <span className="block text-[10px] text-muted-foreground mt-0.5">Giữ lại cọc trong tài khoản</span>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Special Notes (Notes) */}
              <div>
                <label className="block text-sm font-semibold text-foreground uppercase tracking-wider mb-1.5">Ghi chú phát sinh / Lý do thay đổi</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  placeholder="Nhập lý do thay đổi hoặc ghi chú về hóa đơn phát sinh..."
                  className="w-full bg-card hover:bg-muted border border-border rounded-md p-3 text-sm text-foreground focus:bg-white"
                />
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingAppt(null)}
                  className="px-5 py-2.5 bg-muted hover:bg-muted text-foreground text-sm font-bold rounded-md cursor-pointer transition-all"
                >
                  Bỏ qua
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white text-sm font-bold rounded-md transition-all shadow-md cursor-pointer min-h-[44px] touch-manipulation"
                >
                  Save Thay Đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDuplicateNameWarning && (
        <div
          className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-name-title"
        >
          <div className="w-full max-w-md rounded-lg border border-amber-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-amber-100 p-2 text-amber-700">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h3 id="duplicate-name-title" className="font-serif text-lg font-bold text-foreground">
                  Kiểm tra khách trùng tên
                </h3>
                <p className="text-sm leading-relaxed text-foreground">
                  Đã có <strong>{matchingCustomersByName.length}</strong> hồ sơ cùng tên “<strong>{newCustName.trim()}</strong>”.
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Khách mới chưa được tạo và chưa liên kết ví cọc. Hãy quay lại tìm khách cũ nếu đây có thể là cùng một người.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDuplicateNameWarning(false)}
                className="min-h-[44px] rounded-md border border-border bg-white px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
              >
                Quay lại kiểm tra
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDuplicateNameWarning(false);
                  setActiveStep(2);
                }}
                className="min-h-[44px] rounded-md bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-amber-700"
              >
                Vẫn tạo khách mới
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoomed Receipt Overlay Modal */}
      {zoomedReceiptUrl && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-muted/90 backdrop-blur-md p-4 md:p-8 animate-fade-in transition-all"
          onClick={() => setZoomedReceiptUrl(null)}
        >
          {/* Close button in top right */}
          <button
            type="button"
            className="absolute top-4 right-4 text-white hover:text-accent bg-white/10 hover:bg-white/20 p-2.5 rounded-full cursor-pointer transition-all flex items-center justify-center shadow-lg border border-white/10 z-50 hover:scale-105 active:scale-95 min-h-[44px] touch-manipulation"
            onClick={() => setZoomedReceiptUrl(null)}
            title="Đóng (Close)"
            style={{ minHeight: '44px', minWidth: '44px' }}
          >
            <X className="w-6 h-6" />
          </button>

          <div className="relative max-w-full max-h-[85vh] flex flex-col items-center justify-center p-2" onClick={(e) => e.stopPropagation()}>
            <img 
              src={zoomedReceiptUrl} 
              alt="Hóa đơn phóng to" 
              className="max-w-full max-h-[75vh] md:max-h-[80vh] object-contain rounded-lg border-4 border-white/10 shadow-2xl select-none"
            />
            <div 
              className="mt-4 text-center text-white text-sm font-semibold bg-muted/80 px-5 py-2.5 rounded-full border border-border shadow-md flex items-center gap-2 select-none animate-bounce"
              style={{ fontFamily: 'Nunito, sans-serif' }}
            >
              <span>✨ Nhấp bất kỳ đâu bên ngoài hoặc nút đóng để quay lại</span>
            </div>
          </div>
        </div>
      )}

      {billFeedback && (
        <div
          role="status"
          className={`fixed bottom-4 left-4 right-4 z-[10030] mx-auto flex max-w-md items-start gap-3 rounded-xl border bg-white p-4 shadow-2xl sm:left-auto sm:right-5 ${
            billFeedback.type === 'success'
              ? 'border-emerald-200 text-emerald-900'
              : 'border-rose-200 text-rose-900'
          }`}
        >
          {billFeedback.type === 'success'
            ? <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />}
          <p className="flex-1 text-sm font-semibold leading-relaxed">{billFeedback.message}</p>
          <button
            type="button"
            onClick={() => setBillFeedback(null)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Đóng thông báo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {withdrawRequestAppt && (
        <div
          className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          onClick={closeWithdrawRequest}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-bill-title"
            className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-rose-50 p-3 text-rose-700">
                <Undo2 className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="withdraw-bill-title" className="font-serif text-xl font-bold text-foreground">
                  {getPaymentTransactionAppointments(withdrawRequestAppt).length > 1
                    ? 'Mở lại toàn bộ bill nhóm?'
                    : currentUser?.role === 'admin'
                    ? 'Trả bill về để chỉnh sửa?'
                    : isTransferPending(withdrawRequestAppt)
                    ? 'Hủy phiên chuyển khoản?'
                    : 'Rút yêu cầu duyệt bill?'}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {getPaymentTransactionAppointments(withdrawRequestAppt).length > 1
                    ? `Toàn bộ ${getPaymentTransactionAppointments(withdrawRequestAppt).length} bill trong giao dịch sẽ quay lại trạng thái đang xử lý. Không bill nào trong nhóm được giữ ở trạng thái chờ duyệt.`
                    : currentUser?.role === 'admin'
                    ? 'Bill sẽ quay lại trạng thái đang xử lý để thợ có thể chỉnh giá, dịch vụ hoặc phương thức thanh toán.'
                    : isTransferPending(withdrawRequestAppt)
                    ? 'Mã thanh toán hiện tại sẽ bị hủy và bill được mở lại để bạn chỉnh sửa.'
                    : 'Bill sẽ quay lại trạng thái đang xử lý để bạn chỉnh giá, dịch vụ hoặc phương thức thanh toán.'}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-muted/50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-base font-extrabold text-foreground">
                    {withdrawRequestAppt.customerName}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {withdrawRequestAppt.customerPhone || 'Chưa có SĐT'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-muted-foreground">Tổng bill</p>
                  <p className="font-mono text-base font-extrabold text-foreground">
                    {getPaymentTransactionTotals(withdrawRequestAppt).billTotal > 0
                      ? `${getPaymentTransactionTotals(withdrawRequestAppt).billTotal.toLocaleString()}đ`
                      : 'Chưa chốt giá'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm font-semibold text-foreground">
                {isTransferPending(withdrawRequestAppt)
                  ? <QrCode className="h-4 w-4 text-sky-700" />
                  : <Banknote className="h-4 w-4 text-amber-800" />}
                {isTransferPending(withdrawRequestAppt) ? 'Chuyển khoản QR' : 'Tiền mặt'}
              </div>
              {getPaymentTransactionAppointments(withdrawRequestAppt).length > 1 && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                  <span>{getPaymentTransactionAppointments(withdrawRequestAppt).length} bill trong nhóm</span>
                  <strong className="font-mono text-emerald-700">Cần thu {getPaymentTransactionTotals(withdrawRequestAppt).cashTotal.toLocaleString()}đ</strong>
                </div>
              )}
            </div>

            {withdrawRequestError && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
                {withdrawRequestError}
              </div>
            )}

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={closeWithdrawRequest}
                disabled={isWithdrawingRequest}
                className="min-h-[50px] rounded-xl border border-border bg-white px-4 py-3 text-sm font-bold text-foreground transition-all hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                Quay lại
              </button>
              <button
                type="button"
                onClick={confirmWithdrawRequest}
                disabled={isWithdrawingRequest}
                className="flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-extrabold text-white shadow-md transition-all hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isWithdrawingRequest ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang xử lý...
                  </>
                ) : (
                  <>
                    <Undo2 className="h-4 w-4" />
                    {currentUser?.role === 'admin'
                      ? 'Trả về chỉnh sửa'
                      : getWithdrawRequestLabel(withdrawRequestAppt)}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Large action confirmation overlay. Appointment details stay in the underlying detail card. */}
      {(quickCompleteId || quickCancelId || confirmApproveId || confirmCancelRequestId) && (() => {
        const actionAppointmentId = quickCompleteId || quickCancelId || confirmApproveId || confirmCancelRequestId;
        const actionAppointment = appointments.find(appt => appt.id === actionAppointmentId);
        if (!actionAppointment) return null;

        const isCompleteAction = quickCompleteId === actionAppointment.id;
        const isApproveAction = confirmApproveId === actionAppointment.id;
        const isCancelRequestAction = confirmCancelRequestId === actionAppointment.id;
        const isCancelAction = quickCancelId === actionAppointment.id || isCancelRequestAction;
        const paymentActionSummary = getPaymentTransactionTotals(actionAppointment);
        const isGroupPaymentApproval = isApproveAction && paymentActionSummary.items.length > 1;
        const depositToRefund = Math.max(
          0,
          Number(actionAppointment.depositAmount || actionAppointment.assignedDepositAmount || 0)
        );

        const closeActionOverlay = () => {
          setQuickCompleteId(null);
          setQuickCancelId(null);
          setConfirmApproveId(null);
          setConfirmCancelRequestId(null);
        };

        const finishCancellation = (refundDeposit: boolean) => {
          handleCancelAppointment(actionAppointment, refundDeposit, () => {
            if (isCancelRequestAction) {
              onUpdateAppointment?.(actionAppointment.id, { pendingStatusApproval: "" as any });
            }
            closeActionOverlay();
          });
        };

        return (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-[10001] p-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-border max-w-lg w-full shadow-2xl p-6 sm:p-8 space-y-6">
              <div className="flex items-center justify-center">
                <div className={`p-4 rounded-full ${
                  isCancelAction ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                }`}>
                  {isCancelAction
                    ? <XCircle className="w-9 h-9" />
                    : <CheckCircle className="w-9 h-9" />}
                </div>
              </div>

              <h3 className="font-serif text-2xl font-bold text-foreground text-center">
                {isCancelAction
                  ? (isCancelRequestAction ? 'Duyệt yêu cầu hủy đơn?' : 'Bạn muốn xử lý cọc thế nào?')
                  : (isApproveAction
                    ? isGroupPaymentApproval ? 'Xác nhận đã thu đủ tiền mặt cho cả nhóm?' : 'Xác nhận đã thu đủ tiền mặt?'
                    : 'Xác nhận hoàn thành đơn?')}
              </h3>

              {isApproveAction && (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/70 p-4">
                  <div className="flex items-center justify-between gap-4 border-b border-emerald-200 pb-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Phạm vi phê duyệt</p>
                      <p className="mt-1 font-extrabold text-foreground">{paymentActionSummary.items.length} bill · {actionAppointment.customerName}</p>
                    </div>
                    <p className="text-right font-mono text-xl font-black text-emerald-700">{paymentActionSummary.cashTotal.toLocaleString()}đ</p>
                  </div>
                  <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">
                    {paymentActionSummary.items.map((item, index) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-semibold">{index + 1}. {getApptServicesString(item)} · {item.staffName || 'Chưa rõ thợ'}</span>
                        <strong className="shrink-0 font-mono">{Number(item.paymentAllocatedAmount ?? item.amountDue ?? item.totalPrice ?? 0).toLocaleString()}đ</strong>
                      </div>
                    ))}
                  </div>
                  {paymentActionSummary.depositTotal > 0 && (
                    <p className="mt-3 text-right text-xs font-bold text-indigo-700">Cọc sẽ khấu trừ: {paymentActionSummary.depositTotal.toLocaleString()}đ</p>
                  )}
                </div>
              )}

              {isCancelAction ? (
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={() => finishCancellation(true)}
                    className="w-full min-h-[58px] px-5 py-3.5 bg-rose-600 hover:bg-rose-700 text-white text-base font-extrabold rounded-xl shadow-md cursor-pointer transition-all active:scale-[0.98]"
                  >
                    Hủy đơn & hoàn cọc{depositToRefund > 0 ? ` ${depositToRefund.toLocaleString()}đ` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => finishCancellation(false)}
                    className="w-full min-h-[58px] px-5 py-3.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-250 text-base font-extrabold rounded-xl cursor-pointer transition-all active:scale-[0.98]"
                  >
                    Hủy đơn & không hoàn cọc
                  </button>
                  <button
                    type="button"
                    onClick={closeActionOverlay}
                    className="w-full min-h-[52px] px-5 py-3 bg-muted hover:bg-muted/80 text-foreground border border-border text-sm font-bold rounded-xl cursor-pointer transition-all"
                  >
                    Quay lại
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={closeActionOverlay}
                    className="min-h-[56px] px-5 py-3 bg-muted hover:bg-muted/80 text-foreground border border-border text-sm font-bold rounded-xl cursor-pointer transition-all sm:order-1"
                  >
                    Quay lại
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isApproveAction) {
                        handleAdminApprovePayment(actionAppointment);
                      } else if (isCompleteAction) {
                        openCheckoutForAppointment(actionAppointment);
                        closeActionOverlay();
                      }
                    }}
                    className="min-h-[56px] px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-extrabold rounded-xl shadow-md cursor-pointer transition-all active:scale-[0.98] sm:order-2"
                  >
                    {isApproveAction ? isGroupPaymentApproval ? 'Duyệt toàn bộ nhóm' : 'Duyệt và hoàn tất' : 'Xác nhận hoàn thành'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Legacy action confirmation overlay */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-[10001] p-4 animate-fade-in">
          <div className="bg-white rounded-lg border border-border max-w-md w-full shadow-2xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-full shrink-0 ${confirmAction.type === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                {confirmAction.type === 'completed' ? <CheckCircle className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
              </div>
              <div className="space-y-1">
                <h3 className="font-serif text-lg font-bold text-foreground">
                  {confirmAction.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {confirmAction.description}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 bg-muted hover:bg-muted text-foreground text-xs font-bold rounded-md cursor-pointer transition-all border border-border min-h-[40px]"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={confirmAction.onConfirm}
                className={`px-4.5 py-2 text-white text-xs font-bold rounded-md transition-all shadow-md cursor-pointer min-h-[40px] ${
                  confirmAction.type === 'completed' 
                    ? 'bg-emerald-600 hover:bg-emerald-700' 
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
