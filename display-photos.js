'use strict';

async function loadDisplayPhotos() {
  const section = document.querySelector('#display-photos');
  const response = await fetch('/api/display-photos');
  if (!response.ok) return;
  const photos = await response.json();
  if (!photos.length) return;

  const gallery = section.querySelector('.photo-carousel-slides');
  const slides = photos.map((photo, index) => {
    const figure = document.createElement('figure');
    figure.setAttribute('role', 'group');
    figure.setAttribute('aria-roledescription', 'slide');
    figure.setAttribute('aria-label', `${index + 1} of ${photos.length}`);
    figure.hidden = index !== 0;
    const image = document.createElement('img');
    image.src = `/api/display-photos/${photo.id}/image`;
    image.alt = photo.label;
    image.loading = 'lazy';
    const caption = document.createElement('figcaption');
    caption.textContent = photo.label;
    figure.append(image, caption);
    return figure;
  });
  gallery.append(...slides);
  section.hidden = false;
  if (slides.length > 1) startSlideshow(section, gallery, slides);
}

function startSlideshow(section, gallery, slides) {
  const carousel = section.querySelector('.photo-carousel');
  const controls = carousel.querySelector('.photo-carousel-controls');
  const rotation = controls.querySelector('[data-photo-rotation]');
  const position = controls.querySelector('.photo-carousel-position');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const page = document.documentElement;
  let rotating = !reducedMotion.matches;
  let visible = false;
  let hovering = false;
  let index = 0;
  let timer;

  function show(step) {
    slides[index].hidden = true;
    index = (index + step + slides.length) % slides.length;
    slides[index].dataset.direction = step < 0 ? 'previous' : 'next';
    slides[index].hidden = false;
    position.textContent = `${index + 1} / ${slides.length}`;
  }

  function schedule() {
    clearTimeout(timer);
    const playing = rotating && !page.classList.contains('paused');
    rotation.textContent = rotating ? 'Pause slideshow' : 'Play slideshow';
    gallery.setAttribute('aria-live', playing ? 'off' : 'polite');
    if (!playing || !visible || hovering || document.hidden) return;
    timer = setTimeout(() => {
      show(1);
      schedule();
    }, 5000);
  }

  rotation.addEventListener('click', () => {
    rotating = !rotating;
    schedule();
  });
  for (const button of controls.querySelectorAll('[data-photo-step]')) {
    button.addEventListener('click', () => {
      rotating = false;
      schedule();
      show(Number(button.dataset.photoStep));
    });
  }
  carousel.addEventListener('focusin', event => {
    if (event.target !== rotation) {
      rotating = false;
      schedule();
    }
  });
  carousel.addEventListener('mouseenter', () => {
    hovering = true;
    schedule();
  });
  carousel.addEventListener('mouseleave', () => {
    hovering = false;
    schedule();
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) rotating = false;
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  new MutationObserver(schedule).observe(page, { attributes: true, attributeFilter: ['class'] });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }, { threshold: 0.2 }).observe(carousel);

  position.textContent = `1 / ${slides.length}`;
  controls.hidden = false;
  schedule();
}

loadDisplayPhotos().catch(error => console.error('Could not load the website photo gallery.', error));
