// Human: HTTP helpers for the shared collab engine.
// Agent: USED by CollabClient; REPLACES document/spreadsheet collab slices in client.ts.

import { API_BASE, apiFetch } from "@/api/client";
import type {
  CollabOp,
  CollabSession,
  PublicShareAuth,
  RoomKind,
} from "./types";

function publicHeaders(auth: PublicShareAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth.sharePassword) {
    headers["X-Share-Password"] = auth.sharePassword;
  }
  return headers;
}

export async function joinCollabSession(body: {
  room_kind: RoomKind;
  file_id: string;
  display_name?: string;
  seed?: Record<string, unknown>;
  initial_html?: string;
  initial_text?: string;
}): Promise<CollabSession> {
  return apiFetch("/collab/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<CollabSession>;
}

export async function getCollabSession(sessionId: string): Promise<CollabSession> {
  return apiFetch(`/collab/sessions/${encodeURIComponent(sessionId)}`) as Promise<CollabSession>;
}

export async function heartbeatCollabSession(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<CollabSession> {
  return apiFetch(`/collab/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<CollabSession>;
}

export async function listCollabOps(
  sessionId: string,
  afterSeq: number,
): Promise<CollabOp[]> {
  return apiFetch(
    `/collab/sessions/${encodeURIComponent(sessionId)}/ops?after_seq=${afterSeq}`,
  ) as Promise<CollabOp[]>;
}

export async function postCollabOp(
  sessionId: string,
  body: {
    base_seq: number;
    op_type: string;
    payload: Record<string, unknown>;
    client_op_id?: string;
  },
): Promise<CollabOp> {
  return apiFetch(`/collab/sessions/${encodeURIComponent(sessionId)}/ops`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<CollabOp>;
}

export async function joinPublicCollabSession(
  auth: PublicShareAuth,
  body: {
    file_id: string;
    display_name?: string;
    seed?: Record<string, unknown>;
    initial_html?: string;
    initial_text?: string;
    room_kind?: RoomKind;
  },
): Promise<CollabSession> {
  return apiFetch(`/public/shares/${encodeURIComponent(auth.token)}/collab/sessions`, {
    method: "POST",
    headers: publicHeaders(auth),
    body: JSON.stringify({
      ...body,
      guest_id: auth.guestId,
      room_kind: body.room_kind ?? "document",
    }),
  }) as Promise<CollabSession>;
}

export async function getPublicCollabSession(
  auth: PublicShareAuth,
  sessionId: string,
): Promise<CollabSession> {
  const q = new URLSearchParams({ guest_id: auth.guestId });
  return apiFetch(
    `/public/shares/${encodeURIComponent(auth.token)}/collab/sessions/${encodeURIComponent(sessionId)}?${q}`,
    { headers: publicHeaders(auth) },
  ) as Promise<CollabSession>;
}

export async function heartbeatPublicCollabSession(
  auth: PublicShareAuth,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<CollabSession> {
  const q = new URLSearchParams({ guest_id: auth.guestId });
  return apiFetch(
    `/public/shares/${encodeURIComponent(auth.token)}/collab/sessions/${encodeURIComponent(sessionId)}/heartbeat?${q}`,
    {
      method: "POST",
      headers: publicHeaders(auth),
      body: JSON.stringify(body),
    },
  ) as Promise<CollabSession>;
}

export async function listPublicCollabOps(
  auth: PublicShareAuth,
  sessionId: string,
  afterSeq: number,
): Promise<CollabOp[]> {
  const q = new URLSearchParams({
    guest_id: auth.guestId,
    after_seq: String(afterSeq),
  });
  return apiFetch(
    `/public/shares/${encodeURIComponent(auth.token)}/collab/sessions/${encodeURIComponent(sessionId)}/ops?${q}`,
    { headers: publicHeaders(auth) },
  ) as Promise<CollabOp[]>;
}

export async function postPublicCollabOp(
  auth: PublicShareAuth,
  sessionId: string,
  body: {
    base_seq: number;
    op_type: string;
    payload: Record<string, unknown>;
    client_op_id?: string;
  },
): Promise<CollabOp> {
  return apiFetch(
    `/public/shares/${encodeURIComponent(auth.token)}/collab/sessions/${encodeURIComponent(sessionId)}/ops`,
    {
      method: "POST",
      headers: publicHeaders(auth),
      body: JSON.stringify({ ...body, guest_id: auth.guestId }),
    },
  ) as Promise<CollabOp>;
}

export function collabWsUrl(
  sessionId: string,
  publicShare?: PublicShareAuth | null,
): string {
  const base =
    typeof window !== "undefined" && API_BASE.startsWith("http")
      ? API_BASE
      : `${window.location.origin}${API_BASE.startsWith("/") ? API_BASE : `/${API_BASE}`}`;
  const wsBase = base.replace(/^http/, "ws");
  if (publicShare?.token) {
    const params = new URLSearchParams({ guest_id: publicShare.guestId });
    if (publicShare.sharePassword) {
      params.set("password", publicShare.sharePassword);
    }
    return `${wsBase}/public/shares/${encodeURIComponent(publicShare.token)}/collab/sessions/${encodeURIComponent(sessionId)}/ws?${params}`;
  }
  return `${wsBase}/collab/sessions/${encodeURIComponent(sessionId)}/ws`;
}

/** Human: Stable guest identity for anonymous public-share collab. */
export function getOrCreatePublicCollabGuestId(): string {
  const key = "ownly_public_collab_guest_id";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && existing.length >= 8) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `g-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `g-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
