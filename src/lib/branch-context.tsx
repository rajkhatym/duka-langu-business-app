import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { Branch } from '@/types/database';

const SELECTED_BRANCH_KEY = 'godown.selected-branch.v1';
const CONFIGURED_BRANCHES_KEY = 'godown.configured-branches.v1';

export const defaultBranches: Branch[] = [
  { id: 'adiasports', name: 'adiasports' },
  { id: 'fitness-empire', name: 'Fitness Empire' },
];

interface BranchContextValue {
  branches: Branch[];
  selectedBranchId: string;
  selectedBranch: Branch | null;
  setSelectedBranchId: (branchId: string) => void;
  setBranches: (branches: Branch[]) => void;
}

const BranchContext = createContext<BranchContextValue | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { profile, isOwner } = useAuth();
  const [branches, setBranchesState] = useState<Branch[]>(defaultBranches);
  const [selectedBranchId, setSelectedBranchIdState] = useState(defaultBranches[0].id);
  const forcedBranchId = !isOwner && profile?.branch_id ? profile.branch_id : null;

  useEffect(() => {
    AsyncStorage.getItem(CONFIGURED_BRANCHES_KEY).then((rawBranches) => {
      if (!rawBranches) return;
      try {
        const parsed = JSON.parse(rawBranches) as Branch[];
        if (Array.isArray(parsed) && parsed.length > 0) setBranchesState(parsed);
      } catch {
        setBranchesState(defaultBranches);
      }
    });
    AsyncStorage.getItem(SELECTED_BRANCH_KEY).then((storedBranchId) => {
      if (storedBranchId) setSelectedBranchIdState(storedBranchId);
    });
  }, []);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase.from('branches').select('*').order('created_at');
      if (!active || error || !data || data.length === 0) return;
      const remoteBranches = data as Branch[];
      setBranchesState(remoteBranches);
      AsyncStorage.setItem(CONFIGURED_BRANCHES_KEY, JSON.stringify(remoteBranches));
      const nextSelected = forcedBranchId ?? selectedBranchId;
      if (!remoteBranches.some((branch) => branch.id === nextSelected)) {
        setSelectedBranchIdState(remoteBranches[0].id);
        AsyncStorage.setItem(SELECTED_BRANCH_KEY, remoteBranches[0].id);
      }
    })();
    return () => {
      active = false;
    };
  }, [forcedBranchId, profile, selectedBranchId]);

  const setSelectedBranchId = useCallback(
    (branchId: string) => {
      const nextBranchId = forcedBranchId ?? branchId;
      setSelectedBranchIdState(nextBranchId);
      AsyncStorage.setItem(SELECTED_BRANCH_KEY, nextBranchId);
    },
    [forcedBranchId]
  );

  const setBranches = useCallback((nextBranches: Branch[]) => {
    const safeBranches = nextBranches.length > 0 ? nextBranches : defaultBranches;
    setBranchesState(safeBranches);
    AsyncStorage.setItem(CONFIGURED_BRANCHES_KEY, JSON.stringify(safeBranches));
    if (isOwner) {
      supabase.from('branches').upsert(safeBranches.map((branch) => ({ id: branch.id, name: branch.name }))).then();
    }
    if (!safeBranches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(safeBranches[0].id);
    }
  }, [isOwner, selectedBranchId, setSelectedBranchId]);

  useEffect(() => {
    if (forcedBranchId && selectedBranchId !== forcedBranchId) {
      setSelectedBranchIdState(forcedBranchId);
      AsyncStorage.setItem(SELECTED_BRANCH_KEY, forcedBranchId);
    }
  }, [forcedBranchId, selectedBranchId]);

  const visibleBranches = useMemo(() => {
    if (!forcedBranchId) return branches;
    return branches.filter((branch) => branch.id === forcedBranchId);
  }, [branches, forcedBranchId]);

  const effectiveSelectedBranchId = forcedBranchId ?? selectedBranchId;
  const value = useMemo(
    () => ({
      branches: visibleBranches.length > 0 ? visibleBranches : branches,
      selectedBranchId: effectiveSelectedBranchId,
      selectedBranch:
        branches.find((branch) => branch.id === effectiveSelectedBranchId) ?? branches[0] ?? defaultBranches[0],
      setSelectedBranchId,
      setBranches,
    }),
    [branches, visibleBranches, effectiveSelectedBranchId, setBranches, setSelectedBranchId]
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch must be used within BranchProvider');
  return ctx;
}
