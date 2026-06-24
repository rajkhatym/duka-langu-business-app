import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { supabase } from '@/lib/supabase';

const EXPENSE_CATEGORIES = ['Fuel / Mafuta', 'Transport', 'Boda boda / Kirikuu', 'Rent', 'Salary', 'Utilities', 'Marketing', 'Repairs'];
const NO_ATTACHMENT_CATEGORIES = ['Boda boda / Kirikuu'];
const RECEIPT_RECOMMENDED_CATEGORIES = ['Fuel / Mafuta', 'Transport', 'Utilities', 'Marketing', 'Repairs'];

type ReceiptAttachment = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  blob: Blob;
  originalSize: number;
  compressedSize: number;
};

const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1280;
const IMAGE_QUALITY = 0.72;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Imeshindikana kusoma file ya risiti.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Imeshindikana kuandaa picha ya risiti.'));
    image.src = src;
  });
}

function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.ceil((base64.length * 3) / 4);
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, base64] = dataUrl.split(',');
  const mimeType = meta.match(/data:(.*);base64/)?.[1] || 'application/octet-stream';
  const binary = atob(base64 ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function compressImageFile(file: File) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceDataUrl);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return sourceDataUrl;

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
}

export default function NewExpenseScreen() {
  const { session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<ReceiptAttachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const attachmentDisabled = NO_ATTACHMENT_CATEGORIES.includes(category);
  const receiptRecommended = RECEIPT_RECOMMENDED_CATEGORIES.includes(category);

  useEffect(() => {
    if (attachmentDisabled) setReceipt(null);
  }, [attachmentDisabled]);

  const pickReceipt = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      Alert.alert('Risiti', 'Attachment ya risiti inapatikana kwenye web preview kwa sasa.');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const isImage = file.type.startsWith('image/');
        const dataUrl = isImage ? await compressImageFile(file) : await readFileAsDataUrl(file);
        const compressedSize = dataUrlBytes(dataUrl);
        if (compressedSize > MAX_RECEIPT_BYTES) {
          setError('Risiti bado ni kubwa baada ya compression. Tafadhali piga picha karibu zaidi au tumia file chini ya 2MB.');
          return;
        }
        setReceipt({
          fileName: file.name,
          mimeType: isImage ? 'image/jpeg' : file.type || 'application/octet-stream',
          dataUrl,
          blob: isImage ? dataUrlToBlob(dataUrl) : file,
          originalSize: file.size,
          compressedSize,
        });
        setError(null);
      } catch (attachmentError) {
        setError(attachmentError instanceof Error ? attachmentError.message : 'Imeshindikana kusoma file ya risiti.');
      }
    };
    input.click();
  };

  const onSubmit = async () => {
    const value = Number(amount);
    if (!title.trim() || !value || value <= 0) {
      setError('Tafadhali jaza jina la matumizi na kiasi sahihi');
      return;
    }

    setError(null);
    setLoading(true);

    let receiptStoragePath: string | null = null;
    const receiptToSave = attachmentDisabled ? null : receipt;
    if (receiptToSave) {
      const safeFileName = receiptToSave.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const extension = receiptToSave.mimeType === 'image/jpeg' && !safeFileName.toLowerCase().match(/\.(jpg|jpeg)$/)
        ? '.jpg'
        : '';
      receiptStoragePath = `${selectedBranchId}/${session?.user.id ?? 'unknown'}/${Date.now()}-${safeFileName}${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('expense-receipts')
        .upload(receiptStoragePath, receiptToSave.blob, {
          contentType: receiptToSave.mimeType,
          upsert: false,
        });

      if (uploadError) {
        setLoading(false);
        setError(
          uploadError.message.includes('Bucket not found') || uploadError.message.includes('row-level security')
            ? 'Run SQL ya Supabase Storage kwanza ili receipt uploads zifanye kazi.'
            : uploadError.message
        );
        return;
      }
    }

    const expensePayload = {
      branch_id: selectedBranchId,
      title: title.trim(),
      category: category.trim() || null,
      amount: value,
      note: note.trim() || null,
      receipt_file_name: receiptToSave?.fileName ?? null,
      receipt_mime_type: receiptToSave?.mimeType ?? null,
      receipt_data_url: null,
      receipt_storage_path: receiptStoragePath,
      receipt_attached_at: receiptToSave ? new Date().toISOString() : null,
      created_by: session?.user.id,
    };

    let { error: insertError } = await supabase.from('expenses').insert(expensePayload);

    if (insertError?.message.includes('branch_id')) {
      const { branch_id: _branchId, ...fallbackPayload } = expensePayload;
      const fallback = await supabase.from('expenses').insert(fallbackPayload);
      insertError = fallback.error;
    }

    if (insertError && receiptStoragePath) {
      await supabase.storage.from('expense-receipts').remove([receiptStoragePath]);
    }

    if (insertError?.message.includes('receipt_')) {
      setLoading(false);
      setError('Run SQL ya expense receipts kwanza ili attachment ihifadhiwe.');
      return;
    }

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>
        <TextField label="Jina la matumizi *" value={title} onChangeText={setTitle} placeholder="Mfano: Usafiri" />
        <TextField label="Category" value={category} onChangeText={setCategory} placeholder="Kodi, Mishahara..." />
        <View style={styles.categoryChips}>
          {EXPENSE_CATEGORIES.map((item) => (
            <Pressable
              key={item}
              style={[styles.categoryChip, category === item && styles.categoryChipActive]}
              onPress={() => setCategory(item)}>
              <Text style={[styles.categoryChipText, category === item && styles.categoryChipTextActive]}>
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextField label="Kiasi *" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="Tsh" />
        {attachmentDisabled ? (
          <View style={styles.noReceiptBox}>
            <Text style={styles.receiptTitle}>Maelezo ya safari</Text>
            <Text style={styles.receiptHint}>
              Category hii haina attachment. Andika route, dereva au sababu ya safari kwenye maelezo.
            </Text>
          </View>
        ) : (
          <View style={[styles.receiptBox, receiptRecommended && styles.receiptBoxRecommended]}>
            <View style={styles.receiptTop}>
              <View style={styles.receiptTextBlock}>
                <Text style={styles.receiptTitle}>Risiti / Document</Text>
                <Text style={styles.receiptHint}>
                  {receiptRecommended
                    ? 'Fungua camera au chagua picha/PDF. Picha itacompressiwa kabla ya kuhifadhi.'
                    : 'Ambatanisha risiti kama matumizi haya yana document. Picha itacompressiwa.'}
                </Text>
              </View>
              <Pressable style={styles.receiptButton} onPress={pickReceipt}>
                <Text style={styles.receiptButtonText}>{receipt ? 'Badilisha' : 'Attach'}</Text>
              </Pressable>
            </View>
            {receipt ? (
              <View style={styles.receiptFileRow}>
                <Text style={styles.receiptFileName}>
                  {receipt.fileName} · {(receipt.compressedSize / 1024).toFixed(0)}KB
                  {receipt.originalSize > receipt.compressedSize
                    ? ` kutoka ${(receipt.originalSize / 1024).toFixed(0)}KB`
                    : ''}
                </Text>
                <Pressable onPress={() => setReceipt(null)}>
                  <Text style={styles.removeReceiptText}>Ondoa</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        <TextField
          label={attachmentDisabled ? 'Maelezo ya safari (hiari)' : 'Maelezo (hiari)'}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={attachmentDisabled ? 'Mfano: Kariakoo kwenda branch, delivery ya mzigo...' : undefined}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Hifadhi Matumizi" onPress={onSubmit} loading={loading} />
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
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  branchHint: {
    color: Colors.primaryDark,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
  categoryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  categoryChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
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
  receiptBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  receiptBoxRecommended: {
    borderColor: Colors.warning,
    backgroundColor: '#FFF9ED',
  },
  noReceiptBox: {
    borderWidth: 1,
    borderColor: '#D7E7DF',
    backgroundColor: Colors.primarySoft,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  receiptTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  receiptTextBlock: {
    flex: 1,
  },
  receiptTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  receiptHint: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 4,
  },
  receiptButton: {
    borderRadius: 10,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  receiptButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  receiptFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  receiptFileName: {
    flex: 1,
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  removeReceiptText: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
});
