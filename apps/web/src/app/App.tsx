import React, { useState, useEffect, useRef } from 'react';
import { Customer, Staff, NailService, Appointment, StaffBonus, AdminAccount, TimeLog, SystemSettings, PromotionCode } from '@shared/types';

const INITIAL_SERVICES: NailService[] = [
  { id: 'srv_1', name: 'Sơn Trơn (Basic Polish)', category: 'basic-nail' },
  { id: 'srv_2', name: 'Úp Móng Thiết Kế (Nail Art Design)', category: 'design' },
  { id: 'srv_3', name: 'Đắp Gel Gắn Móng Giả (Gel Extension)', category: 'fake-nail' },
  { id: 'srv_4', name: 'Phụ Kiện Gắn Đá (Accessories Attachment)', category: 'accessories' }
];

const INITIAL_STAFF: Staff[] = [
  { id: 'staff_demo_1', name: 'Thợ mẫu', phone: '0900000001', role: 'Thợ Chính', commissionRate: 0.6, baseSalary: 200000, status: 'active' },
  { id: 'staff_demo_2', name: 'Hỗ trợ mẫu', phone: '0900000002', role: 'Support', commissionRate: 0.4, baseSalary: 150000, hourlyRate: 30000, status: 'active' }
];

const INITIAL_CUSTOMERS: Customer[] = [
  { id: 'cust_1', name: 'Chị Lan', phone: '0901234567', email: 'lan@gmail.com', totalVisits: 1, totalSpent: 150000, notes: 'Yêu thích tông màu đỏ rượu', createdAt: '2026-06-12', walletBalance: 50000 }
];

const INITIAL_APPOINTMENTS: Appointment[] = [];

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

export const POPULAR_BANKS = [
  { code: 'MB', name: 'MBBank (MB)' },
  { code: 'VCB', name: 'Vietcombank (VCB)' },
  { code: 'ICB', name: 'VietinBank (ICB)' },
  { code: 'BIDV', name: 'BIDV' },
  { code: 'TCB', name: 'Techcombank' },
  { code: 'KLB', name: 'KienlongBank (KLB)' },
  { code: 'ACB', name: 'ACB' },
  { code: 'VPB', name: 'VPBank' },
  { code: 'TPB', name: 'TPBank' },
  { code: 'STB', name: 'Sacombank' },
  { code: 'VBA', name: 'Agribank (VBA)' },
  { code: 'VIB', name: 'VIB' },
  { code: 'SHB', name: 'SHB' },
  { code: 'MSB', name: 'MSB' },
  { code: 'HDB', name: 'HDBank' },
  { code: 'LPB', name: 'LPBank' },
  { code: 'OCB', name: 'OCB' },
  { code: 'SEAB', name: 'SeABank' },
  { code: 'EIB', name: 'Eximbank' },
  { code: 'SCB', name: 'SCB' },
];

const AppointmentCalendar = React.lazy(() => import('@/features/appointments/AppointmentCalendar'));
const CustomerDirectory = React.lazy(() => import('@/features/customers/CustomerDirectory'));
const StaffPayroll = React.lazy(() => import('@/features/payroll/StaffPayroll'));
const ReportDashboard = React.lazy(() => import('@/features/reports/ReportDashboard'));
const ServiceManagement = React.lazy(() => import('@/features/services/ServiceManagement'));
const StaffManagement = React.lazy(() => import('@/features/staff/StaffManagement'));
import { LogOut, Cat, Calendar, Users, Wallet, BarChart3, Scissors, UserCog, Download, Upload, Database, Check, Trash2, Volume2, Settings, BellRing } from 'lucide-react';

import { 
  getDb, 
  initializeFirebase, 
  saveDocToCloud, 
  deleteDocFromCloud,
  clientSessionId,
  fetchCollectionFromCloud,
  syncCollectionToCloud,
  replaceCollectionFromCloud,
  triggerSyncSignal
} from '@/shared/lib/firebase';
import { collection, onSnapshot, doc, enableNetwork, query, where, orderBy, getDocs, getDoc, setDoc, Timestamp, runTransaction, increment, updateDoc } from 'firebase/firestore';
const MyIncomeView = React.lazy(() => import('@/features/payroll/MyIncomeView'));
import { calculatePayroll } from '@/features/payroll/salary';
import { playLoudNotificationSound } from '@/shared/utils/audio';
import { triggerPushNotification, requestNotificationPermission, getNotificationPermissionState, registerServiceWorkerAndSubscribe, showLocalNotificationOnly } from '@/shared/utils/notifications';
import { AuthenticatedUserSession, getAuthHeaders, readStoredSession } from '@/shared/lib/auth';

// Timezone-safe local ISO string formatting (YYYY-MM-DD)
const getLocalTodayStr = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Strips heavy fields such as base64 receiptImage and notes to safeguard localStorage space (avoiding QuotaExceededError)
const stripHeavyFields = (appts: Appointment[]): Appointment[] => {
  if (!appts || !Array.isArray(appts)) return [];
  return appts.map(a => {
    if (a.receiptImage) {
      const { receiptImage, ...rest } = a;
      return rest;
    }
    return a;
  });
};

const initialPromotionForm = { code: '', discountPercent: '10' };

function PromotionCodeManagement({ currentUser }: { currentUser: AuthenticatedUserSession }) {
  const [codes, setCodes] = useState<PromotionCode[]>([]);
  const [form, setForm] = useState(initialPromotionForm);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const response = await fetch('/api/promotion-codes?includeInactive=true', { headers: getAuthHeaders(currentUser) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không thể tải mã giảm giá');
    setCodes(data.codes || []);
  };

  useEffect(() => { load().catch(error => setMessage(error.message)); }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/promotion-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(currentUser) },
        body: JSON.stringify({
          ...form,
          code: form.code.toUpperCase(),
          discountPercent: Number(form.discountPercent)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể lưu mã giảm giá');
      setForm(initialPromotionForm);
      setMessage('Đã lưu mã giảm giá.');
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Không thể lưu mã giảm giá');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (code: PromotionCode) => {
    try {
      const response = await fetch(`/api/promotion-codes/${encodeURIComponent(code.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(currentUser) },
        body: JSON.stringify({ active: !code.active })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể cập nhật mã');
      await load();
    } catch (error: any) {
      setMessage(error.message || 'Không thể cập nhật mã');
    }
  };

  return (
    <div className="bg-background border border-border p-3 rounded-md space-y-3 mb-2">
      <div>
        <p className="text-[9px] font-bold text-accent font-mono uppercase tracking-wider">MÃ GIẢM GIÁ</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Mỗi bill dùng tối đa một mã. Hoa hồng thợ luôn tính trên giá trước giảm.</p>
      </div>
      <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm">
        <input required value={form.code} onChange={e => setForm(s => ({ ...s, code: e.target.value.toUpperCase() }))} placeholder="Ví dụ: NAIL10" className="rounded border border-border bg-white px-2 py-1.5 font-mono font-bold" />
        <input required type="number" min="1" max="100" value={form.discountPercent} onChange={e => setForm(s => ({ ...s, discountPercent: e.target.value }))} placeholder="% giảm" className="rounded border border-border bg-white px-2 py-1.5" />
        <button disabled={saving} className="col-span-2 rounded bg-accent py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Đang lưu...' : 'Thêm / cập nhật mã'}</button>
      </form>
      {message && <p className="text-xs font-semibold text-emerald-700">{message}</p>}
      <div className="space-y-1">
        {codes.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có mã giảm giá.</p> : codes.map(code => (
          <div key={code.id} className="flex items-center justify-between gap-2 rounded border border-border bg-white px-2 py-1.5 text-xs">
            <span><strong className="font-mono">{code.code}</strong> · Giảm {code.discountPercent}%</span>
            <button type="button" onClick={() => toggle(code)} className={`rounded px-2 py-1 font-bold ${code.active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{code.active ? 'Đang bật' : 'Đã tắt'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'calendar' | 'customers' | 'payroll' | 'reports' | 'services' | 'staff' | 'income'>('calendar');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminSectionExpanded, setIsAdminSectionExpanded] = useState(false);
  const [backupFiles, setBackupFiles] = useState<string[]>([]);
  const [selectedBackupFile, setSelectedBackupFile] = useState<string>('');

  // Fetch list of backups when settings is toggled open
  useEffect(() => {
    if (isSettingsOpen) {
      fetch("/api/backups/list", { headers: getAuthHeaders(readStoredSession()) })
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.files)) {
            setBackupFiles(data.files);
            if (data.files.length > 0) {
              setSelectedBackupFile(data.files[0]);
            }
          }
        })
        .catch(err => {
          console.error("Failed to fetch backups list:", err);
        });
    }
  }, [isSettingsOpen]);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(getNotificationPermissionState());
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({});

  // High-performance Session authenticating state
  const [currentUser, setCurrentUser] = useState<AuthenticatedUserSession | null>(() => readStoredSession());

  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    if (getNotificationPermissionState() === 'granted') {
      registerServiceWorkerAndSubscribe(currentUser?.role, currentUser?.name);
    }
  }, [currentUser?.role, currentUser?.name]);

  // Login form controller states
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Staff profile edit local states
  const [staffPhone, setStaffPhone] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const isDataLoadingRef = useRef(false);
  const notifiedTagsRef = useRef<Set<string>>(new Set<string>());
  const tempCustomerMappingsRef = useRef<Record<string, string>>({});
  const loadHistoricalRef = useRef<any>(null);

  const handleInvalidateHistoricalCache = async () => {
    localStorage.removeItem('nail_historical_appointments_cache_v2');
    localStorage.removeItem('nail_historical_appointments_cache_date_v2');
    localStorage.removeItem('nail_historical_appointments_last_sync_time');
    if (loadHistoricalRef.current) {
      await loadHistoricalRef.current(true);
    }
  };

  // Load business data only for an authenticated session. The login screen no
  // longer pays the Firestore/network cost of the entire application.
  useEffect(() => {
    if (!currentUser?.token) return;
    // Prevent double execution in React Strict Mode
    if (isDataLoadingRef.current) return;
    isDataLoadingRef.current = true;

    // Make sure Firebase is initialized correctly
    initializeFirebase();
    
    const db = getDb();
    if (!db) {
      isDataLoadingRef.current = false;
      return;
    }

    // Provide robust reconnection for iOS Safari when app enters foreground
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && db) {
        enableNetwork(db).catch(console.error);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Helper to safely parse any Firestore Timestamp representation (or primitive number) into milliseconds
    const getTimestampMs = (val: any): number => {
      if (!val) return 0;
      if (typeof val.toMillis === 'function') {
        return val.toMillis();
      }
      if (typeof val === 'number') {
        return val;
      }
      if (typeof val.seconds === 'number') {
        return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
      }
      if (val.updatedAt) {
        return getTimestampMs(val.updatedAt);
      }
      return 0;
    };

    let prevAppointments: Appointment[] = [];
    let isFirstLoad = true;
    let isExternalAppointmentsChange = false;
    let isSyncFirstLoad = true;
    const notifiedTags = notifiedTagsRef.current;
    const lastFetchTime: Record<string, number> = {};
    const MIN_REFETCH_INTERVAL_MS = 30_000;

    const triggerUniquePushNotification = (title: string, body: string, tag: string, url?: string) => {
      if (notifiedTags.has(tag)) return;
      notifiedTags.add(tag);
      showLocalNotificationOnly(title, body, tag, url);
    };

    // Timezone-safe local ISO string formatting (YYYY-MM-DD)
    // defined at file level scope

    // Smart loader for historical appointments (older than today)
    const loadHistoricalAppointments = async (forceRefresh = false, serverSyncMs?: number) => {
      loadHistoricalRef.current = loadHistoricalAppointments;
      try {
        const todayStr = getLocalTodayStr();
        const startOfYearStr = `${new Date().getFullYear()}-01-01`;

        let oldList: Appointment[] = [];
        const cacheDate = localStorage.getItem('nail_historical_appointments_cache_date_v2');
        const cachedData = localStorage.getItem('nail_historical_appointments_cache_v2');
        
        if (cacheDate === todayStr && cachedData) {
          const raw = JSON.parse(cachedData);
          oldList = Array.isArray(raw) ? raw.filter((a: any) =>
            a &&
            typeof a.date === 'string' && a.date.length > 0 &&
            typeof a.time === 'string' && a.time.length > 0
          ) : [];
        }

        const lastSyncTimeStr = localStorage.getItem('nail_historical_appointments_last_sync_time');
        const lastSyncTimeMs = lastSyncTimeStr ? Number(lastSyncTimeStr) : 0;
        const isTooOld = lastSyncTimeMs > 0 && (Date.now() - lastSyncTimeMs) > (25 * 24 * 60 * 60 * 1000);

        if (forceRefresh && oldList.length > 0 && lastSyncTimeMs > 0 && !isTooOld) {
          // --- INCREMENTAL PATCH UPDATE ---
          console.log(`[HistoricalAppts] Performing incremental fetch since server ms ${lastSyncTimeMs}...`);
          
          const lastSyncTimestamp = Timestamp.fromMillis(lastSyncTimeMs);
          const incrementalQuery = query(
            collection(db, 'appointments'),
            where('updatedAt', '>', lastSyncTimestamp)
          );
          
          const apptSnapshot = await getDocs(incrementalQuery);
          const updatedDocs = apptSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
              ...data,
              updatedAt: data.updatedAt ? getTimestampMs(data.updatedAt) : undefined
            } as any as Appointment;
          });
          
          if (updatedDocs.length > 0) {
            console.log(`[HistoricalAppts] Found ${updatedDocs.length} updated documents to patch.`);
            
            // Map existing historical list by ID for extremely fast lookup and update
            const oldMap = new Map<string, Appointment>();
            oldList.forEach(a => oldMap.set(a.id, a));
            
            let hasChanges = false;
            updatedDocs.forEach(updatedAppt => {
              // Only patch if it falls within the historical range (startOfYearStr <= date < todayStr)
              if (updatedAppt.date >= startOfYearStr && updatedAppt.date < todayStr) {
                if (updatedAppt.status === 'deleted') {
                  oldMap.delete(updatedAppt.id);
                } else {
                  oldMap.set(updatedAppt.id, updatedAppt);
                }
                hasChanges = true;
              }
            });
            
            if (hasChanges) {
              oldList = Array.from(oldMap.values());
              // Sort by date then time
              oldList.sort((a, b) => {
                const dateA = a.date ?? '';
                const dateB = b.date ?? '';
                if (dateA !== dateB) return dateA.localeCompare(dateB);
                return (a.time ?? '').localeCompare(b.time ?? '');
              });
              
              localStorage.setItem('nail_historical_appointments_cache_v2', JSON.stringify(stripHeavyFields(oldList)));
            }
          } else {
            console.log(`[HistoricalAppts] No new updates found. 0 reads.`);
          }
          
          let nextSyncMs = serverSyncMs || lastSyncTimeMs;
          updatedDocs.forEach(doc => {
            const docUpdatedAtMs = doc.updatedAt ? Number(doc.updatedAt) : 0;
            if (docUpdatedAtMs > nextSyncMs) {
              nextSyncMs = docUpdatedAtMs;
            }
          });
          localStorage.setItem('nail_historical_appointments_last_sync_time', String(nextSyncMs));
        } else if (oldList.length === 0 || forceRefresh || isTooOld) {
          // --- FULL FETCH ---
          if (isTooOld) {
            console.log(`[HistoricalAppts] Last sync time is older than 25 days (${new Date(lastSyncTimeMs).toLocaleDateString()}). Fallback to full fetch.`);
          }
          console.log(`[HistoricalAppts] Fetching full historical list from Firestore...`);
          const historicalQuery = query(
            collection(db, 'appointments'),
            where('date', '>=', startOfYearStr),
            where('date', '<', todayStr),
            orderBy('date', 'asc')
          );
          const apptSnapshot = await getDocs(historicalQuery);
          
          const rawHistorical = apptSnapshot.docs
            .map(doc => {
              const data = doc.data();
              return {
                ...data,
                updatedAt: data.updatedAt ? getTimestampMs(data.updatedAt) : undefined
              } as any as Appointment;
            })
            .filter(a => a.status !== 'deleted');

          oldList = rawHistorical.filter(a => 
            a && 
            typeof a.date === 'string' && a.date.length > 0 &&
            typeof a.time === 'string' && a.time.length > 0
          );

          localStorage.setItem('nail_historical_appointments_cache_v2', JSON.stringify(stripHeavyFields(oldList)));
          localStorage.setItem('nail_historical_appointments_cache_date_v2', todayStr);
          
          let maxUpdatedAtMs = 0;
          oldList.forEach(a => {
            const docMs = a.updatedAt ? Number(a.updatedAt) : 0;
            if (docMs > maxUpdatedAtMs) {
              maxUpdatedAtMs = docMs;
            }
          });
          if (maxUpdatedAtMs === 0) {
            maxUpdatedAtMs = serverSyncMs || Date.now();
          }
          localStorage.setItem('nail_historical_appointments_last_sync_time', String(maxUpdatedAtMs));
          console.log(`[HistoricalAppts] Full fetch completed: cached ${oldList.length} documents.`);
        } else {
          console.log(`[HistoricalAppts] Loaded ${oldList.length} old appointments from cache (0 reads)`);
        }

        if (oldList) {
          setAppointments(prevList => {
            const currentList = prevList || [];
            // Keep only today's and future appointments to merge with the patched historical list
            const todayAndFutureOnly = currentList.filter(a => a.date >= todayStr && a.status !== 'deleted');
            const merged = [...oldList, ...todayAndFutureOnly];
            merged.sort((a, b) => {
              const dateA = a.date ?? '';
              const dateB = b.date ?? '';
              if (dateA !== dateB) return dateA.localeCompare(dateB);
              return (a.time ?? '').localeCompare(b.time ?? '');
            });
            return merged;
          });
        }
      } catch (err) {
        console.warn("Could not load historical appointments:", err);
      }
    };

    // Load static/less frequent collections once on initial mount
    const loadStaticData = async () => {
      try {
        const [cList, sList, srvList, bList, tList] = await Promise.all([
          fetchCollectionFromCloud<Customer>('customers'),
          fetchCollectionFromCloud<Staff>('staff'),
          fetchCollectionFromCloud<NailService>('services'),
          fetchCollectionFromCloud<StaffBonus>('staff_bonuses'),
          fetchCollectionFromCloud<TimeLog>('time_logs'),
        ]);

        if (cList && cList.length > 0) setCustomers(cList);
        if (sList && sList.length > 0) setStaff(sList);
        
        if (srvList && srvList.length > 0) {
          setServices(srvList);
        } else {
          const hasSeeded = sessionStorage.getItem('nail_has_seeded_services');
          if (!hasSeeded) {
            sessionStorage.setItem('nail_has_seeded_services', 'true');
            INITIAL_SERVICES.forEach(item => {
              saveDocToCloud('services', item).catch(err => {
                console.warn(`Could not seed service ${item.name} to cloud`, err);
              });
            });
            setServices(INITIAL_SERVICES);
          }
        }

        if (bList && bList.length > 0) setStaffBonuses(bList);
        if (tList && tList.length > 0) setTimeLogs(tList);

        if (db) {
          try {
            const settingsSnap = await getDoc(doc(db, 'system', 'settings'));
            if (settingsSnap.exists()) {
              setSystemSettings(settingsSnap.data() as SystemSettings);
            }
          } catch (e) {
            console.warn("Could not load system settings:", e);
          }
        }

        // Fetch historical appointments cleanly using our new smart caching / loader function!
        await loadHistoricalAppointments();
      } catch (err) {
        console.warn("Error loading startup Firebase data: ", err);
      }
    };
    loadStaticData();

    // Last processed timestamps for collection-level synchronization
    const lastSyncTimestamps: Record<string, number> = {};

    // 6. Listen to race-condition-safe merge sync tracking signals to detect external updates in other collections
    const unsubSync = onSnapshot(doc(db, 'system', 'sync_status'), (snapshot) => {
      if (isSyncFirstLoad) {
        if (snapshot.exists()) {
          const syncData = snapshot.data();
          Object.keys(syncData).forEach(key => {
            if (key !== 'senderId') {
              const ms = getTimestampMs(syncData[key]);
              if (ms > 0) {
                lastSyncTimestamps[key] = ms;
              }
            }
          });
        }
        isSyncFirstLoad = false;
        return;
      }
      if (!snapshot.exists()) return;
      
      const syncData = snapshot.data();

      Object.keys(syncData).forEach(key => {
        const payload = syncData[key];
        if (!payload) return;

        const senderId = typeof payload === 'object' && 'senderId' in payload ? payload.senderId : syncData.senderId;
        if (senderId === clientSessionId) return;

        const timestamp = getTimestampMs(payload);
        if (timestamp === 0) return;

        const lastProcessed = lastSyncTimestamps[key] || 0;

        if (timestamp > lastProcessed) {
          lastSyncTimestamps[key] = timestamp;
          console.log(`[SyncTracker] Detected external update for collection: ${key}`);

          const documentId = typeof payload === 'object' && 'documentId' in payload ? payload.documentId : undefined;
          const operation = typeof payload === 'object' && 'operation' in payload ? payload.operation : 'upsert';

          if (key === 'appointments_historical' || key === 'appointments') {
            isExternalAppointmentsChange = true;
            console.log(`[SyncTracker] Historical appointments updated! Reloading history...`);
            loadHistoricalAppointments(true, timestamp);
          } else if (key === 'customers') {
            if (documentId) {
              if (operation === 'delete') {
                setCustomers(prev => prev.filter(c => c.id !== documentId));
              } else {
                getDoc(doc(db, 'customers', documentId)).then(docSnap => {
                  if (docSnap.exists()) {
                    const data = docSnap.data() as Customer;
                    setCustomers(prev => {
                      const filtered = prev.filter(c => c.id !== documentId);
                      return [data, ...filtered];
                    });
                  }
                }).catch(console.warn);
              }
            } else {
              const now = Date.now();
              const lastTime = lastFetchTime[key] || 0;
              if (now - lastTime < MIN_REFETCH_INTERVAL_MS) {
                console.log(`[SyncTracker] Skipping rapid repeat sync for ${key}`);
                return;
              }
              lastFetchTime[key] = now;
              fetchCollectionFromCloud<Customer>('customers').then(list => {
                if (list && list.length > 0) setCustomers(list);
              }).catch(console.warn);
            }
          } else if (key === 'staff') {
            if (documentId) {
              if (operation === 'delete') {
                setStaff(prev => prev.filter(s => s.id !== documentId));
              } else {
                getDoc(doc(db, 'staff', documentId)).then(docSnap => {
                  if (docSnap.exists()) {
                    const data = docSnap.data() as Staff;
                    setStaff(prev => {
                      const filtered = prev.filter(s => s.id !== documentId);
                      return [...filtered, data];
                    });
                  }
                }).catch(console.warn);
              }
            } else {
              const now = Date.now();
              const lastTime = lastFetchTime[key] || 0;
              if (now - lastTime < MIN_REFETCH_INTERVAL_MS) {
                console.log(`[SyncTracker] Skipping rapid repeat sync for ${key}`);
                return;
              }
              lastFetchTime[key] = now;
              fetchCollectionFromCloud<Staff>('staff').then(list => {
                if (list && list.length > 0) setStaff(list);
              }).catch(console.warn);
            }
          } else if (key === 'services') {
            if (documentId) {
              if (operation === 'delete') {
                setServices(prev => prev.filter(s => s.id !== documentId));
              } else {
                getDoc(doc(db, 'services', documentId)).then(docSnap => {
                  if (docSnap.exists()) {
                    const data = docSnap.data() as NailService;
                    setServices(prev => {
                      const filtered = prev.filter(s => s.id !== documentId);
                      return [...filtered, data];
                    });
                  }
                }).catch(console.warn);
              }
            } else {
              const now = Date.now();
              const lastTime = lastFetchTime[key] || 0;
              if (now - lastTime < MIN_REFETCH_INTERVAL_MS) {
                console.log(`[SyncTracker] Skipping rapid repeat sync for ${key}`);
                return;
              }
              lastFetchTime[key] = now;
              fetchCollectionFromCloud<NailService>('services').then(list => {
                if (list && list.length > 0) setServices(list);
              }).catch(console.warn);
            }
          } else if (key === 'staff_bonuses') {
            if (documentId) {
              if (operation === 'delete') {
                setStaffBonuses(prev => prev.filter(b => b.id !== documentId));
              } else {
                getDoc(doc(db, 'staff_bonuses', documentId)).then(docSnap => {
                  if (docSnap.exists()) {
                    const data = docSnap.data() as StaffBonus;
                    setStaffBonuses(prev => {
                      const filtered = prev.filter(b => b.id !== documentId);
                      return [...filtered, data];
                    });
                  }
                }).catch(console.warn);
              }
            } else {
              const now = Date.now();
              const lastTime = lastFetchTime[key] || 0;
              if (now - lastTime < MIN_REFETCH_INTERVAL_MS) {
                console.log(`[SyncTracker] Skipping rapid repeat sync for ${key}`);
                return;
              }
              lastFetchTime[key] = now;
              fetchCollectionFromCloud<StaffBonus>('staff_bonuses').then(list => {
                if (list && list.length > 0) setStaffBonuses(list);
              }).catch(console.warn);
            }
          } else if (key === 'time_logs') {
            if (documentId) {
              if (operation === 'delete') {
                setTimeLogs(prev => prev.filter(t => t.id !== documentId));
              } else {
                getDoc(doc(db, 'time_logs', documentId)).then(docSnap => {
                  if (docSnap.exists()) {
                    const data = docSnap.data() as TimeLog;
                    setTimeLogs(prev => {
                      const filtered = prev.filter(t => t.id !== documentId);
                      return [...filtered, data];
                    });
                  }
                }).catch(console.warn);
              }
            } else {
              const now = Date.now();
              const lastTime = lastFetchTime[key] || 0;
              if (now - lastTime < MIN_REFETCH_INTERVAL_MS) {
                console.log(`[SyncTracker] Skipping rapid repeat sync for ${key}`);
                return;
              }
              lastFetchTime[key] = now;
              fetchCollectionFromCloud<TimeLog>('time_logs').then(list => {
                if (list && list.length > 0) setTimeLogs(list);
              }).catch(console.warn);
            }
          }
        }
      });
    }, (error) => {
      console.warn("Firestore sync status listener error:", error);
    });

    // 7. Subscribe to all appointments from today onwards (cost-effective live subscription)
    const todayStr = getLocalTodayStr();
    
    // Timezone-safe yesterday calculation
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;

    const appointmentsQuery = query(
      collection(db, 'appointments'),
      where('date', '>=', todayStr),
      orderBy('date', 'asc')
    );

    const unsubAppointments = onSnapshot(appointmentsQuery, (snapshot) => {
      const rawLive = snapshot.docs
        .map(doc => {
          const data = doc.data();
          return {
            ...data,
            updatedAt: data.updatedAt ? getTimestampMs(data.updatedAt) : undefined
          } as any as Appointment;
        })
        .filter(a => a.status !== 'deleted');

      const liveAppointments = rawLive.filter(a => 
        a && 
        typeof a.date === 'string' && a.date.length > 0 &&
        typeof a.time === 'string' && a.time.length > 0
      );
      
      setAppointments(prevList => {
        const currentList = prevList || [];
        // Filter out any elements from today onwards from our existing list
        const historicalOnly = currentList.filter(a => a.date < todayStr);
        // Combine with live list
        const merged = [...historicalOnly, ...liveAppointments];
        
        // Sort them cleanly by date then time
        merged.sort((a, b) => {
          const dateA = a.date ?? '';
          const dateB = b.date ?? '';
          if (dateA !== dateB) return dateA.localeCompare(dateB);
          return (a.time ?? '').localeCompare(b.time ?? '');
        });
        
        return merged;
      });

      if (!isFirstLoad) {
        if (isExternalAppointmentsChange) {
          let triggerBeep = false;
          const activeUser = currentUserRef.current;
          
          // Check if we have any newly added appointments (matching today onwards ONLY to prevent history spamming)
          const prevIds = new Set(prevAppointments.map(a => a.id));
          const newAppts = liveAppointments.filter(a => !prevIds.has(a.id) && a.date >= todayStr);
          
          if (newAppts.length > 0) {
            triggerBeep = true;
            newAppts.forEach(appt => {
              if (activeUser?.role === 'admin' || activeUser?.role === 'support') {
                triggerUniquePushNotification(
                  "🔔 Có Đơn Hàng Mới Tại nailby.ank!",
                  `Khách hàng: ${appt.customerName} | Giờ: ${appt.time} - ${appt.date}. Trị giá: ${appt.totalPrice.toLocaleString()}đ. Nhấp để xem chi tiết!`,
                  `appt-new-${appt.id}`
                );
              } else if (activeUser?.role === 'staff') {
                if (appt.staffId && appt.staffId === activeUser.staffId) {
                  triggerUniquePushNotification(
                    "📅 Bạn Có Lịch Hẹn Mới Được Phân Công!",
                    `Khách hàng: ${appt.customerName} | Giờ: ${appt.time} ngày ${appt.date}. Chúc bạn phục vụ khách thật tốt! 💅`,
                    `appt-new-${appt.id}`
                  );
                } else {
                  const assignedStaffName = appt.staffName ? `Thợ: ${appt.staffName}` : "Chưa phân thợ";
                  triggerUniquePushNotification(
                    "🔔 Có Đơn Hàng Mới Tại nailby.ank!",
                    `Khách hàng: ${appt.customerName} | Giờ: ${appt.time} - ${appt.date} (${assignedStaffName}). Trị giá: ${appt.totalPrice.toLocaleString()}đ.`,
                    `appt-new-${appt.id}`
                  );
                }
              }
            });
          }

          // Thêm Set ở đầu block diff
          const justCompletedIds = new Set<string>();

          // First pass: identify appointments that just transitioned to 'completed'
          liveAppointments.filter(curr => curr.date >= todayStr).forEach(curr => {
            const prev = prevAppointments.find(p => p.id === curr.id);
            if (prev) {
              if (curr.status !== prev.status && curr.status === 'completed') {
                justCompletedIds.add(curr.id);
              }
            }
          });

          // Check changes on existing appointments (within the live active query of today/future ONLY to prevent history spamming)
          liveAppointments.filter(curr => curr.date >= todayStr).forEach(curr => {
            const prev = prevAppointments.find(p => p.id === curr.id);
            if (prev) {
              if (curr.pendingStatusApproval && curr.pendingStatusApproval !== prev.pendingStatusApproval) {
                if (activeUser?.role === 'admin' || activeUser?.role === 'support') {
                  triggerBeep = true;
                  const statusVn = curr.pendingStatusApproval === 'completed' ? 'Hoàn thành' : 'Hủy bỏ';
                  if (curr.pendingStatusApproval !== 'completed') {
                    if (!justCompletedIds.has(curr.id)) {
                      triggerUniquePushNotification(
                        "🛎️ Yêu Cầu Duyệt Đơn Mới!",
                        `Thợ ${curr.staffName} báo ${statusVn} đơn hàng của ${curr.customerName}. Vui lòng kiểm tra và duyệt thanh toán!`,
                        `appt-approve-${curr.id}`
                      );
                    }
                  }
                }
              }
              
              if (curr.status !== prev.status && curr.status === 'completed') {
                justCompletedIds.add(curr.id);  // đánh dấu
                if (activeUser?.role === 'staff' && curr.staffId === activeUser.staffId) {
                  // Keep sound effect if necessary, but disable push notification popup as requested
                  triggerBeep = true;             // chỉ giữ âm thanh
                  // KHÔNG gọi triggerUniquePushNotification ở đây
                }
              }

              if (curr.date !== prev.date || curr.time !== prev.time) {
                const isAssignedToMe = curr.staffId && activeUser?.role === 'staff' && curr.staffId === activeUser.staffId;
                const isAdminOrSupport = activeUser?.role === 'admin' || activeUser?.role === 'support';
                
                if (isAssignedToMe || isAdminOrSupport) {
                  triggerBeep = true;
                  if (!justCompletedIds.has(curr.id)) {
                    triggerUniquePushNotification(
                      "📅 Lịch Hẹn Đã Dời Thời Gian!",
                      `Lịch hẹn của khách ${curr.customerName} đã dời từ ${prev.time} ngày ${prev.date} sang ${curr.time} ngày ${curr.date} (Phụ trách: ${curr.staffName || 'Chưa phân công'}).`,
                      `appt-resched-${curr.id}`
                    );
                  }
                }
              }

              if (curr.status === 'cancelled' && prev.status !== 'cancelled') {
                const isAssignedToMe = curr.staffId && activeUser?.role === 'staff' && curr.staffId === activeUser.staffId;
                const isAdminOrSupport = activeUser?.role === 'admin' || activeUser?.role === 'support';
                
                if (isAssignedToMe || isAdminOrSupport) {
                  triggerBeep = true;
                  if (!justCompletedIds.has(curr.id)) {
                    triggerUniquePushNotification(
                      "❌ Lịch Hẹn Đã Bị Hủy!",
                      `Lịch hẹn móng của khách ${curr.customerName} lúc ${curr.time} ngày ${curr.date} đã bị HỦY. Vui lòng cập nhật lại lịch biểu!`,
                      `appt-cancel-${curr.id}`
                    );
                  }
                }
              }

              if (curr.staffId !== prev.staffId && curr.staffId && activeUser?.role === 'staff' && curr.staffId === activeUser.staffId) {
                triggerBeep = true;
                if (!justCompletedIds.has(curr.id)) {
                  triggerUniquePushNotification(
                    "📅 Bạn Được Phân Công Trách Nhiệm Mới!",
                    `Bạn vừa được gán vào lịch hẹn móng của khách ${curr.customerName} lúc ${curr.time} ngày ${curr.date}!`,
                    `appt-assign-${curr.id}`
                  );
                }
              }
            }
          });

          if (triggerBeep) {
            playLoudNotificationSound();
          }
          isExternalAppointmentsChange = false;
        }
      }

      prevAppointments = liveAppointments;
      isFirstLoad = false;
    }, (error) => {
      console.warn("Firestore appointments listener error:", error);
    });

    return () => {
      unsubAppointments();
      unsubSync();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      isDataLoadingRef.current = false;
    };
  }, [currentUser?.token]);

  const cloudSave = <T extends { id: string }>(collectionName: string, item: T, previousStateSnapshot?: T[]) => {
    saveDocToCloud(collectionName, item).catch(err => {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Chỉ rollback nếu lỗi thực sự nghiêm trọng như Permission Denied hoặc Quota Exceeded (không rollback nếu chỉ là offline tạm thời)
      const isCriticalError = errMsg.includes('permission') || errMsg.includes('unauthorized') || errMsg.includes('Quota exceeded') || errMsg.includes('not found');
      
      if (isCriticalError && previousStateSnapshot) {
        console.warn(`[Rollback] Critical Firestore error for ${collectionName}. Rolling back to previous state.`, err);
        if (collectionName === 'customers') {
          setCustomers(previousStateSnapshot as any);
          localStorage.setItem('nail_customers', JSON.stringify(previousStateSnapshot));
        } else if (collectionName === 'staff') {
          setStaff(previousStateSnapshot as any);
          localStorage.setItem('nail_staff', JSON.stringify(previousStateSnapshot));
        } else if (collectionName === 'appointments') {
          setAppointments(previousStateSnapshot as any);
          localStorage.setItem('nail_appointments', JSON.stringify(previousStateSnapshot));
        } else if (collectionName === 'services') {
          setServices(previousStateSnapshot as any);
          localStorage.setItem('nail_services', JSON.stringify(previousStateSnapshot));
        } else if (collectionName === 'staff_bonuses') {
          setStaffBonuses(previousStateSnapshot as any);
          localStorage.setItem('nail_staff_bonuses', JSON.stringify(previousStateSnapshot));
        } else if (collectionName === 'time_logs') {
          setTimeLogs(previousStateSnapshot as any);
          localStorage.setItem('nail_time_logs', JSON.stringify(previousStateSnapshot));
        }
        setDbStatus("⚠️ Lỗi đồng bộ đám mây: Dữ liệu đã được khôi phục về trạng thái an toàn trước đó.");
        setTimeout(() => setDbStatus(null), 5000);
      } else {
        console.warn(`Firestore upload delayed/offline, queued locally: ${collectionName}`, err);
      }
    });

    if (collectionName === 'appointments') {
      const todayStr = getLocalTodayStr();
      const isHistorical = (item as any).date && (item as any).date < todayStr;
      if (isHistorical) {
        try {
          const cachedData = localStorage.getItem('nail_historical_appointments_cache_v2');
          if (cachedData) {
            let oldList = JSON.parse(cachedData);
            if (Array.isArray(oldList)) {
              const index = oldList.findIndex((a: any) => a.id === item.id);
              if (index >= 0) {
                oldList[index] = { ...oldList[index], ...item };
              } else {
                oldList.push(item);
              }
              oldList.sort((a, b) => {
                const dateA = a.date ?? '';
                const dateB = b.date ?? '';
                if (dateA !== dateB) return dateA.localeCompare(dateB);
                return (a.time ?? '').localeCompare(b.time ?? '');
              });
              localStorage.setItem('nail_historical_appointments_cache_v2', JSON.stringify(oldList));
              
              setAppointments(prevList => {
                const currentList = prevList || [];
                const todayStr2 = getLocalTodayStr();
                const todayAndFutureOnly = currentList.filter(a => a.date >= todayStr2 && a.status !== 'deleted');
                const merged = [...oldList, ...todayAndFutureOnly];
                merged.sort((a, b) => {
                  const dateA = a.date ?? '';
                  const dateB = b.date ?? '';
                  if (dateA !== dateB) return dateA.localeCompare(dateB);
                  return (a.time ?? '').localeCompare(b.time ?? '');
                });
                return merged;
              });
            }
          }
        } catch (e) {
          console.warn("Failed to patch historical cache locally:", e);
        }
      }
    }
  };

  const cloudDelete = (collectionName: string, id: string, date?: string) => {
    deleteDocFromCloud(collectionName, id, date).catch(err => {
      console.warn(`Firestore delete delayed, falling back on local: ${collectionName}`, err);
    });

    if (collectionName === 'appointments') {
      const todayStr = getLocalTodayStr();
      const isHistorical = date && date < todayStr;
      if (isHistorical) {
        try {
          const cachedData = localStorage.getItem('nail_historical_appointments_cache_v2');
          if (cachedData) {
            let oldList = JSON.parse(cachedData);
            if (Array.isArray(oldList)) {
              oldList = oldList.filter((a: any) => a.id !== id);
              localStorage.setItem('nail_historical_appointments_cache_v2', JSON.stringify(oldList));
              
              setAppointments(prevList => {
                const currentList = prevList || [];
                const todayStr2 = getLocalTodayStr();
                const todayAndFutureOnly = currentList.filter(a => a.date >= todayStr2 && a.status !== 'deleted');
                const merged = [...oldList, ...todayAndFutureOnly];
                merged.sort((a, b) => {
                  const dateA = a.date ?? '';
                  const dateB = b.date ?? '';
                  if (dateA !== dateB) return dateA.localeCompare(dateB);
                  return (a.time ?? '').localeCompare(b.time ?? '');
                });
                return merged;
              });
            }
          }
        } catch (e) {
          console.warn("Failed to delete from historical cache locally:", e);
        }
      }
    }
  };

  // Keep activeTab inside valid choices for staff sessions
  useEffect(() => {
    if ((currentUser?.role === 'staff' || currentUser?.role === 'support') && activeTab !== 'calendar' && activeTab !== 'income') {
      setActiveTab('calendar');
    }
  }, [currentUser, activeTab]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr('');
    setIsLoggingIn(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword.trim() })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.user?.token) {
        throw new Error(data.error || 'Không thể đăng nhập');
      }
      const session = data.user as AuthenticatedUserSession;
      setCurrentUser(session);
      localStorage.setItem('nail_current_user_session', JSON.stringify(session));
      setActiveTab('calendar');
      setLoginUsername('');
      setLoginPassword('');
    } catch (error: any) {
      setLoginErr(error?.message || 'Không thể kết nối máy chủ để đăng nhập');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('nail_current_user_session');
  };
  
  // App States with durable-look fallback
  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('nail_customers');
    return saved ? JSON.parse(saved) : INITIAL_CUSTOMERS;
  });

  const [staff, setStaff] = useState<Staff[]>(() => {
    const saved = localStorage.getItem('nail_staff');
    return saved ? JSON.parse(saved) : INITIAL_STAFF;
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem('nail_appointments');
    const list = saved ? JSON.parse(saved) : INITIAL_APPOINTMENTS;
    return (list || []).filter((a: any) => 
      a && 
      a.status !== 'deleted' &&
      typeof a.date === 'string' && a.date.length > 0 &&
      typeof a.time === 'string' && a.time.length > 0
    );
  });

  const [staffBonuses, setStaffBonuses] = useState<StaffBonus[]>(() => {
    const saved = localStorage.getItem('nail_staff_bonuses');
    return saved ? JSON.parse(saved) : [];
  });

  const [timeLogs, setTimeLogs] = useState<TimeLog[]>(() => {
    const saved = localStorage.getItem('nail_time_logs');
    return saved ? JSON.parse(saved) : [];
  });

  // Services list (Stateful with localStorage support)
  const [services, setServices] = useState<NailService[]>(() => {
    const saved = localStorage.getItem('nail_services');
    return saved ? JSON.parse(saved) : INITIAL_SERVICES;
  });

  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>(() => {
    const saved = localStorage.getItem('nail_admin_accounts');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse nail_admin_accounts, using default.", e);
      }
    }
    return [];
  });

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('nail_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem('nail_staff', JSON.stringify(staff));
  }, [staff]);

  useEffect(() => {
    localStorage.setItem('nail_appointments', JSON.stringify(stripHeavyFields(appointments)));
  }, [appointments]);

  useEffect(() => {
    localStorage.setItem('nail_staff_bonuses', JSON.stringify(staffBonuses));
  }, [staffBonuses]);

  useEffect(() => {
    localStorage.setItem('nail_time_logs', JSON.stringify(timeLogs));
  }, [timeLogs]);

  useEffect(() => {
    localStorage.setItem('nail_services', JSON.stringify(services));
  }, [services]);

  useEffect(() => {
    localStorage.setItem('nail_admin_accounts', JSON.stringify(adminAccounts));
  }, [adminAccounts]);

  // Synchronize staff editing values when settings is toggled open
  useEffect(() => {
    if (isSettingsOpen && (currentUser?.role === 'staff' || currentUser?.role === 'support')) {
      const currentProfile = staff.find(s => s.id === currentUser?.staffId);
      if (currentProfile) {
        setStaffPhone(currentProfile.phone || '');
        setStaffUsername(currentProfile.username || currentProfile.phone || '');
        setStaffPassword(currentProfile.password || '');
      }
    }
  }, [isSettingsOpen, currentUser, staff]);

  // Action: Add new service
  const handleAddService = (newSrv: Omit<NailService, 'id'>) => {
    const newId = 'srv_' + Date.now();
    const serviceToAdd: NailService = {
      ...newSrv,
      id: newId,
      category: newSrv.category as any
    };
    setServices([...services, serviceToAdd]);
    cloudSave('services', serviceToAdd);
  };

  // Action: Update existing service
  const handleUpdateService = (id: string, updatedFields: Partial<NailService>) => {
    setServices(prev => prev.map(srv => {
      if (srv.id === id) {
        const result = { ...srv, ...updatedFields };
        cloudSave('services', result);
        return result;
      }
      return srv;
    }));
  };

  // Action: Delete service
  const handleDeleteService = (id: string) => {
    setServices(prev => prev.filter(srv => srv.id !== id));
    cloudDelete('services', id);
  };

  const handleResetServices = () => {
    setServices(INITIAL_SERVICES);
    INITIAL_SERVICES.forEach(item => {
      cloudSave('services', item);
    });
    setDbStatus("✨ Đã khôi phục toàn bộ bảng giá chuẩn theo thiết kế từ ảnh gốc!");
    setTimeout(() => setDbStatus(null), 4000);
  };

  // Support check-in & check-out handlers
  const handleCheckIn = (staffId: string) => {
    const newLog: TimeLog = {
      id: 'log_' + Date.now(),
      staffId,
      checkIn: new Date().toISOString(),
      paid: false
    };
    setTimeLogs(prev => [...prev, newLog]);
    cloudSave('time_logs', newLog);
  };

  const handleCheckOut = (staffId: string) => {
    const activeStaff = staff.find(s => s.id === staffId);
    const hourlyRate = activeStaff?.hourlyRate || 30000;
    const now = new Date();
    setTimeLogs(prev => prev.map(log => {
      if (log.staffId === staffId && !log.checkOut) {
        const checkInTime = new Date(log.checkIn);
        const diffMs = now.getTime() - checkInTime.getTime();
        const rawHours = diffMs / (1000 * 60 * 60);
        const totalHours = Math.round(rawHours * 10) / 10 || 0.1;
        const totalEarnings = Math.round(totalHours * hourlyRate);
        const updatedLog = {
          ...log,
          checkOut: now.toISOString(),
          totalHours,
          totalEarnings
        };
        cloudSave('time_logs', updatedLog);
        return updatedLog;
      }
      return log;
    }));
  };

  // Action: Settle / Chốt thanh toán lương cho nhân sự
  const handleSettleStaffPayroll = (staffId: string, month: string) => {
    const activeStaff = staff.find(s => s.id === staffId);
    if (!activeStaff) return;

    const isSupport = activeStaff.role && (activeStaff.role.toLowerCase() === 'support' || activeStaff.role === 'Support');

    // Run payroll calculation to capture precise settlement amounts before updating states
    const stats = calculatePayroll(activeStaff, appointments, services, staffBonuses, timeLogs, month);

    // Identify targets for audit settlement record
    const targetAppts = appointments.filter(a => {
      const isOwner = a.staffId === staffId;
      const isCompleted = a.status === 'completed';
      const matchesMonth = month === 'all' || a.date.startsWith(month);
      return isOwner && isCompleted && matchesMonth && !a.payrollSettled;
    });
    const appointmentIds = targetAppts.map(a => a.id);

    const targetBonuses = staffBonuses.filter(b => {
      const isOwner = b.staffId === staffId;
      const matchesMonth = month === 'all' || b.month === month;
      return isOwner && matchesMonth && !b.paid;
    });
    const bonusIds = targetBonuses.map(b => b.id);

    const targetLogs = timeLogs.filter(log => {
      const isOwner = log.staffId === staffId;
      const matchesMonth = month === 'all' || log.checkIn.startsWith(month);
      return isOwner && matchesMonth && log.checkOut && !log.paid;
    });
    const timeLogIds = targetLogs.map(log => log.id);

    // 1. Settle matching bonuses
    setStaffBonuses(prev => prev.map(bonus => {
      const isOwner = bonus.staffId === staffId;
      const matchesMonth = month === 'all' || bonus.month === month;
      if (isOwner && matchesMonth && !bonus.paid) {
        const updatedBonus = {
          ...bonus,
          paid: true,
          paidAt: new Date().toISOString()
        };
        cloudSave('staff_bonuses', updatedBonus);
        return updatedBonus;
      }
      return bonus;
    }));

    if (isSupport) {
      // 2. Settle Support time logs
      setTimeLogs(prev => prev.map(log => {
        const isOwner = log.staffId === staffId;
        const matchesMonth = month === 'all' || log.checkIn.startsWith(month);
        if (isOwner && matchesMonth && log.checkOut && !log.paid) {
          const updatedLog = { ...log, paid: true, paidAt: new Date().toISOString() };
          cloudSave('time_logs', updatedLog);
          return updatedLog;
        }
        return log;
      }));
    } else {
      // 3. Settle Staff appointments
      setAppointments(prev => prev.map(appt => {
        const isOwner = appt.staffId === staffId;
        const isCompleted = appt.status === 'completed';
        const matchesMonth = month === 'all' || appt.date.startsWith(month);
        if (isOwner && isCompleted && matchesMonth && !appt.payrollSettled) {
          const updatedAppt = {
            ...appt,
            payrollSettled: true,
            payrollSettledAt: new Date().toISOString()
          };
          cloudSave('appointments', updatedAppt);
          return updatedAppt;
        }
        return appt;
      }));
    }

    // 4. Save audit log to payroll_settlements
    const settlementId = 'SETTLE_' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
    const settlementRecord = {
      id: settlementId,
      staffId: staffId,
      staffName: activeStaff.name,
      month: month,
      settledAt: new Date().toISOString(),
      commissionPaid: isSupport ? 0 : stats.outstandingCommission,
      baseSalaryPaid: isSupport ? 0 : stats.outstandingBaseSalary,
      bonusPaid: stats.outstandingBonus || 0,
      totalPaid: stats.finalPayout,
      appointmentIds,
      bonusIds,
      timeLogIds
    };
    cloudSave('payroll_settlements', settlementRecord);

    setDbStatus(`✨ Đã chốt thành công và chốt chu kỳ lương cho ${activeStaff.name}!`);
    setTimeout(() => setDbStatus(null), 4000);
  };

  const handleUpdateTimeLog = (logId: string, updatedFields: Partial<TimeLog>) => {
    const existingLog = timeLogs.find(log => log.id === logId);
    if (existingLog && (existingLog.paid || (existingLog as any).settled)) {
      alert("Ca chấm công này đã thanh toán lương, không thể chỉnh sửa!");
      return;
    }
    setTimeLogs(prev => prev.map(log => {
      if (log.id === logId) {
        const updated = { ...log, ...updatedFields };
        cloudSave('time_logs', updated);
        return updated;
      }
      return log;
    }));
    setDbStatus("✨ Đã cập nhật thành công ca chấm công!");
    setTimeout(() => setDbStatus(null), 3000);
  };

  const handleDeleteTimeLog = (logId: string) => {
    const existingLog = timeLogs.find(log => log.id === logId);
    if (existingLog && (existingLog.paid || (existingLog as any).settled)) {
      alert("Ca chấm công này đã thanh toán lương, không thể xóa!");
      return;
    }
    setTimeLogs(prev => prev.filter(log => log.id !== logId));
    cloudDelete('time_logs', logId);
    setDbStatus("🗑️ Đã xóa ca chấm công thành công!");
    setTimeout(() => setDbStatus(null), 3000);
  };

  // Action: Add new booking appointment
  const handleAddAppointment = async (apptData: Omit<Appointment, 'id'>) => {
    const newApptId = 'A' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
    let finalCustomerId = apptData.customerId;
    let isNewCustomer = false;
    let newCust: Customer | null = null;

    // If client specified dynamic new guest creation
    if (apptData.customerId && apptData.customerId.startsWith('new_cust_temp')) {
      const existingMapping = tempCustomerMappingsRef.current[apptData.customerId];
      if (existingMapping) {
        finalCustomerId = existingMapping;
        isNewCustomer = false;
      } else {
        isNewCustomer = true;
        finalCustomerId = 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        tempCustomerMappingsRef.current[apptData.customerId] = finalCustomerId;
        newCust = {
          id: finalCustomerId,
          name: apptData.customerName,
          phone: apptData.customerPhone,
          email: '',
          totalVisits: 0,
          totalSpent: 0,
          notes: apptData.notes || 'Khách tạo lịch nhanh ngoài luồng',
          createdAt: new Date().toISOString().split('T')[0]
        };
      }
    }

    // Map full service details into the appointment document (NoSQL Denormalization best practice)
    const embeddedServices = (apptData.serviceIds || []).map(sId => {
      const srv = services.find(s => s.id === sId);
      return {
        id: sId,
        name: srv ? srv.name : "Dịch vụ làm đẹp",
        price: 0, // Prices are free-form input by the technician
        category: srv ? srv.category : undefined
      };
    });

    const depositAmount = apptData.depositAmount || 0;
    const depositPaid = apptData.depositPaid ?? false;

    const newAppt: Appointment = {
      ...apptData,
      id: newApptId,
      customerId: finalCustomerId,
      services: embeddedServices,
      smsStatus: 'delivered',
      depositAmount: depositAmount,
      depositPaid: depositPaid,
      useDeposit: apptData.useDeposit ?? true
    };

    // Optimistically update local states
    if (isNewCustomer && newCust) {
      const finalNewCust = {
        ...newCust,
        walletBalance: depositPaid ? depositAmount : 0,
        walletVersion: 0
      };
      setCustomers(prev => [...prev, finalNewCust]);
    } else if (depositAmount > 0 && depositPaid) {
      setCustomers(prev => prev.map(c => {
        if (c.id === finalCustomerId) {
          return {
            ...c,
            walletBalance: (c.walletBalance || 0) + depositAmount,
            walletVersion: (c.walletVersion || 0) + 1
          };
        }
        return c;
      }));
    }

    setAppointments(prev => [newAppt, ...prev]);

    const db = getDb();
    if (db) {
      try {
        await runTransaction(db, async (transaction) => {
          const apptRef = doc(db, 'appointments', newApptId);
          const customerRef = doc(db, 'customers', finalCustomerId);

          if (isNewCustomer && newCust) {
            const finalNewCust = {
              ...newCust,
              walletBalance: depositPaid ? depositAmount : 0,
              walletVersion: 0
            };
            transaction.set(customerRef, finalNewCust);
          } else if (depositAmount > 0 && depositPaid) {
            transaction.update(customerRef, {
              walletBalance: increment(depositAmount),
              walletVersion: increment(1)
            });
          }

          transaction.set(apptRef, {
            ...newAppt,
            updatedAt: new Date().toISOString()
          });
        });

        // Trigger sync signals
        const apptDate = newAppt.date;
        const todayStr = getLocalTodayStr();
        const isHistorical = apptDate && apptDate < todayStr;
        if (isHistorical) {
          await triggerSyncSignal('appointments_historical', newAppt.id, 'upsert');
        }
        if (isNewCustomer || (depositAmount > 0 && depositPaid)) {
          await triggerSyncSignal('customers', finalCustomerId, 'upsert');
        }
      } catch (error) {
        console.error("Lỗi giao dịch tạo lịch hẹn:", error);
        setDbStatus("⚠️ Lỗi đồng bộ đám mây: Giao dịch tạo lịch hẹn thất bại.");
        setTimeout(() => setDbStatus(null), 5000);
      }
    } else {
      // Fallback for offline/no-db mode
      if (isNewCustomer && newCust) {
        const finalNewCust = {
          ...newCust,
          walletBalance: depositPaid ? depositAmount : 0,
          walletVersion: 0
        };
        cloudSave('customers', finalNewCust);
      } else if (depositAmount > 0 && depositPaid) {
        const currentCust = customers.find(c => c.id === finalCustomerId);
        if (currentCust) {
          cloudSave('customers', {
            ...currentCust,
            walletBalance: (currentCust.walletBalance || 0) + depositAmount,
            walletVersion: (currentCust.walletVersion || 0) + 1
          });
        }
      }
      cloudSave('appointments', newAppt);
    }

    // Call initiator notification broadcast for other devices with local de-duplication
    const notifyTag = `appt-new-${newAppt.id}`;
    notifiedTagsRef.current.add(notifyTag);
    triggerPushNotification(
      "🔔 Có Lịch Hẹn Mới Tại nailby.ank!",
      `Khách hàng: ${newAppt.customerName} | Giờ: ${newAppt.time} - ${newAppt.date}. Trị giá: ${newAppt.totalPrice.toLocaleString()}đ.`,
      notifyTag
    );
    return newAppt;
  };

  // Action: Update Appointment Status (Complete/Cancel)
  const handleUpdateStatus = (id: string, status: 'completed' | 'cancelled') => {
    setAppointments(prev => prev.map(appt => {
      if (appt.id === id) {
        const oldStatus = appt.status;
        let snapshotRate = appt.commissionRate;
        if (status === 'completed' && snapshotRate === undefined && appt.staffId) {
          const associatedStaff = staff.find(s => s.id === appt.staffId);
          if (associatedStaff) {
            snapshotRate = associatedStaff.commissionRate;
          }
        }
        const apptHasDiscount = !!(appt.discountCode || (appt.discountAmount && appt.discountAmount > 0));
        const commissionAmount = status === 'completed'
          ? calculateStaffCommission(appt.totalPrice || 0, snapshotRate || 0, apptHasDiscount)
          : undefined;

        const result: any = { 
          ...appt, 
          status,
          ...(status === 'completed' && snapshotRate !== undefined && { commissionRate: snapshotRate }),
          ...(status === 'completed' && commissionAmount !== undefined && { commissionAmount })
        };
        delete result.pendingStatusApproval;
        cloudSave('appointments', result);

        // Update customer statistics dynamically (Requirement 2 & 6)
        if (appt.customerId && !appt.customerId.startsWith('new_cust_temp')) {
          const prevCustomers = [...customers];

          setCustomers(prevCusts => prevCusts.map(c => {
            if (c.id === appt.customerId) {
              let newVisits = c.totalVisits || 0;
              let newSpent = c.totalSpent || 0;
              const collected = appt.totalPrice;

              if (status === 'completed' && oldStatus !== 'completed') {
                newVisits += 1;
                newSpent += collected;
              } else if (status !== 'completed' && oldStatus === 'completed') {
                newVisits = Math.max(0, newVisits - 1);
                newSpent = Math.max(0, newSpent - collected);
              }

              const updatedCust = {
                ...c,
                totalVisits: newVisits,
                totalSpent: newSpent
              };
              cloudSave('customers', updatedCust, prevCustomers);
              return updatedCust;
            }
            return c;
          }));
        }

        // Call initiator notification broadcast for other devices with local de-duplication (Requirement 9)
        if (status !== 'completed') {
          const notifyTag = `appt-status-${appt.id}`;
          notifiedTagsRef.current.add(notifyTag);
          const statusVn = 'HỦY BỎ';
          triggerPushNotification(
            "✅ Trạng Thái Đơn Hàng Thay Đổi!",
            `Lịch hẹn móng của khách ${appt.customerName} đã được ${statusVn}!`,
            notifyTag
          );
        }

        return result;
      }
      return appt;
    }));
  };

  // Action: Update Appointment (Admin Edit option)
  const handleUpdateAppointment = (id: string, updatedFields: Partial<Appointment>) => {
    setAppointments(prev => prev.map(appt => {
      if (appt.id === id) {
        const result = { ...appt, ...updatedFields };
        if (updatedFields.serviceIds) {
          result.services = updatedFields.serviceIds.map(sId => {
            const srv = services.find(s => s.id === sId);
            return {
              id: sId,
              name: srv ? srv.name : "Dịch vụ làm đẹp",
              price: 0,
              category: srv ? srv.category : undefined
            };
          });
        }
        if (updatedFields.hasOwnProperty('pendingStatusApproval') && !updatedFields.pendingStatusApproval) {
          delete result.pendingStatusApproval;
        }
        cloudSave('appointments', result);

        // If reschedule or reassignment, trigger push broadcast
        if (updatedFields.date || updatedFields.time || updatedFields.staffId) {
          const isDateOrTimeChange = (updatedFields.date && updatedFields.date !== appt.date) || (updatedFields.time && updatedFields.time !== appt.time);
          const isStaffChange = updatedFields.staffId && updatedFields.staffId !== appt.staffId;
          
          if (isDateOrTimeChange) {
            triggerPushNotification(
              "📅 Lịch Hẹn Đã Dời Thời Gian!",
              `Lịch hẹn của ${appt.customerName} đã dời từ ${appt.time} ngày ${appt.date} sang ${updatedFields.time || appt.time} ngày ${updatedFields.date || appt.date}.`,
              `appt-resched-${appt.id}`
            );
          } else if (isStaffChange) {
            triggerPushNotification(
              "📅 Phân Công Thợ Mới!",
              `Đã phân công ${updatedFields.staffName || 'thợ mới'} đảm nhận lịch hẹn của khách ${appt.customerName} lúc ${appt.time} ngày ${appt.date}.`,
              `appt-assign-${appt.id}`
            );
          }
        }

        return result;
      }
      return appt;
    }));
    setDbStatus("💾 Đã cập nhật thành công thông tin đơn hàng!");
    setTimeout(() => setDbStatus(null), 3000);
  };

  // Action: Add new nail technician staff
  const handleAddStaff = (newStaffData: Omit<Staff, 'id'>) => {
    const newId = 's_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newStaff: Staff = {
      ...newStaffData,
      id: newId
    };
    setStaff([...staff, newStaff]);
    cloudSave('staff', newStaff);
  };

  // Action: Update nail technician staff
  const handleUpdateStaff = (id: string, updatedFields: Partial<Staff>) => {
    setStaff(prev => prev.map(s => {
      if (s.id === id) {
        const result = { ...s, ...updatedFields };
        cloudSave('staff', result);
        return result;
      }
      return s;
    }));
  };

  // Action: Delete nail technician staff
  const handleDeleteStaff = (id: string) => {
    setStaff(prev => prev.filter(s => s.id !== id));
    cloudDelete('staff', id);
  };

  // Action: Add staff bonus/reward
  const handleAddStaffBonus = (newBonusData: Omit<StaffBonus, 'id' | 'createdAt'>) => {
    const newId = 'bonus_' + Date.now();
    const newBonus: StaffBonus = {
      ...newBonusData,
      id: newId,
      createdAt: new Date().toISOString()
    };
    setStaffBonuses(prev => [...prev, newBonus]);
    cloudSave('staff_bonuses', newBonus);
  };

  // Action: Delete staff bonus/reward
  const handleDeleteStaffBonus = (id: string) => {
    const existingBonus = staffBonuses.find(b => b.id === id);
    if (existingBonus && (existingBonus.paid || (existingBonus as any).settled)) {
      alert("Khoản thưởng/trợ cấp này đã thanh toán lương, không thể xóa!");
      return;
    }
    setStaffBonuses(prev => prev.filter(b => b.id !== id));
    cloudDelete('staff_bonuses', id);
  };

  const handleAddExtraService = (appointmentId: string, name: string, price: number) => {
    setAppointments(prev => {
      const updated = prev.map(appt => {
        if (appt.id === appointmentId) {
          const extra = appt.extraServices || [];
          const updatedExtra = [...extra, { name, price }];
          const newTotal = appt.totalPrice + price;
          const result = {
            ...appt,
            extraServices: updatedExtra,
            totalPrice: newTotal
          };
          cloudSave('appointments', result);
          return result;
        }
        return appt;
      });
      localStorage.setItem('nail_appointments', JSON.stringify(updated));
      return updated;
    });
    setDbStatus("✨ Đã ghi nhận dịch vụ phát sinh thêm vào đơn hàng!");
    setTimeout(() => setDbStatus(null), 3000);
  };

  const handleRemoveExtraService = (appointmentId: string, index: number) => {
    setAppointments(prev => {
      const updated = prev.map(appt => {
        if (appt.id === appointmentId && appt.extraServices) {
          const targetExtra = appt.extraServices[index];
          const updatedExtra = appt.extraServices.filter((_, idx) => idx !== index);
          const newTotal = appt.totalPrice - (targetExtra ? targetExtra.price : 0);
          const result = {
            ...appt,
            extraServices: updatedExtra,
            totalPrice: Math.max(0, newTotal)
          };
          cloudSave('appointments', result);
          return result;
        }
        return appt;
      });
      localStorage.setItem('nail_appointments', JSON.stringify(updated));
      return updated;
    });
    setDbStatus("🗑 Đã xóa dịch vụ phát sinh ra khỏi đơn hàng!");
    setTimeout(() => setDbStatus(null), 3000);
  };

  // Action: Add new customer
  const handleAddCustomer = (custData: Omit<Customer, 'id' | 'totalVisits' | 'totalSpent' | 'createdAt'>) => {
    const newId = 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newCust: Customer = {
      ...custData,
      id: newId,
      totalVisits: 0,
      totalSpent: 0,
      createdAt: new Date().toISOString().split('T')[0],
      walletBalance: 0,
      walletVersion: 0
    };
    setCustomers([newCust, ...customers]);
    cloudSave('customers', newCust);
  };

  // Action: Update customer
  const handleUpdateCustomer = (id: string, updatedFields: Partial<Omit<Customer, 'id' | 'totalVisits' | 'totalSpent' | 'createdAt'>>) => {
    setCustomers(prev => prev.map(c => {
      if (c.id === id) {
        const hasWalletBalanceChange = Object.prototype.hasOwnProperty.call(updatedFields, 'walletBalance');
        const nextVersion = hasWalletBalanceChange ? (c.walletVersion || 0) + 1 : (c.walletVersion || 0);
        const result = {
          ...c,
          ...updatedFields,
          ...(hasWalletBalanceChange && { walletVersion: nextVersion })
        };
        cloudSave('customers', result);
        return result;
      }
      return c;
    }));
    setDbStatus("Đã cập nhật thông tin khách hàng!");
    setTimeout(() => setDbStatus(null), 3000);
  };

  // Action: Delete customer
  const handleDeleteCustomer = (id: string) => {
    setCustomers(prev => prev.filter(c => c.id !== id));
    cloudDelete('customers', id);
    setDbStatus("Đã xóa khách hàng thành công!");
    setTimeout(() => setDbStatus(null), 3000);
  };

  // Status feedback for Database interactions
  const [dbStatus, setDbStatus] = useState<string | null>(null);

  // Backup & Restore handlers (100% Free & Persistent Offline Safe storage)
  const handleExportData = async () => {
    try {
      setDbStatus("Đang tải toàn bộ dữ liệu từ đám mây...");
      let paymentSessions: any[] = [];
      let paymentTransactions: any[] = [];
      let staffIncome: any[] = [];
      const dbInstance = getDb();
      if (!dbInstance) {
        throw new Error("Không thể kết nối đến cơ sở dữ liệu (Firestore). Vui lòng kiểm tra kết nối mạng!");
      }

      const paySnap = await getDocs(collection(dbInstance, 'payment_sessions'));
      paymentSessions = paySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const paymentTxSnap = await getDocs(collection(dbInstance, 'payment_transactions'));
      paymentTransactions = paymentTxSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const incSnap = await getDocs(collection(dbInstance, 'staff_income'));
      staffIncome = incSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        customers,
        staff,
        appointments,
        services,
        staffBonuses,
        timeLogs,
        paymentSessions,
        paymentTransactions,
        staffIncome
      }, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `nailby_ank_backup_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setDbStatus("Sao lưu thành công! Đã tải file cấu hình về máy.");
      setTimeout(() => setDbStatus(null), 4000);
    } catch (e: any) {
      console.error("Backup export error:", e);
      alert("Xuất sao lưu thất bại: " + (e.message || "Lỗi tải dữ liệu từ Firestore"));
      setDbStatus("Có lỗi khi xuất file sao lưu!");
      setTimeout(() => setDbStatus(null), 4000);
    }
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (!e.target.files || e.target.files.length === 0) return;
    fileReader.readAsText(e.target.files[0], "UTF-8");
    fileReader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        
        // 1. Validate complete backup file
        const requiredKeys = ['customers', 'staff', 'appointments', 'services', 'staffBonuses', 'timeLogs'];
        for (const key of requiredKeys) {
          if (!parsed[key] || !Array.isArray(parsed[key])) {
            alert(`Lỗi: Tệp sao lưu không hợp lệ. Thiếu mảng '${key}' hoặc không đúng định dạng!`);
            setDbStatus("Tệp sao lưu không hợp lệ!");
            setTimeout(() => setDbStatus(null), 5000);
            return;
          }
        }

        // 2. Validate elements have valid ID and no duplicates in each collection
        const optionalCollections = ['paymentSessions', 'paymentTransactions', 'staffIncome'];
        for (const key of [...requiredKeys, ...optionalCollections]) {
          const array = parsed[key];
          if (array === undefined || array === null) {
            // Optional collections are allowed to be missing in older backups
            continue;
          }
          if (!Array.isArray(array)) {
            alert(`Lỗi: Mảng '${key}' không đúng định dạng!`);
            setDbStatus("Lỗi dữ liệu: Định dạng không hợp lệ!");
            setTimeout(() => setDbStatus(null), 5000);
            return;
          }
          const ids = new Set<string>();
          for (const item of array) {
            if (!item || !item.id || typeof item.id !== 'string' || item.id.trim() === '') {
              alert(`Lỗi: Phát hiện phần tử không có ID hợp lệ trong danh sách '${key}'!`);
              setDbStatus("Lỗi dữ liệu: ID không hợp lệ!");
              setTimeout(() => setDbStatus(null), 5000);
              return;
            }
            if (ids.has(item.id)) {
              alert(`Lỗi: Phát hiện ID trùng lặp '${item.id}' trong danh sách '${key}'!`);
              setDbStatus("Lỗi dữ liệu: Trùng lặp ID!");
              setTimeout(() => setDbStatus(null), 5000);
              return;
            }
            ids.add(item.id);
          }
        }

        // 3. Verify that every appointment.customerId (if not empty) exists in customers
        const customerIds = new Set<string>(parsed.customers.map((c: any) => c.id));
        for (const appt of parsed.appointments) {
          if (appt.customerId && typeof appt.customerId === 'string' && appt.customerId.trim() !== '') {
            if (!customerIds.has(appt.customerId)) {
              alert(`Lỗi: Lịch hẹn '${appt.id}' chứa customerId '${appt.customerId}' không tồn tại trong danh sách khách hàng!`);
              setDbStatus("Lỗi dữ liệu: Liên kết khách hàng không hợp lệ!");
              setTimeout(() => setDbStatus(null), 5000);
              return;
            }
          }
        }

        // 4. Confirmation from administrator
        const confirmed = window.confirm("🔴 CẢNH BÁO: Thao tác này sẽ THAY THẾ HOÀN TOÀN toàn bộ dữ liệu hiện tại bằng dữ liệu trong tệp sao lưu. Bạn có chắc chắn muốn thực hiện?");
        if (!confirmed) {
          setDbStatus(null);
          return;
        }

        setDbStatus("Đang khôi phục và thay thế dữ liệu trên đám mây... Vui lòng đợi!");

        // 5. Sequentially replace each collection
        setDbStatus("Đang cập nhật danh sách Khách hàng...");
        setCustomers(parsed.customers);
        await replaceCollectionFromCloud('customers', parsed.customers);

        setDbStatus("Đang cập nhật danh sách Nhân sự...");
        setStaff(parsed.staff);
        await replaceCollectionFromCloud('staff', parsed.staff);

        setDbStatus("Đang cập nhật danh sách Lịch hẹn...");
        setAppointments(parsed.appointments);
        await replaceCollectionFromCloud('appointments', parsed.appointments);

        setDbStatus("Đang cập nhật Bảng giá dịch vụ...");
        setServices(parsed.services);
        await replaceCollectionFromCloud('services', parsed.services);

        setDbStatus("Đang cập nhật Khoản thưởng/trợ cấp...");
        setStaffBonuses(parsed.staffBonuses);
        await replaceCollectionFromCloud('staff_bonuses', parsed.staffBonuses);

        setDbStatus("Đang cập nhật Lịch sử chấm công...");
        setTimeLogs(parsed.timeLogs);
        await replaceCollectionFromCloud('time_logs', parsed.timeLogs);

        setDbStatus("Đang cập nhật phiên thanh toán QR...");
        const paymentSessions = parsed.paymentSessions || [];
        await replaceCollectionFromCloud('payment_sessions', paymentSessions);

        const paymentTransactions = parsed.paymentTransactions || [];
        await replaceCollectionFromCloud('payment_transactions', paymentTransactions);

        setDbStatus("Đang cập nhật ghi nhận doanh thu...");
        const staffIncome = parsed.staffIncome || [];
        await replaceCollectionFromCloud('staff_income', staffIncome);

        // 6. Clear local storage caches
        const cacheKeys = [
          'nail_customers',
          'nail_staff',
          'nail_appointments',
          'nail_staff_bonuses',
          'nail_time_logs',
          'nail_services',
          'nail_historical_appointments_cache_v2',
          'nail_historical_appointments_cache_date_v2',
          'nail_historical_appointments_last_sync_time',
          'nail_old_appts_cache',
          'nail_old_appts_cache_date'
        ];
        cacheKeys.forEach(key => localStorage.removeItem(key));

        setDbStatus("🎉 Khôi phục toàn bộ database tiệm nail thành công mượt mà! Đang tải lại ứng dụng...");
        
        setTimeout(() => {
          window.location.reload();
        }, 1200);

      } catch (error) {
        console.error("Error during backup import:", error);
        setDbStatus("⚠️ Tệp sao lưu không hợp lệ, hoặc lỗi đồng bộ đám mây!");
        setTimeout(() => setDbStatus(null), 5000);
      }
    };
  };

  const getContextualClearLabel = () => {
    switch (activeTab) {
      case 'calendar':
        return 'Dọn lịch hẹn';
      case 'customers':
        return 'Dọn khách hàng';
      case 'services':
        return 'Dọn bảng giá';
      case 'staff':
        return 'Dọn nhân sự';
      case 'payroll':
        return 'Xóa thưởng/trợ cấp';
      case 'reports':
        return 'Dọn lịch hẹn';
      default:
        return 'Dọn dữ liệu';
    }
  };

  const getContextualClearTooltip = () => {
    switch (activeTab) {
      case 'calendar':
        return 'Dọn sạch toàn bộ danh sách Lịch hẹn & Booking';
      case 'customers':
        return 'Dọn sạch toàn bộ danh sách Khách hàng';
      case 'services':
        return 'Dọn sạch toàn bộ danh sách Dịch vụ / Bảng giá';
      case 'staff':
        return 'Dọn sạch toàn bộ danh sách Nhân sự / Thợ';
      case 'payroll':
        return 'Xóa toàn bộ các khoản Thưởng thêm / Trợ cấp của nhân viên';
      case 'reports':
        return 'Dọn sạch doanh thu (bằng cách xóa danh sách lịch hẹn liên quan)';
      default:
        return 'Dọn sạch dữ liệu của mục hiện tại';
    }
  };

  const handleClearContextualData = () => {
    let confirmMsg = "";
    let statusMsg = "";
    
    if (activeTab === 'calendar' || activeTab === 'reports') {
      confirmMsg = "🔴 CẢNH BÁO: Thao tác này sẽ dọn sạch toàn bộ danh sách Lịch hẹn & Booking hiện có trên trình duyệt (và cả trên Cloud nếu đã kết nối). Bạn có chắc chắn muốn thực hiện?";
      statusMsg = "✨ Đã dọn sạch toàn bộ danh sách Lịch hẹn & Doanh thu!";
    } else if (activeTab === 'customers') {
      confirmMsg = "🔴 CẢNH BÁO: Thao tác này sẽ xoá toàn bộ danh sách Khách hàng hiện có trên trình duyệt (và cả trên Cloud nếu đã kết nối). Bạn có chắc chắn muốn thực hiện?";
      statusMsg = "✨ Đã dọn sạch danh sách Khách hàng!";
    } else if (activeTab === 'services') {
      confirmMsg = "🔴 CẢNH BÁO: Thao tác này sẽ xoá sạch Bảng giá dịch vụ hiện có để bạn tự cài đặt lại từ đầu. Bạn có chắc chắn muốn thực hiện?";
      statusMsg = "✨ Đã dọn sạch Bảng giá dịch vụ nail!";
    } else if (activeTab === 'staff') {
      confirmMsg = "🔴 CẢNH BÁO: Thao tác này sẽ xoá danh sách Nhân viên hiện có trên trình duyệt (và trên Cloud). Bạn có chắc chắn muốn thực hiện?";
      statusMsg = "✨ Đã dọn sạch danh sách Nhân viên!";
    } else if (activeTab === 'payroll') {
      confirmMsg = "🔴 CẢNH BÁO: Thao tác này sẽ xoá sạch danh sách các khoản Thưởng thêm & Trợ cấp của nhân viên. Bạn có chắc chắn muốn thực hiện?";
      statusMsg = "✨ Đã xóa toàn bộ lịch sử Thưởng thêm & Trợ cấp!";
    } else {
      confirmMsg = "🔴 Bạn có chắc chắn muốn dọn dữ liệu hiện tại?";
      statusMsg = "✨ Đã dọn dữ liệu!";
    }

    if (window.confirm(confirmMsg)) {
      if (activeTab === 'calendar' || activeTab === 'reports') {
        localStorage.removeItem('nail_appointments');
        localStorage.removeItem('nail_old_appts_cache');
        localStorage.removeItem('nail_old_appts_cache_date');
        appointments.forEach(item => {
          cloudDelete('appointments', item.id, item.date);
        });
        setAppointments([]);
      } else if (activeTab === 'customers') {
        localStorage.removeItem('nail_customers');
        customers.forEach(item => {
          cloudDelete('customers', item.id);
        });
        setCustomers([]);
      } else if (activeTab === 'services') {
        localStorage.removeItem('nail_services');
        services.forEach(item => {
          cloudDelete('services', item.id);
        });
        setServices([]);
      } else if (activeTab === 'staff') {
        localStorage.removeItem('nail_staff');
        staff.forEach(item => {
          cloudDelete('staff', item.id);
        });
        setStaff([]);
      } else if (activeTab === 'payroll') {
        localStorage.removeItem('nail_staff_bonuses');
        staffBonuses.forEach(item => {
          cloudDelete('staff_bonuses', item.id);
        });
        setStaffBonuses([]);
      }
      
      setDbStatus(statusMsg);
      setTimeout(() => setDbStatus(null), 4000);
    }
  };

  const handleClaimAppointment = async (apptId: string, sId: string, sName: string) => {
    try {
      // 1. Ghi thẳng lên Firestore — đảm bảo server đọc được khi autoSettle chạy
      const dbInstance = getDb();
      if (!dbInstance) {
        throw new Error("Không thể kết nối đến cơ sở dữ liệu");
      }
      const apptRef = doc(dbInstance, 'appointments', apptId);
      await updateDoc(apptRef, {
        staffId: sId,
        staffName: sName,
        updatedAt: new Date().toISOString()
      });

      // 2. Cập nhật local state như cũ
      setAppointments(prev => {
        const updated = prev.map(appt => {
          if (appt.id === apptId) {
            return { ...appt, staffId: sId, staffName: sName };
          }
          return appt;
        });
        localStorage.setItem('nail_appointments', JSON.stringify(updated));
        return updated;
      });

      setDbStatus("💅 Bạn đã nhận đơn phục vụ nail thành công!");
      setTimeout(() => setDbStatus(null), 4000);

    } catch (e) {
      console.error('[claimAppointment] Lỗi ghi Firestore:', e);
      setDbStatus("❌ Lỗi nhận việc, vui lòng thử lại");
      setTimeout(() => setDbStatus(null), 3000);
    }
  };

  // 1. Unauthenticated Login Guard screen
  if (!currentUser) {
    return (
      <div id="login-screen-guard" className="min-h-screen bg-background font-sans text-foreground flex items-center justify-center p-4 relative overflow-hidden">
        {/* Visual background gradient accents */}
        <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-[#f7edea] to-transparent pointer-events-none z-0"></div>
        <div className="absolute -top-12 -left-12 w-64 h-64 bg-accent text-accent-foreground/10 rounded-full blur-2xl"></div>
        <div className="absolute -bottom-12 -right-12 w-64 h-64 bg-muted/20 rounded-full blur-2xl"></div>

        <div className="relative z-10 w-full max-w-md bg-white rounded-lg border border-border p-8 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <span className="p-4 bg-muted rounded-lg text-accent inline-flex border border-border shadow-sm mb-2">
              <Cat className="w-8 h-8" />
            </span>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
              nailby.ank
            </h1>
            <p className="text-sm text-muted-foreground font-medium uppercase tracking-widest leading-relaxed">
              Hệ thống Quản lý Viện Móng Cao Cấp
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider pl-1 font-sans">
                Tài khoản hoặc Email đăng nhập
              </label>
              <input
                type="text"
                placeholder="Ví dụ: admin@tiemnail.com"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-4 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-[var(--accent)] focus:bg-white transition-all outline-hidden font-sans"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider pl-1 font-sans">
                Mật khẩu bảo mật
              </label>
              <input
                type="password"
                placeholder="Nhập mật khẩu..."
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-4 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-[var(--accent)] focus:bg-white transition-all outline-hidden font-mono"
                required
              />
            </div>

            {loginErr && (
              <p className="p-3 bg-muted text-accent border border-muted rounded-md text-sm font-semibold text-center leading-relaxed">
                {loginErr}
              </p>
            )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 bg-accent text-accent-foreground hover:bg-accent-secondary text-white rounded-md text-sm font-bold transition-all shadow-sm cursor-pointer tracking-wider uppercase mt-2 min-h-[44px] touch-manipulation disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoggingIn ? 'Đang xác thực...' : 'Đăng nhập ngay'}
            </button>
          </form>

          <div className="border-t border-dashed border-border pt-4 text-[10px] text-muted-foreground space-y-1.5 text-center leading-relaxed font-sans">
            <p>* Kỹ thuật viên (Thợ): Admin trực tiếp cấp phát credential trong tab Nhân sự</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Authenticated Dashboard Layout
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* Visual background gradient accents */}
      <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-[#f7edea] to-transparent pointer-events-none z-0"></div>

      {/* Primary Header Section */}
      <header className="relative z-35 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-5">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 border-b border-border pb-4">
          <div className="flex flex-col gap-4">
            <h1 className="font-sans text-3xl md:text-4xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5 lowercase">
              <Cat className="w-8 h-8 text-accent opacity-80" />
              nailby.ank
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-1 small-caps text-muted-foreground">
              <span>Hanoi Base</span>
              <span className="text-border">•</span>
              <span className="text-accent">
                {currentUser.role === 'admin' 
                  ? 'Quản Trị' 
                  : currentUser.role === 'support' 
                  ? 'Hỗ Trợ' 
                  : 'Kỹ Thuật Viên'}
              </span>
              <span className="text-border">•</span>
              <span>
                {currentUser.name}
              </span>
            </div>
          </div>

          {/* Compact Settings Cog Dropdown in the corner */}
          <div className="relative z-50 flex items-center gap-3">
            {dbStatus && (
              <p className="hidden sm:inline-block text-[10px] font-bold text-accent bg-card px-3 py-1 border border-border shadow-sm small-caps">
                {dbStatus}
              </p>
            )}

            <div className="relative">
              <button
                type="button"
                id="btn-settings-toggle"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className="px-3 py-2 bg-transparent hover:bg-muted border border-border text-foreground text-sm font-medium flex items-center gap-2 transition-all cursor-pointer min-h-[40px]"
                title="Thiết lập hệ thống & Quản trị"
              >
                <Settings className={`w-4 h-4 text-muted-foreground transition-transform duration-500 ${isSettingsOpen ? 'rotate-90' : ''}`} />
                <span className="small-caps">Cài đặt</span>
              </button>

              {isSettingsOpen && (
                <>
                  {/* Backdrop */}
                  <div 
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setIsSettingsOpen(false)}
                  />
                  
                  {/* Floating Compact Settings Panel */}
                  <div className="absolute left-0 md:left-auto md:right-0 mt-2 w-80 max-h-[calc(100vh-6rem)] overflow-y-auto bg-white rounded-lg border border-border p-4 shadow-xl z-50 font-sans space-y-3 text-left animate-fade-in">
                    <div className="pb-2 border-b border-border flex justify-between items-center">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground font-mono">
                        Cài đặt
                      </span>
                      {dbStatus && (
                        <p className="sm:hidden text-[9px] font-bold text-accent">
                          {dbStatus}
                        </p>
                      )}
                    </div>

                    <section className="rounded-md border border-border overflow-hidden">
                      <div className="px-3 py-2 border-b border-border bg-muted/30">
                        <p className="text-[10px] font-extrabold uppercase tracking-widest text-foreground font-mono">Thiết lập nhanh</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Thông báo và âm thanh cho lịch mới</p>
                      </div>
                      <div className="p-3 space-y-2.5">
                      {/* Notification Control Panel */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            🔔 Thông báo đẩy (Push)
                          </span>
                          <span className={`inline-block px-1.5 py-0.5 rounded-sm font-mono text-[9px] font-extrabold uppercase ${
                            pushPermission === 'granted' 
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                              : 'bg-muted text-accent border border-muted'
                          }`}>
                            {pushPermission === 'granted' ? 'Đã bật' : 'Chưa bật'}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            const perm = await requestNotificationPermission();
                            setPushPermission(perm);
                            if (perm === 'granted') {
                              await registerServiceWorkerAndSubscribe(currentUser?.role, currentUser?.name);
                              triggerPushNotification("🎉 nailby.ank Hoạt Động!", "Tính năng thông báo đẩy đã sẵn sàng hoạt động!", "nailby-ank-test");
                            } else {
                              alert("Yêu cầu thông báo bị từ chối hoặc chưa được cấp phép. Nếu dùng iOS/iPad, vui lòng xem hướng dẫn cài đặt ở dưới.");
                            }
                          }}
                          className={`w-full p-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 ${
                            pushPermission === 'granted'
                              ? 'bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800'
                              : 'bg-accent text-accent-foreground hover:bg-accent text-accent-foreground border border-border text-white'
                          }`}
                        >
                          <span>Kích Hoạt Nhận Thông Báo</span>
                        </button>

                        <p className="text-[11px] text-muted-foreground leading-relaxed">Cần hỗ trợ iPhone/iPad? Hãy thêm ứng dụng vào Màn hình chính trước khi bật thông báo.</p>

                        <div className="hidden">
                          <p className="font-extrabold text-accent uppercase text-[9px] tracking-wider mb-1">
                            📱 HƯỚNG DẪN BẬT (MOBILE / TABLET):
                          </p>
                          <div className="bg-white/60 p-2 rounded-lg border border-border space-y-1">
                            <p className="font-medium text-foreground">
                              <span className="font-bold text-accent">iOS (iPhone/iPad Safari):</span>
                            </p>
                            <ol className="list-decimal pl-3.5 space-y-0.5 text-muted-foreground text-[10px]">
                              <li>Mở Safari, nhấn nút <span className="font-semibold text-foreground">Chia sẻ (Share)</span>.</li>
                              <li>Chọn <span className="font-semibold text-foreground">"Thêm vào MH chính"</span>.</li>
                              <li>Mở ứng dụng từ Màn hình chính đã lưu, vào <span className="font-semibold text-foreground">Thiết lập</span>, rồi bấm nút bật ở trên.</li>
                            </ol>
                          </div>
                          <div className="bg-white/60 p-2 rounded-lg border border-border space-y-1">
                            <p className="font-medium text-foreground">
                              <span className="font-bold text-accent">Android (Chrome):</span>
                            </p>
                            <p className="text-muted-foreground pl-1 text-[10px]">
                              Bấm nút <span className="font-semibold text-foreground">"Kích Hoạt Nhận Thông Báo"</span> ở trên và chọn <span className="font-semibold text-foreground">"Cho phép"</span>.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Sound Alarm Test Button */}
                      <button
                        onClick={() => playLoudNotificationSound()}
                        className="w-full p-2 bg-rose-550/10 hover:bg-accent/15 border border-border text-foreground rounded-md text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 font-sans"
                        title="Kiểm tra thử âm thanh chuông khi có thông báo đơn mới"
                      >
                        <span>Kiểm tra âm thanh</span>
                      </button>
                      </div>
                    </section>

                    {/* Only for staff & support: Compact Sửa mật khẩu / SĐT */}
                    {(currentUser?.role === 'staff' || currentUser?.role === 'support') && (
                      <div className="pt-2.5 border-t border-border space-y-2.5">
                        <p className="text-[9px] font-bold text-accent pl-1 font-mono uppercase tracking-wider">
                          🔐 TÀI KHOẢN CÁ NHÂN
                        </p>
                        <div className="space-y-1.5 text-sm">
                          <div>
                            <label className="block text-[9px] font-bold text-muted-foreground mb-0.5 pl-1">SĐT liên hệ</label>
                            <input
                              type="tel"
                              required
                              value={staffPhone}
                              onChange={(e) => setStaffPhone(e.target.value)}
                              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground text-sm focus:bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-muted-foreground mb-0.5 pl-1">Tên đăng nhập</label>
                            <input
                              type="text"
                              required
                              value={staffUsername}
                              onChange={(e) => setStaffUsername(e.target.value)}
                              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground text-sm focus:bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-muted-foreground mb-0.5 pl-1">Mật khẩu mới</label>
                            <input
                              type="text"
                              required
                              value={staffPassword}
                              onChange={(e) => setStaffPassword(e.target.value)}
                              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-foreground text-sm focus:bg-white font-mono font-bold"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (!currentUser?.staffId) return;
                              handleUpdateStaff(currentUser.staffId, {
                                phone: staffPhone.trim(),
                                username: staffUsername.trim(),
                                password: staffPassword.trim()
                              });
                              setDbStatus("✨ Đã cập nhật tài khoản!");
                              setTimeout(() => setDbStatus(null), 3000);
                            }}
                            className="w-full mt-1.5 py-2 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-md text-sm font-bold transition-all cursor-pointer shadow-sm active:scale-95 text-center"
                          >
                            Xác nhận Thay đổi ✓
                          </button>
                        </div>
                      </div>
                    )}

                    {currentUser.role === 'admin' && (
                      <div className="pt-2.5 border-t border-border space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setIsAdminSectionExpanded(!isAdminSectionExpanded)}
                          className="w-full flex justify-between items-center text-[9px] font-bold text-muted-foreground pl-1 font-mono uppercase tracking-wider cursor-pointer py-1 hover:text-foreground transition-colors"
                        >
                          <span className="flex items-center gap-1.5">Quản trị cửa hàng</span>
                          <span className="font-sans text-sm">{isAdminSectionExpanded ? '▼' : '▲'}</span>
                        </button>

                        {isAdminSectionExpanded && (
                          <div className="space-y-1.5 pt-1 animate-fade-in">
                            <PromotionCodeManagement currentUser={currentUser} />
                            <div className="bg-background border border-border p-3 rounded-md space-y-2.5 mb-2">
                              <p className="text-[9px] font-bold text-accent font-mono uppercase tracking-wider">
                                🏦 THANH TOÁN & NGÂN HÀNG (QR)
                              </p>
                              <div className="space-y-2 text-sm">
                                <div>
                                  <label className="block text-[9px] font-bold text-muted-foreground mb-0.5">Chọn Ngân Hàng Nhận Tiền</label>
                                  <select
                                    value={POPULAR_BANKS.some(b => b.code === systemSettings?.bankId) ? (systemSettings?.bankId || '') : (systemSettings?.bankId ? 'custom' : '')}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'custom') {
                                        setSystemSettings(s => ({ ...s, bankId: 'CUSTOM' }));
                                      } else {
                                        setSystemSettings(s => ({ ...s, bankId: val }));
                                      }
                                    }}
                                    className="w-full bg-white border border-border rounded-md px-2 py-1.5 focus:border-accent outline-hidden"
                                  >
                                    <option value="">-- Chọn ngân hàng --</option>
                                    {POPULAR_BANKS.map((bank) => (
                                      <option key={bank.code} value={bank.code}>
                                        {bank.name}
                                      </option>
                                    ))}
                                    <option value="custom">Khác (Nhập mã thủ công)</option>
                                  </select>
                                </div>
                                {(!POPULAR_BANKS.some(b => b.code === systemSettings?.bankId) || systemSettings?.bankId === 'CUSTOM') && (
                                  <div className="animate-fade-in pt-1">
                                    <label className="block text-[9px] font-bold text-muted-foreground mb-0.5">Mã viết tắt Ngân hàng khác (VietQR Code)</label>
                                    <input
                                      type="text"
                                      value={systemSettings?.bankId === 'CUSTOM' ? '' : (systemSettings?.bankId || '')}
                                      onChange={(e) => setSystemSettings(s => ({ ...s, bankId: e.target.value.toUpperCase() }))}
                                      className="w-full bg-white border border-border rounded-md px-2 py-1.5 focus:border-accent outline-hidden font-mono"
                                      placeholder="Ví dụ: ICB, KLB, MB, VCB..."
                                    />
                                    <p className="text-[10px] text-amber-600 mt-1 leading-normal">
                                      ⚠️ Nhập chính xác mã VietQR của ngân hàng. <br/>
                                      Ví dụ: VietinBank bắt buộc nhập <strong className="font-bold">ICB</strong>, Kienlongbank bắt buộc nhập <strong className="font-bold">KLB</strong>. Nhập "Vietinbank" hoặc "KienlongBank" sẽ lỗi QR.
                                    </p>
                                  </div>
                                )}
                                <div>
                                  <label className="block text-[9px] font-bold text-muted-foreground mb-0.5">Số Tài Khoản</label>
                                  <input
                                    type="text"
                                    value={systemSettings?.bankAccountNumber || ''}
                                    onChange={(e) => setSystemSettings(s => ({ ...s, bankAccountNumber: e.target.value }))}
                                    className="w-full bg-white border border-border rounded-md px-2 py-1.5 focus:border-accent outline-hidden"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[9px] font-bold text-muted-foreground mb-0.5">Tên Chủ Tài Khoản</label>
                                  <input
                                    type="text"
                                    value={systemSettings?.bankAccountName || ''}
                                    onChange={(e) => setSystemSettings(s => ({ ...s, bankAccountName: e.target.value.toUpperCase() }))}
                                    className="w-full bg-white border border-border rounded-md px-2 py-1.5 focus:border-accent outline-hidden"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await setDoc(doc(getDb()!, 'system', 'settings'), systemSettings);
                                      setDbStatus("✨ Đã lưu thông tin ngân hàng!");
                                      setTimeout(() => setDbStatus(null), 3000);
                                    } catch (e) {
                                      console.error("Save error", e);
                                    }
                                  }}
                                  className="w-full mt-2 py-1.5 bg-accent text-white rounded-md text-xs font-bold shadow-sm active:scale-95"
                                >
                                  Lưu Thông Tin Ngân Hàng
                                </button>
                              </div>
                            </div>

                            <p className="pt-1 text-[9px] font-bold text-muted-foreground font-mono uppercase tracking-wider">Dữ liệu & sao lưu</p>

                            <button
                              onClick={() => {
                                handleExportData();
                                setIsSettingsOpen(false);
                              }}
                              className="w-full p-2 bg-white hover:bg-card hover:bg-muted border border-border text-foreground hover:text-foreground rounded-md text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                              title="Tải tệp sao lưu dữ liệu (.json)"
                            >
                              <Download className="w-3.5 h-3.5 text-accent" /> Sao lưu dữ liệu
                            </button>

                            <label className="w-full p-2 bg-accent text-accent-foreground/5 hover:bg-accent text-accent-foreground/10 border border-border text-foreground rounded-md text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm font-sans">
                              <Upload className="w-3.5 h-3.5 text-accent" /> Khôi phục
                              <input
                                type="file"
                                accept=".json"
                                onChange={(e) => {
                                  handleImportData(e);
                                  setIsSettingsOpen(false);
                                }}
                                className="hidden"
                              />
                            </label>

                            <div className="space-y-1.5 border border-indigo-100 bg-indigo-50/50 p-2.5 rounded-md">
                              <span className="text-xs font-semibold text-indigo-900 flex items-center gap-1">
                                <Database className="w-3.5 h-3.5 text-indigo-600" /> Đồng bộ từ tệp backup:
                              </span>
                              {backupFiles.length > 0 ? (
                                <div className="space-y-1.5">
                                  <select
                                    value={selectedBackupFile}
                                    onChange={(e) => setSelectedBackupFile(e.target.value)}
                                    className="w-full text-xs p-1.5 border border-indigo-200 bg-white rounded-md text-foreground outline-hidden focus:ring-1 focus:ring-indigo-400"
                                  >
                                    {backupFiles.map((file) => (
                                      <option key={file} value={file}>
                                        {file}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={async () => {
                                      if (!selectedBackupFile) return;
                                      if (window.confirm(`🔴 Bạn có chắc chắn muốn nạp dữ liệu từ file sao lưu "${selectedBackupFile}"? Thao tác này sẽ ghi đè và thay thế toàn bộ dữ liệu hiện tại trên Firestore.`)) {
                                        setDbStatus("Đang ghi đè dữ liệu từ bản sao lưu lên Firestore... Vui lòng đợi!");
                                        setIsSettingsOpen(false);
                                        try {
                                          const response = await fetch("/api/import-server-backup", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json", ...getAuthHeaders(currentUser) },
                                            body: JSON.stringify({ fileName: selectedBackupFile })
                                          });
                                          const resData = await response.json();
                                          if (response.ok && resData.success) {
                                            // Clear local caches to trigger full reload
                                            const keysToClear = [
                                              'nail_customers',
                                              'nail_staff',
                                              'nail_appointments',
                                              'nail_staff_bonuses',
                                              'nail_time_logs',
                                              'nail_services',
                                              'nail_admin_accounts',
                                              'nail_historical_appointments_cache_v2',
                                              'nail_historical_appointments_cache_date_v2',
                                              'nail_historical_appointments_last_sync_time',
                                              'nail_old_appts_cache',
                                              'nail_old_appts_cache_date'
                                            ];
                                            keysToClear.forEach(key => localStorage.removeItem(key));
                                            
                                            setDbStatus("🎉 Ghi đè database thành công! Đang tải lại...");
                                            setTimeout(() => {
                                              window.location.reload();
                                            }, 2000);
                                          } else {
                                            throw new Error(resData.error || "Lỗi không xác định");
                                          }
                                        } catch (error: any) {
                                          alert("Lỗi khi ghi đè dữ liệu: " + error.message);
                                          setDbStatus(null);
                                        }
                                      }
                                    }}
                                    className="w-full p-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border border-indigo-300 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                                  >
                                    Đồng bộ từ tệp backup
                                  </button>
                                </div>
                              ) : (
                                <div className="text-[11px] text-indigo-600 bg-white p-2 rounded border border-indigo-100 leading-normal">
                                  Chưa có tệp sao lưu .json nào trong thư mục <strong>/backups</strong>. Bạn có thể sử dụng trình quản lý mã nguồn để tải tệp .json lên đây.
                                </div>
                              )}
                            </div>

                            <button
                              onClick={() => {
                                handleClearContextualData();
                                setIsSettingsOpen(false);
                              }}
                              className="w-full p-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-md text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs font-sans active:scale-95"
                              title={getContextualClearTooltip()}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-600" /> {getContextualClearLabel()}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-2.5 border-t border-border">
                      <button
                        onClick={() => {
                          handleLogout();
                          setIsSettingsOpen(false);
                        }}
                        className="w-full p-2 bg-foreground hover:bg-zinc-800 text-white rounded-md text-sm font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md font-sans active:scale-95"
                      >
                        <LogOut className="w-3.5 h-3.5 text-white" /> Đăng xuất
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Navigation Options */}
      <main className="relative w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
        {currentUser.role === 'admin' && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2 -mx-1 px-1">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'calendar'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <Calendar className="w-4 h-4" /> Lịch & Đơn
            </button>
            
            <button
              onClick={() => setActiveTab('customers')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'customers'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <Users className="w-4 h-4" /> Khách hàng
            </button>

            <button
              onClick={() => setActiveTab('payroll')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'payroll'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <Wallet className="w-4 h-4" /> Bảng Lương
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'reports'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <BarChart3 className="w-4 h-4" /> Doanh thu
            </button>

            <button
              onClick={() => setActiveTab('services')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'services'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <Scissors className="w-4 h-4" /> Dịch vụ
            </button>

            <button
              onClick={() => setActiveTab('staff')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'staff'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <UserCog className="w-4 h-4" /> Nhân sự
            </button>
          </div>
        )}

        {(currentUser.role === 'staff' || currentUser.role === 'support') && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2 -mx-1 px-1">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'calendar'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <Calendar className="w-4 h-4" /> Lịch & Đơn
            </button>
            <button
              onClick={() => setActiveTab('income')}
              className={`small-caps whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer px-2.5 py-2 border-b-2 ${
                activeTab === 'income'
                  ? 'text-foreground border-accent'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              }`}
            >
              <Wallet className="w-4 h-4" /> Ví của tôi (Thu Nhập)
            </button>
          </div>
        )}

        {/* Tab content areas */}
        <div className="min-h-[400px]">
          <React.Suspense fallback={<div className="grid min-h-[320px] place-items-center text-sm font-semibold text-muted-foreground">Đang tải màn hình...</div>}>
          {activeTab === 'calendar' && (
            <AppointmentCalendar
              appointments={appointments}
              customers={customers}
              staff={staff}
              services={services}
              systemSettings={systemSettings}
              onAddAppointment={handleAddAppointment}
              onUpdateStatus={handleUpdateStatus}
              currentUser={currentUser}
              onClaimAppointment={handleClaimAppointment}
              onAddExtraService={handleAddExtraService}
              onRemoveExtraService={handleRemoveExtraService}
              onUpdateAppointment={handleUpdateAppointment}
              onUpdateCustomer={handleUpdateCustomer}
              onInvalidateHistoricalCache={handleInvalidateHistoricalCache}
            />
          )}

          {activeTab === 'customers' && (
            <CustomerDirectory
              customers={customers}
              appointments={appointments}
              onAddCustomer={handleAddCustomer}
              onUpdateCustomer={handleUpdateCustomer}
              onDeleteCustomer={handleDeleteCustomer}
            />
          )}

          {activeTab === 'payroll' && (
            <StaffPayroll
              staffList={staff}
              appointments={appointments}
              services={services}
              onAddStaff={handleAddStaff}
              staffBonuses={staffBonuses}
              onAddStaffBonus={handleAddStaffBonus}
              onDeleteStaffBonus={handleDeleteStaffBonus}
              timeLogs={timeLogs}
              onSettleStaffPayroll={handleSettleStaffPayroll}
              onUpdateTimeLog={handleUpdateTimeLog}
              onDeleteTimeLog={handleDeleteTimeLog}
            />
          )}

          {activeTab === 'reports' && (
            <ReportDashboard
              appointments={appointments}
              services={services}
            />
          )}

          {activeTab === 'services' && (
            <ServiceManagement
              services={services}
              onAddService={handleAddService}
              onUpdateService={handleUpdateService}
              onDeleteService={handleDeleteService}
              onResetServices={handleResetServices}
            />
          )}

          {activeTab === 'staff' && (
            <StaffManagement
              staffList={staff}
              onAddStaff={handleAddStaff}
              onUpdateStaff={handleUpdateStaff}
              onDeleteStaff={handleDeleteStaff}
              adminAccounts={adminAccounts}
              onAddAdmin={(newAdmin) => setAdminAccounts(prev => [...prev, { ...newAdmin, id: 'admin_' + Date.now() }])}
              onUpdateAdmin={(id, updated) => setAdminAccounts(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a))}
              onDeleteAdmin={(id) => setAdminAccounts(prev => prev.filter(a => a.id !== id))}
            />
          )}

          {activeTab === 'income' && (currentUser?.role === 'staff' || currentUser?.role === 'support') && (
            <MyIncomeView
              currentStaffId={currentUser.staffId!}
              staffList={staff}
              appointments={appointments}
              services={services}
              staffBonuses={staffBonuses}
              timeLogs={timeLogs}
              onCheckIn={handleCheckIn}
              onCheckOut={handleCheckOut}
            />
          )}
          </React.Suspense>
        </div>
      </main>

      {/* Fine-crafted footer */}
      <footer className="py-4 border-t border-border/50 text-center text-xs text-muted-foreground">
        <p>nailby.ank System</p>
      </footer>
    </div>
  );
}
