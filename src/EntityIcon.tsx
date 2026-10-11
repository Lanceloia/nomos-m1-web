import { Flame, LampCeiling, Package, Sparkles, UserRound } from 'lucide-react';

export function EntityIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = kind === 'person' ? UserRound : kind === 'elemental' ? Sparkles
    : kind === 'chandelier' ? LampCeiling : kind === 'everflame' ? Flame : Package;
  return <Icon size={size} />;
}
