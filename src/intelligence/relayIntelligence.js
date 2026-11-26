/**
 * Portable Nostr Intelligence Engine — Relay Fitness, Classification & Outbox Planner
 *
 * Pure, deterministic, host-agnostic TypeScript module (zero React, DOM, LLM, or Nostr SDK imports).
 * Never blindly assumes a user's existing relays are healthy or appropriate for public publishing.
 * Classifies relays by protocol role (general outbox, music/article specialty, directory-only,
 * encrypted chat/DM, fediverse bridge, paid/gated, community/niche, or broken/redirecting),
 * evaluates real NIP-11 / WebSocket / audience-overlap evidence, and produces a concrete Kind 10002 plan.
 */
import { ECOSYSTEM_DISCOVERY_RELAYS } from './nipRegistry.js';
import { endpoint } from '../core/urls.js';
export const CANDIDATE_DISCOVERY_RELAYS = [
    { url: 'wss://relay.damus.io', roleHint: 'general-outbox', label: 'Damus Public Outbox' },
    { url: 'wss://nos.lol', roleHint: 'general-outbox', label: 'nos.lol Public Outbox' },
    { url: 'wss://relay.primal.net', roleHint: 'general-outbox', label: 'Primal Discovery Relay' },
    { url: 'wss://relay.snort.social', roleHint: 'general-outbox', label: 'Snort Public Relay' },
    { url: 'wss://nostr.mom', roleHint: 'general-outbox', label: 'nostr.mom Public Relay' },
    { url: 'wss://offchain.pub', roleHint: 'general-outbox', label: 'Offchain Public Relay' },
    { url: 'wss://relay.wavlake.com', roleHint: 'music-specialty', label: 'Wavlake Music Relay' },
    { url: 'wss://nostr-01.yakihonne.com', roleHint: 'article-specialty', label: 'Yakihonne Articles Relay' },
    { url: 'wss://purplepag.es', roleHint: 'directory-index', label: 'Purple Pages Profile Directory' },
];
const KNOWN_GENERAL_OUTBOX_HOSTS = new Set([
    'relay.damus.io',
    'nos.lol',
    'relay.primal.net',
    'relay.snort.social',
    'nostr.mom',
    'offchain.pub',
    'relay.nostr.bg',
    'nostr.bitcoiner.social',
    'relay.nostr.band',
    'nostr.wine',
    'relay.noswhere.com',
    'eden.nostr.land',
    'relay.current.fyi',
    'relay.nostr.wirednet.jp',
]);
const KNOWN_MUSIC_HOSTS = new Set([
    'relay.wavlake.com',
    'relay.tunestr.io',
    'relay.zapstr.live',
]);
const KNOWN_ARTICLE_HOSTS = new Set([
    'nostr-01.yakihonne.com',
    'nostr-02.yakihonne.com',
    'relay.yakihonne.com',
    'relay.habla.news',
]);
const KNOWN_DIRECTORY_HOSTS = new Set([
    'purplepag.es',
    'user.kindpag.es',
    'indexer.coracle.social',
    'directory.yabu.me',
    'relay.nostr.directory',
]);
const DM_CHAT_RE = /(whitenoise|inbox|dm\.|chat\.|mls|nip17|nip-17|gift.?wrap|private\s+messages)/i;
const BRIDGE_RE = /(mostr\.pub|ditto\.pub|momostr|fediverse|activitypub|brid\.gy|bluesky|mastodon)/i;
const DIRECTORY_TEXT_RE = /(profile\s+directory|kind\s*0|metadata\s+only|indexer|purple\s*pages)/i;
function normalizeRelay(url) {
    if (typeof url !== 'string') return '';
    try {
        return endpoint(url, 'relay');
    }
    catch {
        return url.trim().replace(/\/+$/, '').toLowerCase();
    }
}
function isSafeRelayUrl(url) {
    if (typeof url !== 'string') return false;
    try {
        endpoint(url, 'relay');
        return true;
    }
    catch {
        return false;
    }
}
function getHostname(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        return url.replace(/^wss?:\/\//i, '').split('/')[0].toLowerCase();
    }
}
export function isSuitablePublicOutboxRole(role) {
    return role === 'general-outbox' || role === 'community-niche';
}
export function roleClassLabel(role) {
    switch (role) {
        case 'general-outbox':
            return 'Public Outbox';
        case 'music-specialty':
            return 'Music Discovery';
        case 'article-specialty':
            return 'Article Discovery';
        case 'directory-index':
            return 'Profile Directory';
        case 'dm-chat-only':
            return 'Chat / DM Only';
        case 'fediverse-bridge':
            return 'Fediverse Bridge';
        case 'paid-or-gated':
            return 'Paid / Auth-Gated';
        case 'community-niche':
            return 'Community / Niche';
        case 'dead-or-redirect':
            return 'Unreachable / Redirect';
    }
}
function verdictLabel(verdict) {
    switch (verdict) {
        case 'keep-outbox':
            return 'Keep in Outbox';
        case 'keep-read-only':
            return 'Read / Inbox Only';
        case 'specialty-only':
            return 'Specialty Broadcast';
        case 'demote-or-remove':
            return 'Remove from Write';
        case 'recommended-add':
            return 'Recommended Add';
    }
}
/**
 * Deterministically classify a relay's real role, policy constraints, health, and suitability
 * as a public NIP-65 write/outbox relay.
 */
export function classifyRelay(relay, options) {
    const normalizedUrl = normalizeRelay(relay.url);
    const host = getHostname(normalizedUrl);
    const status = relay.status ?? 'unknown';
    const overlap = options?.audienceOverlapCount ?? relay.audienceOverlapCount;
    const metaBlob = `${host} ${relay.nip11Name || ''} ${relay.nip11Description || ''} ${relay.nip11Software || ''}`;
    const policyFlags = [];
    if (relay.paymentRequired)
        policyFlags.push('Payment required');
    if (relay.authRequired)
        policyFlags.push('NIP-42 Auth required');
    if (relay.restrictedWrites)
        policyFlags.push('Restricted writes');
    if (relay.httpStatus && relay.httpStatus >= 300) {
        policyFlags.push(`HTTP ${relay.httpStatus}`);
    }
    if (relay.wsReachable === false)
        policyFlags.push('WebSocket handshake failed');
    const isDeadOrBroken = status === 'degraded' ||
        status === 'unreachable' ||
        relay.wsReachable === false ||
        (typeof relay.httpStatus === 'number' && (relay.httpStatus >= 300 && relay.httpStatus < 400 || relay.httpStatus >= 500));
    let roleClass = 'community-niche';
    if (isDeadOrBroken) {
        roleClass = 'dead-or-redirect';
    }
    else if (DM_CHAT_RE.test(metaBlob)) {
        roleClass = 'dm-chat-only';
    }
    else if (BRIDGE_RE.test(metaBlob)) {
        roleClass = 'fediverse-bridge';
    }
    else if (KNOWN_DIRECTORY_HOSTS.has(host) || DIRECTORY_TEXT_RE.test(metaBlob)) {
        roleClass = 'directory-index';
    }
    else if (KNOWN_MUSIC_HOSTS.has(host)) {
        roleClass = 'music-specialty';
    }
    else if (KNOWN_ARTICLE_HOSTS.has(host)) {
        roleClass = 'article-specialty';
    }
    else if (relay.paymentRequired || relay.authRequired || relay.restrictedWrites) {
        roleClass = 'paid-or-gated';
    }
    else if (KNOWN_GENERAL_OUTBOX_HOSTS.has(host)) {
        roleClass = 'general-outbox';
    }
    else {
        roleClass = 'community-niche';
    }
    // Score (0-100) for public publishing & discovery fitness
    let score = 60;
    let verdict = options?.isCandidate ? 'recommended-add' : 'keep-outbox';
    let reason = '';
    switch (roleClass) {
        case 'dead-or-redirect':
            score = 10;
            verdict = 'demote-or-remove';
            reason = BRIDGE_RE.test(metaBlob)
                ? `Fediverse bridge returning ${relay.httpStatus ? `HTTP ${relay.httpStatus}` : 'connection failure'}. Advertising broken bridges in Kind 10002 stalls client lookups and drops publishes.`
                : `Failed live reachability check (${relay.lastError || (relay.httpStatus ? `HTTP ${relay.httpStatus}` : status)}). Remove from your Kind 10002 write set so clients stop timing out.`;
            break;
        case 'dm-chat-only':
            score = 22;
            verdict = 'demote-or-remove';
            reason =
                'Encrypted chat / NIP-17 inbox relay — built for private DMs and MLS messaging, not public outbox discovery for music, articles, or photos. Keep it in a dedicated chat client, not as a public write relay.';
            break;
        case 'fediverse-bridge':
            score = 28;
            verdict = 'demote-or-remove';
            reason =
                'ActivityPub / Fediverse bridge relay — useful for cross-network bridging, but poor as a primary Nostr outbox relay because standard Nostr music/photo/article clients do not index bridges reliably.';
            break;
        case 'directory-index':
            score = 45;
            verdict = 'specialty-only';
            reason =
                'Profile & relay-list directory (Kind 0 / 3 / 10002 only). Rejects regular content events (notes, music, articles) — broadcast Kind 0 & 10002 here, but do not rely on it as a general write relay.';
            break;
        case 'music-specialty':
            score = 86;
            verdict = options?.isCandidate ? 'recommended-add' : 'specialty-only';
            reason =
                'Dedicated Nostr music discovery relay — broadcast Kind 36787 / 31337 tracks here alongside your general write outbox for music client indexing.';
            break;
        case 'article-specialty':
            score = 84;
            verdict = options?.isCandidate ? 'recommended-add' : 'specialty-only';
            reason =
                'Long-form reader relay (Yakihonne / NIP-23) — broadcast Kind 30023 articles here for reader feed placement.';
            break;
        case 'paid-or-gated':
            score = 54;
            verdict = relay.write ? 'keep-read-only' : 'keep-read-only';
            reason = `Access-restricted relay (${policyFlags.join(', ')}). Fine if you intentionally pay/authenticate here, but clients or followers without credentials may miss your public releases unless paired with open high-reach outbox relays.`;
            break;
        case 'general-outbox': {
            score = 92;
            if (typeof relay.latencyMs === 'number') {
                if (relay.latencyMs > 1200)
                    score -= 14;
                else if (relay.latencyMs > 600)
                    score -= 6;
                else if (relay.latencyMs < 250)
                    score += 5;
            }
            if (overlap && overlap > 0) {
                score = Math.min(100, score + Math.min(8, Math.round(overlap / 3)));
            }
            verdict = options?.isCandidate ? 'recommended-add' : 'keep-outbox';
            reason = overlap && overlap > 0
                ? `High-reach public outbox relay shared by ${overlap} sampled follows — strong delivery for Kind 0, 1, 20, 30023, and 36787.`
                : 'High-reach public outbox relay widely queried by Damus, Primal, Amethyst, Olas, and Nsite gateways.';
            break;
        }
        case 'community-niche': {
            score = 68;
            if (typeof relay.latencyMs === 'number' && relay.latencyMs > 1200) {
                score -= 10;
            }
            if (overlap && overlap >= 3) {
                score += 12;
            }
            verdict = options?.isCandidate
                ? 'recommended-add'
                : relay.write
                    ? 'keep-outbox'
                    : 'keep-read-only';
            reason =
                overlap && overlap >= 3
                    ? `Community relay active in your follow graph (${overlap} sampled follows). Good secondary write relay paired with 2–3 high-reach public outbox relays.`
                    : 'Niche or community relay. Works fine as 1 secondary outbox relay if you want community presence, but pair it with 2–3 high-reach public relays so broader Nostr clients actually see your work.';
            break;
        }
    }
    return {
        url: normalizedUrl,
        read: relay.read,
        write: relay.write,
        roleClass,
        roleLabel: roleClassLabel(roleClass),
        verdict,
        verdictLabel: verdictLabel(verdict),
        score: Math.max(0, Math.min(100, Math.round(score))),
        reason,
        status,
        latencyMs: relay.latencyMs,
        nip11Name: relay.nip11Name,
        policyFlags,
        audienceOverlapCount: overlap,
    };
}
/**
 * Build a complete, honest Relay Optimization Plan that NEVER assumes the user's current relays are right.
 */
export function buildRelayOptimizationPlan(params) {
    const { currentRelays, candidateRelays = [], followRelayCounts = {}, sampledFollowsCount = 0, hasMusic = false, hasArticles = false, } = params;
    const currentMap = new Map();
    for (const r of currentRelays) {
        currentMap.set(normalizeRelay(r.url), r);
    }
    const auditedRelays = currentRelays
        .map((r) => {
        const norm = normalizeRelay(r.url);
        return classifyRelay(r, {
            isCandidate: false,
            audienceOverlapCount: followRelayCounts[norm] ?? r.audienceOverlapCount,
        });
    })
        .sort((a, b) => {
        // Show broken/mismatched write relays first when auditing problems, then highest score
        const aProblem = a.write && a.verdict === 'demote-or-remove' ? 0 : 1;
        const bProblem = b.write && b.verdict === 'demote-or-remove' ? 0 : 1;
        if (aProblem !== bProblem)
            return aProblem - bProblem;
        return b.score - a.score;
    });
    // Build candidate pool: live-probed candidates + curated baseline discovery relays not already in user's list
    const candidateMap = new Map();
    for (const c of candidateRelays) {
        const norm = normalizeRelay(c.url);
        if (!currentMap.has(norm)) {
            candidateMap.set(norm, c);
        }
    }
    for (const baseline of CANDIDATE_DISCOVERY_RELAYS) {
        const norm = normalizeRelay(baseline.url);
        if (!currentMap.has(norm) && !candidateMap.has(norm)) {
            candidateMap.set(norm, {
                url: norm,
                read: true,
                write: baseline.roleHint === 'general-outbox',
                status: 'unknown',
                nip11Name: baseline.label,
            });
        }
    }
    // Also include top relays discovered from follow graph that aren't in currentRelays yet
    for (const [url, count] of Object.entries(followRelayCounts)) {
        if (!isSafeRelayUrl(url)) continue;
        const norm = normalizeRelay(url);
        if (count >= 2 && !currentMap.has(norm) && !candidateMap.has(norm)) {
            candidateMap.set(norm, {
                url: norm,
                read: true,
                write: true,
                status: 'unknown',
                audienceOverlapCount: count,
            });
        }
    }
    const discoveredCandidates = Array.from(candidateMap.values())
        .map((c) => {
        const norm = normalizeRelay(c.url);
        return classifyRelay(c, {
            isCandidate: true,
            audienceOverlapCount: followRelayCounts[norm] ?? c.audienceOverlapCount,
        });
    })
        .filter((c) => c.roleClass !== 'dead-or-redirect' && c.roleClass !== 'dm-chat-only' && c.roleClass !== 'fediverse-bridge')
        .sort((a, b) => {
        // Prioritize music/article specialty if relevant, plus general-outbox with high audience overlap
        const aOverlap = a.audienceOverlapCount ?? 0;
        const bOverlap = b.audienceOverlapCount ?? 0;
        const aBoost = (hasMusic && a.roleClass === 'music-specialty' ? 12 : 0) +
            (hasArticles && a.roleClass === 'article-specialty' ? 8 : 0) +
            (a.roleClass === 'general-outbox' ? 10 : 0) +
            Math.min(15, aOverlap * 2);
        const bBoost = (hasMusic && b.roleClass === 'music-specialty' ? 12 : 0) +
            (hasArticles && b.roleClass === 'article-specialty' ? 8 : 0) +
            (b.roleClass === 'general-outbox' ? 10 : 0) +
            Math.min(15, bOverlap * 2);
        return b.score + bBoost - (a.score + aBoost);
    });
    // Select optimal 4 public outbox WRITE relays:
    // 1) Up to 3 verified high-reach general-outbox relays (existing healthy first, then top discovered)
    // 2) Up to 1 healthy community/niche write relay from the user's current list (preserving their community!)
    // NEVER include dead-or-redirect, dm-chat-only, fediverse-bridge, or directory-index in public write outbox!
    // Preserve negative evidence even when duplicate endpoints or filtered
    // candidates would otherwise disappear from the ranking.
    const deniedRead = new Set();
    const deniedWrite = new Set();
    for (const r of [...currentRelays, ...candidateRelays]) {
        const a = classifyRelay(r);
        if (['dead-or-redirect', 'dm-chat-only', 'fediverse-bridge'].includes(a.roleClass)) deniedRead.add(a.url);
        if (deniedRead.has(a.url) || ['directory-index','paid-or-gated'].includes(a.roleClass) || r.authRequired || r.paymentRequired || r.restrictedWrites) deniedWrite.add(a.url);
    }
    const recommendedWriteRelays = [];
    const pushWrite = (url, max = 4) => {
        const norm = normalizeRelay(url);
        if (!norm.startsWith('wss://') || deniedWrite.has(norm) || recommendedWriteRelays.includes(norm) || recommendedWriteRelays.length >= max) {
            return;
        }
        recommendedWriteRelays.push(norm);
    };
    // Keep user's existing healthy general-outbox relays (whether currently marked read or write)
    for (const r of auditedRelays.filter((x) => x.roleClass === 'general-outbox')) {
        pushWrite(r.url, 3);
    }
    // Fill up to 3 general-outbox relays from discovered candidates (ranked by live health + follow overlap)
    for (const c of discoveredCandidates.filter((x) => x.roleClass === 'general-outbox')) {
        pushWrite(c.url, 3);
    }
    // Fallback to canonical generalOutbox if still < 3
    for (const fallback of ECOSYSTEM_DISCOVERY_RELAYS.generalOutbox) {
        pushWrite(fallback, 3);
    }
    // Preserve 1 healthy community/niche write relay from the user's existing set so we don't wipe out their home community
    const bestCommunityWrite = auditedRelays.find((x) => x.write && x.roleClass === 'community-niche');
    if (bestCommunityWrite) {
        pushWrite(bestCommunityWrite.url, 4);
    }
    else {
        // Otherwise add a 4th general-outbox relay if available
        const fourthGeneral = discoveredCandidates.find((x) => x.roleClass === 'general-outbox' && !recommendedWriteRelays.includes(x.url));
        if (fourthGeneral)
            pushWrite(fourthGeneral.url, 4);
    }
    // Recommended READ relays: our recommended write relays + up to 2 healthy read-only relays
    const recommendedReadRelays = [...recommendedWriteRelays];
    for (const r of auditedRelays) {
        if (r.read && !deniedRead.has(r.url) &&
            r.roleClass !== 'dead-or-redirect' &&
            r.roleClass !== 'dm-chat-only' &&
            r.roleClass !== 'fediverse-bridge' &&
            !recommendedReadRelays.includes(r.url) &&
            recommendedReadRelays.length < 5) {
            recommendedReadRelays.push(r.url);
        }
    }
    // Category broadcast sets (clean public outbox + specialty relay, never bridges/chat/broken)
    const recommendedMusicRelays = Array.from(new Set([
        ...recommendedWriteRelays.slice(0, 3),
        'wss://relay.wavlake.com',
        ...recommendedWriteRelays.slice(3, 4),
    ])).filter(url => !deniedWrite.has(normalizeRelay(url))).slice(0, 5);
    const recommendedArticleRelays = Array.from(new Set([
        ...recommendedWriteRelays.slice(0, 3),
        'wss://nostr-01.yakihonne.com',
        ...recommendedWriteRelays.slice(3, 4),
    ])).filter(url => !deniedWrite.has(normalizeRelay(url))).slice(0, 5);
    const relaysToDropOrDemote = auditedRelays.filter((r) => r.write &&
        (r.verdict === 'demote-or-remove' ||
            r.roleClass === 'dead-or-redirect' ||
            r.roleClass === 'dm-chat-only' ||
            r.roleClass === 'fediverse-bridge' ||
            r.roleClass === 'directory-index'));
    // Build exact Kind 10002 tags for the proposed clean outbox plan
    const proposedKind10002Tags = [];
    const allPlannedUrls = Array.from(new Set([...recommendedWriteRelays, ...recommendedReadRelays]));
    for (const url of allPlannedUrls) {
        const isRead = recommendedReadRelays.includes(url);
        const isWrite = recommendedWriteRelays.includes(url);
        if (isRead && isWrite)
            proposedKind10002Tags.push(['r', url]);
        else if (isWrite)
            proposedKind10002Tags.push(['r', url, 'write']);
        else
            proposedKind10002Tags.push(['r', url, 'read']);
    }
    const currentWriteCount = currentRelays.filter((r) => r.write).length;
    const generalWriteCount = auditedRelays.filter((r) => r.write && r.roleClass === 'general-outbox').length;
    const summaryParts = [];
    if (relaysToDropOrDemote.length > 0) {
        summaryParts.push(`${relaysToDropOrDemote.length} current write relay${relaysToDropOrDemote.length === 1 ? ' is' : 's are'} unsuitable for public publishing (${relaysToDropOrDemote
            .slice(0, 3)
            .map((r) => `${getHostname(r.url)}: ${r.roleLabel}`)
            .join('; ')}).`);
    }
    if (generalWriteCount === 0) {
        summaryParts.push('None of your current write relays are high-reach public outbox relays (damus / nos.lol / primal) — broad Nostr clients and music apps may never see new releases.');
    }
    if (currentWriteCount > 5) {
        summaryParts.push(`${currentWriteCount} write relays advertised — NIP-65 outbox works best with 3–5 fast public relays.`);
    }
    if (sampledFollowsCount > 0) {
        const topAudience = [...auditedRelays, ...discoveredCandidates]
            .filter((r) => (r.audienceOverlapCount ?? 0) > 0)
            .sort((a, b) => (b.audienceOverlapCount ?? 0) - (a.audienceOverlapCount ?? 0))
            .slice(0, 2);
        if (topAudience.length > 0) {
            summaryParts.push(`Audience sample (${sampledFollowsCount} follows) clusters on ${topAudience
                .map((r) => `${getHostname(r.url)} (${r.audienceOverlapCount})`)
                .join(' & ')}.`);
        }
    }
    return {
        auditedRelays,
        discoveredCandidates,
        recommendedWriteRelays,
        recommendedReadRelays,
        recommendedMusicRelays,
        recommendedArticleRelays,
        relaysToDropOrDemote,
        sampledFollowsCount,
        proposedKind10002Tags,
        summary: summaryParts.length > 0
            ? summaryParts.join(' ')
            : `Clean NIP-65 outbox: ${recommendedWriteRelays.length} candidate public write relays; live reachability and acceptance require verification.`,
    };
}
