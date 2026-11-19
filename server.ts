import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const FIREBASE_CONFIG_PATH = path.resolve(__dirname, 'firebase-applet-config.json');

interface FirebaseAppletConfig {
  apiKey?: string;
  projectId?: string;
}

function readFirebaseConfig(): FirebaseAppletConfig {
  try {
    const raw = fs.readFileSync(FIREBASE_CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as FirebaseAppletConfig;
  } catch {
    return {};
  }
}

function getMidtransSettings() {
  const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
  const isProduction = String(process.env.MIDTRANS_IS_PRODUCTION || '').toLowerCase() === 'true';
  const baseUrl = isProduction
    ? 'https://api.midtrans.com'
    : 'https://api.sandbox.midtrans.com';
  return {
    configured: serverKey.length > 0,
    serverKey,
    isProduction,
    baseUrl,
  };
}

function buildMidtransAuthHeader(serverKey: string): string {
  return `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

async function verifyFirebaseBearerToken(req: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  const { apiKey } = readFirebaseConfig();
  if (!apiKey) return null;

  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!resp.ok) return null;

  const data = (await resp.json()) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
  };
  const user = data.users?.[0];
  if (!user?.localId || !user?.email || user.emailVerified !== true) {
    return null;
  }

  return {
    uid: user.localId,
    email: user.email.toLowerCase(),
    emailVerified: true,
  };
}

interface WebhookRecord {
  orderId: string;
  transactionId: string;
  transactionStatus: string;
  fraudStatus?: string;
  paymentType?: string;
  settlementTime?: string;
  receivedAt: string;
}

const verifiedWebhookCache = new Map<string, WebhookRecord>();

interface MidtransChargeResponse {
  status_code?: string;
  status_message?: string;
  transaction_id?: string;
  order_id?: string;
  payment_type?: string;
  transaction_status?: string;
  expiry_time?: string;
  va_numbers?: Array<{ bank?: string; va_number?: string }>;
  permata_va_number?: string;
  biller_code?: string;
  bill_key?: string;
  qr_string?: string;
  actions?: Array<{ name?: string; url?: string }>;
}

interface MidtransStatusResponse {
  status_code?: string;
  status_message?: string;
  transaction_id?: string;
  order_id?: string;
  transaction_status?: string;
  fraud_status?: string;
  payment_type?: string;
  settlement_time?: string;
  gross_amount?: string;
}

function interpretMidtransStatus(status?: string, fraudStatus?: string) {
  const normalized = (status || '').toLowerCase();
  const fraud = (fraudStatus || '').toLowerCase();
  const isSettled =
    normalized === 'settlement' || (normalized === 'capture' && fraud !== 'deny');
  const isCancelledOrExpired =
    normalized === 'cancel' ||
    normalized === 'expire' ||
    normalized === 'deny' ||
    normalized === 'failure';
  return {
    normalizedStatus: normalized || 'pending',
    isSettled,
    isCancelledOrExpired,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((_req: Request, res: Response, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    const midtrans = getMidtransSettings();
    res.json({
      ok: true,
      midtransConfigured: midtrans.configured,
      isProduction: midtrans.isProduction,
    });
  });

  app.get('/api/payments/config', (req: Request, res: Response) => {
    const midtrans = getMidtransSettings();
    const envAppUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    const protoHeader = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const hostHeader = req.get('host') || `localhost:${PORT}`;
    const resolvedAppUrl = envAppUrl || `${protoHeader}://${hostHeader}`;
    res.json({
      midtransConfigured: midtrans.configured,
      isProduction: midtrans.isProduction,
      webhookPath: '/api/midtrans/webhook',
      webhookUrl: `${resolvedAppUrl}/api/midtrans/webhook`,
      supportedBanks: ['bca', 'mandiri', 'bri', 'bni', 'permata'],
    });
  });

  app.post('/api/payments/midtrans/charge', async (req: Request, res: Response) => {
    try {
      const verifiedUser = await verifyFirebaseBearerToken(req);
      if (!verifiedUser) {
        res.status(401).json({
          code: 'UNAUTHORIZED',
          message: 'Sesi Google Anda tidak valid atau belum terverifikasi. Silakan login ulang.',
        });
        return;
      }

      const midtrans = getMidtransSettings();
      if (!midtrans.configured) {
        res.status(503).json({
          code: 'GATEWAY_NOT_CONFIGURED',
          message:
            'Payment Gateway Midtrans (MIDTRANS_SERVER_KEY) belum diatur di panel Secrets server. Hubungi pemilik aplikasi untuk menghubungkan akun Midtrans agar nomor VA & QRIS resmi terbit.',
        });
        return;
      }

      const body = req.body as {
        orderId?: string;
        schoolId?: string;
        schoolCode?: string;
        schoolName?: string;
        studentNis?: string;
        studentName?: string;
        parentName?: string;
        parentEmail?: string;
        method?: 'va' | 'qris';
        bankCode?: string;
        totalAmount?: number;
        items?: Array<{ id?: string; name?: string; price?: number; quantity?: number }>;
      };

      const orderId = String(body.orderId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
      const grossAmount = Math.round(Number(body.totalAmount || 0));
      const method = body.method;
      const bankCode = String(body.bankCode || 'bca').toLowerCase();

      if (!orderId || !Number.isFinite(grossAmount) || grossAmount <= 0 || (method !== 'va' && method !== 'qris')) {
        res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'Parameter orderId, method (va/qris), atau totalAmount tidak valid.',
        });
        return;
      }

      const safeItems = Array.isArray(body.items) && body.items.length > 0
        ? body.items.slice(0, 20).map((it, idx) => ({
            id: String(it.id || `item_${idx + 1}`).slice(0, 50),
            price: Math.round(Number(it.price || 0)),
            quantity: Math.max(1, Math.round(Number(it.quantity || 1))),
            name: String(it.name || 'Tagihan Sekolah').slice(0, 50),
          }))
        : [
            {
              id: orderId.slice(0, 50),
              price: grossAmount,
              quantity: 1,
              name: `Tagihan ${String(body.schoolName || 'Sekolah').slice(0, 35)}`.slice(0, 50),
            },
          ];

      const midtransPayload: Record<string, unknown> = {
        transaction_details: {
          order_id: orderId,
          gross_amount: grossAmount,
        },
        item_details: safeItems,
        customer_details: {
          first_name: String(body.studentName || 'Siswa').slice(0, 50),
          last_name: body.studentNis ? `NIS ${String(body.studentNis).slice(0, 20)}` : undefined,
          email: String(body.parentEmail || verifiedUser.email).slice(0, 120),
        },
        custom_field1: String(body.schoolId || '').slice(0, 60),
        custom_field2: String(body.schoolCode || '').slice(0, 30),
        custom_field3: String(body.studentNis || '').slice(0, 30),
      };

      if (method === 'va') {
        if (bankCode === 'mandiri') {
          midtransPayload.payment_type = 'echannel';
          midtransPayload.echannel = {
            bill_info1: 'Pembayaran Sekolah',
            bill_info2: String(body.schoolName || 'EduKasir').slice(0, 30),
          };
        } else if (bankCode === 'permata') {
          midtransPayload.payment_type = 'permata';
        } else if (bankCode === 'bca' || bankCode === 'bni' || bankCode === 'bri') {
          midtransPayload.payment_type = 'bank_transfer';
          midtransPayload.bank_transfer = { bank: bankCode };
        } else {
          res.status(400).json({
            code: 'UNSUPPORTED_BANK',
            message: `Bank Virtual Account "${bankCode}" tidak didukung oleh Midtrans Core API.`,
          });
          return;
        }
      } else {
        midtransPayload.payment_type = 'qris';
        midtransPayload.qris = { acquirer: 'gopay' };
      }

      const mtResp = await fetch(`${midtrans.baseUrl}/v2/charge`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: buildMidtransAuthHeader(midtrans.serverKey),
        },
        body: JSON.stringify(midtransPayload),
      });

      const mtData = (await mtResp.json()) as MidtransChargeResponse;
      if (!mtResp.ok || !['200', '201'].includes(String(mtData.status_code || ''))) {
        res.status(mtResp.status >= 400 ? mtResp.status : 502).json({
          code: 'MIDTRANS_CHARGE_ERROR',
          statusCode: mtData.status_code,
          message:
            mtData.status_message ||
            'Midtrans menolak permintaan pembuatan Virtual Account / QRIS. Periksa kunci Server Key & aktivasi kanal di dashboard Midtrans.',
        });
        return;
      }

      let vaNumber = '';
      let vaBillerCode = '';
      let qrisPayload = '';

      if (method === 'va') {
        if (bankCode === 'mandiri') {
          vaBillerCode = (mtData.biller_code || '').slice(0, 30);
          vaNumber = (mtData.bill_key || '').slice(0, 40);
        } else if (bankCode === 'permata') {
          vaNumber = (mtData.permata_va_number || mtData.va_numbers?.[0]?.va_number || '').slice(0, 40);
        } else {
          vaNumber = (mtData.va_numbers?.[0]?.va_number || '').slice(0, 40);
        }
      } else {
        qrisPayload = (mtData.qr_string || '').slice(0, 1000);
      }

      if ((method === 'va' && !vaNumber) || (method === 'qris' && !qrisPayload)) {
        res.status(502).json({
          code: 'MIDTRANS_EMPTY_CREDENTIAL',
          message: 'Midtrans tidak mengembalikan nomor Virtual Account atau payload QRIS yang valid.',
        });
        return;
      }

      res.json({
        provider: 'midtrans',
        isProduction: midtrans.isProduction,
        gatewayOrderId: (mtData.order_id || orderId).slice(0, 80),
        gatewayTransactionId: (mtData.transaction_id || '').slice(0, 100),
        transactionStatus: (mtData.transaction_status || 'pending').toLowerCase(),
        vaNumber,
        vaBillerCode,
        qrisPayload,
        expiresAt: (mtData.expiry_time || '').slice(0, 40),
      });
    } catch (err) {
      console.error('[Midtrans Charge Error]', err);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Gagal menghubungi server Midtrans.',
      });
    }
  });

  app.get('/api/payments/midtrans/status/:orderId', async (req: Request, res: Response) => {
    try {
      const verifiedUser = await verifyFirebaseBearerToken(req);
      if (!verifiedUser) {
        res.status(401).json({
          code: 'UNAUTHORIZED',
          message: 'Sesi Google tidak valid.',
        });
        return;
      }

      const orderId = String(req.params.orderId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!orderId) {
        res.status(400).json({ code: 'INVALID_ORDER_ID', message: 'Order ID tidak valid.' });
        return;
      }

      const midtrans = getMidtransSettings();
      if (!midtrans.configured) {
        res.status(503).json({
          code: 'GATEWAY_NOT_CONFIGURED',
          message: 'MIDTRANS_SERVER_KEY belum dikonfigurasi di server.',
        });
        return;
      }

      const mtResp = await fetch(`${midtrans.baseUrl}/v2/${encodeURIComponent(orderId)}/status`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: buildMidtransAuthHeader(midtrans.serverKey),
        },
      });
      const mtData = (await mtResp.json()) as MidtransStatusResponse;

      if (!mtResp.ok) {
        const cached = verifiedWebhookCache.get(orderId);
        if (cached) {
          const parsedCached = interpretMidtransStatus(cached.transactionStatus, cached.fraudStatus);
          res.json({
            orderId,
            gatewayTransactionId: cached.transactionId,
            transactionStatus: parsedCached.normalizedStatus,
            isSettled: parsedCached.isSettled,
            isCancelledOrExpired: parsedCached.isCancelledOrExpired,
            settlementTime: cached.settlementTime || '',
            source: 'webhook_cache',
          });
          return;
        }
        res.status(mtResp.status >= 400 ? mtResp.status : 502).json({
          code: 'MIDTRANS_STATUS_ERROR',
          message: mtData.status_message || 'Gagal memeriksa status transaksi di Midtrans.',
        });
        return;
      }

      const parsed = interpretMidtransStatus(mtData.transaction_status, mtData.fraud_status);
      res.json({
        orderId: mtData.order_id || orderId,
        gatewayTransactionId: (mtData.transaction_id || '').slice(0, 100),
        transactionStatus: parsed.normalizedStatus,
        isSettled: parsed.isSettled,
        isCancelledOrExpired: parsed.isCancelledOrExpired,
        settlementTime: mtData.settlement_time || '',
        grossAmount: mtData.gross_amount || '',
        source: 'midtrans_api',
      });
    } catch (err) {
      console.error('[Midtrans Status Error]', err);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Gagal cek status pembayaran.',
      });
    }
  });

  app.post('/api/payments/midtrans/cancel/:orderId', async (req: Request, res: Response) => {
    try {
      const verifiedUser = await verifyFirebaseBearerToken(req);
      if (!verifiedUser) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Sesi Google tidak valid.' });
        return;
      }

      const orderId = String(req.params.orderId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const midtrans = getMidtransSettings();
      if (!orderId || !midtrans.configured) {
        res.json({ ok: true, skipped: true });
        return;
      }

      const mtResp = await fetch(`${midtrans.baseUrl}/v2/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: buildMidtransAuthHeader(midtrans.serverKey),
        },
      });
      const mtData = (await mtResp.json().catch(() => ({}))) as { status_message?: string };
      res.json({ ok: mtResp.ok, message: mtData.status_message || '' });
    } catch (err) {
      console.error('[Midtrans Cancel Error]', err);
      res.json({ ok: false });
    }
  });

  app.post('/api/midtrans/webhook', (req: Request, res: Response) => {
    const midtrans = getMidtransSettings();
    if (!midtrans.configured) {
      res.status(503).json({ message: 'Midtrans server key is not configured.' });
      return;
    }

    const body = req.body as {
      order_id?: string;
      status_code?: string;
      gross_amount?: string;
      signature_key?: string;
      transaction_id?: string;
      transaction_status?: string;
      fraud_status?: string;
      payment_type?: string;
      settlement_time?: string;
    };

    const orderId = String(body.order_id || '');
    const statusCode = String(body.status_code || '');
    const grossAmount = String(body.gross_amount || '');
    const incomingSig = String(body.signature_key || '').toLowerCase();

    const expectedSig = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${midtrans.serverKey}`)
      .digest('hex')
      .toLowerCase();

    if (!orderId || !incomingSig || incomingSig !== expectedSig) {
      res.status(403).json({ message: 'Invalid Midtrans signature_key.' });
      return;
    }

    verifiedWebhookCache.set(orderId, {
      orderId,
      transactionId: String(body.transaction_id || ''),
      transactionStatus: String(body.transaction_status || 'pending').toLowerCase(),
      fraudStatus: body.fraud_status,
      paymentType: body.payment_type,
      settlementTime: body.settlement_time,
      receivedAt: new Date().toISOString(),
    });

    res.status(200).json({ received: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EduKasir server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
