import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import css from './DuelPlayer.css';

function SpellsFx({ refs, states }) {
  const { EL_FX_SPELL_CENTRE, EL_FX_SPELL_DRAW } = refs;
  const { isAttackPlaying, isDrawSpellPlaying } = states;

  return (
    <Fragment>
      <div
        className={cx(css.fx, css.spellFx, {
          [css.visible]: isAttackPlaying,
        })}
        ref={EL_FX_SPELL_CENTRE}
      />

      <div
        className={cx(css.fx, css.spellFx, {
          [css.visible]: isDrawSpellPlaying,
        })}
        ref={EL_FX_SPELL_DRAW}
      />
    </Fragment>
  );
}

SpellsFx.propTypes = {
  refs: PropTypes.shape({
    EL_FX_SPELL_CENTRE: PropTypes.object,
    EL_FX_SPELL_DRAW: PropTypes.object,
  }).isRequired,
  states: PropTypes.shape({
    isAttackPlaying: PropTypes.bool,
    isDrawSpellPlaying: PropTypes.bool,
  }).isRequired,
};

SpellsFx.defaultProps = {};

export default SpellsFx;
