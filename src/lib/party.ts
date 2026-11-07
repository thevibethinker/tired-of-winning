export const reactions = [
  { emoji: '🔥', label: 'On fire' }, { emoji: '💙', label: 'Love it' },
  { emoji: '👀', label: 'Watching' }, { emoji: '😬', label: 'Nervous' },
  { emoji: '🎉', label: 'Celebrating' }, { emoji: '😴', label: 'Exhausted' },
] as const;
export type Pick = 'candidate' | 'opponent' | 'other';
export type PartyRace = { reactions: Record<string, number>; picks: Record<Pick, number>; totalPicks: number; myReaction: string | null; myPick: Pick | null };
export type PartyComment = { id: number; handle: string; body: string; at: number; mine: boolean };
export type PartyState = { serverTime: number; closesAt: number; closed: boolean; me: { handle: string } | null; isHost?: boolean; online: number; comments: PartyComment[]; hasOlder: boolean; races: Record<string, PartyRace> };
export const emptyPartyRace = (): PartyRace => ({ reactions: {}, picks: { candidate: 0, opponent: 0, other: 0 }, totalPicks: 0, myReaction: null, myPick: null });
