import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import fs from "fs";
import crypto from "crypto";
import {
  assertPendingGroupAppointmentsConsistent,
  assertGroupPaymentTotalsConsistent,
  assertStandaloneCheckoutAvailable,
  getGroupPaymentTransactionToUnwind,
  isPaymentSessionExpired,
  shouldCompleteCheckoutImmediately,
  type CheckoutRole
} from "../../../packages/shared/src/checkoutPolicy";
import { SimpleCache } from "./infrastructure/cache/SimpleCache";
import {
  backupsRoot,
  firebaseAppletConfigPath,
  rootEnvPath,
  webDistRoot,
  webRoot,
  webViteConfigPath
} from "./config/paths";

dotenv.config({ path: rootEnvPath });

function toNonNegativeMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

// 40% keeps the standard calculation. For 45% and 50%, deduct 5% and 10%
// respectively from the gross bill after calculating the stated rate —
// but ONLY when the order actually has a discount code/amount applied.
// If there's no discount, staff always get the full stated rate.
function calculateStaffCommission(billAmount: unknown, commissionRate: unknown, hasDiscount: boolean = false): number {
  const bill = toNonNegativeMoney(billAmount);
  const rate = Number(commissionRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  if (!hasDiscount) return bill * rate;
  const deductionRate = Math.abs(rate - 0.45) < 0.000001
    ? 0.05
    : Math.abs(rate - 0.5) < 0.000001
    ? 0.1
    : 0;
  return bill * rate - bill * deductionRate;
}

// Shared helper so every call site derives "does this order have a discount"
// the same way, whether the discount fields live on the appointment,
// a group-payment allocation item, or a payment_session/promotion snapshot.
function orderHasDiscount(source: { discountCode?: unknown; discountAmount?: unknown } | null | undefined): boolean {
  if (!source) return false;
  const hasCode = typeof source.discountCode === 'string' && source.discountCode.length > 0;
  const hasAmount = Number(source.discountAmount) > 0;
  return hasCode || hasAmount;
}

function getBookingDepositAmount(depositAmount: unknown, assignedDepositAmount: unknown): number {
  return toNonNegativeMoney(depositAmount) || toNonNegativeMoney(assignedDepositAmount);
}

// A positive delta restores money to the internal wallet; a negative one
// means cash was returned to the customer and must be taken out of the wallet.
function calculateCancellationWalletDelta(input: {
  status?: string;
  depositUsed?: unknown;
  depositDeducted?: unknown;
  depositAmount?: unknown;
  assignedDepositAmount?: unknown;
  refundDeposit: boolean;
}): number {
  const depositUsed = toNonNegativeMoney(input.depositUsed);
  const restoredCheckoutDeposit =
    input.status === 'awaiting_payment' && depositUsed > 0 && input.depositDeducted !== false
      ? depositUsed
      : 0;
  const bookingDeposit = getBookingDepositAmount(input.depositAmount, input.assignedDepositAmount);
  return restoredCheckoutDeposit - (input.refundDeposit ? bookingDeposit : 0);
}

const appletConfig = JSON.parse(fs.readFileSync(firebaseAppletConfigPath, 'utf-8'));


import webpush from "web-push";

// Setup Web-Push VAPID keys statically on boot - FIXED pairing so subscription keys never invalidate on container restarts
const publicKey = "BFyA_PzRY_7YJ6i82Lq2RJS4AITGx7bPoMGZebBbwLS8WvKjnnFCzrhE9rbK7bvmhfvPFn6NOjsHQz7dBCW0ANc";
const privateKey = "kH6ncRUGYzRxnboUDZMZHzm9j5bbI3xTqpc-7AxGPKo";

try {
  webpush.setVapidDetails(
    "mailto:hoanganh23091997@gmail.com",
    publicKey,
    privateKey
  );
  console.log("Web-Push VAPID consistent credentials configured statically.");
} catch (e) {
  console.error("Failed to configure Web-Push details in server.ts:", e);
}

const subscriptions: any[] = [];

export const app = express();
const PORT = Number(process.env.PORT) || 3000;

let db: firebase.firestore.Firestore | null = null;
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(appletConfig);
  }
  db = firebase.firestore();
  db.settings({
    experimentalForceLongPolling: true
  });
  console.log("Firebase Client SDK initialized successfully on server with long polling enabled.");
} catch (e) {
  console.error("Failed to initialize Firebase Client SDK:", e);
}

// Low-overhead in-memory cache for static Firestore collections.
const serverCache = new SimpleCache();

// Firestore real-time cache-invalidation listeners for NoSQL updates
if (db) {
  try {
    db.collection("system").doc("sync_status").onSnapshot((snapshot) => {
      if (snapshot.exists) {
        const data = snapshot.data();
        const collectionName = data?.collection || data?.changedCollection;
        if (collectionName) {
          console.log(`[Cache Invalidation] System sync signal detected for collection: ${collectionName}. Evicting cache.`);
          serverCache.delete(collectionName);
          // If staff changes, make sure alias is evicted too
          if (collectionName === 'staff') {
            serverCache.delete('staff');
          }
        }
      }
    });
  } catch (err) {
    console.error("Failed to register server-side cache-invalidation listener:", err);
  }
}

// Body parser
app.use(express.json());

type AuthUser = {
  id: string;
  name: string;
  role: CheckoutRole;
  staffId?: string;
};

// `exp` is kept optional only so tokens issued by older deployments remain
// readable. Login sessions no longer expire automatically.
type AuthTokenPayload = AuthUser & { exp?: number };

type PromotionSnapshot = {
  code?: string;
  discountPercent?: number;
  discountAmount: number;
  totalAfterDiscount: number;
};

function normalizePromotionCode(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function resolvePromotionSnapshot(promotion: any, code: string, subtotal: number): PromotionSnapshot {
  if (!code) return { discountAmount: 0, totalAfterDiscount: subtotal };
  if (!promotion || promotion.active !== true) throw new Error('Mã giảm giá không tồn tại hoặc đã ngừng áp dụng');
  const discountPercent = Number(promotion.discountPercent);
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) throw new Error('Cấu hình phần trăm giảm giá không hợp lệ');
  return {
    code,
    discountPercent,
    discountAmount: Math.round(subtotal * discountPercent / 100),
    totalAfterDiscount: Math.max(0, subtotal - Math.round(subtotal * discountPercent / 100))
  };
}

const systemExpiryActor: AuthUser = {
  id: 'system_payment_expiry',
  name: 'Hệ thống hết hạn QR',
  role: 'admin'
};

// AI Studio deployments may not preserve custom environment variables. Use a
// deterministic, server-only fallback so tokens remain valid across restarts
// and file-import deployments. AUTH_SESSION_SECRET still takes precedence
// when it is explicitly configured.
const sourceStableAuthSessionSecret = crypto
  .createHash('sha256')
  .update(`nail-manager-auth-session-v1:${privateKey}`)
  .digest('hex');
const authSessionSecret = process.env.AUTH_SESSION_SECRET || sourceStableAuthSessionSecret;
if (!process.env.AUTH_SESSION_SECRET) {
  console.warn('[auth] AUTH_SESSION_SECRET chưa được cấu hình; đang dùng khóa phiên cố định của bản mã AI Studio.');
}

const encodeAuthPart = (value: string | Buffer) => Buffer.from(value).toString('base64url');

function signAuthPayload(encodedPayload: string): string {
  return crypto.createHmac('sha256', authSessionSecret).update(encodedPayload).digest('base64url');
}

function createAuthToken(user: AuthUser): string {
  const payload: AuthTokenPayload = { ...user };
  const encodedPayload = encodeAuthPart(JSON.stringify(payload));
  return `${encodedPayload}.${signAuthPayload(encodedPayload)}`;
}

function verifyAuthToken(token: string): AuthUser | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;
  const expectedSignature = signAuthPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (
      !payload.id ||
      !payload.name ||
      !['admin', 'staff', 'support'].includes(payload.role)
    ) return null;
    // Ignore the legacy expiry claim so already-issued tokens also remain
    // usable after their former 12-hour limit.
    const { exp: _legacyExpiry, ...user } = payload;
    return user;
  } catch {
    return null;
  }
}

function getRequestUser(req: express.Request): AuthUser {
  const user = (req as express.Request & { authUser?: AuthUser }).authUser;
  if (!user) throw new Error('Phiên đăng nhập không hợp lệ');
  return user;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const user = match ? verifyAuthToken(match[1]) : null;
  if (!user) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
  (req as express.Request & { authUser?: AuthUser }).authUser = user;
  next();
}

function requireRole(...roles: CheckoutRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    requireAuth(req, res, () => {
      const user = getRequestUser(req);
      if (!roles.includes(user.role)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
      next();
    });
  };
}

app.get('/api/promotion-codes', requireRole('admin', 'staff', 'support'), async (req, res) => {
  if (!db) return res.status(500).json({ error: 'No database connected' });
  try {
    const actor = getRequestUser(req);
    const snapshot = await db.collection('promotion_codes').get();
    const includeInactive = req.query.includeInactive === 'true' && actor.role === 'admin';
    const codes = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() } as any))
      .filter(item => includeInactive || item.active === true);
    res.json({ success: true, codes });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Không thể tải mã giảm giá' });
  }
});

app.post('/api/promotion-codes', requireRole('admin'), async (req, res) => {
  if (!db) return res.status(500).json({ error: 'No database connected' });
  try {
    const code = normalizePromotionCode(req.body?.code);
    const discountPercent = Number(req.body?.discountPercent ?? 10);
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new Error('Mã cần 3–30 ký tự: chữ, số, dấu gạch ngang hoặc gạch dưới');
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) throw new Error('Phần trăm giảm giá phải từ 1 đến 100');
    const ref = db.collection('promotion_codes').doc(code);
    await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      transaction.set(ref, {
        code,
        discountPercent,
        active: req.body?.active !== false,
        createdAt: existing.data()?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });
    res.json({ success: true, code });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Không thể lưu mã giảm giá' });
  }
});

app.patch('/api/promotion-codes/:code', requireRole('admin'), async (req, res) => {
  if (!db) return res.status(500).json({ error: 'No database connected' });
  try {
    const code = normalizePromotionCode(req.params.code);
    if (!code) throw new Error('Mã giảm giá không hợp lệ');
    await db.collection('promotion_codes').doc(code).update({
      active: !!req.body?.active,
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Không thể cập nhật mã giảm giá' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  if (!username || !password) return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu' });
  if (!db) return res.status(500).json({ error: 'No database connected' });

  try {
    const configuredAdminUsername = String(process.env.ADMIN_USERNAME || 'hoanganh23091997@gmail.com').trim().toLowerCase();
    const configuredAdminPassword = String(process.env.ADMIN_PASSWORD || '0089').trim();
    let user: AuthUser | null = null;

    if (username === configuredAdminUsername && password === configuredAdminPassword) {
      user = { id: 'admin_configured', name: process.env.ADMIN_NAME || 'Hoàng Anh (Admin)', role: 'admin' };
    } else {
      const adminDocs = await db.collection('admin_accounts').get()
        .then(snapshot => snapshot.docs)
        .catch(() => [] as firebase.firestore.QueryDocumentSnapshot[]);
      const staffSnapshot = await db.collection('staff').get();
      const admin = adminDocs
        .map(doc => ({ id: doc.id, ...doc.data() } as any))
        .find(account => String(account.email || account.username || '').trim().toLowerCase() === username && String(account.password || '').trim() === password);
      if (admin) {
        user = { id: admin.id, name: admin.name || admin.email || 'Admin', role: 'admin' };
      } else {
        const staff = staffSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as any))
          .find(member => {
            const loginName = String(member.username || member.phone || '').trim().toLowerCase();
            const loginPassword = String(member.password || '1234').trim();
            return member.status === 'active' && loginName === username && loginPassword === password;
          });
        if (staff) {
          const isSupport = String(staff.role || '').trim().toLowerCase() === 'support';
          user = {
            id: staff.id,
            staffId: staff.id,
            name: staff.name || 'Nhân viên',
            role: isSupport ? 'support' : 'staff'
          };
        }
      }
    }

    if (!user) return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa' });
    return res.json({ success: true, user: { ...user, token: createAuthToken(user) } });
  } catch (error: any) {
    console.error('[auth/login] Error:', error);
    return res.status(500).json({ error: 'Không thể xác thực tài khoản lúc này' });
  }
});

// Cached Services endpoint (0 reads if cached)
app.get("/api/services", async (req, res) => {
  const cached = serverCache.get<any[]>("services");
  if (cached) {
    console.log("[REST CACHE] Serving services table from RAM (0 reads)");
    return res.json(cached);
  }
  if (!db) {
    return res.status(500).json({ error: "Database not running on server" });
  }
  try {
    console.log("[REST CACHE] Cache miss for services! Pulling from Firestore...");
    const colRef = db.collection("services");
    const snapshot = await colRef.get();
    const services = snapshot.docs.map(doc => ({ ...doc.data() }));
    serverCache.set("services", services, 600000); // 10 minutes TTL (for improved multi-instance consistency)
    return res.json(services);
  } catch (err: any) {
    console.error("Express failed loading services: ", err);
    return res.status(500).json({ error: err.message });
  }
});

// Cached Staff endpoint (0 reads if cached)
app.get("/api/staff", async (req, res) => {
  const cached = serverCache.get<any[]>("staff");
  if (cached) {
    console.log("[REST CACHE] Serving staff table from RAM (0 reads)");
    return res.json(cached);
  }
  if (!db) {
    return res.status(500).json({ error: "Database not running on server" });
  }
  try {
    console.log("[REST CACHE] Cache miss for staff! Pulling from Firestore...");
    const colRef = db.collection("staff");
    const snapshot = await colRef.get();
    const staffList = snapshot.docs.map(doc => ({ ...doc.data() }));
    serverCache.set("staff", staffList, 600000); // 10 minutes TTL (for improved multi-instance consistency)
    return res.json(staffList);
  } catch (err: any) {
    console.error("Express failed loading staff: ", err);
    return res.status(500).json({ error: err.message });
  }
});



// API endpoints for Web Push Subscription
app.get("/api/push-public-key", (req, res) => {
  res.json({ publicKey });
});

app.post("/api/push-subscribe", async (req, res) => {
  const { subscription, role, userName } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription" });
  }

  // 1. Keep in-memory list as local cache
  const exists = subscriptions.some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
  }

  // 2. Persist to Firestore to survive server container scale down / restarts
  if (db) {
    try {
      // Create a unique safe document name from endpoint to prevent duplicate record noise
      const docId = Buffer.from(subscription.endpoint).toString("base64url").slice(0, 100);
      const subDocRef = db.collection("push_subscriptions").doc(docId);
      await subDocRef.set({
        subscription,
        createdAt: new Date().toISOString(),
        role: role || 'unknown',
        userName: userName || ''
      });
      console.log(`Persisted sub to Firestore collection: ${subscription.endpoint.slice(-25)}`);
    } catch (err: any) {
      console.error("Failed to persist subscription to Firestore:", err.message);
    }
  }

  res.json({ success: true, message: "Subscription registered successfully" });
});

async function broadcastPushNotification(
  title?: string,
  body?: string,
  tag?: string,
  url?: string
): Promise<number> {
  console.log(`Broadcast event received with title: "${title}" - content: "${body}" - url: "${url}"`);

  const targetUrl = url || "/";
  const payload = JSON.stringify({
    title: title || "Có đơn hàng mới tại nailby.ank!",
    body: body || "Có đơn hàng mới! Vào kiểm tra ngay.",
    tag: tag || "nailby-ank-push-new",
    url: targetUrl
  });

  // Aggregate memory subscriptions and durable Firestore records
  let allSubs = [...subscriptions];
  if (db) {
    try {
      const colRef = db.collection("push_subscriptions");
      const snapshot = await colRef.get();
      snapshot.forEach(d => {
        const data = d.data();
        if (data && data.subscription && data.subscription.endpoint) {
          if (!allSubs.some(s => s.endpoint === data.subscription.endpoint)) {
            allSubs.push(data.subscription);
          }
        }
      });
      console.log(`Aggregated ${snapshot.size} subscriptions from Firestore collection. Active queue: ${allSubs.length}`);
    } catch (err: any) {
      console.error("Failed to pre-fetch subscriptions from Firestore for broadcast:", err.message);
    }
  }

  // Send Push Notifications
  const promises = allSubs.map(sub => {
    return webpush.sendNotification(sub, payload).catch(async (err) => {
      console.warn("Expired/inactive subscription removal active for:", sub.endpoint, err.message);
      // Remove stale in memory
      const idx = subscriptions.findIndex(s => s.endpoint === sub.endpoint);
      if (idx !== -1) subscriptions.splice(idx, 1);

      // Remove stale from Firestore
      if (db) {
        try {
          const docId = Buffer.from(sub.endpoint).toString("base64url").slice(0, 100);
          const subDocRef = db.collection("push_subscriptions").doc(docId);
          await subDocRef.delete();
          console.log(`Cleaned up stale subscription from database successfully.`);
        } catch (dbErr: any) {
          console.error("Failed to purge stale sub from Firestore:", dbErr.message);
        }
      }
    });
  });

  await Promise.all(promises);
  return allSubs.length;
}

app.post("/api/push-notify-all", async (req, res) => {
  const { title, body, tag, url } = req.body;
  const notifiedCount = await broadcastPushNotification(title, body, tag, url);
  res.json({ success: true, notifiedCount });
});

// Auto Settle function for orders - kept as fallback
async function autoSettle(appointmentId: string, collectedAmount: number, forceSettle = false) {
  await settleAppointment(appointmentId, collectedAmount);
}

// Idempotent settleAppointment function using an atomic Firestore transaction (Requirement 4)
async function settleAppointment(appointmentId: string, collectedAmount: number, approvedBy?: AuthUser) {
  console.log(`[settleAppointment] Starting transaction for ${appointmentId}`);
  if (!db) throw new Error("No database connected");

  await db.runTransaction(async (transaction) => {
    const apptRef = db.collection('appointments').doc(appointmentId);
    const apptSnap = await transaction.get(apptRef);
    const appt = apptSnap.data();

    if (!appt) throw new Error("Appointment not found");
    if (appt.status === 'completed') {
      console.log(`[settleAppointment] Appointment ${appointmentId} already completed, skipping.`);
      return;
    }

    // Đọc toàn bộ dữ liệu trước khi ghi để transaction Firestore luôn hợp lệ.
    let snapshotRate = appt.commissionRate;
    let staffName = appt.staffName;
    if (appt.staffId) {
      const staffRef = db.collection('staff').doc(appt.staffId);
      const staffSnap = await transaction.get(staffRef);
      if (staffSnap.exists) {
        const staffData = staffSnap.data();
        if (snapshotRate === undefined && staffData) snapshotRate = staffData.commissionRate;
        if (!staffName && staffData) staffName = staffData.name;
      }
    }

    let custRef: firebase.firestore.DocumentReference | null = null;
    let custSnap: firebase.firestore.DocumentSnapshot | null = null;
    if (appt.customerId && appt.customerId !== 'new_cust_temp') {
      custRef = db.collection('customers').doc(appt.customerId);
      custSnap = await transaction.get(custRef);
    }

    const depositUsed = Number(appt.depositUsed) || 0;
    // Chỉ các đơn tiền mặt mới tạo sau thay đổi này có depositDeducted === false.
    // Đơn cũ không có cờ được xem là đã trừ để tránh trừ cọc lần hai.
    const shouldDeductPendingDeposit = appt.depositDeducted === false && depositUsed > 0;
    if (shouldDeductPendingDeposit) {
      if (!custRef || !custSnap || !custSnap.exists) {
        throw new Error("Không tìm thấy ví khách hàng để khấu trừ tiền cọc");
      }
      const walletBalance = Number((custSnap.data() || {}).walletBalance) || 0;
      if (walletBalance < depositUsed) {
        throw new Error(`Ví khách không đủ cọc để hoàn thành đơn. Cần ${depositUsed.toLocaleString()}đ, hiện có ${walletBalance.toLocaleString()}đ`);
      }
    }

    const commissionAmount = calculateStaffCommission(appt.totalPrice, snapshotRate, orderHasDiscount(appt));
    transaction.update(apptRef, {
      status: 'completed',
      paymentCollectedAmount: collectedAmount,
      updatedAt: new Date().toISOString(),
      pendingStatusApproval: firebase.firestore.FieldValue.delete(),
      ...(approvedBy ? {
        approvedBy: approvedBy.id,
        approvedByName: approvedBy.name,
        approvedByRole: approvedBy.role,
        approvedAt: new Date().toISOString()
      } : {}),
      ...(depositUsed > 0 && { depositDeducted: true }),
      ...(snapshotRate !== undefined && { commissionRate: snapshotRate }),
      commissionAmount
    });

    if (custRef && custSnap && custSnap.exists) {
      const cust = custSnap.data() || {};
      const customerUpdates: any = {
        totalVisits: (cust.totalVisits || 0) + 1,
        totalSpent: (cust.totalSpent || 0) + collectedAmount + depositUsed
      };
      if (shouldDeductPendingDeposit) {
        customerUpdates.walletBalance = Math.max(0, (Number(cust.walletBalance) || 0) - depositUsed);
        customerUpdates.walletVersion = (Number(cust.walletVersion) || 0) + 1;
      }
      transaction.update(custRef, customerUpdates);
    }

    if (appt.staffId && snapshotRate !== undefined) {
      const commission = calculateStaffCommission(appt.totalPrice, snapshotRate, orderHasDiscount(appt));
      transaction.set(db.collection('staff_income').doc(appointmentId), {
        staffId: appt.staffId,
        staffName: staffName || 'Staff',
        appointmentId,
        date: appt.date,
        totalPrice: appt.totalPrice || 0,
        commissionRate: snapshotRate,
        commission,
        createdAt: new Date().toISOString()
      });
      console.log(`[settleAppointment] Recorded commission ${commission} for staff ${appt.staffId} on appointment ${appointmentId}`);
    }
  });
}

function generatePaymentCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  let result = 'SEVQR';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

type GroupPaymentAllocation = {
  appointmentId: string;
  customerId: string;
  staffId: string;
  staffName: string;
  billAmount: number;
  code?: string;
  discountCode?: string;
  discountPercent?: number;
  discountAmount: number;
  totalAfterDiscount: number;
  depositUsed: number;
  collectedAmount: number;
  commissionRate: number;
  originalAppointmentStatus: string;
};

function generateGroupTransactionId(): string {
  return `GPT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function cancelGroupPaymentTransaction(
  paymentTransactionId: string,
  cancelledBy: AuthUser,
  terminalStatus: 'cancelled' | 'expired' = 'cancelled'
) {
  if (!db) throw new Error("No database connected");

  await db.runTransaction(async transaction => {
    const paymentRef = db.collection('payment_transactions').doc(paymentTransactionId);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists) throw new Error("Giao dịch nhóm không tồn tại");
    const payment = paymentSnap.data() || {};
    if (payment.status === 'requires_reconciliation') {
      throw new Error('Giao dịch đã nhận tiền sau khi QR hết hạn hoặc bị hủy và phải được đối soát thủ công');
    }
    if (
      payment.status === terminalStatus ||
      payment.status === 'cancelled' ||
      payment.status === 'expired'
    ) return;
    if (payment.status === 'completed') throw new Error("Giao dịch đã hoàn tất, không thể hủy");

    const allocations = (payment.allocations || []) as GroupPaymentAllocation[];
    const apptRefs = allocations.map(item => db!.collection('appointments').doc(item.appointmentId));
    const apptSnaps = await Promise.all(apptRefs.map(ref => transaction.get(ref)));
    const depositByCustomer = new Map<string, number>();
    if (payment.depositDeducted) {
      allocations.forEach(item => {
        if (item.customerId && item.customerId !== 'new_cust_temp' && item.depositUsed > 0) {
          depositByCustomer.set(item.customerId, (depositByCustomer.get(item.customerId) || 0) + item.depositUsed);
        }
      });
    }
    const customerEntries = await Promise.all([...depositByCustomer.keys()].map(async customerId => {
      const ref = db!.collection('customers').doc(customerId);
      return { customerId, ref, snap: await transaction.get(ref) };
    }));

    let sessionRef: firebase.firestore.DocumentReference | null = null;
    let sessionSnap: firebase.firestore.DocumentSnapshot | null = null;
    if (payment.paymentCode) {
      sessionRef = db.collection('payment_sessions').doc(payment.paymentCode);
      sessionSnap = await transaction.get(sessionRef);
    }

    customerEntries.forEach(({ customerId, ref, snap }) => {
      if (!snap.exists) return;
      const customer = snap.data() || {};
      transaction.update(ref, {
        walletBalance: (Number(customer.walletBalance) || 0) + (depositByCustomer.get(customerId) || 0),
        walletVersion: (Number(customer.walletVersion) || 0) + 1
      });
    });

    apptSnaps.forEach((snap, index) => {
      if (!snap.exists) return;
      const appt = snap.data() || {};
      if (appt.paymentTransactionId !== paymentTransactionId || appt.status !== 'awaiting_payment') return;
      transaction.update(apptRefs[index], {
        status: allocations[index].originalAppointmentStatus || appt.previousStatus || 'pending',
        paymentCode: firebase.firestore.FieldValue.delete(),
        paymentTransactionId: firebase.firestore.FieldValue.delete(),
        paymentAllocatedAmount: firebase.firestore.FieldValue.delete(),
        paymentMethod: firebase.firestore.FieldValue.delete(),
        paymentStatus: firebase.firestore.FieldValue.delete(),
        amountDue: firebase.firestore.FieldValue.delete(),
        depositUsed: firebase.firestore.FieldValue.delete(),
        depositDeducted: firebase.firestore.FieldValue.delete(),
        subtotal: firebase.firestore.FieldValue.delete(),
        discountCode: firebase.firestore.FieldValue.delete(),
        discountPercent: firebase.firestore.FieldValue.delete(),
        discountAmount: firebase.firestore.FieldValue.delete(),
        totalAfterDiscount: firebase.firestore.FieldValue.delete(),
        pendingStatusApproval: firebase.firestore.FieldValue.delete(),
        previousStatus: firebase.firestore.FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });
    });

    const terminalAt = new Date().toISOString();
    transaction.update(paymentRef, {
      status: terminalStatus,
      cancelledBy: cancelledBy.id,
      cancelledByName: cancelledBy.name,
      cancelledByRole: cancelledBy.role,
      ...(terminalStatus === 'expired' ? { expiredAt: terminalAt } : { cancelledAt: terminalAt }),
      updatedAt: terminalAt
    });
    if (sessionRef && sessionSnap?.exists) {
      transaction.update(sessionRef, { status: terminalStatus, updatedAt: terminalAt });
    }
  });
}

async function expireSinglePaymentSession(paymentCode: string) {
  if (!db) throw new Error('No database connected');
  await db.runTransaction(async transaction => {
    const sessionRef = db!.collection('payment_sessions').doc(paymentCode);
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) return;
    const session = sessionSnap.data() || {};
    if (session.status !== 'pending' || !isPaymentSessionExpired(session.expiresAt)) return;

    const apptRef = db!.collection('appointments').doc(String(session.appointmentId || ''));
    const apptSnap = await transaction.get(apptRef);
    const appt = apptSnap.data() || {};
    let customerRef: firebase.firestore.DocumentReference | null = null;
    let customerSnap: firebase.firestore.DocumentSnapshot | null = null;
    const depositUsed = Number(session.depositUsed) || 0;
    if (
      apptSnap.exists &&
      session.depositDeducted !== false &&
      depositUsed > 0 &&
      appt.customerId &&
      appt.customerId !== 'new_cust_temp'
    ) {
      customerRef = db!.collection('customers').doc(appt.customerId);
      customerSnap = await transaction.get(customerRef);
    }

    if (customerRef && customerSnap?.exists) {
      const customer = customerSnap.data() || {};
      transaction.update(customerRef, {
        walletBalance: (Number(customer.walletBalance) || 0) + depositUsed,
        walletVersion: (Number(customer.walletVersion) || 0) + 1
      });
    }

    if (
      apptSnap.exists &&
      appt.status === 'awaiting_payment' &&
      appt.paymentCode === paymentCode &&
      !appt.paymentTransactionId
    ) {
      transaction.update(apptRef, {
        status: appt.previousStatus || session.originalAppointmentStatus || 'pending',
        paymentCode: firebase.firestore.FieldValue.delete(),
        amountDue: firebase.firestore.FieldValue.delete(),
        depositUsed: firebase.firestore.FieldValue.delete(),
        depositDeducted: firebase.firestore.FieldValue.delete(),
        subtotal: firebase.firestore.FieldValue.delete(),
        discountCode: firebase.firestore.FieldValue.delete(),
        discountPercent: firebase.firestore.FieldValue.delete(),
        discountAmount: firebase.firestore.FieldValue.delete(),
        totalAfterDiscount: firebase.firestore.FieldValue.delete(),
        paymentMethod: firebase.firestore.FieldValue.delete(),
        pendingStatusApproval: firebase.firestore.FieldValue.delete(),
        previousStatus: firebase.firestore.FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });
    }

    transaction.update(sessionRef, {
      status: 'expired',
      expiredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });
}

async function expirePendingPaymentSessions() {
  if (!db) return;
  try {
    const snapshot = await db.collection('payment_sessions').where('status', '==', 'pending').get();
    const expiredSessions = snapshot.docs
      .map(doc => ({ paymentCode: doc.id, ...(doc.data() || {}) } as any))
      .filter(session => isPaymentSessionExpired(session.expiresAt));

    for (const session of expiredSessions) {
      try {
        if (session.paymentTransactionId) {
          await cancelGroupPaymentTransaction(session.paymentTransactionId, systemExpiryActor, 'expired');
        } else {
          await expireSinglePaymentSession(session.paymentCode);
        }
      } catch (error) {
        console.error(`[payment-expiry] Không thể hết hạn session ${session.paymentCode}:`, error);
      }
    }
  } catch (error) {
    console.error('[payment-expiry] Không thể quét session hết hạn:', error);
  }
}

const paymentExpiryInterval = setInterval(expirePendingPaymentSessions, 60_000);
paymentExpiryInterval.unref();
const initialPaymentExpirySweep = setTimeout(expirePendingPaymentSessions, 10_000);
initialPaymentExpirySweep.unref();

async function settlePendingGroupPayment(paymentTransactionId: string, approvedBy: AuthUser) {
  if (!db) throw new Error("No database connected");

  await db.runTransaction(async transaction => {
    const paymentRef = db.collection('payment_transactions').doc(paymentTransactionId);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists) throw new Error("Giao dịch nhóm không tồn tại");
    const payment = paymentSnap.data() || {};
    if (payment.status === 'completed') return;
    if (payment.status !== 'pending_approval') throw new Error("Giao dịch không ở trạng thái chờ duyệt tiền mặt");
    if (payment.paymentMethod !== 'cash') throw new Error('Chỉ giao dịch tiền mặt mới được duyệt thủ công');

    const allocations = (payment.allocations || []) as GroupPaymentAllocation[];
    const apptRefs = allocations.map(item => db!.collection('appointments').doc(item.appointmentId));
    const apptSnaps = await Promise.all(apptRefs.map(ref => transaction.get(ref)));
    if (apptSnaps.some(snap => !snap.exists)) throw new Error('Một hoặc nhiều đơn trong giao dịch nhóm không còn tồn tại');
    const appts: any[] = apptSnaps.map((snap, index) => ({ id: allocations[index].appointmentId, ...(snap.data() || {}) }));
    assertPendingGroupAppointmentsConsistent(appts, paymentTransactionId);
    if (appts.some(appt => appt.paymentMethod !== 'cash')) {
      throw new Error('Phương thức thanh toán của một hoặc nhiều đơn đã thay đổi');
    }

    const customerIds = [...new Set(allocations.map(item => item.customerId).filter(id => id && id !== 'new_cust_temp'))];
    const customerEntries = await Promise.all(customerIds.map(async customerId => {
      const ref = db!.collection('customers').doc(customerId);
      return { customerId, ref, snap: await transaction.get(ref) };
    }));

    const totalsByCustomer = new Map<string, { visits: number; spent: number; deposit: number }>();
    allocations.forEach(item => {
      if (!item.customerId || item.customerId === 'new_cust_temp') return;
      const current = totalsByCustomer.get(item.customerId) || { visits: 0, spent: 0, deposit: 0 };
      // A parallel booking is one customer visit even when it contains many service appointments.
      current.visits = 1;
      current.spent += Number(item.totalAfterDiscount ?? item.billAmount) || 0;
      current.deposit += item.depositUsed;
      totalsByCustomer.set(item.customerId, current);
    });

    customerEntries.forEach(({ customerId, ref, snap }) => {
      if (!snap.exists) return;
      const customer = snap.data() || {};
      const totals = totalsByCustomer.get(customerId)!;
      const walletBalance = Number(customer.walletBalance) || 0;
      if (walletBalance < totals.deposit) {
        throw new Error(`Ví khách không đủ cọc để duyệt giao dịch. Cần ${totals.deposit.toLocaleString()}đ, hiện có ${walletBalance.toLocaleString()}đ`);
      }
      transaction.update(ref, {
        walletBalance: walletBalance - totals.deposit,
        walletVersion: (Number(customer.walletVersion) || 0) + (totals.deposit > 0 ? 1 : 0),
        totalVisits: (Number(customer.totalVisits) || 0) + totals.visits,
        totalSpent: (Number(customer.totalSpent) || 0) + totals.spent
      });
    });

    allocations.forEach((item, index) => {
      const appt = appts[index];
      const commission = calculateStaffCommission(item.billAmount, item.commissionRate, orderHasDiscount(item));
      transaction.update(apptRefs[index], {
        status: 'completed',
        paymentStatus: 'paid',
        paymentCollectedAmount: item.collectedAmount,
        depositDeducted: item.depositUsed > 0,
        commissionRate: item.commissionRate,
        commissionAmount: commission,
        pendingStatusApproval: firebase.firestore.FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });
      transaction.set(db!.collection('staff_income').doc(item.appointmentId), {
        staffId: item.staffId,
        staffName: item.staffName,
        appointmentId: item.appointmentId,
        date: appt.date,
        totalPrice: item.billAmount,
        commissionRate: item.commissionRate,
        commission,
        paymentTransactionId,
        createdAt: new Date().toISOString()
      });
    });

    transaction.update(paymentRef, {
      status: 'completed',
      depositDeducted: allocations.some(item => item.depositUsed > 0),
      approvedBy: approvedBy.id,
      approvedByName: approvedBy.name,
      approvedByRole: approvedBy.role,
      approvedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });
}

async function settleGroupTransfer(
  paymentCode: string,
  amount: number,
  dedupKey: string | null,
  webhookData: { transactionId?: any; referenceCode?: any; content?: any }
) {
  if (!db) throw new Error("No database connected");
  let alreadyProcessed = false;
  let requiresReconciliation = false;

  await db.runTransaction(async transaction => {
    let dedupRef: firebase.firestore.DocumentReference | null = null;
    if (dedupKey) {
      dedupRef = db!.collection('sepay_transactions').doc(dedupKey);
      const dedupSnap = await transaction.get(dedupRef);
      if (dedupSnap.exists) {
        alreadyProcessed = true;
        return;
      }
    }

    const sessionRef = db!.collection('payment_sessions').doc(paymentCode);
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) throw new Error(`Mã thanh toán không tồn tại: ${paymentCode}`);
    const session = sessionSnap.data() || {};
    const paymentTransactionId = session.paymentTransactionId;
    const paymentRef = db!.collection('payment_transactions').doc(paymentTransactionId);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists) throw new Error("Không tìm thấy giao dịch phân bổ");
    const payment = paymentSnap.data() || {};
    const allocations = (payment.allocations || []) as GroupPaymentAllocation[];

    if (session.status !== 'pending') {
      // A retry of the same SePay transaction was caught by the dedup check above.
      // Reaching here means new money arrived for an already terminal QR and must
      // be visible to reconciliation instead of being silently ignored.
      requiresReconciliation = true;
      if (dedupRef) {
        transaction.set(dedupRef, {
          transactionId: webhookData.transactionId || '',
          referenceCode: webhookData.referenceCode || '',
          amount,
          content: webhookData.content || '',
          appointmentIds: allocations.map(item => item.appointmentId),
          paymentTransactionId,
          paymentCode,
          processedAt: new Date().toISOString(),
          previousSessionStatus: session.status,
          status: session.status === 'completed' ? 'duplicate_payment' : 'late_payment'
        });
      }
      transaction.update(paymentRef, {
        reconciliationRequired: true,
        reconciliationReason: session.status === 'completed' ? 'duplicate_payment' : 'late_payment',
        reconciliationUpdatedAt: new Date().toISOString()
      });
      if (session.status !== 'completed') {
        transaction.update(sessionRef, {
          status: 'requires_reconciliation',
          receivedAmount: amount,
          receivedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      return;
    }

    if (isPaymentSessionExpired(session.expiresAt)) {
      requiresReconciliation = true;
      const reconciliationApptRefs = allocations.map(item => db!.collection('appointments').doc(item.appointmentId));
      const reconciliationApptSnaps = await Promise.all(reconciliationApptRefs.map(ref => transaction.get(ref)));
      if (dedupRef) {
        transaction.set(dedupRef, {
          transactionId: webhookData.transactionId || '',
          referenceCode: webhookData.referenceCode || '',
          amount,
          content: webhookData.content || '',
          appointmentIds: allocations.map(item => item.appointmentId),
          paymentTransactionId,
          paymentCode,
          processedAt: new Date().toISOString(),
          status: 'late_payment'
        });
      }
      transaction.update(sessionRef, {
        status: 'requires_reconciliation',
        receivedAmount: amount,
        receivedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      transaction.update(paymentRef, {
        status: 'requires_reconciliation',
        reconciliationRequired: true,
        reconciliationReason: 'late_payment',
        reconciliationUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      reconciliationApptSnaps.forEach((snap, index) => {
        const appt = snap.data() || {};
        if (
          snap.exists &&
          appt.status === 'awaiting_payment' &&
          appt.paymentTransactionId === paymentTransactionId
        ) {
          transaction.update(reconciliationApptRefs[index], {
            paymentStatus: 'requires_reconciliation',
            reconciliationReason: 'late_payment',
            updatedAt: new Date().toISOString()
          });
        }
      });
      return;
    }

    if (payment.status !== 'pending' || payment.paymentMethod !== 'transfer' || payment.paymentCode !== paymentCode) {
      throw new Error('Giao dịch phân bổ QR không còn ở trạng thái hợp lệ để hoàn tất');
    }

    assertGroupPaymentTotalsConsistent(allocations, session.amountDue, payment.totalAmount);

    if (amount !== Number(payment.totalAmount || 0)) {
      throw new Error(`Số tiền thanh toán nhóm không khớp. Yêu cầu: ${payment.totalAmount} VND, nhận: ${amount} VND`);
    }

    const apptRefs = allocations.map(item => db!.collection('appointments').doc(item.appointmentId));
    const apptSnaps = await Promise.all(apptRefs.map(ref => transaction.get(ref)));
    if (apptSnaps.some(snap => !snap.exists)) throw new Error('Một hoặc nhiều đơn trong giao dịch QR nhóm không còn tồn tại');
    const appts: any[] = apptSnaps.map((snap, index) => ({ id: allocations[index].appointmentId, ...(snap.data() || {}) }));
    assertPendingGroupAppointmentsConsistent(appts, paymentTransactionId);
    if (appts.some(appt => appt.paymentMethod !== 'transfer' || appt.paymentCode !== paymentCode)) {
      throw new Error('Một hoặc nhiều đơn đã thay đổi phương thức hoặc mã thanh toán QR');
    }
    const customerIds = [...new Set(allocations.map(item => item.customerId).filter(id => id && id !== 'new_cust_temp'))];
    const customerEntries = await Promise.all(customerIds.map(async customerId => {
      const ref = db!.collection('customers').doc(customerId);
      return { customerId, ref, snap: await transaction.get(ref) };
    }));

    const totalsByCustomer = new Map<string, { visits: number; spent: number }>();
    allocations.forEach(item => {
      if (!item.customerId || item.customerId === 'new_cust_temp') return;
      const current = totalsByCustomer.get(item.customerId) || { visits: 0, spent: 0 };
      // A parallel booking is one customer visit even when it contains many service appointments.
      current.visits = 1;
      current.spent += Number(item.totalAfterDiscount ?? item.billAmount) || 0;
      totalsByCustomer.set(item.customerId, current);
    });

    customerEntries.forEach(({ customerId, ref, snap }) => {
      if (!snap.exists) return;
      const customer = snap.data() || {};
      const totals = totalsByCustomer.get(customerId)!;
      transaction.update(ref, {
        totalVisits: (Number(customer.totalVisits) || 0) + totals.visits,
        totalSpent: (Number(customer.totalSpent) || 0) + totals.spent
      });
    });

    allocations.forEach((item, index) => {
      const appt = appts[index];
      const commission = calculateStaffCommission(item.billAmount, item.commissionRate, orderHasDiscount(item));
      transaction.update(apptRefs[index], {
        status: 'completed',
        paymentStatus: 'paid',
        paymentMethod: 'transfer',
        paymentCollectedAmount: item.collectedAmount,
        commissionRate: item.commissionRate,
        commissionAmount: commission,
        pendingStatusApproval: firebase.firestore.FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });
      transaction.set(db!.collection('staff_income').doc(item.appointmentId), {
        staffId: item.staffId,
        staffName: item.staffName,
        appointmentId: item.appointmentId,
        date: appt.date,
        totalPrice: item.billAmount,
        commissionRate: item.commissionRate,
        commission,
        paymentTransactionId,
        createdAt: new Date().toISOString()
      });
    });

    if (dedupRef) {
      transaction.set(dedupRef, {
        transactionId: webhookData.transactionId || '',
        referenceCode: webhookData.referenceCode || '',
        amount,
        content: webhookData.content || '',
        appointmentIds: allocations.map(item => item.appointmentId),
        paymentTransactionId,
        paymentCode,
        processedAt: new Date().toISOString(),
        status: 'success'
      });
    }
    transaction.update(sessionRef, { status: 'completed', updatedAt: new Date().toISOString() });
    transaction.update(paymentRef, { status: 'completed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });

  return { alreadyProcessed, requiresReconciliation };
}

app.post('/api/group-checkout', requireRole('admin', 'staff', 'support'), async (req, res) => {
  const {
    allocations: requestedAllocations,
    paymentMethod
  } = req.body;
  const actor = getRequestUser(req);
  const billEnteredBy = actor.staffId || actor.id;
  const billEnteredByName = actor.name;
  if (!db) return res.status(500).json({ error: "No database connected" });
  if (!Array.isArray(requestedAllocations) || requestedAllocations.length < 2) {
    return res.status(400).json({ error: "Thanh toán nhóm cần ít nhất hai đơn" });
  }
  if (!['cash', 'transfer', 'wallet'].includes(paymentMethod)) {
    return res.status(400).json({ error: "Phương thức thanh toán không hợp lệ" });
  }

  const appointmentIds = requestedAllocations.map((item: any) => String(item.appointmentId || ''));
  if (appointmentIds.some((id: string) => !id) || new Set(appointmentIds).size !== appointmentIds.length) {
    return res.status(400).json({ error: "Danh sách đơn phân bổ không hợp lệ" });
  }

  const paymentCode = paymentMethod === 'transfer' ? generatePaymentCode() : undefined;
  const paymentTransactionId = generateGroupTransactionId();

  try {
    const result = await db.runTransaction(async transaction => {
      const apptRefs = appointmentIds.map((id: string) => db!.collection('appointments').doc(id));
      const apptSnaps = await Promise.all(apptRefs.map((ref: any) => transaction.get(ref)));
      const appts: any[] = apptSnaps.map((snap, index) => {
        if (!snap.exists) throw new Error(`Đơn ${appointmentIds[index]} không tồn tại`);
        return snap.data() || {};
      });

      const groupIds = new Set(appts.map(appt => appt.groupId).filter(Boolean));
      if (groupIds.size !== 1 || appts.some(appt => !appt.groupId)) {
        throw new Error("Các đơn không thuộc cùng một nhóm đặt lịch");
      }
      const groupedCustomerIds = new Set(appts.map(appt => String(appt.customerId || '')));
      if (groupedCustomerIds.size !== 1 || groupedCustomerIds.has('')) {
        throw new Error("Lịch nhóm chỉ được thanh toán chung khi tất cả dịch vụ thuộc cùng một khách");
      }
      const validStatuses = ['pending', 'confirmed', 'in_progress'];
      appts.forEach((appt, index) => {
        if (!validStatuses.includes(appt.status)) {
          throw new Error(`Đơn ${appointmentIds[index]} không còn sẵn sàng để thanh toán`);
        }
      });

      const staffIds = [...new Set(requestedAllocations.map((item: any) => String(item.staffId || '')))];
      if (staffIds.some(id => !id)) throw new Error("Mỗi đơn phải có thợ thực hiện");
      if (actor.role === 'staff' && (!actor.staffId || !staffIds.includes(actor.staffId))) {
        throw new Error('Nhân viên chỉ được tạo thanh toán cho nhóm có dịch vụ do mình thực hiện');
      }
      const staffEntries = await Promise.all(staffIds.map(async staffId => {
        const ref = db!.collection('staff').doc(staffId);
        return { staffId, snap: await transaction.get(ref) };
      }));
      const staffMap = new Map(staffEntries.map(({ staffId, snap }) => {
        if (!snap.exists) throw new Error(`Không tìm thấy thợ ${staffId}`);
        return [staffId, snap.data() || {}];
      }));

      const customerIds = [...new Set(appts.map(appt => appt.customerId).filter(id => id && id !== 'new_cust_temp'))];
      const customerEntries = await Promise.all(customerIds.map(async customerId => {
        const ref = db!.collection('customers').doc(customerId);
        return { customerId, ref, snap: await transaction.get(ref) };
      }));
      const customerMap = new Map(customerEntries.map(entry => [entry.customerId, entry.snap.data() || {}]));
      const remainingWallet = new Map(customerEntries.map(entry => [entry.customerId, Number((entry.snap.data() || {}).walletBalance) || 0]));

      const promotionCodes = [...new Set(requestedAllocations
        .map((item: any) => normalizePromotionCode(item.promotionCode))
        .filter(Boolean))];
      const promotionEntries = await Promise.all(promotionCodes.map(async code => {
        const ref = db!.collection('promotion_codes').doc(code);
        return { code, ref, snap: await transaction.get(ref) };
      }));
      const promotionMap = new Map(promotionEntries.map(entry => [entry.code, entry.snap.data()]));
      const resolvedAllocations: GroupPaymentAllocation[] = requestedAllocations.map((requested: any, index: number) => {
        const appt = appts[index];
        const billAmount = Number(requested.totalPrice);
        if (!Number.isFinite(billAmount) || billAmount < 0) throw new Error(`Giá bill của đơn ${appointmentIds[index]} không hợp lệ`);
        const promotionCode = normalizePromotionCode(requested.promotionCode);
        const promotion = resolvePromotionSnapshot(promotionMap.get(promotionCode), promotionCode, billAmount);
        const staffData: any = staffMap.get(String(requested.staffId));
        const commissionRate = Number(staffData.commissionRate) || 0;
        let depositUsed = 0;
        if (requested.useDeposit && appt.customerId && remainingWallet.has(appt.customerId)) {
          const available = remainingWallet.get(appt.customerId) || 0;
          const hasAssignedDeposit = appt.assignedDepositAmount !== undefined && appt.assignedDepositAmount !== null;
          const assignedDeposit = hasAssignedDeposit ? Number(appt.assignedDepositAmount) : Math.min(available, promotion.totalAfterDiscount);
          if (!Number.isFinite(assignedDeposit) || assignedDeposit < 0 || assignedDeposit > promotion.totalAfterDiscount) {
            throw new Error(`Tiền cọc của đơn ${appointmentIds[index]} không hợp lệ`);
          }
          if (available < assignedDeposit) throw new Error(`Ví khách không đủ cọc cho đơn ${appointmentIds[index]}`);
          depositUsed = assignedDeposit;
          remainingWallet.set(appt.customerId, available - depositUsed);
        }
        return {
          appointmentId: appointmentIds[index],
          customerId: appt.customerId || '',
          staffId: String(requested.staffId),
          staffName: staffData.name || 'Staff',
          billAmount,
          ...promotion,
          depositUsed,
          collectedAmount: promotion.totalAfterDiscount - depositUsed,
          commissionRate,
          originalAppointmentStatus: appt.status || 'pending'
        };
      });

      const totalAmount = resolvedAllocations.reduce((sum, item) => sum + item.collectedAmount, 0);
      if (paymentMethod === 'wallet' && totalAmount !== 0) throw new Error("Chỉ dùng ví khi số tiền cần thu bằng 0");
      // A bank transfer is only complete after the SePay webhook confirms receipt.
      // Do not let an admin-created QR mark appointments as paid prematurely.
      const completesNow = shouldCompleteCheckoutImmediately(actor.role, paymentMethod, totalAmount);
      const deductDepositNow = paymentMethod === 'transfer' || completesNow;

      const totalsByCustomer = new Map<string, { deposit: number; visits: number; spent: number }>();
      resolvedAllocations.forEach(item => {
        if (!item.customerId || item.customerId === 'new_cust_temp') return;
        const current = totalsByCustomer.get(item.customerId) || { deposit: 0, visits: 0, spent: 0 };
        current.deposit += item.depositUsed;
        if (completesNow) {
          // The group represents one visit; service revenue is still allocated per child appointment.
          current.visits = 1;
          current.spent += item.totalAfterDiscount;
        }
        totalsByCustomer.set(item.customerId, current);
      });

      if (deductDepositNow || completesNow) {
        customerEntries.forEach(({ customerId, ref, snap }) => {
          if (!snap.exists) return;
          const customer = customerMap.get(customerId) || {};
          const totals = totalsByCustomer.get(customerId) || { deposit: 0, visits: 0, spent: 0 };
          const updates: any = {};
          if (deductDepositNow && totals.deposit > 0) {
            updates.walletBalance = (Number(customer.walletBalance) || 0) - totals.deposit;
            updates.walletVersion = (Number(customer.walletVersion) || 0) + 1;
          }
          if (completesNow) {
            updates.totalVisits = (Number(customer.totalVisits) || 0) + totals.visits;
            updates.totalSpent = (Number(customer.totalSpent) || 0) + totals.spent;
          }
          if (Object.keys(updates).length > 0) transaction.update(ref, updates);
        });
      }

      const paymentStatus = paymentMethod === 'transfer' ? 'pending' : completesNow ? 'completed' : 'pending_approval';
      const paymentRef = db!.collection('payment_transactions').doc(paymentTransactionId);
      transaction.set(paymentRef, {
        groupId: appts[0].groupId,
        paymentMethod,
        totalAmount,
        totalBillAmount: resolvedAllocations.reduce((sum, item) => sum + item.billAmount, 0),
        totalDiscountAmount: resolvedAllocations.reduce((sum, item) => sum + item.discountAmount, 0),
        totalAfterDiscount: resolvedAllocations.reduce((sum, item) => sum + item.totalAfterDiscount, 0),
        depositUsed: resolvedAllocations.reduce((sum, item) => sum + item.depositUsed, 0),
        depositDeducted: deductDepositNow && resolvedAllocations.some(item => item.depositUsed > 0),
        allocations: resolvedAllocations,
        appointmentIds,
        billEnteredBy,
        billEnteredByName,
        ...(completesNow ? {
          approvedBy: actor.id,
          approvedByName: actor.name,
          approvedByRole: actor.role,
          approvedAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        } : {}),
        paymentCode: paymentCode || null,
        status: paymentStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      if (paymentMethod === 'transfer') {
        transaction.set(db!.collection('payment_sessions').doc(paymentCode!), {
          paymentTransactionId,
          appointmentId: appointmentIds[0],
          appointmentIds,
          allocations: resolvedAllocations,
          amountDue: totalAmount,
          depositUsed: resolvedAllocations.reduce((sum, item) => sum + item.depositUsed, 0),
          depositDeducted: resolvedAllocations.some(item => item.depositUsed > 0),
          status: 'pending',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
      }

      resolvedAllocations.forEach((item, index) => {
        const commission = calculateStaffCommission(item.billAmount, item.commissionRate, orderHasDiscount(item));
        const nextStatus = completesNow ? 'completed' : 'awaiting_payment';
        transaction.update(apptRefs[index], {
          staffId: item.staffId,
          staffName: item.staffName,
          totalPrice: item.billAmount,
          paymentAllocatedAmount: item.collectedAmount,
          paymentTransactionId,
          billEnteredBy,
          billEnteredByName,
          paymentMethod,
          depositUsed: item.depositUsed,
          subtotal: item.billAmount,
          discountCode: item.code || firebase.firestore.FieldValue.delete(),
          discountPercent: item.discountPercent || firebase.firestore.FieldValue.delete(),
          discountAmount: item.discountAmount,
          totalAfterDiscount: item.totalAfterDiscount,
          depositDeducted: deductDepositNow && item.depositUsed > 0,
          amountDue: item.collectedAmount,
          useDeposit: item.depositUsed > 0,
          status: nextStatus,
          previousStatus: item.originalAppointmentStatus,
          ...(paymentCode ? { paymentCode } : {}),
          ...(completesNow ? {
            paymentStatus: 'paid',
            paymentCollectedAmount: item.collectedAmount,
            commissionRate: item.commissionRate,
            commissionAmount: commission,
            approvedBy: actor.id,
            approvedByName: actor.name,
            approvedByRole: actor.role,
            approvedAt: new Date().toISOString(),
            pendingStatusApproval: firebase.firestore.FieldValue.delete()
          } : { pendingStatusApproval: 'completed' }),
          updatedAt: new Date().toISOString()
        });

        if (completesNow) {
          transaction.set(db!.collection('staff_income').doc(item.appointmentId), {
            staffId: item.staffId,
            staffName: item.staffName,
            appointmentId: item.appointmentId,
            date: appts[index].date,
            totalPrice: item.billAmount,
            commissionRate: item.commissionRate,
            commission,
            paymentTransactionId,
            createdAt: new Date().toISOString()
          });
        }
      });

      return { finalAmountDue: totalAmount, paymentTransactionId };
    });

    res.json({ success: true, paymentMethod, paymentCode, ...result });
  } catch (error: any) {
    console.error('[group-checkout] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkout', requireRole('admin', 'staff', 'support'), async (req, res) => {
  const { appointmentId, paymentMethod, totalPrice, useDeposit, promotionCode: requestedPromotionCode } = req.body;
  const actor = getRequestUser(req);
  if (!db) return res.status(500).json({ error: "No database connected" });
  if (!['cash', 'transfer', 'wallet'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Phương thức thanh toán không hợp lệ' });
  }

  try {
    const apptRef = db.collection('appointments').doc(appointmentId);
    
    // Server-Authoritative Checkout using a transaction (Requirement 3)
    const resultPayload = await db.runTransaction(async (transaction) => {
      const apptSnap = await transaction.get(apptRef);
      const appt = apptSnap.data();
      if (!appt) {
        throw new Error("Đơn hàng không tồn tại");
      }
      if (actor.role === 'staff' && actor.staffId !== appt.staffId) {
        throw new Error('Nhân viên chỉ được checkout đơn được giao cho mình');
      }

      if (appt.status === 'completed') {
        return { alreadyCompleted: true, appt, finalAmountDue: appt.amountDue || 0 };
      }
      assertStandaloneCheckoutAvailable({
        id: appointmentId,
        status: appt.status,
        paymentTransactionId: appt.paymentTransactionId
      });

      const finalTotalPrice = totalPrice !== undefined ? Number(totalPrice) : Number(appt.totalPrice || 0);
      if (!Number.isFinite(finalTotalPrice) || finalTotalPrice < 0) {
        throw new Error("Giá đơn checkout không hợp lệ");
      }
      const promotionCode = normalizePromotionCode(requestedPromotionCode);
      let promotion: PromotionSnapshot = { discountAmount: 0, totalAfterDiscount: finalTotalPrice };
      let promotionRef: firebase.firestore.DocumentReference | null = null;
      if (promotionCode) {
        promotionRef = db.collection('promotion_codes').doc(promotionCode);
        const promotionSnap = await transaction.get(promotionRef);
        const promotionData: any = promotionSnap.data();
        promotion = resolvePromotionSnapshot(promotionData, promotionCode, finalTotalPrice);
      }
      const resolvedUseDeposit = (useDeposit !== undefined) ? !!useDeposit : (appt.useDeposit ?? true);

      let finalDepositUsed = 0;
      let finalAmountDue = promotion.totalAfterDiscount;

      // Calculate deposit used and amount due based on server-side state
      let walletBalance = 0;
      let custRef;
      let custSnap;
      if (appt.customerId && appt.customerId !== 'new_cust_temp') {
        custRef = db.collection('customers').doc(appt.customerId);
        custSnap = await transaction.get(custRef);
        if (custSnap.exists) {
          walletBalance = Number((custSnap.data() as any)?.walletBalance) || 0;
        }
      }

      let snapshotRate = appt.commissionRate;
      let staffName = appt.staffName;
      let staffRef;
      if (appt.staffId) {
        staffRef = db.collection('staff').doc(appt.staffId);
        const staffSnap = await transaction.get(staffRef);
        if (staffSnap.exists) {
          const staffData = staffSnap.data() as any;
          if (snapshotRate === undefined && staffData) {
            snapshotRate = staffData.commissionRate;
          }
          if (!staffName && staffData) {
            staffName = staffData.name;
          }
        }
      }

      const hasAssignedDeposit = appt.assignedDepositAmount !== undefined && appt.assignedDepositAmount !== null;
      const assignedDepositAmount = hasAssignedDeposit ? Number(appt.assignedDepositAmount) : 0;
      if (hasAssignedDeposit && (!Number.isFinite(assignedDepositAmount) || assignedDepositAmount < 0)) {
        throw new Error("Số tiền cọc được gán không hợp lệ");
      }
      if (hasAssignedDeposit && assignedDepositAmount > promotion.totalAfterDiscount) {
        throw new Error(
          `Số tiền cọc được gán (${assignedDepositAmount.toLocaleString()}đ) không được lớn hơn giá sau giảm (${promotion.totalAfterDiscount.toLocaleString()}đ)`
        );
      }

      if (resolvedUseDeposit && appt.customerId && appt.customerId !== 'new_cust_temp') {
        if (hasAssignedDeposit) {
          finalDepositUsed = assignedDepositAmount;
          if (walletBalance < finalDepositUsed) {
            throw new Error(`Ví không đủ số dư để khấu trừ ${finalDepositUsed.toLocaleString()}đ, hiện chỉ còn ${walletBalance.toLocaleString()}đ`);
          }
        } else {
          finalDepositUsed = Math.min(walletBalance, promotion.totalAfterDiscount);
        }
      }

      finalAmountDue = Math.max(0, promotion.totalAfterDiscount - finalDepositUsed);

      // Chuyển khoản cần chốt số tiền QR ngay; đơn hoàn tất trực tiếp cũng trừ cọc ngay.
      // Riêng tiền mặt chờ admin duyệt chỉ ghi nhận cọc dự kiến, chưa thay đổi số dư ví.
      const shouldDeductDepositNow =
        paymentMethod === 'transfer' || shouldCompleteCheckoutImmediately(actor.role, paymentMethod, finalAmountDue);
      if (custRef && custSnap && custSnap.exists && finalDepositUsed > 0 && shouldDeductDepositNow) {
        const currentVersion = (custSnap.data() as any)?.walletVersion || 0;
        transaction.update(custRef, {
          walletBalance: Math.max(0, walletBalance - finalDepositUsed),
          walletVersion: currentVersion + 1
        });
      }

      if (paymentMethod === 'transfer') {
        // Generate a 15-character paymentCode: SEVQR + 10 random alpha-numeric
        const paymentCode = generatePaymentCode();

        // Create direct document payment_sessions/{paymentCode}
        const sessionRef = db.collection('payment_sessions').doc(paymentCode);
        transaction.set(sessionRef, {
          appointmentId,
          amountDue: finalAmountDue,
          depositUsed: finalDepositUsed,
          depositDeducted: finalDepositUsed > 0,
          totalPrice: finalTotalPrice,
          subtotal: finalTotalPrice,
          discountCode: promotion.code || null,
          discountPercent: promotion.discountPercent || null,
          discountAmount: promotion.discountAmount,
          totalAfterDiscount: promotion.totalAfterDiscount,
          useDeposit: resolvedUseDeposit,
          status: 'pending',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          originalAppointmentStatus: appt.status
        });

        // Set appointment to awaiting_payment
        transaction.update(apptRef, {
          status: 'awaiting_payment',
          pendingStatusApproval: 'completed', // keep for legacy compat
          paymentMethod,
          depositUsed: finalDepositUsed,
          depositDeducted: finalDepositUsed > 0,
          amountDue: finalAmountDue,
          useDeposit: resolvedUseDeposit,
          paymentCode,
          totalPrice: finalTotalPrice,
          billEnteredBy: actor.staffId || actor.id,
          billEnteredByName: actor.name,
          previousStatus: appt.status || 'pending',
          updatedAt: new Date().toISOString()
        });

        return { alreadyCompleted: false, appt, finalAmountDue, finalDepositUsed, paymentCode };
      } else {
        const paymentCode = appointmentId.slice(-6).toUpperCase();

        // If amountDue is 0, we can transition it directly to completed
        if (shouldCompleteCheckoutImmediately(actor.role, paymentMethod, finalAmountDue)) {
          const promotionHasDiscount = orderHasDiscount({ discountCode: promotion.code, discountAmount: promotion.discountAmount });
          const commissionAmount = calculateStaffCommission(finalTotalPrice, snapshotRate, promotionHasDiscount);
          transaction.update(apptRef, {
            status: 'completed',
            pendingStatusApproval: firebase.firestore.FieldValue.delete(),
            paymentMethod,
            depositUsed: finalDepositUsed,
            depositDeducted: finalDepositUsed > 0,
            amountDue: finalAmountDue,
            useDeposit: resolvedUseDeposit,
            paymentCollectedAmount: finalAmountDue,
            paymentStatus: 'paid',
            billEnteredBy: actor.staffId || actor.id,
            billEnteredByName: actor.name,
            ...(actor.role === 'admin' ? {
              approvedBy: actor.id,
              approvedByName: actor.name,
              approvedByRole: actor.role,
              approvedAt: new Date().toISOString()
            } : {}),
            paymentCode,
            totalPrice: finalTotalPrice,
            subtotal: finalTotalPrice,
            discountCode: promotion.code || firebase.firestore.FieldValue.delete(),
            discountPercent: promotion.discountPercent || firebase.firestore.FieldValue.delete(),
            discountAmount: promotion.discountAmount,
            totalAfterDiscount: promotion.totalAfterDiscount,
            updatedAt: new Date().toISOString(),
            ...(snapshotRate !== undefined && { commissionRate: snapshotRate }),
            commissionAmount: commissionAmount
          });

          // Update customer totalSpent and totalVisits
          if (custRef && custSnap && custSnap.exists) {
            const custData = (custSnap.data() as any) || {};
            const spentIncrement = promotion.totalAfterDiscount;
            transaction.update(custRef, {
              totalVisits: (custData.totalVisits || 0) + 1,
              totalSpent: (custData.totalSpent || 0) + spentIncrement
            });
          }

          // Record staff income
          if (appt.staffId && snapshotRate !== undefined) {
            const commission = calculateStaffCommission(finalTotalPrice, snapshotRate, promotionHasDiscount);
            transaction.set(db.collection('staff_income').doc(appointmentId), {
              staffId: appt.staffId,
              staffName: staffName || appt.staffName || 'Staff',
              appointmentId,
              date: appt.date,
              totalPrice: finalTotalPrice,
              commissionRate: snapshotRate,
              commission,
              createdAt: new Date().toISOString()
            });
          }
        } else {
          // Otherwise, mark as awaiting_payment
          transaction.update(apptRef, {
            status: 'awaiting_payment',
            pendingStatusApproval: 'completed', // keep for legacy compat
            paymentMethod,
            depositUsed: finalDepositUsed,
            depositDeducted: false,
            amountDue: finalAmountDue,
            useDeposit: resolvedUseDeposit,
            paymentCode,
            totalPrice: finalTotalPrice,
            subtotal: finalTotalPrice,
            discountCode: promotion.code || firebase.firestore.FieldValue.delete(),
            discountPercent: promotion.discountPercent || firebase.firestore.FieldValue.delete(),
            discountAmount: promotion.discountAmount,
            totalAfterDiscount: promotion.totalAfterDiscount,
            billEnteredBy: actor.staffId || actor.id,
            billEnteredByName: actor.name,
            previousStatus: appt.status || 'pending',
            updatedAt: new Date().toISOString()
          });
        }

        return { alreadyCompleted: false, appt, finalAmountDue, finalDepositUsed, paymentCode };
      }
    });

    res.json({ success: true, paymentMethod, ...resultPayload });
  } catch (e: any) {
    console.error('[checkout] Error in checkout API:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/checkout-cancel', requireRole('admin', 'staff', 'support'), async (req, res) => {
  const { appointmentId, paymentCode } = req.body;
  const actor = getRequestUser(req);
  if (!db) return res.status(500).json({ error: "No database connected" });
  if (!paymentCode) return res.status(400).json({ error: "Thiếu mã thanh toán QR" });

  try {
    const sessionPreview = await db.collection('payment_sessions').doc(paymentCode).get();
    const sessionPreviewData = sessionPreview.data();
    if (sessionPreviewData?.paymentTransactionId) {
      const paymentPreview = await db.collection('payment_transactions').doc(sessionPreviewData.paymentTransactionId).get();
      const paymentPreviewData = paymentPreview.data() || {};
      const canCancelGroup = actor.role === 'admin' || actor.role === 'support' ||
        actor.staffId === paymentPreviewData.billEnteredBy || actor.id === paymentPreviewData.billEnteredBy;
      if (!canCancelGroup) return res.status(403).json({ error: 'Bạn không có quyền hủy giao dịch nhóm này' });
      await cancelGroupPaymentTransaction(sessionPreviewData.paymentTransactionId, actor);
      return res.json({ success: true });
    }

    await db.runTransaction(async (transaction) => {
      const sessionRef = db.collection('payment_sessions').doc(paymentCode);
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new Error("Mã thanh toán không tồn tại");
      }
      const sessionData = sessionSnap.data();
      if (!sessionData) throw new Error("Dữ liệu thanh toán trống");

      if (sessionData.status !== 'pending') {
        // Already processed or cancelled, ignore
        return;
      }

      const { appointmentId: sessAppointmentId, depositUsed, depositDeducted, originalAppointmentStatus } = sessionData;

      // Prepare appointment reference and read it
      const apptRef = db.collection('appointments').doc(sessAppointmentId);
      const apptSnap = await transaction.get(apptRef);
      const apptDataForPermission = apptSnap.data() || {};
      const canCancelSingle = actor.role === 'admin' || actor.role === 'support' ||
        actor.staffId === apptDataForPermission.staffId || actor.staffId === apptDataForPermission.billEnteredBy;
      if (!canCancelSingle) throw new Error('Bạn không có quyền hủy phiên thanh toán này');

      // Prepare customer reference and read if necessary (Read-before-write requirement)
      let custRef: firebase.firestore.DocumentReference | null = null;
      let custSnap: firebase.firestore.DocumentSnapshot | null = null;

      if (depositUsed > 0 && depositDeducted !== false && apptSnap.exists) {
        const apptData = apptSnap.data();
        if (apptData && apptData.customerId && apptData.customerId !== 'new_cust_temp') {
          custRef = db.collection('customers').doc(apptData.customerId);
          custSnap = await transaction.get(custRef);
        }
      }

      // --- ALL READS COMPLETED BEFORE THIS LINE ---
      // --- ALL WRITES START BELOW THIS LINE ---

      // Revert appointment status
      if (apptSnap.exists) {
        const apptData = apptSnap.data();
        if (apptData && apptData.status === 'awaiting_payment' && apptData.paymentCode === paymentCode) {
          transaction.update(apptRef, {
            status: apptData.previousStatus || originalAppointmentStatus || 'pending',
            paymentCode: firebase.firestore.FieldValue.delete(),
            amountDue: firebase.firestore.FieldValue.delete(),
            depositUsed: firebase.firestore.FieldValue.delete(),
            depositDeducted: firebase.firestore.FieldValue.delete(),
            subtotal: firebase.firestore.FieldValue.delete(),
            discountCode: firebase.firestore.FieldValue.delete(),
            discountPercent: firebase.firestore.FieldValue.delete(),
            discountAmount: firebase.firestore.FieldValue.delete(),
            totalAfterDiscount: firebase.firestore.FieldValue.delete(),
            paymentMethod: firebase.firestore.FieldValue.delete(),
            pendingStatusApproval: firebase.firestore.FieldValue.delete(),
            previousStatus: firebase.firestore.FieldValue.delete(),
            updatedAt: new Date().toISOString()
          });
        }
      }

      // Revert customer wallet deposit
      if (custRef && custSnap && custSnap.exists) {
        const custData = custSnap.data() || {};
        const walletBalance = custData.walletBalance || 0;
        const currentVersion = custData.walletVersion || 0;
        transaction.update(custRef, {
          walletBalance: walletBalance + depositUsed,
          walletVersion: currentVersion + 1
        });
      }

      // Mark the session doc as cancelled
      transaction.update(sessionRef, {
        status: 'cancelled',
        updatedAt: new Date().toISOString()
      });
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error('[checkout-cancel] Error cancelling checkout session:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/checkout-cancel-request', requireRole('admin', 'staff', 'support'), async (req, res) => {
  const { appointmentId } = req.body;
  const actor = getRequestUser(req);
  if (!db) return res.status(500).json({ error: "No database connected" });
  if (!appointmentId) return res.status(400).json({ error: "Thiếu ID lịch hẹn" });

  try {
    const apptPreview = await db.collection('appointments').doc(appointmentId).get();
    const apptPreviewData = apptPreview.data();
    if (!apptPreviewData) return res.status(404).json({ error: 'Lịch hẹn không tồn tại' });
    const canManagePayment = actor.role === 'admin' || actor.role === 'support' ||
      actor.staffId === apptPreviewData.staffId || actor.staffId === apptPreviewData.billEnteredBy;
    if (!canManagePayment) return res.status(403).json({ error: 'Bạn không có quyền rút yêu cầu thanh toán này' });
    if (apptPreviewData?.paymentTransactionId && apptPreviewData.status === 'awaiting_payment') {
      await cancelGroupPaymentTransaction(apptPreviewData.paymentTransactionId, actor);
      await db.collection("system").doc("sync_status").set({
        collection: "appointments",
        changedAt: new Date().toISOString()
      });
      return res.json({ success: true });
    }

    await db.runTransaction(async (transaction) => {
      const apptRef = db.collection('appointments').doc(appointmentId);
      const apptSnap = await transaction.get(apptRef);
      if (!apptSnap.exists) {
        throw new Error("Lịch hẹn không tồn tại");
      }
      const appt = apptSnap.data();
      if (!appt) throw new Error("Dữ liệu trống");

      if (appt.status !== 'awaiting_payment') {
        // Not awaiting payment, ignore
        return;
      }

      const depositUsed = Number(appt.depositUsed) || 0;
      const paymentCode = appt.paymentCode;
      // 1. If depositUsed > 0, we must refund the wallet
      let custRef = null;
      let custSnap = null;
      if (depositUsed > 0 && appt.depositDeducted !== false && appt.customerId && appt.customerId !== 'new_cust_temp') {
        custRef = db.collection('customers').doc(appt.customerId);
        custSnap = await transaction.get(custRef);
      }

      // 2. If there's a paymentCode (transfer case), locate and cancel the payment session
      let sessionRef = null;
      let sessionSnap = null;
      if (paymentCode) {
        sessionRef = db.collection('payment_sessions').doc(paymentCode);
        sessionSnap = await transaction.get(sessionRef);
      }

      // --- ALL READS COMPLETED ---
      // --- ALL WRITES START BELOW ---

      // Revert customer wallet balance if refund applies
      if (custRef && custSnap && custSnap.exists) {
        const custData = custSnap.data() || {};
        const oldBalance = Number(custData.walletBalance) || 0;
        const currentVersion = Number(custData.walletVersion) || 0;
        transaction.update(custRef, {
          walletBalance: oldBalance + depositUsed,
          walletVersion: currentVersion + 1
        });
      }

      // Update payment session if it exists and is pending
      if (sessionRef && sessionSnap && sessionSnap.exists) {
        const sessData = sessionSnap.data();
        if (sessData && sessData.status === 'pending') {
          transaction.update(sessionRef, {
            status: 'cancelled',
            updatedAt: new Date().toISOString()
          });
        }
      }

      // Revert appointment status and clean fields
      transaction.update(apptRef, {
        status: appt.previousStatus || 'pending',
        paymentCode: firebase.firestore.FieldValue.delete(),
        amountDue: firebase.firestore.FieldValue.delete(),
        depositUsed: firebase.firestore.FieldValue.delete(),
        depositDeducted: firebase.firestore.FieldValue.delete(),
        subtotal: firebase.firestore.FieldValue.delete(),
        discountCode: firebase.firestore.FieldValue.delete(),
        discountPercent: firebase.firestore.FieldValue.delete(),
        discountAmount: firebase.firestore.FieldValue.delete(),
        totalAfterDiscount: firebase.firestore.FieldValue.delete(),
        paymentMethod: firebase.firestore.FieldValue.delete(),
        pendingStatusApproval: firebase.firestore.FieldValue.delete(),
        previousStatus: firebase.firestore.FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });
    });

    // Post sync signal to invalidate cache
    try {
      await db.collection("system").doc("sync_status").set({
        collection: "appointments",
        changedAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn("Failed to set system sync signal:", e);
    }

    res.json({ success: true });
  } catch (e: any) {
    console.error("[checkout-cancel-request] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin-approve', requireRole('admin'), async (req, res) => {
  const { appointmentId } = req.body;
  const actor = getRequestUser(req);
  if (!db) return res.status(500).json({ error: "No database connected" });

  try {
    const apptSnap = await db.collection('appointments').doc(appointmentId).get();
    const appt = apptSnap.data();
    if (!appt) {
      return res.status(400).json({ error: "Đơn hàng không tồn tại" });
    }

    if (appt.paymentMethod !== 'cash') {
      return res.status(400).json({ error: "Không thể duyệt đơn QR/Chuyển khoản bằng nút duyệt tiền mặt. Chỉ hỗ trợ duyệt phương thức tiền mặt." });
    }
    
    const isAwaiting = appt.status === 'awaiting_payment' && appt.pendingStatusApproval === 'completed';
    if (!isAwaiting) {
      return res.status(400).json({ error: "Đơn hàng không ở trạng thái chờ duyệt thanh toán" });
    }
    
    if (appt.paymentTransactionId) {
      await settlePendingGroupPayment(appt.paymentTransactionId, actor);
    } else {
      await settleAppointment(appointmentId, appt.amountDue || 0, actor);
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cancel-appointment', requireRole('admin', 'support'), async (req, res) => {
  const { appointmentId, refundDeposit = false } = req.body;
  const shouldRefundDeposit = refundDeposit === true;
  const actor = getRequestUser(req);
  if (!db) return res.status(500).json({ error: "No database connected" });
  if (!appointmentId) return res.status(400).json({ error: "Missing appointmentId" });

  try {
    const groupPreview = await db.collection('appointments').doc(appointmentId).get();
    const groupPreviewData = groupPreview.data();
    const groupTransactionToUnwind = groupPreviewData
      ? getGroupPaymentTransactionToUnwind(groupPreviewData)
      : null;
    if (groupTransactionToUnwind) {
      // Always unwind the shared payment first. This restores every allocation and
      // refunds the checkout deposit once before the selected booking is cancelled.
      await cancelGroupPaymentTransaction(groupTransactionToUnwind, actor);
    }

    const cancelledAppointment = await db.runTransaction(async (transaction) => {
      const apptRef = db.collection('appointments').doc(appointmentId);
      const apptSnap = await transaction.get(apptRef);
      if (!apptSnap.exists) {
        throw new Error("Lịch hẹn không tồn tại");
      }
      const appt = apptSnap.data();
      if (!appt) throw new Error("Dữ liệu lịch hẹn trống");

      if (appt.status === 'cancelled') {
        // already cancelled, success (idempotent)
        return null;
      }

      if (appt.status === 'completed') {
        throw new Error("Không thể hủy lịch hẹn đã hoàn thành");
      }

      const isAwaitingPayment = appt.status === 'awaiting_payment';
      const depositUsed = Number(appt.depositUsed) || 0;
      const bookingDepositAmount = getBookingDepositAmount(
        appt.depositAmount,
        appt.assignedDepositAmount
      );

      // Khi hủy checkout, hoàn tác phần cọc đã khấu trừ. Nếu admin chọn hoàn cọc,
      // đồng thời rút đúng tiền cọc của đơn khỏi ví vì tiền đã được trả lại cho khách.
      let custRef = null;
      let custSnap = null;
      const walletDelta = calculateCancellationWalletDelta({
        status: appt.status,
        depositUsed,
        depositDeducted: appt.depositDeducted,
        depositAmount: appt.depositAmount,
        assignedDepositAmount: appt.assignedDepositAmount,
        refundDeposit: shouldRefundDeposit
      });
      if (walletDelta !== 0 && appt.customerId && appt.customerId !== 'new_cust_temp') {
        custRef = db.collection('customers').doc(appt.customerId);
        custSnap = await transaction.get(custRef);
      }

      // 2. If there's a paymentCode, locate and update the payment session
      let sessionRef = null;
      let sessionSnap = null;
      if (appt.paymentCode) {
        sessionRef = db.collection('payment_sessions').doc(appt.paymentCode);
        sessionSnap = await transaction.get(sessionRef);
      }

      // --- ALL READS MUST HAPPEN BEFORE WRITES ---
      // Now, do updates:
      
      // Update customer wallet exactly once inside the cancellation transaction.
      if (custRef && custSnap && custSnap.exists) {
        const custData = custSnap.data() || {};
        const oldBalance = Number(custData.walletBalance) || 0;
        const currentVersion = Number(custData.walletVersion) || 0;
        const newBalance = oldBalance + walletDelta;
        if (newBalance < 0) {
          throw new Error(
            `Số dư cọc không đủ để hoàn ${bookingDepositAmount.toLocaleString()}đ. Hiện có ${oldBalance.toLocaleString()}đ`
          );
        }
        transaction.update(custRef, {
          walletBalance: newBalance,
          walletVersion: currentVersion + 1
        });
      }

      // Update payment session if it exists and is pending
      if (sessionRef && sessionSnap && sessionSnap.exists) {
        const sessData = sessionSnap.data();
        if (sessData && sessData.status === 'pending') {
          transaction.update(sessionRef, {
            status: 'cancelled',
            updatedAt: new Date().toISOString()
          });
        }
      }

      // Update appointment
      const updates: any = {
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
        cancellationDepositAction: shouldRefundDeposit ? 'refunded' : 'not_refunded',
        paymentCode: firebase.firestore.FieldValue.delete(),
        amountDue: firebase.firestore.FieldValue.delete(),
        depositUsed: firebase.firestore.FieldValue.delete(),
        depositDeducted: firebase.firestore.FieldValue.delete(),
        pendingStatusApproval: firebase.firestore.FieldValue.delete()
      };

      // "paymentMethod nếu đây chỉ là phương thức đang chờ duyệt."
      if (isAwaitingPayment) {
        updates.paymentMethod = firebase.firestore.FieldValue.delete();
      }

      // Lưu vết số tiền thực tế đã hoàn cho khách.
      if (shouldRefundDeposit && bookingDepositAmount > 0) {
        updates.depositRefundedAmount = bookingDepositAmount;
        updates.depositRefundedAt = new Date().toISOString();
      }

      transaction.update(apptRef, updates);
      return appt;
    });

    // Post sync signal to invalidate cache
    try {
      const syncPayload: any = {
        appointments: {
          collectionName: "appointments",
          documentId: appointmentId,
          operation: "upsert",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          senderId: "server"
        }
      };
      if (
        cancelledAppointment?.customerId &&
        cancelledAppointment.customerId !== 'new_cust_temp' &&
        (shouldRefundDeposit || Boolean(groupTransactionToUnwind))
      ) {
        syncPayload.customers = {
          collectionName: "customers",
          documentId: cancelledAppointment.customerId,
          operation: "upsert",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          senderId: "server"
        };
      }
      await db.collection("system").doc("sync_status").set(syncPayload, { merge: true });
    } catch (e) {
      console.warn("Failed to set system sync signal:", e);
    }

    // Only broadcast for the transaction that actually changed the appointment.
    // A repeated request for an already-cancelled appointment stays idempotent and silent.
    if (cancelledAppointment) {
      const customerName = cancelledAppointment.customerName || "khách hàng";
      const appointmentTime = cancelledAppointment.time || "chưa rõ giờ";
      const appointmentDate = cancelledAppointment.date || "chưa rõ ngày";

      try {
        await broadcastPushNotification(
          "❌ Lịch Hẹn Đã Bị Hủy!",
          `Lịch hẹn của khách ${customerName} lúc ${appointmentTime} ngày ${appointmentDate} đã bị hủy. Vui lòng cập nhật lại lịch biểu!`,
          `appt-cancel-${appointmentId}`,
          "/"
        );
      } catch (pushError) {
        // The cancellation is already committed; a push-provider failure must not
        // turn a successful cancellation into an API error or trigger a retry.
        console.error("[cancel-appointment] Failed to broadcast cancellation push:", pushError);
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    console.error("[cancel-appointment] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// SePay Webhook for automatic bank transfer confirmation
const handleSePayWebhook = async (req: express.Request, res: express.Response) => {
  console.log("[SePay Webhook] Nhận request webhook:", JSON.stringify(req.body));
  
  // 1. Xác thực bảo mật webhook từ SePay bằng Authorization header
  const authHeader = req.headers['authorization'];
  const expectedApiKey = process.env.SEPAY_API_KEY || "emMinhthichchiHoanganhratnhieu";

  if (!authHeader) {
    console.error("[SePay Webhook] Lỗi bảo mật: Thiếu header Authorization");
    return res.status(401).json({ error: "Unauthorized: Missing Authorization header" });
  }

  // Trích xuất API Key từ định dạng "Apikey API_KEY_CUA_BAN"
  let receivedKey = authHeader;
  if (authHeader.toLowerCase().startsWith("apikey ")) {
    receivedKey = authHeader.substring(7).trim();
  }

  if (receivedKey !== expectedApiKey) {
    console.error(`[SePay Webhook] Lỗi bảo mật: API Key không trùng khớp. Nhận được: "${receivedKey}"`);
    return res.status(403).json({ error: "Forbidden: Invalid API Key" });
  }

  console.log("[SePay Webhook] Xác thực webhook thành công.");

  try {
    const { content, transferAmount } = req.body;
    const amount = transferAmount !== undefined ? Number(transferAmount) : Number(req.body.amount || 0);
    const transactionId = req.body.id || req.body.transactionId;
    const referenceCode = req.body.referenceCode || req.body.reference;
    
    // Tạo khóa chống trùng lặp (Deduplication Key) dựa trên ID giao dịch duy nhất của SePay hoặc số tham chiếu ngân hàng
    const dedupKey = transactionId ? String(transactionId) : (referenceCode ? String(referenceCode) : null);

    if (!db) {
      console.error("[SePay Webhook] Lỗi: Database chưa được khởi tạo trên server");
      return res.status(500).json({ error: "Database not running on server" });
    }

    // A. Đọc paymentCode: Ưu tiên đọc từ req.body.code, fallback mới trích từ req.body.content
    let paymentCode = "";
    if (req.body.code) {
      paymentCode = String(req.body.code).trim().toUpperCase();
    }
    
    if (!paymentCode && content) {
      const match = content.match(/SEVQR[A-Z0-9]{10}/i);
      if (match) {
        paymentCode = match[0].toUpperCase();
      }
    }

    if (!paymentCode || !/^SEVQR[A-Z0-9]{10}$/.test(paymentCode)) {
      console.log(`[SePay Webhook] Không tìm thấy mã thanh toán khớp chính xác dạng /^SEVQR[A-Z0-9]{10}$/: "${paymentCode}"`);
      return res.status(200).json({ success: false, message: "No matching payment code in transaction" });
    }

    console.log(`[SePay Webhook] Đã nhận mã thanh toán SEVQR code: "${paymentCode}"`);

    // Giao dịch nhóm dùng một mã QR nhưng phân bổ về nhiều đơn/thợ.
    // Nhánh riêng này giữ nguyên hoàn toàn luồng checkout đơn lẻ cũ bên dưới.
    const groupSessionPreview = await db.collection('payment_sessions').doc(paymentCode).get();
    const groupSessionData = groupSessionPreview.data();
    if (groupSessionData?.paymentTransactionId) {
      const groupResult = await settleGroupTransfer(paymentCode, amount, dedupKey, {
        transactionId,
        referenceCode,
        content
      });
      return res.status(200).json({
        success: true,
        message: groupResult.requiresReconciliation
          ? "Payment received after the QR became terminal and was queued for reconciliation."
          : groupResult.alreadyProcessed
          ? "Transaction already processed or ignored."
          : "Group payment confirmed and allocations settled."
      });
    }

    // Chạy Idempotent Transaction duy nhất để giải quyết tất cả logic ghi nhận giao dịch, hoàn tất đơn, tính hoa hồng, cập nhật thợ & khách
    let isAlreadyProcessed = false;
    let appointmentIdToSettle = "";

    await db.runTransaction(async (transaction) => {
      // 1. Kiểm tra trùng lặp giao dịch trước (Deduplication Check)
      if (dedupKey) {
        const txRef = db.collection('sepay_transactions').doc(dedupKey);
        const txSnap = await transaction.get(txRef);
        if (txSnap.exists) {
          console.log(`[SePay Webhook] Giao dịch trùng lặp phát hiện. Key: ${dedupKey} đã được xử lý.`);
          isAlreadyProcessed = true;
          return;
        }
      }

      // 2. Đọc trực tiếp payment_sessions/{paymentCode}
      const sessionRef = db.collection('payment_sessions').doc(paymentCode);
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new Error(`Mã thanh toán không tồn tại: ${paymentCode}`);
      }
      const sessionData = sessionSnap.data();
      if (!sessionData) {
        throw new Error("Dữ liệu payment session trống");
      }

      if (sessionData.status !== 'pending') {
        console.log(`[SePay Webhook] Giao dịch cho mã ${paymentCode} đã được xử lý hoặc hủy trước đó (status: ${sessionData.status})`);
        isAlreadyProcessed = true;
        return;
      }

      const { appointmentId, amountDue } = sessionData;
      appointmentIdToSettle = appointmentId;

      // 3. Đọc trực tiếp appointments/{appointmentId}
      const apptRef = db.collection('appointments').doc(appointmentId);
      const apptSnap = await transaction.get(apptRef);
      if (!apptSnap.exists) {
        throw new Error(`Lịch hẹn không tồn tại: ${appointmentId}`);
      }
      const apptData = apptSnap.data();
      if (!apptData) {
        throw new Error("Dữ liệu appointment trống");
      }

      if (apptData.status === 'completed') {
        console.log(`[SePay Webhook] Lịch hẹn ${appointmentId} đã hoàn thành trước đó.`);
        isAlreadyProcessed = true;
        return;
      }

      // 4. Kiểm tra sai số số tiền (cho phép ±5,000 VND)
      const amountDifference = Math.abs(amount - amountDue);
      if (amountDifference > 5000) {
        throw new Error(`Số tiền thanh toán không khớp. Yêu cầu: ${amountDue} VND (±5000), Nhận: ${amount} VND`);
      }

      // 5. Đọc thông tin khách hàng nếu có
      let custRef = null;
      let custSnap = null;
      if (apptData.customerId && apptData.customerId !== 'new_cust_temp') {
        custRef = db.collection('customers').doc(apptData.customerId);
        custSnap = await transaction.get(custRef);
      }

      // 6. Đọc thông tin thợ để lấy commissionRate của thợ lúc hoàn tất
      let snapshotRate = apptData.commissionRate;
      let staffName = apptData.staffName;
      if (apptData.staffId) {
        const staffRef = db.collection('staff').doc(apptData.staffId);
        const staffSnap = await transaction.get(staffRef);
        if (staffSnap.exists) {
          const staffData = staffSnap.data() || {};
          if (snapshotRate === undefined) {
            snapshotRate = staffData.commissionRate;
          }
          if (!staffName) {
            staffName = staffData.name;
          }
        }
      }

      // GHI NHẬN GIAO DỊCH, CẬP NHẬT SESSION, APPOINTMENT, CUSTOMER VÀ STAFF INCOME TRONG WORKFLOW TRANSACTION IDEMPOTENT
      
      // a. Ghi sepay_transactions
      if (dedupKey) {
        const txRef = db.collection('sepay_transactions').doc(dedupKey);
        transaction.set(txRef, {
          transactionId: transactionId || '',
          referenceCode: referenceCode || '',
          amount,
          content,
          appointmentId,
          paymentCode,
          processedAt: new Date().toISOString(),
          status: 'success'
        });
      }

      // b. Cập nhật payment session
      transaction.update(sessionRef, {
        status: 'completed',
        updatedAt: new Date().toISOString()
      });

      // c. Cập nhật Appointment sang completed
      const spentIncrement = amount + (apptData.depositUsed || 0);
      const webhookCommissionAmount = snapshotRate !== undefined
        ? calculateStaffCommission(apptData.totalPrice, snapshotRate, orderHasDiscount(sessionData))
        : undefined;
      transaction.update(apptRef, {
        status: 'completed',
        paymentStatus: 'paid',
        paymentMethod: 'transfer',
        paymentCollectedAmount: amount,
        updatedAt: new Date().toISOString(),
        pendingStatusApproval: firebase.firestore.FieldValue.delete(),
        // Propagate the discount snapshot from payment_sessions onto the appointment
        // itself so later reads (reports, payroll, re-settlement) see it too —
        // previously these fields only lived on the payment_sessions doc.
        discountCode: sessionData.discountCode || firebase.firestore.FieldValue.delete(),
        discountPercent: sessionData.discountPercent || firebase.firestore.FieldValue.delete(),
        discountAmount: sessionData.discountAmount || 0,
        totalAfterDiscount: sessionData.totalAfterDiscount ?? amount,
        ...(snapshotRate !== undefined && { commissionRate: snapshotRate }),
        ...(webhookCommissionAmount !== undefined && { commissionAmount: webhookCommissionAmount })
      });

      // d. Cập nhật thống kê khách hàng
      if (custRef && custSnap && custSnap.exists) {
        const custData = custSnap.data() || {};
        transaction.update(custRef, {
          totalVisits: (custData.totalVisits || 0) + 1,
          totalSpent: (custData.totalSpent || 0) + spentIncrement
        });
      }

      // e. Ghi nhận doanh thu staff_income
      if (apptData.staffId && snapshotRate !== undefined) {
        const commission = webhookCommissionAmount ?? calculateStaffCommission(apptData.totalPrice, snapshotRate, orderHasDiscount(sessionData));
        transaction.set(db.collection('staff_income').doc(appointmentId), {
          staffId: apptData.staffId,
          staffName: staffName || 'Staff',
          appointmentId,
          date: apptData.date,
          totalPrice: apptData.totalPrice || 0,
          commissionRate: snapshotRate,
          commission,
          createdAt: new Date().toISOString()
        });
      }
    });

    if (isAlreadyProcessed) {
      return res.status(200).json({ success: true, message: "Transaction already processed or ignored." });
    }

    console.log(`[SePay Webhook] Đã xử lý thanh toán tự động và lưu log thành công cho lịch hẹn ${appointmentIdToSettle}.`);
    return res.status(200).json({ success: true, message: `Payment confirmed and appointment ${appointmentIdToSettle} settled.` });

  } catch (error: any) {
    console.error("[SePay Webhook Error] Lỗi nghiêm trọng khi xử lý webhook:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
};

app.post('/webhook/sepay', handleSePayWebhook);
app.post('/api/sepay/webhook', handleSePayWebhook);

// API endpoint để lấy danh sách các tệp sao lưu trong thư mục backups
app.get("/api/backups/list", (req, res) => {
  try {
    const backupsDir = backupsRoot;
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const files = fs.readdirSync(backupsDir)
      .filter(file => file.endsWith(".json"));
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: "Không thể lấy danh sách tệp sao lưu: " + error.message });
  }
});

// API endpoint để nạp và ghi đè toàn bộ dữ liệu từ một file backup được chỉ định trong thư mục backups
app.post("/api/import-server-backup", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "Cơ sở dữ liệu chưa được kết nối trên Server." });
  }

  const { fileName } = req.body;
  if (!fileName) {
    return res.status(400).json({ error: "Vui lòng chọn một tệp sao lưu để đồng bộ." });
  }

  // Bảo mật chống Directory Traversal
  const safeFileName = path.basename(fileName);
  if (!safeFileName.endsWith(".json")) {
    return res.status(400).json({ error: "Định dạng tệp không hợp lệ, phải là tệp .json." });
  }

  const backupFilePath = path.join(backupsRoot, safeFileName);
  if (!fs.existsSync(backupFilePath)) {
    return res.status(404).json({ error: `Không tìm thấy file sao lưu ${safeFileName} trong thư mục backups.` });
  }

  try {
    const backupContent = fs.readFileSync(backupFilePath, "utf8");
    const backupData = JSON.parse(backupContent);

    const collectionsToImport = [
      { backupKey: "customers", dbName: "customers", required: true },
      { backupKey: "staff", dbName: "staff", required: true },
      { backupKey: "appointments", dbName: "appointments", required: true },
      { backupKey: "services", dbName: "services", required: true },
      { backupKey: "staffBonuses", dbName: "staff_bonuses", required: true },
      { backupKey: "timeLogs", dbName: "time_logs", required: true },
      { backupKey: "paymentSessions", dbName: "payment_sessions", required: false },
      { backupKey: "paymentTransactions", dbName: "payment_transactions", required: false },
      { backupKey: "staffIncome", dbName: "staff_income", required: false }
    ];

    const results: any = {};

    function sanitizeData(obj: any): any {
      if (obj === null || obj === undefined) return null;
      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeData(item));
      }
      if (typeof obj === "object") {
        const sanitized: any = {};
        for (const key of Object.keys(obj)) {
          if (obj[key] !== undefined) {
            sanitized[key] = sanitizeData(obj[key]);
          }
        }
        return sanitized;
      }
      return obj;
    }

    for (const mapping of collectionsToImport) {
      const { backupKey, dbName, required } = mapping;
      let items = backupData[backupKey];

      if (!items || !Array.isArray(items)) {
        if (required) {
          continue;
        } else {
          items = [];
        }
      }

      console.log(`[Import Backup] Đang xử lý ${dbName} (${items.length} phần tử)...`);

      // Xóa tất cả các document cũ trong collection
      const colRef = db.collection(dbName);
      const snapshot = await colRef.get();
      
      let batch = db.batch();
      let deleteCount = 0;
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
        deleteCount++;
        if (deleteCount % 400 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      if (deleteCount % 400 !== 0) {
        await batch.commit();
      }
      console.log(`[Import Backup] Đã xóa ${deleteCount} tài liệu cũ của ${dbName}.`);

      // Ghi mới
      batch = db.batch();
      let writeCount = 0;
      for (const item of items) {
        if (!item.id) continue;
        const docRef = colRef.doc(item.id);
        const cleanItem = sanitizeData(item);
        batch.set(docRef, cleanItem);
        writeCount++;
        if (writeCount % 400 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      if (writeCount % 400 !== 0) {
        await batch.commit();
      }
      console.log(`[Import Backup] Đã thêm thành công ${writeCount} tài liệu cho ${dbName}.`);
      results[dbName] = { deleted: deleteCount, imported: writeCount };
    }

    // Xóa bộ nhớ cache trên RAM của server sau khi import xong
    serverCache.clear();

    // Trigger sync signal để báo cho tất cả client
    try {
      await db.collection("system").doc("sync_status").set({
        collection: "all",
        changedAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn("Failed to set system sync signal:", e);
    }

    return res.json({
      success: true,
      message: "Ghi đè dữ liệu từ file sao lưu lên Cloud Firestore thành công!",
      details: results
    });

  } catch (err: any) {
    console.error("Lỗi khi import file sao lưu:", err);
    return res.status(500).json({ error: "Lỗi hệ thống: " + err.message });
  }
});



// Configure Vite or Static delivery based on environment
export async function startServer() {
  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode with Vite HMR...");
    const vite = await createViteServer({
      root: webRoot,
      configFile: webViteConfigPath,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in production mode...");
    app.use(express.static(webDistRoot));
    app.get("*", (req, res) => {
      res.sendFile(path.join(webDistRoot, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express custom server listening on http://0.0.0.0:${PORT}`);
  });
}
