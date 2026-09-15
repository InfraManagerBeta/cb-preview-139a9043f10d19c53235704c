import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import affinityTypes from 'constants/affinityTypes.js';
import css from './DuelPlayer.css';

function AwaySpells({ refs, states }) {
  const { fire, water, wind } = refs;
  const {
    isAttackPlaying,
    isAwayResetPlaying,
    isAwayHitPlaying,
    awaySpellType,
    isDrawSpellPlaying,
  } = states;

  return (
    <Fragment>
      {/* FIRE */}
      <div
        className={cx(css.fx, css.awayFx, css.spell, {
          [css.visible]:
            isAttackPlaying && awaySpellType === affinityTypes.FIRE,
        })}
        ref={fire.EL_AWAY_SPELL_CAST}
      />
      <div
        className={cx(css.fx, css.awayFx, css.winSpell, {
          [css.visible]:
            isAwayResetPlaying &&
            !isDrawSpellPlaying &&
            awaySpellType === affinityTypes.FIRE,
        })}
        ref={fire.EL_AWAY_SPELL_WIN}
      />
      <div
        className={cx(css.fx, css.awayFx, css.loseSpell, {
          [css.visible]:
            (isAwayHitPlaying || isDrawSpellPlaying) &&
            awaySpellType === affinityTypes.FIRE,
        })}
        ref={fire.EL_AWAY_SPELL_LOSE}
      />

      {/* WATER */}
      <div
        className={cx(css.fx, css.awayFx, css.spell, {
          [css.visible]:
            isAttackPlaying && awaySpellType === affinityTypes.WATER,
        })}
        ref={water.EL_AWAY_SPELL_CAST}
      />
      <div
        className={cx(css.fx, css.awayFx, css.winSpell, {
          [css.visible]:
            isAwayResetPlaying &&
            !isDrawSpellPlaying &&
            awaySpellType === affinityTypes.WATER,
        })}
        ref={water.EL_AWAY_SPELL_WIN}
      />
      <div
        className={cx(css.fx, css.awayFx, css.loseSpell, {
          [css.visible]:
            (isAwayHitPlaying || isDrawSpellPlaying) &&
            awaySpellType === affinityTypes.WATER,
        })}
        ref={water.EL_AWAY_SPELL_LOSE}
      />

      {/* WIND */}
      <div
        className={cx(css.fx, css.awayFx, css.spell, {
          [css.visible]:
            isAttackPlaying && awaySpellType === affinityTypes.WIND,
        })}
        ref={wind.EL_AWAY_SPELL_CAST}
      />
      <div
        className={cx(css.fx, css.awayFx, css.winSpell, {
          [css.visible]:
            isAwayResetPlaying &&
            !isDrawSpellPlaying &&
            awaySpellType === affinityTypes.WIND,
        })}
        ref={wind.EL_AWAY_SPELL_WIN}
      />
      <div
        className={cx(css.fx, css.awayFx, css.loseSpell, {
          [css.visible]:
            (isAwayHitPlaying || isDrawSpellPlaying) &&
            awaySpellType === affinityTypes.WIND,
        })}
        ref={wind.EL_AWAY_SPELL_LOSE}
      />
    </Fragment>
  );
}

AwaySpells.propTypes = {
  refs: PropTypes.object.isRequired,
  states: PropTypes.shape({
    isAttackPlaying: PropTypes.bool,
    isAwayResetPlaying: PropTypes.bool,
    isAwayHitPlaying: PropTypes.bool,
    awaySpellType: PropTypes.string,
    isDrawSpellPlaying: PropTypes.bool,
  }).isRequired,
};

AwaySpells.defaultProps = {};

export default AwaySpells;
