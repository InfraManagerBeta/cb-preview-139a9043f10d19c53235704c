import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import css from './DuelPlayer.css';

function AwayFX({ refs, states }) {
  const {
    EL_AWAY_FX_CHARGE_START,
    EL_AWAY_FX_CHARGE_LOOP,
    EL_AWAY_FX_CHARGE_END,
    EL_AWAY_FX_HIT,
    EL_AWAY_FX_WIN,
  } = refs;
  const {
    isChargePlaying,
    isChargeLoopPlaying,
    isAttackPlaying,
    isAwayHitPlaying,
    isDrawSpellPlaying,
    isAwayWinPlaying,
  } = states;

  return (
    <Fragment>
      <div
        className={cx(css.fx, css.awayFx, {
          [css.visible]: isChargePlaying,
        })}
        ref={EL_AWAY_FX_CHARGE_START}
      />

      <div
        className={cx(css.fx, css.awayFx, {
          [css.visible]: isChargeLoopPlaying,
        })}
        ref={EL_AWAY_FX_CHARGE_LOOP}
      />

      <div
        className={cx(css.fx, css.awayFx, {
          [css.visible]: isAttackPlaying,
        })}
        ref={EL_AWAY_FX_CHARGE_END}
      />

      <div
        className={cx(css.fx, css.awayFx, css.spell, {
          [css.visible]: isAwayHitPlaying && !isDrawSpellPlaying,
        })}
        ref={EL_AWAY_FX_HIT}
      />

      <div
        className={cx(css.fx, css.awayFx, css.spell, {
          [css.visible]: isAwayWinPlaying,
        })}
        ref={EL_AWAY_FX_WIN}
      />
    </Fragment>
  );
}

AwayFX.propTypes = {
  refs: PropTypes.shape({
    EL_AWAY_FX_CHARGE_START: PropTypes.object,
    EL_AWAY_FX_CHARGE_LOOP: PropTypes.object,
    EL_AWAY_FX_CHARGE_END: PropTypes.object,
    EL_AWAY_FX_HIT: PropTypes.object,
    EL_AWAY_FX_WIN: PropTypes.object,
  }).isRequired,
  states: PropTypes.shape({
    isChargePlaying: PropTypes.bool,
    isChargeLoopPlaying: PropTypes.bool,
    isAttackPlaying: PropTypes.bool,
    isAwayHitPlaying: PropTypes.bool,
    isDrawSpellPlaying: PropTypes.bool,
    isAwayWinPlaying: PropTypes.bool,
  }).isRequired,
};

AwayFX.defaultProps = {};

export default AwayFX;
