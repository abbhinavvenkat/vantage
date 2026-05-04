export type NormalizedTrade = {
  brokerCode: 'zerodha' | 'groww' | 'indmoney';
  symbol: string;
  isin?: string;
  tradeDate: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  currency: 'INR' | 'USD';
  exchange?: string;
  segment?: string;
  series?: string;
  tradeId?: string;
  orderId?: string;
  execTime?: string;
  rawRowIdx: number;
};

export interface ParserModule {
  code: string;
  detect(file: { name: string; bytes: Buffer }): boolean;
  parse(file: { name: string; bytes: Buffer }): NormalizedTrade[];
}
