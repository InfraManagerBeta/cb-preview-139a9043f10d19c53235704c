// app/engine/economy.js
// Accounts, character state machine, tiers, re-entry, cashout — R58–R63.
// Pure functions operating on plain-object character/account records so the
// ledger (append-only) stays the single source of truth for anything shown.

export const CHARACTER_STATE = Object.freeze({
  ACTIVE: 'ACTIVE',
  SITTING: 'SITTING',
  RETIRED: 'RETIRED',
});

export function floorForTier(tunables, tier) {
  const f = tunables.floors.byTier[String(tier)];
  if (f === undefined) throw new Error(`no floor defined for tier ${tier}`);
  return f;
}

export function reentryForTier(tunables, tier) {
  const r = tunables.reentry.byTier[String(tier)];
  if (!r) throw new Error(`no re-entry data for tier ${tier}`);
  return r;
}

export function tierLadderEntry(tunables, tier) {
  const t = tunables.tierLadder.tiers.find((t) => t.tier === tier);
  if (!t) throw new Error(`no tier ladder entry for tier ${tier}`);
  return t;
}

export function cheddarToUsd(tunables, cheddar) {
  return cheddar / tunables.economy.cheddarPerDollar;
}
export function usdToCheddar(tunables, usd) {
  return usd * tunables.economy.cheddarPerDollar;
}

/** R58: summon a fresh character. $10 -> 100C stake, minted at tier 0, ACTIVE. */
export function summonCharacter(tunables, { id, name, element, createdAt }) {
  return {
    id,
    name, // drawn from the treatment's name pool by the caller — R59
    element, // the character's own affinity element
    tier: 0,
    state: CHARACTER_STATE.ACTIVE,
    stakeCheddar: tunables.economy.summonCheddar,
    createdAt,
    records: {}, // { [tier]: { w, l } }
    everAdvancedFreeAtTier: {}, // { [tier]: true } once the free first-time advance has been used
    winsToTop: computeWinsToTop(tunables, 0),
    retired: false,
  };
}

/** Wins-to-the-top countdown (R56): 3 wins/bracket x 7 tiers = 21 from a fresh T0 character. */
export function computeWinsToTop(tunables, tier) {
  const winsPerBracket = tunables.bracket.winsPerBracket;
  const tiersFromFreshT0 = tunables.bracket.tiersFromFreshT0;
  const remainingTiers = tiersFromFreshT0 - tier;
  return Math.max(0, remainingTiers * winsPerBracket);
}

/** R60: can this character enter (or advance into) `tier`? */
export function canEnterTier(character, tier) {
  if (tier === 0) return true; // tier 0 ungated
  const prior = character.records[tier - 1];
  return !!prior && prior.w > prior.l;
}

/**
 * R60/R56/R62/C2: what happens when a character wins its entire bracket at
 * `championTier`. Pure/no side effects -- the caller (Game#resolveMatch)
 * turns this into the actual ledger event(s); this is the SINGLE place that
 * decides the shape of a bracket-win payout, so economy.test.js and the live
 * Game facade both exercise the same fixed logic (C2 happened precisely
 * because the live path re-implemented this inline, uncapped, while a dead
 * parallel copy over here had the clamp -- see app/README.md/A8).
 *
 * Fixes C2 two ways:
 *   - clamps at the top tier: a T6 (max tier) win can never write tier 7
 *     (which would then throw in floorForTier/reentryForTier/tierLadderEntry
 *     and brick the character in the append-only ledger).
 *   - implements R62's T6 payout AS WRITTEN: $999,999.92 CASH plus the
 *     champion's battle stake at 20:1 -- not 20,000,000 Cheddar minted onto
 *     the character's stake (tunables.json's `tierLadder.tiers[6].payout`).
 */
export function bracketWinOutcome(tunables, { championTier, canAdvance, stakeCheddarAtWin }) {
  const maxTier = tunables.tierLadder.tiers.length - 1;
  const tierData = tierLadderEntry(tunables, championTier);
  const toppedOut = championTier >= maxTier;
  if (toppedOut) {
    const payout = tierData.payout;
    if (!payout) throw new Error(`bracketWinOutcome: tier ${championTier} is the top tier but carries no 'payout' data (R62)`);
    return {
      toppedOut: true,
      newTier: championTier, // clamped -- never championTier + 1 beyond the ladder's top
      prizeCheddar: 0, // R62: paid as cash below, not minted Cheddar
      prizeUSD: tierData.prizeUSD,
      payoutCashUSD: payout.cashUSD,
      stakeCashedOutCheddar: stakeCheddarAtWin,
      stakeCashUSD: stakeCheddarAtWin / payout.remainderAtCheddarPerDollar,
    };
  }
  const nextTier = championTier + 1;
  return {
    toppedOut: false,
    newTier: canAdvance ? nextTier : championTier,
    prizeCheddar: tierData.prizeCheddar,
    prizeUSD: tierData.prizeUSD,
  };
}

/** R60: lose a duel while ACTIVE IN BRACKET -> SITTING. */
export function eliminate(character) {
  character.state = CHARACTER_STATE.SITTING;
  return character;
}

/**
 * R60/R63: SITTING -> re-enter the same tier. Pays the tier's re-entry fee
 * (USD, tracked on the account/CASH side by the caller) and receives the
 * Cheddar bonus onto the character's stake.
 */
export function reenter(tunables, character) {
  if (character.state !== CHARACTER_STATE.SITTING) throw new Error('reenter: character is not SITTING');
  const fee = reentryForTier(tunables, character.tier);
  character.stakeCheddar += fee.bonusCheddar;
  character.state = CHARACTER_STATE.ACTIVE;
  return { character, feeUSD: fee.usd, bonusCheddar: fee.bonusCheddar };
}

/**
 * R60/R68: SITTING -> cash out. Stake -> CASH at 20:1. Character retires.
 * The sole path to retirement.
 */
export function cashOut(tunables, character) {
  if (character.state !== CHARACTER_STATE.SITTING) throw new Error('cashOut: character must be SITTING');
  const cashUSD = cheddarToUsd(tunables, character.stakeCheddar);
  character.state = CHARACTER_STATE.RETIRED;
  character.retired = true;
  const paidOutCheddar = character.stakeCheddar;
  character.stakeCheddar = 0;
  return { character, cashUSD, paidOutCheddar };
}

/** R55: minimum stake to enter a bracket at `tier` equals its floor. */
export function meetsMinimumStake(tunables, character, tier) {
  return character.stakeCheddar >= floorForTier(tunables, tier);
}

/** R61: the emptied character (0C) — dollar copy only applies when stake > 0. */
export function isEmptied(character) {
  return character.stakeCheddar <= 0;
}
