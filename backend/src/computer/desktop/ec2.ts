/**
 * Start, stop and look up one EC2 instance (an org's Windows desktop) through
 * the EC2 Query API. The instance keeps its disk across stops, so Xactimate
 * and its sign-in stay installed; only compute time is paid while it's off.
 *
 * The IAM user behind AWS_ACCESS_KEY_ID needs only ec2:DescribeInstances,
 * ec2:StartInstances and ec2:StopInstances (ideally limited by a tag).
 */
import { signV4, type AwsKeys } from './sigv4.js';
import type { DesktopEc2Target } from './config.js';

export type Ec2State = 'pending' | 'running' | 'shutting-down' | 'terminated' | 'stopping' | 'stopped' | 'unknown';

export interface Ec2Instance {
  state: Ec2State;
  publicIp: string | null;
}

export class Ec2Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'Ec2Error';
  }
}

type FetchLike = typeof fetch;

const API_VERSION = '2016-11-15';

/** First <tag>value</tag> inside xml (EC2 responses are flat enough for this). */
function tagValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

export function parseDescribe(xml: string): Ec2Instance {
  const stateBlock = xml.match(/<instanceState>([\s\S]*?)<\/instanceState>/)?.[1] ?? '';
  const name = tagValue(stateBlock, 'name');
  const known: Ec2State[] = ['pending', 'running', 'shutting-down', 'terminated', 'stopping', 'stopped'];
  const state = (known as string[]).includes(name ?? '') ? (name as Ec2State) : 'unknown';
  const ip = tagValue(xml, 'ipAddress');
  return { state, publicIp: ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null };
}

export class Ec2Client {
  constructor(
    private readonly keys: () => AwsKeys | null,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async call(target: DesktopEc2Target, action: string): Promise<string> {
    const keys = this.keys();
    if (!keys) throw new Ec2Error('AWS keys are not set', 503);
    const url = new URL(`https://ec2.${target.region}.amazonaws.com/`);
    const body = new URLSearchParams({ Action: action, Version: API_VERSION, 'InstanceId.1': target.instanceId }).toString();
    const headers = signV4({
      method: 'POST',
      url,
      headers: { host: url.host, 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body,
      service: 'ec2',
      region: target.region,
      keys,
      now: this.now(),
    });
    const res = await this.fetchImpl(url, { method: 'POST', headers, body });
    const text = await res.text();
    if (!res.ok) {
      // The AWS error code only; never the request.
      const code = tagValue(text, 'Code') ?? 'error';
      throw new Ec2Error(`EC2 ${action} failed (${res.status} ${code})`, res.status);
    }
    return text;
  }

  async describe(target: DesktopEc2Target): Promise<Ec2Instance> {
    return parseDescribe(await this.call(target, 'DescribeInstances'));
  }

  async start(target: DesktopEc2Target): Promise<void> {
    await this.call(target, 'StartInstances');
  }

  async stop(target: DesktopEc2Target): Promise<void> {
    await this.call(target, 'StopInstances');
  }
}
