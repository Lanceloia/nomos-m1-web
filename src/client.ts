import type { PersonalityAdvice, PolicyStartRequest, PolicyStartSettings, SessionResponse } from './types';
import { REFUSAL_CODES, type RefusalCode } from './types';

const STORAGE_KEY = 'm1-tabletop.session.v1';

function validatePublicFeedback(feedback: unknown): void {
  if (feedback == null) return;
  if (typeof feedback === 'object' && !Array.isArray(feedback)) {
    const value = feedback as Record<string, unknown>;
    if (value.status === 'published' && !Object.hasOwn(value, 'refusal')) return;
    if (value.status === 'rejected' && value.refusal !== null && typeof value.refusal === 'object' && !Array.isArray(value.refusal)) {
      const refusal = value.refusal as Record<string, unknown>;
      if (Object.keys(refusal).length === 1 && REFUSAL_CODES.includes(refusal.code as RefusalCode)) return;
    }
  }
  throw new Error('反馈回执格式无效，请同步会话。');
}

export function validPolicySettings(settings: PolicyStartSettings): boolean {
  return Number.isInteger(settings.maxActions) && settings.maxActions >= 1 && settings.maxActions <= 128
    && typeof settings.stopOnUnexpected === 'boolean';
}

export class SessionClient {
  private session: { id: string; revision: number } | null = null;
  private opening: Promise<SessionResponse> | null = null;
  private pending = false;
  private uncertain = false;
  private policyRunning = false;
  private policyRevision: number | null = null;

  constructor(private readonly storage?: Storage) {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      if (saved && typeof saved.id === 'string' && Number.isInteger(saved.revision)) this.session = saved;
    } catch { /* A malformed local handle is not a world snapshot. */ }
  }

  private async request(path: string, body?: object): Promise<SessionResponse> {
    const response = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `服务返回 ${response.status}`);
    validatePublicFeedback(value.frame?.feedback);
    this.session = { id: value.sessionId, revision: value.revision };
    this.policyRunning = value.policy?.status === 'running';
    this.policyRevision = Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 0 ? value.policyRevision : null;
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.session)); }
    catch { /* Browser storage availability does not change a committed result. */ }
    return value;
  }

  start(): Promise<SessionResponse> {
    if (!this.opening) {
      this.opening = this.session ? this.refresh() : this.request('/sessions', { requestId: crypto.randomUUID() });
      void this.opening.catch(() => { this.opening = null; });
    }
    return this.opening;
  }

  async refresh(): Promise<SessionResponse> {
    if (this.pending) throw new Error('请等待当前请求结束。');
    if (!this.session) return this.start();
    const result = await this.request(`/sessions/${this.session.id}`);
    this.uncertain = false;
    return result;
  }

  async choose(index: number): Promise<SessionResponse> {
    if (this.policyRunning) throw new Error('请先停止当前意图。');
    if (!this.session || this.pending || this.uncertain) throw new Error('请先同步当前会话。');
    this.pending = true;
    try {
      return await this.request(`/sessions/${this.session.id}/actions`, {
        index, revision: this.session.revision, requestId: crypto.randomUUID(),
      });
    } catch (error) {
      // Never replay a possibly committed Action after a transport failure.
      this.uncertain = true;
      throw error;
    } finally { this.pending = false; }
  }

  async restart(): Promise<SessionResponse> {
    if (this.policyRunning) throw new Error('请先停止当前意图。');
    if (!this.session || this.pending || this.uncertain) throw new Error('请先同步当前会话。');
    this.pending = true;
    try {
      return await this.request(`/sessions/${this.session.id}/restart`, {
        revision: this.session.revision, requestId: crypto.randomUUID(),
      });
    } catch (error) { this.uncertain = true; throw error; }
    finally { this.pending = false; }
  }

  async newSession(): Promise<SessionResponse> {
    if (this.pending) throw new Error('请等待当前请求结束。');
    if (this.policyRunning) throw new Error('请先停止当前意图。');
    this.pending = true;
    try {
      const result = await this.request('/sessions', { requestId: crypto.randomUUID() });
      this.uncertain = false;
      this.opening = Promise.resolve(result);
      return result;
    } finally { this.pending = false; }
  }

  private async policyRequest(operation: 'start' | 'step' | 'cancel', identity: object): Promise<SessionResponse> {
    if (!this.session || this.pending || this.uncertain || this.policyRevision === null) throw new Error('请先同步当前会话。');
    this.pending = true;
    try {
      return await this.request(`/sessions/${this.session.id}/policy/${operation}`, {
        ...identity, revision: this.session.revision, policyRevision: this.policyRevision, requestId: crypto.randomUUID(),
      });
    } catch (error) {
      this.uncertain = true;
      throw error;
    } finally { this.pending = false; }
  }

  async startPolicy(intentId: string, settings: PolicyStartSettings): Promise<SessionResponse> {
    if (!validPolicySettings(settings)) throw new Error('行动上限须为 1 到 128 的整数。');
    return this.policyRequest('start', { intentId, maxActions: settings.maxActions, stopOnUnexpected: settings.stopOnUnexpected });
  }

  async advice(snapshot: SessionResponse, intentId: string, stopOnUnexpected: boolean,
    signal?: AbortSignal): Promise<PersonalityAdvice> {
    const response = await fetch(`/api/sessions/${snapshot.sessionId}/advice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: snapshot.revision, policyRevision: snapshot.policyRevision,
        intentId, stopOnUnexpected }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `服务返回 ${response.status}`);
    return value;
  }

  stepPolicy(policyId: string): Promise<SessionResponse> {
    return this.policyRequest('step', { policyId });
  }

  cancelPolicy(policyId: string): Promise<SessionResponse> {
    return this.policyRequest('cancel', { policyId });
  }
}

type PolicyTransport = Pick<SessionClient, 'startPolicy' | 'stepPolicy' | 'cancelPolicy'>;

export class IntentPolicyRunner {
  private latest: SessionResponse | null = null;
  private active: Promise<void> | null = null;
  private cancellation: Promise<void> | null = null;
  private stopRequested = true;
  private releaseReadingPause: (() => void) | null = null;

  constructor(
    private readonly client: PolicyTransport,
    private readonly receive: (response: SessionResponse) => void,
    private readonly yieldTask?: () => Promise<void>,
  ) {}

  observe(response: SessionResponse) { this.latest = response; }

  interrupt() { this.stopRequested = true; this.releaseReadingPause?.(); }

  private async readingPause() {
    if (this.yieldTask) { await this.yieldTask(); return; }
    if (this.stopRequested || this.latest?.policy?.status !== 'running') return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(finish, 500);
      const runner = this;
      function finish() {
        clearTimeout(timer);
        runner.releaseReadingPause = null;
        resolve();
      }
      this.releaseReadingPause = finish;
    });
  }

  private publish(response: SessionResponse) {
    this.observe(response);
    this.receive(response);
  }

  async run(start?: PolicyStartRequest): Promise<void> {
    if (this.active || this.cancellation) throw new Error('请等待当前意图请求结束。');
    if (start === undefined && (!this.latest?.policy?.id || this.latest.policy.status !== 'running')) {
      throw new Error('没有可继续的意图。');
    }
    this.stopRequested = false;
    const pump = async () => {
      if (start !== undefined) {
        this.publish(await this.client.startPolicy(start.intentId, { maxActions: start.maxActions, stopOnUnexpected: start.stopOnUnexpected }));
        await this.readingPause();
      }
      while (!this.stopRequested && this.latest?.policy?.status === 'running' && this.latest.policy.id) {
        this.publish(await this.client.stepPolicy(this.latest.policy.id));
        await this.readingPause();
      }
    };
    this.active = pump();
    try { await this.active; }
    finally { this.stopRequested = true; this.active = null; }
  }

  async cancel(): Promise<void> {
    // Stop locally before waiting for a possibly committed server step.
    this.interrupt();
    if (this.cancellation) return this.cancellation;
    const cancel = async () => {
      try { await this.active; } catch { /* Uncertainty remains guarded by SessionClient. */ }
      const id = this.latest?.policy?.id;
      if (id) this.publish(await this.client.cancelPolicy(id));
    };
    this.cancellation = cancel();
    try { await this.cancellation; }
    finally { this.cancellation = null; }
  }
}
