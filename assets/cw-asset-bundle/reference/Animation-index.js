import lottie from 'lottie-web';
import affinityTypes from 'constants/affinityTypes.js';

export function animationInstance(container, path) {
  const config = {
    autoplay: false,
    container: container,
    loop: false,
    path: path,
    renderer: 'canvas',
    rendererSettings: {
      progressiveLoad: true, // only for svg renderer, loads dom elements when needed. Might speed up initialization for large number of elements.
    },
  };

  const animation = lottie.loadAnimation(config);
  animation.setSubframe(false); // we always want animations to run on the frames they're supposed to (30fps for fight scenes)
  // animation.setSpeed(0.5);

  return animation;
}

// @todo, render affinity spells instead of normal spells for animations
// will also need to add the cape for the wizard when he uses an affinity spell
export function spellToRender(spell) {
  const SPELL_TYPES = {
    [affinityTypes.FIRE]: affinityTypes.FIRE,
    [affinityTypes.WATER]: affinityTypes.WATER,
    [affinityTypes.WIND]: affinityTypes.WIND,
    ['FIRE_AFFINITY']: affinityTypes.FIRE,
    ['WATER_AFFINITY']: affinityTypes.WATER,
    ['WIND_AFFINITY']: affinityTypes.WIND,
  };
  const spellType = SPELL_TYPES[spell];

  return spellType;
}
