import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface MockPushServerOptions {
  port?: number;
  defaultStatus?: number;
}

export class MockPushServer {
  private server: Server | null = null;
  private requests: CapturedRequest[] = [];
  private responseStatus: number;
  private responseBody: string = '';
  private port: number;

  constructor(options: MockPushServerOptions = {}) {
    this.port = options.port ?? 9999;
    this.responseStatus = options.defaultStatus ?? 201;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          this.requests.push({
            method: req.method ?? 'GET',
            url: req.url ?? '/',
            headers: req.headers as Record<string, string | string[] | undefined>,
            body,
          });

          res.writeHead(this.responseStatus);
          res.end(this.responseBody);
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  setResponse(status: number, body: string = ''): void {
    this.responseStatus = status;
    this.responseBody = body;
  }

  getRequests(): CapturedRequest[] {
    return [...this.requests];
  }

  getLastRequest(): CapturedRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  clearRequests(): void {
    this.requests = [];
  }

  getEndpoint(path: string = '/push/test'): string {
    return `http://localhost:${this.port}${path}`;
  }
}

export function createMockPushServer(options?: MockPushServerOptions): MockPushServer {
  return new MockPushServer(options);
}
