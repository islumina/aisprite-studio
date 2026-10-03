import { setFrameDuration } from './atlas-model.js';
import * as preview from './preview.js';
import { DEFAULT_FRAME_DURATION_MS } from './constants.js';

/**
 * Setup and return the Timeline module interface.
 * @param {object} els - DOM elements map.
 * @param {function} getAtlas - getter function returning the current atlas state.
 * @param {function} getCurFrameIdx - getter function returning the current frame index.
 * @param {function} setPlayStatePause - callback to pause playback state (e.g. updatePlayPauseBtn(false)).
 */
export function setupTimeline(els, getAtlas, getCurFrameIdx, setPlayStatePause) {
  return {
    render: (pb) => {
      if (!els.timelineList) return;
      els.timelineList.innerHTML = '';
      if (!pb || !pb.frames) return;

      const atlas = getAtlas();
      const curFrameIdx = getCurFrameIdx();

      pb.frames.forEach((fk, idx) => {
        const frameEl = document.createElement('div');
        frameEl.className = `timeline-frame${idx === curFrameIdx ? ' active' : ''}`;
        frameEl.dataset.index = idx;

        // A real button, so Tab reaches the frame and Enter/Space select it (the click bubbles
        // to frameEl). It sits beside the duration field because a button cannot contain one.
        const numBtn = document.createElement('button');
        numBtn.type = 'button';
        numBtn.className = 'timeline-frame-num';
        numBtn.textContent = `#${idx}`;
        numBtn.setAttribute('aria-label', `Frame #${idx}`);
        if (idx === curFrameIdx) numBtn.setAttribute('aria-current', 'true');

        const durInput = document.createElement('input');
        durInput.type = 'number';
        durInput.className = 'timeline-frame-dur';
        durInput.min = '20';
        durInput.max = '2000';
        durInput.step = '10';
        durInput.setAttribute('aria-label', `Frame #${idx} duration (ms)`);

        const dur = atlas.frames[fk]?.duration || pb.durationMs;
        durInput.value = dur;

        // Jump to specific frame on click
        frameEl.addEventListener('click', (e) => {
          if (e.target === durInput) return; // avoid navigation when editing duration
          preview.gotoFrame(idx);
          setPlayStatePause();
        });

        // Realtime duration tuning
        durInput.addEventListener('change', () => {
          const ms = parseInt(durInput.value, 10) || DEFAULT_FRAME_DURATION_MS;
          setFrameDuration(atlas, fk, ms);
        });

        // Prevent document key handlers from firing when typing in the input
        durInput.addEventListener('keydown', (e) => {
          e.stopPropagation();
        });

        frameEl.appendChild(numBtn);
        frameEl.appendChild(durInput);
        els.timelineList.appendChild(frameEl);
      });
    },

    highlight: (idx) => {
      if (!els.timelineList) return;
      const cards = els.timelineList.querySelectorAll('.timeline-frame');
      cards.forEach((card, i) => {
        const isActive = i === idx;
        card.classList.toggle('active', isActive);
        const numBtn = card.querySelector('.timeline-frame-num');
        if (isActive) numBtn?.setAttribute('aria-current', 'true');
        else numBtn?.removeAttribute('aria-current');
        if (isActive) {
          // Use container.scrollTo instead of scrollIntoView to avoid vertical page shaking.
          // Smoothness comes from CSS scroll-behavior, which prefers-reduced-motion turns off.
          const container = els.timelineList;
          const cardCenter = card.offsetLeft + card.clientWidth / 2;
          const containerCenter = container.clientWidth / 2;
          container.scrollTo({ left: cardCenter - containerCenter });
        }
      });
    }
  };
}
