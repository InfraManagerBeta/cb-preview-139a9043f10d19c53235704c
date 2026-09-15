import React from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import { useSpring, animated, config } from 'react-spring';
import affinityTypes from 'constants/affinityTypes';
import Icons from 'components/Icons';
import css from './SpellHistory.css';

const ICONS = {
  [affinityTypes.FIRE]: (
    <Icons.AffinityFire size={20} isCssColor className={css.icon} />
  ),
  [affinityTypes.WATER]: (
    <Icons.AffinityWater size={20} isCssColor className={css.icon} />
  ),
  [affinityTypes.WIND]: (
    <Icons.AffinityWind size={20} isCssColor className={css.icon} />
  ),
};

function SpellSquare({ spell, isVisible, isAffinity, result }) {
  const icon = ICONS[affinityTypes[spell]];
  const displayButton = useSpring({
    transform: isVisible ? 'scale(1)' : 'scale(0)',
    config: config.wobbly,
  });

  return (
    <animated.div
      style={displayButton}
      className={cx(css.spell, {
        [css.visible]: isVisible,
        [css[result]]: result,
        [css.affinity]: isAffinity,
      })}
    >
      {icon}
    </animated.div>
  );
}

SpellSquare.propTypes = {
  spell: PropTypes.oneOf([
    affinityTypes.FIRE,
    affinityTypes.WATER,
    affinityTypes.WIND,
  ]).isRequired,
  result: PropTypes.oneOf(['draw', 'win', 'lose', 'affinity']).isRequired,
  isVisible: PropTypes.bool,
  isAffinity: PropTypes.bool,
};

SpellSquare.defaultProps = {
  isVisible: false,
  isAffinity: false,
};

export default SpellSquare;
