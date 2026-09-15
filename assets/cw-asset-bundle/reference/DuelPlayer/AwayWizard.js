import React from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import css from './DuelPlayer.css';

function AwayWizard({ refs, states }) {
  const {
    EL_AWAY_IDLE,
    EL_AWAY_CHARGE,
    EL_AWAY_CHARGE_LOOP,
    EL_AWAY_ATTACK,
    EL_AWAY_RESET,
    EL_AWAY_HIT,
    EL_AWAY_WIN,
    EL_AWAY_LOSE,
    EL_AWAY_DRAW,
  } = refs;
  const {
    isIdlePlaying,
    isChargePlaying,
    isChargeLoopPlaying,
    isAttackPlaying,
    isAwayResetPlaying,
    isAwayHitPlaying,
    isDrawSpellPlaying,
    isAwayWinPlaying,
    isAwayLosePlaying,
    isDrawPlaying,
  } = states;

  return (
    <div className={cx(css.wizard, css.awayWizard)}>
      {/* IDLE */}
      <div
        className={cx({
          [css.hidden]: !isIdlePlaying,
        })}
        ref={EL_AWAY_IDLE}
      />
      {/* CHARGE */}
      <div
        className={cx(css.animation, {
          [css.visible]: isChargePlaying,
        })}
        ref={EL_AWAY_CHARGE}
      />
      {/* CHARGE LOOP */}
      <div
        className={cx(css.animation, {
          [css.visible]: isChargeLoopPlaying,
        })}
        ref={EL_AWAY_CHARGE_LOOP}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isAttackPlaying,
        })}
        ref={EL_AWAY_ATTACK}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isAwayResetPlaying,
        })}
        ref={EL_AWAY_RESET}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isAwayHitPlaying && !isDrawSpellPlaying,
        })}
        ref={EL_AWAY_HIT}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isAwayWinPlaying,
        })}
        ref={EL_AWAY_WIN}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isAwayLosePlaying,
        })}
        ref={EL_AWAY_LOSE}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isDrawPlaying,
        })}
        ref={EL_AWAY_DRAW}
      />
    </div>
  );
}

AwayWizard.propTypes = {
  refs: PropTypes.shape({
    EL_AWAY_IDLE: PropTypes.object,
    EL_AWAY_CHARGE: PropTypes.object,
    EL_AWAY_CHARGE_LOOP: PropTypes.object,
    EL_AWAY_ATTACK: PropTypes.object,
    EL_AWAY_RESET: PropTypes.object,
    EL_AWAY_HIT: PropTypes.object,
    EL_AWAY_WIN: PropTypes.object,
    EL_AWAY_LOSE: PropTypes.object,
  }).isRequired,
  states: PropTypes.shape({
    isIdlePlaying: PropTypes.bool,
    isChargePlaying: PropTypes.bool,
    isChargeLoopPlaying: PropTypes.bool,
    isAttackPlaying: PropTypes.bool,
    isAwayResetPlaying: PropTypes.bool,
    isAwayHitPlaying: PropTypes.bool,
    isDrawSpellPlaying: PropTypes.bool,
    isAwayWinPlaying: PropTypes.bool,
    isAwayLosePlaying: PropTypes.bool,
    isDrawPlaying: PropTypes.bool,
  }).isRequired,
};

export default AwayWizard;
