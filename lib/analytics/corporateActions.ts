export type Lot = {
  qty: number;
  costPerShare: number;
  date: string;
};

export function applySplit(lots: Lot[], ratio: number, exDate: string): Lot[] {
  if (ratio <= 0) throw new Error('applySplit: ratio must be > 0');
  return lots.map((lot) => {
    if (lot.date >= exDate) return lot;
    return {
      qty: lot.qty * ratio,
      costPerShare: lot.costPerShare / ratio,
      date: lot.date,
    };
  });
}

export function applyBonus(lots: Lot[], ratio: number, exDate: string): Lot[] {
  if (ratio <= 0) throw new Error('applyBonus: ratio must be > 0');
  return lots.map((lot) => {
    if (lot.date >= exDate) return lot;
    const newQty = lot.qty * (1 + ratio);
    const totalCost = lot.qty * lot.costPerShare;
    return {
      qty: newQty,
      costPerShare: totalCost / newQty,
      date: lot.date,
    };
  });
}
