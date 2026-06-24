import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useBranch } from '@/lib/branch-context';
import { defaultCompanySettings, getCompanySettings, splitLines, type CompanySettings } from '@/lib/company-settings';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { buildProfessionalShareMessage } from '@/lib/share-templates';
import { supabase } from '@/lib/supabase';
import type { Sale } from '@/types/database';

function saleTotal(sale: Sale) {
  return sale.quantity * sale.unit_price;
}

function paymentMethodLabel(method: Sale['payment_method']) {
  if (method === 'mpesa') return 'M-Pesa';
  if (method === 'bank') return 'Bank';
  if (method === 'credit') return 'Credit';
  return 'Cash';
}

function saleNumber(sale: Sale) {
  return sale.sale_number ?? sale.id.slice(0, 8).toUpperCase();
}

function saleBatchId(sale: Sale) {
  return sale.client_sale_id?.replace(/-line-\d+$/, '') ?? null;
}

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { branches } = useBranch();
  const [sales, setSales] = useState<Sale[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings>(defaultCompanySettings);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const savedSettings = await getCompanySettings();
      setCompanySettings(savedSettings);
      if (!id) {
        setError('Hakuna receipt iliyochaguliwa.');
        return;
      }
      const { data, error: saleError } = await supabase
        .from('sales')
        .select('*, products(id,name,unit,sku,cost_price,warranty_months)')
        .eq('id', id)
        .single();

      if (saleError) {
        setError(saleError.message);
        return;
      }
      const firstSale = data as unknown as Sale;
      const batchId = saleBatchId(firstSale);
      if (!batchId) {
        setSales([firstSale]);
        return;
      }

      const { data: batchData, error: batchError } = await supabase
        .from('sales')
        .select('*, products(id,name,unit,sku,cost_price,warranty_months)')
        .like('client_sale_id', `${batchId}-line-%`)
        .order('client_sale_id', { ascending: true });

      if (batchError || !batchData?.length) {
        setSales([firstSale]);
        return;
      }
      setSales(batchData as unknown as Sale[]);
    })();
  }, [id]);

  const sale = sales[0] ?? null;
  const receiptTotal = sales.reduce((sum, row) => sum + saleTotal(row), 0);
  const receiptPaid = sales.reduce((sum, row) => sum + row.amount_paid, 0);
  const receiptBalance = Math.max(receiptTotal - receiptPaid, 0);
  const receiptNumber = sale ? saleNumber(sale) : '';

  const receiptText = useMemo(() => {
    if (!sale) return '';
    const branchName = branches.find((branch) => branch.id === sale.branch_id)?.name ?? 'Duka Langu';
    return buildProfessionalShareMessage({
      company: companySettings,
      branchName,
      documentTitle: 'Receipt / Invoice',
      documentNumber: receiptNumber,
      createdAt: sale.created_at,
      customerName: sale.customer_name ?? 'Walk-in',
      items: sales.map((row) => ({
        description: row.products?.name ?? 'Bidhaa',
        quantity: row.quantity,
        unit: row.products?.unit,
        unitPrice: row.unit_price,
        lineTotal: saleTotal(row),
        meta: row.products?.warranty_months ? `Warranty: ${row.products.warranty_months} months` : null,
      })),
      totals: [
        { label: 'Total', value: receiptTotal, emphasize: true },
        { label: 'Paid', value: receiptPaid },
        { label: 'Balance', value: receiptBalance, emphasize: true },
      ],
      paymentMethod: paymentMethodLabel(sale.payment_method),
      paymentStatus: sale.payment_status,
      note: sale.note,
    });
  }, [branches, companySettings, receiptBalance, receiptNumber, receiptPaid, receiptTotal, sale, sales]);

  const shareReceipt = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(`https://wa.me/?text=${encodeURIComponent(receiptText)}`, '_blank');
      return;
    }
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(receiptText);
      Alert.alert('Receipt', 'Receipt ime-copy. Unaweza ku-paste WhatsApp.');
      return;
    }
    await Share.share({ message: receiptText });
  };

  const printReceipt = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.print();
      return;
    }
    Alert.alert('Print', 'Print inapatikana kwenye web preview kwa sasa.');
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sale ? (
          <>
            <View style={styles.receiptCard}>
              <View style={styles.logoMark}>
                <Text style={styles.logoText}>{companySettings.logoText}</Text>
              </View>
              <Text style={styles.shopName}>{companySettings.name}</Text>
              <Text style={styles.companyMeta}>{companySettings.tagline}</Text>
              <Text style={styles.companyMeta}>{companySettings.location}</Text>
              <Text style={styles.companyMeta}>{splitLines(companySettings.phonesText).join(' / ')}</Text>
              <Text style={styles.companyMeta}>{companySettings.tax}</Text>
              <Text style={styles.heading}>RECEIPT / INVOICE</Text>
              <ReceiptLine label="Receipt No" value={receiptNumber} strong />
              <ReceiptLine
                label="Branch"
                value={branches.find((branch) => branch.id === sale.branch_id)?.name ?? 'Duka Langu'}
              />
              <ReceiptLine label="Date" value={formatDateTime(sale.created_at)} />
              <ReceiptLine label="Customer" value={sale.customer_name ?? 'Walk-in'} />
              <View style={styles.divider} />
              {sales.map((row) => (
                <View key={row.id} style={styles.itemBlock}>
                  <ReceiptLine label="Item" value={row.products?.name ?? 'Bidhaa'} />
                  <ReceiptLine label="Qty" value={`${formatQuantity(row.quantity)} ${row.products?.unit ?? ''}`} />
                  <ReceiptLine label="Price" value={`${companySettings.currency} ${formatMoney(row.unit_price)}`} />
                  <ReceiptLine label="Line" value={`${companySettings.currency} ${formatMoney(saleTotal(row))}`} />
                  {row.products?.warranty_months ? (
                    <ReceiptLine label="Warranty" value={`${row.products.warranty_months} months`} />
                  ) : null}
                </View>
              ))}
              <View style={styles.divider} />
              <ReceiptLine label="Total" value={`${companySettings.currency} ${formatMoney(receiptTotal)}`} strong />
              <ReceiptLine label="Payment" value={paymentMethodLabel(sale.payment_method)} />
              <ReceiptLine label="Paid" value={`${companySettings.currency} ${formatMoney(receiptPaid)}`} />
              <ReceiptLine label="Balance" value={`${companySettings.currency} ${formatMoney(receiptBalance)}`} strong />
              <View style={styles.divider} />
              <Text style={styles.thanks}>{companySettings.receiptFooter}</Text>
            </View>
            <View style={styles.actions}>
              <Button label="Share WhatsApp Text" onPress={shareReceipt} />
              <Pressable style={styles.printButton} onPress={printReceipt}>
                <Text style={styles.printText}>Print / Save PDF</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={styles.loadingText}>Inapakia receipt...</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

function ReceiptLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: Spacing.lg, paddingBottom: 120 },
  receiptCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  logoMark: {
    width: 54,
    height: 54,
    borderRadius: 15,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  logoText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '600',
  },
  shopName: { color: Colors.primaryDark, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  companyMeta: { color: Colors.textMuted, fontSize: 11, fontWeight: '400', textAlign: 'center' },
  heading: { color: Colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: Spacing.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  label: { color: Colors.textMuted, fontWeight: '500' },
  value: { flex: 1, color: Colors.text, fontWeight: '600', textAlign: 'right' },
  strong: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  itemBlock: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  thanks: { color: Colors.textMuted, fontWeight: '600', textAlign: 'center' },
  actions: { gap: Spacing.md, marginTop: Spacing.lg },
  printButton: {
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printText: { color: Colors.primary, fontWeight: '600' },
  error: { color: Colors.danger, textAlign: 'center' },
  loadingText: { color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.xl },
});
