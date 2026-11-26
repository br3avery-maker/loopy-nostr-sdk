import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNsiteIdentity, auditCoverage, detectAndPrepareContent, reconstructPreferences, recordCorrection, summarizeObservedActivity, } from '../src/intelligence/index.js';
import { analyzeAccountEcosystem, auditSinglePublication, } from '../src/intelligence/index.js';
test('reconstructPreferences distinguishes recovered, inferred, and unknown values', () => {
    const events = [
        {
            id: '1'.repeat(64),
            pubkey: 'a'.repeat(64),
            created_at: 1730000000,
            kind: 31337,
            tags: [
                ['d', 'night-train'],
                ['title', 'Night Train'],
                ['license', 'CC BY-SA 4.0'],
                ['t', 'ambient'],
                ['t', 'synth'],
            ],
            content: 'Ambient synth track',
        },
    ];
    const prefs = reconstructPreferences({
        events,
        profile: { display_name: 'Mira Solis' },
        relays: [
            { url: 'wss://relay.damus.io', read: true, write: true },
            { url: 'wss://nos.lol', read: true, write: false },
        ],
        blossomServers: [{ url: 'https://blossom.primal.net' }],
    });
    assert.equal(prefs.artistOrAuthorName.provenance, 'recovered');
    assert.equal(prefs.artistOrAuthorName.value, 'Mira Solis');
    assert.equal(prefs.preferredLicense.provenance, 'inferred');
    assert.equal(prefs.preferredLicense.value, 'CC BY-SA 4.0');
    assert.equal(prefs.defaultWriteRelays.provenance, 'recovered');
    assert.deepEqual(prefs.defaultWriteRelays.value, ['wss://relay.damus.io']);
    assert.equal(prefs.defaultBlossomServers.provenance, 'recovered');
    assert.equal(prefs.backupCadence.provenance, 'unknown');
    assert.equal(prefs.backupCadence.value, null);
});
test('detectAndPrepareContent auto-prepares MP3 + cover image as Kind 31337 music release', () => {
    const prefs = reconstructPreferences({
        events: [],
        profile: { name: 'Kova Audio' },
        relays: [{ url: 'wss://relay.nostr.band', read: true, write: true }],
        blossomServers: [{ url: 'https://cdn.satellite.earth' }],
    });
    const corrections = recordCorrection([], {
        contentType: 'music',
        field: 'license',
        previousValue: 'All Rights Reserved',
        correctedValue: 'CC BY 4.0',
    }, 1730001000);
    const draft = detectAndPrepareContent({
        submission: {
            assets: [
                {
                    name: '01-midnight-signal.mp3',
                    mimeType: 'audio/mpeg',
                    sizeBytes: 4820100,
                    sha256: 'ab'.repeat(32),
                    durationSec: 214,
                },
                {
                    name: 'cover.jpg',
                    mimeType: 'image/jpeg',
                    sizeBytes: 184200,
                    sha256: 'cd'.repeat(32),
                },
            ],
        },
        preferences: prefs,
        corrections,
        existingSites: [],
    });
    assert.equal(draft.detectedCategory, 'music');
    assert.equal(draft.kind, 31337);
    assert.equal(draft.title, 'Midnight Signal');
    assert.equal(draft.artist, 'Kova Audio');
    assert.equal(draft.license, 'CC BY 4.0');
    assert.equal(draft.readyToPublish, true);
    assert.ok(draft.tags.some((t) => t[0] === 'd' && t[1] === 'midnight-signal'));
    assert.ok(draft.tags.some((t) => t[0] === 'image' && t[1].includes('cd'.repeat(32))));
    assert.ok(draft.appliedCorrections.length === 1);
});
test('analyzeNsiteIdentity protects existing root nsite and preserves named site d-tag', () => {
    const existingSites = [
        {
            id: 'site-root',
            title: 'Personal Home',
            mode: 'root',
            format: 'legacy-34128',
            fileCount: 6,
            updatedAt: 1729000000,
        },
        {
            id: 'site-field-notes',
            title: 'Field Notes',
            mode: 'named',
            format: 'named-35128',
            dTag: 'field-notes',
            fileCount: 12,
            updatedAt: 1729500000,
        },
    ];
    // Updating named site must keep kind 35128 + dTag 'field-notes' without root overwrite risk
    const namedUpdate = analyzeNsiteIdentity({
        existingSites,
        assets: [{ name: 'index.html', path: '/index.html', mimeType: 'text/html', sizeBytes: 1200 }],
        requestedMode: 'named',
        requestedSlug: 'field-notes',
    });
    assert.equal(namedUpdate.detectedMode, 'named');
    assert.equal(namedUpdate.recommendedKind, 35128);
    assert.equal(namedUpdate.recommendedDTag, 'field-notes');
    assert.equal(namedUpdate.preservesIdentity, true);
    assert.equal(namedUpdate.rootOverwriteRisk, false);
    assert.equal(namedUpdate.legacyTransitionDetected, true);
    // Attempting to publish to root warns about overwriting existing root site
    const rootUpdate = analyzeNsiteIdentity({
        existingSites,
        assets: [{ name: 'index.html', path: '/index.html', mimeType: 'text/html', sizeBytes: 1200 }],
        requestedMode: 'root',
    });
    assert.equal(rootUpdate.detectedMode, 'root');
    assert.equal(rootUpdate.recommendedKind, 15128);
    assert.equal(rootUpdate.rootOverwriteRisk, true);
    assert.ok(rootUpdate.warnings.some((w) => w.includes('replace your existing root nsite')));
});
test('auditCoverage detects missing relays and missing Blossom mirrors accurately', () => {
    const report = auditCoverage([
        {
            id: 'pub-1',
            title: 'Tape Loop 04',
            category: 'music',
            kind: 31337,
            eventId: 'e1'.repeat(32),
            publishedRelays: ['wss://relay.damus.io'],
            expectedRelays: ['wss://relay.damus.io', 'wss://nos.lol'],
            assetHashes: ['ff'.repeat(32)],
            assetLocations: { ['ff'.repeat(32)]: ['https://blossom.primal.net'] },
            expectedBlossomServers: ['https://blossom.primal.net', 'https://blossom.band'],
        },
    ]);
    assert.equal(report.degradedCount, 1);
    assert.equal(report.overallRelayCoveragePct, 50);
    assert.equal(report.overallMediaCoveragePct, 50);
    assert.deepEqual(report.gaps[0].missingRelays, ['wss://nos.lol']);
    assert.deepEqual(report.gaps[0].missingAssets[0].missingServers, ['https://blossom.band']);
});
test('summarizeObservedActivity explicitly states queried relay provenance', () => {
    const summary = summarizeObservedActivity([
        {
            id: 'act-1',
            type: 'reaction',
            authorPubkey: 'b'.repeat(64),
            content: '+',
            createdAt: 1730000100,
            observedOnRelays: ['wss://relay.damus.io'],
        },
        {
            id: 'act-2',
            type: 'reply',
            authorPubkey: 'c'.repeat(64),
            content: 'Great track!',
            createdAt: 1730000200,
            observedOnRelays: ['wss://nos.lol'],
        },
    ], ['wss://relay.damus.io', 'wss://nos.lol']);
    assert.equal(summary.totalObserved, 2);
    assert.equal(summary.counts.reaction, 1);
    assert.equal(summary.counts.reply, 1);
    assert.ok(summary.provenanceStatement.includes('2 queried relays'));
});
test('detectAndPrepareContent emits full Kind 36787 music event with url, format, imeta, image, ai_generated, and V4V zap split', () => {
    const prefs = reconstructPreferences({
        events: [],
        profile: { display_name: 'Chaoticka', lud16: 'chaoticka@nostrcheck.me' },
        relays: [{ url: 'wss://relay.damus.io', read: true, write: true }],
        blossomServers: [{ url: 'https://blossom.primal.net' }],
    });
    const draft = detectAndPrepareContent({
        submission: {
            explicitHint: 'music',
            musicKindPreference: 36787,
            title: 'Neon Static',
            text: 'Glitchy electro single recorded live. #electronic',
            assets: [],
            externalAudioUrl: 'https://blossom.primal.net/' + 'a'.repeat(64) + '.mp3',
            externalAudioMime: 'audio/mpeg',
            externalAudioSha256: 'a'.repeat(64),
            externalDurationSec: 194,
            externalCoverUrl: 'https://blossom.primal.net/' + 'b'.repeat(64) + '.jpg',
            aiGenerated: false,
            zapPubkey: 'c'.repeat(64),
            zapRelay: 'wss://relay.damus.io',
        },
        preferences: prefs,
        corrections: [],
        existingSites: [],
    });
    assert.equal(draft.kind, 36787);
    assert.equal(draft.readyToPublish, true);
    assert.ok(draft.tags.some((t) => t[0] === 'd' && t[1] === 'neon-static'));
    assert.ok(draft.tags.some((t) => t[0] === 'url' && t[1].includes('a'.repeat(64))));
    assert.ok(draft.tags.some((t) => t[0] === 'format' && t[1] === 'audio/mpeg'));
    assert.ok(draft.tags.some((t) => t[0] === 'duration' && t[1] === '194'));
    assert.ok(draft.tags.some((t) => t[0] === 'image' && t[1].includes('b'.repeat(64))));
    assert.ok(draft.tags.some((t) => t[0] === 'ai_generated' && t[1] === 'false'));
    assert.ok(draft.tags.some((t) => t[0] === 'zap' && t[1] === 'c'.repeat(64)));
    assert.ok(draft.hashtags.includes('nostrmusic'));
    assert.ok(draft.hashtags.includes('electronic'));
});
test('analyzeAccountEcosystem detects trapped music in Kind 35128 nsite, bare Kind 1 media links, incomplete articles, and bloated outbox relays', () => {
    const report = analyzeAccountEcosystem({
        profile: {
            display_name: 'Chaoticka',
            nip05: 'Chaoticka@nostrcheck.me',
            about: 'Independent music & web experiments',
        },
        relays: [
            { url: 'wss://relay.damus.io', read: true, write: true, status: 'connected' },
            { url: 'wss://nos.lol', read: true, write: true, status: 'connected' },
            { url: 'wss://relay.primal.net', read: true, write: true, status: 'connected' },
            { url: 'wss://relay.mostr.pub', read: true, write: true, status: 'degraded' },
            { url: 'wss://relay.snort.social', read: true, write: true, status: 'connected' },
            { url: 'wss://nostr.wine', read: true, write: true, status: 'connected' },
            { url: 'wss://relay.nostr.band', read: true, write: true, status: 'connected' },
        ],
        blossomServers: [
            { url: 'https://blossom.primal.net' },
            { url: 'https://blossom.band' },
            { url: 'https://nostr.download' },
            { url: 'https://cdn.satellite.earth' },
            { url: 'https://blossom.oxtr.dev' },
            { url: 'https://files.v0l.io' },
        ],
        publications: [
            {
                id: 'pub-chaomusic',
                category: 'nsite',
                kind: 35128,
                title: 'Little Miss Chaos · Music Player',
                summary: 'Interactive browser music player',
                content: '',
                dTag: 'chaomusic',
                hashtags: [],
                tags: [
                    ['d', 'chaomusic'],
                    ['title', 'Little Miss Chaos · Music Player'],
                    ['path', '/index.html', '1'.repeat(64)],
                    ['path', '/tracks/chaos-01.mp3', '2'.repeat(64)],
                ],
                createdAt: 1730000000,
                publishedRelays: ['wss://relay.damus.io'],
                assets: [
                    {
                        name: 'index.html',
                        path: '/index.html',
                        mimeType: 'text/html',
                        sha256: '1'.repeat(64),
                        urls: ['https://blossom.primal.net/' + '1'.repeat(64)],
                        storedOnServers: ['https://blossom.primal.net'],
                        role: 'site-file',
                    },
                    {
                        name: 'chaos-01.mp3',
                        path: '/tracks/chaos-01.mp3',
                        mimeType: 'audio/mpeg',
                        sha256: '2'.repeat(64),
                        urls: ['https://blossom.primal.net/' + '2'.repeat(64)],
                        storedOnServers: ['https://blossom.primal.net'],
                        role: 'site-file',
                    },
                ],
            },
            {
                id: 'pub-melody-2048',
                category: 'nsite',
                kind: 35128,
                title: "Example 2048",
                summary: '2048 browser puzzle game',
                content: '',
                dTag: 'melody-2048',
                hashtags: [],
                tags: [
                    ['d', 'melody-2048'],
                    ['title', "Example 2048"],
                    ['path', '/index.html', '4'.repeat(64)],
                    ['path', '/sfx/merge.mp3', '5'.repeat(64)],
                ],
                createdAt: 1730000500,
                publishedRelays: ['wss://relay.damus.io'],
                assets: [
                    {
                        name: 'index.html',
                        path: '/index.html',
                        mimeType: 'text/html',
                        sha256: '4'.repeat(64),
                        urls: ['https://blossom.primal.net/' + '4'.repeat(64)],
                        storedOnServers: ['https://blossom.primal.net'],
                        role: 'site-file',
                    },
                    {
                        name: 'merge.mp3',
                        path: '/sfx/merge.mp3',
                        mimeType: 'audio/mpeg',
                        sha256: '5'.repeat(64),
                        urls: ['https://blossom.primal.net/' + '5'.repeat(64)],
                        storedOnServers: ['https://blossom.primal.net'],
                        role: 'site-file',
                    },
                ],
            },
            {
                id: 'pub-native-track-1',
                category: 'music',
                kind: 31337,
                title: 'Still Counts (Demo)',
                summary: '',
                content: '',
                dTag: 'still-counts',
                hashtags: [],
                tags: [
                    ['d', 'still-counts'],
                    ['title', 'Still Counts (Demo)'],
                    ['url', 'https://blossom.primal.net/' + '6'.repeat(64) + '.mp3'],
                ],
                createdAt: 1730000800,
                publishedRelays: ['wss://nos.lol'],
                assets: [],
            },
            {
                id: 'pub-bare-photo',
                category: 'post',
                kind: 1,
                title: 'https://blossom.primal.net/' + '3'.repeat(64),
                summary: 'https://blossom.primal.net/' + '3'.repeat(64),
                content: 'https://blossom.primal.net/' + '3'.repeat(64),
                hashtags: [],
                tags: [],
                createdAt: 1730001000,
                publishedRelays: ['wss://nos.lol'],
                assets: [
                    {
                        name: '333333333333',
                        mimeType: 'application/octet-stream',
                        sha256: '3'.repeat(64),
                        urls: ['https://blossom.primal.net/' + '3'.repeat(64)],
                        storedOnServers: ['https://blossom.primal.net'],
                    },
                ],
            },
            {
                id: 'pub-article-1',
                category: 'article',
                kind: 30023,
                title: 'Notes From The Chaos Lab',
                summary: '',
                content: 'Long form markdown body without summary or banner image.',
                dTag: 'chaos-lab',
                hashtags: [],
                tags: [
                    ['d', 'chaos-lab'],
                    ['title', 'Notes From The Chaos Lab'],
                ],
                createdAt: 1730002000,
                publishedRelays: ['wss://relay.damus.io'],
                assets: [],
            },
        ],
    });
    // Trapped music inside Kind 35128 music player must be caught, while game nsite "Example 2048" with SFX must NOT be flagged
    assert.equal(report.musicSpotlight.hasMusicSignals, true);
    assert.equal(report.musicSpotlight.trappedMusicCount, 1);
    assert.equal(report.musicSpotlight.trappedMusicSources[0].publicationId, 'pub-chaomusic');
    assert.equal(report.musicSpotlight.trappedMusicSources.some((s) => s.publicationId === 'pub-melody-2048'), false);
    // Native music track must be audited independently alongside trapped music player
    assert.equal(report.musicSpotlight.detectedTrackCount, 1);
    assert.equal(report.musicSpotlight.underFormattedCount, 1);
    assert.ok(report.musicSpotlight.catalogGaps.length > 0);
    assert.ok(report.recommendations.some((r) => r.id === 'rec-music-catalog-upgrade'));
    assert.ok(report.recommendations.some((r) => r.id === 'rec-music-trapped-pub-chaomusic'));
    assert.equal(report.musicSpotlight.prefillDraft?.category, 'music');
    assert.equal(report.musicSpotlight.prefillDraft?.musicKindPreference, 36787);
    assert.ok(report.musicSpotlight.recommendedRelays.includes('wss://relay.wavlake.com'));
    // Bare Kind 1 Blossom URL must generate a Kind 20 upgrade recommendation
    const bareRec = report.recommendations.find((r) => r.id === 'rec-bare-media-kind20');
    assert.ok(bareRec);
    assert.equal(bareRec.targetKind, 20);
    assert.equal(bareRec.prefillDraft?.category, 'photo');
    // Incomplete Kind 30023 article must flag missing summary, image, published_at, t
    const articleAudit = report.publicationAudits['pub-article-1'];
    assert.ok(articleAudit.missingTags.some((m) => m.includes('summary')));
    assert.ok(articleAudit.missingTags.some((m) => m.includes('image')));
    assert.ok(articleAudit.recommendedRelays.includes('wss://nostr-01.yakihonne.com'));
    // Outbox & Blossom hygiene must flag >5 write relays + degraded relay + >5 Blossom servers
    assert.equal(report.outboxDiagnosis.writeRelayCount, 7);
    assert.deepEqual(report.outboxDiagnosis.degradedWriteRelays, ['wss://relay.mostr.pub']);
    assert.ok(report.recommendations.some((r) => r.id === 'rec-outbox-hygiene'));
    assert.ok(report.recommendations.some((r) => r.id === 'rec-blossom-hygiene'));
    assert.ok(report.recommendations.some((r) => r.id === 'rec-profile-discovery'));
});
test('auditSinglePublication detects incomplete legacy Kind 31337 music event and prepares Kind 36787 upgrade', () => {
    const audit = auditSinglePublication({
        pub: {
            id: 'pub-track-legacy',
            category: 'music',
            kind: 31337,
            title: 'Midnight Sketch',
            summary: '',
            content: 'Demo track',
            dTag: 'midnight-sketch',
            hashtags: [],
            tags: [
                ['d', 'midnight-sketch'],
                ['title', 'Midnight Sketch'],
            ],
            createdAt: 1730000000,
            publishedRelays: ['wss://nos.lol'],
            assets: [],
        },
        profile: { display_name: 'Chaoticka' },
        healthyWriteRelays: ['wss://relay.damus.io', 'wss://nos.lol'],
    });
    assert.equal(audit.status, 'under-formatted');
    assert.ok(audit.missingTags.some((m) => m.includes('36787')));
    assert.ok(audit.missingTags.some((m) => m.includes('url')));
    assert.ok(audit.missingTags.some((m) => m.includes('image')));
    assert.equal(audit.prefillDraft?.musicKindPreference, 36787);
    assert.equal(audit.prefillDraft?.dTag, 'midnight-sketch');
});
test('relayIntelligence classifies bridges, chat relays, directory relays, and dead sockets instead of assuming user relays are right', async () => {
    const { classifyRelay, buildRelayOptimizationPlan } = await import('../src/intelligence/index.js');
    // Broken Fediverse bridge (HTTP 301 / wsReachable false)
    const mostr = classifyRelay({
        url: 'wss://relay.mostr.pub',
        read: true,
        write: true,
        status: 'unreachable',
        wsReachable: false,
        httpStatus: 301,
    });
    assert.equal(mostr.roleClass, 'dead-or-redirect');
    assert.equal(mostr.verdict, 'demote-or-remove');
    // Encrypted chat relay (WhiteNoise) must NOT be kept as a public outbox write relay
    const whitenoise = classifyRelay({
        url: 'wss://relay.us.whitenoise.chat',
        read: true,
        write: true,
        status: 'connected',
        wsReachable: true,
    });
    assert.equal(whitenoise.roleClass, 'dm-chat-only');
    assert.equal(whitenoise.verdict, 'demote-or-remove');
    // Ditto bridge must be flagged as fediverse-bridge
    const ditto = classifyRelay({
        url: 'wss://relay.ditto.pub',
        read: true,
        write: true,
        status: 'connected',
        wsReachable: true,
    });
    assert.equal(ditto.roleClass, 'fediverse-bridge');
    assert.equal(ditto.verdict, 'demote-or-remove');
    // Purple Pages is directory-index, not general content outbox
    const purple = classifyRelay({
        url: 'wss://purplepag.es',
        read: true,
        write: true,
        status: 'connected',
        wsReachable: true,
    });
    assert.equal(purple.roleClass, 'directory-index');
    assert.equal(purple.verdict, 'specialty-only');
    // Full plan on a messy real-world write set must exclude broken/bridge/chat relays and propose clean public outbox + 1 healthy community relay
    const plan = buildRelayOptimizationPlan({
        currentRelays: [
            { url: 'wss://relay.mostr.pub', read: true, write: true, status: 'unreachable', wsReachable: false, httpStatus: 301 },
            { url: 'wss://relay.ditto.pub', read: true, write: true, status: 'connected', wsReachable: true },
            { url: 'wss://relay.us.whitenoise.chat', read: true, write: true, status: 'connected', wsReachable: true },
            { url: 'wss://relay.btcforplebs.com', read: true, write: true, status: 'connected', wsReachable: true },
        ],
        followRelayCounts: {
            'wss://relay.damus.io': 34,
            'wss://nos.lol': 29,
            'wss://relay.primal.net': 26,
        },
        sampledFollowsCount: 40,
        hasMusic: true,
        hasArticles: true,
    });
    // MUST NEVER recommend mostr.pub, ditto.pub, or whitenoise.chat in public outbox or music relays
    assert.equal(plan.recommendedWriteRelays.includes('wss://relay.mostr.pub'), false);
    assert.equal(plan.recommendedWriteRelays.includes('wss://relay.ditto.pub'), false);
    assert.equal(plan.recommendedWriteRelays.includes('wss://relay.us.whitenoise.chat'), false);
    // MUST include top public discovery relays + preserve 1 healthy community relay
    assert.ok(plan.recommendedWriteRelays.includes('wss://relay.damus.io'));
    assert.ok(plan.recommendedWriteRelays.includes('wss://nos.lol'));
    assert.ok(plan.recommendedWriteRelays.includes('wss://relay.btcforplebs.com'));
    // Music broadcast must include Wavlake and ZERO broken/bridge/chat relays
    assert.ok(plan.recommendedMusicRelays.includes('wss://relay.wavlake.com'));
    assert.equal(plan.recommendedMusicRelays.includes('wss://relay.mostr.pub'), false);
    // Must explicitly list all 3 unsuitable write relays to drop
    assert.equal(plan.relaysToDropOrDemote.length, 3);
});
