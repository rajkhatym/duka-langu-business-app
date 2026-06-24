import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';
import type { PaymentMethod, PaymentStatus } from '@/types/database';

const OFFLINE_SALES_KEY = 'godown.pending-sales.v1';

export type SaleInsertRow = {
  client_sale_id?: string | null;
  branch_id?: string | null;
  product_id: string;
  quantity: number;
  unit_price: number;
  amount_paid: number;
  customer_name: string | null;
  payment_status: PaymentStatus;
  payment_method?: PaymentMethod | null;
  note: string | null;
  created_by: string | null;
};

type PendingSaleBatch = {
  id: string;
  created_at: string;
  attempts?: number;
  last_error?: string | null;
  next_retry_at?: string | null;
  rows: SaleInsertRow[];
};

type InsertSaleRowsResult = {
  data: { inserted: number; skipped: number; sale_ids?: string[] } | null;
  error: { message: string } | null;
};

export function isOfflineInsertError(message?: string | null) {
  const lower = (message ?? '').toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('internet') ||
    lower.includes('offline')
  );
}

async function readPendingBatches() {
  const raw = await AsyncStorage.getItem(OFFLINE_SALES_KEY);
  if (!raw) return [] as PendingSaleBatch[];

  try {
    const parsed = JSON.parse(raw) as PendingSaleBatch[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((batch) => ({
      ...batch,
      rows: ensureClientSaleIds(batch.rows, batch.id),
    }));
  } catch {
    return [];
  }
}

async function writePendingBatches(batches: PendingSaleBatch[]) {
  await AsyncStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(batches));
}

export async function queuePendingSaleBatch(rows: SaleInsertRow[]) {
  const batches = await readPendingBatches();
  const batchId = createSaleBatchId();
  batches.push({
    id: batchId,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    next_retry_at: null,
    rows: ensureClientSaleIds(rows, batchId),
  });
  await writePendingBatches(batches);
  return batches.reduce((sum, batch) => sum + batch.rows.length, 0);
}

export async function getPendingSalesCount() {
  const batches = await readPendingBatches();
  return batches.reduce((sum, batch) => sum + batch.rows.length, 0);
}

export function createSaleBatchId() {
  return `sale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createClientSaleId(batchId: string, index: number) {
  return `${batchId}-line-${index + 1}`;
}

export function ensureClientSaleIds(rows: SaleInsertRow[], batchId = createSaleBatchId()) {
  return rows.map((row, index) => ({
    ...row,
    client_sale_id: row.client_sale_id ?? createClientSaleId(batchId, index),
  }));
}

function retryDelayMs(attempts: number) {
  return Math.min(300000, 5000 * 2 ** Math.min(attempts, 6));
}

async function insertRowsIdempotently(rows: SaleInsertRow[]): Promise<InsertSaleRowsResult> {
  const rpcResult = await supabase.rpc('record_sale_batch', { p_rows: rows });
  if (!rpcResult.error) {
    return { data: rpcResult.data as InsertSaleRowsResult['data'], error: null };
  }

  const rpcMessage = rpcResult.error.message.toLowerCase();
  const isMissingRpc =
    rpcMessage.includes('function public.record_sale_batch') ||
    rpcMessage.includes('could not find the function') ||
    rpcMessage.includes('schema cache');

  if (isMissingRpc) {
    return {
      data: null,
      error: {
        message:
          'Run SQL ya transaction-safe sales kwanza: record_sale_batch inahitajika ili stock ipungue kwa uhakika.',
      },
    };
  }

  return { data: null, error: rpcResult.error };
}

export async function insertSaleRowsOnline(rows: SaleInsertRow[]) {
  return insertRowsIdempotently(ensureClientSaleIds(rows));
}

export async function syncPendingSales(options: { force?: boolean } = {}) {
  const batches = await readPendingBatches();
  if (batches.length === 0) return { synced: 0, remaining: 0, error: null as string | null };

  const remaining: PendingSaleBatch[] = [];
  let synced = 0;
  let firstError: string | null = null;

  for (const batch of batches) {
    if (firstError) {
      remaining.push(batch);
      continue;
    }

    const nextRetryAt = batch.next_retry_at ? new Date(batch.next_retry_at).getTime() : 0;
    if (!options.force && nextRetryAt > Date.now()) {
      remaining.push(batch);
      continue;
    }

    const { error } = await insertRowsIdempotently(batch.rows);
    if (error) {
      firstError = error.message;
      const attempts = (batch.attempts ?? 0) + 1;
      remaining.push({
        ...batch,
        attempts,
        last_error: error.message,
        next_retry_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
      });
      continue;
    }

    synced += batch.rows.length;
  }

  await writePendingBatches(remaining);
  return {
    synced,
    remaining: remaining.reduce((sum, batch) => sum + batch.rows.length, 0),
    error: firstError,
  };
}
