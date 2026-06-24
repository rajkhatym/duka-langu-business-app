import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { StatCard } from '@/components/stat-card';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { defaultCompanySettings, getCompanySettings, splitLines, type CompanySettings } from '@/lib/company-settings';
import { formatDateTime, formatMoney } from '@/lib/format';
import { buildProfessionalShareMessage } from '@/lib/share-templates';
import { supabase } from '@/lib/supabase';
import type { Debt, Purchase, WingaCustomer } from '@/types/database';

type LedgerTab = 'customers' | 'suppliers';
type LedgerRow = { name: string; balance: number; count: number; contact?: string | null; note?: string | null; registered?: boolean };
type AgingBuckets = { current: number; days8to30: number; days31to60: number; days60plus: number };

function daysSince(date: string) {
  return Math.max(0, Math.floor((new Date().getTime() - new Date(date).getTime()) / 86400000));
}

function normalizeWhatsAppPhone(phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('255')) return digits;
  if (digits.startsWith('0')) return `255${digits.slice(1)}`;
  return digits;
}

function groupBalances<T>(
  rows: T[],
  getName: (row: T) => string,
  getBalance: (row: T) => number
): LedgerRow[] {
  const map = new Map<string, LedgerRow>();
  rows.forEach((row) => {
    const name = getName(row);
    const balance = getBalance(row);
    if (balance <= 0) return;
    const current = map.get(name) ?? { name, balance: 0, count: 0 };
    current.balance += balance;
    current.count += 1;
    map.set(name, current);
  });
  return [...map.values()].sort((a, b) => b.balance - a.balance);
}

function agingBuckets<T>(rows: T[], getDate: (row: T) => string, getBalance: (row: T) => number): AgingBuckets {
  const today = new Date();
  return rows.reduce<AgingBuckets>(
    (acc, row) => {
      const balance = getBalance(row);
      if (balance <= 0) return acc;
      const days = Math.max(0, Math.floor((today.getTime() - new Date(getDate(row)).getTime()) / 86400000));
      if (days <= 7) acc.current += balance;
      else if (days <= 30) acc.days8to30 += balance;
      else if (days <= 60) acc.days31to60 += balance;
      else acc.days60plus += balance;
      return acc;
    },
    { current: 0, days8to30: 0, days31to60: 0, days60plus: 0 }
  );
}

export default function LedgersScreen() {
  const { session } = useAuth();
  const { branches, selectedBranchId } = useBranch();
  const [tab, setTab] = useState<LedgerTab>('customers');
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [mawinga, setMawinga] = useState<WingaCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [wingaName, setWingaName] = useState('');
  const [wingaContact, setWingaContact] = useState('');
  const [wingaNote, setWingaNote] = useState('');
  const [savingWinga, setSavingWinga] = useState(false);
  const [wingaMessage, setWingaMessage] = useState<string | null>(null);
  const [wingaTableError, setWingaTableError] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings>(defaultCompanySettings);

  useEffect(() => {
    getCompanySettings().then(setCompanySettings);
  }, []);

  const load = useCallback(async () => {
    const [debtsRes, purchasesRes, mawingaRes] = await Promise.all([
      supabase.from('debts').select('*').eq('branch_id', selectedBranchId).neq('status', 'paid'),
      supabase.from('purchases').select('*, products(id,name,unit,sku)').eq('branch_id', selectedBranchId),
      supabase
        .from('mawinga')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
    ]);
    setDebts((debtsRes.data as Debt[]) ?? []);
    if (mawingaRes.error) {
      setMawinga([]);
      setWingaTableError(
        mawingaRes.error.message.includes('mawinga')
          ? 'Run SQL ya mawinga ili usajili ufanye kazi online.'
          : mawingaRes.error.message
      );
    } else {
      setMawinga((mawingaRes.data as WingaCustomer[]) ?? []);
      setWingaTableError(null);
    }
    if (purchasesRes.error) {
      setPurchases([]);
      setSupplierError(
        purchasesRes.error.message.includes('purchases')
          ? 'Run SQL ya purchases ili Supplier Ledger ifanye kazi.'
          : purchasesRes.error.message
      );
    } else {
      setSupplierError(null);
      setPurchases((purchasesRes.data as unknown as Purchase[]) ?? []);
    }
  }, [selectedBranchId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        await load();
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  const customerRows = useMemo(() => {
    const balanceRows = groupBalances(
      debts,
      (debt) => debt.customer_name,
      (debt) => Math.max(debt.amount - debt.amount_paid, 0)
    );
    const map = new Map<string, LedgerRow>();
    balanceRows.forEach((row) => map.set(row.name.toLowerCase(), row));
    mawinga.forEach((winga) => {
      const key = winga.name.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        map.set(key, { ...existing, contact: winga.contact, note: winga.note, registered: true });
        return;
      }
      map.set(key, {
        name: winga.name,
        balance: 0,
        count: 0,
        contact: winga.contact,
        note: winga.note,
        registered: true,
      });
    });
    return [...map.values()].sort((a, b) => {
      if (b.balance !== a.balance) return b.balance - a.balance;
      return a.name.localeCompare(b.name);
    });
  }, [debts, mawinga]);
  const supplierRows = useMemo(
    () =>
      groupBalances(
        purchases,
        (purchase) => purchase.supplier_name,
        (purchase) => Math.max(purchase.quantity * purchase.cost_price - purchase.amount_paid, 0)
      ),
    [purchases]
  );
  const customerAging = useMemo(
    () => agingBuckets(debts, (debt) => debt.created_at, (debt) => Math.max(debt.amount - debt.amount_paid, 0)),
    [debts]
  );
  const supplierAging = useMemo(
    () =>
      agingBuckets(
        purchases,
        (purchase) => purchase.created_at,
        (purchase) => Math.max(purchase.quantity * purchase.cost_price - purchase.amount_paid, 0)
      ),
    [purchases]
  );
  const activeAging = tab === 'customers' ? customerAging : supplierAging;
  const rows = (tab === 'customers' ? customerRows : supplierRows).filter((row) =>
    row.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const total = rows.reduce((sum, row) => sum + row.balance, 0);
  const branchName = branches.find((branch) => branch.id === selectedBranchId)?.name ?? 'Branch';
  const selectedCustomerDebts = selectedName
    ? debts
        .filter((debt) => debt.customer_name === selectedName && Math.max(debt.amount - debt.amount_paid, 0) > 0)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : [];
  const selectedSupplierPurchases = selectedName
    ? purchases
        .filter(
          (purchase) =>
            purchase.supplier_name === selectedName &&
            Math.max(purchase.quantity * purchase.cost_price - purchase.amount_paid, 0) > 0
        )
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : [];
  const selectedCustomerContact =
    tab === 'customers' && selectedName
      ? (customerRows.find((row) => row.name === selectedName)?.contact ?? null)
      : null;
  const selectedBalance =
    tab === 'customers'
      ? selectedCustomerDebts.reduce((sum, debt) => sum + Math.max(debt.amount - debt.amount_paid, 0), 0)
      : selectedSupplierPurchases.reduce(
          (sum, purchase) => sum + Math.max(purchase.quantity * purchase.cost_price - purchase.amount_paid, 0),
          0
        );
  const selectedOldestDays =
    tab === 'customers'
      ? selectedCustomerDebts.reduce((max, debt) => Math.max(max, daysSince(debt.created_at)), 0)
      : selectedSupplierPurchases.reduce((max, purchase) => Math.max(max, daysSince(purchase.created_at)), 0);
  const ledgerReminderText = selectedName
    ? tab === 'customers'
      ? buildProfessionalShareMessage({
          company: companySettings,
          branchName,
          documentTitle: 'AI Debt Follow-up Reminder',
          documentNumber: `REM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${selectedName
            .slice(0, 3)
            .toUpperCase()}`,
          createdAt: new Date().toISOString(),
          customerName: selectedName,
          customerContact: selectedCustomerContact,
          items:
            selectedCustomerDebts.length > 0
              ? selectedCustomerDebts.map((debt) => {
                  const balance = Math.max(debt.amount - debt.amount_paid, 0);
                  return {
                    description: debt.description ?? 'Mzigo uliopo kwenye ledger',
                    lineTotal: balance,
                    meta: `Paid Tsh ${formatMoney(debt.amount_paid)} · Open ${daysSince(debt.created_at)} day(s) · Due ${
                      debt.due_date ?? 'haijawekwa'
                    }`,
                  };
                })
              : [{ description: 'Hakuna balance wazi kwa sasa.' }],
          totals: [{ label: 'Balance inayodaiwa', value: selectedBalance, emphasize: true }],
          paymentStatus: selectedBalance > 0 ? 'Open' : 'Cleared',
          note:
            selectedOldestDays >= 14
              ? `AI Follow-up: balance ya zamani zaidi imekaa siku ${selectedOldestDays}.`
              : selectedOldestDays > 0
                ? `AI Follow-up: balance ya zamani zaidi ina siku ${selectedOldestDays}.`
                : 'AI Follow-up: reminder ya kulipa balance ya mzigo.',
          paymentInstruction: splitLines(companySettings.bankText).join('\n'),
          footer: `Habari ${selectedName}, tafadhali tuma malipo au mpango wa kulipa ili ledger yako ibaki clear. Asante, ${companySettings.name}.`,
        })
      : [
          `Habari ${selectedName},`,
          `Kumbusho la malipo yetu kwako ${branchName}: Tsh ${formatMoney(selectedBalance)}.`,
          selectedOldestDays > 0 ? `Balance ya zamani zaidi ina siku ${selectedOldestDays}.` : null,
          'Tafadhali tuwasiliane kuhusu ratiba ya payment.',
          `Asante, ${companySettings.name}.`,
        ]
          .filter(Boolean)
          .join('\n')
    : '';

  const switchTab = (nextTab: LedgerTab) => {
    setTab(nextTab);
    setSelectedName(null);
    setSearch('');
    setPaymentAmount('');
    setPaymentMessage(null);
  };

  const registerWinga = async () => {
    const name = wingaName.trim();
    if (name.length < 2) {
      setWingaMessage('Jaza jina la winga.');
      return;
    }
    const exists = customerRows.some((row) => row.name.trim().toLowerCase() === name.toLowerCase());
    if (exists) {
      setWingaMessage('Winga huyu tayari yupo kwenye list.');
      return;
    }

    setSavingWinga(true);
    setWingaMessage(null);
    const { error } = await supabase.from('mawinga').insert({
      branch_id: selectedBranchId,
      name,
      contact: wingaContact.trim() || null,
      note: wingaNote.trim() || null,
      status: 'active',
      created_by: session?.user.id ?? null,
    });

    if (error) {
      setSavingWinga(false);
      setWingaMessage(
        error.message.includes('mawinga')
          ? 'Table ya mawinga haijawashwa. Run SQL ya mawinga kwanza.'
          : error.message
      );
      return;
    }

    setWingaName('');
    setWingaContact('');
    setWingaNote('');
    await load();
    setSavingWinga(false);
    setWingaMessage('Winga amesajiliwa.');
  };

  const recordCustomerPayment = async () => {
    if (!selectedName || selectedCustomerDebts.length === 0) return;
    const amount = Number(paymentAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setPaymentMessage('Weka kiasi cha malipo kilicho sahihi.');
      return;
    }

    setSavingPayment(true);
    setPaymentMessage(null);
    let remaining = amount;
    for (const debt of selectedCustomerDebts) {
      if (remaining <= 0) break;
      const balance = Math.max(debt.amount - debt.amount_paid, 0);
      const paidNow = Math.min(balance, remaining);
      const nextPaid = debt.amount_paid + paidNow;
      const nextStatus = nextPaid >= debt.amount ? 'paid' : nextPaid > 0 ? 'partial' : 'open';
      const { error } = await supabase
        .from('debts')
        .update({ amount_paid: nextPaid, status: nextStatus })
        .eq('id', debt.id);
      if (error) {
        setSavingPayment(false);
        setPaymentMessage(error.message);
        return;
      }
      remaining -= paidNow;
    }

    setPaymentAmount('');
    await load();
    setSavingPayment(false);
    setPaymentMessage(
      remaining > 0
        ? `Malipo yamehifadhiwa. Ziada Tsh ${formatMoney(remaining)} haikugawiwa kwa debt.`
        : 'Malipo yamehifadhiwa na balance imepungua.'
    );
  };

  const recordSupplierPayment = async () => {
    if (!selectedName || selectedSupplierPurchases.length === 0) return;
    const amount = Number(paymentAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setPaymentMessage('Weka kiasi cha malipo kilicho sahihi.');
      return;
    }

    setSavingPayment(true);
    setPaymentMessage(null);
    let remaining = amount;
    for (const purchase of selectedSupplierPurchases) {
      if (remaining <= 0) break;
      const total = purchase.quantity * purchase.cost_price;
      const balance = Math.max(total - purchase.amount_paid, 0);
      const paidNow = Math.min(balance, remaining);
      const nextPaid = purchase.amount_paid + paidNow;
      const nextStatus = nextPaid >= total ? 'paid' : nextPaid > 0 ? 'partial' : 'credit';
      const { error } = await supabase
        .from('purchases')
        .update({ amount_paid: nextPaid, payment_status: nextStatus })
        .eq('id', purchase.id);
      if (error) {
        setSavingPayment(false);
        setPaymentMessage(error.message);
        return;
      }
      remaining -= paidNow;
    }

    setPaymentAmount('');
    await load();
    setSavingPayment(false);
    setPaymentMessage(
      remaining > 0
        ? `Malipo ya supplier yamehifadhiwa. Ziada Tsh ${formatMoney(remaining)} haikugawiwa.`
        : 'Malipo ya supplier yamehifadhiwa na balance imepungua.'
    );
  };

  const recordLedgerPayment = tab === 'customers' ? recordCustomerPayment : recordSupplierPayment;

  const copyLedgerReminder = async () => {
    if (!ledgerReminderText) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(ledgerReminderText);
      Alert.alert('Ledger Reminder', 'Reminder ime-copy. Unaweza ku-paste WhatsApp/SMS.');
      return;
    }
    await Share.share({ message: ledgerReminderText });
  };

  const sendAiReminderWhatsApp = async () => {
    if (tab !== 'customers' || !selectedName || !ledgerReminderText) return;
    const phone = normalizeWhatsAppPhone(selectedCustomerContact);
    if (!phone) {
      Alert.alert('AI WhatsApp Reminder', 'Winga huyu hana namba ya simu. Ongeza contact kwanza.');
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(ledgerReminderText)}`;
    await Linking.openURL(url);
  };

  const sendWingaInvoiceWhatsApp = async () => {
    if (tab !== 'customers' || !selectedName) return;
    const phone = normalizeWhatsAppPhone(selectedCustomerContact);
    if (!phone) {
      Alert.alert('WhatsApp Invoice', 'Winga huyu hana namba ya simu. Ongeza contact kwanza.');
      return;
    }

    const message = buildProfessionalShareMessage({
      company: companySettings,
      branchName,
      documentTitle: 'Mawinga Statement',
      documentNumber: `MW-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${selectedName
        .slice(0, 3)
        .toUpperCase()}`,
      createdAt: new Date().toISOString(),
      customerName: selectedName,
      customerContact: selectedCustomerContact,
      items:
        selectedCustomerDebts.length > 0
          ? selectedCustomerDebts.map((debt) => {
              const balance = Math.max(debt.amount - debt.amount_paid, 0);
              return {
                description: debt.description ?? 'Mzigo',
                meta: `Balance: ${companySettings.currency} ${formatMoney(balance)} · ${formatDateTime(debt.created_at)}`,
              };
            })
          : [{ description: 'Hakuna balance wazi kwa sasa.' }],
      totals: [{ label: 'Jumla ya balance', value: selectedBalance, emphasize: true }],
      paymentStatus: selectedBalance > 0 ? 'Open' : 'Cleared',
      paymentInstruction: splitLines(companySettings.bankText).join('\n'),
      footer: 'Tafadhali tuma/leta malipo ili deni lipungue au kuclear. Asante.',
    });
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    await Linking.openURL(url);
  };

  const pageHeader = (
    <View style={styles.header}>
      <View style={styles.tabs}>
        <Text onPress={() => switchTab('customers')} style={[styles.tab, tab === 'customers' && styles.tabActive]}>
          Mawinga
        </Text>
        <Text onPress={() => switchTab('suppliers')} style={[styles.tab, tab === 'suppliers' && styles.tabActive]}>
          Suppliers
        </Text>
      </View>
      <StatCard
        label={tab === 'customers' ? 'Mawinga wanaodaiwa' : 'Supplier Debts'}
        value={`Tsh ${formatMoney(total)}`}
      />
      {tab === 'customers' ? (
        <View style={styles.mawingaInfoCard}>
          <Text style={styles.mawingaInfoTitle}>Mawinga</Text>
          <Text style={styles.mawingaInfoText}>
            Hawa ni watu waliochukua mzigo wakauze. Wakileta pesa, rekodi malipo hapa ili deni lao lipungue au
            kuclear kabisa.
          </Text>
        </View>
      ) : null}
      {tab === 'customers' ? (
        <View style={styles.registerCard}>
          <Text style={styles.registerTitle}>Sajili Winga</Text>
          <TextInput
            value={wingaName}
            onChangeText={setWingaName}
            placeholder="Jina la winga"
            placeholderTextColor={Colors.textMuted}
            style={styles.registerInput}
          />
          <TextInput
            value={wingaContact}
            onChangeText={setWingaContact}
            placeholder="Simu / contact"
            placeholderTextColor={Colors.textMuted}
            keyboardType="phone-pad"
            style={styles.registerInput}
          />
          <TextInput
            value={wingaNote}
            onChangeText={setWingaNote}
            placeholder="Maelezo mafupi"
            placeholderTextColor={Colors.textMuted}
            style={styles.registerInput}
          />
          <Pressable style={styles.registerButton} onPress={registerWinga} disabled={savingWinga}>
            <Text style={styles.registerButtonText}>{savingWinga ? 'Inasajili...' : 'Sajili Winga'}</Text>
          </Pressable>
          {wingaTableError ? <Text style={styles.registerWarning}>{wingaTableError}</Text> : null}
          {wingaMessage ? <Text style={styles.registerMessage}>{wingaMessage}</Text> : null}
        </View>
      ) : null}
      <View style={styles.agingPanel}>
        <Text style={styles.agingTitle}>{tab === 'customers' ? 'Mawinga Aging' : 'Supplier Aging'}</Text>
        <View style={styles.agingGrid}>
          <AgingPill label="0-7" amount={activeAging.current} />
          <AgingPill label="8-30" amount={activeAging.days8to30} />
          <AgingPill label="31-60" amount={activeAging.days31to60} danger={activeAging.days31to60 > 0} />
          <AgingPill label="60+" amount={activeAging.days60plus} danger={activeAging.days60plus > 0} />
        </View>
      </View>
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={tab === 'customers' ? 'Tafuta winga...' : 'Tafuta supplier...'}
          placeholderTextColor={Colors.textMuted}
          style={styles.searchInput}
        />
      </View>
    </View>
  );

  return (
    <Screen>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <LedgerItem
              item={item}
              active={selectedName === item.name}
              onPress={() => setSelectedName((current) => (current === item.name ? null : item.name))}
            />
          )}
          ListHeaderComponent={
            <>
              {pageHeader}
              {selectedName ? (
                <LedgerDetails
                  tab={tab}
                  name={selectedName}
                  debts={selectedCustomerDebts}
                  purchases={selectedSupplierPurchases}
                  paymentAmount={paymentAmount}
                  onPaymentAmountChange={setPaymentAmount}
                  onRecordPayment={recordLedgerPayment}
                  savingPayment={savingPayment}
                  paymentMessage={paymentMessage}
                  selectedBalance={selectedBalance}
                  selectedOldestDays={selectedOldestDays}
                  reminderText={ledgerReminderText}
                  onCopyReminder={copyLedgerReminder}
                  onSendWhatsAppReminder={sendAiReminderWhatsApp}
                  onSendWhatsAppInvoice={sendWingaInvoiceWhatsApp}
                  hasWhatsAppContact={Boolean(normalizeWhatsAppPhone(selectedCustomerContact))}
                />
              ) : null}
            </>
          }
          ListEmptyComponent={
            <EmptyState
              title={tab === 'suppliers' && supplierError ? 'Supplier Ledger haijawashwa' : 'Hakuna balance wazi'}
              subtitle={tab === 'suppliers' ? supplierError ?? undefined : undefined}
            />
          }
        />
      )}
    </Screen>
  );
}

function AgingPill({ label, amount, danger = false }: { label: string; amount: number; danger?: boolean }) {
  return (
    <View style={[styles.agingPill, danger && styles.agingPillDanger]}>
      <Text style={[styles.agingPillLabel, danger && styles.agingPillLabelDanger]}>{label}</Text>
      <Text style={[styles.agingPillValue, danger && styles.agingPillLabelDanger]}>Tsh {formatMoney(amount)}</Text>
    </View>
  );
}

function LedgerDetails({
  tab,
  name,
  debts,
  purchases,
  paymentAmount,
  onPaymentAmountChange,
  onRecordPayment,
  savingPayment,
  paymentMessage,
  selectedBalance,
  selectedOldestDays,
  reminderText,
  onCopyReminder,
  onSendWhatsAppReminder,
  onSendWhatsAppInvoice,
  hasWhatsAppContact,
}: {
  tab: LedgerTab;
  name: string;
  debts: Debt[];
  purchases: Purchase[];
  paymentAmount: string;
  onPaymentAmountChange: (value: string) => void;
  onRecordPayment: () => void;
  savingPayment: boolean;
  paymentMessage: string | null;
  selectedBalance: number;
  selectedOldestDays: number;
  reminderText: string;
  onCopyReminder: () => void;
  onSendWhatsAppReminder: () => void;
  onSendWhatsAppInvoice: () => void;
  hasWhatsAppContact: boolean;
}) {
  const visibleDebts = debts.slice(0, 5);
  const visiblePurchases = purchases.slice(0, 5);

  return (
    <View style={styles.detailsCard}>
      <Text style={styles.detailsTitle}>{name}</Text>
      <Text style={styles.detailsSubtitle}>{tab === 'customers' ? 'Historia ya mzigo na malipo ya winga' : 'Supplier ledger history'}</Text>
      <View style={styles.reminderBox}>
        <View>
          <Text style={styles.reminderLabel}>Open balance</Text>
          <Text style={styles.reminderValue}>Tsh {formatMoney(selectedBalance)}</Text>
          <Text style={styles.reminderMeta}>Oldest: {selectedOldestDays} day(s)</Text>
        </View>
        <View style={styles.reminderActions}>
          <Pressable style={styles.reminderButton} onPress={onCopyReminder} disabled={selectedBalance <= 0}>
            <Text style={styles.reminderButtonText}>Copy AI Reminder</Text>
          </Pressable>
          {tab === 'customers' ? (
            <>
              <Pressable
                style={[styles.whatsAppButton, !hasWhatsAppContact && styles.whatsAppButtonDisabled]}
                onPress={onSendWhatsAppReminder}>
                <Text style={styles.whatsAppButtonText}>Debt WhatsApp</Text>
              </Pressable>
              <Pressable
                style={[styles.whatsAppButtonSecondary, !hasWhatsAppContact && styles.whatsAppButtonDisabled]}
                onPress={onSendWhatsAppInvoice}>
                <Text style={styles.whatsAppButtonSecondaryText}>WhatsApp Invoice</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
      {tab === 'customers' ? (
        <View style={styles.aiReminderPreview}>
          <Text style={styles.aiReminderPreviewTitle}>AI Debt Follow-up Message</Text>
          <Text style={styles.aiReminderPreviewText}>{reminderText}</Text>
        </View>
      ) : null}
      <View style={styles.paymentBox}>
        <TextInput
          value={paymentAmount}
          onChangeText={onPaymentAmountChange}
          placeholder={tab === 'customers' ? 'Kiasi alicholeta winga' : 'Kiasi ulichomlipa supplier'}
          placeholderTextColor={Colors.textMuted}
          keyboardType="numeric"
          style={styles.paymentInput}
        />
        <Pressable style={styles.paymentButton} onPress={onRecordPayment} disabled={savingPayment}>
          <Text style={styles.paymentButtonText}>
            {savingPayment ? 'Inahifadhi...' : tab === 'customers' ? 'Clear Deni la Winga' : 'Record Supplier Payment'}
          </Text>
        </Pressable>
        {paymentMessage ? <Text style={styles.paymentMessage}>{paymentMessage}</Text> : null}
      </View>
      {tab === 'customers' ? (
        visibleDebts.map((debt) => {
          const balance = Math.max(debt.amount - debt.amount_paid, 0);
          return (
            <View key={debt.id} style={styles.detailRow}>
              <View style={styles.detailInfo}>
                <Text style={styles.detailTitle}>{debt.description ?? 'Deni la mauzo'}</Text>
                <Text style={styles.detailMeta}>
                  Paid Tsh {formatMoney(debt.amount_paid)} · {formatDateTime(debt.created_at)}
                </Text>
              </View>
              <Text style={styles.detailBalance}>Tsh {formatMoney(balance)}</Text>
            </View>
          );
        })
      ) : (
        visiblePurchases.map((purchase) => {
          const total = purchase.quantity * purchase.cost_price;
          const balance = Math.max(total - purchase.amount_paid, 0);
          return (
            <View key={purchase.id} style={styles.detailRow}>
              <View style={styles.detailInfo}>
                <Text style={styles.detailTitle}>{purchase.products?.name ?? 'Purchase'}</Text>
                <Text style={styles.detailMeta}>
                  Paid Tsh {formatMoney(purchase.amount_paid)} · {formatDateTime(purchase.created_at)}
                </Text>
              </View>
              <Text style={styles.detailBalance}>Tsh {formatMoney(balance)}</Text>
            </View>
          );
        })
      )}
      {tab === 'customers' && debts.length > visibleDebts.length ? (
        <Text style={styles.moreHistoryText}>+{debts.length - visibleDebts.length} older/open record(s) zitatumika kwenye payment.</Text>
      ) : null}
      {tab === 'suppliers' && purchases.length > visiblePurchases.length ? (
        <Text style={styles.moreHistoryText}>
          +{purchases.length - visiblePurchases.length} older/open purchase(s) zitatumika kwenye payment.
        </Text>
      ) : null}
    </View>
  );
}

function LedgerItem({ item, active, onPress }: { item: LedgerRow; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.row, active && styles.rowActive]} onPress={onPress}>
      <View>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.meta}>
          {item.count > 0 ? `${item.count} transaction(s)` : 'Amesajiliwa, hana balance'} · tap kuona history
        </Text>
        {item.contact ? <Text style={styles.meta}>Contact: {item.contact}</Text> : null}
      </View>
      <Text style={styles.balance}>Tsh {formatMoney(item.balance)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.md },
  tabs: { flexDirection: 'row', gap: Spacing.sm },
  searchBox: {
    height: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  searchIcon: { color: Colors.textMuted, fontSize: 20 },
  searchInput: { flex: 1, height: '100%', color: Colors.text, fontWeight: '500' },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    color: Colors.textMuted,
    fontWeight: '600',
    overflow: 'hidden',
    padding: Spacing.md,
    textAlign: 'center',
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary, color: Colors.white },
  mawingaInfoCard: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  mawingaInfoTitle: { color: Colors.primaryDark, fontSize: 15, fontWeight: '600' },
  mawingaInfoText: { color: Colors.text, fontSize: 13, lineHeight: 19, fontWeight: '400' },
  registerCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  registerTitle: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  registerInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.background,
    color: Colors.text,
    paddingHorizontal: Spacing.md,
    fontWeight: '500',
  },
  registerButton: {
    minHeight: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  registerButtonText: { color: Colors.white, fontSize: 14, fontWeight: '600' },
  registerWarning: { color: Colors.warning, fontSize: 12, fontWeight: '400' },
  registerMessage: { color: Colors.primaryDark, fontSize: 12, fontWeight: '400' },
  agingPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  agingTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  agingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  agingPill: {
    flexGrow: 1,
    minWidth: '47%',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.background,
    padding: Spacing.sm,
  },
  agingPillDanger: { borderColor: '#F5C2C7', backgroundColor: '#FFF5F5' },
  agingPillLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '500' },
  agingPillLabelDanger: { color: Colors.danger },
  agingPillValue: { color: Colors.text, fontSize: 12, fontWeight: '600', marginTop: 2 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: Spacing.xxl },
  row: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  rowActive: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  name: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  meta: { color: Colors.textMuted, marginTop: Spacing.xs },
  balance: { color: Colors.warning, fontWeight: '600' },
  detailsCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  detailsTitle: { color: Colors.text, fontSize: 18, fontWeight: '400' },
  detailsSubtitle: { color: Colors.textMuted, fontWeight: '400' },
  reminderBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  reminderLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: '500' },
  reminderValue: { color: Colors.text, fontSize: 18, fontWeight: '600', marginTop: 2 },
  reminderMeta: { color: Colors.textMuted, fontSize: 12, fontWeight: '400', marginTop: 2 },
  reminderActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'flex-start',
    width: '100%',
  },
  reminderButton: {
    flexGrow: 1,
    minWidth: 132,
    minHeight: 38,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  reminderButtonText: { color: Colors.white, fontSize: 12, fontWeight: '600' },
  whatsAppButton: {
    flexGrow: 1,
    minWidth: 132,
    minHeight: 38,
    borderRadius: Radius.sm,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  whatsAppButtonDisabled: {
    backgroundColor: Colors.textMuted,
  },
  whatsAppButtonText: { color: Colors.white, fontSize: 12, fontWeight: '600' },
  whatsAppButtonSecondary: {
    flexGrow: 1,
    minWidth: 132,
    minHeight: 38,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  whatsAppButtonSecondaryText: { color: Colors.primaryDark, fontSize: 12, fontWeight: '600' },
  aiReminderPreview: {
    borderWidth: 1,
    borderColor: '#DCEBE4',
    borderRadius: Radius.md,
    backgroundColor: '#F7FFFB',
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  aiReminderPreviewTitle: { color: Colors.primaryDark, fontSize: 13, fontWeight: '600' },
  aiReminderPreviewText: { color: Colors.text, fontSize: 12, lineHeight: 18, fontWeight: '400' },
  paymentBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  paymentInput: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    color: Colors.text,
    paddingHorizontal: Spacing.md,
    fontWeight: '500',
  },
  paymentButton: {
    minHeight: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  paymentButtonText: { color: Colors.white, fontWeight: '600' },
  paymentMessage: { color: Colors.primaryDark, fontSize: 12, fontWeight: '400' },
  detailRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  detailInfo: { flex: 1 },
  detailTitle: { color: Colors.text, fontWeight: '600' },
  detailMeta: { color: Colors.textMuted, marginTop: 2, fontSize: 12, fontWeight: '400' },
  detailBalance: { color: Colors.warning, fontWeight: '600', textAlign: 'right' },
  moreHistoryText: { color: Colors.textMuted, fontSize: 12, fontWeight: '400' },
});
