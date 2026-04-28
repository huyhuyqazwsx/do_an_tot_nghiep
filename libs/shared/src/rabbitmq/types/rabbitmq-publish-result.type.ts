export type RabbitmqPublishResult = {
  queue: string;
  messageId: string;
  confirmedAt: string;
};
