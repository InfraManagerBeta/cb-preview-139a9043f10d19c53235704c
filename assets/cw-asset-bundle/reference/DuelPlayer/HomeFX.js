import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import css from './DuelPlayer.css';

function HomeFX({ refs, states }) {
  const {
    EL_HOME_FX_CHARGE_START,
    EL_HOME_FX_CHARGE_LOOP,
    EL_HOME_FX_CHARGE_END,
    EL_HOME_FX_HIT,
    EL_HOME_FX_WIN,
  } = refs;
  const {
    isChargePlaying,
    isChargeLoopPlaying,
    isAttackPlaying,
    isHomeHitPlaying,
    isDrawSpellPlaying,
    isHomeWinPlaying,
  } = states;

  return (
    <Fragment>
      <div
        className={cx(css.fx, css.homeFx, {
          [css.visible]: isChargePlaying,
        })}
        ref={EL_HOME_FX_CHARGE_START}
      />

      <div
        className={cx(css.fx, css.homeFx, {
          [css.visible]: isChargeLoopPlaying,
        })}
        ref={EL_HOME_FX_CHARGE_LOOP}
      />

      <div
        className={cx(css.fx, css.homeFx, {
          [css.visible]: isAttackPlaying,
        })}
        ref={EL_HOME_FX_CHARGE_END}
      />

      <div
        className={cx(css.fx, css.homeFx, css.spell, {
          [css.visible]: isHomeHitPlaying && !isDrawSpellPlaying,
        })}
        ref={EL_HOME_FX_HIT}
      />

      <div
        className={cx(css.fx, css.homeFx, css.spell, {
          [css.visible]: isHomeWinPlaying,
        })}
        ref={EL_HOME_FX_WIN}
      />
    </Fragment>
  );
}

HomeFX.propTypes = {
  refs: PropTypes.shape({
    EL_HOME_FX_CHARGE_START: PropTypes.object,
    EL_HOME_FX_CHARGE_START: PropTypes.object,
    EL_HOME_FX_CHARGE_LOOP: PropTypes.object,
    EL_HOME_FX_CHARGE_END: PropTypes.object,
    EL_HOME_FX_HIT: PropTypes.object,
    EL_HOME_FX_WIN: PropTypes.object,
  }).isRequired,
  states: PropTypes.shape({
    isChargePlaying: PropTypes.bool,
    isChargeLoopPlaying: PropTypes.bool,
    isAttackPlaying: PropTypes.bool,
    isHomeHitPlaying: PropTypes.bool,
    isDrawSpellPlaying: PropTypes.bool,
    isHomeWinPlaying: PropTypes.bool,
  }).isRequired,
};

export default HomeFX;
