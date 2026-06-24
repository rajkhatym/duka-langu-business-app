import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

const COMPANY_SETTINGS_KEY = 'godown.company-settings.v1';

export type CompanySettings = {
  name: string;
  tagline: string;
  location: string;
  phonesText: string;
  email: string;
  tax: string;
  bankText: string;
  logoText: string;
  currency: string;
  receiptFooter: string;
};

type CompanySettingsRow = {
  name: string;
  tagline: string | null;
  location: string | null;
  phones_text: string | null;
  email: string | null;
  tax: string | null;
  bank_text: string | null;
  logo_text: string | null;
  currency: string | null;
  receipt_footer: string | null;
};

export const defaultCompanySettings: CompanySettings = {
  name: 'Fitness Empire co ltd',
  tagline: 'Sinza kumekucha',
  location: 'Dar es salaam Tanzania',
  phonesText: '+255718327776\n+255758728258',
  email: 'Fitnessempiretz@gmail.com',
  tax: 'Tax no. : TIN 138-837-327 VRN 40-320840-G',
  logoText: 'FE',
  currency: 'TZS',
  receiptFooter: 'Asante kwa kununua. Karibu tena.',
  bankText:
    'BANKING DETAILS\nBank: CRDB\nAccount Name: FITNESS EMPIRE COMPANY LIMITED\nAccount Number: 0150439355500\nSWIFT CODE: CORUTZTZ',
};

export function splitLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getCompanySettings() {
  const raw = await AsyncStorage.getItem(COMPANY_SETTINGS_KEY);
  const localSettings = (() => {
    if (!raw) return defaultCompanySettings;
    try {
      return { ...defaultCompanySettings, ...(JSON.parse(raw) as Partial<CompanySettings>) };
    } catch {
      return defaultCompanySettings;
    }
  })();

  try {
    const { data, error } = await supabase.from('company_settings').select('*').eq('id', 'default').maybeSingle();
    if (error || !data) return localSettings;
    const row = data as CompanySettingsRow;
    return {
      name: row.name || localSettings.name,
      tagline: row.tagline ?? localSettings.tagline,
      location: row.location ?? localSettings.location,
      phonesText: row.phones_text ?? localSettings.phonesText,
      email: row.email ?? localSettings.email,
      tax: row.tax ?? localSettings.tax,
      bankText: row.bank_text ?? localSettings.bankText,
      logoText: row.logo_text ?? localSettings.logoText,
      currency: row.currency ?? localSettings.currency,
      receiptFooter: row.receipt_footer ?? localSettings.receiptFooter,
    };
  } catch {
    return localSettings;
  }
}

export async function saveCompanySettings(settings: CompanySettings) {
  await AsyncStorage.setItem(COMPANY_SETTINGS_KEY, JSON.stringify(settings));
  await supabase.from('company_settings').upsert({
    id: 'default',
    name: settings.name,
    tagline: settings.tagline,
    location: settings.location,
    phones_text: settings.phonesText,
    email: settings.email,
    tax: settings.tax,
    bank_text: settings.bankText,
    logo_text: settings.logoText,
    currency: settings.currency,
    receipt_footer: settings.receiptFooter,
    updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
  });
}
