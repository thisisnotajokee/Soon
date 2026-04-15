export type SelfHealEventDto = {
  eventId: string;
  playbookId: string;
  result: 'success' | 'rollback' | 'failed';
};
