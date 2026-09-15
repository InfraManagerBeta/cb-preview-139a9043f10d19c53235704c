import React from 'react';
import PropTypes from 'prop-types';
import SpellSquare from './SpellSquare.js';
import css from './SpellHistory.css';

function cleanSpellName(spell) {
  return spell.replace('_AFFINITY', '');
}

function isAffinitySpell(spell) {
  const affinityString = spell.substring(spell.indexOf('_') + 1);
  return affinityString === 'AFFINITY';
}

function outcomeType(outcome, perspective) {
  if (outcome === 'draw') {
    return 'draw';
  }

  const isWin = outcome === perspective;
  return isWin ? 'win' : 'lose';
}

function SpellHistory({ round, moves, type }) {
  return (
    <div className={css.spellHistory}>
      {moves.map((move, index) => {
        const spell = move[`${type}WizardSpell`];
        const outcome = move.winner.toLowerCase();
        const isVisible = round >= index + 1;

        return (
          <SpellSquare
            key={index}
            spell={cleanSpellName(spell)}
            isVisible={isVisible}
            isAffinity={isAffinitySpell(spell)}
            result={outcomeType(outcome, type)}
          />
        );
      })}
    </div>
  );
}

SpellHistory.propTypes = {
  round: PropTypes.number.isRequired,
  moves: PropTypes.array.isRequired,
  type: PropTypes.oneOf(['home', 'away']).isRequired,
};

SpellHistory.defaultProps = {};

export default SpellHistory;
