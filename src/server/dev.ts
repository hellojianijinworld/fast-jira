import { createServer } from "vite";
import { startApi } from "./runtime.ts";

const api = await startApi();
const vite = await createServer({ server: { host: "127.0.0.1" } });
try {
  await vite.listen();
  vite.printUrls();
} catch (error) {
  api.close();
  throw error;
}
