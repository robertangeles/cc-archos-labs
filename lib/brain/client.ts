import { getIntegrationConfig } from "@/lib/integration-config";

export interface GBrainTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface GBrainClientRegistration {
  client_id: string;
  client_secret: string;
}

export interface GBrainHealthResponse {
  status: string;
  version: string;
  engine: string;
}

export interface McpRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function getGBrainUrl(): Promise<string | null> {
  const config = await getIntegrationConfig();
  const url = config.gbrainUrl;
  if (!url) return null;
  if (!url.startsWith("https://") && !(process.env.NODE_ENV === "development" && url.startsWith("http://localhost"))) {
    console.error(`[brain] gbrainUrl rejected: must use HTTPS (got ${url.slice(0, 30)})`);
    return null;
  }
  return url;
}

async function getGBrainAdminToken(): Promise<string | null> {
  const config = await getIntegrationConfig();
  return config.gbrainAdminToken;
}

export async function checkHealth(): Promise<GBrainHealthResponse | null> {
  const url = await getGBrainUrl();
  if (!url) return null;

  const res = await fetch(`${url}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function registerClient(
  userId: string,
): Promise<GBrainClientRegistration> {
  const url = await getGBrainUrl();
  const adminToken = await getGBrainAdminToken();
  if (!url || !adminToken) {
    throw new Error("GBrain not configured: missing URL or admin token");
  }

  const res = await fetch(`${url}/oauth/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_name: `user-${userId}`,
      grant_types: ["client_credentials"],
      scope: "read write",
      source_id: `user-${userId}`,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[brain:register] failed (${res.status}): ${text}`);
    throw new Error(`GBrain client registration failed (${res.status})`);
  }

  return res.json();
}

export async function getAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<GBrainTokenResponse> {
  const url = await getGBrainUrl();
  if (!url) {
    throw new Error("GBrain not configured: missing URL");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "read write",
  });

  const res = await fetch(`${url}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // 8s (was 5s): GBrain runs on Render and cold-starts after idle. The
    // token endpoint is fast when warm (~0.5s) but the very first request
    // against a sleeping instance needs headroom or recall silently fails.
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[brain:token] failed (${res.status}): ${text}`);
    throw new Error(`GBrain token request failed (${res.status})`);
  }

  return res.json();
}

export async function callMcp(
  accessToken: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<McpResponse> {
  const url = await getGBrainUrl();
  if (!url) {
    throw new Error("GBrain not configured: missing URL");
  }

  const request: McpRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[brain:mcp] ${toolName} failed (${res.status}): ${text}`);
    throw new Error(`GBrain MCP call failed (${res.status})`);
  }

  const rawText = await res.text();

  for (const line of rawText.split("\n")) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.slice(6)) as McpResponse;
    }
  }

  return JSON.parse(rawText) as McpResponse;
}
