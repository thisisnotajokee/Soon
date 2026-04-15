export type ProductDetailDto = {
  asin: string;
  title: string;
  historyPoints: Array<{ ts: string; value: number }>;
};
