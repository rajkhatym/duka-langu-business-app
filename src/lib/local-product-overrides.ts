import { Platform } from 'react-native';

import type { Product } from '@/types/database';

type ProductOverride = Partial<
  Pick<
    Product,
    | 'name'
    | 'sku'
    | 'unit'
    | 'category'
    | 'variant_size'
    | 'variant_color'
    | 'variant_weight'
    | 'warranty_months'
    | 'quantity'
    | 'reorder_level'
    | 'cost_price'
    | 'unit_price'
  >
> & {
  updated_at: string;
};

type ProductOverrideMap = Record<string, ProductOverride>;

const PRODUCT_OVERRIDES_KEY = 'godown-product-overrides';
const LOCAL_PRODUCTS_KEY = 'godown-local-products';

function canUseLocalStorage() {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

function readOverrides(): ProductOverrideMap {
  if (!canUseLocalStorage()) return {};
  try {
    const raw = window.localStorage.getItem(PRODUCT_OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as ProductOverrideMap) : {};
  } catch {
    return {};
  }
}

function writeOverrides(overrides: ProductOverrideMap) {
  if (!canUseLocalStorage()) return;
  window.localStorage.setItem(PRODUCT_OVERRIDES_KEY, JSON.stringify(overrides));
}

function readLocalProducts() {
  if (!canUseLocalStorage()) return [] as Product[];
  try {
    const raw = window.localStorage.getItem(LOCAL_PRODUCTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Product[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalProducts(products: Product[]) {
  if (!canUseLocalStorage()) return;
  window.localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(products));
}

export function normalizeProductLookup(value: string | null | undefined) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function saveLocalProductOverride(productId: string, override: Omit<ProductOverride, 'updated_at'>) {
  const overrides = readOverrides();
  overrides[productId] = {
    ...(overrides[productId] ?? {}),
    ...override,
    updated_at: new Date().toISOString(),
  };
  writeOverrides(overrides);
}

export function applyLocalProductOverrides(products: Product[]) {
  const localProducts = readLocalProducts();
  const overrides = readOverrides();
  const mergedProducts = [...products];
  localProducts.forEach((localProduct) => {
    if (!mergedProducts.some((product) => product.id === localProduct.id)) {
      mergedProducts.push(localProduct);
    }
  });
  return mergedProducts.map((product) => ({
    ...product,
    ...(overrides[product.id] ?? {}),
  }));
}

export function applyLocalProductOverride(product: Product | null) {
  if (!product) return null;
  const overrides = readOverrides();
  return {
    ...product,
    ...(overrides[product.id] ?? {}),
  };
}

export function saveLocalProduct(product: Product) {
  const products = readLocalProducts();
  const nextProducts = [product, ...products.filter((nextProduct) => nextProduct.id !== product.id)];
  writeLocalProducts(nextProducts);
}
