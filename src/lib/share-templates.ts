import { splitLines, type CompanySettings } from '@/lib/company-settings';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';

export type ProfessionalShareItem = {
  description: string;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  meta?: string | null;
};

export type ProfessionalShareTotal = {
  label: string;
  value: number | string;
  emphasize?: boolean;
};

export function normalizeWhatsAppPhone(contact?: string | null) {
  const digits = (contact ?? '').replace(/\D/g, '');
  if (digits.length < 9) return '';
  if (digits.startsWith('255')) return digits;
  if (digits.startsWith('0')) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function formatCurrency(company: CompanySettings, value: number) {
  return `${company.currency} ${formatMoney(value)}`;
}

function lineSeparator() {
  return '--------------------------------';
}

export function buildProfessionalShareMessage({
  company,
  branchName,
  documentTitle,
  documentNumber,
  createdAt,
  customerName,
  customerContact,
  items,
  totals,
  paymentStatus,
  paymentMethod,
  note,
  paymentInstruction,
  footer,
}: {
  company: CompanySettings;
  branchName: string;
  documentTitle: string;
  documentNumber: string;
  createdAt: string;
  customerName?: string | null;
  customerContact?: string | null;
  items: ProfessionalShareItem[];
  totals: ProfessionalShareTotal[];
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  note?: string | null;
  paymentInstruction?: string | null;
  footer?: string | null;
}) {
  const phones = splitLines(company.phonesText).join(' / ');
  const itemLines =
    items.length > 0
      ? items.flatMap((item, index) => {
          const quantity =
            typeof item.quantity === 'number'
              ? `${formatQuantity(item.quantity)}${item.unit ? ` ${item.unit}` : ''}`
              : null;
          const price =
            typeof item.unitPrice === 'number' ? ` @ ${formatCurrency(company, item.unitPrice)}` : '';
          const total =
            typeof item.lineTotal === 'number' ? ` = ${formatCurrency(company, item.lineTotal)}` : '';
          return [
            `${index + 1}. ${item.description}`,
            quantity || price || total ? `   ${[quantity, `${price}${total}`.trim()].filter(Boolean).join(' ')}` : null,
            item.meta ? `   ${item.meta}` : null,
          ].filter(Boolean) as string[];
        })
      : ['Hakuna item kwenye document hii.'];

  return [
    company.name.toUpperCase(),
    company.tagline,
    company.location,
    phones ? `Phone: ${phones}` : null,
    company.email ? `Email: ${company.email}` : null,
    company.tax,
    lineSeparator(),
    documentTitle.toUpperCase(),
    `No: ${documentNumber}`,
    `Branch: ${branchName}`,
    `Date: ${formatDateTime(createdAt)}`,
    customerName ? `Customer: ${customerName}` : null,
    customerContact ? `Contact: ${customerContact}` : null,
    lineSeparator(),
    'ITEMS',
    ...itemLines,
    lineSeparator(),
    ...totals.map((total) => {
      const value = typeof total.value === 'number' ? formatCurrency(company, total.value) : total.value;
      return `${total.emphasize ? '* ' : ''}${total.label}: ${value}${total.emphasize ? ' *' : ''}`;
    }),
    paymentMethod ? `Payment method: ${paymentMethod}` : null,
    paymentStatus ? `Payment status: ${paymentStatus}` : null,
    note ? `Note: ${note}` : null,
    paymentInstruction ? [lineSeparator(), 'PAYMENT INSTRUCTION', paymentInstruction].join('\n') : null,
    lineSeparator(),
    footer ?? company.receiptFooter,
  ]
    .filter(Boolean)
    .join('\n');
}
