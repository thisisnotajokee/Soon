export type AlertDto = {
  kind: 'purchase' | 'technical';
  title: string;
  message: string;
};
