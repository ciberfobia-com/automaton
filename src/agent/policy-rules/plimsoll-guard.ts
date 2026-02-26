/**
 * Plimsoll Transaction Guard — Anti-Drain Defense Engines
 *
 * Three zero-dependency defense engines that protect the automaton's wallet
 * from prompt-injection-driven drain attacks that bypass per-tx limits.
 *
 * Priority 450 — runs after path-protection (200) but before financial (500).
 * Fail-open: all engines return null on internal errors.
 *
 * Based on PR #234 (Plimsoll Protocol).
 */

import type {
    PolicyRule,
    PolicyRequest,
    PolicyRuleResult,
} from "../../types.js";

// ── Helpers ──

function deny(
    rule: string,
    reasonCode: string,
    humanMessage: string,
): PolicyRuleResult {
    return { rule, action: "deny", reasonCode, humanMessage };
}

function quarantine(
    rule: string,
    reasonCode: string,
    humanMessage: string,
): PolicyRuleResult {
    return { rule, action: "quarantine" as any, reasonCode, humanMessage };
}

// ── Financial tool names ──
const FINANCIAL_TOOLS = [
    "transfer_credits",
    "fund_child",
    "x402_fetch",
    "topup_credits",
];

// ═══════════════════════════════════════════════════════════════════
// Engine 1: Trajectory Hash — Detect hallucination retry loops
// ═══════════════════════════════════════════════════════════════════

interface TrajectoryEntry {
    hash: string;
    ts: number;
}

const trajectoryWindow: TrajectoryEntry[] = [];
const TRAJECTORY_WINDOW_MS = 60_000; // 60 seconds
const TRAJECTORY_HARD_BLOCK = 3;     // 3+ identical = deny
const TRAJECTORY_WARN = 2;           // 2 identical = quarantine

function simpleHash(input: string): string {
    // Simple non-crypto hash (FNV-1a 32-bit) — fast, deterministic, zero-deps
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

function pruneWindow<T extends { ts: number }>(window: T[], maxAge: number): void {
    const cutoff = Date.now() - maxAge;
    while (window.length > 0 && window[0].ts < cutoff) {
        window.shift();
    }
}

function createTrajectoryHashRule(): PolicyRule {
    return {
        id: "plimsoll.trajectory_hash",
        description: "Block hallucination retry loops (3+ identical financial calls in 60s)",
        priority: 450,
        appliesTo: { by: "name", names: FINANCIAL_TOOLS },
        evaluate(request: PolicyRequest): PolicyRuleResult | null {
            try {
                const fingerprint = [
                    request.tool.name,
                    String(request.args.to_address ?? request.args.url ?? ""),
                    String(request.args.amount_cents ?? request.args.amount ?? ""),
                ].join("|");

                const hash = simpleHash(fingerprint);
                const now = Date.now();

                pruneWindow(trajectoryWindow, TRAJECTORY_WINDOW_MS);
                trajectoryWindow.push({ hash, ts: now });

                const matchCount = trajectoryWindow.filter((e) => e.hash === hash).length;

                if (matchCount >= TRAJECTORY_HARD_BLOCK) {
                    return deny(
                        "plimsoll.trajectory_hash",
                        "TRAJECTORY_LOOP",
                        `BLOCKED: Identical financial call repeated ${matchCount} times in 60s. ` +
                        `This looks like a hallucination retry loop. Stop and try a different approach.`,
                    );
                }

                if (matchCount >= TRAJECTORY_WARN) {
                    return quarantine(
                        "plimsoll.trajectory_hash",
                        "TRAJECTORY_WARN",
                        `WARNING: Same financial call repeated ${matchCount} times in 60s. ` +
                        `One more identical call will be blocked.`,
                    );
                }

                return null;
            } catch {
                return null; // fail-open
            }
        },
    };
}

// ═══════════════════════════════════════════════════════════════════
// Engine 2: Capital Velocity — Detect slow-bleed drain attacks
// ═══════════════════════════════════════════════════════════════════

interface VelocityEntry {
    amountCents: number;
    ts: number;
}

const velocityWindow: VelocityEntry[] = [];
const VELOCITY_WINDOW_MS = 5 * 60_000; // 5 minutes
const VELOCITY_HARD_LIMIT_CENTS = 50_000; // $500
const VELOCITY_WARN_RATIO = 0.8; // 80% = quarantine

function createCapitalVelocityRule(): PolicyRule {
    return {
        id: "plimsoll.capital_velocity",
        description: "Block if cumulative spend exceeds $500 in 5 minutes",
        priority: 450,
        appliesTo: { by: "name", names: FINANCIAL_TOOLS },
        evaluate(request: PolicyRequest): PolicyRuleResult | null {
            try {
                const amount = Number(request.args.amount_cents ?? request.args.amount ?? 0);
                if (!Number.isFinite(amount) || amount <= 0) return null;

                pruneWindow(velocityWindow, VELOCITY_WINDOW_MS);

                const currentTotal = velocityWindow.reduce((sum, e) => sum + e.amountCents, 0);
                const projectedTotal = currentTotal + amount;

                if (projectedTotal > VELOCITY_HARD_LIMIT_CENTS) {
                    return deny(
                        "plimsoll.capital_velocity",
                        "VELOCITY_BREACH",
                        `BLOCKED: Cumulative spend in last 5 minutes: $${(currentTotal / 100).toFixed(2)} + ` +
                        `$${(amount / 100).toFixed(2)} = $${(projectedTotal / 100).toFixed(2)}. ` +
                        `Exceeds velocity limit of $${(VELOCITY_HARD_LIMIT_CENTS / 100).toFixed(2)}/5min. ` +
                        `Wait for the window to clear.`,
                    );
                }

                if (projectedTotal > VELOCITY_HARD_LIMIT_CENTS * VELOCITY_WARN_RATIO) {
                    // Record the spend (will count toward future checks)
                    velocityWindow.push({ amountCents: amount, ts: Date.now() });
                    return quarantine(
                        "plimsoll.capital_velocity",
                        "VELOCITY_WARN",
                        `WARNING: Spending velocity at ${Math.round((projectedTotal / VELOCITY_HARD_LIMIT_CENTS) * 100)}% ` +
                        `of 5-minute limit ($${(projectedTotal / 100).toFixed(2)}/$${(VELOCITY_HARD_LIMIT_CENTS / 100).toFixed(2)}).`,
                    );
                }

                // Record spend
                velocityWindow.push({ amountCents: amount, ts: Date.now() });
                return null;
            } catch {
                return null; // fail-open
            }
        },
    };
}

// ═══════════════════════════════════════════════════════════════════
// Engine 3: Entropy Guard — Detect key exfiltration in tool args
// ═══════════════════════════════════════════════════════════════════

// Ethereum private key pattern: 0x followed by 64 hex chars
const PRIVATE_KEY_PATTERN = /0x[a-fA-F0-9]{64}/;

// BIP-39 mnemonic: 12+ words from common wordlist seed phrases
const MNEMONIC_WORDS = new Set([
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
    "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
    "acoustic", "acquire", "across", "action", "actual", "adapt", "add", "addict",
    "address", "adjust", "admit", "adult", "advance", "advice", "aerobic", "affair",
    "afford", "afraid", "again", "age", "agent", "agree", "ahead", "aim", "air",
    "airport", "aisle", "alarm", "album", "alcohol", "alert", "alien", "all",
    "alley", "allow", "almost", "alone", "alpha", "already", "also", "alter",
    "always", "amateur", "amazing", "among", "amount", "amused", "analyst", "anchor",
    "ancient", "anger", "angle", "angry", "animal", "ankle", "announce", "annual",
    "another", "answer", "antenna", "antique", "anxiety", "any", "apart", "apology",
    "appear", "apple", "approve", "april", "arch", "arctic", "area", "arena",
    "argue", "arm", "armed", "armor", "army", "arrange", "arrest", "arrive",
    "arrow", "art", "artefact", "artist", "artwork", "asset", "assist", "assume",
    "asthma", "athlete", "atom", "attack", "attend", "attitude", "attract",
    "auction", "audit", "august", "aunt", "author", "auto", "avocado", "average",
    "avoid", "awake", "aware", "awesome", "awful", "awkward", "axis",
    // First ~120 BIP-39 words. Enough for heuristic detection.
]);

/**
 * Calculate Shannon entropy of a string (bits per character).
 * High-entropy strings (>5.0) are suspicious — likely encoded secrets.
 */
function shannonEntropy(s: string): number {
    if (s.length === 0) return 0;
    const freq = new Map<string, number>();
    for (const c of s) {
        freq.set(c, (freq.get(c) || 0) + 1);
    }
    let entropy = 0;
    for (const count of freq.values()) {
        const p = count / s.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

/**
 * Check if a string looks like a BIP-39 mnemonic phrase.
 */
function looksLikeMnemonic(s: string): boolean {
    const words = s.toLowerCase().trim().split(/\s+/);
    if (words.length < 12) return false;
    const mnemonicCount = words.filter((w) => MNEMONIC_WORDS.has(w)).length;
    return mnemonicCount >= 10; // 10+ out of 12+ words match
}

/**
 * Recursively extract all string values from an object.
 */
function extractStrings(obj: unknown, depth = 0): string[] {
    if (depth > 5) return []; // prevent infinite recursion
    if (typeof obj === "string") return [obj];
    if (Array.isArray(obj)) return obj.flatMap((v) => extractStrings(v, depth + 1));
    if (obj && typeof obj === "object") {
        return Object.values(obj).flatMap((v) => extractStrings(v, depth + 1));
    }
    return [];
}

function createEntropyGuardRule(): PolicyRule {
    return {
        id: "plimsoll.entropy_guard",
        description: "Block tool calls containing private keys, mnemonics, or high-entropy secrets",
        priority: 450,
        // Apply to ALL tools — exfiltration can happen via exec, write_file, etc.
        appliesTo: { by: "category", categories: ["conway", "vm", "financial", "skills", "self_mod", "survival"] },
        evaluate(request: PolicyRequest): PolicyRuleResult | null {
            try {
                const strings = extractStrings(request.args);

                for (const s of strings) {
                    // Check for Ethereum private keys
                    if (PRIVATE_KEY_PATTERN.test(s)) {
                        return deny(
                            "plimsoll.entropy_guard",
                            "KEY_EXFILTRATION",
                            `BLOCKED: Tool argument contains what looks like an Ethereum private key (0x...[64 hex]). ` +
                            `This could be a key exfiltration attempt. Never include private keys in tool arguments.`,
                        );
                    }

                    // Check for BIP-39 mnemonic phrases
                    if (looksLikeMnemonic(s)) {
                        return deny(
                            "plimsoll.entropy_guard",
                            "MNEMONIC_EXFILTRATION",
                            `BLOCKED: Tool argument contains what looks like a BIP-39 mnemonic seed phrase. ` +
                            `Never include seed phrases in tool arguments.`,
                        );
                    }

                    // Check for high-entropy blobs (likely base64-encoded secrets)
                    // Only check strings longer than 32 chars to avoid false positives
                    if (s.length > 32) {
                        const entropy = shannonEntropy(s);
                        if (entropy > 5.0 && /^[A-Za-z0-9+/=]{32,}$/.test(s)) {
                            return quarantine(
                                "plimsoll.entropy_guard",
                                "HIGH_ENTROPY_BLOB",
                                `WARNING: Tool argument contains a high-entropy blob (${entropy.toFixed(1)} bits/char, ` +
                                `${s.length} chars). This could be an encoded secret. Proceed with caution.`,
                            );
                        }
                    }
                }

                return null;
            } catch {
                return null; // fail-open
            }
        },
    };
}

// ═══════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════

/**
 * Create all Plimsoll transaction guard rules.
 * Three engines: trajectory hash, capital velocity, entropy guard.
 */
export function createPlimsollGuardRules(): PolicyRule[] {
    return [
        createTrajectoryHashRule(),
        createCapitalVelocityRule(),
        createEntropyGuardRule(),
    ];
}
