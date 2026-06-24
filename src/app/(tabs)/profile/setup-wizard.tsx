import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import {
  defaultCompanySettings,
  getCompanySettings,
  saveCompanySettings,
  type CompanySettings,
} from '@/lib/company-settings';
import { saveLocalProduct } from '@/lib/local-product-overrides';
import { supabase } from '@/lib/supabase';
import {
  defaultSetupWizardState,
  getSetupWizardState,
  normalizeWizardBranches,
  saveSetupWizardState,
  setupDemoProducts,
} from '@/lib/setup-wizard';

export default function SetupWizardScreen() {
  const { session } = useAuth();
  const { branches, setBranches, setSelectedBranchId } = useBranch();
  const [company, setCompany] = useState<CompanySettings>(defaultCompanySettings);
  const [branchOne, setBranchOne] = useState('adiasports');
  const [branchTwo, setBranchTwo] = useState('Fitness Empire');
  const [categoriesText, setCategoriesText] = useState(defaultSetupWizardState.categories.join('\n'));
  const [staffText, setStaffText] = useState('');
  const [demoProductsEnabled, setDemoProductsEnabled] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [savedCompany, savedSetup, categoriesRes, staffRes] = await Promise.all([
          getCompanySettings(),
          getSetupWizardState(),
          supabase.from('product_categories').select('name').eq('active', true).order('name'),
          supabase.from('staff_invites').select('full_name,email,role,branch_id').order('created_at'),
        ]);
        if (!active) return;
        setCompany(savedCompany);
        const remoteCategories = categoriesRes.error ? [] : ((categoriesRes.data as { name: string }[]) ?? []);
        setCategoriesText((remoteCategories.length > 0 ? remoteCategories.map((item) => item.name) : savedSetup.categories).join('\n'));
        const remoteStaff = staffRes.error ? [] : ((staffRes.data as { full_name: string; email: string; role: string; branch_id: string | null }[]) ?? []);
        setStaffText(
          remoteStaff
            .map((staff) => `${staff.full_name} | ${staff.email} | ${staff.role} | ${staff.branch_id ?? ''}`)
            .join('\n')
        );
        setDemoProductsEnabled(savedSetup.demo_products_enabled);
        setCompleted(savedSetup.completed);
        setBranchOne(branches[0]?.name ?? 'adiasports');
        setBranchTwo(branches[1]?.name ?? 'Fitness Empire');
      })();
      return () => {
        active = false;
      };
    }, [branches])
  );

  const categories = useMemo(
    () =>
      categoriesText
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    [categoriesText]
  );
  const staffInvites = useMemo(
    () =>
      staffText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [fullName = '', email = '', role = 'cashier', branch = ''] = line
            .split('|')
            .map((part) => part.trim());
          const safeRole = role.toLowerCase() === 'manager' ? 'manager' : role.toLowerCase() === 'owner' ? 'owner' : 'cashier';
          return { fullName, email: email.toLowerCase(), role: safeRole, branch };
        })
        .filter((staff) => staff.fullName && staff.email),
    [staffText]
  );

  const updateCompany = (key: keyof CompanySettings, value: string) => {
    setCompany((current) => ({ ...current, [key]: value }));
  };

  const productId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      const next = char === 'x' ? value : (value & 0x3) | 0x8;
      return next.toString(16);
    });
  };

  const saveDemoProducts = async (nextBranches: { id: string; name: string }[]) => {
    const createdAt = new Date().toISOString();
    const createdBy = session?.user.id ?? null;
    for (const branch of nextBranches) {
      for (const [index, product] of setupDemoProducts.entries()) {
        const quantity = Math.max(0, product.quantity - index);
        const localProduct = {
          id: `setup-${branch.id}-${product.sku}`,
          branch_id: branch.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          category: product.category ?? null,
          variant_size: null,
          variant_color: null,
          variant_weight: null,
          warranty_months: product.warranty_months ?? null,
          quantity,
          reorder_level: product.reorder_level,
          cost_price: product.cost_price ?? null,
          unit_price: product.unit_price ?? null,
          created_by: createdBy,
          created_at: createdAt,
        };
        saveLocalProduct(localProduct);

        const { data: existing, error: lookupError } = await supabase
          .from('products')
          .select('id')
          .eq('branch_id', branch.id)
          .eq('sku', product.sku)
          .maybeSingle();
        if (lookupError) throw lookupError;

        const payload = {
          branch_id: branch.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          category: product.category ?? null,
          variant_size: null,
          variant_color: null,
          variant_weight: null,
          warranty_months: product.warranty_months ?? null,
          quantity,
          reorder_level: product.reorder_level,
          cost_price: product.cost_price ?? null,
          unit_price: product.unit_price ?? null,
          created_by: createdBy,
        };
        const result = existing
          ? await supabase.from('products').update(payload).eq('id', existing.id)
          : await supabase.from('products').insert({ id: productId(), ...payload });
        if (result.error) throw result.error;
      }
    }
  };

  const saveSupabaseOnboarding = async (nextBranches: { id: string; name: string }[]) => {
    const createdBy = session?.user.id ?? null;
    const branchResult = await supabase.from('branches').upsert(nextBranches.map((branch) => ({ id: branch.id, name: branch.name })));
    if (branchResult.error) throw branchResult.error;

    if (categories.length > 0) {
      const categoryResult = await supabase.from('product_categories').upsert(
        categories.map((name) => ({
          name,
          active: true,
          created_by: createdBy,
        })),
        { onConflict: 'name' }
      );
      if (categoryResult.error) throw categoryResult.error;
    }

    for (const staff of staffInvites) {
      const branch = nextBranches.find(
        (item) =>
          item.id.toLowerCase() === staff.branch.toLowerCase() ||
          item.name.toLowerCase() === staff.branch.toLowerCase()
      );
      const payload = {
        full_name: staff.fullName,
        email: staff.email,
        role: staff.role,
        branch_id: branch?.id ?? nextBranches[0]?.id ?? null,
        status: 'pending',
        note: 'Created from Setup Wizard',
        created_by: createdBy,
      };
      const { data: existing, error: lookupError } = await supabase
        .from('staff_invites')
        .select('id')
        .eq('email', staff.email)
        .maybeSingle();
      if (lookupError) throw lookupError;
      const result = existing
        ? await supabase.from('staff_invites').update(payload).eq('id', existing.id)
        : await supabase.from('staff_invites').insert(payload);
      if (result.error) throw result.error;
    }
  };

  const onComplete = async () => {
    const nextBranches = normalizeWizardBranches(branchOne, branchTwo);
    if (!company.name.trim()) {
      Alert.alert('Setup Wizard', 'Jaza jina la kampuni kwanza.');
      return;
    }
    if (nextBranches.length < 1) {
      Alert.alert('Setup Wizard', 'Jaza angalau branch moja.');
      return;
    }
    if (categories.length === 0) {
      Alert.alert('Setup Wizard', 'Jaza angalau category moja.');
      return;
    }

    setSaving(true);
    setSyncNotice(null);
    try {
      await saveCompanySettings({
        ...company,
        logoText: company.logoText.trim().slice(0, 4) || company.name.trim().slice(0, 2).toUpperCase(),
        currency: company.currency.trim() || 'TZS',
      });
      await saveSupabaseOnboarding(nextBranches);
      setBranches(nextBranches);
      setSelectedBranchId(nextBranches[0].id);
      if (demoProductsEnabled) await saveDemoProducts(nextBranches);
      await saveSetupWizardState({
        completed: true,
        completed_at: new Date().toISOString(),
        demo_products_enabled: demoProductsEnabled,
        categories,
      });
      setCompleted(true);
      setSyncNotice('Supabase imehifadhi kampuni, branches, categories, staff invites na demo products.');
      Alert.alert('Setup Wizard', 'Setup imekamilika na imehifadhiwa Supabase.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Imeshindikana ku-save Supabase.';
      setSyncNotice(`Haijakamilika: ${message}`);
      Alert.alert('Setup Wizard', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroTitle}>Setup Wizard</Text>
            <Text style={[styles.statusPill, completed && styles.statusPillDone]}>
              {completed ? 'Completed' : 'Not complete'}
            </Text>
          </View>
          <Text style={styles.heroText}>
            Jaza taarifa muhimu mara moja: kampuni, branches, categories, users, demo products na receipt.
          </Text>
          {syncNotice ? <Text style={styles.syncNotice}>{syncNotice}</Text> : null}
        </View>

        <WizardSection title="1. Kampuni na receipt" subtitle="Hizi zitatumika kwenye receipt, invoice na reports.">
          <TextField label="Jina la kampuni *" value={company.name} onChangeText={(value) => updateCompany('name', value)} />
          <TextField label="Logo initials" value={company.logoText} onChangeText={(value) => updateCompany('logoText', value)} />
          <TextField label="Tagline" value={company.tagline} onChangeText={(value) => updateCompany('tagline', value)} />
          <TextField label="Location" value={company.location} onChangeText={(value) => updateCompany('location', value)} />
          <TextField label="Phones" value={company.phonesText} onChangeText={(value) => updateCompany('phonesText', value)} multiline />
          <TextField label="TIN / VRN" value={company.tax} onChangeText={(value) => updateCompany('tax', value)} multiline />
          <TextField label="Receipt footer" value={company.receiptFooter} onChangeText={(value) => updateCompany('receiptFooter', value)} multiline />
        </WizardSection>

        <WizardSection title="2. Branches" subtitle="Mfano: adiasports na Fitness Empire.">
          <TextField label="Branch 1" value={branchOne} onChangeText={setBranchOne} />
          <TextField label="Branch 2" value={branchTwo} onChangeText={setBranchTwo} />
        </WizardSection>

        <WizardSection title="3. Categories" subtitle="Andika category moja kwa line au tumia comma.">
          <TextField label="Categories" value={categoriesText} onChangeText={setCategoriesText} multiline />
          <View style={styles.categoryPreview}>
            {categories.map((category) => (
              <Text key={category} style={styles.categoryChip}>{category}</Text>
            ))}
          </View>
        </WizardSection>

        <WizardSection title="4. Demo products" subtitle="Zinafaa kwa preview/testing. Unaweza kuzima kwa matumizi halisi.">
          <Pressable
            style={[styles.toggleRow, demoProductsEnabled && styles.toggleRowActive]}
            onPress={() => setDemoProductsEnabled((current) => !current)}>
            <View>
              <Text style={styles.toggleTitle}>Demo fitness products</Text>
              <Text style={styles.toggleMeta}>
                {demoProductsEnabled ? `${setupDemoProducts.length} products zitawekwa kwenye kila branch` : 'Demo products zimezimwa'}
              </Text>
            </View>
            <Text style={[styles.toggleBadge, demoProductsEnabled && styles.toggleBadgeActive]}>
              {demoProductsEnabled ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
        </WizardSection>

        <WizardSection
          title="5. Users na permissions"
          subtitle="Andika staff kwa format: Jina | email | role | branch. Mfano: Asha Said | asha@email.com | cashier | adiasports">
          <TextField
            label="Staff invites / setup list"
            value={staffText}
            onChangeText={setStaffText}
            multiline
            placeholder="Asha Said | asha@email.com | cashier | adiasports"
            autoCapitalize="none"
          />
          <View style={styles.categoryPreview}>
            {staffInvites.map((staff) => (
              <Text key={staff.email} style={styles.categoryChip}>
                {staff.fullName} · {staff.role}
              </Text>
            ))}
          </View>
          <Pressable style={styles.secondaryAction} onPress={() => router.push('/(tabs)/profile/users' as Href)}>
            <Text style={styles.secondaryActionText}>Fungua User Management</Text>
          </Pressable>
        </WizardSection>

        <Button label="Complete Setup" onPress={onComplete} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function WizardSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 120 },
  hero: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  heroTitle: { color: Colors.text, fontSize: 24, fontWeight: '600' },
  heroText: { color: Colors.textMuted, fontSize: 13, lineHeight: 19, fontWeight: '400' },
  syncNotice: {
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  statusPill: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: '#FFF5F5',
    color: Colors.danger,
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  statusPillDone: { backgroundColor: Colors.primarySoft, color: Colors.primaryDark },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: { color: Colors.text, fontSize: 17, fontWeight: '600' },
  sectionSubtitle: { color: Colors.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '400', marginTop: 3 },
  sectionBody: { marginTop: Spacing.md },
  categoryPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: -Spacing.sm },
  categoryChip: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  toggleRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    padding: Spacing.md,
  },
  toggleRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  toggleTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  toggleMeta: { color: Colors.textMuted, fontSize: 12, fontWeight: '400', marginTop: 3 },
  toggleBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  toggleBadgeActive: { backgroundColor: Colors.primary, color: Colors.white },
  secondaryAction: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: { color: Colors.primaryDark, fontSize: 13, fontWeight: '600' },
});
