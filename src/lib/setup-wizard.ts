import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Branch, Product } from '@/types/database';

const SETUP_STATE_KEY = 'godown.setup-wizard.v1';

export type SetupWizardState = {
  completed: boolean;
  completed_at: string | null;
  demo_products_enabled: boolean;
  categories: string[];
};

export const defaultSetupWizardState: SetupWizardState = {
  completed: false,
  completed_at: null,
  demo_products_enabled: true,
  categories: ['Weights', 'Cardio', 'Accessories', 'Nutrition', 'Machines', 'Recovery'],
};

export const setupDemoProducts = [
  { name: 'Adjustable Dumbbell 20kg', sku: 'FIT-DB20', category: 'Weights', unit: 'pcs', quantity: 8, reorder_level: 3, cost_price: 180000, unit_price: 240000 },
  { name: 'Olympic Barbell 20kg', sku: 'FIT-BAR20', category: 'Weights', unit: 'pcs', quantity: 5, reorder_level: 2, cost_price: 220000, unit_price: 320000 },
  { name: 'Yoga Mat Premium', sku: 'FIT-YOGA', category: 'Accessories', unit: 'pcs', quantity: 22, reorder_level: 8, cost_price: 18000, unit_price: 35000 },
  { name: 'Resistance Bands Set', sku: 'FIT-BAND', category: 'Accessories', unit: 'set', quantity: 30, reorder_level: 10, cost_price: 12000, unit_price: 28000 },
  { name: 'Treadmill Commercial', sku: 'FIT-TREAD', category: 'Cardio', unit: 'pcs', quantity: 2, reorder_level: 1, cost_price: 1800000, unit_price: 2600000, warranty_months: 12 },
  { name: 'Exercise Bike', sku: 'FIT-BIKE', category: 'Cardio', unit: 'pcs', quantity: 4, reorder_level: 1, cost_price: 650000, unit_price: 950000, warranty_months: 12 },
  { name: 'Gym Gloves', sku: 'FIT-GLOVE', category: 'Accessories', unit: 'pcs', quantity: 36, reorder_level: 12, cost_price: 9000, unit_price: 20000 },
  { name: 'Whey Protein 2kg', sku: 'FIT-WHEY2', category: 'Nutrition', unit: 'pcs', quantity: 12, reorder_level: 5, cost_price: 95000, unit_price: 145000 },
] satisfies (Partial<Product> & { name: string; sku: string; unit: string; quantity: number; reorder_level: number })[];

export function slugBranchId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `branch-${Date.now()}`;
}

export async function getSetupWizardState() {
  const raw = await AsyncStorage.getItem(SETUP_STATE_KEY);
  if (!raw) return defaultSetupWizardState;
  try {
    return { ...defaultSetupWizardState, ...(JSON.parse(raw) as Partial<SetupWizardState>) };
  } catch {
    return defaultSetupWizardState;
  }
}

export async function saveSetupWizardState(state: SetupWizardState) {
  await AsyncStorage.setItem(SETUP_STATE_KEY, JSON.stringify(state));
}

export function normalizeWizardBranches(branchOne: string, branchTwo: string): Branch[] {
  const names = [branchOne, branchTwo].map((name) => name.trim()).filter(Boolean);
  return names.map((name, index) => ({
    id: slugBranchId(name) || `branch-${index + 1}`,
    name,
  }));
}
