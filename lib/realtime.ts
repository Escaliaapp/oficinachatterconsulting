"use client";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A later reconnect/event invalidates an older in-flight snapshot. */
export class SnapshotReconciler<T> {
  private revision = 0;
  private disposed = false;
  constructor(private fetchSnapshot: () => Promise<T>, private apply: (snapshot: T) => void) {}
  async recover() {
    const revision = ++this.revision;
    const snapshot = await this.fetchSnapshot();
    if (!this.disposed && revision === this.revision) this.apply(snapshot);
  }
  dispose() { this.disposed = true; this.revision++; }
}
export interface RoomRealtimeOptions<T> {
  roomId: string;
  userId: string;
  fetchSnapshot: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onPresence: (connections: number, typing: number) => void;
  onReaction: (emoji: string) => void;
  onConnection: (state: "connecting" | "connected" | "reconnecting") => void;
}

export async function connectRoomRealtime<T>(db: SupabaseClient, options: RoomRealtimeOptions<T>) {
  if (!/^[a-f0-9-]{36}$/i.test(options.roomId)) throw new Error("Identificador de sala inválido.");
  const auth = await db.auth.getUser();
  if (auth.error || auth.data.user?.id !== options.userId) throw new Error("Se requiere una sesión autenticada.");
  await db.realtime.setAuth();
  const reconcile = new SnapshotReconciler(options.fetchSnapshot, options.onSnapshot);
  const recover = () => { void reconcile.recover().catch(() => options.onConnection("reconnecting")); };
  const authoritative = db.channel(`room:${options.roomId}`, { config: { private: true } });
  const ephemeral = db.channel(`presence:room:${options.roomId}`, { config: { private: true, presence: { key: options.userId }, broadcast: { self: false } } });
  options.onConnection("connecting");
  authoritative.on("broadcast", { event: "state_changed" }, recover).subscribe((status) => {
    if (status === "SUBSCRIBED") { options.onConnection("connected"); recover(); }
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") options.onConnection("reconnecting");
  });
  ephemeral.on("presence", { event: "sync" }, () => {
    const peers = Object.values(ephemeral.presenceState<{ typing?: boolean }>()).flat();
    options.onPresence(peers.length, peers.filter((peer) => peer.typing).length);
  }).on("broadcast", { event: "reaction" }, ({ payload }) => {
    if (payload && ["heart", "spark", "laugh", "wow"].includes(payload.emoji)) options.onReaction(payload.emoji as string);
  }).subscribe((status) => { if (status === "SUBSCRIBED") void ephemeral.track({ typing: false }); });
  const { data: listener } = db.auth.onAuthStateChange((_event, session) => {
    // Auth callbacks must not await other auth calls while the SDK holds its lock.
    if (session) void db.realtime.setAuth(session.access_token);
  });
  let lastReactionAt = 0;
  return {
    recover,
    setTyping: (typing: boolean) => ephemeral.track({ typing }),
    react: async (emoji: string) => {
      if (!["heart", "spark", "laugh", "wow"].includes(emoji) || Date.now() - lastReactionAt < 800) return;
      lastReactionAt = Date.now();
      await ephemeral.send({ type: "broadcast", event: "reaction", payload: { emoji } });
    },
    disconnect: async () => { reconcile.dispose(); listener.subscription.unsubscribe(); await Promise.all([db.removeChannel(authoritative), db.removeChannel(ephemeral)]); },
  };
}
