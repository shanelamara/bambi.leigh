'use strict';

const element = id => document.getElementById(id);
const endpoint = '/api/admin/photos';
const signIn = element('sign-in');
const management = element('management');
const signOut = element('sign-out');
const status = element('status');
const gallery = element('photos');
const storefrontGallery = element('storefront-photos');
const editor = element('editor');
const confirmation = element('confirmation');
const label = element('photo-label');
const file = element('photo-file');
const published = element('photo-published');
let maxPhotoBytes = 5 * 1024 * 1024;
let selectedPhoto;

async function request(path, method = 'GET', data = {}, onSuccess) {
  const options = method === 'GET' ? {} : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error);
    error.status = response.status;
    throw error;
  }
  onSuccess?.(response);
  return result;
}

function lockGallery() {
  gallery.replaceChildren();
  storefrontGallery.replaceChildren();
  editor.close();
  confirmation.close();
  selectedPhoto = undefined;
  element('photo-form').reset();
  element('confirmation-text').textContent = '';
  management.hidden = true;
  signOut.hidden = true;
  signIn.hidden = false;
}

function showError(error, target = status) {
  if (error.status === 401 && !management.hidden) {
    lockGallery();
    status.textContent = 'Your session has ended. Sign in again to manage photos.';
    element('access-code').focus();
    return;
  }
  target.textContent = error.message;
}

function openEditor(photo) {
  selectedPhoto = photo;
  element('editor-title').textContent = photo ? 'Edit photo' : 'Add photo';
  element('file-label').textContent = photo ? 'Replacement photo (optional)' : 'Photo';
  element('editor-error').textContent = '';
  label.value = photo?.label ?? '';
  file.value = '';
  file.required = !photo;
  published.checked = photo?.published === true;
  element('publish-help').textContent = photo?.placement
    ? `This controls the photo wherever it appears: ${photo.placement}.`
    : 'Published photos are visible to anyone who visits the homepage.';
  editor.showModal();
}

function openConfirmation(photo) {
  selectedPhoto = photo;
  element('delete-error').textContent = '';
  element('confirmation-text').textContent = `Delete “${photo.label}” from the authentication photo gallery?`;
  confirmation.showModal();
}

function photoCard(photo) {
  const card = document.createElement('li');
  const image = document.createElement('img');
  image.src = `${endpoint}/${photo.id}/image?v=${encodeURIComponent(photo.updatedAt)}`;
  image.alt = photo.label;
  image.loading = 'lazy';
  const details = document.createElement('div');
  details.className = 'photo-details';
  const title = document.createElement('h3');
  title.textContent = photo.label;
  const date = document.createElement('small');
  const visibility = photo.published ? 'Shown on website' : 'Private';
  const updated = photo.updatedAt && `Updated ${new Date(photo.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  date.textContent = [visibility, photo.placement, updated].filter(Boolean).join(' · ');
  const actions = document.createElement('div');
  actions.className = 'admin-actions';
  const edit = document.createElement('button');
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit ${photo.label}`);
  edit.onclick = () => openEditor(photo);
  const remove = document.createElement('button');
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${photo.label}`);
  remove.onclick = () => openConfirmation(photo);
  actions.append(edit);
  if (!photo.placement) actions.append(remove);
  details.append(title, date, actions);
  card.append(image, details);
  return card;
}

async function loadGallery() {
  const photos = await request(endpoint, 'GET', {}, response => {
    maxPhotoBytes = Number(response.headers.get('X-Photo-Max-Bytes')) || maxPhotoBytes;
    element('file-help').textContent = `JPEG, PNG, or WebP, up to ${maxPhotoBytes / 1024 ** 2} MB.`;
  });
  const uploaded = photos.filter(photo => !photo.placement);
  storefrontGallery.replaceChildren(...photos.filter(photo => photo.placement).map(photoCard));
  gallery.replaceChildren(...uploaded.map(photoCard));
  element('empty-gallery').hidden = uploaded.length !== 0;
  signIn.hidden = true;
  management.hidden = false;
  signOut.hidden = false;
}

function readPhoto(upload) {
  if (upload.size > maxPhotoBytes) throw new Error(`Photos must be ${maxPhotoBytes / 1024 ** 2} MB or smaller.`);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the selected photo.'));
    reader.readAsDataURL(upload);
  });
}

function onSubmit(id, action, errorTarget = status) {
  const form = element(id);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button:not([type])');
    if (button.disabled) return;
    button.disabled = true;
    form.inert = true;
    errorTarget.textContent = '';
    try {
      await action();
    } catch (error) {
      showError(error, errorTarget);
    } finally {
      form.inert = false;
      button.disabled = false;
    }
  });
}

onSubmit('login-form', async () => {
  const code = element('access-code');
  try {
    await request('/api/admin/session', 'POST', { code: code.value });
    await loadGallery();
    element('add-photo').focus();
  } finally {
    code.value = '';
  }
});

async function refreshAfterChange(message) {
  status.textContent = message;
  try {
    await loadGallery();
  } catch (error) {
    if (error.status === 401) showError(error);
    else status.textContent = `${message} Reload the page to refresh the gallery.`;
  }
  if (!management.hidden) element('add-photo').focus();
}

onSubmit('photo-form', async () => {
  const photo = selectedPhoto;
  const data = { label: label.value, published: published.checked };
  if (file.files[0]) data.image = await readPhoto(file.files[0]);
  await request(photo ? `${endpoint}/${photo.id}` : endpoint, photo ? 'PATCH' : 'POST', data);
  editor.close();
  await refreshAfterChange(photo ? 'Photo updated.' : 'Photo added.');
}, element('editor-error'));

onSubmit('delete-form', async () => {
  await request(`${endpoint}/${selectedPhoto.id}`, 'DELETE');
  confirmation.close();
  await refreshAfterChange('Photo deleted.');
}, element('delete-error'));

signOut.onclick = async () => {
  signOut.disabled = true;
  try {
    await request('/api/admin/session', 'DELETE');
    lockGallery();
    status.textContent = 'Signed out.';
    element('access-code').focus();
  } catch (error) {
    showError(error);
  } finally {
    signOut.disabled = false;
  }
};

element('add-photo').onclick = () => openEditor();
element('cancel-edit').onclick = () => editor.close();
element('cancel-delete').onclick = () => confirmation.close();
for (const dialog of [editor, confirmation]) {
  dialog.addEventListener('cancel', event => {
    if (dialog.querySelector('form').inert) event.preventDefault();
  });
}

loadGallery().catch(error => {
  lockGallery();
  if (error.status === 503) signIn.hidden = true;
  if (error.status !== 401) showError(error);
});
