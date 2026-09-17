// app/engine/projection.js
// Replays the append-only ledger into a current-state snapshot. This is the
// ONLY way state is derived for display or for gated metrics (invariant
// #10: every gated metric recomputes to the same value from the delivered
// raw events) — nothing is tracked "out of band" from the ledger.
//
// Ledger-conservation accounting (invariant #2), in Cheddar:
//   currentStakeTotal + rakeTakenTotal + cashedOutTotal + pveOutflowTotal
//     == summonedTotal + reentryBonusTotal + prizesPaidTotal + pveInflowTotal
// (Sources of new Cheddar: summon, re-entry bonuses, bracket-win prizes from
// the external pool, and gross PvE winnings paid by the house. Sinks: PvE
// rake, cash-out — which converts stake out of the Cheddar economy into
// CASH — and gross PvE losses paid to the house.) PvE house opponents are
// not ledger-tracked characters (R57: "a zeroed opponent is replaced"), so
// their side of a PvE duel is accounted as an explicit inflow/outflow against
// an implicit, unbounded house account rather than as a tracked character.

import { EVENT_TYPES } from './ledger.js';

export function project(events) {
  const account = {
    cashUSD: 0,
    signupGrantApplied: false,
    screener: null,
    reservation: null,
  };
  const characters = {};
  const brackets = {};

  const totals = {
    summonedCheddar: 0,
    reentryBonusCheddar: 0,
    prizesPaidCheddar: 0,
    rakeTakenCheddar: 0,
    cashedOutCheddar: 0,
    pveInflowCheddar: 0, // gross house->player payouts on PvE wins (before rake)
    pveOutflowCheddar: 0, // player->house losses on PvE
  };

  // Replay in the ledger's natural append order — the true causal order for
  // a single-writer local ledger. (Timestamps are for elapsed-time math in
  // retention.js, not for ordering the replay: a caller that mixes real and
  // synthetic clocks across actions could otherwise reorder cause and
  // effect if this replayed by ts instead.)
  const sorted = events;

  for (const e of sorted) {
    switch (e.type) {
      case EVENT_TYPES.SIGNUP_GRANT:
        account.cashUSD += e.payload.amountUSD;
        account.signupGrantApplied = true;
        break;
      case EVENT_TYPES.SCREENER_RESULT:
        account.screener = { passed: e.payload.passed, ts: e.ts, reasons: e.payload.reasons || [] };
        break;
      case EVENT_TYPES.CHARACTER_SUMMONED:
        characters[e.payload.characterId] = {
          id: e.payload.characterId,
          name: e.payload.name,
          element: e.payload.element,
          tier: 0,
          state: 'ACTIVE',
          stakeCheddar: e.payload.stakeCheddar,
          records: {},
          createdAt: e.ts,
          retired: false,
          kind: 'human',
          // CB-BUILD-006 (additive): the rig identity recorded at summon.
          // CB-BUILD-022/R74/§18: audit record ONLY — carried on the
          // snapshot for history/inspection, but read by nothing. Every
          // render path derives traits/palette afresh from characterId via
          // wizardRig.wizardIdentity()/deriveIdentity(), unconditionally
          // (present, absent, or stale/wrong here, it makes no difference).
          traits: e.payload.traits || null,
          palette: e.payload.palette || null,
        };
        account.cashUSD -= e.payload.costUSD;
        totals.summonedCheddar += e.payload.stakeCheddar;
        break;
      case EVENT_TYPES.NPC_SEATED:
        if (!characters[e.payload.characterId]) {
          characters[e.payload.characterId] = {
            id: e.payload.characterId,
            name: e.payload.name,
            element: e.payload.element,
            tier: e.payload.tier || 0,
            state: 'ACTIVE',
            stakeCheddar: e.payload.stakeCheddar,
            records: {},
            createdAt: e.ts,
            retired: false,
            kind: 'npc',
            // CB-BUILD-006 (additive): same rig-identity carriage as human
            // summons. CB-BUILD-022/R74/§18: audit record only, as above.
            traits: e.payload.traits || null,
            palette: e.payload.palette || null,
          };
          totals.summonedCheddar += e.payload.stakeCheddar;
        }
        break;
      case EVENT_TYPES.BRACKET_CREATED:
        brackets[e.payload.bracketId] = { id: e.payload.bracketId, tier: e.payload.tier, seats: e.payload.seats, createdAt: e.ts, complete: false };
        break;
      case EVENT_TYPES.DUEL_RESOLVED: {
        const combatants = e.payload.combatants || [];
        for (const combatant of combatants) {
          const c = characters[combatant.characterId];
          if (!c) continue;
          c.stakeCheddar = combatant.stakeAfter;
          const rec = c.records[combatant.tier] || (c.records[combatant.tier] = { w: 0, l: 0 });
          if (combatant.won) rec.w += 1; else rec.l += 1;
        }
        break;
      }
      case EVENT_TYPES.CHARACTER_ADVANCED: {
        const c = characters[e.payload.characterId];
        if (e.payload.toppedOut) {
          // C2/R62: the T6 (top-tier) payout -- $999,999.92 CASH plus the
          // champion's battle stake at 20:1, NOT 20,000,000 Cheddar minted
          // onto the stake. The character's tier is unchanged (clamped);
          // its stake is paid out (cashed) exactly like a cash-out.
          //
          // f4/N2 fix: the champion lands SITTING, not ACTIVE. Its stake
          // was JUST cashed out by this same payout -- leaving it ACTIVE
          // at 0C stranded the character with no legal action anywhere
          // (can't enter a bracket at floor > 0, can't PvE-build, can't
          // cash out again, and never reached R61's emptied-character
          // "RETIRE TO THE LEDGER" card, since every ACTIVE-routing screen
          // assumes an ACTIVE character can still act). An emptied,
          // stake-cashed character is exactly the SITTING/emptied shape
          // R61 already handles (isEmptied() reads stakeCheddar <= 0
          // regardless of state, but the ROUTING from bracket-board.js/
          // duel.js/wallet.js branches on state === 'SITTING' to reach the
          // sitting screen at all) -- so SITTING is the correct state,
          // and sitting.js's emptied-character branch is where a topped-
          // out champion now lands, reachable via RETIRE TO THE LEDGER.
          if (c) {
            totals.cashedOutCheddar += e.payload.stakeCashedOutCheddar || 0;
            c.stakeCheddar = 0;
            c.tier = e.payload.newTier;
            c.state = 'SITTING';
            c.toppedOutChampion = true; // sitting.js: a champion-specific emptied-card line
          }
          account.cashUSD += (e.payload.payoutCashUSD || 0) + (e.payload.stakeCashUSD || 0);
        } else {
          if (c) {
            c.tier = e.payload.newTier;
            c.state = 'ACTIVE';
            if (e.payload.wonBracket && e.payload.prizeCheddar) {
              c.stakeCheddar += e.payload.prizeCheddar;
            }

          }
          if (e.payload.wonBracket && e.payload.prizeCheddar) {
            totals.prizesPaidCheddar += e.payload.prizeCheddar;
          }
        }
        break;
      }
      case EVENT_TYPES.CHARACTER_ELIMINATED: {
        const c = characters[e.payload.characterId];
        if (c) c.state = 'SITTING';
        break;
      }
      case EVENT_TYPES.CHARACTER_REENTERED: {
        const c = characters[e.payload.characterId];
        if (c) {
          c.stakeCheddar += e.payload.bonusCheddar;
          c.state = 'ACTIVE';
          // A2: this does NOT clear `toppedOutChampion` (set above, on a
          // toppedOut CHARACTER_ADVANCED). That's fine, not a bug: a
          // CHARACTER_REENTERED event can only legally exist for a
          // character that was NOT emptied at the time of re-entry --
          // Game#reenterCharacter (A2 fix) now THROWS for an emptied
          // character (economy.isEmptied) instead of letting it re-enter,
          // since R61's only action for an emptied character is RETIRE.
          // A toppedOut champion IS emptied (its stake was cashed out by
          // the R62 payout) by construction, so it can never reach a real
          // CHARACTER_REENTERED event in the first place -- the stale-flag
          // case (a re-entered former champion still carrying
          // `toppedOutChampion: true` into a later, ordinary SITTING) is
          // unreachable under this ledger's own append rules, not merely
          // unhandled. (sitting.js's champion-line condition also checks
          // `stakeCheddar === 0` directly, belt-and-braces, in case some
          // future change ever makes this event reachable for such a
          // character.)
        }
        account.cashUSD -= e.payload.feeUSD;
        totals.reentryBonusCheddar += e.payload.bonusCheddar;
        break;
      }
      case EVENT_TYPES.CHARACTER_CASHED_OUT: {
        const c = characters[e.payload.characterId];
        if (c) {
          totals.cashedOutCheddar += c.stakeCheddar;
          c.stakeCheddar = 0;
          c.state = 'RETIRED';
          c.retired = true;
        }
        account.cashUSD += e.payload.cashUSD;
        break;
      }
      case EVENT_TYPES.CHARACTER_RETIRED_EMPTY: {
        const c = characters[e.payload.characterId];
        if (c) { c.state = 'RETIRED'; c.retired = true; }
        break;
      }
      case EVENT_TYPES.LOAD_FUNDS_DEPOSIT:
        account.cashUSD += e.payload.amountUSD;
        break;
      case EVENT_TYPES.RESERVATION_PRESSED:
        account.reservation = { ts: e.ts, tier: e.payload.tier, characterState: e.payload.characterState };
        break;
      case EVENT_TYPES.PVE_DUEL_RESOLVED: {
        const c = characters[e.payload.characterId];
        const delta = e.payload.stakeAfter - e.payload.stakeBefore;
        if (c) c.stakeCheddar = e.payload.stakeAfter;
        totals.rakeTakenCheddar += e.payload.rakeTaken || 0;
        if (delta > 0) totals.pveInflowCheddar += delta + (e.payload.rakeTaken || 0);
        else if (delta < 0) totals.pveOutflowCheddar += -delta;
        break;
      }
      case EVENT_TYPES.BRACKET_COMPLETED: {
        const b = brackets[e.payload.bracketId];
        if (b) b.complete = true;
        break;
      }
      case EVENT_TYPES.BRACKET_VOIDED: {
        // C16/AC0: no stake/account effect at all -- every character keeps
        // exactly the stake it held at the instant of the kill. Only marks
        // the bracket record itself, for display.
        const b = brackets[e.payload.bracketId];
        if (b) b.voided = true;
        break;
      }
      case EVENT_TYPES.OPEN_RESPONSE:
        account.openResponse = { text: e.payload.text, ts: e.ts };
        break;
      default:
        break;
    }
  }

  return { account, characters, brackets, totals };
}

/** Invariant #2: ledger conservation, computed straight from the projection totals. */
export function checkConservation(snapshot) {
  const currentStakeTotal = Object.values(snapshot.characters).reduce((sum, c) => sum + c.stakeCheddar, 0);
  const lhs = currentStakeTotal + snapshot.totals.rakeTakenCheddar + snapshot.totals.cashedOutCheddar + snapshot.totals.pveOutflowCheddar;
  const rhs = snapshot.totals.summonedCheddar + snapshot.totals.reentryBonusCheddar + snapshot.totals.prizesPaidCheddar + snapshot.totals.pveInflowCheddar;
  return { lhs, rhs, balanced: lhs === rhs, currentStakeTotal };
}
