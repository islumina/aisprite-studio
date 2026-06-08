import { bus, EV } from './bus.js';
import * as preview from './preview.js';

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
        
        const numSpan = document.createElement('span');
        numSpan.className = 'timeline-frame-num';
        numSpan.textContent = `#${idx}`;
        
        const durInput = document.createElement('input');
        durInput.type = 'number';
        durInput.className = 'timeline-frame-dur';
        durInput.min = '20';
        durInput.max = '2000';
        durInput.step = '10';
        
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
          const ms = parseInt(durInput.value, 10) || 125;
          if (atlas.frames[fk]) {
            atlas.frames[fk].duration = ms;
            bus.emit(EV.ATLAS_CHANGED, { reason: `frame-duration:${fk}` });
          }
        });
        
        // Prevent document key handlers from firing when typing in the input
        durInput.addEventListener('keydown', (e) => {
          e.stopPropagation();
        });
        
        frameEl.appendChild(numSpan);
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
        if (isActive) {
          // Use container.scrollTo instead of scrollIntoView to avoid vertical page shaking
          const container = els.timelineList;
          const cardCenter = card.offsetLeft + card.clientWidth / 2;
          const containerCenter = container.clientWidth / 2;
          container.scrollTo({
            left: cardCenter - containerCenter,
            behavior: 'smooth'
          });
        }
      });
    }
  };
}
