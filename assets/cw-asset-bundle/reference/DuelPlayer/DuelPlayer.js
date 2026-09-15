import React, { Fragment, Component } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import getConfig from 'next/config';
import { DEFAULT_USERNAME } from 'constants/profiles';
import { animationInstance, spellToRender } from 'lib/Animation';
import { percentageOf } from 'lib/numbers';
import { resolveDuel } from 'lib/powerTransferMock';
import { outcomePropType } from 'lib/duelOutcome/duelOutcome.js';
import { HOME, AWAY, BOTH } from 'lib/duel/perspective.js';
import Button from 'components/Button';
import PowerBar from 'components/PowerBar/PowerBar.js';
import { Avatar } from 'components/Avatar/Avatar';
import soundManager from './soundManager.js';
import SpellHistory from './SpellHistory.js';
import HomeWizard from './HomeWizard.js';
import AwayWizard from './AwayWizard.js';
import HomeFX from './HomeFX.js';
import AwayFX from './AwayFX.js';
import HomeSpells from './HomeSpells.js';
import AwaySpells from './AwaySpells.js';
import SpellsFx from './SpellsFx.js';
import css from './DuelPlayer.css';

const { publicRuntimeConfig } = getConfig();
const TOTAL_ROUNDS = 4; // Actually 5, but we counting from 0 to easily match indexes

class DuelPlayer extends Component {
  constructor(props) {
    super(props);
    this.EL_HOME_IDLE = React.createRef();
    this.EL_HOME_CHARGE = React.createRef();
    this.EL_HOME_CHARGE_LOOP = React.createRef();
    this.EL_HOME_ATTACK = React.createRef();
    this.EL_HOME_RESET = React.createRef();
    this.EL_HOME_HIT = React.createRef();
    this.EL_HOME_WIN = React.createRef();
    this.EL_HOME_LOSE = React.createRef();
    this.EL_HOME_DRAW = React.createRef();

    this.EL_AWAY_IDLE = React.createRef();
    this.EL_AWAY_CHARGE = React.createRef();
    this.EL_AWAY_CHARGE_LOOP = React.createRef();
    this.EL_AWAY_ATTACK = React.createRef();
    this.EL_AWAY_RESET = React.createRef();
    this.EL_AWAY_HIT = React.createRef();
    this.EL_AWAY_WIN = React.createRef();
    this.EL_AWAY_LOSE = React.createRef();
    this.EL_AWAY_DRAW = React.createRef();

    this.EL_FX_SPELL_CENTRE = React.createRef();
    this.EL_FX_SPELL_DRAW = React.createRef();

    this.EL_HOME_FX_CHARGE_START = React.createRef();
    this.EL_HOME_FX_CHARGE_LOOP = React.createRef();
    this.EL_HOME_FX_CHARGE_END = React.createRef();
    this.EL_HOME_FX_HIT = React.createRef();
    this.EL_HOME_FX_WIN = React.createRef();

    this.EL_AWAY_FX_CHARGE_START = React.createRef();
    this.EL_AWAY_FX_CHARGE_LOOP = React.createRef();
    this.EL_AWAY_FX_CHARGE_END = React.createRef();
    this.EL_AWAY_FX_HIT = React.createRef();
    this.EL_AWAY_FX_WIN = React.createRef();

    this.EL_HOME_SPELL_CAST_FIRE = React.createRef();
    this.EL_HOME_SPELL_WIN_FIRE = React.createRef();
    this.EL_HOME_SPELL_LOSE_FIRE = React.createRef();

    this.EL_HOME_SPELL_CAST_WATER = React.createRef();
    this.EL_HOME_SPELL_WIN_WATER = React.createRef();
    this.EL_HOME_SPELL_LOSE_WATER = React.createRef();

    this.EL_HOME_SPELL_CAST_WIND = React.createRef();
    this.EL_HOME_SPELL_WIN_WIND = React.createRef();
    this.EL_HOME_SPELL_LOSE_WIND = React.createRef();

    this.EL_AWAY_SPELL_CAST_FIRE = React.createRef();
    this.EL_AWAY_SPELL_WIN_FIRE = React.createRef();
    this.EL_AWAY_SPELL_LOSE_FIRE = React.createRef();

    this.EL_AWAY_SPELL_CAST_WATER = React.createRef();
    this.EL_AWAY_SPELL_WIN_WATER = React.createRef();
    this.EL_AWAY_SPELL_LOSE_WATER = React.createRef();

    this.EL_AWAY_SPELL_CAST_WIND = React.createRef();
    this.EL_AWAY_SPELL_WIN_WIND = React.createRef();
    this.EL_AWAY_SPELL_LOSE_WIND = React.createRef();
  }

  state = {
    isAnimationReady: false,
    isDuelPlayerReady: false,
    isButtonVisible: false,
    isIdlePlaying: true,
    isChargePlaying: false,
    isChargeLoopPlaying: false,
    isAttackPlaying: false,
    isHomeResetPlaying: false,
    isHomeHitPlaying: false,
    isHomeWinPlaying: false,
    isHomeLosePlaying: false,
    isAwayResetPlaying: false,
    isAwayHitPlaying: false,
    isAwayWinPlaying: false,
    isAwayLosePlaying: false,
    isDrawPlaying: false,
    round: 0,
    currentSpellHistory: 0,
    homeSpellType: undefined,
    awaySpellType: undefined,
    isDrawSpellPlaying: false,
    animationsTotal: 0,
    animationsLoaded: 0,
    homeBar: 0,
    awayBar: 0,
  };

  componentDidMount() {
    const { outcome, homeWizardData, awayWizardData } = this.props;
    this.loadAnimations();

    this.homeWizardInitialPower =
      outcome.homeWizardStartingPower /
      publicRuntimeConfig.WIZARD_POWER_DIVISOR;
    this.awayWizardInitialPower =
      outcome.awayWizardStartingPower /
      publicRuntimeConfig.WIZARD_POWER_DIVISOR;

    const powerPerRound = resolveDuel(
      outcome.homeMoves,
      this.homeWizardInitialPower,
      homeWizardData.affinityType,
      outcome.awayMoves,
      this.awayWizardInitialPower,
      awayWizardData.affinityType,
    );

    this.setState({
      homeBar: this.homeWizardInitialPower,
      awayBar: this.awayWizardInitialPower,
    });

    this.powerBarResults = powerPerRound.roundByRoundResults;
  }

  componentDidUpdate() {
    if (
      this.props.isSoundReady &&
      this.state.isAnimationReady &&
      !this.state.isDuelPlayerReady
    ) {
      this.setState({ isDuelPlayerReady: true }, () => {
        this.props.onDuelPlayerReady();
        this.animationChain();
      });
    }
  }

  async componentWillUnmount() {
    await this.HOME_IDLE.removeEventListener('complete');
    await this.HOME_CHARGE.removeEventListener('complete');
    await this.HOME_ATTACK.removeEventListener('complete');
    await this.HOME_RESET.removeEventListener('complete');
    await this.HOME_HIT.removeEventListener('complete');
    await this.HOME_CHARGE.removeEventListener('complete');
    await this.HOME_WIN.removeEventListener('complete');
    await this.HOME_LOSE.removeEventListener('complete');

    // Destroy all the animations
    this.animations.forEach((animation) => {
      try {
        animation.destroy();
      } catch (error) {}
    });
  }

  // Load all the animations that we might need
  loadAnimations = () => {
    const { homeWizard, awayWizard, fx, spells } = this.props;

    // Home wizard default animations
    this.HOME_IDLE = animationInstance(
      this.EL_HOME_IDLE.current,
      homeWizard.idle,
    );
    this.HOME_CHARGE = animationInstance(
      this.EL_HOME_CHARGE.current,
      homeWizard.charge,
    );
    this.HOME_CHARGE_LOOP = animationInstance(
      this.EL_HOME_CHARGE_LOOP.current,
      homeWizard.chargeLoop,
    );
    this.HOME_ATTACK = animationInstance(
      this.EL_HOME_ATTACK.current,
      homeWizard.attack,
    );
    this.HOME_RESET = animationInstance(
      this.EL_HOME_RESET.current,
      homeWizard.reset,
    );
    this.HOME_HIT = animationInstance(this.EL_HOME_HIT.current, homeWizard.hit);
    this.HOME_WIN = animationInstance(this.EL_HOME_WIN.current, homeWizard.win);
    this.HOME_LOSE = animationInstance(
      this.EL_HOME_LOSE.current,
      homeWizard.lose,
    );
    this.HOME_DRAW = animationInstance(
      this.EL_HOME_DRAW.current,
      homeWizard.draw,
    );

    // Away wizard default animations
    this.AWAY_IDLE = animationInstance(
      this.EL_AWAY_IDLE.current,
      awayWizard.idle,
    );
    this.AWAY_CHARGE = animationInstance(
      this.EL_AWAY_CHARGE.current,
      awayWizard.charge,
    );
    this.AWAY_CHARGE_LOOP = animationInstance(
      this.EL_AWAY_CHARGE_LOOP.current,
      awayWizard.chargeLoop,
    );
    this.AWAY_ATTACK = animationInstance(
      this.EL_AWAY_ATTACK.current,
      awayWizard.attack,
    );
    this.AWAY_RESET = animationInstance(
      this.EL_AWAY_RESET.current,
      awayWizard.reset,
    );
    this.AWAY_HIT = animationInstance(this.EL_AWAY_HIT.current, awayWizard.hit);
    this.AWAY_WIN = animationInstance(this.EL_AWAY_WIN.current, awayWizard.win);
    this.AWAY_LOSE = animationInstance(
      this.EL_AWAY_LOSE.current,
      awayWizard.lose,
    );
    this.AWAY_DRAW = animationInstance(
      this.EL_AWAY_DRAW.current,
      awayWizard.draw,
    );

    // FX
    this.FX_SPELL_CENTRE = animationInstance(
      this.EL_FX_SPELL_CENTRE.current,
      fx.center,
    );
    this.FX_SPELL_DRAW = animationInstance(
      this.EL_FX_SPELL_DRAW.current,
      fx.drawCenter,
    );

    // Home wizard fx
    this.HOME_FX_CHARGE_START = animationInstance(
      this.EL_HOME_FX_CHARGE_START.current,
      fx.chargeStart,
    );
    this.HOME_FX_CHARGE_LOOP = animationInstance(
      this.EL_HOME_FX_CHARGE_LOOP.current,
      fx.chargeLoop,
    );
    this.HOME_FX_CHARGE_END = animationInstance(
      this.EL_HOME_FX_CHARGE_END.current,
      fx.chargeEnd,
    );
    this.HOME_FX_HIT = animationInstance(this.EL_HOME_FX_HIT.current, fx.hit);
    this.HOME_FX_WIN = animationInstance(this.EL_HOME_FX_WIN.current, fx.win);

    // Away wizard fx
    this.AWAY_FX_CHARGE_START = animationInstance(
      this.EL_AWAY_FX_CHARGE_START.current,
      fx.chargeStart,
    );
    this.AWAY_FX_CHARGE_LOOP = animationInstance(
      this.EL_AWAY_FX_CHARGE_LOOP.current,
      fx.chargeLoop,
    );
    this.AWAY_FX_CHARGE_END = animationInstance(
      this.EL_AWAY_FX_CHARGE_END.current,
      fx.chargeEnd,
    );
    this.AWAY_FX_HIT = animationInstance(this.EL_AWAY_FX_HIT.current, fx.hit);
    this.AWAY_FX_WIN = animationInstance(this.EL_AWAY_FX_WIN.current, fx.win);

    // Home wizard spells
    this.HOME_SPELL_CAST_FIRE = animationInstance(
      this.EL_HOME_SPELL_CAST_FIRE.current,
      spells.fire.normal.cast,
    );
    this.HOME_SPELL_WIN_FIRE = animationInstance(
      this.EL_HOME_SPELL_WIN_FIRE.current,
      spells.fire.normal.win,
    );
    this.HOME_SPELL_LOSE_FIRE = animationInstance(
      this.EL_HOME_SPELL_LOSE_FIRE.current,
      spells.fire.normal.lose,
    );
    this.HOME_SPELL_CAST_WATER = animationInstance(
      this.EL_HOME_SPELL_CAST_WATER.current,
      spells.water.normal.cast,
    );
    this.HOME_SPELL_WIN_WATER = animationInstance(
      this.EL_HOME_SPELL_WIN_WATER.current,
      spells.water.normal.win,
    );
    this.HOME_SPELL_LOSE_WATER = animationInstance(
      this.EL_HOME_SPELL_LOSE_WATER.current,
      spells.water.normal.lose,
    );
    this.HOME_SPELL_CAST_WIND = animationInstance(
      this.EL_HOME_SPELL_CAST_WIND.current,
      spells.wind.normal.cast,
    );
    this.HOME_SPELL_WIN_WIND = animationInstance(
      this.EL_HOME_SPELL_WIN_WIND.current,
      spells.wind.normal.win,
    );
    this.HOME_SPELL_LOSE_WIND = animationInstance(
      this.EL_HOME_SPELL_LOSE_WIND.current,
      spells.wind.normal.lose,
    );

    // Away wizard spells
    this.AWAY_SPELL_CAST_FIRE = animationInstance(
      this.EL_AWAY_SPELL_CAST_FIRE.current,
      spells.fire.normal.cast,
    );
    this.AWAY_SPELL_WIN_FIRE = animationInstance(
      this.EL_AWAY_SPELL_WIN_FIRE.current,
      spells.fire.normal.win,
    );
    this.AWAY_SPELL_LOSE_FIRE = animationInstance(
      this.EL_AWAY_SPELL_LOSE_FIRE.current,
      spells.fire.normal.lose,
    );
    this.AWAY_SPELL_CAST_WATER = animationInstance(
      this.EL_AWAY_SPELL_CAST_WATER.current,
      spells.water.normal.cast,
    );
    this.AWAY_SPELL_WIN_WATER = animationInstance(
      this.EL_AWAY_SPELL_WIN_WATER.current,
      spells.water.normal.win,
    );
    this.AWAY_SPELL_LOSE_WATER = animationInstance(
      this.EL_AWAY_SPELL_LOSE_WATER.current,
      spells.water.normal.lose,
    );
    this.AWAY_SPELL_CAST_WIND = animationInstance(
      this.EL_AWAY_SPELL_CAST_WIND.current,
      spells.wind.normal.cast,
    );
    this.AWAY_SPELL_WIN_WIND = animationInstance(
      this.EL_AWAY_SPELL_WIN_WIND.current,
      spells.wind.normal.win,
    );
    this.AWAY_SPELL_LOSE_WIND = animationInstance(
      this.EL_AWAY_SPELL_LOSE_WIND.current,
      spells.wind.normal.lose,
    );

    // This is the full collection of animation instances created up above.
    //
    // If wait time is too long we can load animations async loading the most
    // important first and remove them from this object.
    this.animations = [
      this.HOME_IDLE,
      this.HOME_CHARGE,
      this.HOME_CHARGE_LOOP,
      this.HOME_ATTACK,
      this.HOME_RESET,
      this.HOME_HIT,
      this.HOME_WIN,
      this.HOME_LOSE,
      this.HOME_DRAW,
      this.AWAY_IDLE,
      this.AWAY_CHARGE,
      this.AWAY_CHARGE_LOOP,
      this.AWAY_ATTACK,
      this.AWAY_RESET,
      this.AWAY_HIT,
      this.AWAY_WIN,
      this.AWAY_LOSE,
      this.AWAY_DRAW,
      this.FX_SPELL_CENTRE,
      this.FX_SPELL_DRAW,
      this.HOME_FX_CHARGE_START,
      this.HOME_FX_CHARGE_LOOP,
      this.HOME_FX_CHARGE_END,
      this.HOME_FX_HIT,
      this.HOME_FX_WIN,
      this.AWAY_FX_CHARGE_START,
      this.AWAY_FX_CHARGE_LOOP,
      this.AWAY_FX_CHARGE_END,
      this.AWAY_FX_HIT,
      this.AWAY_FX_WIN,
      this.HOME_SPELL_CAST_FIRE,
      this.HOME_SPELL_WIN_FIRE,
      this.HOME_SPELL_LOSE_FIRE,
      this.HOME_SPELL_CAST_WATER,
      this.HOME_SPELL_WIN_WATER,
      this.HOME_SPELL_LOSE_WATER,
      this.HOME_SPELL_CAST_WIND,
      this.HOME_SPELL_WIN_WIND,
      this.HOME_SPELL_LOSE_WIND,
      this.AWAY_SPELL_CAST_FIRE,
      this.AWAY_SPELL_WIN_FIRE,
      this.AWAY_SPELL_LOSE_FIRE,
      this.AWAY_SPELL_CAST_WATER,
      this.AWAY_SPELL_WIN_WATER,
      this.AWAY_SPELL_LOSE_WATER,
      this.AWAY_SPELL_CAST_WIND,
      this.AWAY_SPELL_WIN_WIND,
      this.AWAY_SPELL_LOSE_WIND,
    ];

    // Bump the variable for the total number of animations defined above
    this.setState(
      {
        animationsTotal: this.animations.length,
      },
      () => {
        // Then add an event listener for each element to see if it's read or not
        this.animations.forEach((elem) => {
          elem.addEventListener('data_ready', this.handleDataReady);
        });
      },
    );
  };

  // Each time an animation data set is "ready" we run the handleDataReady
  // callback. This increments the number of animations loaded, and then decides
  // whether or not to update the "isAnimationReady" state variable, which
  // indicates that all duel animations are ready to be played.
  handleDataReady = () => {
    // Increment the number of `animationsLoaded`
    this.setState(
      (prevState) => ({
        animationsLoaded: prevState.animationsLoaded + 1,
      }),
      () => {
        // Only allow play or scroll down of the page if all animations are ready.
        // This is done by checking that total number of animations is equal to the
        // number of loaded animations.
        if (this.state.animationsTotal === this.state.animationsLoaded) {
          console.log(
            '%c👯‍♀️ Animations ready',
            'padding: 4px 8px; color: black; background-color: #fff240;',
          );
          this.setState(
            {
              isAnimationReady: true,
            },
            () => {
              // when all animations are ready remove event listener
              this.animations.forEach((animation) => {
                animation.removeEventListener('data_ready');
              });
            },
          );
        }
      },
    );
  };

  // This gets fired when a user clicks the "Fight" button in the duel player.
  // It checks the current round and the move set, and decides what to play.
  fight = () => {
    const { round } = this.state;
    const { moves, onDuelPlayerRoundStart } = this.props;
    onDuelPlayerRoundStart(round);

    const roundWinner = moves[round].winner;
    const isHomeRoundWinner = roundWinner === 'HOME';
    const isAwayRoundWinner = roundWinner === 'AWAY';
    const isDraw = roundWinner === 'DRAW';

    const homeMove = spellToRender(moves[round].homeWizardSpell);
    const awayMove = spellToRender(moves[round].awayWizardSpell);
    const homeRoundResult = isHomeRoundWinner ? 'WIN' : 'LOSE';
    const awayRoundResult = isAwayRoundWinner ? 'WIN' : 'LOSE';

    this.HOME_CHARGE_LOOP.stop();
    this.AWAY_CHARGE_LOOP.stop();
    this.HOME_FX_CHARGE_LOOP.stop();
    this.AWAY_FX_CHARGE_LOOP.stop();

    this.setState({
      isChargeLoopPlaying: false,
      isAttackPlaying: true,
      isButtonVisible: false,
      homeSpellType: homeMove,
      awaySpellType: awayMove,
    });

    this.HOME_ATTACK.play();
    this.AWAY_ATTACK.play();
    this.HOME_FX_CHARGE_END.play();
    this.AWAY_FX_CHARGE_END.play();
    this.FX_SPELL_CENTRE.play();

    const homeCast = this[`HOME_SPELL_CAST_${homeMove}`];
    const awayCast = this[`AWAY_SPELL_CAST_${awayMove}`];

    const homeResult = this[`HOME_SPELL_${homeRoundResult}_${homeMove}`];
    const awayResult = this[`AWAY_SPELL_${awayRoundResult}_${awayMove}`];

    homeCast.play();
    awayCast.play();

    this.HOME_ATTACK.addEventListener('complete', () => {
      this.setState({
        isAttackPlaying: false,
        isHomeResetPlaying: isHomeRoundWinner || isDraw,
        isHomeHitPlaying: !isHomeRoundWinner,
        isAwayResetPlaying: isAwayRoundWinner || isDraw,
        isAwayHitPlaying: !isAwayRoundWinner,
        isDrawSpellPlaying: isDraw,
        homeBar: this.powerBarResults[round][0],
        awayBar: this.powerBarResults[round][1],
        currentSpellHistory: round + 1,
      });

      this.HOME_ATTACK.stop();
      this.AWAY_ATTACK.stop();
      this.HOME_FX_CHARGE_END.stop();
      this.AWAY_FX_CHARGE_END.stop();
      this.FX_SPELL_CENTRE.stop();
      homeCast.stop();
      awayCast.stop();
      homeResult.play();
      awayResult.play();

      if (isDraw) {
        this.FX_SPELL_DRAW.play();
      }

      if (isHomeRoundWinner || isDraw) {
        this.HOME_RESET.play();
      } else {
        this.HOME_FX_HIT.play();
        this.HOME_HIT.play();
      }

      if (isAwayRoundWinner || isDraw) {
        this.AWAY_RESET.play();
      } else {
        this.AWAY_FX_HIT.play();
        this.AWAY_HIT.play();
      }
    });

    this.HOME_RESET.addEventListener('complete', () => {
      this.onReset(homeResult, awayResult);
    });

    this.HOME_HIT.addEventListener('complete', () => {
      this.onReset(homeResult, awayResult);
    });

    this.HOME_CHARGE.addEventListener('complete', () => {
      this.setState({
        round: round + 1,
      });

      this.chargeLoop();
    });
  };

  onReset = (homeResult, awayResult) => {
    const { round } = this.state;
    const { winner } = this.props;

    this.setState({
      isHomeResetPlaying: false,
      isHomeHitPlaying: false,
      isAwayResetPlaying: false,
      isAwayHitPlaying: false,
      isDrawSpellPlaying: false,
    });

    this.FX_SPELL_DRAW.stop();
    this.HOME_RESET.stop();
    this.HOME_FX_HIT.stop();
    this.HOME_HIT.stop();
    this.AWAY_RESET.stop();
    this.AWAY_FX_HIT.stop();
    this.AWAY_HIT.stop();

    homeResult.stop();
    awayResult.stop();

    if (round === TOTAL_ROUNDS) {
      const isHomeDuelWinner = winner === 'HOME';
      const isAwayDuelWinner = winner === 'AWAY';
      const isDuelDraw = winner === 'DRAW';

      const homeWizardState = isHomeDuelWinner ? 'WIN' : 'LOSE';
      const awayWizardState = isAwayDuelWinner ? 'WIN' : 'LOSE';

      const homeAnimation = isDuelDraw ? 'DRAW' : homeWizardState;
      const awayAnimation = isDuelDraw ? 'DRAW' : awayWizardState;

      const homeFinalAnimation = this[`HOME_${homeAnimation}`];
      const awayFinalAnimation = this[`AWAY_${awayAnimation}`];

      this.setState({
        isHomeWinPlaying: isHomeDuelWinner,
        isHomeLosePlaying: isAwayDuelWinner,
        isAwayWinPlaying: isAwayDuelWinner,
        isAwayLosePlaying: isHomeDuelWinner,
        isDrawPlaying: isDuelDraw,
        isChargePlaying: false,
      });

      if (isHomeDuelWinner) {
        this.HOME_FX_WIN.play();
      } else if (isAwayDuelWinner) {
        this.AWAY_FX_WIN.play();
      }

      homeFinalAnimation.play();
      awayFinalAnimation.play();
      this.HOME_CHARGE.removeEventListener('complete');

      homeFinalAnimation.addEventListener('complete', () => {
        this.props.onSkip();
      });
    } else {
      this.setState({
        isChargePlaying: true,
      });

      this.HOME_CHARGE.play();
      this.AWAY_CHARGE.play();
      this.HOME_FX_CHARGE_START.play();
      this.AWAY_FX_CHARGE_START.play();
    }
  };

  chargeLoop = () => {
    this.setState({
      isChargeLoopPlaying: true,
      isButtonVisible: true,
    });

    this.HOME_CHARGE.stop();
    this.AWAY_CHARGE.stop();
    this.HOME_FX_CHARGE_START.stop();
    this.AWAY_FX_CHARGE_START.stop();

    this.HOME_CHARGE_LOOP.loop = true;
    this.AWAY_CHARGE_LOOP.loop = true;

    this.HOME_FX_CHARGE_LOOP.loop = true;
    this.AWAY_FX_CHARGE_LOOP.loop = true;

    this.HOME_CHARGE_LOOP.play();
    this.AWAY_CHARGE_LOOP.play();

    this.HOME_FX_CHARGE_LOOP.play();
    this.AWAY_FX_CHARGE_LOOP.play();
  };

  animationChain = () => {
    this.HOME_IDLE.play();
    this.AWAY_IDLE.play();

    this.HOME_IDLE.addEventListener('complete', () => {
      this.HOME_CHARGE.play();
      this.AWAY_CHARGE.play();

      this.HOME_FX_CHARGE_START.play();
      this.AWAY_FX_CHARGE_START.play();

      this.setState({
        isIdlePlaying: false,
        isChargePlaying: true,
      });
    });

    this.HOME_CHARGE.addEventListener('complete', () => {
      this.chargeLoop();

      this.setState({
        isButtonVisible: true,
        isChargePlaying: false,
      });
    });
  };

  render() {
    const {
      onSkip = () => {},
      homeWizardData,
      awayWizardData,
      moves,
      perspective,
    } = this.props;

    const {
      isDuelPlayerReady,
      isButtonVisible,
      isIdlePlaying,
      isChargePlaying,
      isChargeLoopPlaying,
      isAttackPlaying,
      isHomeResetPlaying,
      isHomeHitPlaying,
      isHomeWinPlaying,
      isHomeLosePlaying,
      isAwayResetPlaying,
      isAwayHitPlaying,
      isAwayWinPlaying,
      isAwayLosePlaying,
      isDrawPlaying,
      homeSpellType,
      awaySpellType,
      isDrawSpellPlaying,
      round,
      currentSpellHistory,
      animationsTotal,
      animationsLoaded,
      homeBar,
      awayBar,
    } = this.state;

    const loaderPercentage = `${percentageOf(
      animationsLoaded,
      animationsTotal,
    )}%`;

    let homeNickname = homeWizardData.owner?.nickname
      ? homeWizardData.owner.nickname
      : DEFAULT_USERNAME;

    let awayNickname = awayWizardData.owner?.nickname
      ? awayWizardData.owner.nickname
      : DEFAULT_USERNAME;

    if (perspective === HOME) {
      homeNickname = 'You';
    }

    if (perspective === AWAY) {
      awayNickname = 'You';
    }

    if (perspective === BOTH) {
      homeNickname = 'You';
      awayNickname = 'You';
    }

    return (
      <div className={css.page}>
        {!isDuelPlayerReady && (
          <div className={css.loader}>
            <img
              className={css.loaderImg}
              src="/static/img/fightScene/loader.gif"
              alt="battle background"
            />
            <div className={css.loadingProgress}>
              <div
                className={css.progressBar}
                style={{
                  width: loaderPercentage,
                }}
              />
            </div>
          </div>
        )}

        <div
          className={cx(css.wrapper, {
            [css.hidden]: !isDuelPlayerReady,
          })}
        >
          <img
            className={css.background}
            src="/static/img/fightScene/fightBG.svg"
            alt="battle background"
          />
          <div
            className={cx(css.scene, {
              [css.loading]: !isDuelPlayerReady,
            })}
          >
            <HomeWizard
              refs={{
                EL_HOME_IDLE: this.EL_HOME_IDLE,
                EL_HOME_CHARGE: this.EL_HOME_CHARGE,
                EL_HOME_CHARGE_LOOP: this.EL_HOME_CHARGE_LOOP,
                EL_HOME_ATTACK: this.EL_HOME_ATTACK,
                EL_HOME_RESET: this.EL_HOME_RESET,
                EL_HOME_HIT: this.EL_HOME_HIT,
                EL_HOME_WIN: this.EL_HOME_WIN,
                EL_HOME_LOSE: this.EL_HOME_LOSE,
                EL_HOME_DRAW: this.EL_HOME_DRAW,
              }}
              states={{
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
              }}
            />

            <AwayWizard
              refs={{
                EL_AWAY_IDLE: this.EL_AWAY_IDLE,
                EL_AWAY_CHARGE: this.EL_AWAY_CHARGE,
                EL_AWAY_CHARGE_LOOP: this.EL_AWAY_CHARGE_LOOP,
                EL_AWAY_ATTACK: this.EL_AWAY_ATTACK,
                EL_AWAY_RESET: this.EL_AWAY_RESET,
                EL_AWAY_HIT: this.EL_AWAY_HIT,
                EL_AWAY_WIN: this.EL_AWAY_WIN,
                EL_AWAY_LOSE: this.EL_AWAY_LOSE,
                EL_AWAY_DRAW: this.EL_AWAY_DRAW,
              }}
              states={{
                isIdlePlaying,
                isChargePlaying,
                isChargeLoopPlaying,
                isAttackPlaying,
                isAwayResetPlaying,
                isAwayHitPlaying,
                isDrawSpellPlaying,
                isAwayWinPlaying,
                isAwayLosePlaying,
                isDrawPlaying,
              }}
            />

            <HomeFX
              refs={{
                EL_HOME_FX_CHARGE_START: this.EL_HOME_FX_CHARGE_START,
                EL_HOME_FX_CHARGE_LOOP: this.EL_HOME_FX_CHARGE_LOOP,
                EL_HOME_FX_CHARGE_END: this.EL_HOME_FX_CHARGE_END,
                EL_HOME_FX_HIT: this.EL_HOME_FX_HIT,
                EL_HOME_FX_WIN: this.EL_HOME_FX_WIN,
              }}
              states={{
                isChargePlaying,
                isChargeLoopPlaying,
                isAttackPlaying,
                isHomeHitPlaying,
                isDrawSpellPlaying,
                isHomeWinPlaying,
              }}
            />

            <AwayFX
              refs={{
                EL_AWAY_FX_CHARGE_START: this.EL_AWAY_FX_CHARGE_START,
                EL_AWAY_FX_CHARGE_LOOP: this.EL_AWAY_FX_CHARGE_LOOP,
                EL_AWAY_FX_CHARGE_END: this.EL_AWAY_FX_CHARGE_END,
                EL_AWAY_FX_HIT: this.EL_AWAY_FX_HIT,
                EL_AWAY_FX_WIN: this.EL_AWAY_FX_WIN,
              }}
              states={{
                isChargePlaying,
                isChargeLoopPlaying,
                isAttackPlaying,
                isAwayHitPlaying,
                isDrawSpellPlaying,
                isAwayWinPlaying,
              }}
            />

            <HomeSpells
              refs={{
                fire: {
                  EL_HOME_SPELL_CAST: this.EL_HOME_SPELL_CAST_FIRE,
                  EL_HOME_SPELL_WIN: this.EL_HOME_SPELL_WIN_FIRE,
                  EL_HOME_SPELL_LOSE: this.EL_HOME_SPELL_LOSE_FIRE,
                },
                water: {
                  EL_HOME_SPELL_CAST: this.EL_HOME_SPELL_CAST_WATER,
                  EL_HOME_SPELL_WIN: this.EL_HOME_SPELL_WIN_WATER,
                  EL_HOME_SPELL_LOSE: this.EL_HOME_SPELL_LOSE_WATER,
                },
                wind: {
                  EL_HOME_SPELL_CAST: this.EL_HOME_SPELL_CAST_WIND,
                  EL_HOME_SPELL_WIN: this.EL_HOME_SPELL_WIN_WIND,
                  EL_HOME_SPELL_LOSE: this.EL_HOME_SPELL_LOSE_WIND,
                },
              }}
              states={{
                isAttackPlaying,
                isHomeResetPlaying,
                isHomeHitPlaying,
                homeSpellType,
                isDrawSpellPlaying,
              }}
            />

            <AwaySpells
              refs={{
                fire: {
                  EL_AWAY_SPELL_CAST: this.EL_AWAY_SPELL_CAST_FIRE,
                  EL_AWAY_SPELL_WIN: this.EL_AWAY_SPELL_WIN_FIRE,
                  EL_AWAY_SPELL_LOSE: this.EL_AWAY_SPELL_LOSE_FIRE,
                },
                water: {
                  EL_AWAY_SPELL_CAST: this.EL_AWAY_SPELL_CAST_WATER,
                  EL_AWAY_SPELL_WIN: this.EL_AWAY_SPELL_WIN_WATER,
                  EL_AWAY_SPELL_LOSE: this.EL_AWAY_SPELL_LOSE_WATER,
                },
                wind: {
                  EL_AWAY_SPELL_CAST: this.EL_AWAY_SPELL_CAST_WIND,
                  EL_AWAY_SPELL_WIN: this.EL_AWAY_SPELL_WIN_WIND,
                  EL_AWAY_SPELL_LOSE: this.EL_AWAY_SPELL_LOSE_WIND,
                },
              }}
              states={{
                isAttackPlaying,
                isAwayResetPlaying,
                isAwayHitPlaying,
                awaySpellType,
                isDrawSpellPlaying,
              }}
            />

            <SpellsFx
              refs={{
                EL_FX_SPELL_CENTRE: this.EL_FX_SPELL_CENTRE,
                EL_FX_SPELL_DRAW: this.EL_FX_SPELL_DRAW,
              }}
              states={{
                isAttackPlaying,
                isDrawSpellPlaying,
              }}
            />

            <PowerBar
              homeWizard={{
                affinity: homeWizardData.affinityType,
                currentPower: this.homeWizardInitialPower,
                nextPower: homeBar,
              }}
              awayWizard={{
                affinity: awayWizardData.affinityType,
                currentPower: this.awayWizardInitialPower,
                nextPower: awayBar,
              }}
            />
          </div>

          <div className={css.homeSpellHistory}>
            <SpellHistory
              round={currentSpellHistory}
              moves={moves}
              type="home"
            />
          </div>

          <div className={css.awaySpellHistory}>
            <SpellHistory
              round={currentSpellHistory}
              moves={moves}
              type="away"
            />
          </div>

          <div className={cx(css.nicknameContainer, css.homeNickname)}>
            <Avatar owner={homeWizardData.owner} className={css.avatar} />
            <span className={cx(css.nickname, css.homeNickname)}>
              {homeNickname}
            </span>
          </div>

          <div className={cx(css.nicknameContainer, css.awayNickname)}>
            <Avatar owner={awayWizardData.owner} className={css.avatar} />
            <span className={cx(css.nickname, css.awayNickname)}>
              {awayNickname}
            </span>
          </div>

          {isButtonVisible && (
            <Fragment>
              <div className={css.roundSign}>
                {round === TOTAL_ROUNDS ? 'Final round' : `Round 0${round + 1}`}
              </div>
              <div className={css.button}>
                <Button
                  theme={{
                    appearance: 'blackWhite',
                    display: 'inlineBlock',
                  }}
                  onClick={() => this.fight()}
                  trackingProperties={{
                    buttonId: `duelPlayer_fight`,
                  }}
                >
                  Fight
                </Button>
              </div>
            </Fragment>
          )}
        </div>

        <div className={css.skip}>
          <Button
            theme={{
              width: 'shrink',
              appearance: 'blackWhite',
              display: 'inlineBlock',
            }}
            onClick={onSkip}
            trackingProperties={{
              buttonId: `duelPlayer_skip`,
            }}
          >
            Skip
          </Button>
        </div>
      </div>
    );
  }
}

DuelPlayer.propTypes = {
  homeWizardData: PropTypes.object.isRequired,
  awayWizardData: PropTypes.object.isRequired,
  winner: PropTypes.string.isRequired,
  homeWizard: PropTypes.object.isRequired,
  awayWizard: PropTypes.object.isRequired,
  fx: PropTypes.object.isRequired,
  spells: PropTypes.object.isRequired,
  moves: PropTypes.array.isRequired,
  onSkip: PropTypes.func,
  outcome: outcomePropType,
  perspective: PropTypes.number.isRequired,
  isSoundReady: PropTypes.bool,
  onDuelPlayerReady: PropTypes.func,
  onDuelPlayerRoundStart: PropTypes.func,
};

DuelPlayer.defaultProps = {
  onSkip: () => {},
  outcome: undefined,
  isSoundReady: false,
  onDuelPlayerReady: () => {},
  onDuelPlayerRoundStart: () => {},
};

export default soundManager(DuelPlayer);
