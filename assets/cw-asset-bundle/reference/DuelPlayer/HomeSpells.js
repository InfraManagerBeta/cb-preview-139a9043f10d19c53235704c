import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import affinityTypes from 'constants/affinityTypes.js';
import css from './DuelPlayer.css';

function HomeSpells({ refs, states }) {
  const { fire, water, wind } = refs;
  const {
    isAttackPlaying,
    isHomeResetPlaying,
    isHomeHitPlaying,
    homeSpellType,
    isDrawSpellPlaying,
  } = states;

  return (
    <Fragment>
      {/* FIRE */}
      <div
        className={cx(css.fx, css.homeFx, css.spell, {
          [css.visible]:
            isAttackPlaying && homeSpellType === affinityTypes.FIRE,
        })}
        ref={fire.EL_HOME_SPELL_CAST}
      />
      <div
        className={cx(css.fx, css.homeFx, css.winSpell, {
          [css.visible]:
            isHomeResetPlaying &&
            !isDrawSpellPlaying &&
            homeSpellType === affinityTypes.FIRE,
        })}
        ref={fire.EL_HOME_SPELL_WIN}
      />
      <div
        className={cx(css.fx, css.homeFx, css.loseSpell, {
          [css.visible]:
            (isHomeHitPlaying || isDrawSpellPlaying) &&
            homeSpellType === affinityTypes.FIRE,
        })}
        ref={fire.EL_HOME_SPELL_LOSE}
      />

      {/* WATER */}
      <div
        className={cx(css.fx, css.homeFx, css.spell, {
          [css.visible]:
            isAttackPlaying && homeSpellType === affinityTypes.WATER,
        })}
        ref={water.EL_HOME_SPELL_CAST}
      />
      <div
        className={cx(css.fx, css.homeFx, css.winSpell, {
          [css.visible]:
            isHomeResetPlaying &&
            !isDrawSpellPlaying &&
            homeSpellType === affinityTypes.WATER,
        })}
        ref={water.EL_HOME_SPELL_WIN}
      />
      <div
        className={cx(css.fx, css.homeFx, css.loseSpell, {
          [css.visible]:
            (isHomeHitPlaying || isDrawSpellPlaying) &&
            homeSpellType === affinityTypes.WATER,
        })}
        ref={water.EL_HOME_SPELL_LOSE}
      />

      {/* WIND */}
      <div
        className={cx(css.fx, css.homeFx, css.spell, {
          [css.visible]:
            isAttackPlaying && homeSpellType === affinityTypes.WIND,
        })}
        ref={wind.EL_HOME_SPELL_CAST}
      />
      <div
        className={cx(css.fx, css.homeFx, css.winSpell, {
          [css.visible]:
            isHomeResetPlaying &&
            !isDrawSpellPlaying &&
            homeSpellType === affinityTypes.WIND,
        })}
        ref={wind.EL_HOME_SPELL_WIN}
      />
      <div
        className={cx(css.fx, css.homeFx, css.loseSpell, {
          [css.visible]:
            (isHomeHitPlaying || isDrawSpellPlaying) &&
            homeSpellType === affinityTypes.WIND,
        })}
        ref={wind.EL_HOME_SPELL_LOSE}
      />
    </Fragment>
  );
}

HomeSpells.propTypes = {
  refs: PropTypes.object.isRequired,
  states: PropTypes.shape({
    isAttackPlaying: PropTypes.bool,
    isHomeResetPlaying: PropTypes.bool,
    isHomeHitPlaying: PropTypes.bool,
    homeSpellType: PropTypes.string,
    isDrawSpellPlaying: PropTypes.bool,
  }).isRequired,
};

HomeSpells.defaultProps = {};

export default HomeSpells;
