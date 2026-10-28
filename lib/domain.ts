import { moderateText } from './moderation';

export type Role = 'subscriber' | 'advertiser' | 'moderator';
export type ProposalStatus = 'draft' | 'pending_moderation' | 'approved' | 'eligible' | 'selected' | 'generating' | 'ready' | 'played' | 'rejected' | 'cancelled' | 'failed';
export type AuctionStatus = 'scheduled' | 'open' | 'extended' | 'closing' | 'settled' | 'cancelled' | 'failed';
export type GenerationStatus = 'queued' | 'moderating' | 'submitted' | 'generating' | 'processing_output' | 'ready' | 'rejected' | 'retrying' | 'failed' | 'cancelled';
export type SceneKind = 'community' | 'sponsored';
export type CreditAccount = { available: number; reserved: number; total: number };
export type User = { id: string; name: string; role: Role; avatar: string; suspended: boolean };
export type CurrentUser = User & { balance: CreditAccount };
export type Proposal = {
  id: string; authorId: string; author: string; avatar: string; title: string; prompt: string;
  kind: SceneKind; status: ProposalStatus; votes: number; votedByMe: boolean; createdAt: number; reason?: string;
};
type StoredProposal = Omit<Proposal, 'votedByMe'> & { voters: string[] };
export type Clip = {
  id: string; proposalId: string; title: string; prompt: string; authorId: string; author: string; avatar: string;
  kind: SceneKind; videoUrl: string; posterUrl: string; duration: number; startedAt?: number; selectionReason: string;
};
export type ChatMessage = { id: string; authorId: string; author: string; avatar: string; text: string; at: number; system?: boolean };
export type Bid = { id: string; userId: string; name: string; amount: number; proposalId: string; at: number };
export type Auction = {
  id: string; status: AuctionStatus; endsAt: number; startsAt: number; leader: Bid | null;
  minBid: number; increment: number; bids: Bid[]; extensions: number; maxExtensions: number; winner?: Bid; settledAt?: number;
};
export type GenerationJob = {
  id: string; proposalId: string; title: string; author: string; status: GenerationStatus;
  startedAt: number; estimatedReadyAt: number; estimatedSeconds: number; provider: 'demo'; stageLabel: string; attempts: number;
};
export type LedgerEntry = Readonly<{
  id: string; userId: string; kind: 'grant' | 'reserve' | 'release' | 'consume' | 'adjustment';
  availableDelta: number; reservedDelta: number; amount: number; reference: string; idempotencyKey: string; at: number;
}>;
export type AuditEvent = { id: string; actorId: string; action: string; targetId: string; detail: string; at: number };
export type ContentReport = { id: string; authorId: string; targetId: string; reason: string; status: 'open' | 'resolved'; createdAt: number };
export type Appeal = { id: string; authorId: string; proposalId: string; reason: string; status: 'open' | 'resolved'; createdAt: number };
export type Notification = { id: string; userId: string; text: string; type: 'info' | 'success' | 'warning'; at: number };
export type RoomSnapshot = {
  mode: 'demo'; serverTime: number; room: { id: string; name: string; viewers: number; paused: boolean; communityPercent: number };
  user: CurrentUser | null; currentClip: Clip; nextClip: Clip | null; queue: Clip[]; history: Clip[];
  proposals: Proposal[]; chat: ChatMessage[]; auction: Auction; generations: GenerationJob[];
  reactions: { emoji: string; count: number }[]; notifications: Notification[];
  stats: { generated: number; communityTurns: number; sponsoredTurns: number; buffer: number; generationLatencySeconds: number; errors: number; participation: number };
  admin: null | { reports: ContentReport[]; appeals: Appeal[]; audit: AuditEvent[]; ledger: LedgerEntry[]; users: (User & { balance: CreditAccount })[] };
};
export type Action =
  | { type: 'chat'; text: string }
  | { type: 'react'; emoji: string }
  | { type: 'vote'; proposalId: string }
  | { type: 'propose'; prompt: string; kind?: SceneKind; title?: string }
  | { type: 'bid'; proposalId: string; amount: number }
  | { type: 'report'; targetId: string; reason: string }
  | { type: 'appeal'; proposalId: string; reason: string }
  | { type: 'moderate'; proposalId: string; decision: 'approve' | 'reject'; reason?: string }
  | { type: 'admin'; operation: 'pause_room' | 'resume_room' | 'close_auction' | 'cancel_auction' | 'new_auction' | 'select_community' | 'suspend_user' | 'remove_clip' | 'credit_adjustment' | 'resolve_report' | 'resolve_appeal'; targetId?: string; amount?: number; reason?: string };

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = 'DomainError'; }
}

const proposalTransitions: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ['pending_moderation', 'cancelled'], pending_moderation: ['approved', 'rejected', 'cancelled'],
  approved: ['eligible', 'rejected', 'cancelled'], eligible: ['selected', 'rejected', 'cancelled'],
  selected: ['generating', 'cancelled', 'failed'], generating: ['ready', 'failed', 'cancelled', 'rejected'],
  ready: ['played', 'cancelled'], played: [], rejected: ['pending_moderation'], cancelled: [], failed: ['eligible', 'cancelled'],
};
export function assertProposalTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (!proposalTransitions[from].includes(to)) throw new DomainError('invalid_transition', `La transición ${from} → ${to} no está permitida.`, 409);
}

/** FIFO mutex: every authoritative read/tick and action is serialized on the server. */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}

const REACTIONS = ['💜', '✨', '🔥', '🌙', '👏', '❤️'];
const GENERATION_MS = 20_000;
const CLIP_MS = 30_000;
const nowId = (prefix: string, n: number) => `${prefix}-${n.toString(36)}`;
const safeClone = <T,>(value: T): T => structuredClone(value);

/** In-memory transactional demo. No monetary value. Replaced by PostgreSQL RPCs for production. */
export class DemoEngine {
  readonly mutex = new AsyncMutex();
  private sequence = 0;
  private users = new Map<string, User>();
  private accounts = new Map<string, CreditAccount>();
  private ledger: LedgerEntry[] = [];
  private ledgerKeys = new Set<string>();
  private processed = new Map<string, { fingerprint: string; message: string }>();
  private proposals: StoredProposal[] = [];
  private chat: ChatMessage[] = [];
  private generations: GenerationJob[] = [];
  private queue: Clip[] = [];
  private history: Clip[] = [];
  private reports: ContentReport[] = [];
  private appeals: Appeal[] = [];
  private audit: AuditEvent[] = [];
  private notifications: Notification[] = [];
  private reactionCounts = new Map<string, number>([['💜', 128], ['✨', 86], ['🔥', 43], ['🌙', 24]]);
  private paused = false;
  private pausedAt = 0;
  private currentClip: Clip;
  private auction: Auction;
  private lastCommunitySelection: number;
  private lastActivity: number;
  private simulatedStep = 0;
  private simulatedOutbid = false;
  private turns = { community: 1, sponsored: 0 };
  private generated = 3;
  private errors = 0;
  private participation = 0;
  private playedAuthors: string[] = ['luna'];

  constructor(readonly clock: () => number = Date.now, private continuousDemo = false) {
    const now = clock();
    this.lastCommunitySelection = now;
    this.lastActivity = now;
    for (const [id, name, avatar, role] of [
      ['luna', 'Luna', 'L', 'subscriber'], ['milo', 'Milo', 'M', 'subscriber'],
      ['sol', 'Sol', 'S', 'subscriber'], ['nova', 'Nova', 'N', 'advertiser'],
    ] as const) this.addUser({ id, name, avatar, role, suspended: false }, 1200);

    const garden = this.seedProposal('garden', 'luna', 'Un jardín que sueña', 'Un jardín nocturno sobre la luna, flores luminosas y escaleras que flotan entre estrellas.', 'community', 'played', 142, now - 90_000);
    const jelly = this.seedProposal('jellyfish', 'milo', 'El océano sobre nosotros', 'Medusas de cristal flotan entre edificios de una ciudad sumergida en luz violeta.', 'community', 'ready', 96, now - 70_000);
    const desert = this.seedProposal('desert', 'sol', 'Dunas de otro planeta', 'Dunas de arena lavanda bajo un sol coral; una pequeña viajera descubre un oasis imposible.', 'community', 'generating', 82, now - 60_000);
    this.seedProposal('proposal-origami', 'luna', 'Cuando el papel aprende a volar', 'Una bandada de pájaros de origami despierta en una biblioteca infinita y vuela entre libros abiertos.', 'community', 'eligible', 64, now - 45_000);
    this.seedProposal('proposal-whale', 'milo', 'Ballenas entre las nubes', 'Una ballena transparente atraviesa un cielo de nubes rosadas al atardecer, con pequeñas estrellas en su interior.', 'community', 'eligible', 48, now - 35_000);
    this.seedProposal('proposal-train', 'sol', 'El último tren a Saturno', 'Un pequeño tren de luz atraviesa los anillos de Saturno y se detiene en una estación de flores.', 'community', 'eligible', 37, now - 25_000);
    this.seedProposal('sponsor-nova', 'nova', 'Pausa para imaginar · Nova Studio', 'Una taza de cerámica original flota sobre un jardín violeta. Un instante de calma, presentado por Nova Studio.', 'sponsored', 'eligible', 0, now - 55_000);
    this.currentClip = this.makeClip(garden, now);
    this.queue.push(this.makeClip(jelly));
    this.generations.push({ id: 'generation-desert', proposalId: desert.id, title: desert.title, author: desert.author, status: 'generating', startedAt: now - 7_000, estimatedReadyAt: now + 13_000, estimatedSeconds: 20, provider: 'demo', stageLabel: 'Imaginando', attempts: 1 });
    this.history.push({ ...this.makeClip(garden), id: 'clip-garden-before', title: 'El despertar del jardín', startedAt: now - 30_000 });
    this.chat = [
      { id: 'chat-1', authorId: 'milo', author: 'Milo', avatar: 'M', text: 'Ese jardín parece un recuerdo que todavía no tengo.', at: now - 45_000 },
      { id: 'chat-2', authorId: 'sol', author: 'Sol', avatar: 'S', text: 'Las flores que flotan 🌙', at: now - 28_000 },
      { id: 'chat-3', authorId: 'luna', author: 'Luna', avatar: 'L', text: '¡Mi idea está en pantalla! Gracias por los votos 💜', at: now - 14_000 },
      { id: 'chat-4', authorId: 'nova', author: 'Nova', avatar: 'N', text: 'Yo me quedo a ver las medusas.', at: now - 6_000 },
    ];
    const firstBid: Bid = { id: 'bid-seed', userId: 'nova', name: 'Nova', amount: 120, proposalId: 'sponsor-nova', at: now - 15_000 };
    this.auction = { id: 'auction-1', status: 'open', startsAt: now - 25_000, endsAt: now + (continuousDemo ? 80_000 : 140_000), leader: firstBid, minBid: 130, increment: 10, bids: [firstBid], extensions: 0, maxExtensions: 2 };
    this.entry('nova', 'reserve', -120, 120, 'auction-1', 'seed-reserve', now);
  }

  private id(prefix: string): string { return nowId(prefix, ++this.sequence); }
  private addUser(user: User, credits: number): void {
    this.users.set(user.id, { ...user });
    this.accounts.set(user.id, { available: 0, reserved: 0, total: 0 });
    this.entry(user.id, 'grant', credits, 0, 'demo-welcome', `welcome:${user.id}`, this.clock());
  }

  createDemoUser(role: Role, sessionId: string): User {
    const existing = this.users.get(`demo-${sessionId}`);
    if (existing) {
      if (existing.role !== role) throw new DomainError('identity_conflict', 'Esta identidad ya existe con otro perfil.', 409);
      return { ...existing };
    }
    const user: User = { id: `demo-${sessionId}`, name: role === 'advertiser' ? 'Tú · Studio' : role === 'moderator' ? 'Tú · Moderación' : 'Tú', role, avatar: 'T', suspended: false };
    this.addUser(user, 1200);
    if (role === 'advertiser') {
      this.seedProposal(`sponsor-${user.id}`, user.id, 'Una pausa creativa · Tu Studio', 'Una taza artesanal gira lentamente entre flores luminosas. Una pausa para imaginar, presentada por Tu Studio.', 'sponsored', 'eligible', 0, this.clock());
      this.record('system', 'demo_advertiser_approved', user.id, 'Anuncio de muestra y anunciante preaprobados únicamente para la demo.');
    }
    this.record(user.id, 'demo_session', user.id, `Acceso de demostración: ${role}. Créditos sin valor monetario.`);
    return { ...user };
  }

  getUser(id: string): User | null { const user = this.users.get(id); return user ? { ...user } : null; }
  getBalance(id: string): CreditAccount { return { ...(this.accounts.get(id) ?? { available: 0, reserved: 0, total: 0 }) }; }
  getLedger(): LedgerEntry[] { return this.ledger.map((entry) => ({ ...entry })); }

  private seedProposal(id: string, authorId: string, title: string, prompt: string, kind: SceneKind, status: ProposalStatus, votes: number, createdAt: number): StoredProposal {
    const author = this.users.get(authorId)!;
    const proposal: StoredProposal = { id, authorId, title, prompt, kind, status, votes, voters: [], createdAt, author: author.name, avatar: author.avatar };
    this.proposals.push(proposal);
    return proposal;
  }

  private entry(userId: string, kind: LedgerEntry['kind'], availableDelta: number, reservedDelta: number, reference: string, idempotencyKey: string, at: number): void {
    if (this.ledgerKeys.has(idempotencyKey)) return;
    if (![availableDelta, reservedDelta].every(Number.isSafeInteger)) throw new DomainError('invalid_credit_amount', 'Los créditos deben ser enteros.');
    const current = this.accounts.get(userId);
    if (!current) throw new DomainError('unknown_account', 'La cuenta de créditos no existe.', 404);
    const available = current.available + availableDelta;
    const reserved = current.reserved + reservedDelta;
    if (available < 0 || reserved < 0) throw new DomainError('insufficient_credits', 'No tienes suficientes créditos disponibles.', 409);
    const next = Object.freeze({ id: this.id('ledger'), userId, kind, availableDelta, reservedDelta, amount: Math.max(Math.abs(availableDelta), Math.abs(reservedDelta)), reference, idempotencyKey, at });
    this.ledger.push(next);
    this.ledgerKeys.add(idempotencyKey);
    this.accounts.set(userId, { available, reserved, total: available + reserved });
  }

  private record(actorId: string, action: string, targetId: string, detail: string): void {
    this.audit.push({ id: this.id('audit'), actorId, action, targetId, detail, at: this.clock() });
  }
  private notify(userId: string, text: string, type: Notification['type'] = 'info'): void {
    this.notifications.push({ id: this.id('notice'), userId, text, type, at: this.clock() });
  }
  private transition(proposal: StoredProposal, status: ProposalStatus, actorId = 'system'): void {
    assertProposalTransition(proposal.status, status);
    const before = proposal.status;
    proposal.status = status;
    this.record(actorId, 'proposal_transition', proposal.id, `${before} → ${status}`);
  }
  private proposal(id: string): StoredProposal {
    const proposal = this.proposals.find((item) => item.id === id);
    if (!proposal) throw new DomainError('proposal_not_found', 'No encontramos esa propuesta.', 404);
    return proposal;
  }

  private makeClip(proposal: StoredProposal, startedAt?: number): Clip {
    const posterUrl = /medusa|oc[eé]ano/i.test(proposal.prompt) ? '/media/jellyfish.jpg' : /duna|desierto/i.test(proposal.prompt) ? '/media/desert.jpg' : '/media/moon-garden.jpg';
    return { id: this.id('clip'), proposalId: proposal.id, title: proposal.title, prompt: proposal.prompt, authorId: proposal.authorId, author: proposal.author, avatar: proposal.avatar, kind: proposal.kind, videoUrl: posterUrl.replace('.jpg', '.mp4'), posterUrl, duration: 30, ...(startedAt ? { startedAt } : {}), selectionReason: proposal.kind === 'sponsored' ? 'Turno patrocinado · ganador de la subasta' : 'Elegido por la comunidad · votos, espera y diversidad' };
  }

  private ambientClip(now: number): Clip {
    return { id: this.id('ambient'), proposalId: 'ambient', title: 'Una pausa entre mundos', prompt: 'Pieza ambiental de la sala mientras preparamos la siguiente escena.', authorId: 'system', author: 'La sala', avatar: '◌', kind: 'community', videoUrl: '/media/moon-garden.mp4', posterUrl: '/media/moon-garden.jpg', duration: 30, startedAt: now, selectionReason: 'Buffer ambiental · demo' };
  }

  snapshot(userId: string | null = null): RoomSnapshot {
    const user = userId ? this.users.get(userId) : undefined;
    const proposals = this.proposals.filter((p) => ['eligible', 'pending_moderation', 'generating', 'selected', 'ready'].includes(p.status) || p.authorId === userId || user?.role === 'moderator');
    const publicAuction = { ...this.auction, minBid: this.auction.leader ? this.auction.leader.amount + this.auction.increment : 50 };
    return safeClone({
      mode: 'demo', serverTime: this.clock(), room: { id: 'impossible-garden', name: 'El jardín de lo imposible', viewers: 248, paused: this.paused, communityPercent: 80 },
      user: user ? { ...user, balance: this.getBalance(user.id) } : null,
      currentClip: this.currentClip, nextClip: this.nextPlayable() ?? null, queue: this.queue, history: this.history.slice(-10).reverse(),
      proposals: proposals.map(({ voters, ...proposal }) => ({ ...proposal, votedByMe: !!userId && voters.includes(userId) })),
      chat: this.chat.slice(-60), auction: publicAuction, generations: this.generations.slice(-12),
      reactions: Array.from(this.reactionCounts, ([emoji, count]) => ({ emoji, count })), notifications: this.notifications.filter((n) => n.userId === userId).slice(-15),
      stats: { generated: this.generated, communityTurns: this.turns.community, sponsoredTurns: this.turns.sponsored, buffer: this.queue.length, generationLatencySeconds: 20, errors: this.errors, participation: this.participation },
      admin: user?.role === 'moderator' ? { reports: this.reports, appeals: this.appeals, audit: this.audit.slice(-150).reverse(), ledger: this.ledger.slice(-150).reverse(), users: Array.from(this.users.values(), (u) => ({ ...u, balance: this.getBalance(u.id) })) } : null,
    });
  }

  execute(userId: string, action: Action, idempotencyKey: string): { message: string; duplicate: boolean } {
    const user = this.users.get(userId);
    if (!user) throw new DomainError('unauthenticated', 'Inicia sesión para participar.', 401);
    if (user.suspended) throw new DomainError('suspended', 'Tu cuenta está suspendida. Contacta con moderación.', 403);
    const key = `${userId}:${idempotencyKey}`;
    const fingerprint = JSON.stringify(action);
    const previous = this.processed.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new DomainError('idempotency_conflict', 'Esta clave ya se utilizó para otra acción.', 409);
      return { message: previous.message, duplicate: true };
    }
    if (this.paused && !['admin', 'report', 'appeal', 'moderate'].includes(action.type)) throw new DomainError('room_paused', 'La sala está pausada por moderación.', 409);
    let message: string;
    switch (action.type) {
      case 'chat': message = this.sendChat(user, action.text); break;
      case 'react': {
        if (!REACTIONS.includes(action.emoji)) throw new DomainError('invalid_reaction', 'Elige una de las reacciones disponibles.');
        this.reactionCounts.set(action.emoji, (this.reactionCounts.get(action.emoji) ?? 0) + 1);
        message = 'Tu reacción llegó a la sala.'; break;
      }
      case 'vote': {
        const proposal = this.proposal(action.proposalId);
        if (proposal.kind !== 'community' || proposal.status !== 'eligible') throw new DomainError('not_votable', 'Esta propuesta todavía no admite votos.', 409);
        if (proposal.voters.includes(user.id)) { proposal.voters = proposal.voters.filter((id) => id !== user.id); proposal.votes--; message = 'Retiraste tu voto.'; }
        else { proposal.voters.push(user.id); proposal.votes++; message = 'Tu voto cuenta. Gracias por dirigir la próxima escena.'; }
        break;
      }
      case 'propose': message = this.propose(user, action); break;
      case 'bid': message = this.placeBid(user, action.proposalId, action.amount, key); break;
      case 'report': {
        const targetExists = this.proposals.some((p) => p.id === action.targetId) || this.chat.some((c) => c.id === action.targetId) || [...this.queue, ...this.history, this.currentClip].some((c) => c.id === action.targetId);
        if (!targetExists) throw new DomainError('target_not_found', 'El contenido reportado ya no está disponible.', 404);
        this.reports.push({ id: this.id('report'), authorId: user.id, targetId: action.targetId, reason: action.reason, status: 'open', createdAt: this.clock() });
        this.record(user.id, 'content_reported', action.targetId, action.reason); message = 'Reporte enviado. Moderación lo revisará.'; break;
      }
      case 'appeal': {
        const proposal = this.proposal(action.proposalId);
        if (proposal.authorId !== user.id || proposal.status !== 'rejected') throw new DomainError('cannot_appeal', 'Sólo puedes apelar tus propuestas rechazadas.', 403);
        if (this.appeals.some((a) => a.proposalId === proposal.id && a.status === 'open')) throw new DomainError('appeal_exists', 'Esta propuesta ya tiene una apelación abierta.', 409);
        this.appeals.push({ id: this.id('appeal'), authorId: user.id, proposalId: proposal.id, reason: action.reason, status: 'open', createdAt: this.clock() });
        this.record(user.id, 'appeal_created', proposal.id, action.reason); message = 'Apelación recibida. La revisará una persona moderadora.'; break;
      }
      case 'moderate': message = this.moderate(user, action); break;
      case 'admin': message = this.adminAction(user, action, key); break;
    }
    this.participation++;
    this.processed.set(key, { fingerprint, message });
    return { message, duplicate: false };
  }

  private sendChat(user: User, text: string): string {
    const result = moderateText(text, 'chat');
    if (!result.approved) { this.record(user.id, 'chat_rejected', user.id, result.reason!); throw new DomainError('moderation_rejected', result.reason!, 422); }
    this.chat.push({ id: this.id('chat'), authorId: user.id, author: user.name, avatar: user.avatar, text, at: this.clock() });
    return 'Mensaje enviado.';
  }

  private propose(user: User, action: Extract<Action, { type: 'propose' }>): string {
    const kind = action.kind ?? (user.role === 'advertiser' ? 'sponsored' : 'community');
    if (kind === 'sponsored' && user.role !== 'advertiser') throw new DomainError('advertiser_required', 'Necesitas una cuenta de anunciante aprobada.', 403);
    if (kind === 'community' && user.role !== 'subscriber' && user.role !== 'moderator') throw new DomainError('subscriber_required', 'Las propuestas comunitarias requieren una suscripción.', 403);
    const pending = this.proposals.filter((p) => p.authorId === user.id && !['played', 'rejected', 'cancelled', 'failed'].includes(p.status)).length;
    if (pending >= 5) throw new DomainError('proposal_limit', 'Puedes tener hasta cinco propuestas activas.', 429);
    const title = action.title || action.prompt.slice(0, 58).replace(/\s+\S*$/, '') || action.prompt;
    const proposal = this.seedProposal(this.id('proposal'), user.id, title, action.prompt, kind, 'draft', 0, this.clock());
    this.transition(proposal, 'pending_moderation', user.id);
    const result = moderateText(`${title}. ${action.prompt}`, kind === 'sponsored' ? 'advertisement' : 'proposal');
    if (!result.approved) {
      this.transition(proposal, 'rejected'); proposal.reason = result.reason;
      this.notify(user.id, `Propuesta rechazada: ${result.reason}`, 'warning');
      return `Propuesta rechazada: ${result.reason} Puedes solicitar una apelación.`;
    }
    this.notify(user.id, kind === 'sponsored' ? 'Tu anuncio espera revisión humana antes de poder pujar.' : 'Tu idea está en moderación. En unos segundos podrá recibir votos.');
    return kind === 'sponsored' ? 'Anuncio enviado a revisión humana. Aún no puede participar en la subasta.' : 'Tu idea está en moderación. Pronto estará lista para recibir votos.';
  }

  private placeBid(user: User, proposalId: string, amount: number, key: string): string {
    const now = this.clock();
    if (user.role !== 'advertiser') throw new DomainError('advertiser_required', 'Sólo anunciantes aprobados pueden pujar.', 403);
    if (!['open', 'extended'].includes(this.auction.status) || now >= this.auction.endsAt) throw new DomainError('auction_closed', 'Esta subasta ya está cerrada.', 409);
    const proposal = this.proposal(proposalId);
    if (proposal.authorId !== user.id || proposal.kind !== 'sponsored' || proposal.status !== 'eligible') throw new DomainError('ineligible_proposal', 'Elige uno de tus anuncios aprobados y elegibles.', 403);
    if (this.playedAuthors.slice(-2).length === 2 && this.playedAuthors.slice(-2).every((id) => id === user.id)) throw new DomainError('author_limit', 'Deja espacio a otra persona antes de volver a patrocinar.', 409);
    const minimum = this.auction.leader ? this.auction.leader.amount + this.auction.increment : 50;
    if (!Number.isSafeInteger(amount) || amount < minimum || amount > 100_000) throw new DomainError('invalid_bid', `La oferta mínima es ${minimum} créditos.`, 409);
    const previous = this.auction.leader;
    const ownHold = previous?.userId === user.id ? previous.amount : 0;
    if (this.getBalance(user.id).available + ownHold < amount) throw new DomainError('insufficient_credits', 'Saldo insuficiente. Tu oferta anterior se considera al calcular el disponible.', 409);
    // All preconditions pass before any ledger mutation. The outer mutex commits this synchronously.
    if (previous) {
      this.entry(previous.userId, 'release', previous.amount, -previous.amount, this.auction.id, `${key}:release`, now);
      if (previous.userId !== user.id) this.notify(previous.userId, `Superaron tu oferta. Liberamos tus ${previous.amount} créditos.`, 'info');
    }
    this.entry(user.id, 'reserve', -amount, amount, this.auction.id, `${key}:reserve`, now);
    const bid: Bid = { id: this.id('bid'), userId: user.id, name: user.name, amount, proposalId, at: now };
    this.auction.bids.push(bid); this.auction.leader = bid;
    if (this.auction.endsAt - now <= 15_000 && this.auction.extensions < this.auction.maxExtensions) {
      this.auction.endsAt += 20_000; this.auction.extensions++; this.auction.status = 'extended';
      this.record('system', 'auction_extended', this.auction.id, 'Protección de ofertas tardías: +20 segundos.');
    }
    this.record(user.id, 'bid_reserved', this.auction.id, `${amount} créditos reservados para ${proposal.id}.`);
    this.notify(user.id, `Lideras con ${amount} créditos. Permanecen reservados hasta el cierre.`, 'success');
    return `Oferta aceptada: ${amount} créditos reservados. Sólo pagarás si ganas.`;
  }

  closeAuction(actorId = 'system', force = false): boolean {
    if (['settled', 'cancelled', 'failed'].includes(this.auction.status)) return false;
    if (!force && this.clock() < this.auction.endsAt) throw new DomainError('auction_not_due', 'La subasta todavía no termina.', 409);
    const leader = this.auction.leader;
    if (leader) {
      const proposal = this.proposal(leader.proposalId);
      if (proposal.status !== 'eligible' || this.users.get(leader.userId)?.suspended) {
        this.cancelAuction(actorId, 'El anuncio ganador dejó de ser elegible.'); return true;
      }
    }
    this.auction.status = 'closing';
    this.record(actorId, 'auction_closing', this.auction.id, 'Estado congelado; liquidación transaccional.');
    if (leader) {
      this.entry(leader.userId, 'consume', 0, -leader.amount, this.auction.id, `settle:${this.auction.id}`, this.clock());
      this.auction.winner = { ...leader };
      this.enqueue(this.proposal(leader.proposalId));
      this.notify(leader.userId, `Ganaste el turno patrocinado con ${leader.amount} créditos. Tu escena está en preparación.`, 'success');
    }
    this.auction.status = 'settled'; this.auction.settledAt = this.clock();
    this.record(actorId, 'auction_settled', this.auction.id, leader ? `Ganador ${leader.userId}; consumidos ${leader.amount} créditos.` : 'Sin ofertas.');
    return true;
  }

  private newAuction(actorId: string): void {
    if (!['settled', 'cancelled', 'failed'].includes(this.auction.status)) throw new DomainError('auction_active', 'Primero cierra o cancela la subasta activa.', 409);
    this.auction = { id: this.id('auction'), status: 'open', startsAt: this.clock(), endsAt: this.clock() + 140_000, leader: null, minBid: 50, increment: 10, bids: [], extensions: 0, maxExtensions: 2 };
    this.record(actorId, 'auction_opened', this.auction.id, 'Nuevo turno demo. No se modificaron los saldos ni la cola anterior.');
  }

  private cancelAuction(actorId: string, reason: string): void {
    if (['settled', 'cancelled', 'failed'].includes(this.auction.status)) throw new DomainError('auction_terminal', 'La subasta ya terminó.', 409);
    const leader = this.auction.leader;
    if (leader) this.entry(leader.userId, 'release', leader.amount, -leader.amount, this.auction.id, `cancel:${this.auction.id}`, this.clock());
    this.auction.status = 'cancelled'; this.auction.settledAt = this.clock();
    this.record(actorId, 'auction_cancelled', this.auction.id, reason);
    if (leader) this.notify(leader.userId, `Subasta cancelada. Liberamos ${leader.amount} créditos.`, 'warning');
  }

  selectCommunity(actorId = 'system'): StoredProposal | null {
    const now = this.clock();
    const candidates = this.proposals.filter((p) => p.kind === 'community' && p.status === 'eligible' && !this.users.get(p.authorId)?.suspended);
    const lastTwo = this.playedAuthors.slice(-2);
    const eligible = candidates.filter((p) => !(lastTwo.length === 2 && lastTwo.every((id) => id === p.authorId)));
    const score = (p: StoredProposal): number => p.votes + Math.min(60, (now - p.createdAt) / 10_000) - (this.playedAuthors.slice(-4).filter((id) => id === p.authorId).length * 22);
    eligible.sort((a, b) => score(b) - score(a) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const selected = eligible[0];
    if (!selected) return null;
    this.enqueue(selected, actorId); this.lastCommunitySelection = now;
    this.notify(selected.authorId, '¡La comunidad eligió tu idea! Estamos preparando tu escena.', 'success');
    return selected;
  }

  private enqueue(proposal: StoredProposal, actorId = 'system'): void {
    if (proposal.status !== 'eligible') throw new DomainError('not_approved', 'Sólo las propuestas aprobadas y elegibles pueden generarse.', 409);
    this.transition(proposal, 'selected', actorId); this.transition(proposal, 'generating');
    this.generations.push({ id: this.id('generation'), proposalId: proposal.id, title: proposal.title, author: proposal.author, status: 'queued', startedAt: this.clock(), estimatedReadyAt: this.clock() + GENERATION_MS, estimatedSeconds: 20, provider: 'demo', stageLabel: 'En cola', attempts: 1 });
  }

  private moderate(user: User, action: Extract<Action, { type: 'moderate' }>): string {
    this.requireModerator(user);
    const proposal = this.proposal(action.proposalId);
    if (!['pending_moderation', 'approved', 'eligible', 'rejected'].includes(proposal.status)) throw new DomainError('already_selected', 'Esta propuesta ya está seleccionada o terminada.', 409);
    if (action.decision === 'approve') {
      const result = moderateText(`${proposal.title}. ${proposal.prompt}`, proposal.kind === 'sponsored' ? 'advertisement' : 'proposal');
      if (!result.approved) throw new DomainError('policy_cannot_override', `La revisión humana no puede omitir la política: ${result.reason}`, 422);
      if (proposal.status === 'rejected') this.transition(proposal, 'pending_moderation', user.id);
      if (proposal.status === 'pending_moderation') this.transition(proposal, 'approved', user.id);
      if (proposal.status === 'approved') this.transition(proposal, 'eligible', user.id);
      delete proposal.reason;
      this.notify(proposal.authorId, 'Tu propuesta fue aprobada y ya es elegible.', 'success');
    } else {
      if (proposal.status === 'rejected') throw new DomainError('already_rejected', 'La propuesta ya está rechazada.', 409);
      if (this.auction.leader?.proposalId === proposal.id && ['open', 'extended'].includes(this.auction.status)) this.cancelAuction(user.id, 'El anuncio líder fue retirado por moderación.');
      this.transition(proposal, 'rejected', user.id); proposal.reason = action.reason || 'No cumple las normas de la sala.';
      this.notify(proposal.authorId, `Propuesta rechazada: ${proposal.reason}`, 'warning');
    }
    this.record(user.id, `moderation_${action.decision}`, proposal.id, action.reason || 'Revisión humana en modo demo.');
    return action.decision === 'approve' ? 'Propuesta aprobada y elegible.' : 'Propuesta rechazada. Se notificó a su autor.';
  }

  private requireModerator(user: User): void {
    if (user.role !== 'moderator') throw new DomainError('forbidden', 'Esta acción requiere permisos de moderación.', 403);
  }

  private adminAction(user: User, action: Extract<Action, { type: 'admin' }>, key: string): string {
    this.requireModerator(user);
    switch (action.operation) {
      case 'pause_room':
        if (!this.paused) { this.paused = true; this.pausedAt = this.clock(); }
        break;
      case 'resume_room': {
        if (this.paused) {
          const delay = this.clock() - this.pausedAt;
          this.currentClip.startedAt = (this.currentClip.startedAt ?? this.clock()) + delay;
          if (['open', 'extended'].includes(this.auction.status)) this.auction.endsAt += delay;
          for (const generation of this.generations.filter((g) => !['ready', 'failed', 'cancelled'].includes(g.status))) { generation.startedAt += delay; generation.estimatedReadyAt += delay; }
          this.lastCommunitySelection += delay; this.lastActivity += delay;
          this.paused = false;
        }
        break;
      }
      case 'close_auction': this.closeAuction(user.id, true); break;
      case 'new_auction': this.newAuction(user.id); break;
      case 'cancel_auction': this.cancelAuction(user.id, action.reason || 'Cancelada por moderación.'); break;
      case 'select_community': if (!this.selectCommunity(user.id)) throw new DomainError('empty_candidates', 'No hay propuestas elegibles en este momento.', 409); break;
      case 'suspend_user': {
        const target = this.users.get(action.targetId || '');
        if (!target || target.id === user.id) throw new DomainError('invalid_target', 'Elige otra cuenta válida.');
        target.suspended = !target.suspended;
        if (target.suspended && this.auction.leader?.userId === target.id && ['open', 'extended'].includes(this.auction.status)) this.cancelAuction(user.id, 'Cuenta líder suspendida.');
        break;
      }
      case 'remove_clip': {
        const id = action.targetId;
        if (id === this.currentClip.id) {
          const original = this.currentClip;
          this.currentClip = this.ambientClip(this.clock());
          this.record(user.id, 'current_clip_withdrawn', original.id, action.reason || 'Retirado por moderación.');
        } else if (!this.queue.some((clip) => clip.id === id) && !this.history.some((clip) => clip.id === id)) throw new DomainError('clip_not_found', 'No encontramos ese clip.', 404);
        for (const clip of this.queue.filter((c) => c.id === id)) this.transition(this.proposal(clip.proposalId), 'cancelled', user.id);
        this.queue = this.queue.filter((clip) => clip.id !== id); this.history = this.history.filter((clip) => clip.id !== id);
        break;
      }
      case 'credit_adjustment': {
        if (!action.targetId || !this.users.has(action.targetId) || !Number.isSafeInteger(action.amount) || !action.amount || Math.abs(action.amount) > 10_000 || !action.reason?.trim()) throw new DomainError('invalid_adjustment', 'Indica una cuenta, un ajuste entero de hasta 10.000 créditos y su motivo.');
        this.entry(action.targetId, 'adjustment', action.amount, 0, `admin:${user.id}:${action.reason}`, `${key}:adjustment`, this.clock());
        break;
      }
      case 'resolve_report': {
        const report = this.reports.find((r) => r.id === action.targetId);
        if (!report) throw new DomainError('report_not_found', 'Reporte no encontrado.', 404);
        report.status = 'resolved'; this.notify(report.authorId, 'Moderación revisó y resolvió tu reporte.'); break;
      }
      case 'resolve_appeal': {
        const appeal = this.appeals.find((r) => r.id === action.targetId);
        if (!appeal) throw new DomainError('appeal_not_found', 'Apelación no encontrada.', 404);
        appeal.status = 'resolved'; this.notify(appeal.authorId, 'Moderación revisó tu apelación. Consulta el estado de tu propuesta.'); break;
      }
    }
    this.record(user.id, action.operation, action.targetId || 'impossible-garden', action.reason || 'Acción administrativa de demostración.');
    return 'Acción aplicada y registrada en la auditoría.';
  }

  /** Authoritative deterministic clock. Clients only render snapshots and never settle auctions. */
  tick(): void {
    if (this.paused) return;
    const now = this.clock();
    if (this.continuousDemo && ['settled', 'cancelled'].includes(this.auction.status) && now - (this.auction.settledAt ?? now) >= 60_000) this.newAuction('demo');
    for (const proposal of this.proposals.filter((p) => p.status === 'pending_moderation' && p.kind === 'community' && now - p.createdAt >= 2_000)) {
      const result = moderateText(`${proposal.title}. ${proposal.prompt}`, 'proposal');
      if (result.approved) { this.transition(proposal, 'approved'); this.transition(proposal, 'eligible'); this.notify(proposal.authorId, 'Tu idea pasó la moderación y ya puede recibir votos.', 'success'); }
      else { this.transition(proposal, 'rejected'); proposal.reason = result.reason; }
    }
    if (['open', 'extended'].includes(this.auction.status) && now >= this.auction.endsAt) this.closeAuction();
    for (const generation of this.generations.filter((g) => !['ready', 'failed', 'cancelled', 'rejected'].includes(g.status))) {
      const elapsed = now - generation.startedAt;
      if (elapsed >= GENERATION_MS) {
        const proposal = this.proposal(generation.proposalId);
        const moderation = moderateText(`${proposal.title}. ${proposal.prompt}`, proposal.kind === 'sponsored' ? 'advertisement' : 'proposal');
        if (!moderation.approved) { generation.status = 'rejected'; generation.stageLabel = 'Salida rechazada'; this.transition(proposal, 'rejected'); proposal.reason = moderation.reason; this.errors++; continue; }
        generation.status = 'ready'; generation.stageLabel = 'Lista para salir';
        this.transition(proposal, 'ready'); this.queue.push(this.makeClip(proposal)); this.generated++;
        this.notify(proposal.authorId, 'Tu escena está lista y entró al buffer de reproducción.', 'success');
      } else if (elapsed >= 14_000) { generation.status = 'processing_output'; generation.stageLabel = 'Preparando'; }
      else if (elapsed >= 6_000) { generation.status = 'generating'; generation.stageLabel = 'Renderizando'; }
      else if (elapsed >= 4_000) { generation.status = 'submitted'; generation.stageLabel = 'Imaginando'; }
      else if (elapsed >= 2_000) { generation.status = 'moderating'; generation.stageLabel = 'Moderando'; }
    }
    if (now - (this.currentClip.startedAt ?? now) >= CLIP_MS) this.advancePlayback(now);
    const activeCommunity = this.generations.filter((g) => !['ready', 'failed', 'cancelled', 'rejected'].includes(g.status) && this.proposal(g.proposalId).kind === 'community').length;
    if (now - this.lastCommunitySelection >= 28_000 && this.queue.filter((c) => c.kind === 'community').length + activeCommunity < 3) this.selectCommunity();
    if (now - this.lastActivity >= 22_000) this.simulateActivity(now);
  }

  private nextPlayable(): Clip | undefined {
    const sponsorDue = (this.turns.community + this.turns.sponsored + 1) % 5 === 0;
    if (sponsorDue && this.currentClip.kind !== 'sponsored') {
      const sponsored = this.queue.find((c) => c.kind === 'sponsored' && !this.users.get(c.authorId)?.suspended);
      if (sponsored) return sponsored;
    }
    const candidates = this.queue.filter((c) => c.kind === 'community' && !this.users.get(c.authorId)?.suspended);
    const lastTwo = this.playedAuthors.slice(-2);
    return candidates.find((c) => !(lastTwo.length === 2 && lastTwo.every((id) => id === c.authorId)));
  }

  private advancePlayback(now: number): void {
    const next = this.nextPlayable();
    if (!next) {
      // A sponsored clip must never repeat indefinitely when the buffer empties.
      // Ambient playback does not consume a programmed community/sponsor turn.
      if (this.currentClip.authorId !== 'system') this.history.push({ ...this.currentClip });
      this.currentClip = this.ambientClip(now);
      return;
    }
    if (this.currentClip.authorId !== 'system') this.history.push({ ...this.currentClip });
    this.queue = this.queue.filter((clip) => clip.id !== next.id);
    this.currentClip = { ...next, startedAt: now };
    this.transition(this.proposal(next.proposalId), 'played');
    this.turns[next.kind]++;
    this.playedAuthors.push(next.authorId);
    this.notify(next.authorId, '¡Tu idea está en pantalla! Ya puedes compartir el replay.', 'success');
    this.record('system', 'clip_playing', next.id, `${next.kind}; autor ${next.authorId}.`);
  }

  private simulateActivity(now: number): void {
    this.lastActivity = now; this.simulatedStep++;
    const lines = [
      ['milo', 'La próxima escena tiene algo de otro planeta.'], ['sol', 'Acabo de votar por las ballenas entre las nubes ✨'],
      ['luna', 'Qué bonito imaginar esto en compañía.'], ['nova', 'Aquí cada idea abre un mundo distinto.'],
    ];
    const [id, text] = lines[(this.simulatedStep - 1) % lines.length];
    const user = this.users.get(id)!;
    this.chat.push({ id: this.id('chat'), authorId: id, author: user.name, avatar: user.avatar, text, at: now });
    this.reactionCounts.set('✨', (this.reactionCounts.get('✨') ?? 0) + 1);
    const candidate = this.proposals.find((p) => p.id === 'proposal-whale' && p.status === 'eligible');
    if (candidate) candidate.votes++;
    if (this.continuousDemo && this.proposals.filter(p => p.kind === 'community' && p.status === 'eligible').length < 3) {
      const ideas = [
        ['luna', 'La noche florece', 'Un jardín de flores luminosas se abre bajo una luna enorme y rosada.'],
        ['milo', 'Un océano de estrellas', 'Medusas de cristal flotan sobre un desierto nocturno bajo las estrellas.'],
        ['sol', 'La arquitectura de un sueño', 'Una estructura circular flota sobre dunas terracota al atardecer.'],
      ];
      const [author, title, prompt] = ideas[(this.simulatedStep - 1) % ideas.length];
      this.seedProposal(this.id('demo-idea'), author, title, prompt, 'community', 'eligible', 3, now);
    }
    const leader = this.auction.leader;
    if (!this.simulatedOutbid && ['open', 'extended'].includes(this.auction.status) && leader?.userId.startsWith('demo-') && leader.amount <= 300 && now - leader.at >= 25_000 && this.proposal('sponsor-nova').status === 'eligible') {
      // One clearly labelled simulated counteroffer makes reserve release demonstrable.
      this.execute('nova', { type: 'bid', amount: leader.amount + this.auction.increment, proposalId: 'sponsor-nova' }, `demo-counteroffer:${this.auction.id}`);
      this.simulatedOutbid = true;
      this.record('demo', 'simulated_counteroffer', this.auction.id, 'Una única contraoferta ficticia de Nova; no representa gasto real.');
    }
    this.record('demo', 'simulated_activity', 'impossible-garden', 'Mensaje, reacción y voto de participantes ficticios.');
  }
}
