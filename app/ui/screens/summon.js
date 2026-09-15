// app/ui/screens/summon.js — R58/R59: summon $10 -> 100C; the name pool
// names the character (naming is the pool's job alone), the player only
// picks an element (the character's affinity). CB-BUILD-002/R59: the name
// is drawn server-side by Game#summonCharacter AT COMMIT (the Summon
// press) and first revealed on the result/character card afterward -- never
// previewed on this picker screen, and never before an element is chosen.
// CB-BUILD-012/R67: an insufficient-CASH funds wall opens Load Funds
// inline (never a dead-end toast) and retries the summon on deposit.
// CB-BUILD-013/§12/R83: every other failure is mapped to player-language
// copy -- e.message (a raw developer string) never reaches this screen.
import { mountScreen, el } from '../components/dom.js';
import { truthBadge, topBar } from '../components/chrome.js';
import { openLoadFundsSheet } from '../components/money-sheets.js';

/**
 * C15/R19: the summon button's copy must show the ACTIVE price door arm's
 * price (O2), not the incumbent's hand-authored "$10" hardcoded into
 * treatment.copy.summonButton -- the verb ("Summon"/"Build"/"Sign") is
 * still theme-bound copy; the price and stake-unit suffix are derived live
 * from tunables so a console O2 switch changes this button's text exactly
 * like it changes what `Game#summonCharacter` charges.
 */
export function summonButtonLabel(treatment, tunables) {
  const verb = (treatment.copy.summonButton || 'Summon').split('(')[0].trim();
  const priceUSD = tunables.priceDoorArms.displayedEntryPriceDefaultUSD;
  const stakeCheddar = tunables.economy.summonCheddar;
  const abbrev = treatment.nouns.stakeUnitAbbrev;
  return `${verb} ($${priceUSD} \u2014 ${stakeCheddar}${abbrev})`;
}

/**
 * CB-BUILD-013/§12/R83: maps a thrown developer-facing Error to
 * player-language copy. No raw or developer error text (e.message) ever
 * reaches a participant surface, whatever the failure -- the insufficient-
 * CASH case is handled entirely separately (CB-BUILD-012, no error text at
 * all), so this only ever runs for a genuinely unexpected failure.
 */
export function playerFacingSummonError(e) {
  if (e && e.name === 'KillSwitchFrozenError') {
    return 'This run is paused right now \u2014 please check back shortly.';
  }
  return 'That summon didn\u2019t go through \u2014 please try again.';
}

export function mountSummon(ctx) {
  const { treatment, tunables } = ctx;
  let element = null;

  function render() {
    mountScreen([
      topBar(ctx),
      el('h2', {}, treatment.copy.summonHeading),
      el('p', { class: 'cb-prose' }, treatment.copy.summonBody),
      truthBadge(ctx),
      el('div', { class: 'cb-card' }, [
        el('div', { class: 'cb-micro', style: 'margin-bottom:8px;' }, 'CHOOSE AN AFFINITY ELEMENT'),
        el('div', { class: 'cb-element-row' }, ['fire', 'water', 'air'].map((elName) =>
          el('button', {
            class: `cb-element-btn${element === elName ? ' selected' : ''}`,
            'data-el': elName,
            onClick: () => { element = elName; render(); },
          }, treatment.elements[elName].label)
        )),
      ]),
      el('button', {
        class: 'cb-btn block',
        'aria-disabled': !element,
        onClick: () => {
          if (!element) return;
          attemptSummon();
        },
      }, summonButtonLabel(treatment, tunables)),
      el('p', { class: 'cb-prose' }, treatment.copy.signupGrantNotice),
    ]);
  }

  /**
   * CB-BUILD-012/R67: the summon attempt, extracted so a funds-wall retry
   * (after a Load Funds deposit) can call the exact same path the Summon
   * button does, with the SAME chosen element -- `retrySummon` below is
   * literally this function, passed as `onDeposited`.
   */
  function attemptSummon() {
    try {
      // CB-BUILD-002/R59: no `name` is passed here -- summonCharacter
      // draws it server-side (pickUnusedName, at commit) exactly like
      // the master rule requires: assigned and first revealed by the
      // act of summoning, never previewed before the element pick.
      const summoned = ctx.game.summonCharacter({ element });
      ctx.patchSession({ activeCharacterId: summoned.characterId });
      renderReveal(summoned);
    } catch (e) {
      if (/insufficient CASH/.test(e.message)) {
        // CB-BUILD-012/R67: a funds wall is never a dead end -- open Load
        // Funds inline and return to this exact blocked action (retry the
        // summon with the same chosen element) once the deposit lands.
        openLoadFundsSheet(ctx, { onDeposited: retrySummon });
        return;
      }
      // CB-BUILD-013/§12/R83: never surface a raw/developer error string
      // (e.message) to a participant surface -- map every other failure to
      // player-language copy instead.
      ctx.toast(playerFacingSummonError(e));
    }
  }

  function retrySummon() {
    attemptSummon();
  }

  /**
   * CB-BUILD-002/R59: the small reveal moment -- the summoned character's
   * name (assigned server-side, this instant) is shown here for the FIRST
   * time, on the result/character card, after the Summon press. There is
   * no route to this screen except through a completed summon.
   */
  function renderReveal(summoned) {
    mountScreen([
      topBar(ctx),
      el('div', { class: 'cb-card', style: 'text-align:center;' }, [
        el('div', { class: 'cb-micro' }, `YOUR ${treatment.nouns.character.toUpperCase()}`),
        el('div', { class: 'cb-display', style: 'font-size:28px;color:var(--cb-yellow);' }, summoned.name),
        el('div', { class: 'cb-micro', style: 'margin-top:6px;' }, treatment.elements[summoned.element].label.toUpperCase()),
      ]),
      el('button', {
        class: 'cb-btn block',
        onClick: () => ctx.router.navigate('lobby-entry'),
      }, 'Continue'),
    ]);
  }

  render();
}
