export interface QueuedMessage {
  id: number;
  text: string;
}
/** 대기 요청은 대화별 메모리에만 보관하고 중단·실패 후에는 명시적으로 재개한다. */
export function createChatQueue() {
  let sequence = 0;
  const queues = new Map<string, QueuedMessage[]>();
  const paused = new Set<string>();
  const list = (id: string) => queues.get(id) ?? [];
  return {
    list,
    paused: (id: string) => paused.has(id),
    add(id: string, text: string) {
      const message = { id: ++sequence, text };
      queues.set(id, [...list(id), message]);
      return message;
    },
    remove(id: string, messageId: number) {
      queues.set(
        id,
        list(id).filter((message) => message.id !== messageId),
      );
    },
    take(id: string) {
      if (paused.has(id)) return;
      const [next, ...remaining] = list(id);
      queues.set(id, remaining);
      return next;
    },
    pause: (id: string) => {
      paused.add(id);
    },
    resume: (id: string) => {
      paused.delete(id);
    },
    clear(id: string) {
      queues.delete(id);
      paused.delete(id);
    },
  };
}
