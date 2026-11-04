import { startApi } from "./runtime.ts";

const server = await startApi();
// 업데이트·종료 시 AI 자식 연결까지 정리해서 원본 대화 점유를 남기지 않는다.
function shutdown() {
  server.close();
  server.closeAllConnections();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
