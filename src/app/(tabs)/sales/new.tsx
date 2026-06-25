import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/button';
import { Colors, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatMoney, formatQuantity } from '@/lib/format';
import {
  applyLocalProductOverrides,
  normalizeProductLookup,
  saveLocalProductOverride,
} from '@/lib/local-product-overrides';
import {
  getPendingSalesCount,
  insertSaleRowsOnline,
  isOfflineInsertError,
  queuePendingSaleBatch,
  syncPendingSales,
  type SaleInsertRow,
} from '@/lib/offline-sales';
import { getLocalReportSales, recordLocalReportSales, removeLocalReportSales } from '@/lib/local-report-sales';
import { setupDemoProducts } from '@/lib/setup-wizard';
import { supabase } from '@/lib/supabase';
import type { PaymentMethod, PaymentStatus, Product } from '@/types/database';

type QuantityMap = Record<string, number>;
type PriceMap = Record<string, string>;
type FlashMap = Record<string, boolean>;
type SaleDraft = {
  category: string;
  prices: PriceMap;
  quantities: QuantityMap;
  search: string;
  savedAt: string;
};
type LastPreviewSale = {
  reportIds: string[];
  stockBefore: { productId: string; quantity: number }[];
  total: number;
  itemCount: number;
  profit: number;
  savedAt: string;
};
type DailySalesStats = {
  total: number;
  profit: number;
  itemCount: number;
  transactionCount: number;
};
type StockAlert = {
  message: string;
  productId: string;
  suggestedQuantity: number;
};

const SALE_DRAFT_PREFIX = 'godown-sale-draft';
const QR_PREFIX = 'DLBA:';
const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'bank', label: 'Bank' },
  { value: 'credit', label: 'Credit' },
];

function paymentStatus(total: number, paid: number): PaymentStatus {
  if (paid <= 0) return 'credit';
  if (paid >= total) return 'paid';
  return 'partial';
}

function productBasePrice(product: Product) {
  return product.unit_price ?? 0;
}

function previewProducts(branchId: string): Product[] {
  return setupDemoProducts.map((product, index) => ({
    id: `preview-product-${index + 1}`,
    branch_id: branchId,
    name: product.name,
    sku: product.sku,
    unit: product.unit,
    category: product.category ?? null,
    variant_size: null,
    variant_color: null,
    variant_weight: null,
    warranty_months: product.warranty_months ?? null,
    quantity: product.quantity,
    reorder_level: product.reorder_level,
    cost_price: product.cost_price ?? null,
    unit_price: product.unit_price ?? null,
    created_by: null,
    created_at: new Date().toISOString(),
  }));
}

function draftKey(branchId: string) {
  return `${SALE_DRAFT_PREFIX}:${branchId}`;
}

function readSaleDraft(branchId: string): SaleDraft | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const rawDraft = window.localStorage.getItem(draftKey(branchId));
    return rawDraft ? (JSON.parse(rawDraft) as SaleDraft) : null;
  } catch {
    return null;
  }
}

function writeSaleDraft(branchId: string, draft: SaleDraft) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(draftKey(branchId), JSON.stringify(draft));
}

function removeSaleDraft(branchId: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.removeItem(draftKey(branchId));
}

function draftForProducts(draft: SaleDraft | null, products: Product[]): SaleDraft | null {
  if (!draft) return null;
  const productIds = new Set(products.map((product) => product.id));
  const quantities = Object.fromEntries(
    Object.entries(draft.quantities).filter(([productId]) => productIds.has(productId))
  ) as QuantityMap;
  const prices = Object.fromEntries(
    Object.entries(draft.prices).filter(([productId]) => productIds.has(productId))
  ) as PriceMap;
  return { ...draft, quantities, prices };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function codeFromScan(rawValue: string) {
  const value = rawValue.trim();
  return value.toUpperCase().startsWith(QR_PREFIX) ? value.slice(QR_PREFIX.length).trim() : value;
}

function productMatchesScan(product: Product, normalizedCode: string) {
  return (
    normalizeProductLookup(product.sku) === normalizedCode ||
    normalizeProductLookup(product.id) === normalizedCode ||
    normalizeProductLookup(product.name) === normalizedCode
  );
}

type BarcodeDetectionResult = { rawValue?: string };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectionResult[]>;
};

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    }),
  ]);
}

export default function NewSaleScreen() {
  const {
    createdAt,
    createdProduct,
    createdQty,
    createdSku,
    selectedExisting,
    updatedAt,
    updatedProduct,
    restockedAt,
    restockedProduct,
    restockedQty,
  } = useLocalSearchParams<{
    createdAt?: string;
    createdProduct?: string;
    createdQty?: string;
    createdSku?: string;
    selectedExisting?: string;
    updatedAt?: string;
    updatedProduct?: string;
    restockedAt?: string;
    restockedProduct?: string;
    restockedQty?: string;
  }>();
  const { session, isOwner } = useAuth();
  const { selectedBranchId, selectedBranch } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [usingDemoProducts, setUsingDemoProducts] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Zote');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [quantities, setQuantities] = useState<QuantityMap>({});
  const [prices, setPrices] = useState<PriceMap>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [creditCustomerName, setCreditCustomerName] = useState('');
  const [flashingPrices, setFlashingPrices] = useState<FlashMap>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stockAlert, setStockAlert] = useState<StockAlert | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingSalesCount, setPendingSalesCount] = useState(0);
  const [isOnline, setIsOnline] = useState(
    Platform.OS !== 'web' || typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [refreshingProducts, setRefreshingProducts] = useState(false);
  const [lastProductsRefresh, setLastProductsRefresh] = useState<string | null>(null);
  const [handledCreatedAt, setHandledCreatedAt] = useState<string | null>(null);
  const [handledProductUpdateAt, setHandledProductUpdateAt] = useState<string | null>(null);
  const [handledRestockedAt, setHandledRestockedAt] = useState<string | null>(null);
  const [lastPreviewSale, setLastPreviewSale] = useState<LastPreviewSale | null>(null);
  const [checkoutPreviewOpen, setCheckoutPreviewOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [, setDailySalesStats] = useState<DailySalesStats>({
    total: 0,
    profit: 0,
    itemCount: 0,
    transactionCount: 0,
  });
  const searchInputRef = useRef<TextInput>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerStopRef = useRef(false);
  const productReturnQuery = isOwnerPreviewMode() ? 'returnTo=sales&owner=preview' : 'returnTo=sales';
  const focusSearchInput = useCallback(() => {
    setTimeout(() => searchInputRef.current?.focus(), 80);
  }, []);
  const cleanSalesRoute = useCallback(() => {
    const nextPath = isOwnerPreviewMode() ? '/sales/new?owner=preview' : '/sales/new';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.setTimeout(() => {
        window.history.replaceState(null, '', `${window.location.origin}${nextPath}`);
      }, 0);
      return;
    }
    router.replace(isOwnerPreviewMode() ? '/(tabs)/sales/new?owner=preview' : '/(tabs)/sales/new');
  }, []);

  const loadDailySalesStats = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const rows = await getLocalReportSales(startOfDay, selectedBranchId);
    const transactionKeys = new Set<string>();
    const nextStats = rows.reduce<DailySalesStats>(
      (acc, row) => {
        acc.total += row.unit_price * row.quantity;
        acc.profit += row.quantity * (row.unit_price - (row.products?.cost_price ?? 0));
        acc.itemCount += row.quantity;
        transactionKeys.add(row.created_at);
        return acc;
      },
      { total: 0, profit: 0, itemCount: 0, transactionCount: 0 }
    );
    nextStats.transactionCount = transactionKeys.size;
    setDailySalesStats(nextStats);
  }, [selectedBranchId]);

  const loadProducts = useCallback(
    async ({ restoreDraft }: { restoreDraft: boolean }) => {
      setDraftReady(false);
      if (restoreDraft) {
        setDraftRestored(false);
      }
      try {
        let { data, error: productsError } = await withTimeout(
          supabase
            .from('products')
            .select('*')
            .eq('branch_id', selectedBranchId)
            .order('name')
        );
        if (productsError?.message.includes('branch_id')) {
          const fallback = await withTimeout(supabase.from('products').select('*').order('name'));
          data = fallback.data;
        }
        const databaseProducts = applyLocalProductOverrides((data as Product[]) ?? []);
        const nextProducts =
          databaseProducts.length > 0 || !isAnyPreviewMode()
            ? databaseProducts
            : previewProducts(selectedBranchId);
        const draft = restoreDraft ? draftForProducts(readSaleDraft(selectedBranchId), nextProducts) : null;
        const defaultPrices = nextProducts.reduce<PriceMap>((acc, product) => {
          acc[product.id] = String(productBasePrice(product));
          return acc;
        }, {});
        setUsingDemoProducts(false);
        setProducts(nextProducts);
        setError((currentError) =>
          currentError?.startsWith('Bidhaa hazijasoma') || currentError?.startsWith('Hakuna bidhaa')
            ? null
            : currentError
        );
        if (nextProducts.length === 0) {
          setError('Hakuna bidhaa kwenye branch hii. Ongeza bidhaa au bonyeza Refresh baada ya kuingia account sahihi.');
        }
        setPrices(restoreDraft ? { ...defaultPrices, ...(draft?.prices ?? {}) } : defaultPrices);
        if (restoreDraft) {
          setQuantities(draft?.quantities ?? {});
          setSearch(draft?.search ?? '');
          setCategory(draft?.category ?? 'Zote');
          setDraftRestored(Boolean(draft && Object.values(draft.quantities).some((quantity) => quantity > 0)));
        }
      } catch {
        const fallbackProducts = isAnyPreviewMode() ? previewProducts(selectedBranchId) : [];
        const defaultPrices = fallbackProducts.reduce<PriceMap>((acc, product) => {
          acc[product.id] = String(productBasePrice(product));
          return acc;
        }, {});
        setUsingDemoProducts(false);
        setProducts(fallbackProducts);
        setPrices(defaultPrices);
        if (restoreDraft) {
          setQuantities({});
          setSearch('');
          setCategory('Zote');
          setDraftRestored(false);
        }
        setError(
          fallbackProducts.length > 0
            ? null
            : 'Bidhaa hazijasoma. Bonyeza Refresh au hakikisha umeingia kwenye account sahihi.'
        );
      } finally {
        setLastProductsRefresh(new Date().toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' }));
        setDraftReady(true);
      }
    },
    [selectedBranchId]
  );

  useEffect(() => {
    loadProducts({ restoreDraft: true });
  }, [loadProducts]);

  useEffect(() => {
    loadDailySalesStats();
  }, [loadDailySalesStats]);

  useEffect(() => {
    focusSearchInput();
  }, [focusSearchInput]);

  useEffect(() => {
    if (!createdSku || !createdAt || handledCreatedAt === createdAt) return;

    const reloadCreatedProduct = async () => {
      setHandledCreatedAt(createdAt);
      setRefreshingProducts(true);
      await loadProducts({ restoreDraft: false });
      setRefreshingProducts(false);
      setSearch('');
      setError(null);
      if (createdProduct && Number(createdQty) > 0) {
        setQuantities({ [createdProduct]: 1 });
        removeSaleDraft(selectedBranchId);
        setDraftRestored(false);
        setNotice(
          selectedExisting === '1'
            ? `Bidhaa iliyopo imeongezwa kwenye sale: ${createdSku}.`
            : `Bidhaa mpya imeongezwa kwenye sale: ${createdSku}.`
        );
      } else {
        setNotice(`Bidhaa mpya imeongezwa: ${createdSku}.`);
      }
      focusSearchInput();
      cleanSalesRoute();
    };

    reloadCreatedProduct();
  }, [
    cleanSalesRoute,
    createdAt,
    createdProduct,
    createdQty,
    createdSku,
    focusSearchInput,
    handledCreatedAt,
    loadProducts,
    selectedExisting,
    selectedBranchId,
  ]);

  useEffect(() => {
    if (!updatedProduct || !updatedAt || handledProductUpdateAt === updatedAt) return;

    const reloadUpdatedProduct = async () => {
      setHandledProductUpdateAt(updatedAt);
      setRefreshingProducts(true);
      await loadProducts({ restoreDraft: true });
      setRefreshingProducts(false);
      setNotice('Product imesasishwa. Stock na bei zimesomwa upya.');
      cleanSalesRoute();
    };

    reloadUpdatedProduct();
  }, [cleanSalesRoute, handledProductUpdateAt, loadProducts, updatedAt, updatedProduct]);

  useEffect(() => {
    if (!restockedProduct || !restockedAt || handledRestockedAt === restockedAt) return;

    const reloadRestockedProduct = async () => {
      setHandledRestockedAt(restockedAt);
      setRefreshingProducts(true);
      await loadProducts({ restoreDraft: false });
      setRefreshingProducts(false);
      setStockAlert(null);
      setNotice(`Stock imeongezwa${restockedQty ? `: +${restockedQty}` : ''}. Bidhaa imesasishwa.`);
      focusSearchInput();
      cleanSalesRoute();
    };

    reloadRestockedProduct();
  }, [cleanSalesRoute, focusSearchInput, handledRestockedAt, loadProducts, restockedAt, restockedProduct, restockedQty]);

  const refreshProducts = async () => {
    setRefreshingProducts(true);
    await loadProducts({ restoreDraft: false });
    setRefreshingProducts(false);
    setNotice('Stock na bei zimesasishwa.');
  };

  useEffect(() => {
    if (!draftReady) return;
    const hasSelectedProducts = Object.values(quantities).some((quantity) => quantity > 0);
    const hasSearch = search.trim().length > 0;
    if (!hasSelectedProducts && !hasSearch) {
      removeSaleDraft(selectedBranchId);
      return;
    }
    writeSaleDraft(selectedBranchId, {
      category,
      prices,
      quantities,
      search,
      savedAt: new Date().toISOString(),
    });
  }, [category, draftReady, prices, quantities, search, selectedBranchId]);

  useEffect(() => {
    const syncQueuedSales = async () => {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
        setIsOnline(navigator.onLine);
      }
      const result = await withTimeout(syncPendingSales(), 5000).catch(() => ({ synced: 0 }));
      if (result.synced > 0) {
        setNotice(`Mauzo ${result.synced} ya offline yamesync.`);
      }

      const pendingCount = await withTimeout(getPendingSalesCount(), 3000).catch(() => 0);
      setPendingSalesCount(pendingCount);
      if (pendingCount > 0) {
        setNotice(`Mauzo ${pendingCount} yanasubiri sync internet ikirudi.`);
      }
    };

    syncQueuedSales();

    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const markOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', syncQueuedSales);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', syncQueuedSales);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  const handleManualSync = async () => {
    setLoading(true);
    const result = await withTimeout(syncPendingSales({ force: true }), 5000).catch(() => ({ synced: 0 }));
    const pendingCount = await withTimeout(getPendingSalesCount(), 3000).catch(() => 0);
    setPendingSalesCount(pendingCount);
    setLoading(false);
    if (result.synced > 0) {
      setNotice(`Mauzo ${result.synced} ya offline yamesync.`);
      setError(null);
      return;
    }
    setNotice(pendingCount > 0 ? `Bado kuna mauzo ${pendingCount} yanasubiri sync.` : 'Hakuna mauzo yanayosubiri sync.');
  };

  const categories = useMemo(() => {
    const productCategories = products
      .map((product) => product.category)
      .filter((nextCategory): nextCategory is string => Boolean(nextCategory));
    return ['Zote', ...Array.from(new Set(productCategories))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const normalizedQuery = normalizeProductLookup(query);
    const selectedFiltered = showSelectedOnly
      ? products.filter((product) => (quantities[product.id] ?? 0) > 0)
      : products;
    const categoryFiltered =
      category === 'Zote'
        ? selectedFiltered
        : selectedFiltered.filter((product) => product.category === category);
    if (!query) return categoryFiltered;
    return categoryFiltered.filter((product) => {
      return (
        product.name.toLowerCase().includes(query) ||
        (product.sku ?? '').toLowerCase().includes(query) ||
        normalizeProductLookup(product.sku).includes(normalizedQuery) ||
        normalizeProductLookup(product.name).includes(normalizedQuery) ||
        (product.category ?? '').toLowerCase().includes(query)
      );
    });
  }, [category, products, quantities, search, showSelectedOnly]);

  const selectedLines = useMemo(() => {
    return products
      .map((product) => {
        const quantity = quantities[product.id] ?? 0;
        const price = Number(prices[product.id]) || 0;
        return { product, quantity, price, total: quantity * price };
      })
      .filter((line) => line.quantity > 0);
  }, [prices, products, quantities]);

  const total = selectedLines.reduce((sum, line) => sum + line.total, 0);
  const totalCost = selectedLines.reduce(
    (sum, line) => sum + line.quantity * (line.product.cost_price ?? 0),
    0
  );
  const estimatedProfit = total - totalCost;
  const selectedCount = selectedLines.reduce((sum, line) => sum + line.quantity, 0);
  const selectedPaymentLabel = paymentMethods.find((method) => method.value === paymentMethod)?.label ?? 'Cash';
  const hasMissingSelectedCost = selectedLines.some((line) => (line.product.cost_price ?? 0) <= 0);
  const profitSummaryText = hasMissingSelectedCost
    ? 'Faida: jaza cost kwanza'
    : `Faida: TZS ${formatMoney(estimatedProfit)}`;
  const selectedCostIssue = useMemo(() => {
    if (!isOwner) return null;
    const missingCostLine = selectedLines.find((line) => (line.product.cost_price ?? 0) <= 0);
    if (missingCostLine) {
      return { message: `Weka cost kwa ${missingCostLine.product.name} kabla ya kuhifadhi.`, product: missingCostLine.product };
    }
    const lossLine = selectedLines.find((line) => line.price < (line.product.cost_price ?? 0));
    if (lossLine) {
      return { message: `Bei ya ${lossLine.product.name} iko chini ya manunuzi.`, product: lossLine.product };
    }
    return null;
  }, [isOwner, selectedLines]);

  const setQuantity = (product: Product, nextQuantity: number) => {
    const cleanQuantity = Math.max(0, Math.min(product.quantity, nextQuantity));
    setQuantities((current) => ({ ...current, [product.id]: cleanQuantity }));
    if (nextQuantity > product.quantity) {
      setNotice(null);
      setError(
        `Stock iliyopo kwa ${product.name} ni ${formatQuantity(product.quantity)} ${product.unit}. Nimeweka kiwango cha juu kinachopatikana.`
      );
      return;
    }
    setError((currentError) =>
      currentError?.startsWith('Stock iliyopo kwa ') ? null : currentError
    );
  };

  const setProductPrice = (product: Product, nextPrice: string) => {
    setPrices((current) => ({ ...current, [product.id]: nextPrice }));

    const numericPrice = Number(nextPrice);
    const basePrice = productBasePrice(product);
    if (basePrice > 0 && numericPrice > basePrice) {
      setFlashingPrices((current) => ({ ...current, [product.id]: true }));
      setTimeout(() => {
        setFlashingPrices((current) => ({ ...current, [product.id]: false }));
      }, 260);
      setTimeout(() => {
        setFlashingPrices((current) => ({ ...current, [product.id]: true }));
      }, 520);
    } else {
      setFlashingPrices((current) => ({ ...current, [product.id]: false }));
    }
  };

  const clearCart = () => {
    setQuantities({});
    setError(null);
    setStockAlert(null);
    setDraftRestored(false);
    setCreditCustomerName('');
    removeSaleDraft(selectedBranchId);
  };

  const addScannedProduct = useCallback(
    (rawValue: string) => {
      const code = codeFromScan(rawValue);
      const normalizedCode = normalizeProductLookup(code);
      if (!normalizedCode) {
        setScanStatus('Code haijasomeka. Jaribu tena au andika SKU.');
        return false;
      }
      const matchedProduct = products.find((product) => productMatchesScan(product, normalizedCode));
      if (!matchedProduct) {
        setScanStatus(`Hakuna bidhaa yenye code: ${code}`);
        setSearch(code);
        return false;
      }
      const currentQuantity = quantities[matchedProduct.id] ?? 0;
      if (matchedProduct.quantity <= currentQuantity) {
        setScanStatus(
          `Stock haitoshi kwa ${matchedProduct.name}. Iliyopo: ${formatQuantity(matchedProduct.quantity)} ${matchedProduct.unit}.`
        );
        setSearch(matchedProduct.name);
        return false;
      }
      setQuantity(matchedProduct, currentQuantity + 1);
      setSearch(matchedProduct.name);
      setScanCode('');
      setScanStatus(`${matchedProduct.name} imeongezwa kwenye sale.`);
      setNotice(`${matchedProduct.name} imeongezwa kwa QR/Barcode.`);
      return true;
    },
    [products, quantities]
  );

  const stopScanner = useCallback(() => {
    scannerStopRef.current = true;
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
    scannerStreamRef.current = null;
  }, []);

  const closeScanner = useCallback(() => {
    stopScanner();
    setScanOpen(false);
  }, [stopScanner]);

  const startScanner = useCallback(async () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof navigator === 'undefined') {
      setScanStatus('Scanner inapatikana kwenye browser yenye camera. Andika SKU hapa chini.');
      return;
    }
    const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!BarcodeDetectorClass || !navigator.mediaDevices?.getUserMedia) {
      setScanStatus('Browser hii haina QR scanner. Andika au paste SKU kwenye box hapa chini.');
      return;
    }

    try {
      scannerStopRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      scannerStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new BarcodeDetectorClass({ formats: ['qr_code', 'code_128', 'ean_13', 'ean_8'] });
      setScanStatus('Elekeza camera kwenye QR/Barcode ya bidhaa.');

      const scanLoop = async () => {
        if (scannerStopRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const rawValue = codes[0]?.rawValue;
          if (rawValue && addScannedProduct(rawValue)) {
            closeScanner();
            return;
          }
        } catch {
          setScanStatus('Camera imeshindwa kusoma code. Jaribu tena au andika SKU.');
        }
        window.setTimeout(scanLoop, 450);
      };

      scanLoop();
    } catch {
      setScanStatus('Camera haijaruhusiwa. Ruhusu camera au andika SKU hapa chini.');
    }
  }, [addScannedProduct, closeScanner]);

  useEffect(() => {
    if (!scanOpen) return;
    startScanner();
    return stopScanner;
  }, [scanOpen, startScanner, stopScanner]);

  const undoLastPreviewSale = async () => {
    if (!lastPreviewSale) return;
    setLoading(true);
    lastPreviewSale.stockBefore.forEach((item) => {
      saveLocalProductOverride(item.productId, { quantity: item.quantity });
    });
    await removeLocalReportSales(lastPreviewSale.reportIds);
    setLastPreviewSale(null);
    setStockAlert(null);
    await loadDailySalesStats();
    await loadProducts({ restoreDraft: false });
    setLoading(false);
    setNotice(`Sale ya mwisho imefutwa. Stock imerudishwa. TZS ${formatMoney(lastPreviewSale.total)}`);
    focusSearchInput();
  };

  const validateCheckout = () => {
    if (selectedLines.length === 0) {
      setError('Ongeza quantity kwa angalau bidhaa moja');
      return false;
    }

    const invalidLine = selectedLines.find((line) => line.quantity <= 0 || line.price <= 0);
    if (invalidLine) {
      setError('Tafadhali hakikisha quantity na bei ni sahihi');
      return false;
    }

    const overStockLine = selectedLines.find((line) => line.quantity > line.product.quantity);
    if (overStockLine) {
      setError(`Stock haitoshi kwa ${overStockLine.product.name}`);
      return false;
    }

    if (selectedCostIssue) {
      setError(selectedCostIssue.message);
      return false;
    }

    const saleCustomerName = paymentMethod === 'credit' ? creditCustomerName.trim() : '';
    if (paymentMethod === 'credit' && saleCustomerName.length < 2) {
      setError('Weka jina la mteja kwa mauzo ya credit');
      return false;
    }

    setError(null);
    return true;
  };

  const openCheckoutPreview = () => {
    if (!validateCheckout()) return;
    setCheckoutPreviewOpen(true);
  };

  const onSubmit = async () => {
    if (!validateCheckout()) return;

    const saleCustomerName = paymentMethod === 'credit' ? creditCustomerName.trim() : '';

    setError(null);
    setStockAlert(null);
    setCheckoutPreviewOpen(false);
    setLoading(true);

    const resolvedProductIds: Record<string, string> = {};
    for (const line of selectedLines) {
      if (isUuid(line.product.id)) {
        resolvedProductIds[line.product.id] = line.product.id;
        continue;
      }

      if (!line.product.sku) {
        setLoading(false);
        setError(`Bidhaa ${line.product.name} haina SKU ya ku-match na Supabase.`);
        return;
      }

      const { data: matchedProduct, error: matchError } = await supabase
        .from('products')
        .select('id')
        .eq('branch_id', selectedBranchId)
        .eq('sku', line.product.sku)
        .maybeSingle();

      if (matchError || !matchedProduct?.id) {
        setLoading(false);
        setError(`Bidhaa ${line.product.name} haijapatikana Supabase. Refresh products au fungua bidhaa hiyo kwanza.`);
        return;
      }

      resolvedProductIds[line.product.id] = matchedProduct.id as string;
    }

    const linePaidAmount = (lineTotal: number) => (paymentMethod === 'credit' ? 0 : lineTotal);
    const saleBatchId = `sale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const rows: SaleInsertRow[] = selectedLines.map((line, index) => ({
      client_sale_id: `${saleBatchId}-line-${index + 1}`,
      branch_id: selectedBranchId,
      product_id: resolvedProductIds[line.product.id] ?? line.product.id,
      quantity: line.quantity,
      unit_price: line.price,
      amount_paid: linePaidAmount(line.total),
      customer_name: saleCustomerName || null,
      payment_status: paymentStatus(line.total, linePaidAmount(line.total)),
      payment_method: paymentMethod,
      note: null,
      created_by: session?.user.id ?? null,
    }));
    const localReportRows = selectedLines.map((line) => ({
      branch_id: selectedBranchId,
      product: line.product,
      quantity: line.quantity,
      unit_price: line.price,
      amount_paid: linePaidAmount(line.total),
      customer_name: saleCustomerName || null,
      payment_status: paymentStatus(line.total, linePaidAmount(line.total)),
      payment_method: paymentMethod,
      note: null,
      created_by: session?.user.id ?? null,
    }));
    const openReceiptForBatch = async () => {
      const clientSaleIds = rows.map((row) => row.client_sale_id).filter(Boolean) as string[];
      if (clientSaleIds.length === 0) {
        router.replace('/(tabs)/sales');
        return;
      }

      const { data } = await supabase
        .from('sales')
        .select('id')
        .in('client_sale_id', clientSaleIds)
        .order('created_at', { ascending: true })
        .limit(1);
      const receiptId = data?.[0]?.id as string | undefined;
      if (receiptId) {
        router.replace(`/(tabs)/sales/receipt?id=${receiptId}` as Href);
        return;
      }
      router.replace('/(tabs)/sales');
    };

    const completeLocalPreviewSale = async (message: string) => {
      const stockBefore = selectedLines.map((line) => ({
        productId: line.product.id,
        quantity: line.product.quantity,
      }));
      const lowStockLines = selectedLines
        .map((line) => {
          const nextQuantity = Math.max(0, line.product.quantity - line.quantity);
          return { product: line.product, nextQuantity };
        })
        .filter(({ product, nextQuantity }) => nextQuantity <= product.reorder_level);
      selectedLines.forEach((line) => {
        saveLocalProductOverride(line.product.id, {
          quantity: Math.max(0, line.product.quantity - line.quantity),
        });
      });
      const reportIds = await recordLocalReportSales(localReportRows);
      await loadDailySalesStats();
      setLastPreviewSale({
        reportIds,
        stockBefore,
        total,
        itemCount: selectedCount,
        profit: estimatedProfit,
        savedAt: new Date().toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' }),
      });
      clearCart();
      await loadProducts({ restoreDraft: false });
      setLoading(false);
      setNotice(message);
      if (lowStockLines.length > 0) {
        const firstAlert = lowStockLines[0];
        const moreCount = lowStockLines.length - 1;
        setStockAlert({
          productId: firstAlert.product.id,
          suggestedQuantity: Math.max(1, firstAlert.product.reorder_level * 2 - firstAlert.nextQuantity),
          message: `Low stock: ${firstAlert.product.name} imebaki ${formatQuantity(firstAlert.nextQuantity)} ${firstAlert.product.unit}${moreCount > 0 ? ` +${moreCount} nyingine` : ''}.`,
        });
      }
      focusSearchInput();
    };

    if (isOwnerPreviewMode()) {
      await completeLocalPreviewSale('Mauzo yamehifadhiwa kwenye preview. Stock imepungua local.');
      return;
    }

    if (usingDemoProducts) {
      await recordLocalReportSales(localReportRows);
      clearCart();
      setLoading(false);
      router.replace('/(tabs)/sales');
      return;
    }

    let { error: insertError } = await insertSaleRowsOnline(rows);

    setLoading(false);

    if (insertError) {
      if (isOfflineInsertError(insertError.message)) {
        const pendingCount = await queuePendingSaleBatch(rows);
        setPendingSalesCount(pendingCount);
        setIsOnline(false);
        await completeLocalPreviewSale(`Internet imekata. Mauzo yamehifadhiwa local, batch ${pendingCount} inasubiri sync.`);
        return;
      }
      if (isOwnerPreviewMode()) {
        await completeLocalPreviewSale('Mauzo yamehifadhiwa kwenye preview. Stock imepungua local.');
        return;
      }
      setError(insertError.message);
      return;
    }

    await recordLocalReportSales(localReportRows);
    clearCart();
    await openReceiptForBatch();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Rekodi Mauzo</Text>
            <View style={[styles.syncBadge, !isOnline && styles.syncBadgeOffline]}>
              <Text style={[styles.syncDot, !isOnline && styles.syncDotOffline]}>●</Text>
              <Text style={[styles.syncBadgeText, !isOnline && styles.syncBadgeTextOffline]}>
                {isOnline ? 'Online' : 'Offline'}
                {pendingSalesCount > 0 ? ` · ${pendingSalesCount} pending` : ''}
              </Text>
              {pendingSalesCount > 0 ? (
                <Pressable style={styles.syncButton} onPress={handleManualSync} disabled={loading}>
                  <Text style={styles.syncButtonText}>Sync</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <View style={styles.subtitleRow}>
            <View style={styles.subtitleCopy}>
              <Text style={styles.subtitle}>
                {selectedBranch?.name} · Tafuta bidhaa, ongeza quantity, rekebisha bei na hifadhi.
              </Text>
              {lastProductsRefresh ? (
                <Text style={styles.refreshMeta}>Updated {lastProductsRefresh}</Text>
              ) : null}
            </View>
            <Pressable style={styles.refreshButton} onPress={refreshProducts} disabled={refreshingProducts}>
              <Text style={styles.refreshButtonText}>{refreshingProducts ? '...' : 'Refresh'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Tafuta jina, SKU au scan QR..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan QR au barcode ya bidhaa"
            style={styles.scanButton}
            onPress={() => {
              setScanStatus(null);
              setScanOpen(true);
            }}>
            <Text style={styles.scanButtonText}>Scan QR</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryChips}>
          {categories.map((nextCategory) => {
            const isActive = nextCategory === category;
            return (
              <Pressable
                key={nextCategory}
                style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => setCategory(nextCategory)}>
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                  {nextCategory}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Bidhaa</Text>
          <View style={styles.listHeaderActions}>
            {selectedLines.length > 0 ? (
              <Pressable
                style={[styles.selectedOnlyButton, showSelectedOnly && styles.selectedOnlyButtonActive]}
                onPress={() => setShowSelectedOnly((current) => !current)}>
                <Text
                  style={[
                    styles.selectedOnlyButtonText,
                    showSelectedOnly && styles.selectedOnlyButtonTextActive,
                  ]}>
                  Zilizochaguliwa
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.listMeta}>{selectedCount} zimechaguliwa</Text>
          </View>
        </View>
        {usingDemoProducts ? (
          <Text style={styles.demoNotice}>Demo products: badilisha na bidhaa zako ukishaweka stock.</Text>
        ) : null}
        {draftRestored ? (
          <Text style={styles.draftNotice}>Draft ya mauzo ya awali imerudishwa. Bonyeza Futa kuanza upya.</Text>
        ) : null}

        <ScrollView
          style={styles.productScroll}
          contentContainerStyle={styles.productList}
          keyboardShouldPersistTaps="handled">
          {filteredProducts.length === 0 ? (
            <Text style={styles.empty}>Hakuna bidhaa zinazofanana na ulichotafuta.</Text>
          ) : (
            filteredProducts.map((product) => (
              <ProductSaleRow
                key={product.id}
                product={product}
                quantity={quantities[product.id] ?? 0}
                price={prices[product.id] ?? String(productBasePrice(product))}
                isFlashing={!!flashingPrices[product.id]}
                showSensitive={isOwner}
                onDecrease={() => setQuantity(product, (quantities[product.id] ?? 0) - 1)}
                onIncrease={() => setQuantity(product, (quantities[product.id] ?? 0) + 1)}
                onQuantityChange={(nextQuantity) => setQuantity(product, nextQuantity)}
                onPriceChange={(nextPrice) => setProductPrice(product, nextPrice)}
                onOpenProduct={() => router.push(`/(tabs)/products/${product.id}?${productReturnQuery}`)}
              />
            ))
          )}
        </ScrollView>

        <View style={styles.floatingCheckout}>
          <View style={styles.checkoutTop}>
            <View>
              <Text style={styles.summaryLabel}>Jumla ya Mauzo</Text>
              <Text style={styles.summaryValue}>TZS {formatMoney(total)}</Text>
            </View>
            <Text style={styles.summaryItems}>
              {selectedLines.length} bidhaa · {selectedCount} pcs
            </Text>
          </View>
          <View style={styles.paymentMethodBox}>
            <Text style={styles.paymentMethodLabel}>Njia ya malipo</Text>
            <View style={styles.paymentMethodChips}>
              {paymentMethods.map((method) => {
                const active = paymentMethod === method.value;
                return (
                  <Pressable
                    key={method.value}
                    style={[styles.paymentMethodChip, active && styles.paymentMethodChipActive]}
                    onPress={() => setPaymentMethod(method.value)}>
                    <Text style={[styles.paymentMethodText, active && styles.paymentMethodTextActive]}>
                      {method.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {paymentMethod === 'credit' && selectedLines.length > 0 ? (
            <View style={styles.creditCustomerBox}>
              <Text style={styles.creditHint}>Credit: amount paid itawekwa 0 na sale itaingia kama deni.</Text>
              <TextInput
                value={creditCustomerName}
                onChangeText={setCreditCustomerName}
                placeholder="Jina la mteja wa deni"
                placeholderTextColor="rgba(255,255,255,0.55)"
                style={styles.creditCustomerInput}
              />
            </View>
          ) : null}
          {selectedLines.length > 0 ? (
            <View style={styles.simpleCheckoutMeta}>
              <Text style={styles.simpleProfit}>
                {isOwner ? profitSummaryText : 'Tayari kuhifadhi'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Futa draft ya mauzo"
                style={styles.clearCartButton}
                onPress={clearCart}>
                <Text style={styles.clearCartText}>Futa</Text>
              </Pressable>
            </View>
          ) : null}
          {selectedCostIssue ? (
            <View style={styles.checkoutWarningRow}>
              <Text style={styles.checkoutWarningText}>{selectedCostIssue.message}</Text>
              <Pressable
                style={styles.checkoutWarningButton}
                onPress={() => router.push(`/(tabs)/products/${selectedCostIssue.product.id}?${productReturnQuery}`)}>
                <Text style={styles.checkoutWarningButtonText}>Weka cost</Text>
              </Pressable>
            </View>
          ) : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {stockAlert ? (
            <View style={styles.stockAlertRow}>
              <Text style={styles.stockAlertText}>{stockAlert.message}</Text>
              <Pressable
                style={styles.stockAlertButton}
                onPress={() =>
                  router.push(
                    `/(tabs)/movements/new?productId=${stockAlert.productId}&type=IN&qty=${stockAlert.suggestedQuantity}${isOwnerPreviewMode() ? '&owner=preview&returnTo=sales' : ''}`
                  )
                }>
                <Text style={styles.stockAlertButtonText}>Ongeza stock</Text>
              </Pressable>
            </View>
          ) : null}
          {lastPreviewSale && isOwnerPreviewMode() ? (
            <Pressable style={styles.undoSaleCompact} onPress={undoLastPreviewSale} disabled={loading}>
              <Text style={styles.undoSaleCompactText}>
                Undo mwisho · TZS {formatMoney(lastPreviewSale.total)} · {lastPreviewSale.itemCount} pcs
              </Text>
            </Pressable>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label="Sell"
            onPress={openCheckoutPreview}
            loading={loading}
            disabled={selectedLines.length === 0 || Boolean(selectedCostIssue)}
            style={styles.checkoutSaveButton}
          />
        </View>

        <Modal
          visible={scanOpen}
          transparent
          animationType="fade"
          onRequestClose={closeScanner}>
          <View style={styles.previewOverlay}>
            <View style={styles.scanCard}>
              <View style={styles.previewHeader}>
                <View>
                  <Text style={styles.previewEyebrow}>QR/Barcode scanner</Text>
                  <Text style={styles.previewTitle}>Scan bidhaa</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Funga scanner"
                  style={styles.previewCloseButton}
                  onPress={closeScanner}>
                  <Text style={styles.previewCloseText}>X</Text>
                </Pressable>
              </View>
              {Platform.OS === 'web' ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    minHeight: 220,
                    borderRadius: 12,
                    backgroundColor: '#102A23',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <View style={styles.scanFallbackBox}>
                  <Text style={styles.scanFallbackText}>Tumia browser yenye camera au andika SKU.</Text>
                </View>
              )}
              {scanStatus ? <Text style={styles.scanStatus}>{scanStatus}</Text> : null}
              <View style={styles.scanManualRow}>
                <TextInput
                  value={scanCode}
                  onChangeText={setScanCode}
                  placeholder="Andika/paste SKU au DLBA:SKU"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.scanManualInput}
                  autoCapitalize="characters"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ongeza bidhaa iliyoscan"
                  style={styles.scanManualButton}
                  onPress={() => {
                    if (addScannedProduct(scanCode)) closeScanner();
                  }}>
                  <Text style={styles.scanManualButtonText}>Ongeza</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={checkoutPreviewOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setCheckoutPreviewOpen(false)}>
          <View style={styles.previewOverlay}>
            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <View>
                  <Text style={styles.previewEyebrow}>Hakiki kabla ya kuhifadhi</Text>
                  <Text style={styles.previewTitle}>Preview ya Mauzo</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Funga preview ya mauzo"
                  style={styles.previewCloseButton}
                  onPress={() => setCheckoutPreviewOpen(false)}
                  disabled={loading}>
                  <Text style={styles.previewCloseText}>X</Text>
                </Pressable>
              </View>

              <View style={styles.previewSummary}>
                <View>
                  <Text style={styles.previewSummaryLabel}>Jumla</Text>
                  <Text style={styles.previewSummaryValue}>TZS {formatMoney(total)}</Text>
                </View>
                <View style={styles.previewSummaryRight}>
                  <Text style={styles.previewSummaryMeta}>{selectedLines.length} bidhaa · {selectedCount} pcs</Text>
                  <Text style={styles.previewSummaryMeta}>Malipo: {selectedPaymentLabel}</Text>
                </View>
              </View>

              {paymentMethod === 'credit' ? (
                <Text style={styles.previewCreditCustomer}>Mteja wa deni: {creditCustomerName.trim()}</Text>
              ) : null}

              <ScrollView style={styles.previewItems} contentContainerStyle={styles.previewItemsContent}>
                {selectedLines.map((line) => (
                  <View key={line.product.id} style={styles.previewItemRow}>
                    <View style={styles.previewItemInfo}>
                      <Text style={styles.previewItemName} numberOfLines={1}>{line.product.name}</Text>
                      <Text style={styles.previewItemMeta}>
                        {formatQuantity(line.quantity)} {line.product.unit} x TZS {formatMoney(line.price)}
                      </Text>
                    </View>
                    <Text style={styles.previewItemTotal}>TZS {formatMoney(line.total)}</Text>
                  </View>
                ))}
              </ScrollView>

              {isOwner ? <Text style={styles.previewProfit}>{profitSummaryText}</Text> : null}

              <View style={styles.previewActions}>
                <Button
                  label="Rudi kurekebisha"
                  variant="secondary"
                  onPress={() => setCheckoutPreviewOpen(false)}
                  disabled={loading}
                  style={styles.previewActionButton}
                />
                <Button
                  label="Sell"
                  onPress={onSubmit}
                  loading={loading}
                  disabled={loading}
                  style={styles.previewActionButton}
                />
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

function ProductSaleRow({
  product,
  quantity,
  price,
  isFlashing,
  showSensitive,
  onDecrease,
  onIncrease,
  onQuantityChange,
  onPriceChange,
  onOpenProduct,
}: {
  product: Product;
  quantity: number;
  price: string;
  isFlashing: boolean;
  showSensitive: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onQuantityChange: (quantity: number) => void;
  onPriceChange: (price: string) => void;
  onOpenProduct: () => void;
}) {
  const basePrice = productBasePrice(product);
  const currentPrice = Number(price) || 0;
  const costPrice = product.cost_price ?? 0;
  const isHigherThanBase = basePrice > 0 && currentPrice > basePrice;
  const isBelowCost = showSensitive && costPrice > 0 && currentPrice > 0 && currentPrice < costPrice;
  const isMissingCost = showSensitive && costPrice <= 0;
  const outOfStock = product.quantity <= 0;
  const remainingAfterSale = product.quantity - quantity;
  const isLowStock = !outOfStock && product.quantity <= product.reorder_level;
  const willBeLowStock = quantity > 0 && remainingAfterSale <= product.reorder_level;
  const lineTotal = quantity * currentPrice;
  const lineProfit = quantity * (currentPrice - costPrice);
  const handleQuantityChange = (nextValue: string) => {
    const numericQuantity = Number(nextValue.replace(',', '.'));
    onQuantityChange(Number.isFinite(numericQuantity) ? numericQuantity : 0);
  };

  return (
    <View style={[styles.productRow, quantity > 0 && styles.productRowActive]}>
      <View style={styles.productInfo}>
        <View style={styles.productNameRow}>
          <Text style={styles.productName} numberOfLines={1}>
            {product.name}
          </Text>
          {outOfStock ? (
            <Text style={[styles.stockBadge, styles.stockBadgeDanger]}>Imeisha</Text>
          ) : isLowStock ? (
            <Text style={[styles.stockBadge, styles.stockBadgeWarning]}>Low stock</Text>
          ) : null}
        </View>
        <Text style={styles.productMeta} numberOfLines={1}>
          Stock: {formatQuantity(product.quantity)} {product.unit}
          {product.sku ? ` · ${product.sku}` : ''}
        </Text>
        <Text style={styles.basePrice}>Bei halisi: TZS {formatMoney(basePrice)}</Text>
        {showSensitive ? (
          <Text style={styles.costPrice}>Manunuzi: TZS {formatMoney(costPrice)}</Text>
        ) : null}
        {isBelowCost ? (
          <Text style={styles.lossWarning}>Bei iko chini ya manunuzi</Text>
        ) : null}
        {isMissingCost ? (
          <View style={styles.missingCostRow}>
            <Text style={styles.missingCostWarning}>Bei ya manunuzi haijawekwa</Text>
            <Pressable style={styles.fixCostButton} onPress={onOpenProduct}>
              <Text style={styles.fixCostButtonText}>Weka cost</Text>
            </Pressable>
          </View>
        ) : null}
        {willBeLowStock ? (
          <Text style={styles.remainingWarning}>
            Itabaki {formatQuantity(Math.max(remainingAfterSale, 0))} {product.unit} baada ya mauzo
          </Text>
        ) : null}
        {quantity > 0 ? (
          <View style={styles.lineSummary}>
            <Text style={styles.lineSummaryText}>Line: TZS {formatMoney(lineTotal)}</Text>
            {showSensitive ? (
              <Text style={[styles.lineSummaryText, lineProfit < 0 && styles.lineSummaryLoss]}>
                {isMissingCost ? 'Profit: jaza cost kwanza' : `Profit: TZS ${formatMoney(lineProfit)}`}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.rowControls}>
        <View style={styles.quantityControl}>
          <Pressable style={styles.qtyButton} onPress={onDecrease} disabled={quantity <= 0}>
            <Text style={styles.qtyButtonText}>-</Text>
          </Pressable>
          <TextInput
            style={styles.quantityInput}
            value={String(quantity)}
            onChangeText={handleQuantityChange}
            keyboardType="numeric"
            selectTextOnFocus
          />
          <Pressable style={styles.qtyButton} onPress={onIncrease} disabled={outOfStock || quantity >= product.quantity}>
            <Text style={styles.qtyButtonText}>+</Text>
          </Pressable>
        </View>

        <TextInput
          style={[
            styles.priceInput,
            isHigherThanBase && styles.priceInputHigh,
            isBelowCost && styles.priceInputLoss,
            isFlashing && styles.priceInputFlash,
          ]}
          value={price}
          onChangeText={onPriceChange}
          keyboardType="numeric"
          selectTextOnFocus
        />
      </View>
    </View>
  );
}

const cardShadow = {
  shadowColor: '#17352C',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.07,
  shadowRadius: 14,
  elevation: 2,
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  title: {
    flex: 1,
    color: Colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  syncBadge: {
    minHeight: 30,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  syncBadgeOffline: {
    backgroundColor: Colors.warningSoft,
    borderColor: '#F8D78B',
  },
  syncDot: {
    color: Colors.success,
    fontSize: 10,
    lineHeight: 14,
  },
  syncDotOffline: {
    color: Colors.warning,
  },
  syncBadgeText: {
    color: Colors.primaryDark,
    fontSize: 11,
    fontWeight: '600',
  },
  syncBadgeTextOffline: {
    color: '#8A5A00',
  },
  syncButton: {
    height: 22,
    borderRadius: 7,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  syncButtonText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '600',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  subtitleCopy: {
    flex: 1,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '400',
  },
  refreshMeta: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  refreshButton: {
    minHeight: 28,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  refreshButtonText: {
    color: Colors.primaryDark,
    fontSize: 11,
    fontWeight: '600',
  },
  searchBox: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDE8E3',
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
    ...cardShadow,
  },
  searchIcon: {
    color: Colors.textMuted,
    fontSize: 26,
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: Colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  scanButton: {
    minWidth: 78,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  scanButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  categoryScroll: {
    flexGrow: 0,
    height: 38,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  categoryChips: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  categoryChip: {
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  categoryChipText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: Colors.primaryDark,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  listTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  listHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  selectedOnlyButton: {
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  selectedOnlyButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  selectedOnlyButtonText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  selectedOnlyButtonTextActive: {
    color: Colors.primaryDark,
  },
  listMeta: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '400',
  },
  demoNotice: {
    color: '#A46100',
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: '#F8D78B',
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
  draftNotice: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
  productScroll: {
    flex: 1,
  },
  productList: {
    gap: Spacing.sm,
    paddingBottom: 300,
  },
  empty: {
    color: Colors.textMuted,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    textAlign: 'center',
  },
  productRow: {
    minHeight: 92,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#E2EAE6',
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...cardShadow,
  },
  productRowActive: {
    borderColor: Colors.primary,
    backgroundColor: '#FBFFFD',
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
    paddingRight: Spacing.sm,
  },
  productNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  productName: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  stockBadge: {
    borderRadius: 8,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '600',
    overflow: 'hidden',
  },
  stockBadgeWarning: {
    color: '#8A5A00',
    backgroundColor: Colors.warningSoft,
  },
  stockBadgeDanger: {
    color: Colors.white,
    backgroundColor: Colors.danger,
  },
  productMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  basePrice: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  costPrice: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  remainingWarning: {
    color: '#8A5A00',
    backgroundColor: Colors.warningSoft,
    borderRadius: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '400',
    marginTop: Spacing.xs,
    overflow: 'hidden',
  },
  lossWarning: {
    color: Colors.danger,
    backgroundColor: '#FFE8E4',
    borderRadius: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '400',
    marginTop: Spacing.xs,
    overflow: 'hidden',
  },
  missingCostRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  missingCostWarning: {
    color: '#8A5A00',
    backgroundColor: Colors.warningSoft,
    borderRadius: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '400',
    overflow: 'hidden',
  },
  fixCostButton: {
    minHeight: 20,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  fixCostButtonText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '600',
  },
  lineSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  lineSummaryText: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderRadius: 8,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '400',
    overflow: 'hidden',
  },
  lineSummaryLoss: {
    color: Colors.danger,
    backgroundColor: '#FFE8E4',
  },
  rowControls: {
    width: 132,
    alignItems: 'stretch',
    gap: Spacing.sm,
  },
  quantityControl: {
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  qtyButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonText: {
    color: Colors.primaryDark,
    fontSize: 18,
    fontWeight: '600',
  },
  quantityInput: {
    color: Colors.text,
    minWidth: 32,
    height: 28,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '500',
    padding: 0,
  },
  priceInput: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDE8E3',
    backgroundColor: Colors.surface,
    color: Colors.text,
    paddingHorizontal: Spacing.sm,
    fontSize: 13,
    fontWeight: '500',
  },
  priceInputHigh: {
    borderColor: Colors.danger,
    color: Colors.danger,
  },
  priceInputLoss: {
    borderColor: Colors.warning,
    color: '#8A5A00',
    backgroundColor: Colors.warningSoft,
  },
  priceInputFlash: {
    backgroundColor: '#FFE8E4',
    borderColor: Colors.danger,
  },
  floatingCheckout: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: 8,
    borderRadius: 14,
    backgroundColor: Colors.primaryDark,
    padding: Spacing.sm,
    ...cardShadow,
  },
  paymentMethodBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 4,
    gap: 6,
  },
  paymentMethodLabel: {
    color: '#A7E3D1',
    fontSize: 10,
    fontWeight: '500',
  },
  paymentMethodChips: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
  },
  paymentMethodChip: {
    flex: 1,
    minHeight: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  paymentMethodChipActive: {
    borderColor: '#A7E3D1',
    backgroundColor: Colors.white,
  },
  paymentMethodText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '600',
  },
  paymentMethodTextActive: {
    color: Colors.primaryDark,
  },
  creditHint: {
    color: '#FFE8E4',
    fontSize: 11,
    fontWeight: '400',
  },
  creditCustomerBox: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  creditCustomerInput: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: Colors.white,
    paddingHorizontal: Spacing.md,
    fontSize: 13,
    fontWeight: '500',
  },
  simpleCheckoutMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: 6,
  },
  simpleProfit: {
    color: '#A7E3D1',
    fontSize: 12,
    fontWeight: '600',
  },
  todayStatsRow: {
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  todayStatsLabel: {
    color: '#A7E3D1',
    fontSize: 11,
    fontWeight: '500',
  },
  todayStatsValue: {
    color: Colors.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  todayStatsRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  todayStatsMeta: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '400',
  },
  todayStatsProfit: {
    color: '#A7E3D1',
    fontSize: 11,
    fontWeight: '600',
  },
  todayStatsCompact: {
    color: '#A7E3D1',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  checkoutWarningRow: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9,
    padding: Spacing.xs,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  checkoutWarningText: {
    flex: 1,
    color: '#FFE8E4',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '400',
  },
  checkoutWarningButton: {
    minHeight: 26,
    borderRadius: 8,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  checkoutWarningButtonText: {
    color: Colors.primaryDark,
    fontSize: 11,
    fontWeight: '600',
  },
  clearCartButton: {
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  clearCartText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '600',
  },
  lastSaleSummary: {
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  lastSaleLabel: {
    color: '#A7E3D1',
    fontSize: 11,
    fontWeight: '500',
  },
  lastSaleValue: {
    color: Colors.white,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    marginTop: 2,
  },
  lastSaleRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  lastSaleMeta: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '400',
  },
  lastSaleProfit: {
    color: '#A7E3D1',
    fontSize: 11,
    fontWeight: '600',
  },
  undoSaleButton: {
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  undoSaleButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  undoSaleCompact: {
    minHeight: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    marginBottom: 6,
  },
  undoSaleCompactText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '400',
    textAlign: 'center',
  },
  checkoutTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: Spacing.md,
  },
  summaryLabel: {
    color: '#A7E3D1',
    fontSize: 12,
    fontWeight: '500',
  },
  summaryValue: {
    color: Colors.white,
    fontSize: 20,
    lineHeight: 23,
    fontWeight: '600',
    marginTop: 2,
  },
  summaryItems: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  error: {
    color: '#FFE8E4',
    marginBottom: 6,
    textAlign: 'center',
    fontWeight: '600',
  },
  checkoutSaveButton: {
    minHeight: 44,
    borderRadius: 10,
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 30, 24, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  previewCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '86%',
    borderRadius: 18,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    ...cardShadow,
  },
  scanCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    ...cardShadow,
  },
  scanFallbackBox: {
    minHeight: 160,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  scanFallbackText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
  },
  scanStatus: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 10,
    padding: Spacing.sm,
    fontSize: 12,
    fontWeight: '400',
    marginTop: Spacing.md,
  },
  scanManualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  scanManualInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    color: Colors.text,
    paddingHorizontal: Spacing.md,
    fontSize: 13,
    fontWeight: '500',
  },
  scanManualButton: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  scanManualButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  previewEyebrow: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  previewTitle: {
    color: Colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
    marginTop: 2,
  },
  previewCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCloseText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  previewSummary: {
    borderRadius: 14,
    backgroundColor: Colors.primaryDark,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  previewSummaryLabel: {
    color: '#A7E3D1',
    fontSize: 11,
    fontWeight: '500',
  },
  previewSummaryValue: {
    color: Colors.white,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    marginTop: 2,
  },
  previewSummaryRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  previewSummaryMeta: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'right',
  },
  previewCreditCustomer: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 10,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    fontSize: 12,
    fontWeight: '600',
  },
  previewItems: {
    maxHeight: 260,
    marginBottom: Spacing.sm,
  },
  previewItemsContent: {
    gap: Spacing.xs,
  },
  previewItemRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  previewItemInfo: {
    flex: 1,
    minWidth: 0,
  },
  previewItemName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  previewItemMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  previewItemTotal: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  previewProfit: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderRadius: 10,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  previewActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  previewActionButton: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    paddingHorizontal: Spacing.sm,
  },
  notice: {
    color: '#DDF7EC',
    marginBottom: Spacing.md,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '400',
  },
  stockAlertRow: {
    backgroundColor: 'rgba(255, 184, 77, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 184, 77, 0.25)',
    borderRadius: 10,
    padding: Spacing.xs,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  stockAlertText: {
    flex: 1,
    color: '#FFE8B8',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '400',
  },
  stockAlertButton: {
    minHeight: 26,
    borderRadius: 8,
    backgroundColor: '#FFE8B8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  stockAlertButtonText: {
    color: '#624400',
    fontSize: 11,
    fontWeight: '600',
  },
});
