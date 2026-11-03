export type Role = 'OPERATOR' | 'VIEWER';
export interface Session { username: string; role: Role }
export interface InventoryItem { sku: string; name: string; availableQuantity: number }
export interface Address { recipient: string; line1: string; city: string; postalCode: string; country: string }
export type Scenario = 'NORMAL' | 'FAIL_THEN_RECOVER' | 'TIMEOUT_AFTER_CREATE';
export interface CreateOrder { customerReference: string; shippingAddress: Address; demoScenario: Scenario; items: { sku: string; quantity: number }[] }
export type OrderStatus = 'CONFIRMED' | 'SHIPMENT_CREATED' | 'FULFILLMENT_FAILED';
export interface Order extends CreateOrder {
  id: string; status: OrderStatus; createdAt: string; attemptGeneration: number;
  shipmentId: string | null; trackingNumber: string | null;
  timeline: { id: string; type: string; message: string; occurredAt: string }[];
}
export interface OrderPage { content: Order[]; number: number; size: number; totalElements: number; totalPages: number }
interface Csrf { headerName: string; token: string }

export class ApiError extends Error {
  status: number;
  uncertain: boolean;
  constructor(message: string, status = 0, uncertain = status === 0 || status >= 500 || status === 408) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.uncertain = uncertain;
  }
}

export class ApiClient {
  private transport: typeof fetch;
  private csrf?: Csrf;
  constructor(transport: typeof fetch = (input, options) => fetch(input, options)) { this.transport = transport; }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(url, { ...options, credentials: 'same-origin', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', ...options.headers } });
    } catch {
      throw new ApiError('Connection interrupted. The request may have reached the server.');
    }
    if (!response.ok) {
      if (response.status === 403) this.csrf = undefined;
      let message = response.status === 401 ? 'Your session has ended. Sign in to continue.'
        : response.status === 403 ? 'This action is not allowed. Refresh your session and try again.'
        : response.status >= 500 ? 'The service is temporarily unavailable. Please try again.'
        : `The request could not be completed (${response.status}).`;
      try {
        const body = await response.json();
        if (typeof body.detail === 'string') message = body.detail;
        else if (typeof body.message === 'string') message = body.message;
      } catch { /* A proxy may return an HTML error page. */ }
      throw new ApiError(message, response.status);
    }
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch { throw new ApiError('The server returned an unreadable response. Please retry the same request.'); }
  }

  private async token(): Promise<Csrf> {
    if (!this.csrf) this.csrf = await this.request<Csrf>('/api/csrf');
    return this.csrf;
  }
  private async mutate<T>(url: string, body?: unknown, key?: string): Promise<T> {
    const csrf = await this.token();
    return this.request<T>(url, {
      method: 'POST',
      headers: { [csrf.headerName]: csrf.token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async login(username: string, password: string): Promise<void> {
    this.csrf = undefined;
    const csrf = await this.token();
    await this.request<void>('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', [csrf.headerName]: csrf.token }, body: new URLSearchParams({ username, password }).toString() });
    this.csrf = undefined;
    await this.token();
  }
  async logout(): Promise<void> { await this.mutate<void>('/logout'); this.csrf = undefined; }
  session() { return this.request<Session>('/api/session'); }
  inventory() { return this.request<InventoryItem[]>('/api/inventory'); }
  orders(page: number) { return this.request<OrderPage>(`/api/orders?page=${page}&size=10`); }
  order(id: string) { return this.request<Order>(`/api/orders/${encodeURIComponent(id)}`); }
  createOrder(body: CreateOrder, key: string) { return this.mutate<Order>('/api/orders', body, key); }
  retry(id: string, key: string) { return this.mutate<Order>(`/api/orders/${encodeURIComponent(id)}/retry`, undefined, key); }
}

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface Intent<T> { key: string; payload: T }

/** One frozen request per operation. A lost response never creates a new request identity. */
export class RequestIntent<T> {
  current?: Intent<T>;
  private name: string;
  private storage?: StorageLike;
  constructor(name: string, storage?: StorageLike) {
    this.name = `orderops:pending:${name}`;
    this.storage = storage;
    try {
      const value = storage?.getItem(this.name);
      if (value) {
        const parsed = JSON.parse(value) as Intent<T>;
        if (typeof parsed.key === 'string' && /^[\w-]{8,100}$/.test(parsed.key) && parsed.payload) this.current = parsed;
      }
    } catch { /* Storage may be disabled; in-memory retention still works. */ }
  }
  begin(payload: T): Intent<T> {
    if (this.current) {
      if (JSON.stringify(this.current.payload) !== JSON.stringify(payload)) throw new Error('Resolve the unresolved request before changing its payload.');
      return this.current;
    }
    this.current = { key: crypto.randomUUID(), payload: JSON.parse(JSON.stringify(payload)) as T };
    try { this.storage?.setItem(this.name, JSON.stringify(this.current)); } catch { /* Keep the in-memory identity. */ }
    return this.current;
  }
  clear() {
    this.current = undefined;
    try { this.storage?.removeItem(this.name); } catch { /* Storage may be disabled. */ }
  }
}

export const api = new ApiClient();
export function browserStorage(): StorageLike | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
