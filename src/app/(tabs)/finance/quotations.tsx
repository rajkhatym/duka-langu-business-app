import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import {
  defaultCompanySettings,
  getCompanySettings,
  saveCompanySettings,
  splitLines,
  type CompanySettings,
} from '@/lib/company-settings';
import { formatDateTime, formatMoney } from '@/lib/format';
import { recordLocalReportSales } from '@/lib/local-report-sales';
import { buildProfessionalShareMessage } from '@/lib/share-templates';
import { supabase } from '@/lib/supabase';
import type { PaymentStatus, Product, Quotation } from '@/types/database';

type QuoteLine = {
  product: Product;
  quantity: number;
  unitPrice: number;
};

type QuoteItem = {
  id: string;
  quotation_id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
};

type DocumentType = 'quotation' | 'proforma' | 'invoice';
type DocumentFilter = 'all' | DocumentType;
type PaymentFilter = 'all' | 'Unpaid' | 'Partial' | 'Paid';
type DueFilter = 'all' | 'overdue' | 'due_soon' | 'no_due';
type StatusFilter = 'all' | Quotation['status'];
type DateFilter = 'all' | 'today' | 'week' | 'month';
type SortMode = 'newest' | 'due_date' | 'highest_balance';
type DueStatus = {
  key: 'paid' | 'no_due' | 'overdue' | 'today' | 'soon' | 'future';
  label: string;
  days: number | null;
};
type PaymentHistoryItem = {
  id: string;
  amount: number;
  createdAt: string;
  note?: string;
};
type ReminderHistoryItem = {
  id: string;
  createdAt: string;
  channel: 'whatsapp' | 'share';
};
type InvoiceStockCheck = {
  item: QuoteItem;
  product?: Product;
  status: 'ok' | 'low' | 'unknown';
  available: number | null;
  remaining: number | null;
};
const VAT_RATE = 0.18;
const VAT_OFF_MARKER = '[VAT:OFF]';
const CUSTOMER_ADDRESS_PREFIX = '[CUSTOMER_ADDRESS:';
const AMOUNT_PAID_PREFIX = '[AMOUNT_PAID:';
const PAYMENT_HISTORY_PREFIX = '[PAYMENT_HISTORY:';
const REMINDER_HISTORY_PREFIX = '[REMINDER_HISTORY:';
const SALE_CONVERTED_PREFIX = '[SALE_CONVERTED:';

function getDocumentType(quote: Quotation): DocumentType {
  if (quote.quote_number?.startsWith('P-')) return 'proforma';
  if (quote.quote_number?.startsWith('I-')) return 'invoice';
  return 'quotation';
}

function getDocumentLabel(type: DocumentType) {
  if (type === 'proforma') return 'Proforma Invoice';
  if (type === 'invoice') return 'Invoice';
  return 'Quotation';
}

function getDocumentPrefix(type: DocumentType) {
  if (type === 'proforma') return 'P';
  if (type === 'invoice') return 'I';
  return 'Q';
}

function getNextDocumentType(type: DocumentType): DocumentType | null {
  if (type === 'quotation') return 'proforma';
  if (type === 'proforma') return 'invoice';
  return null;
}

function isVatEnabledForQuote(quote: Quotation) {
  return !(quote.note ?? '').includes(VAT_OFF_MARKER);
}

function cleanQuoteNote(note?: string | null) {
  return (note ?? '')
    .replace(VAT_OFF_MARKER, '')
    .replace(/\[CUSTOMER_ADDRESS:[^\]]*\]/g, '')
    .replace(/\[AMOUNT_PAID:[^\]]*\]/g, '')
    .replace(/\[PAYMENT_HISTORY:[^\]]*\]/g, '')
    .replace(/\[REMINDER_HISTORY:[^\]]*\]/g, '')
    .replace(/\[SALE_CONVERTED:[^\]]*\]/g, '')
    .trim();
}

function buildFreshDocumentNote(note?: string | null) {
  const vatMarker = (note ?? '').includes(VAT_OFF_MARKER) ? VAT_OFF_MARKER : '';
  const addressMarker = encodeCustomerAddress(getCustomerAddress(note));
  const visibleNote = cleanQuoteNote(note);
  return `${vatMarker}\n${addressMarker}\n${visibleNote}`.trim() || null;
}

function encodeCustomerAddress(address: string) {
  const cleanAddress = address.trim();
  if (!cleanAddress) return '';
  return `${CUSTOMER_ADDRESS_PREFIX}${encodeURIComponent(cleanAddress)}]`;
}

function getCustomerAddress(note?: string | null) {
  const match = (note ?? '').match(/\[CUSTOMER_ADDRESS:([^\]]*)\]/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function normalizeWhatsAppPhone(contact?: string | null) {
  const digits = (contact ?? '').replace(/\D/g, '');
  if (digits.length < 9) return '';
  if (digits.startsWith('0')) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function sameCustomer(a: Quotation, b: Quotation) {
  const nameMatches = a.customer_name.trim().toLowerCase() === b.customer_name.trim().toLowerCase();
  const aContact = (a.customer_contact ?? '').replace(/\D/g, '');
  const bContact = (b.customer_contact ?? '').replace(/\D/g, '');
  if (aContact && bContact) return aContact === bContact;
  return nameMatches;
}

function encodeAmountPaid(amount: string) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return `${AMOUNT_PAID_PREFIX}${numeric}]`;
}

function encodePaymentHistory(history: PaymentHistoryItem[]) {
  if (history.length === 0) return '';
  return `${PAYMENT_HISTORY_PREFIX}${encodeURIComponent(JSON.stringify(history))}]`;
}

function getPaymentHistory(note?: string | null): PaymentHistoryItem[] {
  const match = (note ?? '').match(/\[PAYMENT_HISTORY:([^\]]*)\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as PaymentHistoryItem[];
    return parsed.filter((item) => Number.isFinite(Number(item.amount)) && Number(item.amount) > 0);
  } catch {
    return [];
  }
}

function encodeReminderHistory(history: ReminderHistoryItem[]) {
  if (history.length === 0) return '';
  return `${REMINDER_HISTORY_PREFIX}${encodeURIComponent(JSON.stringify(history))}]`;
}

function getReminderHistory(note?: string | null): ReminderHistoryItem[] {
  const match = (note ?? '').match(/\[REMINDER_HISTORY:([^\]]*)\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as ReminderHistoryItem[];
    return parsed.filter((item) => Boolean(item.createdAt));
  } catch {
    return [];
  }
}

function replaceReminderMarker(note: string | null | undefined, history: ReminderHistoryItem[]) {
  const cleanNote = (note ?? '').replace(/\[REMINDER_HISTORY:[^\]]*\]/g, '').trim();
  const marker = encodeReminderHistory(history);
  return `${marker}\n${cleanNote}`.trim() || null;
}

function isInvoicePostedToSales(note?: string | null) {
  return (note ?? '').includes(SALE_CONVERTED_PREFIX);
}

function getInvoicePostedAt(note?: string | null) {
  const match = (note ?? '').match(/\[SALE_CONVERTED:([^\]]*)\]/);
  return match?.[1] ?? null;
}

function addSaleConvertedMarker(note: string | null | undefined) {
  const cleanNote = (note ?? '').replace(/\[SALE_CONVERTED:[^\]]*\]/g, '').trim();
  return `${SALE_CONVERTED_PREFIX}${new Date().toISOString()}]\n${cleanNote}`.trim();
}

function replacePaymentMarkers(note: string | null | undefined, amount: number, history: PaymentHistoryItem[]) {
  const cleanNote = (note ?? '')
    .replace(/\[AMOUNT_PAID:[^\]]*\]/g, '')
    .replace(/\[PAYMENT_HISTORY:[^\]]*\]/g, '')
    .trim();
  const marker = amount > 0 ? `${AMOUNT_PAID_PREFIX}${amount}]` : '';
  const historyMarker = encodePaymentHistory(history);
  return `${marker}\n${historyMarker}\n${cleanNote}`.trim() || null;
}

function getAmountPaid(note?: string | null) {
  const match = (note ?? '').match(/\[AMOUNT_PAID:([^\]]*)\]/);
  const amount = Number(match?.[1] ?? 0);
  if (Number.isFinite(amount) && amount > 0) return amount;
  return getPaymentHistory(note).reduce((sum, item) => sum + Number(item.amount), 0);
}

function getPaymentSummary(quote: Quotation) {
  const vat = isVatEnabledForQuote(quote) ? quote.total_amount * VAT_RATE : 0;
  const total = quote.total_amount + vat;
  const paid = Math.min(getAmountPaid(quote.note), total);
  const balance = Math.max(total - paid, 0);
  const status = balance <= 0 && total > 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
  return { total, paid, balance, status };
}

function salePaymentStatus(total: number, paid: number): PaymentStatus {
  if (paid <= 0) return 'credit';
  if (paid >= total) return 'paid';
  return 'partial';
}

function getInvoiceStockChecks(items: QuoteItem[], products: Product[]): InvoiceStockCheck[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return items
    .filter((item) => item.product_id)
    .map((item) => {
      const product = productsById.get(item.product_id as string);
      if (!product) {
        return { item, product, status: 'unknown', available: null, remaining: null };
      }
      const remaining = product.quantity - item.quantity;
      return {
        item,
        product,
        status: remaining >= 0 ? 'ok' : 'low',
        available: product.quantity,
        remaining,
      };
    });
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeCsv(value: string | number | null | undefined) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function buildQuotationCsv(rows: Quotation[]) {
  const header = [
    'document_type',
    'number',
    'customer',
    'contact',
    'status',
    'payment_status',
    'subtotal',
    'total_with_vat',
    'amount_paid',
    'balance',
    'due_date',
    'due_status',
    'created_at',
  ];
  const body = rows.map((quote) => {
    const payment = getPaymentSummary(quote);
    const due = getDueStatus(quote);
    const documentType = getDocumentLabel(getDocumentType(quote));
    return [
      documentType,
      quote.quote_number ?? quote.id.slice(0, 8),
      quote.customer_name,
      quote.customer_contact ?? '',
      quote.status,
      payment.status,
      quote.total_amount,
      payment.total,
      payment.paid,
      payment.balance,
      quote.valid_until ?? '',
      due.label,
      quote.created_at,
    ].map(escapeCsv).join(',');
  });
  return [header.map(escapeCsv).join(','), ...body].join('\n');
}

function formatDocumentDate(value: string) {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getDueStatus(quote: Quotation): DueStatus {
  if (getPaymentSummary(quote).status === 'Paid') {
    return { key: 'paid', label: 'Paid', days: null };
  }
  if (!quote.valid_until) {
    return { key: 'no_due', label: 'No due date', days: null };
  }

  const dueDate = new Date(`${quote.valid_until}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) {
    return { key: 'no_due', label: 'No due date', days: null };
  }

  const days = Math.ceil((dueDate.getTime() - startOfToday().getTime()) / 86400000);
  if (days < 0) return { key: 'overdue', label: `${Math.abs(days)}d overdue`, days };
  if (days === 0) return { key: 'today', label: 'Due today', days };
  if (days <= 7) return { key: 'soon', label: `Due in ${days}d`, days };
  return { key: 'future', label: `Due in ${days}d`, days };
}

function matchesDateFilter(quote: Quotation, filter: DateFilter) {
  if (filter === 'all') return true;
  const createdAt = new Date(quote.created_at);
  const today = startOfToday();
  if (filter === 'today') return createdAt >= today;

  const from = new Date(today);
  from.setDate(today.getDate() - (filter === 'week' ? 7 : 30));
  return createdAt >= from;
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = 6000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    }),
  ]);
}

function buildPrintableDocumentHtml({
  quote,
  items,
  company,
}: {
  quote: Quotation;
  items: QuoteItem[];
  company: CompanySettings;
}) {
  const documentLabel = getDocumentLabel(getDocumentType(quote));
  const subtotal = quote.total_amount;
  const vat = isVatEnabledForQuote(quote) ? subtotal * VAT_RATE : 0;
  const { total, paid: amountPaid, balance: balanceDue, status: paymentStatus } = getPaymentSummary(quote);
  const paymentHistory = getPaymentHistory(quote.note);
  const note = cleanQuoteNote(quote.note);
  const customerAddress = getCustomerAddress(quote.note);
  const phones = splitLines(company.phonesText);
  const bankLines = splitLines(company.bankText);
  const rows = items
    .map(
      (item) => `
        <tr>
          <td class="item">${escapeHtml(item.description)}</td>
          <td class="qty">${escapeHtml(formatMoney(item.quantity))}</td>
          <td class="money">TSh${escapeHtml(formatMoney(item.unit_price))}</td>
          <td class="money">TSh${escapeHtml(formatMoney(item.quantity * item.unit_price))}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(documentLabel)} ${escapeHtml(quote.quote_number ?? '')}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f5f3; color: #22272b; font-family: Arial, Helvetica, sans-serif; }
    .page { width: 960px; min-height: 1240px; margin: 24px auto; background: #fff; padding: 60px 58px 70px; }
    .header { display: flex; justify-content: space-between; gap: 40px; margin-bottom: 46px; }
    .brand-left { font-size: 28px; font-weight: 500; }
    .brand-right { text-align: right; line-height: 1.45; }
    .doc-title { font-size: 30px; font-weight: 500; margin-bottom: 10px; }
    .company-name { font-size: 20px; font-weight: 800; }
    .small { font-size: 14px; }
    .info-band { display: flex; justify-content: space-between; gap: 40px; background: #f0f3f4; padding: 26px 38px; margin-bottom: 22px; }
    .to-label { font-size: 18px; font-weight: 800; margin-bottom: 8px; }
    .customer { font-size: 20px; margin-bottom: 8px; }
    .meta { width: 320px; }
    .meta-row { display: flex; justify-content: space-between; gap: 18px; margin: 6px 0; }
    .meta-label { font-size: 16px; font-weight: 800; }
    .meta-value { font-size: 14px; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th { font-size: 16px; text-align: left; padding: 12px 10px; border-top: 1px solid #d7dde1; border-bottom: 1px solid #d7dde1; }
    td { font-size: 16px; padding: 14px 10px; border-bottom: 1px solid #d7dde1; vertical-align: top; }
    .item { font-weight: 800; width: 52%; }
    .qty { text-align: center; width: 14%; }
    .money { text-align: right; width: 17%; }
    .totals { width: 46%; margin-left: auto; margin-top: 72px; border-bottom: 1px solid #d7dde1; padding-bottom: 8px; }
    .total-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; font-size: 16px; }
    .amount-due { width: 330px; margin-left: auto; margin-top: 38px; background: #f0f3f4; padding: 16px 18px; }
    .amount-label { color: #4f575e; font-size: 18px; margin-bottom: 12px; }
    .amount-value { font-size: 30px; text-align: right; color: #000; }
    .amount-status { margin-top: 8px; text-align: right; color: #2f8069; font-weight: 800; }
    .note { margin-top: 26px; font-size: 14px; }
    .payment { margin-top: 74px; }
    .history { width: 46%; margin-left: auto; margin-top: 20px; font-size: 13px; }
    .history-title { font-weight: 800; margin-bottom: 8px; }
    .history-row { display: flex; justify-content: space-between; gap: 16px; margin: 5px 0; color: #4f575e; }
    .payment-title { font-size: 24px; font-weight: 500; margin-bottom: 18px; }
    .payment-line { font-size: 14px; line-height: 1.45; }
    .print-actions { position: fixed; right: 24px; top: 18px; display: flex; gap: 10px; }
    .print-actions button { border: 0; border-radius: 8px; padding: 11px 16px; font-weight: 800; cursor: pointer; }
    .primary { background: #2f8069; color: white; }
    .secondary { background: #e8f5ef; color: #226d58; }
    @media print {
      body { background: #fff; }
      .page { margin: 0; width: 100%; min-height: auto; box-shadow: none; }
      .print-actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="print-actions">
    <button class="secondary" onclick="window.close()">Close</button>
    <button class="primary" onclick="window.print()">Print / Save PDF</button>
  </div>
  <main class="page">
    <section class="header">
      <div class="brand-left">${escapeHtml(company.name)}</div>
      <div class="brand-right">
        <div class="doc-title">${escapeHtml(documentLabel)}</div>
        <div class="company-name">${escapeHtml(company.name)}</div>
        <div class="small">${escapeHtml(company.tagline)}</div>
        <div class="small">${escapeHtml(company.location)}</div>
        ${phones.map((phone) => `<div class="small">${escapeHtml(phone)}</div>`).join('')}
        <div class="small">${escapeHtml(company.email)}</div>
        <div class="small">${escapeHtml(company.tax)}</div>
      </div>
    </section>
    <section class="info-band">
      <div>
        <div class="to-label">TO</div>
        <div class="customer">${escapeHtml(quote.customer_name)}</div>
        ${quote.customer_contact ? `<div class="small">${escapeHtml(quote.customer_contact)}</div>` : ''}
        ${customerAddress ? customerAddress.split('\n').map((line) => `<div class="small">${escapeHtml(line)}</div>`).join('') : ''}
      </div>
      <div class="meta">
        <div class="meta-row"><span class="meta-label">${escapeHtml(documentLabel)} #</span><span class="meta-value">${escapeHtml(quote.quote_number ?? quote.id.slice(0, 8))}</span></div>
        <div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">${escapeHtml(formatDocumentDate(quote.created_at))}</span></div>
        <div class="meta-row"><span class="meta-label">Due date</span><span class="meta-value">${escapeHtml(quote.valid_until ?? '-')}</span></div>
      </div>
    </section>
    <table>
      <thead><tr><th>Item</th><th class="qty">Quantity</th><th class="money">Price</th><th class="money">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="totals">
      <div class="total-row"><span>Subtotal</span><span>TSh${escapeHtml(formatMoney(subtotal))}</span></div>
      <div class="total-row"><span>VAT TAX (18%)</span><span>TSh${escapeHtml(formatMoney(vat))}</span></div>
      <div class="total-row"><span>Total</span><span>TSh${escapeHtml(formatMoney(total))}</span></div>
      <div class="total-row"><span>Amount paid</span><span>TSh${escapeHtml(formatMoney(amountPaid))}</span></div>
    </section>
    <section class="amount-due">
      <div class="amount-label">Amount due</div>
      <div class="amount-value">TSh${escapeHtml(formatMoney(balanceDue))}</div>
      <div class="amount-status">${escapeHtml(paymentStatus)}</div>
    </section>
    ${
      paymentHistory.length > 0
        ? `<section class="history">
            <div class="history-title">Payment history</div>
            ${paymentHistory
              .map(
                (payment) => `
                  <div class="history-row">
                    <span>${escapeHtml(formatDocumentDate(payment.createdAt))}${payment.note ? ` - ${escapeHtml(payment.note)}` : ''}</span>
                    <span>TSh${escapeHtml(formatMoney(payment.amount))}</span>
                  </div>`
              )
              .join('')}
          </section>`
        : ''
    }
    ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}
    <section class="payment">
      <div class="payment-title">Payment instruction</div>
      ${bankLines.map((line) => `<div class="payment-line">${escapeHtml(line)}</div>`).join('')}
    </section>
  </main>
</body>
</html>`;
}

export default function QuotationsScreen() {
  const {
    productId: prefillProductId,
    documentType: prefillDocumentType,
    qty: prefillQuantity,
    price: prefillPrice,
  } = useLocalSearchParams<{
    productId?: string;
    documentType?: string;
    qty?: string;
    price?: string;
  }>();
  const { isOwner, session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('quotation');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [validUntil, setValidUntil] = useState('');
  const [includeVat, setIncludeVat] = useState(true);
  const [amountPaid, setAmountPaid] = useState('');
  const [note, setNote] = useState('');
  const [selectedQuote, setSelectedQuote] = useState<Quotation | null>(null);
  const [selectedItems, setSelectedItems] = useState<QuoteItem[]>([]);
  const [quoteSearch, setQuoteSearch] = useState('');
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [dueFilter, setDueFilter] = useState<DueFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentNoteInput, setPaymentNoteInput] = useState('');
  const [companySettings, setCompanySettings] = useState<CompanySettings>(defaultCompanySettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prefillAppliedRef = useRef('');

  useEffect(() => {
    getCompanySettings().then(setCompanySettings);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await withTimeout(
          supabase.from('products').select('*').eq('branch_id', selectedBranchId).order('name')
        );
        setProducts((data as Product[]) ?? []);
      } catch {
        setProducts([]);
      }
    })();
  }, [selectedBranchId]);

  useEffect(() => {
    if (product?.unit_price) setUnitPrice(String(product.unit_price));
  }, [product]);

  useEffect(() => {
    if (!prefillProductId || products.length === 0) return;
    const prefillKey = `${prefillProductId}-${prefillDocumentType ?? ''}-${prefillQuantity ?? ''}-${prefillPrice ?? ''}`;
    if (prefillAppliedRef.current === prefillKey) return;
    const matchedProduct = products.find((nextProduct) => nextProduct.id === prefillProductId);
    if (!matchedProduct) return;
    const nextQuantity = prefillQuantity && Number(prefillQuantity) > 0 ? Number(prefillQuantity) : 1;
    const nextPrice = prefillPrice && Number(prefillPrice) > 0 ? Number(prefillPrice) : Number(matchedProduct.unit_price ?? 0);
    setProduct(matchedProduct);
    setQuantity(String(nextQuantity));
    setUnitPrice(nextPrice > 0 ? String(nextPrice) : '');
    if (
      prefillDocumentType === 'quotation' ||
      prefillDocumentType === 'proforma' ||
      prefillDocumentType === 'invoice'
    ) {
      setDocumentType(prefillDocumentType);
    }
    if (nextPrice > 0) {
      setLines((current) => {
        const alreadyAdded = current.some((line) => line.product.id === matchedProduct.id);
        if (alreadyAdded) return current;
        return [...current, { product: matchedProduct, quantity: nextQuantity, unitPrice: nextPrice }];
      });
      setFormNotice(`${matchedProduct.name} imeongezwa kwenye document lines.`);
      setError(null);
    }
    prefillAppliedRef.current = prefillKey;
  }, [prefillDocumentType, prefillPrice, prefillProductId, prefillQuantity, products]);

  const load = useCallback(async () => {
    try {
      const { data } = await withTimeout(
        supabase
          .from('quotations')
          .select('*')
          .eq('branch_id', selectedBranchId)
          .order('created_at', { ascending: false })
          .limit(25)
      );
      setQuotes((data as Quotation[]) ?? []);
    } catch {
      setQuotes([]);
    }
  }, [selectedBranchId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const draftLineTotal = (Number(quantity) || 0) * (Number(unitPrice) || 0);
  const selectedProductCost = Number(product?.cost_price ?? 0);
  const selectedProductRegularPrice = Number(product?.unit_price ?? 0);
  const selectedProductPriceMargin =
    selectedProductCost > 0 && Number(unitPrice) > 0
      ? ((Number(unitPrice) - selectedProductCost) / Number(unitPrice)) * 100
      : 0;
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const draftVat = includeVat ? total * VAT_RATE : 0;
  const draftGrandTotal = total + draftVat;
  const draftAmountPaid = Math.min(Math.max(Number(amountPaid) || 0, 0), draftGrandTotal);
  const draftBalance = Math.max(draftGrandTotal - draftAmountPaid, 0);
  const draftPaymentStatus =
    draftGrandTotal > 0 && draftBalance <= 0 ? 'Paid' : draftAmountPaid > 0 ? 'Partial' : 'Unpaid';
  const draftCostTotal = lines.reduce(
    (sum, line) => sum + line.quantity * Number(line.product.cost_price ?? 0),
    0
  );
  const draftGrossProfit = total - draftCostTotal;
  const draftProfitMargin = total > 0 ? (draftGrossProfit / total) * 100 : 0;
  const hasMissingDraftCost = lines.some((line) => !Number(line.product.cost_price));
  const draftPriceChecks = lines.map((line) => {
    const costPrice = Number(line.product.cost_price ?? 0);
    const regularPrice = Number(line.product.unit_price ?? 0);
    const isBelowCost = costPrice > 0 && line.unitPrice < costPrice;
    const isBelowRegular = !isBelowCost && regularPrice > 0 && line.unitPrice < regularPrice;
    return {
      productId: line.product.id,
      costPrice,
      regularPrice,
      status: isBelowCost ? 'below_cost' : isBelowRegular ? 'discount' : 'ok',
      label: isBelowCost
        ? `Below cost: cost Tsh ${formatMoney(costPrice)}`
        : isBelowRegular
          ? `Discount: regular Tsh ${formatMoney(regularPrice)}`
          : 'Price check: OK',
    };
  });
  const hasDraftPriceWarning = draftPriceChecks.some((check) => check.status === 'below_cost');
  const draftStockChecks = lines.map((line) => {
    const available = line.product.quantity;
    const remaining = available - line.quantity;
    return {
      productId: line.product.id,
      available,
      remaining,
      isEnough: remaining >= 0,
    };
  });
  const hasDraftStockWarning = draftStockChecks.some((check) => !check.isEnough);
  const draftReadinessItems = [
    { label: 'Customer name', done: Boolean(customerName.trim()) },
    { label: 'Line items', done: lines.length > 0 && total > 0 },
    { label: 'Stock checked', done: lines.length > 0 && !hasDraftStockWarning },
    { label: 'Due date', done: Boolean(validUntil.trim()) },
    { label: 'Payment status', done: draftGrandTotal > 0 },
  ];
  const draftReadinessDone = draftReadinessItems.filter((item) => item.done).length;
  const draftReadinessScore = Math.round((draftReadinessDone / draftReadinessItems.length) * 100);
  const draftReadinessTone =
    draftReadinessScore >= 80 ? 'Tayari kutumwa' : draftReadinessScore >= 50 ? 'Karibu kukamilika' : 'Bado inahitaji taarifa';
  const formDocumentLabel = getDocumentLabel(documentType);
  const saveMissingItems = [
    !customerName.trim() ? 'customer name' : null,
    lines.length === 0 || total <= 0 ? 'angalau bidhaa moja' : null,
  ].filter((item): item is string => Boolean(item));
  const canSaveDocument = saveMissingItems.length === 0;
  const saveReadinessMessage = canSaveDocument
    ? `${formDocumentLabel} iko tayari kuhifadhiwa.`
    : `Kabla ya kuhifadhi, jaza ${saveMissingItems.join(' na ')}.`;
  const recentCustomerOptions = useMemo(() => {
    const seen = new Set<string>();
    return quotes
      .filter((quote) => quote.customer_name.trim())
      .map((quote) => ({
        name: quote.customer_name.trim(),
        contact: quote.customer_contact ?? '',
        address: getCustomerAddress(quote.note),
        createdAt: quote.created_at,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((customer) => {
        const key = `${customer.name.toLowerCase()}-${customer.contact.replace(/\D/g, '')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [quotes]);
  const draftCustomerOpenDocs = useMemo(() => {
    const name = customerName.trim().toLowerCase();
    const contact = customerContact.replace(/\D/g, '');
    if (!name && !contact) return [] as Quotation[];

    return quotes
      .filter((quote) => {
        const quoteName = quote.customer_name.trim().toLowerCase();
        const quoteContact = (quote.customer_contact ?? '').replace(/\D/g, '');
        const nameMatches = Boolean(name) && quoteName === name;
        const contactMatches = Boolean(contact && quoteContact) && quoteContact === contact;
        return (nameMatches || contactMatches) && getPaymentSummary(quote).balance > 0;
      })
      .sort((a, b) => getPaymentSummary(b).balance - getPaymentSummary(a).balance)
      .slice(0, 3);
  }, [customerContact, customerName, quotes]);
  const draftCustomerBalance = draftCustomerOpenDocs.reduce(
    (sum, quote) => sum + getPaymentSummary(quote).balance,
    0
  );
  const filteredQuotes = useMemo(() => {
    const search = quoteSearch.trim().toLowerCase();
    const filtered = quotes.filter((quote) => {
      const quoteType = getDocumentType(quote);
      const payment = getPaymentSummary(quote);
      const due = getDueStatus(quote);
      const matchesType = documentFilter === 'all' || quoteType === documentFilter;
      const matchesPayment = paymentFilter === 'all' || payment.status === paymentFilter;
      const matchesStatus = statusFilter === 'all' || quote.status === statusFilter;
      const matchesDate = matchesDateFilter(quote, dateFilter);
      const matchesDue =
        dueFilter === 'all' ||
        (dueFilter === 'overdue' && due.key === 'overdue') ||
        (dueFilter === 'due_soon' && (due.key === 'today' || due.key === 'soon')) ||
        (dueFilter === 'no_due' && due.key === 'no_due');
      const matchesSearch =
        !search ||
        quote.customer_name.toLowerCase().includes(search) ||
        (quote.customer_contact ?? '').toLowerCase().includes(search) ||
        (quote.quote_number ?? '').toLowerCase().includes(search);
      return matchesType && matchesPayment && matchesStatus && matchesDate && matchesDue && matchesSearch;
    });

    return filtered.sort((a, b) => {
      if (sortMode === 'highest_balance') return getPaymentSummary(b).balance - getPaymentSummary(a).balance;
      if (sortMode === 'due_date') {
        const aTime = a.valid_until ? new Date(`${a.valid_until}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.valid_until ? new Date(`${b.valid_until}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [dateFilter, documentFilter, dueFilter, paymentFilter, quoteSearch, quotes, sortMode, statusFilter]);
  const quoteSummary = useMemo(() => {
    return quotes.reduce(
      (summary, quote) => {
        const payment = getPaymentSummary(quote);
        const due = getDueStatus(quote);
        summary.outstanding += payment.balance;
        if (due.key === 'overdue') summary.overdue += 1;
        if (due.key === 'today' || due.key === 'soon') summary.dueSoon += 1;
        if (getDocumentType(quote) === 'invoice') summary.invoices += 1;
        return summary;
      },
      { outstanding: 0, overdue: 0, dueSoon: 0, invoices: 0 }
    );
  }, [quotes]);
  const documentPipeline = useMemo(
    () =>
      (['draft', 'sent', 'accepted', 'converted'] as const).map((status) => {
        const rows = quotes.filter((quote) => quote.status === status);
        return {
          status,
          label:
            status === 'draft'
              ? 'Draft'
              : status === 'sent'
                ? 'Sent'
                : status === 'accepted'
                  ? 'Accepted'
                  : 'Converted',
          count: rows.length,
          value: rows.reduce((sum, quote) => sum + quote.total_amount, 0),
        };
      }),
    [quotes]
  );
  const selectedCustomerDocs = useMemo(() => {
    if (!selectedQuote) return [] as Quotation[];
    return quotes
      .filter((quote) => sameCustomer(quote, selectedQuote))
      .filter((quote) => getPaymentSummary(quote).balance > 0)
      .sort((a, b) => getPaymentSummary(b).balance - getPaymentSummary(a).balance);
  }, [quotes, selectedQuote]);
  const selectedCustomerStatementText = useMemo(() => {
    if (!selectedQuote || selectedCustomerDocs.length === 0) return '';
    const totalBalance = selectedCustomerDocs.reduce((sum, quote) => sum + getPaymentSummary(quote).balance, 0);
    return [
      companySettings.name,
      `Customer statement: ${selectedQuote.customer_name}`,
      selectedQuote.customer_contact ? `Contact: ${selectedQuote.customer_contact}` : null,
      '',
      ...selectedCustomerDocs.map((quote, index) => {
        const payment = getPaymentSummary(quote);
        return `${index + 1}. ${getDocumentLabel(getDocumentType(quote))} ${
          quote.quote_number ?? quote.id.slice(0, 8)
        } - Balance TSh${formatMoney(payment.balance)}${quote.valid_until ? ` - Due ${quote.valid_until}` : ''}`;
      }),
      '',
      `Total balance: TSh${formatMoney(totalBalance)}`,
    ]
      .filter((line) => line !== null)
      .join('\n');
  }, [companySettings.name, selectedCustomerDocs, selectedQuote]);
  const selectedQuoteText = useMemo(() => {
    if (!selectedQuote) return '';
    const selectedDocumentType = getDocumentType(selectedQuote);
    const selectedDocumentLabel = getDocumentLabel(selectedDocumentType);
    const subtotal = selectedQuote.total_amount;
    const vat = isVatEnabledForQuote(selectedQuote) ? subtotal * VAT_RATE : 0;
    const { total: totalWithVat, paid, balance: amountDue, status: paymentStatus } = getPaymentSummary(selectedQuote);
    const selectedCustomerAddress = getCustomerAddress(selectedQuote.note);
    const selectedPaymentHistory = getPaymentHistory(selectedQuote.note);
    const historyText =
      selectedPaymentHistory.length > 0
        ? [
            'Payment history:',
            ...selectedPaymentHistory.map(
              (payment) =>
                `- ${formatDocumentDate(payment.createdAt)}: ${companySettings.currency} ${formatMoney(payment.amount)}${
                  payment.note ? ` (${payment.note})` : ''
                }`
            ),
          ].join('\n')
        : null;
    const visibleNote = [selectedCustomerAddress ? `Address: ${selectedCustomerAddress}` : null, cleanQuoteNote(selectedQuote.note), historyText]
      .filter(Boolean)
      .join('\n');

    return buildProfessionalShareMessage({
      company: companySettings,
      branchName: selectedBranch?.name ?? selectedQuote.branch_id ?? selectedBranchId,
      documentTitle: selectedDocumentLabel,
      documentNumber: selectedQuote.quote_number ?? selectedQuote.id.slice(0, 8).toUpperCase(),
      createdAt: selectedQuote.created_at,
      customerName: selectedQuote.customer_name,
      customerContact: selectedQuote.customer_contact,
      items: selectedItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineTotal: item.quantity * item.unit_price,
      })),
      totals: [
        { label: 'Subtotal', value: subtotal },
        { label: 'VAT TAX (18%)', value: vat },
        { label: 'Total', value: totalWithVat, emphasize: true },
        { label: 'Amount paid', value: paid },
        { label: 'Balance', value: amountDue, emphasize: true },
      ],
      paymentStatus,
      note: visibleNote || null,
      paymentInstruction: splitLines(companySettings.bankText).join('\n'),
      footer: 'Asante kwa biashara yako.',
    });
  }, [companySettings, selectedBranch?.name, selectedBranchId, selectedItems, selectedQuote]);
  const selectedReminderText = useMemo(() => {
    if (!selectedQuote) return '';
    const documentType = getDocumentType(selectedQuote);
    const documentLabel = getDocumentLabel(documentType);
    const payment = getPaymentSummary(selectedQuote);
    if (payment.balance <= 0) return '';

    const due = getDueStatus(selectedQuote);
    return [
      `Habari ${selectedQuote.customer_name},`,
      `Tunakukumbusha kuhusu ${documentLabel} ${selectedQuote.quote_number ?? selectedQuote.id.slice(0, 8)} ya ${
        companySettings.name
      }.`,
      `Kiasi kilichobaki: TSh${formatMoney(payment.balance)}.`,
      selectedQuote.valid_until ? `Due date: ${selectedQuote.valid_until} (${due.label}).` : null,
      `Tafadhali fanya malipo au wasiliana nasi kama tayari umelipa.`,
      `Asante.`,
    ]
      .filter((line) => line !== null)
      .join('\n');
  }, [companySettings.name, selectedQuote]);

  const onSaveCompanySettings = async () => {
    await saveCompanySettings(companySettings);
    Alert.alert('Company settings', 'Taarifa za kampuni zimehifadhiwa.');
    setSettingsOpen(false);
  };

  const setDueInDays = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setValidUntil(date.toISOString().slice(0, 10));
  };

  const openQuote = async (quote: Quotation) => {
    const { data, error: itemsError } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', quote.id)
      .order('id');

    if (itemsError) {
      Alert.alert('Hitilafu', itemsError.message);
      return;
    }

    setSelectedQuote(quote);
    setPaymentAmountInput('');
    setPaymentNoteInput('');
    setSelectedItems((data as QuoteItem[]) ?? []);
  };

  const copyQuote = async () => {
    if (!selectedQuoteText) return;
    const label = selectedQuote ? getDocumentLabel(getDocumentType(selectedQuote)) : 'Quotation';
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(selectedQuoteText);
      Alert.alert(label, `${label} ime-copy. Unaweza ku-paste WhatsApp/Email.`);
      return;
    }
    await Share.share({ message: selectedQuoteText });
  };

  const shareQuoteWhatsApp = async () => {
    if (!selectedQuoteText) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const phone = normalizeWhatsAppPhone(selectedQuote?.customer_contact);
      const target = phone ? `https://wa.me/${phone}?text=` : 'https://wa.me/?text=';
      window.open(`${target}${encodeURIComponent(selectedQuoteText)}`, '_blank');
      return;
    }
    await Share.share({ message: selectedQuoteText });
  };

  const sharePaymentReminder = async () => {
    if (!selectedQuote) return;
    if (!selectedReminderText) {
      Alert.alert('Reminder', 'Document hii haina balance ya kukumbushia.');
      return;
    }
    const channel: ReminderHistoryItem['channel'] = Platform.OS === 'web' ? 'whatsapp' : 'share';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const phone = normalizeWhatsAppPhone(selectedQuote.customer_contact);
      const target = phone ? `https://wa.me/${phone}?text=` : 'https://wa.me/?text=';
      window.open(`${target}${encodeURIComponent(selectedReminderText)}`, '_blank');
    } else {
      await Share.share({ message: selectedReminderText });
    }

    const nextHistory = [
      { id: `${Date.now()}`, createdAt: new Date().toISOString(), channel },
      ...getReminderHistory(selectedQuote.note),
    ];
    const nextNote = replaceReminderMarker(selectedQuote.note, nextHistory);
    const { error: updateError } = await supabase.from('quotations').update({ note: nextNote }).eq('id', selectedQuote.id);
    if (updateError) {
      Alert.alert('Reminder', updateError.message);
      return;
    }
    const nextQuote = { ...selectedQuote, note: nextNote };
    setSelectedQuote(nextQuote);
    setQuotes((current) => current.map((quote) => (quote.id === selectedQuote.id ? nextQuote : quote)));
  };

  const copyPaymentReminder = async () => {
    if (!selectedReminderText) {
      Alert.alert('Reminder', 'Document hii haina balance ya kukumbushia.');
      return;
    }
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(selectedReminderText);
      Alert.alert('Reminder', 'Reminder ime-copy. Unaweza ku-paste WhatsApp/SMS.');
      return;
    }
    await Share.share({ message: selectedReminderText });
  };

  const copyCustomerStatement = async () => {
    if (!selectedCustomerStatementText) {
      Alert.alert('Customer Statement', 'Hakuna outstanding documents kwa customer huyu.');
      return;
    }
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(selectedCustomerStatementText);
      Alert.alert('Customer Statement', 'Statement ime-copy.');
      return;
    }
    await Share.share({ message: selectedCustomerStatementText });
  };

  const filterSelectedCustomer = () => {
    if (!selectedQuote) return;
    setQuoteSearch(selectedQuote.customer_contact || selectedQuote.customer_name);
    setPaymentFilter('all');
    setDueFilter('all');
    setStatusFilter('all');
    setDateFilter('all');
  };

  const resetQuoteFilters = () => {
    setQuoteSearch('');
    setDocumentFilter('all');
    setDateFilter('all');
    setStatusFilter('all');
    setPaymentFilter('all');
    setDueFilter('all');
    setSortMode('newest');
  };

  const exportFilteredQuotesCsv = async () => {
    if (filteredQuotes.length === 0) {
      Alert.alert('Export CSV', 'Hakuna documents za ku-export kwa filter hizi.');
      return;
    }

    const csv = buildQuotationCsv(filteredQuotes);
    const filename = `documents-${new Date().toISOString().slice(0, 10)}.csv`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = filename;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    await Share.share({ message: csv });
  };

  const printQuote = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (!selectedQuote) return;
      const html = buildPrintableDocumentHtml({
        quote: selectedQuote,
        items: selectedItems,
        company: companySettings,
      });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, '_blank', 'width=1000,height=900');
      if (!printWindow) {
        URL.revokeObjectURL(url);
        Alert.alert('Print', 'Browser imezuia popup. Ruhusu popups kisha jaribu tena.');
        return;
      }
      printWindow.focus();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }
    Alert.alert('Print', 'Print inapatikana kwenye web preview kwa sasa.');
  };

  const updateQuoteStatus = async (status: Quotation['status']) => {
    if (!selectedQuote) return;
    const { error: updateError } = await supabase
      .from('quotations')
      .update({ status })
      .eq('id', selectedQuote.id);
    if (updateError) {
      Alert.alert('Hitilafu', updateError.message);
      return;
    }
    setSelectedQuote({ ...selectedQuote, status });
    await load();
  };

  const duplicateSelectedQuote = async () => {
    if (!selectedQuote || selectedItems.length === 0) return;
    const sourceType = getDocumentType(selectedQuote);
    const { data: nextQuote, error: quoteError } = await supabase
      .from('quotations')
      .insert({
        branch_id: selectedQuote.branch_id ?? selectedBranchId,
        customer_name: selectedQuote.customer_name,
        customer_contact: selectedQuote.customer_contact,
        quote_number: `${getDocumentPrefix(sourceType)}-${Date.now()}`,
        total_amount: selectedQuote.total_amount,
        status: 'draft',
        valid_until: selectedQuote.valid_until,
        note: buildFreshDocumentNote(selectedQuote.note),
        created_by: session?.user.id,
      })
      .select('*')
      .single();

    if (quoteError) {
      Alert.alert('Duplicate', quoteError.message);
      return;
    }

    const itemRows = selectedItems.map((item) => ({
      quotation_id: nextQuote.id,
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));
    const { error: itemsError } = await supabase.from('quotation_items').insert(itemRows);
    if (itemsError) {
      Alert.alert('Duplicate', itemsError.message);
      return;
    }

    setSelectedQuote(nextQuote as Quotation);
    setSelectedItems(
      itemRows.map((item, index) => ({
        id: `${nextQuote.id}-${index}`,
        ...item,
      }))
    );
    setPaymentAmountInput('');
    setPaymentNoteInput('');
    await load();
    Alert.alert('Duplicate', `${getDocumentLabel(sourceType)} mpya imetengenezwa.`);
  };

  const updateSelectedPayment = async () => {
    if (!selectedQuote) return;
    const paymentAmount = Number(paymentAmountInput) || 0;
    if (paymentAmount <= 0) {
      Alert.alert('Payment', 'Weka kiasi cha payment kilicho zaidi ya 0.');
      return;
    }

    const currentHistory = getPaymentHistory(selectedQuote.note);
    const nextHistory = [
      {
        id: `${Date.now()}`,
        amount: paymentAmount,
        createdAt: new Date().toISOString(),
        note: paymentNoteInput.trim() || undefined,
      },
      ...currentHistory,
    ];
    const nextAmountPaid = getAmountPaid(selectedQuote.note) + paymentAmount;
    const nextNote = replacePaymentMarkers(selectedQuote.note, nextAmountPaid, nextHistory);
    const { error: updateError } = await supabase
      .from('quotations')
      .update({ note: nextNote })
      .eq('id', selectedQuote.id);

    if (updateError) {
      Alert.alert('Hitilafu', updateError.message);
      return;
    }

    const nextQuote = { ...selectedQuote, note: nextNote };
    setSelectedQuote(nextQuote);
    setQuotes((current) => current.map((quote) => (quote.id === selectedQuote.id ? nextQuote : quote)));
    setPaymentAmountInput('');
    setPaymentNoteInput('');
    Alert.alert('Payment', 'Payment imeongezwa kwenye history.');
  };

  const postInvoiceToSales = async () => {
    if (!selectedQuote) return;
    if (getDocumentType(selectedQuote) !== 'invoice') {
      Alert.alert('Sales', 'Badilisha document kuwa Invoice kwanza.');
      return;
    }
    if (isInvoicePostedToSales(selectedQuote.note)) {
      Alert.alert('Sales', 'Invoice hii tayari imeingizwa kwenye mauzo.');
      return;
    }

    const saleItems = selectedItems.filter((item) => item.product_id);
    if (saleItems.length === 0) {
      Alert.alert('Sales', 'Hakuna bidhaa zenye product id kwenye invoice hii.');
      return;
    }

    const stockChecks = getInvoiceStockChecks(saleItems, products);
    const lowStockItems = stockChecks.filter((check) => check.status === 'low');
    if (lowStockItems.length > 0) {
      Alert.alert(
        'Stock haitoshi',
        lowStockItems
          .map(
            (check) =>
              `${check.item.description}: invoice ${formatMoney(check.item.quantity)}, stock ${formatMoney(
                check.available ?? 0
              )}`
          )
          .join('\n')
      );
      return;
    }

    const { paid } = getPaymentSummary(selectedQuote);
    let remainingPaid = paid;
    const rows = saleItems.map((item) => {
      const lineTotal = item.quantity * item.unit_price;
      const linePaid = Math.min(remainingPaid, lineTotal);
      remainingPaid -= linePaid;
      return {
        branch_id: selectedQuote.branch_id ?? selectedBranchId,
        product_id: item.product_id as string,
        quantity: item.quantity,
        unit_price: item.unit_price,
        amount_paid: linePaid,
        customer_name: selectedQuote.customer_name,
        payment_status: salePaymentStatus(lineTotal, linePaid),
        note: `From ${getDocumentLabel(getDocumentType(selectedQuote))} ${
          selectedQuote.quote_number ?? selectedQuote.id.slice(0, 8)
        }`,
        created_by: session?.user.id ?? null,
      };
    });

    const { error: insertError } = await supabase.from('sales').insert(rows);
    if (insertError) {
      if (insertError.message.includes('branch_id')) {
        const fallbackRows = rows.map(({ branch_id: _branchId, ...row }) => row);
        const fallback = await supabase.from('sales').insert(fallbackRows);
        if (fallback.error) {
          Alert.alert('Hitilafu', fallback.error.message);
          return;
        }
      } else {
        Alert.alert('Hitilafu', insertError.message);
        return;
      }
    }

    const productsById = new Map(products.map((nextProduct) => [nextProduct.id, nextProduct]));
    let localRemainingPaid = paid;
    await recordLocalReportSales(
      saleItems.map((item) => {
        const product =
          productsById.get(item.product_id as string) ??
          ({
            id: item.product_id as string,
            branch_id: selectedQuote.branch_id ?? selectedBranchId,
            name: item.description,
            sku: null,
            unit: 'pcs',
            category: null,
            quantity: 0,
            reorder_level: 0,
            cost_price: null,
            unit_price: item.unit_price,
            created_by: null,
            created_at: new Date().toISOString(),
          } satisfies Product);
        const lineTotal = item.quantity * item.unit_price;
        const linePaid = Math.min(localRemainingPaid, lineTotal);
        localRemainingPaid -= linePaid;
        return {
          branch_id: selectedQuote.branch_id ?? selectedBranchId,
          product,
          quantity: item.quantity,
          unit_price: item.unit_price,
          amount_paid: linePaid,
          customer_name: selectedQuote.customer_name,
          payment_status: salePaymentStatus(lineTotal, linePaid),
          note: `From invoice ${selectedQuote.quote_number ?? selectedQuote.id.slice(0, 8)}`,
          created_by: session?.user.id ?? null,
        };
      })
    );

    const nextNote = addSaleConvertedMarker(selectedQuote.note);
    await supabase.from('quotations').update({ note: nextNote, status: 'converted' }).eq('id', selectedQuote.id);
    const nextQuote = { ...selectedQuote, note: nextNote, status: 'converted' as const };
    setSelectedQuote(nextQuote);
    setQuotes((current) => current.map((quote) => (quote.id === selectedQuote.id ? nextQuote : quote)));
    Alert.alert('Sales', 'Invoice imeingizwa kwenye mauzo na stock itapunguzwa.');
  };

  const convertSelectedQuote = async () => {
    if (!selectedQuote || selectedItems.length === 0) return;
    const currentType = getDocumentType(selectedQuote);
    const nextType = getNextDocumentType(currentType);
    if (!nextType) {
      Alert.alert('Convert', 'Document hii tayari ni Invoice.');
      return;
    }

    const { data: nextQuote, error: quoteError } = await supabase
      .from('quotations')
      .insert({
        branch_id: selectedQuote.branch_id ?? selectedBranchId,
        customer_name: selectedQuote.customer_name,
        customer_contact: selectedQuote.customer_contact,
        quote_number: `${getDocumentPrefix(nextType)}-${Date.now()}`,
        total_amount: selectedQuote.total_amount,
        status: 'draft',
        valid_until: selectedQuote.valid_until,
        note: selectedQuote.note,
        created_by: session?.user.id,
      })
      .select('*')
      .single();

    if (quoteError) {
      Alert.alert('Hitilafu', quoteError.message);
      return;
    }

    const itemRows = selectedItems.map((item) => ({
      quotation_id: nextQuote.id,
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));
    const { error: itemsError } = await supabase.from('quotation_items').insert(itemRows);
    if (itemsError) {
      Alert.alert('Hitilafu', itemsError.message);
      return;
    }

    const convertedStatus: Quotation['status'] = nextType === 'invoice' ? 'converted' : 'accepted';
    await supabase.from('quotations').update({ status: convertedStatus }).eq('id', selectedQuote.id);
    setSelectedQuote(nextQuote as Quotation);
    setSelectedItems(
      itemRows.map((item, index) => ({
        id: `${nextQuote.id}-${index}`,
        ...item,
      }))
    );
    await load();
    Alert.alert('Imefanikiwa', `${getDocumentLabel(currentType)} imebadilishwa kuwa ${getDocumentLabel(nextType)}.`);
  };

  const addLine = () => {
    const qty = Number(quantity) || 0;
    const price = Number(unitPrice) || 0;
    if (!product || qty <= 0 || price <= 0) {
      setError('Chagua bidhaa, quantity na bei kabla ya kuongeza line');
      return;
    }
    setLines((current) => [...current, { product, quantity: qty, unitPrice: price }]);
    setProduct(null);
    setQuantity('1');
    setUnitPrice('');
    setError(null);
    setFormNotice(`${product.name} imeongezwa kwenye document lines.`);
  };

  const removeLine = (indexToRemove: number) => {
    const removedLine = lines[indexToRemove];
    setLines((current) => current.filter((_line, index) => index !== indexToRemove));
    if (removedLine) setFormNotice(`${removedLine.product.name} imeondolewa kwenye document lines.`);
    setError(null);
  };

  const resetDraft = () => {
    setProduct(null);
    setCustomerName('');
    setCustomerContact('');
    setCustomerAddress('');
    setQuantity('1');
    setUnitPrice('');
    setLines([]);
    setValidUntil('');
    setIncludeVat(true);
    setAmountPaid('');
    setNote('');
    setError(null);
    setFormNotice('Draft imesafishwa. Unaweza kuanza document mpya.');
  };

  const selectRecentCustomer = (customer: { name: string; contact: string; address: string }) => {
    setCustomerName(customer.name);
    setCustomerContact(customer.contact);
    setCustomerAddress(customer.address);
    setError(null);
    setFormNotice(`${customer.name} amejazwa kwenye document.`);
  };

  const applyQuickLinePrice = (price: number, label: string) => {
    if (price <= 0) return;
    setUnitPrice(String(Math.round(price)));
    setFormNotice(`${label} imewekwa kwenye line price.`);
    setError(null);
  };

  const copyDraftSummary = async () => {
    if (lines.length === 0) {
      setError('Ongeza angalau bidhaa moja kabla ya kunakili summary.');
      return;
    }
    const customerLabel = customerName.trim() || 'Mteja';
    const message = [
      `${formDocumentLabel} draft - ${companySettings.name}`,
      `Customer: ${customerLabel}`,
      customerContact.trim() ? `Contact: ${customerContact.trim()}` : null,
      '',
      ...lines.map(
        (line, index) =>
          `${index + 1}. ${line.product.name} - ${formatMoney(line.quantity)} x Tsh ${formatMoney(line.unitPrice)} = Tsh ${formatMoney(
            line.quantity * line.unitPrice
          )}`
      ),
      '',
      `Subtotal: Tsh ${formatMoney(total)}`,
      `VAT: Tsh ${formatMoney(draftVat)}`,
      `Grand total: Tsh ${formatMoney(draftGrandTotal)}`,
      `Paid: Tsh ${formatMoney(draftAmountPaid)}`,
      `Balance: Tsh ${formatMoney(draftBalance)}`,
      validUntil.trim() ? `Valid until: ${validUntil.trim()}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message);
        setFormNotice('Draft summary imenakiliwa.');
        setError(null);
        return;
      } catch {
        setFormNotice(message);
        setError(null);
        return;
      }
    }

    try {
      await Share.share({ message });
      setFormNotice('Draft summary iko tayari kushare.');
      setError(null);
    } catch {
      setFormNotice(message);
      setError(null);
    }
  };

  const onSubmit = async () => {
    if (!customerName.trim() || lines.length === 0 || total <= 0) {
      setError('Jaza customer na ongeza angalau bidhaa moja');
      return;
    }
    setError(null);
    setLoading(true);

    const { data: quote, error: quoteError } = await supabase
      .from('quotations')
      .insert({
        branch_id: selectedBranchId,
        customer_name: customerName.trim(),
        customer_contact: customerContact.trim() || null,
        quote_number: `${getDocumentPrefix(documentType)}-${Date.now()}`,
        total_amount: total,
        valid_until: validUntil.trim() || null,
        note:
          `${includeVat ? '' : `${VAT_OFF_MARKER}\n`}${encodeCustomerAddress(customerAddress)}\n${encodeAmountPaid(
            amountPaid
          )}\n${encodePaymentHistory(
            Number(amountPaid) > 0
              ? [{ id: `${Date.now()}`, amount: Number(amountPaid), createdAt: new Date().toISOString(), note: 'Deposit' }]
              : []
          )}\n${note.trim()}`.trim() || null,
        created_by: session?.user.id,
      })
      .select('*')
      .single();

    if (quoteError) {
      setLoading(false);
      setError(quoteError.message.includes('quotations') ? 'Run SQL ya equipment sales modules kwanza.' : quoteError.message);
      return;
    }

    const itemRows = lines.map((line) => ({
        quotation_id: quote.id,
        product_id: line.product.id,
        description: line.product.name,
        quantity: line.quantity,
        unit_price: line.unitPrice,
      }));
    await supabase.from('quotation_items').insert(itemRows);

    setLoading(false);
    setSelectedQuote(quote as Quotation);
    setPaymentAmountInput('');
    setPaymentNoteInput('');
    setSelectedItems(
      itemRows.map((item, index) => ({
        id: `${quote.id}-${index}`,
        ...item,
      }))
    );
    setCustomerName('');
    setCustomerContact('');
    setCustomerAddress('');
    setDocumentType('quotation');
    setIncludeVat(true);
    setAmountPaid('');
    setProduct(null);
    setQuantity('1');
    setUnitPrice('');
    setLines([]);
    setValidUntil('');
    setNote('');
    await load();
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>
      <Pressable style={styles.settingsToggle} onPress={() => setSettingsOpen((current) => !current)}>
        <Text style={styles.settingsToggleText}>Company Settings</Text>
      </Pressable>
      {settingsOpen ? (
        <View style={styles.card}>
          <Text style={styles.title}>Company Settings</Text>
          <TextField
            label="Company name"
            value={companySettings.name}
            onChangeText={(name) => setCompanySettings((current) => ({ ...current, name }))}
          />
          <TextField
            label="Tagline / Area"
            value={companySettings.tagline}
            onChangeText={(tagline) => setCompanySettings((current) => ({ ...current, tagline }))}
          />
          <TextField
            label="Location"
            value={companySettings.location}
            onChangeText={(location) => setCompanySettings((current) => ({ ...current, location }))}
          />
          <TextField
            label="Phones (mstari mmoja kwa kila namba)"
            value={companySettings.phonesText}
            onChangeText={(phonesText) => setCompanySettings((current) => ({ ...current, phonesText }))}
            multiline
          />
          <TextField
            label="Email"
            value={companySettings.email}
            onChangeText={(email) => setCompanySettings((current) => ({ ...current, email }))}
          />
          <TextField
            label="Tax / TIN / VRN"
            value={companySettings.tax}
            onChangeText={(tax) => setCompanySettings((current) => ({ ...current, tax }))}
          />
          <TextField
            label="Bank details"
            value={companySettings.bankText}
            onChangeText={(bankText) => setCompanySettings((current) => ({ ...current, bankText }))}
            multiline
          />
          <Button label="Hifadhi Company Settings" onPress={onSaveCompanySettings} />
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.title}>Nukuu / Proforma / Invoice</Text>
        {formNotice ? <Text style={styles.formNotice}>{formNotice}</Text> : null}
        <View style={styles.segment}>
          <Pressable
            style={[styles.segmentButton, documentType === 'quotation' && styles.segmentButtonActive]}
            onPress={() => setDocumentType('quotation')}>
            <Text style={[styles.segmentText, documentType === 'quotation' && styles.segmentTextActive]}>Quotation</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, documentType === 'proforma' && styles.segmentButtonActive]}
            onPress={() => setDocumentType('proforma')}>
            <Text style={[styles.segmentText, documentType === 'proforma' && styles.segmentTextActive]}>Proforma Invoice</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, documentType === 'invoice' && styles.segmentButtonActive]}
            onPress={() => setDocumentType('invoice')}>
            <Text style={[styles.segmentText, documentType === 'invoice' && styles.segmentTextActive]}>Invoice</Text>
          </Pressable>
        </View>
        {recentCustomerOptions.length > 0 ? (
          <View style={styles.recentCustomersBox}>
            <Text style={styles.recentCustomersTitle}>Recent customers</Text>
            <View style={styles.recentCustomersRow}>
              {recentCustomerOptions.map((customer) => (
                <Pressable
                  key={`${customer.name}-${customer.contact}`}
                  accessibilityRole="button"
                  style={styles.recentCustomerChip}
                  onPress={() => selectRecentCustomer(customer)}>
                  <Text style={styles.recentCustomerName}>{customer.name}</Text>
                  {customer.contact ? <Text style={styles.recentCustomerContact}>{customer.contact}</Text> : null}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <TextField label="Jina la mteja *" value={customerName} onChangeText={setCustomerName} />
        <TextField label="Contact" value={customerContact} onChangeText={setCustomerContact} />
        <TextField
          label="Customer address / P.O Box"
          value={customerAddress}
          onChangeText={setCustomerAddress}
          multiline
        />
        {draftCustomerOpenDocs.length > 0 ? (
          <View style={styles.customerBalanceBox}>
            <View style={styles.customerBalanceTop}>
              <Text style={styles.customerBalanceTitle}>Customer balance alert</Text>
              <Text style={styles.customerBalanceAmount}>Tsh {formatMoney(draftCustomerBalance)}</Text>
            </View>
            <Text style={styles.customerBalanceText}>
              Mteja huyu ana {draftCustomerOpenDocs.length} document zenye balance kabla ya hii draft mpya.
            </Text>
            {draftCustomerOpenDocs.map((quote) => {
              const payment = getPaymentSummary(quote);
              return (
                <Text key={quote.id} style={styles.customerBalanceDoc}>
                  {quote.quote_number ?? quote.id.slice(0, 8)} · Tsh {formatMoney(payment.balance)}
                </Text>
              );
            })}
          </View>
        ) : null}
        <ProductPicker label="Bidhaa *" products={products} value={product} onChange={setProduct} />
        <View style={styles.row}>
          <TextField label="Qty" value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
          <TextField label="Price" value={unitPrice} onChangeText={setUnitPrice} keyboardType="numeric" />
        </View>
        {product ? (
          <View style={styles.quickPriceBox}>
            <View style={styles.quickPriceTop}>
              <Text style={styles.quickPriceTitle}>Quick price</Text>
              {isOwner ? (
                <Text
                  style={[
                    styles.quickPriceMargin,
                    selectedProductCost > 0 && Number(unitPrice) < selectedProductCost && styles.quickPriceMarginDanger,
                  ]}>
                  Margin {selectedProductPriceMargin.toFixed(1)}%
                </Text>
              ) : null}
            </View>
            <View style={styles.quickPriceRow}>
              {selectedProductRegularPrice > 0 ? (
                <Pressable
                  style={styles.quickPriceButton}
                  onPress={() => applyQuickLinePrice(selectedProductRegularPrice, 'Regular price')}>
                  <Text style={styles.quickPriceText}>Regular</Text>
                </Pressable>
              ) : null}
              {isOwner
                ? [20, 30, 40].map((markup) => (
                    <Pressable
                      key={`line-markup-${markup}`}
                      style={styles.quickPriceButton}
                      onPress={() => applyQuickLinePrice(selectedProductCost * (1 + markup / 100), `+${markup}% markup`)}
                      disabled={selectedProductCost <= 0}>
                      <Text style={styles.quickPriceText}>+{markup}%</Text>
                    </Pressable>
                  ))
                : null}
            </View>
            {isOwner ? (
              selectedProductCost > 0 ? (
                <Text style={styles.quickPriceHint}>Cost: Tsh {formatMoney(selectedProductCost)}</Text>
              ) : (
                <Text style={styles.quickPriceHint}>Cost price haijawekwa kwa bidhaa hii.</Text>
              )
            ) : null}
          </View>
        ) : null}
        <Text style={styles.linePreview}>Line total: Tsh {formatMoney(draftLineTotal)}</Text>
        <Button label={`Ongeza bidhaa kwenye ${formDocumentLabel}`} variant="secondary" onPress={addLine} />
        {lines.length > 0 ? (
          <View style={styles.linesBox}>
            {lines.map((line, index) => (
              <View
                key={`${line.product.id}-${index}`}
                style={[styles.lineRow, !draftStockChecks[index]?.isEnough && styles.lineRowWarning]}>
                <View style={styles.lineInfo}>
                  <Text style={styles.lineText}>{index + 1}. {line.product.name}</Text>
                  <Text style={styles.lineMeta}>
                    {line.quantity} x Tsh {formatMoney(line.unitPrice)}
                  </Text>
                  <Text
                    style={[
                      styles.lineStockStatus,
                      !draftStockChecks[index]?.isEnough && styles.lineStockStatusWarning,
                    ]}>
                    Stock: {formatMoney(draftStockChecks[index]?.available ?? 0)} available ·{' '}
                    {draftStockChecks[index]?.remaining >= 0 ? 'Remaining' : 'Short'}{' '}
                    {formatMoney(Math.abs(draftStockChecks[index]?.remaining ?? 0))}
                  </Text>
                  {isOwner ? (
                    <Text
                      style={[
                        styles.linePriceStatus,
                        draftPriceChecks[index]?.status === 'below_cost' && styles.linePriceStatusDanger,
                        draftPriceChecks[index]?.status === 'discount' && styles.linePriceStatusWarning,
                      ]}>
                      {draftPriceChecks[index]?.label}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.lineAmountBlock}>
                  <Text style={styles.lineAmount}>Tsh {formatMoney(line.quantity * line.unitPrice)}</Text>
                  <Pressable style={styles.removeLineButton} onPress={() => removeLine(index)}>
                    <Text style={styles.removeLineText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <TextField label="Ina-expire (YYYY-MM-DD)" value={validUntil} onChangeText={setValidUntil} />
        <View style={styles.quickDueRow}>
          <Pressable style={styles.quickDueButton} onPress={() => setDueInDays(3)}>
            <Text style={styles.quickDueText}>+3 days</Text>
          </Pressable>
          <Pressable style={styles.quickDueButton} onPress={() => setDueInDays(7)}>
            <Text style={styles.quickDueText}>+7 days</Text>
          </Pressable>
          <Pressable style={styles.quickDueButton} onPress={() => setDueInDays(14)}>
            <Text style={styles.quickDueText}>+14 days</Text>
          </Pressable>
        </View>
        <View style={styles.vatToggleRow}>
          <View>
            <Text style={styles.vatTitle}>VAT 18%</Text>
            <Text style={styles.vatSubtitle}>{includeVat ? 'Itaongezwa kwenye total ya document' : 'Document haitachaji VAT'}</Text>
          </View>
          <Pressable
            style={[styles.vatToggle, includeVat && styles.vatToggleActive]}
            onPress={() => setIncludeVat((current) => !current)}>
            <Text style={[styles.vatToggleText, includeVat && styles.vatToggleTextActive]}>
              {includeVat ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
        </View>
        <TextField
          label="Amount paid / Deposit"
          value={amountPaid}
          onChangeText={setAmountPaid}
          keyboardType="numeric"
        />
        <View style={styles.quickPaymentDraftRow}>
          <Pressable
            style={styles.quickPaymentDraftButton}
            onPress={() => setAmountPaid(String(Math.round(draftGrandTotal / 2)))}
            disabled={draftGrandTotal <= 0}>
            <Text style={styles.quickPaymentDraftText}>50%</Text>
          </Pressable>
          <Pressable
            style={styles.quickPaymentDraftButton}
            onPress={() => setAmountPaid(String(Math.round(draftGrandTotal)))}
            disabled={draftGrandTotal <= 0}>
            <Text style={styles.quickPaymentDraftText}>Full</Text>
          </Pressable>
          <Pressable style={styles.quickPaymentDraftButton} onPress={() => setAmountPaid('')}>
            <Text style={styles.quickPaymentDraftText}>Clear</Text>
          </Pressable>
        </View>
        <TextField label="Maelezo" value={note} onChangeText={setNote} multiline />
        {lines.length > 0 ? (
          <View style={[styles.stockDraftBox, hasDraftStockWarning && styles.stockDraftBoxWarning]}>
            <Text style={[styles.stockDraftTitle, hasDraftStockWarning && styles.stockDraftTitleWarning]}>
              {hasDraftStockWarning ? 'Stock warning' : 'Stock check'}
            </Text>
            <Text style={styles.stockDraftText}>
              {hasDraftStockWarning
                ? 'Kuna line yenye quantity kubwa kuliko stock iliyopo. Hakiki kabla ya ku-convert kuwa sale.'
                : 'Stock ya draft lines inaonekana kutosha kwa sasa.'}
            </Text>
          </View>
        ) : null}
        {isOwner && hasDraftPriceWarning ? (
          <View style={styles.priceDraftWarningBox}>
            <Text style={styles.priceDraftWarningTitle}>Price warning</Text>
            <Text style={styles.priceDraftWarningText}>
              Kuna line yenye bei chini ya cost price. Hakiki kabla ya kumtumia mteja document hii.
            </Text>
          </View>
        ) : null}
        {isOwner && lines.length > 0 ? (
          <View style={[styles.profitDraftBox, draftGrossProfit < 0 && styles.profitDraftBoxWarning]}>
            <View style={styles.profitDraftTop}>
              <View>
                <Text style={[styles.profitDraftTitle, draftGrossProfit < 0 && styles.profitDraftTitleWarning]}>
                  Draft profit preview
                </Text>
                <Text style={styles.profitDraftSubtitle}>
                  {hasMissingDraftCost ? 'Baadhi ya bidhaa hazina cost price.' : 'Based on product cost prices.'}
                </Text>
              </View>
              <Text style={[styles.profitDraftMargin, draftGrossProfit < 0 && styles.profitDraftMarginWarning]}>
                {draftProfitMargin.toFixed(1)}%
              </Text>
            </View>
            <View style={styles.profitDraftGrid}>
              <View style={styles.profitDraftCard}>
                <Text style={styles.profitDraftLabel}>Estimated cost</Text>
                <Text style={styles.profitDraftValue}>Tsh {formatMoney(draftCostTotal)}</Text>
              </View>
              <View style={styles.profitDraftCard}>
                <Text style={styles.profitDraftLabel}>Gross profit</Text>
                <Text style={[styles.profitDraftValue, draftGrossProfit < 0 && styles.profitDraftLoss]}>
                  Tsh {formatMoney(draftGrossProfit)}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
        <View style={styles.draftSummaryBox}>
          <View style={styles.draftSummaryTop}>
            <Text style={styles.draftSummaryTitle}>Payment summary</Text>
            <Text
              style={[
                styles.draftStatus,
                draftPaymentStatus === 'Paid'
                  ? styles.draftStatusPaid
                  : draftPaymentStatus === 'Partial'
                    ? styles.draftStatusPartial
                    : styles.draftStatusUnpaid,
              ]}>
              {draftPaymentStatus}
            </Text>
          </View>
          <View style={styles.draftSummaryRow}>
            <Text style={styles.draftSummaryLabel}>Subtotal</Text>
            <Text style={styles.draftSummaryValue}>Tsh {formatMoney(total)}</Text>
          </View>
          <View style={styles.draftSummaryRow}>
            <Text style={styles.draftSummaryLabel}>VAT 18%</Text>
            <Text style={styles.draftSummaryValue}>Tsh {formatMoney(draftVat)}</Text>
          </View>
          <View style={styles.draftSummaryRow}>
            <Text style={styles.draftSummaryLabel}>Grand total</Text>
            <Text style={styles.draftSummaryStrong}>Tsh {formatMoney(draftGrandTotal)}</Text>
          </View>
          <View style={styles.draftSummaryRow}>
            <Text style={styles.draftSummaryLabel}>Amount paid</Text>
            <Text style={styles.draftSummaryValue}>Tsh {formatMoney(draftAmountPaid)}</Text>
          </View>
          <View style={styles.draftBalanceRow}>
            <Text style={styles.draftBalanceLabel}>Balance due</Text>
            <Text style={styles.draftBalanceValue}>Tsh {formatMoney(draftBalance)}</Text>
          </View>
        </View>
        <View style={styles.readinessBox}>
          <View style={styles.readinessTop}>
            <View>
              <Text style={styles.readinessTitle}>Document readiness</Text>
              <Text style={styles.readinessSubtitle}>{draftReadinessTone}</Text>
            </View>
            <Text style={[styles.readinessScore, draftReadinessScore < 50 && styles.readinessScoreWarning]}>
              {draftReadinessScore}%
            </Text>
          </View>
          <View style={styles.readinessGrid}>
            {draftReadinessItems.map((item) => (
              <View
                key={item.label}
                style={[styles.readinessItem, item.done ? styles.readinessItemDone : styles.readinessItemPending]}>
                <Text style={[styles.readinessMark, item.done ? styles.readinessMarkDone : styles.readinessMarkPending]}>
                  {item.done ? '✓' : '•'}
                </Text>
                <Text style={styles.readinessItemText}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.draftActionRow}>
          <Pressable style={styles.copyDraftButton} onPress={copyDraftSummary}>
            <Text style={styles.copyDraftText}>Copy draft summary</Text>
          </Pressable>
          <Pressable style={styles.resetDraftButton} onPress={resetDraft}>
            <Text style={styles.resetDraftText}>Reset draft</Text>
          </Pressable>
        </View>
        <Text style={[styles.saveReadinessText, canSaveDocument && styles.saveReadinessTextReady]}>
          {saveReadinessMessage}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={`Hifadhi ${formDocumentLabel}`}
          onPress={onSubmit}
          loading={loading}
          disabled={!canSaveDocument}
        />
      </View>

      <View style={styles.summaryGrid}>
        <SummaryMetric
          label="Outstanding"
          value={`Tsh ${formatMoney(quoteSummary.outstanding)}`}
          tone="primary"
          onPress={() => {
            setPaymentFilter('all');
            setDueFilter('all');
          }}
        />
        <SummaryMetric
          label="Overdue"
          value={String(quoteSummary.overdue)}
          tone="danger"
          onPress={() => setDueFilter('overdue')}
        />
        <SummaryMetric
          label="Due soon"
          value={String(quoteSummary.dueSoon)}
          tone="warning"
          onPress={() => setDueFilter('due_soon')}
        />
        <SummaryMetric
          label="Invoices"
          value={String(quoteSummary.invoices)}
          tone="neutral"
          onPress={() => setDocumentFilter('invoice')}
        />
      </View>

      <View style={styles.pipelineCard}>
        <View style={styles.pipelineHeader}>
          <View>
            <Text style={styles.pipelineTitle}>Document Pipeline</Text>
            <Text style={styles.pipelineSubtitle}>Bonyeza stage kuchuja list hapa chini</Text>
          </View>
          <Text style={styles.pipelineCount}>{quotes.length} docs</Text>
        </View>
        <View style={styles.pipelineGrid}>
          {documentPipeline.map((stage) => (
            <PipelineStage
              key={stage.status}
              label={stage.label}
              count={stage.count}
              value={stage.value}
              active={statusFilter === stage.status}
              onPress={() => setStatusFilter(stage.status)}
            />
          ))}
        </View>
      </View>

      <View style={styles.recentHeader}>
        <Text style={styles.sectionTitle}>Recent Quotations / Proforma / Invoice</Text>
        <View style={styles.recentActions}>
          <Pressable style={styles.exportButton} onPress={exportFilteredQuotesCsv}>
            <Text style={styles.exportButtonText}>Export CSV</Text>
          </Pressable>
          <Text style={styles.recentCount}>{filteredQuotes.length}/{quotes.length}</Text>
        </View>
      </View>
      <View style={styles.filterCard}>
        <TextField label="Tafuta customer, contact au number" value={quoteSearch} onChangeText={setQuoteSearch} />
        <View style={styles.filterToolsRow}>
          <Text style={styles.filterToolsText}>Filters zinaathiri list na Export CSV</Text>
          <Pressable style={styles.resetFiltersButton} onPress={resetQuoteFilters}>
            <Text style={styles.resetFiltersText}>Reset filters</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="Zote" active={documentFilter === 'all'} onPress={() => setDocumentFilter('all')} />
          <FilterChip label="Quotation" active={documentFilter === 'quotation'} onPress={() => setDocumentFilter('quotation')} />
          <FilterChip label="Proforma" active={documentFilter === 'proforma'} onPress={() => setDocumentFilter('proforma')} />
          <FilterChip label="Invoice" active={documentFilter === 'invoice'} onPress={() => setDocumentFilter('invoice')} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="All dates" active={dateFilter === 'all'} onPress={() => setDateFilter('all')} />
          <FilterChip label="Today" active={dateFilter === 'today'} onPress={() => setDateFilter('today')} />
          <FilterChip label="Last 7 days" active={dateFilter === 'week'} onPress={() => setDateFilter('week')} />
          <FilterChip label="Last 30 days" active={dateFilter === 'month'} onPress={() => setDateFilter('month')} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="All status" active={statusFilter === 'all'} onPress={() => setStatusFilter('all')} />
          <FilterChip label="Draft" active={statusFilter === 'draft'} onPress={() => setStatusFilter('draft')} />
          <FilterChip label="Sent" active={statusFilter === 'sent'} onPress={() => setStatusFilter('sent')} />
          <FilterChip label="Accepted" active={statusFilter === 'accepted'} onPress={() => setStatusFilter('accepted')} />
          <FilterChip label="Converted" active={statusFilter === 'converted'} onPress={() => setStatusFilter('converted')} />
          <FilterChip label="Rejected" active={statusFilter === 'rejected'} onPress={() => setStatusFilter('rejected')} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="All payments" active={paymentFilter === 'all'} onPress={() => setPaymentFilter('all')} />
          <FilterChip label="Unpaid" active={paymentFilter === 'Unpaid'} onPress={() => setPaymentFilter('Unpaid')} />
          <FilterChip label="Partial" active={paymentFilter === 'Partial'} onPress={() => setPaymentFilter('Partial')} />
          <FilterChip label="Paid" active={paymentFilter === 'Paid'} onPress={() => setPaymentFilter('Paid')} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="All due dates" active={dueFilter === 'all'} onPress={() => setDueFilter('all')} />
          <FilterChip label="Overdue" active={dueFilter === 'overdue'} onPress={() => setDueFilter('overdue')} />
          <FilterChip label="Due soon" active={dueFilter === 'due_soon'} onPress={() => setDueFilter('due_soon')} />
          <FilterChip label="No due date" active={dueFilter === 'no_due'} onPress={() => setDueFilter('no_due')} />
        </ScrollView>
        <View style={styles.sortHeader}>
          <Text style={styles.sortLabel}>Sort by</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <FilterChip label="Newest" active={sortMode === 'newest'} onPress={() => setSortMode('newest')} />
            <FilterChip label="Due date" active={sortMode === 'due_date'} onPress={() => setSortMode('due_date')} />
            <FilterChip
              label="Highest balance"
              active={sortMode === 'highest_balance'}
              onPress={() => setSortMode('highest_balance')}
            />
          </ScrollView>
        </View>
      </View>
      {selectedQuote ? (
        <View style={styles.documentCard}>
          <View style={styles.listTop}>
            <Text style={styles.title}>{getDocumentLabel(getDocumentType(selectedQuote))} Preview</Text>
            <Text
              onPress={() => {
                setSelectedQuote(null);
                setPaymentAmountInput('');
              }}
              style={styles.closeText}>
              Funga
            </Text>
          </View>
          <View style={styles.actions}>
            <Pressable style={styles.docButton} onPress={copyQuote}>
              <Text style={styles.docButtonText}>Copy Text</Text>
            </Pressable>
            <Pressable style={styles.whatsappButton} onPress={shareQuoteWhatsApp}>
              <Text style={styles.whatsappButtonText}>WhatsApp</Text>
            </Pressable>
            <Pressable style={styles.docButton} onPress={printQuote}>
              <Text style={styles.docButtonText}>Print / Save PDF</Text>
            </Pressable>
            <Pressable style={styles.duplicateButton} onPress={duplicateSelectedQuote}>
              <Text style={styles.duplicateButtonText}>Duplicate</Text>
            </Pressable>
          </View>
          {getNextDocumentType(getDocumentType(selectedQuote)) ? (
            <Pressable style={styles.convertButton} onPress={convertSelectedQuote}>
              <Text style={styles.convertButtonText}>
                Convert to {getDocumentLabel(getNextDocumentType(getDocumentType(selectedQuote)) as DocumentType)}
              </Text>
            </Pressable>
          ) : (
            <>
              <InvoiceStockCheckPanel items={selectedItems} products={products} quote={selectedQuote} />
              <Pressable
                style={[
                  styles.postSalesButton,
                  isInvoicePostedToSales(selectedQuote.note) && styles.postSalesButtonDisabled,
                ]}
                onPress={postInvoiceToSales}
                disabled={isInvoicePostedToSales(selectedQuote.note)}>
                <Text style={styles.postSalesButtonText}>
                  {isInvoicePostedToSales(selectedQuote.note) ? 'Posted to Sales' : 'Post Invoice to Sales'}
                </Text>
              </Pressable>
            </>
          )}
          <PaymentReminderPanel quote={selectedQuote} onShare={sharePaymentReminder} onCopy={copyPaymentReminder} />
          <CustomerStatementPanel
            quote={selectedQuote}
            documents={selectedCustomerDocs}
            onCopy={copyCustomerStatement}
            onFilter={filterSelectedCustomer}
          />
          <View style={styles.paymentUpdateBox}>
            <View style={styles.paymentUpdateCopy}>
              <Text style={styles.paymentUpdateTitle}>Record Payment</Text>
              <Text style={styles.paymentUpdateMeta}>
                Due: Tsh {formatMoney(getPaymentSummary(selectedQuote).balance)}
              </Text>
            </View>
            <View style={styles.quickPaymentRow}>
              <Pressable
                style={styles.quickPaymentButton}
                onPress={() => setPaymentAmountInput(String(getPaymentSummary(selectedQuote).balance))}>
                <Text style={styles.quickPaymentText}>Pay balance</Text>
              </Pressable>
              <Pressable
                style={styles.quickPaymentButton}
                onPress={() => setPaymentAmountInput(String(Math.round(getPaymentSummary(selectedQuote).balance / 2)))}>
                <Text style={styles.quickPaymentText}>50%</Text>
              </Pressable>
              <Pressable
                style={styles.quickPaymentButton}
                onPress={() => {
                  setPaymentAmountInput('');
                  setPaymentNoteInput('');
                }}>
                <Text style={styles.quickPaymentText}>Clear</Text>
              </Pressable>
            </View>
            <View style={styles.paymentUpdateControls}>
              <TextField
                label="Amount paid"
                value={paymentAmountInput}
                onChangeText={setPaymentAmountInput}
                keyboardType="numeric"
              />
              <TextField
                label="Payment note"
                value={paymentNoteInput}
                onChangeText={setPaymentNoteInput}
              />
              <Pressable style={styles.paymentUpdateButton} onPress={updateSelectedPayment}>
                <Text style={styles.paymentUpdateButtonText}>Update</Text>
              </Pressable>
            </View>
            <PaymentHistoryList quote={selectedQuote} />
            <DocumentActivityTimeline quote={selectedQuote} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator>
          <DocumentPreview quote={selectedQuote} items={selectedItems} company={companySettings} />
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.docButton} onPress={copyQuote}>
              <Text style={styles.docButtonText}>Copy Text</Text>
            </Pressable>
            <Pressable style={styles.whatsappButton} onPress={shareQuoteWhatsApp}>
              <Text style={styles.whatsappButtonText}>WhatsApp</Text>
            </Pressable>
            <Pressable style={styles.docButton} onPress={printQuote}>
              <Text style={styles.docButtonText}>Print / Save PDF</Text>
            </Pressable>
            <Pressable style={styles.duplicateButton} onPress={duplicateSelectedQuote}>
              <Text style={styles.duplicateButtonText}>Duplicate</Text>
            </Pressable>
          </View>
          {getNextDocumentType(getDocumentType(selectedQuote)) ? (
            <Pressable style={styles.convertButton} onPress={convertSelectedQuote}>
              <Text style={styles.convertButtonText}>
                Convert to {getDocumentLabel(getNextDocumentType(getDocumentType(selectedQuote)) as DocumentType)}
              </Text>
            </Pressable>
          ) : (
            <>
              <InvoiceStockCheckPanel items={selectedItems} products={products} quote={selectedQuote} />
              <Pressable
                style={[
                  styles.postSalesButton,
                  isInvoicePostedToSales(selectedQuote.note) && styles.postSalesButtonDisabled,
                ]}
                onPress={postInvoiceToSales}
                disabled={isInvoicePostedToSales(selectedQuote.note)}>
                <Text style={styles.postSalesButtonText}>
                  {isInvoicePostedToSales(selectedQuote.note) ? 'Posted to Sales' : 'Post Invoice to Sales'}
                </Text>
              </Pressable>
            </>
          )}
          <PaymentReminderPanel quote={selectedQuote} onShare={sharePaymentReminder} onCopy={copyPaymentReminder} />
          <CustomerStatementPanel
            quote={selectedQuote}
            documents={selectedCustomerDocs}
            onCopy={copyCustomerStatement}
            onFilter={filterSelectedCustomer}
          />
          <View style={styles.actions}>
            <Pressable style={styles.statusButton} onPress={() => updateQuoteStatus('sent')}>
              <Text style={styles.statusText}>Mark Sent</Text>
            </Pressable>
            <Pressable style={styles.statusButton} onPress={() => updateQuoteStatus('accepted')}>
              <Text style={styles.statusText}>Accepted</Text>
            </Pressable>
            <Pressable style={styles.statusButton} onPress={() => updateQuoteStatus('converted')}>
              <Text style={styles.statusText}>Converted</Text>
            </Pressable>
            <Pressable style={[styles.statusButton, styles.statusButtonDanger]} onPress={() => updateQuoteStatus('rejected')}>
              <Text style={[styles.statusText, styles.statusTextDanger]}>Rejected</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {quotes.length === 0 ? (
        <Text style={styles.empty}>Hakuna quotations bado.</Text>
      ) : filteredQuotes.length === 0 ? (
        <Text style={styles.empty}>Hakuna document inayofanana na filter hizi.</Text>
      ) : (
        filteredQuotes.map((quote) => <QuoteRow key={quote.id} quote={quote} onOpen={() => openQuote(quote)} />)
      )}
    </ScrollView>
  );
}

function DocumentPreview({ quote, items, company }: { quote: Quotation; items: QuoteItem[]; company: CompanySettings }) {
  const documentType = getDocumentType(quote);
  const documentLabel = getDocumentLabel(documentType);
  const subtotal = quote.total_amount;
  const vat = isVatEnabledForQuote(quote) ? subtotal * VAT_RATE : 0;
  const { total, paid: amountPaid, balance: balanceDue, status: paymentStatus } = getPaymentSummary(quote);
  const phones = splitLines(company.phonesText);
  const bankLines = splitLines(company.bankText);
  const note = cleanQuoteNote(quote.note);
  const customerAddress = getCustomerAddress(quote.note);

  return (
    <View style={styles.invoiceSheet}>
      <View style={styles.invoiceHeader}>
        <Text style={styles.invoiceCompanyLeft}>{company.name}</Text>
        <View style={styles.invoiceCompanyRight}>
          <Text style={styles.invoiceTitle}>{documentLabel}</Text>
          <Text style={styles.invoiceCompanyName}>{company.name}</Text>
          <Text style={styles.invoiceSmall}>{company.tagline}</Text>
          <Text style={styles.invoiceSmall}>{company.location}</Text>
          {phones.map((phone) => (
            <Text key={phone} style={styles.invoiceSmall}>{phone}</Text>
          ))}
          <Text style={styles.invoiceSmall}>{company.email}</Text>
          <Text style={styles.invoiceSmall}>{company.tax}</Text>
        </View>
      </View>

      <View style={styles.invoiceInfoBand}>
        <View style={styles.customerBlock}>
          <Text style={styles.invoiceSectionLabel}>TO</Text>
          <Text style={styles.invoiceCustomer}>{quote.customer_name}</Text>
          {quote.customer_contact ? <Text style={styles.invoiceSmall}>{quote.customer_contact}</Text> : null}
          {customerAddress
            ? customerAddress.split('\n').map((line) => (
                <Text key={line} style={styles.invoiceSmall}>{line}</Text>
              ))
            : null}
        </View>
        <View style={styles.invoiceMetaBlock}>
          <View style={styles.invoiceMetaRow}>
            <Text style={styles.invoiceMetaLabel}>{documentLabel} #</Text>
            <Text style={styles.invoiceMetaValue}>{quote.quote_number ?? quote.id.slice(0, 8)}</Text>
          </View>
          <View style={styles.invoiceMetaRow}>
            <Text style={styles.invoiceMetaLabel}>Date</Text>
            <Text style={styles.invoiceMetaValue}>{formatDocumentDate(quote.created_at)}</Text>
          </View>
          <View style={styles.invoiceMetaRow}>
            <Text style={styles.invoiceMetaLabel}>Due date</Text>
            <Text style={styles.invoiceMetaValue}>{quote.valid_until ?? '-'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.tableCell, styles.itemCell, styles.tableHeaderText]}>Item</Text>
          <Text style={[styles.tableCell, styles.qtyCell, styles.tableHeaderText]}>Quantity</Text>
          <Text style={[styles.tableCell, styles.priceCell, styles.tableHeaderText]}>Price</Text>
          <Text style={[styles.tableCell, styles.amountCell, styles.tableHeaderText]}>Amount</Text>
        </View>
        {items.map((item) => (
          <View key={item.id} style={styles.tableRow}>
            <Text style={[styles.tableCell, styles.itemCell, styles.itemName]}>{item.description}</Text>
            <Text style={[styles.tableCell, styles.qtyCell]}>{formatMoney(item.quantity)}</Text>
            <Text style={[styles.tableCell, styles.priceCell]}>TSh{formatMoney(item.unit_price)}</Text>
            <Text style={[styles.tableCell, styles.amountCell]}>TSh{formatMoney(item.quantity * item.unit_price)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.totalsArea}>
        <View style={styles.totalsBox}>
          <InvoiceTotalLine label="Subtotal" value={subtotal} />
          <InvoiceTotalLine label="VAT TAX (18%)" value={vat} />
          <InvoiceTotalLine label="Total" value={total} />
          <InvoiceTotalLine label="Amount paid" value={amountPaid} />
        </View>
      </View>

      <View style={styles.amountDueBox}>
        <Text style={styles.amountDueLabel}>Amount due</Text>
        <Text style={styles.amountDueValue}>TSh{formatMoney(balanceDue)}</Text>
        <Text style={styles.amountDueStatus}>{paymentStatus}</Text>
      </View>

      {note ? <Text style={styles.invoiceNote}>{note}</Text> : null}

      <View style={styles.paymentBlock}>
        <Text style={styles.paymentTitle}>Payment instruction</Text>
        {bankLines.map((line) => (
          <Text key={line} style={styles.paymentLine}>{line}</Text>
        ))}
      </View>
    </View>
  );
}

function InvoiceTotalLine({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.invoiceTotalRow}>
      <Text style={styles.invoiceTotalLabel}>{label}</Text>
      <Text style={styles.invoiceTotalValue}>TSh{formatMoney(value)}</Text>
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'danger' | 'warning' | 'neutral';
  onPress: () => void;
}) {
  const toneStyle =
    tone === 'danger'
      ? styles.summaryValueDanger
      : tone === 'warning'
        ? styles.summaryValueWarning
        : tone === 'neutral'
          ? styles.summaryValueNeutral
          : styles.summaryValuePrimary;

  return (
    <Pressable style={styles.summaryCard} onPress={onPress}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, toneStyle]}>{value}</Text>
    </Pressable>
  );
}

function PipelineStage({
  label,
  count,
  value,
  active,
  onPress,
}: {
  label: string;
  count: number;
  value: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.pipelineStage, active && styles.pipelineStageActive]} onPress={onPress}>
      <Text style={[styles.pipelineStageLabel, active && styles.pipelineStageLabelActive]}>{label}</Text>
      <Text style={[styles.pipelineStageCount, active && styles.pipelineStageCountActive]}>{count}</Text>
      <Text style={[styles.pipelineStageValue, active && styles.pipelineStageValueActive]}>Tsh {formatMoney(value)}</Text>
    </Pressable>
  );
}

function PaymentReminderPanel({
  quote,
  onShare,
  onCopy,
}: {
  quote: Quotation;
  onShare: () => void;
  onCopy: () => void;
}) {
  const payment = getPaymentSummary(quote);
  const due = getDueStatus(quote);
  const reminders = getReminderHistory(quote.note);
  const lastReminder = reminders[0];
  const phone = normalizeWhatsAppPhone(quote.customer_contact);
  const isPaid = payment.balance <= 0;

  return (
    <View style={styles.reminderBox}>
      <View style={styles.reminderCopy}>
        <Text style={styles.reminderTitle}>Payment Reminder</Text>
        <Text style={styles.reminderMeta}>
          {isPaid ? 'Hakuna balance iliyobaki' : `Balance: Tsh ${formatMoney(payment.balance)} · ${due.label}`}
        </Text>
        <Text style={styles.reminderMeta}>
          {lastReminder
            ? `Last reminded: ${formatDateTime(lastReminder.createdAt)} · ${reminders.length} total`
            : 'No reminders yet'}
        </Text>
        <Text style={styles.reminderMeta}>
          {phone ? `WhatsApp: +${phone}` : 'No customer phone saved'}
        </Text>
      </View>
      <View style={styles.reminderActions}>
        <Pressable
          style={[styles.reminderButton, isPaid && styles.reminderButtonDisabled]}
          onPress={onShare}
          disabled={isPaid}>
          <Text style={styles.reminderButtonText}>{isPaid ? 'Paid' : 'WhatsApp'}</Text>
        </Pressable>
        <Pressable
          style={[styles.reminderCopyButton, isPaid && styles.reminderButtonDisabled]}
          onPress={onCopy}
          disabled={isPaid}>
          <Text style={styles.reminderCopyButtonText}>Copy</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CustomerStatementPanel({
  quote,
  documents,
  onCopy,
  onFilter,
}: {
  quote: Quotation;
  documents: Quotation[];
  onCopy: () => void;
  onFilter: () => void;
}) {
  const totalBalance = documents.reduce((sum, document) => sum + getPaymentSummary(document).balance, 0);

  return (
    <View style={styles.customerStatementBox}>
      <View style={styles.customerStatementCopy}>
        <Text style={styles.customerStatementTitle}>Customer Statement</Text>
        <Text style={styles.customerStatementMeta}>
          {quote.customer_name} · {documents.length} open doc{documents.length === 1 ? '' : 's'}
        </Text>
        <Text style={styles.customerStatementBalance}>Total balance: Tsh {formatMoney(totalBalance)}</Text>
      </View>
      <View style={styles.customerStatementActions}>
        <Pressable style={styles.customerStatementButton} onPress={onCopy}>
          <Text style={styles.customerStatementButtonText}>Copy</Text>
        </Pressable>
        <Pressable style={styles.customerStatementFilterButton} onPress={onFilter}>
          <Text style={styles.customerStatementFilterText}>Filter</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PaymentHistoryList({ quote }: { quote: Quotation }) {
  const history = getPaymentHistory(quote.note);
  if (history.length === 0) {
    return <Text style={styles.paymentHistoryEmpty}>Hakuna payment history bado.</Text>;
  }

  return (
    <View style={styles.paymentHistoryBox}>
      <Text style={styles.paymentHistoryTitle}>Payment History</Text>
      {history.map((payment) => (
        <View key={payment.id} style={styles.paymentHistoryRow}>
          <View style={styles.paymentHistoryInfo}>
            <Text style={styles.paymentHistoryDate}>{formatDocumentDate(payment.createdAt)}</Text>
            {payment.note ? <Text style={styles.paymentHistoryNote}>{payment.note}</Text> : null}
          </View>
          <Text style={styles.paymentHistoryAmount}>Tsh {formatMoney(payment.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function DocumentActivityTimeline({ quote }: { quote: Quotation }) {
  const paymentEvents = getPaymentHistory(quote.note).map((payment) => ({
    id: `payment-${payment.id}`,
    createdAt: payment.createdAt,
    title: `Payment: Tsh ${formatMoney(payment.amount)}`,
    detail: payment.note ?? 'Payment recorded',
  }));
  const reminderEvents = getReminderHistory(quote.note).map((reminder) => ({
    id: `reminder-${reminder.id}`,
    createdAt: reminder.createdAt,
    title: 'Reminder sent',
    detail: reminder.channel === 'whatsapp' ? 'WhatsApp reminder opened' : 'Reminder shared',
  }));
  const postedAt = getInvoicePostedAt(quote.note);
  const postedEvents = postedAt
    ? [
        {
          id: 'posted-sales',
          createdAt: postedAt,
          title: 'Posted to Sales',
          detail: 'Invoice converted into sales and stock movement',
        },
      ]
    : [];
  const events = [
    ...paymentEvents,
    ...reminderEvents,
    ...postedEvents,
    {
      id: 'created',
      createdAt: quote.created_at,
      title: 'Document created',
      detail: getDocumentLabel(getDocumentType(quote)),
    },
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <View style={styles.timelineBox}>
      <Text style={styles.timelineTitle}>Activity Timeline</Text>
      {events.slice(0, 6).map((event) => (
        <View key={event.id} style={styles.timelineRow}>
          <View style={styles.timelineDot} />
          <View style={styles.timelineBody}>
            <Text style={styles.timelineEventTitle}>{event.title}</Text>
            <Text style={styles.timelineDetail}>{event.detail}</Text>
          </View>
          <Text style={styles.timelineDate}>{formatDateTime(event.createdAt)}</Text>
        </View>
      ))}
    </View>
  );
}

function InvoiceStockCheckPanel({
  items,
  products,
  quote,
}: {
  items: QuoteItem[];
  products: Product[];
  quote: Quotation;
}) {
  const checks = getInvoiceStockChecks(items, products);
  if (checks.length === 0) {
    return (
      <View style={styles.stockCheckBox}>
        <Text style={styles.stockCheckTitle}>Stock Check</Text>
        <Text style={styles.stockCheckMuted}>Hakuna product stock inayoweza kuangaliwa kwenye invoice hii.</Text>
      </View>
    );
  }

  const hasLowStock = checks.some((check) => check.status === 'low');
  const hasUnknown = checks.some((check) => check.status === 'unknown');
  const posted = isInvoicePostedToSales(quote.note);
  const summary = posted
    ? 'Invoice tayari ime-post kwenye sales.'
    : hasLowStock
      ? 'Stock haitoshi kwa bidhaa baadhi.'
      : hasUnknown
        ? 'Bidhaa baadhi hazijapatikana kwenye stock list.'
        : 'Stock ipo tayari kwa posting.';

  return (
    <View style={styles.stockCheckBox}>
      <View style={styles.stockCheckTop}>
        <Text style={styles.stockCheckTitle}>Stock Check</Text>
        <Text
          style={[
            styles.stockCheckBadge,
            hasLowStock ? styles.stockCheckBadgeLow : styles.stockCheckBadgeOk,
          ]}>
          {hasLowStock ? 'Low stock' : posted ? 'Posted' : 'Ready'}
        </Text>
      </View>
      <Text style={styles.stockCheckMuted}>{summary}</Text>
      {checks.map((check) => (
        <View key={check.item.id} style={styles.stockCheckRow}>
          <View style={styles.stockCheckItem}>
            <Text style={styles.stockCheckName}>{check.item.description}</Text>
            <Text style={styles.stockCheckMuted}>Invoice qty: {formatMoney(check.item.quantity)}</Text>
          </View>
          <View style={styles.stockCheckNumbers}>
            <Text
              style={[
                styles.stockCheckAvailable,
                check.status === 'low' && styles.stockCheckAvailableLow,
              ]}>
              {check.available === null ? 'Unknown' : `Stock ${formatMoney(check.available)}`}
            </Text>
            <Text style={styles.stockCheckMuted}>
              {check.remaining === null ? '-' : `After ${formatMoney(check.remaining)}`}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function QuoteRow({ quote, onOpen }: { quote: Quotation; onOpen: () => void }) {
  const documentLabel = getDocumentLabel(getDocumentType(quote));
  const payment = getPaymentSummary(quote);
  const due = getDueStatus(quote);
  const reminderCount = getReminderHistory(quote.note).length;
  const statusStyle =
    payment.status === 'Paid'
      ? styles.paymentPaid
      : payment.status === 'Partial'
        ? styles.paymentPartial
        : styles.paymentUnpaid;
  const dueStyle =
    due.key === 'overdue'
      ? styles.dueOverdue
      : due.key === 'today' || due.key === 'soon'
        ? styles.dueSoon
        : due.key === 'paid'
          ? styles.duePaid
          : styles.dueNeutral;

  return (
    <Pressable style={styles.listCard} onPress={onOpen}>
      <View style={styles.listTop}>
        <Text style={styles.customer}>{quote.customer_name}</Text>
        <Text style={styles.amount}>Tsh {formatMoney(quote.total_amount)}</Text>
      </View>
      <Text style={styles.meta}>
        {documentLabel} | {quote.quote_number ?? quote.id.slice(0, 8)} | {quote.status} | {formatDateTime(quote.created_at)}
      </Text>
      <View style={styles.paymentRow}>
        <Text style={[styles.paymentBadge, statusStyle]}>{payment.status}</Text>
        <Text style={[styles.dueBadge, dueStyle]}>{due.label}</Text>
        {reminderCount > 0 ? <Text style={styles.reminderBadge}>Reminded {reminderCount}</Text> : null}
        <Text style={styles.paymentBalance}>Due: Tsh {formatMoney(payment.balance)}</Text>
      </View>
      <Text style={styles.openHint}>Tap to preview/copy</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 120 },
  branchHint: { color: Colors.primaryDark, fontWeight: '400', marginBottom: Spacing.lg },
  settingsToggle: {
    alignSelf: 'flex-start',
    minHeight: 38,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  settingsToggleText: {
    color: Colors.primaryDark,
    fontWeight: '400',
  },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.lg },
  title: { color: Colors.text, fontSize: 18, fontWeight: '600', marginBottom: Spacing.md },
  formNotice: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: Radius.sm,
    padding: Spacing.md,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: 4,
    marginBottom: Spacing.lg,
    gap: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  segmentButtonActive: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  segmentText: { color: Colors.textMuted, fontSize: 12, fontWeight: '400', textAlign: 'center' },
  segmentTextActive: { color: Colors.primaryDark },
  recentCustomersBox: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  recentCustomersTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  recentCustomersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  recentCustomerChip: {
    minHeight: 42,
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    justifyContent: 'center',
  },
  recentCustomerName: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  recentCustomerContact: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  customerBalanceBox: {
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  customerBalanceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  customerBalanceTitle: {
    color: '#8A5A00',
    fontSize: 13,
    fontWeight: '600',
  },
  customerBalanceAmount: {
    color: '#8A5A00',
    fontSize: 13,
    fontWeight: '600',
  },
  customerBalanceText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  customerBalanceDoc: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  row: { flexDirection: 'row', gap: Spacing.md },
  total: { color: Colors.primaryDark, fontSize: 16, fontWeight: '600', marginBottom: Spacing.md },
  linePreview: { color: Colors.textMuted, fontWeight: '600', marginBottom: Spacing.md },
  quickPriceBox: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  quickPriceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  quickPriceTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  quickPriceMargin: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  quickPriceMarginDanger: {
    color: Colors.danger,
  },
  quickPriceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  quickPriceButton: {
    flexGrow: 1,
    minWidth: '22%',
    minHeight: 34,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  quickPriceText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  quickPriceHint: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  profitDraftBox: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  profitDraftBoxWarning: {
    backgroundColor: '#FFF5F5',
    borderColor: '#F5C2C7',
  },
  profitDraftTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  profitDraftTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  profitDraftTitleWarning: {
    color: Colors.danger,
  },
  profitDraftSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  profitDraftMargin: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  profitDraftMarginWarning: {
    backgroundColor: '#FFF5F5',
    borderColor: '#F5C2C7',
    color: Colors.danger,
  },
  profitDraftGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  profitDraftCard: {
    flex: 1,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  profitDraftLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  profitDraftValue: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  profitDraftLoss: {
    color: Colors.danger,
  },
  draftSummaryBox: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  draftSummaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  draftSummaryTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  draftStatus: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    fontSize: 12,
    fontWeight: '600',
  },
  draftStatusPaid: {
    backgroundColor: '#E8F8EF',
    color: Colors.success,
  },
  draftStatusPartial: {
    backgroundColor: Colors.warningSoft,
    color: '#8A5A00',
  },
  draftStatusUnpaid: {
    backgroundColor: Colors.surface,
    color: Colors.textMuted,
  },
  draftSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  draftSummaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  draftSummaryValue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  draftSummaryStrong: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
  },
  draftBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#BFE5D6',
    paddingTop: Spacing.sm,
  },
  draftBalanceLabel: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '500',
  },
  draftBalanceValue: {
    color: Colors.primaryDark,
    fontSize: 16,
    fontWeight: '600',
  },
  readinessBox: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  readinessTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  readinessTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  readinessSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  readinessScore: {
    minWidth: 54,
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    textAlign: 'center',
  },
  readinessScoreWarning: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
    color: '#8A5A00',
  },
  readinessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  readinessItem: {
    flexGrow: 1,
    minWidth: '47%',
    minHeight: 36,
    borderRadius: Radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  readinessItemDone: {
    backgroundColor: Colors.primarySoft,
    borderColor: '#BFE5D6',
  },
  readinessItemPending: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
  },
  readinessMark: {
    fontSize: 13,
    fontWeight: '600',
  },
  readinessMarkDone: {
    color: Colors.primaryDark,
  },
  readinessMarkPending: {
    color: '#8A5A00',
  },
  readinessItemText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '400',
    flex: 1,
  },
  draftActionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  copyDraftButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  copyDraftText: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '400',
  },
  resetDraftButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#F5C2C7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  resetDraftText: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  saveReadinessText: {
    color: '#8A5A00',
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  saveReadinessTextReady: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderColor: '#BFE5D6',
  },
  stockDraftBox: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  stockDraftBoxWarning: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
  },
  stockDraftTitle: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  stockDraftTitleWarning: {
    color: '#8A5A00',
  },
  stockDraftText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  priceDraftWarningBox: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#F5C2C7',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  priceDraftWarningTitle: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  priceDraftWarningText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  quickPaymentDraftRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  quickPaymentDraftButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickPaymentDraftText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  quickDueRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  quickDueButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  quickDueText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  vatToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  vatTitle: {
    color: Colors.text,
    fontWeight: '600',
  },
  vatSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  vatToggle: {
    minWidth: 64,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vatToggleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  vatToggleText: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  vatToggleTextActive: {
    color: Colors.white,
  },
  linesBox: { backgroundColor: Colors.primarySoft, borderRadius: Radius.md, padding: Spacing.md, marginVertical: Spacing.md, gap: Spacing.sm },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  lineRowWarning: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
  },
  lineInfo: { flex: 1 },
  lineText: { color: Colors.primaryDark, fontWeight: '400' },
  lineMeta: { color: Colors.textMuted, fontSize: 12, fontWeight: '400', marginTop: 2 },
  lineStockStatus: { color: Colors.success, fontSize: 12, fontWeight: '600', marginTop: 2 },
  lineStockStatusWarning: { color: '#8A5A00' },
  linePriceStatus: { color: Colors.primaryDark, fontSize: 12, fontWeight: '600', marginTop: 2 },
  linePriceStatusWarning: { color: '#8A5A00' },
  linePriceStatusDanger: { color: Colors.danger },
  lineAmountBlock: { alignItems: 'flex-end', gap: Spacing.xs },
  lineAmount: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  removeLineButton: {
    minHeight: 30,
    borderRadius: Radius.sm,
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#F5C2C7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  removeLineText: { color: Colors.danger, fontSize: 12, fontWeight: '600' },
  error: { color: Colors.danger, textAlign: 'center', marginBottom: Spacing.md },
  sectionTitle: { color: Colors.text, fontSize: 17, fontWeight: '600', marginTop: Spacing.xl, marginBottom: Spacing.md },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  recentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  exportButton: {
    minHeight: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  exportButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  recentCount: {
    color: Colors.textMuted,
    fontWeight: '600',
  },
  filterCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  filterToolsRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  filterToolsText: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  resetFiltersButton: {
    minHeight: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  resetFiltersText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  filterRow: {
    gap: Spacing.sm,
    paddingRight: Spacing.md,
  },
  sortHeader: {
    gap: Spacing.xs,
  },
  sortLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  filterChip: {
    minHeight: 36,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: Colors.white,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 76,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    justifyContent: 'center',
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  summaryValue: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '600',
  },
  summaryValuePrimary: {
    color: Colors.primaryDark,
  },
  summaryValueDanger: {
    color: Colors.danger,
  },
  summaryValueWarning: {
    color: Colors.warning,
  },
  summaryValueNeutral: {
    color: Colors.text,
  },
  pipelineCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  pipelineHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  pipelineTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  pipelineSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  pipelineCount: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  pipelineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  pipelineStage: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 86,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    padding: Spacing.md,
  },
  pipelineStageActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  pipelineStageLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  pipelineStageLabelActive: {
    color: Colors.primaryDark,
  },
  pipelineStageCount: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  pipelineStageCountActive: {
    color: Colors.primaryDark,
  },
  pipelineStageValue: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  pipelineStageValueActive: {
    color: Colors.primaryDark,
  },
  reminderBox: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  reminderCopy: {
    flex: 1,
  },
  reminderTitle: {
    color: Colors.text,
    fontWeight: '600',
  },
  reminderMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  reminderButton: {
    minHeight: 40,
    borderRadius: Radius.md,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  reminderActions: {
    minWidth: 104,
    gap: Spacing.xs,
  },
  reminderButtonDisabled: {
    backgroundColor: Colors.textMuted,
  },
  reminderButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  reminderCopyButton: {
    minHeight: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  reminderCopyButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  reminderBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  customerStatementBox: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  customerStatementCopy: {
    flex: 1,
  },
  customerStatementTitle: {
    color: Colors.text,
    fontWeight: '600',
  },
  customerStatementMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  customerStatementBalance: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  customerStatementActions: {
    minWidth: 94,
    gap: Spacing.xs,
  },
  customerStatementButton: {
    minHeight: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  customerStatementButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  customerStatementFilterButton: {
    minHeight: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  customerStatementFilterText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
  },
  empty: { color: Colors.textMuted },
  listCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  listTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  customer: { flex: 1, color: Colors.text, fontWeight: '600' },
  amount: { color: Colors.success, fontWeight: '600' },
  meta: { color: Colors.textMuted, marginTop: Spacing.xs },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  paymentBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  paymentPaid: {
    backgroundColor: Colors.primarySoft,
    color: Colors.success,
  },
  paymentPartial: {
    backgroundColor: Colors.warningSoft,
    color: Colors.warning,
  },
  paymentUnpaid: {
    backgroundColor: '#FDECEA',
    color: Colors.danger,
  },
  dueBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  dueOverdue: {
    backgroundColor: '#FDECEA',
    color: Colors.danger,
  },
  dueSoon: {
    backgroundColor: Colors.warningSoft,
    color: Colors.warning,
  },
  duePaid: {
    backgroundColor: Colors.primarySoft,
    color: Colors.success,
  },
  dueNeutral: {
    backgroundColor: Colors.background,
    color: Colors.textMuted,
  },
  paymentBalance: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  openHint: { color: Colors.primaryDark, fontWeight: '400', marginTop: Spacing.sm },
  documentCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  documentText: {
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : Platform.OS === 'android' ? 'monospace' : 'monospace',
    lineHeight: 20,
  },
  invoiceSheet: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6E9EB',
    width: 760,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  invoiceCompanyLeft: {
    flex: 1,
    color: Colors.text,
    fontSize: 22,
    fontWeight: '500',
  },
  invoiceCompanyRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  invoiceTitle: {
    color: Colors.text,
    fontSize: 26,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  invoiceCompanyName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: Spacing.xs,
    textAlign: 'right',
  },
  invoiceSmall: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  invoiceInfoBand: {
    backgroundColor: '#F0F3F4',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  customerBlock: {
    flex: 1,
  },
  invoiceSectionLabel: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '500',
    marginBottom: Spacing.xs,
  },
  invoiceCustomer: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '500',
    marginBottom: Spacing.xs,
  },
  invoiceMetaBlock: {
    width: 220,
  },
  invoiceMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: 4,
  },
  invoiceMetaLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '400',
  },
  invoiceMetaValue: {
    color: Colors.text,
    fontSize: 13,
    textAlign: 'right',
  },
  table: {
    borderTopWidth: 1,
    borderTopColor: '#D7DDE1',
  },
  tableRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#D7DDE1',
  },
  tableHeader: {
    minHeight: 38,
  },
  tableCell: {
    color: Colors.text,
    fontSize: 13,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  tableHeaderText: {
    fontWeight: '600',
  },
  itemCell: {
    flex: 1.8,
  },
  qtyCell: {
    flex: 0.7,
    textAlign: 'center',
  },
  priceCell: {
    flex: 1,
    textAlign: 'right',
  },
  amountCell: {
    flex: 1,
    textAlign: 'right',
  },
  itemName: {
    fontWeight: '600',
  },
  totalsArea: {
    alignItems: 'flex-end',
    marginTop: Spacing.xl,
  },
  totalsBox: {
    width: '50%',
    minWidth: 280,
    borderBottomWidth: 1,
    borderBottomColor: '#D7DDE1',
    paddingBottom: Spacing.sm,
  },
  invoiceTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  invoiceTotalLabel: {
    flex: 1,
    color: Colors.text,
    textAlign: 'right',
    fontSize: 14,
  },
  invoiceTotalValue: {
    width: 140,
    color: Colors.text,
    textAlign: 'right',
    fontSize: 14,
  },
  amountDueBox: {
    alignSelf: 'flex-end',
    width: '36%',
    minWidth: 240,
    backgroundColor: '#F0F3F4',
    borderRightWidth: 1,
    borderRightColor: '#E6E9EB',
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  amountDueLabel: {
    color: Colors.textMuted,
    fontSize: 16,
    marginBottom: Spacing.sm,
  },
  amountDueValue: {
    color: '#000000',
    fontSize: 26,
    textAlign: 'right',
  },
  amountDueStatus: {
    color: Colors.primaryDark,
    fontWeight: '600',
    marginTop: Spacing.xs,
    textAlign: 'right',
  },
  invoiceNote: {
    color: Colors.text,
    fontSize: 13,
    marginTop: Spacing.sm,
  },
  paymentBlock: {
    marginTop: Spacing.xl,
  },
  paymentTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '500',
    marginBottom: Spacing.md,
  },
  paymentLine: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 17,
  },
  closeText: { color: Colors.danger, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  docButton: {
    flex: 1,
    minWidth: 118,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docButtonText: { color: Colors.white, fontWeight: '600' },
  duplicateButton: {
    flex: 1,
    minWidth: 118,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  duplicateButtonText: {
    color: Colors.primaryDark,
    fontWeight: '600',
  },
  whatsappButton: {
    flex: 1,
    minWidth: 118,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsappButtonText: {
    color: Colors.white,
    fontWeight: '600',
  },
  convertButton: {
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  convertButtonText: {
    color: Colors.white,
    fontWeight: '600',
    textAlign: 'center',
  },
  postSalesButton: {
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  postSalesButtonDisabled: {
    backgroundColor: Colors.textMuted,
  },
  postSalesButtonText: {
    color: Colors.white,
    fontWeight: '600',
    textAlign: 'center',
  },
  stockCheckBox: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  stockCheckTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  stockCheckTitle: {
    color: Colors.text,
    fontWeight: '600',
  },
  stockCheckBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  stockCheckBadgeOk: {
    backgroundColor: Colors.primary,
  },
  stockCheckBadgeLow: {
    backgroundColor: Colors.danger,
  },
  stockCheckMuted: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  stockCheckRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  stockCheckItem: {
    flex: 1,
  },
  stockCheckName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  stockCheckNumbers: {
    alignItems: 'flex-end',
  },
  stockCheckAvailable: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  stockCheckAvailableLow: {
    color: Colors.danger,
  },
  paymentUpdateBox: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  paymentUpdateCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  paymentUpdateTitle: {
    color: Colors.text,
    fontWeight: '600',
  },
  paymentUpdateMeta: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  quickPaymentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  quickPaymentButton: {
    minHeight: 34,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  quickPaymentText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  paymentUpdateControls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  paymentUpdateButton: {
    minWidth: 96,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  paymentUpdateButtonText: {
    color: Colors.white,
    fontWeight: '600',
  },
  paymentHistoryBox: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  paymentHistoryTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  paymentHistoryRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  paymentHistoryInfo: {
    flex: 1,
  },
  paymentHistoryDate: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  paymentHistoryNote: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  paymentHistoryAmount: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  paymentHistoryEmpty: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  timelineBox: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  timelineTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  timelineRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  timelineBody: {
    flex: 1,
  },
  timelineEventTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  timelineDetail: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  timelineDate: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 110,
    textAlign: 'right',
  },
  statusButton: {
    flex: 1,
    minWidth: 92,
    minHeight: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  statusButtonDanger: {
    backgroundColor: '#FDECEA',
  },
  statusText: { color: Colors.primaryDark, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  statusTextDanger: { color: Colors.danger },
});
