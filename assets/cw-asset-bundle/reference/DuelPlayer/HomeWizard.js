import React from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import css from './DuelPlayer.css';

function HomeWizard({ refs, states }) {
  const {
    EL_HOME_IDLE,
    EL_HOME_CHARGE,
    EL_HOME_CHARGE_LOOP,
    EL_HOME_ATTACK,
    EL_HOME_RESET,
    EL_HOME_HIT,
    EL_HOME_WIN,
    EL_HOME_LOSE,
    EL_HOME_DRAW,
  } = refs;

  const {
    isIdlePlaying,
    isChargePlaying,
    isChargeLoopPlaying,
    isAttackPlaying,
    isHomeResetPlaying,
    isHomeHitPlaying,
    isDrawSpellPlaying,
    isHomeWinPlaying,
    isHomeLosePlaying,
    isDrawPlaying,
  } = states;

  return (
    <div className={cx(css.wizard, css.homeWizard)}>
      {/* IDLE */}
      <div
        className={cx({
          [css.hidden]: !isIdlePlaying,
        })}
        ref={EL_HOME_IDLE}
      />
      {/* CHARGE */}
      <div
        className={cx(css.animation, {
          [css.visible]: isChargePlaying,
        })}
        ref={EL_HOME_CHARGE}
      />
      {/* CHARGE LOOP */}
      <div
        className={cx(css.animation, {
          [css.visible]: isChargeLoopPlaying,
        })}
        ref={EL_HOME_CHARGE_LOOP}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isAttackPlaying,
        })}
        ref={EL_HOME_ATTACK}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isHomeResetPlaying,
        })}
        ref={EL_HOME_RESET}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isHomeHitPlaying && !isDrawSpellPlaying,
        })}
        ref={EL_HOME_HIT}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isHomeWinPlaying,
        })}
        ref={EL_HOME_WIN}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isHomeLosePlaying,
        })}
        ref={EL_HOME_LOSE}
      />

      <div
        className={cx(css.animation, {
          [css.visible]: isDrawPlaying,
        })}
        ref={EL_HOME_DRAW}
      />
    </div>
  );
}

HomeWizard.propTypes = {
  refs: PropTypes.shape({
    EL_HOME_IDLE: PropTypes.object,
    EL_HOME_CHARGE: PropTypes.object,
    EL_HOME_CHARGE_LOOP: PropTypes.object,
    EL_HOME_ATTACK: PropTypes.object,
    EL_HOME_RESET: PropTypes.object,
    EL_HOME_HIT: PropTypes.object,
    EL_HOME_WIN: PropTypes.object,
    EL_HOME_LOSE: PropTypes.object,
    EL_HOME_DRAW: PropTypes.object,
  }).isRequired,
  states: PropTypes.shape({
    isIdlePlaying: PropTypes.bool,
    isChargePlaying: PropTypes.bool,
    isChargeLoopPlaying: PropTypes.bool,
    isAttackPlaying: PropTypes.bool,
    isHomeResetPlaying: PropTypes.bool,
    isHomeHitPlaying: PropTypes.bool,
    isDrawSpellPlaying: PropTypes.bool,
    isHomeWinPlaying: PropTypes.bool,
    isHomeLosePlaying: PropTypes.bool,
    isDrawPlaying: PropTypes.bool,
  }).isRequired,
};

export default HomeWizard;
