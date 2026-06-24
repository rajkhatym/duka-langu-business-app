import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import {
  defaultCompanySettings,
  getCompanySettings,
  saveCompanySettings,
  type CompanySettings,
} from '@/lib/company-settings';

export default function CompanySettingsScreen() {
  const [settings, setSettings] = useState<CompanySettings>(defaultCompanySettings);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const saved = await getCompanySettings();
        if (active) setSettings(saved);
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const update = (key: keyof CompanySettings, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const onSave = async () => {
    if (!settings.name.trim()) {
      Alert.alert('Company Settings', 'Jina la kampuni linahitajika.');
      return;
    }
    setSaving(true);
    await saveCompanySettings({
      ...settings,
      logoText: settings.logoText.trim().slice(0, 4) || settings.name.trim().slice(0, 2).toUpperCase(),
      currency: settings.currency.trim() || 'TZS',
    });
    setSaving(false);
    Alert.alert('Company Settings', 'Taarifa za kampuni zimehifadhiwa.');
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.previewCard}>
          <View style={styles.logoMark}>
            <Text style={styles.logoText}>{settings.logoText || settings.name.slice(0, 2).toUpperCase()}</Text>
          </View>
          <View style={styles.previewInfo}>
            <Text style={styles.companyName}>{settings.name}</Text>
            <Text style={styles.companyMeta}>{settings.tagline}</Text>
            <Text style={styles.companyMeta}>{settings.location}</Text>
            <Text style={styles.companyMeta}>{settings.currency} · {settings.tax}</Text>
          </View>
        </View>

        <TextField label="Jina la kampuni *" value={settings.name} onChangeText={(value) => update('name', value)} />
        <TextField label="Logo initials" value={settings.logoText} onChangeText={(value) => update('logoText', value)} />
        <TextField label="Tagline" value={settings.tagline} onChangeText={(value) => update('tagline', value)} />
        <TextField label="Location / Address" value={settings.location} onChangeText={(value) => update('location', value)} />
        <TextField
          label="Phones"
          value={settings.phonesText}
          onChangeText={(value) => update('phonesText', value)}
          multiline
        />
        <TextField label="Email" value={settings.email} onChangeText={(value) => update('email', value)} />
        <TextField label="TIN / VRN / Tax" value={settings.tax} onChangeText={(value) => update('tax', value)} multiline />
        <TextField label="Currency" value={settings.currency} onChangeText={(value) => update('currency', value)} />
        <TextField
          label="Receipt footer"
          value={settings.receiptFooter}
          onChangeText={(value) => update('receiptFooter', value)}
          multiline
        />
        <TextField
          label="Bank details"
          value={settings.bankText}
          onChangeText={(value) => update('bankText', value)}
          multiline
        />

        <Button label="Hifadhi Settings" onPress={onSave} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: 120,
  },
  previewCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  logoMark: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: Colors.white,
    fontSize: 19,
    fontWeight: '600',
  },
  previewInfo: {
    flex: 1,
  },
  companyName: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  companyMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
});
