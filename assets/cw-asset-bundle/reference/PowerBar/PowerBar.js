import React from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import { useSpring, animated } from 'react-spring';
// import { Spring } from 'react-spring/renderprops.cjs';
import { percentageOf } from 'lib/numbers';
import affinityTypes from 'constants/affinityTypes';
import Icons from 'components/Icons';
import css from './PowerBar.css';

const ICONS = {
  [affinityTypes.FIRE]: <Icons.AffinityFire size={20} isCssColor />,
  [affinityTypes.WATER]: <Icons.AffinityWater size={20} isCssColor />,
  [affinityTypes.WIND]: <Icons.AffinityWind size={20} isCssColor />,
  [affinityTypes.NEUTRAL]: <Icons.AffinityNeutral size={20} isCssColor />,
};

const AFFINITY_CLASS_NAMES = {
  [affinityTypes.FIRE]: 'fire',
  [affinityTypes.WATER]: 'water',
  [affinityTypes.WIND]: 'wind',
  [affinityTypes.NEUTRAL]: 'neutral',
};

function PowerBar({ homeWizard, awayWizard }) {
  const homeWizardIcon = ICONS[affinityTypes[homeWizard.affinity]];
  const awayWizardIcon = ICONS[affinityTypes[awayWizard.affinity]];
  const homeWizardClass = AFFINITY_CLASS_NAMES[homeWizard.affinity];
  const awayWizardClass = AFFINITY_CLASS_NAMES[awayWizard.affinity];

  const homeNextPower = homeWizard.nextPower ? homeWizard.nextPower : 50;
  const awyNextPower = awayWizard.nextPower ? awayWizard.nextPower : 50;

  const totalPower = homeNextPower + awyNextPower;
  const homeWizardPercentage = `${percentageOf(homeNextPower, totalPower)}%`;
  const awayWizardPercentage = `${percentageOf(awyNextPower, totalPower)}%`;

  const homeWizardBar = useSpring({
    width: homeWizardPercentage,
    from: { width: homeWizardPercentage },
  });

  const awayWizardBar = useSpring({
    width: awayWizardPercentage,
    from: { width: awayWizardPercentage },
  });

  return (
    <div className={css.bar}>
      <div className={css.homeWizard}>
        <div>{homeWizardIcon}</div>
        {/* temporarily disable display of numbers */}
        {/* <Spring
          from={{ number: homeWizard.currentPower }}
          to={{ number: homeWizard.nextPower }}
        >
          {(props) => (
            <div className={css.power}>
              {powerDisplayFromWizardPower(props.number)}
            </div>
          )}
        </Spring> */}
      </div>

      <div className={css.powerBar}>
        <animated.div className={css.homeWizardBar} style={homeWizardBar}>
          <div
            className={cx(css.homePowerPercentage, {
              [css[homeWizardClass]]: homeWizardClass,
            })}
          />
          <Icons.CheeseSliceColor className={css.icon} />
        </animated.div>

        <animated.div style={awayWizardBar}>
          <div
            className={cx(css.awayPowerPercentage, {
              [css[awayWizardClass]]: awayWizardClass,
            })}
          />
        </animated.div>
      </div>

      <div className={css.awayWizard}>
        <div>{awayWizardIcon}</div>
        {/* temporarily disable display of numbers */}
        {/* <div className={css.power}>
          <Spring
            from={{ number: awayWizard.currentPower }}
            to={{ number: awayWizard.nextPower }}
          >
            {(props) => (
              <div className={css.power}>
                {powerDisplayFromWizardPower(props.number)}
              </div>
            )}
          </Spring>
        </div> */}
      </div>
    </div>
  );
}

PowerBar.propTypes = {
  // number: PropTypes.number,
  homeWizard: PropTypes.shape({
    affinity: PropTypes.oneOf(Object.keys(affinityTypes)),
    currentPower: PropTypes.number,
    nextPower: PropTypes.number,
  }),
  awayWizard: PropTypes.shape({
    affinity: PropTypes.oneOf(Object.keys(affinityTypes)),
    currentPower: PropTypes.number,
    nextPower: PropTypes.number,
  }),
};

PowerBar.defaultProps = {
  homeWizard: undefined,
  awayWizard: undefined,
  // number: null,
};

export default PowerBar;
