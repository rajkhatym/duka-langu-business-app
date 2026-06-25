import { router, useLocalSearchParams, type Href } from 'expo-router';
import { createElement, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { formatDateTime, formatQuantity } from '@/lib/format';
import { isAnyPreviewMode, isManagerPreviewMode, isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import {
  applyLocalProductOverride,
  applyLocalProductOverrides,
  normalizeProductLookup,
  saveLocalProductOverride,
} from '@/lib/local-product-overrides';
import { getLocalPurchases } from '@/lib/local-purchases';
import { getLocalReportSales } from '@/lib/local-report-sales';
import { getLocalStockMovements } from '@/lib/local-stock-movements';
import { setupDemoProducts } from '@/lib/setup-wizard';
import { supabase } from '@/lib/supabase';
import { isMissingCostPriceError } from '@/lib/supabase-errors';
import { userFacingError } from '@/lib/user-facing-errors';
import type { Product, Purchase, Sale, StockMovement } from '@/types/database';

const QR_PREFIX = 'DLBA:';
const LABEL_PRINT_OPTIONS = [
  { count: 12, columns: 3, rows: 4, qrSizeMm: 30 },
  { count: 24, columns: 3, rows: 8, qrSizeMm: 22 },
  { count: 30, columns: 3, rows: 10, qrSizeMm: 18 },
] as const;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function previewProductById(productId: string, branchId: string): Product | null {
  const match = productId.match(/^preview-product-(\d+)$/);
  const index = match ? Number(match[1]) - 1 : -1;
  const demoProduct = setupDemoProducts[index];
  if (!demoProduct) return null;

  return {
    id: productId,
    branch_id: branchId,
    name: demoProduct.name,
    sku: demoProduct.sku,
    unit: demoProduct.unit,
    category: demoProduct.category ?? null,
    variant_size: null,
    variant_color: null,
    variant_weight: null,
    warranty_months: demoProduct.warranty_months ?? null,
    quantity: demoProduct.quantity,
    reorder_level: demoProduct.reorder_level,
    cost_price: demoProduct.cost_price ?? null,
    unit_price: demoProduct.unit_price ?? null,
    created_by: null,
    created_at: new Date().toISOString(),
  };
}

export default function ProductDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { isAdmin, isOwner } = useAuth();
  const { selectedBranchId } = useBranch();
  const shouldReturnToSales = returnTo === 'sales';
  const ownerPreviewMode = isOwnerPreviewMode();
  const managerPreviewMode = isManagerPreviewMode();

  const [product, setProduct] = useState<Product | null>(null);
  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<Purchase[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [labelPrintCount, setLabelPrintCount] = useState(24);
  const [printSheet, setPrintSheet] = useState<{ css: string; labelsHtml: string } | null>(null);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [variantSize, setVariantSize] = useState('');
  const [variantColor, setVariantColor] = useState('');
  const [variantWeight, setVariantWeight] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState('');
  const [reorderLevel, setReorderLevel] = useState('0');
  const [costPrice, setCostPrice] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  const numericCostPrice = Number(costPrice) || 0;
  const numericUnitPrice = Number(unitPrice) || 0;
  const profitPerUnit = numericUnitPrice - numericCostPrice;
  const profitMargin = numericUnitPrice > 0 ? (profitPerUnit / numericUnitPrice) * 100 : 0;
  const hasLossPrice = numericCostPrice > 0 && numericUnitPrice > 0 && profitPerUnit < 0;
  const recommendedSellingPrice = numericCostPrice > 0 ? Math.round(numericCostPrice * 1.3) : 0;
  const canReturnToSales =
    !shouldReturnToSales || (numericCostPrice > 0 && numericUnitPrice > 0 && !hasLossPrice);
  const selectedMarkup = numericCostPrice > 0
    ? [20, 30, 40].find((markup) => Math.round(numericCostPrice * (1 + markup / 100)) === numericUnitPrice)
    : undefined;
  const applyMarkup = (markup: number) => {
    if (numericCostPrice <= 0) return;
    setUnitPrice(String(Math.round(numericCostPrice * (1 + markup / 100))));
  };
  const qrCodeValue = `${QR_PREFIX}${sku.trim() || product?.sku || id}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(qrCodeValue)}`;

  const ownerRouteParam = ownerPreviewMode ? { owner: 'preview' } : {};
  const ownerQuery = ownerPreviewMode ? '&owner=preview' : managerPreviewMode ? '&manager=preview' : '';

  const sellThisProduct = () => {
    router.replace({
      pathname: '/(tabs)/sales/new',
      params: {
        ...(ownerPreviewMode ? { owner: 'preview' } : {}),
        createdProduct: id,
        createdSku: sku || name,
        createdQty: String(product?.quantity ?? 0),
        createdAt: String(Date.now()),
        selectedExisting: '1',
      },
    });
  };

  const copySku = async () => {
    if (!sku.trim()) {
      setNotice('Bidhaa hii haina SKU ya kunakili.');
      return;
    }
    await copyTextWithNotice(sku.trim(), `SKU ${sku.trim()} imenakiliwa.`, `SKU: ${sku.trim()}`);
  };

  const copyQrCode = async () => {
    await copyTextWithNotice(qrCodeValue, `QR code ${qrCodeValue} imenakiliwa.`, `QR code: ${qrCodeValue}`);
  };

  useEffect(() => {
    if (!printSheet || Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    let cancelled = false;
    let cleanupTimer: number | undefined;
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      setPrintSheet(null);
    };

    const startTimer = window.setTimeout(() => {
      const printRoot = document.querySelector('[data-qr-print-root="true"]');
      if (!printRoot) return;

      const imageLoads = Array.from(printRoot.querySelectorAll('img')).map((image) => {
        if (image.complete && image.naturalWidth > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
      });

      Promise.all(imageLoads).then(() => {
        if (cancelled) return;
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        cleanupTimer = window.setTimeout(cleanup, 30000);
      });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (cleanupTimer) window.clearTimeout(cleanupTimer);
      window.removeEventListener('afterprint', cleanup);
    };
  }, [printSheet]);

  const buildPrintSheet = (count = labelPrintCount) => {
    const layout = LABEL_PRINT_OPTIONS.find((option) => option.count === count) ?? LABEL_PRINT_OPTIONS[1];
    const labelName = escapeHtml(name.trim() || product?.name || 'Bidhaa');
    const labelSku = escapeHtml(sku.trim() || product?.sku || id);
    const labelCode = escapeHtml(qrCodeValue);
    const labelUnit = escapeHtml(unit.trim() || product?.unit || '');
    const qrImage = escapeHtml(qrCodeUrl);
    const labels = Array.from({ length: layout.count }, () => `
        <section class="label">
          <img src="${qrImage}" alt="${labelCode}" />
          <div class="copy">
            <strong>${labelName}</strong>
            <span>SKU: ${labelSku}</span>
            <small>${labelCode}${labelUnit ? ` · ${labelUnit}` : ''}</small>
          </div>
        </section>
      `).join('');
    const css = `
        @page { size: A4; margin: 8mm; }
        @media screen {
          .qr-print-root {
            position: fixed;
            left: -10000px;
            top: 0;
            width: 194mm;
            background: #ffffff;
          }
        }
        @media print {
          html, body {
            margin: 0 !important;
            background: #ffffff !important;
          }
          body * {
            visibility: hidden !important;
          }
          .qr-print-root, .qr-print-root * {
            visibility: visible !important;
          }
          .qr-print-root {
            position: absolute !important;
            left: 8mm !important;
            top: 8mm !important;
            width: 194mm !important;
            min-height: 281mm !important;
            display: grid !important;
            grid-template-columns: repeat(${layout.columns}, 1fr) !important;
            grid-template-rows: repeat(${layout.rows}, 1fr) !important;
            gap: 2mm !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            font-family: Arial, sans-serif !important;
            color: #102A23 !important;
            background: #ffffff !important;
          }
          .qr-print-root .label {
            border: 0.35mm solid #CFE8DE !important;
            border-radius: 2mm !important;
            padding: 2mm !important;
            display: flex !important;
            align-items: center !important;
            gap: 2mm !important;
            overflow: hidden !important;
            break-inside: avoid !important;
            box-sizing: border-box !important;
          }
          .qr-print-root img {
            width: ${layout.qrSizeMm}mm !important;
            height: ${layout.qrSizeMm}mm !important;
            flex: 0 0 auto !important;
          }
          .qr-print-root .copy {
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 1mm !important;
            line-height: 1.1 !important;
          }
          .qr-print-root strong {
            font-size: ${layout.count >= 30 ? 7.5 : 8.5}pt !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
          }
          .qr-print-root span {
            font-size: ${layout.count >= 30 ? 6.5 : 7.5}pt !important;
            font-weight: 700 !important;
          }
          .qr-print-root small {
            font-size: ${layout.count >= 30 ? 5.5 : 6.5}pt !important;
            color: #44645B !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
          }
        }
      `;
    return { css, labelsHtml: labels };
  };

  const openPrintPreview = () => {
    setPrintPreviewOpen(true);
  };

  const printQrLabel = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      setPrintSheet(buildPrintSheet());
      setPrintPreviewOpen(false);
      return;
    }
    setPrintPreviewOpen(false);
    setNotice(`Print label: ${qrCodeValue}`);
  };

  const copyTextWithNotice = async (text: string, successMessage: string, fallbackMessage: string) => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        setNotice(successMessage);
        return;
      } catch {
        setNotice(fallbackMessage);
        return;
      }
    }
    setNotice(fallbackMessage);
  };

  const copyOrderMessage = async () => {
    const message = [
      `Naomba quotation/purchase ya ${name.trim() || 'bidhaa hii'}.`,
      sku.trim() ? `SKU: ${sku.trim()}` : null,
      `Quantity: ${formatQuantity(recommendedPurchaseQuantity)} ${unit.trim() || product?.unit || ''}`.trim(),
      isOwner && numericCostPrice > 0 ? `Estimated cost/unit: TZS ${numericCostPrice.toLocaleString('en-US')}` : null,
      isOwner && numericCostPrice > 0 ? `Estimated total: TZS ${recommendedPurchaseCost.toLocaleString('en-US')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await copyTextWithNotice(message, 'Order message imenakiliwa.', message);
  };

  const restockQuantity = product ? Math.max((product.reorder_level || 1) - product.quantity, 1) : 1;
  const reorderGap = product ? Math.max(product.reorder_level - product.quantity, 0) : 0;
  const isLowStock = Boolean(product && product.reorder_level > 0 && product.quantity <= product.reorder_level);
  const stockCostValue = product ? product.quantity * numericCostPrice : 0;
  const stockSellingValue = product ? product.quantity * numericUnitPrice : 0;
  const stockPotentialProfit = stockSellingValue - stockCostValue;
  const recommendedPurchaseQuantity = product
    ? Math.max(product.reorder_level * 2 - product.quantity, restockQuantity)
    : 0;
  const recommendedPurchaseCost = recommendedPurchaseQuantity * numericCostPrice;
  const salesSummary = recentSales.reduce(
    (acc, sale) => {
      acc.quantity += sale.quantity;
      acc.revenue += sale.quantity * sale.unit_price;
      acc.profit += sale.quantity * (sale.unit_price - (sale.products?.cost_price ?? numericCostPrice));
      return acc;
    },
    { quantity: 0, revenue: 0, profit: 0 }
  );
  const saleTimestamps = recentSales
    .map((sale) => new Date(sale.created_at).getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  const firstSaleTimestamp = saleTimestamps.length > 0 ? Math.min(...saleTimestamps) : 0;
  const salesWindowDays = firstSaleTimestamp > 0 ? Math.max((Date.now() - firstSaleTimestamp) / 86400000, 1) : 0;
  const dailySalesRate = salesWindowDays > 0 ? salesSummary.quantity / salesWindowDays : 0;
  const stockCoverageDays = dailySalesRate > 0 && product ? product.quantity / dailySalesRate : 0;
  const movementSpeed =
    salesSummary.quantity >= 10 ? 'Fast moving' : salesSummary.quantity >= 3 ? 'Inaenda vizuri' : 'Slow moving';
  const movementSpeedTone =
    salesSummary.quantity >= 10 ? 'Hot item' : salesSummary.quantity >= 3 ? 'Stable demand' : 'Needs attention';
  const stockCoverageLabel =
    dailySalesRate > 0 ? `${Math.ceil(stockCoverageDays).toLocaleString('en-US')} siku` : 'Bado hakuna trend';
  const productActionSuggestion = isLowStock
    ? `Ongeza angalau ${formatQuantity(Math.max(reorderGap, 1))} ${product?.unit ?? (unit || '')}.`
    : salesSummary.quantity >= 10
      ? 'Fikiria kuongeza stock kabla haijakaribia reorder level.'
      : salesSummary.quantity === 0
        ? 'Jaribu discount, bundle, au kuionyesha mbele kwenye mauzo.'
        : isOwner
          ? 'Endelea kufuatilia mauzo na margin ya bidhaa hii.'
          : 'Endelea kufuatilia mauzo ya bidhaa hii.';
  const readinessItems = [
    { label: 'SKU imewekwa', done: Boolean(sku.trim()) },
    ...(isOwner ? [{ label: 'Cost price ipo', done: numericCostPrice > 0 }] : []),
    { label: 'Selling price ipo', done: numericUnitPrice > 0 },
    { label: 'Reorder level ipo', done: product ? product.reorder_level > 0 : Number(reorderLevel) > 0 },
    { label: 'Variant/warranty imefafanuliwa', done: Boolean(variantSize.trim() || variantColor.trim() || variantWeight.trim() || warrantyMonths.trim()) },
    { label: 'Stock iko juu ya reorder level', done: !isLowStock },
  ];
  const readinessDoneCount = readinessItems.filter((item) => item.done).length;
  const readinessScore = Math.round((readinessDoneCount / readinessItems.length) * 100);
  const readinessTone =
    readinessScore >= 85 ? 'Bidhaa iko tayari vizuri' : readinessScore >= 60 ? 'Karibu kukamilika' : 'Inahitaji maboresho';
  const priceHealthMessage =
    numericCostPrice <= 0
      ? 'Cost haijawekwa. Profit haiwezi kuhesabiwa vizuri.'
      : numericUnitPrice <= 0
        ? 'Bei ya kuuza haijawekwa.'
        : hasLossPrice
          ? 'Bei ya kuuza iko chini ya cost.'
          : numericUnitPrice < recommendedSellingPrice
            ? 'Bei ya kuuza iko chini ya recommended +30%.'
            : 'Bei na margin zinaonekana vizuri.';
  const priceHealthIsGood =
    numericCostPrice > 0 && numericUnitPrice > 0 && !hasLossPrice && numericUnitPrice >= recommendedSellingPrice;
  const productFormSnapshot = product
    ? {
        name: product.name,
        sku: product.sku ?? '',
        unit: product.unit,
        category: product.category ?? '',
        variantSize: product.variant_size ?? '',
        variantColor: product.variant_color ?? '',
        variantWeight: product.variant_weight ?? '',
        warrantyMonths: product.warranty_months != null ? String(product.warranty_months) : '',
        reorderLevel: String(product.reorder_level),
        costPrice: product.cost_price != null ? String(product.cost_price) : '',
        unitPrice: product.unit_price != null ? String(product.unit_price) : '',
      }
    : null;
  const hasUnsavedChanges = Boolean(
    productFormSnapshot &&
      (name !== productFormSnapshot.name ||
        sku !== productFormSnapshot.sku ||
        unit !== productFormSnapshot.unit ||
        category !== productFormSnapshot.category ||
        variantSize !== productFormSnapshot.variantSize ||
        variantColor !== productFormSnapshot.variantColor ||
        variantWeight !== productFormSnapshot.variantWeight ||
        warrantyMonths !== productFormSnapshot.warrantyMonths ||
        reorderLevel !== productFormSnapshot.reorderLevel ||
        costPrice !== productFormSnapshot.costPrice ||
        unitPrice !== productFormSnapshot.unitPrice)
  );

  const restoreProductForm = () => {
    if (!productFormSnapshot) return;
    setName(productFormSnapshot.name);
    setSku(productFormSnapshot.sku);
    setUnit(productFormSnapshot.unit);
    setCategory(productFormSnapshot.category);
    setVariantSize(productFormSnapshot.variantSize);
    setVariantColor(productFormSnapshot.variantColor);
    setVariantWeight(productFormSnapshot.variantWeight);
    setWarrantyMonths(productFormSnapshot.warrantyMonths);
    setReorderLevel(productFormSnapshot.reorderLevel);
    setCostPrice(productFormSnapshot.costPrice);
    setUnitPrice(productFormSnapshot.unitPrice);
    setError(null);
    setNotice('Mabadiliko ambayo hayajahifadhiwa yamerudishwa.');
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('products').select('*').eq('id', id).single();
      const fallbackProduct = isAnyPreviewMode() ? previewProductById(id, selectedBranchId) : null;
      const p = applyLocalProductOverride((data as Product | null) ?? fallbackProduct);
      if (p) {
        setProduct(p);
        setName(p.name);
        setSku(p.sku ?? '');
        setUnit(p.unit);
        setCategory(p.category ?? '');
        setVariantSize(p.variant_size ?? '');
        setVariantColor(p.variant_color ?? '');
        setVariantWeight(p.variant_weight ?? '');
        setWarrantyMonths(p.warranty_months != null ? String(p.warranty_months) : '');
        setReorderLevel(String(p.reorder_level));
        setCostPrice(p.cost_price != null ? String(p.cost_price) : '');
        setUnitPrice(p.unit_price != null ? String(p.unit_price) : '');
      }
      let movementData: StockMovement[] = [];
      const { data: stockData } = await supabase
        .from('stock_movements')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .eq('product_id', id)
        .order('created_at', { ascending: false })
        .limit(5);
      movementData = (stockData as unknown as StockMovement[]) ?? [];

      if (ownerPreviewMode) {
        const localMovements = await getLocalStockMovements(selectedBranchId);
        const productLocalMovements = localMovements.filter((movement) => movement.product_id === id);
        movementData = [...productLocalMovements, ...movementData].slice(0, 5);
      }
      setRecentMovements(movementData);

      let purchaseData: Purchase[] = [];
      const { data: stockPurchaseData } = await supabase
        .from('purchases')
        .select('*, products(id,name,unit,sku)')
        .eq('product_id', id)
        .order('created_at', { ascending: false })
        .limit(5);
      purchaseData = (stockPurchaseData as unknown as Purchase[]) ?? [];

      if (ownerPreviewMode) {
        const localPurchases = await getLocalPurchases(selectedBranchId);
        const productLocalPurchases = localPurchases.filter((purchase) => purchase.product_id === id);
        purchaseData = [...productLocalPurchases, ...purchaseData].slice(0, 5);
      }
      setRecentPurchases(purchaseData);

      let salesData: Sale[] = [];
      const { data: stockSalesData } = await supabase
        .from('sales')
        .select('*, products(id,name,unit,sku,cost_price,warranty_months), profiles(id,full_name)')
        .eq('product_id', id)
        .order('created_at', { ascending: false })
        .limit(5);
      salesData = (stockSalesData as unknown as Sale[]) ?? [];

      if (ownerPreviewMode) {
        const localSales = await getLocalReportSales(new Date(0), selectedBranchId);
        const productLocalSales = localSales.filter((sale) => sale.product_id === id);
        salesData = [...productLocalSales, ...salesData].slice(0, 5);
      }
      setRecentSales(salesData);
      setLoading(false);
    })();
  }, [id, ownerPreviewMode, selectedBranchId]);

  const onSave = async () => {
    if (!name.trim() || !unit.trim()) {
      setError('Tafadhali jaza jina la bidhaa na kipimo (unit)');
      return;
    }
    if (shouldReturnToSales && numericCostPrice <= 0) {
      setError('Tafadhali jaza bei ya manunuzi ili profit ihesabiwe vizuri kwenye mauzo.');
      return;
    }
    if (shouldReturnToSales && numericUnitPrice <= 0) {
      setError('Tafadhali jaza bei ya kuuza kabla ya kurudi kwenye mauzo.');
      return;
    }
    if (shouldReturnToSales && hasLossPrice) {
      setError('Bei ya kuuza iko chini ya bei ya manunuzi. Rekebisha kwanza ili usiuze kwa loss.');
      return;
    }
    setError(null);
    setSaving(true);

    const productPayload = {
      name: name.trim(),
      sku: sku.trim() || null,
      unit: unit.trim(),
      category: category.trim() || null,
      variant_size: variantSize.trim() || null,
      variant_color: variantColor.trim() || null,
      variant_weight: variantWeight.trim() || null,
      warranty_months: warrantyMonths.trim() ? Number(warrantyMonths) : null,
      reorder_level: Number(reorderLevel) || 0,
      cost_price: costPrice.trim() ? Number(costPrice) : null,
      unit_price: unitPrice.trim() ? Number(unitPrice) : null,
    };

    const normalizedSku = normalizeProductLookup(productPayload.sku);
    if (normalizedSku) {
      const { data: existingData } = await supabase.from('products').select('*');
      const existingProducts = applyLocalProductOverrides((existingData as Product[]) ?? []);
      const duplicateProduct = existingProducts.find(
        (nextProduct) => nextProduct.id !== id && normalizeProductLookup(nextProduct.sku) === normalizedSku
      );

      if (duplicateProduct) {
        setSaving(false);
        setError(`SKU hii tayari ipo kwenye ${duplicateProduct.name}. Tumia SKU nyingine.`);
        return;
      }
    }

    const returnToSalesParams = {
      ...(ownerPreviewMode ? { owner: 'preview' } : {}),
      updatedProduct: id,
      updatedAt: String(Date.now()),
    };

    if (ownerPreviewMode) {
      saveLocalProductOverride(id, productPayload);
      setProduct((currentProduct) => (currentProduct ? { ...currentProduct, ...productPayload } : currentProduct));
      setSaving(false);
      if (shouldReturnToSales) {
        router.replace({
          pathname: '/(tabs)/sales/new',
          params: { ...returnToSalesParams, local: '1' },
        });
        return;
      }
      setNotice('Mabadiliko yamehifadhiwa kwenye preview.');
      return;
    }

    let { error: updateError } = await supabase.from('products').update(productPayload).eq('id', id);

    if (isMissingCostPriceError(updateError)) {
      const { cost_price: _costPrice, ...fallbackPayload } = productPayload;
      const fallbackResult = await supabase.from('products').update(fallbackPayload).eq('id', id);
      updateError = fallbackResult.error;
    }

    if (updateError?.message.includes('variant_') || updateError?.message.includes('warranty_months')) {
      const {
        variant_size: _variantSize,
        variant_color: _variantColor,
        variant_weight: _variantWeight,
        warranty_months: _warrantyMonths,
        ...fallbackPayload
      } = productPayload;
      const fallbackResult = await supabase.from('products').update(fallbackPayload).eq('id', id);
      updateError = fallbackResult.error;
    }

    setSaving(false);

    if (updateError) {
      setError(userFacingError(updateError.message));
      return;
    }

    if (shouldReturnToSales) {
      router.replace({
        pathname: '/(tabs)/sales/new',
        params: returnToSalesParams,
      });
      return;
    }

    router.back();
  };

  const onDelete = () => {
    Alert.alert('Futa Bidhaa', `Una hakika unataka kufuta "${product?.name}"?`, [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Futa',
        style: 'destructive',
        onPress: async () => {
          const { error: deleteError } = await supabase.from('products').delete().eq('id', id);
          if (deleteError) {
            Alert.alert('Hitilafu', deleteError.message);
            return;
          }
          router.back();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>Bidhaa haipatikani</Text>
      </View>
    );
  }

  return (
    <>
      {Platform.OS === 'web' && printSheet
        ? createElement('style', {
            dangerouslySetInnerHTML: { __html: printSheet.css },
          })
        : null}
      {Platform.OS === 'web' && printSheet
        ? createElement('main', {
            className: 'qr-print-root',
            'data-qr-print-root': 'true',
            dangerouslySetInnerHTML: { __html: printSheet.labelsHtml },
          })
        : null}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.quantityBox}>
          <Text style={styles.quantityLabel}>Stock Iliyopo</Text>
          <Text style={styles.quantityValue}>
            {formatQuantity(product.quantity)} {product.unit}
          </Text>
          <Text style={styles.quantityHint}>
            Kiasi hubadilika kupitia &quot;Stock In/Out&quot; pekee.
          </Text>
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {hasUnsavedChanges ? (
          <Text style={styles.unsavedNotice}>Una mabadiliko ambayo bado hayajahifadhiwa.</Text>
        ) : null}

        <View style={styles.identityPanel}>
          <View style={styles.identityTop}>
            <View>
              <Text style={styles.identityTitle}>Product identity</Text>
              <Text style={styles.identitySubtitle}>{sku.trim() || 'Hakuna SKU'}</Text>
            </View>
            <Pressable style={styles.copySkuButton} onPress={copySku}>
              <Text style={styles.copySkuText}>Copy SKU</Text>
            </Pressable>
          </View>
          <View style={styles.identityGrid}>
            <View style={styles.identityItem}>
              <Text style={styles.identityLabel}>Category</Text>
              <Text style={styles.identityValue}>{category.trim() || '-'}</Text>
            </View>
            <View style={styles.identityItem}>
              <Text style={styles.identityLabel}>Size</Text>
              <Text style={styles.identityValue}>{variantSize.trim() || '-'}</Text>
            </View>
            <View style={styles.identityItem}>
              <Text style={styles.identityLabel}>Rangi</Text>
              <Text style={styles.identityValue}>{variantColor.trim() || '-'}</Text>
            </View>
            <View style={styles.identityItem}>
              <Text style={styles.identityLabel}>Uzito</Text>
              <Text style={styles.identityValue}>{variantWeight.trim() || '-'}</Text>
            </View>
            <View style={styles.identityItem}>
              <Text style={styles.identityLabel}>Warranty</Text>
              <Text style={styles.identityValue}>{warrantyMonths.trim() ? `${warrantyMonths} miezi` : '-'}</Text>
            </View>
            <View style={styles.identityItem}>
              <Text style={styles.identityLabel}>Unit</Text>
              <Text style={styles.identityValue}>{unit.trim() || '-'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.qrPanel}>
          <View style={styles.qrTop}>
            <View style={styles.qrCopy}>
              <Text style={styles.qrTitle}>QR ya bidhaa</Text>
              <Text style={styles.qrSubtitle}>{qrCodeValue}</Text>
            </View>
            <Image source={{ uri: qrCodeUrl }} style={styles.qrImage} resizeMode="contain" />
          </View>
          <View style={styles.qrActions}>
            <Pressable style={styles.qrButton} onPress={copyQrCode}>
              <Text style={styles.qrButtonText}>Copy QR code</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Preview QR labels A4"
              style={[styles.qrButton, styles.qrButtonPrimary]}
              onPress={openPrintPreview}>
              <Text style={[styles.qrButtonText, styles.qrButtonTextPrimary]}>Preview A4 ({labelPrintCount})</Text>
            </Pressable>
          </View>
          <View style={styles.labelOptionRow}>
            <Text style={styles.labelOptionTitle}>Labels kwenye A4</Text>
            <View style={styles.labelOptions}>
              {LABEL_PRINT_OPTIONS.map((option) => {
                const selected = labelPrintCount === option.count;
                return (
                  <Pressable
                    key={option.count}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.count} labels kwenye A4`}
                    style={[styles.labelOption, selected && styles.labelOptionActive]}
                    onPress={() => setLabelPrintCount(option.count)}>
                    <Text style={[styles.labelOptionText, selected && styles.labelOptionTextActive]}>
                      {option.count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.readinessPanel}>
          <View style={styles.readinessTop}>
            <View>
              <Text style={styles.readinessTitle}>Product readiness</Text>
              <Text style={styles.readinessSubtitle}>{readinessTone}</Text>
            </View>
            <View style={[styles.readinessScoreBadge, readinessScore < 60 && styles.readinessScoreBadgeWarning]}>
              <Text style={[styles.readinessScoreText, readinessScore < 60 && styles.readinessScoreTextWarning]}>
                {readinessScore}%
              </Text>
            </View>
          </View>
          <View style={styles.readinessGrid}>
            {readinessItems.map((item) => (
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

        <View style={styles.actionPanel}>
          <Text style={styles.actionTitle}>Hatua za haraka</Text>
          <View style={styles.actionGrid}>
            <Pressable style={[styles.actionButton, styles.actionButtonPrimary]} onPress={sellThisProduct}>
              <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>Uza bidhaa hii</Text>
            </Pressable>
            {isOwner ? (
              <>
                <Pressable
                  style={styles.actionButton}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/movements/new',
                      params: {
                        productId: id,
                        type: 'IN',
                        qty: String(restockQuantity),
                        returnTo: 'product',
                        ...ownerRouteParam,
                      },
                    })
                  }>
                  <Text style={styles.actionButtonText}>Ongeza stock</Text>
                </Pressable>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => router.push(`/(tabs)/movements/stock-count?productId=${id}${ownerQuery}` as Href)}>
                  <Text style={styles.actionButtonText}>Stock count</Text>
                </Pressable>
              </>
            ) : null}
            {isAdmin ? (
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push(`/(tabs)/movements/transfer?productId=${id}${ownerQuery}` as Href)}>
                <Text style={styles.actionButtonText}>Transfer branch</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.documentsPanel}>
          <View style={styles.documentsTop}>
            <View>
              <Text style={styles.documentsTitle}>Business documents</Text>
              <Text style={styles.documentsSubtitle}>Tengeneza document ikiwa imejaza bidhaa hii tayari.</Text>
            </View>
          </View>
          <View style={styles.documentsGrid}>
            {(['quotation', 'proforma', 'invoice'] as const).map((documentType) => (
              <Pressable
                key={documentType}
                style={styles.documentButton}
                onPress={() =>
                  router.push(
                    `/(tabs)/finance/quotations?productId=${id}&documentType=${documentType}&qty=1&price=${
                      numericUnitPrice || product.unit_price || 0
                    }${ownerQuery}` as Href
                  )
                }>
                <Text style={styles.documentButtonText}>
                  {documentType === 'quotation' ? 'Quotation' : documentType === 'proforma' ? 'Proforma' : 'Invoice'}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.documentButton, styles.documentButtonWarning]}
              onPress={() =>
                router.push(`/(tabs)/finance/warranty-claims?productId=${id}${ownerQuery}` as Href)
              }>
              <Text style={[styles.documentButtonText, styles.documentButtonTextWarning]}>Warranty claim</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.stockStatusPanel, isLowStock && styles.stockStatusPanelDanger]}>
          <View style={styles.stockStatusTop}>
            <View>
              <Text style={[styles.stockStatusTitle, isLowStock && styles.stockStatusTitleDanger]}>
                {isLowStock ? 'Stock pungufu' : 'Stock iko sawa'}
              </Text>
              <Text style={styles.stockStatusText}>
                Reorder level: {formatQuantity(product.reorder_level)} {product.unit}
              </Text>
            </View>
            {isLowStock && isOwner ? (
              <Pressable
                style={styles.stockStatusButton}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/movements/new',
                    params: {
                      productId: id,
                      type: 'IN',
                      qty: String(Math.max(reorderGap, 1)),
                      returnTo: 'product',
                      ...ownerRouteParam,
                    },
                  })
                }>
                <Text style={styles.stockStatusButtonText}>Ongeza {formatQuantity(Math.max(reorderGap, 1))}</Text>
              </Pressable>
            ) : null}
          </View>
          {isLowStock ? (
            <Text style={styles.stockStatusHint}>
              Inahitaji angalau {formatQuantity(Math.max(reorderGap, 1))} {product.unit} kufika reorder level.
            </Text>
          ) : (
            <Text style={styles.stockStatusHint}>Bidhaa hii ipo juu ya kiwango cha chini.</Text>
          )}
        </View>

        <View style={styles.purchaseRecommendationPanel}>
          <View style={styles.purchaseRecommendationTop}>
            <View>
              <Text style={styles.purchaseRecommendationTitle}>Purchase recommendation</Text>
              <Text style={styles.purchaseRecommendationText}>
                Nunua {formatQuantity(recommendedPurchaseQuantity)} {product.unit} kufikisha stock karibu na 2x reorder level.
              </Text>
            </View>
            <View style={styles.purchaseRecommendationActions}>
              <Pressable style={styles.purchaseRecommendationCopyButton} onPress={copyOrderMessage}>
                <Text style={styles.purchaseRecommendationCopyText}>Copy order</Text>
              </Pressable>
              {isOwner ? (
                <Pressable
                  style={styles.purchaseRecommendationButton}
                  onPress={() =>
                    router.push(
                      `/(tabs)/movements/purchase?productId=${id}&qty=${recommendedPurchaseQuantity}&cost=${numericCostPrice}&returnTo=product${
                        ownerPreviewMode ? '&owner=preview' : ''
                      }` as Href
                    )
                  }>
                  <Text style={styles.purchaseRecommendationButtonText}>Purchase</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <View style={styles.purchaseRecommendationStats}>
            {isOwner ? (
              <View style={styles.purchaseRecommendationStat}>
                <Text style={styles.purchaseRecommendationLabel}>Estimated cost</Text>
                <Text style={styles.purchaseRecommendationValue}>
                  TZS {recommendedPurchaseCost.toLocaleString('en-US')}
                </Text>
              </View>
            ) : null}
            <View style={styles.purchaseRecommendationStat}>
              <Text style={styles.purchaseRecommendationLabel}>After purchase</Text>
              <Text style={styles.purchaseRecommendationValue}>
                {formatQuantity(product.quantity + recommendedPurchaseQuantity)} {product.unit}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.purchaseHistoryPanel}>
          <View style={styles.purchaseHistoryTop}>
            <Text style={styles.purchaseHistoryTitle}>Purchase history</Text>
            <Text style={styles.purchaseHistoryCount}>{recentPurchases.length} recent</Text>
          </View>
          {recentPurchases.length === 0 ? (
            <Text style={styles.purchaseHistoryEmpty}>Hakuna purchase history ya bidhaa hii bado.</Text>
          ) : (
            recentPurchases.map((purchase) => {
              const purchaseTotal = purchase.quantity * purchase.cost_price;
              const purchaseBalance = Math.max(purchaseTotal - purchase.amount_paid, 0);
              return (
                <View key={purchase.id} style={styles.purchaseHistoryRow}>
                  <View style={styles.purchaseHistoryInfo}>
                    <Text style={styles.purchaseHistorySupplier}>{purchase.supplier_name}</Text>
                    <Text style={styles.purchaseHistoryMeta}>
                      {formatDateTime(purchase.created_at)} · {purchase.invoice_number ?? 'No invoice'}
                    </Text>
                    <Text style={styles.purchaseHistoryMeta}>
                      {formatQuantity(purchase.quantity)} {product.unit} @ TZS {purchase.cost_price.toLocaleString('en-US')}
                    </Text>
                  </View>
                  <View style={styles.purchaseHistoryAmountBlock}>
                    <Text style={styles.purchaseHistoryTotal}>TZS {purchaseTotal.toLocaleString('en-US')}</Text>
                    <Text
                      style={[
                        styles.purchaseHistoryStatus,
                        purchaseBalance > 0 && styles.purchaseHistoryStatusDebt,
                      ]}>
                      {purchaseBalance > 0 ? `Bal ${purchaseBalance.toLocaleString('en-US')}` : 'Paid'}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {isOwner ? (
        <View style={styles.profitSnapshotPanel}>
          <Text style={styles.profitSnapshotTitle}>Profit snapshot</Text>
          <View style={[styles.priceHealthBox, !priceHealthIsGood && styles.priceHealthBoxWarning]}>
            <Text style={[styles.priceHealthText, !priceHealthIsGood && styles.priceHealthTextWarning]}>
              {priceHealthMessage}
            </Text>
            {numericCostPrice > 0 ? (
              <Text style={styles.priceHealthHint}>
                Recommended +30%: TZS {recommendedSellingPrice.toLocaleString('en-US')}
              </Text>
            ) : null}
          </View>
          <View style={styles.profitSnapshotGrid}>
            <View style={styles.profitSnapshotCard}>
              <Text style={styles.profitSnapshotLabel}>Cost</Text>
              <Text style={styles.profitSnapshotValue}>TZS {numericCostPrice.toLocaleString('en-US')}</Text>
            </View>
            <View style={styles.profitSnapshotCard}>
              <Text style={styles.profitSnapshotLabel}>Bei ya kuuza</Text>
              <Text style={styles.profitSnapshotValue}>TZS {numericUnitPrice.toLocaleString('en-US')}</Text>
            </View>
            <View style={styles.profitSnapshotCard}>
              <Text style={styles.profitSnapshotLabel}>Profit / unit</Text>
              <Text style={[styles.profitSnapshotValue, profitPerUnit < 0 && styles.profitSnapshotLoss]}>
                TZS {profitPerUnit.toLocaleString('en-US')}
              </Text>
            </View>
            <View style={styles.profitSnapshotCard}>
              <Text style={styles.profitSnapshotLabel}>Margin</Text>
              <Text style={[styles.profitSnapshotValue, profitPerUnit < 0 && styles.profitSnapshotLoss]}>
                {profitMargin.toFixed(1)}%
              </Text>
            </View>
          </View>
          <View style={styles.stockValueRow}>
            <View style={styles.stockValueItem}>
              <Text style={styles.profitSnapshotLabel}>Stock cost value</Text>
              <Text style={styles.stockValueText}>TZS {stockCostValue.toLocaleString('en-US')}</Text>
            </View>
            <View style={styles.stockValueDivider} />
            <View style={styles.stockValueItem}>
              <Text style={styles.profitSnapshotLabel}>Potential profit</Text>
              <Text style={[styles.stockValueText, stockPotentialProfit < 0 && styles.profitSnapshotLoss]}>
                TZS {stockPotentialProfit.toLocaleString('en-US')}
              </Text>
            </View>
          </View>
          {numericCostPrice > 0 ? (
            <View style={styles.snapshotMarkupRow}>
              <Text style={styles.snapshotMarkupLabel}>Quick markup:</Text>
              {[20, 30, 40].map((markup) => (
                <Pressable
                  key={`snapshot-${markup}`}
                  style={[styles.snapshotMarkupButton, selectedMarkup === markup && styles.snapshotMarkupButtonActive]}
                  onPress={() => applyMarkup(markup)}>
                  <Text
                    style={[
                      styles.snapshotMarkupText,
                      selectedMarkup === markup && styles.snapshotMarkupTextActive,
                    ]}>
                    +{markup}%
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        ) : null}

        <View style={styles.salesHistoryPanel}>
          <View style={styles.salesHistoryTop}>
            <Text style={styles.salesHistoryTitle}>Sales history</Text>
            <Pressable onPress={() => router.push(`/(tabs)/sales${ownerPreviewMode ? '?owner=preview' : ''}` as Href)}>
              <Text style={styles.salesHistoryLink}>Zote</Text>
            </Pressable>
          </View>
          <View style={styles.salesSummaryGrid}>
            <View style={styles.salesSummaryCard}>
              <Text style={styles.salesSummaryLabel}>Units sold</Text>
              <Text style={styles.salesSummaryValue}>{formatQuantity(salesSummary.quantity)}</Text>
            </View>
            <View style={styles.salesSummaryCard}>
              <Text style={styles.salesSummaryLabel}>Revenue</Text>
              <Text style={styles.salesSummaryValue}>TZS {salesSummary.revenue.toLocaleString('en-US')}</Text>
            </View>
            {isOwner ? (
              <View style={styles.salesSummaryCard}>
                <Text style={styles.salesSummaryLabel}>Profit</Text>
                <Text style={[styles.salesSummaryValue, salesSummary.profit < 0 && styles.salesSummaryLoss]}>
                  TZS {salesSummary.profit.toLocaleString('en-US')}
                </Text>
              </View>
            ) : null}
          </View>
          {recentSales.length === 0 ? (
            <Text style={styles.salesHistoryEmpty}>Hakuna mauzo ya hivi karibuni kwa bidhaa hii.</Text>
          ) : (
            recentSales.map((sale) => {
              const saleProfit = sale.quantity * (sale.unit_price - (sale.products?.cost_price ?? numericCostPrice));
              return (
                <View key={sale.id} style={styles.salesHistoryRow}>
                  <View style={styles.salesHistoryInfo}>
                    <Text style={styles.salesHistoryCustomer}>{sale.customer_name || 'Mteja wa kawaida'}</Text>
                    <Text style={styles.salesHistoryMeta}>{formatDateTime(sale.created_at)}</Text>
                    <Text style={styles.salesHistoryMeta}>
                      {formatQuantity(sale.quantity)} {product.unit} @ TZS {sale.unit_price.toLocaleString('en-US')}
                    </Text>
                  </View>
                  <View style={styles.salesHistoryAmountBlock}>
                    <Text style={styles.salesHistoryTotal}>
                      TZS {(sale.quantity * sale.unit_price).toLocaleString('en-US')}
                    </Text>
                    {isOwner ? (
                      <Text style={[styles.salesHistoryProfit, saleProfit < 0 && styles.salesSummaryLoss]}>
                        Profit {saleProfit.toLocaleString('en-US')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.performancePanel}>
          <View style={styles.performanceTop}>
            <View>
              <Text style={styles.performanceTitle}>Performance insights</Text>
              <Text style={styles.performanceSubtitle}>{movementSpeedTone}</Text>
            </View>
            <View style={[styles.performanceBadge, isLowStock && styles.performanceBadgeWarning]}>
              <Text style={[styles.performanceBadgeText, isLowStock && styles.performanceBadgeTextWarning]}>
                {movementSpeed}
              </Text>
            </View>
          </View>
          <View style={styles.performanceGrid}>
            <View style={styles.performanceCard}>
              <Text style={styles.performanceLabel}>Avg sales/day</Text>
              <Text style={styles.performanceValue}>{dailySalesRate.toFixed(1)} {product.unit}</Text>
            </View>
            <View style={styles.performanceCard}>
              <Text style={styles.performanceLabel}>Stock coverage</Text>
              <Text style={styles.performanceValue}>{stockCoverageLabel}</Text>
            </View>
            <View style={styles.performanceCard}>
              <Text style={styles.performanceLabel}>Recent revenue</Text>
              <Text style={styles.performanceValue}>TZS {salesSummary.revenue.toLocaleString('en-US')}</Text>
            </View>
            {isOwner ? (
              <View style={styles.performanceCard}>
                <Text style={styles.performanceLabel}>Recent margin</Text>
                <Text style={[styles.performanceValue, salesSummary.profit < 0 && styles.performanceLoss]}>
                  TZS {salesSummary.profit.toLocaleString('en-US')}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.performanceSuggestion}>{productActionSuggestion}</Text>
        </View>

        <View style={styles.recentPanel}>
          <View style={styles.recentTop}>
            <Text style={styles.recentTitle}>Recent movements</Text>
            <Pressable onPress={() => router.push(`/(tabs)/movements${ownerPreviewMode ? '?owner=preview' : ''}` as Href)}>
              <Text style={styles.recentLink}>Zote</Text>
            </Pressable>
          </View>
          {recentMovements.length === 0 ? (
            <Text style={styles.recentEmpty}>Hakuna movement ya hivi karibuni kwa bidhaa hii.</Text>
          ) : (
            recentMovements.map((movement) => (
              <View key={movement.id} style={styles.recentRow}>
                <View style={styles.recentInfo}>
                  <Text style={styles.recentType}>{movement.type === 'IN' ? 'Stock In' : 'Stock Out'}</Text>
                  <Text style={styles.recentMeta}>{formatDateTime(movement.created_at)}</Text>
                  {movement.note ? <Text style={styles.recentNote}>{movement.note}</Text> : null}
                </View>
                <Text style={[styles.recentQty, movement.type === 'OUT' && styles.recentQtyOut]}>
                  {movement.type === 'IN' ? '+' : '-'}
                  {formatQuantity(movement.quantity)} {product.unit}
                </Text>
              </View>
            ))
          )}
        </View>

        {shouldReturnToSales ? (
          <Text style={styles.returnNotice}>
            Umetoka kwenye mauzo. Jaza bei ya manunuzi kisha hifadhi, tutakurudisha kuuza.
          </Text>
        ) : null}

        {shouldReturnToSales ? (
          <View style={styles.priceFocusPanel}>
            <Text style={styles.priceFocusTitle}>Profit setup</Text>
            <TextField
              label="Bei ya Manunuzi kwa kipimo"
              value={costPrice}
              onChangeText={setCostPrice}
              keyboardType="numeric"
              autoFocus={shouldReturnToSales && !costPrice.trim()}
              returnKeyType="next"
              style={!costPrice.trim() ? styles.focusInput : undefined}
            />
            {!costPrice.trim() ? (
              <Text style={styles.costHint}>
                Jaza bei uliyonunulia bidhaa hii. Hii ndiyo itatumika kuhesabu profit kwenye mauzo.
              </Text>
            ) : null}
            {numericCostPrice > 0 ? (
              <View style={styles.markupRow}>
                <Text style={styles.markupLabel}>Set selling price:</Text>
                {[20, 30, 40].map((markup) => (
                  <Pressable
                    key={markup}
                    style={[styles.markupButton, selectedMarkup === markup && styles.markupButtonActive]}
                    onPress={() => applyMarkup(markup)}>
                    <Text
                      style={[
                        styles.markupButtonText,
                        selectedMarkup === markup && styles.markupButtonTextActive,
                      ]}>
                      +{markup}%
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <TextField
              label="Bei ya Kuuza kwa kipimo"
              value={unitPrice}
              onChangeText={setUnitPrice}
              keyboardType="numeric"
              returnKeyType="done"
            />
            {isOwner && numericCostPrice > 0 && numericUnitPrice > 0 ? (
              <View style={styles.profitPreview}>
                <Text style={styles.profitPreviewLabel}>Profit kwa kipimo</Text>
                <Text style={[styles.profitPreviewValue, profitPerUnit < 0 && styles.profitPreviewLoss]}>
                  TZS {profitPerUnit.toLocaleString('en-US')} · {profitMargin.toFixed(1)}%
                </Text>
                {profitPerUnit < 0 ? (
                  <Text style={styles.profitPreviewHint}>Selling price iko chini ya manunuzi.</Text>
                ) : null}
              </View>
            ) : null}
            {shouldReturnToSales && numericCostPrice <= 0 ? (
              <Text style={styles.requiredHint}>Bei ya manunuzi inahitajika kabla ya kurudi kuuza.</Text>
            ) : null}
            {isOwner && shouldReturnToSales && hasLossPrice ? (
              <Text style={styles.requiredHint}>Rekebisha selling price, ipo chini ya manunuzi.</Text>
            ) : null}
            {isOwner && shouldReturnToSales && numericCostPrice > 0 ? (
              <View style={styles.priceGuide}>
                <Text style={styles.priceGuideText}>
                  Minimum: TZS {numericCostPrice.toLocaleString('en-US')} · Recommended +30%: TZS{' '}
                  {recommendedSellingPrice.toLocaleString('en-US')}
                </Text>
                {numericUnitPrice < recommendedSellingPrice ? (
                  <Pressable style={styles.recommendedButton} onPress={() => setUnitPrice(String(recommendedSellingPrice))}>
                    <Text style={styles.recommendedButtonText}>Tumia recommended</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={styles.saveReadiness}>
              <Text style={styles.saveReadinessTitle}>Tayari kurudi kuuza?</Text>
              <Text style={[styles.saveReadinessItem, numericCostPrice > 0 && styles.saveReadinessDone]}>
                {numericCostPrice > 0 ? '✓' : '•'} Bei ya manunuzi imejazwa
              </Text>
              <Text style={[styles.saveReadinessItem, numericUnitPrice > 0 && styles.saveReadinessDone]}>
                {numericUnitPrice > 0 ? '✓' : '•'} Bei ya kuuza imejazwa
              </Text>
              {hasLossPrice ? (
                <Text style={styles.saveReadinessBlocker}>• Selling price isiwe chini ya manunuzi</Text>
              ) : null}
            </View>
            <Button
              label="Hifadhi na Rudi Kuuza"
              onPress={onSave}
              loading={saving}
              disabled={!canReturnToSales}
              style={styles.quickSaveButton}
            />
            <Button
              label="Rudi bila kuhifadhi"
              onPress={() => router.replace(ownerPreviewMode ? '/(tabs)/sales/new?owner=preview' : '/(tabs)/sales/new')}
              variant="secondary"
              style={styles.cancelReturnButton}
            />
          </View>
        ) : null}

        <TextField label="Jina la Bidhaa *" value={name} onChangeText={setName} />
        <TextField label="SKU / Namba ya Bidhaa" value={sku} onChangeText={setSku} />
        <TextField label="Kipimo (unit) *" value={unit} onChangeText={setUnit} />
        <TextField label="Jamii (Category)" value={category} onChangeText={setCategory} />
        <TextField label="Size / Ukubwa" value={variantSize} onChangeText={setVariantSize} />
        <TextField label="Rangi" value={variantColor} onChangeText={setVariantColor} />
        <TextField label="Uzito / Variant" value={variantWeight} onChangeText={setVariantWeight} />
        <TextField
          label="Warranty (miezi)"
          value={warrantyMonths}
          onChangeText={setWarrantyMonths}
          keyboardType="numeric"
        />
        <TextField
          label="Kiwango cha chini (Reorder level)"
          value={reorderLevel}
          onChangeText={setReorderLevel}
          keyboardType="numeric"
        />
        {!shouldReturnToSales ? (
          <>
            {isOwner ? (
              <TextField
                label="Bei ya Manunuzi kwa kipimo"
                value={costPrice}
                onChangeText={setCostPrice}
                keyboardType="numeric"
                returnKeyType="next"
              />
            ) : null}
            <TextField
              label="Bei ya Kuuza kwa kipimo"
              value={unitPrice}
              onChangeText={setUnitPrice}
              keyboardType="numeric"
              returnKeyType="done"
            />
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!shouldReturnToSales ? (
          <>
            <Button
              label={hasUnsavedChanges ? 'Hifadhi Mabadiliko' : 'Hakuna mabadiliko'}
              onPress={onSave}
              loading={saving}
              disabled={!hasUnsavedChanges}
            />
            {hasUnsavedChanges ? (
              <Button
                label="Rudisha mabadiliko"
                onPress={restoreProductForm}
                variant="secondary"
                style={styles.restoreButton}
              />
            ) : null}
          </>
        ) : null}

        {isOwner ? (
          <Button label="Futa Bidhaa" onPress={onDelete} variant="danger" style={styles.deleteButton} />
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
      {printPreviewOpen ? (
        <View style={[styles.printPreviewOverlay, Platform.OS === 'web' && styles.printPreviewOverlayWeb]}>
          <Pressable style={styles.printPreviewScrim} onPress={() => setPrintPreviewOpen(false)} />
          <View style={styles.printPreviewPanel}>
            <View style={styles.printPreviewHeader}>
              <View style={styles.printPreviewTitleBlock}>
                <Text style={styles.printPreviewTitle}>Preview ya QR Labels</Text>
                <Text style={styles.printPreviewSubtitle}>
                  Angalia mpangilio wa A4 kabla ya kufungua printer.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Funga preview"
                style={styles.printPreviewClose}
                onPress={() => setPrintPreviewOpen(false)}>
                <Text style={styles.printPreviewCloseText}>×</Text>
              </Pressable>
            </View>

            <View style={styles.printPreviewOptions}>
              {LABEL_PRINT_OPTIONS.map((option) => {
                const selected = labelPrintCount === option.count;
                return (
                  <Pressable
                    key={`preview-${option.count}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.count} labels preview`}
                    style={[styles.printPreviewOption, selected && styles.printPreviewOptionActive]}
                    onPress={() => setLabelPrintCount(option.count)}>
                    <Text style={[styles.printPreviewOptionCount, selected && styles.printPreviewOptionCountActive]}>
                      {option.count}
                    </Text>
                    <Text style={[styles.printPreviewOptionMeta, selected && styles.printPreviewOptionMetaActive]}>
                      {option.columns} x {option.rows}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.printPreviewPage}>
              {Array.from({ length: labelPrintCount }, (_, index) => (
                <View
                  key={`label-preview-${index}`}
                  style={[
                    styles.printPreviewLabel,
                    labelPrintCount === 12 && styles.printPreviewLabelLarge,
                    labelPrintCount === 30 && styles.printPreviewLabelCompact,
                  ]}>
                  <Image source={{ uri: qrCodeUrl }} style={styles.printPreviewQr} resizeMode="contain" />
                  <View style={styles.printPreviewCopy}>
                    <Text style={styles.printPreviewProductName} numberOfLines={1}>
                      {name.trim() || product.name}
                    </Text>
                    <Text style={styles.printPreviewSku} numberOfLines={1}>
                      SKU: {sku.trim() || product.sku || id}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.printPreviewFooter}>
              <Text style={styles.printPreviewHint}>
                {labelPrintCount} labels zitawekwa kwenye karatasi moja ya A4.
              </Text>
              <View style={styles.printPreviewActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ghairi preview"
                  style={styles.printPreviewCancel}
                  onPress={() => setPrintPreviewOpen(false)}>
                  <Text style={styles.printPreviewCancelText}>Ghairi</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Print QR labels"
                  style={styles.printPreviewPrint}
                  onPress={printQrLabel}>
                  <Text style={styles.printPreviewPrintText}>Print</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  quantityBox: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Spacing.md,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    alignItems: 'center',
  },
  quantityLabel: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  quantityValue: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  quantityHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  notice: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '400',
    marginBottom: Spacing.lg,
  },
  unsavedNotice: {
    color: '#8A5A00',
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '400',
    marginBottom: Spacing.lg,
  },
  identityPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  identityTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  identityTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  identitySubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  copySkuButton: {
    minHeight: 36,
    borderRadius: 9,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  copySkuText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  identityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  identityItem: {
    flexGrow: 1,
    minWidth: '30%',
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
  },
  identityLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  identityValue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  qrPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  qrTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  qrCopy: {
    flex: 1,
    minWidth: 0,
  },
  qrTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  qrSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  qrImage: {
    width: 116,
    height: 116,
    borderRadius: 8,
    backgroundColor: Colors.white,
  },
  qrActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  qrButton: {
    minHeight: 40,
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  qrButtonPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  qrButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  qrButtonTextPrimary: {
    color: Colors.white,
  },
  printPreviewOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  printPreviewOverlayWeb: {
    position: 'fixed' as 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 9999,
  },
  printPreviewScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 34, 28, 0.45)',
  },
  printPreviewPanel: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '94%',
    borderRadius: 18,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    gap: Spacing.md,
    overflow: 'hidden',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 12,
  },
  printPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  printPreviewTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  printPreviewTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  printPreviewSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 3,
  },
  printPreviewClose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printPreviewCloseText: {
    color: Colors.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
  },
  printPreviewOptions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  printPreviewOption: {
    minHeight: 48,
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
  },
  printPreviewOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  printPreviewOptionCount: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  printPreviewOptionCountActive: {
    color: Colors.primaryDark,
  },
  printPreviewOptionMeta: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  printPreviewOptionMetaActive: {
    color: Colors.primaryDark,
  },
  printPreviewPage: {
    width: '100%',
    aspectRatio: 0.707,
    maxHeight: 360,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDE8E3',
    backgroundColor: Colors.white,
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    overflow: 'hidden',
  },
  printPreviewLabel: {
    flexBasis: '32%',
    height: 26,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CFE8DE',
    backgroundColor: '#FBFFFD',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 3,
  },
  printPreviewLabelLarge: {
    height: 52,
  },
  printPreviewLabelCompact: {
    height: 21,
  },
  printPreviewQr: {
    width: 18,
    height: 18,
    backgroundColor: Colors.white,
  },
  printPreviewCopy: {
    flex: 1,
    minWidth: 0,
  },
  printPreviewProductName: {
    color: Colors.text,
    fontSize: 7,
    fontWeight: '700',
  },
  printPreviewSku: {
    color: Colors.textMuted,
    fontSize: 6,
    fontWeight: '600',
    marginTop: 1,
  },
  printPreviewFooter: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  printPreviewHint: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  printPreviewActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  printPreviewCancel: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printPreviewCancelText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  printPreviewPrint: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printPreviewPrintText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  labelOptionRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  labelOptionTitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  labelOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  labelOption: {
    minWidth: 58,
    minHeight: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  labelOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  labelOptionText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  labelOptionTextActive: {
    color: Colors.primaryDark,
  },
  readinessPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
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
  readinessScoreBadge: {
    minWidth: 58,
    minHeight: 38,
    borderRadius: 999,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  readinessScoreBadgeWarning: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
  },
  readinessScoreText: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  readinessScoreTextWarning: {
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
    minHeight: 40,
    borderRadius: 10,
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
    fontSize: 14,
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
  actionPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  actionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  actionButton: {
    minHeight: 44,
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  actionButtonPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  actionButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionButtonTextPrimary: {
    color: Colors.white,
  },
  documentsPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  documentsTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  documentsTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  documentsSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  documentsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  documentButton: {
    minHeight: 42,
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  documentButtonWarning: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
  },
  documentButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  documentButtonTextWarning: {
    color: '#8A5A00',
  },
  stockStatusPanel: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  stockStatusPanelDanger: {
    backgroundColor: '#FFF5F5',
    borderColor: '#F5C2C7',
  },
  stockStatusTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  stockStatusTitle: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
  },
  stockStatusTitleDanger: {
    color: Colors.danger,
  },
  stockStatusText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  stockStatusHint: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  stockStatusButton: {
    minHeight: 36,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  stockStatusButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  purchaseRecommendationPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  purchaseRecommendationTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  purchaseRecommendationTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  purchaseRecommendationText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  purchaseRecommendationActions: {
    alignItems: 'stretch',
    gap: Spacing.xs,
    minWidth: 104,
  },
  purchaseRecommendationButton: {
    minHeight: 36,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  purchaseRecommendationButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  purchaseRecommendationCopyButton: {
    minHeight: 36,
    borderRadius: 9,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  purchaseRecommendationCopyText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
  },
  purchaseRecommendationStats: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  purchaseRecommendationStat: {
    flex: 1,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 10,
    padding: Spacing.md,
  },
  purchaseRecommendationLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  purchaseRecommendationValue: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  purchaseHistoryPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  purchaseHistoryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  purchaseHistoryTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  purchaseHistoryCount: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  purchaseHistoryEmpty: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  purchaseHistoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  purchaseHistoryInfo: {
    flex: 1,
  },
  purchaseHistorySupplier: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  purchaseHistoryMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  purchaseHistoryAmountBlock: {
    alignItems: 'flex-end',
  },
  purchaseHistoryTotal: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  purchaseHistoryStatus: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  purchaseHistoryStatusDebt: {
    color: Colors.warning,
  },
  profitSnapshotPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  profitSnapshotTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  priceHealthBox: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 10,
    padding: Spacing.md,
  },
  priceHealthBoxWarning: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
  },
  priceHealthText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  priceHealthTextWarning: {
    color: '#8A5A00',
  },
  priceHealthHint: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  profitSnapshotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  profitSnapshotCard: {
    flexGrow: 1,
    minWidth: '47%',
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  profitSnapshotLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  profitSnapshotValue: {
    color: Colors.primaryDark,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  profitSnapshotLoss: {
    color: Colors.danger,
  },
  stockValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primarySoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    padding: Spacing.md,
  },
  stockValueItem: {
    flex: 1,
  },
  stockValueDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#BFE5D6',
  },
  stockValueText: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  snapshotMarkupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  snapshotMarkupLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  snapshotMarkupButton: {
    minHeight: 32,
    borderRadius: 9,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  snapshotMarkupButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  snapshotMarkupText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  snapshotMarkupTextActive: {
    color: Colors.white,
  },
  salesHistoryPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  salesHistoryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  salesHistoryTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  salesHistoryLink: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  salesSummaryGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  salesSummaryCard: {
    flex: 1,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 10,
    padding: Spacing.md,
  },
  salesSummaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  salesSummaryValue: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  salesSummaryLoss: {
    color: Colors.danger,
  },
  salesHistoryEmpty: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  salesHistoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  salesHistoryInfo: {
    flex: 1,
  },
  salesHistoryCustomer: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  salesHistoryMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  salesHistoryAmountBlock: {
    alignItems: 'flex-end',
  },
  salesHistoryTotal: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  salesHistoryProfit: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  performancePanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  performanceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  performanceTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  performanceSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  performanceBadge: {
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  performanceBadgeWarning: {
    backgroundColor: Colors.warningSoft,
    borderColor: Colors.warning,
  },
  performanceBadgeText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  performanceBadgeTextWarning: {
    color: '#8A5A00',
  },
  performanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  performanceCard: {
    flexGrow: 1,
    minWidth: '47%',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: Spacing.md,
  },
  performanceLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  performanceValue: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  performanceLoss: {
    color: Colors.danger,
  },
  performanceSuggestion: {
    color: Colors.text,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 10,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '600',
  },
  recentPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  recentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  recentTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  recentLink: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  recentEmpty: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  recentInfo: {
    flex: 1,
  },
  recentType: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  recentMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  recentNote: {
    color: Colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  recentQty: {
    color: Colors.success,
    fontSize: 13,
    fontWeight: '600',
  },
  recentQtyOut: {
    color: Colors.danger,
  },
  returnNotice: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '400',
    marginBottom: Spacing.lg,
  },
  priceFocusPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  priceFocusTitle: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  profitPreview: {
    backgroundColor: Colors.primarySoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    padding: Spacing.md,
  },
  profitPreviewLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  profitPreviewValue: {
    color: Colors.primaryDark,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  profitPreviewLoss: {
    color: Colors.danger,
  },
  profitPreviewHint: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '400',
    marginTop: Spacing.xs,
  },
  markupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  markupLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginRight: Spacing.xs,
  },
  markupButton: {
    minHeight: 30,
    borderRadius: 9,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  markupButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  markupButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  markupButtonTextActive: {
    color: Colors.white,
  },
  focusInput: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warningSoft,
  },
  costHint: {
    color: '#8A5A00',
    fontSize: 12,
    fontWeight: '400',
    marginTop: -Spacing.md,
    marginBottom: Spacing.lg,
  },
  requiredHint: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '400',
    marginTop: Spacing.sm,
  },
  priceGuide: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: Spacing.md,
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  priceGuideText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  recommendedButton: {
    minHeight: 34,
    borderRadius: 9,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  recommendedButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  quickSaveButton: {
    marginTop: Spacing.md,
  },
  cancelReturnButton: {
    marginTop: Spacing.sm,
  },
  saveReadiness: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  saveReadinessTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  saveReadinessItem: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  saveReadinessDone: {
    color: Colors.success,
  },
  saveReadinessBlocker: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  restoreButton: {
    marginTop: Spacing.sm,
  },
  deleteButton: {
    marginTop: Spacing.md,
  },
});
