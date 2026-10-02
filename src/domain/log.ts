export interface LogEntry {
  id: number;
  source: "API";
  command: string;
  result: string;
  time: string;
  response?: string;
}
