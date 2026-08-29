import { initializeApp, getApp, getApps, deleteApp, type FirebaseApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  deleteDoc,
  type Firestore, 
  getDocFromServer,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  Timestamp,
  writeBatch
} from "firebase/firestore";
import appletConfig from "../../../../../infra/firebase/firebase-applet-config.json";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseURL?: string;
  measurementId?: string;
  firestoreDatabaseId?: string;
}

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: (appletConfig as any).apiKey || "AIzaSyBbFY4k_vLxYQZq8TNu93aj4hc7jC2qvjA",
  authDomain: (appletConfig as any).authDomain || "nailmanager-1802c.firebaseapp.com",
  projectId: (appletConfig as any).projectId || "nailmanager-1802c",
  storageBucket: (appletConfig as any).storageBucket || "nailmanager-1802c.firebasestorage.app",
  messagingSenderId: (appletConfig as any).messagingSenderId || "163961583971",
  appId: (appletConfig as any).appId || "1:163961583971:web:fa02ca48af04ecd4b1fb56",
  databaseURL: (appletConfig as any).databaseURL || "https://nailmanager-1802c-default-rtdb.asia-southeast1.firebasedatabase.app",
  measurementId: (appletConfig as any).measurementId || "G-DCYKN33KVW",
  firestoreDatabaseId: undefined // Enforce connecting to the "default" database
};

export const clientSessionId = "session_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

// Global logger matching system specification
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;

export function isUsingCustomFirebaseConfig(): boolean {
  return localStorage.getItem("nail_firebase_config_is_custom") === "true";
}

export function getCustomFirebaseConfig(): FirebaseConfig | null {
  if (!isUsingCustomFirebaseConfig()) {
    return DEFAULT_FIREBASE_CONFIG;
  }
  
  const saved = localStorage.getItem("nail_firebase_config");
  if (!saved) {
    return DEFAULT_FIREBASE_CONFIG;
  }
  try {
    const config = JSON.parse(saved);
    if (config.apiKey && config.projectId) {
      // If the custom config has a different projectId than DEFAULT_FIREBASE_CONFIG,
      // it means we just updated DEFAULT_FIREBASE_CONFIG.
      // We should wipe the custom config to let it fall back to the new default!
      if (config.projectId !== DEFAULT_FIREBASE_CONFIG.projectId) {
        localStorage.removeItem("nail_firebase_config");
        localStorage.removeItem("nail_firebase_config_is_custom");
        return DEFAULT_FIREBASE_CONFIG;
      }
      return config as FirebaseConfig;
    }
  } catch (e) {
    console.error("Failed to parse custom firebase config:", e);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

export function saveCustomFirebaseConfig(config: FirebaseConfig | null) {
  if (!config) {
    localStorage.removeItem("nail_firebase_config");
    localStorage.removeItem("nail_firebase_config_is_custom");
  } else {
    localStorage.setItem("nail_firebase_config", JSON.stringify(config));
    localStorage.setItem("nail_firebase_config_is_custom", "true");
  }
}

export function initializeFirebase(force: boolean = false): { app: FirebaseApp; db: Firestore } | null {
  const config = getCustomFirebaseConfig();
  if (!config) return null;

  // Clear local cache if the connected database projectId changes to force refetching fresh data
  const lastProject = localStorage.getItem("nail_last_connected_project_id");
  if (lastProject && lastProject !== config.projectId) {
    console.log(`Database project changed from ${lastProject} to ${config.projectId}. Clearing local cache...`);
    const keysToClear = [
      'nail_customers',
      'nail_staff',
      'nail_appointments',
      'nail_staff_bonuses',
      'nail_time_logs',
      'nail_services',
      'nail_admin_accounts',
      'nail_historical_appointments_cache',
      'nail_historical_appointments_cache_date',
      'nail_historical_appointments_last_sync_time',
      'nail_old_appts_cache',
      'nail_old_appts_cache_date',
      'nail_current_user_session'
    ];
    keysToClear.forEach(key => localStorage.removeItem(key));
  }
  localStorage.setItem("nail_last_connected_project_id", config.projectId);

  try {
    const apps = getApps();
    
    // If not forcing reinitialization and we already have an app initialized
    if (apps.length > 0 && !force) {
      firebaseApp = apps[0];
      if (!firestoreDb) {
        try {
          firestoreDb = initializeFirestore(firebaseApp, {
            experimentalForceLongPolling: true,
            localCache: persistentLocalCache({
              tabManager: persistentMultipleTabManager()
            })
          });
        } catch (e) {
          try {
            firestoreDb = initializeFirestore(firebaseApp, {
              experimentalForceLongPolling: true
            });
          } catch (err) {
            firestoreDb = getFirestore(firebaseApp);
          }
        }
      }
      return { app: firebaseApp, db: firestoreDb };
    }

    // Force or no existing app - clean up previous app instances if any
    for (const existingApp of apps) {
      deleteApp(existingApp).catch(e => console.warn("Stale app tear down deferred:", e));
    }

    firebaseApp = initializeApp(config);
    
    try {
      firestoreDb = initializeFirestore(firebaseApp, {
        experimentalForceLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
    } catch (e) {
      console.warn("Could not initialize persistentLocalCache, falling back on initializeFirestore without cache:", e);
      try {
        firestoreDb = initializeFirestore(firebaseApp, {
          experimentalForceLongPolling: true
        });
      } catch (err) {
        firestoreDb = getFirestore(firebaseApp);
      }
    }
    
    return { app: firebaseApp, db: firestoreDb };
  } catch (error) {
    console.error("Failed to initialize Firebase with custom config:", error);
    return null;
  }
}

// Get raw DB instance
export function getDb(): Firestore | null {
  if (!firestoreDb) {
    const init = initializeFirebase(false);
    if (init) {
      firestoreDb = init.db;
    }
  }
  return firestoreDb;
}

export interface ConnectionResult {
  success: boolean;
  error?: string;
}

// Test connectivity according to critical skill guidelines
export async function testFirebaseConnection(): Promise<ConnectionResult> {
  const db = getDb();
  if (!db) return { success: false, error: "Chưa cấu hình cơ sở dữ liệu" };
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { success: true };
  } catch (error: any) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Connection check failed with error detail:", error);
    
    // Check if the service was reached
    if (errMsg.includes('Database does not exist') || errMsg.includes('not-found')) {
      return { 
        success: false, 
        error: "Project ID sai hoặc bạn chưa tạo 'Firestore Database' trên Firebase Console! Vui lòng vào mục Build > Firestore Database và nhấn 'Create database'." 
      };
    }
    
    if (errMsg.includes('permission-denied')) {
      // Permission denied means we connected to the database successfully, but security rules blocked it (which is fine for connection test!)
      return { success: true };
    }

    if (errMsg.includes('offline') || errMsg.includes('network') || errMsg.includes('failed-precondition')) {
      return { 
        success: false, 
        error: "Không thể kết nối mạng tới Firestore. Vui lòng kiểm tra mạng hoặc cho phép bên thứ ba chạy (third-party/cookies) trên trình duyệt." 
      };
    }

    return { success: false, error: errMsg };
  }
}

// Helper to remove any undefined values recursively to prevent JS SDK validation failures
function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => cleanUndefined(item)) as unknown as T;
  }
  if (typeof obj === "object") {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = (obj as any)[key];
      if (val !== undefined) {
        cleaned[key] = cleanUndefined(val);
      }
    }
    return cleaned as T;
  }
  return obj;
}

// Firestore Collection Synchronization Utilities
const pendingSignals = new Map<string, { timeoutId: any; operation: 'upsert' | 'delete' }>();

export async function triggerSyncSignal(
  collectionName: string,
  documentId?: string,
  operation: 'upsert' | 'delete' = 'upsert'
): Promise<void> {
  if (collectionName === 'system') return;
  const db = getDb();
  if (!db) return;

  if (!documentId) {
    try {
      const syncRef = doc(db, 'system', 'sync_status');
      const payload = {
        collectionName,
        updatedAt: serverTimestamp(),
        senderId: clientSessionId
      };
      await setDoc(syncRef, {
        [collectionName]: payload
      }, { merge: true });
    } catch (error) {
      console.warn("Failed to trigger generic sync signal:", error);
    }
    return;
  }

  const key = `${collectionName}|${documentId}`;
  if (pendingSignals.has(key)) {
    clearTimeout(pendingSignals.get(key)!.timeoutId);
  }

  const performWrite = async () => {
    pendingSignals.delete(key);
    try {
      const syncRef = doc(db, 'system', 'sync_status');
      const payload = {
        collectionName,
        documentId,
        operation,
        updatedAt: serverTimestamp(),
        senderId: clientSessionId
      };
      await setDoc(syncRef, {
        [collectionName]: payload
      }, { merge: true });
      console.log(`[SyncTracker] Fired sync signal for ${collectionName}/${documentId} (${operation})`);
    } catch (error) {
      console.warn("Failed to trigger debounced sync signal:", error);
    }
  };

  const timeoutId = setTimeout(performWrite, 400);
  pendingSignals.set(key, { timeoutId, operation });
}

export async function syncCollectionToCloud<T extends { id: string }>(
  collectionName: string, 
  data: T[]
): Promise<void> {
  const db = getDb();
  if (!db) return;

  for (const item of data) {
    try {
      const docRef = doc(db, collectionName, item.id);
      const sanitized = cleanUndefined(item);
      await setDoc(docRef, sanitized);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${item.id}`);
    }
  }
  // Trigger sync signal once after full array is synchronized
  await triggerSyncSignal(collectionName);
}

const fetchPromises: Record<string, Promise<any>> = {};

export async function fetchCollectionFromCloud<T>(
  collectionName: string
): Promise<T[]> {
  // Use high-performance Express memory cache proxy for static/rarely altered tables (services and staff)
  if (collectionName === 'services' || collectionName === 'staff') {
    try {
      const response = await fetch(`/api/${collectionName}`);
      if (response.ok) {
        const list = await response.json();
        if (Array.isArray(list)) {
          console.log(`[Cache Proxy Hit] Loaded collection '${collectionName}' via server RAM proxy (0 Firestore reads)`);
          return list as T[];
        }
      }
    } catch (e) {
      console.warn(`[Cache Backup Fallback] Failed fetching cached REST API for '${collectionName}', running direct SDK query:`, e);
    }
  }

  if (fetchPromises[collectionName]) {
    return fetchPromises[collectionName];
  }

  const db = getDb();
  if (!db) return [];

  const promise = (async () => {
    try {
      const colRef = collection(db, collectionName);
      const snapshot = await getDocs(colRef);
      return snapshot.docs.map(d => ({ ...d.data() }) as T);
    } catch (error: any) {
      if (error?.message?.includes("Target ID already exists")) {
        console.warn(`[Firestore] Target ID exists for ${collectionName}. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const colRef = collection(db, collectionName);
          const snapshot = await getDocs(colRef);
          return snapshot.docs.map(d => ({ ...d.data() }) as T);
        } catch (retryError) {
          handleFirestoreError(retryError, OperationType.LIST, collectionName);
          return [];
        }
      }
      handleFirestoreError(error, OperationType.LIST, collectionName);
      return [];
    } finally {
      delete fetchPromises[collectionName];
    }
  })();

  fetchPromises[collectionName] = promise;
  return promise;
}

function getLocalTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function saveDocToCloud<T extends { id: string }>(
  collectionName: string,
  item: T
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const docRef = doc(db, collectionName, item.id);
    const docData = { ...item };
    if (collectionName === 'appointments') {
      (docData as any).updatedAt = serverTimestamp();
    }
    const sanitized = cleanUndefined(docData);
    await setDoc(docRef, sanitized);
    
    if (collectionName === 'appointments') {
      const todayStr = getLocalTodayStr();
      const apptDate = (item as any).date;
      const isHistorical = apptDate && apptDate < todayStr;
      if (isHistorical) {
        await triggerSyncSignal('appointments_historical', item.id, 'upsert');
      }
    } else {
      await triggerSyncSignal(collectionName, item.id, 'upsert');
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${item.id}`);
  }
}

export async function deleteDocFromCloud(
  collectionName: string,
  id: string,
  date?: string
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const docRef = doc(db, collectionName, id);
    if (collectionName === 'appointments') {
      // Soft-delete: set status: 'deleted' and updatedAt: serverTimestamp() so other clients can detect deletion during sync
      await setDoc(docRef, {
        id,
        status: 'deleted',
        updatedAt: serverTimestamp(),
        date: date || ""
      }, { merge: true });
      
      const todayStr = getLocalTodayStr();
      const isHistorical = date && date < todayStr;
      if (isHistorical) {
        await triggerSyncSignal('appointments_historical', id, 'delete');
      }
    } else {
      await deleteDoc(docRef);
      await triggerSyncSignal(collectionName, id, 'delete');
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
  }
}

export async function replaceCollectionFromCloud<T extends { id: string }>(
  collectionName: string,
  items: T[]
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Chưa cấu hình cơ sở dữ liệu");

  // Kiểm tra id không rỗng và không trùng trước khi xóa dữ liệu
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || !item.id || typeof item.id !== 'string' || item.id.trim() === '') {
      throw new Error(`Item trong collection '${collectionName}' có ID không hợp lệ hoặc rỗng!`);
    }
    if (ids.has(item.id)) {
      throw new Error(`Phát hiện ID trùng lặp '${item.id}' trong collection '${collectionName}'!`);
    }
    ids.add(item.id);
  }

  // Đọc collection hiện tại
  const colRef = collection(db, collectionName);
  const snapshot = await getDocs(colRef);
  const oldDocRefs = snapshot.docs.map(d => doc(db, collectionName, d.id));

  // Xóa document cũ bằng writeBatch, tối đa 400 thao tác mỗi batch
  let batch = writeBatch(db);
  let count = 0;

  for (const docRef of oldDocRefs) {
    batch.delete(docRef);
    count++;
    if (count === 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
  }

  // Ghi lại toàn bộ items bằng batch, tối đa 400 thao tác mỗi batch
  batch = writeBatch(db);
  count = 0;

  for (const item of items) {
    const docRef = doc(db, collectionName, item.id);
    const sanitized = cleanUndefined(item);
    batch.set(docRef, sanitized);
    count++;
    if (count === 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
  }

  // Trigger sync signal once after full collection replacement
  await triggerSyncSignal(collectionName);
}
