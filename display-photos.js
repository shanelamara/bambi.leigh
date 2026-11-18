'use strict';

async function loadDisplayPhotos() {
  const section = document.querySelector('#display-photos');
  const response = await fetch('/api/display-photos');
  if (!response.ok) return;
  const photos = await response.json();
  if (!photos.length) return;

  const gallery = section.querySelector('.display-photo-grid');
  for (const photo of photos) {
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.src = `/api/display-photos/${photo.id}/image`;
    image.alt = photo.label;
    image.loading = 'lazy';
    const caption = document.createElement('figcaption');
    caption.textContent = photo.label;
    figure.append(image, caption);
    gallery.append(figure);
  }
  section.hidden = false;
}

loadDisplayPhotos().catch(error => console.error('Could not load the website photo gallery.', error));
