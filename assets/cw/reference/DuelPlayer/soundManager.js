import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Tone from 'tone';
import withSoundState from 'contexts/sound-state/withSoundState.js';
import { states as soundStates } from 'lib/sound/sound.js';

/**
 * This is the collection of all sound bites
 * @type {Object}
 */
const samples = {
  fightIntro: '/static/sound/fight-intro.wav',
  fightLoop: '/static/sound/fight-loop.wav',
  fightRound0: '/static/sound/fight-round-1.wav',
  fightRound1: '/static/sound/fight-round-2.wav',
  fightRound2: '/static/sound/fight-round-3.wav',
  fightRound3: '/static/sound/fight-round-4.wav',
  fightRound4: '/static/sound/fight-round-5.wav',
  voiceRound0: '/static/sound/voice-round-1.wav',
  voiceRound1: '/static/sound/voice-round-2.wav',
  voiceRound2: '/static/sound/voice-round-3.wav',
  voiceRound3: '/static/sound/voice-round-4.wav',
  voiceRound4: '/static/sound/voice-round-5.wav',
};

function soundManager(WrappedComponent) {
  class EnhancedComponent extends Component {
    static propTypes = {
      soundState: PropTypes.string,
    };

    static defaultProps = {
      soundState: undefined,
    };

    constructor(props) {
      super(props);
    }

    /**
     * Defaults ready state to false
     * @type {Object}
     */
    state = {
      ready: false,
    };

    /**
     * Initializes the player and starts the Tone Transport, which is a time
     * keeper
     */
    componentDidMount() {
      this.players = new Tone.Players(samples, this.onSoundReady).toMaster();
      // Mute all players immediately if sound is disabled
      if (this.props.soundState === soundStates.off) {
        this.players.mute = true;
      }
      this.players.get('fightLoop').loop = true; // Default fightLoop to be a looping sample
      Tone.Transport.start();
    }

    componentDidUpdate(prevProps) {
      if (
        this.props.soundState === soundStates.on &&
        prevProps.soundState === soundStates.off
      ) {
        this.players.mute = false;
      }

      if (
        this.props.soundState === soundStates.off &&
        prevProps.soundState === soundStates.on
      ) {
        this.players.mute = true;
      }
    }

    /**
     * Kills the Transport Timer and disposes of all the players on component
     * unmount
     */
    componentWillUnmount() {
      Tone.Transport.stop();
      this.players.dispose();
    }

    /**
     * This gets invoked once all the samples are ready and loaded. At that
     * point, we can update the ready state to true.
     */
    onSoundReady = () => {
      console.log(
        '%c🔊 The only good system is a sound system',
        'padding: 4px 8px; color: black; background-color: #fff240;',
      );
      this.setState({
        ready: true,
      });
    };

    /**
     * This gets passed in to the DuelPlayer component, and gets fired once the
     * DuelPlayer is fully ready to go. At that point, we can initialise the
     * sound.
     */
    onDuelPlayerReady = () => {
      this.start('fightIntro');
      // Schedule once the fight loop sample
      this.scheduleOnceIn(1.8, () => this.start('fightLoop'));

      // Schedule once the round 1 vocal sample
      this.scheduleOnceIn(2.2, () => this.start('voiceRound0'));
    };

    /**
     * This gets passed in to the DuelPlayer component, and gets invoked once
     * each "round" begins, i.e. once a user hits the "fight" button in the UI.
     * @param {Number} round The round index, 0 - 4
     */
    onDuelPlayerRoundStart = (round) => {
      // Stop the previously plating fight loop sample
      this.stop('fightLoop');

      // Start the fight round sample
      this.start(`fightRound${round}`);

      // If it's not the final round, then schedule the fight loop and the round
      // vocal sample
      if (round !== 4) {
        // Schedule once the loop
        this.scheduleOnceIn(2.2, () => this.restart('fightLoop'));

        // Schedule once the round vocal sample. Note that we have to look one
        // round ahead here, because this is the vocal sample for the beginning
        // of the next round.
        this.scheduleOnceIn(3.6, () => this.start(`voiceRound${round + 1}`));
      }
    };

    /**
     * Convenience function for getting the seconds on the Transport at the
     * current time.
     * @return {Time} A Tone Time type, in seconds
     */
    getSecondsAtTime = () => {
      return Tone.Transport.getSecondsAtTime();
    };

    /**
     * Convenience function for scheduling a callback once in `n` seconds
     * @param {Number} time Number of seconds from now to run the callback
     * @param {Function} callback Callback to run after `n` seconds
     */
    scheduleOnceIn = (n, callback) => {
      const currentTime = this.getSecondsAtTime();
      Tone.Transport.scheduleOnce(callback, currentTime + n);
    };

    /**
     * Convenience function for starting a specific player
     * @param {String} name Name of the player
     */
    start = (name) => {
      this.players.get(name).start();
    };

    /**
     * Convenience function for restarting a specific player
     * @param {String} name Name of the player
     */
    restart = (name) => {
      this.players.get(name).restart();
    };

    /**
     * Convenience function for stoping a specific player
     * @param {String} name Name of the player
     */
    stop = (name) => {
      this.players.get(name).stop();
    };

    render() {
      return (
        <WrappedComponent
          isSoundReady={this.state.ready}
          onDuelPlayerReady={this.onDuelPlayerReady}
          onDuelPlayerRoundStart={this.onDuelPlayerRoundStart}
          {...this.props}
        />
      );
    }
  }

  return withSoundState(EnhancedComponent);
}

export default soundManager;
